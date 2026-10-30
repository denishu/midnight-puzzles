import { config } from 'dotenv';
import { Express } from 'express';
import { BaseGameServer, GameServerConfig } from '../../core/web/BaseGameServer';
import { resolveUserId } from '../../core/auth/ActivityAuth';
import { validateWordleGuess } from '../../core/utils/InputValidator';
import { Logger } from '../../core/utils/Logger';
import { BetweenleGame, BetweenleState, BetweenleWords, MAX_GUESSES, guessesRemaining } from '../../games/betweenle';

config();
const log = new Logger('betweenle-web');

const CONFIG: GameServerConfig = {
  gameType: 'betweenle',
  dbFile: 'betweenle-bot.db',
  clientIdEnv: 'BETWEENLE_CLIENT_ID',
  clientSecretEnv: 'BETWEENLE_CLIENT_SECRET',
  botTokenEnv: 'BETWEENLE_BOT_TOKEN',
  requiredEnv: ['BETWEENLE_CLIENT_ID', 'BETWEENLE_CLIENT_SECRET', 'BETWEENLE_BOT_TOKEN'],
  port: process.env.BETWEENLE_PORT || 3004,
  staticDir: 'web/betweenle',
  configLabel: 'betweenle-web',
  rateLimits: [
    { paths: '/game', maxRequests: 120, windowMs: 60_000, bucket: 'betweenle-all' },
    { paths: ['/game/guess'], maxRequests: 45, windowMs: 60_000, bucket: 'betweenle-play' },
  ],
  completeEmbed: { title: '🔤 Betweenle Results', color: 0x8f3f50, channelKey: 'betweenle' },
};

const server = new BaseGameServer(CONFIG);
let game: BetweenleGame;

// Ephemeral states for anonymous/local (non-Discord) users only.
const anonStates: Map<string, BetweenleState> = new Map();
function getAnonState(id: string): BetweenleState {
  let s = anonStates.get(id);
  if (!s) { s = game.newState(new Date()); anonStates.set(id, s); }
  return s;
}

/** Client-safe view of the state (never leaks the secret until the game is over). */
function view(state: BetweenleState) {
  const over = state.isComplete;
  return {
    puzzleDate: state.puzzleDate,
    guesses: state.guesses.map(g => ({ word: g.word, direction: g.direction, distance: g.distance })),
    lowerBound: state.lowerBound,
    upperBound: state.upperBound,
    guessesUsed: state.guesses.length,
    guessesRemaining: guessesRemaining(state),
    maxGuesses: MAX_GUESSES,
    isComplete: over,
    isWin: state.isWin,
    score: over ? state.score : undefined,
    secret: over ? state.secret : undefined,
  };
}

server.listen(
  // --- init: load words, build the game, return session hooks ---
  async (ctx) => {
    const words = new BetweenleWords();
    words.loadFromDisk();
    log.info(`Loaded ${words.answersList.length} answers, ${words.size} dictionary words`);
    game = new BetweenleGame(words);

    return {
      // Create/resume today's persisted session, seeding gameData with a fresh
      // BetweenleState when new. Returns the session id.
      startSession: async (userId, serverId) => {
        const existing = await ctx.sessionRepo.getActiveSession(userId, 'betweenle', new Date());
        if (existing && (existing.gameData as any)?.secret) {
          if (serverId && serverId !== 'activity' && existing.serverId === 'activity') {
            await ctx.sessionRepo.updateServerId(existing.id, serverId);
          }
          return existing.id;
        }
        const state = game.newState(new Date());
        const created = await ctx.sessionRepo.createSession({
          userId, serverId, gameType: 'betweenle',
          puzzleDate: new Date(), maxAttempts: MAX_GUESSES, gameData: state as any,
        });
        return created.id;
      },
      onDailyCleanup: () => anonStates.clear(),
    };
  },
  // --- registerRoutes: Betweenle gameplay endpoints ---
  (app: Express, base: BaseGameServer) => {
    const ctx = base.context;

    async function loadPersisted(sessionId: string): Promise<BetweenleState | null> {
      const s = await ctx.sessionRepo.getSession(sessionId);
      if (!s || !(s.gameData as any)?.secret) return null;
      return s.gameData as unknown as BetweenleState;
    }

    async function savePersisted(sessionId: string, state: BetweenleState): Promise<void> {
      await ctx.sessionRepo.updateGameData(sessionId, state as any);
      if (state.isComplete) {
        await ctx.sessionRepo.completeSession(sessionId, {
          isWin: state.isWin, guessCount: state.guesses.length, score: state.score,
        });
      }
    }

    app.get('/game/state', async (req, res) => {
      const id = resolveUserId(req);
      const username = req.authUsername ?? (req.query.username as string | undefined);
      const guildId = req.query.guildId as string | undefined;

      const sessionId = await base.getOrCreateSession(id, username, guildId);
      const state = sessionId ? await loadPersisted(sessionId) : getAnonState(id);
      if (!state) { res.status(500).json({ error: 'failed to load session' }); return; }
      res.json(view(state));
    });

    app.post('/game/guess', async (req, res) => {
      const id = resolveUserId(req);
      const username = req.authUsername ?? req.body.username;
      const guildId = req.query.guildId as string | undefined;
      const { word } = req.body;

      const validation = validateWordleGuess(word);
      if (!validation.ok) { res.status(400).json({ isValid: false, error: validation.error }); return; }
      const clean = validation.value!;

      const sessionId = await base.getOrCreateSession(id, username, guildId);
      let state: BetweenleState | null;
      if (sessionId) {
        state = await loadPersisted(sessionId);
        if (!state) { res.status(500).json({ isValid: false, error: 'session not found' }); return; }
        const outcome = game.guess(state, clean);
        if (!outcome.ok) { res.json({ isValid: false, error: outcome.error }); return; }
        await savePersisted(sessionId, state);
      } else {
        state = getAnonState(id);
        const outcome = game.guess(state, clean);
        if (!outcome.ok) { res.json({ isValid: false, error: outcome.error }); return; }
      }

      res.json({ isValid: true, ...view(state) });
    });

    app.post('/game/reset', async (req, res) => {
      const id = resolveUserId(req);
      base.forgetSession(id);
      anonStates.delete(id);
      if (id !== 'default' && !id.startsWith('local_')) {
        const dbSession = await ctx.sessionRepo.getActiveSession(id, 'betweenle', new Date());
        if (dbSession) await ctx.sessionRepo.deleteSession(dbSession.id);
      }
      const sessionId = await base.getOrCreateSession(id);
      const state = sessionId ? await loadPersisted(sessionId) : getAnonState(id);
      res.json(view(state!));
    });
  },
);
