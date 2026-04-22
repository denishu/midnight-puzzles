import { DatabaseConnection } from './DatabaseConnection';
import { Logger } from '../utils/Logger';

export interface GameSession {
  id: string;
  userId: string;
  serverId: string;
  gameType: string;
  puzzleDate: Date;
  startTime: Date;
  endTime: Date | null;
  isComplete: boolean;
  attempts: number;
  maxAttempts: number;
  gameData: Record<string, any>;
  result: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSessionData {
  userId: string;
  serverId: string;
  gameType: string;
  puzzleDate: Date;
  maxAttempts: number;
  gameData?: Record<string, any>;
}

/**
 * Repository for managing game sessions and state
 */
export class GameStateRepository {
  private db: DatabaseConnection;
  private logger: Logger;

  constructor(db: DatabaseConnection) {
    this.db = db;
    this.logger = new Logger('GameStateRepository');
  }

  /**
   * Create a new game session
   */
  async createSession(data: CreateSessionData): Promise<GameSession> {
    try {
      const dateStr = data.puzzleDate.toISOString().split('T')[0];
      
      const sql = `
        INSERT INTO game_sessions 
        (user_id, server_id, game_type, puzzle_date, max_attempts, game_data)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      
      const rows = await this.db.query<any>(sql, [
        data.userId,
        data.serverId,
        data.gameType,
        dateStr,
        data.maxAttempts,
        JSON.stringify(data.gameData || {})
      ]);
      
      return this.mapRowToSession(rows[0]);
    } catch (error) {
      this.logger.error('Error creating session:', { data, error });
      throw error;
    }
  }

  /**
   * Get active session for a user and game type
   */
  async getActiveSession(userId: string, gameType: string, puzzleDate?: Date): Promise<GameSession | null> {
    try {
      const dateStr = puzzleDate ? puzzleDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      
      const sql = `
        SELECT * FROM game_sessions 
        WHERE user_id = $1 AND game_type = $2 AND puzzle_date = $3
        ORDER BY created_at DESC
        LIMIT 1
      `;
      
      const rows = await this.db.query<any>(sql, [userId, gameType, dateStr]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return this.mapRowToSession(rows[0]);
    } catch (error) {
      this.logger.error('Error getting active session:', { userId, gameType, puzzleDate, error });
      throw error;
    }
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<GameSession | null> {
    try {
      const sql = 'SELECT * FROM game_sessions WHERE id = $1';
      const rows = await this.db.query<any>(sql, [sessionId]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return this.mapRowToSession(rows[0]);
    } catch (error) {
      this.logger.error('Error getting session:', { sessionId, error });
      throw error;
    }
  }

  /**
   * Update game data (e.g., add a guess)
   */
  async updateGameData(sessionId: string, gameData: Record<string, any>): Promise<void> {
    try {
      const sql = `
        UPDATE game_sessions 
        SET game_data = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `;
      
      await this.db.query(sql, [JSON.stringify(gameData), sessionId]);
    } catch (error) {
      this.logger.error('Error updating game data:', { sessionId, gameData, error });
      throw error;
    }
  }

  /**
   * Increment attempt counter
   */
  async incrementAttempts(sessionId: string): Promise<void> {
    try {
      const sql = `
        UPDATE game_sessions 
        SET attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `;
      
      await this.db.query(sql, [sessionId]);
    } catch (error) {
      this.logger.error('Error incrementing attempts:', { sessionId, error });
      throw error;
    }
  }

  /**
   * Complete a game session
   */
  async completeSession(sessionId: string, result: Record<string, any>): Promise<void> {
    try {
      const sql = `
        UPDATE game_sessions 
        SET 
          is_complete = TRUE,
          end_time = CURRENT_TIMESTAMP,
          result = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `;
      
      await this.db.query(sql, [JSON.stringify(result), sessionId]);
    } catch (error) {
      this.logger.error('Error completing session:', { sessionId, result, error });
      throw error;
    }
  }

  /**
   * Get user's game history
   */
  async getUserHistory(userId: string, gameType?: string, limit: number = 10): Promise<GameSession[]> {
    try {
      let sql = `
        SELECT * FROM game_sessions 
        WHERE user_id = $1
      `;
      
      const params: any[] = [userId];
      
      if (gameType) {
        sql += ' AND game_type = $2';
        params.push(gameType);
      }
      
      sql += ' ORDER BY puzzle_date DESC, created_at DESC LIMIT $' + (params.length + 1);
      params.push(limit);
      
      const rows = await this.db.query<any>(sql, params);
      return rows.map(row => this.mapRowToSession(row));
    } catch (error) {
      this.logger.error('Error getting user history:', { userId, gameType, limit, error });
      throw error;
    }
  }

  /**
   * Get server leaderboard for a specific date
   */
  async getServerLeaderboard(
    serverId: string,
    gameType: string,
    puzzleDate: Date,
    limit: number = 10
  ): Promise<GameSession[]> {
    try {
      const dateStr = puzzleDate.toISOString().split('T')[0];
      
      const sql = `
        SELECT * FROM game_sessions 
        WHERE server_id = $1 AND game_type = $2 AND puzzle_date = $3 AND is_complete = TRUE
        ORDER BY attempts ASC, end_time ASC
        LIMIT $4
      `;
      
      const rows = await this.db.query<any>(sql, [serverId, gameType, dateStr, limit]);
      return rows.map(row => this.mapRowToSession(row));
    } catch (error) {
      this.logger.error('Error getting server leaderboard:', { serverId, gameType, puzzleDate, limit, error });
      throw error;
    }
  }

  /**
   * Get completion statistics for a date
   */
  async getCompletionStats(gameType: string, puzzleDate: Date): Promise<{
    totalGames: number;
    completedGames: number;
    averageAttempts: number;
  }> {
    try {
      const dateStr = puzzleDate.toISOString().split('T')[0];
      
      const sql = `
        SELECT 
          COUNT(*) as total_games,
          SUM(CASE WHEN is_complete THEN 1 ELSE 0 END) as completed_games,
          AVG(CASE WHEN is_complete THEN attempts ELSE NULL END) as average_attempts
        FROM game_sessions
        WHERE game_type = $1 AND puzzle_date = $2
      `;
      
      const rows = await this.db.query<any>(sql, [gameType, dateStr]);
      const row = rows[0];
      
      return {
        totalGames: parseInt(row.total_games) || 0,
        completedGames: parseInt(row.completed_games) || 0,
        averageAttempts: parseFloat(row.average_attempts) || 0
      };
    } catch (error) {
      this.logger.error('Error getting completion stats:', { gameType, puzzleDate, error });
      throw error;
    }
  }

  /**
   * Check if user has completed today's puzzle
   */
  async hasCompletedToday(userId: string, gameType: string): Promise<boolean> {
    try {
      const session = await this.getActiveSession(userId, gameType);
      return session?.isComplete || false;
    } catch (error) {
      this.logger.error('Error checking completion:', { userId, gameType, error });
      throw error;
    }
  }

  /**
   * Delete a specific session by ID
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.db.query('DELETE FROM game_sessions WHERE id = $1', [sessionId]);
    } catch (error) {
      this.logger.error('Error deleting session:', { sessionId, error });
      throw error;
    }
  }

  /**
   * Delete old sessions (cleanup)
   */
  async deleteOldSessions(daysToKeep: number = 90): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      const cutoffStr = cutoffDate.toISOString().split('T')[0];
      
      const sql = `
        DELETE FROM game_sessions 
        WHERE puzzle_date < $1
      `;
      
      const result = await this.db.query(sql, [cutoffStr]);
      return result.length;
    } catch (error) {
      this.logger.error('Error deleting old sessions:', { daysToKeep, error });
      throw error;
    }
  }

  /**
   * Get all completed sessions for a game type and date, joined with username.
   * Used for daily recap messages.
   */
  async getCompletedSessionsForDate(gameType: string, puzzleDate: Date): Promise<Array<GameSession & { username: string }>> {
    try {
      const dateStr = puzzleDate.toISOString().split('T')[0];
      const sql = `
        SELECT gs.*, u.username
        FROM game_sessions gs
        JOIN users u ON gs.user_id = u.discord_id
        WHERE gs.game_type = $1 AND gs.puzzle_date = $2 AND gs.is_complete = TRUE
        ORDER BY gs.server_id, gs.end_time ASC
      `;
      const rows = await this.db.query<any>(sql, [gameType, dateStr]);
      return rows.map(row => ({ ...this.mapRowToSession(row), username: row.username }));
    } catch (error) {
      this.logger.error('Error getting completed sessions for date:', { gameType, puzzleDate, error });
      throw error;
    }
  }

  /**
   * Map database row to GameSession object
   */
  private mapRowToSession(row: any): GameSession {
    return {
      id: row.id,
      userId: row.user_id,
      serverId: row.server_id,
      gameType: row.game_type,
      puzzleDate: new Date(row.puzzle_date),
      startTime: new Date(row.start_time),
      endTime: row.end_time ? new Date(row.end_time) : null,
      isComplete: row.is_complete,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      gameData: typeof row.game_data === 'string' ? JSON.parse(row.game_data) : row.game_data,
      result: row.result ? (typeof row.result === 'string' ? JSON.parse(row.result) : row.result) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
