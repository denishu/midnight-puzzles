// Integration test: proves the auth trust boundary over real HTTP.
//
// This mounts the SAME authMiddleware + resolveUserId the game servers use on a
// fresh Express app with a route that mirrors how endpoints resolve identity,
// then fires real requests through supertest. The critical assertion is the
// IDOR repro from IMPROVEMENTS.md: a forged ?id= with no valid token must NOT
// resolve to that user.

process.env.ACTIVITY_JWT_SECRET = 'test-secret-for-activity-auth-integration';

import express from 'express';
import request from 'supertest';
import { authMiddleware, resolveUserId, issueSessionToken } from '../../../core/auth/ActivityAuth';
import jwt from 'jsonwebtoken';

function buildApp() {
  const app = express();
  app.use(express.json());
  // Same wiring as the real servers.
  app.use('/game', authMiddleware);
  // Mirrors how every endpoint derives identity.
  app.get('/game/state', (req, res) => {
    res.json({ userId: resolveUserId(req), authUsername: req.authUsername ?? null });
  });
  return app;
}

describe('Auth trust boundary (integration)', () => {
  const app = buildApp();
  const VICTIM_ID = '209384029384'; // a "known" public Discord id an attacker might try

  it('IDOR repro: forged ?id= with no token does NOT resolve to that user', async () => {
    const res = await request(app).get('/game/state').query({ id: VICTIM_ID });
    expect(res.status).toBe(200);
    // The forged id must be ignored — resolves to anonymous default, not the victim.
    expect(res.body.userId).toBe('default');
    expect(res.body.userId).not.toBe(VICTIM_ID);
  });

  it('a token forged with the wrong secret is rejected; ?id= still ignored', async () => {
    const forged = jwt.sign({ username: 'attacker' }, 'wrong-secret', { subject: VICTIM_ID });
    const res = await request(app)
      .get('/game/state')
      .query({ id: VICTIM_ID })
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('default');
  });

  it('a valid token resolves to the verified user even if ?id= claims someone else', async () => {
    const token = issueSessionToken({ id: 'real-user-1', username: 'denis' });
    const res = await request(app)
      .get('/game/state')
      .query({ id: VICTIM_ID }) // attacker-style spoof attempt in the query
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('real-user-1');
    expect(res.body.authUsername).toBe('denis');
  });

  it('local_* anonymous play is still allowed through the query', async () => {
    const res = await request(app).get('/game/state').query({ id: 'local_abc123' });
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('local_abc123');
  });

  it('no id and no token resolves to anonymous default', async () => {
    const res = await request(app).get('/game/state');
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('default');
  });
});
