// Attack sound effects, synthesized with the Web Audio API on the bus music.js provides.
// cast(): the sound of a skill going off (whoosh, twang, zap...), for you and for other players.
// impact(): what happens when it lands (hits, crits, explosions, the boss stomp, monsters popping),
// plus the big moments: a jingle when anyone levels up and a victory fanfare when the King Slime falls.
// Sounds from other players fade with distance and pan left/right.
(function () {
  const MAX_VOICES = 28;
  const MIN_GAP_MS = 45; // the same sound can't retrigger faster than this

  // skill slot (A Z X C V) -> sound, per class; beyonderSword is the Beyonder's sword form
  const CAST = {
    fighter: ['swing', 'dash', 'heavy', 'spin', 'buff'],
    mage: ['fire', 'zap', 'ice', 'blink', 'buff'],
    rogue: ['swing', 'throw', 'blink', 'dash', 'fan'],
    marksman: ['bow', 'multi', 'root', 'dash', 'bow'],
    druid: ['magic', 'root', 'root', 'buff', 'buff'],
    paladin: ['holy', 'buff', 'buff', 'buff', 'buff'],
    beyonder: ['magic', 'magic', 'root', 'blink', 'blink'],
    beyonderSword: ['swing', 'dash', 'root', 'buff', 'blink'],
  };

  let ctx = null, bus = null, noise = null, voices = 0;
  let lx = 0, ly = 0;
  const last = {};

  function attach(c, b) {
    if (ctx === c) return;
    ctx = c; bus = b;
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  // ---------------- building blocks
  // output for one sound: distance fade + stereo pan, and a voice count so a big fight can't pile up hundreds
  function outFor(pos, life) {
    let gain = 1, pan = 0;
    if (pos) {
      const d = Math.hypot(pos.x - lx, (pos.y - ly) * 1.3);
      gain = Math.max(0, Math.min(1, 1 - (d - 250) / 900));
      pan = Math.max(-0.8, Math.min(0.8, (pos.x - lx) / 700));
    }
    if (gain < 0.04 || voices >= MAX_VOICES) return null;
    voices++;
    setTimeout(() => { voices--; }, life * 1000 + 50);
    const g = ctx.createGain();
    g.gain.value = gain;
    if (ctx.createStereoPanner && pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(bus);
    } else g.connect(bus);
    return g;
  }

  // filtered noise with a cutoff sweep: whooshes, impacts, crackle
  function hiss(out, t, dur, type, f0, f1, peak, q = 1) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // an oscillator with a pitch sweep and a fast decay
  function tone(out, t, dur, type, f0, f1, peak) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // brass-like note: a sawtooth whose filter opens on the attack, with a little vibrato on long notes
  function brass(out, t, dur, f, peak) {
    const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = f;
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(f * 1.5, t);
    lp.frequency.exponentialRampToValueAtTime(f * 6, t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(f * 3, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.03);
    g.gain.setValueAtTime(peak, t + Math.max(0.03, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    if (dur > 0.4) {
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = 5;
      depth.gain.value = f * 0.008;
      lfo.connect(depth).connect(o.frequency);
      lfo.start(t + 0.2);
      lfo.stop(t + dur + 0.3);
    }
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.3);
  }

  const v = (x) => x * (0.92 + Math.random() * 0.16); // slight pitch variety so repeats don't sound robotic

  // ---------------- sounds: [duration in seconds, play(out, t)]
  const SOUNDS = {
    swing: [0.16, (o, t) => { hiss(o, t, 0.15, 'bandpass', v(700), v(3200), 0.5, 1.4); }],
    heavy: [0.3, (o, t) => { hiss(o, t, 0.12, 'bandpass', 500, 2000, 0.45, 1.2); tone(o, t + 0.06, 0.22, 'sine', 150, 50, 0.6); hiss(o, t + 0.06, 0.12, 'lowpass', 1200, 200, 0.4); }],
    spin: [0.4, (o, t) => { for (let i = 0; i < 3; i++) hiss(o, t + i * 0.1, 0.13, 'bandpass', v(900), v(2800), 0.4, 1.4); }],
    dash: [0.3, (o, t) => { hiss(o, t, 0.28, 'lowpass', 300, 2500, 0.45); }],
    bow: [0.25, (o, t) => { tone(o, t, 0.14, 'triangle', v(330), 180, 0.35); hiss(o, t, 0.03, 'highpass', 3000, 5000, 0.3); hiss(o, t + 0.02, 0.18, 'bandpass', 4000, 1500, 0.2, 2); }],
    multi: [0.35, (o, t) => { tone(o, t, 0.14, 'triangle', 330, 180, 0.35); for (let i = 0; i < 3; i++) hiss(o, t + 0.02 + i * 0.05, 0.15, 'bandpass', v(4200), 1500, 0.18, 2); }],
    throw: [0.15, (o, t) => { hiss(o, t, 0.1, 'highpass', v(2500), v(6000), 0.35); }],
    fan: [0.35, (o, t) => { for (let i = 0; i < 4; i++) hiss(o, t + i * 0.05, 0.1, 'highpass', v(2500), v(6000), 0.25); }],
    fire: [0.4, (o, t) => { hiss(o, t, 0.35, 'lowpass', 400, 2200, 0.5); tone(o, t, 0.25, 'sine', 180, 420, 0.25); }],
    zap: [0.3, (o, t) => { hiss(o, t, 0.25, 'bandpass', 5000, 2000, 0.4, 3); tone(o, t, 0.2, 'sawtooth', v(1400), 300, 0.12); tone(o, t + 0.04, 0.15, 'square', v(900), 200, 0.06); }],
    ice: [0.5, (o, t) => { [1760, 2349, 2794, 3520].forEach((f, i) => tone(o, t + i * 0.035, 0.35, 'sine', f, f * 0.98, 0.14)); hiss(o, t, 0.3, 'highpass', 6000, 3000, 0.15); }],
    magic: [0.25, (o, t) => { tone(o, t, 0.18, 'sine', v(1100), 280, 0.35); tone(o, t, 0.18, 'triangle', v(550), 140, 0.15); }],
    holy: [0.5, (o, t) => { hiss(o, t, 0.14, 'bandpass', 800, 3000, 0.4, 1.4); tone(o, t + 0.05, 0.4, 'sine', 1320, 1318, 0.18); tone(o, t + 0.05, 0.4, 'sine', 1980, 1975, 0.08); }],
    blink: [0.25, (o, t) => { tone(o, t, 0.18, 'sine', 300, 1800, 0.25); hiss(o, t, 0.15, 'highpass', 2000, 8000, 0.15); }],
    buff: [0.45, (o, t) => { [1047, 1319, 1568].forEach((f, i) => tone(o, t + i * 0.07, 0.25, 'triangle', f, f, 0.18)); }],
    root: [0.45, (o, t) => { tone(o, t, 0.4, 'sine', 110, 55, 0.5); hiss(o, t, 0.35, 'lowpass', 600, 150, 0.4); }],
    // impacts
    hit: [0.12, (o, t) => { hiss(o, t, 0.05, 'lowpass', v(2500), 600, 0.45); tone(o, t, 0.09, 'sine', v(200), 90, 0.4); }],
    crit: [0.2, (o, t) => { hiss(o, t, 0.06, 'highpass', 2000, 5000, 0.4); hiss(o, t, 0.08, 'lowpass', 3000, 600, 0.55); tone(o, t, 0.15, 'square', v(320), 120, 0.15); }],
    hurt: [0.2, (o, t) => { tone(o, t, 0.18, 'sine', 140, 55, 0.6); hiss(o, t, 0.1, 'lowpass', 900, 200, 0.4); }],
    block: [0.3, (o, t) => { tone(o, t, 0.25, 'square', 880, 860, 0.1); tone(o, t, 0.25, 'sine', 1320, 1300, 0.15); hiss(o, t, 0.04, 'highpass', 3000, 6000, 0.3); }],
    boom: [0.6, (o, t) => { hiss(o, t, 0.55, 'lowpass', 1800, 120, 0.7); tone(o, t, 0.35, 'sine', 90, 35, 0.7); }],
    stomp: [0.8, (o, t) => { tone(o, t, 0.7, 'sine', 75, 28, 0.9); hiss(o, t, 0.6, 'lowpass', 700, 80, 0.7); }],
    pop: [0.15, (o, t) => { tone(o, t, 0.12, 'sine', v(500), v(1300), 0.35); }],
    // big moments
    levelup: [1.4, (o, t) => {
      [523, 659, 784, 1047, 1319].forEach((f, i) => { tone(o, t + i * 0.07, 0.3, 'triangle', f, f, 0.22); tone(o, t + i * 0.07, 0.3, 'sine', f * 2, f * 2, 0.06); });
      [1047, 1319, 1568, 2093].forEach((f) => tone(o, t + 0.38, 0.9, 'sine', f, f * 1.002, 0.09)); // sparkling held chord
      hiss(o, t + 0.35, 0.8, 'highpass', 7000, 4000, 0.08);
    }],
    victory: [3, (o, t) => {
      const b = 0.13; // "da-da-da DAAA, da-DAAA!" in C major
      [[0, 392, 1], [1, 392, 1], [2, 392, 1], [3, 523, 5], [9, 466, 2], [11, 523, 9]].forEach(([at, f, len]) => {
        brass(o, t + at * b, len * b * 0.9, f, 0.16);
        brass(o, t + at * b, len * b * 0.9, f * 1.5, 0.07); // a fifth above, for a fuller section
      });
      [523, 659, 784, 1047].forEach((f) => tone(o, t + 11 * b, 1.4, 'triangle', f, f, 0.08)); // final chord
      for (let i = 0; i < 6; i++) tone(o, t + 9 * b + i * 0.045, 0.2, 'sine', 95, 60, 0.25 + i * 0.05); // timpani roll
      tone(o, t + 11 * b, 0.9, 'sine', 90, 40, 0.8);
      hiss(o, t + 11 * b, 1.2, 'highpass', 6000, 3000, 0.07); // cymbal shimmer
    }],
  };

  function play(name, pos) {
    if (!ctx || ctx.state !== 'running') return;
    const s = SOUNDS[name];
    if (!s) return;
    const now = performance.now();
    if (now - (last[name] || 0) < MIN_GAP_MS) return;
    last[name] = now;
    const out = outFor(pos, s[0]);
    if (out) s[1](out, ctx.currentTime + 0.005);
  }

  window.Sfx = {
    attach,
    listen(x, y) { lx = x; ly = y; },
    cast(cls, form, slot, pos) {
      const table = cls === 'beyonder' && form === 'sword' ? CAST.beyonderSword : CAST[cls];
      if (table) play(table[slot], pos);
    },
    // server fx events that deserve a sound
    impact(fx) {
      // some effects (e.g. chain lightning) have no single position: play those unpanned at full volume
      const pos = Number.isFinite(fx.x) && Number.isFinite(fx.y) ? { x: fx.x, y: fx.y } : null;
      switch (fx.t) {
        case 'dmg': if (fx.k === 'm') play('hit', pos); else if (fx.k === 'c') play('crit', pos); else if (fx.k === 'p') play('hurt', pos); break;
        case 'explode': case 'trapboom': play('boom', pos); break;
        case 'lightning': play('zap', pos); break;
        case 'stomp': play('stomp', pos); break;
        case 'block': play('block', pos); break;
        case 'death': if (fx.m === 'kingslime') play('victory'); else play('pop', pos); break; // everyone hears the boss fall
        case 'levelup': play('levelup', pos); break;
      }
    },
  };
})();
