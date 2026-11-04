import { InputManager } from './input';

const STICK_RADIUS = 52;
const FIRE_THRESHOLD = 0.62;

/** Wires the on-screen sticks and buttons into the input manager. */
export function setupTouch(input: InputManager, root: HTMLElement, onPause: () => void): void {
  bindStick(root.querySelector<HTMLElement>('#stick-left')!, (x, y) => input.setTouchMove(x, y), () => input.setTouchMove(0, 0));
  bindStick(
    root.querySelector<HTMLElement>('#stick-right')!,
    (x, y) => {
      const mag = Math.hypot(x, y);
      input.setTouchAim(mag > 0.12 ? Math.atan2(y, x) : null, mag > FIRE_THRESHOLD);
    },
    () => input.setTouchAim(null, false),
  );

  root.querySelectorAll<HTMLButtonElement>('[data-touch]').forEach((btn) => {
    const name = btn.dataset.touch!;
    const press = (down: boolean) => (e: Event): void => {
      e.preventDefault();
      input.setTouchButton(name, down);
    };
    btn.addEventListener('pointerdown', press(true));
    btn.addEventListener('pointerup', press(false));
    btn.addEventListener('pointercancel', press(false));
    btn.addEventListener('pointerleave', press(false));
  });
  root.querySelector('#touch-pause')!.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onPause();
  });
}

function bindStick(zone: HTMLElement, onMove: (x: number, y: number) => void, onEnd: () => void): void {
  const nub = zone.querySelector<HTMLElement>('.stick-nub')!;
  const base = zone.querySelector<HTMLElement>('.stick-base')!;
  let pointer: number | null = null;

  const update = (e: PointerEvent): void => {
    const rect = base.getBoundingClientRect();
    let dx = e.clientX - (rect.left + rect.width / 2);
    let dy = e.clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    nub.style.transform = `translate(${dx}px, ${dy}px)`;
    onMove(dx / STICK_RADIUS, dy / STICK_RADIUS);
  };

  zone.addEventListener('pointerdown', (e) => {
    if (pointer !== null) return;
    pointer = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    update(e);
    e.preventDefault();
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId === pointer) update(e);
  });
  const end = (e: PointerEvent): void => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    nub.style.transform = '';
    onEnd();
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
}
