# Wild Realms

A cute chibi fantasy 2D platformer in the browser. Up to **10 heroes at a time** share one map,
hunting monsters that spawn on their own. Everyone who helps take down a monster earns score and XP
in proportion to how much they contributed.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000. To test multiplayer, open a second browser window (or another
device on your network at `http://<your-ip>:3000`) and log in with a different character.

Requires Node.js 22.13+ (it uses the built-in `node:sqlite`, so there is nothing native to compile).

## Deploy online (Render)

The game needs a running Node server for logins, the database and real-time play, so it can't be
hosted on static sites like GitHub Pages. This repo includes a `render.yaml` blueprint for
[Render](https://render.com):

1. Sign in to Render with GitHub.
2. Click **New + → Blueprint** and pick this repository. Render reads `render.yaml` and deploys it.
3. Share the `https://chibi-realms-xxxx.onrender.com` URL it gives you.

Notes on the free plan: the service sleeps after about 15 minutes with nobody playing, so the first
visit after that takes up to a minute to load. The free plan also has **no persistent disk**, so
accounts and progress reset whenever the service restarts or redeploys. To keep them, upgrade the
plan, attach a disk mounted at `/var/data`, and set the `DATA_DIR=/var/data` environment variable
(see the comment in `render.yaml`).

## Gameplay

| Key | Action |
| --- | --- |
| ← → | Move |
| Space (or Alt) | Jump |
| ↑ ↓ | Climb ladders |
| ↓ + Space | Drop through a platform |
| A Z X C V (or 1–5) | Class skills (A is the basic attack) |
| Enter | Chat |
| Tab | Show or hide the online list |

**Classes** (skills listed in key order A, Z, X, C, V)
- **Fighter**: Slash, Charge (dash forward, knocking back and briefly stunning everything in the path), Shield Bash (stun), Whirlwind (area attack), Iron Will (10s of −60% damage taken plus 10% HP regen). Most HP and armor.
- **Mage**: Fireball (explodes), Chain Lightning (chains to 3 enemies), Frost Nova (freeze), Teleport (blink sideways, or up/down to the next platform, using the arrow keys), Magic Shield (4s dome; you and allies inside are invulnerable). Low HP.
- **Rogue**: Backstab (always crits from behind or from stealth; ×3.5 from stealth, ×1.5 from behind), Knife Throw (ranged single-target), Stealth (untouchable for 5s), Dodge Roll (invulnerable), Fan of Knives (hits all nearby foes, then 1.5s invulnerable). Fastest class.
- **Marksman**: Arrow, Multishot (5-arrow fan), Trap (up to 3; triggers a random freeze, explosion or poison), Disengage (leap back and knock enemies away), Headshot (huge piercing shot that explodes on each hit; targets take 30% more damage for 6s).
- **Druid**: Thorn Seed (slows), Tree Spirit (plant a seed that grows into a stationary fighting tree after 10s; trees can be attacked; up to 3), Entangle (roots enemies in place), Rejuvenate (heals allies in range), Monsoon (6s of healing rain over a large area).
- **Beyonder**: masked void sorcerer with two weapon forms, swapped with **V (Transmogrify)**. Each form's A/Z/X/C keep their own cooldowns. *Rod:* Void Bolt, Curse (damage over time), Black Tentacles (slowing, damaging pool), Void Portal (press twice to open a linked pair for 10s; allies travel with ↑). *Sword:* Void Slash, Phase Dash (invulnerable dash strike), Spectral Hound (12s ally that heals you for 30% of its damage), Hex Armor (40% dodge for 8s).
- **Paladin**: Holy Strike (single-target; every 10s it becomes Divine Strike for triple damage and a stun), Holy Auras (always-on aura for nearby allies; press to cycle Bulwark −20% damage taken → Zephyr +20% speed and faster basic attacks → Life 5% heal every 5s → Vengeance +15% damage), Divine Bulwark (block the next 2 hits), Righteous Cry (taunt nearby enemies for 4s), Guardian Spirits (6s holy aura that damages nearby foes). Golden armor, the team protector.

**Passives** (always on; shown in the round **P** slot next to the skill bar)
- **Fighter — Battle Fury**: killing an enemy grants +25% damage for 6s.
- **Mage — Arcane Prowess**: killing an enemy takes 2s off all your cooldowns.
- **Rogue — Haste**: any skill except Backstab grants +30% movement speed for 6s.
- **Marksman — Wild Friend**: a wolf follows you, attacks what you attack and scales with your level. If it dies it returns after 30s.
- **Druid — Nature Fairy**: every 6s it attacks the nearest enemy in range, or (with none nearby) heals you or the closest hurt ally for 12% HP.
- **Beyonder — Scarab Swarm**: every kill summons a void scarab that roams its platform attacking enemies until it dies (up to 6).
- **Paladin — Invincible**: dropping to 10% HP or below (even from a killing blow) makes you immune to all damage for 6s. 120s cooldown.

**Scoring**: when a monster dies, its score and XP are split among everyone who damaged it, by their
share of the damage. Crowd control (stun, freeze, root, slow) adds bonus credit. The last hit counts
as a *kill* and everyone else gets an *assist*. Healers (Druid heals, Monsoon, and the Paladin's Aura of Life) also earn score for healing other players, and the Paladin's taunt counts as crowd control.
The **King Slime** boss shows up every few minutes, with HP that scales with the number of players online.

## Project layout

```
server.js            Express REST API (register/login/characters/leaderboard) + Socket.io
server/store.js      SQLite database (data/game.db): users, sessions, characters
server/game.js       Server-side simulation: monsters, abilities, damage, rewards, 10-player cap
public/index.html    Login, character select and create screens, plus the game HUD
public/js/shared.js  Map, classes, monsters and the XP curve (used by both server and client)
public/js/render.js  Procedurally drawn chibi characters, monsters and world art
public/js/game.js    Client loop: physics, input, interpolation, effects, HUD
public/js/app.js     Menu screens and API calls
```

The server decides all combat: abilities, cooldowns, monster HP, damage and rewards. Clients send
only their position and which skill they pressed. Passwords are hashed with scrypt, and sessions are
random 64-character tokens that expire after 30 days. Progress is saved after each level-up, every
30 seconds, and when a player disconnects.

Settings you can change: `PORT` env var (default 3000), `MAX_PLAYERS` and the map layout in
`public/js/shared.js`, and spawn and boss timing in `server/game.js`.
