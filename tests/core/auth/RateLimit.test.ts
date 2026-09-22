import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import {
  InMemoryRateLimitStore,
  rateLimit,
  RateLimitStore,
} from '../../../core/auth/RateLimit';

describe('InMemoryRateLimitStore', () => {
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
  });

  afterEach(() => {
    store.destroy();
  });

  it('counts hits within a window', () => {
    expect(store.hit('k', 60_000).count).toBe(1);
    expect(store.hit('k', 60_000).count).toBe(2);
    expect(store.hit('k', 60_000).count).toBe(3);
  });

  it('tracks separate keys independently', () => {
    store.hit('a', 60_000);
    store.hit('a', 60_000);
    expect(store.hit('b', 60_000).count).toBe(1);
    expect(store.hit('a', 60_000).count).toBe(3);
  });

  it('resets the count after the window elapses', () => {
    const now = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(now);
    expect(store.hit('k', 1_000).count).toBe(1);
    expect(store.hit('k', 1_000).count).toBe(2);
    // Advance past the window.
    nowSpy.mockReturnValue(now + 1_001);
    expect(store.hit('k', 1_000).count).toBe(1);
    nowSpy.mockRestore();
  });

  it('sets resetTime windowMs into the future', () => {
    const now = 5_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const hit = store.hit('k', 30_000);
    expect(hit.resetTime).toBe(now + 30_000);
    nowSpy.mockRestore();
  });
});

describe('rateLimit middleware', () => {
  // Build an app with a fresh store and an optional pre-set identity.
  function buildApp(opts: { maxRequests: number; windowMs: number; userId?: string; store: RateLimitStore }) {
    const app = express();
    app.set('trust proxy', 1);
    if (opts.userId) {
      app.use((req: Request, _res: Response, next: NextFunction) => {
        req.userId = opts.userId;
        next();
      });
    }
    app.use('/game', rateLimit({
      maxRequests: opts.maxRequests,
      windowMs: opts.windowMs,
      store: opts.store,
      bucket: 'test',
    }));
    app.get('/game/ping', (_req, res) => res.json({ ok: true }));
    return app;
  }

  it('allows requests up to the limit, then returns 429', async () => {
    const store = new InMemoryRateLimitStore();
    const app = buildApp({ maxRequests: 3, windowMs: 60_000, userId: 'u1', store });

    for (let i = 0; i < 3; i++) {
      const ok = await request(app).get('/game/ping');
      expect(ok.status).toBe(200);
    }
    const blocked = await request(app).get('/game/ping');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('rate limit exceeded');
    expect(blocked.body.retryAfter).toBeGreaterThanOrEqual(0);
    expect(blocked.headers['retry-after']).toBeDefined();

    store.destroy();
  });

  it('sets X-RateLimit headers with a decreasing remaining count', async () => {
    const store = new InMemoryRateLimitStore();
    const app = buildApp({ maxRequests: 5, windowMs: 60_000, userId: 'u2', store });

    const r1 = await request(app).get('/game/ping');
    expect(r1.headers['x-ratelimit-limit']).toBe('5');
    expect(r1.headers['x-ratelimit-remaining']).toBe('4');

    const r2 = await request(app).get('/game/ping');
    expect(r2.headers['x-ratelimit-remaining']).toBe('3');

    store.destroy();
  });

  it('limits different verified users independently', async () => {
    const store = new InMemoryRateLimitStore();
    // Exhaust user A.
    const appA = buildApp({ maxRequests: 2, windowMs: 60_000, userId: 'A', store });
    await request(appA).get('/game/ping');
    await request(appA).get('/game/ping');
    expect((await request(appA).get('/game/ping')).status).toBe(429);

    // User B (same shared store) is unaffected.
    const appB = buildApp({ maxRequests: 2, windowMs: 60_000, userId: 'B', store });
    expect((await request(appB).get('/game/ping')).status).toBe(200);

    store.destroy();
  });

  it('falls back to IP keying for anonymous requests (no userId)', async () => {
    const store = new InMemoryRateLimitStore();
    const app = buildApp({ maxRequests: 2, windowMs: 60_000, store }); // no userId

    // All requests from supertest share a loopback IP → same bucket.
    expect((await request(app).get('/game/ping')).status).toBe(200);
    expect((await request(app).get('/game/ping')).status).toBe(200);
    expect((await request(app).get('/game/ping')).status).toBe(429);

    store.destroy();
  });

  it('keeps separate buckets from colliding', async () => {
    const store = new InMemoryRateLimitStore();
    const app = express();
    const mkUser = (req: Request, _res: Response, next: NextFunction) => { req.userId = 'same'; next(); };
    app.use(mkUser);
    app.use('/game/a', rateLimit({ maxRequests: 1, windowMs: 60_000, store, bucket: 'a' }));
    app.use('/game/b', rateLimit({ maxRequests: 1, windowMs: 60_000, store, bucket: 'b' }));
    app.get('/game/a', (_req, res) => res.json({ ok: true }));
    app.get('/game/b', (_req, res) => res.json({ ok: true }));

    // Same user, but different buckets → each gets its own allowance.
    expect((await request(app).get('/game/a')).status).toBe(200);
    expect((await request(app).get('/game/b')).status).toBe(200);
    // Second hit on each bucket trips its own limit.
    expect((await request(app).get('/game/a')).status).toBe(429);
    expect((await request(app).get('/game/b')).status).toBe(429);

    store.destroy();
  });
});
