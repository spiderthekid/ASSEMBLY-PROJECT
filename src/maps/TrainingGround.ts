import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CollisionWorld } from '../core/CollisionWorld';
import { WEAPONS, type HitZone, type WeaponId } from '../weapons/WeaponDatabase';
import { buildWeaponModel } from '../player/WeaponModels';

export interface TargetDummy {
  id: string;
  label: string;
  root: THREE.Group;
  pivot: THREE.Group;
  hp: number;
  maxHp: number;
  down: boolean;
  downTimer: number;
  tiltAngle: number;
  baseX: number;
  strafeAmp: number;
  strafeSpeed: number;
  phase: number;
  plateMat: THREE.MeshStandardMaterial;
  headMat: THREE.MeshStandardMaterial;
  flashTimer: number;
  heldWeaponId: WeaponId | null;
  heldMagAmmo: number;
  heldReserveAmmo: number;
  heldWeaponMesh: THREE.Group | null;
}

export interface TrainingGroundResult {
  spawnPosition: THREE.Vector3;
  spawnYaw: number;
  shootables: THREE.Object3D[];
  obstacleMeshes: THREE.Object3D[];
  targets: TargetDummy[];
  armedTargets: TargetDummy[];
  environmentTexture: THREE.Texture;
  update: (dt: number) => void;
  resetTargets: () => void;
}

function makeGridTexture(
  bg: string,
  lineMajor: string,
  lineMinor: string,
  size = 512,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);

  // Subtle concrete speckle
  for (let i = 0; i < 2400; i++) {
    const v = Math.random() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.045)';
    g.fillStyle = v;
    g.fillRect(Math.random() * size, Math.random() * size, 3, 3);
  }

  g.strokeStyle = lineMinor;
  g.lineWidth = 1;
  const step = size / 8;
  for (let i = 1; i < 8; i++) {
    g.beginPath();
    g.moveTo(i * step, 0);
    g.lineTo(i * step, size);
    g.moveTo(0, i * step);
    g.lineTo(size, i * step);
    g.stroke();
  }

  g.strokeStyle = lineMajor;
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, size - 3, size - 3);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function makeRangeBannerTexture(text: string, subtext: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#14181d';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#e59a28';
  g.lineWidth = 6;
  g.strokeRect(6, 6, c.width - 12, c.height - 12);
  g.fillStyle = '#f4f6f8';
  g.font = 'bold 48px Consolas, monospace';
  g.textAlign = 'center';
  g.fillText(text, c.width / 2, 62);
  g.fillStyle = '#e59a28';
  g.font = 'bold 24px Consolas, monospace';
  g.fillText(subtext, c.width / 2, 102);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildTrainingGround(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  world: CollisionWorld,
  onWeaponDrop?: (
    weaponId: WeaponId,
    currentMagAmmo: number,
    reserveAmmo: number,
    position: THREE.Vector3,
    velocity: THREE.Vector3,
  ) => void,
): TrainingGroundResult {
  // PBR Image-Based Lighting via PMREM RoomEnvironment
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = envTex;
  scene.environmentIntensity = 0.75;

  // Procedural sky backdrop + atmospheric fog
  scene.background = new THREE.Color(0x9cb6d4);
  scene.fog = new THREE.FogExp2(0x9cb6d4, 0.0045);

  // HDR Directional sun with crisp shadow mapping + hemisphere fill
  const sun = new THREE.DirectionalLight(0xfff1d6, 3.2);
  sun.position.set(38, 64, 28);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 180;
  const d = 75;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(0xc8e0ff, 0x3f3931, 0.85);
  scene.add(hemi);

  // Materials
  const floorTex = makeGridTexture('#2b3036', '#454d57', '#343a42');
  floorTex.repeat.set(35, 70);
  const wallTex = makeGridTexture('#3e434a', '#565d66', '#464c54');
  wallTex.repeat.set(16, 4);
  const crateTex = makeGridTexture('#6e583b', '#8c714d', '#5d4930');
  crateTex.repeat.set(2, 2);

  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.78, metalness: 0.08 });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.68, metalness: 0.12 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.38, metalness: 0.82 });
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.62, metalness: 0.1 });
  const hazardMat = new THREE.MeshStandardMaterial({ color: 0xd98a1e, roughness: 0.45, metalness: 0.25 });
  const cyanStripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.4, 3.2) });

  const shootables: THREE.Object3D[] = [];
  const obstacleMeshes: THREE.Object3D[] = [];

  const addSolidBox = (
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
     l: number,
    mat: THREE.Material,
    collide = true,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    shootables.push(mesh);
    if (collide) {
      obstacleMeshes.push(mesh);
      world.addFromCenter(cx, cy, cz, w, h, l);
    }
    return mesh;
  };

  // Main Arena Floor (70m wide x 140m long)
  addSolidBox(0, -0.5, -35, 70, 1, 140, floorMat, true);

  // Perimeter Walls
  addSolidBox(0, 4, 35, 70, 8, 1, wallMat);
  addSolidBox(0, 5, -105, 70, 10, 1, wallMat);
  addSolidBox(-35, 4, -35, 1, 8, 140, wallMat);
  addSolidBox(35, 4, -35, 1, 8, 140, wallMat);

  // Firing Line Divider & Low Cover Bench (z = 2)
  addSolidBox(-14, 0.55, 2, 8, 1.1, 0.7, darkMetal);
  addSolidBox(14, 0.55, 2, 8, 1.1, 0.7, darkMetal);

  // Range Distance Floor Stripes & Signs at 10m, 25m, 50m, 75m, 100m (relative to firing line z = 0)
  const distances = [10, 25, 50, 75, 100];
  for (const dist of distances) {
    const z = -dist;
    const line = new THREE.Mesh(new THREE.BoxGeometry(24, 0.02, 0.16), hazardMat);
    line.position.set(0, 0.01, z);
    line.receiveShadow = true;
    scene.add(line);

    const signTex = makeRangeBannerTexture(`${dist}m`, `RANGE LINE`);
    const signMat = new THREE.MeshBasicMaterial({ map: signTex });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), signMat);
    sign.position.set(-12.5, 2.3, z);
    sign.rotation.y = 0.25;
    scene.add(sign);
  }

  // Overhead Range Canopy above firing line
  addSolidBox(0, 5.2, 8, 28, 0.4, 14, darkMetal);
  addSolidBox(-13.4, 2.6, 2, 0.5, 5.2, 0.5, darkMetal);
  addSolidBox(13.4, 2.6, 2, 0.5, 5.2, 0.5, darkMetal);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(24, 0.08, 0.25), cyanStripMat);
  strip.position.set(0, 4.95, 3);
  scene.add(strip);

  // ---------------------------------------------------------------------------
  // West Wing: Movement & Slide-Under / Bunny-Hop Course (x = -16 .. -32)
  // ---------------------------------------------------------------------------
  // Slide Gate 1 & 2: underside is 1.25m high (standing height is 1.8m -> requires crouch-slide!)
  addSolidBox(-22, 2.15, -6, 6.0, 1.8, 1.4, hazardMat, true);
  addSolidBox(-25, 1.1, -6, 0.4, 2.2, 1.4, darkMetal, true);
  addSolidBox(-19, 1.1, -6, 0.4, 2.2, 1.4, darkMetal, true);

  addSolidBox(-22, 2.15, -18, 6.0, 1.8, 1.4, hazardMat, true);
  addSolidBox(-25, 1.1, -18, 0.4, 2.2, 1.4, darkMetal, true);
  addSolidBox(-19, 1.1, -18, 0.4, 2.2, 1.4, darkMetal, true);

  const slideBanner = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 1.05),
    new THREE.MeshBasicMaterial({ map: makeRangeBannerTexture('SLIDE COURSE', 'SPRINT [SHIFT] + [C] TO SLIDE') }),
  );
  slideBanner.position.set(-22, 3.55, -5.28);
  scene.add(slideBanner);

  // Bunny-Hop Stepping Pillars along x = -22, z = -28 .. -62
  for (let i = 0; i < 6; i++) {
    const px = -22 + (i % 2 === 0 ? -1.4 : 1.4);
    const pz = -28 - i * 6.5;
    const h = 0.5 + (i % 3) * 0.25;
    addSolidBox(px, h / 2, pz, 2.4, h, 2.4, crateMat, true);
  }

  // Elevated Sniper Overwatch Deck + Staircase (West-South corner)
  const steps = 8;
  for (let s = 0; s < steps; s++) {
    const sh = (s + 1) * 0.35;
    addSolidBox(-26, sh / 2, 14 - s * 0.9, 3.2, sh, 0.9, wallMat, true);
  }
  addSolidBox(-26, 1.4, 4, 7, 2.8, 6, wallMat, true);
  addSolidBox(-22.6, 3.25, 2.5, 0.25, 0.9, 3, darkMetal, true);

  // ---------------------------------------------------------------------------
  // East Wing: CQB Killhouse & Tactical Cover (x = 15 .. 32)
  // ---------------------------------------------------------------------------
  addSolidBox(22, 1.75, -12, 12, 3.5, 0.5, wallMat, true);
  addSolidBox(16, 1.75, -20, 0.5, 3.5, 16, wallMat, true);
  addSolidBox(28, 1.75, -20, 0.5, 3.5, 16, wallMat, true);
  addSolidBox(22, 1.75, -28, 12, 3.5, 0.5, wallMat, true);
  // Cover crates inside and around CQB lane
  addSolidBox(20, 0.65, -16, 1.6, 1.3, 1.6, crateMat, true);
  addSolidBox(24.5, 0.9, -22, 1.8, 1.8, 1.8, crateMat, true);
  addSolidBox(19.5, 0.65, -24.5, 1.5, 1.3, 1.5, crateMat, true);

  const cqbBanner = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 1.05),
    new THREE.MeshBasicMaterial({ map: makeRangeBannerTexture('CQB KILLHOUSE', 'CLOSE-QUARTERS TARGETS') }),
  );
  cqbBanner.position.set(22, 4.1, -11.7);
  scene.add(cqbBanner);

  // ---------------------------------------------------------------------------
  // Reactive Armored Target Dummies (Head / Body / Limb hitzones + Held Weapons)
  // ---------------------------------------------------------------------------
  const targets: TargetDummy[] = [];
  const armedTargets: TargetDummy[] = [];

  const makeHeldWeaponTag = (text: string): THREE.Sprite => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 54;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(12, 18, 26, 0.85)';
    g.strokeStyle = '#ffae2b';
    g.lineWidth = 3;
    g.fillRect(3, 3, c.width - 6, c.height - 6);
    g.strokeRect(3, 3, c.width - 6, c.height - 6);
    g.fillStyle = '#ffbe42';
    g.font = 'bold 20px Consolas, monospace';
    g.textAlign = 'center';
    g.fillText(text, c.width / 2, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sp.scale.set(1.15, 0.25, 1);
    sp.position.set(0, 1.92, 0);
    return sp;
  };

  const createTarget = (
    id: string,
    label: string,
    x: number,
    z: number,
    strafeAmp = 0,
    strafeSpeed = 0,
    heldWeapon?: { weaponId: WeaponId; mag: number; reserve: number },
  ): TargetDummy => {
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    scene.add(root);

    // Base pedestal
    const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.6), darkMetal);
    baseMesh.position.y = 0.07;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    root.add(baseMesh);

    const pivot = new THREE.Group();
    pivot.position.set(0, 0.12, 0);
    root.add(pivot);

    const plateMat = new THREE.MeshStandardMaterial({
      color: heldWeapon ? 0x354338 : 0x2c3540,
      roughness: 0.42,
      metalness: 0.65,
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xd94832,
      roughness: 0.35,
      metalness: 0.4,
      emissive: new THREE.Color(0x280604),
    });
    const limbMat = new THREE.MeshStandardMaterial({
      color: 0x454e59,
      roughness: 0.55,
      metalness: 0.5,
    });

    // Legs (limb zone)
    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.16), limbMat);
    leftLeg.position.set(-0.14, 0.36, 0);
    leftLeg.userData.hitZone = 'limb' satisfies HitZone;
    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.16), limbMat);
    rightLeg.position.set(0.14, 0.36, 0);
    rightLeg.userData.hitZone = 'limb' satisfies HitZone;

    // Torso / Chest plate (body zone)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.66, 0.22), plateMat);
    torso.position.set(0, 1.05, 0);
    torso.userData.hitZone = 'body' satisfies HitZone;

    // Center bullseye plate on chest
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(0.24, 0.28),
      new THREE.MeshBasicMaterial({ color: heldWeapon ? 0x32d296 : 0xe59a28 }),
    );
    ring.position.set(0, 1.08, 0.112);

    // Arms / Shoulders (limb zone)
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.56, 0.16), limbMat);
    leftArm.position.set(-0.34, 1.02, 0);
    leftArm.userData.hitZone = 'limb' satisfies HitZone;
    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.56, 0.16), limbMat);
    rightArm.position.set(0.34, 1.02, 0);
    rightArm.userData.hitZone = 'limb' satisfies HitZone;

    // Head (headshot zone)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.28, 0.24), headMat);
    head.position.set(0, 1.56, 0);
    head.userData.hitZone = 'head' satisfies HitZone;

    pivot.add(leftLeg, rightLeg, torso, ring, leftArm, rightArm, head);

    let heldWeaponMesh: THREE.Group | null = null;
    if (heldWeapon) {
      const wDef = WEAPONS[heldWeapon.weaponId];
      const built = buildWeaponModel(heldWeapon.weaponId);
      heldWeaponMesh = built.root;
      heldWeaponMesh.scale.setScalar(1.1);
      // Orient barrel toward +Z (toward firing line) at dummy chest/hand level
      heldWeaponMesh.rotation.set(0, Math.PI, 0);
      heldWeaponMesh.position.set(0.24, 1.02, 0.26);
      heldWeaponMesh.traverse((o) => {
        o.raycast = () => {};
      });
      pivot.add(heldWeaponMesh);
      const tagSprite = makeHeldWeaponTag(wDef.name);
      tagSprite.raycast = () => {};
      root.add(tagSprite);
    }

    pivot.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    shootables.push(pivot);

    const dummy: TargetDummy = {
      id,
      label,
      root,
      pivot,
      hp: 100,
      maxHp: 100,
      down: false,
      downTimer: 0,
      tiltAngle: 0,
      baseX: x,
      strafeAmp,
      strafeSpeed,
      phase: Math.random() * Math.PI * 2,
      plateMat,
      headMat,
      flashTimer: 0,
      heldWeaponId: heldWeapon?.weaponId ?? null,
      heldMagAmmo: heldWeapon?.mag ?? 0,
      heldReserveAmmo: heldWeapon?.reserve ?? 0,
      heldWeaponMesh,
    };

    pivot.userData.onBulletHit = (dmg: number): boolean => {
      if (dummy.down) return false;
      dummy.hp = Math.max(0, dummy.hp - dmg);
      dummy.flashTimer = 0.09;
      if (dummy.hp <= 0) {
        dummy.down = true;
        dummy.downTimer = 3.8;
        if (dummy.heldWeaponMesh) dummy.heldWeaponMesh.visible = false;

        if (dummy.heldWeaponId && onWeaponDrop) {
          const dropPos = new THREE.Vector3(
            dummy.root.position.x + (Math.random() - 0.5) * 0.2,
            1.15,
            dummy.root.position.z + 0.45,
          );
          // Toss slightly forward toward the player (+Z) so it lands cleanly in front of the pedestal
          const dropVel = new THREE.Vector3(
            (Math.random() - 0.5) * 1.1,
            2.4,
            1.8 + Math.random() * 0.6,
          );
          onWeaponDrop(
            dummy.heldWeaponId,
            dummy.heldMagAmmo,
            dummy.heldReserveAmmo,
            dropPos,
            dropVel,
          );
        }
        return true;
      }
      return false;
    };

    targets.push(dummy);
    if (heldWeapon) armedTargets.push(dummy);
    return dummy;
  };

  // ---------------------------------------------------------------------------
  // 5 Armed Dummy Targets holding different weapons from the 8-gun military roster
  // Positioned along the Scavenging Line (z = -7.5m) for quick kill -> swap / scavenge testing
  // ---------------------------------------------------------------------------
  createTarget('armed_1', 'Combatant 1 [M4A1 SOPMOD]', -6.8, -7.5, 0, 0, {
    weaponId: 'm4a1_sopmod',
    mag: 20,
    reserve: 10, // 30 total (= 1 full M4A1 mag, so walking over it absorbs 1 mag and removes the empty drop)
  });
  createTarget('armed_2', 'Combatant 2 [AK-105 Zenit]', -3.4, -7.5, 0, 0, {
    weaponId: 'ak105_zenit',
    mag: 24,
    reserve: 30,
  });
  createTarget('armed_3', 'Combatant 3 [MP7A1 Navy]', 0.0, -7.5, 0, 0, {
    weaponId: 'mp7a1_navy',
    mag: 32,
    reserve: 40,
  });
  createTarget('armed_4', 'Combatant 4 [M1014 Breacher]', 3.4, -7.5, 0, 0, {
    weaponId: 'm1014_breacher',
    mag: 6,
    reserve: 7,
  });
  createTarget('armed_5', 'Combatant 5 [AWM .338]', 6.8, -7.5, 0, 0, {
    weaponId: 'awm_338',
    mag: 4,
    reserve: 5,
  });

  // Main firing lane targets at 25m, 50m, 75m, 100m
  createTarget('t_25m_c', '25m Center', 0, -25);
  createTarget('t_25m_m', '25m Strafe', -7, -25, 3.2, 1.65);
  createTarget('t_50m_l', '50m Mid-Range', -3.5, -50);
  createTarget('t_50m_m', '50m Strafe', 5.0, -50, 4.5, 1.35);
  createTarget('t_75m_c', '75m Long-Range', -2.0, -75);
  createTarget('t_75m_m', '75m Strafe', 6.0, -75, 5.0, 1.15);
  createTarget('t_100m_l', '100m Sniper Left', -5.5, -100);
  createTarget('t_100m_c', '100m Sniper Center', 0, -100);
  createTarget('t_100m_r', '100m Sniper Right', 5.5, -100);

  // Killhouse CQB targets
  createTarget('t_cqb_1', 'Killhouse Entry', 18.5, -14.5);
  createTarget('t_cqb_2', 'Killhouse Corner', 25.5, -19.0);
  createTarget('t_cqb_3', 'Killhouse Deep', 21.5, -26.2, 2.2, 2.1);

  const resetTargets = () => {
    for (const t of targets) {
      t.hp = t.maxHp;
      t.down = false;
      t.downTimer = 0;
      t.tiltAngle = 0;
      t.pivot.rotation.x = 0;
      if (t.heldWeaponMesh) t.heldWeaponMesh.visible = true;
    }
  };

  const update = (dt: number) => {
    for (const t of targets) {
      if (t.strafeAmp > 0 && !t.down) {
        t.phase += t.strafeSpeed * dt;
        t.root.position.x = t.baseX + Math.sin(t.phase) * t.strafeAmp;
      }

      if (t.down) {
        t.downTimer -= dt;
        if (t.downTimer <= 0) {
          t.down = false;
          t.hp = t.maxHp;
          if (t.heldWeaponMesh) t.heldWeaponMesh.visible = true;
        }
      }

      const targetTilt = t.down ? -Math.PI * 0.48 : 0;
      t.tiltAngle += (targetTilt - t.tiltAngle) * (1 - Math.exp(-16 * dt));
      t.pivot.rotation.x = t.tiltAngle;

      if (t.flashTimer > 0) {
        t.flashTimer -= dt;
        t.plateMat.emissive.setHex(0x664018);
      } else {
        t.plateMat.emissive.setHex(0x000000);
      }
    }
  };

  return {
    spawnPosition: new THREE.Vector3(0, 0, 8),
    spawnYaw: 0,
    shootables,
    obstacleMeshes,
    targets,
    armedTargets,
    environmentTexture: envTex,
    update,
    resetTargets,
  };
}
