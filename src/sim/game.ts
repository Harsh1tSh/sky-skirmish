import {
  AIR_ACCEL, AIR_MAX_SPEED, BURN_DPS, BURN_TIME, FLAG_CARRIER_DAMAGE, FLAG_GRAB_SHIELD, FLAG_REACH, FLAG_RETURN, MINE_ARM, MINE_LIFE, MINE_TRIGGER, SLOPE_SNAP, SLOPE_TOLERANCE, START_MINES, CROUCH_H, CROUCH_SPEED, CROUCH_SPREAD_MULT, DROPPED_WEAPON_LIFE, DT,
  DUAL_WIELD_COOLDOWN, FRAG_DAMAGE, FRAG_FUSE, FRAG_RADIUS, FUEL_DRAIN, FUEL_MAX, FUEL_REGEN_AIR, FUEL_REGEN_GROUND,
  FUEL_RESTART_MIN, GAS_DPS, GAS_FUSE, GAS_LIFE, GAS_RADIUS, GRAVITY, GRENADE_COOLDOWN, GROUND_ACCEL, HEADSHOT_MULT,
  HEAD_H, HEAD_HALF_W, JET_ACCEL, JET_MAX_RISE, KNOCKBACK_CAP, LOW_GRAVITY_MULT, MAX_FALL, MAX_GRENADES, MAX_HEALTH, MELEE_COOLDOWN,
  MELEE_RANGE, PICKUP_RADIUS, PLAYER_H, PLAYER_W, PUNCH_DAMAGE, REGEN_DELAY, REGEN_RATE, RESPAWN_DELAY, RUN_SPEED,
  SHOULDER_RATIO, SPAWN_SHIELD, START_FRAGS, START_GAS, STEP_UP, SURVIVAL_LIVES, THROW_SPEED, TILE,
} from './constants';
import { isSlope, T_PLATFORM, T_SOLID, GameMap } from './map';
import { createMap } from './maps';
import { Rng } from './rng';
import {
  emptyInput, Flag, GameEvent, GameMods, GasCloud, GrenadeType, MatchConfig, Phase, Pickup, Player, PlayerInput, Projectile, ProjectileKind,
} from './types';
import { COMMON_WEAPONS, POWER_WEAPONS, WEAPONS, WeaponDef, WeaponId } from './weapons';
import { BotBrain, createBrain, updateBot } from './bot';

type DamageSource = WeaponId | 'grenade' | 'gas' | 'burn' | 'punch';

const BOT_NAMES = ['Rookie', 'Havoc', 'Nomad', 'Sparrow', 'Bishop', 'Viper', 'Ghost', 'Mako', 'Rusty', 'Blaze', 'Echo', 'Tank', 'Jinx', 'Dozer', 'Comet', 'Wasp'];
const BOT_COLORS = ['#e4572e', '#17bebb', '#ffc914', '#76b041', '#b388eb', '#ff8fab', '#f4a259', '#5bc0eb', '#9bc53d', '#ef476f', '#06d6a0', '#c08552'];
export const TEAM_COLORS: Record<number, string> = { 1: '#3a86ff', 2: '#ef476f' };

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function shoulderOf(p: Player): { x: number; y: number } {
  return { x: p.x, y: p.y - p.height * SHOULDER_RATIO };
}

export class Game {
  readonly map: GameMap;
  readonly rng: Rng;
  readonly players: Player[] = [];
  readonly projectiles: Projectile[] = [];
  readonly clouds: GasCloud[] = [];
  readonly pickups: Pickup[] = [];
  readonly flags: Flag[] = [];
  /** Filled during step(), cleared at the start of the next one. Clients read this for sound and effects. */
  readonly events: GameEvent[] = [];

  tick = 0;
  phase: Phase;
  countdown = 3;
  timeLeft: number;
  teamScores: [number, number, number] = [0, 0, 0];
  winnerTeam = -1;
  winnerId = -1;

  wave = 0;
  waveTimer = 0;
  waveToSpawn = 0;
  waveSpawnTimer = 0;
  lives = SURVIVAL_LIVES;

  private nextId = 1;
  private readonly brains = new Map<number, BotBrain>();
  private botNameIndex = 0;

  constructor(readonly config: MatchConfig) {
    this.map = createMap(config.mapId);
    this.rng = new Rng(config.seed);
    this.timeLeft = config.timeLimit;
    this.phase = config.skipCountdown ? 'playing' : 'countdown';
    this.setupPickups();
    if (config.mode === 'ctf') this.setupFlags();
    this.setupPlayers();
    if (config.mode === 'survival') this.waveTimer = 2;
  }

  // ---------------------------------------------------------------- setup

  private setupPickups(): void {
    this.map.pickups.forEach((spot, i) => {
      const pickup: Pickup = {
        id: this.nextId++, kind: spot.kind === 'health' ? 'health' : spot.kind === 'grenade' ? 'grenade' : 'weapon',
        weapon: null, mag: 0, reserve: 0,
        x: (spot.x + 0.5) * TILE, y: (spot.y + 1) * TILE - 2, vy: 0,
        active: false, respawn: 0, spot: i, life: Infinity,
      };
      this.fillSpot(pickup);
      this.pickups.push(pickup);
    });
  }

  private setupFlags(): void {
    for (const team of [1, 2] as const) {
      const base = this.map.spawns.find((s) => s.team === team)!;
      const x = (base.x + 0.5) * TILE;
      const y = (base.y + 1) * TILE - 2;
      this.flags.push({ team, homeX: x, homeY: y, x, y, vy: 0, carrier: -1, atHome: true, returnIn: 0 });
    }
  }

  /** True when the two sides are fixed teams rather than everyone for themselves. */
  private get teamMode(): boolean {
    return this.config.mode === 'tdm' || this.config.mode === 'ctf';
  }

  private fillSpot(p: Pickup): void {
    const spot = this.map.pickups[p.spot];
    p.active = true;
    if (p.kind === 'weapon') {
      const id = spot.kind === 'power' ? this.rng.pick(POWER_WEAPONS) : this.rng.pick(COMMON_WEAPONS);
      p.weapon = id;
      p.mag = WEAPONS[id].mag;
      p.reserve = WEAPONS[id].reserve;
    }
  }

  private setupPlayers(): void {
    const { config } = this;
    const humanCount = config.humans.length;
    config.humans.forEach((h) => {
      const team = config.mode === 'ffa' ? 0 : 1;
      this.addPlayer(h.name, team, false, h.color);
    });
    for (let i = 0; i < config.bots; i++) {
      let team: 0 | 1 | 2 = 0;
      if (config.mode === 'survival') team = 1;
      if (this.teamMode) {
        const one = this.players.filter((p) => p.team === 1).length;
        const two = this.players.filter((p) => p.team === 2).length;
        team = one <= two && (humanCount === 0 || one < two) ? 1 : 2;
      }
      this.addBot(team);
    }
  }

  private nextBotName(): string {
    const name = BOT_NAMES[this.botNameIndex % BOT_NAMES.length];
    const round = Math.floor(this.botNameIndex / BOT_NAMES.length);
    this.botNameIndex++;
    return round > 0 ? `${name} ${round + 1}` : name;
  }

  private addBot(team: 0 | 1 | 2): Player {
    const color = team === 0 ? BOT_COLORS[this.botNameIndex % BOT_COLORS.length] : TEAM_COLORS[team];
    const p = this.addPlayer(this.nextBotName(), team, true, color);
    this.brains.set(p.id, createBrain(this, p));
    return p;
  }

  private addPlayer(name: string, team: 0 | 1 | 2, isBot: boolean, color: string): Player {
    const p: Player = {
      id: this.nextId++, name, team, isBot, color,
      x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, height: PLAYER_H, aim: 0, facing: 1,
      onGround: false, crouching: false, jetting: false, dropTimer: 0, stepOffset: 0,
      health: MAX_HEALTH, fuel: FUEL_MAX, alive: true, respawnTimer: 0, shield: 0,
      weapons: [null, null], current: 0, reloadTimer: 0, fireCooldown: 0, meleeCooldown: 0, grenadeCooldown: 0, bloom: 0,
      frags: START_FRAGS, gas: START_GAS, mines: START_MINES, grenadeType: 'frag', burstLeft: 0, dualSide: 1,
      lastDamageTick: -100000, lastAttacker: -1, burnTimer: 0, burnOwner: -1,
      kills: 0, deaths: 0, score: 0, streak: 0, removeOnDeath: false, prevInput: emptyInput(), interactPressed: false, killedBy: -1,
    };
    this.players.push(p);
    this.spawnPlayer(p);
    return p;
  }

  private spawnPlayer(p: Player): void {
    const { mode } = this.config;
    const usable = mode === 'tdm' || mode === 'ctf' ? this.map.spawns.filter((s) => s.team === p.team) : this.map.spawns;
    let best = usable[0];
    let bestScore = -Infinity;
    for (const s of usable) {
      const sx = (s.x + 0.5) * TILE;
      const sy = (s.y + 1) * TILE;
      let nearest = 4000;
      for (const o of this.players) {
        if (!o.alive || o === p || !this.isEnemy(p, o)) continue;
        nearest = Math.min(nearest, Math.hypot(o.x - sx, o.y - sy));
      }
      const score = nearest + this.rng.range(0, 260);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    p.x = p.prevX = (best.x + 0.5) * TILE;
    p.y = p.prevY = (best.y + 1) * TILE - 0.01;
    p.vx = p.vy = 0;
    p.height = PLAYER_H;
    p.health = MAX_HEALTH;
    p.fuel = FUEL_MAX;
    p.alive = true;
    p.shield = SPAWN_SHIELD;
    p.crouching = false;
    p.burnTimer = 0;
    p.reloadTimer = 0;
    p.bloom = 0;
    p.frags = START_FRAGS;
    p.gas = START_GAS;
    p.mines = START_MINES;
    p.burstLeft = 0;
    p.weapons = [{ id: 'pistol', mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve }, null];
    p.current = 0;
    const startWeapon = this.modsFor(p).startWeapon;
    if (startWeapon && startWeapon !== 'pistol') {
      const def = WEAPONS[startWeapon];
      p.weapons[1] = { id: startWeapon, mag: def.mag, reserve: def.reserve };
      p.current = 1;
    }
    this.events.push({ type: 'spawn', id: p.id, x: p.x, y: p.y });
  }

  // ---------------------------------------------------------------- queries

  isEnemy(a: Player, b: Player): boolean {
    if (a.id === b.id) return false;
    return a.team === 0 || a.team !== b.team;
  }

  getPlayer(id: number): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  /** The mods that apply to this player. Bots only get them when the host opted in. */
  modsFor(p: Player): GameMods {
    const { mods } = this.config;
    if (!p.isBot || mods.applyToBots) return mods;
    return NO_MODS;
  }

  /** Weapon on the ground this player could press interact to take, for the HUD prompt. */
  swappablePickup(p: Player): Pickup | null {
    if (!p.alive) return null;
    for (const k of this.pickups) {
      if (!k.active || k.kind !== 'weapon' || !k.weapon) continue;
      if (Math.hypot(k.x - p.x, k.y - (p.y - p.height / 2)) > PICKUP_RADIUS + 10) continue;
      if (p.weapons.some((w) => w?.id === k.weapon)) continue;
      return k;
    }
    return null;
  }

  // ---------------------------------------------------------------- main step

  /** Advances the match by one tick. `inputs` maps human player ids to their input. */
  step(inputs: Record<number, PlayerInput> = {}): void {
    this.events.length = 0;
    if (this.phase === 'ended') return;
    this.tick++;

    if (this.phase === 'countdown') {
      this.countdown -= DT;
      if (this.countdown <= 0) this.phase = 'playing';
    }

    for (let i = this.players.length - 1; i >= 0; i--) {
      const p = this.players[i];
      p.prevX = p.x;
      p.prevY = p.y;
      if (!p.alive) {
        p.respawnTimer -= DT;
        if (p.respawnTimer <= 0) {
          if (p.removeOnDeath) {
            this.players.splice(i, 1);
            this.brains.delete(p.id);
          } else {
            this.spawnPlayer(p);
          }
        }
      }
    }

    for (const p of this.players) {
      let input: PlayerInput;
      if (p.isBot) {
        input = updateBot(this, p, this.brains.get(p.id)!);
      } else {
        input = inputs[p.id] ?? { ...emptyInput(p.aim) };
      }
      if (this.phase === 'countdown') input = { ...emptyInput(input.aim) };
      p.interactPressed = input.interact && !p.prevInput.interact;
      if (p.alive) this.stepPlayer(p, input);
      p.prevInput = input;
    }

    this.stepProjectiles();
    this.stepClouds();
    this.stepPickups();
    if (this.phase === 'playing') {
      if (this.flags.length > 0) this.stepFlags();
      this.stepRules();
    }
  }

  // ---------------------------------------------------------------- player

  private stepPlayer(p: Player, input: PlayerInput): void {
    const mods = this.modsFor(p);
    const prev = p.prevInput;
    p.aim = input.aim;
    p.facing = Math.cos(input.aim) >= 0 ? 1 : -1;
    // The spawn shield must not burn away during the pre-match countdown.
    if (p.shield > 0 && this.phase === 'playing') p.shield -= DT;
    if (p.dropTimer > 0) p.dropTimer -= DT;
    if (p.stepOffset > 0) p.stepOffset = Math.max(0, p.stepOffset - 280 * DT);

    this.updateCrouch(p, input);
    this.applyMovement(p, input, mods);
    this.moveAndCollide(p);

    // Health regeneration and burning.
    const sinceHit = (this.tick - p.lastDamageTick) * DT;
    if (sinceHit > REGEN_DELAY && p.health < MAX_HEALTH) {
      p.health = Math.min(MAX_HEALTH, p.health + REGEN_RATE * DT);
    }
    if (p.burnTimer > 0) {
      p.burnTimer -= DT;
      const owner = this.getPlayer(p.burnOwner);
      this.damage(p, BURN_DPS * DT, owner ?? null, 'burn', { silent: true });
      if (!p.alive) return;
    }

    this.updateCombat(p, input, prev, mods);
  }

  private updateCrouch(p: Player, input: PlayerInput): void {
    const onPlatform = p.onGround && this.standingOnPlatform(p);
    if (input.crouch && !input.jet && onPlatform) {
      p.dropTimer = 0.22;
      p.onGround = false;
    }
    const wantCrouch = input.crouch && p.onGround && !input.jet;
    if (wantCrouch) {
      p.crouching = true;
      p.height = CROUCH_H;
    } else if (p.crouching) {
      const hw = PLAYER_W / 2;
      if (!this.map.boxHitsSolid(p.x - hw, p.y - PLAYER_H, p.x + hw, p.y)) {
        p.crouching = false;
        p.height = PLAYER_H;
      }
    }
  }

  private standingOnPlatform(p: Player): boolean {
    const hw = PLAYER_W / 2 - 1;
    const row = Math.floor((p.y + 1) / TILE);
    const c0 = Math.floor((p.x - hw) / TILE);
    const c1 = Math.floor((p.x + hw) / TILE);
    let platform = false;
    for (let c = c0; c <= c1; c++) {
      const t = this.map.tile(c, row);
      if (t === T_PLATFORM) platform = true;
      else if (t !== 0) return false;
    }
    return platform;
  }

  private applyMovement(p: Player, input: PlayerInput, mods: GameMods): void {
    const moveX = clamp(input.moveX, -1, 1);
    const target = moveX * (p.crouching ? CROUCH_SPEED : RUN_SPEED);
    if (p.onGround) {
      p.vx += clamp(target - p.vx, -GROUND_ACCEL * DT, GROUND_ACCEL * DT);
    } else if (moveX !== 0) {
      // In the air, steering can't add speed beyond the cap but knockback can exceed it.
      const airTarget = moveX * AIR_MAX_SPEED;
      if (Math.abs(p.vx) < AIR_MAX_SPEED || Math.sign(p.vx) !== Math.sign(moveX)) {
        p.vx += clamp(airTarget - p.vx, -AIR_ACCEL * DT, AIR_ACCEL * DT);
      }
    } else {
      p.vx -= p.vx * Math.min(1, 0.9 * DT);
    }

    const minFuel = p.jetting ? 0 : FUEL_RESTART_MIN;
    const canJet = input.jet && (p.fuel > minFuel || mods.unlimitedFuel);
    p.jetting = canJet;
    if (canJet) {
      if (p.vy > -JET_MAX_RISE) p.vy = Math.max(-JET_MAX_RISE, p.vy - JET_ACCEL * DT);
      if (!mods.unlimitedFuel) p.fuel = Math.max(0, p.fuel - FUEL_DRAIN * DT);
      p.onGround = false;
    } else {
      p.fuel = Math.min(FUEL_MAX, p.fuel + (p.onGround ? FUEL_REGEN_GROUND : FUEL_REGEN_AIR) * DT);
    }
    const gravity = this.config.mods.lowGravity ? GRAVITY * LOW_GRAVITY_MULT : GRAVITY;
    p.vy = Math.min(MAX_FALL, p.vy + gravity * DT);
    p.vx = clamp(p.vx, -KNOCKBACK_CAP, KNOCKBACK_CAP);
    p.vy = clamp(p.vy, -KNOCKBACK_CAP, MAX_FALL);
  }

  private moveAndCollide(p: Player): void {
    const { map } = this;
    const hw = PLAYER_W / 2;
    const wasGrounded = p.onGround;
    // While walking, feet may clip a corner a little so ramps flow straight into flat ground.
    const feetGrace = wasGrounded ? SLOPE_TOLERANCE : 0;

    // Horizontal.
    if (p.vx !== 0) {
      const nx = p.x + p.vx * DT;
      if (!this.blockedAhead(nx, p.vx, p.y - p.height, p.y - feetGrace)) {
        p.x = nx;
      } else if (p.onGround && !map.boxHitsSolid(nx - hw, p.y - p.height - STEP_UP, nx + hw, p.y - STEP_UP)) {
        // Walk up single-tile steps so hills don't stop you dead.
        const top = Math.floor((p.y - 1) / TILE) * TILE;
        p.stepOffset += p.y - top;
        p.y = top - 0.01;
        p.x = nx;
      } else {
        if (p.vx > 0) p.x = Math.floor((nx + hw) / TILE) * TILE - hw - 0.01;
        else p.x = (Math.floor((nx - hw) / TILE) + 1) * TILE + hw + 0.01;
        p.vx = 0;
      }
    }

    // Vertical.
    const oldFeet = p.y;
    const ny = p.y + p.vy * DT;
    p.onGround = false;
    if (p.vy >= 0) {
      const c0 = Math.floor((p.x - hw + 0.5) / TILE);
      const c1 = Math.floor((p.x + hw - 0.5) / TILE);
      const r0 = Math.floor(oldFeet / TILE);
      const r1 = Math.floor(ny / TILE);
      let landed = false;
      for (let r = r0; r <= r1 && !landed; r++) {
        for (let c = c0; c <= c1; c++) {
          const t = map.tile(c, r);
          const rowTop = r * TILE;
          const solid = t === 1;
          const platform = t === T_PLATFORM && p.dropTimer <= 0 && oldFeet <= rowTop + 0.5;
          if ((solid || platform) && ny >= rowTop && oldFeet <= rowTop + 0.5) {
            p.y = rowTop - 0.01;
            p.vy = 0;
            p.onGround = true;
            landed = true;
            break;
          }
        }
      }
      if (!landed) p.y = ny;
    } else {
      if (map.boxHitsSolid(p.x - hw + 0.5, ny - p.height, p.x + hw - 0.5, ny - p.height + 1)) {
        p.y = (Math.floor((ny - p.height) / TILE) + 1) * TILE + p.height + 0.01;
        p.vy = 0;
      } else {
        p.y = ny;
      }
    }
    this.resolveSlopes(p, wasGrounded);
    if (!p.onGround) this.pushOutOfWalls(p);
  }

  /** Only the column the player is moving into can block them, so a clipped corner behind never does. */
  private blockedAhead(nx: number, vx: number, top: number, bottom: number): boolean {
    const hw = PLAYER_W / 2;
    const edge = vx > 0 ? nx + hw : nx - hw;
    return this.map.boxHitsSolid(edge - 0.01, top, edge + 0.01, bottom);
  }

  /** A corner clipped while walking must not stay inside a wall once airborne. */
  private pushOutOfWalls(p: Player): void {
    const { map } = this;
    const hw = PLAYER_W / 2;
    const top = p.y - p.height;
    const bottom = p.y - 1;
    if (map.boxHitsSolid(p.x - 0.01, top, p.x + 0.01, bottom)) return;
    if (map.boxHitsSolid(p.x + hw - 0.01, top, p.x + hw + 0.01, bottom)) {
      p.x = Math.floor((p.x + hw) / TILE) * TILE - hw - 0.01;
    } else if (map.boxHitsSolid(p.x - hw - 0.01, top, p.x - hw + 0.01, bottom)) {
      p.x = (Math.floor((p.x - hw) / TILE) + 1) * TILE + hw + 0.01;
    }
  }

  /** Slopes only ever collide with the point under the player's centre. */
  private resolveSlopes(p: Player, wasGrounded: boolean): void {
    const { map } = this;
    const tx = Math.floor(p.x / TILE);
    const row = Math.floor((p.y - 0.02) / TILE);

    // Walked off the top of a ramp and now standing in the next tile: step up onto it.
    if (map.tile(tx, row) === T_SOLID) {
      const top = row * TILE;
      if (p.y - top <= SLOPE_TOLERANCE + 2) this.liftOntoGround(p, top - 0.01);
      return;
    }

    const glue = wasGrounded && !p.jetting && p.vy >= 0;
    for (const r of [row, row + 1]) {
      const t = map.tile(tx, r);
      if (!isSlope(t)) {
        if (t !== 0) return;
        continue;
      }
      const surface = map.slopeSurface(t, tx, r, p.x);
      if (p.y >= surface) this.liftOntoGround(p, surface - 0.01);
      else if (glue && surface - p.y <= SLOPE_SNAP) {
        p.y = surface - 0.01;
        p.vy = 0;
        p.onGround = true;
      }
      return;
    }
  }

  /** Raises feet to `y`, unless that would push the head into a ceiling, in which case the move is undone. */
  private liftOntoGround(p: Player, y: number): void {
    const hw = PLAYER_W / 2 - 0.5;
    if (this.map.boxHitsSolid(p.x - hw, y - p.height, p.x + hw, y - p.height + 4)) {
      p.x = p.prevX;
      p.vx = 0;
      return;
    }
    p.y = y;
    if (p.vy > 0) p.vy = 0;
    p.onGround = p.vy >= 0;
  }

  // ---------------------------------------------------------------- combat

  private updateCombat(p: Player, input: PlayerInput, prev: PlayerInput, mods: GameMods): void {
    if (p.fireCooldown > 0) p.fireCooldown -= DT;
    if (p.meleeCooldown > 0) p.meleeCooldown -= DT;
    if (p.grenadeCooldown > 0) p.grenadeCooldown -= DT;
    p.bloom = Math.max(0, p.bloom - 0.18 * DT);

    let slot = p.weapons[p.current]!;

    if (input.swap && !prev.swap && p.weapons[1 - p.current]) {
      p.current = (1 - p.current) as 0 | 1;
      slot = p.weapons[p.current]!;
      p.reloadTimer = 0;
      p.burstLeft = 0;
      p.fireCooldown = Math.max(p.fireCooldown, 0.16);
      this.events.push({ type: 'swap', id: p.id, x: p.x, y: p.y });
    }

    const def = WEAPONS[slot.id];

    if (p.reloadTimer > 0) {
      p.reloadTimer -= DT;
      if (p.reloadTimer <= 0) this.finishReload(slot, def, mods);
    } else if (input.reload && !prev.reload) {
      this.startReload(p, slot, def, mods);
    }

    if (input.cycleGrenade && !prev.cycleGrenade) {
      p.grenadeType = GRENADE_ORDER[(GRENADE_ORDER.indexOf(p.grenadeType) + 1) % GRENADE_ORDER.length];
    }
    if (input.grenade && !prev.grenade) this.throwGrenade(p, mods);
    if (input.melee && !prev.melee && p.meleeCooldown <= 0) this.melee(p, def.kind === 'blade' ? def : null);

    const wantsFire = def.auto ? input.fire : input.fire && !prev.fire;
    if (p.burstLeft > 0 && p.reloadTimer <= 0 && p.fireCooldown <= 0) {
      p.burstLeft--;
      this.fire(p, slot, def, mods);
    } else if (wantsFire && p.reloadTimer <= 0 && p.fireCooldown <= 0) {
      p.burstLeft = (def.burst ?? 1) - 1;
      this.fire(p, slot, def, mods);
    }
    if (!input.fire && p.bloom > 0) p.bloom = Math.max(0, p.bloom - 0.5 * DT);
  }

  private startReload(p: Player, slot: { mag: number; reserve: number }, def: WeaponDef, mods: GameMods): void {
    if (def.kind === 'blade' || slot.mag >= def.mag) return;
    if (slot.reserve <= 0 && !mods.unlimitedAmmo) return;
    if (mods.instantReload) {
      this.finishReload(slot, def, mods);
      return;
    }
    p.reloadTimer = def.reload;
    this.events.push({ type: 'reload', id: p.id, x: p.x, y: p.y });
  }

  private finishReload(slot: { mag: number; reserve: number }, def: WeaponDef, mods: GameMods): void {
    const need = def.mag - slot.mag;
    if (mods.unlimitedAmmo) {
      slot.mag = def.mag;
      return;
    }
    const take = Math.min(need, slot.reserve);
    slot.mag += take;
    slot.reserve -= take;
  }

  private fire(p: Player, slot: { id: WeaponId; mag: number; reserve: number }, def: WeaponDef, mods: GameMods): void {
    if (def.kind === 'blade') {
      if (p.meleeCooldown <= 0) this.melee(p, def);
      p.fireCooldown = def.cooldown;
      return;
    }
    if (slot.mag <= 0) {
      p.burstLeft = 0;
      if (slot.reserve > 0 || mods.unlimitedAmmo) {
        this.startReload(p, slot, def, mods);
      } else {
        this.events.push({ type: 'dry', id: p.id, x: p.x, y: p.y });
        p.fireCooldown = 0.3;
        // Out of everything: fall back to the other gun.
        const other = p.weapons[1 - p.current];
        if (other) p.current = (1 - p.current) as 0 | 1;
      }
      return;
    }

    if (!mods.unlimitedAmmo) slot.mag--;
    const midBurst = p.burstLeft > 0;
    p.fireCooldown = (midBurst ? 0.07 : def.cooldown) * (mods.dualWield ? DUAL_WIELD_COOLDOWN : 1);

    const s = shoulderOf(p);
    const cos = Math.cos(p.aim);
    const sin = Math.sin(p.aim);
    let mx = s.x + cos * def.barrel;
    let my = s.y + sin * def.barrel;
    if (!this.map.hasLineOfSight(s.x, s.y, mx, my)) {
      mx = s.x;
      my = s.y;
    } else if (mods.dualWield) {
      // The two guns take turns, so shots leave from either side of the aim line.
      p.dualSide = p.dualSide === 1 ? -1 : 1;
      mx -= sin * 4 * p.dualSide;
      my += cos * 4 * p.dualSide;
    }

    const crouchMult = p.crouching ? CROUCH_SPREAD_MULT : 1;
    const spread = (def.spread + p.bloom) * crouchMult;
    this.events.push({ type: 'shot', owner: p.id, weapon: def.id, x: mx, y: my, angle: p.aim });

    if (def.kind === 'rail') {
      this.fireRail(p, mx, my, def);
    } else {
      for (let i = 0; i < def.pellets; i++) {
        const angle = p.aim + this.rng.range(-spread, spread);
        this.spawnWeaponProjectile(p, def, mx, my, angle);
      }
    }
    p.bloom = Math.min(def.bloomMax, p.bloom + def.bloom);
    p.vx -= cos * def.recoil;
    if (!p.onGround) p.vy -= sin * def.recoil * 0.7;

    if (slot.mag <= 0 && (slot.reserve > 0 || mods.unlimitedAmmo)) this.startReload(p, slot, def, mods);
  }

  private spawnWeaponProjectile(p: Player, def: WeaponDef, x: number, y: number, angle: number): void {
    const speedVar = def.kind === 'flame' ? this.rng.range(0.75, 1.15) : 1;
    const kind: ProjectileKind = def.kind === 'rocket' ? 'rocket' : def.kind === 'flame' ? 'flame' : def.kind === 'saw' ? 'saw' : 'bullet';
    let life = def.range;
    if (kind === 'rocket') life = 3.5;
    if (kind === 'flame') life = def.range / def.speed;
    if (kind === 'saw') life = def.range / def.speed;
    this.projectiles.push({
      id: this.nextId++, kind, owner: p.id, team: p.team, weapon: def.id,
      x, y, prevX: x, prevY: y,
      vx: Math.cos(angle) * def.speed * speedVar, vy: Math.sin(angle) * def.speed * speedVar,
      damage: def.damage, knockback: def.knockback, life,
      bounces: kind === 'saw' ? 3 : 0, splashRadius: def.splashRadius ?? 0, arm: 0, dead: false,
    });
  }

  private fireRail(p: Player, x: number, y: number, def: WeaponDef): void {
    const ex = x + Math.cos(p.aim) * def.range;
    const ey = y + Math.sin(p.aim) * def.range;
    const wall = this.map.raycast(x, y, ex, ey);
    // The rail pierces every player up to the first wall.
    for (const target of this.players) {
      if (!target.alive || !this.isEnemy(p, target)) continue;
      const t = segmentVsPlayer(x, y, wall.x, wall.y, target);
      if (t === null) continue;
      const hy = y + (wall.y - y) * t;
      const headshot = isHeadshot(target, x + (wall.x - x) * t, hy, Math.cos(p.aim), Math.sin(p.aim));
      this.damage(target, def.damage * (headshot ? HEADSHOT_MULT : 1), p, def.id, {
        headshot, kx: Math.cos(p.aim) * def.knockback, ky: Math.sin(p.aim) * def.knockback,
        hx: x + (wall.x - x) * t, hy,
      });
    }
    this.events.push({ type: 'rail', owner: p.id, x0: x, y0: y, x1: wall.x, y1: wall.y });
    if (wall.hit) this.events.push({ type: 'impact', x: wall.x, y: wall.y, nx: wall.nx, ny: wall.ny, kind: 'bullet' });
  }

  private melee(p: Player, blade: WeaponDef | null): void {
    p.meleeCooldown = blade ? blade.cooldown : MELEE_COOLDOWN;
    const s = shoulderOf(p);
    const range = blade ? blade.range : MELEE_RANGE;
    const damage = blade ? blade.damage : PUNCH_DAMAGE;
    const knock = blade ? blade.knockback : 260;
    const cos = Math.cos(p.aim);
    const sin = Math.sin(p.aim);
    let landed = false;
    for (const t of this.players) {
      if (!t.alive || !this.isEnemy(p, t)) continue;
      const tx = t.x;
      const ty = t.y - t.height / 2;
      const dx = tx - s.x;
      const dy = ty - s.y;
      const dist = Math.hypot(dx, dy);
      if (dist > range + PLAYER_W) continue;
      if (dist > 8 && (dx * cos + dy * sin) / dist < 0.25) continue;
      if (!this.map.hasLineOfSight(s.x, s.y, tx, ty)) continue;
      this.damage(t, damage, p, blade ? blade.id : 'punch', { kx: cos * knock, ky: sin * knock - 70, hx: tx, hy: ty });
      landed = true;
    }
    this.events.push({ type: 'melee', id: p.id, x: s.x + cos * 24, y: s.y + sin * 24, angle: p.aim, landed, blade: !!blade });
  }

  private throwGrenade(p: Player, mods: GameMods): void {
    if (p.grenadeCooldown > 0) return;
    const kind = p.grenadeType;
    if (grenadeCount(p, kind) <= 0 && !mods.unlimitedGrenades) {
      // Out of this type: move to the next one that has any, ready for the next press.
      p.grenadeType = nextGrenade(p, kind);
      return;
    }
    if (!mods.unlimitedGrenades) {
      if (kind === 'frag') p.frags--;
      else if (kind === 'gas') p.gas--;
      else p.mines--;
    }
    p.grenadeCooldown = GRENADE_COOLDOWN;
    const s = shoulderOf(p);
    const hasRoom = this.map.hasLineOfSight(s.x, s.y, s.x + Math.cos(p.aim) * 16, s.y + Math.sin(p.aim) * 16);
    const x = hasRoom ? s.x + Math.cos(p.aim) * 16 : s.x;
    const y = hasRoom ? s.y + Math.sin(p.aim) * 16 : s.y;
    this.projectiles.push({
      id: this.nextId++, kind, owner: p.id, team: p.team, weapon: 'grenade',
      x, y, prevX: x, prevY: y,
      vx: Math.cos(p.aim) * THROW_SPEED + p.vx * 0.5,
      vy: Math.sin(p.aim) * THROW_SPEED + p.vy * 0.5,
      damage: kind === 'gas' ? 0 : FRAG_DAMAGE, knockback: 520,
      life: kind === 'frag' ? FRAG_FUSE : kind === 'gas' ? GAS_FUSE : MINE_LIFE, bounces: 0,
      splashRadius: kind === 'gas' ? 0 : FRAG_RADIUS, arm: kind === 'mine' ? MINE_ARM : 0, dead: false,
    });
    this.events.push({ type: 'throw', id: p.id, x, y });
  }

  // ---------------------------------------------------------------- damage

  damage(
    v: Player, amount: number, attacker: Player | null, source: DamageSource,
    opts: { headshot?: boolean; kx?: number; ky?: number; hx?: number; hy?: number; silent?: boolean } = {},
  ): void {
    if (!v.alive) return;
    const hx = opts.hx ?? v.x;
    const hy = opts.hy ?? v.y - v.height / 2;
    const attackerId = attacker?.id ?? -1;
    if (v.shield > 0 || this.modsFor(v).godMode) {
      if (!opts.silent) this.events.push({ type: 'hit', victim: v.id, attacker: attackerId, x: hx, y: hy, damage: 0, headshot: false, shielded: true });
      return;
    }
    let dealt = amount;
    if (this.flags.some((f) => f.carrier === v.id)) dealt *= FLAG_CARRIER_DAMAGE;
    if (attacker && attacker !== v && this.modsFor(attacker).oneHitKill) dealt = 9999;
    v.health -= dealt;
    v.lastDamageTick = this.tick;
    if (attacker && attacker !== v) v.lastAttacker = attacker.id;
    if (opts.kx !== undefined) v.vx = clamp(v.vx + opts.kx, -KNOCKBACK_CAP, KNOCKBACK_CAP);
    if (opts.ky !== undefined) v.vy = clamp(v.vy + opts.ky, -KNOCKBACK_CAP, KNOCKBACK_CAP);
    if (!opts.silent) {
      this.events.push({ type: 'hit', victim: v.id, attacker: attackerId, x: hx, y: hy, damage: Math.round(dealt), headshot: !!opts.headshot, shielded: false });
    }
    if (v.health <= 0) this.killPlayer(v, attacker, source, !!opts.headshot);
  }

  private killPlayer(v: Player, attacker: Player | null, source: DamageSource, headshot: boolean): void {
    v.alive = false;
    v.health = 0;
    v.deaths++;
    v.streak = 0;
    v.jetting = false;
    v.respawnTimer = RESPAWN_DELAY;
    v.burnTimer = 0;
    const credited = attacker && attacker !== v ? attacker : this.getPlayer(v.lastAttacker) ?? null;
    v.killedBy = credited?.id ?? v.id;

    if (credited && credited !== v) {
      credited.kills++;
      credited.score++;
      credited.streak++;
      if (this.config.mode === 'tdm') this.teamScores[credited.team]++;
    } else {
      v.score--;
      if (this.config.mode === 'tdm') this.teamScores[v.team]--;
    }

    this.dropWeapon(v);
    this.events.push({ type: 'kill', killer: credited?.id ?? v.id, victim: v.id, weapon: source, headshot, streak: credited?.streak ?? 0 });

    if (this.config.mode === 'survival') {
      if (v.team === 2) {
        v.removeOnDeath = true;
        v.respawnTimer = 1.2;
      } else if (!v.isBot) {
        this.lives--;
        if (this.lives <= 0) this.endMatch(2, -1);
      }
    }
  }

  private dropWeapon(p: Player): void {
    const slot = p.weapons[p.current];
    if (!slot || WEAPONS[slot.id].tier === 0) return;
    this.pickups.push({
      id: this.nextId++, kind: 'weapon', weapon: slot.id, mag: slot.mag, reserve: slot.reserve,
      x: p.x, y: p.y - 10, vy: -120, active: true, respawn: 0, spot: -1, life: DROPPED_WEAPON_LIFE,
    });
  }

  private explode(x: number, y: number, radius: number, damage: number, knock: number, owner: Player | null, source: DamageSource): void {
    this.events.push({ type: 'explosion', x, y, radius });
    for (const t of this.players) {
      if (!t.alive) continue;
      const isSelf = owner?.id === t.id;
      if (owner && !isSelf && !this.isEnemy(owner, t)) continue;
      const cx = t.x;
      const cy = t.y - t.height / 2;
      const hw = PLAYER_W / 2;
      const hh = t.height / 2;
      const dx = Math.max(Math.abs(x - cx) - hw, 0);
      const dy = Math.max(Math.abs(y - cy) - hh, 0);
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      if (!this.map.hasLineOfSight(x, y, cx, cy) && !this.map.hasLineOfSight(x, y, cx, t.y - t.height + 4)) continue;
      const falloff = 1 - dist / radius;
      const dirLen = Math.hypot(cx - x, cy - y) || 1;
      const ux = (cx - x) / dirLen;
      const uy = (cy - y) / dirLen;
      const amount = damage * (0.25 + 0.75 * falloff) * (isSelf ? 0.5 : 1);
      this.damage(t, amount, owner, source, { kx: ux * knock * falloff, ky: (uy - 0.25) * knock * falloff, hx: cx, hy: cy });
    }
  }

  // ---------------------------------------------------------------- projectiles

  private stepProjectiles(): void {
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      pr.prevX = pr.x;
      pr.prevY = pr.y;
      switch (pr.kind) {
        case 'bullet': this.stepBullet(pr); break;
        case 'rocket': this.stepRocket(pr); break;
        case 'flame': this.stepFlame(pr); break;
        case 'saw': this.stepSaw(pr); break;
        case 'frag':
        case 'gas':
        case 'mine': this.stepGrenade(pr); break;
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i].dead) this.projectiles.splice(i, 1);
    }
  }

  /** Finds the first thing hit along this tick's motion. Friendly players are ignored. */
  private trace(pr: Projectile, ex: number, ey: number): { wall: ReturnType<GameMap['raycast']>; player: Player | null; t: number } {
    const wall = this.map.raycast(pr.x, pr.y, ex, ey);
    let best = wall.hit ? wall.t : Infinity;
    let hit: Player | null = null;
    const owner = this.getPlayer(pr.owner);
    for (const target of this.players) {
      if (!target.alive || target.id === pr.owner) continue;
      if (owner ? !this.isEnemy(owner, target) : pr.team !== 0 && target.team === pr.team) continue;
      const t = segmentVsPlayer(pr.x, pr.y, ex, ey, target);
      if (t !== null && t < best) {
        best = t;
        hit = target;
      }
    }
    return { wall, player: hit, t: best };
  }

  private stepBullet(pr: Projectile): void {
    const ex = pr.x + pr.vx * DT;
    const ey = pr.y + pr.vy * DT;
    const { wall, player, t } = this.trace(pr, ex, ey);
    if (player) {
      const hx = pr.x + (ex - pr.x) * t;
      const hy = pr.y + (ey - pr.y) * t;
      const speed = Math.hypot(pr.vx, pr.vy) || 1;
      const headshot = isHeadshot(player, hx, hy, pr.vx / speed, pr.vy / speed);
      this.damage(player, pr.damage * (headshot ? HEADSHOT_MULT : 1), this.getPlayer(pr.owner) ?? null, pr.weapon as WeaponId, {
        headshot, kx: (pr.vx / speed) * pr.knockback, ky: (pr.vy / speed) * pr.knockback, hx, hy,
      });
      pr.x = hx;
      pr.y = hy;
      pr.dead = true;
      return;
    }
    if (wall.hit) {
      pr.x = wall.x;
      pr.y = wall.y;
      pr.dead = true;
      this.events.push({ type: 'impact', x: wall.x, y: wall.y, nx: wall.nx, ny: wall.ny, kind: 'bullet' });
      return;
    }
    pr.life -= Math.hypot(ex - pr.x, ey - pr.y);
    pr.x = ex;
    pr.y = ey;
    if (pr.life <= 0) pr.dead = true;
  }

  private stepRocket(pr: Projectile): void {
    pr.vx *= 1 + 1.2 * DT;
    pr.vy *= 1 + 1.2 * DT;
    const ex = pr.x + pr.vx * DT;
    const ey = pr.y + pr.vy * DT;
    const { wall, player, t } = this.trace(pr, ex, ey);
    pr.life -= DT;
    if (player || wall.hit || pr.life <= 0) {
      const tt = player || wall.hit ? t : 1;
      let x = pr.x + (ex - pr.x) * tt;
      let y = pr.y + (ey - pr.y) * tt;
      if (wall.hit && !player) {
        x += wall.nx * 3;
        y += wall.ny * 3;
      }
      pr.x = x;
      pr.y = y;
      pr.dead = true;
      this.explode(x, y, pr.splashRadius, pr.damage, pr.knockback, this.getPlayer(pr.owner) ?? null, 'rocket');
      return;
    }
    pr.x = ex;
    pr.y = ey;
  }

  private stepFlame(pr: Projectile): void {
    pr.vx *= 1 - 1.4 * DT;
    pr.vy = pr.vy * (1 - 1.4 * DT) - 70 * DT;
    const ex = pr.x + pr.vx * DT;
    const ey = pr.y + pr.vy * DT;
    const { wall, player, t } = this.trace(pr, ex, ey);
    pr.life -= DT;
    if (player) {
      const owner = this.getPlayer(pr.owner) ?? null;
      this.damage(player, pr.damage, owner, 'flamer', { silent: this.tick % 6 !== 0, hx: pr.x + (ex - pr.x) * t, hy: pr.y + (ey - pr.y) * t });
      player.burnTimer = BURN_TIME;
      player.burnOwner = pr.owner;
      pr.dead = true;
      return;
    }
    if (wall.hit || pr.life <= 0) {
      pr.dead = true;
      return;
    }
    pr.x = ex;
    pr.y = ey;
  }

  private stepSaw(pr: Projectile): void {
    const ex = pr.x + pr.vx * DT;
    const ey = pr.y + pr.vy * DT;
    const { wall, player, t } = this.trace(pr, ex, ey);
    pr.life -= DT;
    if (player) {
      const speed = Math.hypot(pr.vx, pr.vy) || 1;
      this.damage(player, pr.damage, this.getPlayer(pr.owner) ?? null, 'saw', {
        kx: (pr.vx / speed) * pr.knockback, ky: (pr.vy / speed) * pr.knockback,
        hx: pr.x + (ex - pr.x) * t, hy: pr.y + (ey - pr.y) * t,
      });
      pr.dead = true;
      return;
    }
    if (wall.hit) {
      this.events.push({ type: 'impact', x: wall.x, y: wall.y, nx: wall.nx, ny: wall.ny, kind: 'saw' });
      if (pr.bounces <= 0) {
        pr.dead = true;
        return;
      }
      pr.bounces--;
      reflect(pr, wall.nx, wall.ny, 1);
      pr.x = wall.x + wall.nx * 2;
      pr.y = wall.y + wall.ny * 2;
      return;
    }
    pr.x = ex;
    pr.y = ey;
    if (pr.life <= 0) pr.dead = true;
  }

  private stepGrenade(pr: Projectile): void {
    pr.vy = Math.min(MAX_FALL, pr.vy + GRAVITY * DT);
    const ex = pr.x + pr.vx * DT;
    const ey = pr.y + pr.vy * DT;
    const wall = this.map.raycast(pr.x, pr.y, ex, ey);
    if (wall.hit && wall.t > 0) {
      const speed = Math.hypot(pr.vx, pr.vy);
      reflect(pr, wall.nx, wall.ny, pr.kind === 'mine' ? 0.12 : 0.45);
      const friction = pr.kind === 'mine' ? 0.3 : 0.7;
      pr.vx *= friction;
      pr.x = wall.x + wall.nx * 1.5;
      pr.y = wall.y + wall.ny * 1.5;
      if (speed > 90) this.events.push({ type: 'bounce', x: pr.x, y: pr.y });
    } else if (wall.hit) {
      // Started inside a wall (thrown point blank): stop rather than tunnel through.
      pr.vx = 0;
      pr.vy = 0;
    } else {
      pr.x = ex;
      pr.y = ey;
    }
    pr.life -= DT;
    if (pr.kind === 'mine') {
      if (pr.arm > 0) pr.arm -= DT;
      else if (this.mineTriggered(pr)) pr.life = 0;
    }
    if (pr.life > 0) return;
    pr.dead = true;
    if (pr.kind === 'frag' || pr.kind === 'mine') {
      this.explode(pr.x, pr.y, pr.splashRadius, pr.damage, pr.knockback, this.getPlayer(pr.owner) ?? null, 'grenade');
    } else {
      this.clouds.push({ id: this.nextId++, x: pr.x, y: pr.y, owner: pr.owner, team: pr.team, life: GAS_LIFE });
      this.events.push({ type: 'gas', x: pr.x, y: pr.y });
    }
  }

  private mineTriggered(pr: Projectile): boolean {
    const owner = this.getPlayer(pr.owner);
    for (const p of this.players) {
      if (!p.alive || p.id === pr.owner) continue;
      if (owner ? !this.isEnemy(owner, p) : pr.team !== 0 && p.team === pr.team) continue;
      if (Math.hypot(p.x - pr.x, p.y - p.height / 2 - pr.y) < MINE_TRIGGER) return true;
    }
    return false;
  }

  private stepClouds(): void {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.life -= DT;
      if (c.life <= 0) {
        this.clouds.splice(i, 1);
        continue;
      }
      const owner = this.getPlayer(c.owner) ?? null;
      for (const p of this.players) {
        if (!p.alive) continue;
        if (owner && p.id !== owner.id && !this.isEnemy(owner, p)) continue;
        if (Math.hypot(p.x - c.x, p.y - p.height / 2 - c.y) > GAS_RADIUS) continue;
        this.damage(p, GAS_DPS * DT, owner, 'gas', { silent: true });
      }
    }
  }

  // ---------------------------------------------------------------- pickups

  /** Lets a loose object fall until it rests on ground, a slope or a platform. */
  private settle(k: { x: number; y: number; vy: number }): void {
    const { map } = this;
    const tx = Math.floor(k.x / TILE);
    const row = Math.floor((k.y + 2) / TILE);
    const t = map.tile(tx, row);
    if (k.vy >= 0) {
      let rest: number | null = null;
      if (t === T_SOLID || t === T_PLATFORM) rest = row * TILE - 2;
      else if (isSlope(t)) {
        const surface = map.slopeSurface(t, tx, row, k.x);
        if (k.y + 2 >= surface) rest = surface - 2;
      }
      if (rest !== null) {
        k.vy = 0;
        k.y = rest;
        return;
      }
    }
    k.vy = Math.min(600, k.vy + GRAVITY * DT);
    const ny = k.y + k.vy * DT;
    if (k.vy < 0 && map.isSolidAt(k.x, ny)) k.vy = 0;
    else k.y = ny;
  }

  private stepPickups(): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      if (!k.active) {
        k.respawn -= DT;
        if (k.respawn <= 0) this.fillSpot(k);
        continue;
      }
      if (k.spot === -1) {
        k.life -= DT;
        if (k.life <= 0) {
          this.pickups.splice(i, 1);
          continue;
        }
      }
      this.settle(k);
      this.tryCollect(k, i);
    }
  }

  private tryCollect(k: Pickup, index: number): void {
    for (const p of this.players) {
      if (!p.alive) continue;
      if (Math.hypot(k.x - p.x, k.y - (p.y - p.height / 2)) > PICKUP_RADIUS) continue;
      if (this.collect(p, k)) {
        this.events.push({ type: 'pickup', id: p.id, kind: k.kind, x: k.x, y: k.y });
        if (k.spot === -1) {
          this.pickups.splice(index, 1);
        } else {
          k.active = false;
          const kind = this.map.pickups[k.spot].kind;
          k.respawn = kind === 'power' ? 30 : kind === 'common' ? 16 : 20;
        }
        return;
      }
    }
  }

  private collect(p: Player, k: Pickup): boolean {
    if (k.kind === 'health') {
      if (p.health >= MAX_HEALTH) return false;
      p.health = Math.min(MAX_HEALTH, p.health + 50);
      p.burnTimer = 0;
      return true;
    }
    if (k.kind === 'grenade') {
      if (p.frags >= MAX_GRENADES && p.gas >= MAX_GRENADES && p.mines >= MAX_GRENADES) return false;
      p.frags = Math.min(MAX_GRENADES, p.frags + 2);
      p.gas = Math.min(MAX_GRENADES, p.gas + 1);
      p.mines = Math.min(MAX_GRENADES, p.mines + 1);
      return true;
    }
    const id = k.weapon!;
    const def = WEAPONS[id];
    const owned = p.weapons.find((w) => w?.id === id);
    if (owned) {
      // Same gun: only worth taking for its ammo.
      if (def.kind === 'blade' || owned.reserve >= def.reserve) return false;
      owned.reserve = Math.min(def.reserve, owned.reserve + k.mag + k.reserve);
      return true;
    }
    const emptySlot = p.weapons[0] === null ? 0 : p.weapons[1] === null ? 1 : null;
    if (emptySlot !== null) {
      p.weapons[emptySlot] = { id, mag: k.mag, reserve: k.reserve };
      p.current = emptySlot;
      p.reloadTimer = 0;
      p.fireCooldown = Math.max(p.fireCooldown, 0.15);
      return true;
    }
    if (p.interactPressed) {
      // Consume the press so one tap swaps exactly one weapon.
      p.interactPressed = false;
      const old = p.weapons[p.current]!;
      if (WEAPONS[old.id].tier > 0 || old.mag > 0 || old.reserve > 0) {
        this.pickups.push({
          id: this.nextId++, kind: 'weapon', weapon: old.id, mag: old.mag, reserve: old.reserve,
          x: p.x, y: p.y - 10, vy: -100, active: true, respawn: 0, spot: -1, life: DROPPED_WEAPON_LIFE,
        });
      }
      p.weapons[p.current] = { id, mag: k.mag, reserve: k.reserve };
      p.reloadTimer = 0;
      p.fireCooldown = Math.max(p.fireCooldown, 0.15);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- rules

  private stepRules(): void {
    const { config } = this;
    if (config.mode === 'survival') {
      this.stepSurvival();
      return;
    }
    if (config.timeLimit > 0) {
      this.timeLeft -= DT;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.finishByScore();
        return;
      }
    }
    if (config.scoreLimit > 0) {
      if (this.teamMode) {
        if (this.teamScores[1] >= config.scoreLimit) this.endMatch(1, -1);
        else if (this.teamScores[2] >= config.scoreLimit) this.endMatch(2, -1);
      } else {
        const leader = this.leader();
        if (leader && leader.score >= config.scoreLimit) this.endMatch(0, leader.id);
      }
    }
  }

  leader(): Player | null {
    let best: Player | null = null;
    for (const p of this.players) if (!best || p.score > best.score) best = p;
    return best;
  }

  private finishByScore(): void {
    if (this.teamMode) {
      const [, a, b] = this.teamScores;
      this.endMatch(a === b ? 0 : a > b ? 1 : 2, -1);
    } else {
      this.endMatch(0, this.leader()?.id ?? -1);
    }
  }

  private endMatch(team: number, id: number): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.winnerTeam = team;
    this.winnerId = id;
    this.events.push({ type: 'ended', winnerTeam: team, winnerId: id });
  }

  private stepFlags(): void {
    for (const flag of this.flags) {
      if (flag.carrier !== -1) {
        const c = this.getPlayer(flag.carrier);
        if (c && c.alive) {
          flag.x = c.x;
          flag.y = c.y - c.height / 2;
          this.tryCapture(flag, c);
          continue;
        }
        // The carrier died or left: the flag falls where they were.
        flag.carrier = -1;
        flag.vy = 0;
        flag.returnIn = FLAG_RETURN;
        this.events.push({ type: 'flag', action: 'dropped', team: flag.team, player: c?.id ?? -1 });
      }
      this.settle(flag);
      if (!flag.atHome) {
        flag.returnIn -= DT;
        if (flag.returnIn <= 0) {
          this.sendFlagHome(flag);
          this.events.push({ type: 'flag', action: 'returned', team: flag.team, player: -1 });
          continue;
        }
      }
      for (const p of this.players) {
        if (!p.alive) continue;
        if (Math.hypot(p.x - flag.x, p.y - p.height / 2 - flag.y) > FLAG_REACH) continue;
        if (p.team !== flag.team) {
          flag.carrier = p.id;
          flag.atHome = false;
          // Flags sit by the enemy's spawn, so a grab needs a moment to get clear.
          p.shield = Math.max(p.shield, FLAG_GRAB_SHIELD);
          this.events.push({ type: 'flag', action: 'taken', team: flag.team, player: p.id });
          break;
        }
        if (!flag.atHome) {
          this.sendFlagHome(flag);
          p.score++;
          this.events.push({ type: 'flag', action: 'returned', team: flag.team, player: p.id });
          break;
        }
      }
    }
  }

  private tryCapture(enemyFlag: Flag, carrier: Player): void {
    const own = this.flags.find((f) => f.team === carrier.team);
    if (!own || !own.atHome) return;
    if (Math.hypot(carrier.x - own.homeX, carrier.y - carrier.height / 2 - own.homeY) > FLAG_REACH + 8) return;
    this.teamScores[carrier.team]++;
    carrier.score += 3;
    this.sendFlagHome(enemyFlag);
    this.events.push({ type: 'flag', action: 'captured', team: enemyFlag.team, player: carrier.id });
  }

  private sendFlagHome(flag: Flag): void {
    flag.x = flag.homeX;
    flag.y = flag.homeY;
    flag.vy = 0;
    flag.carrier = -1;
    flag.atHome = true;
    flag.returnIn = 0;
  }

  private stepSurvival(): void {
    const enemies = this.players.filter((p) => p.team === 2).length;
    if (this.waveToSpawn === 0 && enemies === 0) {
      if (this.wave > 0 && this.waveTimer <= 0) {
        this.events.push({ type: 'waveClear', wave: this.wave });
        this.waveTimer = 6;
        for (const p of this.players) {
          if (p.team !== 1 || !p.alive) continue;
          p.health = MAX_HEALTH;
          for (const w of p.weapons) {
            if (!w) continue;
            const def = WEAPONS[w.id];
            w.mag = def.mag;
            w.reserve = def.reserve;
          }
        }
      }
      if (this.waveTimer > 0) {
        this.waveTimer -= DT;
        if (this.waveTimer <= 0) {
          this.wave++;
          this.waveToSpawn = 2 + this.wave * 2;
          this.waveSpawnTimer = 0;
          this.events.push({ type: 'wave', wave: this.wave });
          this.waveTimer = 0;
        }
      }
      return;
    }
    if (this.waveToSpawn > 0) {
      this.waveSpawnTimer -= DT;
      if (this.waveSpawnTimer <= 0 && enemies < 8) {
        this.waveToSpawn--;
        this.waveSpawnTimer = 0.6;
        const enemy = this.addBot(2);
        enemy.name = `Raider ${enemy.id}`;
        enemy.frags = this.wave >= 4 ? 1 : 0;
        enemy.gas = 0;
        enemy.mines = 0;
        const roll = this.rng.next();
        let weapon: WeaponId | null = null;
        if (this.wave >= 6 && roll < 0.2) weapon = this.rng.pick(POWER_WEAPONS);
        else if (this.wave >= 2 && roll < 0.2 + this.wave * 0.1) weapon = this.rng.pick(COMMON_WEAPONS);
        if (weapon) {
          const def = WEAPONS[weapon];
          enemy.weapons[1] = { id: weapon, mag: def.mag, reserve: def.reserve };
          enemy.current = 1;
        }
      }
    }
  }
}

const GRENADE_ORDER: GrenadeType[] = ['frag', 'gas', 'mine'];

function grenadeCount(p: Player, kind: GrenadeType): number {
  return kind === 'frag' ? p.frags : kind === 'gas' ? p.gas : p.mines;
}

function nextGrenade(p: Player, from: GrenadeType): GrenadeType {
  const start = GRENADE_ORDER.indexOf(from);
  for (let i = 1; i < GRENADE_ORDER.length; i++) {
    const kind = GRENADE_ORDER[(start + i) % GRENADE_ORDER.length];
    if (grenadeCount(p, kind) > 0) return kind;
  }
  return from;
}

/** Bounces a velocity off a surface. Works on sloped surfaces as well as flat ones. */
function reflect(v: { vx: number; vy: number }, nx: number, ny: number, bounce: number): void {
  const dot = v.vx * nx + v.vy * ny;
  if (dot >= 0) return;
  v.vx -= (1 + bounce) * dot * nx;
  v.vy -= (1 + bounce) * dot * ny;
}

const NO_MODS: GameMods = {
  unlimitedAmmo: false, unlimitedFuel: false, instantReload: false, dualWield: false, godMode: false,
  oneHitKill: false, lowGravity: false, unlimitedGrenades: false, startWeapon: '', applyToBots: false,
};

/** A headshot means the shot's path, continued past where it entered the body box, crosses the head. */
function isHeadshot(p: Player, hx: number, hy: number, dirX: number, dirY: number): boolean {
  const top = p.y - p.height;
  const reach = PLAYER_W + p.height;
  return segmentVsBox(hx, hy, hx + dirX * reach, hy + dirY * reach, p.x - HEAD_HALF_W, top - 1, p.x + HEAD_HALF_W, top + HEAD_H) !== null;
}

/** Slab test of a segment against a player's box. Returns the entry fraction, or null on a miss. */
export function segmentVsPlayer(x0: number, y0: number, x1: number, y1: number, p: Player): number | null {
  const hw = PLAYER_W / 2 + 1;
  return segmentVsBox(x0, y0, x1, y1, p.x - hw, p.y - p.height - 1, p.x + hw, p.y);
}

function segmentVsBox(x0: number, y0: number, x1: number, y1: number, left: number, top: number, right: number, bottom: number): number | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let tMin = 0;
  let tMax = 1;
  if (dx === 0) {
    if (x0 < left || x0 > right) return null;
  } else {
    let a = (left - x0) / dx;
    let b = (right - x0) / dx;
    if (a > b) [a, b] = [b, a];
    tMin = Math.max(tMin, a);
    tMax = Math.min(tMax, b);
    if (tMin > tMax) return null;
  }
  if (dy === 0) {
    if (y0 < top || y0 > bottom) return null;
  } else {
    let a = (top - y0) / dy;
    let b = (bottom - y0) / dy;
    if (a > b) [a, b] = [b, a];
    tMin = Math.max(tMin, a);
    tMax = Math.min(tMax, b);
    if (tMin > tMax) return null;
  }
  return tMin;
}

