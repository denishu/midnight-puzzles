// Semantle Frontend — talks to /game endpoints

import { initDiscord, getDiscordUser, getDiscordChannelId, getDiscordGuildId } from './dist/discord-sdk.js';

let sessionUserId = null;
let discordChannelId = null;
let discordGuildId = null;
let guesses = [];
let gameOver = false;

function getSessionParam() {
  if (sessionUserId) return '?id=' + encodeURIComponent(sessionUserId);
  let id = localStorage.getItem('semantle_session_id');
  if (!id) {
    id = 'local_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('semantle_session_id', id);
  }
  return '?id=' + encodeURIComponent(id);
}

// --- API calls ---
async function loadState() {
  const resp = await fetch('/game/state' + getSessionParam());
  const data = await resp.json();
  guesses = data.guesses || [];
  gameOver = data.isComplete;

  document.getElementById('guess-count').textContent = data.guessCount;
  document.getElementById('best-rank').textContent = data.bestRank ? '#' + data.bestRank : '—';
  document.getElementById('submit-btn').disabled = gameOver;

  // Show similarity thresholds
  if (data.thresholds) {
    const t = data.thresholds;
    const fmt = (v) => v != null ? (v * 100).toFixed(2) + '%' : '?';
    document.getElementById('hints').innerHTML =
      'The nearest word has a similarity of <span>' + fmt(t.rank1) + '</span>. ' +
      'The 10th nearest has <span>' + fmt(t.rank10) + '</span>. ' +
      'The 1000th nearest has <span>' + fmt(t.rank1000) + '</span>.';
  }

  renderGuesses();

  if (gameOver && data.targetWord) {
    showGameOver(data.targetWord, data.guessCount, false);
  }
}

async function submitGuess() {
  const input = document.getElementById('guess-input');
  const word = input.value.trim().toLowerCase();
  if (!word || gameOver) return;

  const resp = await fetch('/game/guess' + getSessionParam(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word }),
  });
  const result = await resp.json();

  if (!result.isValid) {
    updateStatus(result.feedback);
    return;
  }

  // Add to local guesses list
  guesses.push({
    word,
    similarity: result.similarity,
    rank: result.rank,
  });

  gameOver = result.isComplete;

  document.getElementById('guess-count').textContent = guesses.length;
  document.getElementById('best-rank').textContent = result.bestRank ? '#' + result.bestRank : '—';
  document.getElementById('submit-btn').disabled = gameOver;

  renderGuesses();
  input.value = '';

  if (result.isComplete) {
    showGameOver(result.targetWord, guesses.length, true);
  }
}

function getTemp(rank, similarity) {
  if (rank === 0) return 'correct';
  if (rank && rank <= 10) return 'hot';
  if (rank && rank <= 100) return 'warm';
  if (rank && rank <= 1000) return 'ranked';
  if (similarity >= 0.16) return 'tepid';
  return 'cold';
}

function getRankText(rank, similarity) {
  if (rank === 0) return '🎯 FOUND';
  if (rank) return '#' + rank;
  if (similarity >= 0.16) return '🌊 Tepid';
  return '❄️ Cold';
}

function renderGuesses() {
  const list = document.getElementById('guess-list');
  const latestWord = guesses.length > 0 ? guesses[guesses.length - 1].word : null;

  // Sort by similarity descending, but pin the latest guess to the top
  const sorted = [...guesses].sort((a, b) => {
    if (a.word === latestWord) return -1;
    if (b.word === latestWord) return 1;
    return (b.similarity || 0) - (a.similarity || 0);
  });

  list.innerHTML = sorted.map(g => {
    const temp = getTemp(g.rank, g.similarity);
    const simPct = g.similarity != null ? (g.similarity * 100).toFixed(1) + '%' : '—';
    const rankText = getRankText(g.rank, g.similarity);
    const barWidth = Math.max(2, (g.similarity || 0) * 100);
    const isLatest = g.word === latestWord ? ' latest' : '';

    return '<div class="guess-row temp-' + temp + isLatest + '">' +
      '<span class="guess-word">' + g.word + '</span>' +
      '<div class="guess-bar"><div class="guess-bar-fill" style="width:' + barWidth + '%"></div></div>' +
      '<span class="guess-similarity">' + simPct + '</span>' +
      '<span class="guess-rank">' + rankText + '</span>' +
    '</div>';
  }).join('');
}

let statusTimeout = null;
function updateStatus(msg) {
  const bar = document.getElementById('status-bar');
  bar.textContent = msg;
  bar.classList.add('active');
  if (statusTimeout) clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => bar.classList.remove('active'), 3000);
}

function showGameOver(targetWord, guessCount, shouldPost) {
  const overlay = document.getElementById('game-over');
  document.getElementById('go-title').textContent = '🎉 You found it!';

  // Find best rank from guesses (excluding the correct answer)
  const bestRanked = guesses
    .filter(g => g.rank && g.rank > 0)
    .sort((a, b) => a.rank - b.rank)[0];
  const bestRankText = bestRanked ? ' | Best rank: #' + bestRanked.rank : '';

  document.getElementById('go-msg').textContent =
    'The word was "' + targetWord + '" — solved in ' + guessCount + ' guesses' + bestRankText;
  overlay.classList.add('active');

  // Only auto-post when the game was just won, not when loading a completed game
  if (shouldPost && (discordChannelId || discordGuildId)) {
    const user = getDiscordUser();
    const username = user ? user.username : 'Someone';
    const bestRankedForShare = guesses
      .filter(g => g.rank && g.rank > 0)
      .sort((a, b) => a.rank - b.rank)[0];
    const bestText = bestRankedForShare ? ' | Best rank: #' + bestRankedForShare.rank : '';
    const shareText = '**' + username + '** solved today\'s Semantle in ' + guessCount + ' guesses' + bestText;
    fetch('/game/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: discordChannelId, serverId: discordGuildId, message: shareText }),
    }).catch(e => console.error('Failed to post results:', e));
  }
}

// --- Events ---
function toggleInfo() {
  document.getElementById('info-popup').classList.toggle('active');
}
document.getElementById('info-btn').addEventListener('click', toggleInfo);
document.getElementById('info-close').addEventListener('click', toggleInfo);
document.getElementById('guess-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitGuess(); }
});
document.getElementById('submit-btn').addEventListener('click', submitGuess);
document.getElementById('hint-btn').addEventListener('click', async () => {
  const resp = await fetch('/game/hint' + getSessionParam());
  const data = await resp.json();
  if (data.hint) {
    document.getElementById('guess-input').value = data.hint;
    updateStatus('💡 Hint: try "' + data.hint + '" (rank #' + data.rank + ')');
  } else {
    updateStatus('No hint available');
  }
});
document.getElementById('go-close').addEventListener('click', () => {
  document.getElementById('game-over').classList.remove('active');
});

// --- Init ---
async function boot() {
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
