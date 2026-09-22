// Set a signing secret before importing the module (getJwtSecret reads env).
process.env.ACTIVITY_JWT_SECRET = 'test-secret-for-activity-auth';

import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import {
  verifyDiscordToken,
  issueSessionToken,
  verifySessionToken,
  authMiddleware,
  resolveUserId,
  getJwtSecret,
} from '../../../core/auth/ActivityAuth';

/** Build a minimal Express-like Request for middleware/resolver tests. */
function makeReq(opts: { authorization?: string; queryId?: string } = {}): Request {
  return {
    headers: opts.authorization ? { authorization: opts.authorization } : {},
    query: opts.queryId !== undefined ? { id: opts.queryId } : {},
  } as unknown as Request;
}

describe('ActivityAuth', () => {
  describe('getJwtSecret', () => {
    it('returns the configured ACTIVITY_JWT_SECRET', () => {
      expect(getJwtSecret()).toBe('test-secret-for-activity-auth');
    });
  });

  describe('issueSessionToken / verifySessionToken', () => {
    it('round-trips a verified identity', () => {
      const token = issueSessionToken({ id: '123456789', username: 'denis' });
      const identity = verifySessionToken(token);
      expect(identity).not.toBeNull();
      expect(identity!.id).toBe('123456789');
      expect(identity!.username).toBe('denis');
    });

    it('works without a username', () => {
      const token = issueSessionToken({ id: '999' });
      const identity = verifySessionToken(token);
      expect(identity!.id).toBe('999');
      expect(identity!.username).toBeUndefined();
    });

    it('rejects a token signed with a different secret (tampered/forged)', () => {
      const forged = jwt.sign({ username: 'attacker' }, 'wrong-secret', { subject: '42' });
      expect(verifySessionToken(forged)).toBeNull();
    });

    it('rejects a structurally tampered token', () => {
      const token = issueSessionToken({ id: '123', username: 'denis' });
      // Flip a character in the signature segment.
      const parts = token.split('.');
      parts[2] = parts[2]!.slice(0, -1) + (parts[2]!.endsWith('a') ? 'b' : 'a');
      expect(verifySessionToken(parts.join('.'))).toBeNull();
    });

    it('rejects an expired token', () => {
      const expired = jwt.sign({ username: 'denis' }, getJwtSecret(), {
        subject: '123',
        expiresIn: -10, // already expired
      });
      expect(verifySessionToken(expired)).toBeNull();
    });

    it('rejects garbage and empty input', () => {
      expect(verifySessionToken('')).toBeNull();
      expect(verifySessionToken('not-a-jwt')).toBeNull();
      expect(verifySessionToken('a.b.c')).toBeNull();
    });

    it('rejects a valid-signature token that lacks a subject', () => {
      const noSub = jwt.sign({ username: 'denis' }, getJwtSecret());
      expect(verifySessionToken(noSub)).toBeNull();
    });
  });

  describe('resolveUserId', () => {
    it('prefers the verified JWT identity on the request', () => {
      const req = makeReq({ queryId: 'someone_else' });
      req.userId = 'verified-123';
      expect(resolveUserId(req)).toBe('verified-123');
    });

    it('ignores a raw numeric ?id= with no JWT (the IDOR case)', () => {
      const req = makeReq({ queryId: '209384029384' });
      expect(resolveUserId(req)).toBe('default');
    });

    it('allows a local_* anonymous id from the query', () => {
      const req = makeReq({ queryId: 'local_abc123' });
      expect(resolveUserId(req)).toBe('local_abc123');
    });

    it('falls back to default when nothing is provided', () => {
      expect(resolveUserId(makeReq())).toBe('default');
    });

    it('does not let a forged ?id= override a verified identity', () => {
      const req = makeReq({ queryId: 'local_evil' });
      req.userId = 'verified-999';
      expect(resolveUserId(req)).toBe('verified-999');
    });
  });

  describe('authMiddleware', () => {
    it('attaches userId/authUsername from a valid Bearer token', () => {
      const token = issueSessionToken({ id: 'user-1', username: 'denis' });
      const req = makeReq({ authorization: `Bearer ${token}` });
      const next = jest.fn();

      authMiddleware(req, {} as Response, next);

      expect(req.userId).toBe('user-1');
      expect(req.authUsername).toBe('denis');
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('is case-insensitive on the Bearer scheme', () => {
      const token = issueSessionToken({ id: 'user-2' });
      const req = makeReq({ authorization: `bearer ${token}` });
      const next = jest.fn();

      authMiddleware(req, {} as Response, next);

      expect(req.userId).toBe('user-2');
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('leaves userId unset and still calls next for no token', () => {
      const req = makeReq();
      const next = jest.fn();

      authMiddleware(req, {} as Response, next);

      expect(req.userId).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('leaves userId unset for an invalid token but does not throw', () => {
      const req = makeReq({ authorization: 'Bearer not-a-real-token' });
      const next = jest.fn();

      authMiddleware(req, {} as Response, next);

      expect(req.userId).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('verifyDiscordToken', () => {
    const realFetch = global.fetch;

    afterEach(() => {
      global.fetch = realFetch;
      jest.restoreAllMocks();
    });

    it('returns the verified identity from /users/@me', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: '555', username: 'realuser' }),
      }) as unknown as typeof fetch;

      const identity = await verifyDiscordToken('good-access-token');

      expect(identity).toEqual({ id: '555', username: 'realuser' });
      const call = (global.fetch as jest.Mock).mock.calls[0];
      expect(call[0]).toBe('https://discord.com/api/users/@me');
      expect(call[1].headers.Authorization).toBe('Bearer good-access-token');
    });

    it('returns null on a non-ok Discord response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({}),
      }) as unknown as typeof fetch;

      expect(await verifyDiscordToken('bad-token')).toBeNull();
    });

    it('returns null when the response has no user id', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ username: 'noid' }),
      }) as unknown as typeof fetch;

      expect(await verifyDiscordToken('weird-token')).toBeNull();
    });

    it('returns null when fetch throws', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
      expect(await verifyDiscordToken('any')).toBeNull();
    });

    it('returns null for an empty access token without calling fetch', async () => {
      global.fetch = jest.fn() as unknown as typeof fetch;
      expect(await verifyDiscordToken('')).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
