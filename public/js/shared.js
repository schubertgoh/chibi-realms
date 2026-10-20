// Shared game data — loaded by both the Node server (require) and the browser (window.Shared).
(function () {
  const MAX_PLAYERS = 10;
  const MAX_CHARACTERS_PER_ACCOUNT = 5;
  const MAX_LEVEL = 50;

  const WORLD = { w: 3200, h: 1400, gravity: 2000 };
  const SPAWN = { x: 1600, y: 1200 };

  // y = top (walkable) surface. Floating platforms are one-way (jump up through them).
  const PLATFORMS = [
    { x: 0, y: 1200, w: 3200, ground: true },
    { x: 200, y: 1020, w: 500 }, { x: 1000, y: 1020, w: 500 }, { x: 1800, y: 1020, w: 500 }, { x: 2600, y: 1020, w: 450 },
    { x: 450, y: 840, w: 500 }, { x: 1350, y: 840, w: 550 }, { x: 2200, y: 840, w: 550 },
    { x: 100, y: 660, w: 500 }, { x: 900, y: 660, w: 500 }, { x: 1700, y: 660, w: 500 }, { x: 2500, y: 660, w: 600 },
    { x: 600, y: 480, w: 500 }, { x: 1450, y: 480, w: 500 }, { x: 2250, y: 480, w: 450 },
    { x: 1100, y: 300, w: 1000 },
  ];

  // Ladders connect a platform (top) with the one below it (bottom).
  const LADDERS = [
    { x: 450, top: 1020, bottom: 1200 }, { x: 1250, top: 1020, bottom: 1200 },
    { x: 2050, top: 1020, bottom: 1200 }, { x: 2800, top: 1020, bottom: 1200 },
    { x: 600, top: 840, bottom: 1020 }, { x: 1450, top: 840, bottom: 1020 }, { x: 2250, top: 840, bottom: 1020 },
    { x: 500, top: 660, bottom: 840 }, { x: 1380, top: 660, bottom: 840 },
    { x: 1800, top: 660, bottom: 840 }, { x: 2650, top: 660, bottom: 840 },
    { x: 1000, top: 480, bottom: 660 }, { x: 1750, top: 480, bottom: 660 }, { x: 2600, top: 480, bottom: 660 },
    { x: 1500, top: 300, bottom: 480 },
  ];

  const HAIR_COLORS = ['#5a3825', '#f2c94c', '#e86a5c', '#6c8cff', '#f59fd0', '#3b3b4f', '#f4f4f4', '#7ed957'];

  const CLASSES = {
    fighter: {
      name: 'Fighter', color: '#5b8def', hp: 230, armor: 0.3, speed: 230, jump: 900,
      desc: 'Armored frontliner with sword and shield. The toughest hero in the realm.',
      skills: [
        { name: 'Slash', icon: '⚔️', cd: 0.45, desc: 'Swing your sword in front of you.' },
        { name: 'Shield Bash', icon: '🛡️', cd: 5, desc: 'Bash and stun enemies in front.' },
        { name: 'Whirlwind', icon: '🌀', cd: 8, desc: 'Spin and hit everything around you.' },
        { name: 'Iron Wall', icon: '🏰', cd: 15, desc: 'Take 60% less damage for 5s.' },
      ],
    },
    mage: {
      name: 'Mage', color: '#9b6cf0', hp: 95, armor: 0, speed: 240, jump: 900,
      desc: 'Frail but devastating spellcaster of fire, lightning and frost.',
      skills: [
        { name: 'Fireball', icon: '🔥', cd: 0.7, desc: 'Hurl an exploding ball of fire.' },
        { name: 'Lightning Bolt', icon: '⚡', cd: 4, desc: 'Chain lightning through up to 3 foes.' },
        { name: 'Frost Nova', icon: '❄️', cd: 10, desc: 'Freeze nearby enemies solid.' },
        { name: 'Slow Field', icon: '🌨️', cd: 12, desc: 'Conjure a blizzard that slows foes.' },
      ],
    },
    rogue: {
      name: 'Rogue', color: '#d65a7a', hp: 120, armor: 0.05, speed: 330, jump: 980,
      desc: 'Lightning-fast shadow. Stealth, dodge and devastating backstabs.',
      skills: [
        { name: 'Backstab', icon: '🗡️', cd: 0.3, desc: 'Quick stab. Huge damage from stealth or behind.' },
        { name: 'Stealth', icon: '👤', cd: 10, desc: 'Vanish for 5s — monsters cannot hurt you.' },
        { name: 'Dodge Roll', icon: '💨', cd: 3, desc: 'Roll forward, invulnerable.' },
        { name: 'Shadow Step', icon: '🌑', cd: 8, desc: 'Teleport behind the nearest foe.' },
      ],
    },
    marksman: {
      name: 'Marksman', color: '#4fae5a', hp: 125, armor: 0.05, speed: 260, jump: 900,
      desc: 'Sharp-eyed archer who rains arrows from afar.',
      skills: [
        { name: 'Arrow', icon: '🏹', cd: 0.4, desc: 'Fire a swift arrow.' },
        { name: 'Multishot', icon: '🎯', cd: 5, desc: 'Fire a fan of five arrows.' },
        { name: 'Piercing Shot', icon: '💥', cd: 7, desc: 'A powerful arrow that pierces all foes.' },
        { name: 'Disengage', icon: '🦘', cd: 6, desc: 'Leap back and knock enemies away.' },
      ],
    },
    druid: {
      name: 'Druid', color: '#c98b3a', hp: 140, armor: 0.1, speed: 250, jump: 900,
      desc: 'Guardian of nature. Crowd control, healing and spirit allies.',
      skills: [
        { name: 'Thorn Seed', icon: '🌱', cd: 0.6, desc: 'Throw a seed that slows its target.' },
        { name: 'Entangle', icon: '🌿', cd: 8, desc: 'Roots burst out and hold enemies in place.' },
        { name: 'Rejuvenate', icon: '💚', cd: 6, desc: 'Heal yourself and nearby allies.' },
        { name: 'Nature Spirit', icon: '🦊', cd: 18, desc: 'Summon a spirit fox to fight for 15s.' },
      ],
    },
  };

  const MONSTERS = {
    slime: { name: 'Slime', hp: 70, dmg: 10, speed: 70, w: 44, h: 36, xp: 12, score: 10 },
    mushroom: { name: 'Mushroom', hp: 110, dmg: 14, speed: 85, w: 46, h: 52, xp: 20, score: 18 },
    stump: { name: 'Stumpy', hp: 200, dmg: 20, speed: 55, w: 56, h: 60, xp: 35, score: 30 },
    kingslime: { name: 'King Slime', hp: 2000, dmg: 28, speed: 60, w: 150, h: 120, xp: 600, score: 500, boss: true },
  };

  // Total XP needed to reach `level` from level 1.
  function xpForLevel(level) {
    let total = 0;
    for (let l = 1; l < level; l++) total += 50 + (l - 1) * 40 + (l - 1) * (l - 1) * 10;
    return total;
  }
  function levelFromXp(xp) {
    let l = 1;
    while (l < MAX_LEVEL && xp >= xpForLevel(l + 1)) l++;
    return l;
  }
  function playerStats(cls, level) {
    const c = CLASSES[cls];
    return {
      maxHp: Math.round(c.hp * (1 + 0.08 * (level - 1))),
      dmgMult: 1 + 0.07 * (level - 1),
      armor: c.armor, speed: c.speed, jump: c.jump,
    };
  }

  const Shared = {
    MAX_PLAYERS, MAX_CHARACTERS_PER_ACCOUNT, MAX_LEVEL, WORLD, SPAWN, PLATFORMS, LADDERS,
    HAIR_COLORS, CLASSES, MONSTERS, xpForLevel, levelFromXp, playerStats,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Shared;
  else window.Shared = Shared;
})();
