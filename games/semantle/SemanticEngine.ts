import { Logger } from '../../core/utils/Logger';
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

/**
 * Semantic engine for calculating word similarity in Semantle
 * Supports both pre-computed rankings and dynamic similarity calculation
 */
export class SemanticEngine {
  private logger: Logger;
  private wordVectors: Map<string, number[]> = new Map();
  private precomputedRankings: Map<string, Map<string, number>> = new Map();
  private rankingCache: Map<string, Map<string, number>> = new Map(); // in-memory cache for dynamic rankings
  private vocabulary: Set<string> = new Set();
  private wordPositions: Map<string, number> = new Map(); // Track position in GloVe file
  private properNounBlacklist: Set<string> = new Set(); // Proper nouns to exclude

  constructor() {
    this.logger = new Logger('SemanticEngine');
  }

  /**
   * Initialize the semantic engine with word data
   */
  async initialize(dataPath?: string): Promise<void> {
    try {
      this.logger.info('Initializing semantic engine...');
      
      // Load proper noun blacklist first
      await this.loadProperNounBlacklist(dataPath);
      
      // Try to load pre-computed data first
      await this.loadPrecomputedData(dataPath);
      
      // If no pre-computed data, load word vectors
      if (this.precomputedRankings.size === 0) {
        await this.loadWordVectors(dataPath);
      }
      
      this.logger.info(`Semantic engine initialized with ${this.vocabulary.size} words`);
    } catch (error) {
      this.logger.warn('Failed to load semantic data, using mock data:', error);
      this.loadMockData();
    }
  }

  /**
   * Get semantic similarity data for a target word
   */
  getSemanticData(targetWord: string): SemanticData {
    const rankings = new Map<string, number>();
    const similarities = new Map<string, number>();

    // Use pre-computed rankings if available
    const precomputed = this.precomputedRankings.get(targetWord.toLowerCase());
    if (precomputed) {
      precomputed.forEach((rank, word) => {
        rankings.set(word, rank);
        // Convert rank to similarity score (higher rank = lower similarity)
        similarities.set(word, Math.max(0, 1 - (rank / 1000)));
      });
    } else {
      // Calculate similarities dynamically
      this.calculateDynamicSimilarities(targetWord, rankings, similarities);
    }

    return {
      targetWord: targetWord.toLowerCase(),
      rankings,
      similarities
    };
  }

  /**
   * Calculate similarity between two words
   */
  calculateSimilarity(word1: string, word2: string): number {
    const vec1 = this.wordVectors.get(word1.toLowerCase());
    const vec2 = this.wordVectors.get(word2.toLowerCase());

    if (!vec1 || !vec2) {
      return 0;
    }

    return this.cosineSimilarity(vec1, vec2);
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
   * Get the frequency ranking (position in GloVe file) of a word
   * Lower position = more frequent word
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

    // Check in-memory cache first
    const cached = this.rankingCache.get(targetWord.toLowerCase());
    if (cached) {
      return cached.get(guessWord.toLowerCase()) || null;
    }

    // Compute and cache rankings for this target word
    const semanticData = this.getSemanticData(targetWord);
    this.rankingCache.set(targetWord.toLowerCase(), semanticData.rankings);
    return semanticData.rankings.get(guessWord.toLowerCase()) || null;
  }

  /**
   * Get a hint word for the target that is better than the user's best rank.
   * Uses a "halving" strategy: the hint is roughly halfway between the best rank and rank 1.
   * Excludes already-guessed words and the target itself.
   */
  getHintWord(targetWord: string, bestRank: number | null, guessedWords: Set<string>): { word: string; rank: number } | null {
    const target = targetWord.toLowerCase();

    // Get or compute rankings for this target
    let rankings = this.rankingCache.get(target) || this.precomputedRankings.get(target);
    if (!rankings) {
      const data = this.getSemanticData(target);
      rankings = data.rankings;
      this.rankingCache.set(target, rankings);
    }

    // Build a sorted list of [word, rank] excluding guessed words and the target
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


  /**
   * Load proper noun blacklist from file
   */
  private async loadProperNounBlacklist(dataPath?: string): Promise<void> {
    const filePath = dataPath || path.join(__dirname, '../../data/dictionaries/proper-nouns-blacklist.txt');
    
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const lines = data.split('\n');
      
      lines.forEach(line => {
        const word = line.trim().toLowerCase();
        // Skip empty lines and comments
        if (word && !word.startsWith('#')) {
          this.properNounBlacklist.add(word);
        }
      });
      
      this.logger.info(`Loaded ${this.properNounBlacklist.size} proper nouns to blacklist`);
    } catch (error) {
      this.logger.warn('No proper noun blacklist found, continuing without filtering:', error);
    }
  }

  /**
   * Load pre-computed word rankings from file
   */
  private async loadPrecomputedData(dataPath?: string): Promise<void> {
    const filePath = dataPath || path.join(__dirname, '../../data/dictionaries/word-rankings.json');
    
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const rankings = JSON.parse(data);
      
      Object.entries(rankings).forEach(([targetWord, wordRanks]) => {
        const rankMap = new Map<string, number>();
        Object.entries(wordRanks as Record<string, number>).forEach(([word, rank]) => {
          rankMap.set(word, rank);
          this.vocabulary.add(word);
        });
        this.precomputedRankings.set(targetWord, rankMap);
        this.vocabulary.add(targetWord);
      });
      
      this.logger.info(`Loaded pre-computed rankings for ${this.precomputedRankings.size} target words`);
    } catch (error) {
      this.logger.debug('No pre-computed rankings found:', error);
    }
  }

  /**
   * Load word vectors from file (GloVe format)
   * Loads only the first 50,000 most common words to manage memory usage
   */
  private async loadWordVectors(dataPath?: string): Promise<void> {
    const filePath = dataPath || path.join(__dirname, '../../data/dictionaries/semantic-vectors.txt');
    
    try {
      // Use readline to handle large files efficiently
      const readline = require('readline');
      const fileStream = require('fs').createReadStream(filePath);
      
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });
      
      let lineCount = 0;
      const maxWords = 100000; // Limit to first 100k words for better coverage
      
      this.logger.info(`Loading first ${maxWords} word vectors for better vocabulary coverage...`);
      
      for await (const line of rl) {
        if (line.trim() && lineCount < maxWords) {
          const parts = line.split(' ');
          const word = parts[0];
          
          // Only accept words that contain only letters (a-z, A-Z) and not in blacklist
          if (word && parts.length > 1 && /^[a-zA-Z]+$/.test(word) && !this.properNounBlacklist.has(word.toLowerCase())) {
            const vector = parts.slice(1).map(Number);
            
            if (vector.length > 0 && !vector.some(isNaN)) {
              this.wordVectors.set(word, vector);
              this.vocabulary.add(word);
              this.wordPositions.set(word, lineCount + 1); // Position in file (1-based)
              lineCount++;
              
              // Log progress every 10,000 words
              if (lineCount % 10000 === 0) {
                this.logger.info(`Loaded ${lineCount} word vectors...`);
              }
            }
          }
        } else if (lineCount >= maxWords) {
          break; // Stop loading after reaching limit
        }
      }
      
      this.logger.info(`Loaded ${this.wordVectors.size} word vectors (limited to ${maxWords} for vocabulary coverage)`);
    } catch (error) {
      this.logger.debug('No word vectors found:', error);
    }
  }

  /**
   * Load mock data for development/testing
   */
  private loadMockData(): void {
    this.logger.info('Loading mock semantic data for development');
    
    // Mock vocabulary
    const mockWords = [
      'cat', 'dog', 'animal', 'pet', 'kitten', 'puppy', 'feline', 'canine',
      'house', 'home', 'building', 'structure', 'dwelling', 'residence',
      'car', 'vehicle', 'automobile', 'truck', 'transportation',
      'book', 'read', 'story', 'novel', 'literature', 'text',
      'water', 'liquid', 'drink', 'ocean', 'sea', 'river',
      'food', 'eat', 'meal', 'dinner', 'lunch', 'breakfast'
    ];

    mockWords.forEach(word => this.vocabulary.add(word));

    // Mock rankings for 'cat'
    const catRankings = new Map([
      ['kitten', 1],
      ['feline', 2],
      ['pet', 3],
      ['animal', 8],
      ['dog', 15],
      ['puppy', 25],
      ['canine', 45],
      ['house', 500],
      ['car', 800],
      ['water', 900]
    ]);
    
    this.precomputedRankings.set('cat', catRankings);

    // Mock rankings for 'house'
    const houseRankings = new Map([
      ['home', 1],
      ['building', 2],
      ['dwelling', 3],
      ['residence', 5],
      ['structure', 12],
      ['car', 200],
      ['cat', 500],
      ['water', 700]
    ]);
    
    this.precomputedRankings.set('house', houseRankings);

    this.logger.info('Mock data loaded successfully');
  }

  /**
   * Calculate dynamic similarities when no pre-computed data exists
   */
  private calculateDynamicSimilarities(
    targetWord: string, 
    rankings: Map<string, number>, 
    similarities: Map<string, number>
  ): void {
    const targetVector = this.wordVectors.get(targetWord.toLowerCase());
    if (!targetVector) return;

    const wordSimilarities: Array<{ word: string; similarity: number }> = [];

    // Calculate similarity with all words in vocabulary
    this.vocabulary.forEach(word => {
      if (word !== targetWord.toLowerCase()) {
        const similarity = this.calculateSimilarity(targetWord, word);
        if (similarity > 0) {
          wordSimilarities.push({ word, similarity });
        }
      }
    });

    // Sort by similarity (highest first) and assign ranks
    wordSimilarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 1000) // Top 1000 only
      .forEach((item, index) => {
        const rank = index + 1;
        rankings.set(item.word, rank);
        similarities.set(item.word, item.similarity);
      });
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) return 0;

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      const v1 = vec1[i];
      const v2 = vec2[i];
      
      if (v1 !== undefined && v2 !== undefined) {
        dotProduct += v1 * v2;
        norm1 += v1 * v1;
        norm2 += v2 * v2;
      }
    }

    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }
}