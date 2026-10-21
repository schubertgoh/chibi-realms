// Authoritative shared-world simulation: monsters, abilities, damage, rewards.
const S = require('../public/js/shared.js');

const TICK_MS = 50;
const BOSS_INTERVAL_MS = 4 * 60 * 1000;
const RESPAWN_DELAY_MS = S.RESPAWN_SECONDS * 1000;
const SKILL_SLOTS = [0, 1, 2, 3, 4];

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
    this.zones = [];   // Magic Shield domes, Monsoon rain
    this.trees = [];   // Druid tree spirits
    this.traps = [];   // Marksman traps
    this.potions = []; // health/mana potions dropped by monsters
    this.pets = new Map(); // Marksman wolves, keyed by owner socket id
    this.hounds = [];   // Beyonder spectral hounds
    this.scarabs = [];  // Beyonder passive scarabs
    this.portals = [];  // Beyonder void portal pairs
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
      if (!SKILL_SLOTS.includes(slot)) return;
      const now = Date.now();
      const key = S.cdIndex(p.cls, p.form, slot);
      if (now < p.cds[key] - 120) return; // small latency slack
      // opening the second Void Portal is free (the cost was paid when placing the first)
      const portalSecond = p.cls === 'beyonder' && p.form === 'rod' && slot === 3 && p.portalPending && now <= p.portalPending.until;
      const cost = portalSecond ? 0 : S.skillCost(p.cls, p.form, slot);
      if (p.res < cost) { p.socket.emit('noResource', { slot, type: p.resType }); return; }
      p.res -= cost;
      p.cds[key] = now + this.cooldownMs(p, slot);
      p.atkSeq++;
      p.atkSlot = slot;
      this.cast(p, slot, now, d);
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
      ...(() => { const r = S.resourceStats(ch.class, level); return { resType: r.type, resMax: r.max, res: r.max, resRegen: r.regen, energyAt: now + S.ENERGY_TICK.everyMs }; })(),
      x: S.SPAWN.x + rand(-100, 100), y: S.SPAWN.y, facing: 1, anim: 'idle',
      dead: false, deadAt: 0, cds: new Array(S.COOLDOWN_SLOTS).fill(0), atkSeq: 0, atkSlot: 0,
      stealthUntil: 0, invulnUntil: now + 2000, ironWillUntil: 0, hitIframeUntil: 0, lastHurt: 0,
      guardianUntil: 0, guardianTickAt: 0, auraHealed: 0,
      // paladin
      aura: 0, buffs: 0, lifeTickAt: 0, blockCharges: 0, divineReadyAt: now,
      // passives
      furyUntil: 0, hasteUntil: 0, fairyAt: now + 6000, invincibleUntil: 0, invincibleReadyAt: now,
      // beyonder
      form: 'rod', hexUntil: 0, portalPending: null,
      lastChat: 0, lastSave: now,
    };
    if (this.players.size === 0 && this.nextBossAt < now) this.nextBossAt = now + 90 * 1000;
    this.players.set(socket.id, p);
    socket.data.player = p;
    socket.join('game');
    if (p.cls === 'marksman') this.pets.set(p.sid, this.makePet(p));
    socket.emit('joined', { id: socket.id, x: p.x, y: p.y, me: this.selfInfo(p) });
    this.sys(`${p.name} the ${S.CLASSES[p.cls].name} joined the realm!`);
  }

  removePlayer(p) {
    this.savePlayer(p);
    this.players.delete(p.sid);
    p.socket.leave('game');
    this.trees = this.trees.filter((t) => t.owner !== p.sid);
    this.traps = this.traps.filter((t) => t.owner !== p.sid);
    this.pets.delete(p.sid);
    this.hounds = this.hounds.filter((h) => h.owner !== p.sid);
    this.scarabs = this.scarabs.filter((sc) => sc.owner !== p.sid);
    this.portals = this.portals.filter((po) => po.owner !== p.sid);
    for (const m of this.monsters.values()) if (m.target === 'p:' + p.sid) m.target = null;
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

  cooldownMs(p, slot) {
    let cd = S.skillDef(p.cls, p.form, slot).cd * 1000;
    if (slot === 0 && p.buffs & S.AURA_BITS.zephyr) cd *= S.AURA_EFFECTS.zephyrAttackCd;
    return cd;
  }
  refund(p, slot, msg) {
    p.cds[S.cdIndex(p.cls, p.form, slot)] = 0;
    p.socket.emit('cdReset', { slot, msg });
  }
  platformUnder(x, y) {
    return S.PLATFORMS.findIndex((pl) => Math.abs(pl.y - y) < 4 && x >= pl.x - 6 && x <= pl.x + pl.w + 6);
  }

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
      exposedUntil: 0, tauntSid: null, tauntUntil: 0, dots: [],
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

  // Monster targets are players ('p:<sid>') or grown druid trees ('t:<id>').
  resolveTarget(key, now) {
    if (!key) return null;
    if (key.startsWith('p:')) {
      const p = this.players.get(key.slice(2));
      return p && !p.dead && now >= p.stealthUntil ? { x: p.x, y: p.y } : null;
    }
    const id = Number(key.slice(2));
    const t = this.trees.find((tr) => tr.id === id);
    return t && now >= t.growAt ? { x: t.x, y: t.y } : null;
  }

  findTarget(m, rangeX, rangeY, now) {
    let best = null, bestD = Infinity;
    for (const p of this.players.values()) {
      if (p.dead || now < p.stealthUntil) continue;
      const dx = Math.abs(p.x - m.x), dy = Math.abs(p.y - m.y);
      if (dx < rangeX && dy < rangeY && dx < bestD) { best = 'p:' + p.sid; bestD = dx; }
    }
    for (const t of this.trees) {
      if (now < t.growAt) continue;
      const dx = Math.abs(t.x - m.x), dy = Math.abs(t.y - m.y);
      if (dx < rangeX && dy < rangeY && dx < bestD) { best = 't:' + t.id; bestD = dx; }
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
      const rangeY = def.boss ? 200 : 90;
      let target = null;
      // Righteous Cry forces the monster onto the paladin
      if (now < m.tauntUntil) {
        const tp = this.players.get(m.tauntSid);
        if (tp && !tp.dead) { m.target = 'p:' + tp.sid; target = { x: tp.x, y: tp.y }; }
      }
      if (!target) {
        target = this.resolveTarget(m.target, now);
        if (!target || Math.abs(target.y - m.y) > rangeY + 20 || Math.abs(target.x - m.x) > 520) {
          m.target = this.findTarget(m, def.boss ? 700 : 340, rangeY, now);
          target = this.resolveTarget(m.target, now);
        }
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

      // contact damage to players
      for (const p of this.players.values()) {
        if (p.dead) continue;
        if (Math.abs(p.x - m.x) < m.w / 2 + 12 && p.y > m.y - m.h - 10 && p.y - 50 < m.y) {
          this.hurtPlayer(p, def.dmg, m.x, now);
        }
      }
      // contact damage to grown trees
      for (const t of this.trees) {
        if (now < t.growAt || now < t.hitAt) continue;
        if (Math.abs(t.x - m.x) < m.w / 2 + 18 && Math.abs(t.y - m.y) < 20) {
          t.hp -= def.dmg;
          t.hitAt = now + 800;
          this.addFx({ t: 'dmg', x: t.x, y: t.y - 90, v: def.dmg, k: 'p' });
          if (t.hp <= 0) this.addFx({ t: 'treedeath', x: t.x, y: t.y });
        }
      }
      // contact damage to marksman wolves
      for (const pet of this.pets.values()) {
        if (pet.dead || now < pet.hitAt) continue;
        if (Math.abs(pet.x - m.x) < m.w / 2 + 14 && Math.abs(pet.y - m.y) < 20) {
          pet.hp -= def.dmg;
          pet.hitAt = now + 800;
          this.addFx({ t: 'dmg', x: pet.x, y: pet.y - 40, v: def.dmg, k: 'p' });
          if (pet.hp <= 0) {
            pet.dead = true;
            pet.respawnAt = now + 30000;
            pet.target = null;
            this.addFx({ t: 'petdeath', x: pet.x, y: pet.y });
          }
        }
      }
      // contact damage to beyonder scarabs
      for (const sc of this.scarabs) {
        if (sc.hp <= 0 || now < sc.hitAt) continue;
        if (Math.abs(sc.x - m.x) < m.w / 2 + 10 && Math.abs(sc.y - m.y) < 20) {
          sc.hp -= def.dmg;
          sc.hitAt = now + 800;
          if (sc.hp <= 0) this.addFx({ t: 'petdeath', x: sc.x, y: sc.y });
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
    // Divine Bulwark absorbs whole hits
    if (p.blockCharges > 0) {
      p.blockCharges--;
      p.hitIframeUntil = now + 800;
      this.addFx({ t: 'block', x: p.x, y: p.y, left: p.blockCharges });
      return;
    }
    // Hex Armor: 40% chance to dodge the hit entirely
    if (now < p.hexUntil && Math.random() < 0.4) {
      p.hitIframeUntil = now + 500;
      this.addFx({ t: 'dodge', x: p.x, y: p.y });
      return;
    }
    let dmg = amount * (1 - p.armor) * rand(0.9, 1.1);
    if (now < p.ironWillUntil) dmg *= 0.4;
    if (p.buffs & S.AURA_BITS.bulwark) dmg *= S.AURA_EFFECTS.bulwarkDamageTaken;
    dmg = Math.max(1, Math.round(dmg));
    p.hp -= dmg;
    p.hitIframeUntil = now + 800;
    p.lastHurt = now;
    this.addFx({ t: 'dmg', x: p.x, y: p.y - 70, v: dmg, k: 'p' });
    // Invincible: dropping to 10% HP or below (even from a lethal hit) grants 6s of total invulnerability
    if (p.cls === 'paladin' && now >= p.invincibleReadyAt && p.hp <= p.maxHp * 0.1) {
      p.hp = Math.max(1, p.hp);
      p.invulnUntil = Math.max(p.invulnUntil, now + 6000);
      p.invincibleUntil = now + 6000;
      p.invincibleReadyAt = now + 120000;
      this.addFx({ t: 'invincible', x: p.x, y: p.y });
    }
    p.socket.emit('hurt', { kb: sign(p.x - fromX) });
    if (p.hp <= 0) {
      p.hp = 0;
      p.dead = true;
      p.deadAt = now;
      p.deaths++;
      p.stealthUntil = 0;
      p.guardianUntil = 0;
      p.blockCharges = 0;
      this.addFx({ t: 'pdeath', x: p.x, y: p.y });
      this.sendSelf(p);
    }
  }

  addContrib(m, p, v) {
    const c = m.contrib.get(p.charId) || { name: p.name, v: 0 };
    c.v += v;
    m.contrib.set(p.charId, c);
  }

  damageMonster(m, base, p, opts = {}) {
    if (!m || m.dead) return 0;
    const now = Date.now();
    let dmg = base * p.dmgMult * (opts.mult || 1) * rand(0.9, 1.1);
    const crit = opts.crit || Math.random() < (p.cls === 'rogue' ? 0.25 : 0.1);
    if (crit) dmg *= 1.5;
    if (now < m.freezeUntil && !opts.freeze) dmg *= 1.25; // shatter bonus
    if (now < m.exposedUntil) dmg *= S.EXPOSED_MULT;     // Headshot debuff
    if (p.buffs & S.AURA_BITS.vengeance) dmg *= S.AURA_EFFECTS.vengeanceDamage;
    if (p.cls === 'marksman' && !opts.fromPet) { const pet = this.pets.get(p.sid); if (pet) pet.target = m.id; }
    dmg = Math.max(1, Math.round(dmg));
    m.hp -= dmg;
    m.hurtAt = now;
    this.addContrib(m, p, dmg + (opts.stun || opts.freeze || opts.root || opts.slow || opts.expose ? 8 : 0));
    if (opts.stun) m.stunUntil = Math.max(m.stunUntil, now + opts.stun);
    if (opts.freeze) m.freezeUntil = Math.max(m.freezeUntil, now + opts.freeze);
    if (opts.root) m.rootUntil = Math.max(m.rootUntil, now + opts.root);
    if (opts.expose) m.exposedUntil = Math.max(m.exposedUntil, now + opts.expose);
    if (opts.slow) {
      m.slowFactor = now < m.slowUntil ? Math.min(m.slowFactor, opts.slow) : opts.slow;
      m.slowUntil = Math.max(m.slowUntil, now + opts.slowMs);
    }
    if (opts.kb && !S.MONSTERS[m.type].boss) m.kbv = opts.kb;
    if (!m.target) m.target = 'p:' + p.sid;
    this.addFx({ t: 'dmg', x: m.x + rand(-8, 8), y: m.y - m.h - 10, v: dmg, k: crit ? 'c' : 'm' });
    if (m.hp <= 0) this.killMonster(m, p);
    return dmg;
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
        if (isKill) this.onKillPassive(p, m);
        if (def.boss) p.bossKills++;
        this.giveXp(p, xp);
        p.socket.emit('reward', { score, xp, monster: def.name, share: Math.round(share * 100), kill: isKill });
        this.sendSelf(p);
      } else {
        this.store.rewardOffline(charId, xp, score, isKill);
      }
    }
    this.dropPotions(m, def);
    if (def.boss) {
      this.sys(`👑 The King Slime was defeated by ${names.join(', ')}!`);
      this.nextBossAt = Date.now() + BOSS_INTERVAL_MS;
      for (const p of this.players.values()) this.savePlayer(p);
    }
  }

  dropPotions(m, def) {
    const drops = [];
    if (def.boss) for (let i = 0; i < 3; i++) drops.push(S.POTIONS[2]);
    else {
      const r = Math.random();
      let acc = 0;
      for (const pot of [...S.POTIONS].reverse()) { acc += pot.chance; if (r < acc) { drops.push(pot); break; } } // rarest first
    }
    drops.forEach((pot, i) => {
      this.potions.push({ id: this.nid++, kind: Math.random() < 0.5 ? 'hp' : 'mp', size: pot.size, amount: pot.amount,
        x: m.x + (i - (drops.length - 1) / 2) * 30, y: m.y, until: Date.now() + 30000 });
    });
  }

  updatePotions(now) {
    for (const pot of this.potions) {
      for (const p of this.players.values()) {
        if (p.dead || Math.abs(p.x - pot.x) > 26 || Math.abs(p.y - pot.y) > 40) continue;
        if (pot.kind === 'hp') {
          const amt = Math.min(p.maxHp - p.hp, pot.amount);
          p.hp += amt;
          this.addFx({ t: 'dmg', x: p.x, y: p.y - 70, v: amt, k: 'h' });
        } else {
          p.res = Math.min(p.resMax, p.res + pot.amount);
          this.addFx({ t: 'dmg', x: p.x, y: p.y - 70, v: pot.amount, k: 'r' });
        }
        this.addFx({ t: 'potion', x: pot.x, y: pot.y, kind: pot.kind });
        pot.until = 0;
        break;
      }
    }
    this.potions = this.potions.filter((pot) => pot.until > now);
  }

  onKillPassive(p, m) {
    const now = Date.now();
    if (p.cls === 'beyonder' && m) {
      const mine = this.scarabs.filter((sc) => sc.owner === p.sid);
      if (mine.length >= S.MAX_SCARABS) this.scarabs.splice(this.scarabs.indexOf(mine[0]), 1);
      const hp = Math.round(35 * (1 + 0.08 * (p.level - 1)));
      this.scarabs.push({ id: this.nid++, owner: p.sid, plat: m.plat, x: m.x, y: m.y, f: 1, hp, maxHp: hp,
        atkAt: 0, hitAt: 0, moving: false, moveDir: 0, idleT: 0 });
      this.addFx({ t: 'transmog', x: m.x, y: m.y });
      return;
    }
    if (p.cls === 'rogue') { // Haste
      p.hasteUntil = now + 6000;
      this.addFx({ t: 'dust', x: p.x, y: p.y });
    }
  }

  // ---------- passives: Marksman wolf, Druid fairy ----------
  petMaxHp(level) { return Math.round(160 * (1 + 0.1 * (level - 1))); }
  makePet(p) {
    const hp = this.petMaxHp(p.level);
    return { x: p.x - 40, y: p.y, f: 1, hp, maxHp: hp, dead: false, respawnAt: 0, atkAt: 0, hitAt: 0, target: null, moving: false };
  }

  updatePets(dt, now) {
    for (const [sid, pet] of this.pets) {
      const o = this.players.get(sid);
      if (!o) { this.pets.delete(sid); continue; }
      pet.maxHp = this.petMaxHp(o.level);
      if (pet.dead) {
        if (now >= pet.respawnAt && !o.dead) {
          Object.assign(pet, { dead: false, hp: pet.maxHp, x: o.x - o.facing * 40, y: o.y, target: null });
          this.addFx({ t: 'spawn', x: pet.x, y: pet.y - 20 });
        }
        continue;
      }
      if (o.dead) { pet.moving = false; continue; }
      let target = pet.target ? this.monsters.get(pet.target) : null;
      if (target && Math.hypot(target.x - o.x, target.y - o.y) > 520) target = null;
      if (!target) pet.target = null;
      const tx = target ? target.x - sign(target.x - pet.x) * (target.w / 2 + 12) : o.x - o.facing * 45;
      const ty = target ? target.y : o.y;
      const dx = tx - pet.x;
      pet.moving = Math.abs(dx) > 4;
      if (pet.moving) { pet.x += sign(dx) * Math.min(Math.abs(dx), 340 * dt); pet.f = sign(dx); }
      pet.y += (ty - pet.y) * Math.min(1, dt * 8);
      if (Math.abs(pet.x - o.x) > 700 || Math.abs(pet.y - o.y) > 500) { pet.x = o.x - o.facing * 40; pet.y = o.y; }
      if (target && now >= pet.atkAt && Math.abs(target.x - pet.x) < target.w / 2 + 26 && Math.abs(target.y - pet.y) < 30) {
        pet.atkAt = now + 900;
        pet.f = sign(target.x - pet.x);
        this.addFx({ t: 'bite', x: target.x, y: target.y - target.h / 2 });
        this.damageMonster(target, 18, o, { fromPet: true });
      }
    }
  }

  updateHounds(dt, now) {
    for (const h of this.hounds) {
      const o = this.players.get(h.owner);
      if (!o || o.dead) { h.until = 0; continue; }
      let target = null, bd = 320;
      for (const m of this.monsters.values()) {
        const dd = Math.hypot(m.x - o.x, m.y - o.y);
        if (dd < bd) { bd = dd; target = m; }
      }
      const tx = target ? target.x - sign(target.x - h.x) * (target.w / 2 + 12) : o.x - o.facing * 40;
      const ty = target ? target.y : o.y;
      const dx = tx - h.x;
      h.moving = Math.abs(dx) > 4;
      if (h.moving) { h.x += sign(dx) * Math.min(Math.abs(dx), 380 * dt); h.f = sign(dx); }
      h.y += (ty - h.y) * Math.min(1, dt * 8);
      if (target && now >= h.atkAt && Math.abs(target.x - h.x) < target.w / 2 + 26 && Math.abs(target.y - h.y) < 30) {
        h.atkAt = now + 800;
        h.f = sign(target.x - h.x);
        this.addFx({ t: 'bite', x: target.x, y: target.y - target.h / 2 });
        const dealt = this.damageMonster(target, 14, o);
        const heal = Math.min(o.maxHp - o.hp, Math.round(dealt * 0.3));
        if (heal > 0) { o.hp += heal; this.addFx({ t: 'dmg', x: o.x, y: o.y - 70, v: heal, k: 'h' }); }
      }
    }
    this.hounds = this.hounds.filter((h) => h.until > now);
  }

  updateScarabs(dt, now) {
    for (const sc of this.scarabs) {
      const o = this.players.get(sc.owner);
      if (!o) { sc.hp = 0; continue; }
      const plat = S.PLATFORMS[sc.plat];
      let target = null, bd = 400;
      for (const m of this.monsters.values()) {
        if (m.plat !== sc.plat) continue;
        const dx = Math.abs(m.x - sc.x);
        if (dx < bd) { bd = dx; target = m; }
      }
      sc.moving = false;
      if (target) {
        const dx = target.x - sc.x;
        if (Math.abs(dx) > target.w / 2 + 6) { sc.f = sign(dx); sc.x += sc.f * 150 * dt; sc.moving = true; }
        if (now >= sc.atkAt && Math.abs(dx) < target.w / 2 + 16) {
          sc.atkAt = now + 700;
          this.addFx({ t: 'bite', x: target.x, y: target.y - 10 });
          this.damageMonster(target, 7, o);
        }
      } else {
        sc.idleT -= dt;
        if (sc.idleT <= 0) { sc.moveDir = [-1, 0, 1][Math.floor(Math.random() * 3)]; sc.idleT = rand(0.8, 2); }
        if (sc.moveDir) { sc.f = sc.moveDir; sc.x += sc.moveDir * 90 * dt; sc.moving = true; }
      }
      sc.x = clamp(sc.x, plat.x + 8, plat.x + plat.w - 8);
      if (sc.x <= plat.x + 8 || sc.x >= plat.x + plat.w - 8) sc.moveDir *= -1;
    }
    this.scarabs = this.scarabs.filter((sc) => sc.hp > 0);
  }

  updateFairies(now) {
    for (const p of this.players.values()) {
      if (p.cls !== 'druid' || p.dead || now < p.fairyAt) continue;
      // attack the nearest enemy in range…
      let enemy = null, bd = 300;
      for (const m of this.monsters.values()) {
        const d = Math.hypot(m.x - p.x, m.y - p.y);
        if (d < bd) { bd = d; enemy = m; }
      }
      if (enemy) {
        p.fairyAt = now + 6000;
        this.addFx({ t: 'fairybolt', x1: p.x - p.facing * 26, y1: p.y - 76, x2: enemy.x, y2: enemy.y - enemy.h / 2, heal: 0 });
        this.damageMonster(enemy, 20, p);
        continue;
      }
      // …otherwise heal the druid if hurt, else the closest hurt ally
      let ally = p.hp < p.maxHp ? p : null;
      if (!ally) {
        let ad = 300;
        for (const o of this.players.values()) {
          if (o === p || o.dead || o.hp >= o.maxHp) continue;
          const d = Math.hypot(o.x - p.x, o.y - p.y);
          if (d < ad) { ad = d; ally = o; }
        }
      }
      if (!ally) { p.fairyAt = now + 1000; continue; } // nothing to do — check again shortly
      p.fairyAt = now + 6000;
      const amt = Math.min(ally.maxHp - ally.hp, Math.round(ally.maxHp * 0.12 + 5 * p.dmgMult));
      ally.hp += amt;
      if (ally !== p) p.auraHealed += amt;
      this.addFx({ t: 'fairybolt', x1: p.x - p.facing * 26, y1: p.y - 76, x2: ally.x, y2: ally.y - 40, heal: 1 });
      this.addFx({ t: 'dmg', x: ally.x, y: ally.y - 70, v: amt, k: 'h' });
    }
  }

  // HUD info for each class passive: active (glow) and remaining cooldown in seconds
  passiveState(p, now) {
    switch (p.cls) {
      case 'fighter': return { pa: p.hp < p.maxHp * 0.5 ? 1 : 0, pc: 0 }; // Resilience kicking in
      case 'mage': return { pa: p.res < p.resMax * 0.5 ? 1 : 0, pc: 0 };  // Arcane Discipline kicking in
      case 'rogue': return { pa: now < p.hasteUntil ? 1 : 0, pc: 0 };
      case 'marksman': {
        const pet = this.pets.get(p.sid);
        return pet && pet.dead ? { pa: 0, pc: Math.ceil((pet.respawnAt - now) / 1000) } : { pa: 1, pc: 0 };
      }
      case 'druid': return { pa: 1, pc: Math.max(0, Math.ceil((p.fairyAt - now) / 1000)) };
      case 'beyonder': return { pa: 0, pc: this.scarabs.filter((sc) => sc.owner === p.sid).length };
      case 'paladin': return { pa: now < p.invincibleUntil ? 1 : 0, pc: Math.max(0, Math.ceil((p.invincibleReadyAt - now) / 1000)) };
      default: return { pa: 0, pc: 0 };
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
      const rs = S.resourceStats(p.cls, p.level);
      p.resMax = rs.max; p.resRegen = rs.regen; p.res = p.resMax;
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
  nearestInFront(p, reach, height) {
    let best = null, bd = Infinity;
    for (const m of this.monstersInBox(...this.frontBox(p, reach, height))) {
      const d = Math.abs(m.x - p.x);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }
  shoot(p, type, opts) {
    this.projectiles.push({
      id: this.nid++, type, owner: p.sid, x: p.x + p.facing * 24, y: p.y - 34,
      vx: opts.vx, vy: opts.vy || 0, dmg: opts.dmg, life: opts.life, pierce: !!opts.pierce,
      hit: new Set(), r: opts.r || 12, slow: opts.slow,
    });
  }

  cast(p, slot, now, d) {
    const f = p.facing;
    const key = p.cls !== 'beyonder' ? p.cls + slot : slot === 4 ? 'beyonder4' : 'beyonder' + p.form + slot;
    switch (key) {
      // ---- Fighter ----
      case 'fighter0': // Slash
        for (const m of this.monstersInBox(...this.frontBox(p, 100, 85))) this.damageMonster(m, 28, p, { kb: f * 160 });
        this.addFx({ t: 'slash', x: p.x, y: p.y, f, c: p.cls });
        break;
      case 'fighter1': { // Charge: dash forward, knocking back everything along the path
        const x2 = clamp(p.x + f * 230, 0, S.WORLD.w);
        for (const m of this.monstersInBox(Math.min(p.x, x2) - 20, p.y - 80, Math.max(p.x, x2) + 20, p.y + 6)) {
          this.damageMonster(m, 26, p, { kb: f * 700, stun: 400 });
        }
        this.addFx({ t: 'charge', x1: p.x, x2, y: p.y, f });
        break;
      }
      case 'fighter2': // Shield Bash
        for (const m of this.monstersInBox(...this.frontBox(p, 85, 75))) this.damageMonster(m, 20, p, { stun: 1600, kb: f * 320 });
        this.addFx({ t: 'bash', x: p.x + f * 40, y: p.y - 30, f });
        break;
      case 'fighter3': // Whirlwind
        for (const m of this.monstersInCircle(p.x, p.y - 30, 145)) this.damageMonster(m, 42, p, { kb: sign(m.x - p.x) * 240 });
        this.addFx({ t: 'whirl', x: p.x, y: p.y - 30 });
        break;
      case 'fighter4': // Iron Will: 10s of 60% damage reduction + regenerate 10% max HP
        p.ironWillUntil = now + 10000;
        this.addFx({ t: 'shield', x: p.x, y: p.y });
        break;
      // ---- Mage ----
      case 'mage0': // Fireball
        this.shoot(p, 'fireball', { vx: f * 650, dmg: 30, life: 1.2, r: 16 });
        break;
      case 'mage1': { // Chain Lightning
        const targets = [...this.monsters.values()]
          .filter((m) => (m.x - p.x) * f > -30 && Math.abs(m.x - p.x) < 520 && Math.abs(m.y - p.y) < 240)
          .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x)).slice(0, 3);
        const pts = [[p.x + f * 18, p.y - 40]];
        for (const m of targets) { pts.push([m.x, m.y - m.h / 2]); this.damageMonster(m, 55, p, { stun: 350 }); }
        if (!targets.length) pts.push([p.x + f * 260, p.y - 40]);
        this.addFx({ t: 'lightning', pts });
        break;
      }
      case 'mage2': // Frost Nova
        for (const m of this.monstersInCircle(p.x, p.y - 25, 175)) this.damageMonster(m, 15, p, { freeze: 2500 });
        this.addFx({ t: 'nova', x: p.x, y: p.y - 25, r: 175 });
        break;
      case 'mage3': { // Teleport: the client moves itself; show a blink at both ends
        const fx0 = typeof d.fx === 'number' ? clamp(d.fx, 0, S.WORLD.w) : p.x;
        const fy0 = typeof d.fy === 'number' ? clamp(d.fy, 0, S.WORLD.h) : p.y;
        this.addFx({ t: 'blink', x: fx0, y: fy0 - 30 });
        this.addFx({ t: 'blink', x: p.x, y: p.y - 30 });
        p.invulnUntil = Math.max(p.invulnUntil, now + 250);
        break;
      }
      case 'mage4': // Magic Shield: a dome where the mage and allies are invulnerable
        this.zones.push({ id: this.nid++, type: 'shield', owner: p.sid, x: p.x, y: p.y, r: 130, until: now + 4000 });
        this.addFx({ t: 'burst', x: p.x, y: p.y - 30 });
        break;
      // ---- Rogue ----
      case 'rogue0': { // Backstab
        const stealthed = now < p.stealthUntil;
        for (const m of this.monstersInBox(...this.frontBox(p, 80, 70))) {
          let mult = 1, crit = false;
          if (stealthed) { mult = 3.5; crit = true; }
          else if (m.facing === f) { mult = 1.5; crit = true; } // striking from behind always crits
          this.damageMonster(m, 20, p, { mult, crit, kb: f * 60 });
        }
        if (stealthed) p.stealthUntil = 0;
        this.addFx({ t: 'slash', x: p.x, y: p.y, f, c: p.cls, big: stealthed ? 1 : 0 });
        break;
      }
      case 'rogue1': // Knife Throw
        this.shoot(p, 'knife', { vx: f * 950, dmg: 26, life: 0.55 });
        break;
      case 'rogue2': // Stealth
        p.stealthUntil = now + 5000;
        for (const m of this.monsters.values()) if (m.target === 'p:' + p.sid) m.target = null;
        this.addFx({ t: 'smoke', x: p.x, y: p.y });
        break;
      case 'rogue3': // Dodge Roll
        p.invulnUntil = now + 450;
        this.addFx({ t: 'dust', x: p.x, y: p.y });
        break;
      case 'rogue4': // Fan of Knives
        for (const m of this.monstersInCircle(p.x, p.y - 30, 200)) this.damageMonster(m, 32, p, { kb: sign(m.x - p.x) * 140 });
        p.invulnUntil = Math.max(p.invulnUntil, now + 1500);
        this.addFx({ t: 'knives', x: p.x, y: p.y - 30, r: 200 });
        break;
      // ---- Marksman ----
      case 'marksman0': // Arrow
        this.shoot(p, 'arrow', { vx: f * 1000, dmg: 22, life: 0.9 });
        break;
      case 'marksman1': // Multishot
        for (let i = -2; i <= 2; i++) {
          const a = i * 0.12;
          this.shoot(p, 'arrow', { vx: f * 950 * Math.cos(a), vy: 950 * Math.sin(a), dmg: 16, life: 0.7 });
        }
        break;
      case 'marksman2': { // Trap
        if (this.platformUnder(p.x, p.y) < 0) { this.refund(p, slot, 'Place traps while standing on the ground!'); break; }
        const mine = this.traps.filter((t) => t.owner === p.sid);
        if (mine.length >= S.MAX_TRAPS) this.traps.splice(this.traps.indexOf(mine[0]), 1);
        this.traps.push({ id: this.nid++, owner: p.sid, x: p.x, y: p.y, armAt: now + 400, until: now + 40000 });
        this.addFx({ t: 'dust', x: p.x, y: p.y });
        break;
      }
      case 'marksman3': // Disengage
        for (const m of this.monstersInCircle(p.x, p.y - 25, 140)) this.damageMonster(m, 10, p, { kb: sign(m.x - p.x) * 380, slow: 0.5, slowMs: 2000 });
        this.addFx({ t: 'burst', x: p.x, y: p.y - 25 });
        break;
      case 'marksman4': // Headshot: huge piercing shot that explodes on each hit and exposes targets
        this.shoot(p, 'headshot', { vx: f * 1300, dmg: 95, life: 0.85, pierce: true, r: 42 });
        break;
      // ---- Druid ----
      case 'druid0': // Thorn Seed
        this.shoot(p, 'thorn', { vx: f * 600, dmg: 20, life: 1.1, slow: 0.6 });
        break;
      case 'druid1': { // Tree Spirit: plant a seed that grows into a stationary attacking tree
        const plat = this.platformUnder(p.x, p.y);
        if (plat < 0) { this.refund(p, slot, 'Plant seeds while standing on the ground!'); break; }
        const mine = this.trees.filter((t) => t.owner === p.sid);
        if (mine.length >= S.MAX_TREES) this.trees.splice(this.trees.indexOf(mine[0]), 1);
        const hp = Math.round(150 * (1 + 0.08 * (p.level - 1)));
        this.trees.push({ id: this.nid++, owner: p.sid, x: p.x, y: S.PLATFORMS[plat].y, bornAt: now, growAt: now + 10000,
          until: now + 10000 + 60000, hp, maxHp: hp, atkAt: 0, hitAt: 0, f });
        this.addFx({ t: 'entangle', x: p.x, y: p.y, r: 40 });
        break;
      }
      case 'druid2': { // Entangle
        const cx = p.x + f * 100;
        for (const m of this.monstersInCircle(cx, p.y - 20, 185)) this.damageMonster(m, 12, p, { root: 3000 });
        this.addFx({ t: 'entangle', x: cx, y: p.y, r: 185 });
        break;
      }
      case 'druid3': // Rejuvenate
        this.awardHealScore(p, this.healAround(p, p.x, p.y, 270, 0.3, 10));
        this.addFx({ t: 'heal', x: p.x, y: p.y, r: 270 });
        break;
      case 'druid4': // Monsoon: large healing rain
        this.zones.push({ id: this.nid++, type: 'rain', owner: p.sid, x: p.x, y: p.y, r: 280, until: now + 6000, tickAt: now });
        break;
      // ---- Paladin ----
      case 'paladin0': { // Holy Strike; every 10s it is empowered into Divine Strike
        const m = this.nearestInFront(p, 95, 85);
        const divine = now >= p.divineReadyAt && p.res >= S.DIVINE_STRIKE_COST;
        if (m && divine) {
          this.damageMonster(m, 34, p, { mult: 3, stun: 1500, kb: f * 260 });
          this.addFx({ t: 'smite', x: m.x, y: m.y });
          p.divineReadyAt = now + 10000;
          p.res -= S.DIVINE_STRIKE_COST;
        } else if (m) {
          this.damageMonster(m, 34, p, { kb: f * 120 });
        }
        this.addFx({ t: 'slash', x: p.x, y: p.y, f, c: p.cls, big: m && divine ? 1 : 0 });
        break;
      }
      case 'paladin1': // Holy Auras: cycle to the next aura
        p.aura = (p.aura + 1) % S.AURAS.length;
        p.lifeTickAt = now + 5000;
        this.addFx({ t: 'auraswap', x: p.x, y: p.y, a: p.aura });
        break;
      case 'paladin2': // Divine Bulwark: block the next 2 hits
        p.blockCharges = 2;
        this.addFx({ t: 'shield', x: p.x, y: p.y });
        break;
      case 'paladin3': { // Righteous Cry: taunt everything nearby
        for (const m of this.monsters.values()) {
          if (Math.abs(m.x - p.x) < 360 && Math.abs(m.y - p.y) < 220) {
            m.tauntSid = p.sid;
            m.tauntUntil = now + 4000;
            m.target = 'p:' + p.sid;
            this.addContrib(m, p, 8);
          }
        }
        this.addFx({ t: 'cry', x: p.x, y: p.y - 40, r: 360 });
        break;
      }
      // ---- Beyonder: shared ----
      case 'beyonder4': // Transmogrify: swap rod <-> sword
        p.form = p.form === 'rod' ? 'sword' : 'rod';
        p.portalPending = null;
        this.addFx({ t: 'transmog', x: p.x, y: p.y });
        break;
      // ---- Beyonder: rod ----
      case 'beyonderrod0': // Void Bolt
        this.shoot(p, 'voidbolt', { vx: f * 700, dmg: 28, life: 1.0, r: 14 });
        break;
      case 'beyonderrod1': { // Curse: damage over time on the nearest enemy
        let best = null, bd = 420;
        for (const m of this.monsters.values()) {
          const dd = Math.hypot(m.x - p.x, m.y - p.y);
          if (dd < bd) { bd = dd; best = m; }
        }
        if (!best) { this.refund(p, slot, 'No enemy close enough to curse!'); break; }
        best.dots.push({ owner: p.sid, dmg: 10, every: 500, next: now + 500, until: now + 5000, kind: 'curse' });
        this.addContrib(best, p, 8);
        if (!best.target) best.target = 'p:' + p.sid;
        this.addFx({ t: 'curse', x: best.x, y: best.y - best.h / 2, x1: p.x, y1: p.y - 40 });
        break;
      }
      case 'beyonderrod2': // Black Tentacles: slowing, damaging pool
        this.zones.push({ id: this.nid++, type: 'tentacles', owner: p.sid, x: p.x + f * 140, y: p.y, r: 140, until: now + 5000, tickAt: now });
        break;
      case 'beyonderrod3': // Void Portal: first press marks portal A, second press opens the pair
        if (!p.portalPending || now > p.portalPending.until) {
          p.portalPending = { x: p.x, y: p.y, until: now + 10000 };
          p.cds[S.cdIndex(p.cls, p.form, slot)] = now + 400; // the real cooldown starts when the pair opens
          this.addFx({ t: 'blink', x: p.x, y: p.y - 30 });
        } else {
          this.portals = this.portals.filter((po) => po.owner !== p.sid);
          this.portals.push({ id: this.nid++, owner: p.sid, ax: p.portalPending.x, ay: p.portalPending.y, bx: p.x, by: p.y, until: now + 10000 });
          p.portalPending = null;
          this.addFx({ t: 'blink', x: p.x, y: p.y - 30 });
        }
        break;
      // ---- Beyonder: sword ----
      case 'beyondersword0': { // Void Slash: single target
        const m = this.nearestInFront(p, 95, 85);
        if (m) {
          this.damageMonster(m, 32, p, { kb: f * 120 });
          p.res = Math.min(p.resMax, p.res + S.VOID_SLASH_RESTORE);
        }
        this.addFx({ t: 'slash', x: p.x, y: p.y, f, c: p.cls });
        break;
      }
      case 'beyondersword1': { // Phase Dash: invulnerable dash that strikes everything in the path
        const x2 = clamp(p.x + f * 260, 0, S.WORLD.w);
        for (const m of this.monstersInBox(Math.min(p.x, x2) - 20, p.y - 80, Math.max(p.x, x2) + 20, p.y + 6)) {
          this.damageMonster(m, 34, p, { kb: f * 200 });
        }
        p.invulnUntil = Math.max(p.invulnUntil, now + 450);
        this.addFx({ t: 'phasedash', x1: p.x, x2, y: p.y, f });
        break;
      }
      case 'beyondersword2': // Spectral Hound
        this.hounds = this.hounds.filter((h) => h.owner !== p.sid);
        this.hounds.push({ id: this.nid++, owner: p.sid, x: p.x - f * 30, y: p.y, f, until: now + 12000, atkAt: 0, moving: false });
        this.addFx({ t: 'transmog', x: p.x - f * 30, y: p.y });
        break;
      case 'beyondersword3': // Hex Armor: chance to dodge
        p.hexUntil = now + 8000;
        this.addFx({ t: 'hex', x: p.x, y: p.y });
        break;
      case 'paladin4': // Guardian Spirits: 6s holy aura that damages nearby foes
        p.guardianUntil = now + 6000;
        p.guardianTickAt = now;
        this.addFx({ t: 'summon', x: p.x, y: p.y - 40 });
        break;
    }
  }

  // Heals every living player within r of (cx, cy) by frac of their max HP (+flat, scaled by the healer's level).
  // Returns HP healed on players other than the healer.
  healAround(healer, cx, cy, r, frac, flat) {
    let healedOthers = 0;
    for (const o of this.players.values()) {
      if (o.dead || Math.hypot(o.x - cx, o.y - cy) > r) continue;
      const amt = Math.min(o.maxHp - o.hp, Math.round(o.maxHp * frac + flat * healer.dmgMult));
      if (amt <= 0) continue;
      o.hp += amt;
      this.addFx({ t: 'dmg', x: o.x, y: o.y - 70, v: amt, k: 'h' });
      if (o !== healer) healedOthers += amt;
    }
    return healedOthers;
  }

  // Restores frac of max mana to every living mana user within r of (cx, cy). Returns mana given to others.
  restoreManaAround(giver, cx, cy, r, frac) {
    let given = 0;
    for (const o of this.players.values()) {
      if (o.dead || o.resType !== 'mana' || Math.hypot(o.x - cx, o.y - cy) > r) continue;
      const amt = Math.min(o.resMax - o.res, Math.round(o.resMax * frac));
      if (amt <= 0) continue;
      o.res += amt;
      if (o !== giver) given += amt;
    }
    return given;
  }

  awardHealScore(p, healedOthers) {
    const bonus = Math.floor(healedOthers / 10);
    if (bonus <= 0) return 0;
    p.score += bonus;
    p.socket.emit('reward', { score: bonus, xp: 0, monster: 'healing allies', heal: true });
    this.sendSelf(p);
    return bonus;
  }

  updatePlayerEffects(p, dt, now) {
    if (p.dead) return;
    const missing = 1 - p.hp / p.maxHp; // 0 at full health, ~1 near death
    if (p.resType === 'energy') {
      if (now >= p.energyAt) { p.energyAt = now + S.ENERGY_TICK.everyMs; p.res = Math.min(p.resMax, p.res + S.ENERGY_TICK.amount); }
    } else {
      // Arcane Discipline: mage mana regen scales up to 4x as mana runs low
      const mult = p.cls === 'mage' ? 1 + 3 * (1 - p.res / p.resMax) : 1;
      p.res = Math.min(p.resMax, p.res + p.resRegen * mult * dt);
    }
    // Resilience: fighter HP regen (always on) scales with missing health — up to 3% max HP/s near death
    if (p.cls === 'fighter' && missing > 0) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.03 * missing * dt);
    // Iron Will regen: 10% max HP over 10s
    if (now < p.ironWillUntil) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.01 * dt);
    // Guardian Spirits: damage pulse every 0.5s
    if (now < p.guardianUntil && now >= p.guardianTickAt) {
      p.guardianTickAt = now + 500;
      for (const m of this.monstersInCircle(p.x, p.y - 30, 160)) this.damageMonster(m, 11, p);
    }
    // pay out score for over-time healing in chunks so toasts don't spam
    if (p.auraHealed >= 50) p.auraHealed -= this.awardHealScore(p, p.auraHealed) * 10;
  }

  updateAuras(now) {
    for (const p of this.players.values()) p.buffs = 0;
    for (const pal of this.players.values()) {
      if (pal.cls !== 'paladin' || pal.dead) continue;
      const aura = S.AURAS[pal.aura];
      for (const o of this.players.values()) {
        if (!o.dead && Math.hypot(o.x - pal.x, o.y - pal.y) <= S.AURA_RADIUS) o.buffs |= S.AURA_BITS[aura.key];
      }
      if (aura.key === 'life' && now >= pal.lifeTickAt) {
        pal.lifeTickAt = now + 5000;
        pal.auraHealed += this.healAround(pal, pal.x, pal.y, S.AURA_RADIUS, S.AURA_EFFECTS.lifeHealFrac, 3);
        // Aura of Vitality also restores mana; mana given to allies counts like healing for score
        pal.auraHealed += this.restoreManaAround(pal, pal.x, pal.y, S.AURA_RADIUS, S.AURA_EFFECTS.vitalityManaFrac);
        this.addFx({ t: 'heal', x: pal.x, y: pal.y, r: S.AURA_RADIUS });
      }
    }
  }

  updateTrees(now) {
    for (const t of this.trees) {
      const owner = this.players.get(t.owner);
      if (!owner || t.hp <= 0) { t.until = 0; continue; }
      if (now < t.growAt || now < t.atkAt) continue;
      let target = null, bd = 230;
      for (const m of this.monsters.values()) {
        const dx = Math.abs(m.x - t.x);
        if (dx < bd && Math.abs(m.y - t.y) < 130) { bd = dx; target = m; }
      }
      if (!target) continue;
      t.atkAt = now + 1000;
      t.f = sign(target.x - t.x);
      this.addFx({ t: 'vine', x1: t.x, y1: t.y - 60, x2: target.x, y2: target.y - target.h / 2 });
      this.damageMonster(target, 18, owner);
    }
    this.trees = this.trees.filter((t) => t.until > now && t.hp > 0);
  }

  updateTraps(now) {
    for (const t of this.traps) {
      const owner = this.players.get(t.owner);
      if (!owner) { t.until = 0; continue; }
      if (now < t.armAt) continue;
      const m = [...this.monsters.values()].find((mm) => Math.abs(mm.y - t.y) < 8 && Math.abs(mm.x - t.x) < mm.w / 2 + 12);
      if (!m) continue;
      t.until = 0;
      const roll = Math.floor(Math.random() * 3);
      if (roll === 0) { // freeze
        this.damageMonster(m, 15, owner, { freeze: 2500 });
        this.addFx({ t: 'nova', x: t.x, y: t.y - 20, r: 80 });
      } else if (roll === 1) { // explosion
        for (const o of this.monstersInCircle(t.x, t.y - 20, 110)) this.damageMonster(o, 45, owner, { kb: sign(o.x - t.x) * 200 });
        this.addFx({ t: 'explode', x: t.x, y: t.y - 20 });
        this.addFx({ t: 'trapboom', x: t.x, y: t.y });
      } else { // poison: damage over time on the one enemy
        m.dots.push({ owner: owner.sid, dmg: 9, every: 500, next: now + 500, until: now + 4000 });
        this.addContrib(m, owner, 8);
        this.addFx({ t: 'poison', x: m.x, y: m.y - m.h / 2 });
      }
    }
    this.traps = this.traps.filter((t) => t.until > now);
  }

  updateDots(now) {
    for (const m of [...this.monsters.values()]) {
      if (!m.dots.length) continue;
      for (const d of m.dots) {
        if (m.dead || now < d.next) continue;
        d.next += d.every;
        const owner = this.players.get(d.owner);
        if (owner) this.damageMonster(m, d.dmg, owner);
      }
      m.dots = m.dots.filter((d) => now < d.until);
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

    this.updateAuras(now);
    for (const m of [...this.monsters.values()]) this.updateMonster(m, dt, now);
    this.updateDots(now);

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
        } else if (pr.type === 'headshot') {
          this.damageMonster(m, pr.dmg, owner, { kb: sign(pr.vx) * 200, expose: 6000 });
          for (const o of this.monstersInCircle(m.x, m.y - m.h / 2, 85)) {
            if (o !== m && !pr.hit.has(o.id)) this.damageMonster(o, 30, owner, { expose: 6000 });
          }
          this.addFx({ t: 'headshot', x: m.x, y: m.y - m.h / 2 });
        } else {
          this.damageMonster(m, pr.dmg, owner, { kb: sign(pr.vx) * 80 });
        }
        if (!pr.pierce) { pr.life = 0; break; }
      }
      if (pr.x < 0 || pr.x > S.WORLD.w) pr.life = 0;
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);

    // zones
    for (const z of this.zones) {
      if (z.type === 'shield') { // Magic Shield: players standing inside are invulnerable
        for (const p of this.players.values()) {
          if (!p.dead && Math.hypot(p.x - z.x, p.y - z.y) < z.r) p.invulnUntil = Math.max(p.invulnUntil, now + 150);
        }
      } else if (z.type === 'tentacles') { // Black Tentacles: slow everything inside, damage every 0.5s
        const inside = this.monstersInCircle(z.x, z.y - 20, z.r);
        for (const m of inside) { m.slowFactor = now < m.slowUntil ? Math.min(m.slowFactor, 0.5) : 0.5; m.slowUntil = Math.max(m.slowUntil, now + 300); }
        const owner = this.players.get(z.owner);
        if (owner && now >= z.tickAt) { z.tickAt = now + 500; for (const m of inside) this.damageMonster(m, 7, owner); }
      } else if (z.type === 'rain' && now >= z.tickAt) { // Monsoon: heal pulse every 0.5s
        z.tickAt = now + 500;
        const owner = this.players.get(z.owner);
        if (owner) {
          owner.auraHealed += this.healAround(owner, z.x, z.y, z.r, 0.03, 2);
          owner.auraHealed += this.restoreManaAround(owner, z.x, z.y, z.r, 0.02); // Monsoon restores mana too
        }
      }
    }
    this.zones = this.zones.filter((z) => z.until > now);

    this.updateTrees(now);
    this.updateTraps(now);
    this.updatePets(dt, now);
    this.updateFairies(now);
    this.updateHounds(dt, now);
    this.updateScarabs(dt, now);
    this.portals = this.portals.filter((po) => po.until > now);
    this.updatePotions(now);
    for (const p of this.players.values()) this.updatePlayerEffects(p, dt, now);

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
        st: now < p.stealthUntil ? 1 : 0, iw: now < p.ironWillUntil ? 1 : 0, inv: now < p.invulnUntil ? 1 : 0,
        gs: now < p.guardianUntil ? 1 : 0, bf: p.buffs, bl: p.blockCharges,
        au: p.cls === 'paladin' ? p.aura : -1, ds: p.cls === 'paladin' && now >= p.divineReadyAt && p.res >= S.DIVINE_STRIKE_COST ? 1 : 0,
        rs: Math.floor(p.res), rm: p.resMax,
        fu: now < p.furyUntil ? 1 : 0, hs: now < p.hasteUntil ? 1 : 0, ivc: now < p.invincibleUntil ? 1 : 0,
        fm: p.form === 'sword' ? 1 : 0, hx: now < p.hexUntil ? 1 : 0,
        ...this.passiveState(p, now),
        d: p.dead ? 1 : 0, as: p.atkSeq, sl: p.atkSlot,
      })),
      hd: this.hounds.map((h) => ({ id: h.id, x: Math.round(h.x), y: Math.round(h.y), f: h.f, mv: h.moving ? 1 : 0 })),
      sc: this.scarabs.map((sc) => ({ id: sc.id, x: Math.round(sc.x), y: sc.y, f: sc.f, mv: sc.moving ? 1 : 0, hp: sc.hp, mhp: sc.maxHp })),
      po: [
        ...this.portals.map((po) => ({ id: po.id, o: po.owner, ax: po.ax, ay: po.ay, bx: po.bx, by: po.by })),
        ...[...this.players.values()].filter((p) => p.portalPending && now <= p.portalPending.until)
          .map((p) => ({ id: 'pend-' + p.sid, o: p.sid, ax: p.portalPending.x, ay: p.portalPending.y, pend: 1 })),
      ],
      pt: [...this.pets].map(([sid, pet]) => ({ o: sid, x: Math.round(pet.x), y: Math.round(pet.y), f: pet.f, hp: Math.max(0, pet.hp), mhp: pet.maxHp, mv: pet.moving ? 1 : 0, d: pet.dead ? 1 : 0 })),
      m: [...this.monsters.values()].map((m) => ({
        id: m.id, t: m.type, x: Math.round(m.x), y: m.y, f: m.facing, hp: Math.max(0, m.hp), mhp: m.maxHp,
        mv: m.moving ? 1 : 0, hu: now - m.hurtAt < 150 ? 1 : 0,
        s: (now < m.freezeUntil ? 'f' : '') + (now < m.stunUntil ? 's' : '') + (now < m.rootUntil ? 'r' : '') +
          (now < m.slowUntil ? 'w' : '') + (now < m.exposedUntil ? 'x' : '') + (m.dots.some((d) => d.kind !== 'curse') ? 'p' : '') + (m.dots.some((d) => d.kind === 'curse') ? 'c' : '') +
          (now < m.tauntUntil ? 't' : ''),
      })),
      pr: this.projectiles.map((p) => ({ id: p.id, t: p.type, x: Math.round(p.x), y: Math.round(p.y), vx: p.vx, vy: p.vy, r: p.r })),
      z: this.zones.map((z) => ({ id: z.id, t: z.type, x: z.x, y: z.y, r: z.r })),
      tz: this.trees.map((t) => ({ id: t.id, x: t.x, y: t.y, f: t.f, hp: Math.max(0, t.hp), mhp: t.maxHp, g: Math.min(1, (now - t.bornAt) / (t.growAt - t.bornAt)) })),
      tr: this.traps.map((t) => ({ id: t.id, x: t.x, y: t.y })),
      pot: this.potions.map((pot) => ({ id: pot.id, k: pot.kind, s: pot.size, x: Math.round(pot.x), y: pot.y })),
      fx: this.fx,
      boss: this.bossAlive() ? 0 : Math.max(0, Math.round((this.nextBossAt - now) / 1000)),
    };
    this.fx = [];
    this.io.to('game').emit('snapshot', snap);
  }
}

module.exports = Game;
