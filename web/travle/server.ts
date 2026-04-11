import express from 'express';
import path from 'path';
import { CountryGraph } from '../../games/travle/CountryGraph';
import { TravleGame, TravleGameState } from '../../games/travle/TravleGame';

const app = express();
app.use(express.json());

// --- Game setup ---
let travleGame: TravleGame;
const sessions: Map<string, TravleGameState> = new Map();

async function initGame() {
  const graph = new CountryGraph();
  await graph.initialize();
  travleGame = new TravleGame(graph);
  travleGame.init();
  console.log('Travle game initialized');
}

function getSession(id: string): TravleGameState {
  let state = sessions.get(id);
  if (!state) {
    const puzzle = travleGame.genPuzzle(new Date());
    state = travleGame.newState(puzzle);
    sessions.set(id, state);
  }
  return state;
}

// --- API endpoints ---

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
        client_secret: process.env.DISCORD_CLIENT_SECRET || '',
        grant_type: 'authorization_code',
        code,
      }),
    });
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
app.post('/game/guess', (req, res) => {
  const sessionId = (req.query.id as string) || 'default';
  const { country } = req.body;
  if (!country) { res.status(400).json({ error: 'country required' }); return; }

  const state = getSession(sessionId);
  const result = travleGame.guess(state, country);

  res.json({
    ...result,
    guesses: state.guesses,
    guessesRemaining: state.guessesRemaining,
  });
});

// Post results to Discord channel
app.post('/game/complete', async (req, res) => {
  const { channelId, message } = req.body;
  if (!channelId || !message) { res.status(400).json({ error: 'channelId and message required' }); return; }

  try {
    const token = process.env.TRAVLE_BOT_TOKEN;
    if (!token) { res.status(500).json({ error: 'bot token not configured' }); return; }

    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content: message })
    });
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

const PORT = process.env.PORT || 3000;
initGame().then(() => {
  app.listen(PORT, () => {
    console.log(`Travle web running at http://localhost:${PORT}`);
  });
});
