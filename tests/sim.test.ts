import { describe, expect, it } from 'vitest';
import { DT, FUEL_MAX, TILE } from '../src/sim/constants';
import { Game } from '../src/sim/game';
import { createMap, MAP_LIST } from '../src/sim/maps';
import { defaultMods, emptyInput, GameMods, MatchConfig, Player, PlayerInput } from '../src/sim/types';
import { WEAPONS, WeaponId } from '../src/sim/weapons';
import { isSlope, T_SLOPE_UP } from '../src/sim/map';

function config(over: Partial<MatchConfig> = {}): MatchConfig {
  return {
    seed: 42, mapId: 'ridge', mode: 'ffa', bots: 0, difficulty: 'normal', timeLimit: 0, scoreLimit: 0,
    humans: [{ name: 'Tester', color: '#fff' }], mods: defaultMods(), skipCountdown: true, ...over,
  };
}

function settle(game: Game, input: PlayerInput = emptyInput()): void {
  const id = game.players[0].id;
  for (let i = 0; i < 240; i++) game.step({ [id]: input });
}

/** Two humans on flat ground, the second one standing `gap` px to the right of the first. */
function duel(gap: number, mods: Partial<GameMods> = {}): { game: Game; a: Player; b: Player; input: PlayerInput } {
  const game = new Game(config({
    mapId: 'dust',
    humans: [{ name: 'A', color: '#fff' }, { name: 'B', color: '#000' }],
    mods: { ...defaultMods(), ...mods },
  }));
  const [a, b] = game.players;
  const floor = 38 * TILE - 0.01;
  a.x = 2 * TILE + 16; a.y = floor;
  b.x = a.x + gap; b.y = floor;
  a.shield = b.shield = 0;
  a.onGround = b.onGround = true;
  return { game, a, b, input: emptyInput() };
}

function give(p: Player, id: WeaponId): void {
  p.weapons[0] = { id, mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
  p.current = 0;
}

describe('maps', () => {
  for (const { id } of MAP_LIST) {
    it(`${id}: spawns are clear and everything is reachable`, () => {
      const map = createMap(id);
      expect(map.spawns.length).toBeGreaterThanOrEqual(8);
      expect(map.spawns.some((s) => s.team === 1)).toBe(true);
      expect(map.spawns.some((s) => s.team === 2)).toBe(true);
      const first = map.spawns[0];
      const fx = (first.x + 0.5) * TILE;
      const fy = (first.y + 1) * TILE;
      for (const s of map.spawns) {
        expect(map.isNavCell(s.x, s.y), `spawn ${s.x},${s.y} is inside a wall`).toBe(true);
        expect(map.findPath(fx, fy, (s.x + 0.5) * TILE, (s.y + 1) * TILE).length, `spawn ${s.x},${s.y} unreachable`).toBeGreaterThan(0);
      }
      for (const k of map.pickups) {
        expect(map.isSolid(k.x, k.y), `pickup ${k.x},${k.y} is inside a wall`).toBe(false);
        expect(map.findPath(fx, fy, (k.x + 0.5) * TILE, (k.y + 1) * TILE).length, `pickup ${k.x},${k.y} unreachable`).toBeGreaterThan(0);
      }
    });

    it(`${id}: spawned players land instead of falling through the floor`, () => {
      const game = new Game(config({ mapId: id }));
      settle(game);
      const p = game.players[0];
      expect(p.onGround).toBe(true);
      expect(p.y).toBeLessThan(game.map.pixelHeight);
    });
  }
});

describe('movement', () => {
  it('jetpack climbs, burns fuel, then refills on the ground', () => {
    const game = new Game(config());
    settle(game);
    const p = game.players[0];
    const startY = p.y;
    const jet = { ...emptyInput(), jet: true };
    for (let i = 0; i < 30; i++) game.step({ [p.id]: jet });
    expect(p.y).toBeLessThan(startY - 20);
    expect(p.fuel).toBeLessThan(FUEL_MAX);
    settle(game);
    expect(p.fuel).toBe(FUEL_MAX);
  });

  it('running out of fuel in the air means falling', () => {
    const game = new Game(config());
    settle(game);
    const p = game.players[0];
    const jet = { ...emptyInput(), jet: true };
    for (let i = 0; i < 20; i++) game.step({ [p.id]: jet });
    p.fuel = 0;
    p.vy = 0;
    const startY = p.y;
    for (let i = 0; i < 20; i++) game.step({ [p.id]: jet });
    expect(p.y).toBeGreaterThan(startY);
  });

  it('walks up one-tile steps', () => {
    const game = new Game(config({ mapId: 'ridge' }));
    const p = game.players[0];
    p.x = 22 * TILE;
    p.y = 39 * TILE;
    settle(game);
    const startX = p.x;
    const startY = p.y;
    for (let i = 0; i < 90; i++) game.step({ [p.id]: { ...emptyInput(), moveX: 1 } });
    expect(p.x - startX).toBeGreaterThan(240);
    expect(p.y).toBeLessThan(startY);
  });

  it('is stopped by walls two tiles tall', () => {
    const { game, a, b } = duel(600);
    a.x = 23 * TILE;
    for (let i = 0; i < 90; i++) game.step({ [a.id]: { ...emptyInput(), moveX: 1 }, [b.id]: emptyInput() });
    expect(a.x).toBeLessThan(25 * TILE);
  });

  it('drops through one-way platforms when crouching, and lands on them otherwise', () => {
    const game = new Game(config({ mapId: 'dust' }));
    const p = game.players[0];
    p.x = 30 * TILE;
    p.y = 24 * TILE;
    p.vy = 0;
    for (let i = 0; i < 90; i++) game.step({ [p.id]: emptyInput() });
    expect(p.onGround).toBe(true);
    expect(p.y).toBeCloseTo(26 * TILE, 0);
    for (let i = 0; i < 60; i++) game.step({ [p.id]: { ...emptyInput(), crouch: true } });
    expect(p.y).toBeGreaterThan(30 * TILE);
  });
});

describe('combat', () => {
  it('a bullet damages an enemy and headshots hit harder', () => {
    const body = duel(200);
    give(body.a, 'rifle');
    body.a.aim = 0;
    const bodyInput = { ...emptyInput(0), fire: true };
    body.game.step({ [body.a.id]: bodyInput, [body.b.id]: emptyInput() });
    for (let i = 0; i < 8; i++) body.game.step({ [body.a.id]: emptyInput(0), [body.b.id]: emptyInput() });
    const bodyDamage = 100 - body.b.health;
    expect(bodyDamage).toBeGreaterThan(0);

    const head = duel(200);
    give(head.a, 'marksman');
    const dy = -15;
    const aim = Math.atan2(dy, 200);
    head.game.step({ [head.a.id]: { ...emptyInput(aim), fire: true }, [head.b.id]: emptyInput() });
    for (let i = 0; i < 8; i++) head.game.step({ [head.a.id]: emptyInput(aim), [head.b.id]: emptyInput() });
    expect(100 - head.b.health).toBeGreaterThan(WEAPONS.marksman.damage);
  });

  it('killing an enemy scores a point, drops the weapon, and they respawn', () => {
    const { game, a, b } = duel(60);
    give(a, 'sniper');
    give(b, 'rifle');
    b.health = 1;
    const pickupsBefore = game.pickups.length;
    game.step({ [a.id]: { ...emptyInput(0), fire: true }, [b.id]: emptyInput() });
    for (let i = 0; i < 4 && b.alive; i++) game.step({ [a.id]: emptyInput(0), [b.id]: emptyInput() });
    expect(b.alive).toBe(false);
    expect(a.kills).toBe(1);
    expect(a.score).toBe(1);
    expect(game.pickups.length).toBe(pickupsBefore + 1);
    for (let i = 0; i < 200; i++) game.step({ [a.id]: emptyInput(0), [b.id]: emptyInput() });
    expect(b.alive).toBe(true);
    expect(b.health).toBe(100);
  });

  it('team-mates cannot be shot', () => {
    const game = new Game(config({ mode: 'tdm', mapId: 'dust', humans: [{ name: 'A', color: '#fff' }, { name: 'B', color: '#000' }] }));
    const [a, b] = game.players;
    const floor = 38 * TILE - 0.01;
    a.x = 80; a.y = floor; b.x = 180; b.y = floor; a.shield = b.shield = 0;
    give(a, 'rifle');
    for (let i = 0; i < 20; i++) game.step({ [a.id]: { ...emptyInput(0), fire: true }, [b.id]: emptyInput() });
    expect(b.health).toBe(100);
  });

  it('rockets explode, hurt the shooter at close range and throw players back', () => {
    const { game, a, b } = duel(70);
    give(a, 'rocket');
    game.step({ [a.id]: { ...emptyInput(0), fire: true }, [b.id]: emptyInput() });
    let exploded = false;
    for (let i = 0; i < 30; i++) {
      game.step({ [a.id]: emptyInput(0), [b.id]: emptyInput() });
      if (game.events.some((e) => e.type === 'explosion')) { exploded = true; break; }
    }
    expect(exploded).toBe(true);
    expect(b.health).toBeLessThan(100);
    expect(a.health).toBeLessThan(100);
    expect(b.vx).toBeGreaterThan(0);
  });

  it('walls stop bullets, one-way platforms do not', () => {
    const map = createMap('dust');
    expect(map.raycast(5 * TILE, 37 * TILE, 8 * TILE, 37 * TILE).hit).toBe(false);
    expect(map.raycast(8 * TILE, 21 * TILE, 8 * TILE, 24 * TILE).hit).toBe(true);
    expect(map.raycast(10 * TILE, 29 * TILE, 10 * TILE, 32 * TILE).hit).toBe(false);
  });

  it('reloads from reserve and punches deal damage', () => {
    const { game, a, b } = duel(30);
    a.weapons[0]!.mag = 0;
    const reserve = a.weapons[0]!.reserve;
    game.step({ [a.id]: { ...emptyInput(0), reload: true }, [b.id]: emptyInput() });
    expect(a.reloadTimer).toBeGreaterThan(0);
    for (let i = 0; i < 90; i++) game.step({ [a.id]: emptyInput(0), [b.id]: emptyInput() });
    expect(a.weapons[0]!.mag).toBe(WEAPONS.pistol.mag);
    expect(a.weapons[0]!.reserve).toBe(reserve - WEAPONS.pistol.mag);
    game.step({ [a.id]: { ...emptyInput(0), melee: true }, [b.id]: emptyInput() });
    expect(b.health).toBeLessThan(100);
  });
});

describe('mods', () => {
  it('unlimited ammo never empties the magazine', () => {
    const { game, a, b } = duel(600, { unlimitedAmmo: true });
    give(a, 'smg');
    for (let i = 0; i < 300; i++) game.step({ [a.id]: { ...emptyInput(Math.PI), fire: true }, [b.id]: emptyInput() });
    expect(a.weapons[0]!.mag).toBe(WEAPONS.smg.mag);
  });

  it('unlimited fuel keeps the tank full', () => {
    const game = new Game(config({ mods: { ...defaultMods(), unlimitedFuel: true } }));
    settle(game);
    const p = game.players[0];
    for (let i = 0; i < 300; i++) game.step({ [p.id]: { ...emptyInput(), jet: true } });
    expect(p.fuel).toBe(FUEL_MAX);
  });

  it('god mode blocks damage, and one-hit kill finishes anyone', () => {
    const god = duel(60, { godMode: true });
    god.a.isBot = false;
    god.game.damage(god.a, 50, god.b, 'rifle');
    expect(god.a.health).toBe(100);

    const onehit = duel(60, { oneHitKill: true });
    onehit.game.damage(onehit.b, 1, onehit.a, 'pistol');
    expect(onehit.b.alive).toBe(false);
  });

  it('dual wield fires faster and a start weapon is equipped on spawn', () => {
    const count = (dual: boolean): number => {
      const { game, a, b } = duel(600, { dualWield: dual, unlimitedAmmo: true });
      give(a, 'rifle');
      let shots = 0;
      for (let i = 0; i < 120; i++) {
        game.step({ [a.id]: { ...emptyInput(Math.PI), fire: true }, [b.id]: emptyInput() });
        shots += game.events.filter((e) => e.type === 'shot').length;
      }
      return shots;
    };
    expect(count(true)).toBeGreaterThan(count(false) * 1.4);

    const game = new Game(config({ mods: { ...defaultMods(), startWeapon: 'rail' } }));
    expect(game.players[0].weapons[game.players[0].current]!.id).toBe('rail');
  });

  it('mods stay off for bots unless asked', () => {
    const game = new Game(config({ bots: 1, mods: { ...defaultMods(), godMode: true } }));
    const [human, bot] = game.players;
    expect(game.modsFor(human).godMode).toBe(true);
    expect(game.modsFor(bot).godMode).toBe(false);
    const shared = new Game(config({ bots: 1, mods: { ...defaultMods(), godMode: true, applyToBots: true } }));
    expect(shared.modsFor(shared.players[1]).godMode).toBe(true);
  });
});

function hash(game: Game): string {
  return game.players.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.health.toFixed(2)},${p.kills}`).join('|');
}

describe('bots and match flow', () => {
  it('is deterministic: same seed and inputs replay exactly', () => {
    const run = (): string => {
      const game = new Game(config({ humans: [], bots: 6, mapId: 'foundry', seed: 7 }));
      for (let i = 0; i < 1800; i++) game.step();
      return hash(game);
    };
    expect(run()).toBe(run());
  });

  for (const { id } of MAP_LIST) {
    it(`${id}: bots hunt each other and get kills with no broken state`, () => {
      const game = new Game(config({ humans: [], bots: 8, mapId: id, seed: 11 }));
      let kills = 0;
      for (let i = 0; i < 60 * 90; i++) {
        game.step();
        kills += game.events.filter((e) => e.type === 'kill').length;
        for (const p of game.players) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
          if (p.alive) {
            // Feet may clip a corner on ramps, so this checks the upper body.
            expect(game.map.boxHitsSolid(p.x - 8, p.y - 40, p.x + 8, p.y - 18), `${p.name} stuck in wall at ${p.x},${p.y}`).toBe(false);
          }
        }
      }
      expect(kills).toBeGreaterThan(8);
    });
  }

  it('deathmatch ends at the score limit with a winner', () => {
    const game = new Game(config({ humans: [], bots: 6, scoreLimit: 3, seed: 3 }));
    for (let i = 0; i < 60 * 300 && game.phase !== 'ended'; i++) game.step();
    expect(game.phase).toBe('ended');
    expect(game.getPlayer(game.winnerId)!.score).toBeGreaterThanOrEqual(3);
  });

  it('the time limit ends a match', () => {
    const game = new Game(config({ humans: [], bots: 2, timeLimit: 5 }));
    for (let i = 0; i < 60 * 6; i++) game.step();
    expect(game.phase).toBe('ended');
  });

  it('team deathmatch splits teams evenly', () => {
    const game = new Game(config({ mode: 'tdm', bots: 7 }));
    const one = game.players.filter((p) => p.team === 1).length;
    const two = game.players.filter((p) => p.team === 2).length;
    expect(one).toBe(4);
    expect(two).toBe(4);
  });

  it('survival sends waves that grow and ends when lives run out', () => {
    const game = new Game(config({ mode: 'survival', difficulty: 'hard', seed: 5 }));
    const human = game.players[0];
    let maxWave = 0;
    for (let i = 0; i < 60 * 600 && game.phase !== 'ended'; i++) {
      game.step({ [human.id]: emptyInput() });
      maxWave = Math.max(maxWave, game.wave);
    }
    expect(maxWave).toBeGreaterThanOrEqual(1);
    expect(game.phase).toBe('ended');
    expect(game.lives).toBe(0);
  });

  it('survival waves can be cleared', () => {
    const game = new Game(config({ mode: 'survival', mods: { ...defaultMods(), godMode: true, oneHitKill: true } }));
    const human = game.players[0];
    let cleared = false;
    for (let i = 0; i < 60 * 40 && !cleared; i++) {
      game.step({ [human.id]: emptyInput() });
      for (const p of game.players) if (p.team === 2 && p.alive) game.damage(p, 1, human, 'pistol');
      cleared = game.events.some((e) => e.type === 'waveClear');
    }
    expect(cleared).toBe(true);
    expect(DT).toBeGreaterThan(0);
  });
});

describe('balance', () => {
  it('headshots are a minority of kills, even with everyone flying around', () => {
    let total = 0;
    let heads = 0;
    for (const mapId of ['ridge', 'dust', 'caves', 'foundry']) {
      const game = new Game(config({ humans: [], bots: 8, mapId, seed: 21 }));
      for (let i = 0; i < 60 * 120; i++) {
        game.step();
        for (const e of game.events) {
          if (e.type !== 'kill') continue;
          total++;
          if (e.headshot) heads++;
        }
      }
    }
    console.log(`headshot kills: ${heads}/${total}`);
    expect(total).toBeGreaterThan(30);
    expect(heads / total).toBeLessThan(0.45);
  });

  it('an idle player survives the countdown and the first few seconds', () => {
    for (const mapId of ['ridge', 'dust', 'caves', 'foundry']) {
      const game = new Game(config({ mapId, bots: 5, seed: 9, skipCountdown: false }));
      const me = game.players[0];
      for (let i = 0; i < 60 * 4; i++) game.step({ [me.id]: emptyInput() });
      expect(me.deaths, mapId).toBe(0);
    }
  });

  it('bot skill levels are meaningfully different', () => {
    const lifetimes: Record<string, number> = {};
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      let deaths = 0;
      const seconds = 240;
      for (const seed of [1, 2, 3]) {
        const game = new Game(config({ bots: 5, difficulty, seed }));
        const me = game.players[0];
        for (let i = 0; i < 60 * seconds; i++) game.step({ [me.id]: emptyInput() });
        deaths += me.deaths;
      }
      lifetimes[difficulty] = (seconds * 3) / Math.max(1, deaths);
    }
    console.log('seconds an idle player lasts vs 5 bots', lifetimes);
    expect(lifetimes.easy).toBeGreaterThan(lifetimes.hard);
    expect(lifetimes.normal).toBeGreaterThan(5);
    }, 60000);
});

describe('slopes', () => {
  function firstSlope(mapId: string, kind: number): { tx: number; ty: number } {
    const map = createMap(mapId);
    for (let y = 2; y < map.height - 2; y++) {
      for (let x = 2; x < map.width - 2; x++) {
        if (map.tile(x, y) === kind && map.tile(x, y - 1) === 0 && map.tile(x, y - 2) === 0 && map.tile(x - 1, y) === 0) return { tx: x, ty: y };
      }
    }
    throw new Error('no slope on ' + mapId);
  }

  it('natural maps have ramps and man-made ones stay square', () => {
    const count = (id: string): number => {
      const map = createMap(id);
      return Array.from(map.tiles).filter(isSlope).length;
    };
    expect(count('ridge')).toBeGreaterThan(10);
    expect(count('caves')).toBeGreaterThan(10);
    expect(count('dust')).toBe(0);
    expect(count('foundry')).toBe(0);
  });

  it('walking uphill is continuous, with no sudden jumps in height', () => {
    const game = new Game(config({ mapId: 'ridge' }));
    const p = game.players[0];
    const { tx, ty } = firstSlope('ridge', T_SLOPE_UP);
    p.x = (tx - 1) * TILE;
    p.y = (ty + 1) * TILE - 0.01;
    p.vx = 0;
    p.vy = 0;
    for (let i = 0; i < 30; i++) game.step({ [p.id]: emptyInput() });
    const startY = p.y;
    let biggest = 0;
    let last = p.y;
    for (let i = 0; i < 28; i++) {
      game.step({ [p.id]: { ...emptyInput(), moveX: 1 } });
      biggest = Math.max(biggest, Math.abs(p.y - last));
      last = p.y;
    }
    expect(p.y).toBeLessThan(startY - 8);
    expect(biggest).toBeLessThan(10);
  });

  it('stays glued to the ground running downhill', () => {
    const game = new Game(config({ mapId: 'ridge' }));
    const p = game.players[0];
    const { tx, ty } = firstSlope('ridge', T_SLOPE_UP);
    p.x = (tx + 0.9) * TILE;
    p.y = ty * TILE + 2;
    for (let i = 0; i < 10; i++) game.step({ [p.id]: emptyInput() });
    let airborne = 0;
    for (let i = 0; i < 8; i++) {
      game.step({ [p.id]: { ...emptyInput(), moveX: -1 } });
      if (!p.onGround) airborne++;
    }
    expect(airborne).toBe(0);
  });

  it('shots hit the slope surface, not the corner of the tile', () => {
    const map = createMap('ridge');
    const { tx, ty } = firstSlope('ridge', T_SLOPE_UP);
    const x = (tx + 0.25) * TILE;
    // Over the low side, the top of the tile is open air.
    expect(map.isSolidAt(x, ty * TILE + 8)).toBe(false);
    const hit = map.raycast(x, (ty - 1) * TILE, x, (ty + 1) * TILE - 1);
    expect(hit.hit).toBe(true);
    expect(hit.y).toBeCloseTo((ty + 0.75) * TILE, 1);
    expect(hit.ny).toBeLessThan(0);
  });
});

describe('new weapons and grenades', () => {
  it('burst rifle fires three shots per pull', () => {
    const { game, a, b } = duel(600);
    give(a, 'burst');
    let shots = 0;
    game.step({ [a.id]: { ...emptyInput(Math.PI), fire: true }, [b.id]: emptyInput() });
    shots += game.events.filter((e) => e.type === 'shot').length;
    for (let i = 0; i < 18; i++) {
      game.step({ [a.id]: emptyInput(Math.PI), [b.id]: emptyInput() });
      shots += game.events.filter((e) => e.type === 'shot').length;
    }
    expect(shots).toBe(3);
  });

  it('grenade button cycles frag, gas, mine', () => {
    const { game, a, b } = duel(600);
    const seen: string[] = [a.grenadeType];
    for (let i = 0; i < 3; i++) {
      game.step({ [a.id]: { ...emptyInput(), cycleGrenade: true }, [b.id]: emptyInput() });
      seen.push(a.grenadeType);
      game.step({ [a.id]: emptyInput(), [b.id]: emptyInput() });
    }
    expect(seen).toEqual(['frag', 'gas', 'mine', 'frag']);
  });

  it('a mine waits until an enemy walks near, and spares its owner', () => {
    const { game, a, b } = duel(600);
    a.grenadeType = 'mine';
    const none = emptyInput(Math.PI / 2);
    game.step({ [a.id]: { ...none, grenade: true }, [b.id]: emptyInput() });
    expect(a.mines).toBe(0);
    for (let i = 0; i < 180; i++) game.step({ [a.id]: none, [b.id]: emptyInput() });
    const mine = game.projectiles.find((p) => p.kind === 'mine');
    expect(mine, 'mine should still be waiting').toBeTruthy();
    b.x = mine!.x + 20;
    b.y = mine!.y + 2;
    b.shield = 0;
    let exploded = false;
    for (let i = 0; i < 5 && !exploded; i++) {
      game.step({ [a.id]: none, [b.id]: emptyInput() });
      exploded = game.events.some((e) => e.type === 'explosion');
    }
    expect(exploded).toBe(true);
    expect(b.health).toBeLessThan(100);
  });
});

describe('capture the flag', () => {
  const ctf = (over: Partial<MatchConfig> = {}): Game => new Game(config({
    mode: 'ctf', scoreLimit: 2, humans: [{ name: 'A', color: '#fff' }, { name: 'B', color: '#000' }], ...over,
  }));
  /** Human players join team 1, so this moves the second onto the other side. */
  const split = (game: Game): [Player, Player] => {
    const [a, b] = game.players;
    b.team = 2;
    a.shield = b.shield = 99;
    return [a, b];
  };
  const idle = (game: Game, a: Player, b: Player, n = 1): void => {
    for (let i = 0; i < n; i++) game.step({ [a.id]: emptyInput(), [b.id]: emptyInput() });
  };

  it('touching the enemy flag takes it, and bringing it home scores', () => {
    const game = ctf();
    const [a, b] = split(game);
    idle(game, a, b, 60);
    const theirs = game.flags.find((f) => f.team === 2)!;
    a.x = theirs.x; a.y = theirs.y;
    idle(game, a, b);
    expect(theirs.carrier).toBe(a.id);
    const mine = game.flags.find((f) => f.team === 1)!;
    a.x = mine.homeX; a.y = mine.homeY; a.vy = 0;
    idle(game, a, b, 2);
    expect(game.teamScores[1]).toBe(1);
    expect(theirs.atHome).toBe(true);
    expect(theirs.carrier).toBe(-1);
  });

  it('kills do not count toward the team score', () => {
    const game = ctf();
    const [a, b] = split(game);
    b.shield = 0;
    game.damage(b, 999, a, 'rifle');
    expect(a.kills).toBe(1);
    expect(game.teamScores[1]).toBe(0);
  });

  it('dying drops the flag, and team-mates can return it', () => {
    const game = ctf();
    const [a, b] = split(game);
    idle(game, a, b, 60);
    const theirs = game.flags.find((f) => f.team === 2)!;
    a.x = theirs.x; a.y = theirs.y;
    idle(game, a, b);
    expect(theirs.carrier).toBe(a.id);
    a.shield = 0;
    game.damage(a, 999, b, 'rifle');
    idle(game, a, b, 2);
    expect(theirs.carrier).toBe(-1);
    expect(theirs.atHome).toBe(false);
    b.x = theirs.x; b.y = theirs.y;
    idle(game, a, b, 2);
    expect(theirs.atHome).toBe(true);
  });

  it('a dropped flag goes home by itself', () => {
    const game = ctf();
    const [a, b] = split(game);
    idle(game, a, b, 60);
    const theirs = game.flags.find((f) => f.team === 2)!;
    a.x = theirs.x; a.y = theirs.y;
    idle(game, a, b);
    a.shield = 0;
    game.damage(a, 999, b, 'rifle');
    b.x = game.flags[0].homeX;
    b.y = game.flags[0].homeY;
    a.respawnTimer = 9999;
    for (let i = 0; i < 60 * 13; i++) game.step({ [a.id]: emptyInput(), [b.id]: emptyInput() });
    expect(theirs.atHome).toBe(true);
  });

  for (const { id } of MAP_LIST) {
    it(`${id}: bots complete flag captures by themselves`, () => {
      // One match can stall by chance, so this looks across a few.
      let captures = 0;
      for (const seed of [1, 2, 3]) {
        const game = new Game(config({ mode: 'ctf', humans: [], bots: 8, mapId: id, seed }));
        for (let i = 0; i < 60 * 300; i++) {
          game.step();
          captures += game.events.filter((e) => e.type === 'flag' && e.action === 'captured').length;
        }
      }
      expect(captures).toBeGreaterThan(0);
    }, 60000);
  }
});

describe('jetpack feel', () => {
  it('feathering the jets stays airborne longer than holding them', () => {
    const flight = (pattern: (tick: number) => boolean): number => {
      const game = new Game(config({ mapId: 'dust', bots: 0 }));
      const p = game.players[0];
      p.x = 48 * TILE;
      p.y = 37 * TILE;
      for (let i = 0; i < 120; i++) game.step({ [p.id]: emptyInput() });
      let ticks = 0;
      for (let i = 0; i < 60 * 20; i++) {
        game.step({ [p.id]: { ...emptyInput(), jet: pattern(i) } });
        if (i > 30 && p.onGround) break;
        ticks++;
      }
      return ticks;
    };
    const held = flight(() => true);
    const feathered = flight((t) => t < 45 || t % 40 < 18);
    expect(feathered).toBeGreaterThan(held);
  });
});
