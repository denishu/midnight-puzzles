# Implementation Plan

## Completed

- [x] 1. Project structure and core infrastructure
  - Monorepo with core/, games/, data/, bot/, web/ folders
  - TypeScript, Jest, fast-check configured
  - Database schema (SQLite dev, PostgreSQL prod) with migrations
  - Migration system with multi-statement SQL support and trigger handling

- [x] 2. Core Discord integration layer
  - DiscordClient, InteractionHandler, EmbedBuilder, MessageFormatter
  - BaseBotApplication with command registration and deployment
  - Fixed deployCommands to preserve Activity entry point commands

- [x] 3. Data persistence and storage layer
  - GameStateRepository, DailyPuzzleRepository, UserRepository, ConfigRepository
  - channel_id column on server_configs (migration v2)
  - Streak tracking via custom_settings JSON
  - getCompletedSessionsForDate() for daily recaps

- [x] 4. Shared game infrastructure
  - Game interface, GameSession, SessionManager, GameSessionFactory
  - UserValidator, shared utilities

- [x] 5. Semantle game module
  - SemanticEngine with GloVe vectors (100k words), cosine similarity, word rankings
  - SemantleGame with session management, guess processing, hints, daily puzzles
  - Proper noun blacklist filtering
  - getSimilarityThresholds() for rank 1/10/1000 reference points
  - 8,075 target words, tepid threshold at 16%

- [x] 6. Travle game module
  - CountryGraph with 196 countries, alias resolution, 0-1 BFS weighted pathfinding
  - TravleGame with green/yellow/red guess coloring, win detection
  - PuzzleGenerator with deterministic daily puzzles (3-11 steps)
  - Adjacency fixes: removed Spain↔Morocco, Egypt↔Jordan connections

- [x] 7. Semantle Discord bot
  - Slash commands: /play, /guess, /hint, /results, /help, /reset, /setchannel
  - Daily midnight cron: recap with scores + server streak, then new puzzle
  - Session cleanup (purge before post)
  - Exported class, fixed deploy script

- [x] 8. Travle Discord bot
  - Slash commands: /play, /guess, /results, /help, /reset, /setchannel
  - Daily midnight cron: recap with scores + server streak, then new puzzle
  - Session cleanup (purge before post)
  - Daily puzzle announcement

- [x] 9. Travle web Activity
  - Express server (port 3002) with game API endpoints
  - Discord Embedded App SDK integration for per-user session isolation
  - SDK auth handshake (authorize → token exchange → authenticate)
  - Leaflet map with country highlighting, autocomplete with alias support
  - Auto-post results embed to Discord channel (with username)
  - Game-over reveal with differentiated country/ocean colors
  - Info popup, daily session cleanup at midnight UTC
  - Cache-control headers for API routes
  - discord-sdk.js bundle built via Vite for non-Vite serving

- [x] 10. Semantle web Activity
  - Express server (port 3001) with game state, guess, hint, reset endpoints
  - Discord SDK auth integration (reuses same pattern as Travle)
  - Light purple theme UI with similarity bars (gradient colors by temperature)
  - Latest guess pinned to top with highlight
  - Similarity thresholds display (rank 1/10/1000)
  - Hint button (starts at rank 1000, halves on each use)
  - Auto-post results embed on win only (not on page reload)
  - Info popup with how-to-play and color legend

- [x] 11. Unit tests
  - Travle: CountryGraph (BFS, 0-1 BFS, aliases, adjacency), TravleGame (coloring with Ghana→UAE example, win/loss, invalid guesses), PuzzleGenerator (deterministic, path constraints)
  - Semantle: SemanticEngine (cosine similarity, rankings, hints, vocabulary), SemantleGame (sessions, guesses, win condition, deterministic puzzles, thresholds)
  - 68 tests total, all passing

- [x] 12. Game data and dictionaries
  - GloVe semantic vectors (100k words from 6B model)
  - Country adjacency graph (196 countries)
  - Semantle target words (8,075 words)
  - Wordle answer list (2,315 words) and valid guesses list (12,972 words)
  - Proper noun blacklist
  - Shared UI design tokens (web/shared/styles.md)

## In Progress / Remaining

- [x] 13. Duotrigordle game module
  - Create GridManager for managing 32 simultaneous Wordle grids
  - Build WordValidator for 5-letter word validation using wordle word lists
  - Implement guess evaluation (green/yellow/gray per grid)
  - Track grid completion across 37 guesses
  - Deterministic daily puzzle generation (32 unique target words per day)

- [x] 14. Duotrigordle Discord bot
  - Slash commands: /play (launches Activity), /results, /help, /setchannel
  - No /guess command — 32 grids can't fit in Discord embeds, gameplay is Activity-only
  - Daily midnight cron with recap and streak (same pattern as Travle/Semantle)
  - Session management (read completed games from DB for recaps)

- [x] 15. Duotrigordle web Activity (primary gameplay interface)
  - Express server with game API endpoints
  - Discord SDK auth integration (same pattern)
  - UI: 32-grid display, on-screen keyboard, guess input
  - Auto-post results embed to Discord channel on completion
  - Cloudflare tunnel setup

- [x] 16. Duotrigordle unit tests
  - Grid generation (32 unique words)
  - Guess evaluation (green/yellow/gray logic)
  - Grid completion tracking
  - Win/loss conditions

- [ ] 17. Travle hint feature
  - Add /game/hint endpoint: compute cheapest path with current guesses, return one unguessed country closest to the player's last guess
  - Add 💡 button to Travle UI (same pattern as Semantle)
  - Reveal the hint country's outline on the map (no tooltip, no name — just the shape with a subtle border)
  - Player must still identify the country by its shape

- [ ] 18. Semantle improvements (polish)
  - Precompute similarity rankings per target word (Option 3 hybrid approach)
  - Store vectors in binary Float32Array format for fast loading
  - Expand proper noun blacklist (US states, cities, common names)
  - Filter proper nouns from rankings (not just vocabulary)
  - Consider upgrading to GloVe 840B for better vocabulary coverage

- [ ] 18. Deployment
  - Choose hosting platform for all 3 bots + web servers
  - Docker configuration (Dockerfiles already exist)
  - Production database setup (PostgreSQL)
  - Persistent tunnel or custom domain setup
  - Environment variable management for production

- [ ] 19. Landing page
  - Static webpage at web/landing/ with logos, descriptions, install links
  - Host on GitHub Pages or alongside the bots

- [ ] 20. Final polish
  - Test daily midnight messages end-to-end
  - Clean up dead code (web/travle/main.js — unused Vite entry point)
  - Remove debug logging from production builds
  - Cover image assets for all 3 bots
