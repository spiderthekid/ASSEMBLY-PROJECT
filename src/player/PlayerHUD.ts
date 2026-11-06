import * as THREE from 'three';
import {
  PRIMARY_ORDER,
  WEAPONS,
  fireModeLabel,
  type WeaponDef,
  type WeaponId,
  type OpticType,
} from '../weapons/WeaponDatabase';
import type { GameSettings } from '../core/Settings';
import { MOVEMENT_CONFIG } from './ArenaPlayerController';
import type { BotDifficultySetting, KillFeedEvent } from '../ai/BotDirector';
import { MAP_DEFINITIONS, MAP_ORDER, type MapId } from '../maps/MapAssets';
import {
  getMapThumbnailSvg,
  type MapRegistry,
  type MapSelectionMode,
} from '../core/MapRegistry';
import type {
  KillerTelemetry,
  MatchPhase,
  MatchStatsSummary,
  VictoryKillTarget,
} from '../core/MatchManager';

function weaponSilhouetteSvg(def: WeaponDef): string {
  switch (def.weaponClass) {
    case 'assault_rifle':
      return `<svg class="kf-icon" viewBox="0 0 64 20"><path fill="currentColor" d="M2 8h12l2-3h22l4 2h18v3H42l-2 3-3 6h-4l2-6h-9l-2 5h-4v-5H14l-2 3H2z"/></svg>`;
    case 'smg':
      return `<svg class="kf-icon" viewBox="0 0 64 20"><path fill="currentColor" d="M8 7h10l2-2h18l3 2h14v3H40l-2 3-1 6h-4l1-6h-6l-2 6h-4v-6H16l-2 2H8z"/></svg>`;
    case 'shotgun':
      return `<svg class="kf-icon" viewBox="0 0 64 20"><path fill="currentColor" d="M2 9h14l3-3h41v3H38v2H22l-4 5h-5l3-4H2z"/></svg>`;
    case 'dmr':
      return `<svg class="kf-icon" viewBox="0 0 64 20"><path fill="currentColor" d="M2 8h13l3-2h24l2 1h18v2H42l-2 3-2 6h-4l1-6H22l-2 5h-4v-4H2zm20-5h14v2H22z"/></svg>`;
    case 'sniper':
      return `<svg class="kf-icon" viewBox="0 0 64 20"><path fill="currentColor" d="M1 8h14l4-2h23l2 1h19v2H42l-3 3-2 5h-4l1-5H20l-3 5h-5v-4H1zm20-5h16v2H21z"/></svg>`;
    case 'lmg':
      return `<svg class="kf-icon" viewBox="0 0 64 20"><path fill="currentColor" d="M2 7h12l2-2h24l3 2h17v3H42l-2 4h-9v5h-8v-5h-5l-2 5h-4v-5H2z"/></svg>`;
    case 'pistol':
    default:
      return `<svg class="kf-icon" viewBox="0 0 64 20"><path fill="currentColor" d="M20 5h24v4H34l-3 9h-6l2-9h-7z"/></svg>`;
  }
}

export function formatSurvivalTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = Math.floor(s).toString().padStart(2, '0');
  const tenths = Math.floor((s - Math.floor(s)) * 10);
  return `${mm}:${ss}.${tenths}`;
}

export interface DamageDirectionIndicator {
  attackerX: number;
  attackerZ: number;
  damage: number;
  age: number;
  maxAge: number;
}

export interface HUDUpdatePayload {
  dt: number;
  fps: number;
  frameMs: number;
  weapon: WeaponDef;
  mag: number;
  reserve: number;
  activeSlot: 'primary' | 'secondary';
  primaryWeapon: WeaponDef;
  primaryMag: number;
  primaryReserve: number;
  secondaryWeapon: WeaponDef;
  secondaryMag: number;
  secondaryReserve: number;
  pickupPrompt: string | null;
  weaponState: 'idle' | 'reloading' | 'equipping' | 'cycling';
  stateProgress: number;
  adsEase: number;
  magnification: number;
  spreadDeg: number;
  vfovDeg: number;
  speed: number;
  stateLabel: string;
  onGround: boolean;
  sliding: boolean;
  crouching: boolean;
  health: number;
  spawnProtected: boolean;
  mapId: MapId;
  mapName: string;
  mapSubtitle: string;
  playerPos: THREE.Vector3;
  playerYaw: number;
  matchPhase: MatchPhase;
  survivalTimeSec: number;
  totalKills: number;
  victoryKillTarget: VictoryKillTarget;
  deathCamProgress: number;
  killerInfo: KillerTelemetry | null;
}

export class PlayerHUD {
  private readonly reticleCanvas: HTMLCanvasElement;
  private readonly reticleCtx: CanvasRenderingContext2D;
  private readonly hudRootEl: HTMLElement;

  // Sandbox Lobby Operator Auth Header
  private readonly lobbyOperatorCallsignEl: HTMLElement;

  private readonly fpsVal: HTMLElement;
  private readonly frameVal: HTMLElement;
  private readonly mapBadgeEl: HTMLElement;
  private readonly runKillsEl: HTMLElement;
  private readonly runTimerEl: HTMLElement;
  private readonly spawnShieldEl: HTMLElement;
  private readonly speedVal: HTMLElement;
  private readonly speedFill: HTMLElement;
  private readonly stateBadge: HTMLElement;
  private readonly weaponNameEl: HTMLElement;
  private readonly weaponSubEl: HTMLElement;
  private readonly opticBadgeEl: HTMLElement;
  private readonly magEl: HTMLElement;
  private readonly reserveEl: HTMLElement;
  private readonly reloadBarWrap: HTMLElement;
  private readonly reloadBarFill: HTMLElement;
  private readonly reloadLabel: HTMLElement;
  private readonly pickupPromptEl: HTMLElement;
  private readonly killFeedEl: HTMLElement;
  private readonly hitLogEl: HTMLElement;
  private readonly hpNumEl: HTMLElement;
  private readonly hpFillEl: HTMLElement;
  private readonly damageFlashEl: HTMLElement;
  private readonly lowHpVignetteEl: HTMLElement;
  private readonly killcamBannerEl: HTMLElement;
  private readonly killcamInfoEl: HTMLElement;
  private readonly killcamFillEl: HTMLElement;
  private readonly primarySlotEl: HTMLElement;
  private readonly primarySlotNameEl: HTMLElement;
  private readonly primarySlotAmmoEl: HTMLElement;
  private readonly secondarySlotEl: HTMLElement;
  private readonly secondarySlotNameEl: HTMLElement;
  private readonly secondarySlotAmmoEl: HTMLElement;

  // Sandbox Lobby Overlay
  private readonly overlayEl: HTMLElement;
  private readonly lockStatusEl: HTMLElement;
  private readonly mapSelectEl: HTMLSelectElement;
  private readonly playlistWrapEl: HTMLElement;
  private readonly singleMapWrapEl: HTMLElement;

  // End-of-Run Tactical Overlay
  private readonly eorOverlayEl: HTMLElement;
  private readonly eorTitleEl: HTMLElement;
  private readonly eorSubEl: HTMLElement;
  private readonly eorKillerCardEl: HTMLElement;
  private readonly eorSurvivalEl: HTMLElement;
  private readonly eorKillsEl: HTMLElement;
  private readonly eorAccuracyEl: HTMLElement;
  private readonly eorHeadshotEl: HTMLElement;
  private readonly eorScavengedEl: HTMLElement;
  private readonly eorScoreboardBodyEl: HTMLElement;
  private readonly eorNextMapThumbEl: HTMLElement;
  private readonly eorNextMapNameEl: HTMLElement;

  // Hitmarker & Directional Damage Indicators
  private hitmarkerTimer = 0;
  private hitmarkerHead = false;
  private hitmarkerKill = false;
  readonly damageIndicators: DamageDirectionIndicator[] = [];

  private lastWeaponId: WeaponId | null = null;
  private lastMapId: MapId | null = null;
  private lowHpPulseClock = 0;

  constructor(
    container: HTMLElement,
    private readonly settings: GameSettings,
    private readonly mapRegistry: MapRegistry,
    private readonly callbacks: {
      onResumeClick: () => void;
      onSettingsChange: (s: GameSettings) => void;
      onRefillAmmo: () => void;
      onResetTargets: () => void;
      onSelectStartingPrimary: (id: WeaponId) => void;
      onSelectMap: (mapId: MapId) => void;
      onSelectMapMode: (mode: MapSelectionMode) => void;
      onPlaylistChanged: () => void;
      onBotCountChange: (count: number) => void;
      onBotDifficultyChange: (diff: BotDifficultySetting) => void;
      onVictoryTargetChange: (target: VictoryKillTarget) => void;
      onDeployNextPlaylistMap: () => void;
      onDeployRandomMap: () => void;
      onInstantRematch: () => void;
      onReturnToLobby: () => void;
      onLogoutClick?: () => void;
    },
  ) {
    this.reticleCanvas = document.createElement('canvas');
    this.reticleCanvas.id = 'reticle-canvas';
    container.appendChild(this.reticleCanvas);
    const ctx = this.reticleCanvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.reticleCtx = ctx;

    const hud = document.createElement('div');
    hud.id = 'hud-root';
    this.hudRootEl = hud;
    hud.innerHTML = `
      <div class="hud-damage-flash" id="hud-damage-flash"></div>
      <div class="hud-low-hp-vignette" id="hud-low-hp-vignette"></div>

      <div class="hud-top-left">
        <div class="hud-perf" id="hud-perf">
          <span class="brand-tag">ASSEMBLY</span>
          <span class="sep">|</span>
          <span id="hud-fps">144</span> <small>FPS</small>
          <span class="sep">|</span>
          <span id="hud-ms">6.9</span> <small>ms</small>
          <span class="sep">|</span>
          <span class="hud-map-badge" id="hud-map-badge">KILLHOUSE ALPHA</span>
        </div>
        <div class="hud-run-bar">
          <div class="run-stat">
            <small>SURVIVAL</small>
            <b id="hud-run-timer">00:00.0</b>
          </div>
          <div class="run-stat">
            <small>ELIMINATIONS</small>
            <b id="hud-run-kills">0 / 15</b>
          </div>
        </div>
        <div class="hud-telemetry">
          <div class="speed-row">
            <span class="speed-num" id="hud-speed">0.0</span>
            <span class="speed-unit">m/s</span>
            <span class="state-badge" id="hud-state">IDLE</span>
          </div>
          <div class="speed-bar"><div class="speed-fill" id="hud-speed-fill"></div></div>
          <div class="speed-ticks">
            <span>Base 7.5</span>
            <span>Sprint 10.0</span>
            <span>Cap 11.5</span>
          </div>
        </div>
        <div class="hud-spawn-shield" id="hud-spawn-shield" style="display:none">
          SPAWN PROTECTION ACTIVE (1.5s // CLEARS ON FIRE)
        </div>
      </div>

      <div class="hud-top-right">
        <div class="hud-kill-feed" id="hud-kill-feed"></div>
        <div class="hud-hit-log" id="hud-hit-log"></div>
      </div>

      <div class="hud-pickup-prompt" id="hud-pickup-prompt" style="display:none"></div>

      <div class="hud-killcam-banner" id="hud-killcam-banner" style="display:none">
        <div class="killcam-tag">PERMADEATH // 1.2s SLOW-MOTION KILLCAM</div>
        <div class="killcam-title" id="hud-killcam-info">KILLED BY VANGUARD-1 · AK-105 ZENIT · 22.4m</div>
        <div class="killcam-track"><div class="killcam-fill" id="hud-killcam-fill"></div></div>
      </div>

      <div class="hud-reload-wrap" id="hud-reload-wrap">
        <div class="reload-label" id="hud-reload-label">RELOADING</div>
        <div class="reload-track"><div class="reload-fill" id="hud-reload-fill"></div></div>
      </div>

      <div class="hud-bottom-left">
        <div class="hp-label">OPERATOR VITALS // 1-LIFE PERMADEATH</div>
        <div class="hp-row">
          <span class="hp-num" id="hud-hp">100</span>
          <div class="hp-bar"><div class="hp-fill" id="hud-hp-fill" style="width:100%"></div></div>
        </div>
      </div>

      <div class="hud-bottom-right">
        <div class="weapon-meta">
          <div class="weapon-title" id="hud-weapon-name">M4A1 SOPMOD</div>
          <div class="weapon-sub" id="hud-weapon-sub">5.56x45mm NATO · AUTO · 800 RPM</div>
          <div class="optic-badge" id="hud-optic-badge">EOTech EXPS3 Holographic · 1.25x</div>
        </div>
        <div class="ammo-block">
          <span class="ammo-mag" id="hud-mag">30</span>
          <span class="ammo-slash">/</span>
          <span class="ammo-res" id="hud-reserve">60</span>
        </div>
      </div>

      <div class="hud-weapon-bar" id="hud-weapon-bar">
        <div class="weapon-slot active" id="slot-primary">
          <span class="slot-key">[1] PRIMARY</span>
          <span class="slot-name" id="slot-primary-name">M4A1</span>
          <span class="slot-mag" id="slot-primary-ammo">30 / 60</span>
        </div>
        <div class="weapon-slot" id="slot-secondary">
          <span class="slot-key">[2] SIDEARM</span>
          <span class="slot-name" id="slot-secondary-name">G19</span>
          <span class="slot-mag" id="slot-secondary-ammo">17 / 34</span>
        </div>
      </div>
    `;
    container.appendChild(hud);

    const primaryOptionsHtml = PRIMARY_ORDER.map((id) => {
      const w = WEAPONS[id];
      return `<option value="${id}">${w.name} (${w.ammo.magSize} / ${w.ammo.magSize * 2} · ${w.caliber})</option>`;
    }).join('');

    const mapOptionsHtml = MAP_ORDER.map((id) => {
      const m = MAP_DEFINITIONS[id];
      return `<option value="${id}">${m.name} (${m.sizeClass} · ${m.setting})</option>`;
    }).join('');

    // 1. Sandbox Pre-Match Lobby Overlay (#pause-overlay)
    const overlay = document.createElement('div');
    overlay.id = 'pause-overlay';
    overlay.innerHTML = `
      <div class="overlay-card">
        <div class="overlay-header">
          <div>
            <div class="overlay-tag">PC TACTICAL ARENA FPS // PERMADEATH SCAVENGER EDITION</div>
            <h1>ASSEMBLY</h1>
          </div>
          <div class="overlay-header-right">
            <div class="lobby-operator-bar">
              <span class="lobby-operator-tag" id="lobby-operator-callsign">OPERATOR: GHOST-01</span>
              <button id="btn-logout" type="button" class="btn-logout">[ LOGOUT ]</button>
            </div>
            <div class="overlay-badge">ALL WEAPONS &amp; MAPS UNLOCKED · 1-LIFE FFA</div>
          </div>
        </div>

        <p class="overlay-status" id="lock-status">Configure your Starting Loadout, AI Bot Director, Victory Target, and Map Playlist Queue below, then click <b>DEPLOY TO ARENA</b>.</p>

        <div class="overlay-grid">
          <div class="overlay-panel">
            <h3>SANDBOX MATCH &amp; LOADOUT CONFIGURATION</h3>
            <label class="setting-row">
              <span>Starting Primary Weapon (2 Reserve Mags)</span>
              <select id="inp-starting-primary" class="select-input">${primaryOptionsHtml}</select>
            </label>
            <label class="setting-row">
              <span>Active FFA Bot Count (3–15) <b id="lbl-bots">7 Bots</b></span>
              <input id="inp-bots" type="range" min="3" max="15" step="1" value="7" />
            </label>
            <div class="setting-two-col">
              <label class="setting-row">
                <span>AI Difficulty Tier</span>
                <select id="inp-bot-difficulty" class="select-input">
                  <option value="recruit">Recruit (700ms · 4.2°)</option>
                  <option value="regular" selected>Regular (420ms · 2.5°)</option>
                  <option value="veteran">Veteran (240ms · 1.3°)</option>
                  <option value="nightmare">Nightmare (120ms · 0.55°)</option>
                  <option value="mixed">Mixed (All 4 Tiers)</option>
                </select>
              </label>
              <label class="setting-row">
                <span>Victory Kill Target</span>
                <select id="inp-kill-target" class="select-input">
                  <option value="15" selected>15 Eliminations</option>
                  <option value="30">30 Eliminations</option>
                  <option value="50">50 Eliminations</option>
                  <option value="0">Endless Survival</option>
                </select>
              </label>
            </div>

            <h3 style="margin-top:10px">CAMERA &amp; RENDER SETTINGS</h3>
            <div class="setting-two-col">
              <label class="setting-row">
                <span>Horizontal FOV <b id="lbl-fov">${this.settings.fov}°</b></span>
                <input id="inp-fov" type="range" min="80" max="120" step="1" value="${this.settings.fov}" />
              </label>
              <label class="setting-row">
                <span>Raw Sensitivity <b id="lbl-sens">${this.settings.sensitivity.toFixed(2)}</b></span>
                <input id="inp-sens" type="range" min="0.2" max="5.0" step="0.05" value="${this.settings.sensitivity}" />
              </label>
            </div>
            <label class="setting-row checkbox-row">
              <span>HDR Unreal Bloom Post-Processing</span>
              <input id="inp-bloom" type="checkbox" ${this.settings.bloom ? 'checked' : ''} />
            </label>
            <div class="action-buttons">
              <button id="btn-refill" type="button" class="btn-secondary">Refill Ammo [B]</button>
              <button id="btn-reset-targets" type="button" class="btn-secondary">Instant Rematch [T]</button>
            </div>
          </div>

          <div class="overlay-panel">
            <h3>MAP SELECTION MODE &amp; PLAYLIST QUEUE</h3>
            <div class="map-mode-tabs" id="map-mode-tabs">
              <button type="button" class="mode-tab active" data-mode="playlist">Playlist Queue</button>
              <button type="button" class="mode-tab" data-mode="single">Single Map</button>
              <button type="button" class="mode-tab" data-mode="random">Random Map</button>
            </div>

            <div id="single-map-wrap" style="display:none; margin-top:8px;">
              <label class="setting-row">
                <span>Active Tactical Arena Map</span>
                <select id="inp-map-select" class="select-input">${mapOptionsHtml}</select>
              </label>
            </div>

            <div id="playlist-queue-wrap" style="margin-top:8px;">
              <div class="playlist-hint">Drag rows or use ▲/▼ to order your Pre-Chosen Map Playlist Queue:</div>
              <div class="playlist-queue-list" id="playlist-queue-list"></div>
            </div>

            <h3 style="margin-top:12px">PERMADEATH &amp; SCAVENGER RULES</h3>
            <ul class="key-list compact">
              <li><b>1-Life Permadeath:</b> Bots respawn endlessly; when your HP hits 0, your run ends.</li>
              <li><kbd>F</kbd> Swap Primary for Dropped Weapon (2.5m) · <b>1.5m Auto-Scavenge</b> reserve mag</li>
              <li><kbd>SPACE</kbd> Next Playlist Map · <kbd>R</kbd> Random Map · <kbd>T</kbd> Instant Rematch</li>
            </ul>
          </div>
        </div>

        <button id="btn-resume" type="button" class="btn-primary">START MATCH // DEPLOY TO ARENA</button>
      </div>
    `;
    container.appendChild(overlay);
    this.overlayEl = overlay;
    this.lockStatusEl = overlay.querySelector('#lock-status') as HTMLElement;
    this.mapSelectEl = overlay.querySelector('#inp-map-select') as HTMLSelectElement;
    this.playlistWrapEl = overlay.querySelector('#playlist-queue-wrap') as HTMLElement;
    this.singleMapWrapEl = overlay.querySelector('#single-map-wrap') as HTMLElement;
    this.lobbyOperatorCallsignEl = overlay.querySelector('#lobby-operator-callsign') as HTMLElement;

    // 2. End-of-Run Tactical Overlay (#end-of-run-overlay)
    const eor = document.createElement('div');
    eor.id = 'end-of-run-overlay';
    eor.style.display = 'none';
    eor.innerHTML = `
      <div class="eor-card">
        <div class="eor-header">
          <div>
            <div class="eor-tag">ASSEMBLY // END-OF-RUN TACTICAL REPORT</div>
            <h1 id="eor-title" class="eor-title kia">KILLED IN ACTION // PERMADEATH</h1>
            <div id="eor-sub" class="eor-sub">KILLHOUSE ALPHA · INDOOR SAS TACTICAL HANGAR</div>
          </div>
          <div class="eor-killer-card" id="eor-killer-card">
            <div class="killer-label">ELIMINATED BY</div>
            <div class="killer-main" id="eor-killer-main">VANGUARD-1</div>
            <div class="killer-meta" id="eor-killer-meta">AK-105 ZENIT · 21.4m</div>
          </div>
        </div>

        <div class="eor-stats-strip">
          <div class="eor-stat-box">
            <span class="eor-stat-lbl">SURVIVAL TIME</span>
            <strong class="eor-stat-val" id="eor-stat-survival">00:42.5</strong>
          </div>
          <div class="eor-stat-box">
            <span class="eor-stat-lbl">TOTAL KILLS</span>
            <strong class="eor-stat-val" id="eor-stat-kills">8 / 15</strong>
          </div>
          <div class="eor-stat-box">
            <span class="eor-stat-lbl">ACCURACY %</span>
            <strong class="eor-stat-val" id="eor-stat-accuracy">38.5%</strong>
          </div>
          <div class="eor-stat-box">
            <span class="eor-stat-lbl">HEADSHOT %</span>
            <strong class="eor-stat-val" id="eor-stat-headshot">25.0%</strong>
          </div>
          <div class="eor-stat-box">
            <span class="eor-stat-lbl">WEAPONS SCAVENGED</span>
            <strong class="eor-stat-val" id="eor-stat-scavenged">4</strong>
          </div>
        </div>

        <div class="eor-scoreboard-wrap">
          <div class="eor-section-title">FULL FREE-FOR-ALL TACTICAL SCOREBOARD</div>
          <table class="eor-scoreboard">
            <thead>
              <tr>
                <th>#</th>
                <th>OPERATOR / CALLSIGN</th>
                <th>ROLE / TIER</th>
                <th>LOADOUT</th>
                <th>KILLS</th>
                <th>DEATHS</th>
                <th>HEADSHOTS</th>
                <th>K/D</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody id="eor-scoreboard-body"></tbody>
          </table>
        </div>

        <div class="eor-actions-bar">
          <button type="button" class="eor-action-btn primary-next" id="btn-eor-next-map">
            <div class="next-map-thumb" id="eor-next-map-thumb"></div>
            <div class="next-map-info">
              <span class="action-kbd"><kbd>SPACEBAR</kbd> DEPLOY NEXT IN PLAYLIST</span>
              <strong id="eor-next-map-name">Black Site Khyber</strong>
            </div>
          </button>

          <button type="button" class="eor-action-btn" id="btn-eor-random-map">
            <span class="action-kbd"><kbd>R</kbd> RANDOM MAP</span>
            <strong>Deploy Different Arena</strong>
          </button>

          <button type="button" class="eor-action-btn" id="btn-eor-rematch">
            <span class="action-kbd"><kbd>T</kbd> INSTANT REMATCH</span>
            <strong>Retry Current Map (0.2s)</strong>
          </button>

          <button type="button" class="eor-action-btn" id="btn-eor-lobby">
            <span class="action-kbd"><kbd>ESC</kbd> SANDBOX LOBBY</span>
            <strong>Configure Loadout &amp; Bots</strong>
          </button>
        </div>
      </div>
    `;
    container.appendChild(eor);
    this.eorOverlayEl = eor;
    this.eorTitleEl = eor.querySelector('#eor-title') as HTMLElement;
    this.eorSubEl = eor.querySelector('#eor-sub') as HTMLElement;
    this.eorKillerCardEl = eor.querySelector('#eor-killer-card') as HTMLElement;
    this.eorSurvivalEl = eor.querySelector('#eor-stat-survival') as HTMLElement;
    this.eorKillsEl = eor.querySelector('#eor-stat-kills') as HTMLElement;
    this.eorAccuracyEl = eor.querySelector('#eor-stat-accuracy') as HTMLElement;
    this.eorHeadshotEl = eor.querySelector('#eor-stat-headshot') as HTMLElement;
    this.eorScavengedEl = eor.querySelector('#eor-stat-scavenged') as HTMLElement;
    this.eorScoreboardBodyEl = eor.querySelector('#eor-scoreboard-body') as HTMLElement;
    this.eorNextMapThumbEl = eor.querySelector('#eor-next-map-thumb') as HTMLElement;
    this.eorNextMapNameEl = eor.querySelector('#eor-next-map-name') as HTMLElement;

    // Bind HUD elements
    this.fpsVal = hud.querySelector('#hud-fps') as HTMLElement;
    this.frameVal = hud.querySelector('#hud-ms') as HTMLElement;
    this.mapBadgeEl = hud.querySelector('#hud-map-badge') as HTMLElement;
    this.runKillsEl = hud.querySelector('#hud-run-kills') as HTMLElement;
    this.runTimerEl = hud.querySelector('#hud-run-timer') as HTMLElement;
    this.spawnShieldEl = hud.querySelector('#hud-spawn-shield') as HTMLElement;
    this.speedVal = hud.querySelector('#hud-speed') as HTMLElement;
    this.speedFill = hud.querySelector('#hud-speed-fill') as HTMLElement;
    this.stateBadge = hud.querySelector('#hud-state') as HTMLElement;
    this.weaponNameEl = hud.querySelector('#hud-weapon-name') as HTMLElement;
    this.weaponSubEl = hud.querySelector('#hud-weapon-sub') as HTMLElement;
    this.opticBadgeEl = hud.querySelector('#hud-optic-badge') as HTMLElement;
    this.magEl = hud.querySelector('#hud-mag') as HTMLElement;
    this.reserveEl = hud.querySelector('#hud-reserve') as HTMLElement;
    this.reloadBarWrap = hud.querySelector('#hud-reload-wrap') as HTMLElement;
    this.reloadBarFill = hud.querySelector('#hud-reload-fill') as HTMLElement;
    this.reloadLabel = hud.querySelector('#hud-reload-label') as HTMLElement;
    this.pickupPromptEl = hud.querySelector('#hud-pickup-prompt') as HTMLElement;
    this.killFeedEl = hud.querySelector('#hud-kill-feed') as HTMLElement;
    this.hitLogEl = hud.querySelector('#hud-hit-log') as HTMLElement;
    this.hpNumEl = hud.querySelector('#hud-hp') as HTMLElement;
    this.hpFillEl = hud.querySelector('#hud-hp-fill') as HTMLElement;
    this.damageFlashEl = hud.querySelector('#hud-damage-flash') as HTMLElement;
    this.lowHpVignetteEl = hud.querySelector('#hud-low-hp-vignette') as HTMLElement;
    this.killcamBannerEl = hud.querySelector('#hud-killcam-banner') as HTMLElement;
    this.killcamInfoEl = hud.querySelector('#hud-killcam-info') as HTMLElement;
    this.killcamFillEl = hud.querySelector('#hud-killcam-fill') as HTMLElement;
    this.primarySlotEl = hud.querySelector('#slot-primary') as HTMLElement;
    this.primarySlotNameEl = hud.querySelector('#slot-primary-name') as HTMLElement;
    this.primarySlotAmmoEl = hud.querySelector('#slot-primary-ammo') as HTMLElement;
    this.secondarySlotEl = hud.querySelector('#slot-secondary') as HTMLElement;
    this.secondarySlotNameEl = hud.querySelector('#slot-secondary-name') as HTMLElement;
    this.secondarySlotAmmoEl = hud.querySelector('#slot-secondary-ammo') as HTMLElement;

    // Wire Sandbox Lobby controls
    this.mapSelectEl.addEventListener('change', () => {
      const id = this.mapSelectEl.value as MapId;
      this.mapRegistry.setSingleMap(id);
      callbacks.onSelectMap(id);
    });

    const modeTabs = overlay.querySelectorAll('.mode-tab');
    modeTabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        modeTabs.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = (btn as HTMLElement).dataset.mode as MapSelectionMode;
        this.mapRegistry.setSelectionMode(mode);
        this.singleMapWrapEl.style.display = mode === 'single' ? 'block' : 'none';
        this.playlistWrapEl.style.display = mode === 'playlist' ? 'block' : 'none';
        callbacks.onSelectMapMode(mode);
      });
    });

    this.renderPlaylistEditor();

    const primarySelect = overlay.querySelector('#inp-starting-primary') as HTMLSelectElement;
    primarySelect.addEventListener('change', () => {
      callbacks.onSelectStartingPrimary(primarySelect.value as WeaponId);
    });

    const botsInp = overlay.querySelector('#inp-bots') as HTMLInputElement;
    const botsLbl = overlay.querySelector('#lbl-bots') as HTMLElement;
    botsInp.addEventListener('input', () => {
      const c = parseInt(botsInp.value, 10);
      botsLbl.textContent = `${c} Bots`;
      callbacks.onBotCountChange(c);
    });

    const diffSelect = overlay.querySelector('#inp-bot-difficulty') as HTMLSelectElement;
    diffSelect.addEventListener('change', () => {
      callbacks.onBotDifficultyChange(diffSelect.value as BotDifficultySetting);
    });

    const targetSelect = overlay.querySelector('#inp-kill-target') as HTMLSelectElement;
    targetSelect.addEventListener('change', () => {
      const v = parseInt(targetSelect.value, 10) as VictoryKillTarget;
      callbacks.onVictoryTargetChange(v);
    });

    // Wire camera/render settings inputs
    const bindRange = (id: string, lblId: string, fmt: (v: number) => string, apply: (v: number) => void) => {
      const inp = overlay.querySelector(id) as HTMLInputElement;
      const lbl = overlay.querySelector(lblId) as HTMLElement;
      if (!inp || !lbl) return;
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        lbl.textContent = fmt(v);
        apply(v);
        callbacks.onSettingsChange(this.settings);
      });
    };

    bindRange('#inp-fov', '#lbl-fov', (v) => `${v}°`, (v) => (this.settings.fov = v));
    bindRange('#inp-sens', '#lbl-sens', (v) => v.toFixed(2), (v) => (this.settings.sensitivity = v));

    const bloomInp = overlay.querySelector('#inp-bloom') as HTMLInputElement;
    bloomInp.addEventListener('change', () => {
      this.settings.bloom = bloomInp.checked;
      callbacks.onSettingsChange(this.settings);
    });

    (overlay.querySelector('#btn-resume') as HTMLButtonElement).addEventListener('click', () => {
      callbacks.onResumeClick();
    });
    (overlay.querySelector('#btn-refill') as HTMLButtonElement).addEventListener('click', () => {
      callbacks.onRefillAmmo();
    });
    (overlay.querySelector('#btn-reset-targets') as HTMLButtonElement).addEventListener('click', () => {
      callbacks.onInstantRematch();
    });
    const logoutBtn = overlay.querySelector('#btn-logout') as HTMLButtonElement | null;
    logoutBtn?.addEventListener('click', () => {
      callbacks.onLogoutClick?.();
    });

    // Wire End-of-Run buttons
    (eor.querySelector('#btn-eor-next-map') as HTMLButtonElement).addEventListener('click', () => {
      callbacks.onDeployNextPlaylistMap();
    });
    (eor.querySelector('#btn-eor-random-map') as HTMLButtonElement).addEventListener('click', () => {
      callbacks.onDeployRandomMap();
    });
    (eor.querySelector('#btn-eor-rematch') as HTMLButtonElement).addEventListener('click', () => {
      callbacks.onInstantRematch();
    });
    (eor.querySelector('#btn-eor-lobby') as HTMLButtonElement).addEventListener('click', () => {
      callbacks.onReturnToLobby();
    });

    this.resize();
  }

  /**
   * Renders the interactive Pre-Chosen Map Playlist Queue builder (supports drag-and-drop, ▲/▼ reorder, and toggle).
   */
  renderPlaylistEditor(): void {
    const listEl = this.overlayEl.querySelector('#playlist-queue-list') as HTMLElement;
    if (!listEl) return;
    listEl.innerHTML = '';

    const activeQueue = this.mapRegistry.playlist;
    const excludedMaps = MAP_ORDER.filter((id) => !activeQueue.includes(id));
    const displayOrder: Array<{ id: MapId; enabled: boolean; queueIdx: number }> = [
      ...activeQueue.map((id, idx) => ({ id, enabled: true, queueIdx: idx })),
      ...excludedMaps.map((id) => ({ id, enabled: false, queueIdx: -1 })),
    ];

    let dragFromIdx: number | null = null;

    displayOrder.forEach((item) => {
      const meta = MAP_DEFINITIONS[item.id];
      const row = document.createElement('div');
      row.className = `playlist-item ${item.enabled ? 'enabled' : 'disabled'}`;
      row.dataset.mapId = item.id;
      if (item.enabled) {
        row.draggable = true;
        row.addEventListener('dragstart', () => {
          dragFromIdx = item.queueIdx;
        });
        row.addEventListener('dragover', (e) => {
          e.preventDefault();
        });
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          if (dragFromIdx !== null && dragFromIdx !== item.queueIdx) {
            this.mapRegistry.reorderPlaylist(dragFromIdx, item.queueIdx);
            this.renderPlaylistEditor();
            this.callbacks.onPlaylistChanged();
          }
          dragFromIdx = null;
        });
      }

      row.innerHTML = `
        <input type="checkbox" class="pl-toggle" ${item.enabled ? 'checked' : ''} title="Toggle in Playlist Queue" />
        <div class="pl-thumb">${getMapThumbnailSvg(item.id)}</div>
        <div class="pl-meta">
          <div class="pl-name">${item.enabled ? `#${item.queueIdx + 1} ` : ''}${meta.name}</div>
          <div class="pl-sub">${meta.sizeClass} · ${meta.setting}</div>
        </div>
        <div class="pl-order-btns">
          <button type="button" class="pl-btn-up" ${!item.enabled || item.queueIdx === 0 ? 'disabled' : ''} title="Move Up">▲</button>
          <button type="button" class="pl-btn-down" ${!item.enabled || item.queueIdx === activeQueue.length - 1 ? 'disabled' : ''} title="Move Down">▼</button>
        </div>
      `;

      const toggleInp = row.querySelector('.pl-toggle') as HTMLInputElement;
      toggleInp.addEventListener('change', () => {
        this.mapRegistry.toggleMapInPlaylist(item.id);
        this.renderPlaylistEditor();
        this.callbacks.onPlaylistChanged();
      });

      const upBtn = row.querySelector('.pl-btn-up') as HTMLButtonElement;
      upBtn.addEventListener('click', () => {
        if (item.enabled) {
          this.mapRegistry.moveMapInPlaylist(item.queueIdx, -1);
          this.renderPlaylistEditor();
          this.callbacks.onPlaylistChanged();
        }
      });

      const downBtn = row.querySelector('.pl-btn-down') as HTMLButtonElement;
      downBtn.addEventListener('click', () => {
        if (item.enabled) {
          this.mapRegistry.moveMapInPlaylist(item.queueIdx, 1);
          this.renderPlaylistEditor();
          this.callbacks.onPlaylistChanged();
        }
      });

      listEl.appendChild(row);
    });
  }

  setPaused(paused: boolean, statusMessage?: string): void {
    // Only show Sandbox Lobby if we aren't on the End-of-Run overlay
    if (this.eorOverlayEl.style.display === 'flex' && paused) {
      this.overlayEl.style.display = 'none';
      return;
    }
    this.overlayEl.style.display = paused ? 'flex' : 'none';
    if (statusMessage) this.lockStatusEl.textContent = statusMessage;
  }

  setOperatorCallsign(callsign: string): void {
    const clean = (callsign || 'GHOST-01').trim().toUpperCase();
    this.lobbyOperatorCallsignEl.textContent = `OPERATOR: ${clean}`;
  }

  setSpectatorHidden(hidden: boolean): void {
    this.hudRootEl.style.display = hidden ? 'none' : 'block';
    this.reticleCanvas.style.display = hidden ? 'none' : 'block';
    if (hidden) {
      this.overlayEl.style.display = 'none';
      this.eorOverlayEl.style.display = 'none';
    }
  }

  isLobbyVisible(): boolean {
    return this.overlayEl.style.display !== 'none';
  }

  isEndOfRunVisible(): boolean {
    return this.eorOverlayEl.style.display === 'flex';
  }

  clearDamageIndicators(): void {
    this.damageIndicators.length = 0;
    this.damageFlashEl.style.opacity = '0';
    this.lowHpVignetteEl.style.opacity = '0';
  }

  showEndOfRunOverlay(summary: MatchStatsSummary): void {
    this.overlayEl.style.display = 'none';
    this.eorOverlayEl.style.display = 'flex';

    const isVictory = summary.outcome === 'victory_target_reached';
    this.eorTitleEl.textContent = isVictory
      ? 'VICTORY // TARGET ELIMINATIONS ACHIEVED'
      : 'KILLED IN ACTION // PERMADEATH';
    this.eorTitleEl.className = `eor-title ${isVictory ? 'victory' : 'kia'}`;
    this.eorSubEl.textContent = `${summary.mapMeta.name.toUpperCase()} · ${summary.mapMeta.sizeClass.toUpperCase()} · ${summary.mapMeta.setting.toUpperCase()}`;

    if (summary.killerInfo && !isVictory) {
      this.eorKillerCardEl.style.display = 'block';
      const main = this.eorKillerCardEl.querySelector('#eor-killer-main') as HTMLElement;
      const meta = this.eorKillerCardEl.querySelector('#eor-killer-meta') as HTMLElement;
      main.textContent = summary.killerInfo.killerName;
      meta.textContent = `${summary.killerInfo.weaponName} · ${summary.killerInfo.distanceMeters.toFixed(1)}m`;
    } else {
      this.eorKillerCardEl.style.display = 'none';
    }

    this.eorSurvivalEl.textContent = formatSurvivalTime(summary.survivalTimeSec);
    this.eorKillsEl.textContent =
      summary.victoryKillTarget > 0
        ? `${summary.totalKills} / ${summary.victoryKillTarget}`
        : `${summary.totalKills}`;
    this.eorAccuracyEl.textContent = `${summary.accuracyPct.toFixed(1)}%`;
    this.eorHeadshotEl.textContent = `${summary.headshotPct.toFixed(1)}%`;
    this.eorScavengedEl.textContent = summary.weaponsScavenged.toString();

    this.eorScoreboardBodyEl.innerHTML = summary.scoreboard
      .map(
        (row, idx) => `
        <tr class="${row.isPlayer ? 'player-row' : ''}">
          <td>${idx + 1}</td>
          <td><b>${row.name}</b></td>
          <td>${row.roleLabel}</td>
          <td><span class="sb-weapon">${row.weaponShortName}</span></td>
          <td><b>${row.kills}</b></td>
          <td>${row.deaths}</td>
          <td>${row.headshots}</td>
          <td>${row.kdRatio}</td>
          <td><span class="sb-status ${row.alive ? 'alive' : 'kia'}">${row.alive ? 'ACTIVE' : 'KIA'}</span></td>
        </tr>
      `,
      )
      .join('');

    this.eorNextMapThumbEl.innerHTML = getMapThumbnailSvg(summary.nextPlaylistMapMeta.id);
    this.eorNextMapNameEl.textContent = `${summary.nextPlaylistMapMeta.name} (${summary.nextPlaylistMapMeta.sizeClass})`;
  }

  hideEndOfRunOverlay(): void {
    this.eorOverlayEl.style.display = 'none';
  }

  pushKillFeed(ev: KillFeedEvent): void {
    const row = document.createElement('div');
    row.className = `kill-feed-row ${ev.killerIsPlayer ? 'by-player' : ''} ${ev.victimIsPlayer ? 'on-player' : ''}`;
    const hsBadge = ev.headshot ? `<span class="kf-hs" title="Headshot">⌖</span>` : '';
    row.innerHTML = `
      <span class="kf-killer ${ev.killerIsPlayer ? 'me' : 'bot'}">${ev.killerName}</span>
      <span class="kf-weapon">
        ${weaponSilhouetteSvg(ev.weaponDef)}
        <small>${ev.weaponDef.shortName}</small>
        ${hsBadge}
      </span>
      <span class="kf-victim ${ev.victimIsPlayer ? 'me' : 'bot'}">${ev.victimName}</span>
    `;
    this.killFeedEl.prepend(row);
    while (this.killFeedEl.children.length > 6) {
      this.killFeedEl.lastElementChild?.remove();
    }
    window.setTimeout(() => row.remove(), 5500);
  }

  /**
   * Flashes damage screen border and pushes a directional red damage indicator toward `attackerPos`.
   */
  notifyPlayerDamaged(dmg: number, killed: boolean, attackerPos?: THREE.Vector3): void {
    this.damageFlashEl.style.opacity = killed ? '0.78' : '0.45';
    window.setTimeout(() => {
      this.damageFlashEl.style.opacity = '0';
    }, 180);

    if (attackerPos) {
      this.damageIndicators.push({
        attackerX: attackerPos.x,
        attackerZ: attackerPos.z,
        damage: dmg,
        age: 0,
        maxAge: 1.15,
      });
      while (this.damageIndicators.length > 6) {
        this.damageIndicators.shift();
      }
    }
  }

  /**
   * Crisp Hitmarker Feedback:
   *  - White = Body / Limb
   *  - Red = Headshot
   *  - Red X + Elimination Audio Chime = Elimination
   */
  notifyHit(damage: number, zone: 'head' | 'body' | 'limb', distance: number, killed: boolean): void {
    this.hitmarkerTimer = killed ? 0.32 : 0.18;
    this.hitmarkerHead = zone === 'head';
    this.hitmarkerKill = killed;

    const item = document.createElement('div');
    item.className = `hit-entry ${zone === 'head' ? 'head' : ''} ${killed ? 'kill' : ''}`;
    const tag = killed ? 'ELIMINATED // WEAPON DROPPED' : zone.toUpperCase();
    item.textContent = `+${damage} ${tag} (${distance.toFixed(0)}m)`;
    this.pushLogItem(item, 2400);
  }

  notifyScavenge(weaponName: string, rounds: number): void {
    const item = document.createElement('div');
    item.className = 'hit-entry scavenge';
    item.textContent = `SCAVENGED +${rounds} RDS (${weaponName})`;
    this.pushLogItem(item, 2800);
  }

  notifySwap(newWeaponName: string, mag: number, reserve: number): void {
    const item = document.createElement('div');
    item.className = 'hit-entry swap';
    item.textContent = `EQUIPPED ${newWeaponName} (${mag} / ${reserve})`;
    this.pushLogItem(item, 2600);
  }

  private pushLogItem(item: HTMLElement, durationMs: number): void {
    this.hitLogEl.prepend(item);
    while (this.hitLogEl.children.length > 6) {
      this.hitLogEl.lastElementChild?.remove();
    }
    window.setTimeout(() => item.remove(), durationMs);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.reticleCanvas.width = Math.floor(window.innerWidth * dpr);
    this.reticleCanvas.height = Math.floor(window.innerHeight * dpr);
    this.reticleCanvas.style.width = `${window.innerWidth}px`;
    this.reticleCanvas.style.height = `${window.innerHeight}px`;
    this.reticleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  update(p: HUDUpdatePayload): void {
    this.fpsVal.textContent = Math.round(p.fps).toString();
    this.frameVal.textContent = p.frameMs.toFixed(1);

    if (this.lastMapId !== p.mapId) {
      this.lastMapId = p.mapId;
      this.mapBadgeEl.textContent = `${p.mapName.toUpperCase()} · ${p.mapSubtitle}`;
      if (this.mapSelectEl.value !== p.mapId) {
        this.mapSelectEl.value = p.mapId;
      }
    }

    this.runTimerEl.textContent = formatSurvivalTime(p.survivalTimeSec);
    this.runKillsEl.textContent =
      p.victoryKillTarget > 0 ? `${p.totalKills} / ${p.victoryKillTarget}` : `${p.totalKills} (ENDLESS)`;

    this.spawnShieldEl.style.display = p.spawnProtected ? 'block' : 'none';

    // 1.2s Slow-Motion Killcam Banner
    if (p.matchPhase === 'death_cam' && p.killerInfo) {
      this.killcamBannerEl.style.display = 'flex';
      this.killcamInfoEl.textContent = `ELIMINATED BY ${p.killerInfo.killerName} · ${p.killerInfo.weaponName.toUpperCase()} · ${p.killerInfo.distanceMeters.toFixed(1)}m`;
      this.killcamFillEl.style.width = `${(p.deathCamProgress * 100).toFixed(1)}%`;
    } else {
      this.killcamBannerEl.style.display = 'none';
    }

    this.speedVal.textContent = p.speed.toFixed(1);
    const cap = MOVEMENT_CONFIG.sprintSpeed * MOVEMENT_CONFIG.momentumCapMult;
    const pct = Math.min(100, (p.speed / cap) * 100);
    this.speedFill.style.width = `${pct.toFixed(1)}%`;
    this.speedFill.style.background =
      p.speed > MOVEMENT_CONFIG.sprintSpeed + 0.15
        ? 'linear-gradient(90deg, #27d8ff, #ffae2b)'
        : 'linear-gradient(90deg, #32d296, #27d8ff)';
    this.stateBadge.textContent = p.stateLabel;
    this.stateBadge.dataset.state = p.stateLabel;

    if (this.lastWeaponId !== p.weapon.id) {
      this.lastWeaponId = p.weapon.id;
      this.weaponNameEl.textContent = p.weapon.name;
      this.weaponSubEl.textContent = `${p.weapon.caliber} · ${fireModeLabel(p.weapon)} · ${p.weapon.fire.rpm} RPM`;
      this.opticBadgeEl.textContent = `${p.weapon.ads.opticName} · ${p.weapon.ads.magnification.toFixed(2).replace(/\.00$/, '.0')}x (${p.weapon.ads.timeMs}ms ADS)`;
    }

    // Update 2-slot loadout bar ([1] Primary & [2] Sidearm)
    this.primarySlotEl.classList.toggle('active', p.activeSlot === 'primary');
    this.secondarySlotEl.classList.toggle('active', p.activeSlot === 'secondary');
    this.primarySlotNameEl.textContent = p.primaryWeapon.shortName;
    this.primarySlotAmmoEl.textContent = `${p.primaryMag} / ${p.primaryReserve}`;
    this.secondarySlotNameEl.textContent = p.secondaryWeapon.shortName;
    this.secondarySlotAmmoEl.textContent = `${p.secondaryMag} / ${p.secondaryReserve}`;

    this.magEl.textContent = p.mag.toString();
    this.magEl.classList.toggle('low', p.mag <= Math.ceil(p.weapon.ammo.magSize * 0.25));
    this.reserveEl.textContent = p.reserve.toString();

    const hpClamped = Math.max(0, Math.round(p.health));
    this.hpNumEl.textContent = hpClamped.toString();
    this.hpFillEl.style.width = `${hpClamped}%`;

    // Low-health vignette pulse (when 0 < HP <= 35)
    if (hpClamped > 0 && hpClamped <= 35) {
      this.lowHpPulseClock += p.dt * (5.5 + (35 - hpClamped) * 0.18);
      const pulse = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(this.lowHpPulseClock));
      this.lowHpVignetteEl.style.opacity = pulse.toFixed(2);
    } else {
      this.lowHpVignetteEl.style.opacity = '0';
    }

    if (p.pickupPrompt && p.matchPhase === 'playing') {
      this.pickupPromptEl.style.display = 'block';
      this.pickupPromptEl.textContent = p.pickupPrompt;
    } else {
      this.pickupPromptEl.style.display = 'none';
    }

    if (p.weaponState === 'reloading' || p.weaponState === 'cycling') {
      this.reloadBarWrap.style.opacity = '1';
      this.reloadLabel.textContent = p.weaponState === 'reloading' ? 'RELOADING' : 'CYCLING BOLT';
      this.reloadBarFill.style.width = `${(p.stateProgress * 100).toFixed(1)}%`;
    } else {
      this.reloadBarWrap.style.opacity = '0';
    }

    this.hitmarkerTimer = Math.max(0, this.hitmarkerTimer - p.dt);
    for (let i = this.damageIndicators.length - 1; i >= 0; i--) {
      this.damageIndicators[i].age += p.dt;
      if (this.damageIndicators[i].age >= this.damageIndicators[i].maxAge) {
        this.damageIndicators.splice(i, 1);
      }
    }

    this.drawReticle(p);
  }

  private drawReticle(p: HUDUpdatePayload): void {
    const g = this.reticleCtx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = w * 0.5;
    const cy = h * 0.5;
    g.clearRect(0, 0, w, h);

    // 1. Directional Red Damage Indicators around center screen
    if (this.damageIndicators.length > 0) {
      const fwdX = -Math.sin(p.playerYaw);
      const fwdZ = -Math.cos(p.playerYaw);
      const rightX = Math.cos(p.playerYaw);
      const rightZ = -Math.sin(p.playerYaw);
      const radius = Math.min(w, h) * 0.17;

      for (const ind of this.damageIndicators) {
        const dx = ind.attackerX - p.playerPos.x;
        const dz = ind.attackerZ - p.playerPos.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const nx = dx / len;
        const nz = dz / len;

        // Screen-space angle where 0 is Up (-Y on canvas = forward in world), +PI/2 is Right (+X)
        const forwardDot = nx * fwdX + nz * fwdZ;
        const rightDot = nx * rightX + nz * rightZ;
        const angle = Math.atan2(rightDot, forwardDot) - Math.PI * 0.5;
        const alpha = Math.max(0, 1 - ind.age / ind.maxAge);

        g.save();
        g.globalAlpha = alpha * 0.9;
        g.strokeStyle = '#ff2a1f';
        g.fillStyle = '#ff2a1f';
        g.shadowColor = '#ff2a1f';
        g.shadowBlur = 10;
        g.lineWidth = 5.5;

        const arcSpan = 0.34;
        g.beginPath();
        g.arc(cx, cy, radius, angle - arcSpan, angle + arcSpan);
        g.stroke();

        // Outer chevron tip pointing toward attacker
        const tipR = radius + 12;
        const baseR = radius + 3;
        const tipX = cx + Math.cos(angle) * tipR;
        const tipY = cy + Math.sin(angle) * tipR;
        const leftX = cx + Math.cos(angle - 0.09) * baseR;
        const leftY = cy + Math.sin(angle - 0.09) * baseR;
        const rightTipX = cx + Math.cos(angle + 0.09) * baseR;
        const rightTipY = cy + Math.sin(angle + 0.09) * baseR;
        g.beginPath();
        g.moveTo(tipX, tipY);
        g.lineTo(leftX, leftY);
        g.lineTo(rightTipX, rightTipY);
        g.closePath();
        g.fill();
        g.restore();
      }
    }

    // 2. Dynamic Hip-Fire Crosshair (fades out as ADS approaches 1)
    const hipAlpha = Math.max(0, 1 - p.adsEase * 1.35);
    if (hipAlpha > 0.01) {
      const vfovRad = (p.vfovDeg * Math.PI) / 180;
      const spreadRad = (p.spreadDeg * Math.PI) / 180;
      const focalPx = (h * 0.5) / Math.tan(vfovRad * 0.5);
      const gap = Math.max(5, Math.min(120, Math.tan(spreadRad) * focalPx));
      const len = 9;

      g.save();
      g.globalAlpha = hipAlpha * 0.92;
      g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      g.lineWidth = 3.5;
      this.strokeCrossLines(g, cx, cy, gap, len);

      g.strokeStyle = '#e8f7ff';
      g.lineWidth = 1.6;
      this.strokeCrossLines(g, cx, cy, gap, len);

      if (p.weapon.damage.pellets > 1) {
        const pelletRad = ((p.weapon.spread.pelletSpreadHip * 0.5) * Math.PI) / 180;
        const ringR = Math.tan(pelletRad) * focalPx;
        g.beginPath();
        g.arc(cx, cy, ringR, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(232, 247, 255, 0.32)';
        g.lineWidth = 1.2;
        g.stroke();
      }
      g.restore();
    }

    // 3. Clean Optical Reticle in ADS
    if (p.adsEase > 0.15) {
      const a = Math.min(1, (p.adsEase - 0.15) / 0.65);
      this.drawOpticReticle(g, cx, cy, w, h, p.weapon.ads.optic, p.weapon.ads.reticleColor, a, p.weapon.ads.magnification);
    }

    // 4. Crisp Hitmarkers: White = Body, Red = Headshot, Red X = Elimination
    if (this.hitmarkerTimer > 0) {
      const a = Math.min(1, this.hitmarkerTimer / 0.12);
      g.save();
      g.globalAlpha = a;
      const isRed = this.hitmarkerKill || this.hitmarkerHead;
      const color = isRed ? '#ff2c1e' : '#ffffff';
      g.strokeStyle = color;
      g.lineWidth = this.hitmarkerKill ? 3.0 : this.hitmarkerHead ? 2.4 : 2.0;
      if (isRed) {
        g.shadowColor = '#ff2c1e';
        g.shadowBlur = this.hitmarkerKill ? 10 : 5;
      }

      const inner = 5;
      const outer = this.hitmarkerKill ? 17 : 12;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          g.beginPath();
          g.moveTo(cx + sx * inner, cy + sy * inner);
          g.lineTo(cx + sx * outer, cy + sy * outer);
          g.stroke();
        }
      }

      // Extra outer elimination Red X accents on kill
      if (this.hitmarkerKill) {
        g.lineWidth = 1.6;
        const kIn = 10;
        const kOut = 22;
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            g.beginPath();
            g.moveTo(cx + sx * kIn, cy + sy * (kIn - 3));
            g.lineTo(cx + sx * kOut, cy + sy * (kOut - 3));
            g.stroke();
          }
        }
      }
      g.restore();
    }
  }

  private strokeCrossLines(g: CanvasRenderingContext2D, cx: number, cy: number, gap: number, len: number): void {
    g.beginPath();
    g.moveTo(cx - gap - len, cy);
    g.lineTo(cx - gap, cy);
    g.moveTo(cx + gap, cy);
    g.lineTo(cx + gap + len, cy);
    g.moveTo(cx, cy - gap - len);
    g.lineTo(cx, cy - gap);
    g.moveTo(cx, cy + gap);
    g.lineTo(cx, cy + gap + len);
    g.stroke();
  }

  private drawOpticReticle(
    g: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    w: number,
    h: number,
    optic: OpticType,
    color: string,
    alpha: number,
    magnification: number,
  ): void {
    g.save();
    g.globalAlpha = alpha;

    if (optic === 'dmr_scope' || optic === 'sniper_scope') {
      const r = Math.min(w, h) * 0.42;

      g.save();
      g.beginPath();
      g.rect(0, 0, w, h);
      g.arc(cx, cy, r, 0, Math.PI * 2, true);
      g.fillStyle = 'rgba(4, 6, 9, 0.94)';
      g.fill();
      g.restore();

      g.strokeStyle = '#181c22';
      g.lineWidth = 10;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();

      const lensGrad = g.createRadialGradient(cx, cy, r * 0.65, cx, cy, r);
      lensGrad.addColorStop(0, 'rgba(0,0,0,0)');
      lensGrad.addColorStop(1, 'rgba(8, 22, 34, 0.42)');
      g.fillStyle = lensGrad;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();

      g.strokeStyle = 'rgba(18, 22, 26, 0.9)';
      g.lineWidth = 1.25;
      g.beginPath();
      g.moveTo(cx - r, cy);
      g.lineTo(cx + r, cy);
      g.moveTo(cx, cy - r);
      g.lineTo(cx, cy + r);
      g.stroke();

      g.lineWidth = 3.6;
      g.beginPath();
      g.moveTo(cx - r, cy);
      g.lineTo(cx - r * 0.36, cy);
      g.moveTo(cx + r * 0.36, cy);
      g.lineTo(cx + r, cy);
      g.moveTo(cx, cy + r * 0.36);
      g.lineTo(cx, cy + r);
      g.stroke();

      g.lineWidth = 1.3;
      const step = r * 0.065;
      for (let i = 1; i <= 5; i++) {
        const off = i * step;
        const tick = i % 2 === 0 ? 6 : 3.5;
        g.beginPath();
        g.moveTo(cx - tick, cy + off);
        g.lineTo(cx + tick, cy + off);
        g.moveTo(cx - off, cy - 3);
        g.lineTo(cx - off, cy + 3);
        g.moveTo(cx + off, cy - 3);
        g.lineTo(cx + off, cy + 3);
        g.stroke();
      }

      g.fillStyle = color;
      g.shadowColor = color;
      g.shadowBlur = 8;
      g.beginPath();
      g.arc(cx, cy, optic === 'sniper_scope' ? 2.1 : 2.6, 0, Math.PI * 2);
      g.fill();

      g.shadowBlur = 0;
      g.fillStyle = 'rgba(220, 238, 255, 0.72)';
      g.font = 'bold 12px Consolas, monospace';
      g.fillText(`${magnification.toFixed(1)}x OPTIC // ZERO 100M`, cx - r * 0.32, cy + r * 0.74);
      g.restore();
      return;
    }

    g.strokeStyle = color;
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 7;

    if (optic === 'holo') {
      const ringR = 22;
      g.lineWidth = 1.7;
      g.beginPath();
      g.arc(cx, cy, ringR, 0, Math.PI * 2);
      g.stroke();

      const tIn = ringR - 4;
      const tOut = ringR + 5;
      g.beginPath();
      g.moveTo(cx - tOut, cy);
      g.lineTo(cx - tIn, cy);
      g.moveTo(cx + tIn, cy);
      g.lineTo(cx + tOut, cy);
      g.moveTo(cx, cy - tOut);
      g.lineTo(cx, cy - tIn);
      g.moveTo(cx, cy + tIn);
      g.lineTo(cx, cy + tOut);
      g.stroke();

      g.beginPath();
      g.arc(cx, cy, 2.0, 0, Math.PI * 2);
      g.fill();
    } else if (optic === 'prism') {
      g.lineWidth = 2.0;
      g.beginPath();
      g.moveTo(cx - 7, cy + 6);
      g.lineTo(cx, cy);
      g.lineTo(cx + 7, cy + 6);
      g.stroke();

      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(cx, cy + 9);
      g.lineTo(cx, cy + 36);
      for (const yOff of [16, 24, 32]) {
        g.moveTo(cx - 4, cy + yOff);
        g.lineTo(cx + 4, cy + yOff);
      }
      g.stroke();
    } else {
      const r = optic === 'rmr' ? 2.6 : 2.2;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
    }

    g.restore();
  }
}
