import { Pool, PoolClient } from 'pg';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { Logger } from '../utils/Logger';

export interface DatabaseConfig {
  type: 'sqlite' | 'postgresql';
  host?: string;
  port?: number;
  database: string;
  username?: string;
  password?: string;
  maxConnections?: number;
  idleTimeoutMs?: number;
}

export interface DatabaseConnection {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  transaction<T>(callback: (client: any) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PostgreSQLConnection implements DatabaseConnection {
  private pool: Pool;
  private logger: Logger;

  constructor(config: DatabaseConfig, logger: Logger) {
    this.logger = logger;
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      max: config.maxConnections || 20,
      idleTimeoutMillis: config.idleTimeoutMs || 30000,
      connectionTimeoutMillis: 2000,
    });

    this.pool.on('error', (err) => {
      this.logger.error('PostgreSQL pool error:', err);
    });
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows;
    } catch (error) {
      this.logger.error('PostgreSQL query error:', { sql, params, error });
      throw error;
    } finally {
      client.release();
    }
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('PostgreSQL transaction error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class SQLiteConnection implements DatabaseConnection {
  private db: sqlite3.Database;
  private logger: Logger;
  private dbAll: (sql: string, params?: any[]) => Promise<any[]>;
  private dbRun: (sql: string, params?: any[]) => Promise<sqlite3.RunResult>;

  constructor(config: DatabaseConfig, logger: Logger) {
    this.logger = logger;
    this.db = new sqlite3.Database(config.database, (err) => {
      if (err) {
        this.logger.error('SQLite connection error:', err);
        throw err;
      }
    });

    // Promisify SQLite methods
    this.dbAll = promisify(this.db.all.bind(this.db));
    this.dbRun = promisify(this.db.run.bind(this.db));

    // Enable foreign keys
    this.db.run('PRAGMA foreign_keys = ON');
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    try {
      return await this.dbAll(sql, params);
    } catch (error) {
      this.logger.error('SQLite query error:', { sql, params, error });
      throw error;
    }
  }

  async transaction<T>(callback: (client: any) => Promise<T>): Promise<T> {
    try {
      await this.dbRun('BEGIN TRANSACTION');
      const result = await callback(this);
      await this.dbRun('COMMIT');
      return result;
    } catch (error) {
      await this.dbRun('ROLLBACK');
      this.logger.error('SQLite transaction error:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          this.logger.error('SQLite close error:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

export class DatabaseConnectionFactory {
  private static instance: DatabaseConnection | null = null;
  private static logger: Logger = new Logger('DatabaseConnection');

  static async create(config: DatabaseConfig): Promise<DatabaseConnection> {
    if (this.instance) {
      return this.instance;
    }

    switch (config.type) {
      case 'postgresql':
        this.instance = new PostgreSQLConnection(config, this.logger);
        break;
      case 'sqlite':
        this.instance = new SQLiteConnection(config, this.logger);
        break;
      default:
        throw new Error(`Unsupported database type: ${config.type}`);
    }

    return this.instance;
  }

  static async close(): Promise<void> {
    if (this.instance) {
      await this.instance.close();
      this.instance = null;
    }
  }
}