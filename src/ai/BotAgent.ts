import * as THREE from 'three';
import {
  WEAPONS,
  SIDEARM,
  type WeaponId,
  type WeaponDef,
  type HitZone,
} from '../weapons/WeaponDatabase';
import { buildWeaponModel } from '../player/WeaponModels';
import type { CollisionWorld } from '../core/CollisionWorld';

export type BotDifficulty = 'recruit' | 'regular' | 'veteran' | 'nightmare';

export interface DifficultyProfile {
  id: BotDifficulty;
  label: string;
  /** Time (seconds) after first perceiving a target before the bot can open fire. */
  reactionTimeSec: number;
  /** Angular aim error cone radius in degrees. */
  aimErrorDeg: number;
  /** Lateral strafe speed & weave intensity (0..1). */
  strafeIntensity: number;
  /** Angular tracking speed (radians/sec). */
  turnSpeedRad: number;
  /** Burst discipline multiplier. */
  burstPauseSec: number;
}

export const DIFFICULTY_PROFILES: Record<BotDifficulty, DifficultyProfile> = {
  recruit: {
    id: 'recruit',
    label: 'Recruit',
    reactionTimeSec: 0.70, // 700ms
    aimErrorDeg: 4.2,
    strafeIntensity: 0.45,
    turnSpeedRad: 4.5,
    burstPauseSec: 0.42,
  },
  regular: {
    id: 'regular',
    label: 'Regular',
    reactionTimeSec: 0.42, // 420ms
    aimErrorDeg: 2.5,
    strafeIntensity: 0.70,
    turnSpeedRad: 7.2,
    burstPauseSec: 0.28,
  },
  veteran: {
    id: 'veteran',
    label: 'Veteran',
    reactionTimeSec: 0.24, // 240ms
    aimErrorDeg: 1.3,
    strafeIntensity: 0.90,
    turnSpeedRad: 11.0,
    burstPauseSec: 0.18,
  },
  nightmare: {
    id: 'nightmare',
    label: 'Nightmare',
    reactionTimeSec: 0.12, // 120ms
    aimErrorDeg: 0.55,
    strafeIntensity: 1.00,
    turnSpeedRad: 16.5,
    burstPauseSec: 0.10,
  },
};

export type BotCombatRole = 'rush_cqb' | 'mid_burst' | 'long_sightline';
export type BotTacticalState =
  | 'PATROL'
  | 'RUSH_CLOSE'
  | 'MID_ENGAGE'
  | 'HOLD_SIGHTLINE'
  | 'SIDEARM_DEFENSE'
  | 'DEAD';

export interface CombatantTarget {
  id: string;
  name: string;
  isPlayer: boolean;
  alive: boolean;
  position: THREE.Vector3;
  eyePosition: THREE.Vector3;
  velocity: THREE.Vector3;
}

export interface ThreatScoreBreakdown {
  targetId: string;
  distance: number;
  distanceWeight: number;
  lineOfSightWeight: number;
  recentDamageWeight: number;
  totalScore: number;
  hasLineOfSight: boolean;
  isAudible: boolean;
}

export interface BotShotEvent {
  bot: BotAgent;
  weaponDef: WeaponDef;
  muzzleWorld: THREE.Vector3;
  dir: THREE.Vector3;
  endPoint: THREE.Vector3;
  hitTargetId: string | null;
  hitZone: HitZone | null;
  damage: number;
  killed: boolean;
}

const DEG = Math.PI / 180;
/** 110-degree vision cone => 55-degree half-angle. */
export const VISION_HALF_ANGLE_COS = Math.cos(55 * DEG);
export const VISION_MAX_RANGE = 95;
/** 35m gunfire audio detection radius. */
export const AUDIO_DETECTION_RANGE = 35;

const BOT_RADIUS = 0.38;
const BOT_HEIGHT = 1.78;
const BOT_EYE_HEIGHT = 1.56;
const BOT_BASE_SPEED = 6.6;

function makeBotNameTag(name: string, weaponShort: string): {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.35, 0.34, 1);
  sprite.position.set(0, 2.02, 0);
  sprite.raycast = () => {};
  updateBotNameTagCanvas(canvas, texture, name, weaponShort, 100, 100);
  return { sprite, canvas, texture };
}

function updateBotNameTagCanvas(
  canvas: HTMLCanvasElement,
  texture: THREE.CanvasTexture,
  name: string,
  weaponShort: string,
  hp: number,
  maxHp: number,
): void {
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);

  g.fillStyle = 'rgba(10, 14, 20, 0.82)';
  g.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  g.lineWidth = 2;
  g.fillRect(4, 4, canvas.width - 8, canvas.height - 8);
  g.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

  g.fillStyle = '#f1f5f9';
  g.font = 'bold 20px Consolas, monospace';
  g.textAlign = 'left';
  g.fillText(name, 14, 27);

  g.fillStyle = '#ffbe42';
  g.font = 'bold 17px Consolas, monospace';
  g.textAlign = 'right';
  g.fillText(`[${weaponShort}]`, canvas.width - 14, 27);

  // Health bar
  const barX = 14;
  const barY = 39;
  const barW = canvas.width - 28;
  const barH = 11;
  g.fillStyle = 'rgba(255, 255, 255, 0.14)';
  g.fillRect(barX, barY, barW, barH);

  const pct = THREE.MathUtils.clamp(hp / maxHp, 0, 1);
  g.fillStyle = pct > 0.5 ? '#34d399' : pct > 0.25 ? '#fbbf24' : '#f87171';
  g.fillRect(barX, barY, barW * pct, barH);

  texture.needsUpdate = true;
}

export function classifyCombatRole(weaponId: WeaponId): BotCombatRole {
  const cls = WEAPONS[weaponId].weaponClass;
  if (cls === 'smg' || cls === 'shotgun') return 'rush_cqb';
  if (cls === 'dmr' || cls === 'sniper') return 'long_sightline';
  return 'mid_burst';
}

export class BotAgent implements CombatantTarget {
  readonly id: string;
  readonly name: string;
  readonly isPlayer = false;

  alive = true;
  hp = 100;
  readonly maxHp = 100;
  respawnTimer = 0;

  // FFA Scoreboard telemetry
  kills = 0;
  deaths = 0;
  headshotKills = 0;

  readonly position = new THREE.Vector3();
  readonly eyePosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;

  primaryWeaponId: WeaponId;
  readonly secondaryWeaponId: WeaponId = SIDEARM;
  equippedWeaponId: WeaponId;

  primaryMag = 30;
  primaryReserve = 60;
  secondaryMag = 17;
  secondaryReserve = 34;

  difficulty: DifficultyProfile;
  combatRole: BotCombatRole;
  tacticalState: BotTacticalState = 'PATROL';

  currentTarget: CombatantTarget | null = null;
  lastThreatScores: ThreatScoreBreakdown[] = [];

  /** Tracks when current target first became perceived to enforce difficulty reaction time. */
  private targetPerceivedTime = 0;
  private trackedTargetId: string | null = null;

  /** Map of attackerId -> { damage, timestamp } for RecentDamageDealtToMe in threat formula. */
  private readonly damageMemory = new Map<string, { amount: number; time: number }>();
  /** Map of shooterId -> { position, timestamp } for 35m gunfire audio perception. */
  private readonly audioMemory = new Map<string, { position: THREE.Vector3; time: number }>();

  // Firing / Burst / Reload timers
  private fireCooldown = 0;
  private reloadTimer = 0;
  private burstShotsFired = 0;
  private burstPauseTimer = 0;

  // Movement & Strafe / Patrol state
  private strafeDir = 1;
  private strafeSwitchTimer = 0;
  private patrolGoal = new THREE.Vector3();
  private patrolWaitTimer = 0;

  // 3D visual hierarchy
  readonly root = new THREE.Group();
  readonly hitboxGroup = new THREE.Group();
  private readonly weaponMount = new THREE.Group();
  private heldWeaponModel: THREE.Group | null = null;
  private readonly plateMat: THREE.MeshStandardMaterial;
  private readonly headMat: THREE.MeshStandardMaterial;
  private readonly tagCanvas: HTMLCanvasElement;
  private readonly tagTexture: THREE.CanvasTexture;
  private hitFlashTimer = 0;

  private readonly tmpToTarget = new THREE.Vector3();
  private readonly tmpMin = new THREE.Vector3();
  private readonly tmpMax = new THREE.Vector3();

  onDamaged: ((attackerId: string, dmg: number, zone: HitZone) => void) | null = null;
  onKilled: ((killerId: string, weaponId: WeaponId, zone: HitZone) => void) | null = null;
  onFootstep: ((pos: THREE.Vector3, intensity: number) => void) | null = null;
  isSpawnProtected: (() => boolean) | null = null;
  private footstepAccum = 0;

  constructor(
    id: string,
    name: string,
    initialWeaponId: WeaponId,
    difficulty: BotDifficulty,
    scene: THREE.Scene,
  ) {
    this.id = id;
    this.name = name;
    this.primaryWeaponId = initialWeaponId;
    this.equippedWeaponId = initialWeaponId;
    this.difficulty = DIFFICULTY_PROFILES[difficulty];
    this.combatRole = classifyCombatRole(initialWeaponId);

    this.root.name = `bot_${id}`;
    scene.add(this.root);

    this.hitboxGroup.userData.botAgent = this;
    this.root.add(this.hitboxGroup);

    // Build tactical operator mesh (Head / Body / Limb hitzones)
    this.plateMat = new THREE.MeshStandardMaterial({
      color: 0x28343f,
      roughness: 0.48,
      metalness: 0.55,
    });
    this.headMat = new THREE.MeshStandardMaterial({
      color: 0x3b4856,
      roughness: 0.4,
      metalness: 0.5,
    });
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0xff5a36,
      roughness: 0.2,
      metalness: 0.8,
      emissive: new THREE.Color(0x661608),
    });
    const limbMat = new THREE.MeshStandardMaterial({
      color: 0x1e252d,
      roughness: 0.65,
      metalness: 0.25,
    });

    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.76, 0.19), limbMat);
    leftLeg.position.set(-0.14, 0.38, 0);
    leftLeg.userData.hitZone = 'limb' satisfies HitZone;

    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.76, 0.19), limbMat);
    rightLeg.position.set(0.14, 0.38, 0);
    rightLeg.userData.hitZone = 'limb' satisfies HitZone;

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.68, 0.26), this.plateMat);
    torso.position.set(0, 1.1, 0);
    torso.userData.hitZone = 'body' satisfies HitZone;

    const chestRig = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.36, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x4f4637, roughness: 0.75, metalness: 0.1 }),
    );
    chestRig.position.set(0, 1.05, 0);
    chestRig.userData.hitZone = 'body' satisfies HitZone;

    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.58, 0.16), limbMat);
    leftArm.position.set(-0.35, 1.08, 0);
    leftArm.userData.hitZone = 'limb' satisfies HitZone;

    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.58, 0.16), limbMat);
    rightArm.position.set(0.35, 1.08, 0);
    rightArm.userData.hitZone = 'limb' satisfies HitZone;

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.29, 0.26), this.headMat);
    head.position.set(0, 1.6, 0);
    head.userData.hitZone = 'head' satisfies HitZone;

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.04), visorMat);
    visor.position.set(0, 1.61, -0.125);
    visor.userData.hitZone = 'head' satisfies HitZone;

    this.hitboxGroup.add(leftLeg, rightLeg, torso, chestRig, leftArm, rightArm, head, visor);
    this.hitboxGroup.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });

    // Weapon mount on right hand/chest facing -Z (forward)
    this.weaponMount.position.set(0.22, 1.12, -0.26);
    this.hitboxGroup.add(this.weaponMount);

    const tag = makeBotNameTag(this.name, WEAPONS[initialWeaponId].shortName);
    this.tagCanvas = tag.canvas;
    this.tagTexture = tag.texture;
    this.root.add(tag.sprite);

    // Bullet hit callback used by player WeaponSystem raycaster
    this.hitboxGroup.userData.onBulletHit = (dmg: number, zone: HitZone): boolean => {
      return this.applyDamage('player', 'm4a1_sopmod', dmg, zone);
    };

    this.assignLoadout(initialWeaponId);
  }

  get equippedDef(): WeaponDef {
    return WEAPONS[this.equippedWeaponId];
  }

  get currentMagAmmo(): number {
    return this.equippedWeaponId === this.secondaryWeaponId ? this.secondaryMag : this.primaryMag;
  }

  set currentMagAmmo(val: number) {
    if (this.equippedWeaponId === this.secondaryWeaponId) this.secondaryMag = val;
    else this.primaryMag = val;
  }

  get currentReserveAmmo(): number {
    return this.equippedWeaponId === this.secondaryWeaponId ? this.secondaryReserve : this.primaryReserve;
  }

  set currentReserveAmmo(val: number) {
    if (this.equippedWeaponId === this.secondaryWeaponId) this.secondaryReserve = val;
    else this.primaryReserve = val;
  }

  setDifficulty(diff: BotDifficulty): void {
    this.difficulty = DIFFICULTY_PROFILES[diff];
  }

  resetStats(): void {
    this.kills = 0;
    this.deaths = 0;
    this.headshotKills = 0;
  }

  assignLoadout(primaryId: WeaponId): void {
    this.primaryWeaponId = primaryId;
    this.equippedWeaponId = primaryId;
    this.combatRole = classifyCombatRole(primaryId);

    const pDef = WEAPONS[primaryId];
    this.primaryMag = pDef.ammo.magSize;
    this.primaryReserve = pDef.ammo.magSize * pDef.ammo.reserveMags;

    const sDef = WEAPONS[this.secondaryWeaponId];
    this.secondaryMag = sDef.ammo.magSize;
    this.secondaryReserve = sDef.ammo.magSize * sDef.ammo.reserveMags;

    this.rebuildHeldWeaponMesh(primaryId);
    this.refreshNameTag();
  }

  private switchEquippedWeapon(targetId: WeaponId): void {
    if (this.equippedWeaponId === targetId) return;
    this.equippedWeaponId = targetId;
    this.reloadTimer = 0;
    this.burstShotsFired = 0;
    this.fireCooldown = 0.22;
    this.rebuildHeldWeaponMesh(targetId);
    this.refreshNameTag();
  }

  private rebuildHeldWeaponMesh(weaponId: WeaponId): void {
    if (this.heldWeaponModel) {
      this.heldWeaponModel.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
        }
      });
      this.weaponMount.remove(this.heldWeaponModel);
    }
    const built = buildWeaponModel(weaponId);
    this.heldWeaponModel = built.root;
    this.heldWeaponModel.scale.setScalar(1.1);
    this.heldWeaponModel.traverse((o) => {
      o.raycast = () => {};
    });
    this.weaponMount.add(this.heldWeaponModel);
  }

  private refreshNameTag(): void {
    updateBotNameTagCanvas(
      this.tagCanvas,
      this.tagTexture,
      this.name,
      WEAPONS[this.equippedWeaponId].shortName,
      this.hp,
      this.maxHp,
    );
  }

  spawnAt(pos: THREE.Vector3, yaw: number, primaryId: WeaponId, patrolPoints: THREE.Vector3[]): void {
    this.alive = true;
    this.hp = this.maxHp;
    this.respawnTimer = 0;
    this.position.copy(pos);
    this.eyePosition.set(pos.x, pos.y + BOT_EYE_HEIGHT, pos.z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.currentTarget = null;
    this.trackedTargetId = null;
    this.targetPerceivedTime = 0;
    this.tacticalState = 'PATROL';
    this.damageMemory.clear();
    this.audioMemory.clear();
    this.root.visible = true;
    this.root.position.copy(pos);
    this.hitboxGroup.rotation.y = yaw;
    this.assignLoadout(primaryId);
    if (patrolPoints.length > 0) {
      this.patrolGoal.copy(patrolPoints[Math.floor(Math.random() * patrolPoints.length)]);
    }
  }

  /**
   * Registers gunfire audio if within 35m of shooter.
   */
  notifyGunfireAudio(shooterId: string, shooterPos: THREE.Vector3, nowSec: number): void {
    if (!this.alive || shooterId === this.id) return;
    const dist = this.position.distanceTo(shooterPos);
    if (dist <= AUDIO_DETECTION_RANGE) {
      this.audioMemory.set(shooterId, {
        position: shooterPos.clone(),
        time: nowSec,
      });
    }
  }

  /**
   * Applies damage from any attacker (player or another bot). Returns true if this hit killed the bot.
   */
  applyDamage(attackerId: string, attackerWeaponId: WeaponId, dmg: number, zone: HitZone): boolean {
    if (!this.alive) return false;
    if (this.isSpawnProtected?.()) return false;
    const nowSec = performance.now() * 0.001;
    const prev = this.damageMemory.get(attackerId)?.amount ?? 0;
    this.damageMemory.set(attackerId, { amount: prev + dmg, time: nowSec });

    this.hp = Math.max(0, this.hp - dmg);
    this.hitFlashTimer = 0.09;
    this.refreshNameTag();
    this.onDamaged?.(attackerId, dmg, zone);

    if (this.hp <= 0) {
      this.alive = false;
      this.tacticalState = 'DEAD';
      this.respawnTimer = 2.5; // 2.5s respawn per spec
      this.root.visible = false;
      this.onKilled?.(attackerId, attackerWeaponId, zone);
      return true;
    }
    return false;
  }

  /**
   * Checks whether `target` is within this bot's 110-degree forward vision cone
   * AND has an unobstructed raycast Line-of-Sight against world obstacles.
   */
  hasLineOfSightTo(
    target: CombatantTarget,
    obstacleMeshes: THREE.Object3D[],
    raycaster: THREE.Raycaster,
    requireVisionCone = true,
  ): boolean {
    this.tmpToTarget.subVectors(target.eyePosition, this.eyePosition);
    const dist = this.tmpToTarget.length();
    if (dist < 0.05 || dist > VISION_MAX_RANGE) return false;
    this.tmpToTarget.multiplyScalar(1 / dist);

    if (requireVisionCone) {
      // Forward vector from bot yaw: (-sin(yaw), 0, -cos(yaw))
      const fwdX = -Math.sin(this.yaw);
      const fwdZ = -Math.cos(this.yaw);
      const horizLen = Math.hypot(this.tmpToTarget.x, this.tmpToTarget.z);
      const dot =
        horizLen > 1e-4
          ? (this.tmpToTarget.x * fwdX + this.tmpToTarget.z * fwdZ) / horizLen
          : 1;
      if (dot < VISION_HALF_ANGLE_COS) return false;
    }

    raycaster.set(this.eyePosition, this.tmpToTarget);
    raycaster.near = 0.1;
    raycaster.far = dist - 0.15;
    const hits = raycaster.intersectObjects(obstacleMeshes, false);
    return hits.length === 0;
  }

  /**
   * Scores a candidate target using the exact Phase 3 Threat Matrix formula:
   * Score = (DistanceWeight * 0.4) + (LineOfSightWeight * 0.35) + (RecentDamageDealtToMe * 0.25)
   */
  evaluateTargetScore(
    target: CombatantTarget,
    nowSec: number,
    obstacleMeshes: THREE.Object3D[],
    raycaster: THREE.Raycaster,
  ): ThreatScoreBreakdown | null {
    if (!target.alive || target.id === this.id) return null;

    const dist = this.position.distanceTo(target.position);
    const hasLosInCone = this.hasLineOfSightTo(target, obstacleMeshes, raycaster, true);

    const audioEntry = this.audioMemory.get(target.id);
    const hasGunfireAudio =
      audioEntry !== undefined && nowSec - audioEntry.time <= 4.0 && dist <= AUDIO_DETECTION_RANGE;
    // Footstep / tactical proximity awareness so bots actively converge in FFA
    const hasProximityAudio = !target.isPlayer
      ? dist <= 28.0
      : dist <= 15.0 && target.velocity.lengthSq() > 9.0;
    const isAudible = hasGunfireAudio || hasProximityAudio;

    const dmgEntry = this.damageMemory.get(target.id);
    const recentDmg = dmgEntry !== undefined && nowSec - dmgEntry.time <= 5.0 ? dmgEntry.amount : 0;

    // If neither visible in the 110° cone nor heard nor recently damaged us, not perceived
    const hasUnobstructedLosAnywhere =
      (isAudible || recentDmg > 0) && this.hasLineOfSightTo(target, obstacleMeshes, raycaster, false);
    const isPerceived = hasLosInCone || isAudible || recentDmg > 0;
    if (!isPerceived) return null;

    const hasLos = hasLosInCone || hasUnobstructedLosAnywhere;

    const distanceWeight = THREE.MathUtils.clamp(1 - dist / VISION_MAX_RANGE, 0, 1);
    const lineOfSightWeight = hasLos ? 1.0 : isAudible ? 0.35 : 0.15;
    const recentDamageWeight = THREE.MathUtils.clamp(recentDmg / 100, 0, 1);

    const totalScore =
      distanceWeight * 0.4 +
      lineOfSightWeight * 0.35 +
      recentDamageWeight * 0.25;

    return {
      targetId: target.id,
      distance: dist,
      distanceWeight,
      lineOfSightWeight,
      recentDamageWeight,
      totalScore,
      hasLineOfSight: hasLos,
      isAudible,
    };
  }

  update(
    dt: number,
    nowSec: number,
    allCombatants: CombatantTarget[],
    obstacleMeshes: THREE.Object3D[],
    collisionWorld: CollisionWorld,
    patrolPoints: THREE.Vector3[],
    raycaster: THREE.Raycaster,
    onBotFire: (shot: BotShotEvent) => void,
  ): void {
    if (!this.alive) return;

    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.burstPauseTimer = Math.max(0, this.burstPauseTimer - dt);
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= dt;
      this.plateMat.emissive.setHex(0x552211);
    } else {
      this.plateMat.emissive.setHex(0x000000);
    }

    // Handle active reload
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const def = this.equippedDef;
        const needed = def.ammo.magSize - this.currentMagAmmo;
        const take = Math.min(needed, this.currentReserveAmmo);
        this.currentMagAmmo += take;
        this.currentReserveAmmo -= take;
        if (this.currentReserveAmmo < def.ammo.magSize) {
          this.currentReserveAmmo = def.ammo.magSize; // keep bots combat-ready over long matches
        }
      }
    }

    // 1. Evaluate Free-For-All Threat Matrix across all living combatants
    this.lastThreatScores.length = 0;
    let bestTarget: CombatantTarget | null = null;
    let bestBreakdown: ThreatScoreBreakdown | null = null;

    for (const candidate of allCombatants) {
      const score = this.evaluateTargetScore(candidate, nowSec, obstacleMeshes, raycaster);
      if (score) {
        this.lastThreatScores.push(score);
        if (!bestBreakdown || score.totalScore > bestBreakdown.totalScore) {
          bestBreakdown = score;
          bestTarget = candidate;
        }
      }
    }

    this.currentTarget = bestTarget;

    if (bestTarget && bestBreakdown) {
      if (this.trackedTargetId !== bestTarget.id) {
        this.trackedTargetId = bestTarget.id;
        this.targetPerceivedTime = nowSec;
        this.burstShotsFired = 0;
      }
      this.updateCombatBehavior(
        dt,
        nowSec,
        bestTarget,
        bestBreakdown,
        obstacleMeshes,
        collisionWorld,
        raycaster,
        onBotFire,
      );
    } else {
      this.trackedTargetId = null;
      this.tacticalState = 'PATROL';
      this.updatePatrolBehavior(dt, collisionWorld, patrolPoints);
    }

    this.eyePosition.set(this.position.x, this.position.y + BOT_EYE_HEIGHT, this.position.z);
    this.root.position.copy(this.position);
    this.hitboxGroup.rotation.y = this.yaw;
  }

  private updateCombatBehavior(
    dt: number,
    nowSec: number,
    target: CombatantTarget,
    threat: ThreatScoreBreakdown,
    obstacleMeshes: THREE.Object3D[],
    collisionWorld: CollisionWorld,
    raycaster: THREE.Raycaster,
    onBotFire: (shot: BotShotEvent) => void,
  ): void {
    const dist = threat.distance;

    // Loadout-aware weapon switching & tactical combat state
    if (this.combatRole === 'long_sightline') {
      // Marksman / Sniper bots (MK14, AWM) swap to Glock 19 sidearm when pushed within 8m
      if (dist <= 8.0) {
        this.tacticalState = 'SIDEARM_DEFENSE';
        this.switchEquippedWeapon(this.secondaryWeaponId);
      } else if (dist >= 9.5) {
        this.tacticalState = 'HOLD_SIGHTLINE';
        this.switchEquippedWeapon(this.primaryWeaponId);
      } else {
        this.tacticalState =
          this.equippedWeaponId === this.secondaryWeaponId ? 'SIDEARM_DEFENSE' : 'HOLD_SIGHTLINE';
      }
    } else if (this.combatRole === 'rush_cqb') {
      // SMG / Shotgun bots (MP7, Vector, M1014) aggressively rush to close range (<12m) and strafe-fire
      this.tacticalState = 'RUSH_CLOSE';
      this.switchEquippedWeapon(this.primaryWeaponId);
    } else {
      // AR / LMG bots (M4A1, AK-105, M249) engage at mid-range (15m-35m) with controlled bursts
      this.tacticalState = 'MID_ENGAGE';
      this.switchEquippedWeapon(this.primaryWeaponId);
    }

    // Smoothly orient yaw & pitch toward target
    const dx = target.eyePosition.x - this.eyePosition.x;
    const dy = target.eyePosition.y - this.eyePosition.y;
    const dz = target.eyePosition.z - this.eyePosition.z;
    const desiredYaw = Math.atan2(-dx, -dz);
    const desiredPitch = Math.atan2(dy, Math.hypot(dx, dz));

    let yawDiff = desiredYaw - this.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    const maxTurn = this.difficulty.turnSpeedRad * dt;
    this.yaw += THREE.MathUtils.clamp(yawDiff, -maxTurn, maxTurn);
    this.pitch = desiredPitch;

    // Strafe direction timer
    this.strafeSwitchTimer -= dt;
    if (this.strafeSwitchTimer <= 0) {
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      this.strafeSwitchTimer = 0.55 + Math.random() * 0.9;
    }

    // Compute desired movement vector based on loadout combat role
    const fwdX = -Math.sin(this.yaw);
    const fwdZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    let moveForward = 0;
    let moveStrafe = this.strafeDir * this.difficulty.strafeIntensity;

    if (this.combatRole === 'rush_cqb') {
      // Aggressively rush until <12m, then wide strafe-fire
      if (dist > 11.5) {
        moveForward = 1.05;
        moveStrafe *= 0.45;
      } else if (dist < 4.0) {
        moveForward = -0.35;
      } else {
        moveForward = 0.2;
      }
    } else if (this.combatRole === 'mid_burst') {
      // Maintain 15m - 35m engagement envelope
      if (dist > 34.0) moveForward = 0.9;
      else if (dist < 15.0) moveForward = -0.65;
      else moveForward = 0.0;
    } else {
      // Marksman / Sniper: hold long sightlines; backpedal while firing sidearm if pushed < 8m
      if (this.tacticalState === 'SIDEARM_DEFENSE') {
        moveForward = -0.8;
      } else if (dist < 22.0) {
        moveForward = -0.45;
      } else {
        moveForward = 0.0;
        moveStrafe *= 0.35;
      }
    }

    // If we only heard the target and don't have LOS yet, advance toward their position
    if (!threat.hasLineOfSight) {
      moveForward = 0.85;
    }

    const speed = BOT_BASE_SPEED * this.equippedDef.handling.moveSpeedMult;
    const vx = (fwdX * moveForward + rightX * moveStrafe) * speed;
    const vz = (fwdZ * moveForward + rightZ * moveStrafe) * speed;
    this.moveWithCollision(vx, vz, dt, collisionWorld);

    // Firing logic: requires LOS, reaction time elapsed, ammo in mag, and burst timer ready
    if (this.currentMagAmmo <= 0 && this.reloadTimer <= 0) {
      this.reloadTimer = this.equippedDef.ammo.reloadTime || 2.0;
      return;
    }

    const requiredReaction = target.isPlayer
      ? this.difficulty.reactionTimeSec
      : this.difficulty.reactionTimeSec * 0.42;
    const reactionElapsed = nowSec - this.targetPerceivedTime >= requiredReaction;
    const maxAimYawDiff = target.isPlayer ? 0.38 : 0.55;
    if (
      threat.hasLineOfSight &&
      reactionElapsed &&
      this.reloadTimer <= 0 &&
      this.fireCooldown <= 0 &&
      this.burstPauseTimer <= 0 &&
      Math.abs(yawDiff) < maxAimYawDiff
    ) {
      this.fireAtTarget(target, obstacleMeshes, raycaster, onBotFire);
    }
  }

  private fireAtTarget(
    target: CombatantTarget,
    obstacleMeshes: THREE.Object3D[],
    raycaster: THREE.Raycaster,
    onBotFire: (shot: BotShotEvent) => void,
  ): void {
    const def = this.equippedDef;
    this.currentMagAmmo = Math.max(0, this.currentMagAmmo - 1);
    this.fireCooldown = 60 / def.fire.rpm;
    this.burstShotsFired += 1;

    // Controlled bursts for AR/LMG bots; deliberate shots for DMR/Sniper
    if (this.combatRole === 'mid_burst') {
      const burstLen = def.weaponClass === 'lmg' ? 9 : 5;
      if (this.burstShotsFired >= burstLen) {
        this.burstShotsFired = 0;
        this.burstPauseTimer = target.isPlayer
          ? this.difficulty.burstPauseSec
          : this.difficulty.burstPauseSec * 0.55;
      }
    } else if (this.combatRole === 'long_sightline' && this.equippedWeaponId === this.primaryWeaponId) {
      this.burstPauseTimer =
        def.fire.mode === 'bolt'
          ? def.ammo.boltCycleTime
          : this.difficulty.burstPauseSec * (target.isPlayer ? 1.1 : 0.65);
    }

    // Aim toward target chest/head with difficulty aim cone error
    const aimHeight = !target.isPlayer && Math.random() < 0.28 ? 1.56 : 1.18;
    const aimPoint = new THREE.Vector3(
      target.position.x,
      target.position.y + aimHeight,
      target.position.z,
    );
    const baseDir = aimPoint.sub(this.eyePosition).normalize();

    const pellets = def.damage.pellets;
    const muzzleWorld = new THREE.Vector3(
      this.position.x - Math.sin(this.yaw) * 0.55,
      this.position.y + 1.15,
      this.position.z - Math.cos(this.yaw) * 0.55,
    );

    const botVsBotAccuracyMult = target.isPlayer ? 1.0 : 0.38;

    for (let p = 0; p < pellets; p++) {
      const errDeg =
        (this.difficulty.aimErrorDeg +
          (pellets > 1 ? def.spread.pelletSpreadHip * 0.5 : def.spread.hipBase * 0.35)) *
        botVsBotAccuracyMult;
      const errRad = errDeg * DEG;
      const r = Math.sqrt(Math.random()) * Math.tan(errRad);
      const theta = Math.random() * Math.PI * 2;

      const shotDir = baseDir.clone();
      shotDir.x += Math.cos(theta) * r;
      shotDir.y += Math.sin(theta) * r * 0.75;
      shotDir.z += Math.cos(theta + 1.1) * r;
      shotDir.normalize();

      // Check obstacle distance first
      raycaster.set(this.eyePosition, shotDir);
      raycaster.near = 0.1;
      raycaster.far = def.fire.maxRange;
      const wallHits = raycaster.intersectObjects(obstacleMeshes, false);
      const maxDist = wallHits.length > 0 ? wallHits[0].distance : def.fire.maxRange;
      const endPoint =
        wallHits.length > 0
          ? wallHits[0].point.clone()
          : this.eyePosition.clone().addScaledVector(shotDir, def.fire.maxRange);

      // Check if ray intersects the target's cylinder/capsule within maxDist
      const hitResult = this.intersectTargetCapsule(this.eyePosition, shotDir, target, maxDist);
      let dmg = 0;
      const killed = false;
      if (hitResult) {
        dmg = this.computeWeaponDamage(def, hitResult.distance, hitResult.zone);
        if (!target.isPlayer) {
          // Ensure brisk bot-vs-bot TTK in Free-For-All skirmishes
          dmg = Math.round(dmg * 1.25);
        }
        endPoint.copy(hitResult.point);
      }

      onBotFire({
        bot: this,
        weaponDef: def,
        muzzleWorld,
        dir: shotDir,
        endPoint,
        hitTargetId: hitResult ? target.id : null,
        hitZone: hitResult ? hitResult.zone : null,
        damage: dmg,
        killed,
      });
    }
  }

  private intersectTargetCapsule(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    target: CombatantTarget,
    maxDist: number,
  ): { distance: number; point: THREE.Vector3; zone: HitZone } | null {
    // Ray-to-vertical-segment closest approach
    const tx = target.position.x - origin.x;
    const tz = target.position.z - origin.z;
    const horizDirSq = dir.x * dir.x + dir.z * dir.z;
    if (horizDirSq < 1e-6) return null;

    const t = (tx * dir.x + tz * dir.z) / horizDirSq;
    if (t < 0.2 || t > maxDist) return null;

    const hitX = origin.x + dir.x * t;
    const hitY = origin.y + dir.y * t;
    const hitZ = origin.z + dir.z * t;

    const radialDist = Math.hypot(hitX - target.position.x, hitZ - target.position.z);
    const maxRadius = target.isPlayer ? 0.42 : 0.52;
    if (radialDist > maxRadius) return null;

    const relY = hitY - target.position.y;
    if (relY < -0.05 || relY > 1.88) return null;

    const zone: HitZone = relY >= 1.42 ? 'head' : relY >= 0.72 ? 'body' : 'limb';
    return {
      distance: t,
      point: new THREE.Vector3(hitX, hitY, hitZ),
      zone,
    };
  }

  private computeWeaponDamage(def: WeaponDef, distance: number, zone: HitZone): number {
    const d = def.damage;
    let falloff = 1.0;
    if (distance > d.falloffStart) {
      const u = THREE.MathUtils.clamp((distance - d.falloffStart) / (d.falloffEnd - d.falloffStart), 0, 1);
      falloff = THREE.MathUtils.lerp(1.0, d.minMultiplier, u);
    }
    const mult = zone === 'head' ? d.headMultiplier : zone === 'limb' ? d.limbMultiplier : 1.0;
    return Math.max(1, Math.round(d.base * falloff * mult));
  }

  private updatePatrolBehavior(
    dt: number,
    collisionWorld: CollisionWorld,
    patrolPoints: THREE.Vector3[],
  ): void {
    if (patrolPoints.length === 0) return;

    const dx = this.patrolGoal.x - this.position.x;
    const dz = this.patrolGoal.z - this.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 1.8) {
      this.patrolWaitTimer -= dt;
      if (this.patrolWaitTimer <= 0) {
        const next = patrolPoints[Math.floor(Math.random() * patrolPoints.length)];
        this.patrolGoal.copy(next);
        this.patrolWaitTimer = 0.4 + Math.random() * 0.8;
      }
      return;
    }

    const desiredYaw = Math.atan2(-dx, -dz);
    let yawDiff = desiredYaw - this.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    this.yaw += THREE.MathUtils.clamp(yawDiff, -5.0 * dt, 5.0 * dt);

    const speed = BOT_BASE_SPEED * 0.78 * this.equippedDef.handling.moveSpeedMult;
    const vx = (dx / dist) * speed;
    const vz = (dz / dist) * speed;
    const blocked = this.moveWithCollision(vx, vz, dt, collisionWorld);
    if (blocked) {
      const next = patrolPoints[Math.floor(Math.random() * patrolPoints.length)];
      this.patrolGoal.copy(next);
    }
  }

  private moveWithCollision(
    vx: number,
    vz: number,
    dt: number,
    collisionWorld: CollisionWorld,
  ): boolean {
    let blocked = false;
    this.velocity.set(vx, 0, vz);

    // X step (with step-up clearance of 0.42m so bots climb stairs/ramps smoothly)
    const oldX = this.position.x;
    this.position.x = THREE.MathUtils.clamp(this.position.x + vx * dt, -47.5, 47.5);
    if (this.overlapsWorld(collisionWorld, 0.42)) {
      this.position.x = oldX;
      blocked = true;
    }

    // Z step
    const oldZ = this.position.z;
    this.position.z = THREE.MathUtils.clamp(this.position.z + vz * dt, -47.5, 47.5);
    if (this.overlapsWorld(collisionWorld, 0.42)) {
      this.position.z = oldZ;
      blocked = true;
    }

    // Probe floor/ramp height under bot
    const floorY = collisionWorld.highestFloor(
      this.position.x - BOT_RADIUS * 0.8,
      this.position.x + BOT_RADIUS * 0.8,
      this.position.z - BOT_RADIUS * 0.8,
      this.position.z + BOT_RADIUS * 0.8,
      this.position.y - 0.55,
      this.position.y + 0.45,
    );
    if (floorY !== null) {
      this.position.y = floorY;
    } else if (this.position.y > 0) {
      // Bot stepped off an elevated platform/tower/catwalk — apply gravity toward lower floor
      const lowerFloor =
        collisionWorld.highestFloor(
          this.position.x - BOT_RADIUS * 0.8,
          this.position.x + BOT_RADIUS * 0.8,
          this.position.z - BOT_RADIUS * 0.8,
          this.position.z + BOT_RADIUS * 0.8,
          -2.0,
          this.position.y,
        ) ?? 0;
      this.position.y = Math.max(lowerFloor, this.position.y - 18.0 * dt);
    }

    const stepDist = Math.hypot(this.position.x - oldX, this.position.z - oldZ);
    if (stepDist > 0.001) {
      this.footstepAccum += stepDist;
      if (this.footstepAccum >= 2.35) {
        this.footstepAccum = 0;
        const speedNorm = Math.min(1.2, Math.hypot(vx, vz) / BOT_BASE_SPEED);
        this.onFootstep?.(this.position, speedNorm);
      }
    }

    return blocked;
  }

  private overlapsWorld(collisionWorld: CollisionWorld, stepClearance = 0.05): boolean {
    this.tmpMin.set(
      this.position.x - BOT_RADIUS,
      this.position.y + stepClearance,
      this.position.z - BOT_RADIUS,
    );
    this.tmpMax.set(
      this.position.x + BOT_RADIUS,
      this.position.y + BOT_HEIGHT,
      this.position.z + BOT_RADIUS,
    );
    return collisionWorld.firstOverlap(this.tmpMin, this.tmpMax) !== null;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.root);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (o.material instanceof THREE.Material && o.material !== this.plateMat && o.material !== this.headMat) {
          // Only dispose non-shared per-bot materials
          if (o.parent === this.hitboxGroup) {
            o.material.dispose();
          }
        }
      } else if (o instanceof THREE.Sprite) {
        o.material.dispose();
      }
    });
    this.plateMat.dispose();
    this.headMat.dispose();
    this.tagTexture.dispose();
  }
}
