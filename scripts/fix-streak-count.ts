#!/usr/bin/env npx ts-node
/**
 * One-off manual correction for a streak row's counts, e.g. to repair values
 * inflated by the old "losses counted toward streaks" bug (fixed in
 * updateStreaks). Sets current_count / max_count / current_last_date /
 * max_date on BOTH the server-scope row and (optionally) a specific player's
 * row for a given server+game. Touches ONLY the rows you name.
 *
 * Usage (from project root):
 *   npx ts-node scripts/fix-streak-count.ts \
 *     --game duotrigordle --server 1505076028597338142 \
 *     --current 3 --max 3 --last-date 2026-10-23 [--user <discordId>]
 *
 * --last-date is used for BOTH current_last_date and max_date (the day the
 * corrected run ends). --user also corrects that player's row to the same
 * values. Reads the DB exactly like the bots (DATABASE_URL / NODE_ENV).
 */

import { config } from 'dotenv';
import { DatabaseConnectionFactory, DatabaseConfig } from '../core/storage/DatabaseConnection';
import { Logger } from '../core/utils/Logger';

config();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const log = new Logger('fix-streak-count');
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

  const dbConfig: DatabaseConfig = {
    type: (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite') as 'sqlite' | 'postgresql',
    database: process.env.DATABASE_URL || `${game}-bot.db`,
    ...(process.env.DB_HOST && { host: process.env.DB_HOST }),
    ...(process.env.DB_PORT && { port: parseInt(process.env.DB_PORT) }),
    ...(process.env.DB_USER && { username: process.env.DB_USER }),
    ...(process.env.DB_PASSWORD && { password: process.env.DB_PASSWORD }),
  };
  const db = await DatabaseConnectionFactory.create(dbConfig);

  async function show(label: string): Promise<void> {
    const rows = await db.query<any>(
      `SELECT scope, user_id, current_count, current_last_date, max_count, max_date
       FROM streaks WHERE game_type = ? AND server_id = ?`,
      [game, server]
    );
    log.info(label);
    // eslint-disable-next-line no-console
    console.table(rows);
  }

  await show('before:');

  // Server scope (user_id = '').
  await db.query(
    `UPDATE streaks SET current_count = ?, max_count = ?, current_last_date = ?, max_date = ?, updated_at = CURRENT_TIMESTAMP
     WHERE scope = 'server' AND server_id = ? AND user_id = '' AND game_type = ?`,
    [cur, mx, lastDate, lastDate, server, game]
  );
  log.info(`server-scope row set to current=${cur}, max=${mx}, last=${lastDate}`);

  if (user) {
    // Diagnose match before updating: list player rows and compare ids exactly.
    const playerRows = await db.query<any>(
      `SELECT user_id, length(user_id) AS len FROM streaks
       WHERE scope = 'player' AND server_id = ? AND game_type = ?`,
      [server, game]
    );
    log.info(`player rows for this server+game: ${playerRows.length}`);
    for (const r of playerRows) {
      log.info(`  stored user_id="${r.user_id}" (len ${r.len}) vs passed="${user}" (len ${user.length}) -> ${r.user_id === user ? 'MATCH' : 'NO MATCH'}`);
    }

    const res: any = await db.query(
      `UPDATE streaks SET current_count = ?, max_count = ?, current_last_date = ?, max_date = ?, updated_at = CURRENT_TIMESTAMP
       WHERE scope = 'player' AND server_id = ? AND user_id = ? AND game_type = ?`,
      [cur, mx, lastDate, lastDate, server, user]
    );
    const changes = res?.changes ?? res?.rowCount ?? (Array.isArray(res) ? res.length : 'unknown');
    log.info(`player-scope UPDATE affected rows: ${changes}`);
  }

  await show('after:');
  await DatabaseConnectionFactory.close();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('fix-streak-count failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
