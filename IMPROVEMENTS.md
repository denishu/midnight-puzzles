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

### 4. Extract a shared `BaseGameServer`
The three `web/*/server.ts` files are ~90% duplicated (DB init + migrate, in-memory
`userSessions` map, `scheduleDailyCleanup`, token exchange, `/game/complete` Discord
post, static serving). Mirror what was already done on the bot side
(`BaseBotApplication` / `BaseCommandRegistry` / `BaseEventHandlers`). Doing this
first makes #1 and #2 one-place changes.

### 5. Session state: document/limit the in-memory map
`userSessions: Map<string,string>` is per-process and lost on restart/deploy (the DB
session survives; the cache doesn't) and wouldn't be shared across instances. Fine
for one Hetzner box — but note the limitation in code + README, and sketch the
DB/Redis path for horizontal scale.

### 6. `DatabaseConnectionFactory` singleton footgun
`create()` ignores its `config` after the first call and returns the cached instance.
Two different DB configs would silently get the wrong one. Document or fix.

---

## P1 — Observability & ops

### 7. Route web servers through the `Logger`
Servers use `console.log('[session]...')` while a winston `Logger`
(`core/utils/Logger.ts`) exists and is used elsewhere. Structured logging with levels
also cleanly solves task #20's "remove debug logging from production" via `LOG_LEVEL`.

### 8. Health check + graceful shutdown
No `/health` endpoint and no SIGTERM handler. Add both; wire
`DatabaseConnectionFactory.close()` into `process.on('SIGTERM')` to drain/close the
pool.

---

## P2 — Quality / polish

### 9. Reduce `no-explicit-any` warnings (112)
Concentrated in the storage repos and server response shapes. Type the API
request/response bodies (a shared `types.ts` between server and `app-game.js` is
ideal). Flip the ESLint rule to `error` once close to zero.

### 10. Finish task #20 items + ts-jest deprecation
- Move `jest.config.js` `globals['ts-jest']` into `transform`.
- Remove dead code (`web/travle/main.js`).
- Cover image assets; end-to-end midnight-message test.

### 11. Act on the Semantle data-quality audit
`TargetWordQuality.test.ts` flags ~16.5% (331/2001) plural-looking answers. Prune
them to close the loop on a test that already exists.

---

_Notes / new ideas (add below as you think of them):_
