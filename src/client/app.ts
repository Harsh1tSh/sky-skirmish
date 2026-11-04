import { CTF_CAPTURES, DT } from '../sim/constants';
import { Game, shoulderOf } from '../sim/game';
import { createMap, MAP_LIST } from '../sim/maps';
import { defaultMods, Difficulty, GameEvent, GameMode, MatchConfig, Player } from '../sim/types';
import { ALL_WEAPON_IDS, WEAPONS, WeaponId } from '../sim/weapons';
import { THEMES } from './art';
import { AudioEngine } from './audio';
import { Hud } from './hud';
import { InputManager } from './input';
import { applyPreset, MOD_PRESETS, MOD_TOGGLES } from './presets';
import { Renderer } from './renderer';
import { clearStats, loadSettings, loadStats, Record as StatRecord, saveSettings, saveStats, Settings, Stats } from './storage';
import { setupTouch } from './touch';

type Screen = 'menu' | 'setup' | 'howto' | 'stats' | 'settings' | 'pause' | 'results' | 'none';

const COLORS = ['#3a86ff', '#e4572e', '#17bebb', '#ffc914', '#76b041', '#b388eb', '#ff8fab', '#ef476f', '#f1f1f1', '#3d405b'];
const MAX_STEPS_PER_FRAME = 5;
const RESULTS_DELAY = 1.4;

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;

export class App {
  private readonly canvas = $<HTMLCanvasElement>('#game');
  private readonly renderer = new Renderer(this.canvas);
  private readonly hud = new Hud();
  private readonly audio = new AudioEngine();
  private readonly input = new InputManager(this.canvas);
  private settings: Settings = loadSettings();
  private stats: Stats = loadStats();

  private game!: Game;
  private localId = -1;
  private inMatch = false;
  private paused = false;
  private screen: Screen = 'menu';
  private accumulator = 0;
  private lastFrame = 0;
  private pendingSelect: 0 | 1 | null = null;
  private lastCountdownBeep = 4;
  private resultsIn = -1;
  private resultsShown = false;
  private bestStreak = 0;
  private spectateId = -1;
  private spectateFor = 0;
  private aimX = 0;
  private aimY = 0;

  start(): void {
    this.applySettings();
    this.buildUi();
    this.startAttract();
    this.input.onGesture = () => this.audio.unlock();
    this.input.onKeyAction = (a) => this.handleKeyAction(a);
    setupTouch(this.input, $('#touch'), () => this.togglePause());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.inMatch && !this.paused && this.game.phase !== 'ended') this.togglePause();
    });
    window.addEventListener('blur', () => {
      if (this.inMatch && !this.paused && this.game.phase !== 'ended') this.togglePause();
    });
    window.addEventListener('resize', () => this.updateRotatePrompt());
    this.updateRotatePrompt();
    requestAnimationFrame((t) => this.frame(t));
    if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = this;
  }

  private isCoarse(): boolean {
    return window.matchMedia?.('(pointer: coarse)').matches ?? false;
  }

  private updateRotatePrompt(): void {
    const portrait = window.innerHeight > window.innerWidth;
    $('#rotate').classList.toggle('hidden', !(this.isCoarse() && portrait));
  }

  private applySettings(): void {
    const s = this.settings;
    this.audio.setVolume(s.volume / 100);
    this.renderer.screenShake = s.shake;
    this.renderer.showDamageNumbers = s.damageNumbers;
    this.renderer.quality = s.reducedEffects ? 0.5 : 1;
  }

  private persist(): void {
    saveSettings(this.settings);
  }

  // ---------------------------------------------------------------- match lifecycle

  /** The menu backdrop: a live bot match with no sound. */
  private startAttract(): void {
    const map = MAP_LIST[Math.floor(Math.random() * MAP_LIST.length)].id;
    const config: MatchConfig = {
      seed: randomSeed(), mapId: map, mode: 'ffa', bots: 7, difficulty: 'normal', timeLimit: 0, scoreLimit: 0,
      humans: [], mods: defaultMods(), skipCountdown: true,
    };
    this.game = new Game(config);
    this.renderer.prepare(this.game);
    this.renderer.localId = -1;
    this.localId = -1;
    this.inMatch = false;
    this.paused = false;
    this.input.enabled = false;
    document.body.classList.remove('in-game');
    $('#touch').classList.add('hidden');
    const first = this.game.players[0];
    this.renderer.snapCamera(first.x, first.y);
    this.spectateId = first.id;
  }

  private startMatch(): void {
    const s = this.settings;
    const setup = s.setup;
    const config: MatchConfig = {
      seed: randomSeed(),
      mapId: setup.mapId,
      mode: setup.mode,
      bots: setup.mode === 'survival' ? Math.min(setup.bots, 3) : setup.bots,
      difficulty: setup.difficulty,
      timeLimit: setup.mode === 'survival' ? 0 : setup.timeLimit,
      scoreLimit: setup.mode === 'survival' ? 0 : setup.mode === 'ctf' ? CTF_CAPTURES : setup.scoreLimit,
      humans: [{ name: s.name.trim() || 'Player', color: setup.mode === 'ffa' ? s.color : '#3a86ff' }],
      // The switch is the single source of truth: Normal always plays with no mods at all.
      mods: setup.modded ? { ...setup.mods } : defaultMods(),
    };
    this.game = new Game(config);
    const me = this.game.players[0];
    this.localId = me.id;
    this.renderer.localId = me.id;
    this.renderer.prepare(this.game);
    this.renderer.snapCamera(me.x, me.y - 30);
    this.hud.reset(!s.tutorialSeen, setup.modded, this.input.usingTouch || this.isCoarse());
    this.inMatch = true;
    this.paused = false;
    this.accumulator = 0;
    this.resultsIn = -1;
    this.resultsShown = false;
    this.bestStreak = 0;
    this.lastCountdownBeep = 4;
    this.input.enabled = true;
    this.input.releaseAll();
    this.input.scopeToggled = false;
    document.body.classList.add('in-game');
    $('#touch').classList.toggle('hidden', !(this.input.usingTouch || this.isCoarse()));
    this.show('none');
  }

  private togglePause(): void {
    if (!this.inMatch || this.game.phase === 'ended') return;
    this.paused = !this.paused;
    this.audio.setJet(false);
    this.input.releaseAll();
    document.body.classList.toggle('in-game', !this.paused);
    this.show(this.paused ? 'pause' : 'none');
  }

  private quitToMenu(): void {
    this.audio.setJet(false);
    this.startAttract();
    this.show('menu');
  }

  private handleKeyAction(action: 'pause' | 'mute' | 'select1' | 'select2'): void {
    if (action === 'pause') {
      if (this.inMatch) {
        if (this.screen === 'settings' || this.screen === 'howto') this.show('pause');
        else this.togglePause();
      }
      return;
    }
    if (action === 'mute') {
      this.audio.setMuted(!this.audio.isMuted);
      return;
    }
    this.pendingSelect = action === 'select1' ? 0 : 1;
  }

  // ---------------------------------------------------------------- frame

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000 || 0);
    this.lastFrame = now;

    const running = !this.paused && (this.game.phase !== 'ended');
    if (running) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= DT && steps < MAX_STEPS_PER_FRAME) {
        this.stepOnce();
        this.accumulator -= DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }

    // Watch the match state itself, so the results screen can never be missed.
    if (this.inMatch && this.game.phase === 'ended' && !this.resultsShown) {
      if (this.resultsIn < 0) {
        this.resultsIn = RESULTS_DELAY;
        this.audio.setJet(false);
      }
      this.resultsIn -= dt;
      if (this.resultsIn <= 0) this.showResults();
    }

    this.updateFraming(dt);
    const alpha = running ? this.accumulator / DT : 1;
    this.renderer.render(this.game, alpha, dt, this.paused);

    if (this.inMatch) {
      const me = this.game.getPlayer(this.localId) ?? null;
      const showBoard = this.input.showScores;
      this.hud.draw(this.renderer.ctx, this.game, me, this.renderer.camera, this.aimX, this.aimY, showBoard, this.paused ? 0 : dt);
    }
  }

  private stepOnce(): void {
    const { game } = this;
    const inputs: Parameters<Game['step']>[0] = {};
    const me = this.inMatch ? game.getPlayer(this.localId) : undefined;
    if (me) {
      const s = shoulderOf(me);
      const cam = this.renderer.camera;
      const mouseAim = Math.atan2(cam.worldY(this.input.mouseY) - s.y, cam.worldX(this.input.mouseX) - s.x);
      const input = this.input.sample(mouseAim);
      if (this.pendingSelect !== null) {
        if (this.pendingSelect !== me.current && me.weapons[this.pendingSelect]) input.swap = true;
        this.pendingSelect = null;
      }
      inputs[me.id] = input;
      if (input.jet || input.moveX !== 0) this.hud.noteAction(0);
      if (input.fire) this.hud.noteAction(1);
      if (input.grenade || input.melee) this.hud.noteAction(2);
      if (input.interact) this.hud.noteAction(3);
    }
    game.step(inputs);
    for (const e of game.events) this.handleEvent(e, game);
    if (this.inMatch) {
      this.audio.setJet(!!me?.alive && me.jetting);
      this.beepCountdown(game);
    }
  }

  private beepCountdown(game: Game): void {
    if (game.phase === 'countdown') {
      const n = Math.ceil(game.countdown);
      if (n < this.lastCountdownBeep) {
        this.lastCountdownBeep = n;
        this.audio.countdown(false);
      }
    } else if (this.lastCountdownBeep !== 0) {
      this.lastCountdownBeep = 0;
      this.audio.countdown(true);
    }
  }

  private handleEvent(e: GameEvent, game: Game): void {
    this.renderer.handleEvent(e, game, this.localId);
    if (!this.inMatch) return;
    this.hud.handleEvent(e, game, this.localId);
    this.playSound(e);
    if (e.type === 'pickup' && e.id === this.localId) this.hud.noteAction(3);
    if (e.type === 'kill' && e.killer === this.localId && e.victim !== this.localId) {
      this.bestStreak = Math.max(this.bestStreak, e.streak);
    }
  }

  private spatial(x: number, y: number): { vol: number; pan: number } {
    const cam = this.renderer.camera;
    const d = Math.hypot(x - cam.x, y - cam.y);
    return {
      vol: Math.max(0, 1 - d / 1250) ** 1.5,
      pan: Math.max(-0.8, Math.min(0.8, (x - cam.x) / 800)),
    };
  }

  private playSound(e: GameEvent): void {
    const { audio } = this;
    const me = this.localId;
    switch (e.type) {
      case 'shot': {
        const { vol, pan } = this.spatial(e.x, e.y);
        if (e.owner === me) audio.shot(e.weapon, 1, 0);
        else audio.shot(e.weapon, vol * 0.75, pan);
        break;
      }
      case 'impact': {
        const { vol, pan } = this.spatial(e.x, e.y);
        if (e.kind === 'saw') audio.ricochet(vol, pan);
        else audio.impact(vol, pan);
        break;
      }
      case 'hit': {
        if (e.attacker === me && e.victim !== me && !e.shielded) audio.hitMarker(e.headshot);
        else if (e.victim === me && !e.shielded) audio.hurt(1, 0);
        break;
      }
      case 'explosion': {
        const { vol, pan } = this.spatial(e.x, e.y);
        audio.explosion(Math.max(0.12, vol), pan);
        break;
      }
      case 'gas': {
        const { vol, pan } = this.spatial(e.x, e.y);
        audio.gas(vol, pan);
        break;
      }
      case 'kill':
        if (e.killer === me && e.victim !== me) {
          audio.killConfirm();
          if (e.streak >= 2) audio.announce();
        }
        if (e.victim === me) audio.death();
        break;
      case 'melee': {
        const { vol, pan } = this.spatial(e.x, e.y);
        audio.punch(e.landed, vol, pan);
        break;
      }
      case 'reload':
        if (e.id === me) audio.reload(1, 0);
        break;
      case 'dry':
        if (e.id === me) audio.dry();
        break;
      case 'swap':
        if (e.id === me) audio.swap();
        break;
      case 'pickup':
        if (e.id === me) audio.pickup();
        break;
      case 'spawn':
        if (e.id === me) audio.spawn();
        break;
      case 'bounce': {
        const { vol, pan } = this.spatial(e.x, e.y);
        audio.bounce(vol, pan);
        break;
      }
      case 'flag':
      case 'wave':
      case 'waveClear':
        audio.announce();
        break;
      default:
        break;
    }
  }

  /** Works out what the camera follows and where the crosshair sits this frame. */
  private updateFraming(dt: number): void {
    const { game, renderer, input } = this;
    const cam = renderer.camera;
    const me = this.inMatch ? game.getPlayer(this.localId) : undefined;

    if (me && me.alive) {
      const slot = me.weapons[me.current];
      const scope = slot ? WEAPONS[slot.id].scope : 1;
      const scoped = input.scoped || input.scopeToggled;
      const zoomOut = scoped ? Math.max(1.12, scope) : 1;
      let lookX: number;
      let lookY: number;
      if (input.hasDirectAim) {
        const reach = scoped ? 280 : 70;
        lookX = Math.cos(me.aim) * reach;
        lookY = Math.sin(me.aim) * reach;
        const s = shoulderOf(me);
        const crossDist = scoped ? 420 : 170;
        this.aimX = cam.screenX(s.x + Math.cos(me.aim) * crossDist);
        this.aimY = cam.screenY(s.y + Math.sin(me.aim) * crossDist);
      } else {
        const factor = scoped ? 0.62 : 0.2;
        lookX = ((input.mouseX - cam.viewW / 2) / cam.scale) * factor;
        lookY = ((input.mouseY - cam.viewH / 2) / cam.scale) * factor;
        this.aimX = input.mouseX;
        this.aimY = input.mouseY;
      }
      renderer.updateCamera(game, me.x, me.y - 26, lookX, lookY, zoomOut, dt);
      return;
    }

    // Dead, or on the menu: watch someone interesting.
    let focus: Player | undefined;
    if (me) {
      focus = game.getPlayer(me.killedBy);
      if (!focus?.alive) focus = me;
    } else {
      this.spectateFor -= dt;
      focus = game.getPlayer(this.spectateId);
      if (!focus?.alive || this.spectateFor <= 0) {
        const alive = game.players.filter((p) => p.alive);
        focus = alive[Math.floor(Math.random() * alive.length)] ?? game.players[0];
        this.spectateId = focus?.id ?? -1;
        this.spectateFor = 9;
      }
    }
    if (focus) renderer.updateCamera(game, focus.x, focus.y - 26, 0, 0, 1.05, dt * 0.55);
  }

  // ---------------------------------------------------------------- results

  private showResults(): void {
    const { game } = this;
    const me = game.getPlayer(this.localId);
    const setup = this.settings.setup;
    const { mode } = game.config;

    let won = false;
    let title = 'Match over';
    let sub = '';
    if (mode === 'survival') {
      title = `You reached wave ${game.wave}`;
      sub = me ? `${me.kills} raiders taken down` : '';
    } else if (mode === 'tdm' || mode === 'ctf') {
      if (game.winnerTeam === 0) title = "It's a draw";
      else {
        won = me?.team === game.winnerTeam;
        title = won ? 'Your team wins!' : 'Your team lost';
      }
      sub = `Blue ${game.teamScores[1]}  ·  Red ${game.teamScores[2]}`;
    } else {
      won = game.winnerId === this.localId;
      const winner = game.getPlayer(game.winnerId);
      title = won ? 'You win!' : `${winner?.name ?? 'Nobody'} wins`;
      sub = me ? `You finished with ${me.score} points` : '';
    }
    if (setup.modded) sub += sub ? '  ·  Modded match' : 'Modded match';
    $('#result-title').textContent = title;
    $('#result-sub').textContent = sub;

    const table = $('#result-table');
    table.textContent = '';
    addRow(table, ['Player', 'Score', 'Kills', 'Deaths'], true);
    const rows = [...game.players].sort((a, b) => b.score - a.score || a.deaths - b.deaths).slice(0, 12);
    for (const p of rows) {
      const row = addRow(table, [p.name, `${p.score}`, `${p.kills}`, `${p.deaths}`]);
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      row.cells[0].prepend(dot);
      if (p.id === this.localId) row.classList.add('me');
    }

    // Modded games go in their own record so they can't inflate the Normal one.
    const record: StatRecord = setup.modded ? this.stats.modded : this.stats.normal;
    record.matches++;
    if (won) record.wins++;
    if (me) {
      record.kills += me.kills;
      record.deaths += me.deaths;
    }
    record.bestStreak = Math.max(record.bestStreak, this.bestStreak);
    if (mode === 'survival') record.bestWave = Math.max(record.bestWave, game.wave);
    saveStats(this.stats);

    if (!this.settings.tutorialSeen) {
      this.settings.tutorialSeen = true;
      this.persist();
    }
    this.resultsShown = true;
    document.body.classList.remove('in-game');
    $('#touch').classList.add('hidden');
    this.input.enabled = false;
    this.show('results');
  }

  // ---------------------------------------------------------------- UI

  private show(screen: Screen): void {
    this.screen = screen;
    document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
    if (screen !== 'none') $(`#screen-${screen}`).classList.remove('hidden');
    if (screen === 'stats') this.renderStats();
  }

  private buildUi(): void {
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      this.audio.unlock();
      if (target.closest('button')) this.audio.click();
      const go = target.closest<HTMLElement>('[data-go]');
      if (go) {
        // Mid-match, the pages reached from the pause menu lead back to it, not to the main menu.
        const dest = go.dataset.go as Screen;
        this.show(dest === 'menu' && this.inMatch ? 'pause' : dest);
      }
    });

    this.buildSetup();
    this.buildSettings();

    $('#start-match').addEventListener('click', () => {
      this.persist();
      this.startMatch();
    });
    $('#resume').addEventListener('click', () => this.togglePause());
    $('#restart').addEventListener('click', () => this.startMatch());
    $('#quit').addEventListener('click', () => this.quitToMenu());
    $('#pause-settings').addEventListener('click', () => this.show('settings'));
    $('#pause-howto').addEventListener('click', () => this.show('howto'));
    $('#settings-back').addEventListener('click', () => {
      this.persist();
      this.show(this.inMatch ? 'pause' : 'menu');
    });
    $('#play-again').addEventListener('click', () => this.startMatch());
    $('#change-setup').addEventListener('click', () => {
      this.startAttract();
      this.show('setup');
    });
    $('#results-menu').addEventListener('click', () => this.quitToMenu());
    $('#reset-stats').addEventListener('click', () => {
      if (!window.confirm('Reset all stats? This cannot be undone.')) return;
      this.stats = clearStats();
      this.renderStats();
    });
  }

  private buildSetup(): void {
    const setup = this.settings.setup;

    this.bindSeg('#version-seg', 'version', () => (setup.modded ? 'modded' : 'normal'), (v) => {
      setup.modded = v === 'modded';
      this.persist();
      this.syncSetup();
    });
    this.bindSeg('#mode-seg', 'mode', () => setup.mode, (v) => {
      setup.mode = v as GameMode;
      if (setup.mode === 'survival') setup.bots = Math.min(setup.bots, 3);
      this.persist();
      this.syncSetup();
    });
    this.bindSeg('#diff-seg', 'diff', () => setup.difficulty, (v) => {
      setup.difficulty = v as Difficulty;
      this.persist();
    });

    // Map cards, each with a tiny preview drawn from the real level data.
    const grid = $('#map-grid');
    for (const info of MAP_LIST) {
      const card = document.createElement('button');
      card.className = 'map-card';
      card.dataset.map = info.id;
      card.append(mapPreview(info.id));
      const title = document.createElement('b');
      title.textContent = info.name;
      const blurb = document.createElement('span');
      blurb.textContent = info.blurb;
      card.append(title, blurb);
      card.addEventListener('click', () => {
        setup.mapId = info.id;
        this.persist();
        this.syncSetup();
      });
      grid.append(card);
    }

    const bots = $<HTMLInputElement>('#bots');
    bots.addEventListener('input', () => {
      setup.bots = Number(bots.value);
      this.persist();
      this.syncSetup();
    });

    const time = $<HTMLSelectElement>('#time-limit');
    time.addEventListener('change', () => { setup.timeLimit = Number(time.value); this.persist(); });
    const score = $<HTMLSelectElement>('#score-limit');
    score.addEventListener('change', () => { setup.scoreLimit = Number(score.value); this.persist(); });

    // Mods.
    const toggles = $('#mod-toggles');
    for (const t of MOD_TOGGLES) {
      const label = document.createElement('label');
      label.className = 'check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.mod = t.key;
      box.addEventListener('change', () => {
        (setup.mods[t.key] as boolean) = box.checked;
        this.persist();
      });
      label.append(box, document.createTextNode(t.label));
      toggles.append(label);
    }

    const presets = $('#mod-presets');
    for (const preset of MOD_PRESETS) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = preset.name;
      chip.addEventListener('click', () => {
        setup.mods = applyPreset(preset.mods);
        this.persist();
        this.syncSetup();
      });
      presets.append(chip);
    }

    const weapon = $<HTMLSelectElement>('#mod-weapon');
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Standard loadout';
    weapon.append(none);
    for (const id of ALL_WEAPON_IDS) {
      if (id === 'pistol') continue;
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = WEAPONS[id].name;
      weapon.append(opt);
    }
    weapon.addEventListener('change', () => {
      setup.mods.startWeapon = weapon.value as WeaponId | '';
      this.persist();
    });

    this.syncSetup();
  }

  private bindSeg(sel: string, attr: string, get: () => string, set: (v: string) => void): void {
    const root = $(sel);
    root.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        set(btn.dataset[attr]!);
        this.syncSeg(sel, attr, get());
      });
    });
    this.syncSeg(sel, attr, get());
  }

  private syncSeg(sel: string, attr: string, value: string): void {
    $(sel).querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
      const on = btn.dataset[attr] === value;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }

  /** Makes every control on the setup screen match the saved state. */
  private syncSetup(): void {
    const setup = this.settings.setup;
    this.syncSeg('#version-seg', 'version', setup.modded ? 'modded' : 'normal');
    this.syncSeg('#mode-seg', 'mode', setup.mode);
    this.syncSeg('#diff-seg', 'diff', setup.difficulty);

    $('#mods-panel').classList.toggle('hidden', !setup.modded);
    $('#version-note').textContent = setup.modded
      ? 'Your mods are on. These matches count toward your Modded stats only.'
      : 'The fair game, with every mod off. Your mod choices are saved for when you switch back.';

    document.querySelectorAll<HTMLElement>('.map-card').forEach((c) => c.classList.toggle('active', c.dataset.map === setup.mapId));

    const survival = setup.mode === 'survival';
    $('#limits-row').classList.toggle('hidden', survival);
    const bots = $<HTMLInputElement>('#bots');
    bots.min = survival ? '0' : '1';
    bots.max = survival ? '3' : '11';
    bots.value = String(setup.bots);
    $('#bots-label').textContent = survival ? 'Bot allies' : setup.mode === 'ffa' ? 'Bots' : 'Other bots';
    $('#score-field').classList.toggle('hidden', setup.mode === 'ctf');
    $('#bots-value').textContent = String(setup.bots);

    $<HTMLSelectElement>('#time-limit').value = String(setup.timeLimit);
    $<HTMLSelectElement>('#score-limit').value = String(setup.scoreLimit);
    $<HTMLSelectElement>('#mod-weapon').value = setup.mods.startWeapon;
    document.querySelectorAll<HTMLInputElement>('[data-mod]').forEach((box) => {
      box.checked = Boolean(setup.mods[box.dataset.mod as keyof typeof setup.mods]);
    });
  }

  private buildSettings(): void {
    const s = this.settings;
    const name = $<HTMLInputElement>('#player-name');
    name.value = s.name;
    name.addEventListener('input', () => { s.name = name.value; this.persist(); });

    const swatches = $('#swatches');
    for (const color of COLORS) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = color;
      b.setAttribute('aria-label', `Colour ${color}`);
      b.classList.toggle('active', color === s.color);
      b.addEventListener('click', () => {
        s.color = color;
        swatches.querySelectorAll('.swatch').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        this.persist();
      });
      swatches.append(b);
    }

    const volume = $<HTMLInputElement>('#volume');
    volume.value = String(s.volume);
    $('#volume-value').textContent = `${s.volume}%`;
    volume.addEventListener('input', () => {
      s.volume = Number(volume.value);
      $('#volume-value').textContent = `${s.volume}%`;
      this.applySettings();
      this.persist();
    });

    const bindCheck = (sel: string, get: () => boolean, set: (v: boolean) => void): void => {
      const box = $<HTMLInputElement>(sel);
      box.checked = get();
      box.addEventListener('change', () => {
        set(box.checked);
        this.applySettings();
        this.persist();
      });
    };
    bindCheck('#opt-shake', () => s.shake, (v) => { s.shake = v; });
    bindCheck('#opt-damage', () => s.damageNumbers, (v) => { s.damageNumbers = v; });
    bindCheck('#opt-quality', () => s.reducedEffects, (v) => { s.reducedEffects = v; });

    $('#fullscreen').addEventListener('click', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    });
  }

  private renderStats(): void {
    const table = $('#stats-table');
    table.textContent = '';
    const { normal, modded } = this.stats;
    addRow(table, ['', 'Normal', 'Modded'], true);
    const kd = (r: StatRecord): string => (r.deaths ? (r.kills / r.deaths).toFixed(2) : `${r.kills}`);
    const rows: [string, (r: StatRecord) => string][] = [
      ['Matches', (r) => `${r.matches}`],
      ['Wins', (r) => `${r.wins}`],
      ['Kills', (r) => `${r.kills}`],
      ['Deaths', (r) => `${r.deaths}`],
      ['Kills per death', kd],
      ['Best kill streak', (r) => `${r.bestStreak}`],
      ['Best survival wave', (r) => `${r.bestWave}`],
    ];
    for (const [label, fn] of rows) addRow(table, [label, fn(normal), fn(modded)]);
  }
}

function addRow(table: HTMLElement, cells: string[], header = false): HTMLTableRowElement {
  const row = document.createElement('tr');
  for (const text of cells) {
    const cell = document.createElement(header ? 'th' : 'td');
    cell.textContent = text;
    row.append(cell);
  }
  table.append(row);
  return row;
}

function mapPreview(id: string): HTMLCanvasElement {
  const map = createMap(id);
  const px = 3;
  const canvas = document.createElement('canvas');
  canvas.width = map.width * px;
  canvas.height = map.height * px;
  const ctx = canvas.getContext('2d')!;
  const theme = THEMES[map.theme];
  ctx.fillStyle = theme.sky[0];
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.tile(x, y);
      if (t === 0) continue;
      const ground = t !== 2;
      ctx.fillStyle = ground ? (map.tile(x, y - 1) !== 0 && map.tile(x, y - 1) !== 2 ? theme.rock : theme.surface) : theme.platform;
      ctx.fillRect(x * px, y * px, px, ground ? px : px - 1);
    }
  }
  return canvas;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

