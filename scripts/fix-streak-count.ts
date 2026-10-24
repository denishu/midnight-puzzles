#!/usr/bin/env npx ts-node
/**
 * One-off manual correction for a streak row's counts, e.g. to repair values
 * inflated by the old "losses counted toward streaks" bug (fixed in
 * updateStreaks). Sets current_count / max_count / current_last_date /
 * max_date on BOTH the server-scope row and (optionally) a specific player's
 * row for a given server+game. Touches ONLY the rows you name.
 *
 * IMPORTANT: writes go through sqlite3 `run()` directly (not the app's shared
 * DatabaseConnection.query, which routes everything through `all()` and does
 * not reliably persist/report UPDATEs). This script is sqlite-only -- it reads
 * the db file path from DATABASE_URL (defaulting to <game>-bot.db).
 *
 * Usage (from project root):
 *   npx ts-node scripts/fix-streak-count.ts \
 *     --game duotrigordle --server 1505076028597338142 \
 *     --current 3 --max 3 --last-date 2026-10-23 [--user <discordId>]
 */

import { config } from 'dotenv';
import sqlite3 from 'sqlite3';

config();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function run(db: sqlite3.Database, sql: string, params: any[]): Promise<number> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (this: sqlite3.RunResult, err: Error | null) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });
}

function all(db: sqlite3.Database, sql: string, params: any[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as any[])));
  });
}

async function main(): Promise<void> {
  const game = arg('--game');
  const server = arg('--server');
  const current = arg('--current');
  const max = arg('--max');
  const lastDate = arg('--last-date');
  const user = arg('--user');

  if (!game || !server || current === undefined || max === undefined || !lastDate) {
    throw new Error('usage: --game <t> --server <id> --current <n> --max <n> --last-date <YYYY-MM-DD> [--user <id>]');
  }
  const cur = parseInt(current, 10);
  const mx = parseInt(max, 10);
  if (Number.isNaN(cur) || Number.isNaN(mx)) throw new Error('--current and --max must be integers');

  const dbPath = process.env.DATABASE_URL || `${game}-bot.db`;
  const db = new sqlite3.Database(dbPath);

  const SELECT =
    `SELECT scope, user_id, current_count, current_last_date, max_count, max_date
     FROM streaks WHERE game_type = ? AND server_id = ?`;

  console.log('db:', dbPath);
  console.log('before:');
  console.table(await all(db, SELECT, [game, server]));

  const serverChanges = await run(
    db,
    `UPDATE streaks SET current_count = ?, max_count = ?, current_last_date = ?, max_date = ?, updated_at = CURRENT_TIMESTAMP
     WHERE scope = 'server' AND server_id = ? AND user_id = '' AND game_type = ?`,
    [cur, mx, lastDate, lastDate, server, game]
  );
  console.log(`server-scope UPDATE changed ${serverChanges} row(s)`);

  if (user) {
    // Diagnose exactly which predicate excludes the row: dump the raw scope
    // value (quoted + length) and progressive match counts.
    const raw = await all(
      db,
      `SELECT scope, '>' || scope || '<' AS scope_q, length(scope) AS scope_len,
              user_id, '>' || user_id || '<' AS uid_q, length(user_id) AS uid_len
       FROM streaks WHERE server_id = ? AND game_type = ? AND current_count IS NOT NULL`,
      [server, game]
    );
    console.log('all rows for this server+game (raw scope/user):');
    console.table(raw);

    const c1 = await all(db, `SELECT COUNT(*) n FROM streaks WHERE server_id=? AND game_type=?`, [server, game]);
    const c2 = await all(db, `SELECT COUNT(*) n FROM streaks WHERE server_id=? AND game_type=? AND user_id=?`, [server, game, user]);
    const c3 = await all(db, `SELECT COUNT(*) n FROM streaks WHERE server_id=? AND game_type=? AND user_id=? AND scope=?`, [server, game, user, 'player']);
    const c4 = await all(db, `SELECT COUNT(*) n FROM streaks WHERE server_id=? AND game_type=? AND user_id=? AND scope LIKE ?`, [server, game, user, '%player%']);
    const c5 = await all(db, `SELECT COUNT(*) n FROM streaks WHERE server_id=? AND game_type=? AND CAST(user_id AS TEXT)=? AND scope='player'`, [server, game, user]);
    const c6 = await all(db, `SELECT COUNT(*) n, typeof(user_id) t FROM streaks WHERE scope='player' AND server_id=? AND game_type=?`, [server, game]);
    console.log(`match server+game: ${c1[0].n} | +user_id: ${c2[0].n} | +scope='player': ${c3[0].n} | LIKE %player%: ${c4[0].n} | CAST user_id TEXT: ${c5[0].n}`);
    console.log(`stored user_id typeof: ${c6[0]?.t}`);

    // Type-agnostic UPDATE: CAST user_id to TEXT so a numerically-stored
    // snowflake (> 2^53, unsafe as a JS/number) still matches a string param.
    const playerChanges = await run(
      db,
      `UPDATE streaks SET current_count = ?, max_count = ?, current_last_date = ?, max_date = ?, updated_at = CURRENT_TIMESTAMP
       WHERE scope = 'player' AND server_id = ? AND CAST(user_id AS TEXT) = ? AND game_type = ?`,
      [cur, mx, lastDate, lastDate, server, user]
    );
    console.log(`player-scope UPDATE changed ${playerChanges} row(s)`);
  }

  console.log('after:');
  console.table(await all(db, SELECT, [game, server]));

  await new Promise<void>((resolve) => db.close(() => resolve()));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('fix-streak-count failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
