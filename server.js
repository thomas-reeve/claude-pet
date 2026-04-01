const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// --- API key auth (optional) ---
const API_KEY = process.env.API_KEY || null;

function requireAuth(req, res, next) {
  if (!API_KEY) return next();
  const provided = req.headers.authorization?.replace('Bearer ', '');
  if (provided === API_KEY) return next();
  res.status(401).json({ error: 'unauthorized' });
}

// --- State persistence ---
const STATE_FILE = path.join(__dirname, '.claude-pet-state.json');

const defaultState = {
  mode: 'idle',        // idle | working | sleeping | rate_limited | error
  task: null,
  toolType: null,      // read | write | bash | web | git | test | null
  tokens: 0,
  tokensToday: 0,
  tokensSession: 0,
  recentMeals: [],     // last 3 tasks
  rateLimitResetsAt: null,
  hunger: 80,          // 0-100
  messiness: 0,        // 0-100
  weather: { code: 0, description: 'clear', temp: 15 },
  timeOfDay: 'day',    // dawn | day | dusk | night
  lastUpdated: Date.now()
};

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Reset tokensToday if it's a new day
    const savedDate = new Date(data.lastUpdated).toDateString();
    const today = new Date().toDateString();
    if (savedDate !== today) data.tokensToday = 0;
    return { ...defaultState, ...data, lastUpdated: Date.now() };
  } catch {
    return { ...defaultState };
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(claudeState, null, 2));
  } catch (e) {
    console.error('[state] save failed:', e.message);
  }
}

let claudeState = loadState();

// --- Time of day ---
function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 18) return 'day';
  if (hour >= 18 && hour < 21) return 'dusk';
  return 'night';
}

// --- Weather (Open-Meteo, no API key needed) ---
// Config — persisted, configurable via UI
const CONFIG_FILE = path.join(__dirname, '.claude-pet-config.json');

const defaultConfig = {
  lat: parseFloat(process.env.LAT) || 52.2368,
  lon: parseFloat(process.env.LON) || -0.8957,
  locationName: process.env.LOCATION_NAME || 'Northampton, UK',
  ownerName: process.env.OWNER_NAME || ''
};

function loadConfig() {
  try {
    return { ...defaultConfig, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch {
    return { ...defaultConfig };
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(petConfig, null, 2));
}

let petConfig = loadConfig();

async function fetchWeather() {
  try {
    const fetch = (await import('node-fetch')).default;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${petConfig.lat}&longitude=${petConfig.lon}&current_weather=true&hourly=temperature_2m&forecast_days=1`;
    const res = await fetch(url);
    const data = await res.json();
    const code = data.current_weather?.weathercode ?? 0;
    const temp = Math.round(data.current_weather?.temperature ?? 15);
    claudeState.weather = { code, description: weatherCodeToDesc(code), temp };
    console.log(`[weather] ${claudeState.weather.description} ${temp}°C`);
    broadcast();
  } catch (e) {
    console.error('[weather] fetch failed:', e.message);
  }
}

function weatherCodeToDesc(code) {
  if (code === 0) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code <= 9) return 'foggy';
  if (code <= 19) return 'drizzle';
  if (code <= 29) return 'rain';
  if (code <= 39) return 'snow';
  if (code <= 49) return 'foggy';
  if (code <= 59) return 'drizzle';
  if (code <= 69) return 'rain';
  if (code <= 79) return 'snow';
  if (code <= 84) return 'rain';
  if (code <= 94) return 'storm';
  return 'storm';
}

// --- Hunger drain + night desk cleanup ---
setInterval(() => {
  if (claudeState.mode !== 'rate_limited') {
    claudeState.hunger = Math.max(0, claudeState.hunger - 0.5);
  }
  // Night cleanup — messiness drains slowly
  const hour = new Date().getHours();
  if (hour >= 21 || hour < 5) {
    claudeState.messiness = Math.max(0, claudeState.messiness - 2);
  }
  claudeState.timeOfDay = getTimeOfDay();

  // Auto-sleep at night if idle
  if (claudeState.timeOfDay === 'night' && claudeState.mode === 'idle') {
    claudeState.mode = 'sleeping';
  } else if (claudeState.timeOfDay !== 'night' && claudeState.mode === 'sleeping') {
    claudeState.mode = 'idle';
  }

  saveState();
  broadcast();
}, 30000); // every 30s

// Fetch weather every 30 mins (first fetch awaited at startup below)
setInterval(fetchWeather, 30 * 60 * 1000);

// --- Broadcast ---
function broadcast() {
  const payload = JSON.stringify({ type: 'state', data: { ...claudeState, config: petConfig } });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(payload);
  });
}

// --- WebSocket ---
wss.on('connection', (ws) => {
  console.log('[ws] client connected');
  claudeState.timeOfDay = getTimeOfDay();
  ws.send(JSON.stringify({ type: 'state', data: claudeState }));
  ws.on('close', () => console.log('[ws] client disconnected'));
});

// --- Tool type detection ---
function detectToolType(task) {
  if (!task) return null;
  const t = task.toLowerCase();
  if (/^(read|glob|grep|view)/.test(t)) return 'read';
  if (/^(edit|write|notebookedit)/.test(t)) return 'write';
  if (/^bash/.test(t)) {
    if (/git\s/.test(t)) return 'git';
    if (/test|jest|pytest|mocha|vitest|cargo test/.test(t)) return 'test';
    return 'bash';
  }
  if (/^(web|fetch|search)/.test(t)) return 'web';
  return null;
}

// --- API endpoints ---

// POST /status — called by Cowork/scripts
// Body: { state: "working|idle|sleeping|rate_limited", task?: "...", tokens?: 1234, resetsAt?: ISO }
const VALID_STATES = new Set(['idle', 'working', 'sleeping', 'rate_limited', 'error']);

app.post('/status', requireAuth, (req, res) => {
  const { state, task, tokens, resetsAt } = req.body;

  if (state && !VALID_STATES.has(state)) {
    return res.status(400).json({ error: 'invalid state' });
  }

  const prevMode = claudeState.mode;

  if (state) claudeState.mode = state;
  if (task) {
    claudeState.task = String(task).slice(0, 200);
    claudeState.toolType = detectToolType(task);
  }

  if (state === 'working' && tokens) {
    claudeState.tokens = tokens;
    claudeState.tokensToday += tokens;
    claudeState.tokensSession += tokens;
    claudeState.hunger = Math.min(100, claudeState.hunger + (tokens / 100));
    claudeState.recentMeals = [
      { task: task || 'task', tokens, time: Date.now() },
      ...claudeState.recentMeals.slice(0, 9)
    ];
  }

  if (state === 'idle') {
    // Task just finished — add messiness
    if (prevMode === 'working') {
      claudeState.messiness = Math.min(100, claudeState.messiness + 8 + Math.floor(Math.random() * 8));
    }
    claudeState.task = null;
    claudeState.tokens = 0;
    claudeState.toolType = null;
  }

  if (state === 'rate_limited' && resetsAt) {
    claudeState.rateLimitResetsAt = resetsAt;
  }

  claudeState.lastUpdated = Date.now();
  claudeState.timeOfDay = getTimeOfDay();
  saveState();
  broadcast();
  res.json({ ok: true, state: claudeState });
});

// GET /status — check current state
app.get('/status', (req, res) => {
  claudeState.timeOfDay = getTimeOfDay();
  res.json({ ...claudeState, config: petConfig });
});

// GET /feed — manually feed tokens (for testing)
app.get('/feed', requireAuth, (req, res) => {
  const tokens = parseInt(req.query.tokens) || 1000;
  const task = req.query.task || 'manual feed';
  claudeState.mode = 'working';
  claudeState.task = task;
  claudeState.tokens = tokens;
  claudeState.tokensToday += tokens;
  claudeState.tokensSession += tokens;
  claudeState.hunger = Math.min(100, claudeState.hunger + (tokens / 100));
  claudeState.recentMeals = [
    { task, tokens, time: Date.now() },
    ...claudeState.recentMeals.slice(0, 9)
  ];
  claudeState.lastUpdated = Date.now();
  saveState();
  broadcast();
  setTimeout(() => {
    claudeState.mode = 'idle';
    claudeState.task = null;
    saveState();
    broadcast();
  }, 5000);
  res.json({ ok: true });
});

// GET /config — current config
app.get('/config', (req, res) => {
  res.json(petConfig);
});

// POST /config — update config
app.post('/config', (req, res) => {
  const { lat, lon, locationName, ownerName } = req.body;
  if (lat !== undefined && lon !== undefined) {
    if (typeof lat !== 'number' || typeof lon !== 'number' || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'invalid coordinates' });
    }
    petConfig.lat = lat;
    petConfig.lon = lon;
    if (locationName) petConfig.locationName = String(locationName).slice(0, 100);
    fetchWeather();
  }
  if (ownerName !== undefined) {
    petConfig.ownerName = String(ownerName).slice(0, 50);
  }
  saveConfig();
  broadcast();
  res.json({ ok: true, config: petConfig });
});

const PORT = process.env.PORT || 3950;
const HOST = process.env.HOST || '127.0.0.1';
// Fetch weather before starting so first clients get real data
fetchWeather().then(() => {});
server.listen(PORT, HOST, () => {
  console.log(`\n🤖 Claude Pet running at http://${HOST}:${PORT}`);
  if (HOST === '127.0.0.1') console.log(`   (set HOST=0.0.0.0 for network access)`);
  console.log(`   POST /status  — update state from Cowork`);
  console.log(`   GET  /status  — check current state`);
  console.log(`   GET  /feed    — test feeding (?tokens=2000&task=inbox)\n`);
});
