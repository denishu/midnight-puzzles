-- Database schema for Discord Puzzle Bot Suite
-- Supports both SQLite and PostgreSQL with minor syntax differences

-- Users table
CREATE TABLE IF NOT EXISTS users (
    discord_id VARCHAR(20) PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    preferences JSONB DEFAULT '{}',
    statistics JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Daily puzzles table
CREATE TABLE IF NOT EXISTS daily_puzzles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_type VARCHAR(20) NOT NULL,
    puzzle_date DATE NOT NULL,
    puzzle_data JSONB NOT NULL,
    solution JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_type, puzzle_date)
);

-- Game sessions table
CREATE TABLE IF NOT EXISTS game_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(20) NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    server_id VARCHAR(20) NOT NULL,
    game_type VARCHAR(20) NOT NULL,
    puzzle_date DATE NOT NULL,
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    is_complete BOOLEAN DEFAULT FALSE,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER NOT NULL,
    game_data JSONB DEFAULT '{}',
    result JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, game_type, puzzle_date)
);

-- Server configurations table
CREATE TABLE IF NOT EXISTS server_configs (
    server_id VARCHAR(20) PRIMARY KEY,
    channel_id VARCHAR(20),
    enabled_games JSONB DEFAULT '["semantle", "travle", "duotrigordle"]',
    custom_settings JSONB DEFAULT '{}',
    custom_word_lists JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Usage statistics table (aggregated, privacy-preserving)
CREATE TABLE IF NOT EXISTS usage_statistics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    game_type VARCHAR(20) NOT NULL,
    server_id VARCHAR(20),
    total_games INTEGER DEFAULT 0,
    completed_games INTEGER DEFAULT 0,
    average_attempts DECIMAL(5,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, game_type, server_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_game_sessions_user_date ON game_sessions(user_id, puzzle_date);
CREATE INDEX IF NOT EXISTS idx_game_sessions_server_date ON game_sessions(server_id, puzzle_date);
CREATE INDEX IF NOT EXISTS idx_daily_puzzles_type_date ON daily_puzzles(game_type, puzzle_date);
CREATE INDEX IF NOT EXISTS idx_usage_statistics_date ON usage_statistics(date, game_type);

-- Update trigger for game_sessions
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_game_sessions_modtime 
    BEFORE UPDATE ON game_sessions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_modified_column();

CREATE TRIGGER update_server_configs_modtime 
    BEFORE UPDATE ON server_configs 
    FOR EACH ROW 
    EXECUTE FUNCTION update_modified_column();