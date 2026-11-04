import { Rng } from '../sim/rng';
import { isSlope, T_PLATFORM, T_SLOPE_UP, GameMap, ThemeId } from '../sim/map';
import { TILE } from '../sim/constants';
import type { WeaponId } from '../sim/weapons';

export interface Theme {
  sky: [string, string];
  far: string;
  near: string;
  rock: string;
  rockDark: string;
  surface: string;
  surfaceDark: string;
  platform: string;
  platformEdge: string;
  accent: string;
  /** Background fill behind everything in enclosed maps. */
  sun: string | null;
  sparkle: boolean;
}

export const THEMES: Record<ThemeId, Theme> = {
  meadow: {
    sky: ['#7fa8bd', '#d9dcc8'], far: '#a3aea6', near: '#7f8f78', rock: '#6b5238', rockDark: '#40301f',
    surface: '#8a9a45', surfaceDark: '#5c6b2c', platform: '#7d6443', platformEdge: '#4a3825', accent: '#ffd166',
    sun: '#fff5c2', sparkle: false,
  },
  desert: {
    sky: ['#c98a5a', '#ecd3a4'], far: '#c9a57a', near: '#ad8558', rock: '#99704a', rockDark: '#654529',
    surface: '#d6b67c', surfaceDark: '#a98752', platform: '#6d5238', platformEdge: '#443222', accent: '#ffe08a',
    sun: '#fff0c9', sparkle: false,
  },
  ice: {
    sky: ['#142544', '#3c6690'], far: '#28456e', near: '#203a5e', rock: '#4f79a3', rockDark: '#2f5078',
    surface: '#e2f6ff', surfaceDark: '#a8d8ee', platform: '#9fc9df', platformEdge: '#6a97b3', accent: '#8be9ff',
    sun: null, sparkle: true,
  },
  night: {
    sky: ['#0b0a24', '#35205e'], far: '#1e1a44', near: '#171434', rock: '#2d2d48', rockDark: '#1b1b30',
    surface: '#3de8ff', surfaceDark: '#1a93ad', platform: '#4b4b72', platformEdge: '#ff4f9a', accent: '#ff4f9a',
    sun: '#ffd6f0', sparkle: true,
  },
};

// ------------------------------------------------------------------ terrain

/** Paints the whole map once into an offscreen canvas. Drawing it each frame is then one image copy. */
export function bakeTerrain(map: GameMap, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(map.pixelWidth * scale);
  canvas.height = Math.ceil(map.pixelHeight * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  const theme = THEMES[map.theme];
  const rng = new Rng(map.width * 7919 + map.height);
  const T = TILE;
  const solid = (x: number, y: number): boolean => {
    const t = map.tile(x, y);
    return t !== 0 && t !== T_PLATFORM;
  };

  drawProps(ctx, map, theme, rng);

  // Rock, with rounded corners wherever two neighbouring sides are open.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!solid(x, y)) continue;
      const cell = map.tile(x, y);
      if (isSlope(cell)) {
        const up = cell === T_SLOPE_UP;
        ctx.fillStyle = theme.rock;
        ctx.beginPath();
        ctx.moveTo(x * T, (y + 1) * T);
        ctx.lineTo((x + 1) * T, (y + 1) * T);
        ctx.lineTo(up ? (x + 1) * T : x * T, y * T);
        ctx.closePath();
        ctx.fill();
        continue;
      }
      const up = solid(x, y - 1);
      const down = solid(x, y + 1);
      const left = solid(x - 1, y);
      const right = solid(x + 1, y);
      const r = 9;
      const px = x * T;
      const py = y * T;
      ctx.fillStyle = theme.rock;
      ctx.beginPath();
      ctx.moveTo(px + (!up && !left ? r : 0), py);
      ctx.lineTo(px + T - (!up && !right ? r : 0), py);
      if (!up && !right) ctx.quadraticCurveTo(px + T, py, px + T, py + r);
      ctx.lineTo(px + T, py + T - (!down && !right ? r : 0));
      if (!down && !right) ctx.quadraticCurveTo(px + T, py + T, px + T - r, py + T);
      ctx.lineTo(px + (!down && !left ? r : 0), py + T);
      if (!down && !left) ctx.quadraticCurveTo(px, py + T, px, py + T - r);
      ctx.lineTo(px, py + (!up && !left ? r : 0));
      if (!up && !left) ctx.quadraticCurveTo(px, py, px + r, py);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Depth shading: tiles further from open air get darker. Painting one pixel per tile and
  // scaling it up with smoothing gives a soft gradient rather than visible squares.
  const depth = computeDepth(map);
  const shadeMap = document.createElement('canvas');
  shadeMap.width = map.width;
  shadeMap.height = map.height;
  const shadeCtx = shadeMap.getContext('2d')!;
  shadeCtx.fillStyle = theme.rockDark;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const d = depth[y * map.width + x];
      if (d <= 1) continue;
      shadeCtx.globalAlpha = Math.min(0.68, (d - 1) * 0.15);
      shadeCtx.fillRect(x, y, 1, 1);
    }
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(shadeMap, 0, 0, map.pixelWidth, map.pixelHeight);

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!solid(x, y) || isSlope(map.tile(x, y))) continue;
      // Hand-sketched hatching, so the ground reads as inked rather than flat.
      if (rng.next() < 0.3) {
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = theme.rockDark;
        ctx.lineWidth = 1.4;
        const hx = x * T + rng.range(4, T - 12);
        const hy = y * T + rng.range(5, T - 12);
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          ctx.moveTo(hx + i * 4, hy + 8);
          ctx.lineTo(hx + i * 4 + 4, hy);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // Stones and flecks so large areas don't look flat.
      const flecks = rng.int(3);
      for (let i = 0; i < flecks; i++) {
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = rng.next() < 0.5 ? theme.rockDark : theme.surfaceDark;
        const sz = rng.range(1.5, 4.5);
        ctx.beginPath();
        ctx.ellipse(x * T + rng.range(3, T - 3), y * T + rng.range(3, T - 3), sz, sz * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  // Dark outline along open sides, then a bright surface on top-facing tiles.
  ctx.strokeStyle = theme.rockDark;
  ctx.lineWidth = 3;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!solid(x, y)) continue;
      const px = x * T;
      const py = y * T;
      const cell = map.tile(x, y);
      if (isSlope(cell)) {
        drawSlopeSurface(ctx, cell === T_SLOPE_UP, px, py, theme, rng, map.theme === 'meadow');
        ctx.strokeStyle = theme.rockDark;
        ctx.lineWidth = 3;
        continue;
      }
      ctx.beginPath();
      // Lines run edge to edge so walls read as one stroke, and stop short only at rounded corners.
      const openUp = !solid(x, y - 1);
      const openDown = !solid(x, y + 1);
      const openLeft = !solid(x - 1, y);
      const openRight = !solid(x + 1, y);
      const vTop = py + (openUp ? 8 : 0);
      const vBottom = py + T - (openDown ? 8 : 0);
      if (openLeft) { ctx.moveTo(px + 1, vTop); ctx.lineTo(px + 1, vBottom); }
      if (openRight) { ctx.moveTo(px + T - 1, vTop); ctx.lineTo(px + T - 1, vBottom); }
      if (openDown) { ctx.moveTo(px + (openLeft ? 8 : 0), py + T - 1); ctx.lineTo(px + T - (openRight ? 8 : 0), py + T - 1); }
      ctx.stroke();
      if (solid(x, y - 1)) continue;

      const insetL = solid(x - 1, y) ? 0 : 3;
      const insetR = solid(x + 1, y) ? 0 : 3;
      ctx.fillStyle = theme.surfaceDark;
      ctx.beginPath();
      ctx.moveTo(px + insetL, py);
      ctx.lineTo(px + T - insetR, py);
      for (let i = 4; i >= 0; i--) {
        const bx = px + insetL + ((T - insetL - insetR) * i) / 4;
        ctx.lineTo(bx, py + 8 + rng.range(0, 5));
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = theme.surface;
      ctx.fillRect(px + insetL, py, T - insetL - insetR, 6);
      if (map.theme === 'meadow') {
        ctx.strokeStyle = theme.surfaceDark;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 5; i++) {
          const gx = px + rng.range(2, T - 2);
          ctx.beginPath();
          ctx.moveTo(gx, py + 1);
          ctx.lineTo(gx + rng.range(-3, 3), py - rng.range(3, 7));
          ctx.stroke();
        }
        ctx.strokeStyle = theme.rockDark;
        ctx.lineWidth = 3;
      }
    }
  }

  // One-way platforms: slats on a beam, so they read differently from solid ground.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.tile(x, y) !== T_PLATFORM) continue;
      const px = x * T;
      const py = y * T;
      const left = map.tile(x - 1, y) === T_PLATFORM;
      const right = map.tile(x + 1, y) === T_PLATFORM;
      ctx.fillStyle = theme.platform;
      ctx.fillRect(px, py, T, 9);
      ctx.fillStyle = theme.platformEdge;
      ctx.fillRect(px, py + 8, T, 3);
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#000';
      ctx.fillRect(px + T / 2 - 0.5, py, 1, 8);
      ctx.fillRect(px, py, 1, 8);
      ctx.globalAlpha = 1;
      if (x % 4 === 0 || !left || !right) {
        ctx.fillStyle = theme.platformEdge;
        ctx.beginPath();
        const bx = !left ? px + 3 : !right ? px + T - 3 : px + T / 2;
        const lean = !left ? 9 : !right ? -9 : 0;
        ctx.moveTo(bx - 2, py + 10);
        ctx.lineTo(bx + 2, py + 10);
        ctx.lineTo(bx + lean + 1, py + 22);
        ctx.lineTo(bx + lean - 1, py + 22);
        ctx.fill();
      }
    }
  }
  return canvas;
}

function drawSlopeSurface(ctx: CanvasRenderingContext2D, up: boolean, px: number, py: number, theme: Theme, rng: Rng, grass: boolean): void {
  const T = TILE;
  const x0 = px;
  const y0 = up ? py + T : py;
  const x1 = px + T;
  const y1 = up ? py : py + T;
  // Dark band under the surface, then the bright top edge, following the ramp.
  ctx.fillStyle = theme.surfaceDark;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1, y1 + 12);
  ctx.lineTo(x0, y0 + 12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = theme.surface;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1, y1 + 6);
  ctx.lineTo(x0, y0 + 6);
  ctx.closePath();
  ctx.fill();
  if (!grass) return;
  ctx.strokeStyle = theme.surfaceDark;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    const f = rng.next();
    const gx = x0 + (x1 - x0) * f;
    const gy = y0 + (y1 - y0) * f;
    ctx.beginPath();
    ctx.moveTo(gx, gy + 1);
    ctx.lineTo(gx + rng.range(-3, 3), gy - rng.range(3, 7));
    ctx.stroke();
  }
}

function computeDepth(map: GameMap): Int32Array {
  const w = map.width;
  const depth = new Int32Array(w * map.height).fill(99);
  const queue: number[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < w; x++) {
      if (!map.isSolid(x, y)) {
        depth[y * w + x] = 0;
        queue.push(y * w + x);
      }
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    const x = c % w;
    const y = (c - x) / w;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= map.height) continue;
      const n = ny * w + nx;
      if (depth[n] > depth[c] + 1) {
        depth[n] = depth[c] + 1;
        queue.push(n);
      }
    }
  }
  return depth;
}

/** Scatter scenery on top surfaces. It's painted first so it sits behind the ground. */
function drawProps(ctx: CanvasRenderingContext2D, map: GameMap, theme: Theme, rng: Rng): void {
  const T = TILE;
  for (let x = 2; x < map.width - 2; x++) {
    for (let y = 2; y < map.height - 2; y++) {
      if (!map.isSolid(x, y) || map.tile(x, y - 1) !== 0 || map.tile(x, y - 2) !== 0 || map.tile(x, y - 3) !== 0) continue;
      if (rng.next() > 0.13) continue;
      const bx = x * T + T / 2;
      const by = y * T + 2;
      switch (map.theme) {
        case 'meadow': {
          const h = rng.range(40, 72);
          ctx.fillStyle = '#4c3a26';
          ctx.fillRect(bx - 3, by - h, 6, h);
          for (let i = 0; i < 3; i++) {
            ctx.fillStyle = i === 2 ? '#8b9c4e' : i === 1 ? '#6d8040' : '#536533';
            ctx.beginPath();
            ctx.arc(bx + (i - 1) * 10, by - h - 6 - (i === 2 ? 12 : 0), 19 - i * 2, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case 'desert': {
          const h = rng.range(24, 48);
          ctx.strokeStyle = '#5f8f4a';
          ctx.lineCap = 'round';
          ctx.lineWidth = 8;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx, by - h);
          ctx.moveTo(bx, by - h * 0.45);
          ctx.lineTo(bx - 11, by - h * 0.45);
          ctx.lineTo(bx - 11, by - h * 0.8);
          ctx.moveTo(bx, by - h * 0.6);
          ctx.lineTo(bx + 11, by - h * 0.6);
          ctx.lineTo(bx + 11, by - h * 0.95);
          ctx.stroke();
          ctx.lineCap = 'butt';
          break;
        }
        case 'ice': {
          const h = rng.range(16, 42);
          ctx.fillStyle = 'rgba(190, 235, 255, 0.75)';
          ctx.beginPath();
          ctx.moveTo(bx - 7, by);
          ctx.lineTo(bx, by - h);
          ctx.lineTo(bx + 7, by);
          ctx.fill();
          break;
        }
        case 'night': {
          ctx.fillStyle = '#26264a';
          ctx.fillRect(bx - 2, by - 54, 4, 54);
          ctx.fillStyle = theme.accent;
          ctx.shadowColor = theme.accent;
          ctx.shadowBlur = 14;
          ctx.fillRect(bx - 9, by - 58, 18, 4);
          ctx.shadowBlur = 0;
          break;
        }
      }
    }
  }
}

// ------------------------------------------------------------------ background

/** Builds the two repeating silhouette layers used for parallax. */
export function bakeBackdrop(themeId: ThemeId, layer: 0 | 1): HTMLCanvasElement {
  const W = 1600;
  const H = 700;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const theme = THEMES[themeId];
  const rng = new Rng(layer * 991 + themeId.length * 37 + 11);
  ctx.fillStyle = layer === 0 ? theme.far : theme.near;

  // Sum of sines with whole-number periods, so the layer repeats without a seam.
  const waves = Array.from({ length: 4 }, (_, i) => ({
    n: (i + 1) * (1 + rng.int(3)), amp: rng.range(30, 90) / (i + 1), ph: rng.range(0, 6.28),
  }));
  const base = layer === 0 ? 360 : 490;
  const heightAt = (x: number): number =>
    base + waves.reduce((sum, w) => sum + Math.sin((x / W) * Math.PI * 2 * w.n + w.ph) * w.amp, 0);

  if (themeId === 'night') {
    const step = layer === 0 ? 62 : 84;
    for (let x = 0; x < W; x += step) {
      const top = base + rng.range(-150, 90);
      ctx.fillStyle = layer === 0 ? theme.far : theme.near;
      ctx.fillRect(x, top, step - 6, H - top);
      for (let wy = top + 10; wy < H - 10; wy += 18) {
        for (let wx = x + 6; wx < x + step - 14; wx += 13) {
          if (rng.next() < 0.28) {
            ctx.fillStyle = rng.next() < 0.5 ? 'rgba(255,214,120,0.55)' : 'rgba(120,230,255,0.45)';
            ctx.fillRect(wx, wy, 6, 8);
          }
        }
      }
    }
    return canvas;
  }

  if (themeId === 'desert') {
    // Flat-topped mesas instead of smooth hills.
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const h = heightAt(x);
      ctx.lineTo(x, Math.round(h / 44) * 44);
    }
    ctx.lineTo(W, H);
    ctx.fill();
    return canvas;
  }

  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 6) ctx.lineTo(x, heightAt(x));
  ctx.lineTo(W, H);
  ctx.fill();

  if (themeId === 'ice') {
    // Hanging stalactites for the cavern ceiling.
    ctx.fillStyle = layer === 0 ? theme.far : theme.near;
    ctx.fillRect(0, 0, W, 70);
    for (let x = 0; x < W; x += 34) {
      const len = rng.range(30, layer === 0 ? 150 : 210);
      ctx.beginPath();
      ctx.moveTo(x - 20, 66);
      ctx.lineTo(x + rng.range(-6, 6), 66 + len);
      ctx.lineTo(x + 20, 66);
      ctx.fill();
    }
  } else if (layer === 1) {
    // A band of distant pines along the nearer ridge.
    ctx.fillStyle = '#66775f';
    for (let x = 0; x < W; x += rng.range(24, 62)) {
      const y = heightAt(x);
      const h = rng.range(20, 46);
      ctx.beginPath();
      ctx.moveTo(x - h * 0.34, y + 6);
      ctx.lineTo(x, y - h);
      ctx.lineTo(x + h * 0.34, y + 6);
      ctx.fill();
    }
  }
  return canvas;
}

// ------------------------------------------------------------------ weapons

type Part = [x: number, y: number, w: number, h: number, color: string];

/** The dark line used around soldiers and weapons. */
const INK = '#1a1712';

const STEEL = '#3a4150';
const DARK = '#22262f';
const GREY = '#6b7385';
const WOOD = '#8a5a34';

const WEAPON_ART: Record<WeaponId, Part[]> = {
  pistol: [[0, -4, 17, 5, STEEL], [14, -3.5, 4, 3, DARK], [0, 0, 5, 7, DARK]],
  smg: [[-2, -4, 22, 6, DARK], [18, -2.5, 8, 2.5, STEEL], [3, 2, 4, 10, STEEL], [-8, -2, 7, 3, GREY], [12, -6, 3, 2, GREY]],
  rifle: [[-3, -4, 26, 6, '#40503a'], [22, -2.5, 12, 2.5, DARK], [5, 2, 5, 9, DARK], [-13, -3, 11, 6, WOOD], [10, -7, 7, 3, DARK], [14, 2, 7, 3, WOOD]],
  burst: [[-3, -4, 24, 6, '#3d4552'], [20, -2.5, 10, 2.5, DARK], [4, 2, 5, 9, DARK], [-12, -3, 10, 6, DARK], [8, -7, 8, 3, GREY], [13, 2, 5, 6, '#3d4552']],
  marksman: [[-3, -3.5, 28, 5, '#59503e'], [24, -2.5, 15, 2, DARK], [3, 1.5, 5, 7, DARK], [-14, -3, 12, 6, WOOD], [6, -8, 13, 3.5, DARK]],
  shotgun: [[-3, -4, 20, 6, DARK], [15, -4, 18, 3, STEEL], [14, -0.5, 13, 3, WOOD], [-15, -3, 13, 6, WOOD]],
  sniper: [[-5, -3, 30, 5, '#2f3f4a'], [24, -2, 22, 2, DARK], [43, -3, 4, 4, DARK], [4, 2, 5, 7, DARK], [-17, -3, 13, 7, '#26323a'], [3, -9, 18, 4, '#11161c'], [22, 2, 2, 9, GREY]],
  rocket: [[-16, -6, 44, 9, '#4f6b3a'], [28, -7, 7, 11, '#2e3f22'], [-20, -7, 6, 11, '#2e3f22'], [2, 3, 5, 8, DARK], [6, -11, 8, 5, DARK]],
  flamer: [[-6, -4, 26, 7, '#7a2f22'], [20, -2, 14, 3, STEEL], [32, -3.5, 3, 6, '#ffb347'], [-3, 3, 5, 7, DARK], [2, -10, 11, 6, '#c9462b']],
  rail: [[-5, -5, 28, 8, '#2b2f55'], [22, -5, 15, 2.5, '#7c83ff'], [22, 0.5, 15, 2.5, '#7c83ff'], [-13, -3, 9, 6, '#1c1f3a'], [4, 3, 5, 7, DARK], [6, -8, 9, 3, '#7c83ff']],
  saw: [[-5, -4, 24, 7, '#6a5a1e'], [4, 3, 5, 8, DARK], [-11, -2, 7, 4, DARK], [17, -1, 7, 2, STEEL]],
  blade: [[-1, -1.5, 7, 4, DARK], [5, -4.5, 2.5, 9, GREY], [7, -2, 21, 4, '#d6dee8'], [27, -2, 4, 2.5, '#d6dee8']],
};

/** Draws a weapon with the grip at the origin, pointing along +x. */
export function drawWeapon(ctx: CanvasRenderingContext2D, id: WeaponId): void {
  ctx.fillStyle = INK;
  for (const [x, y, w, h] of WEAPON_ART[id]) ctx.fillRect(x - 0.9, y - 0.9, w + 1.8, h + 1.8);
  for (const [x, y, w, h, color] of WEAPON_ART[id]) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }
  if (id === 'saw') {
    ctx.fillStyle = '#c7ced8';
    ctx.beginPath();
    ctx.arc(18, -1, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = DARK;
    ctx.beginPath();
    ctx.arc(18, -1, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ------------------------------------------------------------------ soldiers

export interface SoldierPose {
  x: number;
  y: number;
  aim: number;
  height: number;
  color: string;
  walkPhase: number;
  speed: number;
  grounded: boolean;
  jetting: boolean;
  weapon: WeaponId | null;
  dual: boolean;
  /** Whole-body rotation, for corpses. */
  rotation: number;
  alpha: number;
  meleeSwing: number;
  shield: boolean;
  recoil: number;
}

function limb(ctx: CanvasRenderingContext2D, x0: number, y0: number, kx: number, ky: number, x1: number, y1: number, width: number, color: string): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(kx, ky);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = INK;
  ctx.lineWidth = width + 2.4;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** Fills the current path, then outlines it in ink. */
function inked(ctx: CanvasRenderingContext2D, fill: string, line = 1.3): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = line;
  ctx.stroke();
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const adj = (v: number): number => Math.max(0, Math.min(255, Math.round(v + 255 * amount)));
  const r = adj((n >> 16) & 255);
  const g = adj((n >> 8) & 255);
  const b = adj(n & 255);
  return `rgb(${r},${g},${b})`;
}

/** Draws a soldier with feet at (x, y). All shapes are drawn facing right, then mirrored if needed. */
export function drawSoldier(ctx: CanvasRenderingContext2D, s: SoldierPose): void {
  ctx.save();
  ctx.globalAlpha = s.alpha;
  ctx.translate(s.x, s.y);
  if (s.rotation !== 0) {
    ctx.translate(0, -s.height / 2);
    ctx.rotate(s.rotation);
    ctx.translate(0, s.height / 2);
  }
  const facing = Math.cos(s.aim) >= 0 ? 1 : -1;
  ctx.scale(facing, 1);
  const aim = facing === 1 ? s.aim : Math.PI - s.aim;
  const localAim = Math.atan2(Math.sin(aim), Math.cos(aim));

  const crouched = s.height < 40;
  const hipY = crouched ? -13 : -18;
  const chestY = hipY - 15;
  const headY = chestY - 8.5;
  const dark = shade(s.color, -0.28);
  const pants = '#5a5a3c';
  const boots = '#2a2118';

  // Legs.
  const moving = s.grounded && s.speed > 20;
  const swing = moving ? Math.sin(s.walkPhase) : 0;
  let f1x: number; let f1y: number; let f2x: number; let f2y: number;
  if (s.grounded) {
    f1x = 5 + swing * 9;
    f2x = -4 - swing * 9;
    f1y = moving ? -Math.max(0, Math.cos(s.walkPhase)) * 5 : 0;
    f2y = moving ? -Math.max(0, -Math.cos(s.walkPhase)) * 5 : 0;
    if (crouched) { f1x = 9; f2x = -7; }
  } else {
    // Legs trail behind while flying.
    f1x = 1 - s.speed * 0.012;
    f2x = -6 - s.speed * 0.012;
    f1y = -1;
    f2y = -4;
  }
  const kneeFwd = crouched ? 8 : 3;
  limb(ctx, -2, hipY, (f2x - 2) / 2 + kneeFwd - 1, (hipY + f2y) / 2, f2x, f2y - 2, 6, shade(pants, -0.08));
  ctx.beginPath();
  ctx.rect(f2x - 3, f2y - 3, 9, 4);
  inked(ctx, boots, 1);

  // Jetpack behind the back.
  roundRect(ctx, -14, chestY - 2, 8, 15, 2.5);
  inked(ctx, '#5c5a48');
  ctx.fillStyle = '#ff9d2e';
  ctx.fillRect(-13, chestY + 1, 6, 2.5);
  ctx.fillStyle = '#272b35';
  ctx.fillRect(-13.5, chestY + 13, 7, 3);
  if (s.jetting) {
    const len = 13 + Math.random() * 13;
    const grad = ctx.createLinearGradient(0, chestY + 15, 0, chestY + 15 + len);
    grad.addColorStop(0, '#fff6c9');
    grad.addColorStop(0.45, '#ffa52e');
    grad.addColorStop(1, 'rgba(255,70,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-14, chestY + 15);
    ctx.lineTo(-6, chestY + 15);
    ctx.lineTo(-10, chestY + 15 + len);
    ctx.fill();
  }

  // Back arm and second gun when dual wielding.
  const shoulderX = 0;
  const shoulderY = chestY + 2;
  if (s.dual && s.weapon) {
    ctx.save();
    ctx.translate(shoulderX - 1, shoulderY + 2);
    ctx.rotate(localAim);
    limb(ctx, 0, 0, 5, 1.5, 11, 0, 5, dark);
    ctx.translate(12 - s.recoil, 0);
    drawWeapon(ctx, s.weapon);
    ctx.restore();
  }

  // Torso.
  roundRect(ctx, -7.5, chestY - 2, 15, hipY - chestY + 4, 4);
  inked(ctx, s.color);
  ctx.fillStyle = dark;
  ctx.fillRect(-7.5, hipY - 2, 15, 3.5);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  roundRect(ctx, -2, chestY + 1, 8, 9, 2);
  ctx.fill();

  // Front leg, over the torso.
  limb(ctx, 2, hipY, (f1x + 2) / 2 + kneeFwd, (hipY + f1y) / 2, f1x, f1y - 2, 6, pants);
  ctx.beginPath();
  ctx.rect(f1x - 3, f1y - 3, 9, 4);
  inked(ctx, boots, 1);

  // Head: tilts a little with the aim.
  ctx.save();
  ctx.translate(1, headY);
  ctx.rotate(localAim * 0.28);
  ctx.beginPath();
  ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
  inked(ctx, '#e3bb92');
  ctx.fillStyle = '#1b2230';
  roundRect(ctx, 1, -2.6, 7.5, 4, 1.6);
  ctx.fill();
  ctx.fillStyle = 'rgba(160,230,255,0.75)';
  ctx.fillRect(3, -2, 3.2, 1.4);
  // Helmet.
  ctx.beginPath();
  ctx.arc(-0.5, -1.5, 8.6, Math.PI * 0.98, Math.PI * 1.98);
  ctx.closePath();
  inked(ctx, dark);
  ctx.beginPath();
  ctx.rect(-9, -2.2, 18.5, 2.4);
  inked(ctx, dark, 1);
  ctx.restore();

  // Front arm and weapon.
  ctx.save();
  ctx.translate(shoulderX, shoulderY);
  const swingAngle = s.meleeSwing > 0 ? Math.sin(s.meleeSwing * Math.PI) * -1.5 : 0;
  ctx.rotate(localAim + swingAngle);
  const reach = 12 - s.recoil;
  if (s.weapon) {
    ctx.save();
    ctx.translate(reach, 0);
    drawWeapon(ctx, s.weapon);
    ctx.restore();
    const twoHanded = s.weapon !== 'pistol' && s.weapon !== 'blade' && !s.dual;
    if (twoHanded) limb(ctx, -1, 1, 11, 6, reach + 12, 1.5, 4.4, s.color);
    limb(ctx, 0, 0, reach * 0.5, 3, reach, 0.5, 5, s.color);
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(reach, 0.5, 2.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.restore();

  if (s.shield) {
    ctx.save();
    ctx.globalAlpha = 0.35 + Math.sin(performance.now() / 70) * 0.15;
    ctx.strokeStyle = '#9ff4ff';
    ctx.fillStyle = 'rgba(120,230,255,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y - s.height / 2, 21, s.height / 2 + 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
