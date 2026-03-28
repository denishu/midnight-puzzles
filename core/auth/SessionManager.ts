import { GameSession } from './Game.interface';
import { GameStateRepository } from '../storage/GameStateRepository';
import { Logger } from '../utils/Logger';

/**
 * Manages active user game sessions
 * Tracks sessions in memory for quick access and coordinates with persistent storage
 */
export class SessionManager {
  private activeSessions: Map<string, GameSession> = new Map();
  private userSessionIndex: Map<string, Set<string>> = new Map();
  private gameStateRepo: GameStateRepository;
  private logger: Logger;

  constructor(gameStateRepo: GameStateRepository) {
    this.gameStateRepo = gameStateRepo;
    this.logger = new Logger('SessionManager');
  }

  /**
   * Get or create a session for a user and game type
   * Implements session resumption (Requirement 1.2)
   */
  async getOrCreateSession(
    userId: string,
    serverId: string,
    gameType: string,
    maxAttempts: number,
    puzzleDate?: Date
  ): Promise<GameSession> {
    const date = puzzleDate || new Date();
    
    // Check if user already has an active session for this game today
    const existingSession = await this.gameStateRepo.getActiveSession(userId, gameType, date);
    
    if (existingSession) {
      this.logger.info(`Resuming session for user ${userId}, game ${gameType}`);
      this.trackSession(existingSession);
      return existingSession;
    }
    
    // Create new session
    this.logger.info(`Creating new session for user ${userId}, game ${gameType}`);
    const newSession = await this.gameStateRepo.createSession({
      userId,
      serverId,
      gameType,
      puzzleDate: date,
      maxAttempts,
      gameData: {}
    });
    
    this.trackSession(newSession);
    return newSession;
  }

  /**
   * Get an active session by ID
   */
  async getSession(sessionId: string): Promise<GameSession | null> {
    // Check memory first
    if (this.activeSessions.has(sessionId)) {
      return this.activeSessions.get(sessionId)!;
    }
    
    // Fall back to database
    const session = await this.gameStateRepo.getSession(sessionId);
    if (session) {
      this.trackSession(session);
    }
    
    return session;
  }

  /**
   * Update session data
   */
  async updateSession(sessionId: string, gameData: Record<string, any>): Promise<void> {
    await this.gameStateRepo.updateGameData(sessionId, gameData);
    
    // Update in-memory cache
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.gameData = gameData;
    }
  }

  /**
   * Increment attempt counter for a session
   */
  async incrementAttempts(sessionId: string): Promise<void> {
    await this.gameStateRepo.incrementAttempts(sessionId);
    
    // Update in-memory cache
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.attempts++;
    }
  }

  /**
   * Complete a game session
   * Implements completed game protection (Requirement 1.4)
   */
  async completeSession(sessionId: string, result: Record<string, any>): Promise<void> {
    await this.gameStateRepo.completeSession(sessionId, result);
    
    // Update in-memory cache
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.isComplete = true;
      session.endTime = new Date();
      session.result = result;
    }
    
    this.logger.info(`Session ${sessionId} completed`);
  }

  /**
   * Check if user has completed today's puzzle for a game type
   * Implements completed game protection (Requirement 1.4)
   */
  async hasCompletedToday(userId: string, gameType: string): Promise<boolean> {
    return await this.gameStateRepo.hasCompletedToday(userId, gameType);
  }

  /**
   * Get all active sessions for a user
   */
  getUserSessions(userId: string): GameSession[] {
    const sessionIds = this.userSessionIndex.get(userId);
    if (!sessionIds) {
      return [];
    }
    
    return Array.from(sessionIds)
      .map(id => this.activeSessions.get(id))
      .filter((session): session is GameSession => session !== undefined);
  }

  /**
   * Remove a session from active tracking
   */
  removeSession(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      const userSessions = this.userSessionIndex.get(session.userId);
      if (userSessions) {
        userSessions.delete(sessionId);
        if (userSessions.size === 0) {
          this.userSessionIndex.delete(session.userId);
        }
      }
      this.activeSessions.delete(sessionId);
      this.logger.info(`Removed session ${sessionId} from tracking`);
    }
  }

  /**
   * Clean up old completed sessions from memory
   */
  cleanupOldSessions(maxAgeMinutes: number = 60): number {
    const cutoffTime = Date.now() - (maxAgeMinutes * 60 * 1000);
    let removed = 0;
    
    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.isComplete && session.endTime) {
        if (session.endTime.getTime() < cutoffTime) {
          this.removeSession(sessionId);
          removed++;
        }
      }
    }
    
    if (removed > 0) {
      this.logger.info(`Cleaned up ${removed} old sessions`);
    }
    
    return removed;
  }

  /**
   * Get statistics about active sessions
   */
  getStats(): {
    totalSessions: number;
    activeUsers: number;
    completedSessions: number;
  } {
    let completedSessions = 0;
    
    for (const session of this.activeSessions.values()) {
      if (session.isComplete) {
        completedSessions++;
      }
    }
    
    return {
      totalSessions: this.activeSessions.size,
      activeUsers: this.userSessionIndex.size,
      completedSessions
    };
  }

  /**
   * Track a session in memory
   */
  private trackSession(session: GameSession): void {
    this.activeSessions.set(session.id, session);
    
    if (!this.userSessionIndex.has(session.userId)) {
      this.userSessionIndex.set(session.userId, new Set());
    }
    this.userSessionIndex.get(session.userId)!.add(session.id);
  }
}
