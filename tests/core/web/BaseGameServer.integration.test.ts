// HTTP-level test for BaseGameServer: builds a real server via build() (no port
// bind, no cleanup timer) and drives it with supertest. Covers the shared
// scaffolding the three entrypoints rely on — /game middleware, the Discord
// token route's failure path, /game/complete validation, and the
// getOrCreateSession anonymous fallback — using the real TravleGameSession as a
// representative game so a gameplay route is exercised too.

process.env.ACTIVITY_JWT_SECRET = 'test-secret-base-game-server';
// Required config so validateConfigOrExit() passes without exiting.
process.env.TEST_CLIENT_ID = 'cid';
process.env.TEST_CLIENT_SECRET = 'csecret';
process.env.TEST_BOT_TOKEN = 'btoken';
// Force an isolated in-memory DB regardless of local .env.
process.env.DATABASE_URL = ':memory:';

import request from 'supertest';
import path from 'path';
import type { Express } from 'express';
import { BaseGameServer, GameServerConfig } from '../../../core/web/BaseGameServer';
import { CountryGraph } from '../../../games/travle/CountryGraph';
import { TravleGameSession } from '../../../games/travle/TravleGameSession';
import { DatabaseConnectionFactory } from '../../../core/storage/DatabaseConnection';

const CONFIG: GameServerConfig = {
  gameType: 'testgame',
  dbFile: ':memory:',
  clientIdEnv: 'TEST_CLIENT_ID',
  clientSecretEnv: 'TEST_CLIENT_SECRET',
  botTokenEnv: 'TEST_BOT_TOKEN',
  requiredEnv: ['TEST_CLIENT_ID', 'TEST_CLIENT_SECRET', 'TEST_BOT_TOKEN'],
  port: 0,
  // Point static at repo root (exists); we only assert API behavior.
  staticDir: path.resolve(__dirname, '../../..'),
  configLabel: 'testgame-web',
  rateLimits: [
    { paths: '/game', maxRequests: 1000, windowMs: 60_000, bucket: 'test-all' },
  ],
  completeEmbed: { title: 'Test Results', color: 0x123456, channelKey: 'testgame' },
};

let server: BaseGameServer;
let app: Express;
// Shared across the init + registerRoutes hooks.
let travle: TravleGameSession;

beforeAll(async () => {
  await DatabaseConnectionFactory.close();
  server = new BaseGameServer(CONFIG);
  const built = await server.build(
    async (ctx) => {
      const graph = new CountryGraph();
      await graph.initialize();
      travle = new TravleGameSession(graph, ctx.sessionManager);
      travle.init();
      return {
        startSession: async (userId, serverId) => (await travle.startSession(userId, serverId)).id,
        onDailyCleanup: () => { /* no-op for test */ },
      };
    },
    (a: Express, base: BaseGameServer) => {
      // Minimal game route exercising getOrCreateSession's anon path. (Full
      // gameplay is covered by the per-game characterization tests; here we
      // assert the BASE wiring actually reaches a registered route.)
      a.get('/game/puzzle', async (req, res) => {
        const id = (req.query.id as string) || 'default';
        const sessionId = await base.getOrCreateSession(id);
        const state = sessionId ? await travle.getState(sessionId) : travle.newAnonState(new Date());
        res.json({ start: state!.puzzle.start, end: state!.puzzle.end, sessionPersisted: !!sessionId });
      });
    },
  );
  app = built.app;
});

afterAll(async () => {
  await DatabaseConnectionFactory.close();
});

describe('BaseGameServer HTTP wiring', () => {
  it('applies the no-cache headers on /game routes', async () => {
    const res = await request(app).get('/game/puzzle').query({ id: 'local_test' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['pragma']).toBe('no-cache');
  });

  it('applies rate-limit headers from the configured rule', async () => {
    const res = await request(app).get('/game/puzzle').query({ id: 'local_test' });
    expect(res.headers['x-ratelimit-limit']).toBe('1000');
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('getOrCreateSession returns anonymous (non-persisted) for local_* ids', async () => {
    const res = await request(app).get('/game/puzzle').query({ id: 'local_abc' });
    expect(res.status).toBe(200);
    expect(res.body.sessionPersisted).toBe(false);
    expect(typeof res.body.start).toBe('string');
  });

  it('/game/discord/token requires a code (400)', async () => {
    const res = await request(app).post('/game/discord/token').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/code required/);
  });

  it('/game/complete requires a message (400)', async () => {
    const res = await request(app).post('/game/complete').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message required/);
  });

  it('/game/complete with a message but no channel returns a config error (400)', async () => {
    const res = await request(app).post('/game/complete').send({ message: 'hi' });
    // Bot token IS set in test env, so it passes that check and fails on channel.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no channel configured/);
  });

  it('/health returns 200 ok with a DB ping', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.game).toBe('testgame');
  });

  it('/health is exempt from the /game rate-limit + no-cache middleware', async () => {
    const res = await request(app).get('/health');
    // Not under /game, so no rate-limit headers and no forced no-store.
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
    expect(res.headers['cache-control'] ?? '').not.toContain('no-store');
  });

  it('serves shared assets at /shared (single source of truth for tokens)', async () => {
    const res = await request(app).get('/shared/tokens.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/css/);
    expect(res.text).toContain('--font-display');
  });
});

// NOTE: these run LAST because shutdown() closes the shared DB singleton.
describe('BaseGameServer graceful shutdown', () => {
  it('drains: closes the DB and logs the sequence (no process.exit)', async () => {
    // Before: DB is usable.
    await expect(server.context.db.query('SELECT 1')).resolves.toBeDefined();

    await server.shutdown('TEST');

    // After: the DB connection is closed, so queries fail.
    await expect(server.context.db.query('SELECT 1')).rejects.toBeDefined();
  });

  it('is idempotent — a second shutdown() is a no-op', async () => {
    // Already shut down above; calling again must not throw.
    await expect(server.shutdown('TEST-again')).resolves.toBeUndefined();
  });
});
