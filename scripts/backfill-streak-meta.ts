#!/usr/bin/env npx ts-node
/**
 * One-off backfill for streak-row guild metadata (name + icon).
 *
 * WHY: the nightly job resolves guild name/icon only once per run. If rows were
 * created without metadata (server wasn't in the gateway cache at the time),
 * they show as "A Discord Server" until the next nightly run. This script fills
 * them in on demand, using the SAME resolver path as the fixed nightly job
 * (clientGuildResolver -> cache, then REST fetch on miss).
 *
 * SAFETY: writes ONLY guild_name / icon_hash via StreakRepository.upsertServerMeta.
 * It never reads or mutates streak COUNTS. Servers the bot has left resolve to
 * null and are skipped (left as-is). Read-only w.r.t. everything except the two
 * metadata columns.
 *
 * Usage (run from the project root, where the bots run):
 *   npx ts-node scripts/backfill-streak-meta.ts --game semantle
 *   npx ts-node scripts/backfill-streak-meta.ts --game travle
 *   npx ts-node scripts/backfill-streak-meta.ts --game duotrigordle
 *
 * Reads the bot token + DB config from the environment exactly like the bots
 * (so it targets Postgres in production when NODE_ENV=production).
 */

import { config } from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import { DatabaseConnectionFactory, DatabaseConfig } from '../core/storage/DatabaseConnection';
import { StreakRepository, isSyntheticServer } from '../core/storage/StreakRepository';
import { clientGuildResolver } from '../bot/shared/updateStreaks';
import { Logger } from '../core/utils/Logger';

config();

const GAME_TOKENS: Record<string, string> = {
  semantle: 'SEMANTLE_BOT_TOKEN',
  travle: 'TRAVLE_BOT_TOKEN',
  duotrigordle: 'DUOTRIGORDLE_BOT_TOKEN',
};
const DEFAULT_DB: Record<string, string> = {
  semantle: 'semantle-bot.db',
  travle: 'travle-bot.db',
  duotrigordle: 'duotrigordle-bot.db',
};
const ALLOWED = new Set(Object.keys(GAME_TOKENS));

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const log = new Logger('backfill-streak-meta');
  const game = arg('--game') || 'semantle';
  if (!ALLOWED.has(game)) {
    throw new Error(`--game must be one of ${[...ALLOWED].join(', ')} (got "${game}")`);
  }

  const token = process.env[GAME_TOKENS[game]!];
  if (!token) throw new Error(`Missing ${GAME_TOKENS[game]} in environment`);

  // Same DB config the bots use: Postgres in prod, sqlite otherwise.
  const dbConfig: DatabaseConfig = {
    type: (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite') as 'sqlite' | 'postgresql',
    database: process.env.DATABASE_URL || DEFAULT_DB[game]!,
    ...(process.env.DB_HOST && { host: process.env.DB_HOST }),
    ...(process.env.DB_PORT && { port: parseInt(process.env.DB_PORT) }),
    ...(process.env.DB_USER && { username: process.env.DB_USER }),
    ...(process.env.DB_PASSWORD && { password: process.env.DB_PASSWORD }),
  };

  const db = await DatabaseConnectionFactory.create(dbConfig);
  const repo = new StreakRepository(db);

  // Every distinct server that has a server-scope streak row for this game.
  const rows = await db.query<{ server_id: string }>(
    `SELECT DISTINCT server_id FROM streaks WHERE scope = 'server' AND game_type = ?`,
    [game]
  );
  const serverIds = rows.map(r => r.server_id).filter(id => !isSyntheticServer(id));
  log.info(`Found ${serverIds.length} server row(s) for ${game} to resolve`);

  // Log in a minimal client (Guilds intent is enough for name/icon + fetch).
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);
  // Wait until the gateway is ready so the cache is populated before we resolve.
  await new Promise<void>((resolve) => {
    if (client.isReady()) return resolve();
    client.once('ready', () => resolve());
  });
  log.info(`Logged in as ${client.user?.tag}; cache has ${client.guilds.cache.size} guild(s)`);

  const resolver = clientGuildResolver(client, log);
  let named = 0;
  let skipped = 0;
  for (const id of serverIds) {
    const guild = await resolver.resolve(id);
    if (!guild) { skipped++; continue; }
    await repo.upsertServerMeta(id, game, guild.name, guild.icon);
    named++;
  }

  log.info(`[backfill] ${game}: named ${named}, skipped ${skipped} (bot no longer in those servers)`);

  await client.destroy();
  await DatabaseConnectionFactory.close();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('backfill-streak-meta failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
