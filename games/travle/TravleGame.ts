import { CountryGraph } from './CountryGraph';
import { PuzzleGenerator, TravlePuzzle } from './PuzzleGenerator';
import { Logger } from '../../core/utils/Logger';

export interface TravleGuessResult {
  isValid: boolean;
  feedback: string;
  isGameOver: boolean;
  isWin: boolean;
  status: 'green' | 'yellow' | 'red' | 'invalid';
  winningPath?: string[] | undefined;
}

export interface TravleGameState {
  puzzle: TravlePuzzle;
  guesses: Array<{ country: string; status: 'green' | 'yellow' | 'red' }>;
  guessesRemaining: number;
  isComplete: boolean;
  isWin: boolean;
  currentChain: string[] | null;
}

export class TravleGame {
  private graph: CountryGraph;
  private puzzleGen: PuzzleGenerator;
  private logger: Logger;
  constructor(graph: CountryGraph) {
    this.graph = graph;
    this.puzzleGen = new PuzzleGenerator(graph);
    this.logger = new Logger('TravleGame');
  }
  init(): void { this.puzzleGen.initialize(); }
  genPuzzle(date: Date): TravlePuzzle { return this.puzzleGen.generateForDate(date); }
  newState(p: TravlePuzzle): TravleGameState {
    return { puzzle: p, guesses: [], guessesRemaining: p.maxGuesses, isComplete: false, isWin: false, currentChain: null };
  }
  guess(state: TravleGameState, input: string): TravleGuessResult {
    const country = input.trim().toLowerCase();
    const pz = state.puzzle;
    const bad = (fb: string, over = false): TravleGuessResult =>
      ({ isValid: false, feedback: fb, isGameOver: over, isWin: state.isWin, status: 'invalid' });
    if (state.isComplete) return bad('Game is already over.', true);
    if (!this.graph.isValidCountry(country)) return bad('"' + input + '" is not a recognized country.');
    if (country === pz.start || country === pz.end) return bad(input + ' is already the start or end.');
    if (state.guesses.some((g: { country: string }) => g.country === country)) return bad('You already guessed ' + input + '.');

    // Build free set: all previously guessed countries
    const freeBefore = new Set(state.guesses.map((g: { country: string }) => g.country));
    const costBefore = this.graph.weightedShortestCost(pz.start, pz.end, freeBefore);

    // Add this guess to the free set
    const freeAfter = new Set([...freeBefore, country]);
    const costAfter = this.graph.weightedShortestCost(pz.start, pz.end, freeAfter);

    // Green if this guess reduced the cost
    let status: 'green' | 'yellow' | 'red';
    if (costAfter < costBefore) {
      status = 'green';
    } else {
      // Compute cost of best path forced through this guess
      const throughG = this.graph.weightedCostThrough(pz.start, pz.end, country, freeAfter);
      if (throughG !== -1 && throughG <= costBefore + 1) {
        status = 'yellow';
      } else {
        status = 'red';
      }
    }

    state.guesses.push({ country, status });
    state.guessesRemaining--;

    // Check win: cost is 0 means all countries on the path are free
    const allGuessed = new Set(state.guesses.map((g: { country: string }) => g.country));
    const finalCost = this.graph.weightedShortestCost(pz.start, pz.end, allGuessed);
    if (finalCost === 0) {
      const chain = this.graph.findChainFromGuesses(pz.start, pz.end, [...allGuessed]);
      state.currentChain = chain;
      state.isComplete = true;
      state.isWin = true;
      return { isValid: true, isGameOver: true, isWin: true, status,
        feedback: 'You connected ' + pz.start + ' to ' + pz.end + ' in ' + state.guesses.length + ' guesses!',
        winningPath: chain ?? undefined };
    }

    state.currentChain = null;
    if (state.guessesRemaining <= 0) {
      state.isComplete = true;
      state.isWin = false;
      return { isValid: true, isGameOver: true, isWin: false, status,
        feedback: 'Out of guesses! Path was: ' + pz.shortestPath.join(' -> ') };
    }

    const msg = status === 'green' ? country + ' reduces the path!'
      : status === 'yellow' ? country + ' is nearby but didn\'t shorten the path.'
      : country + ' is far from the path.';
    return { isValid: true, isGameOver: false, isWin: false, status,
      feedback: msg + ' (' + state.guessesRemaining + ' left, cost: ' + finalCost + ')' };
  }
}
