# Ops / diagnostic scripts

Operational helpers for the streak-leaderboard feature. Run them from the
**project root** (same CWD the bots run under) so relative paths and env resolve
correctly. They read the bot token(s) + DB config from the environment exactly
like the bots (so they target the production Postgres DB when
`NODE_ENV=production`).

## Key context (read before using)

- **One shared database in prod.** All three bots (semantle, travle,
  duotrigordle) use a single database via `DATABASE_URL`. The per-game
  `*-bot.db` filenames are only local-sqlite defaults and do **not** exist on
  the prod box. A single query sees all three games' rows.
- **Guild install vs user install.** The app can be added to a *server* (guild
  install — the bot is a member) or to a *user* (user install — the user can
  launch the Activity in any server, even ones without the bot). Sessions/
  streaks get created for **both**, but a streak is only ever visible to users
  through embed messages (daily recap + `/streak`), which require the bot to be
  in the guild.
- **Membership is the gate.** As of the streak fixes, streaks are tracked and
  shown **only** for guilds the bot is a current member of. `GET
  /users/@me/guilds` (live) is ground truth for membership; the dev-portal
  "Servers" number (`approximate_guild_count`) is a lagging, approximate stat
  and can be much higher than real current membership.

## Scripts

### `check-streaks.js` (read-only)
Lists server-scope streak rows and flags any with a null/empty `guild_name` /
`icon_hash` (i.e. would render as "A Discord Server" on the leaderboard).
Quick health check of leaderboard metadata.
```
node scripts/check-streaks.js
```

### `backfill-streak-meta.ts` (writes metadata; `--prune` deletes)
Resolves and writes `guild_name`/`icon_hash` for existing streak rows on
demand (same resolver path as the nightly job: gateway cache, then REST fetch).
Default mode is metadata-only and never touches streak counts.

With `--prune`, it also **deletes** all streak rows (both scopes) for guilds the
bot is *confirmed* not a member of (Discord error 10004/50001). Ambiguous
errors never trigger a delete. Use this to clean up streaks accrued via
user-install Activity launches in bot-less guilds.
```
npx ts-node scripts/backfill-streak-meta.ts --game semantle
npx ts-node scripts/backfill-streak-meta.ts --game travle --prune
```

### `audit-guilds.ts` (read-only)
Reconciles the bot's actual current guild membership (`GET /users/@me/guilds`)
against `streaks` + `server_configs`, and also reports the API's
`approximate_guild_count` / `approximate_user_install_count` (the same figures
the dev portal shows). Answers "the portal says N servers — how many are real,
played-in, configured, or idle?" and flags orphan streak rows (should be ~0
after a prune).
```
npx ts-node scripts/audit-guilds.ts --game travle
```

## Related non-ops scripts
- `seed-streaks.ts` — seeds sample streak data for manual leaderboard testing
  (does not target prod unless you pass a real `--server`).
