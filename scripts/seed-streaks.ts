#!/usr/bin/env npx ts-node
/**
 * Seed the `streaks` table with sample data for manual testing of the
 * leaderboard feature: the public /api/leaderboard endpoint, the /streak slash
 * command, and the landing-page leaderboard.
 *
 * It writes through the real StreakRepository (same code path as production),
 * so the rows it creates are exactly shaped like the nightly job's output.
 *
 * What it seeds (per game):
 *   - Two REAL servers: one WITH a Discord icon hash, one WITHOUT (so you can
 *     verify both the icon render and the initials-badge fallback).
 *   - One SYNTHETIC 'activity' server with a huge streak — it must NOT appear on
 *     the leaderboard, proving the exclusion filter works.
 *   - A per-PLAYER streak row in the first real server, so running /streak as
 *     that user in that server shows non-zero current + best numbers.
 *
 * Usage:
 *   npx ts-node scripts/seed-streaks.ts [--game <semantle|travle|duotrigordle>]
 *                                       [--db <path-to-sqlite-db>]
 *                                       [--user <discordUserId>]
 *                                       [--clear]
 *
 * Examples:
 *   npx ts-node scripts/seed-streaks.ts --game semantle --db semantle-bot.db
 *   npx ts-node scripts/seed-streaks.ts --game travle --db ./scratch.db --clear
 *
 * Or via npm: npm run seed:streaks -- --game semantle --db semantle-bot.db
 *
 * NOTE: the public endpoint keys off the SERVER's real guild id, and /streak
 * keys off the guild id of the server you run it in. To see seeded data in a
 * REAL server/landing page, pass --server <yourGuildId> (otherwise sample ids
 * are used, which still prove the endpoint + rendering work).
 */

import { DatabaseConnectionFactory } from '../core/storage/DatabaseConnection';
import { MigrationManager } from '../core/storage/migrations/migrate';
import { StreakRepository } from '../core/storage/StreakRepository';
import { Logger } from '../core/utils/Logger';

interface Args {
  game: string;
  db: string;
  user: string;
  server?: string | undefined;
  clear: boolean;
}

const ALLOWED_GAMES = new Set(['semantle', 'travle', 'duotrigordle']);
const DEFAULT_DB: Record<string, string> = {
  semantle: 'semantle-bot.db',
  travle: 'travle-bot.db',
  duotrigordle: 'duotrigordle-bot.db',
};

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const game = get('--game') || 'semantle';
  if (!ALLOWED_GAMES.has(game)) {
    throw new Error(`--game must be one of ${[...ALLOWED_GAMES].join(', ')} (got "${game}")`);
  }
  return {
    game,
    db: get('--db') || DEFAULT_DB[game]!,
    user: get('--user') || '250395918774435840', // sample Discord user id
    server: get('--server'),
    clear: argv.includes('--clear'),
  };
}

/** 'YYYY-MM-DD' for N days ago (UTC), matching the nightly job's date keys. */
function dateNDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split('T')[0]!;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const log = new Logger('seed-streaks');

  // Use the real sqlite file (or :memory: scratch). Force sqlite regardless of
  // NODE_ENV so a stray NODE_ENV=production doesn't try to reach Postgres.
  const db = await DatabaseConnectionFactory.create({ type: 'sqlite', database: args.db });
  await new MigrationManager(db).migrate(); // ensure the streaks table exists
  const repo = new StreakRepository(db);

  if (args.clear) {
    await db.query('DELETE FROM streaks WHERE game_type = ?', [args.game]);
    log.info(`Cleared existing ${args.game} streak rows`);
  }

  // Real server ids: use the provided --server for the first one so you can see
  // it in your own guild / landing page; fall back to sample snowflakes.
  const serverA = args.server || '111111111111111111';
  const serverB = '222222222222222222';
  const today = dateNDaysAgo(0);

  // --- Server-scope rows (drive the leaderboard + /streak server record) ---

  // A: strong current streak + higher all-time best, WITH an icon.
  await repo.upsert({
    scope: 'server', serverId: serverA, userId: '', gameType: args.game,
    currentCount: 5, currentLastDate: today, maxCount: 14, maxDate: dateNDaysAgo(9),
  });
  // NOTE: 'a_...' prefix would signal an animated (gif) icon; this is a static
  // png hash. If you pass --server <yourGuild>, replace this with your guild's
  // real icon hash to see the actual image; otherwise the CDN 404s and the page
  // falls back to the initials badge (which is itself a valid thing to test).
  await repo.upsertServerMeta(serverA, args.game, 'The Puzzle Lounge', '1234567890abcdef1234567890abcdef');

  // B: smaller streak, NO metadata row -> name + icon fallbacks on the page.
  await repo.upsert({
    scope: 'server', serverId: serverB, userId: '', gameType: args.game,
    currentCount: 2, currentLastDate: today, maxCount: 8, maxDate: dateNDaysAgo(20),
  });

  // Synthetic server with a huge streak — must be EXCLUDED from the board.
  await repo.upsert({
    scope: 'server', serverId: 'activity', userId: '', gameType: args.game,
    currentCount: 99, currentLastDate: today, maxCount: 99, maxDate: today,
  });

  // --- Player-scope row (drives /streak personal numbers in serverA) ---
  // Active streak 5, personal best 11 — so the embed shows current < best.
  await repo.upsert({
    scope: 'player', serverId: serverA, userId: args.user, gameType: args.game,
    currentCount: 5, currentLastDate: today, maxCount: 11, maxDate: dateNDaysAgo(15),
  });

  // --- Report what landed + how to verify ---
  const top = await repo.getTopServers(args.game, 5);
  const player = await repo.getPlayerStreak(args.user, serverA, args.game);

  log.info(`Seeded ${args.game} streaks into ${args.db}`);
  // eslint-disable-next-line no-console
  console.log('\n=== Top servers (what /api/leaderboard will return) ===');
  // eslint-disable-next-line no-console
  console.table(top.map(t => ({
    rank: top.indexOf(t) + 1,
    serverId: t.serverId,
    name: t.guildName ?? '(fallback: A Discord Server)',
    icon: t.iconHash ?? '(fallback: initials badge)',
    maxStreak: t.maxCount,
    current: t.currentCount,
  })));

  // eslint-disable-next-line no-console
  console.log('=== Player streak in serverA (what /streak shows for this user) ===');
  // eslint-disable-next-line no-console
  console.log(`  user ${args.user} @ ${serverA}: current=${player?.currentCount ?? 0}, best=${player?.maxCount ?? 0}\n`);

  const port = args.game === 'semantle' ? 3001 : args.game === 'travle' ? 3002 : 3003;
  // eslint-disable-next-line no-console
  console.log('Verify the endpoint (start the game server first: npm run dev:' + args.game + '-web):');
  // eslint-disable-next-line no-console
  console.log(`  curl "http://localhost:${port}/api/leaderboard?game=${args.game}"`);
  if (args.server) {
    // eslint-disable-next-line no-console
    console.log(`\nRun /streak in guild ${args.server} as user ${args.user} to see the player numbers.`);
  } else {
    // eslint-disable-next-line no-console
    console.log('\nTip: pass --server <yourGuildId> to seed YOUR server so /streak + the landing page show it.');
  }

  await DatabaseConnectionFactory.close();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('seed-streaks failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
