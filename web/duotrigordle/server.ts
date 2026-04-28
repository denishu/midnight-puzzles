import express from 'express';
import path from 'path';
import { config } from 'dotenv';
import { GridManager, GRID_COUNT, MAX_GUESSES, DuotrigordlePuzzle } from '../../games/duotrigordle/GridManager';
import { WordValidator } from '../../games/duotrigordle/WordValidator';
import { ProgressTracker } from '../../games/duotrigordle/ProgressTracker';
import { DatabaseConnectionFactory } from '../../core/storage/DatabaseConnection';
import { GameStateRepository } from '../../core/storage/GameStateRepository';
import { UserRepository } from '../../core/storage/UserRepository';
import { ConfigRepository } from '../../core/storage/ConfigRepository';
import { MigrationManager } from '../../core/storage/migrations/migrate';

config();

const app = express();
app.use(express.json());

// --- Game setup ---
let validator: WordValidator;
let sessionRepo: GameStateRepository;
let userRepo: UserRepository;
let configRepo: ConfigRepository;

interface GameSession {
  gridManager: GridManager;
  tracker: ProgressTracker;
  puzzle: DuotrigordlePuzzle;
  givenUp?: boolean;
}

const sessions: Map<string, GameSession> = new Map();
let sessionsDate: string = new Date().toISOString().split('T')[0]!;

async function initGame() {
  const db = await DatabaseConnectionFactory.create({
    type: (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite') as 'sqlite' | 'postgresql',
    database: process.env.DATABASE_URL || 'duotrigordle-bot.db',
  });
  await new MigrationManager(db).migrate();

  sessionRepo = new GameStateRepository(db);
  userRepo = new UserRepository(db);
  configRepo = new ConfigRepository(db);

  validator = new WordValidator();
  validator.loadWordLists();
  console.log(`Loaded ${validator.answerCount} answers, ${validator.guessCount} valid guesses`);

  scheduleDailyCleanup();
}

function scheduleDailyCleanup() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 5, 0);
  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  setTimeout(() => {
    console.log(`[cleanup] Purging ${sessions.size} sessions for ${sessionsDate}`);
    sessions.clear();
    sessionsDate = new Date().toISOString().split('T')[0]!;
    scheduleDailyCleanup();
  }, msUntilMidnight);

  console.log(`[cleanup] Next session purge in ${Math.round(msUntilMidnight / 60000)} minutes`);
}

function getSession(id: string): GameSession {
  const today = new Date().toISOString().split('T')[0]!;
  if (today !== sessionsDate) {
    console.log(`[cleanup] Date rolled to ${today}, purging ${sessions.size} stale sessions`);
    sessions.clear();
    sessionsDate = today;
  }

  let session = sessions.get(id);
  if (!session) {
    const puzzle = GridManager.generateDailyPuzzle(new Date(), validator);
    const gm = new GridManager(validator);
    gm.initializeGrids(puzzle);
    const tracker = new ProgressTracker(gm);
    session = { gridManager: gm, tracker, puzzle };
    sessions.set(id, session);
  }
  return session;
}

/** Build a serializable state snapshot for the frontend */
function buildStateResponse(session: GameSession) {
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
    progress: session.tracker.formatProgress(),
    // Reveal unsolved targets on game over
    unsolvedTargets: (summary.isGameOver || session.givenUp) ? session.gridManager.getUnsolvedTargets() : undefined,
  };
}

/** Save a completed game to the DB so the bot can use it for recaps */
async function saveCompletedGame(userId: string, session: GameSession): Promise<void> {
  try {
    await userRepo.upsertUser(userId, 'activity_user_' + userId);

    const summary = session.tracker.getSummary();
    const existing = await sessionRepo.getActiveSession(userId, 'duotrigordle', new Date());

    if (existing) {
      await sessionRepo.updateGameData(existing.id, {
        gridsCompleted: summary.completedGrids,
        guessesUsed: summary.guessesUsed,
      });
      if (summary.isGameOver) {
        await sessionRepo.completeSession(existing.id, {
          isWin: summary.isWin,
          gridsCompleted: summary.completedGrids,
          guessesUsed: summary.guessesUsed,
        });
      }
    } else {
      const created = await sessionRepo.createSession({
        userId,
        serverId: 'activity',
        gameType: 'duotrigordle',
        puzzleDate: new Date(),
        maxAttempts: MAX_GUESSES,
        gameData: {
          gridsCompleted: summary.completedGrids,
          guessesUsed: summary.guessesUsed,
        },
      });
      if (summary.isGameOver) {
        await sessionRepo.completeSession(created.id, {
          isWin: summary.isWin,
          gridsCompleted: summary.completedGrids,
          guessesUsed: summary.guessesUsed,
        });
      }
    }
  } catch (e) {
    console.error('[db] Failed to save completed game:', e);
  }
}

// --- API endpoints ---

// Prevent Discord's Activity proxy from caching API responses
app.use('/game', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

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
    res.json({ access_token });
  } catch (e) {
    console.error('Token exchange failed:', e);
    res.status(500).json({ error: 'token exchange failed' });
  }
});

// Get current game state
app.get('/game/state', (req, res) => {
  const userId = (req.query.id as string) || 'default';
  console.log('[session] state request from:', userId);
  const session = getSession(userId);
  res.json(buildStateResponse(session));
});

// Submit a guess
app.post('/game/guess', async (req, res) => {
  const userId = (req.query.id as string) || 'default';
  const { word } = req.body;
  console.log('[guess]', userId, word);
  if (!word) { res.status(400).json({ error: 'word required' }); return; }

  const session = getSession(userId);

  if (session.givenUp) {
    res.json({ isValid: false, error: 'Game is already over.' });
    return;
  }

  const result = session.gridManager.applyGuess(word);

  if (!result.isValid) {
    res.json({ isValid: false, error: result.error });
    return;
  }

  // Save to DB when game completes
  if (result.isGameOver && userId !== 'default' && !userId.startsWith('local_')) {
    await saveCompletedGame(userId, session);
  }

  res.json({
    isValid: true,
    ...buildStateResponse(session),
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
      if (config?.channelId) channelId = config.channelId;
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
          title: '📝 Duotrigordle Results',
          description: message,
          color: 0x22c55e,
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
  const userId = (req.query.id as string) || 'default';
  console.log('[give-up]', userId);
  const session = getSession(userId);

  session.givenUp = true;

  // Save as completed loss
  if (userId !== 'default' && !userId.startsWith('local_')) {
    await saveCompletedGame(userId, session);
  }

  res.json(buildStateResponse(session));
});

// Reset session (testing)
app.post('/game/reset', (req, res) => {
  const userId = (req.query.id as string) || 'default';
  console.log('[reset]', userId);
  sessions.delete(userId);
  const session = getSession(userId);
  res.json(buildStateResponse(session));
});

// --- Start ---
app.use(express.static(path.resolve(process.cwd(), 'web/duotrigordle')));

const PORT = process.env.DUOTRIGORDLE_PORT || 3003;
initGame().then(() => {
  app.listen(PORT, () => {
    console.log(`Duotrigordle web running at http://localhost:${PORT}`);
  });
});
