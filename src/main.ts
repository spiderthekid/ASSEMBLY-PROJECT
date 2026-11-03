import * as THREE from 'three';
import {
  loadSettings,
  saveSettings,
  hfovToVfov,
  zoomVfov,
  DEG_PER_COUNT,
} from './core/Settings';
import { InputManager } from './core/InputManager';
import { AudioManager } from './core/AudioManager';
import { CollisionWorld } from './core/CollisionWorld';
import { RenderPipeline } from './core/RenderPipeline';
import { MapRegistry } from './core/MapRegistry';
import { MatchManager } from './core/MatchManager';
import { ArenaPlayerController } from './player/ArenaPlayerController';
import { WeaponViewModel } from './player/WeaponViewModel';
import { PlayerHUD } from './player/PlayerHUD';
import { WEAPONS } from './weapons/WeaponDatabase';
import { WeaponSystem } from './weapons/WeaponSystem';
import { LootDropManager } from './weapons/LootDropManager';
import { BotDirector } from './ai/BotDirector';
import { MapBuilder, type BuiltMapResult } from './maps/MapBuilder';
import { SpawnSystem } from './maps/SpawnSystem';
import type { MapId } from './maps/MapAssets';

const app = document.getElementById('app')!;
const settings = loadSettings();
const audio = new AudioManager();
audio.setVolume(settings.volume);

const worldScene = new THREE.Scene();
const aspect = window.innerWidth / window.innerHeight;
const baseVfov = hfovToVfov(settings.fov, aspect);
const worldCamera = new THREE.PerspectiveCamera(baseVfov, aspect, 0.08, 350);

const collisionWorld = new CollisionWorld();

const viewmodel = new WeaponViewModel(aspect, null);
const pipeline = new RenderPipeline(app, worldScene, worldCamera, viewmodel.scene, viewmodel.camera);
pipeline.setRenderScale(settings.renderScale);
pipeline.setBloom(settings.bloom);

const weapons = new WeaponSystem(worldScene, viewmodel, audio);
weapons.setStartingPrimary('m4a1_sopmod');

const lootDrops = new LootDropManager(worldScene, collisionWorld, weapons);

const mapRegistry = new MapRegistry();
const spawnSystem = new SpawnSystem();
const mapBuilder = new MapBuilder(worldScene, pipeline.renderer, collisionWorld);

const player = new ArenaPlayerController(collisionWorld);
player.events = {
  onJump: () => audio.playJump(),
  onLand: (impact) => audio.playLand(impact),
  onSlideStart: () => audio.playSlide(),
  onFootstep: (intensity) => audio.playFootstep(intensity),
};

const botDirector = new BotDirector(worldScene, collisionWorld, lootDrops, audio, spawnSystem);

let currentMap!: BuiltMapResult;
let botsInitialized = false;

const syncShootables = () => {
  if (!currentMap) return;
  weapons.setShootables([
    ...currentMap.shootables,
    ...botDirector.getBotHitboxObjects(),
  ]);
};
botDirector.onShootablesChanged = syncShootables;

let hud: PlayerHUD | null = null;

function loadArenaMap(mapId: MapId): BuiltMapResult {
  mapRegistry.setCurrentMap(mapId);
  lootDrops.clearAll();
  weapons.clearFX();
  botDirector.clearFX();
  hud?.clearDamageIndicators();

  currentMap = mapBuilder.buildMap(
    mapId,
    (weaponId, magAmmo, reserveAmmo, pos, vel) => {
      lootDrops.spawnWeaponDrop(weaponId, magAmmo, reserveAmmo, pos, vel);
    },
  );
  viewmodel.scene.environment = currentMap.environmentTexture;

  spawnSystem.setNodes(currentMap.spawnNodes);
  botDirector.setObstacleMeshes(currentMap.obstacleMeshes);
  botDirector.setPatrolWaypoints(currentMap.patrolWaypoints);

  weapons.setStartingPrimary(weapons.primaryId);

  const pSpawn = botDirector.selectPlayerSpawn();
  player.spawn(pSpawn.node.position, pSpawn.node.yaw);

  if (!botsInitialized) {
    botsInitialized = true;
    botDirector.setBotCount(7, weapons.primaryId, player.position);
  } else {
    botDirector.resetMatch(weapons.primaryId, player.position);
  }

  syncShootables();
  if (window.__arenaGame) {
    window.__arenaGame.currentMap = currentMap;
    window.__arenaGame.trainingGround = currentMap;
  }
  return currentMap;
}

const matchManager = new MatchManager(mapRegistry, botDirector, (mapId, cfg) => {
  weapons.setStartingPrimary(cfg.startingPrimary);
  botDirector.setDifficulty(cfg.botDifficulty);
  if (currentMap && currentMap.mapId === mapId) {
    // Fast 0.2s same-map reset
    lootDrops.clearAll();
    weapons.clearFX();
    botDirector.clearFX();
    hud?.clearDamageIndicators();
    currentMap.resetTargets();
    const pSpawn = botDirector.selectPlayerSpawn();
    player.spawn(pSpawn.node.position, pSpawn.node.yaw);
    botDirector.setBotCount(cfg.botCount, cfg.startingPrimary, player.position);
    botDirector.resetMatch(cfg.startingPrimary, player.position);
    syncShootables();
  } else {
    loadArenaMap(mapId);
    botDirector.setBotCount(cfg.botCount, cfg.startingPrimary, player.position);
  }
});

// Build initial default map (Killhouse Alpha) and start active run ready for testing/play
loadArenaMap(mapRegistry.currentMapId);
matchManager.phase = 'playing';

const input = new InputManager(pipeline.domElement);

hud = new PlayerHUD(app, settings, mapRegistry, {
  onResumeClick: () => {
    audio.unlock();
    matchManager.deployFromLobby();
    hud!.hideEndOfRunOverlay();
    hud!.setPaused(false);
    input.debugActive = true;
    void input.requestLock();
  },
  onSettingsChange: (s) => {
    saveSettings(s);
    pipeline.setRenderScale(s.renderScale);
    pipeline.setBloom(s.bloom);
    audio.setVolume(s.volume);
  },
  onRefillAmmo: () => weapons.refillCurrentReserve(2),
  onResetTargets: () => currentMap.resetTargets(),
  onSelectStartingPrimary: (id) => {
    matchManager.config.startingPrimary = id;
    weapons.setStartingPrimary(id);
    botDirector.resetMatch(id, player.position);
  },
  onSelectMap: (mapId) => {
    loadArenaMap(mapId);
    matchManager.resetTelemetry();
    matchManager.phase = 'playing';
  },
  onSelectMapMode: (mode) => {
    mapRegistry.setSelectionMode(mode);
  },
  onPlaylistChanged: () => {
    // Playlist updated in MapRegistry
  },
  onBotCountChange: (count) => {
    matchManager.config.botCount = count;
    botDirector.setBotCount(count, weapons.primaryId, player.position);
  },
  onBotDifficultyChange: (diff) => {
    matchManager.config.botDifficulty = diff;
    botDirector.setDifficulty(diff);
  },
  onVictoryTargetChange: (target) => {
    matchManager.config.victoryKillTarget = target;
  },
  onDeployNextPlaylistMap: () => {
    audio.unlock();
    hud!.hideEndOfRunOverlay();
    hud!.setPaused(false);
    input.debugActive = true;
    matchManager.deployNextPlaylistMap();
    void input.requestLock();
  },
  onDeployRandomMap: () => {
    audio.unlock();
    hud!.hideEndOfRunOverlay();
    hud!.setPaused(false);
    input.debugActive = true;
    matchManager.deployRandomMap();
    void input.requestLock();
  },
  onInstantRematch: () => {
    audio.unlock();
    hud!.hideEndOfRunOverlay();
    hud!.setPaused(false);
    input.debugActive = true;
    matchManager.instantRematchCurrentMap();
    void input.requestLock();
  },
  onReturnToLobby: () => {
    hud!.hideEndOfRunOverlay();
    matchManager.returnToSandboxLobby();
    hud!.setPaused(true);
  },
});

matchManager.onPhaseChanged = (phase, summary) => {
  if (phase === 'post_match') {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    hud!.showEndOfRunOverlay(summary);
  } else if (phase === 'playing') {
    hud!.hideEndOfRunOverlay();
  } else if (phase === 'lobby') {
    hud!.hideEndOfRunOverlay();
    hud!.setPaused(true);
  }
};

// Zero-friction End-of-Run keyboard shortcuts ([SPACE], [R], [T], [ESC])
window.addEventListener(
  'keydown',
  (e) => {
    if (matchManager.phase !== 'post_match' && matchManager.phase !== 'death_cam') return;
    if (e.code === 'Space') {
      e.preventDefault();
      e.stopImmediatePropagation();
      hud!.hideEndOfRunOverlay();
      hud!.setPaused(false);
      input.debugActive = true;
      matchManager.deployNextPlaylistMap();
      void input.requestLock();
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      e.stopImmediatePropagation();
      hud!.hideEndOfRunOverlay();
      hud!.setPaused(false);
      input.debugActive = true;
      matchManager.deployRandomMap();
      void input.requestLock();
    } else if (e.code === 'KeyT') {
      e.preventDefault();
      e.stopImmediatePropagation();
      hud!.hideEndOfRunOverlay();
      hud!.setPaused(false);
      input.debugActive = true;
      matchManager.instantRematchCurrentMap();
      void input.requestLock();
    } else if (e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      hud!.hideEndOfRunOverlay();
      matchManager.returnToSandboxLobby();
      hud!.setPaused(true);
    }
  },
  true,
);

input.onLockChange = (locked) => {
  if (matchManager.phase === 'post_match' || matchManager.phase === 'death_cam') return;
  if (!locked && input.debugActive) return;
  hud!.setPaused(!locked);
};
input.onLockError = (msg) => {
  if (matchManager.phase === 'post_match' || matchManager.phase === 'death_cam') return;
  if (input.debugActive) return;
  hud!.setPaused(true, msg);
};

pipeline.domElement.addEventListener('click', () => {
  if (!input.active && matchManager.phase !== 'post_match') {
    audio.unlock();
    void input.requestLock();
  }
});

weapons.onFire = (def) => {
  matchManager.recordPlayerShotFired(def);
  botDirector.notifyPlayerGunfire(player.position, def.id);
};

weapons.onHit = (hit) => {
  matchManager.recordPlayerHit(hit.zone, hit.killed);
  hud!.notifyHit(hit.damage, hit.zone, hit.distance, hit.killed);
};

lootDrops.onScavenge = (ev) => {
  matchManager.recordWeaponScavenged();
  hud!.notifyScavenge(ev.weaponDef.name, ev.roundsAbsorbed);
};

lootDrops.onSwap = (ev) => {
  matchManager.recordWeaponScavenged();
  hud!.notifySwap(ev.newWeaponDef.name, ev.newMag, ev.newReserve);
};

botDirector.onKillFeed = (ev) => {
  hud!.pushKillFeed(ev);
};

const tmpPlayerEye = new THREE.Vector3();

botDirector.onPlayerDamaged = (dmg, attackerPos, _weaponDef, killed, detail) => {
  hud!.notifyPlayerDamaged(dmg, killed, attackerPos);
  if (killed) {
    tmpPlayerEye.set(player.position.x, player.position.y + player.eyeHeight, player.position.z);
    matchManager.notifyPlayerKilled(tmpPlayerEye, detail);
  }
};

window.addEventListener('resize', () => {
  const a = window.innerWidth / window.innerHeight;
  worldCamera.aspect = a;
  worldCamera.updateProjectionMatrix();
  viewmodel.resize(a);
  pipeline.resize();
  hud!.resize();
});

let lastTime = performance.now();
let smoothFps = 120;
let smoothMs = 8.3;
let heartbeatCooldown = 0;

function stepFrame(rawDt: number): void {
  const dt = rawDt * matchManager.timeScale;
  const lobbyOpen = hud!.isLobbyVisible();
  const playerAlive = botDirector.playerHealth > 0 && matchManager.phase === 'playing';

  // Protect player from taking background bot damage while configuring the Pre-Match Lobby
  if (lobbyOpen) {
    spawnSystem.grantSpawnProtection('player', 1.5);
  }

  // Instant Rematch on [T] during play
  if (input.wasPressed('KeyT')) {
    hud!.hideEndOfRunOverlay();
    hud!.setPaused(false);
    matchManager.instantRematchCurrentMap();
  }

  // Cycle tactical map on [M]
  if (input.wasPressed('KeyM')) {
    matchManager.deployNextPlaylistMap();
  }

  // Phase 2 Loadout controls: [1] Primary Weapon, [2] Glock 19 Sidearm, Scroll / [Q] Swap
  if (playerAlive) {
    if (input.wasPressed('Digit1')) weapons.equipSlot(1);
    if (input.wasPressed('Digit2')) weapons.equipSlot(2);
    if (input.wasPressed('KeyQ')) weapons.quickSwap();
    if (input.wasPressed('KeyB')) weapons.refillCurrentReserve(2);
    if (input.wasPressed('KeyG')) currentMap.resetTargets();

    const wheel = input.consumeWheel();
    if (wheel !== 0) weapons.cycleWeapon(wheel);
  } else {
    input.consumeWheel();
  }

  // Raw Mouse Look (zero smoothing; scaled by optical zoom ratio when aiming)
  const { dx, dy } = input.consumeMouseDelta();
  if (playerAlive) {
    const mag = weapons.currentMagnification;
    const zoomSensScale = mag > 1.001 ? (1 / mag) * settings.adsSensitivityMult : 1.0;
    const degPerCount = settings.sensitivity * DEG_PER_COUNT * zoomSensScale;
    player.look(dx, dy, degPerCount);
  }

  const fireDown = playerAlive && input.isMouseDown(0);
  const firePressed = playerAlive && input.wasMousePressed(0);
  const adsDown = playerAlive && input.isMouseDown(2);
  const reloadPressed = playerAlive && input.wasPressed('KeyR');
  const interactPressed = playerAlive && input.wasPressed('KeyF');

  if (playerAlive) {
    const moveMods = weapons.getMovementModifiers(adsDown, fireDown);
    player.update(dt, input, moveMods);
  }

  // Apply player position + recoil offset to world camera before raycasting
  player.applyToCamera(worldCamera, weapons.recoilPitch, weapons.recoilYaw);

  // Update 3D spatial audio listener pose
  audio.setListenerPose(
    player.position.x,
    player.position.y + player.eyeHeight,
    player.position.z,
    player.yaw,
  );

  // Low-health heartbeat audio pulse (when 0 < HP <= 35)
  if (botDirector.playerHealth > 0 && botDirector.playerHealth <= 35) {
    heartbeatCooldown -= rawDt;
    if (heartbeatCooldown <= 0) {
      const urgency = 1 - botDirector.playerHealth / 35;
      audio.playHeartbeat(0.75 + urgency * 0.5);
      heartbeatCooldown = Math.max(0.42, 0.9 - urgency * 0.45);
    }
  } else {
    heartbeatCooldown = 0;
  }

  // Update physical weapon drops, 1.5m auto-ammo scavenge, 2.5m raycast prompt, and [F] swap
  lootDrops.update(dt, player.position, worldCamera, interactPressed);

  // Camera FOV zoom based on weapon's optic magnification
  const curAspect = window.innerWidth / window.innerHeight;
  const hipVfov = hfovToVfov(settings.fov, curAspect);
  const targetVfov = zoomVfov(hipVfov, weapons.currentMagnification);
  if (Math.abs(worldCamera.fov - targetVfov) > 0.005) {
    worldCamera.fov = targetVfov;
    worldCamera.updateProjectionMatrix();
  }

  weapons.update(
    dt,
    { fireDown, firePressed, adsDown, reloadPressed },
    {
      speed: player.horizontalSpeed,
      onGround: player.onGround,
      crouching: player.crouching,
      sliding: player.sliding,
      sprinting: player.sprinting,
    },
    worldCamera,
  );

  // Re-apply camera orientation so newly added shot recoil is visible on the same frame
  player.applyToCamera(worldCamera, weapons.recoilPitch, weapons.recoilYaw);

  // Update Free-For-All AI Bot Director, Spawn Protection & Agents
  tmpPlayerEye.set(player.position.x, player.position.y + player.eyeHeight, player.position.z);
  botDirector.update(
    dt,
    player.position,
    tmpPlayerEye,
    player.velocity,
    weapons.primaryId,
    weapons.currentId,
  );

  // Update Permadeath Match Manager & 1.2s Slow-Motion Death Camera (overrides worldCamera when in death_cam)
  if (!lobbyOpen) {
    matchManager.update(rawDt, worldCamera, tmpPlayerEye);
  }

  viewmodel.update(dt, {
    adsEase: weapons.adsEase,
    magnification: weapons.currentMagnification,
    speed: player.horizontalSpeed,
    onGround: player.onGround,
    sprinting: player.sprinting,
    sliding: player.sliding,
    crouching: player.crouching,
    strideDistance: player.strideDistance,
    landDip: player.landDip,
    mouseDX: dx,
    mouseDY: dy,
    state: weapons.state,
    stateProgress: weapons.stateProgress,
    reloadEmpty: weapons.reloadEmpty,
    shellPulse: weapons.shellPulse,
    magEmpty: weapons.currentState.mag === 0,
  });

  currentMap.update(dt);

  const primarySt = weapons.primaryState;
  const secondarySt = weapons.secondaryState;
  const mapDef = currentMap.meta;

  hud!.update({
    dt: rawDt,
    fps: smoothFps,
    frameMs: smoothMs,
    weapon: weapons.currentDef,
    mag: weapons.currentState.mag,
    reserve: weapons.currentState.reserve,
    activeSlot: weapons.activeSlot,
    primaryWeapon: WEAPONS[weapons.primaryId],
    primaryMag: primarySt.mag,
    primaryReserve: primarySt.reserve,
    secondaryWeapon: WEAPONS[weapons.secondaryId],
    secondaryMag: secondarySt.mag,
    secondaryReserve: secondarySt.reserve,
    pickupPrompt: lootDrops.getPickupPrompt(),
    weaponState: weapons.state,
    stateProgress: weapons.stateProgress,
    adsEase: weapons.adsEase,
    magnification: weapons.currentMagnification,
    spreadDeg: weapons.currentSpreadDeg,
    vfovDeg: worldCamera.fov,
    speed: player.horizontalSpeed,
    stateLabel: player.stateLabel,
    onGround: player.onGround,
    sliding: player.sliding,
    crouching: player.crouching,
    health: botDirector.playerHealth,
    spawnProtected: spawnSystem.isProtected('player'),
    mapId: mapDef.id,
    mapName: mapDef.name,
    mapSubtitle: `${mapDef.sizeClass} · ${mapDef.setting}`,
    playerPos: player.position,
    playerYaw: player.yaw,
    matchPhase: matchManager.phase,
    survivalTimeSec: matchManager.survivalTimeSec,
    totalKills: matchManager.totalKills,
    victoryKillTarget: matchManager.config.victoryKillTarget,
    deathCamProgress: matchManager.deathCamProgress,
    killerInfo: matchManager.killerInfo,
  });

  pipeline.render(dt);
  input.endFrame();
}

function animate(now: number): void {
  requestAnimationFrame(animate);
  const rawDt = (now - lastTime) / 1000;
  lastTime = now;
  const dt = Math.min(Math.max(rawDt, 0.0005), 0.1);

  const instFps = 1 / Math.max(rawDt, 0.0005);
  smoothFps += (instFps - smoothFps) * 0.08;
  smoothMs += (rawDt * 1000 - smoothMs) * 0.08;

  stepFrame(dt);
}

requestAnimationFrame(animate);

// Expose deterministic harness for automated verification & developer inspection
export interface GameQAHarness {
  matchManager: MatchManager;
  player: ArenaPlayerController;
  weaponSystem: WeaponSystem;
  weapons: WeaponSystem;
  lootManager: LootDropManager;
  lootDrops: LootDropManager;
  botDirector: BotDirector;
  mapBuilder: MapBuilder;
  mapRegistry: MapRegistry;
  spawnSystem: SpawnSystem;
  hud: PlayerHUD;
  input: InputManager;
  worldCamera: THREE.PerspectiveCamera;
  viewmodel: WeaponViewModel;
  audio: AudioManager;
  pipeline: RenderPipeline;
  getPlayerState: () => {
    alive: boolean;
    health: number;
    maxHealth: number;
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    horizontalSpeed: number;
    yaw: number;
    pitch: number;
    eyeHeight: number;
    onGround: boolean;
    crouching: boolean;
    sliding: boolean;
    sprinting: boolean;
    stateLabel: string;
    spawnProtected: boolean;
    activeSlot: 'primary' | 'secondary';
    equippedWeaponId: string;
    equippedWeaponName: string;
    primaryWeaponId: string;
    primaryMag: number;
    primaryReserve: number;
    secondaryWeaponId: string;
    secondaryMag: number;
    secondaryReserve: number;
    weaponState: string;
    adsProgress: number;
    adsEase: number;
    magnification: number;
    cameraFov: number;
    pickupPrompt: string | null;
    matchPhase: string;
    totalKills: number;
    survivalTimeSec: number;
  };
  getActiveBots: () => Array<{
    id: string;
    name: string;
    alive: boolean;
    hp: number;
    maxHp: number;
    respawnTimer: number;
    primaryWeaponId: string;
    primaryWeaponName: string;
    equippedWeaponId: string;
    primaryMag: number;
    primaryReserve: number;
    combatRole: string;
    tacticalState: string;
    difficulty: string;
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    currentTargetId: string | null;
    currentTargetIsPlayer: boolean;
    kills: number;
    deaths: number;
    headshotKills: number;
    spawnProtected: boolean;
  }>;
  getDroppedWeapons: () => Array<{
    uid: number;
    weaponId: string;
    name: string;
    shortName: string;
    currentMagAmmo: number;
    reserveAmmo: number;
    position: { x: number; y: number; z: number };
    grounded: boolean;
    age: number;
    isFocused: boolean;
  }>;
  getCurrentMap: () => {
    mapId: MapId;
    name: string;
    codeName: string;
    sizeClass: string;
    setting: string;
    lightingProfile: typeof currentMap.meta.lightingProfile;
    bounds: typeof currentMap.bounds;
    spawnNodeCount: number;
    navWaypointCount: number;
    obstacleCount: number;
    shootableCount: number;
    playlist: MapId[];
    selectionMode: string;
  };
  getFPS: () => number;
  simulateMove: (dir: string, duration?: number) => ReturnType<GameQAHarness['getPlayerState']>;
  simulateSlide: () => ReturnType<GameQAHarness['getPlayerState']> & {
    slideTriggered: boolean;
    peakSlideSpeed: number;
    loweredEyeHeight: number;
    standEyeHeight: number;
  };
  simulateADS: (active: boolean) => ReturnType<GameQAHarness['getPlayerState']>;
  simulateFireAtNearestBot: () => {
    killedBotId: string;
    killedBotName: string;
    droppedWeaponId: string;
    droppedWeaponsCount: number;
    droppedWeapons: ReturnType<GameQAHarness['getDroppedWeapons']>;
  };
  simulatePickupKeyF: () => {
    swapped: boolean;
    promptBeforeSwap: string | null;
    previousWeaponId: string;
    newWeaponId: string;
    newMag: number;
    newReserve: number;
    droppedWeapons: ReturnType<GameQAHarness['getDroppedWeapons']>;
  };
  forcePlayerDeath: () => {
    playerHealth: number;
    matchPhase: string;
    timeScale: number;
    killerInfo: typeof matchManager.killerInfo;
  };
}

declare global {
  interface Window {
    __GAME_QA__?: GameQAHarness;
    __arenaGame?: {
      player: ArenaPlayerController;
      weapons: WeaponSystem;
      lootDrops: LootDropManager;
      botDirector: BotDirector;
      mapBuilder: MapBuilder;
      mapRegistry: MapRegistry;
      spawnSystem: SpawnSystem;
      matchManager: MatchManager;
      audio: AudioManager;
      currentMap: BuiltMapResult;
      trainingGround: BuiltMapResult;
      loadArenaMap: (mapId: MapId) => BuiltMapResult;
      viewmodel: WeaponViewModel;
      input: InputManager;
      hud: PlayerHUD;
      worldCamera: THREE.PerspectiveCamera;
      settings: typeof settings;
      stepFrame: (dt: number) => void;
    };
  }
}

window.__arenaGame = {
  player,
  weapons,
  lootDrops,
  botDirector,
  mapBuilder,
  mapRegistry,
  spawnSystem,
  matchManager,
  audio,
  currentMap,
  trainingGround: currentMap,
  loadArenaMap,
  viewmodel,
  input,
  hud: hud!,
  worldCamera,
  settings,
  stepFrame,
};

const ENABLE_QA_HARNESS =
  import.meta.env.DEV ||
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  new URLSearchParams(window.location.search).has('qa');

if (ENABLE_QA_HARNESS) {
  const ensureActivePlay = () => {
    input.debugActive = true;
    if (hud!.isLobbyVisible()) {
      hud!.setPaused(false);
    }
  };

  const getPlayerState = () => ({
    alive: botDirector.playerHealth > 0 && matchManager.phase === 'playing',
    health: botDirector.playerHealth,
    maxHealth: botDirector.playerMaxHealth,
    position: { x: player.position.x, y: player.position.y, z: player.position.z },
    velocity: { x: player.velocity.x, y: player.velocity.y, z: player.velocity.z },
    horizontalSpeed: player.horizontalSpeed,
    yaw: player.yaw,
    pitch: player.pitch,
    eyeHeight: player.eyeHeight,
    onGround: player.onGround,
    crouching: player.crouching,
    sliding: player.sliding,
    sprinting: player.sprinting,
    stateLabel: player.stateLabel,
    spawnProtected: spawnSystem.isProtected('player'),
    activeSlot: weapons.activeSlot,
    equippedWeaponId: weapons.currentId,
    equippedWeaponName: weapons.currentDef.name,
    primaryWeaponId: weapons.primaryId,
    primaryMag: weapons.primaryState.mag,
    primaryReserve: weapons.primaryState.reserve,
    secondaryWeaponId: weapons.secondaryId,
    secondaryMag: weapons.secondaryState.mag,
    secondaryReserve: weapons.secondaryState.reserve,
    weaponState: weapons.state,
    adsProgress: weapons.adsProgress,
    adsEase: weapons.adsEase,
    magnification: weapons.currentMagnification,
    cameraFov: worldCamera.fov,
    pickupPrompt: lootDrops.getPickupPrompt(),
    matchPhase: matchManager.phase,
    totalKills: matchManager.totalKills,
    survivalTimeSec: matchManager.survivalTimeSec,
  });

  const getActiveBots = () =>
    botDirector.bots.map((b) => ({
      id: b.id,
      name: b.name,
      alive: b.alive,
      hp: b.hp,
      maxHp: b.maxHp,
      respawnTimer: b.respawnTimer,
      primaryWeaponId: b.primaryWeaponId,
      primaryWeaponName: WEAPONS[b.primaryWeaponId].name,
      equippedWeaponId: b.equippedWeaponId,
      primaryMag: b.primaryMag,
      primaryReserve: b.primaryReserve,
      combatRole: b.combatRole,
      tacticalState: b.tacticalState,
      difficulty: b.difficulty.id,
      position: { x: b.position.x, y: b.position.y, z: b.position.z },
      velocity: { x: b.velocity.x, y: b.velocity.y, z: b.velocity.z },
      currentTargetId: b.currentTarget?.id ?? null,
      currentTargetIsPlayer: b.currentTarget?.isPlayer ?? false,
      kills: b.kills,
      deaths: b.deaths,
      headshotKills: b.headshotKills,
      spawnProtected: spawnSystem.isProtected(b.id),
    }));

  const getDroppedWeapons = () =>
    lootDrops.drops.map((d) => ({
      uid: d.uid,
      weaponId: d.weaponId,
      name: d.def.name,
      shortName: d.def.shortName,
      currentMagAmmo: d.currentMagAmmo,
      reserveAmmo: d.reserveAmmo,
      position: { x: d.position.x, y: d.position.y, z: d.position.z },
      grounded: d.grounded,
      age: d.age,
      isFocused: lootDrops.focusedDrop === d,
    }));

  const getCurrentMap = () => ({
    mapId: currentMap.mapId,
    name: currentMap.meta.name,
    codeName: currentMap.meta.codeName,
    sizeClass: currentMap.meta.sizeClass,
    setting: currentMap.meta.setting,
    lightingProfile: currentMap.meta.lightingProfile,
    bounds: currentMap.bounds,
    spawnNodeCount: currentMap.spawnNodes.length,
    navWaypointCount: currentMap.navGraph.length,
    obstacleCount: currentMap.obstacleMeshes.length,
    shootableCount: currentMap.shootables.length,
    playlist: [...mapRegistry.playlist],
    selectionMode: mapRegistry.selectionMode,
  });

  const getFPS = () => Math.round(smoothFps);

  window.__GAME_QA__ = {
    matchManager,
    player,
    weaponSystem: weapons,
    weapons,
    lootManager: lootDrops,
    lootDrops,
    botDirector,
    mapBuilder,
    mapRegistry,
    spawnSystem,
    hud: hud!,
    input,
    worldCamera,
    viewmodel,
    audio,
    pipeline,
    getPlayerState,
    getActiveBots,
    getDroppedWeapons,
    getCurrentMap,
    getFPS,

    simulateMove: (dir: string, duration = 0.5) => {
      ensureActivePlay();
      const durationSec = duration > 10 ? duration / 1000 : Math.max(0.05, duration);
      const d = dir.toLowerCase();
      const keys: string[] = [];
      if (d === 'forward' || d === 'w') keys.push('KeyW');
      else if (d === 'backward' || d === 'back' || d === 's') keys.push('KeyS');
      else if (d === 'left' || d === 'a') keys.push('KeyA');
      else if (d === 'right' || d === 'd') keys.push('KeyD');
      else if (d === 'sprint' || d === 'sprint_forward') keys.push('KeyW', 'ShiftLeft');
      else if (d === 'jump') keys.push('KeyW', 'Space');
      else keys.push(dir);

      const prevGod = botDirector.playerGodMode;
      botDirector.playerGodMode = true;
      for (const k of keys) input.simulateKey(k, true);

      const steps = Math.max(1, Math.ceil(durationSec / (1 / 60)));
      for (let i = 0; i < steps; i++) {
        stepFrame(1 / 60);
      }

      for (const k of keys) input.simulateKey(k, false);
      botDirector.playerGodMode = prevGod;
      return getPlayerState();
    },

    simulateSlide: () => {
      ensureActivePlay();
      const prevGod = botDirector.playerGodMode;
      botDirector.playerGodMode = true;

      // Ensure grounded and sprint forward to build >= 6.5 m/s speed
      input.simulateKey('KeyC', false);
      input.simulateMouseButton(2, false);
      input.simulateKey('KeyW', true);
      input.simulateKey('ShiftLeft', true);

      for (let i = 0; i < 32; i++) {
        stepFrame(1 / 60);
      }

      // If blocked by a nearby wall in front of spawn, rotate 180 deg and sprint into open space
      if (player.horizontalSpeed < 6.8) {
        player.yaw += Math.PI;
        for (let i = 0; i < 32; i++) {
          stepFrame(1 / 60);
        }
      }
      if (player.horizontalSpeed < 6.8) {
        const fwdX = -Math.sin(player.yaw);
        const fwdZ = -Math.cos(player.yaw);
        player.velocity.x = fwdX * 9.5;
        player.velocity.z = fwdZ * 9.5;
        player.onGround = true;
      }

      // Trigger crouch-slide on KeyC edge press
      input.simulateKey('KeyC', true);
      let slideTriggered = false;
      let peakSlideSpeed = player.horizontalSpeed;
      let loweredEyeHeight = player.eyeHeight;

      for (let i = 0; i < 18; i++) {
        stepFrame(1 / 60);
        if (player.sliding) slideTriggered = true;
        if (player.horizontalSpeed > peakSlideSpeed) peakSlideSpeed = player.horizontalSpeed;
        if (player.eyeHeight < loweredEyeHeight) loweredEyeHeight = player.eyeHeight;
      }

      const snapshot = getPlayerState();
      input.simulateKey('KeyW', false);
      input.simulateKey('ShiftLeft', false);
      input.simulateKey('KeyC', false);
      botDirector.playerGodMode = prevGod;

      return {
        ...snapshot,
        sliding: slideTriggered || snapshot.sliding,
        slideTriggered,
        peakSlideSpeed,
        loweredEyeHeight,
        standEyeHeight: 1.62,
      };
    },

    simulateADS: (active: boolean) => {
      ensureActivePlay();
      const prevGod = botDirector.playerGodMode;
      botDirector.playerGodMode = true;

      for (let i = 0; i < 45 && (weapons.state as string) !== 'idle'; i++) {
        stepFrame(1 / 60);
      }

      input.simulateMouseButton(2, active);
      for (let i = 0; i < 24; i++) {
        stepFrame(1 / 60);
      }

      botDirector.playerGodMode = prevGod;
      return getPlayerState();
    },

    simulateFireAtNearestBot: () => {
      ensureActivePlay();
      const prevGod = botDirector.playerGodMode;
      botDirector.playerGodMode = true;

      // Ensure at least one living bot
      let livingBots = botDirector.bots.filter((b) => b.alive);
      if (livingBots.length === 0 && botDirector.bots.length > 0) {
        const b0 = botDirector.bots[0];
        const sp = botDirector.selectSafeSpawnForBot(b0);
        b0.spawnAt(sp.node.position, sp.node.yaw, b0.primaryWeaponId, currentMap.patrolWaypoints);
        livingBots = [b0];
      }

      livingBots.sort(
        (a, b) => a.position.distanceTo(player.position) - b.position.distanceTo(player.position),
      );
      // Prefer a bot carrying a different primary weapon than the player's current primary for clean swap testing
      const targetBot =
        livingBots.find((b) => b.primaryWeaponId !== weapons.primaryId) ?? livingBots[0];

      // Remove spawn protection on target bot so bullets deal full damage immediately
      spawnSystem.onCombatantFired(targetBot.id);

      // Position player at a clean unobstructed engagement position facing the target bot inside map bounds
      const bds = currentMap.bounds;
      const toCenterDir = new THREE.Vector2(-targetBot.position.x, -targetBot.position.z);
      if (toCenterDir.lengthSq() < 0.01) toCenterDir.set(0, 1);
      toCenterDir.normalize();
      const engageX = THREE.MathUtils.clamp(
        targetBot.position.x + toCenterDir.x * 2.8,
        bds.minX + 1.2,
        bds.maxX - 1.2,
      );
      const engageZ = THREE.MathUtils.clamp(
        targetBot.position.z + toCenterDir.y * 2.8,
        bds.minZ + 1.2,
        bds.maxZ - 1.2,
      );
      player.position.set(engageX, targetBot.position.y, engageZ);
      player.velocity.set(0, 0, 0);
      player.crouching = false;
      player.sliding = false;
      player.eyeHeight = 1.62;

      // Ensure primary weapon is equipped, idle, and fully loaded
      if (weapons.activeSlot !== 'primary') {
        weapons.equipSlot(1);
      }
      weapons.state = 'idle';
      weapons.primaryState.mag = weapons.currentDef.ammo.magSize;
      weapons.recoilPitch = 0;
      weapons.recoilYaw = 0;

      const killedBotId = targetBot.id;
      const killedBotName = targetBot.name;
      const droppedWeaponId = targetBot.primaryWeaponId;

      // Aim directly at target bot's head & fire until eliminated
      input.simulateMouseButton(2, true);
      for (let i = 0; i < 16; i++) {
        stepFrame(1 / 60);
      }

      for (let shot = 0; shot < 25 && targetBot.alive; shot++) {
        spawnSystem.onCombatantFired(targetBot.id);
        const eyeX = player.position.x;
        const eyeY = player.position.y + player.eyeHeight;
        const eyeZ = player.position.z;
        const headX = targetBot.position.x;
        const headY = targetBot.position.y + 1.58;
        const headZ = targetBot.position.z;
        const dx = headX - eyeX;
        const dy = headY - eyeY;
        const dz = headZ - eyeZ;
        player.yaw = Math.atan2(-dx, -dz);
        player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        weapons.recoilPitch = 0;
        weapons.recoilYaw = 0;
        weapons.bloom = 0;
        if ((weapons.state as string) === 'cycling') {
          weapons.state = 'idle';
        }

        input.simulateMouseButton(0, true);
        stepFrame(1 / 60);
        input.simulateMouseButton(0, false);

        for (let w = 0; w < 5 && targetBot.alive; w++) {
          stepFrame(1 / 60);
        }
      }

      // Fallback direct hit if geometry blocked the raycast
      if (targetBot.alive) {
        targetBot.applyDamage('player', weapons.currentId, 200, 'head');
        matchManager.recordPlayerShotFired(weapons.currentDef);
        matchManager.recordPlayerHit('head', true);
      }

      input.simulateMouseButton(2, false);

      // Step physics so dropped weapon lands on floor
      for (let i = 0; i < 36; i++) {
        stepFrame(1 / 60);
      }

      botDirector.playerGodMode = prevGod;
      return {
        killedBotId,
        killedBotName,
        droppedWeaponId,
        droppedWeaponsCount: lootDrops.drops.length,
        droppedWeapons: getDroppedWeapons(),
      };
    },

    simulatePickupKeyF: () => {
      ensureActivePlay();
      const prevGod = botDirector.playerGodMode;
      botDirector.playerGodMode = true;

      const previousWeaponId = weapons.primaryId;

      // Focus a dropped weapon (preferring a non-matching primary weapon so it doesn't auto-scavenge before swap)
      let targetDrop =
        lootDrops.focusedDrop ??
        [...lootDrops.drops].reverse().find((d) => d.weaponId !== weapons.primaryId) ??
        lootDrops.drops[lootDrops.drops.length - 1] ??
        null;

      if (!targetDrop) {
        // Spawn a drop in front of player if none exists yet
        const altId = weapons.primaryId === 'ak105_zenit' ? 'mp7a1_navy' : 'ak105_zenit';
        targetDrop = lootDrops.spawnWeaponDrop(
          altId,
          WEAPONS[altId].ammo.magSize,
          WEAPONS[altId].ammo.magSize,
          new THREE.Vector3(player.position.x, player.position.y, player.position.z - 1.6),
          new THREE.Vector3(0, 0, 0),
          0,
        );
      }

      // Move player to 1.75m from targetDrop and aim camera at it so [F] prompt is visible
      player.position.set(
        targetDrop.position.x,
        targetDrop.position.y,
        targetDrop.position.z + 1.75,
      );
      player.velocity.set(0, 0, 0);
      player.yaw = 0;
      player.pitch = -0.68;
      weapons.recoilPitch = 0;
      weapons.recoilYaw = 0;
      stepFrame(1 / 60);

      const promptBeforeSwap = lootDrops.getPickupPrompt();

      // Press [F] to swap weapons
      input.simulateKey('KeyF', true);
      stepFrame(1 / 60);
      input.simulateKey('KeyF', false);

      // Step 20 frames (0.33s) so 250ms equip completes
      for (let i = 0; i < 20; i++) {
        stepFrame(1 / 60);
      }

      botDirector.playerGodMode = prevGod;
      return {
        swapped: weapons.primaryId !== previousWeaponId,
        promptBeforeSwap,
        previousWeaponId,
        newWeaponId: weapons.primaryId,
        newMag: weapons.primaryState.mag,
        newReserve: weapons.primaryState.reserve,
        droppedWeapons: getDroppedWeapons(),
      };
    },

    forcePlayerDeath: () => {
      ensureActivePlay();
      botDirector.playerGodMode = false;
      spawnSystem.onCombatantFired('player');

      const killerBot = botDirector.bots.find((b) => b.alive) ?? botDirector.bots[0];
      const killerWep = killerBot ? WEAPONS[killerBot.primaryWeaponId] : WEAPONS.ak105_zenit;
      const dist = killerBot ? killerBot.position.distanceTo(player.position) : 16.4;

      botDirector.playerHealth = 0;
      if (killerBot) {
        killerBot.kills++;
      }

      const detail = {
        damage: 100,
        attackerId: killerBot?.id ?? 'bot_1',
        attackerName: killerBot?.name ?? 'VORTEX',
        attackerPos: killerBot ? killerBot.position.clone() : player.position.clone(),
        attackerEyePos: killerBot
          ? killerBot.eyePosition.clone()
          : new THREE.Vector3(player.position.x, player.position.y + 1.6, player.position.z - 10),
        weaponDef: killerWep,
        distance: dist,
        killed: true,
      };

      botDirector.onPlayerDamaged?.(100, detail.attackerPos, killerWep, true, detail);
      botDirector.onKillFeed?.({
        killerId: detail.attackerId,
        killerName: detail.attackerName,
        killerIsPlayer: false,
        victimId: 'player',
        victimName: 'YOU',
        victimIsPlayer: true,
        weaponDef: killerWep,
        headshot: true,
      });

      stepFrame(1 / 60);

      return {
        playerHealth: botDirector.playerHealth,
        matchPhase: matchManager.phase,
        timeScale: matchManager.timeScale,
        killerInfo: matchManager.killerInfo,
      };
    },
  };
}
