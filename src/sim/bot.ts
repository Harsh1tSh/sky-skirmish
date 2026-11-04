import { DT, TILE } from './constants';
import type { Game } from './game';
import { shoulderOf } from './game';
import { Difficulty, emptyInput, Player, PlayerInput } from './types';
import { WEAPONS } from './weapons';

interface Profile {
  /** Seconds between first seeing an enemy and opening fire. */
  reaction: number;
  /** Size of the slow wobble added to aim, radians. */
  aimError: number;
  /** How fast the aim can turn, radians per second. */
  turnRate: number;
  grenadeChance: number;
}

const PROFILES: Record<Difficulty, Profile> = {
  easy: { reaction: 0.9, aimError: 0.2, turnRate: 4, grenadeChance: 0.1 },
  normal: { reaction: 0.55, aimError: 0.12, turnRate: 7, grenadeChance: 0.25 },
  hard: { reaction: 0.28, aimError: 0.06, turnRate: 12, grenadeChance: 0.45 },
};

export interface BotBrain {
  profile: Profile;
  targetId: number;
  path: number[];
  pathIndex: number;
  repathIn: number;
  seenFor: number;
  strafeDir: number;
  strafeFor: number;
  dodgeJetFor: number;
  refuelling: boolean;
  stuckFor: number;
  lastX: number;
  lastY: number;
  unstickFor: number;
  unstickDir: number;
  pulse: boolean;
  swapIn: number;
  grenadeIn: number;
  wobble: number;
}

export function createBrain(game: Game, _p: Player): BotBrain {
  const profile = PROFILES[game.config.difficulty];
  return {
    profile, targetId: -1, path: [], pathIndex: 0, repathIn: 0,
    seenFor: 0, strafeDir: game.rng.next() < 0.5 ? -1 : 1, strafeFor: 1,
    dodgeJetFor: 0, refuelling: false, stuckFor: 0, lastX: 0, lastY: 0,
    unstickFor: 0, unstickDir: 1, pulse: false, swapIn: 0, grenadeIn: 3,
    wobble: game.rng.range(0, 6.28),
  };
}

function preferredRange(weaponId: keyof typeof WEAPONS): number {
  switch (weaponId) {
    case 'sniper': return 900;
    case 'marksman': return 700;
    case 'rail': return 700;
    case 'rocket': return 520;
    case 'shotgun': return 220;
    case 'flamer': return 150;
    case 'blade': return 30;
    case 'smg': return 320;
    default: return 450;
  }
}

function pickTarget(game: Game, p: Player, b: BotBrain): Player | null {
  const s = shoulderOf(p);
  let best: Player | null = null;
  let bestScore = Infinity;
  for (const o of game.players) {
    if (!o.alive || !game.isEnemy(p, o)) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    const visible = d < 1100 && game.map.hasLineOfSight(s.x, s.y, o.x, o.y - o.height * 0.6);
    // Stick with the current target unless something is much closer, so bots don't dither.
    const score = d * (visible ? 0.45 : 1) * (o.id === b.targetId ? 0.8 : 1);
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

/** Capture the Flag duties. Odd and even ids split bots into attackers and defenders. */
function flagObjective(game: Game, p: Player): { x: number; y: number } | null {
  if (game.config.mode !== 'ctf') return null;
  const mine = game.flags.find((f) => f.team === p.team);
  const theirs = game.flags.find((f) => f.team !== p.team);
  if (!mine || !theirs) return null;
  if (theirs.carrier === p.id) return { x: mine.homeX, y: mine.homeY };
  if (mine.carrier !== -1) {
    const thief = game.getPlayer(mine.carrier);
    if (thief) return { x: thief.x, y: thief.y };
  }
  if (!mine.atHome) return { x: mine.x, y: mine.y };
  if (p.id % 2 === 0 && theirs.carrier === -1) return { x: theirs.x, y: theirs.y };
  return null;
}

/** Where the bot wants to walk or fly right now: a useful pickup, otherwise its target. */
function chooseGoal(game: Game, p: Player, target: Player | null): { x: number; y: number } | null {
  const objective = flagObjective(game, p);
  if (objective) return objective;
  const slots = p.weapons.filter((w) => w !== null);
  const bestTier = Math.max(...slots.map((w) => WEAPONS[w!.id].tier));
  const lowHealth = p.health < 45;
  let goal: { x: number; y: number } | null = null;
  let bestDist = lowHealth ? 1500 : bestTier === 0 ? 1200 : 500;
  for (const k of game.pickups) {
    if (!k.active) continue;
    let wanted = false;
    if (k.kind === 'health') wanted = lowHealth;
    else if (k.kind === 'grenade') wanted = p.frags === 0;
    else if (k.weapon) wanted = WEAPONS[k.weapon].tier > bestTier;
    if (!wanted) continue;
    const d = Math.hypot(k.x - p.x, k.y - p.y);
    if (d < bestDist) {
      bestDist = d;
      goal = { x: k.x, y: k.y };
    }
  }
  if (goal) return goal;
  return target ? { x: target.x, y: target.y } : null;
}

export function updateBot(game: Game, p: Player, b: BotBrain): PlayerInput {
  const input = emptyInput(p.aim);
  if (!p.alive) return input;
  const { map, rng } = game;
  b.pulse = !b.pulse;

  // Periodically re-evaluate who to fight and where to go.
  b.repathIn -= DT;
  if (game.tick % 12 === p.id % 12 || b.targetId === -1) {
    b.targetId = pickTarget(game, p, b)?.id ?? -1;
  }
  const target = b.targetId !== -1 ? game.getPlayer(b.targetId) ?? null : null;
  const liveTarget = target && target.alive ? target : null;

  const s = shoulderOf(p);
  let visible = false;
  let dist = Infinity;
  let tx = 0;
  let ty = 0;
  if (liveTarget) {
    tx = liveTarget.x;
    ty = liveTarget.y - liveTarget.height * 0.6;
    dist = Math.hypot(tx - s.x, ty - s.y);
    visible = dist < 1250 && map.hasLineOfSight(s.x, s.y, tx, ty);
  }
  b.seenFor = visible ? b.seenFor + DT : Math.max(0, b.seenFor - DT * 2);

  const slot = p.weapons[p.current]!;
  const def = WEAPONS[slot.id];
  const range = preferredRange(def.id);
  // Objectives come first: a flag carrier keeps moving rather than stopping to duel.
  const holdPosition = visible && dist < range * 1.15 && def.kind !== 'blade' && !flagObjective(game, p);

  // Navigation.
  let wantX = 0;
  let waypointY: number | null = null;
  if (holdPosition) {
    b.strafeFor -= DT;
    if (b.strafeFor <= 0) {
      b.strafeDir = rng.next() < 0.5 ? -1 : 1;
      b.strafeFor = rng.range(0.6, 1.8);
      if (rng.next() < 0.35 && p.fuel > 40) b.dodgeJetFor = rng.range(0.25, 0.7);
    }
    wantX = b.strafeDir;
    if (dist < range * 0.45) wantX = tx > s.x ? -1 : 1;
  } else {
    if (b.repathIn <= 0) {
      b.repathIn = rng.range(0.35, 0.6);
      const goal = chooseGoal(game, p, liveTarget);
      if (goal) {
        b.path = map.findPath(p.x, p.y, goal.x, goal.y);
        b.pathIndex = 0;
      } else {
        b.path = [];
      }
    }
    while (b.pathIndex < b.path.length - 1) {
      const c = b.path[b.pathIndex];
      const cx = ((c % map.width) + 0.5) * TILE;
      const cy = (Math.floor(c / map.width) + 1) * TILE;
      if (Math.abs(cx - p.x) < 26 && Math.abs(cy - p.y) < 34) b.pathIndex++;
      else break;
    }
    if (b.pathIndex < b.path.length) {
      // Aim two cells ahead when clear, which smooths out the grid staircase.
      const ahead = Math.min(b.pathIndex + 2, b.path.length - 1);
      let c = b.path[ahead];
      if (!map.hasLineOfSight(p.x, p.y - 20, ((c % map.width) + 0.5) * TILE, (Math.floor(c / map.width) + 1) * TILE - 20)) {
        c = b.path[b.pathIndex];
      }
      const wx = ((c % map.width) + 0.5) * TILE;
      const wy = (Math.floor(c / map.width) + 1) * TILE;
      if (Math.abs(wx - p.x) > 6) wantX = wx > p.x ? 1 : -1;
      waypointY = wy;
    }
  }

  input.moveX = wantX;

  // Fuel discipline: once dry, stay off the jets until there is a decent tank again.
  if (p.fuel < 6) b.refuelling = true;
  else if (p.fuel > 55 || (p.onGround && p.fuel > 35)) b.refuelling = false;

  let wantJet = false;
  if (waypointY !== null) {
    if (p.y > waypointY + 4) wantJet = true;
    else if (!p.onGround && p.vy > 50 && p.y > waypointY - 28) wantJet = true;
    if (waypointY > p.y + 8 && p.onGround) input.crouch = true;
  }
  if (b.dodgeJetFor > 0) {
    b.dodgeJetFor -= DT;
    wantJet = true;
  }

  // If a bot isn't getting anywhere, shake it loose with a random hop.
  const moved = Math.hypot(p.x - b.lastX, p.y - b.lastY);
  if (game.tick % 30 === 0) {
    if (moved < 14 && !holdPosition) b.stuckFor += 0.5;
    else b.stuckFor = 0;
    b.lastX = p.x;
    b.lastY = p.y;
    if (b.stuckFor >= 1) {
      b.stuckFor = 0;
      b.unstickFor = 0.6;
      b.unstickDir = rng.next() < 0.5 ? -1 : 1;
      b.repathIn = 0;
    }
  }
  if (b.unstickFor > 0) {
    b.unstickFor -= DT;
    input.moveX = b.unstickDir;
    wantJet = true;
    input.crouch = false;
  }
  input.jet = wantJet && !b.refuelling;

  // Aiming.
  b.wobble += DT * 2.3;
  let desired = p.aim;
  if (visible && liveTarget) {
    const speed = def.speed > 0 ? def.speed : 6000;
    const leadT = Math.min(0.6, dist / speed);
    const ax = tx + liveTarget.vx * leadT;
    const ay = ty + liveTarget.vy * leadT;
    // Fast flyers are harder to track, which rewards using the jetpack to dodge.
    const moving = Math.min(1, Math.hypot(liveTarget.vx, liveTarget.vy) / 300);
    const error = b.profile.aimError * (1 + moving * 0.7);
    desired = Math.atan2(ay - s.y, ax - s.x) + Math.sin(b.wobble) * error;
  } else if (input.moveX !== 0) {
    desired = input.moveX > 0 ? 0 : Math.PI;
  }
  const delta = Math.atan2(Math.sin(desired - p.aim), Math.cos(desired - p.aim));
  const maxTurn = b.profile.turnRate * DT;
  input.aim = p.aim + Math.max(-maxTurn, Math.min(maxTurn, delta));

  // Shooting.
  if (visible && b.seenFor >= b.profile.reaction && Math.abs(delta) < 0.14) {
    const inRange = dist < def.range * 0.95;
    const safeRocket = def.kind !== 'rocket' || dist > 150;
    if (inRange && safeRocket) input.fire = def.auto ? true : b.pulse;
  }
  if (visible && dist < 52 && def.kind !== 'blade') input.melee = b.pulse;

  // Grenades, thrown with a little arc.
  b.grenadeIn -= DT;
  if (visible && dist > 170 && dist < 620 && b.grenadeIn <= 0 && p.frags > 0) {
    b.grenadeIn = rng.range(3, 8);
    if (rng.next() < b.profile.grenadeChance) {
      input.grenade = true;
      input.aim += Math.cos(input.aim) >= 0 ? -0.3 : 0.3;
    }
  }

  // Weapon housekeeping.
  b.swapIn -= DT;
  const other = p.weapons[1 - p.current];
  if (b.swapIn <= 0 && other) {
    const currentEmpty = slot.mag === 0 && slot.reserve === 0 && def.kind !== 'blade';
    const otherHasAmmo = other.mag > 0 || other.reserve > 0 || WEAPONS[other.id].kind === 'blade';
    if ((currentEmpty && otherHasAmmo) || (WEAPONS[other.id].tier > def.tier && otherHasAmmo)) {
      input.swap = true;
      b.swapIn = 1;
    }
  }
  if (!visible && slot.mag < def.mag * 0.4 && slot.reserve > 0 && p.reloadTimer <= 0) input.reload = b.pulse;

  // Take a better weapon when standing on one.
  const offer = game.swappablePickup(p);
  if (offer && offer.weapon) {
    const worst = Math.min(...p.weapons.map((w) => (w ? WEAPONS[w.id].tier : -1)));
    if (WEAPONS[offer.weapon].tier > worst) {
      if (WEAPONS[p.weapons[p.current]!.id].tier > worst && p.weapons[1 - p.current]) {
        input.swap = b.pulse;
      } else {
        input.interact = b.pulse;
      }
    }
  }

  return input;
}
