#!/usr/bin/env npx ts-node
/**
 * Read-only streak diagnosis for a single server+game.
 *
 * Prints the stored streak rows (server + player scopes) next to the DISTINCT
 * completed puzzle-dates from game_sessions, each annotated with its derived
 * puzzle NUMBER (UTC date -> number, epoch 2026-10-01 = #1). Lets you see at a
 * glance whether current_count matches the actual run of consecutive completed
 * days, and exactly which day is phantom/missing if it doesn't.
 *
 * Usage (from project root):
 *   npx ts-node scripts/diagnose-streak.ts --game duotrigordle --server 1505076028597338142
 *
 * Reads the DB exactly like the bots (DATABASE_URL / NODE_ENV). Does not write.
 */

import { config } from 'dotenv';
import { DatabaseConnectionFactory, DatabaseConfig } from '../core/storage/DatabaseConnection';
import { puzzleNumber } from '../core/utils/puzzleNumber';
import { Logger } from '../core/utils/Logger';

config();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const log = new Logger('diagnose-streak');
  const game = arg('--game');
  const server = arg('--server');
  if (!game || !server) {
    throw new Error('usage: --game <type> --server <guildId>');
  }

  const dbConfig: DatabaseConfig = {
    type: (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite') as 'sqlite' | 'postgresql',
    database: process.env.DATABASE_URL || `${game}-bot.db`,
    ...(process.env.DB_HOST && { host: process.env.DB_HOST }),
    ...(process.env.DB_PORT && { port: parseInt(process.env.DB_PORT) }),
    ...(process.env.DB_USER && { username: process.env.DB_USER }),
    ...(process.env.DB_PASSWORD && { password: process.env.DB_PASSWORD }),
  };
  const db = await DatabaseConnectionFactory.create(dbConfig);

  // --- Streak rows (both scopes) for this server+game ---
  const streaks = await db.query<any>(
    `SELECT scope, user_id, current_count, current_last_date, max_count, max_date
     FROM streaks WHERE game_type = ? AND server_id = ?`,
    [game, server]
  );
  console.log('\n=== streak rows ===');
  console.table(streaks.map((r: any) => ({
    scope: r.scope,
    user: r.user_id || '(server)',
    current: r.current_count,
    current_last_date: r.current_last_date,
    max: r.max_count,
    max_date: r.max_date,
  })));

  // --- Distinct completed puzzle-dates, annotated with puzzle number ---
  const sessions = await db.query<any>(
    `SELECT puzzle_date, user_id, is_complete FROM game_sessions
     WHERE game_type = ? AND server_id = ?
     ORDER BY puzzle_date DESC`,
    [game, server]
  );

  // Normalize puzzle_date -> UTC date string + puzzle number.
  const seen = new Map<string, { number: number; anyComplete: boolean; rows: number }>();
  for (const s of sessions) {
    const d = new Date(s.puzzle_date);
    const key = d.toISOString().split('T')[0]!;
    const entry = seen.get(key) ?? { number: puzzleNumber(d), anyComplete: false, rows: 0 };
    entry.rows++;
    if (s.is_complete) entry.anyComplete = true;
    seen.set(key, entry);
  }

  console.log('=== distinct puzzle-dates in game_sessions (UTC) ===');
  console.table([...seen.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, v]) => ({
      utc_date: date,
      puzzle: '#' + v.number,
      any_complete: v.anyComplete ? 'yes' : 'no',
      session_rows: v.rows,
    })));

  // Today's number for reference.
  log.info(`today (UTC now) = #${puzzleNumber(new Date())}`);

  await DatabaseConnectionFactory.close();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('diagnose-streak failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
