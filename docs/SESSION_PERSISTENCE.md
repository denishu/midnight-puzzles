# Session Persistence

## Overview

Each game enforces **one puzzle per player per day**, regardless of where they play (server Activity, DM Activity, slash commands). Game progress is persisted to the database on every guess, enabling cross-context resumption and preventing replays.

## How It Works

### Database Schema

The `game_sessions` table stores one row per user per game per day:

```sql
UNIQUE(user_id, game_type, puzzle_date)
```

The `game_data` JSONB column holds the full game state needed to resume a session.

### Per-Game Storage

**Semantle** — `game_data` contains:
```json
{
  "targetWord": "example",
  "guesses": [{"word": "happy", "similarity": 0.42, "rank": 312}, ...],
  "bestRank": 12,
  "foundRanks": [312, 150, 12]
}
```

**Travle** — `game_data` contains the full `TravleGameState`:
```json
{
  "puzzle": {"start": "france", "end": "japan", "shortestPathLength": 4, ...},
  "guesses": [{"country": "germany", "status": "green"}, ...],
  "guessesRemaining": 5,
  "isComplete": false,
  "isWin": false
}
```

**Duotrigordle** — `game_data` contains just the guess words:
```json
{
  "guesses": ["crane", "sloth", "plumb", ...],
  "gridsCompleted": 28,
  "guessesUsed": 15,
  "gaveUp": false
}
```

Duotrigordle doesn't store per-grid feedback because it's deterministic — given the date (which determines the 32 target words) and the list of guesses, the full grid state is reconstructed by replaying guesses through `GridManager.applyGuess()`.

### Session Resolution Flow

When a player starts a game (via Activity or slash command):

1. Check in-memory cache (fast path for same-process, same-session)
2. If cache miss, query DB for `(user_id, game_type, today's date)`
3. If DB has a session:
   - **Semantle/Travle**: Load the stored state directly
   - **Duotrigordle**: Replay stored guesses through GridManager to reconstruct all 32 grids
4. If no DB session exists, create a fresh game

### Save Triggers

- **Every guess** saves the current state to the DB (all three games)
- **Game completion** additionally marks `is_complete = TRUE` and writes the `result` column
- The unique constraint prevents duplicate rows; existing rows are updated via upsert logic

### Cross-Context Scenarios

| Scenario | Behavior |
|----------|----------|
| Play in Server A, open Activity in DM | Resumes from where you left off |
| Complete in Activity, use `/results` in Server B | Shows your results |
| Complete in Activity, use `/play` in DM | Shows "already solved" message |
| Server process restarts mid-game | Resumes from DB on next request |

### Bot Slash Commands

The bot processes (`bot/*.ts`) maintain their own in-memory caches for performance. When the cache misses (e.g., player used the Activity instead of slash commands), the bot falls back to the DB:

- `/play` — Loads or creates session from DB, shows current state
- `/guess` — Loads session from DB if not cached, processes guess
- `/results` — Falls back to DB if not in cache, shows completed game
- `/hint` — Falls back to DB if not in cache

## Cleanup

- In-memory caches are cleared at midnight UTC (daily puzzle rollover)
- DB sessions older than 7 days are deleted by the midnight cron job
- The `puzzle_date` column ensures old sessions don't interfere with new puzzles
