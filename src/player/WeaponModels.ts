import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { WeaponId } from '../weapons/WeaponDatabase';

/**
 * Procedural PBR weapon viewmodels. Every weapon is assembled from bevelled boxes
 * and lathed cylinders in real-world metres.
 *
 * Local space convention: bore axis along -Z (muzzle forward), +Y up, +X right.
 */
export interface WeaponModel {
  root: THREE.Group;
  /** Optic centre / line of sight (local). Aligned to screen centre at full ADS. */
  sight: THREE.Vector3;
  muzzle: THREE.Vector3;
  /** Detachable part animated during reload (magazine, belt box or shotgun shell). */
  mag: THREE.Object3D;
  magRest: THREE.Vector3;
  /** Bolt handle (AWM) or slide (Glock) animated on cycling. */
  bolt: THREE.Object3D | null;
  boltRest: THREE.Vector3;
  boltKind: 'none' | 'bolt-action' | 'slide';
  hipOffset: THREE.Vector3;
  /** Distance from the eye to the optic at full ADS. */
  adsDistance: number;
}

// -----------------------------------------------------------------------------
// Materials
// -----------------------------------------------------------------------------

function makeNoiseTexture(size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 175 + Math.random() * 80;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // light directional scratches
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    const x = Math.random() * size;
    const y = Math.random() * size;
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 6);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

let MATS: ReturnType<typeof createMaterials> | null = null;

function createMaterials() {
  const noise = makeNoiseTexture();
  const std = (color: number, roughness: number, metalness: number) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, roughnessMap: noise, envMapIntensity: 1.0 });
  const tube = (color: number) => {
    const m = std(color, 0.5, 0.6);
    m.side = THREE.DoubleSide;
    return m;
  };
  return {
    anodized: std(0x1c1d1f, 0.42, 0.8),
    parkerized: std(0x2a2b2c, 0.55, 0.7),
    steel: std(0x8d9196, 0.28, 1.0),
    darkSteel: std(0x45484c, 0.35, 0.95),
    polymer: std(0x151617, 0.72, 0.0),
    rubber: std(0x0d0d0d, 0.9, 0.0),
    fde: std(0x8c7656, 0.7, 0.05),
    fdeMetal: std(0x8a7558, 0.5, 0.45),
    od: std(0x46503a, 0.68, 0.05),
    awmGreen: std(0x3c4a32, 0.6, 0.1),
    navyGrey: std(0x3c4146, 0.6, 0.2),
    brass: std(0xb58a3c, 0.3, 1.0),
    shellRed: std(0x8e1b16, 0.5, 0.0),
    canvas: std(0x55583f, 0.95, 0.0),
    tubeBlack: tube(0x111214),
    lens: new THREE.MeshStandardMaterial({
      color: 0x6f8fb8, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.16, depthWrite: false,
    }),
    lensCoated: new THREE.MeshStandardMaterial({
      color: 0x203048, roughness: 0.05, metalness: 0.6, emissive: 0x0a1426,
    }),
    laser: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 2.5, 0.4) }),
  };
}

function mats() {
  if (!MATS) MATS = createMaterials();
  return MATS;
}

// -----------------------------------------------------------------------------
// Geometry helpers
// -----------------------------------------------------------------------------

function box(
  parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material,
  x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, bevel = true,
): THREE.Mesh {
  const r = Math.min(w, h, d) * 0.22;
  const geo = bevel && r > 0.0015 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

function cyl(
  parent: THREE.Object3D, rFront: number, rBack: number, len: number, mat: THREE.Material,
  x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'z', segs = 18, open = false,
): THREE.Mesh {
  // CylinderGeometry's +Y end gets radiusTop. Rotating -90° about X maps +Y -> -Z (front).
  const geo = new THREE.CylinderGeometry(rFront, rBack, len, segs, 1, open);
  const m = new THREE.Mesh(geo, mat);
  if (axis === 'z') m.rotation.x = -Math.PI / 2;
  else if (axis === 'x') m.rotation.z = -Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** Picatinny rail: base plus cross slots. */
function rail(parent: THREE.Object3D, len: number, x: number, y: number, z: number, mat: THREE.Material, slots = true): void {
  box(parent, 0.021, 0.009, len, mat, x, y, z, 0, 0, 0, false);
  if (!slots) return;
  const n = Math.floor(len / 0.01);
  const geo = new THREE.BoxGeometry(0.023, 0.004, 0.005);
  for (let i = 0; i < n; i += 2) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y + 0.0055, z - len / 2 + 0.005 + i * 0.01);
    parent.add(m);
  }
}

// -----------------------------------------------------------------------------
// Optics — each returns the line-of-sight centre in parent space
// -----------------------------------------------------------------------------

function reflexSight(p: THREE.Object3D, z: number, baseY: number, mat: THREE.Material): THREE.Vector3 {
  const M = mats();
  box(p, 0.024, 0.012, 0.036, mat, 0, baseY + 0.006, z);
  const tubeY = baseY + 0.012 + 0.018;
  cyl(p, 0.0175, 0.0175, 0.034, M.tubeBlack, 0, tubeY, z, 'z', 24, true);
  cyl(p, 0.019, 0.019, 0.004, M.tubeBlack, 0, tubeY, z - 0.016, 'z', 24, true);
  box(p, 0.012, 0.014, 0.022, mat, 0, baseY + 0.016, z);
  cyl(p, 0.0055, 0.0055, 0.012, mat, 0.022, tubeY, z, 'x', 12);
  cyl(p, 0.0055, 0.0055, 0.012, mat, 0, tubeY + 0.022, z, 'y', 12);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0165, 24), M.lens);
  lens.position.set(0, tubeY, z - 0.012);
  p.add(lens);
  return new THREE.Vector3(0, tubeY, z);
}

function holoSight(p: THREE.Object3D, z: number, baseY: number): THREE.Vector3 {
  const M = mats();
  const winW = 0.04;
  const winH = 0.03;
  box(p, 0.036, 0.016, 0.09, M.anodized, 0, baseY + 0.008, z + 0.006);
  const cy = baseY + 0.016 + winH / 2 + 0.002;
  box(p, winW + 0.012, 0.006, 0.07, M.anodized, 0, cy + winH / 2 + 0.003, z);
  box(p, 0.006, winH + 0.006, 0.07, M.anodized, winW / 2 + 0.003, cy, z);
  box(p, 0.006, winH + 0.006, 0.07, M.anodized, -(winW / 2 + 0.003), cy, z);
  box(p, 0.02, 0.008, 0.016, M.rubber, 0.0, baseY + 0.02, z + 0.044);
  box(p, 0.03, 0.022, 0.03, M.anodized, 0, baseY - 0.004, z + 0.06); // G33 magnifier mount stub
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), M.lens);
  glass.position.set(0, cy, z - 0.03);
  p.add(glass);
  return new THREE.Vector3(0, cy, z);
}

function prismSight(p: THREE.Object3D, z: number, baseY: number): THREE.Vector3 {
  const M = mats();
  box(p, 0.03, 0.02, 0.06, M.anodized, 0, baseY + 0.01, z);
  const cy = baseY + 0.02 + 0.026;
  cyl(p, 0.024, 0.024, 0.11, M.tubeBlack, 0, cy, z, 'z', 28, true);
  cyl(p, 0.029, 0.026, 0.035, M.tubeBlack, 0, cy, z - 0.07, 'z', 28, true);
  cyl(p, 0.025, 0.025, 0.025, M.tubeBlack, 0, cy, z + 0.065, 'z', 28, true);
  box(p, 0.016, 0.012, 0.03, M.anodized, 0, cy + 0.028, z);
  cyl(p, 0.007, 0.007, 0.012, M.anodized, 0.03, cy, z - 0.01, 'x', 12);
  return new THREE.Vector3(0, cy, z);
}

function rifleScope(p: THREE.Object3D, z: number, baseY: number, len: number, objR: number): THREE.Vector3 {
  const M = mats();
  const cy = baseY + 0.022 + objR * 0.6;
  // rings
  box(p, 0.03, cy - baseY, 0.018, M.anodized, 0, (cy + baseY) / 2, z - len * 0.22);
  box(p, 0.03, cy - baseY, 0.018, M.anodized, 0, (cy + baseY) / 2, z + len * 0.18);
  cyl(p, 0.016, 0.016, len * 0.62, M.anodized, 0, cy, z, 'z', 24);
  cyl(p, objR, 0.016, len * 0.18, M.anodized, 0, cy, z - len * 0.4, 'z', 28);
  cyl(p, objR, objR, len * 0.12, M.anodized, 0, cy, z - len * 0.55, 'z', 28);
  cyl(p, 0.017, 0.021, len * 0.12, M.anodized, 0, cy, z + len * 0.37, 'z', 24);
  cyl(p, 0.021, 0.021, len * 0.1, M.rubber, 0, cy, z + len * 0.47, 'z', 24);
  cyl(p, 0.011, 0.011, 0.024, M.anodized, 0, cy + 0.024, z - 0.01, 'y', 16);
  cyl(p, 0.011, 0.011, 0.024, M.anodized, 0.024, cy, z - 0.01, 'x', 16);
  const lensF = new THREE.Mesh(new THREE.CircleGeometry(objR * 0.9, 24), M.lensCoated);
  lensF.position.set(0, cy, z - len * 0.61 - 0.001);
  lensF.rotation.y = Math.PI;
  p.add(lensF);
  return new THREE.Vector3(0, cy, z + len * 0.45);
}

// -----------------------------------------------------------------------------
// Weapon builders
// -----------------------------------------------------------------------------

function base(root: THREE.Group, partial: Omit<WeaponModel, 'root' | 'magRest' | 'boltRest'>): WeaponModel {
  return {
    root,
    ...partial,
    magRest: partial.mag.position.clone(),
    boltRest: partial.bolt ? partial.bolt.position.clone() : new THREE.Vector3(),
  };
}

function stanagMag(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  box(g, 0.026, 0.09, 0.066, mat, 0, -0.045, 0);
  box(g, 0.026, 0.085, 0.064, mat, 0, -0.12, 0.012, 0.28);
  box(g, 0.03, 0.012, 0.07, mat, 0, -0.165, 0.026, 0.28);
  parent.add(g);
  return g;
}

function buildM4(): WeaponModel {
  const M = mats();
  const root = new THREE.Group();
  box(root, 0.05, 0.055, 0.25, M.anodized, 0, 0.012, 0.03);           // upper
  box(root, 0.044, 0.05, 0.19, M.anodized, 0, -0.04, 0.055);          // lower
  box(root, 0.036, 0.05, 0.075, M.anodized, 0, -0.06, -0.01);         // magwell
  rail(root, 0.25, 0, 0.044, 0.03, M.anodized);
  box(root, 0.06, 0.06, 0.31, M.parkerized, 0, 0.008, -0.25);         // quad rail
  rail(root, 0.3, 0, 0.042, -0.25, M.parkerized);
  rail(root, 0.26, 0.034, 0.008, -0.26, M.parkerized, false);
  rail(root, 0.26, -0.034, 0.008, -0.26, M.parkerized, false);
  cyl(root, 0.0095, 0.0095, 0.2, M.darkSteel, 0, 0.008, -0.5);
  cyl(root, 0.0145, 0.0145, 0.055, M.parkerized, 0, 0.008, -0.62, 'z', 6);  // flash hider
  box(root, 0.018, 0.035, 0.03, M.parkerized, 0, 0.045, -0.43);       // gas block / front sight base (low)
  box(root, 0.026, 0.1, 0.04, M.polymer, 0, -0.1, 0.125, -0.35);      // grip
  box(root, 0.006, 0.006, 0.07, M.anodized, 0, -0.085, 0.07, 0, 0, 0, false); // trigger guard
  box(root, 0.004, 0.02, 0.006, M.steel, 0, -0.072, 0.075, 0.3);      // trigger
  box(root, 0.012, 0.012, 0.03, M.anodized, 0.03, 0.02, 0.06);        // forward assist
  box(root, 0.02, 0.01, 0.02, M.anodized, 0, 0.042, 0.16);            // charging handle
  cyl(root, 0.015, 0.015, 0.2, M.anodized, 0, 0.0, 0.25);             // buffer tube
  box(root, 0.045, 0.085, 0.15, M.fde, 0, -0.02, 0.33);               // CTR stock
  box(root, 0.045, 0.11, 0.022, M.rubber, 0, -0.03, 0.41);            // butt pad
  box(root, 0.03, 0.095, 0.036, M.fde, 0, -0.075, -0.3, 0.08);        // vertical grip
  box(root, 0.032, 0.042, 0.085, M.fde, 0.044, 0.025, -0.33);         // PEQ-15
  box(root, 0.006, 0.006, 0.006, M.laser, 0.048, 0.02, -0.374);
  cyl(root, 0.012, 0.012, 0.07, M.anodized, -0.042, 0.0, -0.33);      // weapon light
  const mag = stanagMag(root, M.parkerized, 0, -0.07, -0.01);
  const sight = holoSight(root, -0.04, 0.0485);
  return base(root, {
    sight, muzzle: new THREE.Vector3(0, 0.008, -0.655), mag, bolt: null, boltKind: 'none',
    hipOffset: new THREE.Vector3(0.13, -0.13, -0.27), adsDistance: 0.17,
  });
}

function buildAK(): WeaponModel {
  const M = mats();
  const root = new THREE.Group();
  box(root, 0.048, 0.07, 0.3, M.parkerized, 0, -0.005, 0.05);         // stamped receiver
  box(root, 0.044, 0.02, 0.27, M.parkerized, 0, 0.034, 0.06);         // dust cover
  rail(root, 0.2, 0, 0.049, 0.06, M.anodized);                        // Zenit B-33 rail cover
  box(root, 0.06, 0.06, 0.22, M.polymer, 0, -0.004, -0.2);            // B-30 handguard
  rail(root, 0.2, 0, 0.03, -0.2, M.anodized);
  cyl(root, 0.012, 0.012, 0.22, M.parkerized, 0, 0.034, -0.2);        // gas tube
  cyl(root, 0.0105, 0.0105, 0.13, M.darkSteel, 0, -0.008, -0.37);
  box(root, 0.022, 0.05, 0.03, M.parkerized, 0, 0.008, -0.42);        // front sight block
  box(root, 0.006, 0.025, 0.006, M.parkerized, 0, 0.045, -0.42);
  cyl(root, 0.016, 0.016, 0.075, M.parkerized, 0, -0.008, -0.475, 'z', 14); // AK-105 brake
  box(root, 0.03, 0.105, 0.042, M.polymer, 0, -0.1, 0.17, -0.4);      // RK-3 grip
  box(root, 0.006, 0.006, 0.07, M.parkerized, 0, -0.075, 0.12, 0, 0, 0, false);
  box(root, 0.006, 0.02, 0.07, M.darkSteel, 0.026, 0.005, 0.07);      // safety lever
  box(root, 0.012, 0.012, 0.025, M.steel, 0.032, 0.02, 0.02);         // charging handle
  // PT-1 style skeletal stock
  box(root, 0.04, 0.04, 0.05, M.polymer, 0, -0.005, 0.22);
  cyl(root, 0.013, 0.013, 0.2, M.anodized, 0, 0.005, 0.33);
  box(root, 0.03, 0.03, 0.12, M.polymer, 0, 0.03, 0.33);              // cheek riser
  box(root, 0.04, 0.12, 0.025, M.rubber, 0, -0.03, 0.43);
  box(root, 0.012, 0.06, 0.02, M.polymer, 0, -0.04, 0.39, 0.3);
  // Strongly curved 30-round banana magazine
  const mag = new THREE.Group();
  mag.position.set(0, -0.04, 0.0);
  box(mag, 0.026, 0.07, 0.06, M.polymer, 0, -0.035, 0);
  box(mag, 0.026, 0.07, 0.062, M.polymer, 0, -0.095, -0.016, -0.35);
  box(mag, 0.026, 0.07, 0.064, M.polymer, 0, -0.152, -0.05, -0.62);
  root.add(mag);
  box(root, 0.03, 0.08, 0.035, M.polymer, 0, -0.06, -0.22, 0.12);     // RK-0 vertical grip
  const sight = reflexSight(root, 0.02, 0.054, M.anodized);
  return base(root, {
    sight, muzzle: new THREE.Vector3(0, -0.008, -0.515), mag, bolt: null, boltKind: 'none',
    hipOffset: new THREE.Vector3(0.13, -0.12, -0.27), adsDistance: 0.17,
  });
}

function buildMP7(): WeaponModel {
  const M = mats();
  const root = new THREE.Group();
  box(root, 0.046, 0.075, 0.26, M.navyGrey, 0, 0.0, 0.02);            // receiver
  box(root, 0.04, 0.04, 0.12, M.navyGrey, 0, -0.03, -0.14, 0.15);     // sloped nose
  rail(root, 0.26, 0, 0.042, 0.02, M.anodized);
  rail(root, 0.08, 0.026, 0.0, -0.12, M.anodized, false);
  cyl(root, 0.009, 0.009, 0.06, M.darkSteel, 0, 0.005, -0.15);
  cyl(root, 0.021, 0.021, 0.17, M.parkerized, 0, 0.005, -0.255, 'z', 22); // suppressor
  cyl(root, 0.018, 0.021, 0.012, M.parkerized, 0, 0.005, -0.346, 'z', 22);
  box(root, 0.032, 0.12, 0.045, M.polymer, 0, -0.085, 0.07, -0.18);   // grip w/ mag well
  box(root, 0.006, 0.006, 0.06, M.navyGrey, 0, -0.05, 0.01, 0, 0, 0, false);
  box(root, 0.026, 0.07, 0.03, M.polymer, 0, -0.065, -0.1, 0.1);      // folding foregrip
  // 40-round magazine extends far below the grip
  const mag = new THREE.Group();
  mag.position.set(0, -0.1, 0.075);
  box(mag, 0.024, 0.17, 0.034, M.polymer, 0, -0.06, 0, -0.18);
  box(mag, 0.028, 0.014, 0.038, M.polymer, 0, -0.145, 0.016, -0.18);
  root.add(mag);
  // Telescoping stock rods + butt plate
  cyl(root, 0.004, 0.004, 0.16, M.steel, 0.018, -0.005, 0.2);
  cyl(root, 0.004, 0.004, 0.16, M.steel, -0.018, -0.005, 0.2);
  box(root, 0.05, 0.075, 0.016, M.polymer, 0, -0.02, 0.285);
  box(root, 0.015, 0.012, 0.025, M.anodized, 0, 0.03, 0.14);
  const sight = reflexSight(root, -0.01, 0.0465, M.anodized);
  return base(root, {
    sight, muzzle: new THREE.Vector3(0, 0.005, -0.355), mag, bolt: null, boltKind: 'none',
    hipOffset: new THREE.Vector3(0.12, -0.125, -0.25), adsDistance: 0.16,
  });
}

function buildVector(): WeaponModel {
  const M = mats();
  const root = new THREE.Group();
  box(root, 0.05, 0.05, 0.36, M.polymer, 0, 0.025, -0.02);            // upper
  box(root, 0.052, 0.13, 0.13, M.fde, 0, -0.045, -0.06, -0.55);       // KRISS super-V housing
  box(root, 0.05, 0.05, 0.12, M.fde, 0, -0.01, 0.1);                  // rear lower
  rail(root, 0.33, 0, 0.055, -0.02, M.anodized);
  box(root, 0.05, 0.03, 0.16, M.polymer, 0, 0.0, -0.24);              // handguard
  rail(root, 0.12, 0, -0.018, -0.25, M.anodized, false);
  cyl(root, 0.016, 0.016, 0.07, M.parkerized, 0, 0.0, -0.355, 'z', 18); // shroud
  cyl(root, 0.011, 0.011, 0.04, M.darkSteel, 0, 0.0, -0.405, 'z', 8);
  box(root, 0.03, 0.1, 0.042, M.fde, 0, -0.085, 0.085, -0.25);        // grip
  box(root, 0.006, 0.006, 0.06, M.fde, 0, -0.06, 0.035, 0, 0, 0, false);
  box(root, 0.026, 0.07, 0.032, M.polymer, 0, -0.04, -0.22, 0.05);    // foregrip
  // Glock .45 magazine in front of the trigger, angled with the housing
  const mag = new THREE.Group();
  mag.position.set(0, -0.06, -0.02);
  box(mag, 0.025, 0.2, 0.034, M.polymer, 0, -0.1, 0, -0.08);
  box(mag, 0.03, 0.014, 0.04, M.polymer, 0, -0.2, -0.008, -0.08);
  root.add(mag);
  // Folding stock (stepped)
  box(root, 0.03, 0.03, 0.06, M.polymer, 0, 0.02, 0.19);
  box(root, 0.028, 0.045, 0.16, M.fde, 0, 0.005, 0.28);
  box(root, 0.04, 0.1, 0.02, M.rubber, 0, -0.01, 0.37);
  const sight = reflexSight(root, -0.02, 0.0595, M.anodized);
  return base(root, {
    sight, muzzle: new THREE.Vector3(0, 0.0, -0.43), mag, bolt: null, boltKind: 'none',
    hipOffset: new THREE.Vector3(0.12, -0.13, -0.26), adsDistance: 0.17,
  });
}

function buildM1014(): WeaponModel {
  const M = mats();
  const root = new THREE.Group();
  box(root, 0.05, 0.07, 0.24, M.parkerized, 0, 0.0, 0.03);            // receiver
  box(root, 0.044, 0.012, 0.03, M.steel, 0.026, 0.0, 0.03, 0, 0, 0, false); // ejection port
  rail(root, 0.2, 0, 0.039, 0.02, M.parkerized);
  cyl(root, 0.0125, 0.0125, 0.47, M.parkerized, 0, 0.012, -0.32);     // barrel
  cyl(root, 0.016, 0.016, 0.38, M.parkerized, 0, -0.022, -0.27);      // tube magazine
  box(root, 0.03, 0.06, 0.03, M.parkerized, 0, -0.005, -0.47);        // barrel clamp
  box(root, 0.054, 0.05, 0.2, M.polymer, 0, -0.02, -0.18);            // forend
  box(root, 0.008, 0.02, 0.008, M.steel, 0, 0.034, -0.545);           // front bead
  box(root, 0.028, 0.1, 0.044, M.polymer, 0, -0.095, 0.14, -0.35);    // pistol grip
  box(root, 0.006, 0.006, 0.07, M.parkerized, 0, -0.06, 0.08, 0, 0, 0, false);
  // collapsible stock
  cyl(root, 0.015, 0.015, 0.18, M.parkerized, 0, 0.0, 0.24);
  box(root, 0.04, 0.09, 0.12, M.polymer, 0, -0.02, 0.32);
  box(root, 0.044, 0.12, 0.022, M.rubber, 0, -0.03, 0.39);
  // side shell carrier
  for (let i = 0; i < 4; i++) {
    cyl(root, 0.0095, 0.0095, 0.05, M.shellRed, -0.03, -0.01 - i * 0.0, 0.0 + i * 0.022, 'y', 10);
  }
  // Shell used in the shell-by-shell reload animation
  const mag = new THREE.Group();
  mag.position.set(0, -0.045, -0.02);
  cyl(mag, 0.0095, 0.0095, 0.05, M.shellRed, 0, 0, 0, 'z', 12);
  cyl(mag, 0.0098, 0.0098, 0.014, M.brass, 0, 0, 0.03, 'z', 12);
  mag.visible = false;
  root.add(mag);
  const sight = reflexSight(root, 0.0, 0.0435, M.anodized);
  return base(root, {
    sight, muzzle: new THREE.Vector3(0, 0.012, -0.56), mag, bolt: null, boltKind: 'none',
    hipOffset: new THREE.Vector3(0.13, -0.13, -0.27), adsDistance: 0.17,
  });
}

function buildMK14(): WeaponModel {
  const M = mats();
  const root = new THREE.Group();
  box(root, 0.058, 0.07, 0.38, M.fdeMetal, 0, 0.0, -0.05);            // Sage EBR chassis
  rail(root, 0.36, 0, 0.04, -0.05, M.fdeMetal);
  rail(root, 0.2, 0.033, 0.0, -0.18, M.fdeMetal, false);
  rail(root, 0.2, -0.033, 0.0, -0.18, M.fdeMetal, false);
  box(root, 0.036, 0.04, 0.2, M.darkSteel, 0, 0.0, 0.03);             // M14 action
  box(root, 0.014, 0.014, 0.05, M.steel, 0.032, 0.012, -0.02);        // op rod handle
  cyl(root, 0.011, 0.011, 0.34, M.darkSteel, 0, 0.0, -0.4);
  cyl(root, 0.015, 0.015, 0.06, M.parkerized, 0, 0.0, -0.6, 'z', 8);  // flash hider
  box(root, 0.03, 0.11, 0.045, M.polymer, 0, -0.09, 0.16, -0.35);     // grip
  box(root, 0.006, 0.006, 0.07, M.fdeMetal, 0, -0.05, 0.1, 0, 0, 0, false);
  box(root, 0.03, 0.08, 0.036, M.polymer, 0, -0.07, -0.22, 0.05);     // vertical grip
  // adjustable stock
  cyl(root, 0.016, 0.016, 0.24, M.fdeMetal, 0, 0.0, 0.27);
  box(root, 0.03, 0.03, 0.14, M.fdeMetal, 0, 0.038, 0.3);             // cheek riser
  box(root, 0.045, 0.13, 0.025, M.rubber, 0, -0.03, 0.4);
  box(root, 0.016, 0.07, 0.016, M.fdeMetal, 0, -0.06, 0.34);          // monopod
  // 20-round straight box magazine
  const mag = new THREE.Group();
  mag.position.set(0, -0.035, 0.0);
  box(mag, 0.03, 0.12, 0.08, M.parkerized, 0, -0.06, 0, -0.06);
  box(mag, 0.034, 0.012, 0.084, M.parkerized, 0, -0.12, 0.004, -0.06);
  root.add(mag);
  const sight = rifleScope(root, 0.02, 0.0445, 0.3, 0.025);
  return base(root, {
    sight, muzzle: new THREE.Vector3(0, 0.0, -0.63), mag, bolt: null, boltKind: 'none',
    hipOffset: new THREE.Vector3(0.135, -0.135, -0.28), adsDistance: 0.1,
  });
}

function buildAWM(): WeaponModel {
  const M = mats();
  const root = new THREE.Group();
  // Thumbhole chassis stock (AWM green)
  box(root, 0.06, 0.07, 0.42, M.awmGreen, 0, -0.02, -0.02);
  box(root, 0.055, 0.06, 0.2, M.awmGreen, 0, -0.03, 0.27);
  box(root, 0.055, 0.12, 0.05, M.awmGreen, 0, -0.06, 0.4);
  box(root, 0.05, 0.035, 0.12, M.awmGreen, 0, -0.1, 0.24, -0.1);      // lower stock
  box(root, 0.03, 0.08, 0.05, M.awmGreen, 0, -0.07, 0.15, -0.4);      // thumbhole grip
  box(root, 0.05, 0.13, 0.025, M.rubber, 0, -0.06, 0.435);
  box(root, 0.04, 0.03, 0.12, M.awmGreen, 0, 0.03, 0.29);             // cheek piece
  // Action & barrel
  cyl(root, 0.021, 0.021, 0.22, M.darkSteel, 0, 0.022, 0.03);
  rail(root, 0.22, 0, 0.046, 0.0, M.anodized);
  cyl(root, 0.016, 0.0135, 0.52, M.darkSteel, 0, 0.022, -0.45, 'z', 16);  // fluted look via 8-ish facets
  cyl(root, 0.022, 0.022, 0.08, M.parkerized, 0, 0.022, -0.74, 'z', 10);  // muzzle brake
  box(root, 0.05, 0.012, 0.025, M.parkerized, 0, 0.022, -0.73, 0, 0, 0, false);
  // folded bipod
  box(root, 0.012, 0.012, 0.18, M.anodized, 0.018, -0.06, -0.3);
  box(root, 0.012, 0.012, 0.18, M.anodized, -0.018, -0.06, -0.3);
  // 5-round magazine
  const mag = new THREE.Group();
  mag.position.set(0, -0.055, 0.03);
  box(mag, 0.034, 0.06, 0.1, M.parkerized, 0, -0.03, 0);
  root.add(mag);
  // Bolt with handle on the right
  const bolt = new THREE.Group();
  bolt.position.set(0.0, 0.022, 0.12);
  cyl(bolt, 0.012, 0.012, 0.05, M.steel, 0, 0, 0);
  cyl(bolt, 0.004, 0.004, 0.055, M.steel, 0.03, 0, 0.0, 'x', 10);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 10), M.polymer);
  knob.position.set(0.058, -0.004, 0.0);
  bolt.add(knob);
  root.add(bolt);
  box(root, 0.006, 0.006, 0.06, M.anodized, 0, -0.06, 0.12, 0, 0, 0, false);
  const sight = rifleScope(root, 0.0, 0.0505, 0.36, 0.03);
  return base(root, {
    sight, muzzle: new THREE.Vector3(0, 0.022, -0.79), mag, bolt, boltKind: 'bolt-action',
    hipOffset: new THREE.Vector3(0.14, -0.145, -0.29), adsDistance: 0.1,
  });
}

function buildM249(): WeaponModel {
  const M = mats();
  const root = new THREE.Group();
  box(root, 0.07, 0.085, 0.34, M.parkerized, 0, -0.005, 0.03);        // receiver
  box(root, 0.072, 0.025, 0.17, M.parkerized, 0, 0.045, -0.02);       // feed tray cover
  rail(root, 0.15, 0, 0.062, -0.02, M.parkerized);
  box(root, 0.04, 0.03, 0.04, M.parkerized, 0, 0.04, 0.12);           // rear sight
  cyl(root, 0.013, 0.013, 0.48, M.darkSteel, 0, 0.0, -0.4);           // barrel
  box(root, 0.05, 0.03, 0.26, M.parkerized, 0, 0.026, -0.3);          // heat shield
  box(root, 0.06, 0.055, 0.16, M.polymer, 0, -0.025, -0.2);           // handguard
  cyl(root, 0.015, 0.015, 0.04, M.parkerized, 0, 0.0, -0.66, 'z', 6);
  box(root, 0.02, 0.045, 0.02, M.parkerized, 0, 0.025, -0.6);         // front sight
  // carry handle
  box(root, 0.014, 0.014, 0.11, M.polymer, 0.0, 0.08, -0.36);
  box(root, 0.012, 0.04, 0.012, M.parkerized, 0.0, 0.058, -0.31);
  box(root, 0.012, 0.04, 0.012, M.parkerized, 0.0, 0.058, -0.41);
  // folded bipod
  box(root, 0.012, 0.012, 0.22, M.parkerized, 0.02, -0.045, -0.48);
  box(root, 0.012, 0.012, 0.22, M.parkerized, -0.02, -0.045, -0.48);
  box(root, 0.03, 0.11, 0.045, M.polymer, 0, -0.1, 0.15, -0.3);       // grip
  box(root, 0.006, 0.006, 0.07, M.parkerized, 0, -0.07, 0.1, 0, 0, 0, false);
  // solid stock
  box(root, 0.05, 0.08, 0.2, M.polymer, 0, -0.02, 0.3);
  box(root, 0.05, 0.05, 0.12, M.polymer, 0, -0.07, 0.34, 0.35);
  box(root, 0.052, 0.14, 0.025, M.rubber, 0, -0.04, 0.41);
  // 100-round soft pouch (left side / under) + belt
  const mag = new THREE.Group();
  mag.position.set(-0.025, -0.07, -0.02);
  box(mag, 0.07, 0.1, 0.11, M.canvas, -0.01, -0.05, 0);
  box(mag, 0.074, 0.012, 0.11, M.od, -0.01, -0.002, 0);
  for (let i = 0; i < 5; i++) {
    cyl(mag, 0.0035, 0.0035, 0.045, M.brass, 0.03, 0.01 + i * 0.008, -0.015 + i * 0.006, 'z', 6);
  }
  root.add(mag);
  const sight = prismSight(root, -0.02, 0.0665);
  return base(root, {
    sight, muzzle: new THREE.Vector3(0, 0.0, -0.685), mag, bolt: null, boltKind: 'none',
    hipOffset: new THREE.Vector3(0.145, -0.15, -0.28), adsDistance: 0.13,
  });
}

function buildGlock(): WeaponModel {
  const M = mats();
  const root = new THREE.Group();
  // Slide (animated)
  const slide = new THREE.Group();
  slide.position.set(0, 0.0, 0.0);
  box(slide, 0.028, 0.032, 0.185, M.darkSteel, 0, 0.0, -0.05);
  box(slide, 0.029, 0.012, 0.03, M.parkerized, 0, 0.0, 0.03, 0, 0, 0, false); // serrations
  box(slide, 0.01, 0.009, 0.02, M.darkSteel, 0.0, 0.004, -0.04, 0, 0, 0, false); // ejection port
  // RMR on slide
  box(slide, 0.026, 0.008, 0.032, M.anodized, 0, 0.02, -0.0);
  const rmrY = 0.02 + 0.004 + 0.012;
  box(slide, 0.004, 0.024, 0.026, M.anodized, 0.013, rmrY, 0.0);
  box(slide, 0.004, 0.024, 0.026, M.anodized, -0.013, rmrY, 0.0);
  box(slide, 0.03, 0.005, 0.02, M.anodized, 0, rmrY + 0.013, 0.003, 0.3);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.018), M.lens);
  glass.position.set(0, rmrY, -0.01);
  slide.add(glass);
  root.add(slide);
  cyl(root, 0.0062, 0.0062, 0.012, M.darkSteel, 0, 0.0, -0.145, 'z', 12);    // barrel crown
  // Frame & grip
  box(root, 0.026, 0.022, 0.16, M.polymer, 0, -0.026, -0.05);
  box(root, 0.028, 0.105, 0.05, M.polymer, 0, -0.08, 0.02, -0.28);
  box(root, 0.006, 0.006, 0.05, M.polymer, 0, -0.045, -0.04, 0, 0, 0, false);
  box(root, 0.004, 0.016, 0.006, M.polymer, 0, -0.04, -0.03, 0.2);
  rail(root, 0.03, 0, -0.04, -0.1, M.polymer, false);
  const mag = new THREE.Group();
  mag.position.set(0, -0.05, 0.025);
  box(mag, 0.024, 0.09, 0.034, M.polymer, 0, -0.045, 0.012, -0.28);
  box(mag, 0.028, 0.012, 0.04, M.polymer, 0, -0.088, 0.028, -0.28);
  root.add(mag);
  return base(root, {
    sight: new THREE.Vector3(0, rmrY, 0.0), muzzle: new THREE.Vector3(0, 0.0, -0.155), mag,
    bolt: slide, boltKind: 'slide',
    hipOffset: new THREE.Vector3(0.11, -0.12, -0.3), adsDistance: 0.21,
  });
}

const BUILDERS: Record<WeaponId, () => WeaponModel> = {
  m4a1_sopmod: buildM4,
  ak105_zenit: buildAK,
  mp7a1_navy: buildMP7,
  vector_45: buildVector,
  m1014_breacher: buildM1014,
  mk14_ebr: buildMK14,
  awm_338: buildAWM,
  m249_saw: buildM249,
  glock19: buildGlock,
};

export function buildWeaponModel(id: WeaponId): WeaponModel {
  const model = BUILDERS[id]();
  model.root.name = `viewmodel_${id}`;
  return model;
}
