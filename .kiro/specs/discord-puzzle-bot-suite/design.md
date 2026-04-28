# Design Document

## Overview

The Discord Puzzle Bot Suite provides three daily puzzle games (Semantle, Travle, Duotrigordle) through Discord. Each game has two interfaces: slash commands via a Discord bot process, and a web-based Discord Activity (embedded iframe) for richer gameplay. The system uses shared infrastructure for database, authentication, and Discord integration.

## Architecture

```
discord-puzzle-bot-suite/
├── core/                    # Shared infrastructure
│   ├── discord/            # Discord API wrappers (EmbedBuilder, InteractionHandler)
│   ├── storage/            # Database layer (repositories, migrations, schemas)
│   ├── auth/               # Session management, game interfaces
│   └── utils/              # Logger, error handling, validators
├── games/                  # Pure game logic (no Discord dependency)
│   ├── semantle/           # Semantic similarity engine, game state
│   ├── travle/             # Country graph, 0-1 BFS, puzzle generation
│   └── duotrigordle/       # Grid manager, word validation
├── bot/                    # Discord bot processes (one per game)
│   ├── shared/             # BaseBotApplication, BaseCommandRegistry
│   ├── semantle-bot.ts     # Slash commands, daily cron, recap
│   ├── travle-bot.ts       # Slash commands, daily cron, recap
│   └── duotrigordle-bot.ts # Slash commands, daily cron, recap
├── web/                    # Web Activity frontends (one per game)
│   ├── shared/             # Design tokens (styles.md)
│   ├── travle/             # Express server + Leaflet map UI
│   ├── semantle/           # Express server + similarity UI
│   └── duotrigordle/       # Express server + 32-grid UI (TODO)
├── data/                   # Static game data
│   ├── dictionaries/       # Word lists, GloVe vectors, proper noun blacklist
│   ├── geography/          # Country adjacency graph
│   └── schemas/            # Data validation schemas
├── tests/                  # Unit tests organized by module
├── scripts/                # Utility scripts (check puzzles, deploy, etc.)
└── assets/                 # Logos, cover images
```

### Key Architectural Principles

1. **Dual Interface**: Each game works via both slash commands (bot process) and web Activity (Express + iframe)
2. **Game Independence**: Game logic in `games/` has zero Discord dependency — pure algorithms
3. **Shared Infrastructure**: Database, auth, embeds, and base bot class are shared across all 3 games
4. **Per-User Session Isolation**: Discord SDK auth provides real user IDs for Activity sessions
5. **Shared Channel Config**: `/setchannel` saves one channel_id per server, used by all 3 bots

## Dual-Process Architecture

Each game runs as two separate processes:

### Bot Process (`npm run dev:<game>`)
- Connects to Discord gateway via websocket
- Handles slash commands (/play, /guess, /results, /help, /setchannel)
- Runs daily midnight cron: query yesterday's results → purge DB → post recap + new puzzle
- Manages streaks in `server_configs.custom_settings` JSON
- Uses `SessionManager` with in-memory cache + DB persistence

### Web Server Process (`npm run dev:<game>-web`)
- Express server serving static frontend + API endpoints
- Discord SDK auth handshake: authorize → token exchange → authenticate
- API endpoints: `/game/state`, `/game/guess`, `/game/complete`, `/game/discord/token`
- In-memory session map keyed by Discord user ID
- Saves completed games to shared DB for bot's recap
- Daily session cleanup at midnight UTC
- Served via cloudflared tunnel → Discord's `.discordsays.com` proxy

### Data Flow
```
Activity iframe → discordsays.com proxy → cloudflared tunnel → Express server → SQLite DB
                                                                                    ↑
Bot process (cron) → reads completed sessions from DB → posts recap to Discord channel
```

## Components

### Core Components

| Component | Purpose |
|-----------|---------|
| BaseBotApplication | Base class for all 3 bots — login, command registration, deployment |
| BaseCommandRegistry | Slash command registration and routing |
| SessionManager | In-memory + DB session tracking with resumption |
| GameStateRepository | CRUD for game_sessions table |
| ConfigRepository | Server configs, channel_id, streak management |
| EmbedBuilder | Discord embed creation for game UIs and results |
| MigrationManager | Schema migrations with multi-statement SQL and trigger support |

### Travle Components

| Component | Purpose |
|-----------|---------|
| CountryGraph | 196-country adjacency graph, 0-1 BFS, alias resolution |
| TravleGame | Guess evaluation (green/yellow/red), win detection |
| PuzzleGenerator | Deterministic daily puzzles from date hash (3-11 steps) |
| web/travle/server.ts | Express API on port 3002 |
| web/travle/app-game.js | Leaflet map, autocomplete, game UI |
| web/travle/discord-sdk.js | SDK auth wrapper (bundled via Vite) |

### Semantle Components

| Component | Purpose |
|-----------|---------|
| SemanticEngine | GloVe vector loading, cosine similarity, word rankings |
| SemantleGame | Session management, guess processing, hints, thresholds |
| web/semantle/server.ts | Express API on port 3001 |
| web/semantle/app-game.js | Light purple theme UI, similarity bars, hint button |

### Duotrigordle Components (TODO)

| Component | Purpose |
|-----------|---------|
| GridManager | Manage 32 simultaneous Wordle grids |
| WordValidator | 5-letter word validation against Wordle dictionaries |
| GridRenderer | Multi-grid display formatting |
| ProgressTracker | Track completion across all 32 grids |

## Database Schema

SQLite (dev) / PostgreSQL (prod). Key tables:

- **users** — discord_id, username, preferences, statistics
- **game_sessions** — user_id, server_id, game_type, puzzle_date, game_data (JSON), result (JSON), is_complete
- **daily_puzzles** — game_type, puzzle_date, puzzle_data (JSON), solution (JSON)
- **server_configs** — server_id, channel_id, enabled_games, custom_settings (JSON with streaks)
- **migrations** — version tracking for schema evolution

## Discord SDK Auth Flow

Used by all Activity web frontends for per-user session isolation:

1. `discordSdk.ready()` — tell Discord the iframe loaded
2. `discordSdk.commands.authorize()` — get one-time auth code
3. `POST /game/discord/token` — exchange code for access token via Discord OAuth2
4. `discordSdk.commands.authenticate()` — verify token, get user identity
5. Use `user.id` as session key, `guildId` for channel lookup

The SDK bundle is built once via `node web/travle/build-sdk.js` and copied to each game's web folder.

## Daily Recap Flow (Midnight UTC)

All 3 bots follow the same pattern:

1. Query yesterday's completed sessions from DB (`getCompletedSessionsForDate`)
2. Group results by server
3. Generate today's puzzle
4. **Purge**: delete old DB sessions (7 days), clear in-memory cache
5. For each server:
   - Calculate streak (continue if lastDate was day-before-yesterday and someone won)
   - Post recap embed with scores and streak
   - Post new puzzle announcement
6. Channel selection: configured channel_id → system channel → first available

## Testing

68 tests across 4 test files:

- `tests/games/travle/CountryGraph.test.ts` — BFS, 0-1 BFS, aliases, adjacency, path validation
- `tests/games/travle/TravleGame.test.ts` — Guess coloring (Ghana→UAE example), win/loss, invalid guesses, puzzle generation
- `tests/games/semantle/SemanticEngine.test.ts` — Cosine similarity, rankings, hints, vocabulary
- `tests/games/semantle/SemantleGame.test.ts` — Sessions, guesses, win condition, deterministic puzzles, thresholds

Tests use in-memory SQLite (`:memory:`) for isolation.

## Ports

| Service | Port |
|---------|------|
| Travle web | 3002 |
| Semantle web | 3001 |
| Duotrigordle web | 3003 (planned) |

## Data Files

| File | Purpose | Size |
|------|---------|------|
| semantic-vectors.txt | GloVe 6B word vectors | ~330MB |
| target-words.txt | Semantle daily answer pool | 8,075 words |
| proper-nouns-blacklist.txt | Words to exclude from Semantle | 466 words |
| country-adjacency.json | Travle country graph | 196 countries |
| wordle-answers.txt | Duotrigordle daily answer pool | 2,315 words |
| wordle-valid-guesses.txt | Duotrigordle input validation | 12,972 words |
