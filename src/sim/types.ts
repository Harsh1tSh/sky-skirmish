import type { WeaponId } from './weapons';

/** Everything a player can do in one tick. A future network layer only has to ship this struct. */
export interface PlayerInput {
  moveX: number;
  jet: boolean;
  crouch: boolean;
  /** Aim angle in radians, world space. */
  aim: number;
  fire: boolean;
  melee: boolean;
  reload: boolean;
  swap: boolean;
  grenade: boolean;
  cycleGrenade: boolean;
  interact: boolean;
}

export function emptyInput(aim = 0): PlayerInput {
  return {
    moveX: 0, jet: false, crouch: false, aim, fire: false, melee: false,
    reload: false, swap: false, grenade: false, cycleGrenade: false, interact: false,
  };
}

export type GameMode = 'ffa' | 'tdm' | 'ctf' | 'survival';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type GrenadeType = 'frag' | 'gas' | 'mine';
export type Phase = 'countdown' | 'playing' | 'ended';

/** Cheats for private play. They apply to humans unless `applyToBots` is on. */
export interface GameMods {
  unlimitedAmmo: boolean;
  unlimitedFuel: boolean;
  instantReload: boolean;
  dualWield: boolean;
  godMode: boolean;
  oneHitKill: boolean;
  lowGravity: boolean;
  unlimitedGrenades: boolean;
  startWeapon: WeaponId | '';
  applyToBots: boolean;
}

export function defaultMods(): GameMods {
  return {
    unlimitedAmmo: false, unlimitedFuel: false, instantReload: false, dualWield: false,
    godMode: false, oneHitKill: false, lowGravity: false, unlimitedGrenades: false,
    startWeapon: '', applyToBots: false,
  };
}

export interface MatchConfig {
  seed: number;
  mapId: string;
  mode: GameMode;
  /** Opponents in deathmatch modes, allies in survival. */
  bots: number;
  difficulty: Difficulty;
  /** Seconds. 0 means no limit. */
  timeLimit: number;
  /** Kills to win. 0 means no limit. */
  scoreLimit: number;
  humans: { name: string; color: string }[];
  mods: GameMods;
  /** Skips the countdown, used for the menu background. */
  skipCountdown?: boolean;
}

export interface WeaponSlot { id: WeaponId; mag: number; reserve: number }

export interface Player {
  id: number;
  name: string;
  team: 0 | 1 | 2;
  isBot: boolean;
  color: string;
  x: number;
  /** Feet position. */
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  height: number;
  aim: number;
  facing: 1 | -1;
  onGround: boolean;
  crouching: boolean;
  jetting: boolean;
  dropTimer: number;
  /** Cosmetic: smooths out the jump when walking up a tile step. */
  stepOffset: number;
  health: number;
  fuel: number;
  alive: boolean;
  respawnTimer: number;
  shield: number;
  weapons: [WeaponSlot | null, WeaponSlot | null];
  current: 0 | 1;
  reloadTimer: number;
  fireCooldown: number;
  meleeCooldown: number;
  grenadeCooldown: number;
  bloom: number;
  frags: number;
  gas: number;
  mines: number;
  grenadeType: GrenadeType;
  burstLeft: number;
  /** Which of the two guns fires next when dual wielding. */
  dualSide: 1 | -1;
  lastDamageTick: number;
  lastAttacker: number;
  burnTimer: number;
  burnOwner: number;
  kills: number;
  deaths: number;
  score: number;
  streak: number;
  /** Survival enemies are removed from the match once this hits zero after death. */
  removeOnDeath: boolean;
  prevInput: PlayerInput;
  /** True for the tick interact was pressed, until a weapon swap uses it. */
  interactPressed: boolean;
  /** Set when the player was last killed, for the death screen. */
  killedBy: number;
}

export type ProjectileKind = 'bullet' | 'rocket' | 'flame' | 'saw' | 'frag' | 'gas' | 'mine';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  owner: number;
  team: 0 | 1 | 2;
  weapon: WeaponId | 'grenade';
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  damage: number;
  knockback: number;
  /** Remaining travel distance for bullets, remaining seconds for everything else. */
  life: number;
  bounces: number;
  splashRadius: number;
  /** Seconds until a mine can trigger. */
  arm: number;
  dead: boolean;
}

export interface GasCloud {
  id: number;
  x: number;
  y: number;
  owner: number;
  team: 0 | 1 | 2;
  life: number;
}

export interface Flag {
  team: 1 | 2;
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  vy: number;
  /** Player id, or -1 when nobody holds it. */
  carrier: number;
  atHome: boolean;
  /** Seconds until a dropped flag goes home by itself. */
  returnIn: number;
}

export interface Pickup {
  id: number;
  kind: 'weapon' | 'health' | 'grenade';
  weapon: WeaponId | null;
  mag: number;
  reserve: number;
  x: number;
  y: number;
  vy: number;
  active: boolean;
  /** Seconds until an empty spawn spot refills. */
  respawn: number;
  /** Map spot this belongs to, or -1 for a dropped weapon. */
  spot: number;
  /** Seconds left for dropped weapons. */
  life: number;
}

export type GameEvent =
  | { type: 'shot'; owner: number; weapon: WeaponId; x: number; y: number; angle: number }
  | { type: 'rail'; owner: number; x0: number; y0: number; x1: number; y1: number }
  | { type: 'impact'; x: number; y: number; nx: number; ny: number; kind: ProjectileKind }
  | { type: 'hit'; victim: number; attacker: number; x: number; y: number; damage: number; headshot: boolean; shielded: boolean }
  | { type: 'explosion'; x: number; y: number; radius: number }
  | { type: 'gas'; x: number; y: number }
  | { type: 'kill'; killer: number; victim: number; weapon: WeaponId | 'grenade' | 'gas' | 'burn' | 'punch'; headshot: boolean; streak: number }
  | { type: 'spawn'; id: number; x: number; y: number }
  | { type: 'pickup'; id: number; kind: Pickup['kind']; x: number; y: number }
  | { type: 'reload'; id: number; x: number; y: number }
  | { type: 'dry'; id: number; x: number; y: number }
  | { type: 'swap'; id: number; x: number; y: number }
  | { type: 'melee'; id: number; x: number; y: number; angle: number; landed: boolean; blade: boolean }
  | { type: 'throw'; id: number; x: number; y: number }
  | { type: 'bounce'; x: number; y: number }
  | { type: 'flag'; action: 'taken' | 'dropped' | 'returned' | 'captured'; team: 1 | 2; player: number }
  | { type: 'wave'; wave: number }
  | { type: 'waveClear'; wave: number }
  | { type: 'ended'; winnerTeam: number; winnerId: number };
