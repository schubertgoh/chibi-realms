// Menus: login/register, character select & creation, leaderboard, launching the game.
(function () {
  const S = window.Shared;
  const R = window.Render;
  const $ = (id) => document.getElementById(id);
  let token = localStorage.getItem('cr_token');
  let authMode = 'login';
  let account = null;
  let createState = { cls: 'fighter', hair: S.HAIR_COLORS[0] };
  let menuAnim = 0;

  const SERVER_DOWN = 'Can\'t reach the game server. Make sure it is running (npm start) and open http://localhost:3000.';

  async function api(path, opts = {}) {
    if (location.protocol === 'file:') throw new Error(SERVER_DOWN);
    let res;
    try {
      res = await fetch(path, {
        method: opts.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (_) {
      throw new Error(SERVER_DOWN);
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/login') {
      setToken(null);
      show('auth');
      $('auth-error').textContent = 'Your session expired. Please log in again.';
    }
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }
  function setToken(t) {
    token = t;
    if (t) localStorage.setItem('cr_token', t); else localStorage.removeItem('cr_token');
  }

  function show(name) {
    for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
    $(`screen-${name}`).classList.remove('hidden');
    $('menu-bg').style.display = name === 'game' ? 'none' : 'block';
    if (name === 'chars') loadChars();
    if (name === 'create') renderCreate();
  }

  function modal(text, actions) {
    $('modal-text').textContent = text;
    const box = $('modal-actions');
    box.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.cls || '');
      b.textContent = a.label;
      b.onclick = () => { $('modal').classList.add('hidden'); a.onClick && a.onClick(); };
      box.appendChild(b);
    }
    $('modal').classList.remove('hidden');
  }

  // ------------------------------------------------ auth
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      authMode = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('auth-submit').textContent = authMode === 'login' ? 'Log In' : 'Create Account';
      $('auth-pass').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
      $('auth-error').textContent = '';
    });
  }
  $('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('auth-error').textContent = '';
    $('auth-submit').disabled = true;
    try {
      const data = await api(authMode === 'login' ? '/api/login' : '/api/register', {
        method: 'POST', body: { username: $('auth-user').value.trim(), password: $('auth-pass').value },
      });
      setToken(data.token);
      $('auth-pass').value = '';
      show('chars');
    } catch (err) {
      $('auth-error').textContent = err.message;
    } finally {
      $('auth-submit').disabled = false;
    }
  });
  $('logout-btn').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
    setToken(null);
    show('auth');
  });

  // ------------------------------------------------ characters
  function fmtTime(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  }
  function charPreview(cls, hair, size = 96) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.translate(size / 2, size - 8);
    const s = size / 90;
    ctx.scale(s, s);
    R.drawChibi(ctx, { cls, hair, facing: 1, t: 0, atk: -1 });
    return c;
  }

  async function loadChars() {
    $('char-error').textContent = '';
    try {
      account = await api('/api/me');
    } catch (err) {
      $('char-error').textContent = err.message;
      return;
    }
    $('account-name').textContent = `👤 ${account.username}`;
    const list = $('char-list');
    list.innerHTML = '';
    if (!account.characters.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No heroes yet — create your first one!';
      list.appendChild(empty);
    }
    for (const c of account.characters) {
      const row = document.createElement('div');
      row.className = 'char-row';
      const pv = charPreview(c.cls, c.hair);
      pv.className = 'char-portrait';
      const info = document.createElement('div');
      info.className = 'char-info';
      const span = c.xpLevelEnd - c.xpLevelStart;
      info.innerHTML = `
        <div class="char-title"><b></b> <span class="pill cls"></span> ${c.online ? '<span class="pill online">In game</span>' : ''}</div>
        <div class="char-level">Level ${c.level}</div>
        <div class="bar xp small"><div style="width:${Math.min(100, ((c.xp - c.xpLevelStart) / span) * 100)}%"></div><span>${c.xp - c.xpLevelStart} / ${span} XP</span></div>
        <div class="char-stats">
          <span>⭐ <b>${c.score.toLocaleString()}</b> score</span>
          <span>⚔️ <b>${c.kills}</b> kills</span>
          <span>🤝 <b>${c.assists}</b> assists</span>
          <span>👑 <b>${c.bossKills}</b> bosses</span>
          <span>💀 <b>${c.deaths}</b> deaths</span>
          <span>⏱️ <b>${fmtTime(c.playSeconds)}</b> played</span>
        </div>`;
      info.querySelector('.char-title b').textContent = c.name;
      const clsPill = info.querySelector('.pill.cls');
      clsPill.textContent = S.CLASSES[c.cls].name;
      clsPill.style.background = S.CLASSES[c.cls].color;
      const actions = document.createElement('div');
      actions.className = 'char-actions';
      const play = document.createElement('button');
      play.className = 'btn primary';
      play.textContent = '▶ Play';
      play.onclick = () => enterGame(c);
      const del = document.createElement('button');
      del.className = 'btn ghost danger';
      del.textContent = 'Delete';
      del.onclick = () => modal(`Delete ${c.name} forever? Their score and progress will be lost.`, [
        { label: 'Cancel' },
        { label: 'Delete', cls: 'danger', onClick: async () => {
          try { await api(`/api/characters/${c.id}`, { method: 'DELETE' }); loadChars(); }
          catch (err) { $('char-error').textContent = err.message; }
        } },
      ]);
      actions.append(play, del);
      row.append(pv, info, actions);
      list.appendChild(row);
    }
    $('new-char-btn').disabled = account.characters.length >= account.maxCharacters;
    loadLeaderboard();
  }

  async function loadLeaderboard() {
    try {
      const data = await api('/api/leaderboard');
      const lb = $('leaderboard');
      lb.innerHTML = '';
      if (!data.leaders.length) lb.innerHTML = '<div class="empty">No scores yet. Be the first!</div>';
      data.leaders.forEach((c, i) => {
        const row = document.createElement('div');
        row.className = 'lb-row';
        const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = ['🥇', '🥈', '🥉'][i] || `#${i + 1}`;
        const name = document.createElement('span'); name.className = 'lb-name'; name.textContent = c.name;
        const meta = document.createElement('span'); meta.className = 'muted'; meta.textContent = `Lv.${c.level} ${S.CLASSES[c.class].name}`;
        const score = document.createElement('span'); score.className = 'score'; score.textContent = c.score.toLocaleString();
        row.append(rank, name, meta, score);
        lb.appendChild(row);
      });
      $('online-count').textContent = `${data.online.length}/${data.maxPlayers}`;
      const on = $('online-now');
      on.innerHTML = '';
      if (!data.online.length) on.innerHTML = '<div class="empty">The meadow is quiet… for now.</div>';
      for (const p of data.online) {
        const d = document.createElement('div');
        d.className = 'pill';
        d.textContent = `${p.name} · Lv.${p.level} ${S.CLASSES[p.cls].name}`;
        on.appendChild(d);
      }
    } catch (_) { /* leaderboard is optional */ }
  }

  $('new-char-btn').addEventListener('click', () => show('create'));
  $('create-back').addEventListener('click', () => show('chars'));

  // ------------------------------------------------ create
  function renderCreate() {
    $('create-error').textContent = '';
    const cp = $('class-picker');
    cp.innerHTML = '';
    for (const [key, c] of Object.entries(S.CLASSES)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'class-card' + (createState.cls === key ? ' active' : '');
      b.style.setProperty('--cls', c.color);
      b.appendChild(charPreview(key, createState.hair, 70));
      const n = document.createElement('span'); n.textContent = c.name;
      b.appendChild(n);
      b.onclick = () => { createState.cls = key; renderCreate(); };
      cp.appendChild(b);
    }
    const hp = $('hair-picker');
    hp.innerHTML = '';
    for (const color of S.HAIR_COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (createState.hair === color ? ' active' : '');
      b.style.background = color;
      b.title = color;
      b.onclick = () => { createState.hair = color; renderCreate(); };
      hp.appendChild(b);
    }
    const c = S.CLASSES[createState.cls];
    $('class-desc').innerHTML = '';
    const title = document.createElement('h3'); title.textContent = c.name; title.style.color = c.color;
    const p = document.createElement('p'); p.textContent = c.desc;
    const st = document.createElement('div'); st.className = 'class-statline';
    const res = S.resourceStats(createState.cls, 1);
    st.textContent = `❤️ ${c.hp} HP · ${res.type === 'mana' ? '🔷' : res.type === 'stamina' ? '🟢' : '⚡'} ${res.max} ${S.RESOURCES[res.type].name} · 🛡️ ${Math.round(c.armor * 100)}% armor · 👟 ${c.speed} speed`;
    $('class-desc').append(title, p, st);
    const ul = $('class-skills');
    ul.innerHTML = '';
    if (c.passive) {
      const li = document.createElement('li');
      li.className = 'passive-line';
      li.innerHTML = '<kbd>P</kbd><span class="sk-icon"></span><div><b></b><small></small></div>';
      li.querySelector('.sk-icon').textContent = c.passive.icon;
      li.querySelector('b').textContent = `${c.passive.name} · passive`;
      li.querySelector('small').textContent = c.passive.desc;
      ul.appendChild(li);
    }
    const addSkill = (sk, key, tag) => {
      const li = document.createElement('li');
      li.innerHTML = `<kbd>${key}</kbd><span class="sk-icon"></span><div><b></b><small></small></div>`;
      li.querySelector('.sk-icon').textContent = sk.icon;
      li.querySelector('b').textContent = `${sk.name} · ${sk.cd}s · ${sk.cost ? sk.cost + ' ' + S.RESOURCES[c.resource].name.toLowerCase() : 'free'}${tag ? ' · ' + tag : ''}`;
      li.querySelector('small').textContent = sk.desc;
      ul.appendChild(li);
    };
    c.skills.forEach((sk, i) => {
      addSkill(sk, S.SKILL_LABELS[i], c.altSkills && c.altSkills[i] ? 'rod' : '');
      if (c.altSkills && c.altSkills[i]) addSkill(c.altSkills[i], S.SKILL_LABELS[i], 'sword');
    });
  }

  function animatePreview(ts) {
    const cv = $('create-preview');
    if (!$('screen-create').classList.contains('hidden')) {
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.save();
      ctx.translate(cv.width / 2, cv.height - 26);
      ctx.scale(2.2, 2.2);
      const phase = (ts / 1000) % 3;
      R.drawChibi(ctx, { cls: createState.cls, hair: createState.hair, facing: 1, t: ts / 1000, moving: phase > 1.8, atk: phase < 0.3 ? phase / 0.3 : -1, atkSlot: 0 });
      ctx.restore();
    }
    drawMenuBg(ts);
    requestAnimationFrame(animatePreview);
  }

  $('create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('create-error').textContent = '';
    try {
      await api('/api/characters', { method: 'POST', body: { name: $('create-name').value.trim(), cls: createState.cls, hair: createState.hair } });
      $('create-name').value = '';
      show('chars');
    } catch (err) {
      $('create-error').textContent = err.message;
    }
  });

  // ------------------------------------------------ game
  function enterGame(c) {
    show('game');
    window.ChibiGame.start({
      token, character: c,
      onExit: (msg) => {
        show('chars');
        if (msg) modal(msg, [{ label: 'OK', cls: 'primary' }]);
      },
    });
  }
  $('leave-btn').addEventListener('click', () => window.ChibiGame.stop());
  $('respawn-btn').addEventListener('click', () => window.ChibiGame.respawn());

  // ------------------------------------------------ menu background
  let bg = null;
  function drawMenuBg(ts) {
    const c = $('menu-bg');
    if (c.style.display === 'none') return;
    if (c.width !== innerWidth || c.height !== innerHeight) { c.width = innerWidth; c.height = innerHeight; }
    const ctx = c.getContext('2d');
    if (!bg) bg = { m: R.buildMountains(), h: R.buildHills() };
    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, '#5fb6f2'); g.addColorStop(0.6, '#a8dcfb'); g.addColorStop(1, '#e3f5ff');
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
    const t = ts / 1000;
    for (let i = 0; i < 6; i++) {
      const x = ((i * 330 + t * (8 + i * 2)) % (c.width + 300)) - 150;
      R.drawCloud(ctx, x, 60 + (i * 53) % 200, 0.6 + (i % 3) * 0.25);
    }
    const ox = -((t * 10) % 1600);
    for (let x = ox; x < c.width; x += 1600) ctx.drawImage(bg.m, x, c.height - 560);
    const ox2 = -((t * 25) % 1600);
    for (let x = ox2; x < c.width; x += 1600) ctx.drawImage(bg.h, x, c.height - 400);
    menuAnim = ts;
  }

  // boot
  requestAnimationFrame(animatePreview);
  if (location.protocol === 'file:') {
    show('auth');
    $('auth-error').textContent = SERVER_DOWN;
  } else show(token ? 'chars' : 'auth');
})();
