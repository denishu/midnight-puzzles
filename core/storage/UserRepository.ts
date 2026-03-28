import { DatabaseConnection } from './DatabaseConnection';
import { Logger } from '../utils/Logger';

export interface User {
  discordId: string;
  username: string;
  preferences: Record<string, any>;
  statistics: Record<string, any>;
  createdAt: Date;
  lastActive: Date;
}

export interface UserPreferences {
  theme?: string;
  notifications?: boolean;
  [key: string]: any;
}

export interface UserStatistics {
  gamesPlayed?: number;
  gamesWon?: number;
  currentStreak?: number;
  maxStreak?: number;
  [key: string]: any;
}

/**
 * Repository for managing user data
 */
export class UserRepository {
  private db: DatabaseConnection;
  private logger: Logger;

  constructor(db: DatabaseConnection) {
    this.db = db;
    this.logger = new Logger('UserRepository');
  }

  /**
   * Create a new user or update if exists
   */
  async upsertUser(discordId: string, username: string): Promise<User> {
    try {
      const sql = `
        INSERT INTO users (discord_id, username, last_active)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (discord_id) 
        DO UPDATE SET username = ?, last_active = CURRENT_TIMESTAMP
        RETURNING *
      `;
      
      const rows = await this.db.query<any>(sql, [discordId, username, username]);
      return this.mapRowToUser(rows[0]);
    } catch (error) {
      this.logger.error('Error upserting user:', { discordId, username, error });
      throw error;
    }
  }

  /**
   * Get user by Discord ID
   */
  async getUser(discordId: string): Promise<User | null> {
    try {
      const sql = 'SELECT * FROM users WHERE discord_id = $1';
      const rows = await this.db.query<any>(sql, [discordId]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return this.mapRowToUser(rows[0]);
    } catch (error) {
      this.logger.error('Error getting user:', { discordId, error });
      throw error;
    }
  }

  /**
   * Update user preferences
   */
  async updatePreferences(discordId: string, preferences: UserPreferences): Promise<void> {
    try {
      const sql = `
        UPDATE users 
        SET preferences = $1, last_active = CURRENT_TIMESTAMP
        WHERE discord_id = $2
      `;
      
      await this.db.query(sql, [JSON.stringify(preferences), discordId]);
    } catch (error) {
      this.logger.error('Error updating preferences:', { discordId, preferences, error });
      throw error;
    }
  }

  /**
   * Update user statistics
   */
  async updateStatistics(discordId: string, statistics: UserStatistics): Promise<void> {
    try {
      const sql = `
        UPDATE users 
        SET statistics = $1, last_active = CURRENT_TIMESTAMP
        WHERE discord_id = $2
      `;
      
      await this.db.query(sql, [JSON.stringify(statistics), discordId]);
    } catch (error) {
      this.logger.error('Error updating statistics:', { discordId, statistics, error });
      throw error;
    }
  }

  /**
   * Get user preferences
   */
  async getPreferences(discordId: string): Promise<UserPreferences> {
    try {
      const user = await this.getUser(discordId);
      return user?.preferences || {};
    } catch (error) {
      this.logger.error('Error getting preferences:', { discordId, error });
      throw error;
    }
  }

  /**
   * Get user statistics
   */
  async getStatistics(discordId: string): Promise<UserStatistics> {
    try {
      const user = await this.getUser(discordId);
      return user?.statistics || {};
    } catch (error) {
      this.logger.error('Error getting statistics:', { discordId, error });
      throw error;
    }
  }

  /**
   * Update last active timestamp
   */
  async updateLastActive(discordId: string): Promise<void> {
    try {
      const sql = 'UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE discord_id = $1';
      await this.db.query(sql, [discordId]);
    } catch (error) {
      this.logger.error('Error updating last active:', { discordId, error });
      throw error;
    }
  }

  /**
   * Map database row to User object
   */
  private mapRowToUser(row: any): User {
    return {
      discordId: row.discord_id,
      username: row.username,
      preferences: typeof row.preferences === 'string' ? JSON.parse(row.preferences) : row.preferences,
      statistics: typeof row.statistics === 'string' ? JSON.parse(row.statistics) : row.statistics,
      createdAt: new Date(row.created_at),
      lastActive: new Date(row.last_active)
    };
  }
}
