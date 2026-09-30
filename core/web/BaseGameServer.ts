import express, { Express } from 'express';
import type { Server } from 'http';
import path from 'path';
import { DatabaseConnection, DatabaseConnectionFactory } from '../storage/DatabaseConnection';
import { GameStateRepository } from '../storage/GameStateRepository';
import { UserRepository } from '../storage/UserRepository';
import { ConfigRepository } from '../storage/ConfigRepository';
import { SessionManager } from '../auth/SessionManager';
import { MigrationManager } from '../storage/migrations/migrate';
import { verifyDiscordToken, issueSessionToken, authMiddleware } from '../auth/ActivityAuth';
import { rateLimit } from '../auth/RateLimit';
import { validateConfigOrExit } from '../utils/ConfigValidator';
import { Logger } from '../utils/Logger';

/** A rate-limit rule applied to a set of paths under /game. */
export interface RateLimitRule {
  paths: string | string[];
  maxRequests: number;
  windowMs: number;
  bucket: string;
}

/** Config for the shared /game/complete Discord results post. */
export interface CompleteEmbedConfig {
  /** Embed title, e.g. '🔮 Semantle Results'. */
  title: string;
  /** Embed color (hex int). */
  color: number;
  /** Key under server_configs.customSettings.channels, e.g. 'semantle'. */
  channelKey: string;
}

/** Static, per-game configuration for a web server. */
export interface GameServerConfig {
  /** Game type / db key, e.g. 'semantle'. */
  gameType: string;
  /** Default sqlite db filename (dev), e.g. 'semantle-bot.db'. */
  dbFile: string;
  /** Env var names for Discord OAuth + bot. */
  clientIdEnv: string;
  clientSecretEnv: string;
  botTokenEnv: string;
  /** Required env vars asserted at boot (fail-fast). */
  requiredEnv: string[];
  /** Listen port. */
  port: number | string;
  /** Directory of static assets to serve (relative to cwd). */
  staticDir: string;
  /** Rate-limit rules applied after authMiddleware. */
  rateLimits: RateLimitRule[];
  /** Config for the /game/complete results post. */
  completeEmbed: CompleteEmbedConfig;
  /** Label used by validateConfigOrExit, e.g. 'semantle-web'. */
  configLabel: string;
}

/** Shared infrastructure handed to each game's init hook. */
export interface GameServerContext {
  db: DatabaseConnection;
  sessionRepo: GameStateRepository;
  userRepo: UserRepository;
  configRepo: ConfigRepository;
  sessionManager: SessionManager;
}

/**
 * What a game's init hook returns: a function that gets-or-creates the DB
 * session for a user and returns its session id, plus an optional cleanup
 * callback invoked on the daily purge (to clear game-local caches).
 */
export interface GameHooks {
  /**
   * Get-or-create today's persisted session for a verified user, returning its
   * session id. Called only for real (persisted) users — the base handles the
   * anonymous short-circuit before calling this.
   */
  startSession(userId: string, serverId: string): Promise<string>;
  /** Optional: clear any game-local in-memory caches on daily purge. */
  onDailyCleanup?: () => void;
}

/**
 * Shared scaffolding for the three game web servers (IMPROVEMENTS #4).
 *
 * Owns everything the servers had duplicated ~90%: Express setup, DB init +
 * migrate, the userId->sessionId cache with daily cleanup, the /game middleware
 * stack (no-cache headers, auth, rate limiting), the Discord OAuth token
 * exchange, the /game/complete results post, config fail-fast, static serving,
 * and startup.
 *
 * Each game supplies a {@link GameServerConfig}, an `init` hook that constructs
 * its game object (using the shared {@link GameServerContext}) and returns
 * {@link GameHooks}, and a `registerRoutes` hook for its gameplay endpoints.
 */
export class BaseGameServer {
  readonly app: Express;
  private config: GameServerConfig;

  // userId -> gameSessionId cache (per-process; state itself lives in the DB).
  private userSessions: Map<string, string> = new Map();
  private sessionsDate: string = new Date().toISOString().split('T')[0]!;

  private ctx!: GameServerContext;
  private hooks!: GameHooks;
  private httpServer?: Server;
  private cleanupTimer?: NodeJS.Timeout;
  private shuttingDown = false;
  private readonly log: Logger;

  constructor(config: GameServerConfig) {
    this.config = config;
    this.log = new Logger(`${config.gameType}-web`);
    this.app = express();
    this.app.use(express.json());
    // Trust the reverse proxy so req.ip reflects the real client (rate-limit key).
    this.app.set('trust proxy', 1);
  }

  /**
   * Configure the server WITHOUT binding a port or starting the daily-cleanup
   * timer. Returns `this` so callers can reach `.app` (e.g. supertest in tests).
   *
   * Steps:
   *  1. fail-fast config validation
   *  2. DB init + migrate, build shared context
   *  3. game init hook (constructs the game, returns session hooks)
   *  4. common /game middleware + routes
   *  5. game-specific routes
   *  6. static serving
   *
   * Deliberately omits the port bind and the cleanup setTimeout so tests can
   * exercise the HTTP surface without leaking a listener or a timer.
   */
  async build(
    init: (ctx: GameServerContext) => Promise<GameHooks>,
    registerRoutes: (app: Express, base: BaseGameServer) => void,
  ): Promise<this> {
    // 1. Fail fast if required config is missing (before doing any work).
    validateConfigOrExit(this.config.requiredEnv, this.config.configLabel);

    // 2. DB + shared context.
    const db = await DatabaseConnectionFactory.create({
      type: (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite') as 'sqlite' | 'postgresql',
      database: process.env.DATABASE_URL || this.config.dbFile,
    });
    await new MigrationManager(db).migrate();

    const sessionRepo = new GameStateRepository(db);
    const userRepo = new UserRepository(db);
    const configRepo = new ConfigRepository(db);
    const sessionManager = new SessionManager(sessionRepo);
    this.ctx = { db, sessionRepo, userRepo, configRepo, sessionManager };

    // 3. Game init hook.
    this.hooks = await init(this.ctx);

    // 4. Common middleware + routes.
    this.installHealthCheck();
    this.installCommonMiddleware();
    this.installTokenExchange();
    this.installCompleteRoute();

    // 5. Game-specific routes.
    registerRoutes(this.app, this);

    // 6. Static serving (after API routes so they take priority).
    this.app.use(express.static(path.resolve(process.cwd(), this.config.staticDir)));

    return this;
  }

  /**
   * Boot the server for real: build it, start the daily-cleanup timer, and bind
   * the listen port. This is what the server entrypoints call in production.
   */
  async listen(
    init: (ctx: GameServerContext) => Promise<GameHooks>,
    registerRoutes: (app: Express, base: BaseGameServer) => void,
  ): Promise<void> {
    await this.build(init, registerRoutes);
    this.scheduleDailyCleanup();
    this.httpServer = this.app.listen(this.config.port, () => {
      this.log.info(`running at http://localhost:${this.config.port}`);
    });
    this.installShutdownHandlers();
  }

  /**
   * Register SIGTERM/SIGINT handlers for graceful shutdown. The handlers run
   * the drain sequence (see {@link shutdown}) and then exit the process. The
   * drain itself is factored out so it can be unit-tested without real signals
   * or process.exit.
   */
  private installShutdownHandlers(): void {
    const handle = (signal: string) => {
      void this.shutdown(signal).then(() => process.exit(0));
    };
    process.on('SIGTERM', () => handle('SIGTERM'));
    process.on('SIGINT', () => handle('SIGINT'));
  }

  /**
   * Graceful shutdown drain: stop accepting new connections, cancel the cleanup
   * timer, then drain/close the DB pool. Idempotent — a second call while
   * already shutting down is a no-op. Does NOT call process.exit so it stays
   * testable; the signal handlers exit after this resolves.
   */
  async shutdown(signal: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.log.info(`${signal} received, shutting down...`);

    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);

    // Stop accepting new connections and wait for in-flight requests to finish.
    await new Promise<void>((resolve) => {
      if (!this.httpServer) { resolve(); return; }
      this.httpServer.close(() => resolve());
    });

    // Drain/close the DB pool.
    try {
      await DatabaseConnectionFactory.close();
      this.log.info('[shutdown] database closed');
    } catch (e) {
      this.log.error('[shutdown] error closing database', { error: e });
    }

    this.log.info('[shutdown] done');
  }

  /** Shared infrastructure (repos, session manager) for game routes. */
  get context(): GameServerContext {
    return this.ctx;
  }

  /**
   * Get-or-create today's session id for a user. Returns null for non-Discord
   * users (localStorage fallback ids), which are not persisted — routes fall
   * back to an ephemeral anonymous state for those.
   */
  async getOrCreateSession(id: string, username?: string, guildId?: string): Promise<string | null> {
    if (id === 'default' || id.startsWith('local_')) {
      return null;
    }

    // If the date rolled over but cleanup hasn't fired yet, clear now.
    const today = new Date().toISOString().split('T')[0]!;
    if (today !== this.sessionsDate) {
      this.log.info(`Date rolled to ${today}, purging ${this.userSessions.size} stale sessions`);
      this.userSessions.clear();
      this.hooks.onDailyCleanup?.();
      this.sessionsDate = today;
    }

    const cached = this.userSessions.get(id);
    if (cached) return cached;

    await this.ctx.userRepo.upsertUser(id, username || 'activity_user_' + id);
    const sessionId = await this.hooks.startSession(id, guildId || 'activity');
    this.userSessions.set(id, sessionId);
    return sessionId;
  }

  /** Drop a user's cached session id (used by reset routes). */
  forgetSession(id: string): void {
    this.userSessions.delete(id);
  }

  // --- Common middleware + routes -------------------------------------------

  private installCommonMiddleware(): void {
    // Prevent Discord's Activity proxy from caching API responses.
    this.app.use('/game', (_req, res, next) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      next();
    });

    // Verify session JWT (if present) and attach req.userId. Never trusts ?id=.
    this.app.use('/game', authMiddleware);

    // Rate limiting (keyed per verified user, IP fallback for anonymous play).
    for (const rule of this.config.rateLimits) {
      this.app.use(rule.paths, rateLimit({ maxRequests: rule.maxRequests, windowMs: rule.windowMs, bucket: rule.bucket }));
    }
  }

  private installTokenExchange(): void {
    const { clientIdEnv, clientSecretEnv } = this.config;
    this.app.post('/game/discord/token', async (req, res) => {
      const { code } = req.body;
      if (!code) { res.status(400).json({ error: 'code required' }); return; }

      try {
        const response = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env[clientIdEnv] || '',
            client_secret: process.env[clientSecretEnv] || '',
            grant_type: 'authorization_code',
            code,
          }),
        });

        if (!response.ok) {
          const err = await response.text();
          this.log.error('Discord token exchange error', { status: response.status, err });
          res.status(500).json({ error: 'token exchange failed' });
          return;
        }

        const { access_token } = await response.json() as any;

        // Verify the token with Discord to obtain the REAL user id, then issue
        // our own signed session token for the client to send as a Bearer token.
        const identity = await verifyDiscordToken(access_token);
        if (!identity) {
          res.status(401).json({ error: 'identity verification failed' });
          return;
        }
        const sessionToken = issueSessionToken(identity);

        res.json({ access_token, sessionToken });
      } catch (e) {
        this.log.error('Token exchange failed', { error: e });
        res.status(500).json({ error: 'token exchange failed' });
      }
    });
  }

  private installCompleteRoute(): void {
    const { botTokenEnv, completeEmbed } = this.config;
    this.app.post('/game/complete', async (req, res) => {
      const { message, serverId } = req.body;
      this.log.debug('[complete] request', { serverId, message: message?.substring(0, 50) });
      if (!message) { res.status(400).json({ error: 'message required' }); return; }

      try {
        const token = process.env[botTokenEnv];
        if (!token) { res.status(500).json({ error: 'bot token not configured' }); return; }

        let channelId = req.body.channelId;
        if (serverId) {
          const cfg = await this.ctx.configRepo?.getServerConfig(serverId);
          if (cfg) {
            const gameChannel = cfg.customSettings?.channels?.[completeEmbed.channelKey];
            if (gameChannel) channelId = gameChannel;
            else if (cfg.channelId) channelId = cfg.channelId;
          }
        }
        if (!channelId) { res.status(400).json({ error: 'no channel configured — use /setchannel' }); return; }

        this.log.debug('[complete] posting to channel', { channelId });
        const discordResp = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            embeds: [{
              title: completeEmbed.title,
              description: message,
              color: completeEmbed.color,
            }],
          }),
        });

        if (!discordResp.ok) {
          const err = await discordResp.text();
          this.log.error('[complete] Discord API error', { status: discordResp.status, err });
          res.status(500).json({ error: 'discord api error' });
          return;
        }

        this.log.info('[complete] message posted successfully');
        res.json({ ok: true });
      } catch (e) {
        this.log.error('[complete] failed to post results', { error: e });
        res.status(500).json({ error: 'failed to post' });
      }
    });
  }

  private scheduleDailyCleanup(): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 5, 0); // 5 seconds past midnight to avoid race
    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    this.cleanupTimer = setTimeout(() => {
      this.log.info(`Purging ${this.userSessions.size} sessions for ${this.sessionsDate}`);
      this.userSessions.clear();
      this.hooks.onDailyCleanup?.();
      this.sessionsDate = new Date().toISOString().split('T')[0]!;
      this.scheduleDailyCleanup();
    }, msUntilMidnight);

    this.log.info(`Next session purge in ${Math.round(msUntilMidnight / 60000)} minutes`);
  }

  /**
   * Liveness/readiness probe. Registered on /health (NOT under /game), so it is
   * exempt from the auth + rate-limit + no-cache middleware. Pings the DB with a
   * trivial query so the check reflects real readiness, not just process
   * liveness. Returns 200 {status:'ok'} or 503 {status:'error'} on DB failure.
   */
  private installHealthCheck(): void {
    this.app.get('/health', async (_req, res) => {
      try {
        await this.ctx.db.query('SELECT 1');
        res.json({ status: 'ok', game: this.config.gameType });
      } catch (e) {
        this.log.error('[health] DB check failed', { error: e });
        res.status(503).json({ status: 'error', game: this.config.gameType });
      }
    });
  }
}
