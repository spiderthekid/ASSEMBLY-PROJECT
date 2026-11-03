/**
 * InputManager — raw Mouse & Keyboard via the PointerLock API.
 *
 * Mouse deltas are accumulated exactly as delivered by the browser (no filtering,
 * no smoothing, no acceleration) and consumed once per frame. When supported,
 * pointer lock is requested with `unadjustedMovement: true`, which bypasses OS
 * pointer acceleration and gives true raw input.
 */

type LockableElement = HTMLElement & {
  requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
};

const PASSTHROUGH_KEYS = new Set(['F5', 'F11', 'F12', 'Escape']);

export class InputManager {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly mouseDown: boolean[] = [false, false, false, false, false];
  private readonly mousePressed: boolean[] = [false, false, false, false, false];
  private dx = 0;
  private dy = 0;
  private wheel = 0;

  locked = false;
  /** True when the browser granted unaccelerated (raw) mouse input. */
  rawInput = false;
  /** Lets automated tests drive the game without a real pointer lock. */
  debugActive = false;

  onLockChange: ((locked: boolean) => void) | null = null;
  onLockError: ((message: string) => void) | null = null;

  constructor(private readonly target: HTMLElement) {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) this.releaseAll();
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.onLockError?.('Pointer lock was rejected by the browser. Wait a second and click again.');
    });

    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (!PASSTHROUGH_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat && !this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.active) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (e.button < this.mouseDown.length) {
        if (!this.mouseDown[e.button]) this.mousePressed[e.button] = true;
        this.mouseDown[e.button] = true;
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button < this.mouseDown.length) this.mouseDown[e.button] = false;
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (this.active && e.deltaY !== 0) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.releaseAll());
  }

  get active(): boolean {
    return this.locked || this.debugActive;
  }

  async requestLock(): Promise<void> {
    const el = this.target as LockableElement;
    try {
      const result = el.requestPointerLock({ unadjustedMovement: true });
      if (result instanceof Promise) await result;
      this.rawInput = true;
    } catch {
      // unadjustedMovement unsupported (e.g. Firefox / some Linux setups) — fall back to standard lock.
      try {
        const result = el.requestPointerLock();
        if (result instanceof Promise) await result;
        this.rawInput = false;
      } catch {
        this.onLockError?.('Pointer lock unavailable. Wait a second after pressing Esc, then click again.');
      }
    }
  }

  isDown(code: string): boolean {
    return this.active && this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.active && this.pressed.has(code);
  }

  isMouseDown(button: number): boolean {
    return this.active && this.mouseDown[button] === true;
  }

  wasMousePressed(button: number): boolean {
    return this.active && this.mousePressed[button] === true;
  }

  /** Returns the raw mouse counts accumulated since the last call. */
  consumeMouseDelta(): { dx: number; dy: number } {
    const out = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return out;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Test/automation hooks. */
  simulateKey(code: string, isDown: boolean): void {
    if (isDown) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else {
      this.down.delete(code);
    }
  }

  simulateMouseButton(button: number, isDown: boolean): void {
    if (isDown && !this.mouseDown[button]) this.mousePressed[button] = true;
    this.mouseDown[button] = isDown;
  }

  simulateMouseMove(dx: number, dy: number): void {
    this.dx += dx;
    this.dy += dy;
  }

  /** Clears per-frame edge triggers. Call at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
    for (let i = 0; i < this.mousePressed.length; i++) this.mousePressed[i] = false;
  }

  private releaseAll(): void {
    this.down.clear();
    this.pressed.clear();
    for (let i = 0; i < this.mouseDown.length; i++) {
      this.mouseDown[i] = false;
      this.mousePressed[i] = false;
    }
    this.dx = 0;
    this.dy = 0;
  }
}
