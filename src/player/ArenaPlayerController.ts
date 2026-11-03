import * as THREE from 'three';
import type { CollisionWorld } from '../core/CollisionWorld';
import type { InputManager } from '../core/InputManager';

/**
 * Classic arena movement tuning (metres / seconds).
 */
export const MOVEMENT_CONFIG = {
  baseSpeed: 7.5,
  sprintSpeed: 10.0,
  crouchSpeed: 3.6,
  /** Horizontal speed cap for air-strafing / bunny-hop / slide chains, as a multiple of sprint speed. */
  momentumCapMult: 1.15,

  /** Quake-style ground acceleration (x wishspeed per second). 20 => full speed in ~50 ms. */
  groundAccel: 20,
  friction: 9,
  stopSpeed: 3.0,

  /** Air acceleration and per-frame wish cap — enables air-strafing curves. */
  airAccel: 12,
  airWishCap: 0.9,

  gravity: 20,
  jumpVelocity: 6.7, // ~1.12 m jump apex
  jumpBufferTime: 0.12,
  coyoteTime: 0.08,
  /** Holding jump re-jumps on the exact landing frame (no friction tick) for bunny-hopping. */
  autoHop: true,

  slideMinSpeed: 6.5,
  slideBoost: 0.8,
  slideDecel: 3.2,
  slideMaxTime: 1.15,
  slideExitSpeed: 4.2,
  slideCooldown: 0.55,
  slideSteerAccel: 6,

  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.1,
  standEye: 1.62,
  crouchEye: 1.0,
  slideEye: 0.82,
  stepHeight: 0.5,

  killPlaneY: -40,
} as const;

export interface MovementModifiers {
  /** Weapon handling & ADS speed multiplier. */
  speedMult: number;
  /** False while aiming / firing (sprint is cancelled). */
  canSprint: boolean;
}

export interface MovementEvents {
  onJump?: () => void;
  onLand?: (impactSpeed: number) => void;
  onSlideStart?: () => void;
  onFootstep?: (intensity: number) => void;
}

const DEG = Math.PI / 180;
const EPS = 1e-4;
const MAX_STEP = 1 / 120;

export class ArenaPlayerController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;

  onGround = false;
  crouching = false;
  sliding = false;
  sprinting = false;
  /** Current visual eye height (interpolated on stance changes). */
  eyeHeight: number = MOVEMENT_CONFIG.standEye;
  /** Downward landing impulse for viewmodel/camera dip (decays). */
  landDip = 0;
  /** Camera roll applied while sliding (radians). */
  roll = 0;
  /** Total distance walked on ground (drives head-bob and footsteps). */
  strideDistance = 0;

  events: MovementEvents = {};

  private height: number = MOVEMENT_CONFIG.standHeight;
  private jumpBuffer = 0;
  private coyote = 0;
  private slideTime = 0;
  private slideCooldown = 0;
  private slideQueued = false;
  private nextFootstep = 2.2;
  private readonly spawnPoint = new THREE.Vector3();
  private spawnYaw = 0;

  private readonly wishDir = new THREE.Vector3();
  private hasWish = false;
  private readonly tmpMin = new THREE.Vector3();
  private readonly tmpMax = new THREE.Vector3();

  constructor(private readonly world: CollisionWorld) {}

  spawn(position: THREE.Vector3, yaw: number): void {
    this.spawnPoint.copy(position);
    this.spawnYaw = yaw;
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.crouching = false;
    this.sliding = false;
    this.height = MOVEMENT_CONFIG.standHeight;
    this.eyeHeight = MOVEMENT_CONFIG.standEye;
    this.onGround = false;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get momentumCap(): number {
    return MOVEMENT_CONFIG.sprintSpeed * MOVEMENT_CONFIG.momentumCapMult;
  }

  get stateLabel(): string {
    if (this.sliding) return 'SLIDE';
    if (!this.onGround) return 'AIR';
    if (this.crouching) return 'CROUCH';
    if (this.sprinting) return 'SPRINT';
    return this.horizontalSpeed > 0.5 ? 'RUN' : 'IDLE';
  }

  /**
   * Raw mouse look — counts are applied 1:1 with zero smoothing or acceleration.
   * @param degPerCount effective degrees per mouse count (sensitivity * 0.022 * zoom scale)
   */
  look(dx: number, dy: number, degPerCount: number): void {
    this.yaw -= dx * degPerCount * DEG;
    this.pitch -= dy * degPerCount * DEG;
    const lim = 89 * DEG;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
    if (this.yaw > Math.PI * 2 || this.yaw < -Math.PI * 2) this.yaw %= Math.PI * 2;
  }

  update(dt: number, input: InputManager, mods: MovementModifiers): void {
    const cfg = MOVEMENT_CONFIG;

    const fwd = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    const jumpHeld = input.isDown('Space');
    const crouchHeld = input.isDown('KeyC') || input.isDown('ControlLeft');
    const crouchPressed = input.wasPressed('KeyC') || input.wasPressed('ControlLeft');
    const sprintHeld = input.isDown('ShiftLeft') || input.isDown('ShiftRight');

    if (input.wasPressed('Space')) this.jumpBuffer = cfg.jumpBufferTime;
    if (crouchPressed) this.slideQueued = true;
    if (!crouchHeld) this.slideQueued = false;

    // Wish direction from yaw (camera looks down -Z at yaw 0).
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    this.wishDir.set(-sin * fwd + cos * strafe, 0, -cos * fwd - sin * strafe);
    this.hasWish = this.wishDir.lengthSq() > 0;
    if (this.hasWish) this.wishDir.normalize();

    this.sprinting = sprintHeld && fwd > 0 && mods.canSprint && !this.crouching && !this.sliding;

    const wasGround = this.onGround;
    const preVy = this.velocity.y;

    let remaining = Math.min(dt, 0.1);
    while (remaining > 1e-6) {
      const h = Math.min(remaining, MAX_STEP);
      this.step(h, jumpHeld, crouchHeld, mods);
      remaining -= h;
    }

    if (!wasGround && this.onGround) {
      const impact = Math.max(0, -preVy);
      this.landDip = Math.min(0.12, impact * 0.008);
      this.events.onLand?.(impact);
    }

    // Stance-driven eye height (camera position only; aim is never smoothed).
    const eyeTarget = this.sliding ? cfg.slideEye : this.crouching ? cfg.crouchEye : cfg.standEye;
    this.eyeHeight += (eyeTarget - this.eyeHeight) * (1 - Math.exp(-16 * dt));
    this.landDip *= Math.exp(-10 * dt);
    const rollTarget = this.sliding ? -3.5 * DEG : 0;
    this.roll += (rollTarget - this.roll) * (1 - Math.exp(-10 * dt));

    // Footsteps
    if (this.onGround && !this.sliding && !this.crouching) {
      const speed = this.horizontalSpeed;
      this.strideDistance += speed * dt;
      if (this.strideDistance >= this.nextFootstep) {
        this.nextFootstep = this.strideDistance + (this.sprinting ? 2.6 : 2.2);
        this.events.onFootstep?.(Math.min(1, speed / cfg.sprintSpeed));
      }
    } else if (this.onGround) {
      this.strideDistance += this.horizontalSpeed * dt * 0.6;
    }

    if (this.position.y < cfg.killPlaneY) this.spawn(this.spawnPoint, this.spawnYaw);
  }

  applyToCamera(camera: THREE.Camera, recoilPitch: number, recoilYaw: number): void {
    camera.position.set(this.position.x, this.position.y + this.eyeHeight - this.landDip, this.position.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(
      THREE.MathUtils.clamp(this.pitch + recoilPitch, -89.5 * DEG, 89.5 * DEG),
      this.yaw + recoilYaw,
      this.roll,
    );
  }

  // ---------------------------------------------------------------------------

  private step(h: number, jumpHeld: boolean, crouchHeld: boolean, mods: MovementModifiers): void {
    const cfg = MOVEMENT_CONFIG;
    this.jumpBuffer -= h;
    this.slideCooldown -= h;
    if (this.onGround) this.coyote = cfg.coyoteTime;
    else this.coyote -= h;

    const wantJump = this.jumpBuffer > 0 || (cfg.autoHop && jumpHeld);
    const hspeed = this.horizontalSpeed;

    // Slide entry (also triggers on landing if crouch is held from the air).
    if (
      !this.sliding && this.onGround && crouchHeld && this.slideQueued &&
      hspeed >= cfg.slideMinSpeed && this.slideCooldown <= 0
    ) {
      this.startSlide(hspeed);
    }

    // Crouch stance
    if (!this.sliding) {
      if (crouchHeld) this.crouching = true;
      else if (this.crouching && this.canStand()) this.crouching = false;
    }
    this.height = this.crouching || this.sliding ? cfg.crouchHeight : cfg.standHeight;

    const canJump = this.onGround || this.coyote > 0;
    if (canJump && wantJump && this.velocity.y <= 0.01) {
      // Jump BEFORE friction: landing + jump on the same tick preserves all momentum.
      this.velocity.y = cfg.jumpVelocity;
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      if (this.sliding) this.endSlide(crouchHeld);
      this.airMove(h, mods);
      this.events.onJump?.();
    } else if (this.onGround) {
      if (this.sliding) this.slideMove(h, crouchHeld);
      else this.groundMove(h, mods);
    } else {
      this.airMove(h, mods);
    }

    if (!this.onGround) this.velocity.y -= cfg.gravity * h;

    // Momentum cap (bhop / air-strafe / slide chains).
    const cap = this.momentumCap;
    const hs = this.horizontalSpeed;
    if (hs > cap) {
      const s = cap / hs;
      this.velocity.x *= s;
      this.velocity.z *= s;
    }

    this.moveAndCollide(h);
  }

  private groundMove(h: number, mods: MovementModifiers): void {
    const cfg = MOVEMENT_CONFIG;
    let wishSpeed: number = this.crouching ? cfg.crouchSpeed : this.sprinting ? cfg.sprintSpeed : cfg.baseSpeed;
    wishSpeed *= mods.speedMult;
    if (!this.hasWish) wishSpeed = 0;
    this.applyFriction(cfg.friction, h);
    this.accelerate(wishSpeed, cfg.groundAccel, wishSpeed, h);
  }

  private airMove(h: number, mods: MovementModifiers): void {
    if (!this.hasWish) return;
    const cfg = MOVEMENT_CONFIG;
    const wishSpeed = cfg.baseSpeed * mods.speedMult;
    this.accelerate(wishSpeed, cfg.airAccel, Math.min(wishSpeed, cfg.airWishCap), h);
  }

  private slideMove(h: number, crouchHeld: boolean): void {
    const cfg = MOVEMENT_CONFIG;
    this.slideTime += h;
    const speed = this.horizontalSpeed;
    const decel = cfg.slideDecel + (this.slideTime > cfg.slideMaxTime ? 14 : 0);
    const newSpeed = Math.max(0, speed - decel * h);
    if (speed > 1e-4) {
      const s = newSpeed / speed;
      this.velocity.x *= s;
      this.velocity.z *= s;
    }
    if (this.hasWish) this.accelerate(cfg.baseSpeed, cfg.slideSteerAccel, cfg.airWishCap, h);
    if (newSpeed < cfg.slideExitSpeed || !crouchHeld) this.endSlide(crouchHeld);
  }

  private startSlide(speed: number): void {
    const cfg = MOVEMENT_CONFIG;
    this.sliding = true;
    this.crouching = true;
    this.slideTime = 0;
    this.slideQueued = false;
    const boosted = Math.min(speed + cfg.slideBoost, this.momentumCap);
    if (speed > 1e-4) {
      const s = boosted / speed;
      this.velocity.x *= s;
      this.velocity.z *= s;
    }
    this.events.onSlideStart?.();
  }

  private endSlide(crouchHeld: boolean): void {
    this.sliding = false;
    this.slideCooldown = MOVEMENT_CONFIG.slideCooldown;
    this.crouching = crouchHeld || !this.canStand();
  }

  /** Quake friction model. */
  private applyFriction(friction: number, h: number): void {
    const speed = this.horizontalSpeed;
    if (speed < 1e-4) {
      this.velocity.x = 0;
      this.velocity.z = 0;
      return;
    }
    const control = Math.max(speed, MOVEMENT_CONFIG.stopSpeed);
    const newSpeed = Math.max(0, speed - control * friction * h);
    const s = newSpeed / speed;
    this.velocity.x *= s;
    this.velocity.z *= s;
  }

  /** Quake accelerate: only adds speed along wishDir up to `cappedWish`. */
  private accelerate(wishSpeed: number, accel: number, cappedWish: number, h: number): void {
    if (!this.hasWish) return;
    const current = this.velocity.x * this.wishDir.x + this.velocity.z * this.wishDir.z;
    const add = cappedWish - current;
    if (add <= 0) return;
    const accelSpeed = Math.min(accel * wishSpeed * h, add);
    this.velocity.x += accelSpeed * this.wishDir.x;
    this.velocity.z += accelSpeed * this.wishDir.z;
  }

  private canStand(): boolean {
    const r = MOVEMENT_CONFIG.radius;
    this.tmpMin.set(this.position.x - r, this.position.y + EPS, this.position.z - r);
    this.tmpMax.set(this.position.x + r, this.position.y + MOVEMENT_CONFIG.standHeight, this.position.z + r);
    return this.world.firstOverlap(this.tmpMin, this.tmpMax) === null;
  }

  private overlap(): THREE.Box3 | null {
    const r = MOVEMENT_CONFIG.radius;
    this.tmpMin.set(this.position.x - r, this.position.y, this.position.z - r);
    this.tmpMax.set(this.position.x + r, this.position.y + this.height, this.position.z + r);
    return this.world.firstOverlap(this.tmpMin, this.tmpMax);
  }

  private moveAndCollide(h: number): void {
    const cfg = MOVEMENT_CONFIG;
    const dx = this.velocity.x * h;
    const dy = this.velocity.y * h;
    const dz = this.velocity.z * h;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / (cfg.radius * 0.8)));
    const wasGround = this.onGround;

    for (let i = 0; i < steps; i++) {
      this.moveHorizontal('x', dx / steps, wasGround);
      this.moveHorizontal('z', dz / steps, wasGround);
      this.moveVertical(dy / steps);
    }

    // Ground probe (+ stair-down snapping when we were grounded and not jumping).
    if (this.velocity.y <= 0) {
      const r = cfg.radius - 0.01;
      const probe = wasGround ? cfg.stepHeight : 0.04;
      const floor = this.world.highestFloor(
        this.position.x - r, this.position.x + r,
        this.position.z - r, this.position.z + r,
        this.position.y - probe, this.position.y + 0.01,
      );
      if (floor !== null) {
        const oldY = this.position.y;
        this.position.y = floor;
        if (this.overlap()) {
          this.position.y = oldY;
          this.onGround = false;
        } else {
          this.onGround = true;
          this.velocity.y = 0;
        }
      } else {
        this.onGround = false;
      }
    } else {
      this.onGround = false;
    }

    if (this.position.y < 0) {
      this.position.y = 0;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.onGround = true;
    }
  }

  private moveHorizontal(axis: 'x' | 'z', amount: number, grounded: boolean): void {
    if (amount === 0) return;
    const cfg = MOVEMENT_CONFIG;
    this.position[axis] += amount;
    for (let iter = 0; iter < 4; iter++) {
      const box = this.overlap();
      if (!box) return;
      // Step up onto low obstacles (stairs, curbs) while grounded.
      if (grounded || this.sliding) {
        const rise = box.max.y - this.position.y;
        if (rise > 0 && rise <= cfg.stepHeight) {
          const oldY = this.position.y;
          this.position.y = box.max.y + EPS;
          if (!this.overlap()) {
            this.eyeHeight -= Math.min(rise, 0.3) * 0.6; // soften the visual pop
            continue;
          }
          this.position.y = oldY;
        }
      }
      const r = cfg.radius;
      if (amount > 0) this.position[axis] = box.min[axis] - r - EPS;
      else this.position[axis] = box.max[axis] + r + EPS;
      this.velocity[axis] = 0;
    }
  }

  private moveVertical(amount: number): void {
    if (amount === 0) return;
    this.position.y += amount;
    for (let iter = 0; iter < 4; iter++) {
      const box = this.overlap();
      if (!box) return;
      if (amount < 0) {
        this.position.y = box.max.y;
        if (this.velocity.y < 0) this.velocity.y = 0;
        this.onGround = true;
      } else {
        this.position.y = box.min.y - this.height - EPS;
        if (this.velocity.y > 0) this.velocity.y = 0;
      }
    }
  }
}
