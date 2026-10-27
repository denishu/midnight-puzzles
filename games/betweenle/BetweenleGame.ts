import { BetweenleWords } from './BetweenleWords';

/** Max guesses allowed before the game is lost. */
export const MAX_GUESSES = 14;

/**
 * Score bands by guess count: solving within the first 5 guesses scores 5,
 * the next 3 score 4, the next 3 score 3, the next 2 score 2, the last 1
 * scores 1. (5-3-3-2-1 → 5/4/3/2/1.) A loss scores 0.
 *
 * Index: guessNumber (1-based) -> score. Precomputed for clarity.
 */
export function scoreForGuessNumber(n: number): number {
  if (n < 1 || n > MAX_GUESSES) return 0;
  if (n <= 5) return 5;   // guesses 1-5
  if (n <= 8) return 4;   // guesses 6-8
  if (n <= 11) return 3;  // guesses 9-11
  if (n <= 13) return 2;  // guesses 12-13
  return 1;               // guess 14
}

/** Direction of a guess relative to the secret in dictionary order. */
export type Direction = 'before' | 'after' | 'correct';

/** A single recorded guess and its feedback. */
export interface BetweenleGuess {
  word: string;
  /** 'before' = guess is alphabetically before the secret (secret is AFTER). */
  direction: Direction;
  /** Percent of the dictionary between this guess and the secret (0 on win). */
  distance: number;
}

export interface BetweenleState {
  puzzleDate: string;      // 'YYYY-MM-DD' (UTC)
  secret: string;          // the answer (never sent to the client until over)
  guesses: BetweenleGuess[];
  /** Tightest known bounds (words), seeded with the sentinels. */
  lowerBound: string;      // closest guess alphabetically BEFORE the secret
  upperBound: string;      // closest guess alphabetically AFTER the secret
  isComplete: boolean;
  isWin: boolean;
  /** Final score once complete (0 if lost). */
  score: number;
}

/** Alphabetical sentinels that bracket the entire dictionary. */
const LOWER_SENTINEL = 'aaaaa';
const UPPER_SENTINEL = 'zzzzz';

/** Deterministic string hash (djb2 + bit-mixing), identical to GridManager. */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
  }
  hash = ((hash >>> 16) ^ hash) * 0x45d9f3b;
  hash = ((hash >>> 16) ^ hash) * 0x45d9f3b;
  return ((hash >>> 16) ^ hash) >>> 0;
}

function seededIndex(seed: number, length: number): number {
  let h = seed;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = (h >>> 16) ^ h;
  return (h >>> 0) % length;
}

/** Result of processing one guess. */
export interface GuessOutcome {
  ok: boolean;
  error?: string;
  guess?: BetweenleGuess;
}

/**
 * Betweenle: a daily 5-letter word game decided by ALPHABETICAL order, not
 * meaning. Each guess is marked BEFORE/AFTER the secret in dictionary order and
 * reports how far it is (percent of the dictionary between them); the player
 * binary-searches to the answer within 14 guesses.
 */
export class BetweenleGame {
  constructor(private words: BetweenleWords) {}

  /** The secret for a given UTC date (deterministic). */
  secretForDate(date: Date): string {
    const dateStr = date.toISOString().split('T')[0]!;
    const answers = this.words.answersList;
    const idx = seededIndex(hashString('betweenle:' + dateStr), answers.length);
    return answers[idx]!;
  }

  /** Fresh state for the given date's puzzle. */
  newState(date: Date): BetweenleState {
    return {
      puzzleDate: date.toISOString().split('T')[0]!,
      secret: this.secretForDate(date),
      guesses: [],
      lowerBound: LOWER_SENTINEL,
      upperBound: UPPER_SENTINEL,
      isComplete: false,
      isWin: false,
      score: 0,
    };
  }

  /**
   * Apply a guess to the state (mutates and returns an outcome). Enforces: game
   * not over, 5-letter, valid dictionary word, no exact-duplicate guess.
   */
  guess(state: BetweenleState, rawWord: string): GuessOutcome {
    if (state.isComplete) return { ok: false, error: 'Game is already over.' };
    const word = (rawWord || '').trim().toLowerCase();

    if (word.length !== 5 || !/^[a-z]{5}$/.test(word)) {
      return { ok: false, error: 'Guess must be a 5-letter word.' };
    }
    if (!this.words.isValidGuess(word)) {
      return { ok: false, error: `"${word}" is not in the word list.` };
    }
    if (state.guesses.some(g => g.word === word)) {
      return { ok: false, error: `You already guessed "${word}".` };
    }
    // Out-of-range: must lie strictly between the current bounds. A rejected
    // guess does NOT consume one of the 14 tries (guardrail, like a non-word).
    if (!this.words.isInRange(word, state.lowerBound, state.upperBound)) {
      return { ok: false, error: `"${word}" is outside the current range (${state.lowerBound}–${state.upperBound}).` };
    }

    const secret = state.secret;
    let direction: Direction;
    if (word === secret) direction = 'correct';
    else if (word < secret) direction = 'before'; // guess before secret
    else direction = 'after';

    const distance = direction === 'correct' ? 0 : this.words.distancePercent(word, secret);
    const g: BetweenleGuess = { word, direction, distance };
    state.guesses.push(g);

    // Tighten bounds. 'before' → candidate new lowerBound (closest below secret);
    // 'after' → candidate new upperBound (closest above secret).
    if (direction === 'before') {
      if (state.lowerBound === LOWER_SENTINEL || word > state.lowerBound) state.lowerBound = word;
    } else if (direction === 'after') {
      if (state.upperBound === UPPER_SENTINEL || word < state.upperBound) state.upperBound = word;
    }

    if (direction === 'correct') {
      state.isComplete = true;
      state.isWin = true;
      state.score = scoreForGuessNumber(state.guesses.length);
    } else if (state.guesses.length >= MAX_GUESSES) {
      state.isComplete = true;
      state.isWin = false;
      state.score = 0;
    }

    return { ok: true, guess: g };
  }
}

/** Guesses remaining before the 14-guess cap. */
export function guessesRemaining(state: BetweenleState): number {
  return MAX_GUESSES - state.guesses.length;
}
