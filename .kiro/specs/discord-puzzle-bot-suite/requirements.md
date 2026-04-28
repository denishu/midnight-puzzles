# Requirements Document

## Introduction

A Discord bot suite that provides three daily puzzle games: Semantle (semantic word guessing), Travle (country path finding), and Duotrigordle (32 simultaneous Wordles). Each game runs as a standalone Discord bot with slash commands AND a web-based Discord Activity (embedded iframe) for richer gameplay. Users can play through either interface, track progress, and share results.

## Glossary

- **Discord_Bot_Suite**: The complete system providing three puzzle games through Discord
- **Discord_Activity**: A web app embedded in Discord's iframe via the Embedded App SDK
- **Semantle_Game**: A word guessing game using semantic similarity rankings
- **Travle_Game**: A geography game requiring players to find country paths between two endpoints
- **Duotrigordle_Game**: A word puzzle game with 32 simultaneous Wordle grids
- **Daily_Puzzle**: A puzzle instance that changes once per day and is consistent for all players
- **Game_Session**: An individual player's attempt at a daily puzzle
- **Semantic_Dictionary**: GloVe word vectors for calculating semantic similarity
- **Country_Adjacency_Graph**: A data structure representing which countries share land borders
- **Word_Dictionary**: Wordle answer list (2,315 words) and valid guesses list (12,972 words)
- **Discord_Interaction**: Slash commands used to interact with the bot
- **Game_State**: The current progress of a player's game session
- **Result_Sharing**: Auto-posting game results as Discord embeds on completion
- **Daily_Recap**: Midnight message showing yesterday's results, server streak, and new puzzle
- **Server_Streak**: Consecutive days where at least one server member completed the puzzle

## Requirements

### Requirement 1: Game Initiation and Session Management

**User Story:** As a Discord server member, I want to start daily puzzle games through bot commands or Activities, so that I can play engaging word and geography games with my community.

#### Acceptance Criteria

1. WHEN a user types a game command or launches an Activity, THE bot SHALL initiate the corresponding Daily_Puzzle for that user
2. WHEN a Daily_Puzzle is requested, THE bot SHALL check if the user has already started today's puzzle and resume their Game_Session
3. WHEN multiple users request the same Daily_Puzzle, THE bot SHALL provide identical puzzle content to ensure fair competition
4. WHERE a user has completed today's puzzle, THE bot SHALL display their results and prevent additional attempts
5. WHEN a game is played via Activity, THE bot SHALL use Discord SDK authentication to identify users and isolate sessions

### Requirement 2: Semantle Gameplay

**User Story:** As a Semantle player, I want to guess words and receive semantic similarity feedback, so that I can deduce the target word through logical reasoning.

#### Acceptance Criteria

1. WHEN a user submits a word guess, THE Semantle_Game SHALL calculate cosine similarity using GloVe word vectors
2. WHEN the guessed word ranks in the top 1000 most similar words, THE Semantle_Game SHALL display the exact ranking number with color coding (hot/warm/ranked)
3. WHEN the guessed word is not in the top 1000, THE Semantle_Game SHALL respond with "cold" (<16% similarity) or "tepid" (≥16% similarity)
4. WHEN the user guesses the exact target word, THE Semantle_Game SHALL declare victory and auto-post results to Discord
5. WHEN a guess is made, THE Semantle_Game SHALL maintain a sorted history of all guesses with their rankings and similarity scores
6. WHEN the game starts, THE Semantle_Game SHALL display similarity thresholds for rank 1, 10, and 1000
7. WHEN a hint is requested, THE Semantle_Game SHALL provide a word at approximately half the user's best rank (starting at rank 1000)

### Requirement 3: Travle Gameplay

**User Story:** As a Travle player, I want to find country paths between two endpoints, so that I can test my geographical knowledge through strategic pathfinding.

#### Acceptance Criteria

1. WHEN a Travle_Game starts, THE bot SHALL present two countries with a shortest path of 3-11 steps
2. WHEN a user guesses a country, THE Travle_Game SHALL evaluate it using 0-1 BFS weighted pathfinding
3. WHEN a guess reduces the path cost, THE Travle_Game SHALL color it green
4. WHEN a guess is nearby but doesn't reduce cost, THE Travle_Game SHALL color it yellow (cost through guess ≤ cost_before + 1)
5. WHEN a guess is far from any useful path, THE Travle_Game SHALL color it red
6. WHEN the path cost reaches 0, THE Travle_Game SHALL declare victory and show the winning chain
7. WHEN attempts are exhausted, THE Travle_Game SHALL reveal the optimal solution path
8. WHEN playing via Activity, THE Travle_Game SHALL display an interactive Leaflet map with country highlighting

### Requirement 4: Duotrigordle Gameplay

**User Story:** As a Duotrigordle player, I want to solve 32 Wordle puzzles simultaneously, so that I can challenge myself with an extreme word puzzle variant.

#### Acceptance Criteria

1. WHEN a Duotrigordle_Game starts, THE bot SHALL generate 32 unique 5-letter target words from the Wordle answer list
2. WHEN a user submits a 5-letter word guess, THE Duotrigordle_Game SHALL apply the guess to all 32 grids simultaneously
3. WHEN a guess is processed, THE Duotrigordle_Game SHALL provide green/yellow/gray feedback for each letter position across all 32 grids
4. WHEN a target word is correctly guessed, THE Duotrigordle_Game SHALL mark that grid as completed
5. WHEN all 32 words are guessed within 37 attempts, THE Duotrigordle_Game SHALL declare victory
6. WHEN 37 attempts are used without completing all grids, THE Duotrigordle_Game SHALL reveal remaining target words

### Requirement 5: Result Sharing and Daily Recaps

**User Story:** As a puzzle game player, I want my results shared automatically and see daily recaps, so that I can compare performance with my community.

#### Acceptance Criteria

1. WHEN a game is completed (win or loss), THE bot SHALL auto-post a Discord embed with the player's username, score, and game-specific details
2. WHEN results are posted for Travle, THE embed SHALL include colored squares (🟩🟨🟥) in guess order and a score relative to optimal path
3. WHEN results are posted for Semantle, THE embed SHALL include guess count and best rank achieved
4. WHEN midnight UTC arrives, THE bot SHALL post a recap of yesterday's results per server with all players' scores
5. WHEN posting a recap, THE bot SHALL update and display the server streak (consecutive days with at least one winner)
6. WHEN posting a recap, THE bot SHALL follow it with the new daily puzzle announcement
7. WHEN a /setchannel command is used by an admin, THE bot SHALL save that channel for all daily messages and result posts

### Requirement 6: Server Configuration

**User Story:** As a server administrator, I want to configure where bot messages go, so that I can keep my server organized.

#### Acceptance Criteria

1. WHEN /setchannel is used, THE bot SHALL save the channel ID in server_configs (shared across all 3 bots)
2. WHEN posting daily messages, THE bot SHALL use the configured channel, falling back to system channel
3. WHEN posting results from an Activity, THE bot SHALL look up the configured channel via the guild ID from the SDK
4. WHEN the bot lacks permission to post in the configured channel, THE bot SHALL log the error clearly

### Requirement 7: Technical Infrastructure

**User Story:** As a system operator, I want reliable data management and dual-interface support, so that the bots work consistently via both slash commands and Activities.

#### Acceptance Criteria

1. WHEN running as an Activity, THE web server SHALL authenticate users via Discord Embedded App SDK (authorize → token exchange → authenticate)
2. WHEN storing game data, THE bot SHALL use SQLite for development and PostgreSQL for production
3. WHEN the database schema changes, THE migration system SHALL handle multi-statement SQL and trigger blocks correctly
4. WHEN sessions need cleanup, THE web server SHALL purge in-memory sessions daily at midnight UTC
5. WHEN the Activity web server saves completed games, THE data SHALL be written to the shared database so the bot process can read it for recaps
