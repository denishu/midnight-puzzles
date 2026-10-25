// Unit tests for Betweenle game logic (pure, mostly file-free via loadFromArrays).
//
// Covers: dictionary/rank loading + invariant, alphabetical BEFORE/AFTER/correct
// direction, distance-percent formula, bound tightening, the 14-guess cap, the
// 5-3-3-2-1 score bands, win/loss, daily determinism, and guess validation.
// One suite loads the REAL data files to assert integrity (every answer ranked).

import * as fs from 'fs';
import * as path from 'path';
import { BetweenleWords } from '../../../games/betweenle/BetweenleWords';
import {
  BetweenleGame,
  MAX_GUESSES,
  scoreForGuessNumber,
  guessesRemaining,
} from '../../../games/betweenle/BetweenleGame';

/** A tiny deterministic dictionary for unit tests. Sorted order matters. */
const DICT = [
  'apple', 'bravo', 'crane', 'delta', 'eagle', 'fable', 'grape', 'house',
  'igloo', 'jolly', 'kebab', 'lemon', 'mango', 'noble', 'ocean', 'piano',
  'quart', 'robin', 'stone', 'tiger', 'umbra', 'vivid', 'wager', 'xenon',
  'yacht', 'zebra',
];
// Secret candidates are a subset (the "common" list).
const ANSWERS = ['crane', 'house', 'mango', 'stone', 'zebra'];

function freshGame(): BetweenleGame {
  const words = new BetweenleWords();
  words.loadFromArrays(ANSWERS, DICT);
  return new BetweenleGame(words);
}

/** Build a state whose secret we force, so direction/distance are predictable. */
function stateWithSecret(game: BetweenleGame, secret: string) {
  const s = game.newState(new Date('2026-10-25T12:00:00Z'));
  s.secret = secret;
  // reset derived fields so the forced secret is clean
  s.guesses = [];
  s.lowerBound = 'aaaaa';
  s.upperBound = 'zzzzz';
  s.isComplete = false;
  s.isWin = false;
  s.score = 0;
  return s;
}

describe('BetweenleWords (rank space + distance)', () => {
  it('builds a sorted, deduped rank space and ranks every answer', () => {
    const w = new BetweenleWords();
    w.loadFromArrays(ANSWERS, DICT);
    expect(w.size).toBe(DICT.length);               // DICT already contains all answers
    for (const a of ANSWERS) expect(w.rankOf(a)).toBeGreaterThanOrEqual(0);
    // sorted: 'apple' is rank 0, 'zebra' is last
    expect(w.rankOf('apple')).toBe(0);
    expect(w.rankOf('zebra')).toBe(DICT.length - 1);
  });

  it('includes answers in the rank space even if the dictionary omits them', () => {
    const w = new BetweenleWords();
    w.loadFromArrays(['mango'], ['apple', 'zebra']); // dict omits the answer
    expect(w.rankOf('mango')).toBeGreaterThanOrEqual(0);
    expect(w.size).toBe(3); // apple, mango, zebra (union, sorted)
  });

  it('distancePercent = |rankdiff| / size * 100, rounded to 2dp', () => {
    const w = new BetweenleWords();
    w.loadFromArrays(ANSWERS, DICT);
    // apple(0) vs zebra(25) over size 26 -> 25/26*100 = 96.15
    expect(w.distancePercent('apple', 'zebra')).toBe(96.15);
    // adjacent words -> 1/26*100 = 3.85
    expect(w.distancePercent('apple', 'bravo')).toBe(3.85);
    // identical -> 0
    expect(w.distancePercent('mango', 'mango')).toBe(0);
  });

  it('throws for empty answers', () => {
    const w = new BetweenleWords();
    expect(() => w.loadFromArrays([], DICT)).toThrow();
  });
});

describe('scoreForGuessNumber (5-3-3-2-1 bands)', () => {
  it('maps guess number to the right score tier', () => {
    const expected: Record<number, number> = {
      1: 5, 2: 5, 3: 5, 4: 5, 5: 5,   // first 5 -> 5
      6: 4, 7: 4, 8: 4,               // next 3 -> 4
      9: 3, 10: 3, 11: 3,             // next 3 -> 3
      12: 2, 13: 2,                   // next 2 -> 2
      14: 1,                          // last 1 -> 1
    };
    for (const n of Object.keys(expected).map(Number)) {
      expect(scoreForGuessNumber(n)).toBe(expected[n]);
    }
    expect(scoreForGuessNumber(0)).toBe(0);
    expect(scoreForGuessNumber(15)).toBe(0);
  });
});

describe('BetweenleGame.guess (direction, distance, bounds)', () => {
  it('marks a guess before/after/correct by alphabetical order', () => {
    const game = freshGame();
    const s = stateWithSecret(game, 'mango');

    expect(game.guess(s, 'crane').guess!.direction).toBe('before'); // crane < mango
    expect(game.guess(s, 'stone').guess!.direction).toBe('after');  // stone > mango
    const win = game.guess(s, 'mango');
    expect(win.guess!.direction).toBe('correct');
    expect(win.guess!.distance).toBe(0);
  });

  it('tightens lower/upper bounds toward the secret', () => {
    const game = freshGame();
    const s = stateWithSecret(game, 'noble'); // rank 13

    game.guess(s, 'apple'); // before -> lowerBound apple
    expect(s.lowerBound).toBe('apple');
    game.guess(s, 'mango'); // before, closer -> lowerBound mango
    expect(s.lowerBound).toBe('mango');
    game.guess(s, 'zebra'); // after -> upperBound zebra
    expect(s.upperBound).toBe('zebra');
    game.guess(s, 'piano'); // after, closer -> upperBound piano
    expect(s.upperBound).toBe('piano');
    // a farther guess on a side should NOT loosen the bound
    game.guess(s, 'bravo'); // before but farther than mango -> lowerBound stays
    expect(s.lowerBound).toBe('mango');
  });

  it('reports the distance percent for a non-winning guess', () => {
    const game = freshGame();
    const s = stateWithSecret(game, 'apple'); // rank 0
    const out = game.guess(s, 'zebra');        // rank 25
    expect(out.guess!.distance).toBe(96.15);
  });
});

describe('BetweenleGame win/loss + scoring', () => {
  it('wins and scores by the guess number it was solved on', () => {
    const game = freshGame();
    const s = stateWithSecret(game, 'mango');
    game.guess(s, 'apple'); // 1
    game.guess(s, 'bravo'); // 2
    const win = game.guess(s, 'mango'); // 3rd guess -> still band 1 -> score 5
    expect(win.ok).toBe(true);
    expect(s.isComplete).toBe(true);
    expect(s.isWin).toBe(true);
    expect(s.score).toBe(5);
  });

  it('loses after 14 wrong guesses, scoring 0', () => {
    const game = freshGame();
    const s = stateWithSecret(game, 'mango');
    // 14 distinct non-'mango' dictionary words.
    const wrong = DICT.filter(w => w !== 'mango').slice(0, MAX_GUESSES);
    expect(wrong.length).toBe(MAX_GUESSES);
    let last;
    for (const w of wrong) last = game.guess(s, w);
    expect(last!.ok).toBe(true);
    expect(s.isComplete).toBe(true);
    expect(s.isWin).toBe(false);
    expect(s.score).toBe(0);
    expect(guessesRemaining(s)).toBe(0);
  });

  it('scores 4 when solved on the 6th guess (band 2)', () => {
    const game = freshGame();
    const s = stateWithSecret(game, 'mango');
    const fillers = DICT.filter(w => w !== 'mango').slice(0, 5); // 5 wrong
    for (const w of fillers) game.guess(s, w);
    game.guess(s, 'mango'); // 6th
    expect(s.score).toBe(4);
  });
});

describe('BetweenleGame.guess validation', () => {
  it('rejects non-5-letter, non-dictionary, duplicate, and post-game guesses', () => {
    const game = freshGame();
    const s = stateWithSecret(game, 'mango');

    expect(game.guess(s, 'abc').ok).toBe(false);          // too short
    expect(game.guess(s, 'zzzzz').ok).toBe(false);        // 5 letters but not in dict
    game.guess(s, 'crane');
    expect(game.guess(s, 'crane').ok).toBe(false);        // duplicate

    // finish the game, then reject further guesses
    game.guess(s, 'mango');
    expect(game.guess(s, 'stone').ok).toBe(false);
  });
});

describe('daily determinism', () => {
  it('returns the same secret for the same UTC date, and a valid answer', () => {
    const game = freshGame();
    const d = new Date('2026-10-25T09:30:00Z');
    const a = game.secretForDate(d);
    const b = game.secretForDate(new Date('2026-10-25T23:59:00Z')); // same UTC day
    expect(a).toBe(b);
    expect(ANSWERS).toContain(a);
  });

  it('is stable across constructions (no per-run randomness)', () => {
    const d = new Date('2026-11-01T00:00:00Z');
    expect(freshGame().secretForDate(d)).toBe(freshGame().secretForDate(d));
  });
});

describe('real data files integrity', () => {
  const answersPath = path.join(process.cwd(), 'data/dictionaries/betweenle-answers.txt');
  const dictPath = path.join(process.cwd(), 'data/dictionaries/wordle-valid-guesses.txt');
  const haveFiles = fs.existsSync(answersPath) && fs.existsSync(dictPath);

  (haveFiles ? it : it.skip)('loads real lists; every answer is ranked; secret is always a 5-letter answer', () => {
    const w = new BetweenleWords();
    w.loadFromDisk(answersPath, dictPath);
    expect(w.answersList.length).toBeGreaterThan(2000);
    for (const a of w.answersList) expect(w.rankOf(a)).toBeGreaterThanOrEqual(0); // invariant

    const game = new BetweenleGame(w);
    // Spot-check determinism + validity across a span of dates.
    for (let i = 0; i < 30; i++) {
      const d = new Date(Date.UTC(2026, 9, 1 + i));
      const secret = game.secretForDate(d);
      expect(secret).toMatch(/^[a-z]{5}$/);
      expect(w.rankOf(secret)).toBeGreaterThanOrEqual(0);
    }
  });
});
