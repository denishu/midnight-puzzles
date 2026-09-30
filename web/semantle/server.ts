import { config } from 'dotenv';
import { Express } from 'express';
import { SemantleGame } from '../../games/semantle/SemantleGame';
import { SemanticEngine } from '../../games/semantle/SemanticEngine';
import { DailyPuzzleRepository } from '../../core/storage/DailyPuzzleRepository';
import { resolveUserId } from '../../core/auth/ActivityAuth';
import { validateGuessText } from '../../core/utils/InputValidator';
import { BaseGameServer, GameServerConfig } from '../../core/web/BaseGameServer';
import { Logger } from '../../core/utils/Logger';

config();

const log = new Logger('semantle-web');

const CONFIG: GameServerConfig = {
  gameType: 'semantle',
  dbFile: 'semantle-bot.db',
  clientIdEnv: 'SEMANTLE_CLIENT_ID',
  clientSecretEnv: 'SEMANTLE_CLIENT_SECRET',
  botTokenEnv: 'SEMANTLE_BOT_TOKEN',
  requiredEnv: ['SEMANTLE_CLIENT_ID', 'SEMANTLE_CLIENT_SECRET', 'SEMANTLE_BOT_TOKEN'],
  port: process.env.SEMANTLE_PORT || 3001,
  staticDir: 'web/semantle',
  configLabel: 'semantle-web',
  rateLimits: [
    { paths: '/game', maxRequests: 120, windowMs: 60_000, bucket: 'semantle-all' },
    { paths: ['/game/guess', '/game/hint'], maxRequests: 30, windowMs: 60_000, bucket: 'semantle-play' },
  ],
  completeEmbed: { title: '🔮 Semantle Results', color: 0x9932cc, channelKey: 'semantle' },
};

const server = new BaseGameServer(CONFIG);
let semantleGame: SemantleGame;

server.listen(// --- init: build the game object, return session hooks ---
async (ctx) => {
  const dailyPuzzleRepo = new DailyPuzzleRepository(ctx.db);
  const semanticEngine = new SemanticEngine();
  semantleGame = new SemantleGame(semanticEngine, ctx.sessionManager, dailyPuzzleRepo);
  await semantleGame.initialize();
  log.info('Semantle game initialized');

  return {
    startSession: async (userId, serverId) => {
      const session = await semantleGame.startSession(userId, serverId);
      return session.id;
    },
  };
},
// --- registerRoutes: Semantle-specific gameplay endpoints ---
(app: Express, base: BaseGameServer) => {
  // Get current game state
  app.get('/game/state', async (req, res) => {
    const userId = resolveUserId(req);
    const username = req.authUsername ?? (req.query.username as string | undefined);
    const guildId = req.query.guildId as string | undefined;
    log.debug('[state] request', { userId });

    try {
      const sessionId = await base.getOrCreateSession(userId, username, guildId);
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
      log.error('[state] error', { error: e });
      res.status(500).json({ error: 'failed to get state' });
    }
  });

  // Submit a guess
  app.post('/game/guess', async (req, res) => {
    const userId = resolveUserId(req);
    const guildId = req.query.guildId as string | undefined;
    const { word } = req.body;
    const username = req.authUsername ?? req.body.username;
    log.debug('[guess]', { userId, word });
    const validation = validateGuessText(word);
    if (!validation.ok) { res.status(400).json({ error: validation.error }); return; }
    const cleanWord = validation.value!;

    try {
      const sessionId = await base.getOrCreateSession(userId, username, guildId);
      if (!sessionId) {
        res.status(403).json({ isValid: false, feedback: 'Discord authentication required to play.' });
        return;
      }

      // Fix server_id if we have guild ID (handles cached sessions that missed it on creation)
      if (guildId) {
        const existingSession = await base.context.sessionRepo.getActiveSession(userId, 'semantle', new Date());
        if (existingSession && existingSession.serverId === 'activity') {
          await base.context.sessionRepo.updateServerId(existingSession.id, guildId);
        }
      }

      const result = await semantleGame.processGuess(sessionId, cleanWord);

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
      log.error('[guess] error', { error: e });
      res.status(500).json({ error: 'failed to process guess' });
    }
  });

  // Get a hint
  app.get('/game/hint', async (req, res) => {
    const userId = resolveUserId(req);
    const guildId = req.query.guildId as string | undefined;
    log.debug('[hint]', { userId });

    try {
      const sessionId = await base.getOrCreateSession(userId, undefined, guildId);
      if (!sessionId) { res.json({ hint: null }); return; }
      const hint = await semantleGame.getHint(sessionId);
      if (!hint) { res.json({ hint: null }); return; }
      res.json({ hint: hint.word, rank: hint.rank });
    } catch (e) {
      log.error('[hint] error', { error: e });
      res.status(500).json({ error: 'failed to get hint' });
    }
  });

  // Reset session (for testing)
  app.post('/game/reset', async (req, res) => {
    const userId = resolveUserId(req);
    log.debug('[reset]', { userId });
    base.forgetSession(userId);
    const dbSession = await base.context.sessionRepo.getActiveSession(userId, 'semantle', new Date());
    if (dbSession) await base.context.sessionRepo.deleteSession(dbSession.id);
    res.json({ ok: true, message: 'Reset. Restart the server to fully clear in-memory caches.' });
  });
},);
