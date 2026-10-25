#!/usr/bin/env npx ts-node
/**
 * Read-only audit: reconcile a bot's ACTUAL current guild membership against
 * what the database knows, so you can answer "the app says it's in N servers --
 * how many of those have actually been played in / set up / are idle?"
 *
 * For the chosen game it reports, using only reads:
 *   - installed      : guilds the bot is currently a member of (GET /users/@me/guilds)
 *   - with a config  : installed guilds that have a server_configs row (ran /setchannel)
 *   - with a streak  : installed guilds that have a server-scope streak row (recent play)
 *   - idle installed : installed guilds with neither a config nor a streak
 *   - orphan streaks : server-scope streak rows whose guild the bot is NOT in
 *                      (should be ~0 after a --prune run)
 *
 * Caveats it is honest about:
 *   - "with a streak" only reflects the ~7-day session-retention window, so an
 *     installed guild that played >7 days ago but not since counts as idle here.
 *   - server_configs is the only DURABLE "this guild engaged" marker.
 *
 * Usage (from project root): npx ts-node scripts/audit-guilds.ts --game travle
 * Reads bot token + DB config from env exactly like the bots.
 */

import { config } from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import { DatabaseConnectionFactory, DatabaseConfig } from '../core/storage/DatabaseConnection';
import { Logger } from '../core/utils/Logger';

config();

const GAME_TOKENS: Record<string, string> = {
  semantle: 'SEMANTLE_BOT_TOKEN',
  travle: 'TRAVLE_BOT_TOKEN',
  duotrigordle: 'DUOTRIGORDLE_BOT_TOKEN',
  betweenle: 'BETWEENLE_BOT_TOKEN',
};
const DEFAULT_DB: Record<string, string> = {
  semantle: 'semantle-bot.db',
  travle: 'travle-bot.db',
  duotrigordle: 'duotrigordle-bot.db',
  betweenle: 'betweenle-bot.db',
};
const ALLOWED = new Set(Object.keys(GAME_TOKENS));

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const log = new Logger('audit-guilds');
  const game = arg('--game') || 'semantle';
  if (!ALLOWED.has(game)) {
    throw new Error(`--game must be one of ${[...ALLOWED].join(', ')} (got "${game}")`);
  }

  const token = process.env[GAME_TOKENS[game]!];
  if (!token) throw new Error(`Missing ${GAME_TOKENS[game]} in environment`);

  const dbConfig: DatabaseConfig = {
    type: (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite') as 'sqlite' | 'postgresql',
    database: process.env.DATABASE_URL || DEFAULT_DB[game]!,
    ...(process.env.DB_HOST && { host: process.env.DB_HOST }),
    ...(process.env.DB_PORT && { port: parseInt(process.env.DB_PORT) }),
    ...(process.env.DB_USER && { username: process.env.DB_USER }),
    ...(process.env.DB_PASSWORD && { password: process.env.DB_PASSWORD }),
  };
  const db = await DatabaseConnectionFactory.create(dbConfig);

  // --- DB facts (reads only) ------------------------------------------------
  const streakRows = await db.query<{ server_id: string }>(
    `SELECT DISTINCT server_id FROM streaks WHERE scope = 'server' AND game_type = ?`,
    [game]
  );
  const streakServers = new Set(streakRows.map(r => r.server_id));

  // server_configs may or may not exist / be game-scoped; guard it.
  let configServers = new Set<string>();
  try {
    const cfgRows = await db.query<{ server_id: string }>(
      `SELECT DISTINCT server_id FROM server_configs`
    );
    configServers = new Set(cfgRows.map(r => r.server_id));
  } catch (e) {
    log.warn('could not read server_configs (table may not exist); skipping that column');
  }

  // --- The authoritative current guild list (paginated REST) ----------------
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);
  await new Promise<void>((resolve) => {
    if (client.isReady()) return resolve();
    client.once('ready', () => resolve());
  });

  // GET /users/@me/guilds, following the 200-per-page `after` cursor.
  const installed: { id: string; name: string }[] = [];
  let after: string | undefined;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await client.rest.get(
      `/users/@me/guilds?limit=200${after ? `&after=${after}` : ''}`
    ) as { id: string; name: string }[];
    installed.push(...page.map(g => ({ id: g.id, name: g.name })));
    if (page.length < 200) break;
    after = page[page.length - 1]!.id;
  }
  const installedIds = new Set(installed.map(g => g.id));

  // The approximate counts Discord shows in the dev portal "Install Count"
  // panel -- fetched from the SAME field the portal renders, so we can compare
  // it directly against the enumerated live guild list above.
  let apiGuildCount: number | null = null;
  let apiUserInstallCount: number | null = null;
  try {
    const app = await client.rest.get('/applications/@me') as {
      approximate_guild_count?: number;
      approximate_user_install_count?: number;
    };
    apiGuildCount = app.approximate_guild_count ?? null;
    apiUserInstallCount = app.approximate_user_install_count ?? null;
  } catch (e) {
    log.warn('could not read /applications/@me approximate counts');
  }

  // --- Classify -------------------------------------------------------------
  let played = 0, configured = 0, idle = 0;
  for (const g of installed) {
    const hasStreak = streakServers.has(g.id);
    const hasConfig = configServers.has(g.id);
    if (hasStreak) played++;
    if (hasConfig) configured++;
    if (!hasStreak && !hasConfig) idle++;
  }
  // Streak servers the bot is NOT in (should be ~0 post-prune).
  const orphanStreaks = [...streakServers].filter(id => !installedIds.has(id) && id !== 'activity' && id !== 'dm' && id !== '');

  log.info(`=== ${game} guild audit ===`);
  log.info(`installed (bot is a member)   : ${installed.length}   [enumerated via GET /users/@me/guilds]`);
  log.info(`approximate_guild_count (API) : ${apiGuildCount ?? 'n/a'}   [same field the dev-portal 'Servers' shows]`);
  log.info(`approximate_user_install_count: ${apiUserInstallCount ?? 'n/a'}`);
  log.info(`  ...with a server_configs row: ${configured}`);
  log.info(`  ...with a streak (<=7d play): ${played}`);
  log.info(`  ...idle (neither)           : ${idle}`);
  log.info(`orphan streak servers (bot NOT in, should be ~0): ${orphanStreaks.length}`);
  if (orphanStreaks.length) log.info(`  orphan ids: ${orphanStreaks.join(', ')}`);

  // eslint-disable-next-line no-console
  console.log('\nInstalled guilds:');
  // eslint-disable-next-line no-console
  console.table(installed.map(g => ({
    id: g.id,
    name: g.name,
    streak: streakServers.has(g.id) ? 'yes' : '',
    config: configServers.has(g.id) ? 'yes' : '',
  })));

  await client.destroy();
  await DatabaseConnectionFactory.close();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('audit-guilds failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
