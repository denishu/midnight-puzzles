import express from 'express';
import path from 'path';
import { config } from 'dotenv';
import { CountryGraph } from '../../games/travle/CountryGraph';
import { TravleGameSession } from '../../games/travle/TravleGameSession';
import { SessionManager } from '../../core/auth/SessionManager';
import { DatabaseConnectionFactory } from '../../core/storage/DatabaseConnection';
import { GameStateRepository } from '../../core/storage/GameStateRepository';
import { UserRepository } from '../../core/storage/UserRepository';
import { ConfigRepository } from '../../core/storage/ConfigRepository';
import { MigrationManager } from '../../core/storage/migrations/migrate';
import { verifyDiscordToken, issueSessionToken, authMiddleware, resolveUserId } from '../../core/auth/ActivityAuth';
import { rateLimit } from '../../core/auth/RateLimit';
import { validateConfigOrExit } from '../../core/utils/ConfigValidator';
import { validateGuessText } from '../../core/utils/InputValidator';

config();

const app = express();
app.use(express.json());
// Trust the reverse proxy so req.ip reflects the real client (rate-limit key).
app.set('trust proxy', 1);

// --- Game setup ---
let travle: TravleGameSession;
let graph: CountryGraph;
let sessionRepo: GameStateRepository;
let userRepo: UserRepository;
let configRepo: ConfigRepository;

// In-memory session map: discordUserId -> gameSessionId (mirrors Semantle).
// The actual game state lives in SessionManager / the DB, not here.
const userSessions: Map<string, string> = new Map();

// Track which date the current sessions belong to (for daily cleanup)
let sessionsDate: string = new Date().toISOString().split('T')[0]!;

async function initGame() {
  // Initialize DB
  const db = await DatabaseConnectionFactory.create({
    type: (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite') as 'sqlite' | 'postgresql',
    database: process.env.DATABASE_URL || 'travle-bot.db',
  });
  await new MigrationManager(db).migrate();
  sessionRepo = new GameStateRepository(db);
  userRepo = new UserRepository(db);
  configRepo = new ConfigRepository(db);

  const g = new CountryGraph();
  await g.initialize();
  graph = g;

  const sessionManager = new SessionManager(sessionRepo);
  travle = new TravleGameSession(g, sessionManager);
  travle.init();
  console.log('Travle game initialized');

  // Schedule daily session cleanup at midnight UTC
  scheduleDailyCleanup();
}

function scheduleDailyCleanup() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 5, 0); // 5 seconds past midnight to avoid race
  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  setTimeout(() => {
    console.log(`[cleanup] Purging ${userSessions.size} sessions for ${sessionsDate}`);
    userSessions.clear();
    sessionsDate = new Date().toISOString().split('T')[0]!;
    // Reschedule for next day
    scheduleDailyCleanup();
  }, msUntilMidnight);

  console.log(`[cleanup] Next session purge in ${Math.round(msUntilMidnight / 60000)} minutes`);
}

/**
 * Get or create today's session id for a user, delegating resumption/creation
 * to SessionManager (via TravleGameSession). Returns null for non-Discord users
 * (localStorage fallback IDs) which are not persisted.
 */
async function getOrCreateSession(id: string, username?: string, guildId?: string): Promise<string | null> {
  if (id === 'default' || id.startsWith('local_')) {
    return null;
  }

  // If the date rolled over but cleanup hasn't fired yet, clear now
  const today = new Date().toISOString().split('T')[0]!;
  if (today !== sessionsDate) {
    console.log(`[cleanup] Date rolled to ${today}, purging ${userSessions.size} stale sessions`);
    userSessions.clear();
    sessionsDate = today;
  }

  const cached = userSessions.get(id);
  if (cached) return cached;

  // Ensure user exists (placeholder username — bot will have the real one)
  await userRepo.upsertUser(id, username || 'activity_user_' + id);

  const session = await travle.startSession(id, guildId || 'activity');
  userSessions.set(id, session.id);
  return session.id;
}

// --- API endpoints ---

// Prevent Discord's Activity proxy from caching API responses
app.use('/game', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Verify session JWT (if present) and attach req.userId. Never trusts ?id=.
app.use('/game', authMiddleware);

// Rate limiting (keyed per verified user, IP fallback for anonymous play).
app.use('/game', rateLimit({ maxRequests: 120, windowMs: 60_000, bucket: 'travle-all' }));
app.use(['/game/guess', '/game/hint'], rateLimit({ maxRequests: 30, windowMs: 60_000, bucket: 'travle-play' }));

// Discord OAuth token exchange (for Activity)
app.post('/game/discord/token', async (req, res) => {
  const { code } = req.body;
  if (!code) { res.status(400).json({ error: 'code required' }); return; }

  try {
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.TRAVLE_CLIENT_ID || '',
        client_secret: process.env.TRAVLE_CLIENT_SECRET || '',
        grant_type: 'authorization_code',
        code,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Discord token exchange error:', response.status, err);
      res.status(500).json({ error: 'token exchange failed' });
      return;
    }

    const { access_token } = await response.json() as any;

    // Verify the token with Discord to obtain the REAL user id, then issue our
    // own signed session token for the client to send as a Bearer token.
    const identity = await verifyDiscordToken(access_token);
    if (!identity) {
      res.status(401).json({ error: 'identity verification failed' });
      return;
    }
    const sessionToken = issueSessionToken(identity);

    res.json({ access_token, sessionToken });
  } catch (e) {
    console.error('Token exchange failed:', e);
    res.status(500).json({ error: 'token exchange failed' });
  }
});

// Get country aliases for autocomplete
app.get('/game/aliases', (_req, res) => {
  res.json(CountryGraph.ALIAS_MAP);
});

// Proxy GeoJSON (Discord CSP blocks external fetches)
app.get('/game/geojson', async (_req, res) => {
  try {
    const response = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');
    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch GeoJSON' });
  }
});

// Ephemeral in-memory states for non-Discord (anonymous/local) users only.
// These are never persisted; they let local play work without a DB session.
const anonStates: Map<string, import('../../games/travle/TravleGame').TravleGameState> = new Map();

function getAnonState(id: string) {
  let state = anonStates.get(id);
  if (!state) {
    state = travle.newAnonState(new Date());
    anonStates.set(id, state);
  }
  return state;
}

// Get today's puzzle
app.get('/game/puzzle', async (req, res) => {
  const id = resolveUserId(req);
  const username = req.authUsername ?? (req.query.username as string | undefined);
  const guildId = req.query.guildId as string | undefined;
  console.log('[session] puzzle request from:', id);

  const sessionId = await getOrCreateSession(id, username, guildId);
  const state = sessionId ? await travle.getState(sessionId) : getAnonState(id);
  if (!state) { res.status(500).json({ error: 'failed to load session' }); return; }

  res.json({
    start: state.puzzle.start,
    end: state.puzzle.end,
    shortestPathLength: state.puzzle.shortestPathLength,
    shortestPath: state.puzzle.shortestPath,
    maxGuesses: state.puzzle.maxGuesses,
    guesses: state.guesses,
    guessesRemaining: state.guessesRemaining,
    isComplete: state.isComplete,
    isWin: state.isWin,
  });
});

// Submit a guess
app.post('/game/guess', async (req, res) => {
  const id = resolveUserId(req);
  const guildId = req.query.guildId as string | undefined;
  const { country } = req.body;
  const username = req.authUsername ?? req.body.username;
  console.log('[guess]', id, country);
  const validation = validateGuessText(country);
  if (!validation.ok) { res.status(400).json({ error: validation.error }); return; }
  const cleanCountry = validation.value!;

  const sessionId = await getOrCreateSession(id, username, guildId);

  let state: import('../../games/travle/TravleGame').TravleGameState;
  let result;
  if (sessionId) {
    // Fix server_id if we now have the guild ID (handles sessions created without it)
    if (guildId) await travle.fixServerId(sessionId, guildId);
    result = await travle.processGuess(sessionId, cleanCountry);
    state = (await travle.getState(sessionId))!;
  } else {
    // Anonymous/local play — mutate the ephemeral state, no persistence.
    state = getAnonState(id);
    result = travle.guessAnon(state, cleanCountry);
  }

  res.json({
    ...result,
    guesses: state.guesses,
    guessesRemaining: state.guessesRemaining,
    serverGuessCount: state.guesses.length,
  });
});

// Get a hint: reveal an unguessed country on the cheapest path
app.get('/game/hint', async (req, res) => {
  const id = resolveUserId(req);
  const sessionId = await getOrCreateSession(id);
  const state = sessionId ? await travle.getState(sessionId) : getAnonState(id);
  if (!state) { res.json({ hint: null }); return; }

  if (state.isComplete) {
    res.json({ hint: null });
    return;
  }

  const freeSet = new Set(state.guesses.map(g => g.country));
  const path = graph.weightedShortestPath(state.puzzle.start, state.puzzle.end, freeSet);

  if (!path) {
    res.json({ hint: null });
    return;
  }

  // Find unguessed countries on the path (exclude start and end)
  const guessedSet = new Set([...freeSet, state.puzzle.start, state.puzzle.end]);
  const unguessed = path.filter(c => !guessedSet.has(c));

  if (unguessed.length === 0) {
    res.json({ hint: null });
    return;
  }

  // Pick the one closest to the last guess (or start if no guesses yet)
  const lastGuess = state.guesses.length > 0
    ? state.guesses[state.guesses.length - 1]!.country
    : state.puzzle.start;

  let closest = unguessed[0]!;
  let closestDist = graph.shortestPathLength(lastGuess, closest);

  for (const country of unguessed) {
    const dist = graph.shortestPathLength(lastGuess, country);
    if (dist >= 0 && (closestDist < 0 || dist < closestDist)) {
      closest = country;
      closestDist = dist;
    }
  }

  console.log('[hint]', sessionId, '->', closest);
  res.json({ hint: closest });
});

// Post results to Discord channel (uses the configured channel from /setchannel)
app.post('/game/complete', async (req, res) => {
  const { message, serverId } = req.body;
  console.log('[complete] serverId:', serverId, 'message:', message?.substring(0, 50));
  if (!message) { res.status(400).json({ error: 'message required' }); return; }

  try {
    const token = process.env.TRAVLE_BOT_TOKEN;
    if (!token) { res.status(500).json({ error: 'bot token not configured' }); return; }

    // Look up the configured channel for this server
    let channelId = req.body.channelId;
    if (serverId) {
      const config = await configRepo?.getServerConfig(serverId);
      if (config) {
        const gameChannel = config.customSettings?.channels?.travle;
        if (gameChannel) channelId = gameChannel;
        else if (config.channelId) channelId = config.channelId;
      }
    }

    if (!channelId) { res.status(400).json({ error: 'no channel configured — use /setchannel' }); return; }

    console.log('[complete] Posting to channel:', channelId);
    const discordResp = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        embeds: [{
          title: '🧭 Travle Results',
          description: message,
          color: 0x00aa55, // match bot embed color
        }]
      })
    });

    if (!discordResp.ok) {
      const err = await discordResp.text();
      console.error('[complete] Discord API error:', discordResp.status, err);
      res.status(500).json({ error: 'discord api error' });
      return;
    }

    console.log('[complete] Message posted successfully');
    res.json({ ok: true });
  } catch (e) {
    console.error('Failed to post results:', e);
    res.status(500).json({ error: 'failed to post' });
  }
});

// Reset session
app.post('/game/reset', async (req, res) => {
  const id = resolveUserId(req);
  console.log('[reset]', id);

  // Drop the cached session id + any anonymous state.
  userSessions.delete(id);
  anonStates.delete(id);

  // Delete the persisted session so the next request starts fresh.
  if (id !== 'default' && !id.startsWith('local_')) {
    const dbSession = await sessionRepo.getActiveSession(id, 'travle', new Date());
    if (dbSession) await sessionRepo.deleteSession(dbSession.id);
  }

  // Return a fresh puzzle state (re-creates the session on demand).
  const sessionId = await getOrCreateSession(id);
  const state = sessionId ? await travle.getState(sessionId) : getAnonState(id);
  res.json({
    start: state!.puzzle.start,
    end: state!.puzzle.end,
    shortestPathLength: state!.puzzle.shortestPathLength,
    maxGuesses: state!.puzzle.maxGuesses,
    guesses: [],
    guessesRemaining: state!.guessesRemaining,
  });
});

// --- Start ---
// Fail fast if required config is missing (before binding the port).
validateConfigOrExit(
  ['TRAVLE_CLIENT_ID', 'TRAVLE_CLIENT_SECRET', 'TRAVLE_BOT_TOKEN'],
  'travle-web'
);

// Serve static files AFTER API routes so /api/* takes priority
app.use(express.static(path.resolve(process.cwd(), 'web/travle')));

const PORT = process.env.PORT || 3002;
initGame().then(() => {
  app.listen(PORT, () => {
    console.log(`Travle web running at http://localhost:${PORT}`);
  });
});
