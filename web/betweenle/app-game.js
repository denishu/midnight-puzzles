// Betweenle Frontend — talks to /game endpoints

import { initDiscord, getDiscordUser, getDiscordGuildId, getSessionToken } from './dist/discord-sdk.js?v=1';

let sessionUserId = null;
let discordGuildId = null;
let gameOver = false;

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

function setStatus(msg, ok) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = ok ? 'ok' : '';
}

function render(state) {
  gameOver = state.isComplete;

  $('lower').textContent = state.lowerBound;
  $('upper').textContent = state.upperBound;

  // Guesses, newest at the bottom (chronological), highlighting the closest.
  const rows = state.guesses.map(g => {
    if (g.direction === 'correct') {
      return '<div class="guess-row correct"><span class="word">' + g.word + '</span><span class="meta">✅ correct</span></div>';
    }
    // 'before' = guess is before the secret -> secret is AFTER it.
    const arrow = g.direction === 'before' ? 'secret is after ⬇️' : 'secret is before ⬆️';
    return '<div class="guess-row"><span class="word">' + g.word + '</span>' +
           '<span class="meta">' + arrow + ' · <span class="dist">' + g.distance + '%</span></span></div>';
  });
  $('guesses').innerHTML = rows.join('');
  $('guesses').scrollTop = $('guesses').scrollHeight;

  $('remaining').textContent = 'Guesses: ' + state.guessesUsed + ' / ' + state.maxGuesses;

  if (state.isComplete) {
    $('guess-input').disabled = true;
    $('submit-btn').disabled = true;
    if (state.isWin) {
      setStatus('Solved in ' + state.guessesUsed + ' — score ' + state.score + '/5!', true);
    } else {
      setStatus('Out of guesses. The word was ' + (state.secret || '').toUpperCase() + '.', false);
    }
  }
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
  if (word.length !== 5) { setStatus('Enter a 5-letter word.'); return; }

  setStatus('');
  const user = getDiscordUser();
  const resp = await fetch('/game/guess' + getSessionParam(), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ word, username: user ? user.username : undefined }),
  });
  const data = await resp.json();
  if (!data.isValid) { setStatus(data.error || 'Invalid guess.'); return; }
  input.value = '';
  render(data);
}

// --- events ---
$('submit-btn').addEventListener('click', submitGuess);
$('guess-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitGuess(); }
});
$('info-btn').addEventListener('click', (e) => { e.preventDefault(); $('info-popup').classList.add('active'); });
$('info-close').addEventListener('click', () => $('info-popup').classList.remove('active'));

async function boot() {
  const discord = await initDiscord();
  if (discord) {
    sessionUserId = discord.user.id;
    discordGuildId = discord.guildId;
  }
  await loadState();
  $('guess-input').focus();
}

boot().catch(e => { console.error('boot failed', e); setStatus('Failed to load. Refresh to retry.'); });
