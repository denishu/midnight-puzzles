// HTTP-level test for the public leaderboard endpoint exposed by BaseGameServer.
//
// Boots a real server via build() (no port bind, no cleanup timer), seeds the
// streaks table through the real StreakRepository, and drives GET
// /api/leaderboard with supertest. Asserts the public contract the landing page
// depends on: ranking by max streak, exclusion of synthetic servers, server
// name/icon passthrough with fallbacks, the game allowlist (400), permissive
// CORS, and response caching.
//
// Mirrors BaseGameServer.integration.test.ts for the boot/teardown pattern.

// Force an isolated in-memory DB regardless of any local .env.
process.env.DATABASE_URL = ':memory:';

import request from 'supertest';
import path from 'path';
import type { Express } from 'express';
import { BaseGameServer, GameServerConfig } from '../../../core/web/BaseGameServer';
import { StreakRepository } from '../../../core/storage/StreakRepository';
import { DatabaseConnectionFactory } from '../../../core/storage/DatabaseConnection';

const CONFIG: GameServerConfig = {
  gameType: 'semantle',
  dbFile: ':memory:',
  clientIdEnv: 'LB_CLIENT_ID',
  clientSecretEnv: 'LB_CLIENT_SECRET',
  botTokenEnv: 'LB_BOT_TOKEN',
  // The leaderboard route needs no Discord config, so require nothing (keeps the
  // test free of env coupling while still exercising the real build() path).
  requiredEnv: [],
  port: 0,
  staticDir: path.resolve(__dirname, '../../..'),
  configLabel: 'leaderboard-web',
  rateLimits: [],
  completeEmbed: { title: 'x', color: 0x000000, channelKey: 'semantle' },
};

let server: BaseGameServer;
let app: Express;
let streaks: StreakRepository;

beforeAll(async () => {
  await DatabaseConnectionFactory.close();
  server = new BaseGameServer(CONFIG);
  const built = await server.build(
    async () => ({ startSession: async () => 'session-id' }),
    () => { /* no game routes needed for this test */ },
  );
  app = built.app;

  // Seed streak data on the same DB the server uses.
  streaks = new StreakRepository(server.context.db);

  // Two real servers: S1 (best 12, with icon) ranks above S2 (best 7, no icon).
  await streaks.upsert({
    scope: 'server', serverId: '111111111111111111', userId: '', gameType: 'semantle',
    currentCount: 4, currentLastDate: '2026-10-18', maxCount: 12, maxDate: '2026-10-15',
  });
  await streaks.upsertServerMeta('111111111111111111', 'semantle', 'Puzzle Lounge', 'iconhash1');

  await streaks.upsert({
    scope: 'server', serverId: '222222222222222222', userId: '', gameType: 'semantle',
    currentCount: 2, currentLastDate: '2026-10-18', maxCount: 7, maxDate: '2026-10-10',
  });
  // Deliberately NO upsertServerMeta for S2 -> exercises name + icon fallbacks.

  // A synthetic 'activity' server with a huge streak that must NOT appear.
  await streaks.upsert({
    scope: 'server', serverId: 'activity', userId: '', gameType: 'semantle',
    currentCount: 50, currentLastDate: '2026-10-18', maxCount: 99, maxDate: '2026-10-18',
  });

  // A streak for a DIFFERENT game must not leak into semantle results.
  await streaks.upsert({
    scope: 'server', serverId: '333333333333333333', userId: '', gameType: 'travle',
    currentCount: 3, currentLastDate: '2026-10-18', maxCount: 20, maxDate: '2026-10-01',
  });
});

afterAll(async () => {
  await DatabaseConnectionFactory.close();
});

describe('GET /api/leaderboard (public)', () => {
  it('returns servers ranked by max streak, excluding synthetic servers', async () => {
    const res = await request(app).get('/api/leaderboard').query({ game: 'semantle' });
    expect(res.status).toBe(200);
    expect(res.body.game).toBe('semantle');
    expect(Array.isArray(res.body.servers)).toBe(true);

    const ids = res.body.servers.map((s: any) => s.serverId);
    expect(ids).toEqual(['111111111111111111', '222222222222222222']); // activity excluded, travle excluded
    expect(res.body.servers[0].rank).toBe(1);
    expect(res.body.servers[0].maxStreak).toBe(12);
    expect(res.body.servers[1].rank).toBe(2);
    expect(res.body.servers[1].maxStreak).toBe(7);
  });

  it('passes through server name + icon, with fallbacks for missing metadata', async () => {
    const res = await request(app).get('/api/leaderboard').query({ game: 'semantle' });
    const [first, second] = res.body.servers;

    expect(first.name).toBe('Puzzle Lounge');
    expect(first.iconHash).toBe('iconhash1');

    // S2 had no metadata row -> friendly name fallback + null icon (client
    // renders an initials badge).
    expect(second.name).toBe('A Discord Server');
    expect(second.iconHash).toBeNull();
  });

  it('does not expose any user-level (PII) fields', async () => {
    const res = await request(app).get('/api/leaderboard').query({ game: 'semantle' });
    for (const s of res.body.servers) {
      expect(s).not.toHaveProperty('userId');
      expect(s).not.toHaveProperty('username');
      expect(Object.keys(s).sort()).toEqual(
        ['currentStreak', 'iconHash', 'maxDate', 'maxStreak', 'name', 'rank', 'serverId'].sort(),
      );
    }
  });

  it('includes each server\'s maxDate (when the best streak peaked)', async () => {
    const res = await request(app).get('/api/leaderboard').query({ game: 'semantle' });
    expect(res.body.servers[0].maxDate).toBe('2026-10-15');
    expect(res.body.servers[1].maxDate).toBe('2026-10-10');
  });

  it('updatedAt reflects the stored row timestamp, not the response-build time', async () => {
    const res = await request(app).get('/api/leaderboard').query({ game: 'semantle' });
    // It must be a real timestamp from the streaks rows (set at seed time),
    // comfortably before "now" rather than equal to the request moment.
    expect(res.body.updatedAt).toBeTruthy();
    const updated = new Date(res.body.updatedAt).getTime();
    expect(Number.isNaN(updated)).toBe(false);
    expect(updated).toBeLessThanOrEqual(Date.now());
  });

  it('rejects a game outside the allowlist with 400', async () => {
    const res = await request(app).get('/api/leaderboard').query({ game: 'hacker' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid game/);
  });

  it('defaults to the server\'s own game when game param is omitted', async () => {
    const res = await request(app).get('/api/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body.game).toBe('semantle');
  });

  it('sends permissive CORS + cache headers (consumed cross-origin by the static landing page)', async () => {
    const res = await request(app).get('/api/leaderboard').query({ game: 'semantle' });
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
  });

  it('serves a stable cached body within the TTL even if the data changes underneath', async () => {
    // Prime the cache.
    const first = await request(app).get('/api/leaderboard').query({ game: 'travle' });
    expect(first.status).toBe(200);
    const before = first.body.servers.length;

    // Mutate the underlying data; the cached response should NOT reflect it yet.
    await streaks.upsert({
      scope: 'server', serverId: '444444444444444444', userId: '', gameType: 'travle',
      currentCount: 1, currentLastDate: '2026-10-18', maxCount: 99, maxDate: '2026-10-18',
    });
    const second = await request(app).get('/api/leaderboard').query({ game: 'travle' });
    expect(second.body.servers.length).toBe(before); // served from cache, unchanged
  });

  it('is exempt from the /game no-cache + rate-limit middleware (it is public)', async () => {
    const res = await request(app).get('/api/leaderboard').query({ game: 'semantle' });
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
    expect(res.headers['cache-control'] ?? '').not.toContain('no-store');
  });
});
