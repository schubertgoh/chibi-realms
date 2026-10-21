// Shared game data — loaded by both the Node server (require) and the browser (window.Shared).
(function () {
  const MAX_PLAYERS = 10;
  const MAX_CHARACTERS_PER_ACCOUNT = 5;
  const MAX_LEVEL = 50;
  const RESPAWN_SECONDS = 10;

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

  // Skill slots: 0 = A (primary), 1 = Z, 2 = X, 3 = C, 4 = V
  const SKILL_LABELS = ['A', 'Z', 'X', 'C', 'V'];

  const CLASSES = {
    fighter: {
      name: 'Fighter', color: '#5b8def', hp: 230, armor: 0.3, speed: 230, jump: 900,
      desc: 'Armored frontliner with sword and shield. The toughest hero in the realm.',
      skills: [
        { name: 'Slash', icon: '⚔️', cd: 0.45, desc: 'Swing your sword in front of you.' },
        { name: 'Charge', icon: '🐗', cd: 7, desc: 'Dash forward, knocking back and briefly stunning every enemy in your path.' },
        { name: 'Shield Bash', icon: '🛡️', cd: 5, desc: 'Bash and stun enemies in front.' },
        { name: 'Whirlwind', icon: '🌀', cd: 8, desc: 'Spin and hit everything around you.' },
        { name: 'Iron Will', icon: '🏰', cd: 22, desc: 'For 10s take 60% less damage and regenerate 10% of your HP.' },
      ],
    },
    mage: {
      name: 'Mage', color: '#9b6cf0', hp: 95, armor: 0, speed: 240, jump: 900,
      desc: 'Frail but devastating spellcaster of fire, lightning and frost.',
      skills: [
        { name: 'Fireball', icon: '🔥', cd: 0.7, desc: 'Hurl an exploding ball of fire.' },
        { name: 'Chain Lightning', icon: '⚡', cd: 4, desc: 'Chain lightning through up to 3 foes.' },
        { name: 'Frost Nova', icon: '❄️', cd: 10, desc: 'Freeze nearby enemies solid.' },
        { name: 'Teleport', icon: '🌀', cd: 5, desc: 'Blink a short distance in the arrow-key direction (forward if none). Works up and down too.' },
        { name: 'Magic Shield', icon: '🔮', cd: 24, desc: 'Raise a 4s dome — you and allies inside are invulnerable.' },
      ],
    },
    rogue: {
      name: 'Rogue', color: '#d65a7a', hp: 120, armor: 0.05, speed: 330, jump: 980,
      desc: 'Lightning-fast shadow. Stealth, dodge and devastating backstabs.',
      skills: [
        { name: 'Backstab', icon: '🗡️', cd: 0.3, desc: 'Quick stab. Always crits from behind or from stealth (huge damage from stealth).' },
        { name: 'Knife Throw', icon: '🔪', cd: 2.5, desc: 'Throw a knife that hits the first enemy in its path.' },
        { name: 'Stealth', icon: '👤', cd: 10, desc: 'Vanish for 5s — monsters cannot hurt you.' },
        { name: 'Dodge Roll', icon: '💨', cd: 3, desc: 'Roll forward, invulnerable.' },
        { name: 'Fan of Knives', icon: '✴️', cd: 16, desc: 'Blast knives at all nearby foes, then become invulnerable for 1.5s.' },
      ],
    },
    marksman: {
      name: 'Marksman', color: '#4fae5a', hp: 125, armor: 0.05, speed: 260, jump: 900,
      desc: 'Sharp-eyed archer who rains arrows from afar.',
      skills: [
        { name: 'Arrow', icon: '🏹', cd: 0.4, desc: 'Fire a swift arrow.' },
        { name: 'Multishot', icon: '🎯', cd: 5, desc: 'Fire a fan of five arrows.' },
        { name: 'Trap', icon: '🪤', cd: 10, desc: 'Place a trap (max 3). The first enemy to step on it is frozen, blown up, or poisoned — at random.' },
        { name: 'Disengage', icon: '🦘', cd: 6, desc: 'Leap back and knock enemies away.' },
        { name: 'Headshot', icon: '💥', cd: 12, desc: 'A huge piercing shot that explodes on each hit. Targets take 30% more damage for 6s.' },
      ],
    },
    druid: {
      name: 'Druid', color: '#c98b3a', hp: 140, armor: 0.1, speed: 250, jump: 900,
      desc: 'Guardian of nature. Crowd control, healing and living trees.',
      skills: [
        { name: 'Thorn Seed', icon: '🌱', cd: 0.6, desc: 'Throw a seed that slows its target.' },
        { name: 'Tree Spirit', icon: '🌳', cd: 14, desc: 'Plant a seed that grows into a fighting tree after 10s. Trees can be attacked (max 3).' },
        { name: 'Entangle', icon: '🌿', cd: 8, desc: 'Roots burst out and hold enemies in place.' },
        { name: 'Rejuvenate', icon: '💚', cd: 6, desc: 'Heal yourself and nearby allies.' },
        { name: 'Monsoon', icon: '🌧️', cd: 22, desc: 'Summon a large healing rain for 6s that heals all allies inside it.' },
      ],
    },
    paladin: {
      name: 'Paladin', color: '#e0a82e', hp: 190, armor: 0.2, speed: 235, jump: 900,
      desc: 'Holy warrior in golden armor. Protects allies with auras and taunts, and smites the wicked.',
      skills: [
        { name: 'Holy Strike', icon: '🔨', cd: 0.5, desc: 'Mace hit on one target. Every 10s it becomes Divine Strike: triple damage and a stun.' },
        { name: 'Holy Auras', icon: '🛡️', cd: 3, desc: 'Always-on aura for you and nearby allies. Press to switch: Bulwark → Zephyr → Life → Vengeance.' },
        { name: 'Divine Bulwark', icon: '🔆', cd: 10, desc: 'A holy shield that completely blocks the next 2 hits.' },
        { name: 'Righteous Cry', icon: '📣', cd: 8, desc: 'Taunt all nearby enemies to attack you for 4s.' },
        { name: 'Guardian Spirits', icon: '👼', cd: 18, desc: 'For 6s, holy spirits swirl around you, damaging nearby foes.' },
      ],
    },
  };

  // Beyonder: two weapon forms. `skills` is the rod form; `altSkills` replaces slots 0-3 in sword form.
  // Each form's A/Z/X/C has its own cooldown; V (Transmogrify) is shared.
  CLASSES.beyonder = {
    name: 'Beyonder', color: '#7b3fd6', hp: 115, armor: 0.05, speed: 245, jump: 900,
    desc: 'Masked void sorcerer who wields a dark rod or a hex sword and calls creatures from beyond.',
    skills: [
      { name: 'Void Bolt', icon: '🟣', cd: 0.6, desc: 'Fire a bolt of dark energy from your rod.' },
      { name: 'Curse', icon: '💀', cd: 8, desc: 'Curse the nearest enemy, dealing heavy damage over 5s.' },
      { name: 'Black Tentacles', icon: '🦑', cd: 12, desc: 'Summon a pool of tentacles for 5s that slows and damages enemies inside.' },
      { name: 'Void Portal', icon: '🌀', cd: 20, desc: 'Press to place a portal, press again for its twin. For 10s any ally can travel between them with ↑.' },
      { name: 'Transmogrify', icon: '🔄', cd: 2, desc: 'Switch between your dark rod and hex sword.' },
    ],
    altSkills: [
      { name: 'Void Slash', icon: '🗡️', cd: 0.45, desc: 'Slash a single enemy in front with your hex sword.' },
      { name: 'Phase Dash', icon: '💨', cd: 7, desc: 'Dash forward, invulnerable, striking every enemy in your path.' },
      { name: 'Spectral Hound', icon: '🐕', cd: 16, desc: 'Summon a ghost hound for 12s. You heal for 30% of the damage it deals.' },
      { name: 'Hex Armor', icon: '🔮', cd: 18, desc: 'For 8s, 40% chance to dodge incoming attacks.' },
    ],
  };
  const MAX_SCARABS = 6;
  // Skill definition for a class/form/slot (Beyonder sword form swaps slots 0-3).
  function skillDef(cls, form, slot) {
    const c = CLASSES[cls];
    return form === 'sword' && c.altSkills && c.altSkills[slot] ? c.altSkills[slot] : c.skills[slot];
  }
  // Cooldown slot: Beyonder sword skills use slots 5-8 so both forms keep separate cooldowns.
  function cdIndex(cls, form, slot) {
    return cls === 'beyonder' && form === 'sword' && slot < 4 ? slot + 5 : slot;
  }
  const COOLDOWN_SLOTS = 9;

  // Paladin auras (cycled with Holy Auras). Bits are used in the network snapshot.
  const AURAS = [
    { key: 'bulwark', name: 'Aura of Bulwark', icon: '🛡️', color: '#8fb8ff', desc: 'You and nearby allies take 20% less damage.' },
    { key: 'zephyr', name: 'Aura of Zephyr', icon: '🌬️', color: '#b8f5e0', desc: '+20% movement speed and 25% faster basic attacks.' },
    { key: 'life', name: 'Aura of Life', icon: '💚', color: '#7ee08a', desc: 'Heals you and nearby allies for 5% HP every 5s.' },
    { key: 'vengeance', name: 'Aura of Vengeance', icon: '🔥', color: '#ff7a5c', desc: 'You and nearby allies deal 15% more damage.' },
  ];
  const AURA_BITS = { bulwark: 1, zephyr: 2, life: 4, vengeance: 8 };
  const AURA_RADIUS = 240;
  const AURA_EFFECTS = { bulwarkDamageTaken: 0.8, zephyrSpeed: 1.2, zephyrAttackCd: 0.75, lifeHealFrac: 0.05, vengeanceDamage: 1.15 };
  const EXPOSED_MULT = 1.3; // Headshot debuff
  const MAX_TRAPS = 3;
  const MAX_TREES = 3;

  // Class passives (always on). Numbers live in PASSIVE so server and client agree.
  const PASSIVE = { furyDamage: 1.25, arcaneCdMs: 2000, hasteSpeed: 1.3 };
  const PASSIVES = {
    fighter: { name: 'Battle Fury', icon: '💢', desc: 'Killing an enemy grants +25% damage for 6s.' },
    mage: { name: 'Arcane Prowess', icon: '✨', desc: 'Killing an enemy reduces all your cooldowns by 2s.' },
    rogue: { name: 'Haste', icon: '👟', desc: 'Casting any skill except Backstab grants +30% movement speed for 6s.' },
    marksman: { name: 'Wild Friend', icon: '🐺', desc: 'A wolf follows you, attacks what you attack and levels up with you. If it dies it returns after 30s.' },
    druid: { name: 'Nature Fairy', icon: '🧚', desc: 'Every 6s your fairy attacks a nearby enemy — or, with none in range, heals you or the nearest hurt ally.' },
    beyonder: { name: 'Scarab Swarm', icon: '🪲', desc: 'Every kill summons a void scarab that roams and attacks enemies until it dies (up to 6).' },
    paladin: { name: 'Invincible', icon: '🌟', desc: 'Dropping to 10% HP or below makes you immune to all damage for 6s. 120s cooldown.' },
  };
  for (const k of Object.keys(PASSIVES)) CLASSES[k].passive = PASSIVES[k];

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
    MAX_PLAYERS, MAX_CHARACTERS_PER_ACCOUNT, MAX_LEVEL, RESPAWN_SECONDS, WORLD, SPAWN, PLATFORMS, LADDERS,
    HAIR_COLORS, CLASSES, MONSTERS, SKILL_LABELS, AURAS, AURA_BITS, AURA_RADIUS, AURA_EFFECTS, EXPOSED_MULT, MAX_TRAPS, MAX_TREES, PASSIVE, MAX_SCARABS, skillDef, cdIndex, COOLDOWN_SLOTS, xpForLevel, levelFromXp, playerStats,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Shared;
  else window.Shared = Shared;
})();
