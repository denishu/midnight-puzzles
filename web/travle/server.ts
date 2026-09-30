import { config } from 'dotenv';
import { Express } from 'express';
import { CountryGraph } from '../../games/travle/CountryGraph';
import { TravleGameState } from '../../games/travle/TravleGame';
import { TravleGameSession } from '../../games/travle/TravleGameSession';
import { resolveUserId } from '../../core/auth/ActivityAuth';
import { validateGuessText } from '../../core/utils/InputValidator';
import { BaseGameServer, GameServerConfig } from '../../core/web/BaseGameServer';

config();

const CONFIG: GameServerConfig = {
  gameType: 'travle',
  dbFile: 'travle-bot.db',
  clientIdEnv: 'TRAVLE_CLIENT_ID',
  clientSecretEnv: 'TRAVLE_CLIENT_SECRET',
  botTokenEnv: 'TRAVLE_BOT_TOKEN',
  requiredEnv: ['TRAVLE_CLIENT_ID', 'TRAVLE_CLIENT_SECRET', 'TRAVLE_BOT_TOKEN'],
  port: process.env.PORT || 3002,
  staticDir: 'web/travle',
  configLabel: 'travle-web',
  rateLimits: [
    { paths: '/game', maxRequests: 120, windowMs: 60_000, bucket: 'travle-all' },
    { paths: ['/game/guess', '/game/hint'], maxRequests: 30, windowMs: 60_000, bucket: 'travle-play' },
  ],
  completeEmbed: { title: '🧭 Travle Results', color: 0x00aa55, channelKey: 'travle' },
};

const server = new BaseGameServer(CONFIG);
let travle: TravleGameSession;
let graph: CountryGraph;

// Ephemeral in-memory states for non-Discord (anonymous/local) users only.
// These are never persisted; they let local play work without a DB session.
const anonStates: Map<string, TravleGameState> = new Map();
function getAnonState(id: string): TravleGameState {
  let state = anonStates.get(id);
  if (!state) {
    state = travle.newAnonState(new Date());
    anonStates.set(id, state);
  }
  return state;
}

server.start(
  // --- init: build the game object, return session hooks ---
  async (ctx) => {
    const g = new CountryGraph();
    await g.initialize();
    graph = g;
    travle = new TravleGameSession(g, ctx.sessionManager);
    travle.init();
    console.log('Travle game initialized');

    return {
      startSession: async (userId, serverId) => {
        const session = await travle.startSession(userId, serverId);
        return session.id;
      },
      onDailyCleanup: () => anonStates.clear(),
    };
  },
  // --- registerRoutes: Travle-specific gameplay endpoints ---
  (app: Express, base: BaseGameServer) => {
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

    // Get today's puzzle
    app.get('/game/puzzle', async (req, res) => {
      const id = resolveUserId(req);
      const username = req.authUsername ?? (req.query.username as string | undefined);
      const guildId = req.query.guildId as string | undefined;
      console.log('[session] puzzle request from:', id);

      const sessionId = await base.getOrCreateSession(id, username, guildId);
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

      const sessionId = await base.getOrCreateSession(id, username, guildId);

      let state: TravleGameState;
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
      const sessionId = await base.getOrCreateSession(id);
      const state = sessionId ? await travle.getState(sessionId) : getAnonState(id);
      if (!state) { res.json({ hint: null }); return; }

      if (state.isComplete) { res.json({ hint: null }); return; }

      const freeSet = new Set(state.guesses.map(g => g.country));
      const path = graph.weightedShortestPath(state.puzzle.start, state.puzzle.end, freeSet);
      if (!path) { res.json({ hint: null }); return; }

      // Find unguessed countries on the path (exclude start and end)
      const guessedSet = new Set([...freeSet, state.puzzle.start, state.puzzle.end]);
      const unguessed = path.filter(c => !guessedSet.has(c));
      if (unguessed.length === 0) { res.json({ hint: null }); return; }

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

      console.log('[hint]', id, '->', closest);
      res.json({ hint: closest });
    });

    // Reset session
    app.post('/game/reset', async (req, res) => {
      const id = resolveUserId(req);
      console.log('[reset]', id);

      // Drop the cached session id + any anonymous state.
      base.forgetSession(id);
      anonStates.delete(id);

      // Delete the persisted session so the next request starts fresh.
      if (id !== 'default' && !id.startsWith('local_')) {
        const dbSession = await base.context.sessionRepo.getActiveSession(id, 'travle', new Date());
        if (dbSession) await base.context.sessionRepo.deleteSession(dbSession.id);
      }

      // Return a fresh puzzle state (re-creates the session on demand).
      const sessionId = await base.getOrCreateSession(id);
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
  },
);
