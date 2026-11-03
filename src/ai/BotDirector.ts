import * as THREE from 'three';
import {
  PRIMARY_ORDER,
  WEAPONS,
  type WeaponId,
  type WeaponDef,
  type HitZone,
} from '../weapons/WeaponDatabase';
import {
  BotAgent,
  type BotDifficulty,
  type CombatantTarget,
  type BotShotEvent,
} from './BotAgent';
import type { LootDropManager } from '../weapons/LootDropManager';
import type { CollisionWorld } from '../core/CollisionWorld';
import type { AudioManager } from '../core/AudioManager';
import { SpawnSystem, type SpawnNodeScore } from '../maps/SpawnSystem';

export interface KillFeedEvent {
  killerId: string;
  killerName: string;
  killerIsPlayer: boolean;
  victimId: string;
  victimName: string;
  victimIsPlayer: boolean;
  weaponDef: WeaponDef;
  headshot: boolean;
}

export interface LoadoutWeightEntry {
  weaponId: WeaponId;
  activeCount: number;
  weight: number;
}

const CALLSIGNS = [
  'VORTEX',
  'KESTREL',
  'SPECTRE',
  'WARDEN',
  'DAGGER',
  'NOMAD',
  'REAPER',
  'FALCON',
  'TITAN',
  'PHANTOM',
  'VIPER',
  'COBALT',
  'RONIN',
  'APEX',
  'HAVOC',
];

interface BotTracer {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  maxAge: number;
}

export type BotDifficultySetting = BotDifficulty | 'mixed';

const MIXED_TIERS: BotDifficulty[] = ['recruit', 'regular', 'veteran', 'nightmare'];

export interface PlayerDamageEvent {
  damage: number;
  attackerId: string;
  attackerName: string;
  attackerPos: THREE.Vector3;
  attackerEyePos: THREE.Vector3;
  weaponDef: WeaponDef;
  distance: number;
  killed: boolean;
}

export class BotDirector {
  readonly bots: BotAgent[] = [];
  targetBotCount = 7;
  difficulty: BotDifficultySetting = 'regular';

  onKillFeed: ((ev: KillFeedEvent) => void) | null = null;
  onPlayerDamaged: ((
    dmg: number,
    attackerPos: THREE.Vector3,
    weaponDef: WeaponDef,
    killed: boolean,
    detail: PlayerDamageEvent,
  ) => void) | null = null;
  onShootablesChanged: (() => void) | null = null;

  private readonly raycaster = new THREE.Raycaster();
  private readonly obstacleMeshes: THREE.Object3D[] = [];
  private readonly patrolWaypoints: THREE.Vector3[] = [];
  private readonly tracers: BotTracer[] = [];
  private readonly tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 6, 1, true);
  private readonly upAxis = new THREE.Vector3(0, 1, 0);
  private readonly tmpQuat = new THREE.Quaternion();

  private readonly playerTarget: CombatantTarget = {
    id: 'player',
    name: 'YOU',
    isPlayer: true,
    alive: true,
    position: new THREE.Vector3(),
    eyePosition: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
  };

  playerHealth = 100;
  readonly playerMaxHealth = 100;
  playerGodMode = false;

  constructor(
    private readonly worldScene: THREE.Scene,
    private readonly collisionWorld: CollisionWorld,
    private readonly lootDrops: LootDropManager,
    private readonly audio: AudioManager,
    readonly spawnSystem: SpawnSystem,
  ) {}

  setObstacleMeshes(meshes: THREE.Object3D[]): void {
    this.obstacleMeshes.length = 0;
    this.obstacleMeshes.push(...meshes);
  }

  setPatrolWaypoints(waypoints: THREE.Vector3[]): void {
    this.patrolWaypoints.length = 0;
    this.patrolWaypoints.push(...waypoints);
  }

  getBotHitboxObjects(): THREE.Object3D[] {
    return this.bots.map((b) => b.hitboxGroup);
  }

  getLivingCombatants(): CombatantTarget[] {
    const list: CombatantTarget[] = [];
    if (this.playerHealth > 0) list.push(this.playerTarget);
    for (const b of this.bots) {
      if (b.alive) list.push(b);
    }
    return list;
  }

  /**
   * Computes the Non-Duplicate Weighting Table across the 8 military weapons,
   * counting the player's current primary weapon and all living bots' primary weapons.
   */
  getLoadoutWeightTable(playerPrimaryId: WeaponId, excludeBot?: BotAgent): LoadoutWeightEntry[] {
    const counts = new Map<WeaponId, number>();
    for (const id of PRIMARY_ORDER) counts.set(id, 0);

    counts.set(playerPrimaryId, (counts.get(playerPrimaryId) ?? 0) + 1);

    for (const b of this.bots) {
      if (b === excludeBot || !b.alive) continue;
      counts.set(b.primaryWeaponId, (counts.get(b.primaryWeaponId) ?? 0) + 1);
    }

    let minCount = Infinity;
    for (const c of counts.values()) {
      if (c < minCount) minCount = c;
    }

    return PRIMARY_ORDER.map((weaponId) => {
      const activeCount = counts.get(weaponId) ?? 0;
      const delta = activeCount - minCount;
      const weight = delta === 0 ? 100 / Math.pow(activeCount + 1, 2) : 0.5 / Math.pow(delta + 1, 4);
      return { weaponId, activeCount, weight };
    });
  }

  /**
   * Samples a primary weapon using the Non-Duplicate Weighting Table.
   */
  selectNonDuplicateWeapon(playerPrimaryId: WeaponId, excludeBot?: BotAgent): WeaponId {
    const table = this.getLoadoutWeightTable(playerPrimaryId, excludeBot);
    const minCount = Math.min(...table.map((e) => e.activeCount));
    const leastUsed = table.filter((e) => e.activeCount === minCount);

    let totalWeight = 0;
    for (const entry of leastUsed) totalWeight += entry.weight;
    let r = Math.random() * totalWeight;
    for (const entry of leastUsed) {
      r -= entry.weight;
      if (r <= 0) return entry.weaponId;
    }
    return leastUsed[0].weaponId;
  }

  /**
   * Selects a safe spawn node for the Human Player via SpawnSystem and grants 1.5s spawn protection.
   */
  selectPlayerSpawn(): SpawnNodeScore {
    return this.spawnSystem.selectSpawnNode(
      'player',
      this.getLivingCombatants(),
      this.obstacleMeshes,
    );
  }

  /**
   * Selects a safe spawn node for a Bot via SpawnSystem and grants 1.5s spawn protection.
   */
  selectSafeSpawnForBot(bot: BotAgent): SpawnNodeScore {
    return this.spawnSystem.selectSpawnNode(
      bot.id,
      this.getLivingCombatants(),
      this.obstacleMeshes,
    );
  }

  /**
   * Configures active bot pool size (clamped 3..15, default 7).
   */
  setBotCount(count: number, playerPrimaryId: WeaponId, _playerPos: THREE.Vector3): void {
    const clamped = THREE.MathUtils.clamp(Math.round(count), 3, 15);
    this.targetBotCount = clamped;

    while (this.bots.length > clamped) {
      const removed = this.bots.pop()!;
      removed.dispose(this.worldScene);
    }

    while (this.bots.length < clamped) {
      const idx = this.bots.length;
      const id = `bot_${idx + 1}`;
      const callsign = CALLSIGNS[idx % CALLSIGNS.length];
      const weaponId = this.selectNonDuplicateWeapon(playerPrimaryId);
      const tier: BotDifficulty =
        this.difficulty === 'mixed' ? MIXED_TIERS[idx % MIXED_TIERS.length] : this.difficulty;
      const bot = new BotAgent(id, callsign, weaponId, tier, this.worldScene);
      bot.isSpawnProtected = () => this.spawnSystem.isProtected(bot.id);

      this.wireBotCallbacks(bot, () => playerPrimaryId);

      const chosen = this.selectSafeSpawnForBot(bot);
      bot.spawnAt(chosen.node.position, chosen.node.yaw, weaponId, this.patrolWaypoints);
      this.bots.push(bot);
    }

    this.onShootablesChanged?.();
  }

  setDifficulty(diff: BotDifficultySetting): void {
    this.difficulty = diff;
    this.bots.forEach((b, idx) => {
      const tier: BotDifficulty =
        diff === 'mixed' ? MIXED_TIERS[idx % MIXED_TIERS.length] : diff;
      b.setDifficulty(tier);
    });
  }

  /**
   * Resets all bots with fresh Non-Duplicate loadouts, zeroed scoreboard stats, and anti-spawn-trap positions.
   */
  resetMatch(playerPrimaryId: WeaponId, playerPos: THREE.Vector3): void {
    this.clearFX();
    this.playerHealth = this.playerMaxHealth;
    this.playerTarget.alive = true;
    this.playerTarget.position.copy(playerPos);
    this.playerTarget.eyePosition.set(playerPos.x, playerPos.y + 1.62, playerPos.z);
    this.spawnSystem.grantSpawnProtection('player', 1.5);

    // Temporarily mark all bots dead so non-duplicate assignment & incremental spawn scoring start clean
    for (const b of this.bots) {
      b.alive = false;
      b.resetStats();
    }

    this.bots.forEach((b, idx) => {
      const tier: BotDifficulty =
        this.difficulty === 'mixed' ? MIXED_TIERS[idx % MIXED_TIERS.length] : this.difficulty;
      b.setDifficulty(tier);
      const weaponId = this.selectNonDuplicateWeapon(playerPrimaryId, b);
      const chosen = this.selectSafeSpawnForBot(b);
      b.spawnAt(chosen.node.position, chosen.node.yaw, weaponId, this.patrolWaypoints);
      b.hitboxGroup.userData.onBulletHit = (dmg: number, zone: HitZone): boolean => {
        return b.applyDamage('player', playerPrimaryId, dmg, zone);
      };
    });

    this.onShootablesChanged?.();
  }

  /**
   * Broadcasts player gunfire to all bots within 35m AND immediately removes player's 1.5s spawn protection.
   */
  notifyPlayerGunfire(playerPos: THREE.Vector3, playerPrimaryOrActiveId: WeaponId): void {
    this.spawnSystem.onCombatantFired('player');
    const nowSec = performance.now() * 0.001;
    for (const b of this.bots) {
      b.hitboxGroup.userData.onBulletHit = (dmg: number, zone: HitZone): boolean => {
        return b.applyDamage('player', playerPrimaryOrActiveId, dmg, zone);
      };
      b.notifyGunfireAudio('player', playerPos, nowSec);
    }
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    playerEyePos: THREE.Vector3,
    playerVel: THREE.Vector3,
    playerPrimaryId: WeaponId,
    playerEquippedId: WeaponId,
  ): void {
    const nowSec = performance.now() * 0.001;
    this.spawnSystem.update(dt);

    this.playerTarget.position.copy(playerPos);
    this.playerTarget.eyePosition.copy(playerEyePos);
    this.playerTarget.velocity.copy(playerVel);
    this.playerTarget.alive = this.playerHealth > 0;

    for (const b of this.bots) {
      b.hitboxGroup.userData.onBulletHit = (dmg: number, zone: HitZone): boolean => {
        return b.applyDamage('player', playerEquippedId, dmg, zone);
      };
    }

    const allCombatants: CombatantTarget[] = [this.playerTarget, ...this.bots];

    for (const bot of this.bots) {
      if (!bot.alive) {
        bot.respawnTimer -= dt;
        if (bot.respawnTimer <= 0) {
          const newWeapon = this.selectNonDuplicateWeapon(playerPrimaryId, bot);
          const chosen = this.selectSafeSpawnForBot(bot);
          bot.spawnAt(chosen.node.position, chosen.node.yaw, newWeapon, this.patrolWaypoints);
        }
        continue;
      }

      bot.update(
        dt,
        nowSec,
        allCombatants,
        this.obstacleMeshes,
        this.collisionWorld,
        this.patrolWaypoints,
        this.raycaster,
        (shot) => this.handleBotShot(shot, nowSec, playerPos),
      );
    }

    this.updateTracers(dt);
  }

  private wireBotCallbacks(bot: BotAgent, getPlayerPrimary: () => WeaponId): void {
    bot.onFootstep = (pos, intensity) => {
      this.audio.playSpatialFootstep(pos.x, pos.y, pos.z, intensity);
    };

    bot.onKilled = (killerId, weaponId, zone) => {
      bot.deaths++;
      const dropWeaponId = bot.primaryWeaponId;
      const dropDef = WEAPONS[dropWeaponId];
      const dropMag = Math.max(1, bot.primaryMag);
      const dropReserve = Math.min(bot.primaryReserve, dropDef.ammo.magSize);

      const dropPos = new THREE.Vector3(
        bot.position.x,
        bot.position.y + 1.05,
        bot.position.z,
      );
      const dropVel = new THREE.Vector3(
        (Math.random() - 0.5) * 2.2,
        2.6,
        (Math.random() - 0.5) * 2.2,
      );
      this.lootDrops.spawnWeaponDrop(dropWeaponId, dropMag, dropReserve, dropPos, dropVel);

      const killerIsPlayer = killerId === 'player';
      const killerBot = this.bots.find((b) => b.id === killerId);
      if (killerBot) {
        killerBot.kills++;
        if (zone === 'head') killerBot.headshotKills++;
      }
      const killerName = killerIsPlayer ? 'YOU' : killerBot ? killerBot.name : 'BOT';

      this.onKillFeed?.({
        killerId,
        killerName,
        killerIsPlayer,
        victimId: bot.id,
        victimName: bot.name,
        victimIsPlayer: false,
        weaponDef: WEAPONS[weaponId] ?? WEAPONS[getPlayerPrimary()],
        headshot: zone === 'head',
      });
    };
  }

  private handleBotShot(shot: BotShotEvent, nowSec: number, playerPos: THREE.Vector3): void {
    // Firing immediately removes the bot's 1.5s spawn protection
    this.spawnSystem.onCombatantFired(shot.bot.id);

    for (const other of this.bots) {
      if (other !== shot.bot) {
        other.notifyGunfireAudio(shot.bot.id, shot.bot.position, nowSec);
      }
    }

    // 3D Spatialized stereo gunfire
    this.audio.playSpatialShot(
      shot.weaponDef.fx.sound,
      shot.bot.position.x,
      shot.bot.position.y + 1.4,
      shot.bot.position.z,
      65,
    );

    this.spawnBotTracer(shot.muzzleWorld, shot.endPoint, shot.weaponDef.fx.tracerColor);

    if (!shot.hitTargetId || !shot.hitZone || shot.damage <= 0) return;

    if (shot.hitTargetId === 'player') {
      if (!this.playerTarget.alive) return;
      // Check player 1.5s spawn protection
      if (this.spawnSystem.isProtected('player')) return;

      const scaledDmg = Math.max(2, Math.round(shot.damage * 0.38));
      if (!this.playerGodMode) {
        this.playerHealth = Math.max(0, this.playerHealth - scaledDmg);
      }
      const killed = !this.playerGodMode && this.playerHealth <= 0;
      const distToPlayer = shot.bot.position.distanceTo(playerPos);

      if (killed) {
        shot.bot.kills++;
        if (shot.hitZone === 'head') shot.bot.headshotKills++;
      }

      const detail: PlayerDamageEvent = {
        damage: scaledDmg,
        attackerId: shot.bot.id,
        attackerName: shot.bot.name,
        attackerPos: shot.bot.position.clone(),
        attackerEyePos: shot.bot.eyePosition.clone(),
        weaponDef: shot.weaponDef,
        distance: distToPlayer,
        killed,
      };
      this.onPlayerDamaged?.(scaledDmg, shot.bot.position, shot.weaponDef, killed, detail);

      if (killed) {
        this.playerTarget.alive = false;
        this.onKillFeed?.({
          killerId: shot.bot.id,
          killerName: shot.bot.name,
          killerIsPlayer: false,
          victimId: 'player',
          victimName: 'YOU',
          victimIsPlayer: true,
          weaponDef: shot.weaponDef,
          headshot: shot.hitZone === 'head',
        });
      }
    } else {
      const victimBot = this.bots.find((b) => b.id === shot.hitTargetId);
      if (victimBot && victimBot.alive) {
        victimBot.applyDamage(shot.bot.id, shot.weaponDef.id, shot.damage, shot.hitZone);
      }
    }
  }

  private spawnBotTracer(start: THREE.Vector3, end: THREE.Vector3, rgb: [number, number, number]): void {
    const delta = new THREE.Vector3().subVectors(end, start);
    const len = delta.length();
    if (len < 0.6) return;
    const dir = delta.multiplyScalar(1 / len);

    const segLen = Math.min(len, 30);
    const mid = new THREE.Vector3().copy(start).addScaledVector(dir, segLen * 0.5);

    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(rgb[0] * 3.8, rgb[1] * 3.8, rgb[2] * 3.8),
      transparent: true,
      opacity: 0.85,
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

  clearFX(): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      this.worldScene.remove(tr.mesh);
      tr.mat.dispose();
    }
    this.tracers.length = 0;
  }

  private updateTracers(dt: number): void {
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
  }
}
