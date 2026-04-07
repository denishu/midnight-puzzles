// Travle Frontend
// Loads GeoJSON, renders map, handles guesses with autocomplete

const GEOJSON_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';

// --- State ---
let map, geoLayer;
let allCountries = []; // [{name, feature, layer}]
let countryLookup = {}; // lowercase name -> {feature, layer}
let puzzle = null;
let guesses = [];
let guessesRemaining = 0;
let gameOver = false;
let selectedSuggestion = -1;

// --- Hardcoded daily puzzle (will be replaced by API later) ---
function getDailyPuzzle() {
  // For now, hardcode. Later this comes from the backend.
  return {
    start: 'germany',
    end: 'mali',
    shortestPathLength: 5,
    maxGuesses: 8
  };
}

// --- Map Setup ---
async function initMap() {
  map = L.map('map', {
    center: [20, 0],
    zoom: 2,
    minZoom: 2,
    maxZoom: 8,
    worldCopyJump: true,
    zoomControl: true
  });

  // No tile layer — just a solid ocean background via CSS
  // The map container background is already dark blue

  updateStatus('Loading country data...');
  const resp = await fetch(GEOJSON_URL);
  const geojson = await resp.json();

  geoLayer = L.geoJSON(geojson, {
    style: defaultStyle,
    onEachFeature: (feature, layer) => {
      const name = (feature.properties.ADMIN || feature.properties.name || '').toLowerCase();
      allCountries.push({ name, feature, layer });
      countryLookup[name] = { feature, layer };
    }
  }).addTo(map);

  updateStatus('Ready');
  startGame();
}

function defaultStyle() {
  return {
    fillColor: 'transparent',
    weight: 0,
    color: 'transparent',
    fillOpacity: 0
  };
}

function highlightCountry(name, color) {
  const entry = countryLookup[name.toLowerCase()];
  if (!entry) return;
  entry.layer.setStyle({
    fillColor: color,
    fillOpacity: 0.7,
    weight: 1.5,
    color: '#fff'
  });
  entry.layer.bringToFront();
  // Add tooltip with country name
  entry.layer.bindTooltip(name.charAt(0).toUpperCase() + name.slice(1), {
    sticky: true,
    className: 'country-tooltip'
  });
}

function zoomToCountries(names) {
  const bounds = L.latLngBounds([]);
  for (const n of names) {
    const entry = countryLookup[n.toLowerCase()];
    if (entry) bounds.extend(entry.layer.getBounds());
  }
  if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.3));
  }
}

// --- Game Logic ---
function startGame() {
  puzzle = getDailyPuzzle();
  guessesRemaining = puzzle.maxGuesses;
  guesses = [];
  gameOver = false;

  document.getElementById('start-country').textContent = puzzle.start.toUpperCase();
  document.getElementById('end-country').textContent = puzzle.end.toUpperCase();
  document.getElementById('guesses-left').textContent = guessesRemaining;
  document.getElementById('submit-btn').disabled = false;

  // Highlight start and end
  highlightCountry(puzzle.start, '#3b82f6');
  highlightCountry(puzzle.end, '#3b82f6');
  zoomToCountries([puzzle.start, puzzle.end]);

  updateStatus(`Connect ${puzzle.start.toUpperCase()} to ${puzzle.end.toUpperCase()} — ${puzzle.shortestPathLength - 1} countries to find`);
}

function submitGuess() {
  const input = document.getElementById('guess-input');
  const country = input.value.trim().toLowerCase();
  if (!country || gameOver) return;

  // Validate
  if (!countryLookup[country]) {
    updateStatus(`"${country}" not found on the map.`);
    return;
  }
  if (country === puzzle.start || country === puzzle.end) {
    updateStatus(`${country} is already the start or end.`);
    return;
  }
  if (guesses.some(g => g.country === country)) {
    updateStatus(`You already guessed ${country}.`);
    return;
  }

  const status = 'neutral'; // TODO: get from backend
  guesses.push({ country, status });
  guessesRemaining--;

  // Color the country
  const colorMap = { green: '#22c55e', yellow: '#eab308', red: '#ef4444', neutral: '#60a5fa' };
  highlightCountry(country, colorMap[status] || '#60a5fa');

  // Update UI
  document.getElementById('guesses-left').textContent = guessesRemaining;
  renderGuessChips();
  zoomToCountries([puzzle.start, puzzle.end, ...guesses.map(g => g.country)]);

  input.value = '';
  hideSuggestions();

  if (guessesRemaining <= 0) {
    gameOver = true;
    document.getElementById('submit-btn').disabled = true;
    updateStatus('Out of guesses!');
  }
}

function renderGuessChips() {
  const bar = document.getElementById('guesses-bar');
  bar.innerHTML = guesses.map(g =>
    `<span class="guess-chip ${g.status}">${g.country}</span>`
  ).join('');
}

function updateStatus(msg) {
  document.getElementById('status-bar').textContent = msg;
}

// --- Autocomplete ---
function showSuggestions(query) {
  const box = document.getElementById('suggestions');
  if (!query || query.length < 1) { hideSuggestions(); return; }

  const q = query.toLowerCase();
  const matches = allCountries
    .filter(c => c.name.includes(q))
    .sort((a, b) => {
      // Prefer starts-with over contains
      const aStarts = a.name.startsWith(q) ? 0 : 1;
      const bStarts = b.name.startsWith(q) ? 0 : 1;
      return aStarts - bStarts || a.name.localeCompare(b.name);
    })
    .slice(0, 8);

  if (matches.length === 0) { hideSuggestions(); return; }

  selectedSuggestion = -1;
  box.innerHTML = matches.map((m, i) =>
    `<div class="suggestion" data-name="${m.name}" data-index="${i}">${m.name}</div>`
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

// --- Event Listeners ---
document.getElementById('guess-input').addEventListener('input', (e) => {
  showSuggestions(e.target.value);
});

document.getElementById('guess-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); navigateSuggestions(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); navigateSuggestions(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); hideSuggestions(); submitGuess(); }
  else if (e.key === 'Escape') { hideSuggestions(); }
});

document.getElementById('submit-btn').addEventListener('click', submitGuess);

// --- Init ---
initMap();
