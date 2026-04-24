import { CountryGraph } from '../../../games/travle/CountryGraph';
import { TravleGame, TravleGameState } from '../../../games/travle/TravleGame';
import { PuzzleGenerator, TravlePuzzle } from '../../../games/travle/PuzzleGenerator';

let graph: CountryGraph;
let game: TravleGame;

beforeAll(async () => {
  graph = new CountryGraph();
  await graph.initialize();
  game = new TravleGame(graph);
  game.init();
});

/** Helper: create a Ghana → UAE game state */
function ghanaToUAE(): TravleGameState {
  const path = graph.findShortestPath('ghana', 'united arab emirates')!;
  const puzzle: TravlePuzzle = {
    start: 'ghana',
    end: 'united arab emirates',
    shortestPath: path,
    shortestPathLength: path.length - 1,
    maxGuesses: path.length - 1 + Math.max(3, Math.floor((path.length - 1) * 0.5)),
  };
  return game.newState(puzzle);
}

describe('TravleGame', () => {
  describe('guess coloring — Ghana → UAE example', () => {
    it('mali is yellow (nearby but does not reduce cost)', () => {
      const state = ghanaToUAE();
      const result = game.guess(state, 'mali');
      expect(result.isValid).toBe(true);
      expect(result.status).toBe('yellow');
    });

    it('algeria is green after mali (reduces cost via mali+algeria shortcut)', () => {
      const state = ghanaToUAE();
      game.guess(state, 'mali');
      const result = game.guess(state, 'algeria');
      expect(result.isValid).toBe(true);
      expect(result.status).toBe('green');
    });

    it('a country on the optimal path is green', () => {
      const state = ghanaToUAE();
      // Egypt is on the optimal path, guessing it should reduce cost
      const result = game.guess(state, 'egypt');
      expect(result.isValid).toBe(true);
      expect(result.status).toBe('green');
    });

    it('a far-away country is red', () => {
      const state = ghanaToUAE();
      // Brazil is nowhere near the Ghana→UAE path
      const result = game.guess(state, 'brazil');
      expect(result.isValid).toBe(true);
      expect(result.status).toBe('red');
    });
  });

  describe('win condition', () => {
    it('wins when all intermediate countries are guessed', () => {
      const state = ghanaToUAE();
      const path = state.puzzle.shortestPath;
      // Guess all intermediate countries (skip start and end)
      const intermediates = path.slice(1, -1);
      let lastResult;
      for (const country of intermediates) {
        lastResult = game.guess(state, country);
      }
      expect(lastResult!.isGameOver).toBe(true);
      expect(lastResult!.isWin).toBe(true);
      expect(state.isComplete).toBe(true);
      expect(state.isWin).toBe(true);
    });

    it('returns the winning path on win', () => {
      const state = ghanaToUAE();
      const path = state.puzzle.shortestPath;
      const intermediates = path.slice(1, -1);
      let lastResult;
      for (const country of intermediates) {
        lastResult = game.guess(state, country);
      }
      expect(lastResult!.winningPath).toBeDefined();
      expect(lastResult!.winningPath![0]).toBe('ghana');
      expect(lastResult!.winningPath![lastResult!.winningPath!.length - 1]).toBe('united arab emirates');
    });
  });

  describe('invalid guesses', () => {
    it('rejects non-existent countries', () => {
      const state = ghanaToUAE();
      const result = game.guess(state, 'atlantis');
      expect(result.isValid).toBe(false);
      expect(result.status).toBe('invalid');
    });

    it('rejects the start country', () => {
      const state = ghanaToUAE();
      const result = game.guess(state, 'ghana');
      expect(result.isValid).toBe(false);
    });

    it('rejects the end country', () => {
      const state = ghanaToUAE();
      const result = game.guess(state, 'united arab emirates');
      expect(result.isValid).toBe(false);
    });

    it('rejects duplicate guesses', () => {
      const state = ghanaToUAE();
      game.guess(state, 'egypt');
      const result = game.guess(state, 'egypt');
      expect(result.isValid).toBe(false);
    });

    it('rejects guesses after game is complete', () => {
      const state = ghanaToUAE();
      const path = state.puzzle.shortestPath;
      for (const country of path.slice(1, -1)) {
        game.guess(state, country);
      }
      const result = game.guess(state, 'france');
      expect(result.isValid).toBe(false);
      expect(result.isGameOver).toBe(true);
    });
  });

  describe('game over — out of guesses', () => {
    it('ends the game when guesses run out', () => {
      // Create a small puzzle with few max guesses
      const puzzle: TravlePuzzle = {
        start: 'france',
        end: 'poland',
        shortestPath: graph.findShortestPath('france', 'poland')!,
        shortestPathLength: graph.shortestPathLength('france', 'poland'),
        maxGuesses: 2,
      };
      const state = game.newState(puzzle);

      game.guess(state, 'spain');
      const result = game.guess(state, 'portugal');
      expect(result.isGameOver).toBe(true);
      expect(result.isWin).toBe(false);
      expect(state.isComplete).toBe(true);
    });
  });

  describe('alias support in guesses', () => {
    it('accepts country aliases', () => {
      const state = ghanaToUAE();
      // "uae" is an alias for "united arab emirates" — but it's the end country so it should be rejected
      // Use a different alias: "saudi" for "saudi arabia"
      const result = game.guess(state, 'saudi');
      expect(result.isValid).toBe(true);
    });
  });
});

describe('PuzzleGenerator', () => {
  let gen: PuzzleGenerator;

  beforeAll(() => {
    gen = new PuzzleGenerator(graph);
    gen.initialize();
  });

  it('generates deterministic puzzles for the same date', () => {
    const date = new Date('2026-06-15');
    const puzzle1 = gen.generateForDate(date);
    const puzzle2 = gen.generateForDate(date);
    expect(puzzle1.start).toBe(puzzle2.start);
    expect(puzzle1.end).toBe(puzzle2.end);
    expect(puzzle1.shortestPathLength).toBe(puzzle2.shortestPathLength);
  });

  it('generates different puzzles for different dates', () => {
    const puzzle1 = gen.generateForDate(new Date('2026-06-15'));
    const puzzle2 = gen.generateForDate(new Date('2026-06-16'));
    // Extremely unlikely to be the same pair
    expect(puzzle1.start + puzzle1.end).not.toBe(puzzle2.start + puzzle2.end);
  });

  it('generates puzzles with path length between 3 and 11', () => {
    for (let i = 0; i < 30; i++) {
      const date = new Date('2026-01-01');
      date.setDate(date.getDate() + i);
      const puzzle = gen.generateForDate(date);
      expect(puzzle.shortestPathLength).toBeGreaterThanOrEqual(3);
      expect(puzzle.shortestPathLength).toBeLessThanOrEqual(11);
    }
  });

  it('sets maxGuesses correctly', () => {
    const puzzle = gen.generateForDate(new Date('2026-06-15'));
    const expected = puzzle.shortestPathLength + Math.max(3, Math.floor(puzzle.shortestPathLength * 0.5));
    expect(puzzle.maxGuesses).toBe(expected);
  });

  it('shortest path is valid (consecutive neighbors)', () => {
    const puzzle = gen.generateForDate(new Date('2026-06-15'));
    expect(graph.isValidPath(puzzle.shortestPath)).toBe(true);
  });
});
