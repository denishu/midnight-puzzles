-- SQLite-specific schema for Discord Puzzle Bot Suite
-- Adapted from PostgreSQL schema with SQLite syntax

-- Users table
CREATE TABLE IF NOT EXISTS users (
    discord_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    preferences TEXT DEFAULT '{}',
    statistics TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Daily puzzles table
CREATE TABLE IF NOT EXISTS daily_puzzles (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    game_type TEXT NOT NULL,
    puzzle_date DATE NOT NULL,
    puzzle_data TEXT NOT NULL,
    solution TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_type, puzzle_date)
);

-- Game sessions table
CREATE TABLE IF NOT EXISTS game_sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    server_id TEXT NOT NULL,
    game_type TEXT NOT NULL,
    puzzle_date DATE NOT NULL,
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME,
    is_complete BOOLEAN DEFAULT FALSE,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER NOT NULL,
    game_data TEXT DEFAULT '{}',
    result TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, game_type, puzzle_date)
);

-- Server configurations table
CREATE TABLE IF NOT EXISTS server_configs (
    server_id TEXT PRIMARY KEY,
    enabled_games TEXT DEFAULT '["semantle", "travle", "duotrigordle"]',
    custom_settings TEXT DEFAULT '{}',
    custom_word_lists TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Usage statistics table (aggregated, privacy-preserving)
CREATE TABLE IF NOT EXISTS usage_statistics (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    date DATE NOT NULL,
    game_type TEXT NOT NULL,
    server_id TEXT,
    total_games INTEGER DEFAULT 0,
    completed_games INTEGER DEFAULT 0,
    average_attempts REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, game_type, server_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_game_sessions_user_date ON game_sessions(user_id, puzzle_date);
CREATE INDEX IF NOT EXISTS idx_game_sessions_server_date ON game_sessions(server_id, puzzle_date);
CREATE INDEX IF NOT EXISTS idx_daily_puzzles_type_date ON daily_puzzles(game_type, puzzle_date);
CREATE INDEX IF NOT EXISTS idx_usage_statistics_date ON usage_statistics(date, game_type);

-- Trigger for updating modified timestamp
CREATE TRIGGER IF NOT EXISTS update_game_sessions_modtime 
    AFTER UPDATE ON game_sessions
    FOR EACH ROW
    BEGIN
        UPDATE game_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE TRIGGER IF NOT EXISTS update_server_configs_modtime 
    AFTER UPDATE ON server_configs
    FOR EACH ROW
    BEGIN
        UPDATE server_configs SET updated_at = CURRENT_TIMESTAMP WHERE server_id = NEW.server_id;
    END;