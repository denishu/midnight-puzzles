import { Game, GameSession } from './Game.interface';
import { SessionManager } from './SessionManager';
import { DailyPuzzleRepository } from '../storage/DailyPuzzleRepository';
import { Logger } from '../utils/Logger';

/**
 * Factory for initializing new game instances
 * Coordinates game creation with daily puzzle generation and session management
 */
export class GameSessionFactory {
  private games: Map<string, Game> = new Map();
  private sessionManager: SessionManager;
  private dailyPuzzleRepo: DailyPuzzleRepository;
  private logger: Logger;

  constructor(sessionManager: SessionManager, dailyPuzzleRepo: DailyPuzzleRepository) {
    this.sessionManager = sessionManager;
    this.dailyPuzzleRepo = dailyPuzzleRepo;
    this.logger = new Logger('GameSessionFactory');
  }

  /**
   * Register a game implementation
   */
  registerGame(game: Game): void {
    this.games.set(game.name, game);
    this.logger.info(`Registered game: ${game.name}`);
  }

  /**
   * Get a registered game by name
   */
  getGame(gameName: string): Game | undefined {
    return this.games.get(gameName);
  }

  /**
   * Create or resume a game session for a user
   * Implements session resumption and daily puzzle consistency (Requirements 1.2, 1.3)
   */
  async createSession(
    userId: string,
    serverId: string,
    gameType: string,
    puzzleDate?: Date
  ): Promise<GameSession> {
    const game = this.games.get(gameType);
    
    if (!game) {
      throw new Error(`Game type not found: ${gameType}`);
    }
    
    const date = puzzleDate || new Date();
    
    // Check if user has already completed today's puzzle (Requirement 1.4)
    const hasCompleted = await this.sessionManager.hasCompletedToday(userId, gameType);
    if (hasCompleted) {
      this.logger.info(`User ${userId} has already completed ${gameType} for today`);
      // Return the completed session
      const session = await this.sessionManager.getOrCreateSession(
        userId,
        serverId,
        gameType,
        game.maxAttempts,
        date
      );
      return session;
    }
    
    // Ensure daily puzzle exists for this date (Requirement 1.3)
    await this.ensureDailyPuzzle(game, date);
    
    // Get or create session (Requirement 1.2)
    const session = await this.sessionManager.getOrCreateSession(
      userId,
      serverId,
      gameType,
      game.maxAttempts,
      date
    );
    
    this.logger.info(`Session created/resumed: ${session.id} for user ${userId}, game ${gameType}`);
    return session;
  }

  /**
   * Start a game session using the Game interface
   * Delegates to the specific game implementation
   */
  async startGameSession(userId: string, serverId: string, gameType: string): Promise<GameSession> {
    const game = this.games.get(gameType);
    
    if (!game) {
      throw new Error(`Game type not found: ${gameType}`);
    }
    
    return await game.startSession(userId, serverId);
  }

  /**
   * Get all registered game types
   */
  getRegisteredGames(): string[] {
    return Array.from(this.games.keys());
  }

  /**
   * Check if a game type is registered
   */
  isGameRegistered(gameType: string): boolean {
    return this.games.has(gameType);
  }

  /**
   * Ensure a daily puzzle exists for the specified date
   * Implements daily puzzle consistency (Requirement 1.3)
   */
  private async ensureDailyPuzzle(game: Game, date: Date): Promise<void> {
    const existingPuzzle = await this.dailyPuzzleRepo.getPuzzleByDate(game.name, date);
    
    if (existingPuzzle) {
      this.logger.debug(`Daily puzzle already exists for ${game.name} on ${date.toISOString()}`);
      return;
    }
    
    // Generate new daily puzzle
    this.logger.info(`Generating daily puzzle for ${game.name} on ${date.toISOString()}`);
    const puzzle = await game.generateDailyPuzzle(date);
    
    // Store the puzzle
    await this.dailyPuzzleRepo.createPuzzle(
      game.name,
      date,
      puzzle.puzzleData,
      puzzle.solution
    );
    
    this.logger.info(`Daily puzzle created for ${game.name}`);
  }
}
