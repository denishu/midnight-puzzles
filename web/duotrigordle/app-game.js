// Duotrigordle Frontend — talks to /game endpoints

import { initDiscord, getDiscordUser, getDiscordChannelId, getDiscordGuildId } from './dist/discord-sdk.js';

let sessionUserId = null;
let discordChannelId = null;
let discordGuildId = null;
let gameOver = false;
let currentInput = '';

// Keyboard letter states: best status across all grids
const letterStates = {};

function getSessionParam() {
  if (sessionUserId) return '?id=' + encodeURIComponent(sessionUserId);
  let id = localStorage.getItem('duotrigordle_session_id');
  if (!id) {
    id = 'local_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('duotrigordle_session_id', id);
  }
  return '?id=' + encodeURIComponent(id);
}

// --- Rendering ---

function renderGrids(grids) {
  const area = document.getElementById('grid-area');
  area.innerHTML = grids.map(g => {
    const solved = g.isComplete ? ' solved' : '';
    const check = g.isComplete ? '<span class="solved-check">✓</span>' : '';
    const rows = [];

    // Show all guesses, but if solved, stop at the winning guess
    const guessesToShow = g.isComplete
      ? g.guesses.slice(0, g.guesses.findIndex(q => q.feedback.every(f => f.status === 'correct')) + 1)
      : g.guesses;

    for (const guess of guessesToShow) {
      const cells = guess.feedback.map(f =>
        '<div class="mini-cell ' + f.status + '">' + f.letter.toUpperCase() + '</div>'
      ).join('');
      rows.push('<div class="mini-row">' + cells + '</div>');
    }

    return '<div class="mini-grid' + solved + '">' +
      check +
      '<div class="mini-grid-label">' + (g.gridIndex + 1) + '</div>' +
      '<div class="mini-grid-rows">' + rows.join('') + '</div>' +
    '</div>';
  }).join('');
}

function renderNumberLine(grids) {
  const line = document.getElementById('number-line');
  line.innerHTML = grids.map(g => {
    const cls = g.isComplete ? ' solved' : '';
    return '<div class="nl-num' + cls + '">' + (g.gridIndex + 1) + '</div>';
  }).join('');
}

function updateKeyboardStates(grids) {
  // Reset
  for (const key in letterStates) delete letterStates[key];

  for (const grid of grids) {
    for (const guess of grid.guesses) {
      for (const f of guess.feedback) {
        const letter = f.letter.toLowerCase();
        const current = letterStates[letter];
        // Priority: correct > present > absent
        if (f.status === 'correct') {
          letterStates[letter] = 'correct';
        } else if (f.status === 'present' && current !== 'correct') {
          letterStates[letter] = 'present';
        } else if (f.status === 'absent' && !current) {
          letterStates[letter] = 'absent';
        }
      }
    }
  }

  // Update keyboard key classes
  document.querySelectorAll('.kb-key[data-letter]').forEach(key => {
    const letter = key.dataset.letter;
    key.classList.remove('correct', 'present', 'absent');
    if (letterStates[letter]) {
      key.classList.add(letterStates[letter]);
    }
  });
}

function updateProgress(data) {
  document.getElementById('grids-solved').textContent = data.completedGrids;
  document.getElementById('guesses-used').textContent = data.guessesUsed;
}

function buildKeyboard() {
  const rows = [
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['enter','z','x','c','v','b','n','m','back'],
  ];

  const kb = document.getElementById('keyboard');
  kb.innerHTML = rows.map(row => {
    const keys = row.map(k => {
      if (k === 'enter') return '<button class="kb-key wide" data-action="enter">ENTER</button>';
      if (k === 'back') return '<button class="kb-key wide" data-action="back">⌫</button>';
      return '<button class="kb-key" data-letter="' + k + '">' + k.toUpperCase() + '</button>';
    }).join('');
    return '<div class="kb-row">' + keys + '</div>';
  }).join('');

  // Keyboard click handlers
  kb.addEventListener('click', (e) => {
    const btn = e.target.closest('.kb-key');
    if (!btn || gameOver) return;

    if (btn.dataset.action === 'enter') {
      submitGuess();
    } else if (btn.dataset.action === 'back') {
      const input = document.getElementById('guess-input');
      input.value = input.value.slice(0, -1);
    } else if (btn.dataset.letter) {
      const input = document.getElementById('guess-input');
      if (input.value.length < 5) {
        input.value += btn.dataset.letter;
      }
    }
  });
}

// --- API calls ---

async function loadState() {
  const resp = await fetch('/game/state' + getSessionParam());
  const data = await resp.json();
  gameOver = data.isGameOver;

  renderGrids(data.grids);
  renderNumberLine(data.grids);
  updateKeyboardStates(data.grids);
  updateProgress(data);

  document.getElementById('submit-btn').disabled = gameOver;
  document.getElementById('guess-input').disabled = gameOver;

  if (gameOver) {
    showGameOver(data.isWin, data.completedGrids, data.guessesUsed, false);
  }
}

async function submitGuess() {
  const input = document.getElementById('guess-input');
  const word = input.value.trim().toLowerCase();
  if (!word || gameOver) return;
  if (word.length !== 5) {
    updateStatus('Guess must be 5 letters');
    return;
  }

  const resp = await fetch('/game/guess' + getSessionParam(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word }),
  });
  const result = await resp.json();

  if (!result.isValid) {
    updateStatus(result.error || 'Invalid word');
    return;
  }

  gameOver = result.isGameOver;

  renderGrids(result.grids);
  renderNumberLine(result.grids);
  updateKeyboardStates(result.grids);
  updateProgress(result);

  document.getElementById('submit-btn').disabled = gameOver;
  document.getElementById('guess-input').disabled = gameOver;
  input.value = '';

  if (result.isGameOver) {
    showGameOver(result.isWin, result.completedGrids, result.guessesUsed, true);
  } else {
    checkEarlyLoss(result);
  }
}

// --- UI helpers ---

let statusTimeout = null;
function updateStatus(msg) {
  const bar = document.getElementById('status-bar');
  bar.textContent = msg;
  bar.classList.add('active');
  if (statusTimeout) clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => bar.classList.remove('active'), 3000);
}

function showGameOver(isWin, completedGrids, guessesUsed, shouldPost, gaveUp = false) {
  const overlay = document.getElementById('game-over');
  document.getElementById('go-title').textContent = isWin ? '🎉 All 32 solved!' : gaveUp ? '🏳️ Gave up' : '😞 Out of guesses';
  document.getElementById('go-msg').textContent = isWin
    ? 'Solved all 32 grids in ' + guessesUsed + '/37 guesses!'
    : completedGrids + '/32 grids solved in ' + guessesUsed + '/37 guesses.';
  overlay.classList.add('active');

  // Auto-post results to Discord
  if (shouldPost && (discordChannelId || discordGuildId)) {
    const user = getDiscordUser();
    const username = user ? user.username : 'Someone';
    const score = isWin
      ? '✅ Solved 32/32 in ' + guessesUsed + '/37 guesses'
      : gaveUp
        ? '🏳️ Gave up — ' + completedGrids + '/32 grids (' + guessesUsed + '/37 guesses)'
        : '❌ ' + completedGrids + '/32 grids (' + guessesUsed + '/37 guesses)';
    const shareText = '**' + username + '** — ' + score;

    fetch('/game/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: discordChannelId, serverId: discordGuildId, message: shareText }),
    }).catch(e => console.error('Failed to post results:', e));
  }
}

let earlyLossShown = false;

function checkEarlyLoss(data) {
  if (earlyLossShown || gameOver) return;
  const remaining = data.totalGrids - data.completedGrids;
  const guessesLeft = data.maxGuesses - data.guessesUsed;
  if (remaining > guessesLeft) {
    earlyLossShown = true;
    const banner = document.getElementById('early-loss');
    banner.querySelector('.el-text').textContent =
      remaining + ' grids left but only ' + guessesLeft + ' guesses remaining — a win is no longer possible.';
    banner.classList.add('active');
  }
}

async function giveUp() {
  document.getElementById('early-loss').classList.remove('active');
  // Tell the server to end the game
  const resp = await fetch('/game/give-up' + getSessionParam(), { method: 'POST' });
  const result = await resp.json();
  gameOver = true;
  renderGrids(result.grids);
  renderNumberLine(result.grids);
  updateProgress(result);
  document.getElementById('submit-btn').disabled = true;
  document.getElementById('guess-input').disabled = true;
  showGameOver(false, result.completedGrids, result.guessesUsed, true, true);
}

function toggleInfo() {
  document.getElementById('info-popup').classList.toggle('active');
}

// --- Events ---
document.getElementById('info-btn').addEventListener('click', toggleInfo);
document.getElementById('info-close').addEventListener('click', toggleInfo);
document.getElementById('guess-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitGuess(); }
});
document.getElementById('submit-btn').addEventListener('click', submitGuess);
document.getElementById('give-up-btn').addEventListener('click', giveUp);
document.getElementById('early-loss-close').addEventListener('click', () => {
  document.getElementById('early-loss').classList.remove('active');
});
document.getElementById('go-close').addEventListener('click', () => {
  document.getElementById('game-over').classList.remove('active');
});

// --- Init ---
async function boot() {
  buildKeyboard();

  const discord = await initDiscord();
  if (discord) {
    sessionUserId = discord.user.id;
    discordChannelId = discord.channelId;
    discordGuildId = discord.guildId;
    console.log('Session keyed to Discord user:', sessionUserId);
  } else {
    console.log('Running outside Discord, using localStorage session');
  }

  await loadState();
}

boot();
