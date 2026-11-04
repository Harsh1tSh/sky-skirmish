import { FUEL_MAX, MAX_HEALTH } from '../sim/constants';
import { Game, TEAM_COLORS } from '../sim/game';
import { GameEvent, Player } from '../sim/types';
import { WEAPONS, WeaponId } from '../sim/weapons';
import { drawWeapon, roundRect, THEMES } from './art';
import { Camera } from './renderer';

interface Feed { text: string; involved: boolean; life: number }
interface Banner { text: string; sub: string; color: string; life: number; max: number }
interface Arc { angle: number; life: number }

const STREAKS: Record<number, string> = {
  2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'RAMPAGE', 5: 'UNSTOPPABLE', 7: 'GODLIKE', 10: 'LEGENDARY',
};

const SOURCE_LABEL: Record<string, string> = { grenade: 'Frag', gas: 'Gas', burn: 'Fire', punch: 'Fists' };

/** Everything drawn in screen space on top of the world. */
export class Hud {
  private feed: Feed[] = [];
  private banners: Banner[] = [];
  private arcs: Arc[] = [];
  private hitMarker = 0;
  private hitHead = false;
  private killMarker = 0;
  private lowHealthPulse = 0;
  /** Shown during a player's first match, cleared as they try each thing. */
  private hints: { text: string; done: boolean }[] = [];
  private hintAge = 0;

  showHints = false;
  modded = false;
  touch = false;

  reset(showHints: boolean, modded: boolean, touch: boolean): void {
    this.feed = [];
    this.banners = [];
    this.arcs = [];
    this.hitMarker = 0;
    this.killMarker = 0;
    this.modded = modded;
    this.touch = touch;
    this.showHints = showHints;
    this.hintAge = 0;
    this.hints = touch
      ? [
        { text: 'Left stick: move. Push it up to fly', done: false },
        { text: 'Right stick: aim. Push it far to shoot', done: false },
      ]
      : [
        { text: 'A / D to move. Hold W or Space to fly', done: false },
        { text: 'Move the mouse to aim. Left click to shoot', done: false },
        { text: 'G throws a grenade. F is melee', done: false },
        { text: 'Walk over guns to grab them. E swaps', done: false },
      ];
  }

  noteAction(index: number): void {
    if (this.hints[index]) this.hints[index].done = true;
  }

  handleEvent(e: GameEvent, game: Game, localId: number): void {
    switch (e.type) {
      case 'hit':
        if (e.attacker === localId && e.victim !== localId && !e.shielded) {
          this.hitMarker = 0.2;
          this.hitHead = e.headshot;
        }
        if (e.victim === localId && !e.shielded) {
          const v = game.getPlayer(localId);
          const a = game.getPlayer(e.attacker);
          if (v && a && a !== v) this.arcs.push({ angle: Math.atan2(a.y - v.y, a.x - v.x), life: 0.9 });
        }
        break;
      case 'kill': {
        const killer = game.getPlayer(e.killer);
        const victim = game.getPlayer(e.victim);
        const involved = e.killer === localId || e.victim === localId;
        const weapon = SOURCE_LABEL[e.weapon] ?? WEAPONS[e.weapon as WeaponId]?.name ?? '';
        const text = e.killer === e.victim
          ? `${victim?.name ?? '?'} blew themselves up`
          : `${killer?.name ?? '?'}  [${weapon}${e.headshot ? ' · HEADSHOT' : ''}]  ${victim?.name ?? '?'}`;
        this.feed.unshift({ text, involved, life: 5.5 });
        if (this.feed.length > 5) this.feed.length = 5;
        if (e.killer === localId && e.victim !== localId) {
          this.killMarker = 0.45;
          const streak = STREAKS[e.streak];
          this.pushBanner(streak ?? (e.headshot ? 'HEADSHOT' : 'ELIMINATED'), victim?.name ?? '', streak ? '#ffd166' : '#ffffff', streak ? 2 : 1.1);
        }
        break;
      }
      case 'flag': {
        const me = game.getPlayer(localId);
        const who = game.getPlayer(e.player)?.name ?? 'Someone';
        const ours = me?.team === e.team;
        const name = e.team === 1 ? 'Blue' : 'Red';
        const lines = {
          taken: [ours ? 'YOUR FLAG IS TAKEN' : 'ENEMY FLAG TAKEN', `${who} has the ${name} flag`],
          dropped: [`${name.toUpperCase()} FLAG DROPPED`, ''],
          returned: [`${name.toUpperCase()} FLAG RETURNED`, ''],
          captured: [ours ? 'THEY SCORED' : 'FLAG CAPTURED', `${who} captured the ${name} flag`],
        }[e.action];
        const good = e.action === 'captured' || e.action === 'taken' ? !ours : ours;
        this.pushBanner(lines[0], lines[1], good ? '#7bd64f' : '#ff8a5c', 2.2);
        this.feed.unshift({ text: lines[1] || lines[0], involved: e.player === localId, life: 5 });
        if (this.feed.length > 5) this.feed.length = 5;
        break;
      }
      case 'wave':
        this.pushBanner(`WAVE ${e.wave}`, 'Raiders incoming', '#ff8a5c', 2.4);
        break;
      case 'waveClear':
        this.pushBanner('WAVE CLEARED', 'Health and ammo restored', '#7bd64f', 2.6);
        break;
      default:
        break;
    }
  }

  private pushBanner(text: string, sub: string, color: string, life: number): void {
    this.banners = [{ text, sub, color, life, max: life }];
  }

  // ---------------------------------------------------------------- draw

  draw(ctx: CanvasRenderingContext2D, game: Game, me: Player | null, cam: Camera, aimX: number, aimY: number, showScores: boolean, dt: number): void {
    this.age(dt);
    const w = cam.viewW;
    const h = cam.viewH;
    if (me) {
      this.drawVignette(ctx, me, w, h, dt);
      this.drawDamageArcs(ctx, w, h);
      this.drawVitals(ctx, me);
      this.drawWeaponPanel(ctx, me, w, h, game.modsFor(me).unlimitedAmmo);
      this.drawPrompt(ctx, game, me, w, h);
      if (me.alive) this.drawCrosshair(ctx, me, aimX, aimY);
    }
    this.drawScorePanel(ctx, game, me, w);
    this.drawMinimap(ctx, game, me, w);
    this.drawFeed(ctx, w);
    this.drawBanners(ctx, w, h);
    if (me && !me.alive && game.phase !== 'ended' && !showScores) this.drawDeath(ctx, game, me, w, h);
    if (game.phase === 'countdown') this.drawCountdown(ctx, game, w, h);
    if (this.modded) this.drawModBadge(ctx, w);
    if (this.showHints && me?.alive && game.phase === 'playing') this.drawHints(ctx, w, h);
    if (showScores) this.drawScoreboard(ctx, game, me, w, h);
  }

  private age(dt: number): void {
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    this.killMarker = Math.max(0, this.killMarker - dt);
    this.hintAge += dt;
    for (const f of this.feed) f.life -= dt;
    this.feed = this.feed.filter((f) => f.life > 0);
    for (const b of this.banners) b.life -= dt;
    this.banners = this.banners.filter((b) => b.life > 0);
    for (const a of this.arcs) a.life -= dt;
    this.arcs = this.arcs.filter((a) => a.life > 0);
  }

  private panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 8): void {
    ctx.fillStyle = 'rgba(12,16,26,0.62)';
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
  }

  private text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left'): void {
    ctx.font = font;
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  private drawVignette(ctx: CanvasRenderingContext2D, me: Player, w: number, h: number, dt: number): void {
    const low = me.alive && me.health < 35;
    this.lowHealthPulse = low ? this.lowHealthPulse + dt * 5 : 0;
    if (!low) return;
    const a = (0.2 + Math.sin(this.lowHealthPulse) * 0.1) * (1 - me.health / 35 + 0.4);
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, 'rgba(200,20,20,0)');
    g.addColorStop(1, `rgba(200,20,20,${Math.min(0.75, a)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  private drawDamageArcs(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const r = Math.min(w, h) * 0.3;
    for (const a of this.arcs) {
      ctx.strokeStyle = `rgba(255,70,60,${Math.min(0.9, a.life)})`;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r, a.angle - 0.26, a.angle + 0.26);
      ctx.stroke();
    }
  }

  private drawVitals(ctx: CanvasRenderingContext2D, me: Player): void {
    const x = 14;
    const y = 14;
    const barW = 200;
    this.panel(ctx, x, y, barW + 52, 58);

    ctx.fillStyle = '#ff5a5f';
    ctx.fillRect(x + 12, y + 16, 12, 4);
    ctx.fillRect(x + 16, y + 12, 4, 12);
    this.bar(ctx, x + 34, y + 11, barW, 14, me.health / MAX_HEALTH, me.health > 35 ? '#6fdc5c' : '#ff4d4d');
    this.text(ctx, `${Math.ceil(me.health)}`, x + 34 + barW / 2, y + 22, '800 11px system-ui, sans-serif', '#fff', 'center');

    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.moveTo(x + 18, y + 32);
    ctx.lineTo(x + 23, y + 41);
    ctx.lineTo(x + 13, y + 41);
    ctx.fill();
    this.bar(ctx, x + 34, y + 33, barW, 8, me.fuel / FUEL_MAX, me.fuel < 15 ? '#ff7f50' : '#ffb347');

    const kinds = [['frag', `Frag ${me.frags}`], ['gas', `Gas ${me.gas}`], ['mine', `Mine ${me.mines}`]];
    kinds.forEach(([kind, label], i) => {
      const active = me.grenadeType === kind;
      this.text(ctx, label, x + 34 + i * 42, y + 53, `${active ? 800 : 600} 10px system-ui, sans-serif`, active ? '#ffd166' : 'rgba(255,255,255,0.45)');
    });
    this.text(ctx, `${me.kills} / ${me.deaths}`, x + 34 + barW, y + 53, '600 10px system-ui, sans-serif', 'rgba(255,255,255,0.7)', 'right');
  }

  private bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ratio: number, color: string): void {
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    if (ratio > 0.005) {
      ctx.fillStyle = color;
      roundRect(ctx, x, y, Math.max(h, w * Math.min(1, ratio)), h, h / 2);
      ctx.fill();
    }
  }

  private drawWeaponPanel(ctx: CanvasRenderingContext2D, me: Player, w: number, h: number, unlimited: boolean): void {
    const slot = me.weapons[me.current];
    if (!slot) return;
    const def = WEAPONS[slot.id];
    const panelW = 232;
    const panelH = 66;
    const x = this.touch ? 14 : w - panelW - 14;
    const y = this.touch ? 80 : h - panelH - 14;
    this.panel(ctx, x, y, panelW, panelH);

    // A light plate behind the icon, because most guns are dark.
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    roundRect(ctx, x + 8, y + 7, 96, 34, 6);
    ctx.fill();
    ctx.save();
    ctx.translate(x + 48, y + 25);
    ctx.scale(1.25, 1.25);
    drawWeapon(ctx, slot.id);
    ctx.restore();

    this.text(ctx, def.name, x + 14, y + 57, '700 11px system-ui, sans-serif', 'rgba(255,255,255,0.86)');
    const isBlade = def.kind === 'blade';
    const ammo = isBlade ? '∞' : `${slot.mag}`;
    this.text(ctx, ammo, x + panelW - 62, y + 36, '800 28px system-ui, sans-serif', slot.mag === 0 && !isBlade ? '#ff5a5f' : '#fff', 'right');
    if (!isBlade) this.text(ctx, `/ ${unlimited ? '∞' : slot.reserve}`, x + panelW - 58, y + 36, '600 13px system-ui, sans-serif', 'rgba(255,255,255,0.6)');

    if (me.reloadTimer > 0) {
      const ratio = 1 - me.reloadTimer / def.reload;
      this.bar(ctx, x + 112, y + 46, panelW - 124, 6, ratio, '#7fd8ff');
    }

    const other = me.weapons[1 - me.current];
    if (other) {
      const ox = x;
      const oy = this.touch ? y + panelH + 5 : y - 30;
      this.panel(ctx, ox, oy, panelW, 24, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      roundRect(ctx, ox + 5, oy + 3, 52, 18, 4);
      ctx.fill();
      ctx.save();
      ctx.translate(ox + 28, oy + 12);
      ctx.scale(0.62, 0.62);
      drawWeapon(ctx, other.id);
      ctx.restore();
      this.text(ctx, WEAPONS[other.id].name, ox + 62, oy + 16, '600 11px system-ui, sans-serif', 'rgba(255,255,255,0.68)');
      if (!this.touch) this.text(ctx, 'Q', ox + panelW - 12, oy + 16, '800 11px system-ui, sans-serif', 'rgba(255,255,255,0.5)', 'right');
    }
  }

  private drawPrompt(ctx: CanvasRenderingContext2D, game: Game, me: Player, w: number, h: number): void {
    const offer = game.swappablePickup(me);
    if (!offer?.weapon || !me.weapons[0] || !me.weapons[1]) return;
    const name = WEAPONS[offer.weapon].name;
    const tier = WEAPONS[offer.weapon].tier === 2;
    const label = this.touch ? `Tap SWAP for ${name}` : `Press E for ${name}`;
    ctx.font = '700 14px system-ui, sans-serif';
    const tw = ctx.measureText(label).width + 28;
    this.panel(ctx, w / 2 - tw / 2, h * 0.68, tw, 30, 15);
    this.text(ctx, label, w / 2, h * 0.68 + 20, '700 14px system-ui, sans-serif', tier ? '#ffd166' : '#fff', 'center');
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D, me: Player, x: number, y: number): void {
    const def = WEAPONS[me.weapons[me.current]?.id ?? 'pistol'];
    const gap = 5 + Math.min(20, (def.spread + me.bloom) * 110);
    ctx.save();
    ctx.lineCap = 'round';
    const strokes = (color: string, width: number): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x - gap - 7, y); ctx.lineTo(x - gap, y);
      ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + 7, y);
      ctx.moveTo(x, y - gap - 7); ctx.lineTo(x, y - gap);
      ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + 7);
      ctx.stroke();
    };
    strokes('rgba(0,0,0,0.65)', 4);
    strokes('#ffffff', 2);
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(x - 1, y - 1, 2, 2);

    if (me.reloadTimer > 0) {
      const ratio = 1 - me.reloadTimer / def.reload;
      ctx.strokeStyle = '#7fd8ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 20, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
      ctx.stroke();
    }
    if (this.hitMarker > 0 || this.killMarker > 0) {
      const a = Math.max(this.hitMarker / 0.2, this.killMarker / 0.45);
      ctx.globalAlpha = Math.min(1, a);
      ctx.strokeStyle = this.killMarker > 0 ? '#ff4d4d' : this.hitHead ? '#ffd166' : '#ffffff';
      ctx.lineWidth = this.killMarker > 0 ? 3 : 2;
      const m = 8 + (1 - a) * 4;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.moveTo(x + sx * m, y + sy * m);
        ctx.lineTo(x + sx * (m + 7), y + sy * (m + 7));
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawScorePanel(ctx: CanvasRenderingContext2D, game: Game, me: Player | null, w: number): void {
    const cx = w / 2;
    const { config } = game;
    if (config.mode === 'survival') {
      this.panel(ctx, cx - 112, 12, 224, 48);
      this.text(ctx, game.wave > 0 ? `WAVE ${game.wave}` : 'GET READY', cx, 32, '800 16px system-ui, sans-serif', '#ff8a5c', 'center');
      const enemies = game.players.filter((p) => p.team === 2 && p.alive).length + game.waveToSpawn;
      const lives = '♥'.repeat(Math.max(0, game.lives));
      this.text(ctx, `${lives}   Raiders left ${enemies}`, cx, 51, '700 11px system-ui, sans-serif', '#fff', 'center');
      return;
    }
    const clock = config.timeLimit > 0 ? formatTime(game.timeLeft) : '';
    if (config.mode === 'tdm' || config.mode === 'ctf') {
      this.panel(ctx, cx - 112, 12, 224, 48);
      this.text(ctx, `${game.teamScores[1]}`, cx - 58, 45, '800 28px system-ui, sans-serif', TEAM_COLORS[1], 'center');
      this.text(ctx, `${game.teamScores[2]}`, cx + 58, 45, '800 28px system-ui, sans-serif', TEAM_COLORS[2], 'center');
      this.text(ctx, clock, cx, 33, '800 15px system-ui, sans-serif', '#fff', 'center');
      if (config.scoreLimit) this.text(ctx, `to ${config.scoreLimit}`, cx, 50, '600 10px system-ui, sans-serif', 'rgba(255,255,255,0.65)', 'center');
      return;
    }
    const leader = game.leader();
    this.panel(ctx, cx - 112, 12, 224, 48);
    this.text(ctx, clock || 'FREE FOR ALL', cx, 32, '800 15px system-ui, sans-serif', '#fff', 'center');
    const lead = leader && leader.score > 0 ? `${leader.name} leads ${leader.score}` : '';
    const mine = me ? `You ${me.score}` : '';
    const limit = config.scoreLimit ? ` / ${config.scoreLimit}` : '';
    this.text(ctx, `${mine}${mine && lead ? '  ·  ' : ''}${lead}${limit}`, cx, 50, '600 11px system-ui, sans-serif', 'rgba(255,255,255,0.85)', 'center');
  }

  private drawMinimap(ctx: CanvasRenderingContext2D, game: Game, me: Player | null, w: number): void {
    const mapW = Math.min(170, w * 0.2);
    const scale = mapW / game.map.pixelWidth;
    const mapH = game.map.pixelHeight * scale;
    const x = w - mapW - 14;
    const y = 14;
    this.panel(ctx, x - 4, y - 4, mapW + 8, mapH + 8, 6);

    if (!this.minimapCache || this.minimapMapId !== game.map.id || this.minimapCache.width !== Math.ceil(mapW * 2)) {
      this.minimapCache = bakeMinimap(game, Math.ceil(mapW * 2), Math.ceil(mapH * 2));
      this.minimapMapId = game.map.id;
    }
    ctx.drawImage(this.minimapCache, x, y, mapW, mapH);

    for (const k of game.pickups) {
      if (!k.active || k.kind !== 'weapon' || !k.weapon || WEAPONS[k.weapon].tier !== 2) continue;
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(x + k.x * scale - 1.5, y + k.y * scale - 1.5, 3, 3);
    }
    for (const p of game.players) {
      if (!p.alive) continue;
      const isMe = me?.id === p.id;
      const friend = me && !game.isEnemy(me, p) && !isMe;
      ctx.fillStyle = isMe ? '#fff' : friend ? '#5bd1ff' : '#ff5a5f';
      ctx.beginPath();
      ctx.arc(x + p.x * scale, y + (p.y - p.height / 2) * scale, isMe ? 3 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const flag of game.flags) {
      ctx.fillStyle = TEAM_COLORS[flag.team];
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.fillRect(x + flag.x * scale - 3, y + flag.y * scale - 3, 6, 6);
      ctx.strokeRect(x + flag.x * scale - 3, y + flag.y * scale - 3, 6, 6);
    }
  }
  private minimapCache: HTMLCanvasElement | null = null;
  private minimapMapId = '';

  private drawFeed(ctx: CanvasRenderingContext2D, w: number): void {
    let y = 118;
    // On touch screens the right side holds the action buttons, so the feed moves inwards.
    const right = this.touch ? w - 200 : w - 14;
    ctx.font = '600 12px system-ui, sans-serif';
    for (const f of this.feed) {
      const tw = ctx.measureText(f.text).width + 18;
      ctx.globalAlpha = Math.min(1, f.life);
      ctx.fillStyle = f.involved ? 'rgba(255,140,60,0.62)' : 'rgba(12,16,26,0.58)';
      roundRect(ctx, right - tw, y, tw, 23, 5);
      ctx.fill();
      this.text(ctx, f.text, right - 9, y + 16, '600 12px system-ui, sans-serif', '#fff', 'right');
      y += 27;
    }
    ctx.globalAlpha = 1;
  }

  private drawBanners(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    for (const b of this.banners) {
      const t = b.life / b.max;
      const pop = t > 0.88 ? 1 + (t - 0.88) * 2.2 : 1;
      ctx.save();
      ctx.globalAlpha = Math.min(1, b.life * 3);
      ctx.translate(w / 2, h * 0.2);
      ctx.scale(pop, pop);
      ctx.font = '900 30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(b.text, 0, 0);
      ctx.fillStyle = b.color;
      ctx.fillText(b.text, 0, 0);
      if (b.sub) {
        ctx.font = '700 13px system-ui, sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeText(b.sub, 0, 22);
        ctx.fillStyle = '#fff';
        ctx.fillText(b.sub, 0, 22);
      }
      ctx.restore();
    }
  }

  private drawDeath(ctx: CanvasRenderingContext2D, game: Game, me: Player, w: number, h: number): void {
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.fillRect(0, 0, w, h);
    const killer = game.getPlayer(me.killedBy);
    const label = killer && killer.id !== me.id ? `Taken out by ${killer.name}` : 'You took yourself out';
    this.text(ctx, label, w / 2, h * 0.42, '800 22px system-ui, sans-serif', '#fff', 'center');
    this.text(ctx, `Back in ${Math.max(0, me.respawnTimer).toFixed(1)}s`, w / 2, h * 0.42 + 28, '600 15px system-ui, sans-serif', 'rgba(255,255,255,0.85)', 'center');
  }

  private drawCountdown(ctx: CanvasRenderingContext2D, game: Game, w: number, h: number): void {
    const n = Math.ceil(game.countdown);
    const frac = game.countdown - Math.floor(game.countdown);
    ctx.save();
    ctx.translate(w / 2, h * 0.4);
    ctx.scale(1 + frac * 0.35, 1 + frac * 0.35);
    ctx.font = '900 86px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(`${n}`, 0, 0);
    ctx.fillStyle = THEMES.meadow.accent;
    ctx.fillText(`${n}`, 0, 0);
    ctx.restore();
    this.text(ctx, game.map.name, w / 2, h * 0.4 + 44, '800 18px system-ui, sans-serif', '#fff', 'center');
  }

  private drawModBadge(ctx: CanvasRenderingContext2D, w: number): void {
    const x = w / 2 + 122;
    if (x + 76 > w - 190) return;
    ctx.fillStyle = '#d63af9';
    roundRect(ctx, x, 16, 70, 20, 10);
    ctx.fill();
    this.text(ctx, 'MODDED', x + 35, 30, '800 11px system-ui, sans-serif', '#fff', 'center');
  }

  private drawHints(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const open = this.hints.filter((x) => !x.done);
    if (open.length === 0 || this.hintAge > 45) {
      this.showHints = false;
      return;
    }
    const line = open[0].text;
    ctx.font = '700 14px system-ui, sans-serif';
    const tw = ctx.measureText(line).width + 34;
    const y = this.touch ? h * 0.72 : h * 0.82;
    ctx.fillStyle = 'rgba(255,209,102,0.95)';
    roundRect(ctx, w / 2 - tw / 2, y, tw, 32, 16);
    ctx.fill();
    this.text(ctx, line, w / 2, y + 21, '700 14px system-ui, sans-serif', '#222', 'center');
  }

  drawScoreboard(ctx: CanvasRenderingContext2D, game: Game, me: Player | null, w: number, h: number): void {
    const rows = [...game.players].sort((a, b) => b.score - a.score || a.deaths - b.deaths).slice(0, 14);
    const pw = Math.min(520, w - 28);
    const ph = 62 + rows.length * 25;
    const x = w / 2 - pw / 2;
    const y = Math.max(14, h / 2 - ph / 2);
    ctx.fillStyle = 'rgba(10,14,24,0.88)';
    roundRect(ctx, x, y, pw, ph, 12);
    ctx.fill();
    this.text(ctx, 'SCOREBOARD', x + 18, y + 28, '800 15px system-ui, sans-serif', '#fff');
    const headers: [string, number][] = [['Score', pw - 150], ['Kills', pw - 90], ['Deaths', pw - 28]];
    for (const [label, ox] of headers) this.text(ctx, label, x + ox, y + 28, '700 11px system-ui, sans-serif', 'rgba(255,255,255,0.6)', 'right');
    rows.forEach((p, i) => {
      const ry = y + 52 + i * 25;
      if (p.id === me?.id) {
        ctx.fillStyle = 'rgba(255,209,102,0.18)';
        ctx.fillRect(x + 8, ry - 15, pw - 16, 22);
      }
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x + 22, ry - 4, 5, 0, Math.PI * 2);
      ctx.fill();
      this.text(ctx, p.name, x + 36, ry, '600 13px system-ui, sans-serif', p.alive ? '#fff' : 'rgba(255,255,255,0.5)');
      this.text(ctx, `${p.score}`, x + pw - 150, ry, '800 13px system-ui, sans-serif', '#fff', 'right');
      this.text(ctx, `${p.kills}`, x + pw - 90, ry, '600 13px system-ui, sans-serif', '#fff', 'right');
      this.text(ctx, `${p.deaths}`, x + pw - 28, ry, '600 13px system-ui, sans-serif', '#fff', 'right');
    });
  }
}

function bakeMinimap(game: Game, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const sx = w / game.map.width;
  const sy = h / game.map.height;
  for (let y = 0; y < game.map.height; y++) {
    for (let x = 0; x < game.map.width; x++) {
      const t = game.map.tile(x, y);
      if (t === 0) continue;
      ctx.fillStyle = t !== 2 ? 'rgba(255,255,255,0.46)' : 'rgba(255,255,255,0.24)';
      ctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
    }
  }
  return c;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
