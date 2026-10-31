// Betweenle Frontend — talks to /game endpoints

import { initDiscord, getDiscordUser, getDiscordGuildId, getSessionToken } from './dist/discord-sdk.js?v=1';
import { spawnConfetti } from './shared/confetti.js';

let sessionUserId = null;
let discordGuildId = null;
let discordChannelId = null;
let gameOver = false;
let bounds = { lower: 'aaaaa', upper: 'zzzzz' };

// Include the verified session token (JWT) so the server reads identity from it
// rather than the ?id= query param.
function authHeaders(extra) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  const token = getSessionToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return headers;
}

function getSessionParam() {
  if (sessionUserId) {
    let param = '?id=' + encodeURIComponent(sessionUserId);
    if (discordGuildId) param += '&guildId=' + encodeURIComponent(discordGuildId);
    return param;
  }
  let id = localStorage.getItem('betweenle_session_id');
  if (!id) {
    id = 'local_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('betweenle_session_id', id);
  }
  return '?id=' + encodeURIComponent(id);
}

const $ = (id) => document.getElementById(id);
const setStatus = (msg, ok) => { const el = $('status'); el.textContent = msg || ''; el.className = ok ? 'ok' : ''; };

// --- bounds-band prefix check (mirror of BetweenleWords.prefixWithinBounds) ---
// Advisory only: greys keyboard letters that would take the prefix out of the
// current band. Never blocks typing.
function prefixWithinBounds(prefix) {
  if (prefix.length === 0) return true;
  const n = prefix.length;
  const p = prefix.toLowerCase();
  return p >= bounds.lower.slice(0, n) && p <= bounds.upper.slice(0, n);
}

// --- number line ---
function renderNumberLine(state) {
  // Only the two ACTIVE bound guesses matter — the tightest guess below the
  // secret (current lower bound) and the tightest above (current upper bound).
  // Older interior guesses are superseded; plotting them all made the distance
  // labels overlap illegibly. Find each bound's guess to reuse its distance.
  const byWord = new Map(state.guesses.map(g => [g.word, g]));
  const marks = [];
  const loGuess = byWord.get(state.lowerBound);
  const hiGuess = byWord.get(state.upperBound);
  if (loGuess && loGuess.direction !== 'correct') {
    marks.push({ pos: 0, dist: loGuess.distance, word: loGuess.word, side: 'lo' });
  }
  if (hiGuess && hiGuess.direction !== 'correct') {
    marks.push({ pos: 100, dist: hiGuess.distance, word: hiGuess.word, side: 'hi' });
  }

  $('nl-track').innerHTML = marks.map(m => {
    // Inward-pointing arrow: lower label points right (▶), upper points left (◀).
    const label = m.side === 'lo'
      ? m.dist + ' <span class="nl-arrow">▶</span>'
      : '<span class="nl-arrow">◀</span> ' + m.dist;
    return '<div class="nl-tick nl-' + m.side + '" style="left:' + m.pos + '%" title="' + m.word + ' · ' + m.dist + '%">' +
      '<span class="nl-dist">' + label + '</span></div>';
  }).join('') + dotHtml(loGuess, hiGuess);
  $('nl-lower').textContent = state.lowerBound;
  $('nl-upper').textContent = state.upperBound;
}

// A dot placed proportionally between the two active bounds: its distance-from-
// left is lowerDist / (lowerDist + upperDist). Only shown once BOTH bounds are
// real guesses (otherwise there's no pair to proportion between).
function dotHtml(loGuess, hiGuess) {
  if (!loGuess || !hiGuess || loGuess.direction === 'correct' || hiGuess.direction === 'correct') return '';
  const a = loGuess.distance, b = hiGuess.distance;
  const total = a + b;
  if (total <= 0) return '';
  const pct = (a / total) * 100;
  return '<div class="nl-dot" style="left:' + pct.toFixed(2) + '%" title="estimated position"></div>';
}

// --- letter line (A–Z): NOT an input device, just a greying guide ---
// The user types into the real <input>; this strip only visualizes which next
// letter keeps the prefix within the current bounds. A–Z order makes the
// in-range alphabetical band read clearly left-to-right (pairs with the number
// line). One row on desktop; wraps to two on narrow/mobile widths (CSS).
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');

function buildKeyboard() {
  $('keyboard').innerHTML = ALPHABET
    .map(ch => '<span class="key" data-key="' + ch + '">' + ch.toUpperCase() + '</span>')
    .join('');
}

// Grey letters that would take the current prefix out of bounds (advisory).
// The prefix is whatever is currently typed in the input.
function updateKeyboardGreying() {
  const prefix = ($('guess-input').value || '').toLowerCase();
  $('keyboard').querySelectorAll('.key[data-key]').forEach(key => {
    const k = key.getAttribute('data-key');
    const feasible = prefix.length < 5 && prefixWithinBounds(prefix + k);
    key.classList.toggle('greyed', !feasible);
  });
}

// --- rendering ---
function render(state) {
  gameOver = state.isComplete;
  bounds = { lower: state.lowerBound, upper: state.upperBound };

  renderNumberLine(state);

  const rows = state.guesses.map(g => {
    if (g.direction === 'correct') {
      return '<div class="guess-row correct"><span class="word">' + g.word + '</span><span class="meta">✅ correct</span></div>';
    }
    const arrow = g.direction === 'before'
      ? 'secret is <span class="arrow">after ⬇</span>'
      : 'secret is <span class="arrow">before ⬆</span>';
    return '<div class="guess-row"><span class="word">' + g.word + '</span>' +
           '<span class="meta">' + arrow + ' · <span class="dist">' + g.distance + '%</span></span></div>';
  });
  $('guesses').innerHTML = rows.join('');
  $('guesses').scrollTop = $('guesses').scrollHeight;

  renderScoreboard(state);

  if (state.isComplete) {
    $('guess-input').disabled = true;
    showGameOver(state);
  }
  updateKeyboardGreying();
}

let gameOverShown = false;
function showGameOver(state) {
  const overlay = $('game-over');
  overlay.classList.toggle('win', state.isWin);
  overlay.classList.toggle('loss', !state.isWin);
  $('go-title').textContent = state.isWin ? '🎉 Solved!' : '😞 Out of guesses';
  $('go-msg').innerHTML = state.isWin
    ? 'You found <b>' + (state.secret || '').toUpperCase() + '</b> in ' + state.guessesUsed + ' guesses.<br>Score: <b>' + state.score + '/5</b>'
    : 'The word was <b>' + (state.secret || '').toUpperCase() + '</b>.';
  overlay.classList.add('active');
  if (state.isWin && !gameOverShown) spawnConfetti();
  gameOverShown = true;
}

// Score tiers by the 5-3-3-2-1 guess clusters -> 5/4/3/2/1. Mirrors
// games/betweenle scoreForGuessNumber. Guess n (1-based) lands in a cluster.
const CLUSTERS = [5, 3, 3, 2, 1];          // dot counts per cluster
const CLUSTER_SCORE = [5, 4, 3, 2, 1];     // score for finishing in that cluster

function scoreForGuessNumber(n) {
  if (n < 1 || n > 14) return 0;
  if (n <= 5) return 5;
  if (n <= 8) return 4;
  if (n <= 11) return 3;
  if (n <= 13) return 2;
  return 1;
}

// 14 dots grouped 5-3-3-2-1; fill one per guess used. Left label = guesses used,
// right label = live achievable score (the tier your NEXT guess would score),
// locking to the final score on win and 0 on loss.
function renderScoreboard(state) {
  const used = state.guessesUsed;
  let n = 0;
  const groups = CLUSTERS.map((count, ci) => {
    const dots = [];
    for (let i = 0; i < count; i++) {
      n++;
      const filled = n <= used;
      // Highlight the cluster the current/next guess sits in.
      const active = !state.isComplete && n === used + 1;
      dots.push('<span class="dot' + (filled ? ' filled' : '') + (active ? ' active' : '') + '"></span>');
    }
    return '<span class="dot-group" data-score="' + CLUSTER_SCORE[ci] + '">' + dots.join('') + '</span>';
  }).join('');

  const score = state.isComplete
    ? (state.isWin ? state.score : 0)
    : scoreForGuessNumber(used + 1);

  $('scoreboard').innerHTML =
    '<span class="sb-side sb-used-wrap"><span class="sb-used">' + used + '/14</span><span class="sb-label">Guesses</span></span>' +
    '<span class="sb-dots">' + groups + '</span>' +
    '<span class="sb-side sb-score-wrap"><span class="sb-score">' + score + '/5</span><span class="sb-label">Score</span></span>';
}

async function loadState() {
  const user = getDiscordUser();
  const usernameParam = user ? '&username=' + encodeURIComponent(user.username) : '';
  const resp = await fetch('/game/state' + getSessionParam() + usernameParam, { headers: authHeaders() });
  render(await resp.json());
}

async function submitGuess() {
  if (gameOver) return;
  const input = $('guess-input');
  const word = (input.value || '').trim().toLowerCase();
  if (word.length !== 5) { setStatus('Enter a 5-letter word.'); input.focus(); return; }
  setStatus('');
  const user = getDiscordUser();
  const resp = await fetch('/game/guess' + getSessionParam(), {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ word, username: user ? user.username : undefined }),
  });
  const data = await resp.json();
  if (!data.isValid) {
    setStatus(data.error || 'Invalid guess.');
    input.focus(); // keep the mobile keyboard up
    return;
  }
  input.value = '';
  render(data);
  // On a fresh win, post results to the server's configured channel (same as
  // the other games). Only fires here (a just-happened win), never on reload.
  if (data.isWin && (discordChannelId || discordGuildId)) {
    const u = getDiscordUser();
    const username = u ? u.username : 'Someone';
    const dots = '🔴'.repeat(data.score) + '⚪'.repeat(5 - data.score);
    const message = '🔤 **' + username + '** solved today\'s Betweenle in **' + data.guessesUsed + '** guesses — ' + dots + ' **' + data.score + '/5**!';
    fetch('/game/complete', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ channelId: discordChannelId, serverId: discordGuildId, message }),
    }).catch(e => console.error('Failed to post results:', e));
  }
  // Keep focus so the mobile keyboard stays up (and doesn't flash out/in).
  if (!data.isComplete) input.focus();
}

// --- events ---
const inputEl = $('guess-input');
// Normalize to lowercase letters only; update the reference keyboard greying.
inputEl.addEventListener('input', () => {
  const cleaned = inputEl.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, 5);
  if (inputEl.value !== cleaned) inputEl.value = cleaned;
  updateKeyboardGreying();
});
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitGuess(); }
});
$('info-btn').addEventListener('click', () => $('info-popup').classList.add('active'));
$('info-close').addEventListener('click', () => $('info-popup').classList.remove('active'));
$('go-close').addEventListener('click', () => $('game-over').classList.remove('active'));

async function boot() {
  buildKeyboard();
  const discord = await initDiscord();
  if (discord) { sessionUserId = discord.user.id; discordGuildId = discord.guildId; discordChannelId = discord.channelId; }
  await loadState();
  $('guess-input').focus();
}

boot().catch(e => { console.error('boot failed', e); setStatus('Failed to load. Refresh to retry.'); });
