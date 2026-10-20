// Authoritative shared-world simulation: monsters, abilities, damage, rewards.
const S = require('../public/js/shared.js');

const TICK_MS = 50;
const BOSS_INTERVAL_MS = 4 * 60 * 1000;
const RESPAWN_DELAY_MS = 3000;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sign = (v) => (v < 0 ? -1 : 1);

class Game {
  constructor(io, store) {
    this.io = io;
    this.store = store;
    this.players = new Map(); // socket.id -> player
    this.monsters = new Map();
    this.projectiles = [];
    this.zones = [];
    this.summons = [];
    this.fx = [];
    this.nid = 1;
    this.lastSpawn = 0;
    this.nextBossAt = Date.now() + 90 * 1000;
    this.lastTick = Date.now();

    io.on('connection', (socket) => this.onConnect(socket));
    setInterval(() => this.tick(), TICK_MS);
    setInterval(() => this.saveAll(), 30_000);
  }

  // ---------- connection / players ----------
  onConnect(socket) {
    socket.on('join', (d) => this.onJoin(socket, d || {}));
    socket.on('state', (d) => {
      const p = socket.data.player;
      if (!p || p.dead || !d) return;
      const num = (v, a, b) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, a, b) : null);
      const x = num(d.x, 0, S.WORLD.w), y = num(d.y, 0, S.WORLD.h);
      if (x === null || y === null) return;
      p.x = x; p.y = y;
      p.facing = d.f === -1 ? -1 : 1;
      p.anim = ['idle', 'walk', 'jump', 'climb'].includes(d.a) ? d.a : 'idle';
    });
    socket.on('ability', (d) => {
      const p = socket.data.player;
      if (!p || p.dead || !d) return;
      const slot = d.slot;
      if (![0, 1, 2, 3].includes(slot)) return;
      const now = Date.now();
      if (now < p.cds[slot] - 120) return; // small latency slack
      p.cds[slot] = now + S.CLASSES[p.cls].skills[slot].cd * 1000;
      p.atkSeq++;
      p.atkSlot = slot;
      this.cast(p, slot, now);
    });
    socket.on('chat', (text) => {
      const p = socket.data.player;
      if (!p || typeof text !== 'string') return;
      const now = Date.now();
      if (now - p.lastChat < 600) return;
      p.lastChat = now;
      const clean = text.replace(/\s+/g, ' ').trim().slice(0, 120);
      if (clean) this.io.emit('chat', { id: p.sid, n: p.name, text: clean });
    });
    socket.on('respawn', () => {
      const p = socket.data.player;
      if (!p || !p.dead || Date.now() - p.deadAt < RESPAWN_DELAY_MS) return;
      p.dead = false;
      p.hp = p.maxHp;
      p.x = S.SPAWN.x + rand(-80, 80);
      p.y = S.SPAWN.y;
      p.invulnUntil = Date.now() + 2000;
      socket.emit('teleport', { x: p.x, y: p.y, f: p.facing });
    });
    socket.on('disconnect', () => {
      const p = socket.data.player;
      if (p && this.players.get(socket.id) === p) {
        this.removePlayer(p);
        this.sys(`${p.name} left the realm.`);
      }
    });
  }

  onJoin(socket, { token, characterId }) {
    if (socket.data.player) return;
    const user = this.store.userFromToken(token);
    if (!user) return socket.emit('joinError', 'Your session expired. Please log in again.');
    const ch = this.store.getCharacter(Number(characterId));
    if (!ch || ch.user_id !== user.id) return socket.emit('joinError', 'Character not found.');

    for (const other of this.players.values()) {
      if (other.charId === ch.id) {
        other.socket.emit('kicked', 'This character was logged in from another window.');
        this.removePlayer(other);
        other.socket.disconnect(true);
      }
    }
    if (this.players.size >= S.MAX_PLAYERS)
      return socket.emit('joinError', `The realm is full (${S.MAX_PLAYERS}/${S.MAX_PLAYERS} heroes). Try again soon!`);

    const level = S.levelFromXp(ch.xp);
    const stats = S.playerStats(ch.class, level);
    const now = Date.now();
    const p = {
      sid: socket.id, socket, userId: user.id, charId: ch.id, name: ch.name, cls: ch.class, hair: ch.hair,
      level, xp: ch.xp, score: ch.score, kills: ch.kills, assists: ch.assists, deaths: ch.deaths, bossKills: ch.boss_kills,
      maxHp: stats.maxHp, hp: stats.maxHp, dmgMult: stats.dmgMult, armor: stats.armor,
      x: S.SPAWN.x + rand(-100, 100), y: S.SPAWN.y, facing: 1, anim: 'idle',
      dead: false, deadAt: 0, cds: [0, 0, 0, 0], atkSeq: 0, atkSlot: 0,
      stealthUntil: 0, invulnUntil: now + 2000, ironWallUntil: 0, hitIframeUntil: 0, lastHurt: 0,
      backstabReady: false, lastChat: 0, lastSave: now,
    };
    if (this.players.size === 0 && this.nextBossAt < now) this.nextBossAt = now + 90 * 1000;
    this.players.set(socket.id, p);
    socket.data.player = p;
    socket.join('game');
    socket.emit('joined', { id: socket.id, x: p.x, y: p.y, me: this.selfInfo(p) });
    this.sys(`${p.name} the ${S.CLASSES[p.cls].name} joined the realm!`);
  }

  removePlayer(p) {
    this.savePlayer(p);
    this.players.delete(p.sid);
    p.socket.leave('game');
    this.summons = this.summons.filter((s) => s.owner !== p.sid);
    for (const m of this.monsters.values()) if (m.target === p.sid) m.target = null;
  }

  isCharacterOnline(charId) {
    for (const p of this.players.values()) if (p.charId === charId) return true;
    return false;
  }
  onlineSummary() {
    return [...this.players.values()].map((p) => ({ name: p.name, cls: p.cls, level: p.level }));
  }
  playerByChar(charId) {
    for (const p of this.players.values()) if (p.charId === charId) return p;
    return null;
  }

  selfInfo(p) {
    return {
      name: p.name, cls: p.cls, hair: p.hair, level: p.level, xp: p.xp,
      xpLevelStart: S.xpForLevel(p.level), xpLevelEnd: S.xpForLevel(p.level + 1),
      score: p.score, kills: p.kills, assists: p.assists, deaths: p.deaths, bossKills: p.bossKills,
      maxHp: p.maxHp,
    };
  }
  sendSelf(p) { p.socket.emit('me', this.selfInfo(p)); }

  savePlayer(p) {
    const now = Date.now();
    try {
      this.store.saveCharacter(p, (now - p.lastSave) / 1000);
      p.lastSave = now;
    } catch (e) {
      console.error('save failed', e);
    }
  }
  saveAll() { for (const p of this.players.values()) this.savePlayer(p); }

  sys(text) { this.io.emit('sys', text); }
  addFx(fx) { this.fx.push(fx); }

  // ---------- monsters ----------
  spawnMonster(type, platIdx, x) {
    const def = S.MONSTERS[type];
    const plat = S.PLATFORMS[platIdx];
    const hpScale = def.boss ? 1 + 0.45 * Math.max(0, this.players.size - 1) : 1;
    const m = {
      id: this.nid++, type, plat: platIdx,
      x: clamp(x ?? rand(plat.x + def.w, plat.x + plat.w - def.w), plat.x + def.w / 2, plat.x + plat.w - def.w / 2),
      y: plat.y, w: def.w, h: def.h, facing: Math.random() < 0.5 ? -1 : 1,
      hp: Math.round(def.hp * hpScale), maxHp: Math.round(def.hp * hpScale),
      moveDir: 0, idleT: rand(0.5, 2), moving: false, kbv: 0, target: null,
      stunUntil: 0, freezeUntil: 0, rootUntil: 0, slowUntil: 0, slowFactor: 1, hurtAt: 0,
      contrib: new Map(), stompT: 5, summonT: 10, dead: false,
    };
    this.monsters.set(m.id, m);
    this.addFx({ t: 'spawn', x: m.x, y: m.y - m.h / 2, big: def.boss ? 1 : 0 });
    return m;
  }

  pickSpawn() {
    // weight platforms by width; ground is extra-wide so damp it
    const weights = S.PLATFORMS.map((p) => (p.ground ? 900 : p.w));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let idx = 0;
    for (; idx < weights.length; idx++) { r -= weights[idx]; if (r <= 0) break; }
    idx = Math.min(idx, S.PLATFORMS.length - 1);
    const plat = S.PLATFORMS[idx];
    const roll = Math.random();
    let type;
    if (plat.y >= 1200) type = roll < 0.6 ? 'slime' : 'mushroom';
    else if (plat.y >= 840) type = roll < 0.3 ? 'slime' : roll < 0.8 ? 'mushroom' : 'stump';
    else type = roll < 0.4 ? 'mushroom' : 'stump';
    // avoid spawning right on top of a player
    const def = S.MONSTERS[type];
    let x = rand(plat.x + def.w, plat.x + plat.w - def.w);
    for (const p of this.players.values()) {
      if (Math.abs(p.y - plat.y) < 40 && Math.abs(p.x - x) < 140) x = p.x + (x < p.x ? -160 : 160);
    }
    return { type, idx, x };
  }

  bossAlive() {
    for (const m of this.monsters.values()) if (S.MONSTERS[m.type].boss) return true;
    return false;
  }

  findPlayerTarget(m, rangeX, rangeY, now) {
    let best = null, bestD = Infinity;
    for (const p of this.players.values()) {
      if (p.dead || now < p.stealthUntil) continue;
      const dx = Math.abs(p.x - m.x), dy = Math.abs(p.y - m.y);
      if (dx < rangeX && dy < rangeY && dx < bestD) { best = p; bestD = dx; }
    }
    return best;
  }

  updateMonster(m, dt, now) {
    const def = S.MONSTERS[m.type];
    const plat = S.PLATFORMS[m.plat];
    const minX = plat.x + m.w / 2, maxX = plat.x + plat.w - m.w / 2;
    const disabled = now < m.stunUntil || now < m.freezeUntil;
    const rooted = now < m.rootUntil;
    const speed = def.speed * (now < m.slowUntil ? m.slowFactor : 1);
    m.moving = false;

    if (m.kbv) {
      m.x += m.kbv * dt;
      m.kbv *= Math.pow(0.004, dt);
      if (Math.abs(m.kbv) < 15) m.kbv = 0;
    }

    if (!disabled) {
      let target = m.target ? this.players.get(m.target) : null;
      const rangeY = def.boss ? 200 : 90;
      if (!target || target.dead || now < target.stealthUntil || Math.abs(target.y - m.y) > rangeY + 20 || Math.abs(target.x - m.x) > 520) {
        target = this.findPlayerTarget(m, def.boss ? 700 : 340, rangeY, now);
        m.target = target ? target.sid : null;
      }
      if (target) {
        const dx = target.x - m.x;
        if (Math.abs(dx) > 6) {
          m.facing = sign(dx);
          if (!rooted) { m.x += m.facing * speed * 1.4 * dt; m.moving = true; }
        }
      } else {
        m.idleT -= dt;
        if (m.idleT <= 0) { m.moveDir = [-1, 0, 1][Math.floor(Math.random() * 3)]; m.idleT = rand(1, 3); }
        if (m.moveDir && !rooted) {
          m.facing = m.moveDir;
          m.x += m.moveDir * speed * dt;
          m.moving = true;
          if (m.x <= minX || m.x >= maxX) m.moveDir *= -1;
        }
      }

      if (def.boss) this.updateBoss(m, dt, now);

      // contact damage
      for (const p of this.players.values()) {
        if (p.dead) continue;
        if (Math.abs(p.x - m.x) < m.w / 2 + 12 && p.y > m.y - m.h - 10 && p.y - 50 < m.y) {
          this.hurtPlayer(p, def.dmg, m.x, now);
        }
      }
    }
    m.x = clamp(m.x, minX, maxX);
  }

  updateBoss(m, dt, now) {
    m.stompT -= dt;
    m.summonT -= dt;
    if (m.stompT <= 0) {
      m.stompT = rand(5, 7);
      this.addFx({ t: 'stomp', x: m.x, y: m.y });
      for (const p of this.players.values()) {
        if (!p.dead && Math.abs(p.y - m.y) < 12 && Math.abs(p.x - m.x) < 460) this.hurtPlayer(p, 22, m.x, now, true);
      }
    }
    if (m.summonT <= 0) {
      m.summonT = 12;
      let minions = 0;
      for (const o of this.monsters.values()) if (o.plat === m.plat) minions++;
      if (minions < 10) for (let i = 0; i < 2; i++) this.spawnMonster('slime', m.plat, m.x + rand(-160, 160));
    }
  }

  hurtPlayer(p, amount, fromX, now, ignoreIframe) {
    if (p.dead || now < p.invulnUntil || now < p.stealthUntil) return;
    if (!ignoreIframe && now < p.hitIframeUntil) return;
    let dmg = amount * (1 - p.armor) * (now < p.ironWallUntil ? 0.4 : 1) * rand(0.9, 1.1);
    dmg = Math.max(1, Math.round(dmg));
    p.hp -= dmg;
    p.hitIframeUntil = now + 800;
    p.lastHurt = now;
    this.addFx({ t: 'dmg', x: p.x, y: p.y - 70, v: dmg, k: 'p' });
    p.socket.emit('hurt', { kb: sign(p.x - fromX) });
    if (p.hp <= 0) {
      p.hp = 0;
      p.dead = true;
      p.deadAt = now;
      p.deaths++;
      p.stealthUntil = 0;
      this.addFx({ t: 'pdeath', x: p.x, y: p.y });
      this.sendSelf(p);
    }
  }

  damageMonster(m, base, p, opts = {}) {
    if (!m || m.dead) return;
    const now = Date.now();
    let dmg = base * p.dmgMult * (opts.mult || 1) * rand(0.9, 1.1);
    const crit = opts.crit || Math.random() < (p.cls === 'rogue' ? 0.25 : 0.1);
    if (crit) dmg *= 1.5;
    if (now < m.freezeUntil && !opts.freeze) dmg *= 1.25; // shatter bonus
    dmg = Math.max(1, Math.round(dmg));
    m.hp -= dmg;
    m.hurtAt = now;
    const credit = dmg + (opts.stun || opts.freeze || opts.root || opts.slow ? 8 : 0);
    const c = m.contrib.get(p.charId) || { name: p.name, v: 0 };
    c.v += credit;
    m.contrib.set(p.charId, c);
    if (opts.stun) m.stunUntil = Math.max(m.stunUntil, now + opts.stun);
    if (opts.freeze) m.freezeUntil = Math.max(m.freezeUntil, now + opts.freeze);
    if (opts.root) m.rootUntil = Math.max(m.rootUntil, now + opts.root);
    if (opts.slow) {
      m.slowFactor = now < m.slowUntil ? Math.min(m.slowFactor, opts.slow) : opts.slow;
      m.slowUntil = Math.max(m.slowUntil, now + opts.slowMs);
    }
    if (opts.kb && !S.MONSTERS[m.type].boss) m.kbv = opts.kb;
    if (!m.target) m.target = p.sid;
    this.addFx({ t: 'dmg', x: m.x + rand(-8, 8), y: m.y - m.h - 10, v: dmg, k: crit ? 'c' : 'm' });
    if (m.hp <= 0) this.killMonster(m, p);
  }

  killMonster(m, killer) {
    m.dead = true;
    this.monsters.delete(m.id);
    const def = S.MONSTERS[m.type];
    this.addFx({ t: 'death', x: m.x, y: m.y, m: m.type });
    let total = 0;
    for (const c of m.contrib.values()) total += c.v;
    const names = [];
    for (const [charId, c] of m.contrib) {
      const share = c.v / total;
      const score = Math.max(1, Math.round(def.score * share));
      const xp = Math.max(1, Math.round(def.xp * share));
      const isKill = charId === killer.charId;
      names.push(c.name);
      const p = this.playerByChar(charId);
      if (p) {
        p.score += score;
        if (isKill) p.kills++; else p.assists++;
        if (def.boss) p.bossKills++;
        this.giveXp(p, xp);
        p.socket.emit('reward', { score, xp, monster: def.name, share: Math.round(share * 100), kill: isKill });
        this.sendSelf(p);
      } else {
        this.store.rewardOffline(charId, xp, score, isKill);
      }
    }
    if (def.boss) {
      this.sys(`👑 The King Slime was defeated by ${names.join(', ')}!`);
      this.nextBossAt = Date.now() + BOSS_INTERVAL_MS;
      for (const p of this.players.values()) this.savePlayer(p);
    }
  }

  giveXp(p, xp) {
    p.xp += xp;
    const newLevel = S.levelFromXp(p.xp);
    if (newLevel > p.level) {
      p.level = newLevel;
      const st = S.playerStats(p.cls, p.level);
      p.maxHp = st.maxHp;
      p.dmgMult = st.dmgMult;
      p.hp = p.maxHp;
      this.addFx({ t: 'levelup', x: p.x, y: p.y });
      this.sys(`✨ ${p.name} reached level ${p.level}!`);
      this.savePlayer(p);
    }
  }

  // ---------- abilities ----------
  monstersInBox(x1, y1, x2, y2) {
    const out = [];
    for (const m of this.monsters.values()) {
      if (m.x + m.w / 2 > x1 && m.x - m.w / 2 < x2 && m.y > y1 && m.y - m.h < y2) out.push(m);
    }
    return out;
  }
  monstersInCircle(x, y, r) {
    const out = [];
    for (const m of this.monsters.values()) {
      const cx = clamp(x, m.x - m.w / 2, m.x + m.w / 2);
      const cy = clamp(y, m.y - m.h, m.y);
      if ((cx - x) ** 2 + (cy - y) ** 2 < r * r) out.push(m);
    }
    return out;
  }
  frontBox(p, reach, height) {
    const f = p.facing;
    return f > 0 ? [p.x - 10, p.y - height, p.x + reach, p.y + 6] : [p.x - reach, p.y - height, p.x + 10, p.y + 6];
  }
  shoot(p, type, opts) {
    this.projectiles.push({
      id: this.nid++, type, owner: p.sid, x: p.x + p.facing * 24, y: p.y - 34,
      vx: opts.vx, vy: opts.vy || 0, dmg: opts.dmg, life: opts.life, pierce: !!opts.pierce,
      hit: new Set(), r: opts.r || 12, slow: opts.slow,
    });
  }

  cast(p, slot, now) {
    const f = p.facing;
    const key = p.cls + slot;
    switch (key) {
      // ---- Fighter ----
      case 'fighter0':
        for (const m of this.monstersInBox(...this.frontBox(p, 100, 85))) this.damageMonster(m, 28, p, { kb: f * 160 });
        this.addFx({ t: 'slash', x: p.x, y: p.y, f, c: p.cls });
        break;
      case 'fighter1':
        for (const m of this.monstersInBox(...this.frontBox(p, 85, 75))) this.damageMonster(m, 20, p, { stun: 1600, kb: f * 320 });
        this.addFx({ t: 'bash', x: p.x + f * 40, y: p.y - 30, f });
        break;
      case 'fighter2':
        for (const m of this.monstersInCircle(p.x, p.y - 30, 145)) this.damageMonster(m, 42, p, { kb: sign(m.x - p.x) * 240 });
        this.addFx({ t: 'whirl', x: p.x, y: p.y - 30 });
        break;
      case 'fighter3':
        p.ironWallUntil = now + 5000;
        this.addFx({ t: 'shield', x: p.x, y: p.y });
        break;
      // ---- Mage ----
      case 'mage0':
        this.shoot(p, 'fireball', { vx: f * 650, dmg: 30, life: 1.2, r: 16 });
        break;
      case 'mage1': {
        const targets = [...this.monsters.values()]
          .filter((m) => (m.x - p.x) * f > -30 && Math.abs(m.x - p.x) < 520 && Math.abs(m.y - p.y) < 240)
          .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x)).slice(0, 3);
        const pts = [[p.x + f * 18, p.y - 40]];
        for (const m of targets) { pts.push([m.x, m.y - m.h / 2]); this.damageMonster(m, 55, p, { stun: 350 }); }
        if (!targets.length) pts.push([p.x + f * 260, p.y - 40]);
        this.addFx({ t: 'lightning', pts });
        break;
      }
      case 'mage2':
        for (const m of this.monstersInCircle(p.x, p.y - 25, 175)) this.damageMonster(m, 15, p, { freeze: 2500 });
        this.addFx({ t: 'nova', x: p.x, y: p.y - 25, r: 175 });
        break;
      case 'mage3':
        this.zones.push({ id: this.nid++, type: 'slow', owner: p.sid, x: p.x + f * 170, y: p.y, r: 150, until: now + 5000, tickAt: 0 });
        break;
      // ---- Rogue ----
      case 'rogue0': {
        const stealthed = now < p.stealthUntil;
        let hitAny = false;
        for (const m of this.monstersInBox(...this.frontBox(p, 80, 70))) {
          let mult = 1, crit = false;
          if (stealthed) { mult = 3.5; crit = true; }
          else if (p.backstabReady) { mult = 2.2; crit = true; }
          else if (m.facing === f) mult = 1.5; // striking from behind
          this.damageMonster(m, 20, p, { mult, crit, kb: f * 60 });
          hitAny = true;
        }
        if (hitAny) p.backstabReady = false;
        if (stealthed) p.stealthUntil = 0;
        this.addFx({ t: 'slash', x: p.x, y: p.y, f, c: p.cls, big: stealthed ? 1 : 0 });
        break;
      }
      case 'rogue1':
        p.stealthUntil = now + 5000;
        for (const m of this.monsters.values()) if (m.target === p.sid) m.target = null;
        this.addFx({ t: 'smoke', x: p.x, y: p.y });
        break;
      case 'rogue2':
        p.invulnUntil = now + 450;
        this.addFx({ t: 'dust', x: p.x, y: p.y });
        break;
      case 'rogue3': {
        let best = null, bd = 430;
        for (const m of this.monsters.values()) {
          const d = Math.hypot(m.x - p.x, m.y - p.y);
          if (d < bd) { bd = d; best = m; }
        }
        if (!best) {
          p.cds[slot] = 0;
          p.socket.emit('cdReset', { slot, msg: 'No enemy close enough!' });
          break;
        }
        const plat = S.PLATFORMS[best.plat];
        const tx = clamp(best.x - best.facing * (best.w / 2 + 22), plat.x + 5, plat.x + plat.w - 5);
        this.addFx({ t: 'smoke', x: p.x, y: p.y });
        p.x = tx; p.y = best.y; p.facing = sign(best.x - tx);
        p.backstabReady = true;
        p.invulnUntil = now + 300;
        p.socket.emit('teleport', { x: p.x, y: p.y, f: p.facing });
        this.addFx({ t: 'smoke', x: p.x, y: p.y });
        break;
      }
      // ---- Marksman ----
      case 'marksman0':
        this.shoot(p, 'arrow', { vx: f * 1000, dmg: 22, life: 0.9 });
        break;
      case 'marksman1':
        for (let i = -2; i <= 2; i++) {
          const a = i * 0.12;
          this.shoot(p, 'arrow', { vx: f * 950 * Math.cos(a), vy: 950 * Math.sin(a), dmg: 16, life: 0.7 });
        }
        break;
      case 'marksman2':
        this.shoot(p, 'pierce', { vx: f * 1400, dmg: 60, life: 0.8, pierce: true, r: 16 });
        break;
      case 'marksman3':
        for (const m of this.monstersInCircle(p.x, p.y - 25, 140)) this.damageMonster(m, 10, p, { kb: sign(m.x - p.x) * 380, slow: 0.5, slowMs: 2000 });
        this.addFx({ t: 'burst', x: p.x, y: p.y - 25 });
        break;
      // ---- Druid ----
      case 'druid0':
        this.shoot(p, 'thorn', { vx: f * 600, dmg: 20, life: 1.1, slow: 0.6 });
        break;
      case 'druid1': {
        const cx = p.x + f * 100;
        for (const m of this.monstersInCircle(cx, p.y - 20, 185)) this.damageMonster(m, 12, p, { root: 3000 });
        this.addFx({ t: 'entangle', x: cx, y: p.y, r: 185 });
        break;
      }
      case 'druid2': {
        let healedOthers = 0;
        for (const o of this.players.values()) {
          if (o.dead || Math.hypot(o.x - p.x, o.y - p.y) > 270) continue;
          const amt = Math.min(o.maxHp - o.hp, Math.round(o.maxHp * 0.3 + 10 * p.dmgMult));
          o.hp += amt;
          if (amt > 0) this.addFx({ t: 'dmg', x: o.x, y: o.y - 70, v: amt, k: 'h' });
          if (o !== p) healedOthers += amt;
        }
        const bonus = Math.floor(healedOthers / 10);
        if (bonus > 0) {
          p.score += bonus;
          p.socket.emit('reward', { score: bonus, xp: 0, monster: 'healing allies', heal: true });
          this.sendSelf(p);
        }
        this.addFx({ t: 'heal', x: p.x, y: p.y, r: 270 });
        break;
      }
      case 'druid3':
        this.summons = this.summons.filter((s) => s.owner !== p.sid);
        this.summons.push({ id: this.nid++, owner: p.sid, x: p.x - f * 40, y: p.y - 70, f, until: now + 15000, atkAt: 0 });
        this.addFx({ t: 'summon', x: p.x - f * 40, y: p.y - 70 });
        break;
    }
  }

  // ---------- main loop ----------
  tick() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (this.players.size === 0) { this.fx = []; return; }

    // spawning
    let count = 0;
    for (const m of this.monsters.values()) if (!S.MONSTERS[m.type].boss) count++;
    const max = Math.min(30, 10 + this.players.size * 2);
    if (count < max && now - this.lastSpawn > 1600) {
      this.lastSpawn = now;
      const sp = this.pickSpawn();
      this.spawnMonster(sp.type, sp.idx, sp.x);
    }
    if (now >= this.nextBossAt && !this.bossAlive()) {
      this.spawnMonster('kingslime', 0, rand(500, 2700));
      this.nextBossAt = Infinity;
      this.sys('👑 The King Slime has appeared on the ground floor! Team up to defeat it!');
      this.io.emit('banner', { text: 'The King Slime has appeared!', kind: 'boss' });
    }

    for (const m of [...this.monsters.values()]) this.updateMonster(m, dt, now);

    // projectiles
    for (const pr of this.projectiles) {
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.life -= dt;
      const owner = this.players.get(pr.owner);
      if (!owner) { pr.life = 0; continue; }
      for (const m of this.monstersInCircle(pr.x, pr.y, pr.r)) {
        if (pr.hit.has(m.id)) continue;
        pr.hit.add(m.id);
        if (pr.type === 'fireball') {
          this.damageMonster(m, pr.dmg, owner, { kb: sign(pr.vx) * 120 });
          for (const o of this.monstersInCircle(pr.x, pr.y, 75)) if (o !== m) this.damageMonster(o, 14, owner);
          this.addFx({ t: 'explode', x: pr.x, y: pr.y });
        } else if (pr.type === 'thorn') {
          this.damageMonster(m, pr.dmg, owner, { slow: pr.slow, slowMs: 1500 });
        } else {
          this.damageMonster(m, pr.dmg, owner, { kb: sign(pr.vx) * (pr.pierce ? 200 : 80) });
        }
        if (!pr.pierce) { pr.life = 0; break; }
      }
      if (pr.x < 0 || pr.x > S.WORLD.w) pr.life = 0;
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);

    // zones (Slow Field)
    for (const z of this.zones) {
      const owner = this.players.get(z.owner);
      const inZone = this.monstersInCircle(z.x, z.y - 30, z.r);
      for (const m of inZone) { m.slowUntil = now + 300; m.slowFactor = 0.4; }
      if (owner && now >= z.tickAt) {
        z.tickAt = now + 500;
        for (const m of inZone) this.damageMonster(m, 6, owner);
      }
    }
    this.zones = this.zones.filter((z) => z.until > now);

    // summons (Nature Spirit)
    for (const s of this.summons) {
      const owner = this.players.get(s.owner);
      if (!owner) { s.until = 0; continue; }
      let target = null, bd = 330;
      for (const m of this.monsters.values()) {
        const d = Math.hypot(m.x - owner.x, m.y - owner.y);
        if (d < bd) { bd = d; target = m; }
      }
      const tx = target ? target.x - sign(target.x - owner.x) * 50 : owner.x - owner.facing * 45;
      const ty = target ? target.y - target.h - 30 : owner.y - 75;
      s.x += (tx - s.x) * Math.min(1, dt * 4);
      s.y += (ty - s.y) * Math.min(1, dt * 4);
      s.f = target ? sign(target.x - s.x) : owner.facing;
      if (target && now >= s.atkAt && Math.hypot(target.x - s.x, target.y - target.h / 2 - s.y) < 140) {
        s.atkAt = now + 800;
        this.addFx({ t: 'spirit', x1: s.x, y1: s.y, x2: target.x, y2: target.y - target.h / 2 });
        this.damageMonster(target, 14, owner);
      }
    }
    this.summons = this.summons.filter((s) => s.until > now);

    // regen out of combat
    for (const p of this.players.values()) {
      if (!p.dead && p.hp < p.maxHp && now - p.lastHurt > 5000) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.02 * dt);
    }

    this.broadcast(now);
  }

  broadcast(now) {
    const snap = {
      t: now,
      p: [...this.players.values()].map((p) => ({
        id: p.sid, n: p.name, c: p.cls, h: p.hair, l: p.level, x: Math.round(p.x), y: Math.round(p.y),
        f: p.facing, a: p.anim, hp: Math.ceil(p.hp), mhp: p.maxHp, sc: p.score,
        st: now < p.stealthUntil ? 1 : 0, iw: now < p.ironWallUntil ? 1 : 0, inv: now < p.invulnUntil ? 1 : 0,
        d: p.dead ? 1 : 0, as: p.atkSeq, sl: p.atkSlot,
      })),
      m: [...this.monsters.values()].map((m) => ({
        id: m.id, t: m.type, x: Math.round(m.x), y: m.y, f: m.facing, hp: Math.max(0, m.hp), mhp: m.maxHp,
        mv: m.moving ? 1 : 0, hu: now - m.hurtAt < 150 ? 1 : 0,
        s: (now < m.freezeUntil ? 'f' : '') + (now < m.stunUntil ? 's' : '') + (now < m.rootUntil ? 'r' : '') + (now < m.slowUntil ? 'w' : ''),
      })),
      pr: this.projectiles.map((p) => ({ id: p.id, t: p.type, x: Math.round(p.x), y: Math.round(p.y), vx: p.vx, vy: p.vy })),
      z: this.zones.map((z) => ({ id: z.id, x: z.x, y: z.y, r: z.r })),
      s: this.summons.map((s) => ({ id: s.id, x: Math.round(s.x), y: Math.round(s.y), f: s.f, o: s.owner })),
      fx: this.fx,
      boss: this.bossAlive() ? 0 : Math.max(0, Math.round((this.nextBossAt - now) / 1000)),
    };
    this.fx = [];
    this.io.to('game').emit('snapshot', snap);
  }
}

module.exports = Game;
