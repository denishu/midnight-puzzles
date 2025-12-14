import { readFileSync } from 'fs';
import { join } from 'path';
import { DatabaseConnection, DatabaseConnectionFactory, DatabaseConfig } from '../DatabaseConnection';
import { Logger } from '../../utils/Logger';

export interface Migration {
  version: number;
  name: string;
  up: string;
  down?: string;
}

export class MigrationManager {
  private db: DatabaseConnection;
  private logger: Logger;

  constructor(db: DatabaseConnection) {
    this.db = db;
    this.logger = new Logger('MigrationManager');
  }

  async initialize(): Promise<void> {
    // Create migrations table if it doesn't exist
    const createMigrationsTable = `
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    await this.db.query(createMigrationsTable);
    this.logger.info('Migration system initialized');
  }

  async getAppliedMigrations(): Promise<number[]> {
    const result = await this.db.query<{ version: number }>('SELECT version FROM migrations ORDER BY version');
    return result.map(row => row.version);
  }

  async applyMigration(migration: Migration): Promise<void> {
    await this.db.transaction(async (client) => {
      // Apply the migration
      await this.db.query(migration.up);
      
      // Record the migration
      await this.db.query(
        'INSERT INTO migrations (version, name) VALUES (?, ?)',
        [migration.version, migration.name]
      );
      
      this.logger.info(`Applied migration ${migration.version}: ${migration.name}`);
    });
  }

  async rollbackMigration(migration: Migration): Promise<void> {
    if (!migration.down) {
      throw new Error(`Migration ${migration.version} does not support rollback`);
    }

    await this.db.transaction(async (client) => {
      // Rollback the migration
      await this.db.query(migration.down!);
      
      // Remove migration record
      await this.db.query('DELETE FROM migrations WHERE version = ?', [migration.version]);
      
      this.logger.info(`Rolled back migration ${migration.version}: ${migration.name}`);
    });
  }

  async migrate(targetVersion?: number): Promise<void> {
    await this.initialize();
    
    const appliedMigrations = await this.getAppliedMigrations();
    const availableMigrations = this.getAvailableMigrations();
    
    const migrationsToApply = availableMigrations.filter(migration => {
      const shouldApply = !appliedMigrations.includes(migration.version);
      const withinTarget = targetVersion ? migration.version <= targetVersion : true;
      return shouldApply && withinTarget;
    });

    if (migrationsToApply.length === 0) {
      this.logger.info('No migrations to apply');
      return;
    }

    this.logger.info(`Applying ${migrationsToApply.length} migrations`);
    
    for (const migration of migrationsToApply) {
      await this.applyMigration(migration);
    }
    
    this.logger.info('All migrations applied successfully');
  }

  private getAvailableMigrations(): Migration[] {
    // In a real implementation, this would scan a migrations directory
    // For now, we'll return the initial schema migration
    return [
      {
        version: 1,
        name: 'initial_schema',
        up: this.getInitialSchema()
      }
    ];
  }

  private getInitialSchema(): string {
    try {
      // Try to load PostgreSQL schema first, fall back to SQLite
      const schemaPath = join(__dirname, '..', 'schema.sql');
      return readFileSync(schemaPath, 'utf8');
    } catch {
      const sqliteSchemaPath = join(__dirname, '..', 'schema-sqlite.sql');
      return readFileSync(sqliteSchemaPath, 'utf8');
    }
  }
}

// CLI interface for migrations
export async function runMigrations(config: DatabaseConfig): Promise<void> {
  const logger = new Logger('Migration CLI');
  
  try {
    const db = await DatabaseConnectionFactory.create(config);
    const migrationManager = new MigrationManager(db);
    
    await migrationManager.migrate();
    
    logger.info('Migration completed successfully');
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await DatabaseConnectionFactory.close();
  }
}

// Run migrations if this file is executed directly
if (require.main === module) {
  const config: DatabaseConfig = {
    type: process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite',
    database: process.env.DATABASE_URL || 'discord-bot.db',
    ...(process.env.DB_HOST && { host: process.env.DB_HOST }),
    ...(process.env.DB_PORT && { port: parseInt(process.env.DB_PORT) }),
    ...(process.env.DB_USER && { username: process.env.DB_USER }),
    ...(process.env.DB_PASSWORD && { password: process.env.DB_PASSWORD }),
  };

  runMigrations(config);
}