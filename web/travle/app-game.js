// Travle Frontend — talks to /game endpoints

import { initDiscord, getDiscordUser, getDiscordChannelId, getDiscordGuildId } from './dist/discord-sdk.js';

const GEOJSON_URL = '/game/geojson';

let map, geoLayer;
let allCountries = [];
let countryLookup = {};
let puzzle = null;
let guesses = [];
let guessesRemaining = 0;
let gameOver = false;
let selectedSuggestion = -1;

let aliasMap = {}; // canonical -> [aliases]

// Will be set after Discord SDK auth, or fallback to localStorage
let sessionUserId = null;
let discordChannelId = null;
let discordGuildId = null;

// Display name overrides for formal/long GeoJSON names
const DISPLAY_NAMES = {
  'united republic of tanzania': 'Tanzania',
  'the bahamas': 'Bahamas',
  'the gambia': 'Gambia',
  'republic of the congo': 'Congo',
  'democratic republic of the congo': 'Democratic Republic of the Congo',
  'republic of serbia': 'Serbia',
  'czech republic': 'Czechia',
};

function titleCase(str) {
  const lower = str.toLowerCase();
  if (DISPLAY_NAMES[lower]) return DISPLAY_NAMES[lower];
  const minorWords = new Set(['of', 'the', 'and', 'in', 'on', 'at', 'to', 'for', 'a', 'an']);
  return str.split(' ').map((w, i) => {
    // Handle hyphenated words (e.g. guinea-bissau → Guinea-Bissau)
    if (w.includes('-')) {
      return w.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('-');
    }
    return i === 0 || !minorWords.has(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  }).join(' ');
}

// --- Map ---
async function initMap() {
  map = L.map('map', {
    center: [20, 0], zoom: 2, minZoom: 2, maxZoom: 8,
    worldCopyJump: true, zoomControl: true,
    preferCanvas: true
  });

  updateStatus('Loading country data...');
  const resp = await fetch(GEOJSON_URL);
  const geojson = await resp.json();

  geoLayer = L.geoJSON(geojson, {
    style: () => ({ fillColor: 'transparent', weight: 0, color: 'transparent', fillOpacity: 0 }),
    onEachFeature: (feature, layer) => {
      // Disable click popups, keep hover tooltips
      layer.unbindPopup();
      layer.on('click', () => {});
      const name = (feature.properties.ADMIN || feature.properties.name || '').toLowerCase();
      allCountries.push({ name, feature, layer });
      countryLookup[name] = { feature, layer };
    }
  }).addTo(map);

  updateStatus('Ready');
  // Load aliases
  try { aliasMap = await (await fetch('/game/aliases')).json(); } catch(e) {}
  await loadPuzzle();
}

// Name mappings: our adjacency names -> GeoJSON ADMIN names
const NAME_MAP = {
  'united states': 'united states of america',
  'congo': 'republic of the congo',
  'democratic republic of the congo': 'democratic republic of the congo',
  'ivory coast': "côte d'ivoire",
  'east timor': 'timor-leste',
  'eswatini': 'eswatini',
  'north macedonia': 'north macedonia',
  'czech republic': 'czechia',
  'vatican city': 'vatican',
};

function resolveCountryName(name) {
  const lower = name.toLowerCase();
  // Try our mapping first, then the raw name
  if (NAME_MAP[lower]) return NAME_MAP[lower];
  // Also try matching without common prefixes
  return lower;
}

function highlightCountry(name, color) {
  const resolved = resolveCountryName(name);
  const entry = countryLookup[resolved] || countryLookup[name.toLowerCase()];
  if (!entry) {
    // Try partial match as fallback
    const partial = allCountries.find(c => c.name.includes(name.toLowerCase()) || name.toLowerCase().includes(c.name));
    if (partial) {
      partial.layer.setStyle({ fillColor: color, fillOpacity: 0.7, weight: 1.5, color: '#fff' });
      partial.layer.bringToFront();
      partial.layer.bindTooltip(titleCase(name), { sticky: true, className: 'country-tooltip' });
      return;
    }
    console.warn('Country not found on map:', name, '(tried:', resolved, ')');
    return;
  }
  entry.layer.setStyle({ fillColor: color, fillOpacity: 0.7, weight: 1.5, color: '#fff' });
  entry.layer.bringToFront();
  entry.layer.bindTooltip(titleCase(name), { sticky: true, className: 'country-tooltip' });
}

function zoomToCountries(names) {
  const bounds = L.latLngBounds([]);
  for (const n of names) {
    const resolved = resolveCountryName(n);
    const entry = countryLookup[resolved] || countryLookup[n.toLowerCase()]
      || allCountries.find(c => c.name.includes(n.toLowerCase()) || n.toLowerCase().includes(c.name));
    if (entry) {
      const layer = entry.layer || entry;
      bounds.extend(layer.getBounds());
    }
  }
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.8));
}

function getSessionParam() {
  // Use Discord user ID if authenticated, otherwise fall back to localStorage
  if (sessionUserId) {
    return '?id=' + encodeURIComponent(sessionUserId);
  }
  // Fallback for local dev / non-Discord usage
  let id = localStorage.getItem('travle_session_id');
  if (!id) {
    id = 'local_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('travle_session_id', id);
  }
  return '?id=' + encodeURIComponent(id);
}

// --- API calls ---
async function loadPuzzle() {
  const resp = await fetch('/game/puzzle' + getSessionParam());
  const data = await resp.json();
  puzzle = data;
  guesses = data.guesses || [];
  guessesRemaining = data.guessesRemaining;
  gameOver = data.isComplete;

  document.getElementById('start-country').textContent = puzzle.start.toUpperCase();
  document.getElementById('end-country').textContent = puzzle.end.toUpperCase();
  document.getElementById('guesses-used').textContent = guesses.length; document.getElementById('guesses-total').textContent = puzzle.maxGuesses;
  document.getElementById('submit-btn').disabled = gameOver;

  highlightCountry(puzzle.start, '#f59e0b');
  highlightCountry(puzzle.end, '#f59e0b');

  // Restore any existing guesses
  for (const g of guesses) {
    highlightCountry(g.country, '#d4a574');
  }

  zoomToCountries([puzzle.start, puzzle.end, ...guesses.map(g => g.country)]);
  renderGuessList();
  updateStatus(gameOver ? (puzzle.isWin ? 'You solved it!' : 'Out of guesses!') : 'Connect the countries!');

  // If game was already complete, reveal all country outlines
  if (gameOver) {
    const guessedNames = new Set(guesses.map(g => resolveCountryName(g.country)));
    guessedNames.add(resolveCountryName(puzzle.start));
    guessedNames.add(resolveCountryName(puzzle.end));
    for (const c of allCountries) {
      if (!guessedNames.has(c.name)) {
        c.layer.setStyle({ fillColor: '#0c1425', fillOpacity: 1, weight: 0.5, color: '#334155' });
        c.layer.bindTooltip(titleCase(c.name), { sticky: true, className: 'country-tooltip' });
      }
    }
  }
}

async function submitGuess() {
  const input = document.getElementById('guess-input');
  const country = input.value.trim().toLowerCase();
  if (!country || gameOver) return;

  const resp = await fetch('/game/guess' + getSessionParam(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ country })
  });
  const result = await resp.json();

  if (!result.isValid) {
    updateStatus(result.feedback);
    return;
  }

  guesses = result.guesses;
  guessesRemaining = result.guessesRemaining;
  gameOver = result.isGameOver;

  // Color the latest guessed country on the map
  const latestGuess = guesses[guesses.length - 1];
  if (latestGuess) highlightCountry(latestGuess.country, '#d4a574');

  document.getElementById('guesses-used').textContent = guesses.length; document.getElementById('guesses-total').textContent = puzzle.maxGuesses;
  renderGuessList();
  zoomToCountries([puzzle.start, puzzle.end, ...guesses.map(g => g.country)]);

  input.value = '';
  hideSuggestions();

  if (result.isGameOver) {
    document.getElementById('submit-btn').disabled = true;
    showGameOver(result.isWin, result.feedback, result.winningPath);
  }
}

function renderGuessList() {
  const list = document.getElementById('guess-list');
  list.innerHTML = guesses.map(g =>
    '<span class="guess-tag">' +
      '<span class="dot ' + g.status + '"></span>' +
      g.country +
    '</span>'
  ).join('');
  list.scrollTop = list.scrollHeight;
}

let statusTimeout = null;
function updateStatus(msg) {
  const bar = document.getElementById('status-bar');
  bar.textContent = msg;
  bar.classList.add('active');
  if (statusTimeout) clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => bar.classList.remove('active'), 3000);
}

function showGameOver(isWin, feedback, winningPath) {
  const overlay = document.getElementById('game-over');
  document.getElementById('go-title').textContent = isWin ? '🎉 You solved it!' : '😞 Out of guesses';

  if (isWin) {
    document.getElementById('go-msg').textContent =
      'You got from ' + titleCase(puzzle.start) + ' to ' + titleCase(puzzle.end) + ' in ' + guesses.length + ' guesses';
  } else {
    document.getElementById('go-msg').textContent = 'The path was: ' + (puzzle.shortestPath || []).map(c => titleCase(c)).join(' → ');
  }

  // Show shortest solution
  const shortestCount = puzzle.shortestPathLength - 1;
  const shortestPath = (puzzle.shortestPath || []).map(c => titleCase(c)).join(' → ');
  document.getElementById('go-path').innerHTML =
    'Shortest solution (' + shortestCount + ' guesses): <br>' + shortestPath;

  // Build shareable result (same format as /results slash command)
  const colors = guesses.map(g => g.status === 'green' ? '🟩' : g.status === 'yellow' ? '🟨' : '🟥').join('');
  const over = guesses.length - (puzzle.shortestPathLength - 1);
  const score = isWin ? (over <= 0 ? '✨ Perfect' : '+' + over) : '❌ DNF';
  const user = getDiscordUser();
  const username = user ? user.username : 'Someone';
  const shareText = '**' + username + '** — ' + score + '\n🧭 ' + titleCase(puzzle.start) + ' → ' + titleCase(puzzle.end) + ' (' + guesses.length + ' guesses)\n' + colors;

  const shareEl = document.getElementById('go-share');
  if (shareEl) {
    shareEl.textContent = shareText;
    shareEl.style.display = 'block';
  }

  overlay.classList.add('active');

  // Auto-post results to Discord channel
  console.log('Game over — discordChannelId:', discordChannelId, 'guildId:', discordGuildId);
  if (discordChannelId || discordGuildId) {
    fetch('/game/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: discordChannelId, serverId: discordGuildId, message: shareText }),
    }).then(r => {
      console.log('Post results response:', r.status);
      if (!r.ok) r.text().then(t => console.error('Post results error:', t));
    }).catch(e => console.error('Failed to post results to Discord:', e));
  }

  // Reveal all countries as outlines
  const guessedNames = new Set(guesses.map(g => resolveCountryName(g.country)));
  guessedNames.add(resolveCountryName(puzzle.start));
  guessedNames.add(resolveCountryName(puzzle.end));

  for (const c of allCountries) {
    if (!guessedNames.has(c.name)) {
      c.layer.setStyle({ fillColor: '#0c1425', fillOpacity: 1, weight: 0.5, color: '#334155' });
      c.layer.bindTooltip(titleCase(c.name), {
        sticky: true, className: 'country-tooltip'
      });
    }
  }
}

// --- Autocomplete ---
function showSuggestions(query) {
  const box = document.getElementById('suggestions');
  if (!query || query.length < 1) { hideSuggestions(); return; }
  const q = query.toLowerCase();

  // Build searchable list: country names + aliases
  const searchable = [];
  const aliasValues = new Set();
  for (const aliases of Object.values(aliasMap)) {
    for (const a of aliases) aliasValues.add(a.toLowerCase());
  }
  for (const c of allCountries) {
    // Skip if this GeoJSON name is an alias of a canonical name (avoid duplicates)
    if (!aliasValues.has(c.name)) {
      searchable.push({ display: c.name, value: c.name });
    }
  }
  for (const [canonical, aliases] of Object.entries(aliasMap)) {
    for (const alias of aliases) {
      searchable.push({ display: canonical, value: alias });
    }
  }

  // Prioritize "starts with" matches, then fill with "contains" if needed
  const startsWith = searchable
    .filter(s => s.display.startsWith(q) || s.value.startsWith(q))
    .sort((a, b) => a.display.localeCompare(b.display))
    .filter((s, i, arr) => arr.findIndex(x => x.display === s.display) === i);

  const contains = searchable
    .filter(s => !s.display.startsWith(q) && !s.value.startsWith(q) && (s.display.includes(q) || s.value.includes(q)))
    .sort((a, b) => a.display.localeCompare(b.display))
    .filter((s, i, arr) => arr.findIndex(x => x.display === s.display) === i);

  const matches = [...startsWith, ...contains].slice(0, 10);
  if (matches.length === 0) { hideSuggestions(); return; }
  selectedSuggestion = -1;
  box.innerHTML = matches.map((m, i) =>
    '<div class="suggestion" data-name="' + m.display + '" data-index="' + i + '">' + m.display + '</div>'
  ).join('');
  box.classList.add('active');
  box.querySelectorAll('.suggestion').forEach(el => {
    el.addEventListener('click', () => {
      document.getElementById('guess-input').value = el.dataset.name;
      hideSuggestions();
    });
  });
}

function hideSuggestions() {
  document.getElementById('suggestions').classList.remove('active');
  selectedSuggestion = -1;
}

function navigateSuggestions(dir) {
  const items = document.querySelectorAll('.suggestion');
  if (items.length === 0) return;
  selectedSuggestion = Math.max(-1, Math.min(items.length - 1, selectedSuggestion + dir));
  items.forEach((el, i) => el.classList.toggle('selected', i === selectedSuggestion));
  if (selectedSuggestion >= 0) {
    document.getElementById('guess-input').value = items[selectedSuggestion].dataset.name;
  }
}

// --- Events ---
function closeOverlay() {
  document.getElementById('game-over').classList.remove('active');
}
window.closeOverlay = closeOverlay;

function toggleInfo() {
  document.getElementById('info-popup').classList.toggle('active');
}
window.toggleInfo = toggleInfo;

document.getElementById('guess-input').addEventListener('input', (e) => showSuggestions(e.target.value));
document.getElementById('guess-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); navigateSuggestions(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); navigateSuggestions(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); hideSuggestions(); submitGuess(); }
  else if (e.key === 'Escape') { hideSuggestions(); }
});
document.getElementById('submit-btn').addEventListener('click', submitGuess);
document.getElementById('go-close').addEventListener('click', closeOverlay);
document.getElementById('info-btn').addEventListener('click', toggleInfo);
document.getElementById('info-close').addEventListener('click', toggleInfo);

// --- Init ---
async function boot() {
  // Authenticate with Discord SDK first (if inside an Activity)
  const discord = await initDiscord();
  if (discord) {
    sessionUserId = discord.user.id;
    discordChannelId = discord.channelId;
    discordGuildId = discord.guildId;
    console.log('Session keyed to Discord user:', sessionUserId);
  } else {
    console.log('Running outside Discord, using localStorage session');
  }

  // Then load the map and game
  await initMap();
}

boot();
