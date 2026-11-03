/**
 * WeaponDatabase — authoritative data schema for the military roster.
 *
 * Units:
 *  - Angles (spread / recoil) are in DEGREES.
 *  - Distances in METRES, times in SECONDS (ADS time in milliseconds).
 *  - Damage is in hit points (player / bot health = 100).
 */

export type WeaponId =
  | 'm4a1_sopmod'
  | 'ak105_zenit'
  | 'mp7a1_navy'
  | 'vector_45'
  | 'm1014_breacher'
  | 'mk14_ebr'
  | 'awm_338'
  | 'm249_saw'
  | 'glock19';

export type WeaponClass = 'assault_rifle' | 'smg' | 'shotgun' | 'dmr' | 'sniper' | 'lmg' | 'pistol';
export type FireMode = 'auto' | 'semi' | 'bolt';
export type ReloadStyle = 'magazine' | 'shell';
export type OpticType = 'reflex' | 'holo' | 'prism' | 'rmr' | 'dmr_scope' | 'sniper_scope';
export type HitZone = 'head' | 'body' | 'limb';

export interface ShotSoundProfile {
  /** Low-frequency body thump (Hz). */
  thump: number;
  /** Centre frequency of the supersonic crack (Hz). */
  crack: number;
  /** Main decay time (s). */
  decay: number;
  /** Output gain (0..1). */
  gain: number;
  /** Reverb-like tail length (s). */
  tail: number;
  suppressed?: boolean;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  shortName: string;
  weaponClass: WeaponClass;
  slot: 'primary' | 'secondary';
  caliber: string;
  description: string;

  damage: {
    base: number;
    headMultiplier: number;
    limbMultiplier: number;
    /** Damage begins to fall off at this range. */
    falloffStart: number;
    /** Damage reaches minMultiplier at this range. */
    falloffEnd: number;
    minMultiplier: number;
    /** Projectiles per trigger pull (8 for buckshot). */
    pellets: number;
  };

  fire: {
    mode: FireMode;
    rpm: number;
    maxRange: number;
  };

  ammo: {
    magSize: number;
    /** Spare magazines carried at spawn (ARCHITECTURE: scarce = 2). */
    reserveMags: number;
    reloadStyle: ReloadStyle;
    reloadTime: number;
    reloadEmptyTime: number;
    /** Shell-by-shell reload timings (shotgun). */
    shellReloadStart: number;
    shellReloadPerShell: number;
    shellReloadEnd: number;
    /** Bolt-action cycle time after each shot. */
    boltCycleTime: number;
  };

  spread: {
    /** Standing still hip-fire cone (degrees, full-angle radius). */
    hipBase: number;
    /** Added at base run speed (scales with speed). */
    hipMoveAdd: number;
    /** Added while airborne. */
    hipAirAdd: number;
    /** Multiplier while crouched & grounded. */
    crouchMult: number;
    bloomPerShot: number;
    bloomMax: number;
    /** Bloom recovery (degrees / second). */
    bloomRecovery: number;
    /** Buckshot pattern cone (independent of aim spread). */
    pelletSpreadHip: number;
    pelletSpreadAds: number;
  };

  recoil: {
    /** Vertical camera kick per shot (deg). */
    vertical: number;
    /** Random horizontal kick range per shot (deg). */
    horizontal: number;
    /** Constant horizontal drift per shot (deg, +right). */
    horizontalBias: number;
    firstShotMult: number;
    /** Exponential recovery rate (1/s). */
    recovery: number;
    adsMult: number;
    /** Viewmodel push-back (m) and pitch kick (rad) per shot. */
    viewmodelKickZ: number;
    viewmodelKickRot: number;
  };

  ads: {
    /** Time to fully aim, 150..220 ms. */
    timeMs: number;
    /** Optical magnification (1.1x reflex .. 6.0x sniper). */
    magnification: number;
    optic: OpticType;
    opticName: string;
    reticleColor: string;
    /** Movement speed multiplier while fully aimed. */
    moveSpeedMult: number;
    /** Full-screen scope overlay (viewmodel hidden when fully aimed). */
    fullscreenScope: boolean;
  };

  handling: {
    moveSpeedMult: number;
    equipTime: number;
  };

  fx: {
    muzzleFlashScale: number;
    tracerColor: [number, number, number];
    /** Draw a tracer every N rounds (1 = every round). */
    tracerEvery: number;
    sound: ShotSoundProfile;
  };
}

const shellDefaults = { shellReloadStart: 0, shellReloadPerShell: 0, shellReloadEnd: 0, boltCycleTime: 0 };

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  m4a1_sopmod: {
    id: 'm4a1_sopmod',
    name: 'M4A1 SOPMOD',
    shortName: 'M4A1',
    weaponClass: 'assault_rifle',
    slot: 'primary',
    caliber: '5.56x45mm NATO',
    description: 'Balanced carbine. Holographic sight, vertical grip, PEQ-15.',
    damage: { base: 28, headMultiplier: 2.0, limbMultiplier: 0.85, falloffStart: 35, falloffEnd: 70, minMultiplier: 0.75, pellets: 1 },
    fire: { mode: 'auto', rpm: 800, maxRange: 400 },
    ammo: { magSize: 30, reserveMags: 2, reloadStyle: 'magazine', reloadTime: 2.1, reloadEmptyTime: 2.6, ...shellDefaults },
    spread: { hipBase: 0.9, hipMoveAdd: 1.3, hipAirAdd: 3.5, crouchMult: 0.75, bloomPerShot: 0.22, bloomMax: 2.4, bloomRecovery: 7, pelletSpreadHip: 0, pelletSpreadAds: 0 },
    recoil: { vertical: 0.55, horizontal: 0.22, horizontalBias: 0.04, firstShotMult: 1.3, recovery: 9, adsMult: 0.7, viewmodelKickZ: 0.022, viewmodelKickRot: 0.03 },
    ads: { timeMs: 180, magnification: 1.25, optic: 'holo', opticName: 'EOTech EXPS3 Holographic', reticleColor: '#ff3a2a', moveSpeedMult: 0.65, fullscreenScope: false },
    handling: { moveSpeedMult: 0.97, equipTime: 0.45 },
    fx: { muzzleFlashScale: 1.0, tracerColor: [1.0, 0.75, 0.35], tracerEvery: 2, sound: { thump: 95, crack: 2400, decay: 0.11, gain: 0.55, tail: 0.5 } },
  },

  ak105_zenit: {
    id: 'ak105_zenit',
    name: 'AK-105 Zenit',
    shortName: 'AK-105',
    weaponClass: 'assault_rifle',
    slot: 'primary',
    caliber: '5.45x39mm',
    description: 'Hard-hitting short AK with Zenitco furniture and reflex optic.',
    damage: { base: 33, headMultiplier: 2.0, limbMultiplier: 0.85, falloffStart: 30, falloffEnd: 65, minMultiplier: 0.72, pellets: 1 },
    fire: { mode: 'auto', rpm: 620, maxRange: 400 },
    ammo: { magSize: 30, reserveMags: 2, reloadStyle: 'magazine', reloadTime: 2.3, reloadEmptyTime: 2.85, ...shellDefaults },
    spread: { hipBase: 1.1, hipMoveAdd: 1.5, hipAirAdd: 3.8, crouchMult: 0.75, bloomPerShot: 0.3, bloomMax: 2.8, bloomRecovery: 6.5, pelletSpreadHip: 0, pelletSpreadAds: 0 },
    recoil: { vertical: 0.82, horizontal: 0.36, horizontalBias: -0.07, firstShotMult: 1.25, recovery: 8, adsMult: 0.75, viewmodelKickZ: 0.028, viewmodelKickRot: 0.04 },
    ads: { timeMs: 200, magnification: 1.1, optic: 'reflex', opticName: 'Zenit-B reflex', reticleColor: '#ff2f2f', moveSpeedMult: 0.63, fullscreenScope: false },
    handling: { moveSpeedMult: 0.96, equipTime: 0.5 },
    fx: { muzzleFlashScale: 1.25, tracerColor: [0.6, 1.0, 0.45], tracerEvery: 2, sound: { thump: 80, crack: 1900, decay: 0.13, gain: 0.6, tail: 0.55 } },
  },

  mp7a1_navy: {
    id: 'mp7a1_navy',
    name: 'MP7A1 Navy',
    shortName: 'MP7A1',
    weaponClass: 'smg',
    slot: 'primary',
    caliber: '4.6x30mm',
    description: 'Suppressed PDW. Blistering rate of fire, laser-like hip-fire.',
    damage: { base: 22, headMultiplier: 1.8, limbMultiplier: 0.9, falloffStart: 15, falloffEnd: 38, minMultiplier: 0.6, pellets: 1 },
    fire: { mode: 'auto', rpm: 950, maxRange: 250 },
    ammo: { magSize: 40, reserveMags: 2, reloadStyle: 'magazine', reloadTime: 1.9, reloadEmptyTime: 2.3, ...shellDefaults },
    spread: { hipBase: 0.75, hipMoveAdd: 0.7, hipAirAdd: 2.5, crouchMult: 0.8, bloomPerShot: 0.14, bloomMax: 1.8, bloomRecovery: 8, pelletSpreadHip: 0, pelletSpreadAds: 0 },
    recoil: { vertical: 0.36, horizontal: 0.2, horizontalBias: 0.02, firstShotMult: 1.1, recovery: 11, adsMult: 0.75, viewmodelKickZ: 0.014, viewmodelKickRot: 0.018 },
    ads: { timeMs: 150, magnification: 1.1, optic: 'reflex', opticName: 'Aimpoint T-2 micro', reticleColor: '#ff3030', moveSpeedMult: 0.75, fullscreenScope: false },
    handling: { moveSpeedMult: 1.03, equipTime: 0.35 },
    fx: { muzzleFlashScale: 0.25, tracerColor: [1.0, 0.8, 0.45], tracerEvery: 3, sound: { thump: 140, crack: 3200, decay: 0.06, gain: 0.32, tail: 0.18, suppressed: true } },
  },

  vector_45: {
    id: 'vector_45',
    name: 'Vector .45',
    shortName: 'VECTOR',
    weaponClass: 'smg',
    slot: 'primary',
    caliber: '.45 ACP',
    description: 'KRISS Super-V recoil mitigation. Highest fire rate in the roster.',
    damage: { base: 24, headMultiplier: 1.8, limbMultiplier: 0.9, falloffStart: 12, falloffEnd: 32, minMultiplier: 0.55, pellets: 1 },
    fire: { mode: 'auto', rpm: 1100, maxRange: 220 },
    ammo: { magSize: 25, reserveMags: 2, reloadStyle: 'magazine', reloadTime: 2.0, reloadEmptyTime: 2.4, ...shellDefaults },
    spread: { hipBase: 0.8, hipMoveAdd: 0.75, hipAirAdd: 2.6, crouchMult: 0.8, bloomPerShot: 0.12, bloomMax: 2.0, bloomRecovery: 8, pelletSpreadHip: 0, pelletSpreadAds: 0 },
    recoil: { vertical: 0.3, horizontal: 0.16, horizontalBias: 0.03, firstShotMult: 1.1, recovery: 12, adsMult: 0.7, viewmodelKickZ: 0.012, viewmodelKickRot: 0.014 },
    ads: { timeMs: 155, magnification: 1.1, optic: 'reflex', opticName: 'Trijicon MRO', reticleColor: '#ff4040', moveSpeedMult: 0.75, fullscreenScope: false },
    handling: { moveSpeedMult: 1.03, equipTime: 0.35 },
    fx: { muzzleFlashScale: 0.85, tracerColor: [1.0, 0.65, 0.3], tracerEvery: 3, sound: { thump: 110, crack: 1500, decay: 0.08, gain: 0.45, tail: 0.35 } },
  },

  m1014_breacher: {
    id: 'm1014_breacher',
    name: 'M1014 Breacher',
    shortName: 'M1014',
    weaponClass: 'shotgun',
    slot: 'primary',
    caliber: '12 Gauge 00 Buckshot',
    description: 'Semi-auto combat shotgun. 8-pellet 00 buckshot, shell-by-shell reload.',
    damage: { base: 17, headMultiplier: 1.5, limbMultiplier: 0.9, falloffStart: 8, falloffEnd: 24, minMultiplier: 0.3, pellets: 8 },
    fire: { mode: 'semi', rpm: 260, maxRange: 80 },
    ammo: { magSize: 7, reserveMags: 2, reloadStyle: 'shell', reloadTime: 0, reloadEmptyTime: 0, shellReloadStart: 0.35, shellReloadPerShell: 0.48, shellReloadEnd: 0.35, boltCycleTime: 0 },
    spread: { hipBase: 0.6, hipMoveAdd: 0.5, hipAirAdd: 1.5, crouchMult: 0.9, bloomPerShot: 0.3, bloomMax: 1.2, bloomRecovery: 4, pelletSpreadHip: 4.4, pelletSpreadAds: 2.8 },
    recoil: { vertical: 3.0, horizontal: 0.6, horizontalBias: 0, firstShotMult: 1.0, recovery: 10, adsMult: 0.8, viewmodelKickZ: 0.07, viewmodelKickRot: 0.14 },
    ads: { timeMs: 190, magnification: 1.1, optic: 'reflex', opticName: 'Aimpoint CompM4', reticleColor: '#ff3020', moveSpeedMult: 0.65, fullscreenScope: false },
    handling: { moveSpeedMult: 0.95, equipTime: 0.55 },
    fx: { muzzleFlashScale: 1.6, tracerColor: [1.0, 0.7, 0.35], tracerEvery: 1, sound: { thump: 60, crack: 1100, decay: 0.2, gain: 0.8, tail: 0.8 } },
  },

  mk14_ebr: {
    id: 'mk14_ebr',
    name: 'MK14 EBR',
    shortName: 'MK14',
    weaponClass: 'dmr',
    slot: 'primary',
    caliber: '7.62x51mm NATO',
    description: 'Enhanced Battle Rifle in Sage chassis. Semi-auto, 4x scope.',
    damage: { base: 56, headMultiplier: 2.2, limbMultiplier: 0.85, falloffStart: 60, falloffEnd: 140, minMultiplier: 0.8, pellets: 1 },
    fire: { mode: 'semi', rpm: 380, maxRange: 600 },
    ammo: { magSize: 20, reserveMags: 2, reloadStyle: 'magazine', reloadTime: 2.6, reloadEmptyTime: 3.1, ...shellDefaults },
    spread: { hipBase: 1.6, hipMoveAdd: 1.8, hipAirAdd: 4.5, crouchMult: 0.7, bloomPerShot: 0.8, bloomMax: 3.0, bloomRecovery: 6, pelletSpreadHip: 0, pelletSpreadAds: 0 },
    recoil: { vertical: 1.9, horizontal: 0.45, horizontalBias: 0.05, firstShotMult: 1.0, recovery: 9, adsMult: 0.7, viewmodelKickZ: 0.045, viewmodelKickRot: 0.07 },
    ads: { timeMs: 210, magnification: 4.0, optic: 'dmr_scope', opticName: 'Leupold Mk4 4x', reticleColor: '#ff3020', moveSpeedMult: 0.55, fullscreenScope: true },
    handling: { moveSpeedMult: 0.92, equipTime: 0.6 },
    fx: { muzzleFlashScale: 1.4, tracerColor: [1.0, 0.6, 0.3], tracerEvery: 1, sound: { thump: 70, crack: 1700, decay: 0.16, gain: 0.75, tail: 0.9 } },
  },

  awm_338: {
    id: 'awm_338',
    name: 'AWM .338',
    shortName: 'AWM',
    weaponClass: 'sniper',
    slot: 'primary',
    caliber: '.338 Lapua Magnum',
    description: 'Bolt-action magnum. One-shot kill to the body inside 60 m, any range to the head.',
    damage: { base: 115, headMultiplier: 3.0, limbMultiplier: 0.8, falloffStart: 60, falloffEnd: 200, minMultiplier: 0.8, pellets: 1 },
    fire: { mode: 'bolt', rpm: 45, maxRange: 1000 },
    ammo: { magSize: 5, reserveMags: 2, reloadStyle: 'magazine', reloadTime: 3.0, reloadEmptyTime: 3.6, shellReloadStart: 0, shellReloadPerShell: 0, shellReloadEnd: 0, boltCycleTime: 1.1 },
    spread: { hipBase: 3.2, hipMoveAdd: 3.0, hipAirAdd: 7.0, crouchMult: 0.7, bloomPerShot: 0, bloomMax: 0, bloomRecovery: 6, pelletSpreadHip: 0, pelletSpreadAds: 0 },
    recoil: { vertical: 5.5, horizontal: 0.8, horizontalBias: 0, firstShotMult: 1.0, recovery: 6.5, adsMult: 0.8, viewmodelKickZ: 0.09, viewmodelKickRot: 0.16 },
    ads: { timeMs: 220, magnification: 6.0, optic: 'sniper_scope', opticName: 'Schmidt & Bender 6x', reticleColor: '#ff2a1a', moveSpeedMult: 0.45, fullscreenScope: true },
    handling: { moveSpeedMult: 0.88, equipTime: 0.7 },
    fx: { muzzleFlashScale: 1.8, tracerColor: [1.0, 0.85, 0.5], tracerEvery: 1, sound: { thump: 50, crack: 1300, decay: 0.25, gain: 0.95, tail: 1.4 } },
  },

  m249_saw: {
    id: 'm249_saw',
    name: 'M249 SAW',
    shortName: 'M249',
    weaponClass: 'lmg',
    slot: 'primary',
    caliber: '5.56x45mm NATO (belt)',
    description: 'Belt-fed squad automatic weapon. 100-round box, long reload.',
    damage: { base: 29, headMultiplier: 1.9, limbMultiplier: 0.85, falloffStart: 40, falloffEnd: 80, minMultiplier: 0.75, pellets: 1 },
    fire: { mode: 'auto', rpm: 760, maxRange: 450 },
    ammo: { magSize: 100, reserveMags: 2, reloadStyle: 'magazine', reloadTime: 5.0, reloadEmptyTime: 5.6, ...shellDefaults },
    spread: { hipBase: 1.5, hipMoveAdd: 1.8, hipAirAdd: 4.5, crouchMult: 0.65, bloomPerShot: 0.12, bloomMax: 2.6, bloomRecovery: 5, pelletSpreadHip: 0, pelletSpreadAds: 0 },
    recoil: { vertical: 0.5, horizontal: 0.36, horizontalBias: 0.05, firstShotMult: 1.2, recovery: 8, adsMult: 0.65, viewmodelKickZ: 0.02, viewmodelKickRot: 0.025 },
    ads: { timeMs: 220, magnification: 2.0, optic: 'prism', opticName: 'ELCAN SpecterDR 2x', reticleColor: '#ff3828', moveSpeedMult: 0.5, fullscreenScope: false },
    handling: { moveSpeedMult: 0.85, equipTime: 0.8 },
    fx: { muzzleFlashScale: 1.1, tracerColor: [1.0, 0.4, 0.2], tracerEvery: 1, sound: { thump: 90, crack: 2200, decay: 0.12, gain: 0.6, tail: 0.6 } },
  },

  glock19: {
    id: 'glock19',
    name: 'Glock 19',
    shortName: 'G19',
    weaponClass: 'pistol',
    slot: 'secondary',
    caliber: '9x19mm Parabellum',
    description: 'Compact sidearm with RMR red dot. Fast draw.',
    damage: { base: 25, headMultiplier: 1.9, limbMultiplier: 0.9, falloffStart: 15, falloffEnd: 40, minMultiplier: 0.6, pellets: 1 },
    fire: { mode: 'semi', rpm: 480, maxRange: 200 },
    ammo: { magSize: 17, reserveMags: 2, reloadStyle: 'magazine', reloadTime: 1.5, reloadEmptyTime: 1.8, ...shellDefaults },
    spread: { hipBase: 0.8, hipMoveAdd: 0.8, hipAirAdd: 2.5, crouchMult: 0.8, bloomPerShot: 0.45, bloomMax: 2.2, bloomRecovery: 7, pelletSpreadHip: 0, pelletSpreadAds: 0 },
    recoil: { vertical: 1.1, horizontal: 0.3, horizontalBias: 0, firstShotMult: 1.0, recovery: 12, adsMult: 0.75, viewmodelKickZ: 0.03, viewmodelKickRot: 0.12 },
    ads: { timeMs: 150, magnification: 1.1, optic: 'rmr', opticName: 'Trijicon RMR', reticleColor: '#ff3a2a', moveSpeedMult: 0.8, fullscreenScope: false },
    handling: { moveSpeedMult: 1.06, equipTime: 0.3 },
    fx: { muzzleFlashScale: 0.7, tracerColor: [1.0, 0.75, 0.4], tracerEvery: 2, sound: { thump: 120, crack: 2000, decay: 0.07, gain: 0.45, tail: 0.35 } },
  },
};

/** Keys 1-8 map to this order; key 9 is the sidearm. */
export const PRIMARY_ORDER: WeaponId[] = [
  'm4a1_sopmod',
  'ak105_zenit',
  'mp7a1_navy',
  'vector_45',
  'm1014_breacher',
  'mk14_ebr',
  'awm_338',
  'm249_saw',
];
export const SIDEARM: WeaponId = 'glock19';

export function getWeapon(id: WeaponId): WeaponDef {
  return WEAPONS[id];
}

export function fireModeLabel(def: WeaponDef): string {
  if (def.fire.mode === 'auto') return 'AUTO';
  if (def.fire.mode === 'bolt') return 'BOLT';
  return 'SEMI';
}
