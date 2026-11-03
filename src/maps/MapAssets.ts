import * as THREE from 'three';

export type MapId =
  | 'killhouse_alpha'
  | 'blacksite_khyber'
  | 'severomorsk_dock'
  | 'bone_yard';

export interface MapMetadata {
  id: MapId;
  name: string;
  codeName: string;
  sizeClass: 'Small' | 'Medium' | 'Medium-Large' | 'Large';
  setting: string;
  description: string;
  lightingProfile: {
    skyColor: number;
    fogColor: number;
    fogDensity: number;
    sunColor: number;
    sunIntensity: number;
    sunPosition: [number, number, number];
    hemiSkyColor: number;
    hemiGroundColor: number;
    hemiIntensity: number;
    exposure: number;
  };
}

export const MAP_ORDER: MapId[] = [
  'killhouse_alpha',
  'blacksite_khyber',
  'severomorsk_dock',
  'bone_yard',
];

export const MAP_DEFINITIONS: Record<MapId, MapMetadata> = {
  killhouse_alpha: {
    id: 'killhouse_alpha',
    name: 'Killhouse Alpha',
    codeName: 'OP-HEREFORD // SAS HANGAR',
    sizeClass: 'Small',
    setting: 'Indoor SAS Tactical Hangar',
    description:
      'Plywood & concrete CQB shoot-house inside a steel hangar with a 2-story central overwatch tower and harsh overhead floodlights.',
    lightingProfile: {
      skyColor: 0x0d1218,
      fogColor: 0x10161f,
      fogDensity: 0.011,
      sunColor: 0xeaf4ff,
      sunIntensity: 2.6,
      sunPosition: [14, 48, 12],
      hemiSkyColor: 0x99b8dc,
      hemiGroundColor: 0x1d2228,
      hemiIntensity: 0.9,
      exposure: 1.05,
    },
  },

  blacksite_khyber: {
    id: 'blacksite_khyber',
    name: 'Black Site Khyber',
    codeName: 'FOB-KHYBER // DUSK',
    sizeClass: 'Medium',
    setting: 'Dusk Mountain Forward Operating Base',
    description:
      'Reinforced concrete bunkers, HESCO bastion walls, a central elevated helipad, and subterranean flank tunnels at twilight.',
    lightingProfile: {
      skyColor: 0x3b2c44,
      fogColor: 0x4b3546,
      fogDensity: 0.0065,
      sunColor: 0xff9b52,
      sunIntensity: 3.4,
      sunPosition: [-52, 28, -36],
      hemiSkyColor: 0xd8886c,
      hemiGroundColor: 0x2b2422,
      hemiIntensity: 0.78,
      exposure: 1.0,
    },
  },

  severomorsk_dock: {
    id: 'severomorsk_dock',
    name: 'Severomorsk Dock',
    codeName: 'PEN-09 // ARCTIC SUB BASE',
    sizeClass: 'Medium-Large',
    setting: 'Snowy Cold-War Submarine Pen',
    description:
      'Multi-tiered rusted steel catwalks and ramps overlooking a recessed drydock floor and a moored Typhoon-class submarine hull.',
    lightingProfile: {
      skyColor: 0x7189a3,
      fogColor: 0x7991aa,
      fogDensity: 0.0058,
      sunColor: 0xd4e8ff,
      sunIntensity: 2.9,
      sunPosition: [40, 44, -30],
      hemiSkyColor: 0xbbd6f2,
      hemiGroundColor: 0x26323d,
      hemiIntensity: 0.92,
      exposure: 1.02,
    },
  },

  bone_yard: {
    id: 'bone_yard',
    name: 'Bone Yard',
    codeName: 'DAVIS-SECTOR // HIGH NOON',
    sizeClass: 'Large',
    setting: 'Desert Aircraft Scrapyard at High Noon',
    description:
      'Sun-bleached C-130 fuselage & wing sections forming a central CQB maze surrounded by an elevated sniper berm perimeter.',
    lightingProfile: {
      skyColor: 0xc2d8ee,
      fogColor: 0xd8c6a8,
      fogDensity: 0.0042,
      sunColor: 0xfff5dc,
      sunIntensity: 3.8,
      sunPosition: [18, 78, 14],
      hemiSkyColor: 0xfff0d2,
      hemiGroundColor: 0x6b563b,
      hemiIntensity: 0.95,
      exposure: 0.96,
    },
  },
};

function makeProceduralPatternTexture(
  opts: {
    baseHex: string;
    grainAlpha: number;
    gridMajorHex?: string;
    gridMinorHex?: string;
    gridDivs?: number;
    stripesHex?: string;
    rivets?: boolean;
  },
  size = 512,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = opts.baseHex;
  g.fillRect(0, 0, size, size);

  // Micro surface grain
  const dots = 3200;
  for (let i = 0; i < dots; i++) {
    g.fillStyle =
      Math.random() > 0.5
        ? `rgba(255,255,255,${opts.grainAlpha})`
        : `rgba(0,0,0,${opts.grainAlpha * 1.25})`;
    g.fillRect(Math.random() * size, Math.random() * size, 3, 3);
  }

  if (opts.stripesHex) {
    g.strokeStyle = opts.stripesHex;
    g.lineWidth = 14;
    for (let i = -size; i < size * 2; i += 48) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + size, size);
      g.stroke();
    }
  }

  const divs = opts.gridDivs ?? 8;
  const step = size / divs;
  if (opts.gridMinorHex) {
    g.strokeStyle = opts.gridMinorHex;
    g.lineWidth = 1.2;
    for (let i = 1; i < divs; i++) {
      g.beginPath();
      g.moveTo(i * step, 0);
      g.lineTo(i * step, size);
      g.moveTo(0, i * step);
      g.lineTo(size, i * step);
      g.stroke();
    }
  }

  if (opts.gridMajorHex) {
    g.strokeStyle = opts.gridMajorHex;
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, size - 3, size - 3);
  }

  if (opts.rivets) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 16; x < size; x += 32) {
      g.beginPath();
      g.arc(x, 12, 2.5, 0, Math.PI * 2);
      g.arc(x, size - 12, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export function makeSignBannerTexture(title: string, subtitle: string, accent = '#e59a28'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#12161c';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = accent;
  g.lineWidth = 6;
  g.strokeRect(5, 5, c.width - 10, c.height - 10);
  g.fillStyle = '#f1f5f9';
  g.font = 'bold 42px Consolas, monospace';
  g.textAlign = 'center';
  g.fillText(title, c.width / 2, 58);
  g.fillStyle = accent;
  g.font = 'bold 22px Consolas, monospace';
  g.fillText(subtitle, c.width / 2, 98);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface MapMaterialLibrary {
  hangarFloor: THREE.MeshStandardMaterial;
  plywood: THREE.MeshStandardMaterial;
  concreteWall: THREE.MeshStandardMaterial;
  darkSteel: THREE.MeshStandardMaterial;
  hazard: THREE.MeshStandardMaterial;
  floodlightEmissive: THREE.MeshBasicMaterial;
  khyberGround: THREE.MeshStandardMaterial;
  bunkerConcrete: THREE.MeshStandardMaterial;
  hescoBastion: THREE.MeshStandardMaterial;
  helipadAsphalt: THREE.MeshStandardMaterial;
  snowConcrete: THREE.MeshStandardMaterial;
  rustedCatwalk: THREE.MeshStandardMaterial;
  subHullSteel: THREE.MeshStandardMaterial;
  drydockBasin: THREE.MeshStandardMaterial;
  desertSand: THREE.MeshStandardMaterial;
  aircraftFuselage: THREE.MeshStandardMaterial;
  aircraftInterior: THREE.MeshStandardMaterial;
  sniperBermRock: THREE.MeshStandardMaterial;
  disposeAll: () => void;
}

export function createMapMaterialLibrary(): MapMaterialLibrary {
  const textures: THREE.Texture[] = [];
  const mats: THREE.Material[] = [];

  const regTex = (t: THREE.CanvasTexture, rx: number, ry: number) => {
    t.repeat.set(rx, ry);
    textures.push(t);
    return t;
  };
  const regMat = <T extends THREE.Material>(m: T): T => {
    mats.push(m);
    return m;
  };

  const hangarFloorTex = regTex(
    makeProceduralPatternTexture({
      baseHex: '#252a30',
      grainAlpha: 0.04,
      gridMajorHex: '#3c444e',
      gridMinorHex: '#2e343c',
    }),
    24,
    24,
  );
  const plywoodTex = regTex(
    makeProceduralPatternTexture({
      baseHex: '#947348',
      grainAlpha: 0.065,
      gridMajorHex: '#6e5230',
      gridMinorHex: '#84653d',
      gridDivs: 4,
    }),
    2,
    2,
  );
  const concreteTex = regTex(
    makeProceduralPatternTexture({
      baseHex: '#454a52',
      grainAlpha: 0.05,
      gridMajorHex: '#5a606a',
      gridMinorHex: '#3c4148',
    }),
    8,
    3,
  );
  const khyberGroundTex = regTex(
    makeProceduralPatternTexture({
      baseHex: '#5a493b',
      grainAlpha: 0.06,
      gridMajorHex: '#6c5848',
      gridMinorHex: '#4f3f33',
    }),
    28,
    28,
  );
  const hescoTex = regTex(
    makeProceduralPatternTexture({
      baseHex: '#887456',
      grainAlpha: 0.07,
      gridMajorHex: '#544836',
      gridMinorHex: '#6f5e45',
      gridDivs: 8,
    }),
    3,
    2,
  );
  const snowFloorTex = regTex(
    makeProceduralPatternTexture({
      baseHex: '#7d8a97',
      grainAlpha: 0.055,
      gridMajorHex: '#5f6c78',
      gridMinorHex: '#6f7d8a',
    }),
    28,
    34,
  );
  const catwalkTex = regTex(
    makeProceduralPatternTexture({
      baseHex: '#4c362c',
      grainAlpha: 0.06,
      gridMajorHex: '#6b4735',
      gridMinorHex: '#392820',
      gridDivs: 12,
      rivets: true,
    }),
    6,
    2,
  );
  const desertSandTex = regTex(
    makeProceduralPatternTexture({
      baseHex: '#b89b6f',
      grainAlpha: 0.065,
      gridMajorHex: '#a6895e',
      gridMinorHex: '#ae9267',
    }),
    36,
    36,
  );
  const fuselageTex = regTex(
    makeProceduralPatternTexture({
      baseHex: '#656d60',
      grainAlpha: 0.05,
      gridMajorHex: '#4a5246',
      gridMinorHex: '#596154',
      gridDivs: 6,
      rivets: true,
    }),
    4,
    2,
  );

  return {
    hangarFloor: regMat(new THREE.MeshStandardMaterial({ map: hangarFloorTex, roughness: 0.72, metalness: 0.12 })),
    plywood: regMat(new THREE.MeshStandardMaterial({ map: plywoodTex, roughness: 0.78, metalness: 0.04 })),
    concreteWall: regMat(new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.7, metalness: 0.1 })),
    darkSteel: regMat(new THREE.MeshStandardMaterial({ color: 0x22272e, roughness: 0.36, metalness: 0.85 })),
    hazard: regMat(new THREE.MeshStandardMaterial({ color: 0xe09224, roughness: 0.44, metalness: 0.25 })),
    floodlightEmissive: regMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 3.8, 4.2) })),
    khyberGround: regMat(new THREE.MeshStandardMaterial({ map: khyberGroundTex, roughness: 0.86, metalness: 0.05 })),
    bunkerConcrete: regMat(new THREE.MeshStandardMaterial({ map: concreteTex, color: 0x827970, roughness: 0.74, metalness: 0.1 })),
    hescoBastion: regMat(new THREE.MeshStandardMaterial({ map: hescoTex, roughness: 0.82, metalness: 0.08 })),
    helipadAsphalt: regMat(new THREE.MeshStandardMaterial({ map: hangarFloorTex, color: 0x33363b, roughness: 0.65, metalness: 0.15 })),
    snowConcrete: regMat(new THREE.MeshStandardMaterial({ map: snowFloorTex, roughness: 0.68, metalness: 0.08 })),
    rustedCatwalk: regMat(new THREE.MeshStandardMaterial({ map: catwalkTex, roughness: 0.52, metalness: 0.72 })),
    subHullSteel: regMat(new THREE.MeshStandardMaterial({ color: 0x1b2128, roughness: 0.38, metalness: 0.78 })),
    drydockBasin: regMat(new THREE.MeshStandardMaterial({ color: 0x222c35, roughness: 0.32, metalness: 0.35 })),
    desertSand: regMat(new THREE.MeshStandardMaterial({ map: desertSandTex, roughness: 0.88, metalness: 0.03 })),
    aircraftFuselage: regMat(new THREE.MeshStandardMaterial({ map: fuselageTex, roughness: 0.45, metalness: 0.62 })),
    aircraftInterior: regMat(new THREE.MeshStandardMaterial({ color: 0x4b5349, roughness: 0.6, metalness: 0.45 })),
    sniperBermRock: regMat(new THREE.MeshStandardMaterial({ map: khyberGroundTex, color: 0x997c56, roughness: 0.85, metalness: 0.05 })),
    disposeAll: () => {
      for (const t of textures) t.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
