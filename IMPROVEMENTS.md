# Improvements

A running list of ways to improve the project. Grounded in the current codebase
(3 Discord bots + 3 web Activities over a shared `core/` layer, live on Hetzner
at playmidnightpuzzles.com).

Priority: P0 = do first, P1 = high value, P2 = polish.

---

## P0 — Security / correctness

### 1. Server-side identity verification (auth IDOR) — ✅ DONE
**Fixed** in `core/auth/ActivityAuth.ts` + all three `web/*/server.ts`:
`/game/discord/token` now verifies the OAuth token against Discord's
`/users/@me` and issues a signed session JWT; `authMiddleware` attaches the
verified id and every endpoint resolves identity via `resolveUserId(req)`
instead of `req.query.id`. A forged `?id=` (with no valid token) now resolves
to anonymous `default`. Verified by unit tests (`ActivityAuth.test.ts`) and an
HTTP integration test reproducing the IDOR (`AuthTrustBoundary.integration.test.ts`).
Requires `ACTIVITY_JWT_SECRET` in prod (falls back to a `*_CLIENT_SECRET`).

<details>
<summary>Original problem (for the record)</summary>

**Problem.** The Discord Embedded App SDK genuinely authenticates the user *in the
browser*, but that result never reaches the server as a verified credential.
In `web/*/server.ts`:
- `POST /game/discord/token` exchanges the OAuth `code` for an `access_token` and
  returns it to the client. The server never calls Discord with that token.
- Every other endpoint (`/game/state`, `/game/guess`, `/game/hint`) reads the user
  ID from `req.query.id` — a plain query param the client supplies.

So the server trusts the client to report its own identity. The endpoints are
public HTTP, so anyone can call them directly (outside the Activity iframe) with an
arbitrary `?id=`, bypassing Discord entirely and reading/mutating another user's
session. This is an IDOR / confused-deputy bug: authentication happens client-side,
server enforces nothing.

Repro (works today):
`curl "https://playmidnightpuzzles.com/game/state?id=<any_discord_id>"`

**Fix.**
1. In `/game/discord/token`, after obtaining the `access_token`, call
   `GET https://discord.com/api/users/@me` server-side to get the real user ID.
2. Issue our own signed token (JWT or signed session cookie) with that verified ID.
3. Read the user ID from the verified token, not `req.query.id`.

Same login UX for real players; forged `?id=` becomes inert. Applies to all three
servers — cheaper to do after #4 (BaseGameServer) so it's a one-place change.

**Severity note.** Hobby puzzle bot: blast radius is tampering with another player's
daily session or spoofing a results post — no PII/financial exposure. Not an
emergency, but a real, textbook authz bug.
</details>

### 2. Rate limiting on the web API — ✅ DONE
Added `core/auth/RateLimit.ts`: a fixed-window limiter (same algorithm as
`UserValidator`) as Express middleware, keyed per verified `req.userId` with an
IP fallback for anonymous/local play. Wired into all three servers after
`authMiddleware`: a general cap on `/game` plus a tighter cap on the expensive
guess/hint routes. Returns HTTP 429 with `Retry-After` + `X-RateLimit-*`
headers. Counter lives behind a `RateLimitStore` interface (in-memory now; swap
to Redis for multi-instance — see the scaling note in the module). Servers set
`trust proxy` so `req.ip` is accurate. Covered by `RateLimit.test.ts`.

### 3. Fail-fast config + input validation — ✅ DONE
- `core/utils/ConfigValidator.ts` (`requireEnv` / `validateConfigOrExit`): each
  web server asserts its required env vars (`<GAME>_CLIENT_ID`,
  `<GAME>_CLIENT_SECRET`, `<GAME>_BOT_TOKEN`) at boot and exits with a clear
  message listing all missing ones, before binding the port.
- `core/utils/InputValidator.ts` (`validateGuessText` / `validateWordleGuess`):
  guesses are length/charset-validated at the HTTP boundary before reaching the
  engine — free-text (Semantle/Travle) allows Unicode letters + name
  punctuation up to 60 chars; Duotrigordle requires exactly 5 letters.
- Covered by `ConfigValidator.test.ts` and `InputValidator.test.ts`.

---

## P1 — Architecture / maintainability

### 4. Extract a shared `BaseGameServer` — ✅ DONE
Extracted `core/web/BaseGameServer.ts`: owns the previously ~90%-duplicated
scaffolding — Express setup, DB init + migrate + shared context (repos +
`SessionManager`), the `userId->sessionId` cache with daily cleanup, the `/game`
middleware stack (no-cache headers, `authMiddleware`, config-driven rate limits),
the Discord OAuth token exchange, the `/game/complete` results post, config
fail-fast, and static serving. Each server is now a `GameServerConfig` + an
`init` hook (builds its game object from the shared context, returns session
hooks) + a `registerRoutes` hook for its gameplay endpoints. `start()` is split
into `build()` (configures the app, returns it — no port bind / no timer, for
tests) and `listen()` (build + cleanup timer + bind). Covered by
`tests/core/web/BaseGameServer.integration.test.ts` (supertest).

<details>
<summary>Original problem (for the record)</summary>

The three `web/*/server.ts` files are ~90% duplicated (DB init + migrate, in-memory
`userSessions` map, `scheduleDailyCleanup`, token exchange, `/game/complete` Discord
post, static serving). Mirror what was already done on the bot side
(`BaseBotApplication` / `BaseCommandRegistry` / `BaseEventHandlers`). Doing this
first makes #1 and #2 one-place changes.
</details>

### 5. Session state: document/limit the in-memory map
`userSessions: Map<string,string>` is per-process and lost on restart/deploy (the DB
session survives; the cache doesn't) and wouldn't be shared across instances. Fine
for one Hetzner box — but note the limitation in code + README, and sketch the
DB/Redis path for horizontal scale.

### 6. `DatabaseConnectionFactory` singleton footgun — ✅ DONE
`create()` used to silently return the cached instance and ignore its `config`
on every call after the first, so a request for a different database would
quietly get the wrong connection. It now records the config used to build the
instance and, on a later call with a *different* config (type/database/host/
port/username), throws a clear error instead of returning the wrong one; a
matching config still returns the shared instance as intended. `close()` clears
the stored config so switching databases (e.g. tests → in-memory) works after an
explicit close. Covered by `tests/core/storage/DatabaseConnection.test.ts`.

---

## P1 — Observability & ops

### 7. Route web servers through the `Logger` — ✅ DONE
`BaseGameServer` and the three server entrypoints now use the winston-backed
`Logger` (context per game, e.g. `travle-web`) instead of `console.*`.
Per-request noise (`[state]`/`[guess]`/`[hint]`/`[give-up]`/`[reset]`) is at
`debug`, so the default `LOG_LEVEL=info` silences it in production (this also
covers task #20's "remove debug logging from production" — set `LOG_LEVEL=debug`
to bring it back). Lifecycle/ops (startup, cleanup, shutdown, results post) is
`info`; failures are `error` with structured metadata. CLI `scripts/*` and
browser frontend `web/*/*.js` intentionally keep `console` (different runtime).

### 8. Health check + graceful shutdown — ✅ DONE
`BaseGameServer` serves `GET /health` (DB ping via `SELECT 1`, returns
`200 {status:'ok'}` or `503 {status:'error'}`), registered outside the `/game`
middleware so it is exempt from auth + rate limiting + no-cache. On
`SIGTERM`/`SIGINT` it drains gracefully: stop accepting new connections, cancel
the cleanup timer, close the DB pool via `DatabaseConnectionFactory.close()`,
then exit. The drain is a testable `shutdown()` method (no `process.exit`);
`/health` + the drain are covered in `BaseGameServer.integration.test.ts`, and
the live signal path was verified manually.

---

## P2 — Quality / polish

### 9. Reduce `no-explicit-any` warnings (112)
Concentrated in the storage repos and server response shapes. Type the API
request/response bodies (a shared `types.ts` between server and `app-game.js` is
ideal). Flip the ESLint rule to `error` once close to zero.

### 10. Finish task #20 items + ts-jest deprecation — ✅ DONE
- ✅ Moved `jest.config.js` `globals['ts-jest']` into `transform`
  (`['ts-jest', { tsconfig: 'tsconfig.json' }]`) — the deprecation warning is
  gone from test runs.
- ✅ Dead code removed (`web/travle/main.js` no longer exists).
- ✅ "Remove debug logging from production" — handled by #7 (`LOG_LEVEL`).
- ✅ Cover image assets — bots have live Discord avatars; item retired.
- ✅ End-to-end midnight-recap test — `tests/bot/DailyRecap.e2e.test.ts` drives
  the real repositories over in-memory SQLite: yesterday's completed sessions
  are pulled + grouped by server, the streak state machine (start / continue /
  restart-after-gap / reset-on-loss) is exercised, and `deleteOldSessions(7)`
  purges >7-day-old rows while keeping recent ones. (The Discord posting itself
  is not unit-tested — it's a thin `channel.send` loop not worth mocking.)

> Finding surfaced by the test: `ConfigRepository.updateStreak` merges into
> `custom_settings` via an `UPDATE` (not an upsert), so a server with no
> `server_configs` row silently drops the streak write. Harmless in practice
> (servers get a row from `/setchannel`), but a latent gap — a server that never
> ran `/setchannel` wouldn't accumulate streaks. Candidate follow-up.

### 11. Act on the Semantle data-quality audit
`TargetWordQuality.test.ts` flags ~16.5% (331/2001) plural-looking answers. Prune
them to close the loop on a test that already exists.

---

_Notes / new ideas (add below as you think of them):_
