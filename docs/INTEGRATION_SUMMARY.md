# Integration Summary

## Architecture

Each game (Semantle, Travle, Duotrigordle) runs as a standalone Discord bot with its own entry point in `bot/`. They share core infrastructure in `core/`.

## Shared Infrastructure
- `core/storage/` — SQLite/PostgreSQL repositories (users, sessions, puzzles)
- `core/auth/` — Session management, user validation, game interfaces
- `core/discord/` — Embed builder, interaction handling
- `core/utils/` — Logger, date utils, error handling
- `bot/shared/` — Base bot application, command registry, event handlers

## Game Modules
- `games/semantle/` — Word similarity game (SemanticEngine, SemantleGame)
- `games/travle/` — Country path game (CountryGraph, TravleGame, PuzzleGenerator)
- `games/duotrigordle/` — 32 simultaneous Wordles (not yet implemented)

## Running
```bash
npm run dev:semantle   # Start Semantle bot
npm run dev:travle     # Start Travle bot
```

## Scripts
- `scripts/semantle/` — Deploy, check-word, generate-word-list, reset-db
- `scripts/travle/` — Deploy, find-path, play-test, test-puzzle, verify-graph
