#!/usr/bin/env npx ts-node
/**
 * One-off manual correction for streak counts (repairs values inflated by the
 * old "losses counted toward streaks" bug). Updates BOTH the server-scope row
 * and (with --user) a player's row for a given server+game.
 *
 * Writes by rowid: we first SELECT the target rows' SQLite rowid, then UPDATE
 * `WHERE rowid = ?`. This sidesteps a baffling case where an UPDATE whose
 * WHERE clause provably matched (an identical SELECT returned the row) still
 * reported 0 changes -- matching the physical rowid is unambiguous.
 *
 * sqlite-only; reads the db path from DATABASE_URL (default <game>-bot.db).
 *
 * Usage:
 *   npx ts-node scripts/fix-streak-count.ts --game duotrigordle \
 *     --server 1505076028597338142 --current 3 --max 3 \
 *     --last-date 2026-10-23 [--user <discordId>]
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
    `SELECT rowid, scope, user_id, current_count, current_last_date, max_count, max_date
     FROM streaks WHERE game_type = ? AND server_id = ?`;

  console.log('db:', dbPath);
  console.log('before:');
  console.table(await all(db, SELECT, [game, server]));

  // Collect the rowids to fix: the server row, and (optionally) the player row.
  const rows = await all(db, SELECT, [game, server]);
  const targets: { rowid: number; label: string }[] = [];
  const serverRow = rows.find((r) => r.scope === 'server' && (r.user_id === '' || r.user_id == null));
  if (serverRow) targets.push({ rowid: serverRow.rowid, label: 'server' });
  if (user) {
    const playerRow = rows.find((r) => r.scope === 'player' && String(r.user_id) === user);
    if (playerRow) targets.push({ rowid: playerRow.rowid, label: `player ${user}` });
    else console.log(`WARNING: no player row found for user ${user}`);
  }

  for (const t of targets) {
    const changed = await run(
      db,
      `UPDATE streaks SET current_count = ?, max_count = ?, current_last_date = ?, max_date = ?, updated_at = CURRENT_TIMESTAMP
       WHERE rowid = ?`,
      [cur, mx, lastDate, lastDate, t.rowid]
    );
    console.log(`${t.label} (rowid ${t.rowid}) UPDATE changed ${changed} row(s)`);
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
