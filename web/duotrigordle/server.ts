import express from 'express';
import path from 'path';
import { config } from 'dotenv';
import { WordValidator } from '../../games/duotrigordle/WordValidator';
import { DuotrigordleGameSession, DuotrigordleLiveSession } from '../../games/duotrigordle/DuotrigordleGameSession';
import { SessionManager } from '../../core/auth/SessionManager';
import { DatabaseConnectionFactory } from '../../core/storage/DatabaseConnection';
import { GameStateRepository } from '../../core/storage/GameStateRepository';
import { UserRepository } from '../../core/storage/UserRepository';
import { ConfigRepository } from '../../core/storage/ConfigRepository';
import { MigrationManager } from '../../core/storage/migrations/migrate';
import { verifyDiscordToken, issueSessionToken, authMiddleware, resolveUserId } from '../../core/auth/ActivityAuth';
import { rateLimit } from '../../core/auth/RateLimit';
import { validateConfigOrExit } from '../../core/utils/ConfigValidator';
import { validateWordleGuess } from '../../core/utils/InputValidator';

config();

const app = express();
app.use(express.json());
// Trust the reverse proxy so req.ip reflects the real client (rate-limit key).
app.set('trust proxy', 1);

// --- Game setup ---
let validator: WordValidator;
let duotri: DuotrigordleGameSession;
let sessionRepo: GameStateRepository;
let configRepo: ConfigRepository;

// In-memory session map: discordUserId -> gameSessionId (mirrors Semantle).
// The persisted state lives in SessionManager / the DB; live grids are rebuilt
// by replay in DuotrigordleGameSession.
const userSessions: Map<string, string> = new Map();
// Ephemeral live states for non-Discord (anonymous/local) users only.
const anonStates: Map<string, DuotrigordleLiveSession> = new Map();
let sessionsDate: string = new Date().toISOString().split('T')[0]!;

async function initGame() {
  const db = await DatabaseConnectionFactory.create({
    type: (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite') as 'sqlite' | 'postgresql',
    database: process.env.DATABASE_URL || 'duotrigordle-bot.db',
  });
  await new MigrationManager(db).migrate();

  sessionRepo = new GameStateRepository(db);
  const userRepo = new UserRepository(db);
  configRepo = new ConfigRepository(db);

  validator = new WordValidator();
  validator.loadWordLists();
  console.log(`Loaded ${validator.answerCount} answers, ${validator.guessCount} valid guesses`);

  const sessionManager = new SessionManager(sessionRepo);
  duotri = new DuotrigordleGameSession(validator, sessionManager);
  // Keep a reference for user upserts in getOrCreateSession.
  userRepoRef = userRepo;

  scheduleDailyCleanup();
}

let userRepoRef: UserRepository;

function scheduleDailyCleanup() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 5, 0);
  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  setTimeout(() => {
    console.log(`[cleanup] Purging ${userSessions.size} sessions for ${sessionsDate}`);
    userSessions.clear();
    anonStates.clear();
    sessionsDate = new Date().toISOString().split('T')[0]!;
    scheduleDailyCleanup();
  }, msUntilMidnight);

  console.log(`[cleanup] Next session purge in ${Math.round(msUntilMidnight / 60000)} minutes`);
}

/**
 * Get or create today's session id for a user, delegating resumption/creation
 * to SessionManager (via DuotrigordleGameSession). Returns null for non-Discord
 * users (localStorage fallback IDs) which are not persisted.
 */
async function getOrCreateSession(id: string, username?: string, guildId?: string): Promise<string | null> {
  if (id === 'default' || id.startsWith('local_')) {
    return null;
  }

  const today = new Date().toISOString().split('T')[0]!;
  if (today !== sessionsDate) {
    console.log(`[cleanup] Date rolled to ${today}, purging ${userSessions.size} stale sessions`);
    userSessions.clear();
    anonStates.clear();
    sessionsDate = today;
  }

  const cached = userSessions.get(id);
  if (cached) return cached;

  await userRepoRef.upsertUser(id, username || 'activity_user_' + id);
  const { session } = await duotri.startSession(id, guildId || 'activity');
  userSessions.set(id, session.id);
  return session.id;
}

function getAnonLive(id: string): DuotrigordleLiveSession {
  let live = anonStates.get(id);
  if (!live) {
    live = duotri.newAnonLive();
    anonStates.set(id, live);
  }
  return live;
}

/** Build a serializable state snapshot for the frontend */
function buildStateResponse(session: DuotrigordleLiveSession) {
  const summary = session.tracker.getSummary();
  const grids = session.gridManager.getGrids().map(g => ({
    gridIndex: g.gridIndex,
    guesses: g.guesses.map(q => ({
      word: q.word,
      feedback: q.feedback.map(f => ({ letter: f.letter, status: f.status })),
    })),
    isComplete: g.isComplete,
  }));

  return {
    grids,
    completedGrids: summary.completedGrids,
    totalGrids: summary.totalGrids,
    guessesUsed: summary.guessesUsed,
    guessesRemaining: summary.guessesRemaining,
    maxGuesses: summary.maxGuesses,
    isGameOver: summary.isGameOver || !!session.givenUp,
    isWin: summary.isWin,
    isLoss: summary.isLoss || !!session.givenUp,
    gaveUp: !!session.givenUp,
    progress: session.tracker.formatProgress(),
    // Reveal unsolved targets on game over
    unsolvedTargets: (summary.isGameOver || session.givenUp) ? session.gridManager.getUnsolvedTargets() : undefined,
    // Include target words on game over for the word list card
    targetWords: (summary.isGameOver || session.givenUp) ? session.puzzle.targetWords : undefined,
  };
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
app.use('/game', rateLimit({ maxRequests: 120, windowMs: 60_000, bucket: 'duotri-all' }));
app.use(['/game/guess', '/game/give-up'], rateLimit({ maxRequests: 45, windowMs: 60_000, bucket: 'duotri-play' }));

// Discord OAuth token exchange (for Activity)
app.post('/game/discord/token', async (req, res) => {
  const { code } = req.body;
  if (!code) { res.status(400).json({ error: 'code required' }); return; }

  try {
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DUOTRIGORDLE_CLIENT_ID || '',
        client_secret: process.env.DUOTRIGORDLE_CLIENT_SECRET || '',
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

// Get current game state
app.get('/game/state', async (req, res) => {
  const id = resolveUserId(req);
  const username = req.authUsername ?? (req.query.username as string | undefined);
  const guildId = req.query.guildId as string | undefined;
  console.log('[session] state request from:', id);

  const sessionId = await getOrCreateSession(id, username, guildId);
  const live = sessionId ? await duotri.getLive(sessionId) : getAnonLive(id);
  if (!live) { res.status(500).json({ error: 'failed to load session' }); return; }
  res.json(buildStateResponse(live));
});

// Submit a guess
app.post('/game/guess', async (req, res) => {
  const id = resolveUserId(req);
  const guildId = req.query.guildId as string | undefined;
  const { word } = req.body;
  const username = req.authUsername ?? req.body.username;
  console.log('[guess]', id, word);
  const validation = validateWordleGuess(word);
  if (!validation.ok) { res.status(400).json({ isValid: false, error: validation.error }); return; }
  const cleanWord = validation.value!;

  const sessionId = await getOrCreateSession(id, username, guildId);

  let live: DuotrigordleLiveSession;
  let result;
  if (sessionId) {
    if (guildId) await duotri.fixServerId(sessionId, guildId);
    const outcome = await duotri.processGuess(sessionId, cleanWord);
    if (!outcome) { res.status(500).json({ isValid: false, error: 'session not found' }); return; }
    result = outcome.result;
    live = outcome.live;
  } else {
    // Anonymous/local play — mutate ephemeral state, no persistence.
    live = getAnonLive(id);
    if (live.givenUp) { res.json({ isValid: false, error: 'Game is already over.' }); return; }
    result = live.gridManager.applyGuess(cleanWord);
  }

  if (!result.isValid) {
    res.json({ isValid: false, error: result.error });
    return;
  }

  res.json({
    isValid: true,
    ...buildStateResponse(live),
    newlyCompleted: result.completedGrids,
  });
});

// Post results to Discord channel
app.post('/game/complete', async (req, res) => {
  const { message, serverId } = req.body;
  console.log('[complete] serverId:', serverId, 'message:', message?.substring(0, 50));
  if (!message) { res.status(400).json({ error: 'message required' }); return; }

  try {
    const token = process.env.DUOTRIGORDLE_BOT_TOKEN;
    if (!token) { res.status(500).json({ error: 'bot token not configured' }); return; }

    let channelId = req.body.channelId;
    if (serverId) {
      const config = await configRepo?.getServerConfig(serverId);
      if (config) {
        const gameChannel = config.customSettings?.channels?.duotrigordle;
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
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [{
          title: '🟧 Duotrigordle Results',
          description: message,
          color: 0xff6b35,
        }],
      }),
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

// Give up — end game early when win is impossible
app.post('/game/give-up', async (req, res) => {
  const id = resolveUserId(req);
  const guildId = req.query.guildId as string | undefined;
  const { username: bodyUsername } = req.body || {};
  const username = req.authUsername ?? bodyUsername;
  console.log('[give-up]', id);

  const sessionId = await getOrCreateSession(id, username, guildId);
  let live: DuotrigordleLiveSession | null;
  if (sessionId) {
    if (guildId) await duotri.fixServerId(sessionId, guildId);
    live = await duotri.giveUp(sessionId);
  } else {
    live = getAnonLive(id);
    live.givenUp = true;
  }
  if (!live) { res.status(500).json({ error: 'session not found' }); return; }

  res.json(buildStateResponse(live));
});

// Reset session (testing)
app.post('/game/reset', async (req, res) => {
  const id = resolveUserId(req);
  console.log('[reset]', id);

  userSessions.delete(id);
  anonStates.delete(id);

  if (id !== 'default' && !id.startsWith('local_')) {
    const dbSession = await sessionRepo.getActiveSession(id, 'duotrigordle', new Date());
    if (dbSession) await sessionRepo.deleteSession(dbSession.id);
  }

  const sessionId = await getOrCreateSession(id);
  const live = sessionId ? await duotri.getLive(sessionId) : getAnonLive(id);
  res.json(buildStateResponse(live!));
});

// --- Start ---
// Fail fast if required config is missing (before binding the port).
validateConfigOrExit(
  ['DUOTRIGORDLE_CLIENT_ID', 'DUOTRIGORDLE_CLIENT_SECRET', 'DUOTRIGORDLE_BOT_TOKEN'],
  'duotrigordle-web'
);

app.use(express.static(path.resolve(process.cwd(), 'web/duotrigordle')));

const PORT = process.env.DUOTRIGORDLE_PORT || 3003;
initGame().then(() => {
  app.listen(PORT, () => {
    console.log(`Duotrigordle web running at http://localhost:${PORT}`);
  });
});
