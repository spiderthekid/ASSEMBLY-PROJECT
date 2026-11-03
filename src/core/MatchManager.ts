import * as THREE from 'three';
import { WEAPONS, type WeaponId, type WeaponDef } from '../weapons/WeaponDatabase';
import type { BotDirector, BotDifficultySetting, PlayerDamageEvent } from '../ai/BotDirector';
import type { MapRegistry } from './MapRegistry';
import type { MapId, MapMetadata } from '../maps/MapAssets';

export type VictoryKillTarget = 15 | 30 | 50 | 0; // 0 = Endless Survival

export type MatchPhase = 'lobby' | 'playing' | 'death_cam' | 'post_match';
export type MatchOutcome = 'in_progress' | 'permadeath_kia' | 'victory_target_reached';

export interface SandboxConfig {
  startingPrimary: WeaponId;
  botCount: number;
  botDifficulty: BotDifficultySetting;
  victoryKillTarget: VictoryKillTarget;
}

export interface KillerTelemetry {
  killerId: string;
  killerName: string;
  weaponId: WeaponId;
  weaponName: string;
  weaponShortName: string;
  distanceMeters: number;
  killerEyePos: THREE.Vector3;
}

export interface ScoreboardEntry {
  id: string;
  name: string;
  isPlayer: boolean;
  roleLabel: string;
  weaponShortName: string;
  kills: number;
  deaths: number;
  headshots: number;
  kdRatio: string;
  alive: boolean;
}

export interface MatchStatsSummary {
  outcome: MatchOutcome;
  mapMeta: MapMetadata;
  nextPlaylistMapMeta: MapMetadata;
  survivalTimeSec: number;
  totalKills: number;
  victoryKillTarget: VictoryKillTarget;
  shotsFired: number;
  shotsHit: number;
  headshotHits: number;
  accuracyPct: number;
  headshotPct: number;
  weaponsScavenged: number;
  killerInfo: KillerTelemetry | null;
  scoreboard: ScoreboardEntry[];
}

export const DEATH_CAM_DURATION_SEC = 1.2;
export const DEATH_CAM_TIME_SCALE = 0.28;

export class MatchManager {
  phase: MatchPhase = 'lobby';
  outcome: MatchOutcome = 'in_progress';

  readonly config: SandboxConfig = {
    startingPrimary: 'm4a1_sopmod',
    botCount: 7,
    botDifficulty: 'regular',
    victoryKillTarget: 15,
  };

  // Run telemetry counters
  survivalTimeSec = 0;
  totalKills = 0;
  shotsFired = 0;
  shotsHit = 0;
  headshotHits = 0;
  weaponsScavenged = 0;
  playerDeaths = 0;

  // 1.2s Slow-Motion Death Camera state
  deathCamTimer = 0;
  deathCamProgress = 0;
  killerInfo: KillerTelemetry | null = null;
  private readonly deathStartEye = new THREE.Vector3();
  private readonly deathLookTarget = new THREE.Vector3();
  private readonly tmpCamPos = new THREE.Vector3();

  onPhaseChanged: ((phase: MatchPhase, summary: MatchStatsSummary) => void) | null = null;

  constructor(
    private readonly mapRegistry: MapRegistry,
    private readonly botDirector: BotDirector,
    private readonly onLoadMapAndReset: (mapId: MapId, config: SandboxConfig) => void,
  ) {}

  get timeScale(): number {
    if (this.phase === 'death_cam') return DEATH_CAM_TIME_SCALE;
    return 1.0;
  }

  get accuracyPct(): number {
    if (this.shotsFired <= 0) return 0;
    return Math.min(100, (this.shotsHit / this.shotsFired) * 100);
  }

  get headshotPct(): number {
    if (this.shotsHit <= 0) return 0;
    return Math.min(100, (this.headshotHits / this.shotsHit) * 100);
  }

  resetTelemetry(): void {
    this.survivalTimeSec = 0;
    this.totalKills = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.headshotHits = 0;
    this.weaponsScavenged = 0;
    this.playerDeaths = 0;
    this.deathCamTimer = 0;
    this.deathCamProgress = 0;
    this.killerInfo = null;
    this.outcome = 'in_progress';
  }

  recordPlayerShotFired(_def: WeaponDef): void {
    if (this.phase !== 'playing') return;
    this.shotsFired++;
  }

  recordPlayerHit(zone: 'head' | 'body' | 'limb', killed: boolean): void {
    if (this.phase !== 'playing') return;
    this.shotsHit++;
    if (zone === 'head') {
      this.headshotHits++;
    }
    if (killed) {
      this.totalKills++;
      this.checkVictoryTarget();
    }
  }

  recordWeaponScavenged(): void {
    if (this.phase !== 'playing') return;
    this.weaponsScavenged++;
  }

  private checkVictoryTarget(): void {
    if (
      this.phase === 'playing' &&
      this.config.victoryKillTarget > 0 &&
      this.totalKills >= this.config.victoryKillTarget
    ) {
      this.outcome = 'victory_target_reached';
      this.phase = 'post_match';
      this.onPhaseChanged?.(this.phase, this.getSummary());
    }
  }

  /**
   * Triggered immediately when Player.health <= 0 (Permadeath).
   * Starts the 1.2-second slow-motion death camera focusing on the killer bot.
   */
  notifyPlayerKilled(playerEyePos: THREE.Vector3, detail?: PlayerDamageEvent): void {
    if (this.phase !== 'playing') return;
    this.playerDeaths = 1;
    this.outcome = 'permadeath_kia';
    this.phase = 'death_cam';
    this.deathCamTimer = DEATH_CAM_DURATION_SEC;
    this.deathCamProgress = 0;
    this.deathStartEye.copy(playerEyePos);

    if (detail) {
      this.killerInfo = {
        killerId: detail.attackerId,
        killerName: detail.attackerName,
        weaponId: detail.weaponDef.id,
        weaponName: detail.weaponDef.name,
        weaponShortName: detail.weaponDef.shortName,
        distanceMeters: detail.distance,
        killerEyePos: detail.attackerEyePos.clone(),
      };
      this.deathLookTarget.copy(detail.attackerEyePos);
    } else {
      // Fallback if killed via direct test call without attacker detail
      const firstBot = this.botDirector.bots.find((b) => b.alive) ?? this.botDirector.bots[0];
      const wep = firstBot ? WEAPONS[firstBot.equippedWeaponId] : WEAPONS.m4a1_sopmod;
      const dist = firstBot ? firstBot.position.distanceTo(playerEyePos) : 18.0;
      const eye = firstBot
        ? firstBot.eyePosition.clone()
        : playerEyePos.clone().add(new THREE.Vector3(0, 0, -10));
      this.killerInfo = {
        killerId: firstBot?.id ?? 'bot_1',
        killerName: firstBot?.name ?? 'VANGUARD-1',
        weaponId: wep.id,
        weaponName: wep.name,
        weaponShortName: wep.shortName,
        distanceMeters: dist,
        killerEyePos: eye,
      };
      this.deathLookTarget.copy(eye);
    }

    this.onPhaseChanged?.(this.phase, this.getSummary());
  }

  /**
   * Updates match timers and the 1.2s slow-motion death camera.
   * Uses `rawDt` (unscaled wall-clock delta) for the 1.2s death camera countdown.
   */
  update(rawDt: number, worldCamera: THREE.PerspectiveCamera, playerEyePos: THREE.Vector3): void {
    if (this.phase === 'playing') {
      this.survivalTimeSec += rawDt;
      if (this.botDirector.playerHealth <= 0) {
        this.notifyPlayerKilled(playerEyePos);
      }
      return;
    }

    if (this.phase === 'death_cam') {
      this.deathCamTimer = Math.max(0, this.deathCamTimer - rawDt);
      this.deathCamProgress = THREE.MathUtils.clamp(
        1 - this.deathCamTimer / DEATH_CAM_DURATION_SEC,
        0,
        1,
      );

      // Track live killer bot eye position if still alive
      if (this.killerInfo) {
        const liveBot = this.botDirector.bots.find((b) => b.id === this.killerInfo!.killerId);
        if (liveBot) {
          this.killerInfo.killerEyePos.copy(liveBot.eyePosition);
          this.killerInfo.distanceMeters = liveBot.position.distanceTo(this.deathStartEye);
        }
        this.deathLookTarget.lerp(this.killerInfo.killerEyePos, Math.min(1, rawDt * 12));
      }

      // Smoothly elevate & pull camera slightly back while focusing directly on killer bot
      const ease = 1 - Math.pow(1 - this.deathCamProgress, 3);
      const toKiller = new THREE.Vector3().subVectors(this.deathLookTarget, this.deathStartEye);
      const dist = toKiller.length();
      if (dist > 0.2) {
        toKiller.normalize();
        const pullDist = Math.min(dist * 0.32, 4.5) * ease;
        this.tmpCamPos
          .copy(this.deathStartEye)
          .addScaledVector(toKiller, pullDist)
          .add(new THREE.Vector3(0, 0.35 * ease, 0));
        worldCamera.position.copy(this.tmpCamPos);
      }
      worldCamera.lookAt(this.deathLookTarget);

      if (this.deathCamTimer <= 0) {
        this.phase = 'post_match';
        this.onPhaseChanged?.(this.phase, this.getSummary());
      }
    }
  }

  /**
   * Builds the full Free-For-All Scoreboard (Human Player + all active AI Bots).
   */
  buildScoreboard(playerPrimaryId: WeaponId): ScoreboardEntry[] {
    const entries: ScoreboardEntry[] = [];

    const playerKd =
      this.playerDeaths > 0
        ? (this.totalKills / this.playerDeaths).toFixed(2)
        : this.totalKills.toFixed(2);
    entries.push({
      id: 'player',
      name: 'YOU (OPERATOR)',
      isPlayer: true,
      roleLabel: 'HUMAN // 1-LIFE',
      weaponShortName: WEAPONS[playerPrimaryId].shortName,
      kills: this.totalKills,
      deaths: this.playerDeaths,
      headshots: this.headshotHits,
      kdRatio: playerKd,
      alive: this.botDirector.playerHealth > 0,
    });

    for (const b of this.botDirector.bots) {
      const kd = b.deaths > 0 ? (b.kills / b.deaths).toFixed(2) : b.kills.toFixed(2);
      entries.push({
        id: b.id,
        name: b.name,
        isPlayer: false,
        roleLabel: `${b.difficulty.label.toUpperCase()} // ${b.combatRole.replace('_', ' ').toUpperCase()}`,
        weaponShortName: WEAPONS[b.primaryWeaponId].shortName,
        kills: b.kills,
        deaths: b.deaths,
        headshots: b.headshotKills,
        kdRatio: kd,
        alive: b.alive,
      });
    }

    entries.sort((a, b) => {
      if (b.kills !== a.kills) return b.kills - a.kills;
      return a.deaths - b.deaths;
    });

    return entries;
  }

  getSummary(): MatchStatsSummary {
    return {
      outcome: this.outcome,
      mapMeta: this.mapRegistry.currentMeta,
      nextPlaylistMapMeta: this.mapRegistry.peekNextMap(),
      survivalTimeSec: this.survivalTimeSec,
      totalKills: this.totalKills,
      victoryKillTarget: this.config.victoryKillTarget,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      headshotHits: this.headshotHits,
      accuracyPct: this.accuracyPct,
      headshotPct: this.headshotPct,
      weaponsScavenged: this.weaponsScavenged,
      killerInfo: this.killerInfo,
      scoreboard: this.buildScoreboard(this.config.startingPrimary),
    };
  }

  // ===========================================================================
  // Zero-Friction Deployment & Map Cycling Actions
  // ===========================================================================

  /**
   * Starts a new run from the Sandbox Pre-Match Lobby using the selected Map Selection Mode.
   */
  deployFromLobby(): void {
    const targetMap = this.mapRegistry.resolveInitialLobbyMap();
    this.startRunOnMap(targetMap.id);
  }

  /**
   * `[SPACEBAR]` on End-of-Run screen: Deploy to Next Map in Pre-Chosen Playlist Queue.
   */
  deployNextPlaylistMap(): MapMetadata {
    const nextMeta = this.mapRegistry.advanceToNextMap();
    this.startRunOnMap(nextMeta.id);
    return nextMeta;
  }

  /**
   * `[R]` on End-of-Run screen: Deploy to Random Map (strictly different from current map).
   */
  deployRandomMap(): MapMetadata {
    const randMeta = this.mapRegistry.advanceToRandomMap();
    this.startRunOnMap(randMeta.id);
    return randMeta;
  }

  /**
   * `[T]` on End-of-Run screen (or in-game): Instant Rematch on Current Map (0.2s state reset).
   */
  instantRematchCurrentMap(): MapMetadata {
    const curMeta = this.mapRegistry.currentMeta;
    this.startRunOnMap(curMeta.id);
    return curMeta;
  }

  /**
   * `[ESC]` on End-of-Run screen: Return to Sandbox Pre-Match Lobby.
   */
  returnToSandboxLobby(): void {
    this.phase = 'lobby';
    this.outcome = 'in_progress';
    this.onPhaseChanged?.(this.phase, this.getSummary());
  }

  startRunOnMap(mapId: MapId): void {
    this.resetTelemetry();
    this.phase = 'playing';
    this.outcome = 'in_progress';
    this.onLoadMapAndReset(mapId, this.config);
    this.onPhaseChanged?.(this.phase, this.getSummary());
  }
}
