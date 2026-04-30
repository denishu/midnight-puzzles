import express from 'express';
import path from 'path';
import { config } from 'dotenv';
import { CountryGraph } from '../../games/travle/CountryGraph';
import { TravleGame, TravleGameState } from '../../games/travle/TravleGame';
import { DatabaseConnectionFactory, DatabaseConnection } from '../../core/storage/DatabaseConnection';
import { GameStateRepository } from '../../core/storage/GameStateRepository';
import { UserRepository } from '../../core/storage/UserRepository';
import { ConfigRepository } from '../../core/storage/ConfigRepository';
import { MigrationManager } from '../../core/storage/migrations/migrate';

config();

const app = express();
app.use(express.json());

// --- Game setup ---
let travleGame: TravleGame;
let graph: CountryGraph;
let sessionRepo: GameStateRepository;
let userRepo: UserRepository;
let configRepo: ConfigRepository;
const sessions: Map<string, TravleGameState> = new Map();

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
  travleGame = new TravleGame(g);
  travleGame.init();
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
    console.log(`[cleanup] Purging ${sessions.size} sessions for ${sessionsDate}`);
    sessions.clear();
    sessionsDate = new Date().toISOString().split('T')[0]!;
    // Reschedule for next day
    scheduleDailyCleanup();
  }, msUntilMidnight);

  console.log(`[cleanup] Next session purge in ${Math.round(msUntilMidnight / 60000)} minutes`);
}

function getSession(id: string): TravleGameState {
  // If the date rolled over but cleanup hasn't fired yet, clear now
  const today = new Date().toISOString().split('T')[0]!;
  if (today !== sessionsDate) {
    console.log(`[cleanup] Date rolled to ${today}, purging ${sessions.size} stale sessions`);
    sessions.clear();
    sessionsDate = today;
  }

  let state = sessions.get(id);
  if (!state) {
    const puzzle = travleGame.genPuzzle(new Date());
    state = travleGame.newState(puzzle);
    sessions.set(id, state);
  }
  return state;
}

/** Save a completed game to the DB so the bot can use it for recaps */
async function saveCompletedGame(userId: string, state: TravleGameState): Promise<void> {
  try {
    // Ensure user exists (upsert with a placeholder username — bot will have the real one)
    await userRepo.upsertUser(userId, 'activity_user_' + userId);

    // Check if session already exists for today
    const existing = await sessionRepo.getActiveSession(userId, 'travle', new Date());
    if (existing) {
      await sessionRepo.updateGameData(existing.id, state as any);
      if (state.isComplete) {
        await sessionRepo.completeSession(existing.id, {
          isWin: state.isWin,
          guessCount: state.guesses.length,
          shortestPath: state.puzzle.shortestPathLength,
        });
      }
    } else {
      await sessionRepo.createSession({
        userId,
        serverId: 'activity', // Activity sessions don't have a guild context
        gameType: 'travle',
        puzzleDate: new Date(),
        maxAttempts: state.puzzle.maxGuesses,
        gameData: state as any,
      });
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
    res.json({ access_token });
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

// Get today's puzzle
app.get('/game/puzzle', (req, res) => {
  const sessionId = (req.query.id as string) || 'default';
  console.log('[session] puzzle request from:', sessionId);
  const state = getSession(sessionId);
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
  const sessionId = (req.query.id as string) || 'default';
  const { country } = req.body;
  console.log('[guess]', sessionId, country);
  if (!country) { res.status(400).json({ error: 'country required' }); return; }

  const state = getSession(sessionId);
  const result = travleGame.guess(state, country);

  // Save to DB when game completes (sessionId is the Discord user ID)
  if (result.isGameOver && sessionId !== 'default' && !sessionId.startsWith('local_')) {
    await saveCompletedGame(sessionId, state);
  }

  res.json({
    ...result,
    guesses: state.guesses,
    guessesRemaining: state.guessesRemaining,
  });
});

// Get a hint: reveal an unguessed country on the cheapest path
app.get('/game/hint', (req, res) => {
  const sessionId = (req.query.id as string) || 'default';
  const state = getSession(sessionId);

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
      if (config?.channelId) {
        channelId = config.channelId;
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
          title: '🌍 Travle Results',
          description: message,
          color: 0x4ade80, // green accent
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
app.post('/game/reset', (req, res) => {
  const sessionId = (req.query.id as string) || 'default';
  sessions.delete(sessionId);
  const state = getSession(sessionId);
  res.json({
    start: state.puzzle.start,
    end: state.puzzle.end,
    shortestPathLength: state.puzzle.shortestPathLength,
    maxGuesses: state.puzzle.maxGuesses,
    guesses: [],
    guessesRemaining: state.guessesRemaining,
  });
});

// --- Start ---
// Serve static files AFTER API routes so /api/* takes priority
app.use(express.static(path.resolve(process.cwd(), 'web/travle')));

const PORT = process.env.PORT || 3002;
initGame().then(() => {
  app.listen(PORT, () => {
    console.log(`Travle web running at http://localhost:${PORT}`);
  });
});
