import { GAS_RADIUS } from '../sim/constants';
import { Game, TEAM_COLORS } from '../sim/game';
import { ThemeId } from '../sim/map';
import { Flag, GameEvent, Pickup } from '../sim/types';
import { WEAPONS } from '../sim/weapons';
import { bakeBackdrop, bakeTerrain, drawSoldier, drawWeapon, THEMES } from './art';

interface Particle {
  kind: 'dot' | 'smoke' | 'glow' | 'ring' | 'text' | 'shard';
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; color: string;
  gravity: number; drag: number; rot: number; spin: number;
  text?: string;
}

interface Beam { x0: number; y0: number; x1: number; y1: number; life: number }

interface Corpse {
  x: number; y: number; vx: number; vy: number; rot: number; spin: number; life: number;
  color: string; aim: number;
}

const MAX_PARTICLES = 1400;

export class Camera {
  x = 0;
  y = 0;
  scale = 1;
  shake = 0;
  viewW = 1;
  viewH = 1;

  worldX(screenX: number): number { return this.x + (screenX - this.viewW / 2) / this.scale; }
  worldY(screenY: number): number { return this.y + (screenY - this.viewH / 2) / this.scale; }
  screenX(worldX: number): number { return (worldX - this.x) * this.scale + this.viewW / 2; }
  screenY(worldY: number): number { return (worldY - this.y) * this.scale + this.viewH / 2; }
}

export class Renderer {
  readonly camera = new Camera();
  readonly ctx: CanvasRenderingContext2D;
  dpr = 1;
  screenShake = true;
  showDamageNumbers = true;
  /** 1 = everything, 0.5 = fewer particles and no glow, for slower machines. */
  quality = 1;
  /** The player this screen belongs to, or -1 on the menu. Their name tag is hidden. */
  localId = -1;

  private terrain: HTMLCanvasElement | null = null;
  private terrainMapId = '';
  private terrainScale = 1;
  private backdrops = new Map<ThemeId, [HTMLCanvasElement, HTMLCanvasElement]>();
  private particles: Particle[] = [];
  private beams: Beam[] = [];
  private corpses: Corpse[] = [];
  private flash = 0;
  private walkPhase = new Map<number, number>();
  private recoil = new Map<number, number>();
  private swing = new Map<number, number>();
  private clouds: { x: number; y: number; r: number; speed: number }[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    for (let i = 0; i < 12; i++) {
      this.clouds.push({ x: Math.random() * 1800, y: Math.random() * 260, r: 26 + Math.random() * 42, speed: 4 + Math.random() * 10 });
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.camera.viewW = w;
    this.camera.viewH = h;
  }

  /** Resets per-match visuals and bakes the terrain for this map if needed. */
  prepare(game: Game): void {
    this.particles = [];
    this.beams = [];
    this.corpses = [];
    this.walkPhase.clear();
    this.recoil.clear();
    this.swing.clear();
    if (this.terrainMapId !== game.map.id) {
      const coarse = window.matchMedia?.('(pointer: coarse)').matches;
      this.terrainScale = coarse ? 1 : 1.5;
      this.terrain = bakeTerrain(game.map, this.terrainScale);
      this.terrainMapId = game.map.id;
    }
    const theme = game.map.theme;
    if (!this.backdrops.has(theme)) this.backdrops.set(theme, [bakeBackdrop(theme, 0), bakeBackdrop(theme, 1)]);
  }

  // ---------------------------------------------------------------- camera

  baseScale(): number {
    const { viewW, viewH } = this.camera;
    return Math.max(viewW / 1180, viewH / 660);
  }

  updateCamera(game: Game, focusX: number, focusY: number, lookX: number, lookY: number, zoomOut: number, dt: number): void {
    const cam = this.camera;
    const targetScale = this.baseScale() / zoomOut;
    cam.scale += (targetScale - cam.scale) * Math.min(1, dt * 7);
    const tx = focusX + lookX;
    const ty = focusY + lookY;
    const follow = Math.min(1, dt * 9);
    cam.x += (tx - cam.x) * follow;
    cam.y += (ty - cam.y) * follow;
    const halfW = cam.viewW / 2 / cam.scale;
    const halfH = cam.viewH / 2 / cam.scale;
    const { pixelWidth: mw, pixelHeight: mh } = game.map;
    cam.x = halfW * 2 >= mw ? mw / 2 : Math.max(halfW, Math.min(mw - halfW, cam.x));
    cam.y = halfH * 2 >= mh ? mh / 2 : Math.max(halfH, Math.min(mh - halfH, cam.y));
    cam.shake = Math.max(0, cam.shake - dt * 26);
  }

  snapCamera(x: number, y: number): void {
    this.camera.x = x;
    this.camera.y = y;
    this.camera.scale = this.baseScale();
  }

  addShake(amount: number): void {
    if (this.screenShake) this.camera.shake = Math.min(18, this.camera.shake + amount);
  }

  // ---------------------------------------------------------------- events to effects

  handleEvent(e: GameEvent, game: Game, localId: number): void {
    switch (e.type) {
      case 'shot': {
        const def = WEAPONS[e.weapon];
        this.recoil.set(e.owner, Math.min(7, 2 + def.recoil * 0.06));
        const cos = Math.cos(e.angle);
        const sin = Math.sin(e.angle);
        if (def.kind === 'bullet' || def.kind === 'rail') {
          this.spawn({ kind: 'glow', x: e.x + cos * 5, y: e.y + sin * 5, size: def.pellets > 1 ? 21 : 13, life: 0.07, color: '#ffe9a8' });
          this.spawn({
            kind: 'shard', x: e.x - cos * 16, y: e.y - sin * 16,
            vx: -cos * 60 + rand(-40, 40), vy: -130 + rand(-40, 20), size: 2.2, life: 0.8, color: '#d9a441', gravity: 900, spin: rand(-14, 14),
          });
        } else if (def.kind === 'rocket') {
          for (let i = 0; i < 8; i++) {
            this.spawn({ kind: 'smoke', x: e.x - cos * 26, y: e.y - sin * 26, vx: -cos * rand(60, 170) + rand(-24, 24), vy: -sin * rand(60, 170) + rand(-24, 24), size: rand(8, 15), life: 0.5, color: '#b9b9b9' });
          }
        }
        if (e.owner === localId) this.addShake(Math.min(4.5, def.recoil * 0.035 + 0.3));
        break;
      }
      case 'rail':
        this.beams.push({ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, life: 0.28 });
        break;
      case 'impact': {
        for (let i = 0; i < 5; i++) {
          this.spawn({ kind: 'dot', x: e.x, y: e.y, vx: e.nx * rand(40, 190) + rand(-90, 90), vy: e.ny * rand(40, 190) + rand(-90, 90), size: rand(1, 2.4), life: rand(0.14, 0.32), color: '#ffe9a8', gravity: 500 });
        }
        this.spawn({ kind: 'smoke', x: e.x, y: e.y, vx: e.nx * 30, vy: e.ny * 30, size: 6, life: 0.28, color: '#9d9d9d' });
        break;
      }
      case 'hit': {
        const victim = game.getPlayer(e.victim);
        const count = e.shielded ? 4 : Math.min(9, 2 + Math.floor(e.damage / 10));
        for (let i = 0; i < count; i++) {
          this.spawn({ kind: 'dot', x: e.x, y: e.y, vx: rand(-170, 170), vy: rand(-210, 70), size: rand(1.5, 3), life: rand(0.2, 0.42), color: e.shielded ? '#9ff4ff' : victim?.color ?? '#fff', gravity: 620 });
        }
        if (this.showDamageNumbers && e.damage > 0 && e.attacker === localId) {
          this.spawn({ kind: 'text', x: e.x + rand(-7, 7), y: e.y - 16, vx: rand(-16, 16), vy: -74, size: e.headshot ? 19 : 14, life: 0.8, color: e.headshot ? '#ffd166' : '#ffffff', text: `${e.damage}`, drag: 2 });
        }
        if (e.victim === localId && !e.shielded) this.addShake(Math.min(7, 1.5 + e.damage * 0.08));
        break;
      }
      case 'explosion': {
        this.spawn({ kind: 'ring', x: e.x, y: e.y, size: e.radius, life: 0.34, color: '#fff3c4' });
        this.spawn({ kind: 'glow', x: e.x, y: e.y, size: e.radius * 0.95, life: 0.17, color: '#ffc14d' });
        const n = Math.round(30 * this.quality);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = rand(60, 460);
          this.spawn({ kind: 'dot', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: rand(1.5, 3.6), life: rand(0.25, 0.7), color: Math.random() < 0.5 ? '#ffb347' : '#ffe9a8', gravity: 520 });
        }
        for (let i = 0; i < n * 0.6; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = rand(20, 150);
          this.spawn({ kind: 'smoke', x: e.x + Math.cos(a) * 18, y: e.y + Math.sin(a) * 18, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 34, size: rand(13, 28), life: rand(0.5, 1.15), color: '#6d6d6d' });
        }
        const cam = this.camera;
        const d = Math.hypot(e.x - cam.x, e.y - cam.y);
        if (d < 900) {
          this.addShake((1 - d / 900) * 17);
          this.flash = Math.max(this.flash, (1 - d / 900) * 0.28);
        }
        break;
      }
      case 'gas':
        this.spawn({ kind: 'ring', x: e.x, y: e.y, size: GAS_RADIUS, life: 0.42, color: '#a8f06a' });
        break;
      case 'kill': {
        const v = game.getPlayer(e.victim);
        if (v) {
          this.corpses.push({
            x: v.x, y: v.y, vx: v.vx * 0.6 + rand(-50, 50), vy: Math.min(v.vy, 0) - rand(120, 220),
            rot: 0, spin: rand(3, 7) * (v.vx >= 0 ? 1 : -1), life: 2.2, color: v.color, aim: v.aim,
          });
          for (let i = 0; i < 8; i++) {
            this.spawn({ kind: 'smoke', x: v.x + rand(-11, 11), y: v.y - rand(0, 38), vx: rand(-40, 40), vy: rand(-70, -10), size: rand(7, 14), life: rand(0.35, 0.75), color: '#d9d9d9' });
          }
        }
        break;
      }
      case 'spawn':
        this.spawn({ kind: 'ring', x: e.x, y: e.y - 23, size: 40, life: 0.32, color: '#9ff4ff' });
        break;
      case 'pickup':
        this.spawn({ kind: 'ring', x: e.x, y: e.y - 8, size: 28, life: 0.24, color: '#ffffff' });
        break;
      case 'melee':
        this.swing.set(e.id, 1);
        if (e.landed) {
          for (let i = 0; i < 6; i++) {
            this.spawn({ kind: 'dot', x: e.x, y: e.y, vx: rand(-150, 150), vy: rand(-150, 150), size: rand(1.4, 2.8), life: 0.22, color: '#ffffff' });
          }
        }
        break;
      default:
        break;
    }
  }

  private spawn(p: Partial<Particle> & { kind: Particle['kind']; x: number; y: number; life: number; size: number; color: string }): void {
    if (this.particles.length >= MAX_PARTICLES * this.quality) this.particles.shift();
    this.particles.push({ vx: 0, vy: 0, gravity: 0, drag: 0, rot: 0, spin: 0, max: p.life, ...p });
  }

  private emitTrails(game: Game): void {
    for (const pr of game.projectiles) {
      if (pr.kind === 'rocket') {
        this.spawn({ kind: 'smoke', x: pr.x, y: pr.y, vx: rand(-14, 14), vy: rand(-22, 8), size: rand(5, 9), life: rand(0.3, 0.6), color: '#bcbcbc' });
        this.spawn({ kind: 'glow', x: pr.x, y: pr.y, size: 9, life: 0.09, color: '#ffa52e' });
      }
    }
    for (const c of game.clouds) {
      if (Math.random() < 0.42 * this.quality) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * GAS_RADIUS * 0.82;
        this.spawn({ kind: 'smoke', x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, vx: rand(-13, 13), vy: rand(-16, 2), size: rand(17, 34), life: rand(0.6, 1.2), color: '#8fd14f' });
      }
    }
    for (const p of game.players) {
      if (!p.alive) continue;
      if (p.jetting && Math.random() < 0.55 * this.quality) {
        const back = Math.cos(p.aim) >= 0 ? -10 : 10;
        this.spawn({ kind: 'smoke', x: p.x + back, y: p.y - p.height * 0.28, vx: rand(-18, 18) - p.vx * 0.05, vy: rand(70, 170), size: rand(3, 7), life: rand(0.22, 0.46), color: '#e0e0e0' });
      }
      if (p.burnTimer > 0 && Math.random() < 0.6) {
        this.spawn({ kind: 'glow', x: p.x + rand(-9, 9), y: p.y - rand(4, p.height), vx: rand(-14, 14), vy: rand(-80, -20), size: rand(5, 10), life: 0.26, color: '#ff8a2e' });
      }
    }
  }

  // ---------------------------------------------------------------- frame

  /** `alpha` blends between the last two sim ticks so motion stays smooth on any refresh rate. */
  render(game: Game, alpha: number, dt: number, paused: boolean): void {
    const { ctx, camera: cam } = this;
    if (!paused) {
      this.emitTrails(game);
      this.stepParticles(game, dt);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(game, dt);

    const sx = this.screenShake && cam.shake > 0 ? (Math.random() - 0.5) * cam.shake : 0;
    const sy = this.screenShake && cam.shake > 0 ? (Math.random() - 0.5) * cam.shake : 0;
    ctx.save();
    ctx.translate(cam.viewW / 2 + sx, cam.viewH / 2 + sy);
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-cam.x, -cam.y);

    this.drawPickups(game);
    for (const flag of game.flags) this.drawFlag(flag);
    this.drawCorpses();
    this.drawPlayers(game, alpha, dt, paused);
    this.drawProjectiles(game, alpha);
    this.drawTerrain();
    this.drawParticles();
    this.drawBeams();
    this.drawNames(game, alpha);
    ctx.restore();

    if (this.flash > 0.004) {
      ctx.fillStyle = `rgba(255,240,205,${this.flash})`;
      ctx.fillRect(0, 0, cam.viewW, cam.viewH);
      if (!paused) this.flash *= 0.84;
    }
  }

  private stepParticles(game: Game, dt: number): void {
    const list = this.particles;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.gravity * dt;
      if (p.drag) {
        p.vx -= p.vx * p.drag * dt;
        p.vy -= p.vy * p.drag * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      if (p.gravity > 0 && game.map.isSolidAt(p.x, p.y)) {
        p.vy *= -0.3;
        p.vx *= 0.55;
        p.y -= 2;
      }
      list[w++] = p;
    }
    list.length = w;

    for (let i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].life -= dt;
      if (this.beams[i].life <= 0) this.beams.splice(i, 1);
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.life -= dt;
      if (c.life <= 0) {
        this.corpses.splice(i, 1);
        continue;
      }
      c.vy += 900 * dt;
      c.x += c.vx * dt;
      if (game.map.isSolidAt(c.x, c.y - 10)) {
        c.x -= c.vx * dt;
        c.vx = 0;
      }
      const ny = c.y + c.vy * dt;
      if (game.map.isSolidAt(c.x, ny)) {
        c.vy = 0;
        c.vx *= 0.8;
        c.spin *= 0.6;
        const target = c.rot > 0 ? Math.PI / 2 : -Math.PI / 2;
        c.rot += (target - c.rot) * Math.min(1, dt * 11);
      } else {
        c.y = ny;
        c.rot += c.spin * dt;
      }
    }
  }

  private drawBackground(game: Game, dt: number): void {
    const { ctx, camera: cam } = this;
    const theme = THEMES[game.map.theme];
    const grad = ctx.createLinearGradient(0, 0, 0, cam.viewH);
    grad.addColorStop(0, theme.sky[0]);
    grad.addColorStop(1, theme.sky[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);

    if (theme.sun) {
      const sx = cam.viewW * 0.74 - cam.x * 0.012;
      const sy = cam.viewH * 0.2 - cam.y * 0.012;
      ctx.fillStyle = theme.sun;
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.arc(sx, sy, 86, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(sx, sy, 48, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (theme.sparkle) {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 70; i++) {
        // Hashing the index scatters the stars. A plain multiple would line them up in rows.
        const sx = hash01(i * 12.9898) * cam.viewW;
        const sy = hash01(i * 78.233) * cam.viewH * 0.75;
        ctx.globalAlpha = 0.25 + hash01(i * 37.719) * 0.5;
        ctx.fillRect(sx, sy, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
    }

    const layers = this.backdrops.get(game.map.theme);
    if (layers) {
      const parallax = [0.1, 0.24];
      layers.forEach((img, i) => {
        const ratio = Math.max(1, cam.viewW / 1400);
        const w = img.width * ratio;
        const h = img.height * ratio;
        const yBase = cam.viewH - h * 0.92 - (cam.y - game.map.pixelHeight * 0.7) * parallax[i] * cam.scale * 0.5;
        let x = -((cam.x * parallax[i] * cam.scale) % w);
        if (x > 0) x -= w;
        for (; x < cam.viewW; x += w) {
          ctx.drawImage(img, x, yBase, w, h);
        }
        const bottom = yBase + h;
        if (bottom < cam.viewH) {
          ctx.fillStyle = i === 0 ? theme.far : theme.near;
          ctx.fillRect(0, bottom - 1, cam.viewW, cam.viewH - bottom + 1);
        }
      });
    }

    if (game.map.theme === 'meadow' || game.map.theme === 'desert') {
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      for (const c of this.clouds) {
        c.x += c.speed * dt;
        const span = cam.viewW + 300;
        const x = ((c.x - cam.x * 0.05) % span + span) % span - 150;
        const y = c.y - cam.y * 0.03;
        ctx.beginPath();
        ctx.ellipse(x, y, c.r * 1.9, c.r * 0.55, 0, 0, Math.PI * 2);
        ctx.ellipse(x - c.r * 0.7, y + 3, c.r * 0.8, c.r * 0.42, 0, 0, Math.PI * 2);
        ctx.ellipse(x + c.r * 0.5, y - c.r * 0.26, c.r, c.r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawTerrain(): void {
    if (!this.terrain) return;
    const { ctx, camera: cam } = this;
    const s = this.terrainScale;
    const halfW = cam.viewW / 2 / cam.scale + 24;
    const halfH = cam.viewH / 2 / cam.scale + 24;
    const sx = Math.max(0, (cam.x - halfW) * s);
    const sy = Math.max(0, (cam.y - halfH) * s);
    const sw = Math.min(this.terrain.width - sx, halfW * 2 * s);
    const sh = Math.min(this.terrain.height - sy, halfH * 2 * s);
    if (sw <= 0 || sh <= 0) return;
    ctx.drawImage(this.terrain, sx, sy, sw, sh, sx / s, sy / s, sw / s, sh / s);
  }

  private drawPickups(game: Game): void {
    const { ctx } = this;
    const bob = Math.sin(performance.now() / 280) * 2.5;
    for (const k of game.pickups) {
      if (!k.active) continue;
      this.drawPickup(ctx, k, bob);
    }
  }

  private drawPickup(ctx: CanvasRenderingContext2D, k: Pickup, bob: number): void {
    const blinking = k.spot === -1 && k.life < 4 && Math.floor(k.life * 6) % 2 === 0;
    if (blinking) return;
    const x = k.x;
    const y = k.y - 12 + bob;
    ctx.save();
    if (k.kind === 'health') {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#c62f3b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect?.(x - 11, y - 9, 22, 18, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e63946';
      ctx.fillRect(x - 2.5, y - 6, 5, 12);
      ctx.fillRect(x - 6, y - 2.5, 12, 5);
    } else if (k.kind === 'grenade') {
      ctx.fillStyle = '#39563a';
      ctx.beginPath();
      ctx.ellipse(x, y + 1, 7.5, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c9c9c9';
      ctx.fillRect(x - 3, y - 11, 6, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x - 7, y - 1, 14, 1.5);
    } else if (k.weapon) {
      const tier = WEAPONS[k.weapon].tier;
      const glow = tier === 2 ? '#ffd166' : 'rgba(255,255,255,0.8)';
      ctx.fillStyle = tier === 2 ? 'rgba(255,209,102,0.26)' : 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.ellipse(x, y, 30, 17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = glow;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.translate(x - 8, y);
      drawWeapon(ctx, k.weapon);
    }
    ctx.restore();
  }

  private drawFlag(flag: Flag): void {
    const { ctx } = this;
    const color = TEAM_COLORS[flag.team];
    const carried = flag.carrier !== -1;
    // Carried flags ride up on the carrier's back, a little behind their head.
    const x = flag.x + (carried ? -10 : 0);
    const y = flag.y + (carried ? 14 : 2);
    const h = carried ? 44 : 56;
    ctx.strokeStyle = '#1a1712';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - h);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + 1, y - h);
    const t = performance.now() / 170;
    for (let i = 1; i <= 6; i++) ctx.lineTo(x + 1 + i * 5.2, y - h + Math.sin(t + i * 0.9) * 2.2 + i * 0.4);
    for (let i = 6; i >= 0; i--) ctx.lineTo(x + 1 + i * 5.2, y - h + 18 + Math.sin(t + i * 0.9) * 2.2 - i * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (flag.atHome) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(flag.homeX, flag.homeY + 2, 34, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawCorpses(): void {
    for (const c of this.corpses) {
      drawSoldier(this.ctx, {
        x: c.x, y: c.y, aim: c.aim, height: 46, color: c.color, walkPhase: 0, speed: 0, grounded: true,
        jetting: false, weapon: null, dual: false, rotation: c.rot, alpha: Math.min(1, c.life / 0.5),
        meleeSwing: 0, shield: false, recoil: 0,
      });
    }
  }

  private drawPlayers(game: Game, alpha: number, dt: number, paused: boolean): void {
    for (const p of game.players) {
      if (!p.alive) continue;
      const x = p.prevX + (p.x - p.prevX) * alpha;
      const y = p.prevY + (p.y - p.prevY) * alpha + p.stepOffset;
      let phase = this.walkPhase.get(p.id) ?? 0;
      let recoil = this.recoil.get(p.id) ?? 0;
      let swing = this.swing.get(p.id) ?? 0;
      if (!paused) {
        if (p.onGround) phase += Math.abs(p.vx) * dt * 0.052;
        recoil = Math.max(0, recoil - dt * 42);
        swing = Math.max(0, swing - dt * 5);
        this.walkPhase.set(p.id, phase);
        this.recoil.set(p.id, recoil);
        this.swing.set(p.id, swing);
      }
      const slot = p.weapons[p.current];
      drawSoldier(this.ctx, {
        x, y, aim: p.aim, height: p.height, color: p.color, walkPhase: phase, speed: Math.abs(p.vx), grounded: p.onGround,
        jetting: p.jetting, weapon: slot?.id ?? null, dual: game.modsFor(p).dualWield, rotation: 0, alpha: 1,
        meleeSwing: swing, shield: p.shield > 0, recoil,
      });
    }
  }

  private drawProjectiles(game: Game, alpha: number): void {
    const { ctx } = this;
    for (const pr of game.projectiles) {
      const x = pr.prevX + (pr.x - pr.prevX) * alpha;
      const y = pr.prevY + (pr.y - pr.prevY) * alpha;
      switch (pr.kind) {
        case 'bullet': {
          const speed = Math.hypot(pr.vx, pr.vy) || 1;
          const len = Math.min(58, speed * 0.024);
          const grad = ctx.createLinearGradient(x, y, x - (pr.vx / speed) * len, y - (pr.vy / speed) * len);
          grad.addColorStop(0, '#fff8d6');
          grad.addColorStop(1, 'rgba(255,214,120,0)');
          ctx.strokeStyle = grad;
          ctx.lineWidth = pr.damage > 60 ? 3 : 2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - (pr.vx / speed) * len, y - (pr.vy / speed) * len);
          ctx.stroke();
          break;
        }
        case 'rocket':
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.atan2(pr.vy, pr.vx));
          ctx.fillStyle = '#4f6b3a';
          ctx.fillRect(-11, -3.5, 16, 7);
          ctx.fillStyle = '#d64933';
          ctx.beginPath();
          ctx.moveTo(5, -3.5);
          ctx.lineTo(13, 0);
          ctx.lineTo(5, 3.5);
          ctx.fill();
          ctx.fillStyle = '#2e3f22';
          ctx.fillRect(-13, -6, 5, 12);
          ctx.restore();
          break;
        case 'flame': {
          const r = 7 + (1 - pr.life / 0.5) * 11;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, 'rgba(255,240,180,0.85)');
          g.addColorStop(0.5, 'rgba(255,130,30,0.55)');
          g.addColorStop(1, 'rgba(255,50,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'saw':
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(performance.now() / 34);
          ctx.fillStyle = '#d4dbe4';
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            ctx.lineTo(Math.cos(a) * 10, Math.sin(a) * 10);
            ctx.lineTo(Math.cos(a + 0.38) * 6, Math.sin(a + 0.38) * 6);
          }
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#39414f';
          ctx.beginPath();
          ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          break;
        case 'mine': {
          const armed = pr.arm <= 0;
          ctx.fillStyle = '#2c3324';
          ctx.strokeStyle = '#14170f';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.ellipse(x, y - 1, 9, 4.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = armed && Math.floor(performance.now() / 260) % 2 === 0 ? '#ff4136' : '#5e1a15';
          ctx.beginPath();
          ctx.arc(x, y - 3, 2, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'frag':
        case 'gas':
          ctx.fillStyle = pr.kind === 'frag' ? '#39563a' : '#8a9a2f';
          ctx.beginPath();
          ctx.ellipse(x, y, 5, 6, pr.vx * 0.02, 0, Math.PI * 2);
          ctx.fill();
          if (pr.life < 0.75 && Math.floor(pr.life * 12) % 2 === 0) {
            ctx.fillStyle = '#ff4136';
            ctx.beginPath();
            ctx.arc(x, y - 1, 2, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
      }
    }
  }

  private drawParticles(): void {
    const { ctx } = this;
    for (const p of this.particles) {
      const t = p.life / p.max;
      switch (p.kind) {
        case 'dot':
          ctx.globalAlpha = Math.min(1, t * 2);
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
          break;
        case 'shard':
          ctx.globalAlpha = Math.min(1, t * 3);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size, -p.size / 2.4, p.size * 2, p.size / 1.2);
          ctx.restore();
          break;
        case 'smoke':
          ctx.globalAlpha = t * 0.42;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1.45 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'glow': {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = t;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.4, p.color);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'ring':
          ctx.globalAlpha = t * 0.85;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2 + t * 6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - t * t), 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'text':
          ctx.globalAlpha = Math.min(1, t * 2.2);
          ctx.font = `800 ${p.size}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.75)';
          ctx.strokeText(p.text ?? '', p.x, p.y);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text ?? '', p.x, p.y);
          break;
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawBeams(): void {
    const { ctx } = this;
    for (const b of this.beams) {
      const t = b.life / 0.28;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(124,131,255,${t * 0.65})`;
      ctx.lineWidth = 10 * t + 2;
      ctx.beginPath();
      ctx.moveTo(b.x0, b.y0);
      ctx.lineTo(b.x1, b.y1);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${t})`;
      ctx.lineWidth = 2.5 * t + 0.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawNames(game: Game, alpha: number): void {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.font = '700 11px system-ui, sans-serif';
    for (const p of game.players) {
      if (!p.alive || p.id === this.localId) continue;
      const x = p.prevX + (p.x - p.prevX) * alpha;
      const y = p.prevY + (p.y - p.prevY) * alpha - p.height - 14;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(p.name, x, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(p.name, x, y);
      const hpw = 34;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - hpw / 2, y + 4, hpw, 4);
      ctx.fillStyle = p.health > 50 ? '#7bd64f' : p.health > 25 ? '#ffc14d' : '#ff4d4d';
      ctx.fillRect(x - hpw / 2, y + 4, (hpw * p.health) / 100, 4);
    }
  }

}

function hash01(n: number): number {
  const v = Math.sin(n) * 43758.5453;
  return v - Math.floor(v);
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

