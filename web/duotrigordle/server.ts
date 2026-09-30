import { config } from 'dotenv';
import { Express } from 'express';
import { WordValidator } from '../../games/duotrigordle/WordValidator';
import { DuotrigordleGameSession, DuotrigordleLiveSession } from '../../games/duotrigordle/DuotrigordleGameSession';
import { resolveUserId } from '../../core/auth/ActivityAuth';
import { validateWordleGuess } from '../../core/utils/InputValidator';
import { BaseGameServer, GameServerConfig } from '../../core/web/BaseGameServer';

config();

const CONFIG: GameServerConfig = {
  gameType: 'duotrigordle',
  dbFile: 'duotrigordle-bot.db',
  clientIdEnv: 'DUOTRIGORDLE_CLIENT_ID',
  clientSecretEnv: 'DUOTRIGORDLE_CLIENT_SECRET',
  botTokenEnv: 'DUOTRIGORDLE_BOT_TOKEN',
  requiredEnv: ['DUOTRIGORDLE_CLIENT_ID', 'DUOTRIGORDLE_CLIENT_SECRET', 'DUOTRIGORDLE_BOT_TOKEN'],
  port: process.env.DUOTRIGORDLE_PORT || 3003,
  staticDir: 'web/duotrigordle',
  configLabel: 'duotrigordle-web',
  rateLimits: [
    { paths: '/game', maxRequests: 120, windowMs: 60_000, bucket: 'duotri-all' },
    { paths: ['/game/guess', '/game/give-up'], maxRequests: 45, windowMs: 60_000, bucket: 'duotri-play' },
  ],
  completeEmbed: { title: '🟧 Duotrigordle Results', color: 0xff6b35, channelKey: 'duotrigordle' },
};

const server = new BaseGameServer(CONFIG);
let duotri: DuotrigordleGameSession;

// Ephemeral live states for non-Discord (anonymous/local) users only.
const anonStates: Map<string, DuotrigordleLiveSession> = new Map();
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
    unsolvedTargets: (summary.isGameOver || session.givenUp) ? session.gridManager.getUnsolvedTargets() : undefined,
    targetWords: (summary.isGameOver || session.givenUp) ? session.puzzle.targetWords : undefined,
  };
}

server.listen(// --- init: build the game object, return session hooks ---
async (ctx) => {
  const validator = new WordValidator();
  validator.loadWordLists();
  console.log(`Loaded ${validator.answerCount} answers, ${validator.guessCount} valid guesses`);

  duotri = new DuotrigordleGameSession(validator, ctx.sessionManager);

  return {
    startSession: async (userId, serverId) => {
      const { session } = await duotri.startSession(userId, serverId);
      return session.id;
    },
    onDailyCleanup: () => anonStates.clear(),
  };
},
// --- registerRoutes: Duotrigordle-specific gameplay endpoints ---
(app: Express, base: BaseGameServer) => {
  // Get current game state
  app.get('/game/state', async (req, res) => {
    const id = resolveUserId(req);
    const username = req.authUsername ?? (req.query.username as string | undefined);
    const guildId = req.query.guildId as string | undefined;
    console.log('[session] state request from:', id);

    const sessionId = await base.getOrCreateSession(id, username, guildId);
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

    const sessionId = await base.getOrCreateSession(id, username, guildId);

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

    if (!result.isValid) { res.json({ isValid: false, error: result.error }); return; }

    res.json({
      isValid: true,
      ...buildStateResponse(live),
      newlyCompleted: result.completedGrids,
    });
  });

  // Give up — end game early when win is impossible
  app.post('/game/give-up', async (req, res) => {
    const id = resolveUserId(req);
    const guildId = req.query.guildId as string | undefined;
    const { username: bodyUsername } = req.body || {};
    const username = req.authUsername ?? bodyUsername;
    console.log('[give-up]', id);

    const sessionId = await base.getOrCreateSession(id, username, guildId);
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

    base.forgetSession(id);
    anonStates.delete(id);

    if (id !== 'default' && !id.startsWith('local_')) {
      const dbSession = await base.context.sessionRepo.getActiveSession(id, 'duotrigordle', new Date());
      if (dbSession) await base.context.sessionRepo.deleteSession(dbSession.id);
    }

    const sessionId = await base.getOrCreateSession(id);
    const live = sessionId ? await duotri.getLive(sessionId) : getAnonLive(id);
    res.json(buildStateResponse(live!));
  });
},);
