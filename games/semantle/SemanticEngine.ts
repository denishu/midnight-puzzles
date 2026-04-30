import { Logger } from '../../core/utils/Logger';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface WordSimilarity {
  word: string;
  similarity: number;
  rank?: number;
}

export interface SemanticData {
  targetWord: string;
  rankings: Map<string, number>; // word -> rank (1-1000)
  similarities: Map<string, number>; // word -> similarity score (0-1)
}

const VECTOR_DIM = 300;
const DICT_DIR = path.join(__dirname, '../../data/dictionaries');

/**
 * Semantic engine for calculating word similarity in Semantle.
 * 
 * Uses precomputed data for fast startup:
 *   - vocab-840b.txt: 120k word vocabulary
 *   - vectors-840b.bin: Float32Array binary vectors (137MB)
 *   - rankings-840b.json: precomputed top-1000 rankings per target word
 * 
 * Falls back to old text-based vectors or mock data if new files aren't available.
 */
export class SemanticEngine {
  private logger: Logger;

  // New binary format
  private vocabWords: string[] = [];
  private vocabIndex: Map<string, number> = new Map(); // word -> index
  private vectors: Float32Array | null = null;
  private norms: Float32Array | null = null;

  // Precomputed rankings (target -> { word -> rank })
  private precomputedRankings: Map<string, Map<string, number>> = new Map();

  // Legacy support
  private wordVectors: Map<string, number[]> = new Map();
  private vocabulary: Set<string> = new Set();
  private wordPositions: Map<string, number> = new Map();

  constructor() {
    this.logger = new Logger('SemanticEngine');
  }

  /**
   * Initialize the semantic engine
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing semantic engine...');

      // Try new binary format first
      const loaded = this.loadBinaryData();
      if (loaded) {
        this.loadPrecomputedRankings();
        this.logger.info(`Semantic engine initialized with ${this.vocabWords.length} words (binary format)`);
        return;
      }

      // Fall back to old text format
      this.logger.info('Binary data not found, falling back to text vectors...');
      await this.loadLegacyVectors();
      this.logger.info(`Semantic engine initialized with ${this.vocabulary.size} words (legacy format)`);
    } catch (error) {
      this.logger.warn('Failed to load semantic data, using mock data:', error);
      this.loadMockData();
    }
  }

  // --- Binary format loading ---

  private loadBinaryData(): boolean {
    const vocabPath = path.join(DICT_DIR, 'vocab-840b.txt');
    const vectorsPath = path.join(DICT_DIR, 'vectors-840b.bin');

    if (!fsSync.existsSync(vocabPath) || !fsSync.existsSync(vectorsPath)) {
      return false;
    }

    // Load vocabulary
    this.vocabWords = fsSync.readFileSync(vocabPath, 'utf-8')
      .split('\n').map(w => w.trim()).filter(w => w.length > 0);

    for (let i = 0; i < this.vocabWords.length; i++) {
      this.vocabIndex.set(this.vocabWords[i]!, i);
      this.vocabulary.add(this.vocabWords[i]!);
      this.wordPositions.set(this.vocabWords[i]!, i + 1);
    }

    // Load binary vectors
    const buf = fsSync.readFileSync(vectorsPath);
    this.vectors = new Float32Array(buf.buffer, buf.byteOffset, this.vocabWords.length * VECTOR_DIM);

    // Precompute norms
    this.norms = new Float32Array(this.vocabWords.length);
    for (let i = 0; i < this.vocabWords.length; i++) {
      let sum = 0;
      const offset = i * VECTOR_DIM;
      for (let j = 0; j < VECTOR_DIM; j++) {
        const v = this.vectors[offset + j]!;
        sum += v * v;
      }
      this.norms[i] = Math.sqrt(sum);
    }

    this.logger.info(`Loaded ${this.vocabWords.length} words from binary format`);
    return true;
  }

  private loadPrecomputedRankings(): void {
    const rankingsPath = path.join(DICT_DIR, 'rankings-840b.json');
    try {
      const data = JSON.parse(fsSync.readFileSync(rankingsPath, 'utf-8'));
      for (const [target, wordRanks] of Object.entries(data)) {
        const rankMap = new Map<string, number>();
        for (const [word, rank] of Object.entries(wordRanks as Record<string, number>)) {
          rankMap.set(word, rank);
        }
        this.precomputedRankings.set(target, rankMap);
      }
      this.logger.info(`Loaded precomputed rankings for ${this.precomputedRankings.size} target words`);
    } catch (e) {
      this.logger.warn('No precomputed rankings found');
    }
  }

  // --- Core API ---

  /**
   * Get semantic similarity data for a target word
   */
  getSemanticData(targetWord: string): SemanticData {
    const target = targetWord.toLowerCase();
    const rankings = new Map<string, number>();
    const similarities = new Map<string, number>();

    const precomputed = this.precomputedRankings.get(target);
    if (precomputed) {
      for (const [word, rank] of precomputed.entries()) {
        rankings.set(word, rank);
        // Calculate actual similarity if we have vectors
        const sim = this.calculateSimilarity(target, word);
        similarities.set(word, sim > 0 ? sim : Math.max(0, 1 - (rank / 1000)));
      }
    } else if (this.vectors) {
      // Dynamic calculation for non-precomputed targets
      this.calculateDynamicSimilarities(target, rankings, similarities);
    }

    return { targetWord: target, rankings, similarities };
  }

  /**
   * Calculate similarity between two words
   */
  calculateSimilarity(word1: string, word2: string): number {
    const w1 = word1.toLowerCase();
    const w2 = word2.toLowerCase();

    // Use binary vectors if available
    if (this.vectors && this.norms) {
      const i1 = this.vocabIndex.get(w1);
      const i2 = this.vocabIndex.get(w2);
      if (i1 === undefined || i2 === undefined) return 0;
      return this.cosineSimilarityBinary(i1, i2);
    }

    // Legacy fallback
    const vec1 = this.wordVectors.get(w1);
    const vec2 = this.wordVectors.get(w2);
    if (!vec1 || !vec2) return 0;
    return this.cosineSimilarityArrays(vec1, vec2);
  }

  /**
   * Check if a word is in the vocabulary
   */
  isValidWord(word: string): boolean {
    return this.vocabulary.has(word.toLowerCase());
  }

  /**
   * Get the size of the vocabulary
   */
  getVocabularySize(): number {
    return this.vocabulary.size;
  }

  /**
   * Get the frequency ranking (position in vocab file) of a word
   */
  getWordFrequencyRank(word: string): number | null {
    return this.wordPositions.get(word.toLowerCase()) || null;
  }

  /**
   * Get word ranking for a target word
   */
  getWordRank(targetWord: string, guessWord: string): number | null {
    const precomputed = this.precomputedRankings.get(targetWord.toLowerCase());
    if (precomputed) {
      return precomputed.get(guessWord.toLowerCase()) || null;
    }
    // Dynamic fallback
    const data = this.getSemanticData(targetWord);
    return data.rankings.get(guessWord.toLowerCase()) || null;
  }

  /**
   * Get a hint word for the target.
   * Halving strategy: hint is roughly halfway between best rank and rank 1.
   */
  getHintWord(targetWord: string, bestRank: number | null, guessedWords: Set<string>): { word: string; rank: number } | null {
    const target = targetWord.toLowerCase();
    const rankings = this.precomputedRankings.get(target);
    if (!rankings) return null;

    const candidates = Array.from(rankings.entries())
      .filter(([word]) => word !== target && !guessedWords.has(word))
      .sort((a, b) => a[1] - b[1]);

    if (candidates.length === 0) return null;

    let targetRank: number;
    if (!bestRank || bestRank > 1000) {
      targetRank = 1000;
    } else if (bestRank <= 2) {
      targetRank = 1;
    } else {
      targetRank = Math.floor(bestRank / 2);
    }

    let best = candidates[0]!;
    let bestDiff = Math.abs(best[1] - targetRank);
    for (const candidate of candidates) {
      const diff = Math.abs(candidate[1] - targetRank);
      if (diff < bestDiff) {
        best = candidate;
        bestDiff = diff;
      }
    }

    return { word: best[0], rank: best[1] };
  }

  // --- Similarity calculations ---

  private cosineSimilarityBinary(i1: number, i2: number): number {
    const vectors = this.vectors!;
    const norms = this.norms!;
    let dot = 0;
    const off1 = i1 * VECTOR_DIM;
    const off2 = i2 * VECTOR_DIM;
    for (let j = 0; j < VECTOR_DIM; j++) {
      dot += vectors[off1 + j]! * vectors[off2 + j]!;
    }
    const denom = norms[i1]! * norms[i2]!;
    return denom === 0 ? 0 : dot / denom;
  }

  private cosineSimilarityArrays(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) return 0;
    let dot = 0, n1 = 0, n2 = 0;
    for (let i = 0; i < vec1.length; i++) {
      dot += vec1[i]! * vec2[i]!;
      n1 += vec1[i]! * vec1[i]!;
      n2 += vec2[i]! * vec2[i]!;
    }
    const mag = Math.sqrt(n1) * Math.sqrt(n2);
    return mag === 0 ? 0 : dot / mag;
  }

  private calculateDynamicSimilarities(
    targetWord: string,
    rankings: Map<string, number>,
    similarities: Map<string, number>
  ): void {
    const targetIdx = this.vocabIndex.get(targetWord);
    if (targetIdx === undefined) return;

    const sims: Array<{ word: string; sim: number }> = [];
    for (let i = 0; i < this.vocabWords.length; i++) {
      if (i === targetIdx) continue;
      const sim = this.cosineSimilarityBinary(targetIdx, i);
      if (sim > 0) sims.push({ word: this.vocabWords[i]!, sim });
    }

    sims.sort((a, b) => b.sim - a.sim);
    for (let r = 0; r < Math.min(1000, sims.length); r++) {
      rankings.set(sims[r]!.word, r + 1);
      similarities.set(sims[r]!.word, sims[r]!.sim);
    }
  }

  // --- Legacy loading ---

  private async loadLegacyVectors(): Promise<void> {
    const filePath = path.join(DICT_DIR, 'semantic-vectors.txt');
    const readline = require('readline');
    const fileStream = require('fs').createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let count = 0;
    const maxWords = 100000;

    for await (const line of rl) {
      if (count >= maxWords) break;
      if (!line.trim()) continue;
      const parts = line.split(' ');
      const word = parts[0];
      if (word && /^[a-zA-Z]+$/.test(word)) {
        const vector = parts.slice(1).map(Number);
        if (vector.length > 0 && !vector.some(isNaN)) {
          this.wordVectors.set(word, vector);
          this.vocabulary.add(word);
          this.wordPositions.set(word, count + 1);
          count++;
        }
      }
    }
    this.logger.info(`Loaded ${count} legacy word vectors`);
  }

  private loadMockData(): void {
    this.logger.info('Loading mock semantic data');
    const mockWords = ['cat','dog','animal','pet','kitten','puppy','feline','canine',
      'house','home','building','structure','water','river','ocean','sea'];
    mockWords.forEach(w => this.vocabulary.add(w));

    this.precomputedRankings.set('cat', new Map([
      ['kitten',1],['feline',2],['pet',3],['animal',8],['dog',15],['puppy',25]
    ]));
    this.precomputedRankings.set('house', new Map([
      ['home',1],['building',2],['dwelling',3],['residence',5],['structure',12]
    ]));
  }
}
