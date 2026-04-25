import { 
  Game, 
  GameSession, 
  GuessResult, 
  GameState, 
  DailyPuzzle 
} from '../../core/auth/Game.interface';
import { SessionManager } from '../../core/auth/SessionManager';
import { DailyPuzzleRepository } from '../../core/storage/DailyPuzzleRepository';
import { SemanticEngine } from './SemanticEngine';
import { Logger } from '../../core/utils/Logger';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Semantle game implementation
 * Integrates with the shared game infrastructure
 */
export class SemantleGame implements Game {
  name = 'semantle';
  maxAttempts = Infinity;
  
  private semanticEngine: SemanticEngine;
  private sessionManager: SessionManager;
  private dailyPuzzleRepo: DailyPuzzleRepository;
  private logger: Logger;
  private initialized = false;
  private targetWords: string[] = [];

  constructor(
    semanticEngine: SemanticEngine,
    sessionManager: SessionManager,
    dailyPuzzleRepo: DailyPuzzleRepository
  ) {
    this.semanticEngine = semanticEngine;
    this.sessionManager = sessionManager;
    this.dailyPuzzleRepo = dailyPuzzleRepo;
    this.logger = new Logger('SemantleGame');
  }

  /**
   * Initialize the game (load semantic data)
   */
  async initialize(): Promise<void> {
    if (!this.initialized) {
      await this.semanticEngine.initialize();
      this.loadTargetWords();
      this.initialized = true;
      this.logger.info('Semantle game initialized');
    }
  }

  private loadTargetWords(): void {
    const filePath = path.join(__dirname, '../../data/dictionaries/target-words.txt');
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      this.targetWords = content.split('\n').map(w => w.trim()).filter(w => w.length > 0);
      this.logger.info(`Loaded ${this.targetWords.length} target words from file`);
    } catch {
      this.logger.warn('target-words.txt not found, using built-in word list');
      this.targetWords = [
        'river', 'ocean', 'forest', 'mountain', 'desert', 'island', 'valley', 'cloud',
        'storm', 'shadow', 'flame', 'stone', 'garden', 'flower', 'bridge', 'castle',
        'mirror', 'candle', 'freedom', 'courage', 'wisdom', 'memory', 'silence', 'mystery',
        'tiger', 'eagle', 'dolphin', 'rabbit', 'spider', 'falcon', 'turtle', 'raven',
        'honey', 'bread', 'pepper', 'coffee', 'lemon', 'cherry', 'ginger', 'mushroom',
      ];
    }
  }

  /**
   * Start a new game session for a user
   * Implements Requirement 1.1 - game command initiation
   */
  async startSession(userId: string, serverId: string): Promise<GameSession> {
    await this.ensureInitialized();
    
    // Get or create session (handles resumption automatically)
    const session = await this.sessionManager.getOrCreateSession(
      userId,
      serverId,
      this.name,
      this.maxAttempts
    );
    
    // Initialize game data if new session
    if (session.attempts === 0 && Object.keys(session.gameData).length === 0) {
      const puzzle = await this.getDailyPuzzle(session.puzzleDate);
      session.gameData = {
        targetWord: puzzle.puzzleData.targetWord,
        guesses: [],
        bestRank: null,
        foundRanks: []
      };
      await this.sessionManager.updateSession(session.id, session.gameData);
    }
    
    return session;
  }

  /**
   * Process a user's word guess
   * Implements Requirements 2.1, 2.2, 2.3, 2.5
   */
  async processGuess(sessionId: string, guess: string): Promise<GuessResult> {
    await this.ensureInitialized();
    
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) {
      return {
        isValid: false,
        feedback: 'Session not found',
        isComplete: false
      };
    }

    // Check if game is already complete (Requirement 1.4)
    if (session.isComplete) {
      return {
        isValid: false,
        feedback: 'Game already completed! You found the word in ' + session.attempts + ' guesses.',
        isComplete: true,
        data: { result: session.result }
      };
    }

    const guessWord = guess.toLowerCase().trim();
    const targetWord = session.gameData.targetWord;

    // Validate the guess is a real word (Requirement 2.1)
    if (!this.semanticEngine.isValidWord(guessWord)) {
      return {
        isValid: false,
        feedback: `"${guess}" is not in the vocabulary. Try another word.`,
        isComplete: false
      };
    }

    // Check if already guessed
    const previousGuesses = session.gameData.guesses || [];
    if (previousGuesses.some((g: any) => g.word === guessWord)) {
      return {
        isValid: false,
        feedback: `You already guessed "${guess}". Try a different word.`,
        isComplete: false
      };
    }

    // Calculate similarity and ranking (Requirement 2.1)
    const similarity = this.semanticEngine.calculateSimilarity(guessWord, targetWord);
    const rank = this.semanticEngine.getWordRank(targetWord, guessWord);

    // Increment attempts
    await this.sessionManager.incrementAttempts(sessionId);

    // Store the guess (Requirement 2.5)
    const guessData = {
      word: guessWord,
      similarity,
      rank,
      attemptNumber: session.attempts + 1,
      timestamp: new Date()
    };
    
    previousGuesses.push(guessData);
    session.gameData.guesses = previousGuesses;

    // Update best rank
    if (rank && (!session.gameData.bestRank || rank < session.gameData.bestRank)) {
      session.gameData.bestRank = rank;
    }

    // Track found ranks
    if (rank) {
      session.gameData.foundRanks = session.gameData.foundRanks || [];
      if (!session.gameData.foundRanks.includes(rank)) {
        session.gameData.foundRanks.push(rank);
      }
    }

    await this.sessionManager.updateSession(sessionId, session.gameData);

    // Check if correct (Requirement 2.4)
    if (guessWord === targetWord) {
      // Fix the stored guess to show correct rank/similarity
      guessData.rank = 0;
      guessData.similarity = 1.0;
      await this.sessionManager.updateSession(sessionId, session.gameData);

      const result = {
        success: true,
        attempts: session.attempts + 1,
        targetWord,
        guesses: previousGuesses.length
      };
      
      await this.sessionManager.completeSession(sessionId, result);
      
      return {
        isValid: true,
        feedback: `🎉 Congratulations! You found the word "${targetWord}" in ${session.attempts + 1} guesses!`,
        isComplete: true,
        data: { rank: 0, similarity: 1.0, result }
      };
    }

    // Generate feedback based on ranking (Requirements 2.2, 2.3)
    let feedback = '';
    if (rank && rank <= 1000) {
      // Word is in top 1000 - show exact rank (Requirement 2.2)
      feedback = `🎯 Rank: ${rank}/1000 (Similarity: ${(similarity * 100).toFixed(1)}%)`;
      
      if (rank === 1) {
        feedback += '\n🔥 You found the closest word!';
      } else if (rank <= 10) {
        feedback += '\n🔥 Very close!';
      } else if (rank <= 100) {
        feedback += '\n👍 Getting warmer!';
      }
    } else {
      // Word is not in top 1000
      if (similarity < 0.16) {
        feedback = `❄️ Cold (${(similarity * 100).toFixed(2)}%)`;
      } else {
        feedback = `🌊 Tepid (${(similarity * 100).toFixed(2)}%)`;
      }
    }

    return {
      isValid: true,
      feedback,
      isComplete: false,
      nextPrompt: `Guess #${session.attempts}`,
      data: { rank, similarity, bestRank: session.gameData.bestRank }
    };
  }

  /**
   * Get the current state of a game session
   */
  async getGameState(sessionId: string): Promise<GameState> {
    const session = await this.sessionManager.getSession(sessionId);
    
    if (!session) {
      throw new Error('Session not found');
    }

    const guesses = session.gameData.guesses || [];
    const bestRank = session.gameData.bestRank;

    return {
      session,
      progress: `${session.attempts}/${this.maxAttempts} guesses`,
      canContinue: !session.isComplete && session.attempts < this.maxAttempts,
      state: {
        totalGuesses: guesses.length,
        bestRank,
        recentGuesses: guesses.slice(-5), // Last 5 guesses
        isComplete: session.isComplete
      }
    };
  }

  /**
   * Get similarity thresholds for the 1st, 10th, and 1000th most similar words.
   * Used by the web UI to show reference points.
   */
  getSimilarityThresholds(targetWord: string): { rank1: number | null; rank10: number | null; rank1000: number | null } {
    const data = this.semanticEngine.getSemanticData(targetWord);
    let rank1: number | null = null;
    let rank10: number | null = null;
    let rank1000: number | null = null;

    for (const [word, rank] of data.rankings.entries()) {
      const sim = data.similarities.get(word);
      if (sim == null) continue;
      if (rank === 1) rank1 = sim;
      if (rank === 10) rank10 = sim;
      if (rank === 1000) rank1000 = sim;
    }

    return { rank1, rank10, rank1000 };
  }

  /**
   * Get the similarity score of the 1000th most similar word to the target.
   */
  get1000thSimilarity(targetWord: string): number | null {
    const data = this.semanticEngine.getSemanticData(targetWord);
    // Find the word ranked 1000
    for (const [word, rank] of data.rankings.entries()) {
      if (rank === 1000) {
        return data.similarities.get(word) ?? null;
      }
    }
    // If less than 1000 ranked words, get the last one
    let maxRank = 0;
    let lastSim = 0;
    for (const [word, rank] of data.rankings.entries()) {
      if (rank > maxRank) { maxRank = rank; lastSim = data.similarities.get(word) ?? 0; }
    }
    return lastSim || null;
  }

  /**
   * Get a hint for the current game session
   */
  async getHint(sessionId: string): Promise<{ word: string; rank: number } | null> {
    await this.ensureInitialized();

    const session = await this.sessionManager.getSession(sessionId);
    if (!session || session.isComplete) return null;

    const targetWord = session.gameData.targetWord;
    const guesses: Array<{ word: string }> = session.gameData.guesses || [];
    const guessedWords = new Set(guesses.map(g => g.word));
    const bestRank = session.gameData.bestRank;

    return this.semanticEngine.getHintWord(targetWord, bestRank, guessedWords);
  }

  /**
   * Generate a new daily puzzle
   * Implements Requirement 1.3 - daily puzzle consistency
   */
  async generateDailyPuzzle(date: Date): Promise<DailyPuzzle> {
    await this.ensureInitialized();
    
    // Use date as seed for deterministic word selection
    const dateStr = date.toISOString().split('T')[0] || date.toISOString();
    const seed = this.hashString(dateStr);
    
    // Get a list of valid target words (common words, not proper nouns)
    const targetWord = this.selectTargetWord(seed);
    
    // Get semantic data for the target word
    const semanticData = this.semanticEngine.getSemanticData(targetWord);
    
    return {
      id: `${this.name}-${dateStr}`,
      gameType: this.name,
      date,
      puzzleData: {
        targetWord,
        // Don't include rankings in puzzle data to prevent cheating
      },
      solution: {
        targetWord,
        rankings: Array.from(semanticData.rankings.entries()).slice(0, 10) // Top 10 for reference
      },
      createdAt: new Date()
    };
  }

  /**
   * Get today's daily puzzle
   */
  private async getDailyPuzzle(date: Date): Promise<DailyPuzzle> {
    const puzzle = await this.dailyPuzzleRepo.getPuzzleByDate(this.name, date);
    
    if (!puzzle) {
      // Generate and store new puzzle
      const generatedPuzzle = await this.generateDailyPuzzle(date);
      await this.dailyPuzzleRepo.createPuzzle(
        this.name,
        date,
        generatedPuzzle.puzzleData,
        generatedPuzzle.solution
      );
      return generatedPuzzle;
    }
    
    // Convert repository puzzle to Game interface puzzle
    const result: DailyPuzzle = {
      id: puzzle.id,
      gameType: puzzle.gameType,
      date: puzzle.puzzleDate,
      puzzleData: puzzle.puzzleData,
      createdAt: puzzle.createdAt
    };
    
    if (puzzle.solution) {
      result.solution = puzzle.solution;
    }
    
    return result;
  }

  /**
   * Select a target word based on seed
   */
  private selectTargetWord(seed: number): string {
    const index = Math.abs(seed) % this.targetWords.length;
    return this.targetWords[index]!;
  }

  /**
   * Simple string hash function for deterministic randomness
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Ensure the game is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}
