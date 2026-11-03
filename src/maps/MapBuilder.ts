import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CollisionWorld } from '../core/CollisionWorld';
import {
  MAP_DEFINITIONS,
  createMapMaterialLibrary,
  makeSignBannerTexture,
  type MapId,
  type MapMetadata,
  type MapMaterialLibrary,
} from './MapAssets';
import type { SpawnNode } from './SpawnSystem';
import { WEAPONS, type HitZone, type WeaponId } from '../weapons/WeaponDatabase';
import { buildWeaponModel } from '../player/WeaponModels';
import type { TargetDummy } from './TrainingGround';

export interface NavWaypoint {
  id: number;
  position: THREE.Vector3;
  neighbors: number[];
}

export interface BuiltMapResult {
  mapId: MapId;
  meta: MapMetadata;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  spawnNodes: SpawnNode[];
  navGraph: NavWaypoint[];
  patrolWaypoints: THREE.Vector3[];
  shootables: THREE.Object3D[];
  obstacleMeshes: THREE.Object3D[];
  armedTargets: TargetDummy[];
  environmentTexture: THREE.Texture;
  update: (dt: number) => void;
  resetTargets: () => void;
  dispose: () => void;
}

export class MapBuilder {
  private envTex: THREE.Texture | null = null;
  private mats: MapMaterialLibrary | null = null;
  private currentCleanup: (() => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly collisionWorld: CollisionWorld,
  ) {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.78;
    this.mats = createMapMaterialLibrary();
  }

  get environmentTexture(): THREE.Texture {
    return this.envTex!;
  }

  buildMap(
    mapId: MapId,
    onWeaponDrop?: (
      weaponId: WeaponId,
      currentMagAmmo: number,
      reserveAmmo: number,
      position: THREE.Vector3,
      velocity: THREE.Vector3,
    ) => void,
  ): BuiltMapResult {
    if (this.currentCleanup) {
      this.currentCleanup();
      this.currentCleanup = null;
    }

    this.collisionWorld.boxes.length = 0;

    const meta = MAP_DEFINITIONS[mapId];
    const lp = meta.lightingProfile;

    this.scene.background = new THREE.Color(lp.skyColor);
    this.scene.fog = new THREE.FogExp2(lp.fogColor, lp.fogDensity);
    this.renderer.toneMappingExposure = lp.exposure;

    const mapGroup = new THREE.Group();
    mapGroup.name = `map_${mapId}`;
    this.scene.add(mapGroup);

    // Lighting setup
    const sun = new THREE.DirectionalLight(lp.sunColor, lp.sunIntensity);
    sun.position.set(lp.sunPosition[0], lp.sunPosition[1], lp.sunPosition[2]);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 4;
    sun.shadow.camera.far = 190;
    const d = 75;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0004;
    mapGroup.add(sun);

    const hemi = new THREE.HemisphereLight(lp.hemiSkyColor, lp.hemiGroundColor, lp.hemiIntensity);
    mapGroup.add(hemi);

    const shootables: THREE.Object3D[] = [];
    const obstacleMeshes: THREE.Object3D[] = [];
    const spawnNodes: SpawnNode[] = [];
    const patrolWaypoints: THREE.Vector3[] = [];
    const armedTargets: TargetDummy[] = [];
    const dynamicMaterials: THREE.Material[] = [];
    const dynamicGeometries: THREE.BufferGeometry[] = [];
    const dynamicTextures: THREE.Texture[] = [];

    const addBox = (
      cx: number,
      cy: number,
      cz: number,
      w: number,
      h: number,
      l: number,
      mat: THREE.Material,
      collide = true,
    ): THREE.Mesh => {
      const geo = new THREE.BoxGeometry(w, h, l);
      dynamicGeometries.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, cy, cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mapGroup.add(mesh);
      shootables.push(mesh);
      if (collide) {
        obstacleMeshes.push(mesh);
        this.collisionWorld.addFromCenter(cx, cy, cz, w, h, l);
      }
      return mesh;
    };

    /**
     * Builds a stepped ramp / staircase from (x0, z0, y0) to (x1, z1, y1)
     * with step rises <= 0.35m so ArenaPlayerController & Bots climb smoothly.
     */
    const addRamp = (
      x0: number,
      z0: number,
      y0: number,
      x1: number,
      z1: number,
      y1: number,
      width: number,
      axis: 'x' | 'z',
      mat: THREE.Material,
    ): void => {
      const totalRise = Math.abs(y1 - y0);
      const steps = Math.max(4, Math.ceil(totalRise / 0.32));
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        const topY = THREE.MathUtils.lerp(y0, y1, (i + 1) / steps);
        const h = Math.max(0.2, topY);
        const cx = THREE.MathUtils.lerp(x0, x1, t);
        const cz = THREE.MathUtils.lerp(z0, z1, t);
        const stepLen =
          axis === 'z'
            ? Math.abs(z1 - z0) / steps + 0.08
            : Math.abs(x1 - x0) / steps + 0.08;
        const w = axis === 'z' ? width : stepLen;
        const l = axis === 'z' ? stepLen : width;
        addBox(cx, h * 0.5, cz, w, h, l, mat, true);
      }
    };

    const addBanner = (
      title: string,
      subtitle: string,
      x: number,
      y: number,
      z: number,
      rotY = 0,
      accent = '#e59a28',
    ): void => {
      const tex = makeSignBannerTexture(title, subtitle, accent);
      dynamicTextures.push(tex);
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      dynamicMaterials.push(mat);
      const geo = new THREE.PlaneGeometry(4.2, 1.05);
      dynamicGeometries.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.y = rotY;
      mapGroup.add(mesh);
    };

    let bounds = { minX: -32, maxX: 32, minZ: -32, maxZ: 32 };
    const M = this.mats!;

    if (mapId === 'killhouse_alpha') {
      bounds = this.buildKillhouseAlpha(mapGroup, M, addBox, addRamp, addBanner, spawnNodes, patrolWaypoints);
    } else if (mapId === 'blacksite_khyber') {
      bounds = this.buildBlackSiteKhyber(mapGroup, M, addBox, addRamp, addBanner, spawnNodes, patrolWaypoints);
    } else if (mapId === 'severomorsk_dock') {
      bounds = this.buildSeveromorskDock(mapGroup, M, addBox, addRamp, addBanner, spawnNodes, patrolWaypoints);
    } else {
      bounds = this.buildBoneYard(mapGroup, M, addBox, addRamp, addBanner, spawnNodes, patrolWaypoints);
    }

    // Ensure all obstacle meshes have updated world matrices before raycast-based NavGraph & SpawnSystem checks
    mapGroup.updateMatrixWorld(true);

    // Build interconnected AI Navigation Graph from patrolWaypoints
    const navGraph = this.buildNavGraph(patrolWaypoints, obstacleMeshes);

    // Spawn 5 Armed Scavenging Dummies in a perimeter tactical alcove so weapon drops can also be tested directly
    this.populateArmedDummies(
      mapGroup,
      bounds,
      M.darkSteel,
      shootables,
      armedTargets,
      dynamicGeometries,
      dynamicMaterials,
      onWeaponDrop,
    );
    mapGroup.updateMatrixWorld(true);

    const resetTargets = () => {
      for (const t of armedTargets) {
        t.hp = t.maxHp;
        t.down = false;
        t.downTimer = 0;
        t.tiltAngle = 0;
        t.pivot.rotation.x = 0;
        if (t.heldWeaponMesh) t.heldWeaponMesh.visible = true;
      }
    };

    const update = (dt: number) => {
      for (const t of armedTargets) {
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

    const dispose = () => {
      mapGroup.traverse((obj) => {
        if (obj instanceof THREE.DirectionalLight) {
          obj.shadow.map?.dispose();
          obj.dispose();
        } else if (obj instanceof THREE.Light) {
          obj.dispose();
        }
      });
      this.scene.remove(mapGroup);
      for (const g of dynamicGeometries) g.dispose();
      for (const m of dynamicMaterials) m.dispose();
      for (const t of dynamicTextures) t.dispose();
    };
    this.currentCleanup = dispose;

    return {
      mapId,
      meta,
      bounds,
      spawnNodes,
      navGraph,
      patrolWaypoints,
      shootables,
      obstacleMeshes,
      armedTargets,
      environmentTexture: this.envTex!,
      update,
      resetTargets,
      dispose,
    };
  }

  // ===========================================================================
  // MAP 1: Killhouse Alpha (Small indoor SAS tactical hangar, plywood/concrete
  // shoot-house, 2-story central tower, harsh overhead floodlights)
  // ===========================================================================
  private buildKillhouseAlpha(
    group: THREE.Group,
    M: MapMaterialLibrary,
    addBox: (cx: number, cy: number, cz: number, w: number, h: number, l: number, mat: THREE.Material, collide?: boolean) => THREE.Mesh,
    addRamp: (x0: number, z0: number, y0: number, x1: number, z1: number, y1: number, w: number, axis: 'x' | 'z', mat: THREE.Material) => void,
    addBanner: (title: string, sub: string, x: number, y: number, z: number, rotY?: number, accent?: string) => void,
    spawnNodes: SpawnNode[],
    patrolWaypoints: THREE.Vector3[],
  ) {
    // 56m x 56m Indoor Hangar Floor & Roof
    addBox(0, -0.5, 0, 56, 1, 56, M.hangarFloor, true);
    addBox(0, 11.5, 0, 56, 0.6, 56, M.darkSteel, false); // Hangar ceiling

    // Perimeter Hangar Walls
    addBox(0, 5.5, -28, 56, 11, 1, M.concreteWall, true);
    addBox(0, 5.5, 28, 56, 11, 1, M.concreteWall, true);
    addBox(-28, 5.5, 0, 1, 11, 56, M.concreteWall, true);
    addBox(28, 5.5, 0, 1, 11, 56, M.concreteWall, true);

    // Harsh Overhead SAS Floodlight Fixtures + PointLights
    const floodPositions: Array<[number, number]> = [
      [-14, -14],
      [14, -14],
      [-14, 14],
      [14, 14],
      [0, 0],
    ];
    for (const [fx, fz] of floodPositions) {
      addBox(fx, 10.8, fz, 2.8, 0.22, 1.2, M.floodlightEmissive, false);
      const pl = new THREE.PointLight(0xeef6ff, 42, 34, 1.5);
      pl.position.set(fx, 10.2, fz);
      group.add(pl);
    }

    // 2-Story Central Overwatch Tower (x: -4..4, z: -4..4)
    // Ground floor pillars + low cover walls
    addBox(-3.6, 1.6, -3.6, 0.7, 3.2, 0.7, M.darkSteel, true);
    addBox(3.6, 1.6, -3.6, 0.7, 3.2, 0.7, M.darkSteel, true);
    addBox(-3.6, 1.6, 3.6, 0.7, 3.2, 0.7, M.darkSteel, true);
    addBox(3.6, 1.6, 3.6, 0.7, 3.2, 0.7, M.darkSteel, true);
    addBox(0, 0.6, -3.6, 4.2, 1.2, 0.35, M.plywood, true);
    addBox(0, 0.6, 3.6, 4.2, 1.2, 0.35, M.plywood, true);

    // 2nd Floor Platform (y = 3.0m) + Plywood Parapet Cover
    addBox(0, 3.0, 0, 8.2, 0.35, 8.2, M.plywood, true);
    addBox(0, 3.7, -3.9, 5.6, 1.05, 0.3, M.plywood, true);
    addBox(0, 3.7, 3.9, 5.6, 1.05, 0.3, M.plywood, true);
    addBox(-3.9, 3.7, 0, 0.3, 1.05, 4.4, M.plywood, true);
    addBox(3.9, 3.7, 0, 0.3, 1.05, 4.4, M.plywood, true);

    // Dual Assault Ramps leading up to the 2nd Story Tower (West & East)
    addRamp(-9.5, -5.2, 0, -4.1, -5.2, 3.0, 2.2, 'x', M.plywood);
    addRamp(9.5, 5.2, 0, 4.1, 5.2, 3.0, 2.2, 'x', M.plywood);

    // Plywood & Concrete Shoot-House Quadrants (NW, NE, SW, SE) with 2.5m CQB breach doorways
    // NW Shoot-House Room
    addBox(-16.25, 1.6, -12, 7.5, 3.2, 0.4, M.plywood, true);
    addBox(-10, 1.6, -17, 0.4, 3.2, 10, M.plywood, true);
    addBox(-20, 1.6, -17, 0.4, 3.2, 10, M.concreteWall, true);
    addBox(-15, 0.65, -17, 2.2, 1.3, 1.4, M.hazard, true);

    // NE Shoot-House Breach Wing
    addBox(16.25, 1.6, -12, 7.5, 3.2, 0.4, M.plywood, true);
    addBox(10, 1.6, -17, 0.4, 3.2, 10, M.plywood, true);
    addBox(20, 1.6, -17, 0.4, 3.2, 10, M.concreteWall, true);
    addBox(15, 0.65, -17, 2.2, 1.3, 1.4, M.hazard, true);

    // SW Plywood Maze
    addBox(-16.25, 1.6, 12, 7.5, 3.2, 0.4, M.plywood, true);
    addBox(-10, 1.6, 17, 0.4, 3.2, 10, M.plywood, true);
    addBox(-20, 1.6, 17, 0.4, 3.2, 10, M.concreteWall, true);
    addBox(-15, 0.65, 17, 2.2, 1.3, 1.4, M.hazard, true);

    // SE Concrete & Plywood Shoothouse
    addBox(16.25, 1.6, 12, 7.5, 3.2, 0.4, M.plywood, true);
    addBox(10, 1.6, 17, 0.4, 3.2, 10, M.plywood, true);
    addBox(20, 1.6, 17, 0.4, 3.2, 10, M.concreteWall, true);
    addBox(15, 0.65, 17, 2.2, 1.3, 1.4, M.hazard, true);

    // Mid-Lane Sightline Breakers (prevent cross-map spawn LOS)
    addBox(0, 1.6, -15, 6.5, 3.2, 0.6, M.concreteWall, true);
    addBox(0, 1.6, 15, 6.5, 3.2, 0.6, M.concreteWall, true);
    addBox(-16, 1.6, 0, 0.6, 3.2, 6.5, M.concreteWall, true);
    addBox(16, 1.6, 0, 0.6, 3.2, 6.5, M.concreteWall, true);

    addBanner('KILLHOUSE ALPHA', 'SAS CQB SHOOT-HOUSE // CENTRAL TOWER', 0, 4.8, -4.1, 0, '#38bdf8');

    // 26 Spawn Nodes distributed behind cover rooms, corridors, and central tower
    const coords: Array<[number, number, number]> = [
      [-24, 0, -24], [-15, 0, -24], [-6, 0, -24], [6, 0, -24], [15, 0, -24], [24, 0, -24],
      [-24, 0, -15], [-14, 0, -15], [14, 0, -15], [24, 0, -15],
      [-24, 0, -6], [-12, 0, -6], [12, 0, -6], [24, 0, -6],
      [-24, 0, 6], [-12, 0, 6], [12, 0, 6], [24, 0, 6],
      [-24, 0, 15], [-14, 0, 15], [14, 0, 15], [24, 0, 15],
      [-24, 0, 24], [-6, 0, 24], [6, 0, 24], [24, 0, 24],
      [-2.2, 3.2, -2.2], [2.2, 3.2, 2.2],
    ];
    coords.forEach(([x, y, z], idx) => {
      spawnNodes.push({
        id: `kh_spawn_${idx + 1}`,
        position: new THREE.Vector3(x, y, z),
        yaw: Math.atan2(-x, -z),
      });
      patrolWaypoints.push(new THREE.Vector3(x, y, z));
    });
    patrolWaypoints.push(new THREE.Vector3(0, 0, -8), new THREE.Vector3(0, 0, 8), new THREE.Vector3(-8, 0, 0), new THREE.Vector3(8, 0, 0));

    return { minX: -27, maxX: 27, minZ: -27, maxZ: 27 };
  }

  // ===========================================================================
  // MAP 2: Black Site Khyber (Medium dusk mountain FOB, concrete bunkers,
  // HESCO barriers, central helipad, flank tunnels)
  // ===========================================================================
  private buildBlackSiteKhyber(
    group: THREE.Group,
    M: MapMaterialLibrary,
    addBox: (cx: number, cy: number, cz: number, w: number, h: number, l: number, mat: THREE.Material, collide?: boolean) => THREE.Mesh,
    addRamp: (x0: number, z0: number, y0: number, x1: number, z1: number, y1: number, w: number, axis: 'x' | 'z', mat: THREE.Material) => void,
    addBanner: (title: string, sub: string, x: number, y: number, z: number, rotY?: number, accent?: string) => void,
    spawnNodes: SpawnNode[],
    patrolWaypoints: THREE.Vector3[],
  ) {
    // 76m x 76m Mountain FOB Compound
    addBox(0, -0.5, 0, 76, 1, 76, M.khyberGround, true);

    // Perimeter Mountain Cliff / Compound Walls
    addBox(0, 4.5, -38, 76, 9, 1.5, M.bunkerConcrete, true);
    addBox(0, 4.5, 38, 76, 9, 1.5, M.bunkerConcrete, true);
    addBox(-38, 4.5, 0, 1.5, 9, 76, M.bunkerConcrete, true);
    addBox(38, 4.5, 0, 1.5, 9, 76, M.bunkerConcrete, true);

    // Central Elevated Helipad (x: -9..9, z: -9..9, height 1.5m)
    addBox(0, 0.75, 0, 18, 1.5, 18, M.helipadAsphalt, true);
    // Helipad 'H' markings
    addBox(-2.2, 1.52, 0, 0.6, 0.04, 6.0, M.hazard, false);
    addBox(2.2, 1.52, 0, 0.6, 0.04, 6.0, M.hazard, false);
    addBox(0, 1.52, 0, 4.4, 0.04, 0.6, M.hazard, false);

    // HESCO Bastion Berms on Helipad corners
    addBox(-7.2, 2.25, -7.2, 3.2, 1.5, 1.2, M.hescoBastion, true);
    addBox(7.2, 2.25, -7.2, 3.2, 1.5, 1.2, M.hescoBastion, true);
    addBox(-7.2, 2.25, 7.2, 3.2, 1.5, 1.2, M.hescoBastion, true);
    addBox(7.2, 2.25, 7.2, 3.2, 1.5, 1.2, M.hescoBastion, true);

    // 4 Helipad Access Ramps (N, S, E, W)
    addRamp(0, -13.5, 0, 0, -9.0, 1.5, 3.6, 'z', M.bunkerConcrete);
    addRamp(0, 13.5, 0, 0, 9.0, 1.5, 3.6, 'z', M.bunkerConcrete);
    addRamp(-13.5, 0, 0, -9.0, 0, 1.5, 3.6, 'x', M.bunkerConcrete);
    addRamp(13.5, 0, 0, 9.0, 0, 1.5, 3.6, 'x', M.bunkerConcrete);

    // North & South Concrete Command Bunkers
    addBox(0, 2.0, -24, 16, 4.0, 0.8, M.bunkerConcrete, true);
    addBox(-8, 2.0, -28, 0.8, 4.0, 8, M.bunkerConcrete, true);
    addBox(8, 2.0, -28, 0.8, 4.0, 8, M.bunkerConcrete, true);
    addBox(0, 4.1, -28, 17, 0.5, 9, M.bunkerConcrete, true); // Bunker roof

    addBox(0, 2.0, 24, 16, 4.0, 0.8, M.bunkerConcrete, true);
    addBox(-8, 2.0, 28, 0.8, 4.0, 8, M.bunkerConcrete, true);
    addBox(8, 2.0, 28, 0.8, 4.0, 8, M.bunkerConcrete, true);
    addBox(0, 4.1, 28, 17, 0.5, 9, M.bunkerConcrete, true);

    // Covered West & East Flank Tunnels (x = -28 and x = +28)
    for (const sx of [-1, 1]) {
      const tx = sx * 28;
      addBox(tx - sx * 3.2, 2.0, 0, 0.7, 4.0, 38, M.bunkerConcrete, true);
      addBox(tx + sx * 3.2, 2.0, 0, 0.7, 4.0, 38, M.bunkerConcrete, true);
      addBox(tx, 4.2, 0, 7.2, 0.5, 38, M.bunkerConcrete, true); // Tunnel ceiling
      // Interior tunnel HESCO cover blocks
      addBox(tx - sx * 1.1, 0.75, -10, 1.8, 1.5, 1.6, M.hescoBastion, true);
      addBox(tx + sx * 1.1, 0.75, 10, 1.8, 1.5, 1.6, M.hescoBastion, true);

      const tl = new THREE.PointLight(0xff8e42, 18, 24, 1.5);
      tl.position.set(tx, 3.6, 0);
      group.add(tl);
    }

    // Scattered HESCO Barriers in Courtyard Quadrants
    const hescoCoords: Array<[number, number, number, number]> = [
      [-16, -16, 4.2, 1.6],
      [16, -16, 4.2, 1.6],
      [-16, 16, 4.2, 1.6],
      [16, 16, 4.2, 1.6],
      [-18, -6, 1.6, 4.2],
      [18, 6, 1.6, 4.2],
    ];
    for (const [hx, hz, hw, hl] of hescoCoords) {
      addBox(hx, 0.95, hz, hw, 1.9, hl, M.hescoBastion, true);
    }

    addBanner('BLACK SITE KHYBER', 'DUSK MOUNTAIN FOB // HELIPAD & FLANK TUNNELS', 0, 5.2, -23.5, 0, '#fb923c');

    // 26 Spawn Nodes inside bunkers, flank tunnels, behind HESCO walls, and courtyard corners
    const coords: Array<[number, number, number]> = [
      [-33, 0, -33], [-20, 0, -33], [-4, 0, -30], [4, 0, -30], [20, 0, -33], [33, 0, -33],
      [-28, 0, -16], [-19, 0, -20], [19, 0, -20], [28, 0, -16],
      [-28, 0, -4], [-21, 0, -9], [21, 0, -9], [28, 0, -4],
      [-28, 0, 4], [-21, 0, 9], [21, 0, 9], [28, 0, 4],
      [-28, 0, 16], [-19, 0, 20], [19, 0, 20], [28, 0, 16],
      [-33, 0, 33], [-4, 0, 30], [4, 0, 30], [33, 0, 33],
      [-4.8, 1.5, -4.8], [4.8, 1.5, 4.8],
    ];
    coords.forEach(([x, y, z], idx) => {
      spawnNodes.push({
        id: `khyber_spawn_${idx + 1}`,
        position: new THREE.Vector3(x, y, z),
        yaw: Math.atan2(-x, -z),
      });
      patrolWaypoints.push(new THREE.Vector3(x, y, z));
    });
    patrolWaypoints.push(new THREE.Vector3(0, 1.5, 0));

    return { minX: -36.5, maxX: 36.5, minZ: -36.5, maxZ: 36.5 };
  }

  // ===========================================================================
  // MAP 3: Severomorsk Dock (Medium-Large snowy cold-war submarine pen,
  // multi-tiered rusted steel catwalks overlooking a drydock floor)
  // ===========================================================================
  private buildSeveromorskDock(
    _group: THREE.Group,
    M: MapMaterialLibrary,
    addBox: (cx: number, cy: number, cz: number, w: number, h: number, l: number, mat: THREE.Material, collide?: boolean) => THREE.Mesh,
    addRamp: (x0: number, z0: number, y0: number, x1: number, z1: number, y1: number, w: number, axis: 'x' | 'z', mat: THREE.Material) => void,
    addBanner: (title: string, sub: string, x: number, y: number, z: number, rotY?: number, accent?: string) => void,
    spawnNodes: SpawnNode[],
    patrolWaypoints: THREE.Vector3[],
  ) {
    // 80m x 92m Submarine Pen Drydock Floor (y = 0)
    addBox(0, -0.5, 0, 80, 1, 92, M.drydockBasin, true);

    // Perimeter Pen Concrete Walls
    addBox(0, 6, -46, 80, 12, 1.5, M.snowConcrete, true);
    addBox(0, 6, 46, 80, 12, 1.5, M.snowConcrete, true);
    addBox(-40, 6, 0, 1.5, 12, 92, M.snowConcrete, true);
    addBox(40, 6, 0, 1.5, 12, 92, M.snowConcrete, true);

    // Central Moored Cold-War Submarine Hull (x: -4.5..4.5, z: -26..26, deck height 2.4m)
    addBox(0, 1.2, 0, 9.0, 2.4, 52, M.subHullSteel, true);
    // Submarine Conning Tower / Sail in center (breaks long center sightline)
    addBox(0, 4.2, -2, 3.8, 3.6, 11, M.subHullSteel, true);
    // Bow & Stern Ramps onto the Submarine Deck
    addRamp(0, -31.5, 0, 0, -26.0, 2.4, 4.0, 'z', M.rustedCatwalk);
    addRamp(0, 31.5, 0, 0, 26.0, 2.4, 4.0, 'z', M.rustedCatwalk);

    // Tier-1 Snow-Dusted Concrete Quayside Decks (West x = -22, East x = +22, height 2.4m)
    addBox(-24, 1.2, 0, 16, 2.4, 76, M.snowConcrete, true);
    addBox(24, 1.2, 0, 16, 2.4, 76, M.snowConcrete, true);

    // Ramps from Drydock Floor (y = 0) up to Quayside Decks (y = 2.4m)
    addRamp(-11, -20, 0, -16, -20, 2.4, 3.4, 'x', M.rustedCatwalk);
    addRamp(-11, 20, 0, -16, 20, 2.4, 3.4, 'x', M.rustedCatwalk);
    addRamp(11, -20, 0, 16, -20, 2.4, 3.4, 'x', M.rustedCatwalk);
    addRamp(11, 20, 0, 16, 20, 2.4, 3.4, 'x', M.rustedCatwalk);

    // Tier-2 Elevated Rusted Steel Catwalks (y = 4.8m) overlooking the Drydock & Sub Deck
    addBox(-33, 4.6, 0, 6, 0.4, 68, M.rustedCatwalk, true);
    addBox(33, 4.6, 0, 6, 0.4, 68, M.rustedCatwalk, true);
    // Cross-Dock Overhead Steel Catwalk Bridges at z = -16 and z = +16 (height 2.4m connecting Quays to Sub Deck)
    addBox(0, 2.25, -15, 32, 0.35, 3.4, M.rustedCatwalk, true);
    addBox(0, 2.25, 15, 32, 0.35, 3.4, M.rustedCatwalk, true);

    // Ramps from Tier-1 Quayside (2.4m) to Tier-2 High Catwalks (4.8m)
    addRamp(-28, -28, 2.4, -28, -21, 4.8, 3.0, 'z', M.rustedCatwalk);
    addRamp(-28, 28, 2.4, -28, 21, 4.8, 3.0, 'z', M.rustedCatwalk);
    addRamp(28, -28, 2.4, 28, -21, 4.8, 3.0, 'z', M.rustedCatwalk);
    addRamp(28, 28, 2.4, 28, 21, 4.8, 3.0, 'z', M.rustedCatwalk);

    // Steel Cover Bulkheads & Cargo Containers on Quayside & Drydock Floor
    const bulkheads: Array<[number, number, number, number, number, number]> = [
      [-22, 3.4, -10, 4.5, 2.0, 1.4],
      [-22, 3.4, 10, 4.5, 2.0, 1.4],
      [22, 3.4, -10, 4.5, 2.0, 1.4],
      [22, 3.4, 10, 4.5, 2.0, 1.4],
      [-10, 1.1, -8, 3.2, 2.2, 3.2],
      [10, 1.1, 8, 3.2, 2.2, 3.2],
      [-10, 1.1, 26, 3.6, 2.2, 2.2],
      [10, 1.1, -26, 3.6, 2.2, 2.2],
      [0, 1.2, -37, 8.0, 2.4, 1.2],
      [0, 1.2, 37, 8.0, 2.4, 1.2],
    ];
    for (const [bx, by, bz, bw, bh, bl] of bulkheads) {
      addBox(bx, by, bz, bw, bh, bl, M.darkSteel, true);
    }

    addBanner('SEVEROMORSK DOCK', 'SUBMARINE PEN-09 // MULTI-TIER CATWALKS', 0, 6.6, -2.0, 0, '#38bdf8');

    // 26 Spawn Nodes across drydock basin, quayside decks, and upper catwalks
    const coords: Array<[number, number, number]> = [
      [-35, 0, -41], [-12, 0, -41], [12, 0, -41], [35, 0, -41],
      [-11, 0, -30], [11, 0, -30], [-11, 0, -12], [11, 0, -12],
      [-11, 0, 12], [11, 0, 12], [-11, 0, 30], [11, 0, 30],
      [-35, 0, 41], [-12, 0, 41], [12, 0, 41], [35, 0, 41],
      [-23, 2.4, -32], [-23, 2.4, -16], [-23, 2.4, 0], [-23, 2.4, 16], [-23, 2.4, 32],
      [23, 2.4, -32], [23, 2.4, -16], [23, 2.4, 0], [23, 2.4, 16], [23, 2.4, 32],
    ];
    coords.forEach(([x, y, z], idx) => {
      spawnNodes.push({
        id: `dock_spawn_${idx + 1}`,
        position: new THREE.Vector3(x, y, z),
        yaw: Math.atan2(-x, -z),
      });
      patrolWaypoints.push(new THREE.Vector3(x, y, z));
    });

    return { minX: -38.5, maxX: 38.5, minZ: -44.5, maxZ: 44.5 };
  }

  // ===========================================================================
  // MAP 4: Bone Yard (Large desert aircraft scrapyard at high noon, C-130
  // fuselage CQB maze in the center with an outer sniper perimeter)
  // ===========================================================================
  private buildBoneYard(
    _group: THREE.Group,
    M: MapMaterialLibrary,
    addBox: (cx: number, cy: number, cz: number, w: number, h: number, l: number, mat: THREE.Material, collide?: boolean) => THREE.Mesh,
    addRamp: (x0: number, z0: number, y0: number, x1: number, z1: number, y1: number, w: number, axis: 'x' | 'z', mat: THREE.Material) => void,
    addBanner: (title: string, sub: string, x: number, y: number, z: number, rotY?: number, accent?: string) => void,
    spawnNodes: SpawnNode[],
    patrolWaypoints: THREE.Vector3[],
  ) {
    // 96m x 96m Desert Scrapyard Floor
    addBox(0, -0.5, 0, 96, 1, 96, M.desertSand, true);

    // Outer Boundary Walls
    addBox(0, 5, -48, 96, 10, 1.5, M.sniperBermRock, true);
    addBox(0, 5, 48, 96, 10, 1.5, M.sniperBermRock, true);
    addBox(-48, 5, 0, 1.5, 10, 96, M.sniperBermRock, true);
    addBox(48, 5, 0, 1.5, 10, 96, M.sniperBermRock, true);

    // Central C-130 Hercules Fuselage CQB Maze:
    // Main Fuselage A (runs North-South along x = -6, z = -18..18)
    addBox(-8.6, 1.8, -8, 0.5, 3.6, 14, M.aircraftFuselage, true);
    addBox(-8.6, 1.8, 8, 0.5, 3.6, 14, M.aircraftFuselage, true);
    addBox(-3.4, 1.8, -8, 0.5, 3.6, 14, M.aircraftFuselage, true);
    addBox(-3.4, 1.8, 8, 0.5, 3.6, 14, M.aircraftFuselage, true);
    addBox(-6.0, 3.7, 0, 5.7, 0.4, 34, M.aircraftFuselage, true); // Fuselage A roof
    addBox(-6.0, 3.2, -16, 4.8, 4.5, 0.6, M.aircraftFuselage, false); // Tail fin

    // Main Fuselage B (offset parallel hull along x = +7, z = -16..16)
    addBox(4.4, 1.8, -7, 0.5, 3.6, 12, M.aircraftFuselage, true);
    addBox(4.4, 1.8, 7, 0.5, 3.6, 12, M.aircraftFuselage, true);
    addBox(9.6, 1.8, -7, 0.5, 3.6, 12, M.aircraftFuselage, true);
    addBox(9.6, 1.8, 7, 0.5, 3.6, 12, M.aircraftFuselage, true);
    addBox(7.0, 3.7, 0, 5.7, 0.4, 30, M.aircraftFuselage, true); // Fuselage B roof

    // Sheared C-130 Wing Span bridging the center CQB courtyard & acting as an overhead catwalk
    addBox(0.5, 3.7, 0, 28, 0.35, 5.2, M.aircraftFuselage, true);
    // Ramps up onto the C-130 Wing Deck (West & East wingtips drooped to ground)
    addRamp(-18.5, 0, 0, -13.5, 0, 3.7, 4.2, 'x', M.aircraftFuselage);
    addRamp(19.5, 0, 0, 14.5, 0, 3.7, 4.2, 'x', M.aircraftFuselage);

    // Severed Cockpit & Engine Cowling Cover Blocks in the CQB Maze
    addBox(0.5, 1.1, -11, 3.4, 2.2, 4.5, M.aircraftInterior, true);
    addBox(0.5, 1.1, 11, 3.4, 2.2, 4.5, M.aircraftInterior, true);
    addBox(-15, 1.2, -12, 4.2, 2.4, 2.6, M.aircraftInterior, true);
    addBox(16, 1.2, 12, 4.2, 2.4, 2.6, M.aircraftInterior, true);
    addBox(-15, 1.2, 12, 4.2, 2.4, 2.6, M.aircraftInterior, true);
    addBox(16, 1.2, -12, 4.2, 2.4, 2.6, M.aircraftInterior, true);

    // Outer Elevated Sniper Perimeter Berms (North, South, West, East ridges at height 2.8m)
    addBox(0, 1.4, -36, 44, 2.8, 6, M.sniperBermRock, true);
    addRamp(-26, -36, 0, -22, -36, 2.8, 4.0, 'x', M.sniperBermRock);
    addRamp(26, -36, 0, 22, -36, 2.8, 4.0, 'x', M.sniperBermRock);

    addBox(0, 1.4, 36, 44, 2.8, 6, M.sniperBermRock, true);
    addRamp(-26, 36, 0, -22, 36, 2.8, 4.0, 'x', M.sniperBermRock);
    addRamp(26, 36, 0, 22, 36, 2.8, 4.0, 'x', M.sniperBermRock);

    // Sniper cover blocks along outer perimeter
    addBox(-12, 3.4, -33.4, 3.8, 1.2, 0.6, M.hescoBastion, true);
    addBox(12, 3.4, -33.4, 3.8, 1.2, 0.6, M.hescoBastion, true);
    addBox(-12, 3.4, 33.4, 3.8, 1.2, 0.6, M.hescoBastion, true);
    addBox(12, 3.4, 33.4, 3.8, 1.2, 0.6, M.hescoBastion, true);

    addBox(-34, 1.5, -20, 4.5, 3.0, 4.5, M.aircraftInterior, true);
    addBox(34, 1.5, -20, 4.5, 3.0, 4.5, M.aircraftInterior, true);
    addBox(-34, 1.5, 20, 4.5, 3.0, 4.5, M.aircraftInterior, true);
    addBox(34, 1.5, 20, 4.5, 3.0, 4.5, M.aircraftInterior, true);

    addBanner('BONE YARD', 'C-130 FUSELAGE CQB MAZE // SNIPER PERIMETER', 0.5, 5.1, -2.7, 0, '#fbbf24');

    // 28 Spawn Nodes across the C-130 fuselage bays, scrapyard flanks, and outer sniper perimeter
    const coords: Array<[number, number, number]> = [
      [-42, 0, -42], [-16, 2.8, -36], [0, 2.8, -36], [16, 2.8, -36], [42, 0, -42],
      [-38, 0, -26], [-22, 0, -24], [0, 0, -24], [22, 0, -24], [38, 0, -26],
      [-28, 0, -10], [-6, 0, -10], [7, 0, -10], [28, 0, -10],
      [-28, 0, 10], [-6, 0, 10], [7, 0, 10], [28, 0, 10],
      [-38, 0, 26], [-22, 0, 24], [0, 0, 24], [22, 0, 24], [38, 0, 26],
      [-42, 0, 42], [-16, 2.8, 36], [0, 2.8, 36], [16, 2.8, 36], [42, 0, 42],
    ];
    coords.forEach(([x, y, z], idx) => {
      spawnNodes.push({
        id: `boneyard_spawn_${idx + 1}`,
        position: new THREE.Vector3(x, y, z),
        yaw: Math.atan2(-x, -z),
      });
      patrolWaypoints.push(new THREE.Vector3(x, y, z));
    });

    return { minX: -46.5, maxX: 46.5, minZ: -46.5, maxZ: 46.5 };
  }

  private buildNavGraph(waypoints: THREE.Vector3[], obstacleMeshes: THREE.Object3D[]): NavWaypoint[] {
    const raycaster = new THREE.Raycaster();
    const aEye = new THREE.Vector3();
    const bEye = new THREE.Vector3();
    const dir = new THREE.Vector3();

    const graph: NavWaypoint[] = waypoints.map((pos, idx) => ({
      id: idx,
      position: pos.clone(),
      neighbors: [],
    }));

    for (let i = 0; i < graph.length; i++) {
      for (let j = i + 1; j < graph.length; j++) {
        const dist = graph[i].position.distanceTo(graph[j].position);
        if (dist > 28) continue;

        aEye.copy(graph[i].position).setY(graph[i].position.y + 1.0);
        bEye.copy(graph[j].position).setY(graph[j].position.y + 1.0);
        dir.subVectors(bEye, aEye).normalize();
        raycaster.set(aEye, dir);
        raycaster.near = 0.2;
        raycaster.far = dist - 0.2;
        if (raycaster.intersectObjects(obstacleMeshes, false).length === 0) {
          graph[i].neighbors.push(j);
          graph[j].neighbors.push(i);
        }
      }
    }
    return graph;
  }

  private populateArmedDummies(
    mapGroup: THREE.Group,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    pedestalMat: THREE.Material,
    shootables: THREE.Object3D[],
    armedTargets: TargetDummy[],
    dynamicGeometries: THREE.BufferGeometry[],
    dynamicMaterials: THREE.Material[],
    onWeaponDrop?: (
      weaponId: WeaponId,
      currentMagAmmo: number,
      reserveAmmo: number,
      position: THREE.Vector3,
      velocity: THREE.Vector3,
    ) => void,
  ): void {
    const alcoveZ = bounds.maxZ - 1.4;
    const roster: Array<{ id: string; weaponId: WeaponId; mag: number; reserve: number; x: number; z: number }> = [
      { id: 'armed_1', weaponId: 'm4a1_sopmod', mag: 20, reserve: 10, x: -6.8, z: alcoveZ },
      { id: 'armed_2', weaponId: 'ak105_zenit', mag: 24, reserve: 30, x: -3.4, z: alcoveZ },
      { id: 'armed_3', weaponId: 'mp7a1_navy', mag: 32, reserve: 40, x: 0.0, z: alcoveZ },
      { id: 'armed_4', weaponId: 'm1014_breacher', mag: 6, reserve: 7, x: 3.4, z: alcoveZ },
      { id: 'armed_5', weaponId: 'awm_338', mag: 4, reserve: 5, x: 6.8, z: alcoveZ },
    ];

    const baseGeo = new THREE.BoxGeometry(0.85, 0.12, 0.55);
    const torsoGeo = new THREE.BoxGeometry(0.48, 0.66, 0.22);
    const headGeo = new THREE.BoxGeometry(0.24, 0.27, 0.24);
    const legsGeo = new THREE.BoxGeometry(0.38, 0.72, 0.16);
    dynamicGeometries.push(baseGeo, torsoGeo, headGeo, legsGeo);

    for (const cfg of roster) {
      const floorY =
        this.collisionWorld.highestFloor(
          cfg.x - 0.3,
          cfg.x + 0.3,
          cfg.z - 0.3,
          cfg.z + 0.3,
          -1.0,
          6.0,
        ) ?? 0;

      const root = new THREE.Group();
      root.position.set(cfg.x, floorY, cfg.z);
      mapGroup.add(root);

      const baseMesh = new THREE.Mesh(baseGeo, pedestalMat);
      baseMesh.position.y = 0.06;
      root.add(baseMesh);

      const pivot = new THREE.Group();
      pivot.position.set(0, 0.12, 0);
      root.add(pivot);

      const plateMat = new THREE.MeshStandardMaterial({ color: 0x354338, roughness: 0.42, metalness: 0.65 });
      const headMat = new THREE.MeshStandardMaterial({ color: 0xd94832, roughness: 0.35, metalness: 0.4 });
      const limbMat = new THREE.MeshStandardMaterial({ color: 0x454e59, roughness: 0.55, metalness: 0.5 });
      dynamicMaterials.push(plateMat, headMat, limbMat);

      const torso = new THREE.Mesh(torsoGeo, plateMat);
      torso.position.set(0, 1.05, 0);
      torso.userData.hitZone = 'body' satisfies HitZone;

      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(0, 1.55, 0);
      head.userData.hitZone = 'head' satisfies HitZone;

      const legs = new THREE.Mesh(legsGeo, limbMat);
      legs.position.set(0, 0.36, 0);
      legs.userData.hitZone = 'limb' satisfies HitZone;

      const built = buildWeaponModel(cfg.weaponId);
      const heldWeaponMesh = built.root;
      heldWeaponMesh.scale.setScalar(1.05);
      heldWeaponMesh.rotation.set(0, Math.PI, 0);
      heldWeaponMesh.position.set(0.22, 1.02, 0.24);
      heldWeaponMesh.traverse((o) => {
        o.raycast = () => {};
        if (o instanceof THREE.Mesh) {
          dynamicGeometries.push(o.geometry);
        }
      });

      pivot.add(legs, torso, head, heldWeaponMesh);
      shootables.push(pivot);

      const dummy: TargetDummy = {
        id: cfg.id,
        label: WEAPONS[cfg.weaponId].name,
        root,
        pivot,
        hp: 100,
        maxHp: 100,
        down: false,
        downTimer: 0,
        tiltAngle: 0,
        baseX: cfg.x,
        strafeAmp: 0,
        strafeSpeed: 0,
        phase: 0,
        plateMat,
        headMat,
        flashTimer: 0,
        heldWeaponId: cfg.weaponId,
        heldMagAmmo: cfg.mag,
        heldReserveAmmo: cfg.reserve,
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
            onWeaponDrop(
              dummy.heldWeaponId,
              dummy.heldMagAmmo,
              dummy.heldReserveAmmo,
              new THREE.Vector3(dummy.root.position.x, dummy.root.position.y + 1.1, dummy.root.position.z - 0.55),
              new THREE.Vector3((Math.random() - 0.5) * 0.8, 2.3, -1.8),
            );
          }
          return true;
        }
        return false;
      };

      armedTargets.push(dummy);
    }
  }
}
