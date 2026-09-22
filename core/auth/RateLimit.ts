import type { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/Logger';

const logger = new Logger('RateLimit');

/**
 * Rate limiting for the web API.
 *
 * Uses a fixed-window counter (the same algorithm as UserValidator on the bot
 * side): allow up to `maxRequests` per `windowMs`, then reject with HTTP 429.
 *
 * SCALING NOTE — the default store keeps counters in this process's memory.
 * That is correct and sufficient for a single instance (one Hetzner box). If
 * the app is ever run as multiple instances behind a load balancer, each would
 * keep its own counters and the effective limit becomes `maxRequests × N
 * instances`. To scale horizontally, implement RateLimitStore against a shared
 * store (Redis INCR + EXPIRE) and pass it via `options.store` — the middleware
 * and endpoints do not change. Mirrors the in-memory session-map limitation
 * documented in IMPROVEMENTS.md #5.
 */

/** Result of recording a hit against a key. */
export interface RateLimitHit {
  /** Number of requests seen for this key in the current window (incl. this). */
  count: number;
  /** Epoch ms when the current window resets. */
  resetTime: number;
}

/**
 * Storage backend for rate-limit counters. Swap the implementation (e.g. Redis)
 * to share counters across instances without touching the middleware.
 */
export interface RateLimitStore {
  /** Record a hit for `key` within a `windowMs` window and return the state. */
  hit(key: string, windowMs: number): RateLimitHit;
  /** Release any resources (timers, connections). */
  destroy(): void;
}

interface Entry {
  count: number;
  resetTime: number;
}

/** In-memory fixed-window store. Per-process; see the scaling note above. */
export class InMemoryRateLimitStore implements RateLimitStore {
  private entries: Map<string, Entry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null;

  constructor() {
    // Periodically drop expired entries so the map does not grow unbounded.
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    // Do not keep the process alive solely for cleanup.
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  hit(key: string, windowMs: number): RateLimitHit {
    const now = Date.now();
    let entry = this.entries.get(key);

    if (!entry || now >= entry.resetTime) {
      entry = { count: 1, resetTime: now + windowMs };
      this.entries.set(key, entry);
      return entry;
    }

    entry.count++;
    return entry;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (now >= entry.resetTime) this.entries.delete(key);
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.entries.clear();
  }
}

export interface RateLimitOptions {
  /** Max requests allowed per window. */
  maxRequests: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Counter backend. Defaults to a shared in-memory store. */
  store?: RateLimitStore;
  /** Label used in the counter key to scope limits per route group. */
  bucket?: string;
}

/**
 * Derive the rate-limit key for a request.
 *
 * Prefers the verified Discord id (set by authMiddleware) so limits are
 * per-user. Falls back to the client IP for anonymous/local play, so the shared
 * `default` identity is not a single bypassable bucket. The key is namespaced by
 * `bucket` so different route groups (e.g. guess vs. state) count separately.
 */
function keyFor(req: Request, bucket: string): string {
  if (req.userId) return `${bucket}:user:${req.userId}`;
  // req.ip requires Express `trust proxy` to be accurate behind a reverse proxy.
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return `${bucket}:ip:${ip}`;
}

/** A default in-memory store shared by all limiters created without one. */
let sharedStore: RateLimitStore | null = null;
function defaultStore(): RateLimitStore {
  if (!sharedStore) sharedStore = new InMemoryRateLimitStore();
  return sharedStore;
}

/**
 * Create an Express middleware that enforces a fixed-window rate limit.
 * Responds with 429 and a `Retry-After` header when the limit is exceeded.
 */
export function rateLimit(options: RateLimitOptions) {
  const { maxRequests, windowMs } = options;
  const bucket = options.bucket ?? 'default';
  const store = options.store ?? defaultStore();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const key = keyFor(req, bucket);
    const { count, resetTime } = store.hit(key, windowMs);
    const remaining = Math.max(0, maxRequests - count);
    const resetSeconds = Math.max(0, Math.ceil((resetTime - Date.now()) / 1000));

    // Standard informational headers.
    res.set('X-RateLimit-Limit', String(maxRequests));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(resetSeconds));

    if (count > maxRequests) {
      res.set('Retry-After', String(resetSeconds));
      logger.warn(`Rate limit exceeded for ${key} (${count}/${maxRequests})`);
      res.status(429).json({
        error: 'rate limit exceeded',
        retryAfter: resetSeconds,
      });
      return;
    }

    next();
  };
}
