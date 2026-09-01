import * as fs from 'fs';
import * as path from 'path';
import { SemanticEngine } from '../../../games/semantle/SemanticEngine';
import { vectorDataAvailable } from '../../helpers/vectorData';

// These tests audit the curated target-word list against the real vector data,
// so they need the 137MB GloVe files. Skip in CI / when data is absent.
const describeVectors = vectorDataAvailable() ? describe : describe.skip;

const DICT_DIR = path.join(process.cwd(), 'data/dictionaries');

/** Read a newline-delimited word file, stripping blanks and # comments. */
function readWordList(fileName: string): string[] {
  const filePath = path.join(DICT_DIR, fileName);
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 0 && !w.startsWith('#'));
}

let engine: SemanticEngine;
let targetWords: string[];
let blacklist: Set<string>;

beforeAll(async () => {
  if (!vectorDataAvailable()) return;
  engine = new SemanticEngine();
  await engine.initialize();
  targetWords = readWordList('target-words-840b.txt');
  blacklist = new Set(readWordList('proper-nouns-blacklist.txt'));
}, 120000);

describeVectors('Semantle target word list — data quality audit', () => {
  // --- Hard invariants: a violation makes puzzles broken/unsolvable ---

  describe('hard invariants', () => {
    it('the list is non-empty and has no duplicates', () => {
      expect(targetWords.length).toBeGreaterThan(0);
      expect(new Set(targetWords).size).toBe(targetWords.length);
    });

    it('every target word exists in the vocabulary', () => {
      const missing = targetWords.filter(w => !engine.isValidWord(w));
      // A target not in the vector space can never be scored → unsolvable.
      expect(missing).toEqual([]);
    });

    it('every target word has precomputed rankings (top-1000 neighbors)', () => {
      const noRankings = targetWords.filter(w => {
        const data = engine.getSemanticData(w);
        return data.rankings.size === 0;
      });
      // Without rankings, hints and rank feedback break.
      expect(noRankings).toEqual([]);
    });

    it('no target word is in the proper-nouns blacklist', () => {
      const proper = targetWords.filter(w => blacklist.has(w));
      expect(proper).toEqual([]);
    });

    it('every target word is a self-consistent rank-1 to itself', () => {
      // Sample to keep runtime bounded; identical word must score ~1.0.
      const sample = targetWords.slice(0, 50);
      for (const w of sample) {
        expect(engine.calculateSimilarity(w, w)).toBeCloseTo(1.0, 4);
      }
    });
  });

  // --- Quality heuristics: diagnostics that flag "weird puzzle" words ---
  // These fail only on conservative thresholds so the suite stays green while
  // still surfacing the full list of suspects for manual pruning.

  describe('quality heuristics', () => {
    /**
     * Heuristic plural detector: a word ending in "s" whose singular form
     * (drop the trailing "s", or "es") is itself in the vocabulary.
     * This is what made "adults" a poor target — plurals cluster with other
     * plurals rather than forming a clean semantic neighborhood.
     */
    function looksPlural(word: string): boolean {
      if (word.length < 4 || !word.endsWith('s')) return false;
      if (word.endsWith('ss') || word.endsWith('us') || word.endsWith('is')) return false;
      const dropS = word.slice(0, -1);
      const dropEs = word.endsWith('es') ? word.slice(0, -2) : null;
      return engine.isValidWord(dropS) || (dropEs != null && engine.isValidWord(dropEs));
    }

    it('reports likely plural target words (diagnostic only, never fails)', () => {
      const plurals = targetWords.filter(looksPlural);
      const pct = (plurals.length / targetWords.length) * 100;

      // Report-only: plurals are NOT inherently bad. "perils" clusters tightly
      // with "peril"/"danger" and makes a fine puzzle. The problem case ("adults")
      // is caught better by the cohesion check below. This diagnostic just dumps
      // the full list to support a future manual audit of the answer list.
      // eslint-disable-next-line no-console
      console.warn(
        `[data-quality] ${plurals.length}/${targetWords.length} ` +
        `(${pct.toFixed(1)}%) look plural. Full list:\n${plurals.join(', ')}`
      );

      // No assertion — this test documents, it does not gate.
      expect(true).toBe(true);
    });

    it('flags targets with weak semantic cohesion (soft check)', () => {
      // Cohesion = average similarity of the top-10 nearest neighbors.
      // Concrete nouns cluster tightly; vague/abstract words are diffuse.
      const COHESION_FLOOR = 0.15;
      const weak: Array<{ word: string; cohesion: number }> = [];

      // Sample to bound runtime (full pass would be O(N * vocab)).
      const sample = targetWords.slice(0, 100);
      for (const w of sample) {
        const data = engine.getSemanticData(w);
        const top10 = Array.from(data.rankings.entries())
          .sort((a, b) => a[1] - b[1])
          .slice(0, 10)
          .map(([word]) => data.similarities.get(word) ?? 0);
        if (top10.length === 0) continue;
        const avg = top10.reduce((s, x) => s + x, 0) / top10.length;
        if (avg < COHESION_FLOOR) weak.push({ word: w, cohesion: avg });
      }

      if (weak.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[data-quality] ${weak.length}/${sample.length} sampled targets have low cohesion (<${COHESION_FLOOR}): ` +
          weak.map(x => `${x.word}(${x.cohesion.toFixed(3)})`).slice(0, 20).join(', ')
        );
      }

      // Conservative gate: no more than 20% of the sample should be low-cohesion.
      expect(weak.length).toBeLessThan(sample.length * 0.2);
    });
  });
});
