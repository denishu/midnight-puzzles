# Discord Puzzle Bot Suite

A collection of three independent Discord bots for daily puzzle games:
- **Semantle Bot**: Semantic word guessing game
- **Travle Bot**: Country pathfinding game  
- **Duotrigordle Bot**: 32 simultaneous Wordle puzzles

Each bot can be deployed independently, allowing servers to choose only the games they want.

## Three Independent Bots

### 🎯 Semantle Bot
- Guess words using semantic similarity
- Get ranked feedback for similar words
- Commands: `/play`, `/guess <word>`, `/results`, `/help`

### 🗺️ Travle Bot  
- Find paths between countries using land borders
- Geography-based puzzle solving
- Commands: `/play`, `/guess <country>`, `/results`, `/help`

### 📝 Duotrigordle Bot
- Solve 32 Wordle puzzles simultaneously
- Ultimate word puzzle challenge
- Commands: `/play`, `/guess <word>`, `/results`, `/help`

## Shared Features

- **Daily Puzzles**: New puzzles every day, consistent for all players
- **Result Sharing**: Share results with spoiler protection  
- **Independent Deployment**: Choose which games your server wants
- **Shared Infrastructure**: All bots can use the same database
- **Statistics**: Privacy-preserving usage analytics

## Project Structure

```
discord-puzzle-bot-suite/
├── core/                    # Shared infrastructure
│   ├── discord/            # Discord API integration
│   ├── storage/            # Data persistence layer
│   ├── auth/               # User session management
│   └── utils/              # Common utilities
├── games/                  # Game-specific modules
│   ├── semantle/           # Semantic word guessing
│   ├── travle/             # Geography pathfinding
│   └── duotrigordle/       # Multi-grid Wordle
├── data/                   # Static game data
│   ├── dictionaries/       # Word lists and semantic vectors
│   ├── geography/          # Country adjacency data
│   └── schemas/            # Data validation schemas
├── bot/                    # Main Discord bot entry point
└── tests/                  # Test suites
```

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your Discord bot tokens for each game you want to deploy
   # You need separate Discord applications for each bot
   ```

3. **Set up database:**
   ```bash
   # For development (SQLite)
   npm run migrate:dev
   
   # For production (PostgreSQL)
   npm run migrate
   ```

4. **Build the project:**
   ```bash
   npm run build
   ```

5. **Deploy commands and start bots:**
   ```bash
   # Deploy slash commands (run once per bot)
   npm run deploy:semantle
   npm run deploy:travle  
   npm run deploy:duotrigordle
   
   # Development (run individual bots)
   npm run dev:semantle
   npm run dev:travle
   npm run dev:duotrigordle
   
   # Production (run individual bots)
   npm run start:semantle
   npm run start:travle
   npm run start:duotrigordle
   ```

## Development

- **Run tests:** `npm test`
- **Watch tests:** `npm run test:watch`
- **Coverage:** `npm run test:coverage`
- **Lint:** `npm run lint`
- **Type check:** `npm run build`

## Testing

The project uses a dual testing approach:

- **Unit Tests**: Specific examples and edge cases using Jest
- **Property-Based Tests**: Universal properties using fast-check
- **Integration Tests**: End-to-end game flows

Property-based tests run 100+ iterations to ensure statistical confidence and are tagged with their corresponding design document properties.

## Database

Supports both SQLite (development) and PostgreSQL (production):

- **SQLite**: Simple file-based database for local development
- **PostgreSQL**: Production-ready with connection pooling and transactions
- **Migrations**: Automatic schema management and updates

## Discord Bot Setup

### Creating Discord Applications

You need to create separate Discord applications for each bot:

1. Go to https://discord.com/developers/applications
2. Create three applications:
   - "Semantle" - Word similarity game
   - "Travle" - Geography pathfinding game  
   - "Duotrigordle" - Multi-Wordle challenge
3. For each application:
   - Go to "Bot" section
   - Create a bot and copy the token
   - Copy the Application ID from "General Information"
4. Add tokens to your `.env` file

### Bot Permissions

Each bot needs these Discord permissions:
- Send Messages
- Use Slash Commands  
- Send Messages in Threads
- Embed Links
- Add Reactions

### Inviting Bots to Servers

Generate invite links for each bot with the required permissions. Server admins can choose which games to add to their servers.

## Deployment Options

### Single Server (All Bots)
Run all three bots on the same server with shared database:
```bash
npm run start:semantle &
npm run start:travle &  
npm run start:duotrigordle &
```

### Separate Deployment
Deploy each bot independently on different servers or containers.

### Docker Support

**All bots with shared database:**
```bash
# Copy environment file and configure tokens
cp .env.example .env
# Edit .env with your bot tokens

# Start all services
docker-compose up -d
```

**Individual bot containers:**
```bash
# Build individual bot images
docker build -f Dockerfile.semantle -t semantle-bot .
docker build -f Dockerfile.travle -t travle-bot .
docker build -f Dockerfile.duotrigordle -t duotrigordle-bot .

# Run individual bots
docker run -d --env-file .env semantle-bot
docker run -d --env-file .env travle-bot
docker run -d --env-file .env duotrigordle-bot
```

## License

MIT License - see LICENSE file for details.