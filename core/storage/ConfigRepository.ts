import { DatabaseConnection } from './DatabaseConnection';
import { Logger } from '../utils/Logger';

export interface ServerConfig {
  serverId: string;
  enabledGames: string[];
  customSettings: Record<string, any>;
  customWordLists: Record<string, string[]>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Repository for managing server configurations
 */
export class ConfigRepository {
  private db: DatabaseConnection;
  private logger: Logger;

  constructor(db: DatabaseConnection) {
    this.db = db;
    this.logger = new Logger('ConfigRepository');
  }

  /**
   * Get server configuration
   */
  async getServerConfig(serverId: string): Promise<ServerConfig | null> {
    try {
      const sql = 'SELECT * FROM server_configs WHERE server_id = $1';
      const rows = await this.db.query<any>(sql, [serverId]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return this.mapRowToConfig(rows[0]);
    } catch (error) {
      this.logger.error('Error getting server config:', { serverId, error });
      throw error;
    }
  }

  /**
   * Create or update server configuration
   */
  async upsertServerConfig(serverId: string, config: Partial<ServerConfig>): Promise<ServerConfig> {
    try {
      const enabledGames = config.enabledGames || ['semantle', 'travle', 'duotrigordle'];
      const customSettings = config.customSettings || {};
      const customWordLists = config.customWordLists || {};

      const sql = `
        INSERT INTO server_configs (server_id, enabled_games, custom_settings, custom_word_lists)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (server_id)
        DO UPDATE SET 
          enabled_games = $2,
          custom_settings = $3,
          custom_word_lists = $4,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;
      
      const rows = await this.db.query<any>(sql, [
        serverId,
        JSON.stringify(enabledGames),
        JSON.stringify(customSettings),
        JSON.stringify(customWordLists)
      ]);
      
      return this.mapRowToConfig(rows[0]);
    } catch (error) {
      this.logger.error('Error upserting server config:', { serverId, config, error });
      throw error;
    }
  }

  /**
   * Update enabled games for a server
   */
  async updateEnabledGames(serverId: string, games: string[]): Promise<void> {
    try {
      const sql = `
        UPDATE server_configs 
        SET enabled_games = $1, updated_at = CURRENT_TIMESTAMP
        WHERE server_id = $2
      `;
      
      await this.db.query(sql, [JSON.stringify(games), serverId]);
    } catch (error) {
      this.logger.error('Error updating enabled games:', { serverId, games, error });
      throw error;
    }
  }

  /**
   * Update custom settings for a server
   */
  async updateCustomSettings(serverId: string, settings: Record<string, any>): Promise<void> {
    try {
      const sql = `
        UPDATE server_configs 
        SET custom_settings = $1, updated_at = CURRENT_TIMESTAMP
        WHERE server_id = $2
      `;
      
      await this.db.query(sql, [JSON.stringify(settings), serverId]);
    } catch (error) {
      this.logger.error('Error updating custom settings:', { serverId, settings, error });
      throw error;
    }
  }

  /**
   * Update custom word lists for a server
   */
  async updateCustomWordLists(serverId: string, wordLists: Record<string, string[]>): Promise<void> {
    try {
      const sql = `
        UPDATE server_configs 
        SET custom_word_lists = $1, updated_at = CURRENT_TIMESTAMP
        WHERE server_id = $2
      `;
      
      await this.db.query(sql, [JSON.stringify(wordLists), serverId]);
    } catch (error) {
      this.logger.error('Error updating custom word lists:', { serverId, wordLists, error });
      throw error;
    }
  }

  /**
   * Check if a game is enabled for a server
   */
  async isGameEnabled(serverId: string, gameType: string): Promise<boolean> {
    try {
      const config = await this.getServerConfig(serverId);
      
      // If no config exists, all games are enabled by default
      if (!config) {
        return true;
      }
      
      return config.enabledGames.includes(gameType);
    } catch (error) {
      this.logger.error('Error checking if game is enabled:', { serverId, gameType, error });
      throw error;
    }
  }

  /**
   * Map database row to ServerConfig object
   */
  private mapRowToConfig(row: any): ServerConfig {
    return {
      serverId: row.server_id,
      enabledGames: typeof row.enabled_games === 'string' ? JSON.parse(row.enabled_games) : row.enabled_games,
      customSettings: typeof row.custom_settings === 'string' ? JSON.parse(row.custom_settings) : row.custom_settings,
      customWordLists: typeof row.custom_word_lists === 'string' ? JSON.parse(row.custom_word_lists) : row.custom_word_lists,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
