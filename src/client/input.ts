import { emptyInput, PlayerInput } from '../sim/types';

/** Latest intent from all devices combined. The app turns this into a PlayerInput each tick. */
export class InputManager {
  /** Pointer position in CSS pixels. */
  mouseX = 0;
  mouseY = 0;
  scoped = false;
  /** Zoom left on by a tap, as opposed to held. */
  scopeToggled = false;
  showScores = false;
  usingTouch = false;

  private keys = new Set<string>();
  /** Presses since the last tick. A tap shorter than a tick still has to register. */
  private tapped = new Set<string>();
  private mouseTapped = false;
  private mouseFire = false;
  /** Radians, set by arrow keys or a stick. Null means aim at the mouse. */
  private directAim: number | null = null;
  private wheelSwap = false;
  private touch = {
    moveX: 0, moveY: 0, aim: null as number | null, fire: false,
    buttons: new Set<string>(),
  };
  private padIndex: number | null = null;
  private padFire = false;
  private padButtons = new Set<string>();
  private padMove = { x: 0, y: 0 };
  private padScoped = false;

  /** Set by the app so pause and similar keys can be handled outside the game tick. */
  onKeyAction: (action: 'pause' | 'mute' | 'select1' | 'select2') => void = () => {};
  /** Called on the first gesture of any kind, so audio can start. */
  onGesture: () => void = () => {};

  enabled = false;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => this.handleKey(e, true));
    window.addEventListener('keyup', (e) => this.handleKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.directAim = null;
    });
    canvas.addEventListener('mousedown', (e) => {
      this.onGesture();
      if (e.button === 0) {
        this.mouseFire = true;
        this.mouseTapped = true;
      }
      if (e.button === 2) this.scoped = true;
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
      if (e.button === 2) this.scoped = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > 4) this.wheelSwap = true;
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('gamepadconnected', (e) => { this.padIndex = (e as GamepadEvent).gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this.padIndex = null; });
  }

  private handleKey(e: KeyboardEvent, down: boolean): void {
    if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
    if (down) this.onGesture();
    const { code } = e;
    if (!this.enabled && code !== 'Escape') return;
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) e.preventDefault();
    if (down && !e.repeat) {
      if (code === 'Escape' || code === 'KeyP') this.onKeyAction('pause');
      if (code === 'KeyM') this.onKeyAction('mute');
      if (code === 'KeyV') this.scopeToggled = !this.scopeToggled;
      if (code === 'Digit1') this.onKeyAction('select1');
      if (code === 'Digit2') this.onKeyAction('select2');
    }
    if (code === 'Tab') this.showScores = down;
    if (code === 'KeyZ') this.scoped = down;
    if (down) {
      this.keys.add(code);
      this.tapped.add(code);
    } else {
      this.keys.delete(code);
    }
    if (code.startsWith('Arrow')) this.updateArrowAim();
  }

  /** Eight-way aiming for players without a mouse. Holds the last direction when released. */
  private updateArrowAim(): void {
    const x = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);
    const y = (this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('ArrowUp') ? 1 : 0);
    if (x !== 0 || y !== 0) this.directAim = Math.atan2(y, x);
  }

  releaseAll(): void {
    this.keys.clear();
    this.tapped.clear();
    this.mouseFire = false;
    this.mouseTapped = false;
    this.scoped = false;
    this.showScores = false;
    this.wheelSwap = false;
    this.touch.moveX = this.touch.moveY = 0;
    this.touch.fire = false;
    this.touch.buttons.clear();
  }

  /** True when aim comes from arrow keys or a stick rather than the mouse. */
  get hasDirectAim(): boolean {
    return this.directAim !== null;
  }

  // ---------------------------------------------------------------- touch

  setTouchMove(x: number, y: number): void {
    this.usingTouch = true;
    this.touch.moveX = x;
    this.touch.moveY = y;
  }

  /** Right stick: pointing aims, and pushing it most of the way fires, as on mobile shooters. */
  setTouchAim(angle: number | null, fire: boolean): void {
    this.usingTouch = true;
    this.touch.aim = angle ?? this.touch.aim;
    this.touch.fire = fire;
    if (angle !== null) this.directAim = angle;
  }

  setTouchButton(name: string, pressed: boolean): void {
    if (pressed) {
      this.touch.buttons.add(name);
      this.tapped.add(`touch:${name}`);
    } else {
      this.touch.buttons.delete(name);
    }
    if (name === 'scope' && pressed) this.scopeToggled = !this.scopeToggled;
  }

  // ---------------------------------------------------------------- gamepad

  private pollGamepad(): void {
    if (this.padIndex === null || !navigator.getGamepads) return;
    const pad = navigator.getGamepads()[this.padIndex];
    if (!pad) return;
    const dz = (v: number): number => (Math.abs(v) < 0.18 ? 0 : v);
    this.padMove.x = dz(pad.axes[0] ?? 0);
    this.padMove.y = dz(pad.axes[1] ?? 0);
    const ax = dz(pad.axes[2] ?? 0);
    const ay = dz(pad.axes[3] ?? 0);
    if (ax !== 0 || ay !== 0) this.directAim = Math.atan2(ay, ax);
    const pressed = (i: number): boolean => !!pad.buttons[i]?.pressed;
    this.padFire = pressed(7);
    const scopedNow = pressed(6);
    if (scopedNow !== this.padScoped) {
      this.padScoped = scopedNow;
      this.scoped = scopedNow;
    }
    const set = this.padButtons;
    set.clear();
    if (pressed(0)) set.add('jet');
    if (pressed(1)) set.add('crouch');
    if (pressed(2)) set.add('reload');
    if (pressed(3)) set.add('swap');
    if (pressed(4)) set.add('grenade');
    if (pressed(5)) set.add('melee');
    if (pressed(13)) set.add('interact');
    if (pressed(14)) set.add('cycle');
  }

  // ---------------------------------------------------------------- output

  /** Builds this tick's input. `mouseAim` is the angle from the player to the cursor. */
  sample(mouseAim: number): PlayerInput {
    this.pollGamepad();
    const key = (code: string): boolean => this.keys.has(code) || this.tapped.has(code);
    const btn = (name: string): boolean => this.touch.buttons.has(name) || this.tapped.has(`touch:${name}`);
    const p = this.padButtons;
    const input = emptyInput(this.directAim ?? mouseAim);

    let move = (key('KeyD') ? 1 : 0) - (key('KeyA') ? 1 : 0);
    if (move === 0) move = this.touch.moveX;
    if (move === 0) move = this.padMove.x;
    input.moveX = Math.max(-1, Math.min(1, move));

    input.jet = key('KeyW') || key('Space') || this.touch.moveY < -0.35 || this.padMove.y < -0.45 || p.has('jet');
    input.crouch = key('KeyS') || key('ControlLeft') || this.touch.moveY > 0.65 || this.padMove.y > 0.7 || p.has('crouch');
    input.fire = this.mouseFire || this.mouseTapped || key('KeyJ') || key('Enter') || this.touch.fire || this.padFire;
    input.melee = key('KeyF') || key('KeyK') || btn('melee') || p.has('melee');
    input.reload = key('KeyR') || btn('reload') || p.has('reload');
    input.swap = key('KeyQ') || this.wheelSwap || btn('swap') || p.has('swap');
    input.grenade = key('KeyG') || key('KeyL') || btn('grenade') || p.has('grenade');
    input.cycleGrenade = key('KeyT') || btn('cycle') || p.has('cycle');
    input.interact = key('KeyE') || btn('interact') || p.has('interact');
    this.wheelSwap = false;
    this.mouseTapped = false;
    this.tapped.clear();
    return input;
  }
}
