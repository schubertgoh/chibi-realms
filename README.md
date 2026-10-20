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
| ← → / A D | Move |
| Space (or Alt) | Jump |
| ↑ ↓ / W S | Climb ladders |
| ↓ + Space | Drop through a platform |
| Z X C V (also J K L U or 1–4) | Class skills |
| Enter | Chat |
| Tab | Show or hide the online list |

**Classes**
- **Fighter**: Slash, Shield Bash (stun), Whirlwind (area attack), Iron Will (10s of −60% damage taken plus 10% HP regen). Most HP and armor.
- **Mage**: Fireball (explodes), Lightning Bolt (chains to 3 enemies), Frost Nova (freeze), Magic Shield (4s dome; you and allies inside are invulnerable). Low HP.
- **Rogue**: Backstab (always crits from behind or from stealth; ×3.5 from stealth, ×1.5 from behind), Stealth (untouchable for 5s), Dodge Roll (invulnerable), Fan of Knives (hits all nearby foes, then 1.5s invulnerable; 16s cooldown). Fastest class.
- **Marksman**: Arrow, Multishot (5-arrow fan), Disengage (leap back and knock enemies away), Piercing Shot (huge, wide arrow that pierces everything).
- **Druid**: Thorn Seed (slows), Entangle (roots enemies in place), Rejuvenate (heals allies in range), Nature Spirit (a fox ally that fights for 15s).
- **Paladin**: Holy Strike (single-target mace swing), Divine Aura (5s of healing pulses on you and nearby allies), Righteous Blow (heavy hit that stuns one foe for 2s), Guardian Spirits (6s holy aura that damages nearby foes). Golden armor, sturdy and supportive.

**Scoring**: when a monster dies, its score and XP are split among everyone who damaged it, by their
share of the damage. Crowd control (stun, freeze, root, slow) adds bonus credit. The last hit counts
as a *kill* and everyone else gets an *assist*. Druids also earn score for healing other players.
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
