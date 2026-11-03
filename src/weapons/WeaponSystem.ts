import * as THREE from 'three';
import {
  WEAPONS,
  PRIMARY_ORDER,
  SIDEARM,
  type WeaponId,
  type WeaponDef,
  type HitZone,
} from './WeaponDatabase';
import type { AudioManager } from '../core/AudioManager';
import type { WeaponViewModel } from '../player/WeaponViewModel';
import { MOVEMENT_CONFIG } from '../player/ArenaPlayerController';

export interface WeaponRuntimeState {
  mag: number;
  reserve: number;
}

export interface HitCallbackPayload {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  damage: number;
  zone: HitZone;
  killed: boolean;
  targetObject: THREE.Object3D;
}

interface ActiveTracer {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  maxAge: number;
}

interface ActiveSpark {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
}

interface ImpactDecal {
  mesh: THREE.Mesh;
  age: number;
}

const DEG = Math.PI / 180;

export class WeaponSystem {
  readonly inventory = new Map<WeaponId, WeaponRuntimeState>();
  primaryId: WeaponId = 'm4a1_sopmod';
  readonly secondaryId: WeaponId = SIDEARM;
  activeSlot: 'primary' | 'secondary' = 'primary';
  currentId: WeaponId = 'm4a1_sopmod';
  previousId: WeaponId = 'glock19';

  /** 0 = hip-fire, 1 = full ADS. */
  adsProgress = 0;
  /** Smoothly eased ADS factor (cubic). */
  adsEase = 0;

  /** Accumulated dynamic bloom spread in degrees. */
  bloom = 0;
  /** Current effective hip-fire / ADS spread radius in degrees. */
  currentSpreadDeg = 0;

  /** Camera recoil kick offset (radians) + recovery. */
  recoilPitch = 0;
  recoilYaw = 0;
  shotsInBurst = 0;
  private timeSinceLastShot = 99;

  state: 'idle' | 'reloading' | 'equipping' | 'cycling' = 'idle';
  private stateTimer = 0;
  private stateDuration = 0;
  reloadEmpty = false;
  private shellPhase: 'start' | 'loop' | 'end' = 'start';
  shellPulse = 0;

  private fireCooldown = 0;
  private shotCount = 0;
  private dryFiredThisPress = false;

  // Raycasting & FX
  private readonly raycaster = new THREE.Raycaster();
  private readonly shootables: THREE.Object3D[] = [];
  private readonly tracers: ActiveTracer[] = [];
  private readonly sparks: ActiveSpark[] = [];
  private readonly decals: ImpactDecal[] = [];
  private readonly decalLimit = 72;

  private readonly tracerGeo: THREE.CylinderGeometry;
  private readonly sparkGeo: THREE.BoxGeometry;
  private readonly sparkMat: THREE.MeshBasicMaterial;
  private readonly decalGeo: THREE.PlaneGeometry;
  private readonly decalMat: THREE.MeshBasicMaterial;

  onHit: ((hit: HitCallbackPayload) => void) | null = null;
  onFire: ((def: WeaponDef) => void) | null = null;

  private readonly tmpOrigin = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpMuzzle = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly upAxis = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly worldScene: THREE.Scene,
    private readonly viewmodel: WeaponViewModel,
    private readonly audio: AudioManager,
  ) {
    // Rotate unit cylinder so its length runs along +Y (we orient from start -> end).
    this.tracerGeo = new THREE.CylinderGeometry(0.011, 0.011, 1, 6, 1, true);
    this.sparkGeo = new THREE.BoxGeometry(0.025, 0.025, 0.09);
    this.sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 2.6, 0.9) });
    this.decalGeo = new THREE.PlaneGeometry(0.09, 0.09);
    this.decalMat = new THREE.MeshBasicMaterial({
      color: 0x111214,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });

    this.resetAllAmmo();
    this.viewmodel.setWeapon(this.currentDef);
  }

  get currentDef(): WeaponDef {
    return WEAPONS[this.currentId];
  }

  get primaryDef(): WeaponDef {
    return WEAPONS[this.primaryId];
  }

  get secondaryDef(): WeaponDef {
    return WEAPONS[this.secondaryId];
  }

  get currentState(): WeaponRuntimeState {
    return this.inventory.get(this.currentId)!;
  }

  get stateProgress(): number {
    return this.stateDuration > 0 ? THREE.MathUtils.clamp(1 - this.stateTimer / this.stateDuration, 0, 1) : 0;
  }

  get primaryState(): WeaponRuntimeState {
    return this.inventory.get(this.primaryId)!;
  }

  get secondaryState(): WeaponRuntimeState {
    return this.inventory.get(this.secondaryId)!;
  }

  setShootables(objs: THREE.Object3D[]): void {
    this.shootables.length = 0;
    this.shootables.push(...objs);
  }

  resetAllAmmo(): void {
    const all: WeaponId[] = [...PRIMARY_ORDER, SIDEARM];
    for (const id of all) {
      const def = WEAPONS[id];
      this.inventory.set(id, {
        mag: def.ammo.magSize,
        reserve: def.ammo.magSize * def.ammo.reserveMags,
      });
    }
  }

  /**
   * Resets player loadout to 1 chosen Primary Weapon (with 2 reserve mags)
   * and 1 Glock 19 sidearm (with 2 reserve mags).
   */
  setStartingPrimary(id: WeaponId): void {
    this.primaryId = id;
    const pDef = WEAPONS[id];
    this.inventory.set(id, {
      mag: pDef.ammo.magSize,
      reserve: pDef.ammo.magSize * pDef.ammo.reserveMags,
    });
    const sDef = WEAPONS[this.secondaryId];
    this.inventory.set(this.secondaryId, {
      mag: sDef.ammo.magSize,
      reserve: sDef.ammo.magSize * sDef.ammo.reserveMags,
    });
    this.activeSlot = 'primary';
    this.equip(id, true);
  }

  refillCurrentReserve(mags = 2): void {
    const pDef = WEAPONS[this.primaryId];
    const pSt = this.primaryState;
    pSt.mag = pDef.ammo.magSize;
    pSt.reserve = Math.max(pSt.reserve, pDef.ammo.magSize * mags);

    const sDef = WEAPONS[this.secondaryId];
    const sSt = this.secondaryState;
    sSt.mag = sDef.ammo.magSize;
    sSt.reserve = Math.max(sSt.reserve, sDef.ammo.magSize * mags);
    this.audio.playMechanical(1800, 0.3);
  }

  equip(id: WeaponId, force = false, customEquipTime?: number): void {
    if (id === this.currentId && !force) return;
    this.previousId = this.currentId;
    this.currentId = id;
    this.activeSlot = id === this.secondaryId ? 'secondary' : 'primary';
    const def = this.currentDef;
    const dur = customEquipTime ?? def.handling.equipTime;
    this.state = 'equipping';
    this.stateDuration = dur;
    this.stateTimer = dur;
    this.adsProgress = 0;
    this.adsEase = 0;
    this.bloom = 0;
    this.shotsInBurst = 0;
    this.viewmodel.setWeapon(def);
    this.audio.playMechanical(1250, 0.2);
  }

  /**
   * Slot 1 = Primary Weapon, Slot 2 = Glock 19 Sidearm.
   */
  equipSlot(slot: 1 | 2): void {
    if (slot === 1) {
      this.equip(this.primaryId);
    } else {
      this.equip(this.secondaryId);
    }
  }

  cycleWeapon(_delta: number): void {
    const target = this.activeSlot === 'primary' ? this.secondaryId : this.primaryId;
    this.equip(target);
  }

  quickSwap(): void {
    const target = this.activeSlot === 'primary' ? this.secondaryId : this.primaryId;
    this.equip(target);
  }

  /**
   * Swaps the player's current primary weapon with a scavenged weapon in 250ms,
   * returning the previous primary weapon's exact state so it can be dropped on the floor.
   */
  swapPrimaryWeapon(
    newId: WeaponId,
    newMag: number,
    newReserve: number,
    equipTimeSec = 0.25,
  ): { previousId: WeaponId; previousMag: number; previousReserve: number } {
    const prevId = this.primaryId;
    const prevSt = this.inventory.get(prevId)!;
    const prevMag = prevSt.mag;
    const prevReserve = prevSt.reserve;

    this.primaryId = newId;
    this.inventory.set(newId, {
      mag: newMag,
      reserve: newReserve,
    });
    this.activeSlot = 'primary';
    this.equip(newId, true, equipTimeSec);
    this.audio.playWeaponSwap();

    return {
      previousId: prevId,
      previousMag: prevMag,
      previousReserve: prevReserve,
    };
  }

  /**
   * Adds scavenged rounds to the player's currently equipped primary weapon reserve.
   */
  addPrimaryReserveAmmo(rounds: number): void {
    if (rounds <= 0) return;
    const st = this.primaryState;
    st.reserve += rounds;
    this.audio.playAmmoPickup();
  }

  startReload(): void {
    const def = this.currentDef;
    const st = this.currentState;
    if (this.state === 'reloading' || this.state === 'equipping') return;
    if (st.mag >= def.ammo.magSize || st.reserve <= 0) return;

    this.state = 'reloading';
    this.reloadEmpty = st.mag === 0;

    if (def.ammo.reloadStyle === 'magazine') {
      const dur = this.reloadEmpty ? def.ammo.reloadEmptyTime : def.ammo.reloadTime;
      this.stateDuration = dur;
      this.stateTimer = dur;
      this.audio.playMechanical(980, 0.25);
    } else {
      this.shellPhase = 'start';
      this.stateDuration = def.ammo.shellReloadStart;
      this.stateTimer = def.ammo.shellReloadStart;
      this.shellPulse = 0;
      this.audio.playMechanical(1100, 0.2);
    }
  }

  /** Effective movement modifiers for ArenaPlayerController. */
  getMovementModifiers(wantAds: boolean, triggerHeld: boolean): { speedMult: number; canSprint: boolean } {
    const def = this.currentDef;
    const adsMove = THREE.MathUtils.lerp(1.0, def.ads.moveSpeedMult, this.adsEase);
    const speedMult = def.handling.moveSpeedMult * adsMove;
    const canSprint = !wantAds && !triggerHeld && this.adsProgress < 0.15 && this.timeSinceLastShot > 0.18;
    return { speedMult, canSprint };
  }

  /** Current camera magnification factor (1.0 at hip -> def.ads.magnification at full ADS). */
  get currentMagnification(): number {
    return THREE.MathUtils.lerp(1.0, this.currentDef.ads.magnification, this.adsEase);
  }

  update(
    dt: number,
    input: {
      fireDown: boolean;
      firePressed: boolean;
      adsDown: boolean;
      reloadPressed: boolean;
    },
    playerState: {
      speed: number;
      onGround: boolean;
      crouching: boolean;
      sliding: boolean;
      sprinting: boolean;
    },
    worldCamera: THREE.PerspectiveCamera,
  ): void {
    const def = this.currentDef;
    const st = this.currentState;

    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.timeSinceLastShot += dt;
    if (!input.fireDown) this.dryFiredThisPress = false;

    if (input.reloadPressed) this.startReload();

    // State machine (reload / equip / bolt cycle)
    this.updateState(dt, def, st, input.firePressed);

    // ADS interpolation (150ms - 220ms per weapon spec)
    const canAds = this.state !== 'reloading' && this.state !== 'equipping' && !(this.state === 'cycling' && def.fire.mode === 'bolt');
    const adsTarget = input.adsDown && canAds ? 1 : 0;
    const adsRate = 1000 / def.ads.timeMs;
    if (this.adsProgress < adsTarget) {
      this.adsProgress = Math.min(1, this.adsProgress + adsRate * dt);
    } else if (this.adsProgress > adsTarget) {
      this.adsProgress = Math.max(0, this.adsProgress - adsRate * dt);
    }
    const t = this.adsProgress;
    this.adsEase = t * t * (3 - 2 * t);

    // Dynamic spread calculation (tightens to zero at full ADS)
    this.bloom = Math.max(0, this.bloom - def.spread.bloomRecovery * dt);
    const moveFactor = THREE.MathUtils.clamp(playerState.speed / MOVEMENT_CONFIG.baseSpeed, 0, 1.5);
    let hipSpread = def.spread.hipBase + def.spread.hipMoveAdd * moveFactor;
    if (!playerState.onGround) hipSpread += def.spread.hipAirAdd;
    else if (playerState.crouching || playerState.sliding) hipSpread *= def.spread.crouchMult;
    hipSpread += this.bloom;
    this.currentSpreadDeg = hipSpread * (1 - this.adsEase);

    // Recoil recovery
    if (this.timeSinceLastShot > 0.09) {
      const rec = Math.exp(-def.recoil.recovery * dt);
      this.recoilPitch *= rec;
      this.recoilYaw *= rec;
      if (this.timeSinceLastShot > 0.28) this.shotsInBurst = 0;
    }

    // Trigger evaluation
    const wantsFire = def.fire.mode === 'auto' ? input.fireDown : input.firePressed;
    if (wantsFire && this.fireCooldown <= 0) {
      // Interrupt shotgun shell reload on fire if at least 1 shell is chambered
      if (this.state === 'reloading' && def.ammo.reloadStyle === 'shell' && st.mag > 0) {
        this.state = 'idle';
        this.stateTimer = 0;
      }
      if (this.state === 'idle') {
        if (st.mag > 0) {
          this.fireShot(def, st, worldCamera);
        } else if (!this.dryFiredThisPress) {
          this.dryFiredThisPress = true;
          this.audio.playDryFire();
          if (st.reserve > 0) this.startReload();
        }
      }
    }

    this.updateFX(dt);
  }

  private updateState(dt: number, def: WeaponDef, st: WeaponRuntimeState, firePressed: boolean): void {
    if (this.state === 'idle') return;

    this.stateTimer -= dt;

    if (this.state === 'reloading' && def.ammo.reloadStyle === 'shell') {
      if (this.shellPhase === 'loop') {
        this.shellPulse = THREE.MathUtils.clamp(1 - this.stateTimer / this.stateDuration, 0, 1);
      } else {
        this.shellPulse = 1;
      }

      if (this.stateTimer <= 0) {
        if (this.shellPhase === 'start') {
          this.shellPhase = 'loop';
          this.stateDuration = def.ammo.shellReloadPerShell;
          this.stateTimer = def.ammo.shellReloadPerShell;
          this.shellPulse = 0;
        } else if (this.shellPhase === 'loop') {
          st.mag += 1;
          st.reserve -= 1;
          this.audio.playMechanical(1550, 0.25);
          if (st.mag >= def.ammo.magSize || st.reserve <= 0 || firePressed) {
            this.shellPhase = 'end';
            this.stateDuration = def.ammo.shellReloadEnd;
            this.stateTimer = def.ammo.shellReloadEnd;
          } else {
            this.stateDuration = def.ammo.shellReloadPerShell;
            this.stateTimer = def.ammo.shellReloadPerShell;
            this.shellPulse = 0;
          }
        } else {
          this.state = 'idle';
          this.audio.playMechanical(1300, 0.25);
        }
      }
      return;
    }

    if (this.stateTimer <= 0) {
      if (this.state === 'reloading') {
        const needed = def.ammo.magSize - st.mag;
        const take = Math.min(needed, st.reserve);
        st.mag += take;
        st.reserve -= take;
        this.audio.playMechanical(1450, 0.28);
      }
      this.state = 'idle';
      this.stateTimer = 0;
    }
  }

  private fireShot(def: WeaponDef, st: WeaponRuntimeState, worldCamera: THREE.PerspectiveCamera): void {
    st.mag -= 1;
    this.fireCooldown = 60 / def.fire.rpm;
    this.timeSinceLastShot = 0;
    this.shotCount += 1;
    this.shotsInBurst += 1;

    this.audio.playShot(def.fx.sound);
    this.viewmodel.onShot(def, this.adsEase);
    this.onFire?.(def);

    // Camera basis in world space
    worldCamera.updateMatrixWorld(true);
    this.raycaster.camera = worldCamera;
    this.tmpOrigin.setFromMatrixPosition(worldCamera.matrixWorld);
    worldCamera.getWorldDirection(this.tmpDir).normalize();
    this.tmpRight.crossVectors(this.tmpDir, this.upAxis).normalize();
    this.tmpUp.crossVectors(this.tmpRight, this.tmpDir).normalize();

    this.viewmodel.getMuzzleWorld(worldCamera, this.tmpMuzzle);

    const pellets = def.damage.pellets;
    const pelletCone = THREE.MathUtils.lerp(def.spread.pelletSpreadHip, def.spread.pelletSpreadAds, this.adsEase);
    const drawTracer = this.shotCount % def.fx.tracerEvery === 0;

    for (let p = 0; p < pellets; p++) {
      const rayDir = this.sampleRayDirection(this.currentSpreadDeg, pelletCone, p, pellets);
      this.castPelletRay(def, this.tmpOrigin, rayDir, drawTracer);
    }

    // Bloom & Recoil kick (applied after the shot so first shot is true to crosshair)
    this.bloom = Math.min(def.spread.bloomMax, this.bloom + def.spread.bloomPerShot * (1 - 0.85 * this.adsEase));

    const firstMult = this.shotsInBurst === 1 ? def.recoil.firstShotMult : 1.0;
    const adsMult = THREE.MathUtils.lerp(1.0, def.recoil.adsMult, this.adsEase);
    const vKick = def.recoil.vertical * firstMult * adsMult * DEG;
    const hKick = ((Math.random() * 2 - 1) * def.recoil.horizontal + def.recoil.horizontalBias) * adsMult * DEG;
    this.recoilPitch += vKick;
    this.recoilYaw -= hKick;

    // Bolt-action cycling after firing
    if (def.fire.mode === 'bolt' && st.mag > 0) {
      this.state = 'cycling';
      this.stateDuration = def.ammo.boltCycleTime;
      this.stateTimer = def.ammo.boltCycleTime;
      window.setTimeout(() => this.audio.playMechanical(1350, 0.26), 240);
    } else if (st.mag === 0 && st.reserve > 0) {
      // Auto-initiate reload after a brief beat when mag runs dry
      window.setTimeout(() => {
        if (this.currentDef.id === def.id && this.currentState.mag === 0 && this.state === 'idle') {
          this.startReload();
        }
      }, 220);
    }
  }

  private sampleRayDirection(aimSpreadDeg: number, pelletConeDeg: number, pelletIdx: number, totalPellets: number): THREE.Vector3 {
    const rAim = Math.sqrt(Math.random()) * Math.tan(aimSpreadDeg * DEG);
    const aAim = Math.random() * Math.PI * 2;
    let ox = Math.cos(aAim) * rAim;
    let oy = Math.sin(aAim) * rAim;

    if (totalPellets > 1 && pelletConeDeg > 0) {
      // Stratified ring + jitter for consistent 8-pellet buckshot patterns
      const ringAngle = (pelletIdx / totalPellets) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
      const ringRadius = (0.35 + 0.65 * Math.sqrt((pelletIdx + Math.random()) / totalPellets)) * Math.tan(pelletConeDeg * DEG * 0.5);
      ox += Math.cos(ringAngle) * ringRadius;
      oy += Math.sin(ringAngle) * ringRadius;
    }

    return new THREE.Vector3()
      .copy(this.tmpDir)
      .addScaledVector(this.tmpRight, ox)
      .addScaledVector(this.tmpUp, oy)
      .normalize();
  }

  private castPelletRay(def: WeaponDef, origin: THREE.Vector3, dir: THREE.Vector3, drawTracer: boolean): void {
    this.raycaster.set(origin, dir);
    this.raycaster.near = 0.05;
    this.raycaster.far = def.fire.maxRange;

    const hits = this.raycaster.intersectObjects(this.shootables, true);
    let endPoint = new THREE.Vector3().copy(origin).addScaledVector(dir, def.fire.maxRange);

    if (hits.length > 0) {
      const hit = hits[0];
      endPoint = hit.point;
      const normal = hit.face
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
        : dir.clone().negate();

      const zone = this.findHitZone(hit.object);
      if (zone) {
        const dist = hit.distance;
        const dmg = this.computeDamage(def, dist, zone);
        const handler = this.findDamageHandler(hit.object);
        const killed = handler ? handler(dmg, zone, hit.point) : false;
        this.audio.playHit(zone === 'head');
        if (killed) this.audio.playEliminationChime(zone === 'head');
        this.onHit?.({
          point: hit.point.clone(),
          normal,
          distance: dist,
          damage: dmg,
          zone,
          killed,
          targetObject: hit.object,
        });
        this.spawnSparks(hit.point, normal, zone === 'head' ? 8 : 4);
      } else {
        this.spawnDecal(hit.point, normal);
        this.spawnSparks(hit.point, normal, 4);
      }
    }

    if (drawTracer) {
      this.spawnTracer(this.tmpMuzzle, endPoint, def.fx.tracerColor);
    }
  }

  private computeDamage(def: WeaponDef, distance: number, zone: HitZone): number {
    const d = def.damage;
    let falloff = 1.0;
    if (distance > d.falloffStart) {
      const t = THREE.MathUtils.clamp((distance - d.falloffStart) / (d.falloffEnd - d.falloffStart), 0, 1);
      falloff = THREE.MathUtils.lerp(1.0, d.minMultiplier, t);
    }
    const mult = zone === 'head' ? d.headMultiplier : zone === 'limb' ? d.limbMultiplier : 1.0;
    return Math.round(d.base * falloff * mult);
  }

  private findHitZone(obj: THREE.Object3D | null): HitZone | null {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (cur.userData && typeof cur.userData.hitZone === 'string') {
        return cur.userData.hitZone as HitZone;
      }
      cur = cur.parent;
    }
    return null;
  }

  private findDamageHandler(obj: THREE.Object3D | null): ((dmg: number, zone: HitZone, pt: THREE.Vector3) => boolean) | null {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (cur.userData && typeof cur.userData.onBulletHit === 'function') {
        return cur.userData.onBulletHit as (dmg: number, zone: HitZone, pt: THREE.Vector3) => boolean;
      }
      cur = cur.parent;
    }
    return null;
  }

  private spawnTracer(start: THREE.Vector3, end: THREE.Vector3, rgb: [number, number, number]): void {
    const delta = new THREE.Vector3().subVectors(end, start);
    const fullDist = delta.length();
    if (fullDist < 0.8) return;
    const dir = delta.multiplyScalar(1 / fullDist);

    const segStart = new THREE.Vector3().copy(start).addScaledVector(dir, 0.25);
    const segLen = Math.min(fullDist - 0.25, 38);
    const mid = new THREE.Vector3().copy(segStart).addScaledVector(dir, segLen * 0.5);

    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(rgb[0] * 4.2, rgb[1] * 4.2, rgb[2] * 4.2),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.tracerGeo, mat);
    mesh.position.copy(mid);
    mesh.scale.set(1, segLen, 1);
    this.tmpQuat.setFromUnitVectors(this.upAxis, dir);
    mesh.quaternion.copy(this.tmpQuat);
    this.worldScene.add(mesh);
    this.tracers.push({ mesh, mat, age: 0, maxAge: 0.065 });
  }

  private spawnDecal(point: THREE.Vector3, normal: THREE.Vector3): void {
    const mesh = new THREE.Mesh(this.decalGeo, this.decalMat);
    mesh.position.copy(point).addScaledVector(normal, 0.004);
    this.tmpQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    mesh.quaternion.copy(this.tmpQuat);
    mesh.rotateZ(Math.random() * Math.PI * 2);
    this.worldScene.add(mesh);
    this.decals.push({ mesh, age: 0 });
    if (this.decals.length > this.decalLimit) {
      const oldest = this.decals.shift()!;
      this.worldScene.remove(oldest.mesh);
    }
  }

  private spawnSparks(point: THREE.Vector3, normal: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      mesh.position.copy(point).addScaledVector(normal, 0.02);
      const vel = new THREE.Vector3(
        normal.x + (Math.random() - 0.5) * 1.4,
        normal.y + Math.random() * 1.1,
        normal.z + (Math.random() - 0.5) * 1.4,
      ).multiplyScalar(4 + Math.random() * 6);
      mesh.lookAt(point.clone().add(vel));
      this.worldScene.add(mesh);
      this.sparks.push({ mesh, vel, age: 0, maxAge: 0.14 + Math.random() * 0.1 });
    }
  }

  clearFX(): void {
    for (const tr of this.tracers) {
      this.worldScene.remove(tr.mesh);
      tr.mat.dispose();
    }
    this.tracers.length = 0;

    for (const sp of this.sparks) {
      this.worldScene.remove(sp.mesh);
    }
    this.sparks.length = 0;

    for (const dec of this.decals) {
      this.worldScene.remove(dec.mesh);
    }
    this.decals.length = 0;
  }

  private updateFX(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.age += dt;
      if (tr.age >= tr.maxAge) {
        this.worldScene.remove(tr.mesh);
        tr.mat.dispose();
        this.tracers.splice(i, 1);
      } else {
        tr.mat.opacity = 1 - tr.age / tr.maxAge;
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      sp.age += dt;
      if (sp.age >= sp.maxAge) {
        this.worldScene.remove(sp.mesh);
        this.sparks.splice(i, 1);
      } else {
        sp.vel.y -= 18 * dt;
        sp.mesh.position.addScaledVector(sp.vel, dt);
      }
    }
  }
}
