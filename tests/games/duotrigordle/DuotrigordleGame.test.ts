import { WordValidator } from '../../../games/duotrigordle/WordValidator';
import {
  GridManager,
  DuotrigordlePuzzle,
  GRID_COUNT,
  MAX_GUESSES,
} from '../../../games/duotrigordle/GridManager';
import { ProgressTracker } from '../../../games/duotrigordle/ProgressTracker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a small validator with known words for fast, deterministic tests. */
function makeValidator(answers: string[], extras: string[] = []): WordValidator {
  const v = new WordValidator();
  v.loadFromArrays(answers, extras);
  return v;
}

/** Generate 40 unique 5-letter alphabetic "words" for testing. */
function generate32Words(): string[] {
  const words: string[] = [];
  for (let i = 0; i < 40; i++) {
    // Encode index into 2 lowercase letters (a-z gives 676 combos, plenty for 40)
    const c1 = String.fromCharCode(97 + Math.floor(i / 26));
    const c2 = String.fromCharCode(97 + (i % 26));
    words.push('aaa' + c1 + c2);
  }
  return words;
}

const SAMPLE_ANSWERS = generate32Words();
const EXTRA_GUESSES = ['zzzaa', 'zzzab', 'zzzac'];

// ---------------------------------------------------------------------------
// WordValidator
// ---------------------------------------------------------------------------

describe('WordValidator', () => {
  it('loads from arrays and validates guesses', () => {
    const v = makeValidator(['apple', 'grape'], ['plumb']);
    expect(v.isValidGuess('apple')).toBe(true);
    expect(v.isValidGuess('grape')).toBe(true);
    expect(v.isValidGuess('plumb')).toBe(true);
    expect(v.isValidGuess('zzzzz')).toBe(false);
  });

  it('distinguishes answers from extra guesses', () => {
    const v = makeValidator(['apple'], ['plumb']);
    expect(v.isValidAnswer('apple')).toBe(true);
    expect(v.isValidAnswer('plumb')).toBe(false);
  });

  it('is case-insensitive', () => {
    const v = makeValidator(['apple']);
    expect(v.isValidGuess('APPLE')).toBe(true);
    expect(v.isValidAnswer('Apple')).toBe(true);
  });

  it('reports correct counts', () => {
    const v = makeValidator(['apple', 'grape'], ['plumb']);
    expect(v.answerCount).toBe(2);
    expect(v.guessCount).toBe(3);
  });

  it('getAnswersList returns a copy', () => {
    const v = makeValidator(['apple', 'grape']);
    const list = v.getAnswersList();
    expect(list).toEqual(['apple', 'grape']);
    list.push('extra');
    expect(v.getAnswersList().length).toBe(2);
  });

  it('loads real word lists from disk', () => {
    const v = new WordValidator();
    v.loadWordLists();
    expect(v.answerCount).toBe(5364);
    expect(v.guessCount).toBeGreaterThan(5364);
    expect(v.isValidAnswer('crane')).toBe(true);
    expect(v.isValidGuess('crane')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GridManager — evaluateGuess
// ---------------------------------------------------------------------------

describe('GridManager.evaluateGuess', () => {
  const v = makeValidator(SAMPLE_ANSWERS, EXTRA_GUESSES);
  const gm = new GridManager(v);

  it('marks all correct (green) for exact match', () => {
    const fb = gm.evaluateGuess('apple', 'apple');
    expect(fb.every(f => f.status === 'correct')).toBe(true);
  });

  it('marks all absent (gray) when no letters match', () => {
    const fb = gm.evaluateGuess('xxxxx', 'apple');
    expect(fb.every(f => f.status === 'absent')).toBe(true);
  });

  it('marks present (yellow) for right letter wrong position', () => {
    // guess "elppa" vs target "apple"
    const fb = gm.evaluateGuess('elppa', 'apple');
    // e at 0: target has e at 4 → present
    expect(fb[0]!.status).toBe('present');
    // l at 1: target has l at 3 → present
    expect(fb[1]!.status).toBe('present');
    // p at 2: target has p at 2 → correct
    expect(fb[2]!.status).toBe('correct');
    // p at 3: target has p at 1 → present
    expect(fb[3]!.status).toBe('present');
    // a at 4: target has a at 0 → present
    expect(fb[4]!.status).toBe('present');
  });

  it('handles duplicate letters correctly — only one yellow per remaining', () => {
    // target "aabbc", guess "aaxxa"
    // a@0 → correct, a@1 → correct, x@2 → absent, x@3 → absent, a@4 → absent (no more a's left)
    const fb = gm.evaluateGuess('aaxxa', 'aabbc');
    expect(fb[0]!.status).toBe('correct');
    expect(fb[1]!.status).toBe('correct');
    expect(fb[4]!.status).toBe('absent');
  });

  it('produces feedback with correct positions', () => {
    const fb = gm.evaluateGuess('hello', 'world');
    for (let i = 0; i < 5; i++) {
      expect(fb[i]!.position).toBe(i);
      expect(fb[i]!.letter).toBe('hello'[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// GridManager — applyGuess across 32 grids
// ---------------------------------------------------------------------------

describe('GridManager.applyGuess', () => {
  function setupGame(): { gm: GridManager; puzzle: DuotrigordlePuzzle } {
    const targets = SAMPLE_ANSWERS.slice(0, GRID_COUNT);
    const allWords = [...targets, ...EXTRA_GUESSES];
    const v = makeValidator(allWords, EXTRA_GUESSES);
    const gm = new GridManager(v);
    const puzzle: DuotrigordlePuzzle = { targetWords: targets, date: '2026-01-01' };
    gm.initializeGrids(puzzle);
    return { gm, puzzle };
  }

  it('rejects invalid words', () => {
    const { gm } = setupGame();
    const r = gm.applyGuess('notaw');
    expect(r.isValid).toBe(false);
    expect(r.error).toBeDefined();
  });

  it('rejects non-5-letter input', () => {
    const { gm } = setupGame();
    expect(gm.applyGuess('hi').isValid).toBe(false);
    expect(gm.applyGuess('toolong').isValid).toBe(false);
  });

  it('applies guess to all 32 grids', () => {
    const { gm } = setupGame();
    const r = gm.applyGuess(EXTRA_GUESSES[0]!);
    expect(r.isValid).toBe(true);
    expect(r.feedbacks.length).toBe(GRID_COUNT);
    expect(r.guessNumber).toBe(1);
  });

  it('marks grid complete when target is guessed', () => {
    const { gm, puzzle } = setupGame();
    const target0 = puzzle.targetWords[0]!;
    const r = gm.applyGuess(target0);
    expect(r.isValid).toBe(true);
    expect(r.completedGrids).toContain(0);
    expect(r.totalCompleted).toBeGreaterThanOrEqual(1);
    expect(gm.getGrid(0)!.isComplete).toBe(true);
  });

  it('tracks guess count and remaining', () => {
    const { gm } = setupGame();
    gm.applyGuess(EXTRA_GUESSES[0]!);
    gm.applyGuess(EXTRA_GUESSES[1]!);
    expect(gm.getGuessCount()).toBe(2);
    expect(gm.getRemainingGuesses()).toBe(MAX_GUESSES - 2);
  });

  it('game over after MAX_GUESSES', () => {
    const targets = SAMPLE_ANSWERS.slice(0, GRID_COUNT);
    // Use a large pool so we have enough unique valid guesses (alphabetic only)
    const pool: string[] = [];
    for (let i = 0; i < 50; i++) {
      const c1 = String.fromCharCode(97 + Math.floor(i / 26));
      const c2 = String.fromCharCode(97 + (i % 26));
      pool.push('zzz' + c1 + c2);
    }
    const v = makeValidator([...targets, ...pool]);
    const gm = new GridManager(v);
    gm.initializeGrids({ targetWords: targets, date: '2026-01-01' });

    for (let i = 0; i < MAX_GUESSES; i++) {
      gm.applyGuess(pool[i]!);
    }
    expect(gm.isGameOver()).toBe(true);
    const r = gm.applyGuess(pool[MAX_GUESSES]!);
    expect(r.isValid).toBe(false);
    expect(r.error).toContain('already over');
  });

  it('declares win when all 32 grids solved', () => {
    const targets = SAMPLE_ANSWERS.slice(0, GRID_COUNT);
    const v = makeValidator(targets, EXTRA_GUESSES);
    const gm = new GridManager(v);
    gm.initializeGrids({ targetWords: targets, date: '2026-01-01' });

    let lastResult;
    for (const word of targets) {
      lastResult = gm.applyGuess(word);
    }
    expect(lastResult!.isWin).toBe(true);
    expect(lastResult!.isGameOver).toBe(true);
    expect(lastResult!.totalCompleted).toBe(GRID_COUNT);
  });

  it('getUnsolvedTargets returns remaining targets', () => {
    const { gm, puzzle } = setupGame();
    gm.applyGuess(puzzle.targetWords[0]!);
    const unsolved = gm.getUnsolvedTargets();
    expect(unsolved.length).toBe(GRID_COUNT - 1);
    expect(unsolved.every(u => u.gridIndex !== 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Daily puzzle generation
// ---------------------------------------------------------------------------

describe('GridManager.generateDailyPuzzle', () => {
  let validator: WordValidator;

  beforeAll(() => {
    validator = new WordValidator();
    validator.loadWordLists();
  });

  it('generates 32 unique target words', () => {
    const puzzle = GridManager.generateDailyPuzzle(new Date('2026-06-15'), validator);
    expect(puzzle.targetWords.length).toBe(GRID_COUNT);
    expect(new Set(puzzle.targetWords).size).toBe(GRID_COUNT);
  });

  it('all target words are valid answers', () => {
    const puzzle = GridManager.generateDailyPuzzle(new Date('2026-06-15'), validator);
    for (const word of puzzle.targetWords) {
      expect(validator.isValidAnswer(word)).toBe(true);
    }
  });

  it('is deterministic — same date produces same puzzle', () => {
    const p1 = GridManager.generateDailyPuzzle(new Date('2026-06-15'), validator);
    const p2 = GridManager.generateDailyPuzzle(new Date('2026-06-15'), validator);
    expect(p1.targetWords).toEqual(p2.targetWords);
  });

  it('different dates produce different puzzles', () => {
    const p1 = GridManager.generateDailyPuzzle(new Date('2026-06-15'), validator);
    const p2 = GridManager.generateDailyPuzzle(new Date('2026-06-16'), validator);
    expect(p1.targetWords).not.toEqual(p2.targetWords);
  });

  it('stores the date string', () => {
    const puzzle = GridManager.generateDailyPuzzle(new Date('2026-06-15'), validator);
    expect(puzzle.date).toBe('2026-06-15');
  });
});

// ---------------------------------------------------------------------------
// ProgressTracker
// ---------------------------------------------------------------------------

describe('ProgressTracker', () => {
  function setupTracked() {
    const targets = SAMPLE_ANSWERS.slice(0, GRID_COUNT);
    const v = makeValidator(targets, EXTRA_GUESSES);
    const gm = new GridManager(v);
    gm.initializeGrids({ targetWords: targets, date: '2026-01-01' });
    const pt = new ProgressTracker(gm);
    return { gm, pt, targets };
  }

  it('initial summary is all zeros', () => {
    const { pt } = setupTracked();
    const s = pt.getSummary();
    expect(s.totalGrids).toBe(GRID_COUNT);
    expect(s.completedGrids).toBe(0);
    expect(s.remainingGrids).toBe(GRID_COUNT);
    expect(s.guessesUsed).toBe(0);
    expect(s.guessesRemaining).toBe(MAX_GUESSES);
    expect(s.isWin).toBe(false);
    expect(s.isLoss).toBe(false);
    expect(s.isGameOver).toBe(false);
    expect(s.completionPercentage).toBe(0);
  });

  it('updates after a guess', () => {
    const { gm, pt, targets } = setupTracked();
    gm.applyGuess(targets[0]!);
    const s = pt.getSummary();
    expect(s.completedGrids).toBeGreaterThanOrEqual(1);
    expect(s.guessesUsed).toBe(1);
  });

  it('formatProgress shows progress string', () => {
    const { pt } = setupTracked();
    expect(pt.formatProgress()).toContain(`0/${GRID_COUNT}`);
  });

  it('formatProgress shows win message', () => {
    const { gm, pt, targets } = setupTracked();
    for (const word of targets) {
      gm.applyGuess(word);
    }
    expect(pt.formatProgress()).toContain('Solved');
  });
});
