// Procedural cute chibi art: characters, monsters, world terrain and parallax backdrop.
(function () {
  const S = window.Shared;
  const SKIN = '#ffe2c6';
  const SKIN_SHADE = '#f6c9a6';
  const OUTLINE = '#3a2a2a';

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function ell(ctx, x, y, rx, ry, fill, stroke, lw) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  // ---------------------------------------------------------------- characters
  const OUTFIT = {
    fighter: { body: '#9fb3cf', trim: '#5b7bb5', belt: '#7a4b2a' },
    mage: { body: '#8a63d2', trim: '#f2c94c', belt: '#5b3c9e' },
    rogue: { body: '#43405e', trim: '#d6455f', belt: '#2a2840' },
    marksman: { body: '#4f9d4a', trim: '#a8743c', belt: '#6b4a26' },
    druid: { body: '#a57a44', trim: '#5fb85a', belt: '#5c3f1d' },
    paladin: { body: '#f0c75a', trim: '#ffffff', belt: '#8a5a2b' },
    beyonder: { body: '#3b2456', trim: '#a86cff', belt: '#1f1430' },
  };

  /**
   * Draw a chibi hero with feet at (0,0).
   * o: { cls, hair, facing, t, moving, air, climbing, atk (0..1 or -1), atkSlot }
   */
  function drawChibi(ctx, o) {
    const cls = o.cls, of = OUTFIT[cls];
    const t = o.t || 0;
    ctx.save();
    ctx.scale(o.facing < 0 ? -1 : 1, 1);
    const walk = o.moving && !o.air && !o.climbing ? Math.sin(t * 14) : 0;
    const bob = o.moving && !o.air ? Math.abs(Math.sin(t * 14)) * -2 : Math.sin(t * 3) * 0.8;
    const atk = o.atk >= 0 ? o.atk : -1;

    // shadow
    if (!o.air && !o.climbing) ell(ctx, 0, 0, 17, 4, 'rgba(0,0,0,0.18)');

    ctx.translate(0, bob);

    if (o.climbing) { drawClimber(ctx, o, of, t); ctx.restore(); return; }

    // back gear
    if (cls === 'marksman') { // quiver
      ctx.save(); ctx.translate(-10, -30); ctx.rotate(-0.4);
      rr(ctx, -4, -14, 9, 22, 3); ctx.fillStyle = '#8a5a2b'; ctx.fill(); ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#e8e2d0'; for (let i = 0; i < 3; i++) { ctx.fillRect(-3 + i * 3, -19, 2, 6); }
      ctx.restore();
    }
    if (cls === 'beyonder') { // drifting void wisps behind the robe
      for (let i = 0; i < 3; i++) {
        const k = ((t * 0.7) + i / 3) % 1;
        ell(ctx, -12 - k * 16, -10 - i * 8 - k * 10, 4 * (1 - k) + 1, 3 * (1 - k) + 1, `rgba(123,63,214,${0.55 * (1 - k)})`);
      }
    }
    if (cls === 'rogue') { // scarf tail
      ctx.fillStyle = of.trim;
      ctx.beginPath(); ctx.moveTo(-6, -32); ctx.quadraticCurveTo(-18, -30 + Math.sin(t * 8) * 3, -24, -24 + Math.sin(t * 8 + 1) * 4);
      ctx.lineTo(-20, -20); ctx.quadraticCurveTo(-14, -26, -4, -27); ctx.fill();
    }
    if (cls === 'paladin') { // cape
      ctx.fillStyle = '#4f78c9'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-8, -32); ctx.quadraticCurveTo(-22, -16 + Math.sin(t * 6) * 2, -20 + Math.sin(t * 6) * 3, -2);
      ctx.lineTo(-6, -6); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    if (cls === 'fighter') drawShield(ctx, -9, -20, atk >= 0 && o.atkSlot === 1);
    if (cls === 'paladin') drawShield(ctx, -9, -20, false, true);

    // legs
    const legC = cls === 'beyonder' ? '#241634' : cls === 'paladin' ? '#c9a24a' : cls === 'fighter' ? '#6c7a92' : cls === 'mage' ? '#4b3480' : cls === 'rogue' ? '#2a2840' : cls === 'druid' ? '#6b4a26' : '#5b4126';
    ctx.fillStyle = legC; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.5;
    const legLift = o.air ? -3 : 0;
    rr(ctx, -8 + walk * 4, -13 + legLift, 7, 13, 3); ctx.fill(); ctx.stroke();
    rr(ctx, 2 - walk * 4, -13 + (o.air ? -1 : 0), 7, 13, 3); ctx.fill(); ctx.stroke();
    // shoes
    ctx.fillStyle = '#5a3a22';
    rr(ctx, -9 + walk * 4, -4 + legLift, 10, 5, 2.5); ctx.fill();
    rr(ctx, 1 - walk * 4, -4 + (o.air ? -1 : 0), 10, 5, 2.5); ctx.fill();

    // body
    const robe = cls === 'mage' || cls === 'druid' || cls === 'beyonder';
    ctx.fillStyle = of.body; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.8;
    if (robe) {
      ctx.beginPath(); ctx.moveTo(-10, -31); ctx.lineTo(10, -31); ctx.lineTo(14, -8); ctx.quadraticCurveTo(0, -4, -14, -8); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = of.trim; ctx.fillRect(-13, -11, 26, 3);
    } else {
      rr(ctx, -11, -32, 22, 21, 6); ctx.fill(); ctx.stroke();
    }
    // belt / details
    ctx.fillStyle = of.belt; ctx.fillRect(-11, -16, 22, 3.5);
    ctx.fillStyle = '#f2c94c'; ctx.fillRect(-2, -16.5, 4, 4.5);
    if (cls === 'fighter') { // chest plate shine + pauldron
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; rr(ctx, -6, -29, 6, 9, 3); ctx.fill();
      ell(ctx, 7, -30, 7, 5, '#c3d0e4', OUTLINE, 1.5);
    }
    if (cls === 'paladin') { // shine + holy cross emblem
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; rr(ctx, -7, -29, 5, 8, 2.5); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.fillRect(1, -29, 3, 10); ctx.fillRect(-1.5, -26, 8, 3);
      ell(ctx, 7, -30, 7, 5, '#ffd76a', OUTLINE, 1.5);
    }
    if (cls === 'rogue') { ctx.fillStyle = of.trim; rr(ctx, -10, -33, 20, 6, 3); ctx.fill(); }
    if (cls === 'druid') { ctx.fillStyle = of.trim; ctx.beginPath(); ctx.moveTo(-10, -31); ctx.lineTo(8, -15); ctx.lineTo(4, -14); ctx.lineTo(-11, -27); ctx.fill(); }
    if (cls === 'marksman') { ctx.fillStyle = of.trim; ctx.beginPath(); ctx.moveTo(-9, -31); ctx.lineTo(10, -16); ctx.lineTo(10, -20); ctx.lineTo(-5, -32); ctx.fill(); }

    // head
    drawHead(ctx, o, t);

    // front arm + weapon
    drawWeaponArm(ctx, o, atk, t);

    ctx.restore();
  }

  function drawHead(ctx, o, t) {
    const cls = o.cls, hair = o.hair;
    const hx = 1, hy = -50, R = 20;
    if (cls === 'beyonder') { drawBeyonderHead(ctx, hx, hy, R, t); return; }
    // back hair
    ctx.fillStyle = hair; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.8;
    if (cls !== 'rogue') {
      ctx.beginPath(); ctx.ellipse(hx - 4, hy + 2, R + 1, R + 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (cls === 'mage' || cls === 'druid') { // long hair down the back
        ctx.beginPath(); ctx.moveTo(hx - 20, hy); ctx.quadraticCurveTo(hx - 26, hy + 26, hx - 14, hy + 28); ctx.lineTo(hx - 6, hy + 14); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    // face
    ell(ctx, hx, hy, R, R - 1, SKIN, OUTLINE, 1.8);
    ell(ctx, hx + 3, hy + 9, 12, 5, SKIN_SHADE);
    // eyes
    const blink = (Math.sin(t * 0.9 + (o.seed || 0)) > 0.985);
    if (blink) {
      ctx.strokeStyle = '#2a1e2a'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(hx + 2, hy + 2); ctx.lineTo(hx + 8, hy + 2); ctx.moveTo(hx + 12, hy + 2); ctx.lineTo(hx + 17, hy + 2); ctx.stroke();
    } else {
      const eyeC = cls === 'mage' ? '#5a3aa8' : cls === 'druid' ? '#2f7a3a' : cls === 'rogue' ? '#9e2a44' : '#2a3a6a';
      for (const ex of [hx + 5, hx + 14.5]) {
        ell(ctx, ex, hy + 1, 3.4, 5.2, eyeC);
        ell(ctx, ex, hy + 2.5, 2.4, 3, '#1c1424');
        ell(ctx, ex + 1, hy - 1.2, 1.4, 1.6, '#fff');
        ell(ctx, ex - 0.8, hy + 3.4, 0.7, 0.7, '#fff');
      }
    }
    // blush + mouth
    ell(ctx, hx + 2, hy + 9, 3.2, 1.8, 'rgba(255,120,140,0.45)');
    ell(ctx, hx + 18, hy + 9, 2.5, 1.8, 'rgba(255,120,140,0.45)');
    if (cls !== 'rogue') {
      ctx.strokeStyle = '#7a3a3a'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(hx + 10.5, hy + 9, 2.2, 0.2, Math.PI - 0.2); ctx.stroke();
    }

    // bangs
    ctx.fillStyle = hair; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.6;
    if (cls !== 'rogue') {
      ctx.beginPath();
      ctx.moveTo(hx - R + 1, hy - 2);
      ctx.quadraticCurveTo(hx - 12, hy - R - 8, hx + 8, hy - R - 2);
      ctx.quadraticCurveTo(hx + R + 4, hy - R + 2, hx + R, hy - 2);
      ctx.lineTo(hx + 16, hy - 8); ctx.lineTo(hx + 12, hy - 3); ctx.lineTo(hx + 8, hy - 10); ctx.lineTo(hx + 3, hy - 4);
      ctx.lineTo(hx - 2, hy - 11); ctx.lineTo(hx - 8, hy - 2);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    // headgear
    if (cls === 'fighter') {
      ctx.fillStyle = '#c9d4e6'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(hx, hy - 3, R + 2, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#9fb0cb'; rr(ctx, hx - R - 3, hy - 6, 2 * R + 6, 6, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ell(ctx, hx - 7, hy - 16, 5, 3, 'rgba(255,255,255,0.6)');
      // plume
      ctx.fillStyle = '#e8505b';
      ctx.beginPath(); ctx.moveTo(hx - 2, hy - R - 4);
      ctx.quadraticCurveTo(hx - 10, hy - R - 22 + Math.sin(t * 5) * 2, hx - 26, hy - R - 10);
      ctx.quadraticCurveTo(hx - 14, hy - R - 8, hx - 6, hy - R + 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (cls === 'paladin') {
      ctx.fillStyle = '#f2c94c'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(hx, hy - 3, R + 2, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d9a92e'; rr(ctx, hx - R - 3, hy - 6, 2 * R + 6, 6, 3); ctx.fill(); ctx.stroke();
      ell(ctx, hx - 7, hy - 16, 5, 3, 'rgba(255,255,255,0.7)');
      // little white wings on the helmet
      for (const sx of [-1, 1]) {
        ctx.fillStyle = '#ffffff'; ctx.beginPath();
        ctx.moveTo(hx + sx * (R - 2), hy - 12); ctx.quadraticCurveTo(hx + sx * (R + 14), hy - 30 + Math.sin(t * 5) * 1.5, hx + sx * (R + 12), hy - 14);
        ctx.quadraticCurveTo(hx + sx * (R + 6), hy - 12, hx + sx * (R - 2), hy - 7); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ell(ctx, hx, hy - R - 2, 3.5, 3.5, '#6fb4ff', OUTLINE, 1.2);
    } else if (cls === 'mage') {
      ctx.fillStyle = '#6b47c0'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.8;
      ell(ctx, hx, hy - 12, R + 10, 6, '#6b47c0', OUTLINE, 1.8);
      ctx.beginPath(); ctx.moveTo(hx - 15, hy - 14); ctx.quadraticCurveTo(hx - 2, hy - 40, hx - 14 + Math.sin(t * 2) * 2, hy - 52);
      ctx.quadraticCurveTo(hx + 6, hy - 38, hx + 15, hy - 14); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f2c94c'; ctx.fillRect(hx - 14, hy - 19, 28, 4);
      drawStar(ctx, hx + 1, hy - 28, 4.5, '#ffe27a');
    } else if (cls === 'rogue') {
      // hood
      ctx.fillStyle = '#34314d'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(hx - 1, hy - 1, R + 3, Math.PI * 0.75, Math.PI * 2.05); ctx.quadraticCurveTo(hx + 18, hy - 8, hx + 6, hy - 12);
      ctx.quadraticCurveTo(hx - 6, hy - 6, hx - 16, hy + 8); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = o.hair; ctx.beginPath(); ctx.moveTo(hx + 4, hy - 13); ctx.lineTo(hx + 14, hy - 6); ctx.lineTo(hx + 4, hy - 7); ctx.fill();
      // mask
      ctx.fillStyle = '#d6455f'; rr(ctx, hx - 2, hy + 5, 22, 10, 4); ctx.fill(); ctx.stroke();
    } else if (cls === 'marksman') {
      ctx.fillStyle = '#3f8a3c'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(hx - R - 4, hy - 8); ctx.quadraticCurveTo(hx - 2, hy - R - 14, hx + R + 8, hy - 9);
      ctx.quadraticCurveTo(hx + 4, hy - 13, hx - R - 4, hy - 8); ctx.fill(); ctx.stroke();
      // feather
      ctx.fillStyle = '#e8505b';
      ctx.beginPath(); ctx.moveTo(hx - 8, hy - 16); ctx.quadraticCurveTo(hx - 22, hy - 34 + Math.sin(t * 4) * 2, hx - 28, hy - 30);
      ctx.quadraticCurveTo(hx - 20, hy - 22, hx - 10, hy - 13); ctx.fill(); ctx.stroke();
    } else if (cls === 'druid') {
      // antlers
      ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy - 16); ctx.lineTo(hx - 14, hy - 32); ctx.moveTo(hx - 12, hy - 27); ctx.lineTo(hx - 20, hy - 30);
      ctx.moveTo(hx + 8, hy - 17); ctx.lineTo(hx + 12, hy - 33); ctx.moveTo(hx + 11, hy - 28); ctx.lineTo(hx + 18, hy - 32);
      ctx.stroke(); ctx.lineCap = 'butt';
      // leaf crown
      for (let i = -3; i <= 3; i++) {
        const lx = hx + i * 6, ly = hy - 16 + Math.abs(i) * 1.6;
        ctx.save(); ctx.translate(lx, ly); ctx.rotate(i * 0.25);
        ctx.fillStyle = i % 2 ? '#5fb85a' : '#7fd36b';
        ctx.beginPath(); ctx.ellipse(0, -3, 3.4, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ell(ctx, hx + 2, hy - 18, 2.6, 2.6, '#ff9ac2');
    }
  }

  // Deep hood, a face lost in shadow, blank glowing white eyes and a dark mask over the mouth
  function drawBeyonderHead(ctx, hx, hy, R, t) {
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.8;
    // hood (with a drooping point at the back)
    ctx.fillStyle = '#2e1a45';
    ctx.beginPath(); ctx.moveTo(hx - R + 2, hy - 10); ctx.quadraticCurveTo(hx - R - 12, hy - R - 6, hx - 20, hy - R - 18);
    ctx.quadraticCurveTo(hx - 4, hy - R - 8, hx + 4, hy - R - 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    ell(ctx, hx - 1, hy - 1, R + 4, R + 3, '#2e1a45', OUTLINE, 1.8);
    // face opening — pure shadow
    ell(ctx, hx + 5, hy + 3, R - 5, R - 6, '#0d0614');
    // soulless glowing eyes (no pupils)
    const glow = 0.55 + Math.sin(t * 3) * 0.2;
    for (const ex of [hx + 1, hx + 11]) {
      const g = ctx.createRadialGradient(ex, hy, 1, ex, hy, 8);
      g.addColorStop(0, `rgba(255,255,255,${glow})`); g.addColorStop(1, 'rgba(200,170,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ex, hy, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(ex, hy, 3.4, 2.2, -0.1, 0, Math.PI * 2); ctx.fill();
    }
    // mask over nose and mouth with violet trim and rune
    ctx.fillStyle = '#1f1430'; ctx.strokeStyle = '#a86cff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(hx - 6, hy + 5); ctx.quadraticCurveTo(hx + 6, hy + 2, hx + 18, hy + 5);
    ctx.lineTo(hx + 15, hy + 15); ctx.quadraticCurveTo(hx + 6, hy + 19, hx - 3, hy + 15); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(200,170,255,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hx + 6, hy + 7); ctx.lineTo(hx + 6, hy + 14); ctx.moveTo(hx + 3, hy + 10); ctx.lineTo(hx + 9, hy + 10); ctx.stroke();
    // hood rim trim
    ctx.strokeStyle = '#a86cff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(hx + 5, hy + 3, R - 4, R - 5, 0, -Math.PI * 0.95, Math.PI * 0.7); ctx.stroke();
  }

  function drawStar(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath(); ctx.fill();
  }

  function drawShield(ctx, x, y, bashing, holy) {
    ctx.save(); ctx.translate(bashing ? x + 26 : x, y);
    ctx.fillStyle = holy ? '#ffffff' : '#4f78c9'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(-10, -12); ctx.lineTo(10, -12); ctx.lineTo(10, 2); ctx.quadraticCurveTo(0, 14, -10, 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#f2c94c'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(0, 7); ctx.moveTo(-7, -4); ctx.lineTo(7, -4); ctx.stroke();
    ctx.restore();
  }

  function drawWeaponArm(ctx, o, atk, t) {
    const cls = o.cls;
    const sx = 6, sy = -27; // shoulder
    const melee = cls === 'fighter' || cls === 'rogue' || cls === 'paladin' || (cls === 'beyonder' && o.form === 'sword');
    const rest = melee ? 1.25 : 0.5;
    let ang = rest + Math.sin(t * 3) * 0.05; // radians, 0 = pointing forward
    if (o.moving && !o.air) ang = rest + 0.1 + Math.sin(t * 14) * 0.35;
    if (atk >= 0) {
      if (melee) ang = -2.0 + atk * 3.0; // overhead to forward-down swing
      else ang = -0.2 + Math.sin(atk * Math.PI) * -0.4; // cast/aim forward
    }
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
    // weapon behind hand
    ctx.save(); ctx.translate(11, 0);
    if (cls === 'fighter') {
      ctx.rotate(-Math.PI / 2 + 0.2);
      ctx.fillStyle = '#e8eef7'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-3, -4); ctx.lineTo(-3, -34); ctx.lineTo(0, -40); ctx.lineTo(3, -34); ctx.lineTo(3, -4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f2c94c'; rr(ctx, -8, -5, 16, 4, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#7a4b2a'; ctx.fillRect(-1.5, -1, 3, 8);
    } else if (cls === 'beyonder' && o.form === 'sword') { // hex sword: dark blade with glowing runes
      ctx.rotate(-Math.PI / 2 + 0.2);
      ctx.fillStyle = '#2a1a3e'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-3.5, -4); ctx.lineTo(-3, -34); ctx.lineTo(0, -42); ctx.lineTo(3, -34); ctx.lineTo(3.5, -4); ctx.closePath(); ctx.fill(); ctx.stroke();
      const rune = 0.6 + Math.sin(t * 6) * 0.3;
      ctx.fillStyle = `rgba(200,160,255,${rune})`;
      for (let i = 0; i < 3; i++) ctx.fillRect(-1, -12 - i * 8, 2, 4);
      ctx.fillStyle = '#7b3fd6'; rr(ctx, -8, -5, 16, 4, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1f1430'; ctx.fillRect(-1.5, -1, 3, 8);
    } else if (cls === 'beyonder') { // dark rod topped with a void crystal
      ctx.rotate(-Math.PI / 2 - ang + (atk >= 0 ? 0.6 : 0.05));
      ctx.strokeStyle = '#1f1430'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(0, -24); ctx.stroke(); ctx.lineCap = 'butt';
      ctx.strokeStyle = '#7b3fd6'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-2, -20); ctx.lineTo(2, -10); ctx.moveTo(2, -4); ctx.lineTo(-2, 4); ctx.stroke();
      const glow = 0.5 + Math.sin(t * 5) * 0.2 + (atk >= 0 ? 0.3 : 0);
      const g = ctx.createRadialGradient(0, -31, 2, 0, -31, 14);
      g.addColorStop(0, `rgba(180,140,255,${glow})`); g.addColorStop(1, 'rgba(90,30,160,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -31, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#140a22'; ctx.strokeStyle = '#a86cff'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(5, -31); ctx.lineTo(0, -23); ctx.lineTo(-5, -31); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (cls === 'paladin') { // mace — lowered forward at rest so the head doesn't cover the face
      ctx.rotate(-Math.PI / 2 + 0.2 + (atk >= 0 ? 0 : 2.0));
      ctx.fillStyle = '#8a5a2b'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.4;
      rr(ctx, -2, -24, 4, 30, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffd34d';
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 6, -30 + Math.sin(a) * 6); ctx.lineTo(Math.cos(a) * 12, -30 + Math.sin(a) * 12); ctx.lineTo(Math.cos(a + 0.5) * 6, -30 + Math.sin(a + 0.5) * 6); ctx.fill(); }
      ell(ctx, 0, -30, 8, 8, '#f2c94c', OUTLINE, 1.5);
      ell(ctx, -2.5, -32.5, 2.2, 2.2, 'rgba(255,255,255,0.8)');
      if (o.divine) {
        const pulse = 0.55 + Math.sin(t * 8) * 0.2;
        const g = ctx.createRadialGradient(0, -30, 4, 0, -30, 22);
        g.addColorStop(0, `rgba(255,240,150,${pulse})`); g.addColorStop(1, 'rgba(255,215,80,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -30, 22, 0, Math.PI * 2); ctx.fill();
      }
    } else if (cls === 'rogue') {
      ctx.rotate(-Math.PI / 2 + 0.3);
      ctx.fillStyle = '#dfe6ee'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-2.5, -3); ctx.lineTo(0, -20); ctx.lineTo(2.5, -3); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d6455f'; ctx.fillRect(-5, -4, 10, 3);
    } else if (cls === 'mage' || cls === 'druid') {
      ctx.rotate(-Math.PI / 2 - ang + (atk >= 0 ? 0.6 : 0.05));
      ctx.strokeStyle = cls === 'mage' ? '#6b4a2a' : '#7a5326'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(0, -26); ctx.stroke(); ctx.lineCap = 'butt';
      if (cls === 'mage') {
        const glow = 0.6 + Math.sin(t * 6) * 0.2;
        ell(ctx, 0, -30, 9 + (atk >= 0 ? 3 : 0), 9 + (atk >= 0 ? 3 : 0), `rgba(180,140,255,${glow * 0.35})`);
        ell(ctx, 0, -30, 5.5, 5.5, '#c9a8ff', OUTLINE, 1.4);
        ell(ctx, -1.5, -32, 1.8, 1.8, '#fff');
      } else {
        for (let i = 0; i < 4; i++) {
          ctx.save(); ctx.translate(0, -26); ctx.rotate(-1.2 + i * 0.8);
          ctx.fillStyle = i % 2 ? '#5fb85a' : '#86d66a'; ctx.beginPath(); ctx.ellipse(0, -6, 3.2, 6.5, 0, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        ell(ctx, 0, -27, 3, 3, '#ff9ac2');
      }
    } else if (cls === 'marksman') {
      ctx.rotate(-ang + (atk >= 0 ? 0 : 0.15));
      ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.arc(-6, 0, 18, -1.25, 1.25); ctx.stroke();
      const pull = atk >= 0 ? Math.sin(atk * Math.PI) * 8 : 0;
      ctx.strokeStyle = '#f4efe2'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-6 + 18 * Math.cos(-1.25), 18 * Math.sin(-1.25)); ctx.lineTo(-pull, 0);
      ctx.lineTo(-6 + 18 * Math.cos(1.25), 18 * Math.sin(1.25)); ctx.stroke();
    }
    ctx.restore();
    // arm + hand
    ctx.fillStyle = OUTFIT[cls].body; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.5;
    rr(ctx, -2, -3.5, 12, 7, 3.5); ctx.fill(); ctx.stroke();
    ell(ctx, 11, 0, 4, 4, SKIN, OUTLINE, 1.5);
    ctx.restore();
  }

  function drawClimber(ctx, o, of, t) {
    // back view on ladder
    const c = Math.sin(t * 10) * (o.moving ? 3 : 0);
    ctx.fillStyle = '#5a3a22';
    rr(ctx, -8, -13 + c, 7, 13, 3); ctx.fill();
    rr(ctx, 1, -13 - c, 7, 13, 3); ctx.fill();
    ctx.fillStyle = of.body; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.8;
    rr(ctx, -11, -32, 22, 21, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = of.body;
    rr(ctx, -16, -42 - c, 7, 14, 3); ctx.fill(); ctx.stroke();
    rr(ctx, 9, -42 + c, 7, 14, 3); ctx.fill(); ctx.stroke();
    ell(ctx, 0, -50, 20, 19, o.cls === 'rogue' ? '#34314d' : o.hair, OUTLINE, 1.8);
    if (o.cls === 'mage') { ctx.fillStyle = '#6b47c0'; ctx.beginPath(); ctx.moveTo(-15, -62); ctx.lineTo(-3, -100); ctx.lineTo(15, -62); ctx.fill(); ctx.stroke(); }
    if (o.cls === 'beyonder') { ell(ctx, 0, -50, 22, 21, '#2e1a45', OUTLINE, 1.8); }
    if (o.cls === 'paladin') { ctx.fillStyle = '#f2c94c'; ctx.beginPath(); ctx.arc(0, -53, 22, Math.PI, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    if (o.cls === 'fighter') { ctx.fillStyle = '#c9d4e6'; ctx.beginPath(); ctx.arc(0, -53, 22, Math.PI, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }

  // ---------------------------------------------------------------- monsters
  function drawMonster(ctx, m, t) {
    const seed = m.id * 1.7;
    ctx.save();
    ctx.translate(m.x, m.y);
    const frozen = m.s && m.s.includes('f');
    const anim = frozen ? 0 : t;
    if (m.hu) ctx.translate(Math.sin(t * 90) * 2.5, 0);
    ell(ctx, 0, 0, (S.MONSTERS[m.t].w / 2) * 0.9, 5, 'rgba(0,0,0,0.18)');
    ctx.scale(m.f < 0 ? -1 : 1, 1);
    switch (m.t) {
      case 'slime': drawSlime(ctx, 1, '#7ad65c', anim + seed, m.mv, false); break;
      case 'kingslime': drawSlime(ctx, 3.4, '#6fb4ff', anim + seed, m.mv, true); break;
      case 'mushroom': drawMushroom(ctx, anim + seed, m.mv); break;
      case 'stump': drawStump(ctx, anim + seed, m.mv); break;
    }
    ctx.restore();
    // status overlays (unflipped)
    const def = S.MONSTERS[m.t];
    ctx.save(); ctx.translate(m.x, m.y);
    if (m.s) {
      if (m.s.includes('w')) {
        ctx.strokeStyle = 'rgba(120,190,255,0.7)'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(0, -def.h * 0.4, def.w * 0.6, 6, 0, t * 4 + i * 2, t * 4 + i * 2 + 1.2); ctx.stroke(); }
      }
      if (m.s.includes('r')) {
        ctx.strokeStyle = '#3f8f3a'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath(); ctx.moveTo(i * def.w * 0.2, 2);
          ctx.quadraticCurveTo(i * def.w * 0.2 + 10 * Math.sin(i + t * 3), -def.h * 0.3, i * def.w * 0.15, -def.h * 0.45); ctx.stroke();
        }
        ctx.lineCap = 'butt';
        for (let i = -1; i <= 1; i++) ell(ctx, i * def.w * 0.25, -def.h * 0.4, 3.5, 2, '#7fd36b');
      }
      if (frozen) {
        ctx.fillStyle = 'rgba(170,225,255,0.55)'; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-def.w * 0.62, 2); ctx.lineTo(-def.w * 0.68, -def.h * 0.7); ctx.lineTo(-def.w * 0.2, -def.h * 1.12);
        ctx.lineTo(def.w * 0.4, -def.h * 1.05); ctx.lineTo(def.w * 0.66, -def.h * 0.5); ctx.lineTo(def.w * 0.6, 2); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.moveTo(-def.w * 0.4, -def.h * 0.8); ctx.lineTo(-def.w * 0.2, -def.h * 0.6); ctx.stroke();
      }
      if (m.s.includes('x')) { // exposed: red crosshair above the head
        const cy = -def.h - 22;
        ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, cy, 8, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-12, cy); ctx.lineTo(-4, cy); ctx.moveTo(4, cy); ctx.lineTo(12, cy);
        ctx.moveTo(0, cy - 12); ctx.lineTo(0, cy - 4); ctx.moveTo(0, cy + 4); ctx.lineTo(0, cy + 12); ctx.stroke();
      }
      if (m.s.includes('p')) { // poisoned: rising green bubbles
        for (let i = 0; i < 3; i++) {
          const k = (t * 0.8 + i / 3) % 1;
          ell(ctx, Math.sin(i * 2 + t * 3) * def.w * 0.3, -def.h * (0.3 + k * 0.9), 3 + i, 3 + i, `rgba(127,224,90,${1 - k})`);
        }
      }
      if (m.s.includes('c')) { // cursed: dark aura and a violet skull overhead
        ctx.globalAlpha = 0.35 + Math.sin(t * 5) * 0.1;
        ell(ctx, 0, -def.h * 0.5, def.w * 0.65, def.h * 0.6, '#3b1a66');
        ctx.globalAlpha = 1;
        const sy = -def.h - 18;
        ell(ctx, 0, sy, 6, 5.5, '#c9a8ff', '#3b1a66', 1.2);
        ell(ctx, -2.2, sy - 0.5, 1.4, 1.6, '#1f1430'); ell(ctx, 2.2, sy - 0.5, 1.4, 1.6, '#1f1430');
        ctx.fillStyle = '#c9a8ff'; ctx.fillRect(-3, sy + 4, 6, 3);
      }
      if (m.s.includes('t')) { // taunted: angry golden mark
        ctx.font = 'bold 16px Fredoka, sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = '#7a4a00'; ctx.strokeText('!', def.w * 0.45, -def.h - 4);
        ctx.fillStyle = '#ffd34d'; ctx.fillText('!', def.w * 0.45, -def.h - 4);
      }
      if (m.s.includes('s')) {
        for (let i = 0; i < 3; i++) {
          const a = t * 5 + i * 2.1;
          drawStar(ctx, Math.cos(a) * def.w * 0.35, -def.h - 10 + Math.sin(a) * 5, 5, '#ffe27a');
        }
      }
    }
    ctx.restore();
  }

  function drawFace(ctx, x, y, s, angry) {
    ell(ctx, x - 6 * s, y, 3 * s, 4 * s, '#2a1e2a');
    ell(ctx, x + 6 * s, y, 3 * s, 4 * s, '#2a1e2a');
    ell(ctx, x - 5 * s, y - 1.5 * s, 1.2 * s, 1.4 * s, '#fff');
    ell(ctx, x + 7 * s, y - 1.5 * s, 1.2 * s, 1.4 * s, '#fff');
    if (angry) {
      ctx.strokeStyle = '#2a1e2a'; ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.moveTo(x - 10 * s, y - 7 * s); ctx.lineTo(x - 3 * s, y - 5 * s); ctx.moveTo(x + 10 * s, y - 7 * s); ctx.lineTo(x + 3 * s, y - 5 * s); ctx.stroke();
    }
    ell(ctx, x - 11 * s, y + 4 * s, 2.5 * s, 1.5 * s, 'rgba(255,120,140,0.5)');
    ell(ctx, x + 11 * s, y + 4 * s, 2.5 * s, 1.5 * s, 'rgba(255,120,140,0.5)');
    ctx.strokeStyle = '#5a2a2a'; ctx.lineWidth = 1.4 * s;
    ctx.beginPath(); ctx.arc(x, y + 4 * s, 2.5 * s, 0.1, Math.PI - 0.1); ctx.stroke();
  }

  function drawSlime(ctx, s, color, t, moving, crown) {
    const sq = Math.sin(t * (moving ? 9 : 4)) * (moving ? 0.12 : 0.05);
    const w = 22 * s * (1 + sq), h = 34 * s * (1 - sq);
    const g = ctx.createLinearGradient(0, -h, 0, 0);
    g.addColorStop(0, shade(color, 40)); g.addColorStop(1, shade(color, -30));
    ctx.fillStyle = g; ctx.strokeStyle = shade(color, -90); ctx.lineWidth = 2 * Math.min(s, 1.6);
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.bezierCurveTo(-w * 1.05, -h * 0.75, -w * 0.45, -h, 0, -h);
    ctx.bezierCurveTo(w * 0.45, -h, w * 1.05, -h * 0.75, w, 0);
    ctx.quadraticCurveTo(0, 4 * s, -w, 0);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ell(ctx, -w * 0.4, -h * 0.72, w * 0.22, h * 0.12, 'rgba(255,255,255,0.65)');
    drawFace(ctx, w * 0.25, -h * 0.42, s * 0.9, crown);
    if (crown) {
      ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = '#a8761a'; ctx.lineWidth = 2.5;
      const cy = -h + 6;
      ctx.beginPath(); ctx.moveTo(-28, cy); ctx.lineTo(-32, cy - 30); ctx.lineTo(-14, cy - 14); ctx.lineTo(0, cy - 36);
      ctx.lineTo(14, cy - 14); ctx.lineTo(32, cy - 30); ctx.lineTo(28, cy); ctx.closePath(); ctx.fill(); ctx.stroke();
      ell(ctx, 0, cy - 12, 5, 5, '#e8505b'); ell(ctx, -18, cy - 8, 3.5, 3.5, '#6fb4ff'); ell(ctx, 18, cy - 8, 3.5, 3.5, '#7ad65c');
    }
  }

  function drawMushroom(ctx, t, moving) {
    const hop = moving ? Math.abs(Math.sin(t * 8)) * 6 : Math.abs(Math.sin(t * 3)) * 1.5;
    ctx.translate(0, -hop);
    // feet
    ell(ctx, -8, -2 + hop, 7, 4, '#c98a5a', OUTLINE, 1.5);
    ell(ctx, 8, -2 + hop, 7, 4, '#c98a5a', OUTLINE, 1.5);
    // stem body
    ctx.fillStyle = '#fff1d6'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.8;
    rr(ctx, -15, -30, 30, 28, 11); ctx.fill(); ctx.stroke();
    drawFace(ctx, 3, -16, 0.8, false);
    // cap
    const g = ctx.createLinearGradient(0, -56, 0, -26);
    g.addColorStop(0, '#ff9a4d'); g.addColorStop(1, '#e8641f');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-27, -26); ctx.bezierCurveTo(-28, -50, -10, -58, 0, -58); ctx.bezierCurveTo(10, -58, 28, -50, 27, -26);
    ctx.quadraticCurveTo(0, -20, -27, -26); ctx.closePath(); ctx.fill(); ctx.stroke();
    ell(ctx, -12, -44, 5, 4, '#fff6e6'); ell(ctx, 6, -50, 6, 4, '#fff6e6'); ell(ctx, 16, -36, 4, 3, '#fff6e6'); ell(ctx, -20, -32, 3, 2.5, '#fff6e6');
  }

  function drawStump(ctx, t, moving) {
    const wob = moving ? Math.sin(t * 7) * 0.06 : 0;
    ctx.rotate(wob);
    // roots
    ctx.fillStyle = '#7a5130'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.8;
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * 18, -10); ctx.quadraticCurveTo(sx * 30, -4, sx * 32, 0); ctx.lineTo(sx * 14, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    // trunk
    const g = ctx.createLinearGradient(-26, 0, 26, 0);
    g.addColorStop(0, '#8a5a32'); g.addColorStop(0.5, '#a87245'); g.addColorStop(1, '#7a4e2b');
    ctx.fillStyle = g;
    rr(ctx, -25, -56, 50, 56, 10); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(60,35,20,0.35)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-16, -40); ctx.lineTo(-17, -8); ctx.moveTo(15, -44); ctx.lineTo(16, -12); ctx.stroke();
    // top rings
    ell(ctx, 0, -56, 25, 7, '#e6c08a', OUTLINE, 1.8);
    ctx.strokeStyle = '#c49a62'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(0, -56, 15, 4, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, -56, 7, 2, 0, 0, Math.PI * 2); ctx.stroke();
    // sprout
    ctx.strokeStyle = '#3f8f3a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(6, -58); ctx.quadraticCurveTo(8, -68, 4, -74); ctx.stroke();
    ctx.save(); ctx.translate(4, -72); ctx.rotate(-0.6 + Math.sin(t * 3) * 0.2);
    ctx.fillStyle = '#7fd36b'; ctx.beginPath(); ctx.ellipse(-5, 0, 6, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5, -2, 6, 3.5, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    drawFace(ctx, 4, -30, 0.9, true);
  }

  // ---------------------------------------------------------------- spirit fox
  function drawSpirit(ctx, s, t) {
    ctx.save();
    ctx.translate(s.x, s.y + Math.sin(t * 4 + s.id) * 4);
    ctx.scale(s.f < 0 ? -1 : 1, 1);
    ctx.globalAlpha = 0.9;
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 34);
    glow.addColorStop(0, 'rgba(170,255,170,0.55)'); glow.addColorStop(1, 'rgba(170,255,170,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill();
    // tail
    ctx.fillStyle = '#9ef2a8';
    ctx.beginPath(); ctx.moveTo(-10, 4); ctx.quadraticCurveTo(-30, 10 + Math.sin(t * 6) * 5, -28, -10 + Math.sin(t * 6) * 4); ctx.quadraticCurveTo(-18, -2, -8, -2); ctx.fill();
    // body + head
    ell(ctx, -2, 6, 13, 9, '#b8f7be', '#3e9a4f', 1.5);
    ctx.fillStyle = '#c8fbcd'; ctx.strokeStyle = '#3e9a4f'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-2, -12); ctx.lineTo(1, -26); ctx.lineTo(7, -14); ctx.moveTo(8, -13); ctx.lineTo(15, -24); ctx.lineTo(17, -10); ctx.fill(); ctx.stroke();
    ell(ctx, 8, -6, 12, 10, '#c8fbcd', '#3e9a4f', 1.5);
    ell(ctx, 6, -7, 1.8, 2.6, '#1f5a2c'); ell(ctx, 13, -7, 1.8, 2.6, '#1f5a2c');
    ell(ctx, 19, -3, 2, 1.6, '#1f5a2c');
    ctx.restore();
  }

  // ---------------------------------------------------------------- druid tree spirit
  // t: { x, y, f, g (grow progress 0..1), hp, mhp }
  function drawTreeSpirit(ctx, tr, t) {
    ctx.save();
    ctx.translate(tr.x, tr.y);
    if (tr.g < 1) {
      // sprouting seed: grows from a mound into a sapling
      ell(ctx, 0, 0, 16, 5, '#7a5130');
      const h = 6 + tr.g * 34;
      ctx.strokeStyle = '#3f8f3a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, -2); ctx.quadraticCurveTo(4, -h / 2, 0, -h); ctx.stroke(); ctx.lineCap = 'butt';
      const leaf = 3 + tr.g * 7;
      ctx.save(); ctx.translate(0, -h); ctx.rotate(Math.sin(t * 3) * 0.2);
      ell(ctx, -leaf, 0, leaf, leaf * 0.55, '#86d66a'); ell(ctx, leaf, -2, leaf, leaf * 0.55, '#5fb85a');
      ctx.restore();
      // progress ring
      ctx.strokeStyle = 'rgba(134,214,106,0.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, -h - 16, 7, -Math.PI / 2, -Math.PI / 2 + tr.g * Math.PI * 2); ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.scale(tr.f < 0 ? -1 : 1, 1);
    const sway = Math.sin(t * 2 + tr.id) * 0.04;
    ell(ctx, 0, 0, 30, 6, 'rgba(0,0,0,0.18)');
    // roots + trunk
    ctx.fillStyle = '#7a5130'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.8;
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * 10, -14); ctx.quadraticCurveTo(sx * 22, -4, sx * 26, 0); ctx.lineTo(sx * 6, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.save(); ctx.rotate(sway);
    const g = ctx.createLinearGradient(-14, 0, 14, 0);
    g.addColorStop(0, '#8a5a32'); g.addColorStop(0.5, '#a87245'); g.addColorStop(1, '#7a4e2b');
    ctx.fillStyle = g; rr(ctx, -13, -62, 26, 62, 8); ctx.fill(); ctx.stroke();
    // face on the trunk
    ell(ctx, -4, -36, 3, 3.6, '#2a1e2a'); ell(ctx, 6, -36, 3, 3.6, '#2a1e2a');
    ell(ctx, -3, -37.2, 1, 1.2, '#fff'); ell(ctx, 7, -37.2, 1, 1.2, '#fff');
    ctx.strokeStyle = '#2a1e2a'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(-9, -43); ctx.lineTo(-1, -40); ctx.moveTo(11, -43); ctx.lineTo(3, -40); ctx.stroke();
    ctx.beginPath(); ctx.arc(1, -27, 3, Math.PI + 0.3, -0.3); ctx.stroke();
    // branch arms
    ctx.strokeStyle = '#7a5130'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(10, -44); ctx.quadraticCurveTo(24, -50 + Math.sin(t * 4) * 3, 30, -60); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-10, -40); ctx.quadraticCurveTo(-22, -46, -26, -54); ctx.stroke(); ctx.lineCap = 'butt';
    // leafy crown
    ell(ctx, 0, -80, 34, 26, '#4fae3e', '#2f6f2a', 2.5);
    ell(ctx, -20, -70, 20, 16, '#5fc24a', '#2f6f2a', 2.5);
    ell(ctx, 20, -72, 20, 16, '#5fc24a', '#2f6f2a', 2.5);
    ell(ctx, -6, -92, 12, 7, 'rgba(220,255,170,0.55)');
    ell(ctx, 12, -84, 3, 3, '#ff9ac2'); ell(ctx, -14, -78, 2.5, 2.5, '#ff9ac2');
    ctx.restore();
    ctx.restore();
  }

  // ---------------------------------------------------------------- marksman wolf
  // w: { x, y, f, mv }
  function drawWolf(ctx, w, t, style) {
    const spectral = style === 'spectral';
    ctx.save();
    ctx.translate(w.x, w.y);
    ell(ctx, 0, 0, 18, 4, 'rgba(0,0,0,0.18)');
    ctx.scale(w.f < 0 ? -1 : 1, 1);
    const run = w.mv ? Math.sin(t * 16) : 0;
    const bob = w.mv ? Math.abs(Math.sin(t * 16)) * -2 : Math.sin(t * 3) * 0.6;
    ctx.translate(0, bob);
    const fur = spectral ? '#9b7ae0' : '#9aa6b8', light = spectral ? '#e2d6ff' : '#e8edf3', dark = spectral ? '#4a2f80' : '#5d6878';
    if (spectral) {
      ctx.globalAlpha = 0.78;
      const g = ctx.createRadialGradient(2, -20, 4, 2, -20, 34);
      g.addColorStop(0, 'rgba(180,140,255,0.45)'); g.addColorStop(1, 'rgba(180,140,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(2, -20, 34, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.6;
    // tail
    ctx.fillStyle = fur;
    ctx.beginPath(); ctx.moveTo(-14, -16); ctx.quadraticCurveTo(-28, -24 + Math.sin(t * 8) * 3, -26, -34); ctx.quadraticCurveTo(-20, -22, -12, -12); ctx.closePath(); ctx.fill(); ctx.stroke();
    ell(ctx, -25, -32, 3, 3.5, light);
    // legs
    ctx.fillStyle = dark;
    rr(ctx, -12 + run * 3, -9, 5, 9, 2); ctx.fill(); ctx.stroke();
    rr(ctx, 6 - run * 3, -9, 5, 9, 2); ctx.fill(); ctx.stroke();
    // body
    ell(ctx, -2, -15, 16, 9, fur, OUTLINE, 1.6);
    ell(ctx, 0, -11, 9, 4, light);
    // head (big chibi head)
    ell(ctx, 12, -26, 11, 10, fur, OUTLINE, 1.6);
    ctx.fillStyle = fur;
    ctx.beginPath(); ctx.moveTo(5, -32); ctx.lineTo(6, -44); ctx.lineTo(12, -35); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(13, -35); ctx.lineTo(19, -44); ctx.lineTo(20, -32); ctx.closePath(); ctx.fill(); ctx.stroke();
    ell(ctx, 8, -38, 1.6, 3, '#f5b3c4'); ell(ctx, 18, -38, 1.6, 3, '#f5b3c4');
    // snout + face
    ell(ctx, 20, -23, 6, 4.5, light, OUTLINE, 1.4);
    ell(ctx, 25, -24, 2, 1.6, '#2a1e2a');
    ell(ctx, 10, -28, 2, 2.8, '#2a1e2a'); ell(ctx, 16, -28, 2, 2.8, '#2a1e2a');
    ell(ctx, 10.6, -29.2, 0.8, 1, '#fff'); ell(ctx, 16.6, -29.2, 0.8, 1, '#fff');
    // little red scarf
    if (!spectral) { ctx.fillStyle = '#e8505b'; rr(ctx, 4, -19, 10, 4, 2); ctx.fill(); }
    ctx.restore();
  }

  // ---------------------------------------------------------------- beyonder scarab
  function drawScarab(ctx, sc, t) {
    ctx.save();
    ctx.translate(sc.x, sc.y);
    ell(ctx, 0, 0, 11, 3, 'rgba(0,0,0,0.2)');
    ctx.scale(sc.f < 0 ? -1 : 1, 1);
    const step = sc.mv ? Math.sin(t * 22) * 2 : 0;
    ctx.strokeStyle = '#140a22'; ctx.lineWidth = 1.6;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(i * 5, -5); ctx.lineTo(i * 5 + (i % 2 ? step : -step) - 2, 0); ctx.stroke();
    }
    ell(ctx, 0, -7, 10, 7, '#2e1a45', '#140a22', 1.5);
    ctx.strokeStyle = 'rgba(168,108,255,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(0, -1); ctx.stroke();
    ell(ctx, -3, -10, 3, 1.6, 'rgba(200,170,255,0.55)');
    ell(ctx, 10, -6, 4, 3.5, '#1f1430', '#140a22', 1.2);
    ctx.strokeStyle = '#140a22'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(13, -8); ctx.quadraticCurveTo(17, -12, 15, -15); ctx.stroke();
    ell(ctx, 12, -7, 1.3, 1.3, '#e8dcff');
    ctx.restore();
  }

  // ---------------------------------------------------------------- potions
  // pot: { id, k: 'hp'|'mp', s: 'small'|'medium'|'large', x, y }
  function drawPotion(ctx, pot, t) {
    const sc = pot.s === 'large' ? 1.35 : pot.s === 'medium' ? 1.1 : 0.85;
    const liquid = pot.k === 'hp' ? '#ff4d6d' : '#4f8dff', shine = pot.k === 'hp' ? '#ffb3c1' : '#bcd6ff';
    ctx.save();
    ctx.translate(pot.x, pot.y - 4 + Math.sin(t * 3 + pot.id) * 2.5);
    ctx.scale(sc, sc);
    const g = ctx.createRadialGradient(0, -12, 2, 0, -12, 22);
    g.addColorStop(0, pot.k === 'hp' ? 'rgba(255,120,150,0.45)' : 'rgba(120,170,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -12, 22, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.5;
    // bottle body + neck
    ctx.fillStyle = 'rgba(235,245,255,0.9)';
    ctx.beginPath(); ctx.arc(0, -10, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    rr(ctx, -3.5, -24, 7, 8, 2); ctx.fill(); ctx.stroke();
    // liquid
    ctx.fillStyle = liquid;
    ctx.beginPath(); ctx.arc(0, -10, 7.5, -0.15, Math.PI + 0.15); ctx.closePath(); ctx.fill();
    ell(ctx, -3, -13, 2, 3, shine);
    // cork
    ctx.fillStyle = '#b07a45'; rr(ctx, -4, -28, 8, 5, 2); ctx.fill(); ctx.stroke();
    if (pot.s === 'large') drawStar(ctx, 9, -24, 3.5, '#ffe27a');
    ctx.restore();
  }

  // ---------------------------------------------------------------- marksman trap
  function drawTrap(ctx, tr, t) {
    ctx.save();
    ctx.translate(tr.x, tr.y);
    ell(ctx, 0, 0, 16, 4, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = '#8a9099'; ctx.strokeStyle = '#3a3f48'; ctx.lineWidth = 1.5;
    rr(ctx, -14, -4, 28, 5, 2); ctx.fill(); ctx.stroke();
    // open jaws with teeth
    ctx.fillStyle = '#c9ced6';
    for (const sx of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(sx * 2, -3);
      for (let i = 0; i <= 4; i++) ctx.lineTo(sx * (3 + i * 3), -3 - (i % 2 ? 7 : 3));
      ctx.lineTo(sx * 15, -3); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // blinking rune light
    ell(ctx, 0, -2, 2.6, 2.6, `rgba(255,90,90,${0.5 + Math.sin(t * 6 + tr.id) * 0.4})`);
    ctx.restore();
  }

  // ---------------------------------------------------------------- world
  function seeded(seed) {
    let s = seed;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }

  function buildTerrain() {
    const W = S.WORLD.w, H = S.WORLD.h;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const rnd = seeded(42);

    // ladders behind platform caps
    for (const l of S.LADDERS) drawLadder(ctx, l.x, l.top - 16, l.bottom);

    for (const p of S.PLATFORMS) {
      if (p.ground) drawGround(ctx, p, rnd); else drawFloating(ctx, p, rnd);
    }
    // decorations on top of platforms
    for (const p of S.PLATFORMS) decorate(ctx, p, rnd);
    // signpost near spawn
    drawSign(ctx, S.SPAWN.x - 170, S.SPAWN.y);
    return c;
  }

  function drawLadder(ctx, x, top, bottom) {
    ctx.save();
    ctx.strokeStyle = '#6b4423'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 12, top); ctx.lineTo(x - 12, bottom); ctx.moveTo(x + 12, top); ctx.lineTo(x + 12, bottom); ctx.stroke();
    ctx.strokeStyle = '#a8743c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 13.5, top); ctx.lineTo(x - 13.5, bottom); ctx.moveTo(x + 10.5, top); ctx.lineTo(x + 10.5, bottom); ctx.stroke();
    ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 4;
    for (let y = top + 12; y < bottom - 4; y += 18) { ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x + 12, y); ctx.stroke(); }
    ctx.restore();
  }

  function grassTop(ctx, x, y, w, rnd) {
    // bumpy grass cap with drips
    const g = ctx.createLinearGradient(0, y - 8, 0, y + 22);
    g.addColorStop(0, '#9be35a'); g.addColorStop(0.5, '#6cc644'); g.addColorStop(1, '#3f9a35');
    ctx.fillStyle = g; ctx.strokeStyle = '#2f6f2a'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 4);
    ctx.quadraticCurveTo(x - 8, y - 6, x + 6, y - 6);
    for (let i = x + 6; i < x + w - 6; i += 18) ctx.quadraticCurveTo(i + 9, y - 10 - rnd() * 3, i + 18, y - 6);
    ctx.quadraticCurveTo(x + w + 8, y - 6, x + w + 6, y + 4);
    // dripping underside
    let i = x + w + 6;
    while (i > x - 6) {
      const dw = 14 + rnd() * 18, dh = 10 + rnd() * 12;
      ctx.quadraticCurveTo(i - dw / 2, y + dh + 8, Math.max(x - 6, i - dw), y + 10);
      i -= dw;
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // highlight
    ctx.strokeStyle = 'rgba(220,255,170,0.7)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x + 6, y - 2); ctx.lineTo(x + w - 6, y - 2); ctx.stroke(); ctx.lineCap = 'butt';
  }

  function drawFloating(ctx, p, rnd) {
    const x = p.x, y = p.y, w = p.w, depth = 46;
    const g = ctx.createLinearGradient(0, y, 0, y + depth);
    g.addColorStop(0, '#b77a45'); g.addColorStop(1, '#7e4c2a');
    ctx.fillStyle = g; ctx.strokeStyle = '#4e2e17'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y + 4);
    ctx.lineTo(x + w, y + 4);
    ctx.quadraticCurveTo(x + w + 4, y + depth * 0.6, x + w - 20, y + depth * 0.8);
    let i = x + w - 20;
    while (i > x + 20) {
      const step = 30 + rnd() * 40;
      const nx = Math.max(x + 20, i - step);
      ctx.quadraticCurveTo((i + nx) / 2, y + depth + rnd() * 18, nx, y + depth * (0.75 + rnd() * 0.2));
      i = nx;
    }
    ctx.quadraticCurveTo(x - 4, y + depth * 0.6, x, y + 4);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // stones
    for (let k = 0; k < w / 50; k++) {
      ell(ctx, x + 20 + rnd() * (w - 40), y + 18 + rnd() * 18, 5 + rnd() * 4, 3 + rnd() * 2, 'rgba(240,210,170,0.35)');
    }
    grassTop(ctx, x, y, w, rnd);
  }

  function drawGround(ctx, p, rnd) {
    const y = p.y, H = S.WORLD.h;
    const g = ctx.createLinearGradient(0, y, 0, H);
    g.addColorStop(0, '#b47a45'); g.addColorStop(1, '#6e4224');
    ctx.fillStyle = g;
    ctx.fillRect(p.x, y, p.w, H - y);
    // dirt layers
    ctx.strokeStyle = 'rgba(80,45,20,0.35)'; ctx.lineWidth = 3;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      const ly = y + 60 + k * 45;
      ctx.moveTo(0, ly);
      for (let xx = 0; xx <= p.w; xx += 80) ctx.quadraticCurveTo(xx + 40, ly + (rnd() - 0.5) * 20, xx + 80, ly);
      ctx.stroke();
    }
    for (let k = 0; k < 120; k++) ell(ctx, rnd() * p.w, y + 30 + rnd() * (H - y - 30), 4 + rnd() * 8, 3 + rnd() * 4, 'rgba(240,210,170,0.25)');
    // grass
    const gg = ctx.createLinearGradient(0, y - 10, 0, y + 26);
    gg.addColorStop(0, '#9be35a'); gg.addColorStop(0.6, '#6cc644'); gg.addColorStop(1, '#3f9a35');
    ctx.fillStyle = gg; ctx.strokeStyle = '#2f6f2a'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, y - 6);
    for (let xx = 0; xx < p.w; xx += 20) ctx.quadraticCurveTo(xx + 10, y - 11 - rnd() * 3, xx + 20, y - 6);
    let xx = p.w;
    ctx.lineTo(p.w, y + 14);
    while (xx > 0) { const dw = 16 + rnd() * 20; ctx.quadraticCurveTo(xx - dw / 2, y + 26 + rnd() * 10, xx - dw, y + 14); xx -= dw; }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(220,255,170,0.7)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, y - 2); ctx.lineTo(p.w, y - 2); ctx.stroke();
  }

  function decorate(ctx, p, rnd) {
    const n = Math.floor(p.w / (p.ground ? 70 : 90));
    for (let k = 0; k < n; k++) {
      const x = p.x + 20 + rnd() * (p.w - 40);
      if (S.LADDERS.some((l) => Math.abs(l.x - x) < 26 && (l.top === p.y || l.bottom === p.y))) continue;
      const r = rnd();
      if (r < 0.35) drawFlower(ctx, x, p.y - 4, rnd);
      else if (r < 0.55) drawTuft(ctx, x, p.y - 2);
      else if (r < 0.68) drawBush(ctx, x, p.y - 2, rnd);
      else if (r < 0.76) drawTinyShroom(ctx, x, p.y - 2);
      else if (r < 0.82 && p.ground) drawTree(ctx, x, p.y - 2, rnd);
    }
  }
  function drawFlower(ctx, x, y, rnd) {
    const colors = ['#ff7eb6', '#ffd34d', '#ffffff', '#ff8a5c', '#b48cff'];
    const c = colors[Math.floor(rnd() * colors.length)];
    ctx.strokeStyle = '#3f8f3a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(x, y - 10); ctx.stroke();
    for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; ell(ctx, x + Math.cos(a) * 4, y - 12 + Math.sin(a) * 4, 3.2, 3.2, c); }
    ell(ctx, x, y - 12, 2.5, 2.5, '#ffb84d');
  }
  function drawTuft(ctx, x, y) {
    ctx.fillStyle = '#58b43c';
    ctx.beginPath(); ctx.moveTo(x - 8, y + 2); ctx.lineTo(x - 5, y - 10); ctx.lineTo(x - 1, y); ctx.lineTo(x + 2, y - 13); ctx.lineTo(x + 4, y); ctx.lineTo(x + 8, y - 8); ctx.lineTo(x + 9, y + 2); ctx.fill();
  }
  function drawBush(ctx, x, y, rnd) {
    const s = 0.8 + rnd() * 0.5;
    ell(ctx, x - 12 * s, y - 8 * s, 13 * s, 11 * s, '#4fae3e', '#2f6f2a', 2);
    ell(ctx, x + 12 * s, y - 8 * s, 13 * s, 11 * s, '#4fae3e', '#2f6f2a', 2);
    ell(ctx, x, y - 15 * s, 15 * s, 13 * s, '#5fc24a', '#2f6f2a', 2);
    ell(ctx, x - 4 * s, y - 20 * s, 5 * s, 3 * s, 'rgba(220,255,170,0.6)');
    if (rnd() < 0.5) { ell(ctx, x + 8 * s, y - 12 * s, 2.5, 2.5, '#ff6b6b'); ell(ctx, x - 9 * s, y - 6 * s, 2.5, 2.5, '#ff6b6b'); }
  }
  function drawTinyShroom(ctx, x, y) {
    ctx.fillStyle = '#fff1d6'; ctx.fillRect(x - 2, y - 8, 4, 8);
    ctx.fillStyle = '#e8505b'; ctx.beginPath(); ctx.arc(x, y - 8, 7, Math.PI, 0); ctx.fill();
    ell(ctx, x - 2, y - 11, 1.6, 1.4, '#fff'); ell(ctx, x + 3, y - 10, 1.2, 1.1, '#fff');
  }
  function drawTree(ctx, x, y, rnd) {
    const s = 0.9 + rnd() * 0.5;
    ctx.fillStyle = '#8a5a32'; ctx.strokeStyle = '#4e2e17'; ctx.lineWidth = 2;
    rr(ctx, x - 7 * s, y - 60 * s, 14 * s, 60 * s, 4); ctx.fill(); ctx.stroke();
    ell(ctx, x, y - 75 * s, 36 * s, 28 * s, '#4fae3e', '#2f6f2a', 2.5);
    ell(ctx, x - 20 * s, y - 62 * s, 22 * s, 18 * s, '#5fc24a', '#2f6f2a', 2.5);
    ell(ctx, x + 22 * s, y - 64 * s, 22 * s, 18 * s, '#5fc24a', '#2f6f2a', 2.5);
    ell(ctx, x - 6 * s, y - 88 * s, 14 * s, 8 * s, 'rgba(220,255,170,0.5)');
  }
  function drawSign(ctx, x, y) {
    ctx.fillStyle = '#8a5a32'; ctx.strokeStyle = '#4e2e17'; ctx.lineWidth = 2;
    rr(ctx, x - 4, y - 70, 8, 70, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c4884a';
    ctx.beginPath(); ctx.moveTo(x - 34, y - 68); ctx.lineTo(x + 26, y - 68); ctx.lineTo(x + 38, y - 58); ctx.lineTo(x + 26, y - 48); ctx.lineTo(x - 34, y - 48); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 30, y - 44); ctx.lineTo(x - 30, y - 44); ctx.lineTo(x - 42, y - 34); ctx.lineTo(x - 30, y - 24); ctx.lineTo(x + 30, y - 24); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#4e2e17'; ctx.font = 'bold 10px Fredoka, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('MEADOW', x - 2, y - 54); ctx.fillText('SPAWN', x, y - 30);
  }

  // parallax layers
  function buildMountains() {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 360;
    const ctx = c.getContext('2d'); const rnd = seeded(7);
    const layer = (base, amp, color, snow) => {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, 360);
      const peaks = [];
      for (let x = 0; x <= 1600; x += 160) {
        const py = base - amp * (0.5 + rnd() * 0.5);
        peaks.push([x + 80, py]);
      }
      ctx.lineTo(0, base);
      for (let i = 0; i < peaks.length; i++) {
        const [px, py] = peaks[i];
        ctx.lineTo(px, py); ctx.lineTo(Math.min(1600, px + 80), base - amp * 0.25);
      }
      ctx.lineTo(1600, base); ctx.lineTo(1600, 360); ctx.closePath(); ctx.fill();
      if (snow) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (const [px, py] of peaks) {
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - 24, py + 30); ctx.lineTo(px - 8, py + 24); ctx.lineTo(px, py + 34); ctx.lineTo(px + 10, py + 24); ctx.lineTo(px + 24, py + 30); ctx.closePath(); ctx.fill();
        }
      }
    };
    layer(240, 200, '#a9c8ef', true);
    layer(300, 140, '#8fb6e8', false);
    return c;
  }
  function buildHills() {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 420;
    const ctx = c.getContext('2d'); const rnd = seeded(99);
    ctx.fillStyle = '#9fdc7a';
    ctx.beginPath(); ctx.moveTo(0, 420); ctx.lineTo(0, 140);
    for (let x = 0; x <= 1600; x += 200) ctx.quadraticCurveTo(x + 100, 60 + rnd() * 60, x + 200, 140);
    ctx.lineTo(1600, 420); ctx.closePath(); ctx.fill();
    // round trees on the hills
    for (let i = 0; i < 26; i++) {
      const x = rnd() * 1600, y = 150 + rnd() * 120, s = 0.6 + rnd() * 0.7;
      ctx.fillStyle = '#6b8f4a'; ctx.fillRect(x - 3 * s, y - 10 * s, 6 * s, 26 * s);
      ell(ctx, x, y - 22 * s, 22 * s, 26 * s, i % 3 ? '#5fb04a' : '#4fa03e');
      ell(ctx, x - 6 * s, y - 32 * s, 8 * s, 6 * s, 'rgba(220,255,170,0.4)');
    }
    ctx.fillStyle = '#7cc95c';
    ctx.beginPath(); ctx.moveTo(0, 420); ctx.lineTo(0, 260);
    for (let x = 0; x <= 1600; x += 260) ctx.quadraticCurveTo(x + 130, 210 + rnd() * 40, x + 260, 260);
    ctx.lineTo(1600, 420); ctx.closePath(); ctx.fill();
    // a little river
    ctx.fillStyle = '#7fd0ff';
    ctx.beginPath(); ctx.moveTo(0, 360); ctx.quadraticCurveTo(400, 330, 800, 365); ctx.quadraticCurveTo(1200, 395, 1600, 360);
    ctx.lineTo(1600, 380); ctx.quadraticCurveTo(1200, 415, 800, 385); ctx.quadraticCurveTo(400, 350, 0, 380); ctx.closePath(); ctx.fill();
    return c;
  }

  function drawCloud(ctx, x, y, s) {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ell(ctx, x, y, 40 * s, 22 * s, '#fff');
    ell(ctx, x - 34 * s, y + 6 * s, 28 * s, 16 * s, '#fff');
    ell(ctx, x + 36 * s, y + 6 * s, 30 * s, 17 * s, '#fff');
    ell(ctx, x + 10 * s, y - 14 * s, 26 * s, 18 * s, '#fff');
    ell(ctx, x, y + 10 * s, 60 * s, 10 * s, '#e9f4ff');
  }

  // ---------------------------------------------------------------- Wild Realms emblem
  // A gold-rimmed shield framing a sunny sky, snowy peaks, rolling hills and a cute slime with a leaf sprout.
  // Drawn in a 100x100 design space and scaled to `size` pixels; the background stays transparent.
  function drawEmblem(ctx, size) {
    ctx.save();
    ctx.scale(size / 100, size / 100);
    const shield = () => {
      ctx.beginPath();
      ctx.moveTo(50, 5);
      ctx.bezierCurveTo(68, 5, 84, 8, 91, 13);
      ctx.lineTo(91, 47);
      ctx.bezierCurveTo(91, 71, 74, 87, 50, 96);
      ctx.bezierCurveTo(26, 87, 9, 71, 9, 47);
      ctx.lineTo(9, 13);
      ctx.bezierCurveTo(16, 8, 32, 5, 50, 5);
      ctx.closePath();
    };
    // soft drop shadow
    ctx.save(); ctx.translate(0, 2.5); shield(); ctx.fillStyle = 'rgba(60,20,100,0.35)'; ctx.fill(); ctx.restore();
    // scene, clipped to the shield
    ctx.save();
    shield(); ctx.clip();
    const sky = ctx.createLinearGradient(0, 5, 0, 70);
    sky.addColorStop(0, '#5fb6f2'); sky.addColorStop(1, '#d4f0ff');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 100, 100);
    const sun = ctx.createRadialGradient(72, 24, 2, 72, 24, 18);
    sun.addColorStop(0, 'rgba(255,250,210,1)'); sun.addColorStop(0.45, 'rgba(255,236,150,0.8)'); sun.addColorStop(1, 'rgba(255,236,150,0)');
    ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(72, 24, 18, 0, Math.PI * 2); ctx.fill();
    // little cloud
    ell(ctx, 28, 24, 8, 4.5, '#ffffff'); ell(ctx, 22, 26, 5.5, 3.5, '#ffffff'); ell(ctx, 34, 26, 6, 3.5, '#ffffff');
    // snowy mountains
    ctx.fillStyle = '#9bbfeb';
    ctx.beginPath(); ctx.moveTo(-5, 62); ctx.lineTo(22, 34); ctx.lineTo(40, 52); ctx.lineTo(58, 30); ctx.lineTo(84, 56); ctx.lineTo(105, 44); ctx.lineTo(105, 70); ctx.lineTo(-5, 70); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(58, 30); ctx.lineTo(52, 37); ctx.lineTo(56, 36); ctx.lineTo(58, 39); ctx.lineTo(61, 36); ctx.lineTo(64, 37); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(22, 34); ctx.lineTo(17, 40); ctx.lineTo(21, 39); ctx.lineTo(23, 41); ctx.lineTo(27, 39); ctx.closePath(); ctx.fill();
    // rolling hills with round trees
    ctx.fillStyle = '#8fd36b';
    ctx.beginPath(); ctx.moveTo(-5, 66); ctx.quadraticCurveTo(25, 50, 50, 62); ctx.quadraticCurveTo(75, 52, 105, 64); ctx.lineTo(105, 100); ctx.lineTo(-5, 100); ctx.closePath(); ctx.fill();
    for (const [tx, ty, ts] of [[20, 58, 1], [82, 58, 0.9], [70, 61, 0.7]]) {
      ctx.fillStyle = '#6b8f4a'; ctx.fillRect(tx - 0.8 * ts, ty, 1.6 * ts, 6 * ts);
      ell(ctx, tx, ty - 1, 4.5 * ts, 5.5 * ts, '#5fb04a');
    }
    ctx.fillStyle = '#6cc644';
    ctx.beginPath(); ctx.moveTo(-5, 78); ctx.quadraticCurveTo(30, 68, 55, 76); ctx.quadraticCurveTo(80, 70, 105, 78); ctx.lineTo(105, 100); ctx.lineTo(-5, 100); ctx.closePath(); ctx.fill();
    // flowers
    for (const [fx, fy, c] of [[16, 82, '#ff7eb6'], [86, 80, '#ffd34d'], [26, 88, '#ffffff'], [76, 88, '#ff8a5c']]) {
      for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; ell(ctx, fx + Math.cos(a) * 1.6, fy + Math.sin(a) * 1.6, 1.3, 1.3, c); }
      ell(ctx, fx, fy, 1, 1, '#ffb84d');
    }
    ctx.restore();

    // hero slime with a leaf sprout
    ctx.save();
    ctx.translate(50, 86);
    ell(ctx, 0, 0.5, 17, 3, 'rgba(0,0,0,0.18)');
    const w = 17, h = 26;
    const body = ctx.createLinearGradient(0, -h, 0, 0);
    body.addColorStop(0, '#a6ef7c'); body.addColorStop(1, '#4fae3e');
    ctx.fillStyle = body; ctx.strokeStyle = '#2f6f2a'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-w, 0);
    ctx.bezierCurveTo(-w * 1.05, -h * 0.75, -w * 0.45, -h, 0, -h);
    ctx.bezierCurveTo(w * 0.45, -h, w * 1.05, -h * 0.75, w, 0);
    ctx.quadraticCurveTo(0, 3, -w, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ell(ctx, -7, -19, 4, 2.6, 'rgba(255,255,255,0.7)');
    // face
    for (const ex of [-5.5, 5.5]) { ell(ctx, ex, -11, 2.4, 3.2, '#2a1e2a'); ell(ctx, ex + 0.8, -12.3, 0.9, 1.1, '#ffffff'); }
    ell(ctx, -10, -7, 2.2, 1.3, 'rgba(255,120,140,0.55)'); ell(ctx, 10, -7, 2.2, 1.3, 'rgba(255,120,140,0.55)');
    ctx.strokeStyle = '#5a2a2a'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, -7.5, 2.2, 0.15, Math.PI - 0.15); ctx.stroke();
    // sprout
    ctx.strokeStyle = '#3f8f3a'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -h + 0.5); ctx.quadraticCurveTo(1.5, -h - 4, 0, -h - 7); ctx.stroke(); ctx.lineCap = 'butt';
    ctx.save(); ctx.translate(0, -h - 6.5);
    ctx.save(); ctx.rotate(-0.5); ell(ctx, -4, 0, 4.5, 2.4, '#7fd36b', '#2f6f2a', 1); ctx.restore();
    ctx.save(); ctx.rotate(0.45); ell(ctx, 4, -0.5, 4.5, 2.4, '#5fb85a', '#2f6f2a', 1); ctx.restore();
    ctx.restore();
    ctx.restore();

    // rim: purple outer edge, gold band, light inner line
    shield(); ctx.lineJoin = 'round';
    ctx.strokeStyle = '#6b3fa0'; ctx.lineWidth = 8; ctx.stroke();
    ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 4.5; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,248,210,0.9)'; ctx.lineWidth = 1.2; ctx.stroke();
    // gem at the top of the rim and sparkles
    ell(ctx, 50, 5, 4.2, 4.2, '#e8505b', '#6b3fa0', 1.4);
    ell(ctx, 48.8, 3.8, 1.2, 1.2, 'rgba(255,255,255,0.85)');
    drawStar(ctx, 90, 9, 4, '#fff6c8'); drawStar(ctx, 11, 60, 2.6, '#fff6c8');
    ctx.restore();
  }

  window.Render = {
    rr, ell, shade, drawStar, drawEmblem, drawChibi, drawMonster, drawSpirit, drawTreeSpirit, drawTrap, drawWolf, drawScarab, drawPotion, buildTerrain, buildMountains, buildHills, drawCloud,
  };
})();
