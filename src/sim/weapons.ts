export type WeaponKind = 'bullet' | 'rocket' | 'flame' | 'rail' | 'saw' | 'blade';

export type WeaponId =
  | 'pistol' | 'smg' | 'rifle' | 'burst' | 'marksman' | 'shotgun'
  | 'sniper' | 'rocket' | 'flamer' | 'rail' | 'saw' | 'blade';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  kind: WeaponKind;
  /** 0 = starting gun, 1 = common pickup, 2 = power weapon. Bots use this to rank weapons. */
  tier: 0 | 1 | 2;
  damage: number;
  /** Seconds between shots. */
  cooldown: number;
  auto: boolean;
  mag: number;
  reserve: number;
  reload: number;
  /** Half-angle of random spread, radians. */
  spread: number;
  /** Extra spread added per consecutive shot, and its cap. */
  bloom: number;
  bloomMax: number;
  pellets: number;
  speed: number;
  /** Maximum travel in world units. */
  range: number;
  /** Backwards shove on the shooter. */
  recoil: number;
  knockback: number;
  /** How far the camera pulls back while scoped (1 = none). */
  scope: number;
  barrel: number;
  splashRadius?: number;
  /** Shots fired per trigger pull, for burst weapons. */
  burst?: number;
}

const def = (d: WeaponDef): WeaponDef => d;

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: def({ id: 'pistol', name: 'Hand Cannon', kind: 'bullet', tier: 0, damage: 27, cooldown: 0.28, auto: false, mag: 8, reserve: 48, reload: 1.1, spread: 0.012, bloom: 0.012, bloomMax: 0.05, pellets: 1, speed: 2300, range: 1100, recoil: 10, knockback: 40, scope: 1, barrel: 22 }),
  smg: def({ id: 'smg', name: 'Buzz SMG', kind: 'bullet', tier: 1, damage: 10, cooldown: 0.065, auto: true, mag: 34, reserve: 136, reload: 1.3, spread: 0.035, bloom: 0.006, bloomMax: 0.09, pellets: 1, speed: 2100, range: 850, recoil: 3, knockback: 12, scope: 1, barrel: 26 }),
  rifle: def({ id: 'rifle', name: 'Vanguard Rifle', kind: 'bullet', tier: 1, damage: 15, cooldown: 0.1, auto: true, mag: 30, reserve: 120, reload: 1.6, spread: 0.018, bloom: 0.005, bloomMax: 0.07, pellets: 1, speed: 2500, range: 1250, recoil: 5, knockback: 18, scope: 1.15, barrel: 34 }),
  burst: def({ id: 'burst', name: 'Trident Burst', kind: 'bullet', tier: 1, damage: 17, cooldown: 0.34, auto: false, mag: 24, reserve: 96, reload: 1.7, spread: 0.012, bloom: 0.004, bloomMax: 0.03, pellets: 1, speed: 2600, range: 1300, recoil: 5, knockback: 20, scope: 1.2, barrel: 30, burst: 3 }),
  marksman: def({ id: 'marksman', name: 'Longshot DMR', kind: 'bullet', tier: 1, damage: 38, cooldown: 0.3, auto: false, mag: 12, reserve: 48, reload: 1.8, spread: 0.005, bloom: 0.01, bloomMax: 0.04, pellets: 1, speed: 2900, range: 1600, recoil: 12, knockback: 40, scope: 1.45, barrel: 38 }),
  shotgun: def({ id: 'shotgun', name: 'Scattergun', kind: 'bullet', tier: 1, damage: 11, cooldown: 0.72, auto: false, mag: 6, reserve: 30, reload: 2.1, spread: 0.11, bloom: 0, bloomMax: 0, pellets: 9, speed: 1900, range: 560, recoil: 90, knockback: 22, scope: 1, barrel: 32 }),
  sniper: def({ id: 'sniper', name: 'Peregrine Sniper', kind: 'bullet', tier: 2, damage: 95, cooldown: 1.15, auto: false, mag: 5, reserve: 15, reload: 2.5, spread: 0.0015, bloom: 0, bloomMax: 0, pellets: 1, speed: 4200, range: 2600, recoil: 70, knockback: 110, scope: 2, barrel: 44 }),
  rocket: def({ id: 'rocket', name: 'Boomstick RPG', kind: 'rocket', tier: 2, damage: 105, cooldown: 1.1, auto: false, mag: 1, reserve: 5, reload: 1.9, spread: 0.004, bloom: 0, bloomMax: 0, pellets: 1, speed: 640, range: 2600, recoil: 140, knockback: 620, scope: 1.2, barrel: 34, splashRadius: 125 }),
  flamer: def({ id: 'flamer', name: 'Scorcher', kind: 'flame', tier: 2, damage: 5, cooldown: 0.05, auto: true, mag: 90, reserve: 90, reload: 2.2, spread: 0.13, bloom: 0, bloomMax: 0, pellets: 1, speed: 560, range: 280, recoil: 2, knockback: 8, scope: 1, barrel: 34 }),
  rail: def({ id: 'rail', name: 'Phase Rail', kind: 'rail', tier: 2, damage: 72, cooldown: 0.95, auto: false, mag: 4, reserve: 12, reload: 2.3, spread: 0, bloom: 0, bloomMax: 0, pellets: 1, speed: 0, range: 2400, recoil: 60, knockback: 120, scope: 1.5, barrel: 36 }),
  saw: def({ id: 'saw', name: 'Ripper Disc', kind: 'saw', tier: 2, damage: 42, cooldown: 0.42, auto: false, mag: 8, reserve: 24, reload: 2, spread: 0.01, bloom: 0, bloomMax: 0, pellets: 1, speed: 860, range: 1500, recoil: 14, knockback: 90, scope: 1, barrel: 28 }),
  blade: def({ id: 'blade', name: 'Combat Blade', kind: 'blade', tier: 1, damage: 62, cooldown: 0.38, auto: true, mag: 1, reserve: 0, reload: 0, spread: 0, bloom: 0, bloomMax: 0, pellets: 1, speed: 0, range: 64, recoil: 0, knockback: 240, scope: 1, barrel: 22 }),
};

export const COMMON_WEAPONS: WeaponId[] = ['smg', 'rifle', 'burst', 'marksman', 'shotgun', 'blade'];
export const POWER_WEAPONS: WeaponId[] = ['sniper', 'rocket', 'flamer', 'rail', 'saw'];
export const ALL_WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
