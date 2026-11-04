/** Shared simulation constants. World units are pixels at 1x zoom. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const TILE = 32;

export const PLAYER_W = 22;
export const PLAYER_H = 46;
export const CROUCH_H = 32;
export const HEAD_H = 13;
/** Half-width of the head, so grazing the shoulder from above isn't a headshot. */
export const HEAD_HALF_W = 7;
export const SHOULDER_RATIO = 0.7;

export const GRAVITY = 840;
export const LOW_GRAVITY_MULT = 0.45;
export const MAX_FALL = 900;
export const RUN_SPEED = 235;
export const CROUCH_SPEED = 85;
export const GROUND_ACCEL = 2100;
export const AIR_ACCEL = 1350;
export const AIR_MAX_SPEED = 320;
export const KNOCKBACK_CAP = 900;
export const STEP_UP = TILE + 1;
/** How far feet may overlap a corner while walking up a slope. */
export const SLOPE_TOLERANCE = 14;
/** How far a walking player is pulled down to stay glued to a downhill slope. */
export const SLOPE_SNAP = 18;

export const JET_ACCEL = 1950;
export const JET_MAX_RISE = 370;
export const FUEL_MAX = 100;
export const FUEL_DRAIN = 30;
export const FUEL_REGEN_GROUND = 60;
export const FUEL_REGEN_AIR = 11;
export const FUEL_RESTART_MIN = 12;

export const MAX_HEALTH = 100;
export const REGEN_DELAY = 5;
export const REGEN_RATE = 14;
export const RESPAWN_DELAY = 3;
export const SPAWN_SHIELD = 1.6;

export const HEADSHOT_MULT = 1.5;
export const CROUCH_SPREAD_MULT = 0.55;
export const PICKUP_RADIUS = 34;
export const DROPPED_WEAPON_LIFE = 15;

export const MELEE_RANGE = 46;
export const MELEE_COOLDOWN = 0.42;
export const PUNCH_DAMAGE = 22;
export const THROW_SPEED = 660;
export const GRENADE_COOLDOWN = 0.7;
export const FRAG_FUSE = 2.1;
export const GAS_FUSE = 1.1;
export const FRAG_DAMAGE = 95;
export const FRAG_RADIUS = 130;
export const GAS_RADIUS = 95;
export const GAS_LIFE = 6;
export const GAS_DPS = 18;
export const BURN_TIME = 2;
export const BURN_DPS = 9;
export const START_FRAGS = 2;
export const START_GAS = 1;
export const START_MINES = 1;
export const MINE_ARM = 0.8;
export const MINE_TRIGGER = 48;
export const MINE_LIFE = 30;
export const CTF_CAPTURES = 3;
export const FLAG_RETURN = 12;
export const FLAG_REACH = 38;
export const FLAG_GRAB_SHIELD = 1.5;
export const FLAG_CARRIER_DAMAGE = 0.6;
export const MAX_GRENADES = 4;
export const DUAL_WIELD_COOLDOWN = 0.55;
export const SURVIVAL_LIVES = 3;
