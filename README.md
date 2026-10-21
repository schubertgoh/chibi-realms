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

## AI companions

Whenever at least one real player is online, two AI heroes join the realm: **Pip** (a cheerful Druid
healer) and **Brakka** (a gruff Fighter). They move around, climb ladders, fight monsters with their
class skills, heal and protect you, and chat. They're marked with 🤖, and they leave when the last
real player does. They also give up their slot if the realm fills up.

**Talk to them in chat** by mentioning a name, or use `@all` / `everyone` for both:

- `Pip, stay with me and heal me`
- `Brakka go hunt monsters and tell me how many kills you get`
- `@all the King Slime is up, let's go!`
- `Brakka use Whirlwind` · `Pip go to the top platform on the right` · `everyone fall back`

Each companion has two layers:

- **Autopilot** (`server/bots.js`). It runs every server tick. It handles movement physics, finds its
  way between floors, aims, and runs a skill rotation for its class. It follows the current order:
  follow, protect, hunt, boss, goto, hold or retreat.
- **Claude agent loop**. A ping in chat wakes the companion up. It reads a briefing (recent chat, its
  own state, allies, nearby monsters, the boss) and acts through tools: `say`, `set_order`,
  `use_skill`, `look`, `wait` and `remember`. It can loop a few times, for example to wait, check
  progress and report back. Big moments trigger short unprompted reactions too: the boss appearing, a
  companion being knocked out, or a level-up.

To turn on the agent loop, put a key in a `.env` file next to `server.js` (it's git-ignored):

```bash
ANTHROPIC_API_KEY=sk-ant-...      # Claude API directly (default model claude-opus-5-5)
# or
OPENCODE_API_KEY=oc_sk_...        # Claude via OpenCode's Anthropic-compatible endpoint (default model claude-haiku-5-5)
```

Optional settings: `AI_MODEL` (model ID), `AI_EFFORT` (`low` by default, for snappy replies),
`AI_PLAYERS=off` (no companions), and `AI_AGENT=off` (companions on autopilot only). With no key, the
companions still play and understand plain commands: follow, protect, hunt, boss, hold, retreat, or a
skill name.

### Auto farm

Your own character can use the same autopilot. Type these in chat (only you see the replies):

- `/farm`: hunt the nearest monsters anywhere on the map
- `/farm boss`: go for the King Slime, hunting until it appears
- `/farm off` or `/stop`: take back control (pressing any movement or skill key also does this)

While auto farm runs, the server moves your character and respawns it if it gets knocked out.

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
- **Druid**: Thorn Seed (slows), Tree Spirit (plant a seed that grows into a stationary fighting tree after 10s; trees can be attacked; up to 3), Entangle (roots enemies in place), Rejuvenate (heals allies in range), Monsoon (6s of healing rain over a large area that also restores mana).
- **Beyonder**: masked void sorcerer with two weapon forms, swapped with **V (Transmogrify)**. Each form's A/Z/X/C keep their own cooldowns. *Rod:* Void Bolt, Curse (damage over time), Black Tentacles (slowing, damaging pool), Void Portal (press twice to open a linked pair for 10s; allies travel with ↑). *Sword:* Void Slash, Phase Dash (invulnerable dash strike), Spectral Hound (12s ally that heals you for 30% of its damage), Hex Armor (40% dodge for 8s).
- **Paladin**: Holy Strike (single-target; every 10s it becomes Divine Strike for triple damage and a stun), Holy Auras (always-on aura for nearby allies; press to cycle Bulwark −20% damage taken → Zephyr +20% speed and faster basic attacks → Vitality 5% HP and mana every 5s → Vengeance +15% damage), Divine Bulwark (block the next 2 hits), Righteous Cry (taunt nearby enemies for 4s), Guardian Spirits (6s holy aura that damages nearby foes). Golden armor, the team protector.

**Passives** (always on; shown in the round **P** slot next to the skill bar)
- **Fighter — Resilience**: HP regenerates faster the lower your health is (up to 3% max HP per second).
- **Mage — Arcane Discipline**: mana regenerates faster the lower your mana is (up to 4× when nearly empty).
- **Rogue — Haste**: killing an enemy grants +30% movement speed for 6s.
- **Marksman — Wild Friend**: a sturdy wolf (160 HP, 18 damage bites, both scaling with level) follows you, attacks what you attack and scales with your level. If it dies it returns after 30s.
- **Druid — Nature Fairy**: every 6s it attacks the nearest enemy in range, or (with none nearby) heals you or the closest hurt ally for 12% HP.
- **Beyonder — Scarab Swarm**: every kill summons a void scarab that roams its platform attacking enemies until it dies (up to 6).
- **Paladin — Invincible**: dropping to 10% HP or below (even from a killing blow) makes you immune to all damage for 6s. 120s cooldown.

**Resources** (bar under your HP)
- **Mana** (blue) — Mage 220, Druid 190, Beyonder 180, Paladin 120 at level 1, +6% per level. Regenerates slowly: 0.5/s, +10% per level. Basic attacks cost 1–2 mana; Holy Strike and Holy Auras are free; Divine Strike needs 20 mana; Void Slash restores 4 mana per hit; Transmogrify is free.
- **Stamina** (green) — Fighter and Marksman, 100 at level 1, +6% per level. Regenerates fast: 10/s. Basic attacks cost 5.
- **Energy** (yellow) — Rogue, always 100, +10 every 3 seconds. Backstab and Stealth are free; the other skills have short cooldowns.

**Potions**: each kill has a chance to drop a potion — small (+50, 7.5%), medium (+100, 3.5%) or large (+200, 1.5%). Red potions restore HP, blue potions restore your class resource. Walk over one to drink it. The King Slime always drops three large potions.

**Scoring**: when a monster dies, its score and XP are split among everyone who damaged it, by their
share of the damage. Crowd control (stun, freeze, root, slow) adds bonus credit. The last hit counts
as a *kill* and everyone else gets an *assist*. Healers (Druid heals, Monsoon, and the Paladin's Aura of Vitality) also earn score for healing other players, and the Paladin's taunt counts as crowd control.
The **King Slime** boss shows up every few minutes, with HP that scales with the number of players online.

## Project layout

```
server.js            Express REST API (register/login/characters/leaderboard) + Socket.io
server/store.js      SQLite database (data/game.db): users, sessions, characters
server/game.js       Server-side simulation: monsters, abilities, damage, rewards, 10-player cap
server/bots.js       AI companions: autopilot (movement, navigation, skill rotation) + Claude agent loop
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
