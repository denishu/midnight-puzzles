# Midnight Puzzles — Project Context

3 Discord bots + 3 web Activities over a shared `core/` layer.
Live on Hetzner at playmidnightpuzzles.com.
Games: Semantle, Travle, Duotrigordle.
Stack: TypeScript, Express, SQLite (dev) / PostgreSQL (prod), Jest.

## Background
These are existing browser puzzle games ported to Discord (bots + Activities),
inspired by the popularity of the Wordle Discord bot/Activity. None of the source
games expose a public API, so all game logic was re-implemented from scratch and all
game data was sourced manually (word dictionaries, country adjacency graph, GloVe
vectors, etc.).

## Future games (planned)
- **Betweenle** (by Nebula Bytes): daily 5-letter word game based on ALPHABETICAL
  order, not meaning. Each guess is marked BEFORE ⬅️ or AFTER ➡️ the secret word in
  dictionary order; player binary-searches to the answer. Can likely reuse an
  existing 5-letter word list (e.g. from Duotrigordle). No public API.
- **Factorle**: an original numbers game designed by the project owner. Rules TBD —
  do not assume mechanics until specified.

## Where things live
- Roadmap / open work: `IMPROVEMENTS.md` (prioritized P0/P1/P2).
- Feature spec: `.kiro/specs/discord-puzzle-bot-suite/` (requirements, design, tasks).
- Shared logic: `core/` (e.g. `core/utils/Logger.ts`, DB factory).
- Web servers: `web/*/server.ts` (currently ~90% duplicated).
- Bots: mirror `BaseBotApplication` / `BaseCommandRegistry` / `BaseEventHandlers`.

## Known top issues (see IMPROVEMENTS.md for detail)
- P0: Server-side identity is unverified (IDOR). Endpoints trust `req.query.id`;
  Discord auth happens client-side but is never verified server-side.
- P0: No rate limiting on the Express game API.
- P0: No fail-fast config/env validation at boot.
- P1: `web/*/server.ts` duplication → extract a shared `BaseGameServer`.
