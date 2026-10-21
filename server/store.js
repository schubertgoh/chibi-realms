// SQLite persistence (Node's built-in node:sqlite — no native build needed).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const S = require('../public/js/shared.js');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'game.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    class TEXT NOT NULL,
    hair TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    assists INTEGER NOT NULL DEFAULT 0,
    deaths INTEGER NOT NULL DEFAULT 0,
    boss_kills INTEGER NOT NULL DEFAULT 0,
    play_seconds INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_played INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);
  CREATE INDEX IF NOT EXISTS idx_characters_score ON characters(score DESC);
`);

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const BOT_USER = 'ai-companions'; // system account that owns the AI companions' characters

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

const q = {
  insertUser: db.prepare('INSERT INTO users (username, pass_hash, salt, created_at) VALUES (?, ?, ?, ?)'),
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)'),
  sessionUser: db.prepare(`SELECT u.id, u.username, s.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE created_at < ?'),
  charsByUser: db.prepare('SELECT * FROM characters WHERE user_id = ? ORDER BY created_at'),
  charCount: db.prepare('SELECT COUNT(*) AS n FROM characters WHERE user_id = ?'),
  charById: db.prepare('SELECT * FROM characters WHERE id = ?'),
  charByName: db.prepare('SELECT id FROM characters WHERE name = ?'),
  charRowByName: db.prepare('SELECT * FROM characters WHERE name = ?'),
  insertChar: db.prepare('INSERT INTO characters (user_id, name, class, hair, created_at) VALUES (?, ?, ?, ?, ?)'),
  deleteChar: db.prepare('DELETE FROM characters WHERE id = ? AND user_id = ?'),
  saveChar: db.prepare(`UPDATE characters SET level = ?, xp = ?, score = ?, kills = ?, assists = ?, deaths = ?,
    boss_kills = ?, play_seconds = play_seconds + ?, last_played = ? WHERE id = ?`),
  rewardOffline: db.prepare(`UPDATE characters SET xp = xp + ?, score = score + ?, kills = kills + ?, assists = assists + ? WHERE id = ?`),
  fixLevel: db.prepare('UPDATE characters SET level = ? WHERE id = ?'),
  // AI companions play whenever anyone is online, so they stay off the leaderboard
  leaderboard: db.prepare(`SELECT name, class, hair, level, score, kills, assists, boss_kills FROM characters
    WHERE user_id NOT IN (SELECT id FROM users WHERE username = ?)
    ORDER BY score DESC, level DESC LIMIT ?`),
};

q.purgeSessions.run(Date.now() - SESSION_TTL_MS);

module.exports = {
  createUser(username, password) {
    if (q.userByName.get(username)) return null;
    const salt = crypto.randomBytes(16).toString('hex');
    const r = q.insertUser.run(username, hashPassword(password, salt), salt, Date.now());
    return { id: Number(r.lastInsertRowid), username };
  },
  verifyUser(username, password) {
    const u = q.userByName.get(username);
    if (!u) {
      hashPassword(password, 'timing-pad'); // keep timing similar for unknown users
      return null;
    }
    const a = Buffer.from(hashPassword(password, u.salt), 'hex');
    const b = Buffer.from(u.pass_hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? { id: u.id, username: u.username } : null;
  },
  createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    q.insertSession.run(token, userId, Date.now());
    return token;
  },
  userFromToken(token) {
    if (typeof token !== 'string' || token.length !== 64) return null;
    const row = q.sessionUser.get(token);
    if (!row) return null;
    if (Date.now() - row.created_at > SESSION_TTL_MS) { q.deleteSession.run(token); return null; }
    return { id: row.id, username: row.username };
  },
  deleteSession(token) { q.deleteSession.run(token); },

  listCharacters(userId) { return q.charsByUser.all(userId); },
  countCharacters(userId) { return q.charCount.get(userId).n; },
  getCharacter(id) { return q.charById.get(id) || null; },
  nameTaken(name) { return !!q.charByName.get(name); },
  createCharacter(userId, name, cls, hair) {
    const r = q.insertChar.run(userId, name, cls, hair, Date.now());
    return q.charById.get(Number(r.lastInsertRowid));
  },
  deleteCharacter(id, userId) { return q.deleteChar.run(id, userId).changes > 0; },
  saveCharacter(p, playSeconds) {
    q.saveChar.run(p.level, p.xp, p.score, p.kills, p.assists, p.deaths, p.bossKills,
      Math.round(playSeconds), Date.now(), p.charId);
  },
  rewardOffline(charId, xp, score, isKill) {
    q.rewardOffline.run(xp, score, isKill ? 1 : 0, isKill ? 0 : 1, charId);
    const c = q.charById.get(charId);
    if (c) q.fixLevel.run(S.levelFromXp(c.xp), charId);
  },
  leaderboard(limit = 15) { return q.leaderboard.all(BOT_USER, limit); },

  // AI companions are characters owned by a system account nobody can log in to
  // (the username fails the sign-up check and the password is random). Progress persists like anyone else's.
  ensureBotCharacter(name, cls, hair) {
    const u = q.userByName.get(BOT_USER) || this.createUser(BOT_USER, crypto.randomBytes(24).toString('hex'));
    for (let i = 0; i < 50; i++) {
      const n = i ? `${name}${i + 1}` : name;
      const row = q.charRowByName.get(n);
      if (!row) return this.createCharacter(u.id, n, cls, hair);
      if (row.user_id === u.id && row.class === cls) return row;
    }
    return null;
  },
};
