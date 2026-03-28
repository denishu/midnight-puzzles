import { DatabaseConnection } from './DatabaseConnection';
import { Logger } from '../utils/Logger';

export interface DailyPuzzle {
  id: string;
  gameType: string;
  puzzleDate: Date;
  puzzleData: Record<string, any>;
  solution: Record<string, any> | null;
  createdAt: Date;
}

/**
 * Repository for managing daily puzzles
 */
export class DailyPuzzleRepository {
  private db: DatabaseConnection;
  private logger: Logger;

  constructor(db: DatabaseConnection) {
    this.db = db;
    this.logger = new Logger('DailyPuzzleRepository');
  }

  /**
   * Get today's puzzle for a specific game type
   */
  async getTodaysPuzzle(gameType: string): Promise<DailyPuzzle | null> {
    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      const sql = `
        SELECT * FROM daily_puzzles 
        WHERE game_type = $1 AND puzzle_date = $2
      `;
      
      const rows = await this.db.query<any>(sql, [gameType, today]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return this.mapRowToPuzzle(rows[0]);
    } catch (error) {
      this.logger.error('Error getting today\'s puzzle:', { gameType, error });
      throw error;
    }
  }

  /**
   * Get puzzle for a specific date
   */
  async getPuzzleByDate(gameType: string, date: Date): Promise<DailyPuzzle | null> {
    try {
      const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
      
      const sql = `
        SELECT * FROM daily_puzzles 
        WHERE game_type = $1 AND puzzle_date = $2
      `;
      
      const rows = await this.db.query<any>(sql, [gameType, dateStr]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return this.mapRowToPuzzle(rows[0]);
    } catch (error) {
      this.logger.error('Error getting puzzle by date:', { gameType, date, error });
      throw error;
    }
  }

  /**
   * Create a new daily puzzle
   */
  async createPuzzle(
    gameType: string,
    puzzleDate: Date,
    puzzleData: Record<string, any>,
    solution?: Record<string, any>
  ): Promise<DailyPuzzle> {
    try {
      const dateStr = puzzleDate.toISOString().split('T')[0]; // YYYY-MM-DD
      
      const sql = `
        INSERT INTO daily_puzzles (game_type, puzzle_date, puzzle_data, solution)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (game_type, puzzle_date)
        DO UPDATE SET puzzle_data = $3, solution = $4
        RETURNING *
      `;
      
      const rows = await this.db.query<any>(sql, [
        gameType,
        dateStr,
        JSON.stringify(puzzleData),
        solution ? JSON.stringify(solution) : null
      ]);
      
      return this.mapRowToPuzzle(rows[0]);
    } catch (error) {
      this.logger.error('Error creating puzzle:', { gameType, puzzleDate, error });
      throw error;
    }
  }

  /**
   * Update puzzle solution (for revealing answers)
   */
  async updateSolution(puzzleId: string, solution: Record<string, any>): Promise<void> {
    try {
      const sql = `
        UPDATE daily_puzzles 
        SET solution = $1
        WHERE id = $2
      `;
      
      await this.db.query(sql, [JSON.stringify(solution), puzzleId]);
    } catch (error) {
      this.logger.error('Error updating solution:', { puzzleId, error });
      throw error;
    }
  }

  /**
   * Get recent puzzles for a game type
   */
  async getRecentPuzzles(gameType: string, limit: number = 7): Promise<DailyPuzzle[]> {
    try {
      const sql = `
        SELECT * FROM daily_puzzles 
        WHERE game_type = $1
        ORDER BY puzzle_date DESC
        LIMIT $2
      `;
      
      const rows = await this.db.query<any>(sql, [gameType, limit]);
      return rows.map(row => this.mapRowToPuzzle(row));
    } catch (error) {
      this.logger.error('Error getting recent puzzles:', { gameType, limit, error });
      throw error;
    }
  }

  /**
   * Check if puzzle exists for a date
   */
  async puzzleExists(gameType: string, date: Date): Promise<boolean> {
    try {
      const puzzle = await this.getPuzzleByDate(gameType, date);
      return puzzle !== null;
    } catch (error) {
      this.logger.error('Error checking puzzle existence:', { gameType, date, error });
      throw error;
    }
  }

  /**
   * Delete old puzzles (cleanup)
   */
  async deleteOldPuzzles(gameType: string, daysToKeep: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      const cutoffStr = cutoffDate.toISOString().split('T')[0];
      
      const sql = `
        DELETE FROM daily_puzzles 
        WHERE game_type = $1 AND puzzle_date < $2
      `;
      
      const result = await this.db.query(sql, [gameType, cutoffStr]);
      return result.length;
    } catch (error) {
      this.logger.error('Error deleting old puzzles:', { gameType, daysToKeep, error });
      throw error;
    }
  }

  /**
   * Map database row to DailyPuzzle object
   */
  private mapRowToPuzzle(row: any): DailyPuzzle {
    return {
      id: row.id,
      gameType: row.game_type,
      puzzleDate: new Date(row.puzzle_date),
      puzzleData: typeof row.puzzle_data === 'string' ? JSON.parse(row.puzzle_data) : row.puzzle_data,
      solution: row.solution ? (typeof row.solution === 'string' ? JSON.parse(row.solution) : row.solution) : null,
      createdAt: new Date(row.created_at)
    };
  }
}
