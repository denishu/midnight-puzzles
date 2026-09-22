import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/Logger';

const logger = new Logger('ActivityAuth');

/**
 * Server-side identity verification for Discord Activities.
 *
 * The Discord Embedded App SDK authenticates the user in the browser, but that
 * result is not trustworthy on its own — the client controls it. This module
 * closes the loop:
 *
 *   1. verifyDiscordToken() takes the OAuth access token and asks Discord
 *      (GET /users/@me) who it actually belongs to. The user id therefore comes
 *      from Discord, not from the client.
 *   2. issueSessionToken() signs a short-lived JWT carrying that verified id.
 *      Only this server holds the signing secret, so the token is tamper-proof.
 *   3. authMiddleware() reads the id from that verified JWT (Authorization:
 *      Bearer ...), never from a client-supplied query param.
 *
 * Non-Discord "local" play (localStorage ids like `local_*`, or `default`)
 * remains supported: those requests carry no bearer token and are treated as
 * anonymous, non-persisted sessions by the game servers.
 */

/** Verified identity payload carried inside our session JWT. */
export interface SessionIdentity {
  /** Verified Discord user id (snowflake). */
  id: string;
  /** Discord username at time of verification (best-effort, may be stale). */
  username?: string | undefined;
}

const DISCORD_USER_ENDPOINT = 'https://discord.com/api/users/@me';

/** How long an issued session token stays valid. Daily puzzles reset at UTC
 * midnight, so a 1-day lifetime comfortably covers a play session. */
const TOKEN_TTL_SECONDS = 24 * 60 * 60;

/**
 * Resolve the JWT signing secret. Prefers ACTIVITY_JWT_SECRET, then falls back
 * to a per-game client secret so existing deployments work without new config.
 * Throws if nothing is available — we must never sign with an empty secret.
 */
export function getJwtSecret(): string {
  const secret =
    process.env.ACTIVITY_JWT_SECRET ||
    process.env.SEMANTLE_CLIENT_SECRET ||
    process.env.TRAVLE_CLIENT_SECRET ||
    process.env.DUOTRIGORDLE_CLIENT_SECRET;

  if (!secret) {
    throw new Error(
      'No JWT signing secret configured. Set ACTIVITY_JWT_SECRET (or a *_CLIENT_SECRET).'
    );
  }
  return secret;
}

/**
 * Verify a Discord OAuth access token by calling Discord's /users/@me endpoint.
 * Returns the verified identity, or null if the token is invalid/expired or the
 * call fails. The returned id is the source of truth for who the user is.
 */
export async function verifyDiscordToken(accessToken: string): Promise<SessionIdentity | null> {
  if (!accessToken) return null;

  try {
    const resp = await fetch(DISCORD_USER_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      logger.warn(`Discord /users/@me returned ${resp.status}`);
      return null;
    }

    const user = (await resp.json()) as { id?: string; username?: string };
    if (!user || !user.id) {
      logger.warn('Discord /users/@me response missing user id');
      return null;
    }

    return { id: user.id, username: user.username };
  } catch (e) {
    logger.error(`Discord token verification failed: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Sign a session JWT for a verified identity. The token embeds the verified
 * Discord id (as `sub`) and username, and expires after TOKEN_TTL_SECONDS.
 */
export function issueSessionToken(identity: SessionIdentity): string {
  return jwt.sign(
    { username: identity.username },
    getJwtSecret(),
    { subject: identity.id, expiresIn: TOKEN_TTL_SECONDS }
  );
}

/**
 * Verify and decode a session JWT previously issued by issueSessionToken().
 * Returns the identity, or null if the token is missing, malformed, tampered
 * with, or expired.
 */
export function verifySessionToken(token: string): SessionIdentity | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
    if (!payload.sub) return null;
    return { id: payload.sub, username: payload.username as string | undefined };
  } catch {
    // Invalid signature, expired, or malformed — treat as unauthenticated.
    return null;
  }
}

/** Extract a bearer token from the Authorization header, if present. */
function extractBearer(req: Request): string | null {
  const header = req.headers['authorization'];
  if (!header || typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

// Augment Express's Request with the verified identity we attach.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Verified Discord user id from the session JWT, if authenticated. */
      userId?: string | undefined;
      /** Verified username from the session JWT, if authenticated. */
      authUsername?: string | undefined;
    }
  }
}

/**
 * Express middleware that reads the verified identity from the session JWT and
 * attaches it to the request as `req.userId` / `req.authUsername`.
 *
 * This does NOT reject unauthenticated requests — non-Discord local play has no
 * token. It simply ensures that when a token IS present it must be valid, and
 * that identity can never come from a client-controlled query param. Endpoints
 * decide what to do when `req.userId` is absent (the game servers fall back to
 * non-persisted anonymous sessions).
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  if (token) {
    const identity = verifySessionToken(token);
    if (identity) {
      req.userId = identity.id;
      req.authUsername = identity.username;
    }
  }
  next();
}

/**
 * Resolve the effective user id for a request.
 *
 * Precedence:
 *   1. Verified JWT identity (req.userId) — the only trusted Discord id.
 *   2. A `local_*` id supplied by the client — anonymous localStorage play,
 *      which the servers already treat as non-persisted. This is allowed
 *      through because it can never collide with or impersonate a real Discord
 *      id (servers skip DB persistence for `local_*` / `default`).
 *   3. 'default' — the anonymous fallback.
 *
 * A raw numeric `?id=` with no matching JWT is ignored, which is exactly the
 * IDOR the fix closes.
 */
export function resolveUserId(req: Request): string {
  if (req.userId) return req.userId;

  const claimed = (req.query.id as string) || '';
  if (claimed.startsWith('local_')) return claimed;

  return 'default';
}
