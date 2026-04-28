import { WordValidator } from './WordValidator';

/** Feedback for a single letter position. */
export interface LetterFeedback {
  letter: string;
  position: number;
  status: 'correct' | 'present' | 'absent';
}

/** A single guess applied to one grid. */
export interface WordGuess {
  word: string;
  feedback: LetterFeedback[];
}

/** State of one of the 32 grids. */
export interface GridState {
  gridIndex: number;
  targetWord: string;
  guesses: WordGuess[];
  isComplete: boolean;
}

/** Full puzzle definition. */
export interface DuotrigordlePuzzle {
  targetWords: string[];
  date: string;
}

/** Result of applying a guess across all grids. */
export interface GuessApplicationResult {
  isValid: boolean;
  error?: string;
  feedbacks: WordGuess[];
  completedGrids: number[];
  totalCompleted: number;
  guessNumber: number;
  isGameOver: boolean;
  isWin: boolean;
}

export const GRID_COUNT = 32;
export const MAX_GUESSES = 37;

/**
 * Manages 32 simultaneous Wordle grids for Duotrigordle.
 */
export class GridManager {
  private grids: GridState[] = [];
  private guessCount = 0;
  private validator: WordValidator;
  private gameOver = false;

  constructor(validator: WordValidator) {
    this.validator = validator;
  }

  /**
   * Initialize grids from a puzzle (32 target words).
   */
  initializeGrids(puzzle: DuotrigordlePuzzle): void {
    this.grids = puzzle.targetWords.map((word, i) => ({
      gridIndex: i,
      targetWord: word.toLowerCase(),
      guesses: [],
      isComplete: false,
    }));
    this.guessCount = 0;
    this.gameOver = false;
  }

  /**
   * Apply a guess to all 32 grids simultaneously.
   */
  applyGuess(guess: string): GuessApplicationResult {
    const word = guess.toLowerCase();

    if (this.gameOver) {
      return this.errorResult('Game is already over.');
    }
    if (word.length !== 5) {
      return this.errorResult('Guess must be exactly 5 letters.');
    }
    if (!/^[a-z]{5}$/.test(word)) {
      return this.errorResult('Guess must contain only letters.');
    }
    if (!this.validator.isValidGuess(word)) {
      return this.errorResult('Not a valid word.');
    }
    if (this.grids.length > 0 && this.grids[0]!.guesses.some(g => g.word === word)) {
      return this.errorResult('Already guessed.');
    }

    this.guessCount++;
    const feedbacks: WordGuess[] = [];
    const newlyCompleted: number[] = [];

    for (const grid of this.grids) {
      const feedback = this.evaluateGuess(word, grid.targetWord);
      const wordGuess: WordGuess = { word, feedback };
      grid.guesses.push(wordGuess);
      feedbacks.push(wordGuess);

      if (!grid.isComplete && word === grid.targetWord) {
        grid.isComplete = true;
        newlyCompleted.push(grid.gridIndex);
      }
    }

    const totalCompleted = this.grids.filter(g => g.isComplete).length;
    const isWin = totalCompleted === GRID_COUNT;
    const isGameOver = isWin || this.guessCount >= MAX_GUESSES;
    this.gameOver = isGameOver;

    return {
      isValid: true,
      feedbacks,
      completedGrids: newlyCompleted,
      totalCompleted,
      guessNumber: this.guessCount,
      isGameOver,
      isWin,
    };
  }

  /**
   * Evaluate a guess against a target word, producing per-letter feedback.
   * Standard Wordle rules: green > yellow > gray, with letter frequency handling.
   */
  evaluateGuess(guess: string, target: string): LetterFeedback[] {
    const feedback: LetterFeedback[] = Array.from({ length: 5 }, (_, i) => ({
      letter: guess[i]!,
      position: i,
      status: 'absent' as const,
    }));

    // Track remaining unmatched target letters
    const remaining: (string | null)[] = [...target];

    // First pass: mark correct (green)
    for (let i = 0; i < 5; i++) {
      if (guess[i] === target[i]) {
        feedback[i]!.status = 'correct';
        remaining[i] = null;
      }
    }

    // Second pass: mark present (yellow)
    for (let i = 0; i < 5; i++) {
      if (feedback[i]!.status === 'correct') continue;
      const idx = remaining.indexOf(guess[i]!);
      if (idx !== -1) {
        feedback[i]!.status = 'present';
        remaining[idx] = null;
      }
    }

    return feedback;
  }

  /** Get all grid states. */
  getGrids(): GridState[] {
    return this.grids;
  }

  /** Get a specific grid by index. */
  getGrid(index: number): GridState | undefined {
    return this.grids[index];
  }

  /** Get incomplete grids. */
  getIncompleteGrids(): GridState[] {
    return this.grids.filter(g => !g.isComplete);
  }

  /** Get completed grids. */
  getCompletedGrids(): GridState[] {
    return this.grids.filter(g => g.isComplete);
  }

  /** Current guess count. */
  getGuessCount(): number {
    return this.guessCount;
  }

  /** Remaining guesses. */
  getRemainingGuesses(): number {
    return MAX_GUESSES - this.guessCount;
  }

  /** Whether the game is over. */
  isGameOver(): boolean {
    return this.gameOver;
  }

  /** Get all unrevealed target words (for game-over reveal). */
  getUnsolvedTargets(): Array<{ gridIndex: number; targetWord: string }> {
    return this.grids
      .filter(g => !g.isComplete)
      .map(g => ({ gridIndex: g.gridIndex, targetWord: g.targetWord }));
  }

  private errorResult(error: string): GuessApplicationResult {
    return {
      isValid: false,
      error,
      feedbacks: [],
      completedGrids: [],
      totalCompleted: this.grids.filter(g => g.isComplete).length,
      guessNumber: this.guessCount,
      isGameOver: this.gameOver,
      isWin: false,
    };
  }

  /**
   * Generate a deterministic daily puzzle: 32 unique target words for a date.
   */
  static generateDailyPuzzle(date: Date, validator: WordValidator): DuotrigordlePuzzle {
    const dateStr = date.toISOString().split('T')[0]!;
    const seed = GridManager.hashString(dateStr);
    const answers = validator.getAnswersList();

    const selected: Set<string> = new Set();
    const targetWords: string[] = [];
    let attempt = 0;

    while (targetWords.length < GRID_COUNT) {
      const idx = GridManager.seededIndex(seed + attempt, answers.length);
      const word = answers[idx]!;
      if (!selected.has(word)) {
        selected.add(word);
        targetWords.push(word);
      }
      attempt++;
    }

    return { targetWords, date: dateStr };
  }

  /** Deterministic hash of a string to a number. */
  static hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
    }
    hash = ((hash >>> 16) ^ hash) * 0x45d9f3b;
    hash = ((hash >>> 16) ^ hash) * 0x45d9f3b;
    return ((hash >>> 16) ^ hash) >>> 0;
  }

  /** Seeded index selection with bit mixing. */
  static seededIndex(seed: number, length: number): number {
    let h = seed;
    h = ((h >>> 16) ^ h) * 0x45d9f3b;
    h = ((h >>> 16) ^ h) * 0x45d9f3b;
    h = (h >>> 16) ^ h;
    return (h >>> 0) % length;
  }
}
