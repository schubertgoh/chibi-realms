const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const store = require('./server/store');
const Game = require('./server/game');
const S = require('./public/js/shared.js');

const PORT = Number(process.env.PORT) || 3000;
const app = express();
// Behind a hosting proxy (Render etc.) so req.ip is the real player, not the proxy — the auth rate limiter depends on it.
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server);
const game = new Game(io, store);

app.use(express.json({ limit: '10kb' }));
// no-cache = browsers always revalidate, so after an update nobody runs a mix of old and new game scripts
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

// --- tiny in-memory rate limiter for auth endpoints ---
const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const a = attempts.get(ip) || { n: 0, reset: now + 60_000 };
  if (now > a.reset) { a.n = 0; a.reset = now + 60_000; }
  a.n++;
  attempts.set(ip, a);
  return a.n > 20;
}

function auth(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = store.userFromToken(token);
  if (!user) return res.status(401).json({ error: 'Please log in again.' });
  req.user = user;
  req.token = token;
  next();
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const CHARNAME_RE = /^[A-Za-z0-9]{2,12}$/;

function charView(c) {
  const level = S.levelFromXp(c.xp);
  return {
    id: c.id, name: c.name, cls: c.class, hair: c.hair, level,
    xp: c.xp, xpLevelStart: S.xpForLevel(level), xpLevelEnd: S.xpForLevel(level + 1),
    score: c.score, kills: c.kills, assists: c.assists, deaths: c.deaths, bossKills: c.boss_kills,
    playSeconds: c.play_seconds, createdAt: c.created_at, lastPlayed: c.last_played,
    online: game.isCharacterOnline(c.id),
  };
}

app.post('/api/register', (req, res) => {
  if (rateLimited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username))
    return res.status(400).json({ error: 'Username must be 3-16 letters, numbers or _.' });
  if (typeof password !== 'string' || password.length < 6 || password.length > 64)
    return res.status(400).json({ error: 'Password must be 6-64 characters.' });
  const user = store.createUser(username, password);
  if (!user) return res.status(409).json({ error: 'That username is taken.' });
  res.json({ token: store.createSession(user.id), username: user.username });
});

app.post('/api/login', (req, res) => {
  if (rateLimited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string')
    return res.status(400).json({ error: 'Enter a username and password.' });
  const user = store.verifyUser(username, password);
  if (!user) return res.status(401).json({ error: 'Wrong username or password.' });
  res.json({ token: store.createSession(user.id), username: user.username });
});

app.post('/api/logout', auth, (req, res) => {
  store.deleteSession(req.token);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({
    username: req.user.username,
    characters: store.listCharacters(req.user.id).map(charView),
    maxCharacters: S.MAX_CHARACTERS_PER_ACCOUNT,
  });
});

app.post('/api/characters', auth, (req, res) => {
  const { name, cls, hair } = req.body || {};
  if (typeof name !== 'string' || !CHARNAME_RE.test(name))
    return res.status(400).json({ error: 'Name must be 2-12 letters or numbers.' });
  if (!S.CLASSES[cls]) return res.status(400).json({ error: 'Pick a class.' });
  if (!S.HAIR_COLORS.includes(hair)) return res.status(400).json({ error: 'Pick a hair color.' });
  if (store.countCharacters(req.user.id) >= S.MAX_CHARACTERS_PER_ACCOUNT)
    return res.status(400).json({ error: `You can have up to ${S.MAX_CHARACTERS_PER_ACCOUNT} characters.` });
  if (store.nameTaken(name)) return res.status(409).json({ error: 'That name is taken.' });
  res.json({ character: charView(store.createCharacter(req.user.id, name, cls, hair)) });
});

app.delete('/api/characters/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  if (game.isCharacterOnline(id)) return res.status(400).json({ error: 'That character is in game right now.' });
  if (!store.deleteCharacter(id, req.user.id)) return res.status(404).json({ error: 'Character not found.' });
  res.json({ ok: true });
});

app.get('/api/leaderboard', (req, res) => {
  res.json({
    leaders: store.leaderboard(15),
    online: game.onlineSummary(),
    maxPlayers: S.MAX_PLAYERS,
  });
});

function shutdown() {
  game.saveAll();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`Wild Realms running at http://localhost:${PORT}`));
