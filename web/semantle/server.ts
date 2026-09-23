import express from 'express';
import path from 'path';
import { config } from 'dotenv';
import { SemantleGame } from '../../games/semantle/SemantleGame';
import { SemanticEngine } from '../../games/semantle/SemanticEngine';
import { SessionManager } from '../../core/auth/SessionManager';
import { verifyDiscordToken, issueSessionToken, authMiddleware, resolveUserId } from '../../core/auth/ActivityAuth';
import { rateLimit } from '../../core/auth/RateLimit';
import { validateConfigOrExit } from '../../core/utils/ConfigValidator';
import { validateGuessText } from '../../core/utils/InputValidator';
import { DatabaseConnectionFactory } from '../../core/storage/DatabaseConnection';
import { GameStateRepository } from '../../core/storage/GameStateRepository';
import { DailyPuzzleRepository } from '../../core/storage/DailyPuzzleRepository';
import { ConfigRepository } from '../../core/storage/ConfigRepository';
import { UserRepository } from '../../core/storage/UserRepository';
import { MigrationManager } from '../../core/storage/migrations/migrate';

config();

const app = express();
app.use(express.json());
// Trust the reverse proxy so req.ip reflects the real client (used as the
// rate-limit key for anonymous/local play behind Discord's proxy / nginx).
app.set('trust proxy', 1);

// --- Game setup ---
let semantleGame: SemantleGame;
let sessionRepo: GameStateRepository;
let userRepo: UserRepository;
let configRepo: ConfigRepository;

// In-memory session map: discordUserId -> gameSessionId
const userSessions: Map<string, string> = new Map();
let sessionsDate: string = new Date().toISOString().split('T')[0]!;

async function initGame() {
  const db = await DatabaseConnectionFactory.create({
    type: (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite') as 'sqlite' | 'postgresql',
    database: process.env.DATABASE_URL || 'semantle-bot.db',
  });
  await new MigrationManager(db).migrate();

  sessionRepo = new GameStateRepository(db);
  userRepo = new UserRepository(db);
  configRepo = new ConfigRepository(db);

  const dailyPuzzleRepo = new DailyPuzzleRepository(db);
  const sessionManager = new SessionManager(sessionRepo);
  const semanticEngine = new SemanticEngine();

  semantleGame = new SemantleGame(semanticEngine, sessionManager, dailyPuzzleRepo);
  await semantleGame.initialize();

  console.log('Semantle game initialized');
  scheduleDailyCleanup();
}

function scheduleDailyCleanup() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 5, 0);
  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  setTimeout(() => {
    console.log(`[cleanup] Purging ${userSessions.size} sessions for ${sessionsDate}`);
    userSessions.clear();
    sessionsDate = new Date().toISOString().split('T')[0]!;
    scheduleDailyCleanup();
  }, msUntilMidnight);

  console.log(`[cleanup] Next session purge in ${Math.round(msUntilMidnight / 60000)} minutes`);
}

async function getOrCreateSession(userId: string, username?: string, guildId?: string): Promise<string | null> {
  // Skip DB persistence for non-Discord users (localStorage fallback IDs)
  if (userId === 'default' || userId.startsWith('local_')) {
    return null;
  }

  // Date rollover check
  const today = new Date().toISOString().split('T')[0]!;
  if (today !== sessionsDate) {
    userSessions.clear();
    sessionsDate = today;
  }

  const sessionId = userSessions.get(userId);
  if (sessionId) return sessionId;

  // Ensure user exists
  await userRepo.upsertUser(userId, username || 'activity_user_' + userId);

  const session = await semantleGame.startSession(userId, guildId || 'activity');
  userSessions.set(userId, session.id);
  return session.id;
}

// --- API endpoints ---

// Prevent caching
app.use('/game', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Verify session JWT (if present) and attach req.userId. Never trusts ?id=.
app.use('/game', authMiddleware);

// Rate limiting (keyed per verified user, IP fallback for anonymous play).
// General cap across all /game routes, plus a tighter cap on the expensive
// guess/hint routes that hit the semantic engine + DB.
app.use('/game', rateLimit({ maxRequests: 120, windowMs: 60_000, bucket: 'semantle-all' }));
app.use(['/game/guess', '/game/hint'], rateLimit({ maxRequests: 30, windowMs: 60_000, bucket: 'semantle-play' }));

// Discord OAuth token exchange
app.post('/game/discord/token', async (req, res) => {
  const { code } = req.body;
  if (!code) { res.status(400).json({ error: 'code required' }); return; }

  try {
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.SEMANTLE_CLIENT_ID || '',
        client_secret: process.env.SEMANTLE_CLIENT_SECRET || '',
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
    // own signed session token. The client sends this back as a Bearer token;
    // endpoints trust it instead of a client-supplied ?id=.
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
  const userId = resolveUserId(req);
  const username = req.authUsername ?? (req.query.username as string | undefined);
  const guildId = req.query.guildId as string | undefined;
  console.log('[session] state request from:', userId);

  try {
    const sessionId = await getOrCreateSession(userId, username, guildId);

    if (!sessionId) {
      // Non-Discord user — return empty state without persisting
      res.json({ guessCount: 0, isComplete: false, guesses: [], thresholds: null });
      return;
    }

    const gameState = await semantleGame.getGameState(sessionId);
    const session = gameState.session;
    const guesses = (session.gameData.guesses || []).map((g: any) => ({
      word: g.word,
      similarity: g.similarity,
      rank: g.rank,
    }));

    // Get similarity thresholds for the target word
    const targetWord = session.gameData.targetWord;
    const thresholds = semantleGame.getSimilarityThresholds(targetWord);

    res.json({
      guessCount: session.attempts,
      isComplete: session.isComplete,
      bestRank: session.gameData.bestRank,
      guesses,
      thresholds,
      targetWord: session.isComplete ? session.gameData.targetWord : undefined,
    });
  } catch (e) {
    console.error('[state] Error:', e);
    res.status(500).json({ error: 'failed to get state' });
  }
});

// Submit a guess
app.post('/game/guess', async (req, res) => {
  const userId = resolveUserId(req);
  const guildId = req.query.guildId as string | undefined;
  const { word } = req.body;
  const username = req.authUsername ?? req.body.username;
  console.log('[guess]', userId, word);
  const validation = validateGuessText(word);
  if (!validation.ok) { res.status(400).json({ error: validation.error }); return; }
  const cleanWord = validation.value!;

  try {
    const sessionId = await getOrCreateSession(userId, username, guildId);
    if (!sessionId) {
      res.status(403).json({ isValid: false, feedback: 'Discord authentication required to play.' });
      return;
    }

    // Fix server_id if we have guild ID (handles cached sessions that missed it on creation)
    if (guildId) {
      const existingSession = await sessionRepo.getActiveSession(userId, 'semantle', new Date());
      if (existingSession && existingSession.serverId === 'activity') {
        await sessionRepo.updateServerId(existingSession.id, guildId);
      }
    }

    const result = await semantleGame.processGuess(sessionId, cleanWord);

    // Get the current session state to include server-side guess count
    const currentState = await semantleGame.getGameState(sessionId);
    const serverGuessCount = currentState.session.gameData.guesses?.length || 0;

    res.json({
      isValid: result.isValid,
      feedback: result.feedback,
      isComplete: result.isComplete,
      similarity: result.data?.similarity,
      rank: result.data?.rank,
      bestRank: result.data?.bestRank,
      targetWord: result.isComplete ? result.data?.result?.targetWord : undefined,
      serverGuessCount,
    });
  } catch (e) {
    console.error('[guess] Error:', e);
    res.status(500).json({ error: 'failed to process guess' });
  }
});

// Get a hint
app.get('/game/hint', async (req, res) => {
  const userId = resolveUserId(req);
  const guildId = req.query.guildId as string | undefined;
  console.log('[hint]', userId);

  try {
    const sessionId = await getOrCreateSession(userId, undefined, guildId);
    if (!sessionId) {
      res.json({ hint: null });
      return;
    }
    const hint = await semantleGame.getHint(sessionId);
    if (!hint) {
      res.json({ hint: null });
      return;
    }
    res.json({ hint: hint.word, rank: hint.rank });
  } catch (e) {
    console.error('[hint] Error:', e);
    res.status(500).json({ error: 'failed to get hint' });
  }
});

// Post results to Discord channel
app.post('/game/complete', async (req, res) => {
  const { message, serverId } = req.body;
  if (!message) { res.status(400).json({ error: 'message required' }); return; }

  try {
    const token = process.env.SEMANTLE_BOT_TOKEN;
    if (!token) { res.status(500).json({ error: 'bot token not configured' }); return; }

    let channelId = req.body.channelId;
    if (serverId) {
      const config = await configRepo?.getServerConfig(serverId);
      if (config) {
        const gameChannel = config.customSettings?.channels?.semantle;
        if (gameChannel) channelId = gameChannel;
        else if (config.channelId) channelId = config.channelId;
      }
    }
    if (!channelId) { res.status(400).json({ error: 'no channel configured' }); return; }

    const discordResp = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [{
          title: '🔮 Semantle Results',
          description: message,
          color: 0x9932cc,
        }],
      }),
    });

    if (!discordResp.ok) {
      const err = await discordResp.text();
      console.error('[complete] Discord API error:', discordResp.status, err);
      res.status(500).json({ error: 'discord api error' });
      return;
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('Failed to post results:', e);
    res.status(500).json({ error: 'failed to post' });
  }
});

// Reset session (for testing)
app.post('/game/reset', async (req, res) => {
  const userId = resolveUserId(req);
  console.log('[reset]', userId);
  userSessions.delete(userId);
  // Delete from DB
  const dbSession = await sessionRepo.getActiveSession(userId, 'semantle', new Date());
  if (dbSession) await sessionRepo.deleteSession(dbSession.id);
  res.json({ ok: true, message: 'Reset. Restart the server to fully clear in-memory caches.' });
});

// --- Start ---
// Fail fast if required config is missing (before binding the port).
validateConfigOrExit(
  ['SEMANTLE_CLIENT_ID', 'SEMANTLE_CLIENT_SECRET', 'SEMANTLE_BOT_TOKEN'],
  'semantle-web'
);

app.use(express.static(path.resolve(process.cwd(), 'web/semantle')));

const PORT = process.env.SEMANTLE_PORT || 3001;
initGame().then(() => {
  app.listen(PORT, () => {
    console.log(`Semantle web running at http://localhost:${PORT}`);
  });
});
