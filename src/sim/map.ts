import { TILE } from './constants';

export const T_EMPTY = 0;
export const T_SOLID = 1;
export const T_PLATFORM = 2;
/** Rises to the right, like a forward slash. */
export const T_SLOPE_UP = 3;
/** Falls to the right, like a backslash. */
export const T_SLOPE_DOWN = 4;

export function isSlope(t: number): boolean {
  return t === T_SLOPE_UP || t === T_SLOPE_DOWN;
}

export type ThemeId = 'meadow' | 'desert' | 'ice' | 'night';
export type PickupSpotKind = 'common' | 'power' | 'health' | 'grenade';

export interface SpawnPoint { x: number; y: number; team: 0 | 1 | 2 }
export interface PickupSpot { x: number; y: number; kind: PickupSpotKind }

export interface RayHit {
  hit: boolean;
  x: number;
  y: number;
  /** Surface normal at the hit. */
  nx: number;
  ny: number;
  /** Fraction along the segment, 0..1. */
  t: number;
}

export class GameMap {
  private bfsParent: Int32Array;
  private bfsStamp: Int32Array;
  private bfsQueue: Int32Array;
  private stamp = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly theme: ThemeId,
    readonly width: number,
    readonly height: number,
    readonly tiles: Uint8Array,
    readonly spawns: SpawnPoint[],
    readonly pickups: PickupSpot[],
  ) {
    const n = width * height;
    this.bfsParent = new Int32Array(n);
    this.bfsStamp = new Int32Array(n);
    this.bfsQueue = new Int32Array(n);
  }

  get pixelWidth(): number { return this.width * TILE; }
  get pixelHeight(): number { return this.height * TILE; }

  /** Anything outside the map counts as solid, so nothing can leave it. */
  tile(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return T_SOLID;
    return this.tiles[ty * this.width + tx];
  }

  isSolid(tx: number, ty: number): boolean {
    return this.tile(tx, ty) === T_SOLID;
  }

  /** World y of a slope's surface at world x. */
  slopeSurface(t: number, tx: number, ty: number, x: number): number {
    const local = Math.max(0, Math.min(1, (x - tx * TILE) / TILE));
    return t === T_SLOPE_UP ? (ty + 1 - local) * TILE : (ty + local) * TILE;
  }

  /** True if the exact point is inside ground, including the filled half of a slope. */
  isSolidAt(x: number, y: number): boolean {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const t = this.tile(tx, ty);
    if (t === T_SOLID) return true;
    return isSlope(t) && y >= this.slopeSurface(t, tx, ty, x);
  }

  boxHitsSolid(left: number, top: number, right: number, bottom: number): boolean {
    const x0 = Math.floor(left / TILE);
    const x1 = Math.floor((right - 0.001) / TILE);
    const y0 = Math.floor(top / TILE);
    const y1 = Math.floor((bottom - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this.isSolid(tx, ty)) return true;
      }
    }
    return false;
  }

  /** Grid walk (Amanatides and Woo) against solid tiles. One-way platforms never stop shots. */
  raycast(x0: number, y0: number, x1: number, y1: number): RayHit {
    const dx = x1 - x0;
    const dy = y1 - y0;
    // A NaN here would make the grid walk below spin forever, so treat it as a hit.
    if (!Number.isFinite(dx + dy + x0 + y0)) return { hit: true, x: x0, y: y0, nx: 0, ny: 0, t: 0 };
    if (this.isSolidAt(x0, y0)) return { hit: true, x: x0, y: y0, nx: 0, ny: 0, t: 0 };
    let tx = Math.floor(x0 / TILE);
    let ty = Math.floor(y0 / TILE);

    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
    let tMaxX = dx !== 0
      ? (dx > 0 ? (tx + 1) * TILE - x0 : x0 - tx * TILE) / Math.abs(dx)
      : Infinity;
    let tMaxY = dy !== 0
      ? (dy > 0 ? (ty + 1) * TILE - y0 : y0 - ty * TILE) / Math.abs(dy)
      : Infinity;
    let tEnter = 0;
    let nx = 0;
    let ny = 0;

    for (;;) {
      const cell = this.tile(tx, ty);
      if (cell === T_SOLID) {
        return { hit: true, x: x0 + dx * tEnter, y: y0 + dy * tEnter, nx, ny, t: tEnter };
      }
      const tExit = Math.min(tMaxX, tMaxY, 1);
      if (isSlope(cell)) {
        // Positive means below the surface, which is inside the ground.
        const depth = (t: number): number => y0 + dy * t - this.slopeSurface(cell, tx, ty, x0 + dx * t);
        const atEnter = depth(tEnter);
        if (atEnter >= 0) {
          return { hit: true, x: x0 + dx * tEnter, y: y0 + dy * tEnter, nx, ny, t: tEnter };
        }
        const atExit = depth(tExit);
        if (atExit >= 0) {
          const t = tEnter + (tExit - tEnter) * (atEnter / (atEnter - atExit));
          const side = cell === T_SLOPE_UP ? -Math.SQRT1_2 : Math.SQRT1_2;
          return { hit: true, x: x0 + dx * t, y: y0 + dy * t, nx: side, ny: -Math.SQRT1_2, t };
        }
      }
      if (tExit >= 1) return { hit: false, x: x1, y: y1, nx: 0, ny: 0, t: 1 };
      nx = 0;
      ny = 0;
      if (tMaxX < tMaxY) {
        tEnter = tMaxX;
        tMaxX += tDeltaX;
        tx += stepX;
        nx = -stepX;
      } else {
        tEnter = tMaxY;
        tMaxY += tDeltaY;
        ty += stepY;
        ny = -stepY;
      }
    }
  }

  hasLineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    return !this.raycast(x0, y0, x1, y1).hit;
  }

  /** A nav cell holds a player's feet: it and the cell above must both be free of solid tiles. */
  isNavCell(tx: number, ty: number): boolean {
    return !this.isSolid(tx, ty) && !this.isSolid(tx, ty - 1);
  }

  /** Nearest walkable or flyable cell to a world position, searching outwards a little. */
  nearestNavCell(x: number, y: number): { tx: number; ty: number } | null {
    const cx = Math.floor(x / TILE);
    const cy = Math.floor((y - 1) / TILE);
    for (let r = 0; r <= 4; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          if (this.isNavCell(cx + ox, cy + oy)) return { tx: cx + ox, ty: cy + oy };
        }
      }
    }
    return null;
  }

  /**
   * Breadth-first path over nav cells. Everyone has a jetpack, so the whole open map is
   * traversable and flight counts the same as walking. Returns cell indices, start to goal.
   */
  findPath(fromX: number, fromY: number, toX: number, toY: number): number[] {
    const start = this.nearestNavCell(fromX, fromY);
    const goal = this.nearestNavCell(toX, toY);
    if (!start || !goal) return [];
    const w = this.width;
    const startIdx = start.ty * w + start.tx;
    const goalIdx = goal.ty * w + goal.tx;
    const stamp = ++this.stamp;
    const { bfsParent: parent, bfsStamp: seen, bfsQueue: queue } = this;
    let head = 0;
    let tail = 0;
    queue[tail++] = startIdx;
    seen[startIdx] = stamp;
    parent[startIdx] = -1;
    let found = startIdx === goalIdx;
    while (head < tail && !found) {
      const cur = queue[head++];
      const cx = cur % w;
      const cy = (cur - cx) / w;
      for (let i = 0; i < 4; i++) {
        const nx = cx + (i === 0 ? 1 : i === 1 ? -1 : 0);
        const ny = cy + (i === 2 ? 1 : i === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= this.height) continue;
        const idx = ny * w + nx;
        if (seen[idx] === stamp || !this.isNavCell(nx, ny)) continue;
        seen[idx] = stamp;
        parent[idx] = cur;
        if (idx === goalIdx) { found = true; break; }
        queue[tail++] = idx;
      }
    }
    if (!found) return [];
    const path: number[] = [];
    for (let c = goalIdx; c !== -1; c = parent[c]) path.push(c);
    path.reverse();
    return path;
  }
}

/** Small drawing API for laying out maps in code. Draw the left half and mirror it for fair play. */
export class MapBuilder {
  readonly tiles: Uint8Array;
  readonly spawns: SpawnPoint[] = [];
  readonly pickups: PickupSpot[] = [];

  constructor(
    readonly id: string,
    readonly name: string,
    readonly theme: ThemeId,
    readonly width: number,
    readonly height: number,
  ) {
    this.tiles = new Uint8Array(width * height);
  }

  private set(x: number, y: number, t: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.tiles[y * this.width + x] = t;
  }

  rect(x: number, y: number, w: number, h: number, t: number = T_SOLID): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, t);
    return this;
  }

  clear(x: number, y: number, w: number, h: number): this {
    return this.rect(x, y, w, h, T_EMPTY);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, t: number = T_SOLID): this {
    for (let j = Math.floor(cy - ry); j <= Math.ceil(cy + ry); j++) {
      for (let i = Math.floor(cx - rx); i <= Math.ceil(cx + rx); i++) {
        const nx = (i + 0.5 - cx) / rx;
        const ny = (j + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(i, j, t);
      }
    }
    return this;
  }

  platform(x: number, y: number, w: number): this {
    return this.rect(x, y, w, 1, T_PLATFORM);
  }

  border(thickness = 1): this {
    this.rect(0, 0, this.width, thickness);
    this.rect(0, this.height - thickness, this.width, thickness);
    this.rect(0, 0, thickness, this.height);
    this.rect(this.width - thickness, 0, thickness, this.height);
    return this;
  }

  spawn(x: number, y: number, team: 0 | 1 | 2 = 1): this {
    this.spawns.push({ x, y, team });
    return this;
  }

  pickup(x: number, y: number, kind: PickupSpotKind): this {
    this.pickups.push({ x, y, kind });
    return this;
  }

  /** Copies the left half onto the right. Team 1 spawns become team 2 spawns. */
  mirror(): this {
    const w = this.width;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < Math.floor(w / 2); x++) {
        this.set(w - 1 - x, y, this.tiles[y * w + x]);
      }
    }
    for (const s of [...this.spawns]) {
      this.spawns.push({ x: w - 1 - s.x, y: s.y, team: s.team === 1 ? 2 : s.team });
    }
    for (const p of [...this.pickups]) {
      if (p.x === w - 1 - p.x) continue;
      this.pickups.push({ x: w - 1 - p.x, y: p.y, kind: p.kind });
    }
    return this;
  }

  /** Cuts exposed step corners into ramps, so natural ground rolls instead of forming stairs. */
  autoSlope(): this {
    const w = this.width;
    const src = this.tiles.slice();
    const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= this.height ? T_SOLID : src[y * w + x]);
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (at(x, y) !== T_SOLID || at(x, y - 1) !== T_EMPTY || at(x, y + 1) !== T_SOLID) continue;
        const left = at(x - 1, y);
        const right = at(x + 1, y);
        if (left === T_EMPTY && right === T_SOLID) this.set(x, y, T_SLOPE_UP);
        else if (right === T_EMPTY && left === T_SOLID) this.set(x, y, T_SLOPE_DOWN);
      }
    }
    return this;
  }

  build(): GameMap {
    return new GameMap(this.id, this.name, this.theme, this.width, this.height, this.tiles, this.spawns, this.pickups);
  }
}
