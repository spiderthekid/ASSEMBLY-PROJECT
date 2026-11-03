export interface GameSettings {
  /** Horizontal field of view in degrees (hip-fire). */
  fov: number;
  /** Source-style sensitivity: degrees per mouse count = 0.022 * sensitivity. */
  sensitivity: number;
  /** Multiplier on top of zoom-ratio-matched ADS sensitivity. */
  adsSensitivityMult: number;
  /** Fraction of device pixel ratio used for rendering (0.5 .. 1.5). */
  renderScale: number;
  bloom: boolean;
  showFps: boolean;
  volume: number;
}

const STORAGE_KEY = 'tactical-arena-settings-v1';

export const DEFAULT_SETTINGS: GameSettings = {
  fov: 100,
  sensitivity: 1.5,
  adsSensitivityMult: 1.0,
  renderScale: 1.0,
  bloom: true,
  showFps: true,
  volume: 0.6,
};

/** Degrees of rotation per raw mouse count at sensitivity 1 (Source/CS convention). */
export const DEG_PER_COUNT = 0.022;

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch {
    /* storage unavailable or corrupt — fall back to defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable — settings remain session-only */
  }
}

const DEG = Math.PI / 180;

/** Converts a horizontal FOV to the vertical FOV Three.js cameras expect. */
export function hfovToVfov(hfovDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((hfovDeg * DEG) / 2) / aspect)) / DEG;
}

/** Vertical FOV after applying an optical magnification. */
export function zoomVfov(vfovDeg: number, magnification: number): number {
  return (2 * Math.atan(Math.tan((vfovDeg * DEG) / 2) / magnification)) / DEG;
}
