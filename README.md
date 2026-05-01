# Midnight Puzzles

A suite of three daily puzzle games for Discord, each playable through both slash commands and embedded Discord Activities (web UIs inside Discord).

- **Semantle** — guess the secret word using semantic similarity scores
- **Travle** — connect two countries by hopping through land borders
- **Duotrigordle** — solve 32 Wordle puzzles simultaneously in 37 guesses

## How It Works

Each game runs as two processes:

1. **Discord Bot** — handles slash commands (`/play`, `/results`, `/help`, `/setchannel`), daily midnight recaps with server streaks, and puzzle announcements
2. **Web Server** — serves the Activity UI (embedded in Discord via the Embedded App SDK), handles game logic via API endpoints, authenticates players via Discord OAuth

Players get the same daily puzzle. Completed games are saved to a shared database so the bot can post recaps at midnight UTC.

## The Games

### 🦉 Semantle
Guess the secret word — you get a similarity percentage and ranking instead of letter feedback. Words in the top 1000 most similar show their exact rank. Uses GloVe word vectors (100k words) for cosine similarity calculations.

- Bot: `/play`, `/guess`, `/hint`, `/results`, `/help`, `/setchannel`
- Activity: light purple theme, similarity bars, hint button, auto-post results on win

### 🦊 Travle
Connect two countries through their land borders in as few guesses as possible. Uses 0-1 BFS weighted pathfinding on a 196-country adjacency graph. Guesses are colored green (shortened path), yellow (nearby), or red (far).

- Bot: `/play`, `/guess`, `/results`, `/help`, `/setchannel`
- Activity: Leaflet map with country highlighting, autocomplete, auto-post results

### 🐙 Duotrigordle
32 simultaneous Wordle grids, 37 total guesses. Each guess applies to all grids at once with standard green/yellow/gray feedback. Gameplay is Activity-only — the grids are too large for Discord embeds.

- Bot: `/play`, `/results`, `/help`, `/setchannel` (no `/guess` — Activity only)
- Activity: 4×8 grid layout with letter overlays, QWERTY keyboard with cross-grid letter tracking, early loss detection with give-up option

## Project Structure

```
midnight-puzzles/
├── bot/                     # Discord bot processes (one per game)
│   ├── shared/              # BaseBotApplication, command registry
│   ├── semantle-bot.ts
│   ├── travle-bot.ts
│   └── duotrigordle-bot.ts
├── web/                     # Web Activity frontends (one per game)
│   ├── semantle/            # Express server (port 3001) + UI
│   ├── travle/              # Express server (port 3002) + Leaflet map UI
│   ├── duotrigordle/        # Express server (port 3003) + 32-grid UI
│   ├── landing/             # Static landing page
│   └── shared/              # Design tokens
├── games/                   # Pure game logic (no Discord dependency)
│   ├── semantle/            # SemanticEngine, SemantleGame, SimilarityCalculator
│   ├── travle/              # CountryGraph, TravleGame, PuzzleGenerator
│   └── duotrigordle/        # GridManager, WordValidator, ProgressTracker
├── core/                    # Shared infrastructure
│   ├── discord/             # EmbedBuilder, InteractionHandler, MessageFormatter
│   ├── storage/             # Repositories, migrations, SQLite/PostgreSQL schemas
│   ├── auth/                # SessionManager, GameSessionFactory
│   └── utils/               # Logger, ErrorHandler, Validators
├── data/                    # Static game data
│   ├── dictionaries/        # GloVe vectors, word lists, proper noun blacklist
│   └── geography/           # Country adjacency graph (196 countries)
├── tests/                   # Jest unit tests (30 Duotrigordle + Semantle + Travle)
├── scripts/                 # Utility scripts (deploy, check puzzles, word list tools)
└── assets/                  # Logos and screenshots
```

## Setup

### Prerequisites
- Node.js 18+
- Three Discord applications (one per game) with Bot and Activity enabled

### Install and Configure

```bash
npm install
cp .env.example .env
# Fill in bot tokens, client IDs, and client secrets for each game
```

### Deploy Slash Commands (once per bot)

```bash
npm run deploy:semantle
npm run deploy:travle
npm run deploy:duotrigordle
```

### Run in Development

```bash
# Bots (slash commands + daily cron)
npm run dev:semantle
npm run dev:travle
npm run dev:duotrigordle

# Web Activities
npm run dev:semantle-web     # port 3001
npm run dev:travle-web       # port 3002
npm run dev:duotrigordle-web # port 3003
```

For Activities to work inside Discord, you need a tunnel (e.g., `cloudflared`) pointing to each web server, with the URL mapped in the Discord dev portal under Activities.

### Run Tests

```bash
npm test              # run all tests
npm run test:watch    # watch mode
npm run test:coverage # with coverage
```

## Environment Variables

See `.env.example` for the full list. Each game needs:
- `<GAME>_BOT_TOKEN` — Discord bot token
- `<GAME>_CLIENT_ID` — Discord application/client ID
- `<GAME>_CLIENT_SECRET` — Discord OAuth2 client secret

## Database

SQLite for development (auto-created `.db` files), PostgreSQL for production. One database per game containing all servers and users. The bot and web server for the same game share the same database.

## Daily Flow

At midnight UTC, each bot:
1. Queries yesterday's completed games from the database
2. Posts a recap embed per server with player scores and server streak
3. Announces the new daily puzzle
4. Cleans up old sessions (7 days)

## Tech Stack

TypeScript, Discord.js, Express, SQLite/PostgreSQL, Jest, Leaflet (Travle maps), Discord Embedded App SDK

## License

MIT
