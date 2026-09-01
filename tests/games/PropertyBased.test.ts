import * as fc from 'fast-check';
import { WordValidator } from '../../games/duotrigordle/WordValidator';
import { GridManager } from '../../games/duotrigordle/GridManager';
import { CountryGraph } from '../../games/travle/CountryGraph';
import { TravleGame } from '../../games/travle/TravleGame';
import { PuzzleGenerator } from '../../games/travle/PuzzleGenerator';

// ---------------------------------------------------------------------------
// Duotrigordle — evaluateGuess invariants
// These use an in-memory validator (no data files), so they run everywhere.
// ---------------------------------------------------------------------------

/** Arbitrary that produces a 5-letter lowercase word from a-z. */
const fiveLetterWord = fc
  .array(fc.integer({ min: 97, max: 122 }), { minLength: 5, maxLength: 5 })
  .map(codes => codes.map(c => String.fromCharCode(c)).join(''));

describe('Duotrigordle evaluateGuess — property based', () => {
  const gm = new GridManager(new WordValidator());

  it('feedback is always length 5 with correct letters and positions', () => {
    fc.assert(
      fc.property(fiveLetterWord, fiveLetterWord, (guess, target) => {
        const fb = gm.evaluateGuess(guess, target);
        expect(fb).toHaveLength(5);
        for (let i = 0; i < 5; i++) {
          expect(fb[i]!.position).toBe(i);
          expect(fb[i]!.letter).toBe(guess[i]);
        }
      })
    );
  });

  it('exact match is always all-correct', () => {
    fc.assert(
      fc.property(fiveLetterWord, word => {
        const fb = gm.evaluateGuess(word, word);
        expect(fb.every(f => f.status === 'correct')).toBe(true);
      })
    );
  });

  it('a position marked correct always has guess letter === target letter', () => {
    fc.assert(
      fc.property(fiveLetterWord, fiveLetterWord, (guess, target) => {
        const fb = gm.evaluateGuess(guess, target);
        for (let i = 0; i < 5; i++) {
          if (fb[i]!.status === 'correct') {
            expect(guess[i]).toBe(target[i]);
          }
        }
      })
    );
  });

  it('correct+present count per letter never exceeds its count in the target', () => {
    // The classic Wordle duplicate-letter invariant.
    fc.assert(
      fc.property(fiveLetterWord, fiveLetterWord, (guess, target) => {
        const fb = gm.evaluateGuess(guess, target);

        // Count occurrences of each letter in the target.
        const targetCounts: Record<string, number> = {};
        for (const ch of target) targetCounts[ch] = (targetCounts[ch] ?? 0) + 1;

        // Count non-absent markings per letter in the feedback.
        const markedCounts: Record<string, number> = {};
        for (const f of fb) {
          if (f.status !== 'absent') {
            markedCounts[f.letter] = (markedCounts[f.letter] ?? 0) + 1;
          }
        }

        for (const [letter, count] of Object.entries(markedCounts)) {
          expect(count).toBeLessThanOrEqual(targetCounts[letter] ?? 0);
        }
      })
    );
  });

  it('a letter not in the target is always marked absent', () => {
    fc.assert(
      fc.property(fiveLetterWord, fiveLetterWord, (guess, target) => {
        const fb = gm.evaluateGuess(guess, target);
        for (const f of fb) {
          if (!target.includes(f.letter)) {
            expect(f.status).toBe('absent');
          }
        }
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Travle — pathfinding invariants over real (committed) adjacency data.
// ---------------------------------------------------------------------------

describe('Travle pathfinding — property based', () => {
  let graph: CountryGraph;
  let game: TravleGame;
  let gen: PuzzleGenerator;
  let countries: string[];

  beforeAll(async () => {
    graph = new CountryGraph();
    await graph.initialize();
    game = new TravleGame(graph);
    game.init();
    gen = new PuzzleGenerator(graph);
    gen.initialize();
    // Only countries that have at least one neighbor are meaningful endpoints.
    countries = graph.getAllCountries().filter(c => graph.getNeighbors(c).length > 0);
  });

  it('any shortest path found has consecutive-neighbor validity', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        (i, j) => {
          const a = countries[i % countries.length]!;
          const b = countries[j % countries.length]!;
          const path = graph.findShortestPath(a, b);
          if (path === null) return; // disconnected pair — nothing to assert
          expect(graph.isValidPath(path)).toBe(true);
          expect(path[0]).toBe(a);
          expect(path[path.length - 1]).toBe(b);
        }
      )
    );
  });

  it('guessing every intermediate country on the shortest path always wins', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        (i, j) => {
          const start = countries[i % countries.length]!;
          const end = countries[j % countries.length]!;
          if (start === end) return;
          const path = graph.findShortestPath(start, end);
          if (path === null || path.length < 3) return; // need >=1 intermediate

          const puzzle = {
            start,
            end,
            shortestPath: path,
            shortestPathLength: path.length - 1,
            maxGuesses: path.length, // generous: enough to guess every intermediate
          };
          const state = game.newState(puzzle);

          let lastResult;
          for (const country of path.slice(1, -1)) {
            lastResult = game.guess(state, country);
          }
          expect(state.isWin).toBe(true);
          expect(lastResult!.isGameOver).toBe(true);
        }
      )
    );
  });

  it('generated daily puzzles always satisfy the 4..12 step contract', () => {
    fc.assert(
      fc.property(fc.date({ min: new Date('2026-01-01'), max: new Date('2027-12-31') }), d => {
        const puzzle = gen.generateForDate(d);
        expect(puzzle.shortestPathLength).toBeGreaterThanOrEqual(4);
        expect(puzzle.shortestPathLength).toBeLessThanOrEqual(12);
        // maxGuesses must be enough to guess every intermediate country,
        // otherwise the puzzle is unwinnable.
        expect(puzzle.maxGuesses).toBeGreaterThanOrEqual(puzzle.shortestPathLength - 1);
        // the shortest path itself must be valid
        expect(graph.isValidPath(puzzle.shortestPath)).toBe(true);
      })
    );
  });
});
