import { GridManager, GRID_COUNT, MAX_GUESSES } from './GridManager';

/** Summary of current game progress. */
export interface ProgressSummary {
  totalGrids: number;
  completedGrids: number;
  remainingGrids: number;
  guessesUsed: number;
  guessesRemaining: number;
  maxGuesses: number;
  isWin: boolean;
  isLoss: boolean;
  isGameOver: boolean;
  completionPercentage: number;
}

/**
 * Tracks completion progress across all 32 Duotrigordle grids.
 */
export class ProgressTracker {
  private gridManager: GridManager;

  constructor(gridManager: GridManager) {
    this.gridManager = gridManager;
  }

  /** Get a full progress summary. */
  getSummary(): ProgressSummary {
    const completed = this.gridManager.getCompletedGrids().length;
    const guessesUsed = this.gridManager.getGuessCount();
    const isWin = completed === GRID_COUNT;
    const isLoss = !isWin && guessesUsed >= MAX_GUESSES;

    return {
      totalGrids: GRID_COUNT,
      completedGrids: completed,
      remainingGrids: GRID_COUNT - completed,
      guessesUsed,
      guessesRemaining: MAX_GUESSES - guessesUsed,
      maxGuesses: MAX_GUESSES,
      isWin,
      isLoss,
      isGameOver: isWin || isLoss,
      completionPercentage: Math.round((completed / GRID_COUNT) * 100),
    };
  }

  /** Get indices of grids completed on a specific guess number. */
  getGridsCompletedOnGuess(guessNumber: number): number[] {
    return this.gridManager.getGrids()
      .filter(g => g.isComplete && g.guesses.length === guessNumber)
      .map(g => g.gridIndex);
  }

  /** Format a short progress string. */
  formatProgress(): string {
    const s = this.getSummary();
    if (s.isWin) {
      return `Solved all ${GRID_COUNT} grids in ${s.guessesUsed}/${MAX_GUESSES} guesses!`;
    }
    if (s.isLoss) {
      return `${s.completedGrids}/${GRID_COUNT} grids solved. Out of guesses.`;
    }
    return `${s.completedGrids}/${GRID_COUNT} grids | ${s.guessesUsed}/${MAX_GUESSES} guesses`;
  }
}
