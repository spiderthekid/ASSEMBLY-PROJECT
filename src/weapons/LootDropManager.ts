import * as THREE from 'three';
import { WEAPONS, type WeaponId, type WeaponDef } from './WeaponDatabase';
import { buildWeaponModel } from '../player/WeaponModels';
import type { CollisionWorld } from '../core/CollisionWorld';
import type { WeaponSystem } from './WeaponSystem';

export interface DroppedWeapon {
  uid: number;
  weaponId: WeaponId;
  def: WeaponDef;
  currentMagAmmo: number;
  reserveAmmo: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  angularVel: THREE.Vector3;
  root: THREE.Group;
  weaponPivot: THREE.Group;
  hitProxy: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  beaconMat: THREE.MeshBasicMaterial;
  labelSprite: THREE.Sprite;
  labelCanvas: HTMLCanvasElement;
  labelTexture: THREE.CanvasTexture;
  rimMeshes: THREE.MeshStandardMaterial[];
  grounded: boolean;
  age: number;
  scavengeCooldown: number;
}

export interface ScavengeEvent {
  weaponDef: WeaponDef;
  roundsAbsorbed: number;
  dropRemoved: boolean;
}

export interface SwapEvent {
  newWeaponDef: WeaponDef;
  newMag: number;
  newReserve: number;
  droppedWeaponDef: WeaponDef;
  droppedMag: number;
  droppedReserve: number;
}

const MAX_ACTIVE_DROPS = 12;
const DROP_LIFETIME_SEC = 25.0;
const PICKUP_RAYCAST_RANGE = 2.5;
const AUTO_SCAVENGE_RADIUS = 1.5;
const EQUIP_SWAP_TIME_SEC = 0.25; // 250ms per spec

function makeRingTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const r = s / 2;

  const grad = g.createRadialGradient(r, r, r * 0.25, r, r, r * 0.95);
  grad.addColorStop(0, 'rgba(56, 220, 255, 0.05)');
  grad.addColorStop(0.68, 'rgba(56, 220, 255, 0.22)');
  grad.addColorStop(0.86, 'rgba(255, 255, 255, 0.95)');
  grad.addColorStop(1, 'rgba(56, 220, 255, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBeaconTexture(): THREE.CanvasTexture {
  const w = 64;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.65)');
  grad.addColorStop(0.4, 'rgba(255, 255, 255, 0.18)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = grad;
  g.fillRect(w * 0.35, 0, w * 0.3, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class LootDropManager {
  readonly drops: DroppedWeapon[] = [];
  focusedDrop: DroppedWeapon | null = null;

  onScavenge: ((ev: ScavengeEvent) => void) | null = null;
  onSwap: ((ev: SwapEvent) => void) | null = null;

  private nextUid = 1;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ringTex = makeRingTexture();
  private readonly beaconTex = makeBeaconTexture();
  private readonly ringGeo = new THREE.PlaneGeometry(0.95, 0.95);
  private readonly beaconGeo = new THREE.PlaneGeometry(0.45, 0.85);
  private readonly hitProxyGeo = new THREE.SphereGeometry(0.46, 10, 8);
  private readonly hitProxyMat = new THREE.MeshBasicMaterial({ visible: false });

  private readonly tmpCamPos = new THREE.Vector3();
  private readonly tmpCamDir = new THREE.Vector3();

  constructor(
    private readonly worldScene: THREE.Scene,
    private readonly collisionWorld: CollisionWorld,
    private readonly weapons: WeaponSystem,
  ) {
    this.ringGeo.rotateX(-Math.PI / 2);
  }

  /**
   * Spawns a 3D physical weapon pickup in the world with gravity/bounce physics
   * and a tactical highlight / rim-light so it is easy to spot on the ground.
   */
  spawnWeaponDrop(
    weaponId: WeaponId,
    currentMagAmmo: number,
    reserveAmmo: number,
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    initialScavengeCooldown = 0.35,
  ): DroppedWeapon {
    // Enforce cap of 12 active dropped weapons (remove oldest first)
    while (this.drops.length >= MAX_ACTIVE_DROPS) {
      this.removeDrop(this.drops[0]);
    }

    const def = WEAPONS[weaponId];
    const root = new THREE.Group();
    root.position.copy(position);
    this.worldScene.add(root);

    // 1. Tactical ground highlight ring + vertical beacon
    const ringMat = new THREE.MeshBasicMaterial({
      map: this.ringTex,
      color: new THREE.Color(0.3, 1.9, 2.6),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ringMesh = new THREE.Mesh(this.ringGeo, ringMat);
    ringMesh.position.y = 0.015;
    root.add(ringMesh);

    const beaconMat = new THREE.MeshBasicMaterial({
      map: this.beaconTex,
      color: new THREE.Color(0.3, 1.9, 2.6),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const b1 = new THREE.Mesh(this.beaconGeo, beaconMat);
    b1.position.y = 0.44;
    const b2 = new THREE.Mesh(this.beaconGeo, beaconMat);
    b2.position.y = 0.44;
    b2.rotation.y = Math.PI / 2;
    root.add(b1, b2);

    // 2. Physical 3D weapon mesh with cloned materials for subtle tactical rim-light
    const weaponPivot = new THREE.Group();
    weaponPivot.position.y = 0.08;
    const built = buildWeaponModel(weaponId);
    built.root.scale.setScalar(1.25);

    const rimMeshes: THREE.MeshStandardMaterial[] = [];
    built.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
        const cloned = obj.material.clone();
        cloned.emissive = new THREE.Color(0x0c2436);
        cloned.emissiveIntensity = 0.65;
        obj.material = cloned;
        obj.castShadow = true;
        obj.receiveShadow = true;
        rimMeshes.push(cloned);
      }
    });
    weaponPivot.add(built.root);
    // Start slightly tilted
    weaponPivot.rotation.set(0.15, Math.random() * Math.PI * 2, 1.35);
    root.add(weaponPivot);

    // 3. Invisible raycast bounding sphere for crisp 2.5m look detection
    const hitProxy = new THREE.Mesh(this.hitProxyGeo, this.hitProxyMat);
    hitProxy.position.y = 0.16;
    root.add(hitProxy);

    // 4. Floating tactical world tag above the weapon
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256;
    labelCanvas.height = 64;
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    const spriteMat = new THREE.SpriteMaterial({
      map: labelTexture,
      transparent: true,
      depthTest: false,
    });
    const labelSprite = new THREE.Sprite(spriteMat);
    labelSprite.position.set(0, 0.52, 0);
    labelSprite.scale.set(0.95, 0.24, 1);
    root.add(labelSprite);

    const drop: DroppedWeapon = {
      uid: this.nextUid++,
      weaponId,
      def,
      currentMagAmmo: Math.max(0, Math.round(currentMagAmmo)),
      reserveAmmo: Math.max(0, Math.round(reserveAmmo)),
      position: position.clone(),
      velocity: velocity.clone(),
      angularVel: new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 6,
      ),
      root,
      weaponPivot,
      hitProxy,
      ringMat,
      beaconMat,
      labelSprite,
      labelCanvas,
      labelTexture,
      rimMeshes,
      grounded: false,
      age: 0,
      scavengeCooldown: initialScavengeCooldown,
    };

    hitProxy.userData.weaponDrop = drop;
    this.refreshDropLabel(drop, false);
    this.drops.push(drop);
    return drop;
  }

  /**
   * Formats the exact HUD prompt required when aiming at a dropped weapon within 2.5m.
   */
  getPickupPrompt(): string | null {
    if (!this.focusedDrop) return null;
    const d = this.focusedDrop;
    return `[F] Swap for ${d.def.name} (${d.currentMagAmmo} / ${d.reserveAmmo})`;
  }

  /**
   * Updates drop physics, 25s lifetime despawn, 1.5m auto-ammo scavenging,
   * and 2.5m raycast pickup prompt + `[F]` weapon swapping.
   */
  update(
    dt: number,
    playerPosition: THREE.Vector3,
    worldCamera: THREE.PerspectiveCamera,
    interactPressed: boolean,
  ): void {
    // 1. Update physics & lifetime (25s max)
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      d.scavengeCooldown = Math.max(0, d.scavengeCooldown - dt);

      if (d.age >= DROP_LIFETIME_SEC) {
        this.removeDrop(d);
        continue;
      }

      this.stepDropPhysics(d, dt);
    }

    // 2. Auto-Ammo Scavenge within 1.5m if matching currently equipped primary weapon
    const equippedIsPrimary = this.weapons.activeSlot === 'primary';
    const equippedPrimaryId = this.weapons.primaryId;

    if (equippedIsPrimary) {
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i];
        if (d.weaponId !== equippedPrimaryId || d.scavengeCooldown > 0) continue;

        const dx = d.position.x - playerPosition.x;
        const dz = d.position.z - playerPosition.z;
        const dy = d.position.y - playerPosition.y;
        const dist = Math.hypot(dx, dy, dz);

        if (dist <= AUTO_SCAVENGE_RADIUS) {
          const totalDropAmmo = d.currentMagAmmo + d.reserveAmmo;
          if (totalDropAmmo <= 0) {
            this.removeDrop(d);
            continue;
          }

          // Absorb up to 1 reserve magazine (def.ammo.magSize) from the matching drop
          const oneMag = d.def.ammo.magSize;
          const absorb = Math.min(oneMag, totalDropAmmo);

          // Deduct from reserve first, then mag
          const fromReserve = Math.min(d.reserveAmmo, absorb);
          d.reserveAmmo -= fromReserve;
          const rem = absorb - fromReserve;
          if (rem > 0) {
            d.currentMagAmmo = Math.max(0, d.currentMagAmmo - rem);
          }

          this.weapons.addPrimaryReserveAmmo(absorb);
          const isEmpty = d.currentMagAmmo + d.reserveAmmo <= 0;

          if (isEmpty) {
            this.removeDrop(d);
          } else {
            d.scavengeCooldown = 1.5;
            this.refreshDropLabel(d, d === this.focusedDrop);
          }

          this.onScavenge?.({
            weaponDef: d.def,
            roundsAbsorbed: absorb,
            dropRemoved: isEmpty,
          });
        }
      }
    }

    // 3. Raycast Pickup Prompt within 2.5m (with horizontal proximity fallback when looking level)
    worldCamera.updateMatrixWorld(true);
    this.tmpCamPos.setFromMatrixPosition(worldCamera.matrixWorld);
    worldCamera.getWorldDirection(this.tmpCamDir).normalize();

    this.raycaster.set(this.tmpCamPos, this.tmpCamDir);
    this.raycaster.near = 0.05;
    this.raycaster.far = 3.2;

    const proxies = this.drops.map((d) => d.hitProxy);
    const hits = this.raycaster.intersectObjects(proxies, false);

    let newFocus: DroppedWeapon | null = null;
    if (hits.length > 0) {
      const candidate = hits[0].object.userData.weaponDrop as DroppedWeapon | undefined;
      if (candidate) {
        const horizDist = Math.hypot(
          candidate.position.x - playerPosition.x,
          candidate.position.z - playerPosition.z,
        );
        if (horizDist <= PICKUP_RAYCAST_RANGE || candidate.position.distanceTo(this.tmpCamPos) <= 3.0) {
          newFocus = candidate;
        }
      }
    }

    // Fallback: if player is within 2.5m horizontally of a dropped weapon while looking level
    if (!newFocus) {
      let bestDist = PICKUP_RAYCAST_RANGE;
      for (const d of this.drops) {
        const dx = d.position.x - playerPosition.x;
        const dz = d.position.z - playerPosition.z;
        const dy = Math.abs(d.position.y - playerPosition.y);
        const horizDist = Math.hypot(dx, dz);
        if (horizDist <= bestDist && dy <= 2.0) {
          bestDist = horizDist;
          newFocus = d;
        }
      }
    }

    if (newFocus !== this.focusedDrop) {
      const prev = this.focusedDrop;
      this.focusedDrop = newFocus;
      if (prev && this.drops.includes(prev)) this.refreshDropLabel(prev, false);
      if (newFocus) this.refreshDropLabel(newFocus, true);
    }

    // Update highlight pulse on all active drops
    const now = performance.now() * 0.004;
    for (const d of this.drops) {
      const isFocused = d === this.focusedDrop;
      const isMatchingPrimary = d.weaponId === this.weapons.primaryId;
      const blink = d.age > DROP_LIFETIME_SEC - 3.5 ? 0.45 + 0.55 * Math.sin(now * 6) : 1.0;

      if (isFocused) {
        d.ringMat.color.setRGB(3.2, 2.1, 0.35);
        d.beaconMat.color.setRGB(3.2, 2.1, 0.35);
        d.ringMat.opacity = 0.95 * blink;
        for (const m of d.rimMeshes) {
          m.emissive.setHex(0x4a3008);
          m.emissiveIntensity = 1.1;
        }
      } else if (isMatchingPrimary) {
        d.ringMat.color.setRGB(0.35, 2.8, 1.3);
        d.beaconMat.color.setRGB(0.35, 2.8, 1.3);
        d.ringMat.opacity = 0.78 * blink;
        for (const m of d.rimMeshes) {
          m.emissive.setHex(0x0a381e);
          m.emissiveIntensity = 0.75;
        }
      } else {
        d.ringMat.color.setRGB(0.3, 1.9, 2.6);
        d.beaconMat.color.setRGB(0.3, 1.9, 2.6);
        d.ringMat.opacity = 0.72 * blink;
        for (const m of d.rimMeshes) {
          m.emissive.setHex(0x0c2436);
          m.emissiveIntensity = 0.65;
        }
      }
    }

    // 4. [F] Swap execution
    if (interactPressed && this.focusedDrop) {
      this.performSwap(this.focusedDrop, playerPosition, this.tmpCamDir);
    }
  }

  performSwap(targetDrop: DroppedWeapon, playerPosition: THREE.Vector3, lookDir: THREE.Vector3): void {
    const newWeaponId = targetDrop.weaponId;
    const newMag = targetDrop.currentMagAmmo;
    const newReserve = targetDrop.reserveAmmo;
    const pickupPos = targetDrop.position.clone();

    // Remove the picked-up weapon first so cap of 12 is respected cleanly
    this.removeDrop(targetDrop);

    // Equip new primary weapon in 250ms and retrieve previous primary weapon + exact ammo
    const prev = this.weapons.swapPrimaryWeapon(newWeaponId, newMag, newReserve, EQUIP_SWAP_TIME_SEC);

    // Toss the player's previous primary weapon onto the floor
    const dropOrigin = new THREE.Vector3(
      playerPosition.x + lookDir.x * 0.55,
      Math.max(pickupPos.y + 0.45, playerPosition.y + 1.05),
      playerPosition.z + lookDir.z * 0.55,
    );
    const dropVelocity = new THREE.Vector3(
      lookDir.x * 2.8 + (Math.random() - 0.5) * 0.6,
      1.9,
      lookDir.z * 2.8 + (Math.random() - 0.5) * 0.6,
    );

    this.spawnWeaponDrop(
      prev.previousId,
      prev.previousMag,
      prev.previousReserve,
      dropOrigin,
      dropVelocity,
      0.85,
    );

    this.onSwap?.({
      newWeaponDef: WEAPONS[newWeaponId],
      newMag,
      newReserve,
      droppedWeaponDef: WEAPONS[prev.previousId],
      droppedMag: prev.previousMag,
      droppedReserve: prev.previousReserve,
    });
  }

  clearAll(): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      this.removeDrop(this.drops[i]);
    }
    this.focusedDrop = null;
  }

  removeDrop(drop: DroppedWeapon): void {
    const idx = this.drops.indexOf(drop);
    if (idx !== -1) this.drops.splice(idx, 1);
    if (this.focusedDrop === drop) this.focusedDrop = null;

    this.worldScene.remove(drop.root);
    drop.weaponPivot.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
      }
    });
    drop.ringMat.dispose();
    drop.beaconMat.dispose();
    drop.labelTexture.dispose();
    (drop.labelSprite.material as THREE.Material).dispose();
    for (const m of drop.rimMeshes) m.dispose();
  }

  private stepDropPhysics(d: DroppedWeapon, dt: number): void {
    const gravity = 18.5;
    if (!d.grounded) {
      d.velocity.y -= gravity * dt;
    }

    d.position.addScaledVector(d.velocity, dt);

    // Keep within arena bounds across all 4 map sizes (up to 96m x 96m Bone Yard)
    d.position.x = THREE.MathUtils.clamp(d.position.x, -47.0, 47.0);
    d.position.z = THREE.MathUtils.clamp(d.position.z, -47.0, 47.0);

    // Probe floor height below the weapon
    const r = 0.25;
    const floorY =
      this.collisionWorld.highestFloor(
        d.position.x - r,
        d.position.x + r,
        d.position.z - r,
        d.position.z + r,
        -2.0,
        d.position.y + 0.35,
      ) ?? 0;

    if (d.position.y <= floorY) {
      d.position.y = floorY;
      if (d.velocity.y < -0.85) {
        // Bounce with energy damping
        d.velocity.y = -d.velocity.y * 0.36;
        d.velocity.x *= 0.68;
        d.velocity.z *= 0.68;
        d.angularVel.multiplyScalar(0.6);
      } else {
        d.velocity.y = 0;
        d.grounded = true;
      }
    } else {
      d.grounded = false;
    }

    if (d.grounded) {
      const drag = Math.exp(-10 * dt);
      d.velocity.x *= drag;
      d.velocity.z *= drag;
      // Settle flat on its side on the floor
      d.weaponPivot.rotation.x += (0 - d.weaponPivot.rotation.x) * (1 - Math.exp(-10 * dt));
      d.weaponPivot.rotation.z += (1.42 - d.weaponPivot.rotation.z) * (1 - Math.exp(-10 * dt));
      d.weaponPivot.rotation.y += d.angularVel.y * dt * 0.15;
      d.angularVel.multiplyScalar(Math.exp(-8 * dt));
    } else {
      d.weaponPivot.rotation.x += d.angularVel.x * dt;
      d.weaponPivot.rotation.y += d.angularVel.y * dt;
      d.weaponPivot.rotation.z += d.angularVel.z * dt;
    }

    d.root.position.copy(d.position);
  }

  private refreshDropLabel(d: DroppedWeapon, focused: boolean): void {
    const c = d.labelCanvas;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);

    g.fillStyle = focused ? 'rgba(28, 20, 8, 0.9)' : 'rgba(10, 16, 24, 0.82)';
    g.strokeStyle = focused ? '#ffbe42' : '#27d8ff';
    g.lineWidth = 3;
    g.fillRect(4, 4, c.width - 8, c.height - 8);
    g.strokeRect(4, 4, c.width - 8, c.height - 8);

    g.fillStyle = '#ffffff';
    g.font = 'bold 22px Consolas, monospace';
    g.textAlign = 'center';
    g.fillText(d.def.shortName, c.width / 2, 29);

    g.fillStyle = focused ? '#ffbe42' : '#9ad8ef';
    g.font = 'bold 16px Consolas, monospace';
    g.fillText(`${d.currentMagAmmo} / ${d.reserveAmmo} RDS`, c.width / 2, 50);

    d.labelTexture.needsUpdate = true;
  }
}
