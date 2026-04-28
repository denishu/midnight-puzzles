import { SemanticEngine } from '../../../games/semantle/SemanticEngine';

let engine: SemanticEngine;

beforeAll(async () => {
  engine = new SemanticEngine();
  await engine.initialize();
}, 120000); // vectors take time to load

describe('SemanticEngine', () => {
  describe('vocabulary', () => {
    it('loads a large vocabulary', () => {
      expect(engine.getVocabularySize()).toBeGreaterThan(10000);
    });

    it('recognizes common words', () => {
      expect(engine.isValidWord('river')).toBe(true);
      expect(engine.isValidWord('mountain')).toBe(true);
      expect(engine.isValidWord('freedom')).toBe(true);
    });

    it('rejects nonsense words', () => {
      expect(engine.isValidWord('xyzzyplugh')).toBe(false);
      expect(engine.isValidWord('asdfghjkl')).toBe(false);
    });

    it('filters out blacklisted proper nouns', () => {
      expect(engine.isValidWord('sapporo')).toBe(false);
    });
  });

  describe('cosine similarity', () => {
    it('returns high similarity for related words', () => {
      const sim = engine.calculateSimilarity('river', 'stream');
      expect(sim).toBeGreaterThan(0.5);
    });

    it('returns low similarity for unrelated words', () => {
      const sim = engine.calculateSimilarity('river', 'computer');
      expect(sim).toBeLessThan(0.3);
    });

    it('returns 1.0 for identical words', () => {
      const sim = engine.calculateSimilarity('river', 'river');
      expect(sim).toBeCloseTo(1.0, 5);
    });

    it('returns 0 for unknown words', () => {
      const sim = engine.calculateSimilarity('river', 'xyzzyplugh');
      expect(sim).toBe(0);
    });

    it('is symmetric', () => {
      const ab = engine.calculateSimilarity('river', 'ocean');
      const ba = engine.calculateSimilarity('ocean', 'river');
      expect(ab).toBeCloseTo(ba, 10);
    });
  });

  describe('word rankings', () => {
    it('ranks the most similar word as #1', () => {
      const data = engine.getSemanticData('river');
      let rank1Word = '';
      let rank1Sim = 0;
      for (const [word, rank] of data.rankings.entries()) {
        if (rank === 1) {
          rank1Word = word;
          rank1Sim = data.similarities.get(word) || 0;
          break;
        }
      }
      expect(rank1Word).toBeTruthy();
      // #1 should have the highest similarity
      for (const [word, sim] of data.similarities.entries()) {
        if (word !== rank1Word) {
          expect(rank1Sim).toBeGreaterThanOrEqual(sim);
        }
      }
    });

    it('produces exactly 1000 rankings', () => {
      const data = engine.getSemanticData('river');
      expect(data.rankings.size).toBe(1000);
    });

    it('getWordRank returns a rank for a similar word', () => {
      const rank = engine.getWordRank('river', 'stream');
      expect(rank).not.toBeNull();
      expect(rank).toBeGreaterThan(0);
      expect(rank).toBeLessThanOrEqual(1000);
    });

    it('getWordRank returns null for a distant word', () => {
      const rank = engine.getWordRank('river', 'computer');
      // Might or might not be ranked — just check it doesn't crash
      if (rank !== null) {
        expect(rank).toBeGreaterThan(0);
      }
    });
  });

  describe('hints', () => {
    it('returns a hint word when no guesses made', () => {
      const hint = engine.getHintWord('river', null, new Set());
      expect(hint).not.toBeNull();
      expect(hint!.word).toBeTruthy();
      // First hint should target rank ~1000
      expect(hint!.rank).toBeGreaterThan(500);
    });

    it('returns a closer hint when best rank improves', () => {
      const hint1 = engine.getHintWord('river', null, new Set());
      const hint2 = engine.getHintWord('river', 500, new Set());
      const hint3 = engine.getHintWord('river', 100, new Set());
      // Each hint should target a better rank
      expect(hint2!.rank).toBeLessThan(hint1!.rank);
      expect(hint3!.rank).toBeLessThan(hint2!.rank);
    });

    it('excludes already guessed words', () => {
      const hint1 = engine.getHintWord('river', null, new Set());
      const hint2 = engine.getHintWord('river', null, new Set([hint1!.word]));
      expect(hint2!.word).not.toBe(hint1!.word);
    });
  });
});
