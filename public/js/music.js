// Background music: loops the track in public/audio (TRACK_URL below). If that file is missing or can't be
// decoded, it falls back to an original town theme synthesized live with the Web Audio API
// (flute lead, marimba arpeggios, plucked bass, soft pad and light percussion).
// Also owns the shared audio graph (sound effects plug into it) and the volume / mute settings.
(function () {
  const BPM = 112;
  const EIGHTH = 60 / BPM / 2;
  const LOOKAHEAD_S = 0.25;
  const STORE_KEY = 'cr_music';

  // 16 bars, 8 eighth-note slots each. A note starts a slot, '-' holds it, '.' is a rest.
  const CHORDS = ['F', 'Dm', 'Bb', 'C', 'F', 'Am', 'Bb', 'C', 'Bb', 'C', 'Am', 'Dm', 'Gm', 'C', 'F', 'F'];
  const MELODY = [
    'C5 - A4 C5 F5 - E5 D5', 'C5 - A4 - D5 - . .', 'D5 - Bb4 D5 F5 - E5 D5', 'C5 - - - G4 - . .',
    'A4 C5 F5 - E5 F5 G5 -', 'E5 - C5 - A4 - C5 -', 'D5 C5 Bb4 - A4 Bb4 C5 -', 'G4 - - - . . C5 .',
    'D5 - F5 - D5 C5 Bb4 -', 'C5 - E5 - G5 - E5 -', 'A5 - G5 E5 C5 - E5 -', 'F5 - E5 D5 A4 - - -',
    'Bb4 - D5 - G5 - F5 E5', 'E5 - D5 - C5 - Bb4 -', 'A4 C5 F5 A5 G5 - F5 -', 'F5 - - - . . . .',
  ].map((bar) => bar.split(' '));
  const CHORD_DEFS = { F: [53, 'maj'], Dm: [50, 'min'], Bb: [46, 'maj'], C: [48, 'maj'], Am: [45, 'min'], Gm: [43, 'min'] };
  const ARP = [0, 2, 4, 5, 6, 4, 2, 1]; // indexes into the chord's tones, rising and falling

  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = (n) => {
    const m = n.match(/^([A-G])(b|#)?(\d)$/);
    return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0);
  };
  const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const chordTones = (name) => {
    const [root, q] = CHORD_DEFS[name];
    const third = q === 'maj' ? 4 : 3;
    return [root, root + 7, root + 12, root + 12 + third, root + 19, root + 24, root + 24 + third];
  };

  let ctx = null, out = null, master = null, sfx = null, wet = null, noise = null;
  let timer = null, playing = false, nextTime = 0, step = 0;
  let settings = { volume: 0.5, muted: false };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(STORE_KEY)) || {}); } catch (_) { /* ignore */ }
  const listeners = [];

  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (_) { /* ignore */ } }
  function level() { return settings.muted ? 0 : settings.volume; }
  function applyVolume() { if (out) out.gain.setTargetAtTime(level(), ctx.currentTime, 0.05); }
  function notify() { for (const fn of listeners) fn(settings); }

  function setup() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    out = ctx.createGain(); // player volume, shared by music and effects
    out.gain.value = level();
    out.connect(ctx.destination);
    master = ctx.createGain(); // music bus
    master.gain.value = 0.35;
    master.connect(out);
    sfx = ctx.createGain(); // sound effects bus
    sfx.gain.value = 0.6;
    sfx.connect(out);
    // small hall reverb from a decaying noise impulse
    const len = ctx.sampleRate * 1.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    const verb = ctx.createConvolver();
    verb.buffer = ir;
    wet = ctx.createGain();
    wet.gain.value = 0.28;
    wet.connect(verb).connect(master);
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return true;
  }

  // one enveloped voice routed to the dry and reverb buses
  function voice(type, f, t, dur, peak, attack, release, send = 0.5) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0, t + Math.max(attack, dur), release);
    o.connect(g);
    g.connect(master);
    if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s).connect(wet); }
    o.start(t);
    o.stop(t + dur + release * 6);
    return o;
  }

  function flute(m, t, dur) {
    const f = freq(m);
    const o = voice('triangle', f, t, dur, 0.22, 0.04, 0.12, 0.6);
    voice('sine', f * 2, t, dur, 0.05, 0.05, 0.1, 0.6);
    if (dur > EIGHTH * 1.5) { // gentle vibrato on held notes
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(f * 0.006, t + 0.25);
      lfo.connect(depth).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.6);
    }
  }
  function marimba(m, t) {
    voice('sine', freq(m), t, 0.01, 0.12, 0.004, 0.11, 0.35);
    voice('sine', freq(m) * 4, t, 0.005, 0.025, 0.002, 0.03, 0.2);
  }
  function bass(m, t) { voice('triangle', freq(m), t, 0.05, 0.3, 0.008, 0.16, 0.1); }
  function pad(tones, t, dur) {
    for (const m of [tones[2], tones[3], tones[4]]) {
      voice('sine', freq(m), t, dur, 0.035, 0.3, 0.4, 0.8);
      voice('sine', freq(m) * 1.003, t, dur, 0.025, 0.3, 0.4, 0.8);
    }
  }
  function shaker(t, accent) {
    const src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise;
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    g.gain.setValueAtTime(accent ? 0.06 : 0.035, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(hp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.1);
  }
  function kick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.2);
  }

  function playStep(i, t) {
    const bar = Math.floor(i / 8) % CHORDS.length, slot = i % 8;
    const tones = chordTones(CHORDS[bar]);
    const mel = MELODY[bar];
    const n = mel[slot];
    if (n !== '-' && n !== '.') {
      let len = 1;
      while (slot + len < 8 && mel[slot + len] === '-') len++;
      flute(midi(n), t, len * EIGHTH * 0.92);
    }
    marimba(tones[ARP[slot]] + 12, t);
    if (slot === 0) { bass(tones[0] - 12, t); pad(tones, t, EIGHTH * 7.5); }
    if (slot === 4) bass(tones[1] - 12, t);
    if (slot === 7) bass(tones[0] - 12, t);
    if (slot === 0 || slot === 4) kick(t);
    if (slot % 2 === 1) shaker(t, slot === 3 || slot === 7);
  }

  function schedule() {
    while (nextTime < ctx.currentTime + LOOKAHEAD_S) {
      playStep(step, nextTime);
      step++;
      nextTime += EIGHTH;
    }
  }

  // Background track: an audio file that loops on the music bus. The synthesized theme above only plays
  // if the file can't be loaded or decoded.
  const TRACK_URL = 'audio/floral-life.mp3';
  const TRACK_GAIN = 0.9; // relative to the music bus, so it sits under the sound effects
  let track = null;    // 'loading' | AudioBufferSourceNode | 'failed'

  function startTrack() {
    if (track) return;
    track = 'loading';
    fetch(TRACK_URL)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((data) => ctx.decodeAudioData(data))
      .then((buf) => {
        const src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = buf;
        src.loop = true;
        g.gain.value = TRACK_GAIN;
        src.connect(g).connect(master);
        src.start();
        track = src;
      })
      .catch(() => { // no file: fall back to the synthesized theme
        track = 'failed';
        if (playing && !timer) { step = 0; nextTime = ctx.currentTime + 0.1; timer = setInterval(schedule, 25); }
      });
  }

  function start() {
    if (playing) return;
    if (!ctx && !setup()) return;
    if (window.Sfx) window.Sfx.attach(ctx, sfx);
    playing = true;
    ctx.resume(); // the track keeps its place while stopped and carries on from there
    if (track === 'failed') { step = 0; nextTime = ctx.currentTime + 0.1; timer = setInterval(schedule, 25); }
    else startTrack();
  }

  function stop() {
    if (!playing) return;
    playing = false;
    clearInterval(timer);
    timer = null;
    ctx.suspend();
  }

  // browsers only allow audio after a user gesture; retry on the next key or click
  function unlock() { if (playing && ctx && ctx.state !== 'running' && !document.hidden) ctx.resume(); }
  window.addEventListener('keydown', unlock);
  window.addEventListener('pointerdown', unlock);
  // background tabs throttle timers, which would garble the timing; pause instead
  document.addEventListener('visibilitychange', () => {
    if (!playing || !ctx) return;
    if (document.hidden) ctx.suspend();
    else { nextTime = ctx.currentTime + 0.1; ctx.resume(); }
  });

  window.Music = {
    start, stop,
    get settings() { return { ...settings }; },
    setVolume(v) { settings.volume = Math.max(0, Math.min(1, v)); if (settings.volume > 0) settings.muted = false; applyVolume(); save(); notify(); },
    toggleMute() { settings.muted = !settings.muted; applyVolume(); save(); notify(); },
    onChange(fn) { listeners.push(fn); fn(settings); },
  };
})();
