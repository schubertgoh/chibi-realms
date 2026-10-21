// Client game: local physics + input, server snapshots, rendering, effects, HUD.
(function () {
  const S = window.Shared;
  const R = window.Render;
  const VIEW_H = 720;
  // Movement is on the arrow keys only, so A Z X C V are free for skills.
  const KEYMAP = {
    left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
    jump: ['Space', 'AltLeft', 'AltRight'],
  };
  const SKILL_KEYS = [['KeyA', 'Digit1'], ['KeyZ', 'Digit2'], ['KeyX', 'Digit3'], ['KeyC', 'Digit4'], ['KeyV', 'Digit5']];
  const SKILL_LABELS = S.SKILL_LABELS;

  let socket, canvas, ctx, dpr = 1, scale = 1, viewW = 1280;
  let running = false, onExit = null, token = null;
  let terrain, mountains, hills;
  let selfId = null, me = null, myInfo = null;
  const keys = new Set();
  let jumpQueued = false;
  const others = new Map(), monsters = new Map();
  let projectiles = [], zones = [], trees = [], traps = [], pets = [], hounds = [], scarabs = [], portals = [], potions = [];
  let portalQueued = false;
  const particles = [], floaters = [], effects = [], bubbles = new Map();
  const cds = new Array(S.COOLDOWN_SLOTS).fill(0); // Beyonder sword skills use slots 5-8
  let cam = { x: 0, y: 0 }, shake = 0, lastFrame = 0, lastSend = 0, time = 0;
  let clouds = [];
  let bossCountdown = 0;
  let deadSince = 0;
  let farming = false; // auto farm: the server drives our character and we follow its snapshots
  const el = {};

  // ------------------------------------------------------------------ lifecycle
  function start(opts) {
    token = opts.token;
    onExit = opts.onExit;
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d');
    if (!terrain) { terrain = R.buildTerrain(); mountains = R.buildMountains(); hills = R.buildHills(); }
    clouds = Array.from({ length: 9 }, (_, i) => ({ x: i * 260 + Math.random() * 120, y: 40 + Math.random() * 180, s: 0.6 + Math.random() * 0.7, v: 6 + Math.random() * 10 }));
    for (const id of ['hud-name', 'hud-level', 'hp-fill', 'hp-text', 'xp-fill', 'xp-text', 'stat-score', 'stat-kills', 'stat-assists',
      'stat-online', 'online-list', 'skillbar', 'chat-log', 'chat-input', 'toasts', 'death-overlay', 'respawn-btn', 'respawn-timer',
      'banner', 'boss-timer', 'hud-portrait', 'hud-buffs', 'passive-slot', 'res-fill', 'res-text']) el[id] = document.getElementById(id);
    el['res-fill'].style.background = S.RESOURCES[S.CLASSES[opts.character.cls].resource].color;
    buildSkillbar(opts.character.cls);
    buildPassive(opts.character.cls);
    delete el.skillbar.dataset.form;

    others.clear(); monsters.clear(); projectiles = []; zones = []; trees = []; traps = []; pets = []; hounds = []; scarabs = []; portals = [];
    cds.fill(0);
    farming = false;
    keys.clear(); jumpQueued = false; portalQueued = false; // keys held when the last game ended (keyup was never seen)
    lastBuffKey = ''; el['hud-buffs'].innerHTML = '';
    particles.length = 0; floaters.length = 0; effects.length = 0; bubbles.clear();
    el['chat-log'].innerHTML = '';
    me = null; selfId = null; myInfo = null;

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearKeys);

    socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => socket.emit('join', { token, characterId: opts.character.id }));
    socket.on('joinError', (msg) => stop(msg));
    socket.on('kicked', (msg) => stop(msg));
    socket.on('disconnect', (reason) => { if (running && reason !== 'io client disconnect') stop('Lost connection to the server.'); });
    socket.on('joined', onJoined);
    socket.on('snapshot', onSnapshot);
    socket.on('me', (info) => { const prevLevel = myInfo && myInfo.level; myInfo = info; updateStatsHud(); if (prevLevel && info.level > prevLevel) showBanner(`LEVEL UP!  Lv.${info.level}`, 'level'); });
    socket.on('hurt', ({ kb }) => {
      if (!me) return;
      shake = 8;
      if (!me.climb) { me.kbx = kb * 380; me.vy = -320; me.onGround = false; }
    });
    socket.on('teleport', ({ x, y, f }) => { if (!me) return; Object.assign(me, { x, y, facing: f, vx: 0, vy: 0, kbx: 0, climb: null, onGround: true }); });
    socket.on('reward', (r) => {
      const text = r.heal ? `💚 +${r.score} score for healing allies`
        : `${r.kill ? '⚔️ Kill' : '🤝 Assist'}: ${r.monster} (${r.share}% contribution) — +${r.score} score, +${r.xp} XP`;
      toast(text, r.kill ? 'gold' : '');
    });
    socket.on('cdReset', ({ slot, msg }) => { cds[cdIdx(slot)] = 0; toast(msg); });
    socket.on('noResource', ({ slot, type }) => { cds[cdIdx(slot)] = 0; toast(`Not enough ${S.RESOURCES[type].name.toLowerCase()}!`); });
    socket.on('cdReduce', ({ ms }) => { for (let i = 0; i < cds.length; i++) cds[i] -= ms; }); // Arcane Prowess
    socket.on('chat', ({ id, n, text }) => { addChat(n, text); bubbles.set(id, { text, until: performance.now() + 4500 }); });
    socket.on('sys', (text) => addChat(null, text));
    socket.on('banner', ({ text, kind }) => showBanner(text, kind));
    socket.on('autofarm', (d) => {
      const was = farming;
      farming = !!d.on;
      if (!me || (!farming && !was)) return; // we already took control back locally
      if (farming) { me.sx = me.x; me.sy = me.y; toast('🌾 Auto farm on'); }
      else {
        Object.assign(me, { x: d.x, y: d.y, facing: d.f, vx: 0, vy: 0, kbx: 0, climb: null });
        me.onGround = !!platformUnder(me.x, me.y);
        toast('Auto farm off');
      }
    });
    socket.on('autoCast', ({ slot, i, ms }) => {
      if (!me) return;
      const now = performance.now();
      cds[i] = now + ms;
      me.atkAt = now; me.atkSlot = slot;
      window.Sfx.cast(me.cls, me.form, slot);
      const b = el.skillbar.children[slot];
      if (b) { b.classList.remove('pressed'); void b.offsetWidth; b.classList.add('pressed'); }
    });

    running = true;
    window.Music.start();
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }

  function stop(message) {
    if (!running) return;
    running = false;
    window.Music.stop();
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', clearKeys);
    if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null; }
    el['death-overlay'].classList.add('hidden');
    if (onExit) onExit(message);
  }

  function onJoined({ id, x, y, me: info }) {
    selfId = id;
    myInfo = info;
    const st = S.playerStats(info.cls, info.level);
    me = { x, y, vx: 0, vy: 0, kbx: 0, facing: 1, onGround: false, climb: null, dropUntil: 0, cls: info.cls, hair: info.hair,
      speed: st.speed, jump: st.jump, hp: info.maxHp, maxHp: info.maxHp, dead: false, atkAt: -1, atkSlot: 0, stealth: false };
    updateStatsHud();
    drawPortrait();
    addChat(null, 'Welcome to Wild Realms! Arrow keys move, Space jumps, A Z X C V use skills, Enter to chat, M mutes sound. Type /farm in chat to auto farm.');
  }

  // ------------------------------------------------------------------ input
  function isKey(code, action) { return KEYMAP[action].includes(code); }
  function down(action) { return KEYMAP[action].some((k) => keys.has(k)); }
  function clearKeys() { keys.clear(); }

  function onKeyDown(e) {
    const chatFocused = document.activeElement === el['chat-input'];
    if (chatFocused) {
      if (e.code === 'Enter') {
        const text = el['chat-input'].value.trim();
        if (text && socket) socket.emit('chat', text);
        el['chat-input'].value = '';
        el['chat-input'].blur();
      } else if (e.code === 'Escape') el['chat-input'].blur();
      return;
    }
    if (e.code === 'Enter') { if (chatCollapsed()) setChatCollapsed(false); el['chat-input'].focus(); e.preventDefault(); clearKeys(); return; }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft', 'AltRight', 'Tab'].includes(e.code)) e.preventDefault();
    if (e.code === 'Tab') { document.getElementById('online-panel').classList.toggle('collapsed'); return; }
    if (e.code === 'KeyM' && !e.repeat) { window.Music.toggleMute(); return; }
    // any movement or skill key takes back control from auto farm
    if (farming && !e.repeat && (Object.values(KEYMAP).flat().includes(e.code) || SKILL_KEYS.flat().includes(e.code))) stopFarming();
    if (!e.repeat && isKey(e.code, 'jump')) jumpQueued = true;
    if (!e.repeat && e.code === 'ArrowUp') portalQueued = true;
    if (!e.repeat) SKILL_KEYS.forEach((ks, i) => { if (ks.includes(e.code)) useSkill(i); });
    keys.add(e.code);
  }
  function onKeyUp(e) { keys.delete(e.code); }

  function stopFarming() {
    farming = false; // the server confirms with 'autofarm' and our exact position
    if (me) { me.x = me.sx ?? me.x; me.y = me.sy ?? me.y; me.climb = null; me.vx = 0; me.vy = 0; }
    socket.emit('autofarm', false);
  }

  // While auto farming, glide toward the server's position and mirror its animation state.
  function followServer(dt) {
    if (!me || me.sx === undefined) return;
    const k = Math.min(1, dt * 14);
    if (Math.abs(me.sx - me.x) > 200 || Math.abs(me.sy - me.y) > 200) { me.x = me.sx; me.y = me.sy; }
    me.x += (me.sx - me.x) * k;
    me.y += (me.sy - me.y) * k;
    me.vx = me.sa === 'walk' ? me.facing * 100 : 0;
    me.vy = me.sa === 'climb' ? 100 : 0;
    me.climb = me.sa === 'climb' ? { x: me.x } : null;
    me.onGround = me.sa !== 'jump';
  }

  function useSkill(slot) {
    if (!me || me.dead) return;
    const now = performance.now();
    const idx = cdIdx(slot);
    if (now < cds[idx]) return;
    const portalSecond = me.cls === 'beyonder' && me.form !== 'sword' && slot === 3 && portals.some((po) => po.o === selfId && po.pend);
    const cost = portalSecond ? 0 : S.skillCost(me.cls, me.form, slot);
    if ((me.rs ?? 0) < cost) { toast(`Not enough ${S.RESOURCES[S.CLASSES[me.cls].resource].name.toLowerCase()}!`); return; }
    me.rs -= cost;
    window.Sfx.cast(me.cls, me.form, slot);
    cds[idx] = now + cooldownMs(slot);
    me.atkAt = now; me.atkSlot = slot;
    // movement-type skills are applied locally right away
    const payload = { slot };
    if (me.cls === 'fighter' && slot === 1) { me.kbx = me.facing * 950; me.chargeUntil = now + 320; me.climb = null; }
    if (me.cls === 'mage' && slot === 3) { const from = teleport(); payload.fx = from.x; payload.fy = from.y; }
    if (me.cls === 'rogue' && slot === 3) { me.kbx = me.facing * 820; me.rollUntil = now + 380; }
    if (me.cls === 'marksman' && slot === 3) { me.kbx = -me.facing * 700; me.vy = -560; me.onGround = false; me.climb = null; }
    if (me.cls === 'beyonder') {
      if (slot === 4) { me.form = me.form === 'sword' ? 'rod' : 'sword'; me.formLockUntil = now + 600; }
      else if (me.form === 'sword' && slot === 1) { me.kbx = me.facing * 1000; me.chargeUntil = now + 320; me.climb = null; }
      else if (me.form === 'rod' && slot === 3 && !portals.some((po) => po.o === selfId && po.pend)) cds[idx] = now + 400; // first portal
    }
    sendState(true);
    socket.emit('ability', payload);
    const el2 = el.skillbar.children[slot];
    el2.classList.remove('pressed'); void el2.offsetWidth; el2.classList.add('pressed');
  }

  function hasBuff(key) { return me && (me.bf & S.AURA_BITS[key]); }
  function cdIdx(slot) { return S.cdIndex(me.cls, me.form, slot); }
  function cooldownMs(slot) {
    let cd = S.skillDef(me.cls, me.form, slot).cd * 1000;
    if (slot === 0 && hasBuff('zephyr')) cd *= S.AURA_EFFECTS.zephyrAttackCd;
    return cd;
  }

  // Mage Teleport: up/down jumps to the nearest platform level in that direction, otherwise blinks sideways.
  function teleport() {
    const from = { x: me.x, y: me.y };
    const up = down('up'), dn = down('down'), left = down('left'), right = down('right');
    me.climb = null;
    if (up || dn) {
      const dir = up ? -1 : 1;
      const cands = S.PLATFORMS.filter((p) => me.x >= p.x - 6 && me.x <= p.x + p.w + 6 &&
        (dir < 0 ? p.y < me.y - 20 && p.y >= me.y - 260 : p.y > me.y + 20 && p.y <= me.y + 260));
      cands.sort((a, b) => Math.abs(a.y - me.y) - Math.abs(b.y - me.y));
      if (cands.length) me.y = cands[0].y;
      else if (dir < 0) me.y = Math.max(40, me.y - 190);
    } else {
      const dir = left ? -1 : right ? 1 : me.facing;
      me.facing = dir;
      me.x = Math.max(14, Math.min(S.WORLD.w - 14, me.x + dir * 240));
    }
    me.vx = 0; me.vy = 0; me.kbx = 0;
    me.onGround = !!platformUnder(me.x, me.y);
    return from;
  }

  // ------------------------------------------------------------------ physics
  function ladderAt(x, y, wantUp) {
    for (const l of S.LADDERS) {
      if (Math.abs(x - l.x) > 18) continue;
      if (wantUp && y > l.top + 2 && y <= l.bottom + 2) return l;
      if (!wantUp && y >= l.top - 3 && y < l.bottom - 2) return l;
    }
    return null;
  }

  function updateMe(dt, now) {
    if (!me || me.dead) return;
    const left = down('left'), right = down('right'), up = down('up'), dn = down('down');
    const rolling = me.rollUntil && now < me.rollUntil;

    if (me.climb) {
      const l = me.climb;
      me.x = l.x; me.vx = 0; me.kbx = 0;
      me.vy = up ? -200 : dn ? 200 : 0;
      me.y += me.vy * dt;
      if (me.y <= l.top) { me.y = l.top; me.climb = null; me.onGround = true; me.vy = 0; }
      else if (me.y >= l.bottom) { me.y = l.bottom; me.climb = null; me.onGround = true; me.vy = 0; }
      if (jumpQueued && me.climb) {
        me.climb = null;
        if (left || right) { me.vy = -480; me.facing = left ? -1 : 1; me.vx = me.facing * me.speed; }
        else me.vy = -150;
      }
      jumpQueued = false;
      return;
    }

    // Void Portal travel: ↑ while standing in either end jumps to the other
    if (portalQueued) {
      portalQueued = false;
      const dest = portalDestination();
      if (dest && !(me.portalCdUntil && now < me.portalCdUntil)) {
        burst(me.x, me.y - 30, 14, ['#b48cff', '#3b2456', '#ffffff'], 180, { g: 0, shape: 'star', size: 4 });
        Object.assign(me, { x: dest.x, y: dest.y, vx: 0, vy: 0, kbx: 0, climb: null, portalCdUntil: now + 700 });
        me.onGround = !!platformUnder(me.x, me.y);
        burst(me.x, me.y - 30, 14, ['#b48cff', '#3b2456', '#ffffff'], 180, { g: 0, shape: 'star', size: 4 });
        sendState(true);
        return;
      }
    }

    // grab ladder
    if (up && !rolling) { const l = ladderAt(me.x, me.y, true); if (l && (me.onGround || me.vy > -200)) { me.climb = l; me.vy = 0; return; } }
    if (dn && me.onGround && !rolling) { const l = ladderAt(me.x, me.y, false); if (l && Math.abs(me.y - l.top) < 3) { me.climb = l; me.y += 4; return; } }

    let move = 0;
    if (left) move -= 1;
    if (right) move += 1;
    if (move) me.facing = move;
    const hasted = !!me.hs;
    const target = move * me.speed * (hasBuff('zephyr') ? S.AURA_EFFECTS.zephyrSpeed : 1) * (hasted ? S.PASSIVE.hasteSpeed : 1);
    const accel = me.onGround ? 18 : 7;
    me.vx += (target - me.vx) * Math.min(1, accel * dt);

    if (jumpQueued) {
      if (me.onGround) {
        const plat = platformUnder(me.x, me.y);
        if (dn && plat && !plat.ground) { me.dropUntil = now + 260; me.onGround = false; me.y += 2; }
        else { me.vy = -me.jump; me.onGround = false; }
      }
      jumpQueued = false;
    }

    me.vy = Math.min(me.vy + S.WORLD.gravity * dt, 1100);
    me.x += (me.vx + me.kbx) * dt;
    me.kbx *= Math.pow(0.012, dt);
    if (Math.abs(me.kbx) < 5) me.kbx = 0;
    me.x = Math.max(14, Math.min(S.WORLD.w - 14, me.x));

    const prevY = me.y;
    me.y += me.vy * dt;
    me.onGround = false;
    if (me.vy >= 0) {
      for (const p of S.PLATFORMS) {
        if (me.x < p.x - 6 || me.x > p.x + p.w + 6) continue;
        if (!p.ground && now < me.dropUntil) continue;
        if (prevY <= p.y + 1 && me.y >= p.y) { me.y = p.y; me.vy = 0; me.onGround = true; break; }
      }
    }
    if (me.y > S.WORLD.h) { me.y = S.SPAWN.y; me.x = S.SPAWN.x; me.vy = 0; }
  }

  function portalDestination() {
    for (const po of portals) {
      if (po.pend) continue;
      if (Math.abs(me.x - po.ax) < 30 && Math.abs(me.y - po.ay) < 40) return { x: po.bx, y: po.by };
      if (Math.abs(me.x - po.bx) < 30 && Math.abs(me.y - po.by) < 40) return { x: po.ax, y: po.ay };
    }
    return null;
  }

  function platformUnder(x, y) {
    return S.PLATFORMS.find((p) => Math.abs(p.y - y) < 2 && x >= p.x - 6 && x <= p.x + p.w + 6) || null;
  }

  function sendState(force) {
    if (!socket || !me || me.dead) return;
    const now = performance.now();
    if (!force && now - lastSend < 50) return;
    lastSend = now;
    let a = 'idle';
    if (me.climb) a = 'climb'; else if (!me.onGround) a = 'jump'; else if (Math.abs(me.vx) > 30) a = 'walk';
    socket.emit('state', { x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, f: me.facing, a });
  }

  // ------------------------------------------------------------------ network snapshot
  function onSnapshot(s) {
    const now = performance.now();
    bossCountdown = s.boss;
    const seen = new Set();
    for (const p of s.p) {
      seen.add(p.id);
      if (p.id === selfId) {
        if (me) {
          const wasDead = me.dead;
          me.hp = p.hp; me.maxHp = p.mhp; me.dead = !!p.d; me.stealth = !!p.st; me.iw = !!p.iw; me.inv = !!p.inv; me.gs = !!p.gs; me.level = p.l;
          me.bf = p.bf; me.au = p.au; me.bl = p.bl; me.ds = p.ds;
          me.rs = p.rs; me.rm = p.rm;
          me.sx = p.x; me.sy = p.y; me.sa = p.a;
          if (farming) me.facing = p.f;
          me.fu = p.fu; me.hs = p.hs; me.ivc = p.ivc; me.pa = p.pa; me.pc = p.pc; me.hx = p.hx;
          if (!(me.formLockUntil && now < me.formLockUntil)) me.form = p.fm ? 'sword' : 'rod';
          if (me.dead && !wasDead) { deadSince = now; el['death-overlay'].classList.remove('hidden'); }
          if (!me.dead && wasDead) el['death-overlay'].classList.add('hidden');
          const st = S.playerStats(me.cls, p.l);
          me.speed = st.speed; me.jump = st.jump;
        }
        continue;
      }
      let o = others.get(p.id);
      if (!o) { o = { ...p, rx: p.x, ry: p.y, atkAt: -1, seed: Math.random() * 10 }; others.set(p.id, o); }
      if (o.as !== p.as) { o.atkAt = now; window.Sfx.cast(p.c, p.fm ? 'sword' : 'rod', p.sl, p); }
      Object.assign(o, p);
    }
    for (const id of others.keys()) if (!seen.has(id)) others.delete(id);

    const seenM = new Set();
    for (const m of s.m) {
      seenM.add(m.id);
      let o = monsters.get(m.id);
      if (!o) { o = { ...m, rx: m.x }; monsters.set(m.id, o); }
      Object.assign(o, m);
    }
    for (const id of monsters.keys()) if (!seenM.has(id)) monsters.delete(id);

    projectiles = s.pr.map((p) => ({ ...p, at: now }));
    zones = s.z;
    trees = s.tz || [];
    traps = s.tr || [];
    pets = s.pt || [];
    hounds = s.hd || [];
    scarabs = s.sc || [];
    portals = s.po || [];
    potions = s.pot || [];
    for (const fx of s.fx) { spawnFx(fx, now); window.Sfx.impact(fx); }
    updateOnlineList(s.p);
  }

  // ------------------------------------------------------------------ effects
  function burst(x, y, n, color, speed, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.6);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (opts.up || 0), life: opts.life || 0.6, max: opts.life || 0.6,
        color: Array.isArray(color) ? color[i % color.length] : color, size: opts.size || 4, g: opts.g ?? 300, shape: opts.shape || 'circle' });
    }
  }

  function spawnFx(fx, now) {
    switch (fx.t) {
      case 'dmg': floaters.push({ x: fx.x, y: fx.y, v: fx.v, k: fx.k, born: now }); break;
      case 'slash': effects.push({ ...fx, born: now, dur: 250 }); break;
      case 'bash': effects.push({ ...fx, born: now, dur: 350 }); burst(fx.x, fx.y, 10, ['#ffe27a', '#fff'], 260, { shape: 'star', size: 5 }); break;
      case 'whirl': effects.push({ ...fx, born: now, dur: 450 }); break;
      case 'shield': effects.push({ ...fx, born: now, dur: 600 }); burst(fx.x, fx.y - 30, 16, ['#ffe27a', '#bcd4ff'], 220, { shape: 'star' }); break;
      case 'explode': effects.push({ ...fx, born: now, dur: 380 }); burst(fx.x, fx.y, 22, ['#ff9a3c', '#ffd34d', '#ff5e3a'], 320, { g: 100, size: 5 }); break;
      case 'lightning': effects.push({ ...fx, born: now, dur: 320, seed: Math.random() * 100 });
        for (const [x, y] of fx.pts.slice(1)) burst(x, y, 8, ['#fff7a8', '#9ad7ff'], 260, { g: 0, size: 3 }); break;
      case 'nova': effects.push({ ...fx, born: now, dur: 500 }); burst(fx.x, fx.y, 28, ['#bfe9ff', '#ffffff', '#7fc9ff'], 380, { g: 60, shape: 'shard', size: 5 }); break;
      case 'entangle': effects.push({ ...fx, born: now, dur: 700 }); burst(fx.x, fx.y - 10, 22, ['#5fb85a', '#86d66a', '#3f8f3a'], 250, { up: 180, shape: 'leaf', size: 5 }); break;
      case 'heal': effects.push({ ...fx, born: now, dur: 700 }); burst(fx.x, fx.y - 30, 18, ['#8af59a', '#d4ffd9'], 150, { up: 160, g: -60, shape: 'plus', size: 6, life: 0.9 }); break;
      case 'smoke': burst(fx.x, fx.y - 30, 20, ['#6b5d8f', '#9a8cc2', '#3a3355'], 140, { g: -40, size: 9, life: 0.7 }); break;
      case 'dust': burst(fx.x, fx.y - 4, 12, ['#e8dcc4', '#ffffff'], 140, { g: -20, size: 7, life: 0.5 }); break;
      case 'smite': effects.push({ ...fx, born: now, dur: 500 }); shake = Math.max(shake, 7); burst(fx.x, fx.y - 30, 18, ['#fff6c8', '#ffd34d', '#ffffff'], 300, { g: 200, shape: 'star', size: 5 }); break;
      case 'knives': effects.push({ ...fx, born: now, dur: 420 }); shake = Math.max(shake, 5); burst(fx.x, fx.y, 12, ['#dfe6ee', '#d6455f'], 260, { g: 0, size: 3 }); break;
      case 'burst': effects.push({ ...fx, born: now, dur: 350 }); burst(fx.x, fx.y, 14, ['#ffffff', '#c9f0ff'], 300, { g: 0 }); break;
      case 'charge': effects.push({ ...fx, born: now, dur: 320 }); burst(fx.x1, fx.y - 6, 14, ['#e8dcc4', '#ffffff'], 160, { g: -20, size: 7, life: 0.5 }); break;
      case 'blink': effects.push({ ...fx, born: now, dur: 320 }); burst(fx.x, fx.y, 18, ['#c9a8ff', '#ffffff', '#8a63d2'], 200, { g: 0, shape: 'star', size: 4 }); break;
      case 'block': effects.push({ ...fx, born: now, dur: 420 }); floaters.push({ x: fx.x, y: fx.y - 75, v: 'BLOCK', k: 'b', born: now });
        burst(fx.x + 18, fx.y - 32, 10, ['#ffe27a', '#ffffff'], 200, { g: 0, shape: 'star', size: 4 }); break;
      case 'cry': effects.push({ ...fx, born: now, dur: 650 }); shake = Math.max(shake, 4); break;
      case 'auraswap': {
        const a = S.AURAS[fx.a];
        effects.push({ ...fx, born: now, dur: 600, color: a.color });
        floaters.push({ x: fx.x, y: fx.y - 95, v: a.name, k: 'a', born: now });
        break;
      }
      case 'trapboom': shake = Math.max(shake, 6); burst(fx.x, fx.y - 10, 16, ['#6b5d3f', '#b47a45'], 300, { up: 150, g: 700, size: 4 }); break;
      case 'poison': burst(fx.x, fx.y, 14, ['#7fe05a', '#b6ff8a', '#3f8f3a'], 120, { g: -60, size: 5, life: 0.8 }); break;
      case 'vine': effects.push({ ...fx, born: now, dur: 260 }); burst(fx.x2, fx.y2, 6, ['#86d66a', '#3f8f3a'], 160, { g: 100, shape: 'leaf', size: 4 }); break;
      case 'treedeath': burst(fx.x, fx.y - 50, 26, ['#8a5a32', '#5fb85a', '#86d66a'], 240, { up: 120, g: 500, shape: 'leaf', size: 6, life: 0.9 }); break;
      case 'headshot': effects.push({ ...fx, born: now, dur: 450 }); burst(fx.x, fx.y, 16, ['#ff5e5e', '#ffd1d1', '#ffffff'], 280, { g: 0, size: 4 }); break;
      case 'fury': burst(fx.x, fx.y - 30, 18, ['#ff5e3a', '#ffb03c', '#ffe27a'], 220, { g: -80, size: 5 }); floaters.push({ x: fx.x, y: fx.y - 95, v: 'Battle Fury!', k: 'a', born: now }); break;
      case 'arcane': burst(fx.x, fx.y - 40, 16, ['#c9a8ff', '#8fd3ff', '#ffffff'], 180, { g: -40, shape: 'star', size: 4 }); floaters.push({ x: fx.x, y: fx.y - 95, v: '-2s cooldowns', k: 'a', born: now }); break;
      case 'bite': effects.push({ ...fx, born: now, dur: 200 }); break;
      case 'petdeath': burst(fx.x, fx.y - 20, 16, ['#cfd6e0', '#ffffff'], 160, { g: -30, size: 7 }); break;
      case 'fairybolt': effects.push({ ...fx, born: now, dur: 380 }); burst(fx.x2, fx.y2, 10, fx.heal ? ['#8af5c8', '#ffffff'] : ['#7fd8ff', '#ffffff'], 160, { g: 0, shape: fx.heal ? 'plus' : 'star', size: 4 }); break;
      case 'invincible': effects.push({ ...fx, born: now, dur: 900 }); shake = Math.max(shake, 6); floaters.push({ x: fx.x, y: fx.y - 100, v: 'INVINCIBLE!', k: 'b', born: now });
        burst(fx.x, fx.y - 40, 30, ['#ffe27a', '#ffffff', '#ffd34d'], 300, { g: 0, shape: 'star', size: 5 }); break;
      case 'curse': effects.push({ ...fx, born: now, dur: 450 }); burst(fx.x, fx.y, 14, ['#7b3fd6', '#1a0d2a', '#c9a8ff'], 140, { g: -40, size: 5 }); break;
      case 'phasedash': effects.push({ ...fx, born: now, dur: 320 }); burst(fx.x1, fx.y - 30, 14, ['#7b3fd6', '#c9a8ff'], 160, { g: 0, size: 4 }); break;
      case 'transmog': burst(fx.x, fx.y - 30, 20, ['#7b3fd6', '#1a0d2a', '#c9a8ff', '#ffffff'], 200, { g: -30, shape: 'star', size: 4 }); break;
      case 'hex': burst(fx.x, fx.y - 34, 16, ['#b48cff', '#ffffff'], 180, { g: 0, shape: 'shard', size: 5 }); break;
      case 'potion': burst(fx.x, fx.y - 14, 16, fx.kind === 'hp' ? ['#ff6b81', '#ffd1d9', '#ffffff'] : ['#6fa8ff', '#cfe0ff', '#ffffff'], 160, { g: -60, shape: 'plus', size: 5 }); break;
      case 'dodge': floaters.push({ x: fx.x, y: fx.y - 75, v: 'DODGE', k: 'a', born: now }); break;
      case 'summon': burst(fx.x, fx.y, 26, ['#9ef2a8', '#ffffff', '#5fe07a'], 200, { g: -30, shape: 'star', size: 4 }); break;
      case 'spirit': effects.push({ ...fx, born: now, dur: 220 }); burst(fx.x2, fx.y2, 6, ['#9ef2a8', '#fff'], 160, { g: 0, size: 3 }); break;
      case 'death': burst(fx.x, fx.y - 20, fx.m === 'kingslime' ? 70 : 18, ['#ffffff', '#ffe27a', '#ffd1ec'], fx.m === 'kingslime' ? 500 : 240, { g: 120, shape: 'star', size: 5, life: 0.8 });
        burst(fx.x, fx.y - 10, 10, ['#f4f4f4'], 120, { g: -30, size: 12, life: 0.5 }); if (fx.m === 'kingslime') shake = 20; break;
      case 'pdeath': burst(fx.x, fx.y - 30, 24, ['#ffffff', '#ffb0c8'], 240, { g: -40, size: 6 }); break;
      case 'spawn': burst(fx.x, fx.y, fx.big ? 50 : 12, ['#ffffff', '#ffe27a', '#b9f2ff'], fx.big ? 380 : 140, { g: -20, shape: 'star', size: fx.big ? 7 : 3 }); break;
      case 'stomp': effects.push({ ...fx, born: now, dur: 600 }); shake = Math.max(shake, 14); burst(fx.x, fx.y, 30, ['#b47a45', '#9be35a'], 380, { up: 200, g: 900, size: 6 }); break;
      case 'levelup': effects.push({ ...fx, born: now, dur: 1600 }); burst(fx.x, fx.y - 40, 40, ['#ffe27a', '#ffffff', '#ffb84d'], 260, { up: 200, g: 100, shape: 'star', size: 6, life: 1.2 }); break;
    }
  }

  // ------------------------------------------------------------------ frame
  function frame(ts) {
    if (!running) return;
    const dt = Math.min(0.05, (ts - lastFrame) / 1000);
    lastFrame = ts;
    time += dt;
    if (farming) followServer(dt);
    else { updateMe(dt, ts); sendState(false); }
    if (me) window.Sfx.listen(me.x, me.y);

    const k = Math.min(1, dt * 14);
    for (const o of others.values()) { o.rx += (o.x - o.rx) * k; o.ry += (o.y - o.ry) * k; if (Math.abs(o.x - o.rx) > 300) { o.rx = o.x; o.ry = o.y; } }
    for (const m of monsters.values()) m.rx += (m.x - m.rx) * k;

    for (const p of particles) { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);

    render(ts, dt);
    updateHud(ts);
    requestAnimationFrame(frame);
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    // a hidden/minimised window can report 0x0 — keep at least 1px so the camera maths stays finite
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    scale = canvas.height / VIEW_H;
    viewW = canvas.width / scale;
    if (viewW > S.WORLD.w) { scale = canvas.width / S.WORLD.w; viewW = S.WORLD.w; }
  }

  function render(now, dt) {
    const viewH = canvas.height / scale;
    if (me) {
      const tx = Math.max(0, Math.min(S.WORLD.w - viewW, me.x - viewW / 2));
      const ty = Math.max(0, Math.min(S.WORLD.h - viewH, me.y - viewH * 0.62));
      cam.x += (tx - cam.x) * Math.min(1, dt * 8);
      cam.y += (ty - cam.y) * Math.min(1, dt * 8);
    }
    shake *= Math.pow(0.002, dt);
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawBackdrop(viewH);

    ctx.save();
    ctx.translate(-Math.round(cam.x) + sx, -Math.round(cam.y) + sy);
    // terrain
    const srcX = Math.max(0, Math.floor(cam.x) - 20), srcY = Math.max(0, Math.floor(cam.y) - 20);
    const srcW = Math.min(S.WORLD.w - srcX, Math.ceil(viewW) + 40), srcH = Math.min(S.WORLD.h - srcY, Math.ceil(viewH) + 40);
    ctx.drawImage(terrain, srcX, srcY, srcW, srcH, srcX, srcY, srcW, srcH);

    drawZones(now);
    for (const t of traps) R.drawTrap(ctx, t, now / 1000);
    for (const t of trees) R.drawTreeSpirit(ctx, t, now / 1000);
    for (const pt of pets) if (!pt.d) R.drawWolf(ctx, pt, now / 1000);
    for (const po of portals) drawPortalPair(po, now);
    for (const sc of scarabs) R.drawScarab(ctx, sc, now / 1000);
    for (const pot of potions) R.drawPotion(ctx, pot, now / 1000);
    for (const h of hounds) R.drawWolf(ctx, h, now / 1000, 'spectral');
    drawAuraRings(now);
    for (const m of monsters.values()) R.drawMonster(ctx, { ...m, x: m.rx }, now / 1000);
    for (const o of others.values()) drawPlayer(o, now, false);
    if (me) drawPlayer(me, now, true);
    drawProjectiles(now);
    drawEffects(now);
    drawParticles();
    for (const m of monsters.values()) drawMonsterBar(m);
    for (const o of others.values()) drawNameTag(o.rx, o.ry, `${o.ai ? '🤖 ' : ''}Lv.${o.l} ${o.n}`, o.d, false, o.id);
    if (me && myInfo) drawNameTag(me.x, me.y, `Lv.${myInfo.level} ${myInfo.name}`, me.dead, true, selfId);
    for (const t of trees) if (t.g >= 1 && t.hp < t.mhp) drawBar(t.x, t.y - 118, 46, t.hp / t.mhp, '#6ee07a');
    for (const pt of pets) if (!pt.d && pt.hp < pt.mhp) drawBar(pt.x, pt.y - 50, 34, pt.hp / pt.mhp, '#ffb03c');
    drawFloaters(now);
    ctx.restore();
  }

  // Paladin aura rings (faint circle around every paladin in its aura's colour)
  function drawAuraRings(now) {
    const pals = [...others.values()].filter((o) => o.au >= 0 && !o.d).map((o) => ({ x: o.rx, y: o.ry, au: o.au }));
    if (me && me.au >= 0 && !me.dead) pals.push({ x: me.x, y: me.y, au: me.au });
    for (const p of pals) {
      const a = S.AURAS[p.au];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = a.color;
      ctx.beginPath(); ctx.ellipse(0, -4, S.AURA_RADIUS, 26, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = a.color; ctx.lineWidth = 2; ctx.setLineDash([10, 8]); ctx.lineDashOffset = -now / 40;
      ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }
  }

  function drawBackdrop(viewH) {
    const g = ctx.createLinearGradient(0, 0, 0, viewH);
    g.addColorStop(0, '#5fb6f2'); g.addColorStop(0.55, '#a8dcfb'); g.addColorStop(1, '#e3f5ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, viewW, viewH);
    // sun
    const sunX = viewW * 0.82, sunY = 90 - cam.y * 0.05;
    const sg = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 110);
    sg.addColorStop(0, 'rgba(255,250,210,0.95)'); sg.addColorStop(0.3, 'rgba(255,240,180,0.5)'); sg.addColorStop(1, 'rgba(255,240,180,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sunX, sunY, 110, 0, Math.PI * 2); ctx.fill();
    // clouds
    const span = viewW + 400;
    for (const c of clouds) {
      const x = (((c.x - cam.x * 0.08 + time * c.v) % span) + span) % span - 200;
      R.drawCloud(ctx, x, c.y - cam.y * 0.05, c.s);
    }
    // mountains
    const my = viewH * 0.78 - (cam.y - 600) * 0.22 - 360;
    let ox = -((cam.x * 0.2) % 1600);
    for (let x = ox; x < viewW; x += 1600) ctx.drawImage(mountains, x, my);
    // hills
    const hy = viewH * 0.98 - (cam.y - 600) * 0.45 - 420;
    ox = -((cam.x * 0.45) % 1600);
    for (let x = ox; x < viewW; x += 1600) ctx.drawImage(hills, x, hy);
    if (hy + 420 < viewH) { ctx.fillStyle = '#7cc95c'; ctx.fillRect(0, hy + 419, viewW, viewH - hy - 419); }
  }

  function drawPlayer(p, now, isMe) {
    const x = isMe ? p.x : p.rx, y = isMe ? p.y : p.ry;
    if (isMe ? p.dead : p.d) { drawGhost(x, y, now); return; }
    const cls = isMe ? p.cls : p.c;
    const stealth = isMe ? p.stealth : p.st;
    ctx.save();
    ctx.translate(x, y);
    if (stealth) ctx.globalAlpha = isMe ? 0.45 : 0.18;
    if ((isMe ? p.inv : p.inv) && Math.floor(now / 80) % 2) ctx.globalAlpha *= 0.6;
    const atkElapsed = now - p.atkAt;
    const atk = p.atkAt >= 0 && atkElapsed < 280 ? atkElapsed / 280 : -1;
    const anim = isMe ? null : p.a;
    const moving = isMe ? Math.abs(p.vx) > 30 || (p.climb && Math.abs(p.vy) > 1) : anim === 'walk' || anim === 'climb';
    const air = isMe ? !p.onGround && !p.climb : anim === 'jump';
    const climbing = isMe ? !!p.climb : anim === 'climb';
    const rolling = isMe && p.rollUntil && now < p.rollUntil;
    const charging = isMe && p.chargeUntil && now < p.chargeUntil;
    const hasteOn = p.hs;
    if (p.fu) drawFury(now);
    if (hasteOn && (isMe ? Math.abs(p.vx) > 30 : p.a === 'walk')) drawHaste(isMe ? p.facing : p.f, now);
    if (p.ivc) drawInvincible(now);
    if (p.hx) drawHexArmor(now);
    if (charging) { ctx.rotate(0.18 * p.facing); }
    if (rolling) { ctx.translate(0, -26); ctx.rotate(((now - (p.rollUntil - 380)) / 380) * Math.PI * 2 * p.facing); ctx.translate(0, 26); }
    R.drawChibi(ctx, { cls, hair: isMe ? p.hair : p.h, facing: isMe ? p.facing : p.f, t: now / 1000, moving, air, climbing, atk, atkSlot: isMe ? p.atkSlot : p.sl, seed: p.seed || 0, divine: !!p.ds, form: isMe ? p.form : (p.fm ? 'sword' : 'rod') });
    if (p.iw) {
      ctx.globalAlpha = 0.35 + Math.sin(now / 120) * 0.1;
      R.ell(ctx, 0, -32, 34, 40, null, '#ffd34d', 3);
      ctx.fillStyle = 'rgba(255,220,120,0.15)'; ctx.fill();
    }
    ctx.restore();
    if (p.bl > 0) drawBulwark(x, y, p.bl, now);
    if (cls === 'druid') drawFairy(x, y, isMe ? p.facing : p.f, now);
    if (p.gs) drawGuardianSpirits(x, y, now);
    // hp bar for players (allies see each other)
    const hp = p.hp, mhp = isMe ? p.maxHp : p.mhp;
    if (hp < mhp) drawBar(x, y - 84, 40, hp / mhp, '#ff5e7a');
    // chat bubble
    const id = isMe ? selfId : p.id;
    const b = bubbles.get(id);
    if (b && performance.now() < b.until) drawBubble(x, y - 100, b.text);
  }

  function drawGhost(x, y, now) {
    ctx.save();
    ctx.translate(x, y - 40 + Math.sin(now / 300) * 6);
    ctx.globalAlpha = 0.7;
    R.ell(ctx, 0, 0, 18, 22, '#f4f8ff', '#9aa8c8', 2);
    ctx.fillStyle = '#f4f8ff'; ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(-18, 22); ctx.lineTo(-9, 15); ctx.lineTo(0, 22); ctx.lineTo(9, 15); ctx.lineTo(18, 22); ctx.lineTo(18, 0); ctx.fill();
    R.ell(ctx, -6, -4, 2.5, 4, '#2a1e2a'); R.ell(ctx, 6, -4, 2.5, 4, '#2a1e2a');
    ctx.restore();
    // tombstone
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#a8b0bf'; ctx.strokeStyle = '#5a6070'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-12, -20); ctx.arc(0, -20, 12, Math.PI, 0); ctx.lineTo(12, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5a6070'; ctx.font = 'bold 9px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('RIP', 0, -14);
    ctx.restore();
  }

  function drawBar(x, y, w, frac, color) {
    ctx.fillStyle = 'rgba(30,20,40,0.65)';
    R.rr(ctx, x - w / 2 - 1, y - 1, w + 2, 7, 3.5); ctx.fill();
    ctx.fillStyle = color;
    R.rr(ctx, x - w / 2, y, Math.max(0, w * frac), 5, 2.5); ctx.fill();
  }

  function drawMonsterBar(m) {
    const def = S.MONSTERS[m.t];
    if (def.boss) {
      drawBar(m.rx, m.y - def.h - 60, 160, m.hp / m.mhp, '#ff4d6d');
      drawLabel(m.rx, m.y - def.h - 70, `👑 ${def.name}`, '#ffd34d');
      return;
    }
    if (m.hp < m.mhp) drawBar(m.rx, m.y - def.h - 12, 44, m.hp / m.mhp, '#ff8a3c');
  }

  function drawLabel(x, y, text, color) {
    ctx.font = 'bold 14px Fredoka, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = '#3a2a2a'; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  function drawNameTag(x, y, text, dead, isMe) {
    ctx.font = '600 12px Fredoka, sans-serif';
    ctx.textAlign = 'center';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = isMe ? 'rgba(60,40,90,0.85)' : 'rgba(30,30,45,0.75)';
    R.rr(ctx, x - w / 2, y + 6, w, 17, 5); ctx.fill();
    ctx.fillStyle = dead ? '#aaa' : isMe ? '#ffe27a' : '#ffffff';
    ctx.fillText(text, x, y + 18.5);
  }

  function drawBubble(x, y, text) {
    ctx.font = '13px Fredoka, sans-serif'; ctx.textAlign = 'center';
    const t = text.length > 40 ? text.slice(0, 38) + '…' : text;
    const w = Math.min(260, ctx.measureText(t).width + 18);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#5a4a6a'; ctx.lineWidth = 1.5;
    R.rr(ctx, x - w / 2, y - 22, w, 24, 10); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 5, y + 2); ctx.lineTo(x, y + 9); ctx.lineTo(x + 5, y + 2); ctx.fill();
    ctx.fillStyle = '#3a2a4a'; ctx.fillText(t, x, y - 6);
  }

  // drawn inside drawPlayer's transform (origin = feet)
  function drawFury(now) {
    ctx.save();
    for (let i = 0; i < 5; i++) {
      const k = ((now / 500) + i / 5) % 1;
      const fx = Math.sin(i * 1.7 + now / 200) * 16;
      ctx.globalAlpha = (1 - k) * 0.7;
      R.ell(ctx, fx, -10 - k * 60, 7 * (1 - k) + 2, 10 * (1 - k) + 3, i % 2 ? '#ff5e3a' : '#ffb03c');
    }
    ctx.restore();
  }
  function drawHaste(facing, now) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const y = -14 - i * 13, len = 18 + ((now / 40 + i * 7) % 14);
      ctx.beginPath(); ctx.moveTo(-facing * 16, y); ctx.lineTo(-facing * (16 + len), y); ctx.stroke();
    }
    ctx.restore();
  }
  function drawHexArmor(now) {
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(now / 140) * 0.15;
    ctx.strokeStyle = '#b48cff'; ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = now / 700 + i * Math.PI / 3;
      const hx = Math.cos(a) * 30, hy = -34 + Math.sin(a) * 36;
      ctx.beginPath();
      for (let j = 0; j < 6; j++) { const b = j * Math.PI / 3; ctx.lineTo(hx + Math.cos(b) * 7, hy + Math.sin(b) * 7); }
      ctx.closePath(); ctx.stroke();
    }
    ctx.restore();
  }
  function drawInvincible(now) {
    ctx.save();
    ctx.globalAlpha = 0.45 + Math.sin(now / 90) * 0.15;
    const g = ctx.createRadialGradient(0, -34, 10, 0, -34, 52);
    g.addColorStop(0, 'rgba(255,250,210,0.15)'); g.addColorStop(1, 'rgba(255,215,80,0.65)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, -34, 40, 48, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff3b0'; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
  }

  // Druid's glowing blue nature fairy, orbiting just behind the druid's head
  function drawFairy(x, y, facing, now) {
    const t = now / 1000;
    const fx = x - facing * 26 + Math.cos(t * 2.2) * 10, fy = y - 76 + Math.sin(t * 3.1) * 7;
    ctx.save();
    ctx.translate(fx, fy);
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 20);
    g.addColorStop(0, 'rgba(160,230,255,0.9)'); g.addColorStop(1, 'rgba(90,180,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill();
    const flap = Math.abs(Math.sin(t * 18));
    ctx.globalAlpha = 0.8;
    R.ell(ctx, -6, -3, 6, 3 + flap * 3, 'rgba(220,245,255,0.9)');
    R.ell(ctx, 6, -3, 6, 3 + flap * 3, 'rgba(220,245,255,0.9)');
    ctx.globalAlpha = 1;
    R.ell(ctx, 0, 0, 4.5, 4.5, '#e8fbff', '#4fa8e8', 1.2);
    R.ell(ctx, 0, -6, 3.5, 3.5, '#fff6e6', '#4fa8e8', 1);
    if (Math.random() < 0.15) particles.push({ x: fx, y: fy + 4, vx: (Math.random() - 0.5) * 20, vy: 20, life: 0.6, max: 0.6, color: '#bfeaff', size: 2, g: 0, shape: 'star' });
    ctx.restore();
  }

  // Divine Bulwark: a golden barrier with one pip per remaining block
  function drawBulwark(x, y, charges, now) {
    ctx.save();
    ctx.translate(x, y - 34);
    ctx.globalAlpha = 0.5 + Math.sin(now / 160) * 0.12;
    ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 3; ctx.fillStyle = 'rgba(255,230,140,0.16)';
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; ctx.lineTo(Math.cos(a) * 38, Math.sin(a) * 44); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 1;
    for (let i = 0; i < charges; i++) R.ell(ctx, -6 + i * 12, -54, 4.5, 4.5, '#ffe27a', '#a8761a', 1.5);
    ctx.restore();
  }

  function drawGuardianSpirits(x, y, now) {
    ctx.save();
    ctx.translate(x, y - 32);
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#ffe9a0'; ctx.lineWidth = 2; ctx.setLineDash([6, 10]); ctx.lineDashOffset = -now / 30;
    ctx.beginPath(); ctx.ellipse(0, 0, 160, 70, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    for (let i = 0; i < 3; i++) {
      const a = now / 260 + (i * Math.PI * 2) / 3;
      const sx = Math.cos(a) * 95, sy = Math.sin(a) * 38;
      ctx.globalAlpha = 0.35;
      const g = ctx.createRadialGradient(sx, sy, 2, sx, sy, 22);
      g.addColorStop(0, 'rgba(255,250,210,0.9)'); g.addColorStop(1, 'rgba(255,230,140,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 22, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.95;
      // tiny winged spirit
      R.ell(ctx, sx - 7, sy - 2, 6, 3.5, '#ffffff');
      R.ell(ctx, sx + 7, sy - 2, 6, 3.5, '#ffffff');
      R.ell(ctx, sx, sy, 6, 6, '#fff6d0', '#e0a82e', 1.2);
      R.ell(ctx, sx, sy - 9, 5, 1.6, null, '#ffd34d', 1.5);
      R.ell(ctx, sx - 2, sy - 1, 0.9, 1.3, '#5a3a22'); R.ell(ctx, sx + 2, sy - 1, 0.9, 1.3, '#5a3a22');
    }
    ctx.restore();
  }

  function drawMagicShield(z, now) {
    ctx.save();
    ctx.translate(z.x, z.y);
    const g = ctx.createRadialGradient(0, -40, 10, 0, -30, z.r);
    g.addColorStop(0, 'rgba(210,190,255,0.12)'); g.addColorStop(0.8, 'rgba(160,130,255,0.22)'); g.addColorStop(1, 'rgba(200,180,255,0.55)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, z.r, z.r * 1.05, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(235,225,255,0.9)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, 0, z.r, z.r * 1.05, 0, Math.PI, 0); ctx.stroke();
    // hex shimmer
    ctx.globalAlpha = 0.35 + Math.sin(now / 200) * 0.15;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;
    for (let i = 1; i < 5; i++) {
      ctx.beginPath(); ctx.ellipse(0, 0, z.r * (i / 5), z.r * 1.05, 0, Math.PI, 0); ctx.stroke();
    }
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = 'rgba(200,180,255,0.6)';
    ctx.beginPath(); ctx.ellipse(0, 0, z.r, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawPortalPair(po, now) {
    const ends = po.pend ? [[po.ax, po.ay]] : [[po.ax, po.ay], [po.bx, po.by]];
    for (const [x, y] of ends) {
      ctx.save();
      ctx.translate(x, y - 40);
      ctx.globalAlpha = po.pend ? 0.5 : 0.95;
      const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 38);
      g.addColorStop(0, '#0d0614'); g.addColorStop(0.6, '#3b1a66'); g.addColorStop(1, 'rgba(180,140,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, 26, 40, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#c9a8ff'; ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.ellipse(0, 0, 24 - i * 6, 38 - i * 9, 0, now / 300 + i * 2, now / 300 + i * 2 + 4); ctx.stroke();
      }
      ctx.restore();
    }
    if (!po.pend && Math.hypot(po.ax - po.bx, po.ay - po.by) > 20) {
      ctx.save();
      ctx.globalAlpha = 0.25; ctx.strokeStyle = '#b48cff'; ctx.lineWidth = 2; ctx.setLineDash([6, 10]); ctx.lineDashOffset = -now / 30;
      ctx.beginPath(); ctx.moveTo(po.ax, po.ay - 40); ctx.lineTo(po.bx, po.by - 40); ctx.stroke();
      ctx.restore();
    }
  }

  function drawTentacles(z, now) {
    ctx.save();
    ctx.translate(z.x, z.y);
    ctx.globalAlpha = 0.6;
    const g = ctx.createRadialGradient(0, -2, 6, 0, -2, z.r);
    g.addColorStop(0, 'rgba(20,6,34,0.95)'); g.addColorStop(1, 'rgba(80,30,130,0.15)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, -2, z.r, 20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.95; ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const bx = -z.r * 0.8 + i * z.r * 0.2, h = 30 + ((i * 37) % 25);
      const sway = Math.sin(now / 260 + i * 1.3) * 12;
      ctx.strokeStyle = '#2a1240'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(bx, 0); ctx.quadraticCurveTo(bx + sway, -h * 0.6, bx - sway * 0.6, -h); ctx.stroke();
      ctx.strokeStyle = '#7b3fd6'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx, 0); ctx.quadraticCurveTo(bx + sway, -h * 0.6, bx - sway * 0.6, -h); ctx.stroke();
    }
    ctx.restore();
  }

  function drawRain(z, now) {
    ctx.save();
    ctx.translate(z.x, z.y);
    const top = -260;
    // healing glow on the ground
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#7ee08a';
    ctx.beginPath(); ctx.ellipse(0, -4, z.r, 22, 0, 0, Math.PI * 2); ctx.fill();
    // rain streaks
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#a9dcff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      const rx = ((i * 97) % (z.r * 2)) - z.r;
      const ry = top + ((now / 2.2 + i * 53) % (-top));
      ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 4, ry + 16); ctx.stroke();
    }
    // cloud
    ctx.globalAlpha = 0.92;
    for (let i = -3; i <= 3; i++) R.ell(ctx, i * z.r * 0.28, top + Math.abs(i) * 6, z.r * 0.22, 26, i % 2 ? '#dfe9f5' : '#eef4fb');
    R.ell(ctx, 0, top + 14, z.r * 0.9, 14, '#c9d8ea');
    ctx.restore();
  }

  function drawZones(now) {
    for (const z of zones) {
      if (z.t === 'shield') { drawMagicShield(z, now); continue; }
      if (z.t === 'rain') { drawRain(z, now); continue; }
      if (z.t === 'tentacles') { drawTentacles(z, now); continue; }
      ctx.save();
      ctx.translate(z.x, z.y);
      const g = ctx.createRadialGradient(0, -20, 10, 0, -20, z.r);
      g.addColorStop(0, 'rgba(190,230,255,0.45)'); g.addColorStop(1, 'rgba(120,190,255,0.08)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, -20, z.r, z.r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(200,240,255,0.8)'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]); ctx.lineDashOffset = -now / 40;
      ctx.stroke(); ctx.setLineDash([]);
      for (let i = 0; i < 10; i++) {
        const a = now / 900 + i * 0.63, rr2 = (i * 37 % z.r);
        const fx = Math.cos(a) * rr2, fy = -20 + Math.sin(a * 1.3) * z.r * 0.4;
        R.drawStar(ctx, fx, fy, 4, 'rgba(255,255,255,0.9)');
      }
      ctx.restore();
    }
  }

  function drawProjectiles(now) {
    for (const p of projectiles) {
      const e = (now - p.at) / 1000;
      const x = p.x + p.vx * e, y = p.y + p.vy * e;
      const ang = Math.atan2(p.vy, p.vx);
      ctx.save(); ctx.translate(x, y);
      if (p.t === 'fireball') {
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
        g.addColorStop(0, '#fff6c0'); g.addColorStop(0.4, '#ffb03c'); g.addColorStop(1, 'rgba(255,80,30,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
        if (Math.random() < 0.7) particles.push({ x, y, vx: -p.vx * 0.1 + (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, life: 0.35, max: 0.35, color: '#ff9a3c', size: 5, g: -100, shape: 'circle' });
      } else if (p.t === 'voidbolt') {
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 20);
        g.addColorStop(0, '#0d0614'); g.addColorStop(0.45, '#7b3fd6'); g.addColorStop(1, 'rgba(180,140,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill();
        if (Math.random() < 0.6) particles.push({ x, y, vx: -p.vx * 0.08 + (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, life: 0.4, max: 0.4, color: '#b48cff', size: 3, g: 0, shape: 'circle' });
      } else if (p.t === 'knife') {
        ctx.scale(p.vx < 0 ? -1 : 1, 1);
        ctx.rotate(now / 45);
        ctx.fillStyle = '#e6edf5'; ctx.strokeStyle = '#3a2a2a'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(0, -3.5); ctx.lineTo(0, 3.5); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#d6455f'; ctx.fillRect(-8, -2.5, 8, 5);
      } else if (p.t === 'thorn') {
        ctx.rotate(now / 80);
        R.ell(ctx, 0, 0, 7, 5, '#6fbf4a', '#2f6f2a', 1.5);
        ctx.fillStyle = '#2f6f2a'; for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(6, -2); ctx.lineTo(11, 0); ctx.lineTo(6, 2); ctx.fill(); }
      } else {
        ctx.rotate(ang);
        const pierce = p.t === 'pierce' || p.t === 'headshot';
        if (pierce && p.r) ctx.scale(p.r / 16, p.r / 16);
        if (pierce) {
          const g = ctx.createLinearGradient(-50, 0, 10, 0);
          const c = p.t === 'headshot' ? '255,110,100' : '160,220,255';
          g.addColorStop(0, `rgba(${c},0)`); g.addColorStop(1, `rgba(${c},0.85)`);
          ctx.fillStyle = g; ctx.fillRect(-50, -5, 60, 10);
        }
        ctx.strokeStyle = '#7a4b2a'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(12, 0); ctx.stroke();
        ctx.fillStyle = pierce ? '#bfe9ff' : '#d8dee8';
        ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(10, -4); ctx.lineTo(10, 4); ctx.fill();
        ctx.fillStyle = '#e8505b';
        ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(-24, -5); ctx.lineTo(-14, 0); ctx.lineTo(-24, 5); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawEffects(now) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      const k = (now - e.born) / e.dur;
      if (k >= 1) { effects.splice(i, 1); continue; }
      ctx.save();
      switch (e.t) {
        case 'slash': {
          const rogue = e.c === 'rogue', paladin = e.c === 'paladin', beyonder = e.c === 'beyonder';
          ctx.translate(e.x + e.f * (rogue ? 26 : 34), e.y - 34);
          ctx.scale(e.f, 1);
          const r = rogue ? (e.big ? 48 : 34) : paladin && e.big ? 62 : 52;
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = rogue ? (e.big ? '#ff5e7a' : '#ffd1dc') : paladin ? '#fff6c8' : beyonder ? '#d9c4ff' : '#ffffff';
          ctx.lineWidth = rogue ? 5 : paladin && e.big ? 13 : 9; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.arc(0, 0, r, -1.6 + k * 0.6, 0.9 + k * 0.6); ctx.stroke();
          ctx.strokeStyle = rogue ? '#d6455f' : paladin ? '#ffc93c' : beyonder ? '#7b3fd6' : '#9ad7ff'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(0, 0, r - 7, -1.4 + k * 0.6, 0.8 + k * 0.6); ctx.stroke();
          break;
        }
        case 'bash':
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 5;
          ctx.beginPath(); ctx.arc(e.x, e.y, 18 + k * 40, 0, Math.PI * 2); ctx.stroke(); break;
        case 'whirl':
          ctx.translate(e.x, e.y); ctx.rotate(k * Math.PI * 3);
          ctx.globalAlpha = 1 - k; ctx.lineWidth = 7; ctx.lineCap = 'round';
          for (let j = 0; j < 3; j++) { ctx.strokeStyle = j % 2 ? '#9ad7ff' : '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, 70 + j * 30, j * 2.1, j * 2.1 + 1.8); ctx.stroke(); }
          break;
        case 'shield':
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.ellipse(e.x, e.y - 32, 30 + k * 30, 38 + k * 30, 0, 0, Math.PI * 2); ctx.stroke(); break;
        case 'explode': {
          ctx.globalAlpha = 1 - k;
          const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 30 + k * 60);
          g.addColorStop(0, 'rgba(255,250,200,0.9)'); g.addColorStop(0.5, 'rgba(255,150,40,0.7)'); g.addColorStop(1, 'rgba(255,80,30,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(e.x, e.y, 30 + k * 60, 0, Math.PI * 2); ctx.fill(); break;
        }
        case 'lightning': {
          ctx.globalAlpha = k < 0.5 ? 1 : 2 - 2 * k;
          let seed = e.seed + Math.floor(now / 50);
          const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 - 0.5; };
          for (const [w, c] of [[9, 'rgba(150,210,255,0.5)'], [4, '#fff7a8'], [1.5, '#ffffff']]) {
            ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineJoin = 'round';
            ctx.beginPath(); ctx.moveTo(...e.pts[0]);
            for (let j = 1; j < e.pts.length; j++) {
              const [ax, ay] = e.pts[j - 1], [bx, by] = e.pts[j];
              for (let s = 1; s <= 6; s++) ctx.lineTo(ax + (bx - ax) * s / 6 + (s < 6 ? rnd() * 26 : 0), ay + (by - ay) * s / 6 + (s < 6 ? rnd() * 26 : 0));
            }
            ctx.stroke();
          }
          break;
        }
        case 'nova':
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = 'rgba(190,235,255,0.35)'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r * k, e.r * k * 0.7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); break;
        case 'entangle':
          ctx.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
          ctx.strokeStyle = '#3f8f3a'; ctx.lineWidth = 5; ctx.lineCap = 'round';
          for (let j = 0; j < 9; j++) {
            const vx = e.x - e.r * 0.8 + j * e.r * 0.2, h = 40 * Math.min(1, k * 4) * (0.7 + (j % 3) * 0.2);
            ctx.beginPath(); ctx.moveTo(vx, e.y); ctx.quadraticCurveTo(vx + 14 * Math.sin(j), e.y - h * 0.6, vx - 6, e.y - h); ctx.stroke();
            R.ell(ctx, vx - 6, e.y - h, 5, 3, '#86d66a');
          }
          break;
        case 'heal':
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#8af59a'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.ellipse(e.x, e.y - 4, e.r * k, e.r * k * 0.25, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = 'rgba(140,245,154,0.15)'; ctx.fill(); break;
        case 'smite': {
          // golden pillar of light crashing down on the target
          ctx.globalAlpha = k < 0.3 ? 1 : (1 - k) / 0.7;
          const w2 = 34 * (1 - k * 0.6);
          const g = ctx.createLinearGradient(0, e.y - 260, 0, e.y);
          g.addColorStop(0, 'rgba(255,240,170,0)'); g.addColorStop(0.6, 'rgba(255,230,120,0.7)'); g.addColorStop(1, 'rgba(255,255,230,0.95)');
          ctx.fillStyle = g; ctx.fillRect(e.x - w2 / 2, e.y - 260, w2, 260);
          ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.ellipse(e.x, e.y, 20 + k * 70, 6 + k * 14, 0, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'knives': {
          const ease = 1 - (1 - k) * (1 - k);
          ctx.globalAlpha = k < 0.75 ? 1 : (1 - k) / 0.25;
          ctx.strokeStyle = 'rgba(214,69,95,0.5)'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(e.x, e.y, 20 + ease * e.r * 0.9, 0, Math.PI * 2); ctx.stroke();
          for (let j = 0; j < 14; j++) {
            const a = (j / 14) * Math.PI * 2;
            const d = 18 + ease * e.r;
            ctx.save();
            ctx.translate(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d * 0.75);
            ctx.rotate(a);
            ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(-8, 0); ctx.stroke();
            ctx.fillStyle = '#e6edf5'; ctx.strokeStyle = '#3a2a2a'; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-2, -3); ctx.lineTo(-2, 3); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#d6455f'; ctx.fillRect(-8, -2, 6, 4);
            ctx.restore();
          }
          break;
        }
        case 'curse':
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#7b3fd6'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.quadraticCurveTo((e.x1 + e.x2) / 2, Math.min(e.y1, e.y) - 50, e.x, e.y); ctx.stroke();
          break;
        case 'phasedash': {
          ctx.globalAlpha = (1 - k) * 0.85;
          const g = ctx.createLinearGradient(e.x1, 0, e.x2, 0);
          g.addColorStop(0, 'rgba(123,63,214,0)'); g.addColorStop(1, 'rgba(180,140,255,0.9)');
          ctx.fillStyle = g;
          for (let j = 0; j < 3; j++) ctx.fillRect(Math.min(e.x1, e.x2), e.y - 64 + j * 18, Math.abs(e.x2 - e.x1), 5);
          break;
        }
        case 'fairybolt': {
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = e.heal ? '#8af5c8' : '#7fd8ff'; ctx.lineWidth = 4; ctx.lineCap = 'round';
          const mx = (e.x1 + e.x2) / 2, my = Math.min(e.y1, e.y2) - 30;
          ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.quadraticCurveTo(mx, my, e.x2, e.y2); ctx.stroke();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
          break;
        }
        case 'bite':
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
          for (let j = -1; j <= 1; j++) { ctx.beginPath(); ctx.moveTo(e.x - 10 + j * 7, e.y - 10); ctx.lineTo(e.x + j * 7, e.y + 8); ctx.stroke(); }
          break;
        case 'invincible':
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.ellipse(e.x, e.y - 34, 40 + k * 90, 48 + k * 70, 0, 0, Math.PI * 2); ctx.stroke(); break;
        case 'charge': {
          ctx.globalAlpha = (1 - k) * 0.8;
          const g = ctx.createLinearGradient(e.x1, 0, e.x2, 0);
          g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.85)');
          ctx.fillStyle = g;
          for (let j = 0; j < 4; j++) ctx.fillRect(Math.min(e.x1, e.x2), e.y - 70 + j * 16, Math.abs(e.x2 - e.x1), 4);
          break;
        }
        case 'blink':
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#c9a8ff'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.ellipse(e.x, e.y, 14 + k * 40, 30 + k * 30, 0, 0, Math.PI * 2); ctx.stroke(); break;
        case 'block':
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5;
          ctx.beginPath(); ctx.ellipse(e.x, e.y - 34, 40 + k * 20, 46 + k * 20, 0, 0, Math.PI * 2); ctx.stroke(); break;
        case 'cry':
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 5;
          for (let j = 0; j < 3; j++) {
            const rr = Math.max(0, (k - j * 0.15)) * e.r;
            ctx.beginPath(); ctx.ellipse(e.x, e.y, rr, rr * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
          }
          break;
        case 'auraswap':
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = e.color; ctx.lineWidth = 5;
          ctx.beginPath(); ctx.ellipse(e.x, e.y - 4, 30 + k * S.AURA_RADIUS, 8 + k * 26, 0, 0, Math.PI * 2); ctx.stroke(); break;
        case 'vine':
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#3f8f3a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(e.x1, e.y1);
          ctx.quadraticCurveTo((e.x1 + e.x2) / 2, Math.min(e.y1, e.y2) - 40, e.x2, e.y2); ctx.stroke();
          ctx.strokeStyle = '#86d66a'; ctx.lineWidth = 2; ctx.stroke(); break;
        case 'headshot': {
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 3;
          const r = 16 + k * 26;
          ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(e.x - r - 8, e.y); ctx.lineTo(e.x - r + 8, e.y); ctx.moveTo(e.x + r - 8, e.y); ctx.lineTo(e.x + r + 8, e.y);
          ctx.moveTo(e.x, e.y - r - 8); ctx.lineTo(e.x, e.y - r + 8); ctx.moveTo(e.x, e.y + r - 8); ctx.lineTo(e.x, e.y + r + 8); ctx.stroke();
          break;
        }
        case 'burst':
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5;
          ctx.beginPath(); ctx.arc(e.x, e.y, 20 + k * 110, 0, Math.PI * 2); ctx.stroke(); break;
        case 'spirit':
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#9ef2a8'; ctx.lineWidth = 5; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke(); break;
        case 'stomp':
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 8;
          ctx.beginPath(); ctx.ellipse(e.x, e.y, 60 + k * 400, 14 + k * 30, 0, 0, Math.PI * 2); ctx.stroke(); break;
        case 'levelup': {
          ctx.globalAlpha = k < 0.8 ? 1 : (1 - k) / 0.2;
          const g = ctx.createLinearGradient(0, e.y - 200, 0, e.y);
          g.addColorStop(0, 'rgba(255,230,120,0)'); g.addColorStop(1, 'rgba(255,230,120,0.6)');
          ctx.fillStyle = g; ctx.fillRect(e.x - 30, e.y - 200, 60, 200);
          drawLabel(e.x, e.y - 110 - k * 30, 'LEVEL UP!', '#ffe27a');
          break;
        }
      }
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      const s = p.size;
      switch (p.shape) {
        case 'star': R.drawStar(ctx, p.x, p.y, s, p.color); break;
        case 'plus': ctx.fillStyle = p.color; ctx.fillRect(p.x - s / 2, p.y - 1.5, s, 3); ctx.fillRect(p.x - 1.5, p.y - s / 2, 3, s); break;
        case 'leaf': R.ell(ctx, p.x, p.y, s, s * 0.5, p.color); break;
        case 'shard': ctx.fillStyle = p.color; ctx.beginPath(); ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s * 0.5, p.y); ctx.lineTo(p.x, p.y + s); ctx.lineTo(p.x - s * 0.5, p.y); ctx.fill(); break;
        default: ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawFloaters(now) {
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      const k = (now - f.born) / 900;
      if (k >= 1) { floaters.splice(i, 1); continue; }
      const pop = k < 0.12 ? 0.6 + k / 0.12 * 0.6 : 1.2 - Math.min(0.2, (k - 0.12));
      ctx.save();
      ctx.translate(f.x, f.y - k * 50);
      ctx.scale(pop, pop);
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      const size = f.k === 'c' ? 26 : f.k === 'a' ? 16 : 20;
      ctx.font = `800 ${size}px Fredoka, sans-serif`; ctx.textAlign = 'center';
      const colors = { m: ['#ffb03c', '#7a2a00'], c: ['#ff4d6d', '#5a0018'], p: ['#b48cff', '#2a1a4a'], h: ['#6ef08a', '#0d4a1c'], r: ['#7fb2ff', '#0d2a5a'], b: ['#ffe27a', '#7a4a00'], a: ['#ffffff', '#3a2a4a'] };
      const [fill, stroke] = colors[f.k] || colors.m;
      const v = typeof f.v === 'number' ? Math.round(f.v) : f.v; // numbers always show as whole values
      const txt = (f.k === 'h' ? '+' : '') + v + (f.k === 'c' ? '!' : '');
      ctx.lineWidth = 5; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.strokeText(txt, 0, 0);
      ctx.fillStyle = fill; ctx.fillText(txt, 0, 0);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ HUD
  function buildSkillbar(cls) {
    const bar = el.skillbar;
    bar.innerHTML = '';
    S.CLASSES[cls].skills.forEach((sk, i) => {
      const d = document.createElement('div');
      d.className = 'skill';
      d.title = `${sk.name} (${sk.cd}s${sk.cost ? ', ' + sk.cost + ' ' + S.RESOURCES[S.CLASSES[cls].resource].name.toLowerCase() : ''}) — ${sk.desc}`;
      d.innerHTML = `<div class="skill-icon"></div><div class="skill-key"></div><div class="skill-name"></div><div class="skill-cd"></div>`;
      d.querySelector('.skill-icon').textContent = sk.icon;
      d.querySelector('.skill-key').textContent = SKILL_LABELS[i];
      d.querySelector('.skill-name').textContent = sk.name;
      d.addEventListener('mousedown', (e) => { e.preventDefault(); useSkill(i); });
      bar.appendChild(d);
    });
  }

  function buildPassive(cls) {
    const ps = S.CLASSES[cls].passive, box = el['passive-slot'];
    box.innerHTML = '<div class="skill-icon"></div><div class="skill-key">P</div><div class="skill-name"></div><div class="skill-cd"></div>';
    box.querySelector('.skill-icon').textContent = ps.icon;
    box.querySelector('.skill-name').textContent = ps.name;
    box.title = `Passive — ${ps.name}: ${ps.desc}`;
    box.classList.remove('active');
  }
  function updateBeyonderSlots() {
    if (me.cls !== 'beyonder' || el.skillbar.dataset.form === me.form) return;
    el.skillbar.dataset.form = me.form;
    for (let i = 0; i < 4; i++) {
      const sk = S.skillDef(me.cls, me.form, i), slotEl = el.skillbar.children[i];
      slotEl.querySelector('.skill-icon').textContent = sk.icon;
      slotEl.querySelector('.skill-name').textContent = sk.name;
      slotEl.title = `${sk.name} (${sk.cd}s${sk.cost ? ', ' + sk.cost + ' mana' : ''}) — ${sk.desc}`;
    }
    const v = el.skillbar.children[4];
    v.querySelector('.skill-name').textContent = me.form === 'sword' ? 'To Rod' : 'To Sword';
  }

  function updatePassive() {
    const box = el['passive-slot'], cdEl = box.querySelector('.skill-cd');
    box.classList.toggle('active', !!me.pa && me.cls !== 'marksman' && me.cls !== 'druid');
    // marksman: wolf respawn timer · paladin: Invincible cooldown · druid: time to next fairy action (small)
    const showCd = me.pc > 0 && (me.cls === 'marksman' || me.cls === 'paladin');
    const showCount = me.pc > 0 && me.cls === 'beyonder'; // scarabs alive
    cdEl.style.display = showCd || showCount ? 'flex' : 'none';
    if (showCd) { cdEl.style.background = 'rgba(20,10,40,0.6)'; cdEl.textContent = me.pc; }
    if (showCount) { cdEl.style.background = 'transparent'; cdEl.textContent = '×' + me.pc; }
  }

  function updateHud(now) {
    if (!me || !myInfo) return;
    el['hp-fill'].style.width = `${Math.max(0, (me.hp / me.maxHp) * 100)}%`;
    el['hp-text'].textContent = `${Math.ceil(me.hp)} / ${me.maxHp}`;
    if (me.rm) {
      el['res-fill'].style.width = `${Math.max(0, (me.rs / me.rm) * 100)}%`;
      el['res-text'].textContent = `${Math.max(0, Math.floor(me.rs))} / ${me.rm} ${S.RESOURCES[S.CLASSES[me.cls].resource].name}`;
    }
    // dim skills you can't afford right now
    const kids = el.skillbar.children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('nores', (me.rs ?? 0) < S.skillCost(me.cls, me.form, i));
    const children = el.skillbar.children;
    for (let i = 0; i < children.length; i++) {
      const remain = cds[cdIdx(i)] - now;
      const cdEl = children[i].querySelector('.skill-cd');
      if (remain > 0) {
        cdEl.style.display = 'flex';
        cdEl.style.background = `conic-gradient(rgba(20,10,40,0.7) ${(remain / cooldownMs(i)) * 360}deg, rgba(20,10,40,0.15) 0)`;
        cdEl.textContent = remain > 1000 ? Math.ceil(remain / 1000) : '';
      } else cdEl.style.display = 'none';
    }
    updatePaladinSlots();
    updateBeyonderSlots();
    updateBuffs();
    updatePassive();
    if (me.dead) {
      const wait = Math.max(0, S.RESPAWN_SECONDS * 1000 - (now - deadSince));
      el['respawn-btn'].disabled = wait > 0;
      el['respawn-timer'].textContent = wait > 0 ? `Respawn in ${Math.ceil(wait / 1000)}…` : 'Ready to respawn';
    }
    el['boss-timer'].textContent = bossCountdown > 0 && bossCountdown < 100000
      ? `👑 King Slime in ${Math.floor(bossCountdown / 60)}:${String(bossCountdown % 60).padStart(2, '0')}` : (bossCountdown === 0 ? '👑 King Slime is here!' : '');
  }

  // Paladin: Holy Strike glows gold when Divine Strike is ready; Holy Auras shows the active aura.
  function updatePaladinSlots() {
    if (me.cls !== 'paladin') return;
    const [a, z] = el.skillbar.children;
    a.classList.toggle('empowered', !!me.ds);
    a.querySelector('.skill-name').textContent = me.ds ? 'Divine Strike' : 'Holy Strike';
    const aura = S.AURAS[me.au >= 0 ? me.au : 0];
    if (z.dataset.aura !== aura.key) {
      z.dataset.aura = aura.key;
      z.querySelector('.skill-icon').textContent = aura.icon;
      z.querySelector('.skill-name').textContent = aura.name.replace('Aura of ', '');
      z.title = `Holy Auras (3s) — now: ${aura.name}. ${aura.desc} Press to switch.`;
    }
  }

  let lastBuffKey = '';
  function updateBuffs() {
    const key = String(me.bf || 0) + (me.bl || 0);
    if (key === lastBuffKey) return;
    lastBuffKey = key;
    const box = el['hud-buffs'];
    box.innerHTML = '';
    for (const a of S.AURAS) {
      if (!(me.bf & S.AURA_BITS[a.key])) continue;
      const b = document.createElement('span');
      b.className = 'buff';
      b.textContent = a.icon;
      b.title = `${a.name}: ${a.desc}`;
      box.appendChild(b);
    }
    if (me.bl > 0) {
      const b = document.createElement('span');
      b.className = 'buff';
      b.textContent = `🔆${me.bl}`;
      b.title = `Divine Bulwark: blocks the next ${me.bl} hit(s)`;
      box.appendChild(b);
    }
  }

  function updateStatsHud() {
    if (!myInfo) return;
    el['hud-name'].textContent = myInfo.name;
    el['hud-level'].textContent = `Lv.${myInfo.level} ${S.CLASSES[myInfo.cls].name}`;
    const span = myInfo.xpLevelEnd - myInfo.xpLevelStart;
    const into = myInfo.xp - myInfo.xpLevelStart;
    el['xp-fill'].style.width = `${Math.min(100, (into / span) * 100)}%`;
    el['xp-text'].textContent = myInfo.level >= S.MAX_LEVEL ? 'MAX' : `${into} / ${span} XP`;
    el['stat-score'].textContent = myInfo.score.toLocaleString();
    el['stat-kills'].textContent = myInfo.kills;
    el['stat-assists'].textContent = myInfo.assists;
  }

  let lastListUpdate = 0;
  function updateOnlineList(list) {
    const now = performance.now();
    if (now - lastListUpdate < 500) return;
    lastListUpdate = now;
    el['stat-online'].textContent = `${list.length}/${S.MAX_PLAYERS}`;
    const sorted = [...list].sort((a, b) => b.sc - a.sc);
    el['online-list'].innerHTML = '';
    for (const p of sorted) {
      const row = document.createElement('div');
      row.className = 'online-row' + (p.id === selfId ? ' me' : '');
      const name = document.createElement('span');
      name.textContent = `${S.CLASSES[p.c].skills[0].icon} ${p.n}${p.ai ? ' 🤖' : ''}`;
      if (p.ai) name.title = 'AI companion: mention its name in chat to give it orders';
      const lv = document.createElement('span'); lv.className = 'muted'; lv.textContent = `Lv.${p.l}`;
      const sc = document.createElement('span'); sc.className = 'score'; sc.textContent = p.sc.toLocaleString();
      row.append(name, lv, sc);
      el['online-list'].appendChild(row);
    }
  }

  function drawPortrait() {
    const c = el['hud-portrait'], pc = c.getContext('2d');
    pc.clearRect(0, 0, c.width, c.height);
    pc.save(); pc.translate(c.width / 2, c.height - 4); pc.scale(1.05, 1.05);
    R.drawChibi(pc, { cls: myInfo.cls, hair: myInfo.hair, facing: 1, t: 0, atk: -1 });
    pc.restore();
  }

  let chatUnread = 0;
  function chatCollapsed() { return document.getElementById('chat-panel').classList.contains('collapsed'); }
  function setChatCollapsed(collapsed) {
    document.getElementById('chat-panel').classList.toggle('collapsed', collapsed);
    try { localStorage.setItem('cr_chat_collapsed', collapsed ? '1' : '0'); } catch (_) { /* ignore */ }
    if (!collapsed) {
      chatUnread = 0;
      document.getElementById('chat-unread').classList.add('hidden');
      el['chat-log'].scrollTop = el['chat-log'].scrollHeight;
    }
  }
  (function initChatToggle() {
    const btn = document.getElementById('chat-toggle');
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus off the button so Space still jumps
    btn.addEventListener('click', () => setChatCollapsed(!chatCollapsed()));
    let saved = null;
    try { saved = localStorage.getItem('cr_chat_collapsed'); } catch (_) { /* ignore */ }
    if (saved === '1') document.getElementById('chat-panel').classList.add('collapsed');
  })();

  function addChat(name, text) {
    if (chatCollapsed() && name) {
      chatUnread++;
      const badge = document.getElementById('chat-unread');
      badge.textContent = chatUnread > 99 ? '99+' : chatUnread;
      badge.classList.remove('hidden');
    }
    const line = document.createElement('div');
    line.className = name ? 'chat-line' : 'chat-line sys';
    if (name) { const b = document.createElement('b'); b.textContent = name + ': '; line.appendChild(b); }
    line.appendChild(document.createTextNode(text));
    el['chat-log'].appendChild(line);
    while (el['chat-log'].children.length > 60) el['chat-log'].firstChild.remove();
    el['chat-log'].scrollTop = el['chat-log'].scrollHeight;
  }

  function toast(text, kind) {
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = text;
    el.toasts.appendChild(t);
    while (el.toasts.children.length > 5) el.toasts.firstChild.remove();
    setTimeout(() => t.classList.add('fade'), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  let bannerTimer = 0;
  function showBanner(text, kind) {
    const b = el.banner;
    b.textContent = text;
    b.className = 'banner show ' + (kind || '');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { b.className = 'banner ' + (kind || ''); }, 2800);
  }

  function respawn() { if (socket) socket.emit('respawn'); }

  window.ChibiGame = { start, stop, respawn, debugSelf: () => me && { x: me.x, y: me.y, climb: !!me.climb, onGround: me.onGround } };
})();
