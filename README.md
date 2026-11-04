# Sky Skirmish

A browser jetpack shooter with original art and sound. Everything is drawn and synthesised in code, so there are no asset files. It runs entirely on your own computer.

## Play

Needs [Node.js](https://nodejs.org). Run:

```
npm install
npm run dev
```

Then open the address it prints (normally http://localhost:5173).

To play from a phone on the same Wi-Fi, run `npm run dev -- --host` and open the "Network" address on the phone.

## Controls

| Action | Keyboard and mouse | Keyboard only |
| --- | --- | --- |
| Move | A / D | A / D |
| Fly | W or Space | W or Space |
| Crouch, or drop through a platform | S | S |
| Aim | Mouse | Arrow keys |
| Shoot | Left click | J |
| Zoom | Hold right click, or toggle with V | Hold Z, or toggle with V |
| Melee | F | K |
| Grenade / change type | G / T | L / T |
| Reload | R | R |
| Switch weapon | Q, wheel, 1, 2 | Q, 1, 2 |
| Swap for the gun at your feet | E | E |
| Scoreboard | Hold Tab | Hold Tab |
| Pause / mute | Esc / M | Esc / M |

Gamepads and touch screens also work.

## What's in the game

- **Modes:** Free for all, Team battle, Capture the Flag (first to 3), and Survival (growing waves, 3 lives).
- **Maps:** Skyline Ridge, Dust Yard, Frostbite Caves, Neon Foundry. The natural maps have smooth ramps.
- **Weapons:** 12, from the starting pistol to a burst rifle, sniper, rocket launcher, flamethrower, piercing rail gun and bouncing saw discs. Plus frag grenades, gas grenades, proximity mines and melee.
- **Bots:** three skill levels. They navigate the map, manage fuel, collect weapons and throw grenades.
- **Normal / Modded switch** on the match setup screen. See below.

## Normal and Modded

The switch on the setup screen picks which version you play.

- **Normal** ignores every mod, even ones you've saved.
- **Modded** unlocks the mods panel: unlimited ammo, jetpack and grenades, instant reload, dual wield, god mode, one-hit kills, low gravity and a choice of starting weapon. Mods apply to you alone unless you tick "Bots get mods too". Presets set several at once.

Stats are recorded separately for each version, and modded matches show a badge.

To add a mod:

1. Add the field to `GameMods` and `defaultMods()` in `src/sim/types.ts`, and to `NO_MODS` in `src/sim/game.ts`.
2. Use it in `src/sim/game.ts` through `modsFor(player)`.
3. Add a line to `MOD_TOGGLES` in `src/client/presets.ts`. The menu picks it up from there.

## Tweaking the game

| To change | Edit |
| --- | --- |
| Damage, fire rate, ammo and so on | `src/sim/weapons.ts` |
| Jetpack, gravity, health, grenades | `src/sim/constants.ts` |
| Levels (drawn in code, then mirrored) | `src/sim/maps.ts` |
| Bot skill | `PROFILES` in `src/sim/bot.ts` |
| Colours and map themes | `THEMES` in `src/client/art.ts` |

## How it's built

```
src/sim/      The game rules. No browser code, fixed 60 ticks a second, seeded randomness.
src/client/   Everything the player sees and touches: drawing, sound, input, menus.
tests/        Automated checks for the rules, maps, mods, bots and balance.
```

`npm test` runs the checks.

**Why the split matters:** adding online multiplayer later doesn't need a rewrite. The rules already take player inputs and produce a game state, with no browser involved, so the same code can run on a server. The work that remains is the networking: sending inputs to the server and smoothing what each player sees.
