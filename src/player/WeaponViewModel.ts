import * as THREE from 'three';
import { buildWeaponModel, type WeaponModel } from './WeaponModels';
import type { WeaponDef, WeaponId } from '../weapons/WeaponDatabase';

/** Per-frame animation inputs supplied by the game loop. */
export interface ViewModelFrame {
  adsEase: number;
  magnification: number;
  speed: number;
  onGround: boolean;
  sprinting: boolean;
  sliding: boolean;
  crouching: boolean;
  strideDistance: number;
  landDip: number;
  mouseDX: number;
  mouseDY: number;
  state: 'idle' | 'reloading' | 'equipping' | 'cycling';
  stateProgress: number;
  reloadEmpty: boolean;
  shellPulse: number;
  magEmpty: boolean;
}

const smooth = (a: number, b: number, t: number) => {
  const x = THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

function makeFlashTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,240,1)');
  grad.addColorStop(0.25, 'rgba(255,210,120,0.9)');
  grad.addColorStop(0.6, 'rgba(255,120,30,0.35)');
  grad.addColorStop(1, 'rgba(255,80,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'lighter';
  g.translate(s / 2, s / 2);
  for (let i = 0; i < 7; i++) {
    g.rotate((Math.PI * 2) / 7 + Math.random() * 0.3);
    const lg = g.createLinearGradient(0, 0, s / 2, 0);
    lg.addColorStop(0, 'rgba(255,230,160,0.9)');
    lg.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(0, -4);
    g.lineTo(s / 2, 0);
    g.lineTo(0, 4);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeSideFlashTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 64;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(255,250,220,1)');
  grad.addColorStop(0.3, 'rgba(255,190,90,0.85)');
  grad.addColorStop(1, 'rgba(255,90,10,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, h / 2 - 10);
  g.quadraticCurveTo(w * 0.4, 0, w, h / 2);
  g.quadraticCurveTo(w * 0.4, h, 0, h / 2 + 10);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * WeaponViewModel — first-person weapon rendering & procedural animation.
 * Owns its own scene + camera (rendered as a second pass over the world).
 */
export class WeaponViewModel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly models = new Map<WeaponId, WeaponModel>();
  private current: WeaponModel;
  private currentDef: WeaponDef | null = null;
  private readonly baseFov = 54;

  get currentRoot(): THREE.Group {
    return this.current.root;
  }

  private readonly flash = new THREE.Group();
  private readonly flashMats: THREE.MeshBasicMaterial[] = [];
  private flashTimer = 0;

  // animation state
  private readonly sway = new THREE.Vector2();
  private readonly swayVel = new THREE.Vector2();
  private kickZ = 0;
  private kickPitch = 0;
  private kickYaw = 0;
  private kickRoll = 0;
  private slideKick = 0;
  private sprintBlend = 0;
  private slideBlend = 0;
  private bobAmount = 0;

  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpV = new THREE.Vector3();

  constructor(aspect: number, environment: THREE.Texture | null) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.01, 10);
    this.scene.environment = environment;
    this.scene.environmentIntensity = 0.9;

    const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
    key.position.set(0.6, 1.0, 0.4);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 0.8);
    rim.position.set(-0.8, 0.3, -1);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xcfe3ff, 0x3a3226, 0.35));

    const ids: WeaponId[] = [
      'm4a1_sopmod', 'ak105_zenit', 'mp7a1_navy', 'vector_45', 'm1014_breacher',
      'mk14_ebr', 'awm_338', 'm249_saw', 'glock19',
    ];
    for (const id of ids) {
      const m = buildWeaponModel(id);
      m.root.visible = false;
      m.root.traverse((o) => {
        o.frustumCulled = false;
      });
      this.scene.add(m.root);
      this.models.set(id, m);
    }
    this.current = this.models.get('m4a1_sopmod')!;
    this.buildFlash();
  }

  private buildFlash(): void {
    const front = makeFlashTexture();
    const side = makeSideFlashTexture();
    const mk = (tex: THREE.Texture) => {
      const m = new THREE.MeshBasicMaterial({
        map: tex, color: new THREE.Color(5, 3.6, 2.2), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      this.flashMats.push(m);
      return m;
    };
    const frontMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), mk(front));
    frontMesh.position.z = -0.01;
    this.flash.add(frontMesh);
    const sideGeo = new THREE.PlaneGeometry(0.16, 0.05);
    sideGeo.translate(0.08, 0, 0);
    sideGeo.rotateY(Math.PI / 2); // extend along -Z
    const s1 = new THREE.Mesh(sideGeo, mk(side));
    const s2 = new THREE.Mesh(sideGeo, mk(side));
    s2.rotation.z = Math.PI / 2;
    this.flash.add(s1, s2);
    this.flash.visible = false;
    this.flash.traverse((o) => {
      o.frustumCulled = false;
    });
  }

  setWeapon(def: WeaponDef): void {
    this.current.root.visible = false;
    this.current = this.models.get(def.id)!;
    this.currentDef = def;
    this.current.root.visible = true;
    this.current.root.add(this.flash);
    this.flash.position.copy(this.current.muzzle);
    this.flash.scale.setScalar(def.fx.muzzleFlashScale);
    this.current.mag.position.copy(this.current.magRest);
    this.current.mag.visible = def.ammo.reloadStyle !== 'shell';
    if (this.current.bolt) this.current.bolt.position.copy(this.current.boltRest);
    this.kickZ = this.kickPitch = this.kickYaw = this.kickRoll = 0;
  }

  get model(): WeaponModel {
    return this.current;
  }

  onShot(def: WeaponDef, adsEase: number): void {
    const k = 1 - adsEase * 0.55;
    this.kickZ += def.recoil.viewmodelKickZ * k;
    this.kickPitch += def.recoil.viewmodelKickRot * k;
    this.kickYaw += (Math.random() - 0.5) * def.recoil.viewmodelKickRot * 0.4 * k;
    this.kickRoll += (Math.random() - 0.5) * def.recoil.viewmodelKickRot * 0.6 * k;
    this.slideKick = 1;
    this.flashTimer = 0.04;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    const s = def.fx.muzzleFlashScale * (0.85 + Math.random() * 0.3);
    this.flash.scale.setScalar(s);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Muzzle position projected from viewmodel space into the world, so tracers
   * visually originate from the barrel despite the separate viewmodel FOV.
   */
  getMuzzleWorld(worldCamera: THREE.PerspectiveCamera, out: THREE.Vector3): THREE.Vector3 {
    this.current.root.updateMatrixWorld(true);
    this.tmpPos.copy(this.current.muzzle).applyMatrix4(this.current.root.matrixWorld);
    const viewDist = -this.tmpPos.z;
    this.tmpPos.project(this.camera);
    this.tmpV.set(this.tmpPos.x, this.tmpPos.y, 0.5).unproject(worldCamera).sub(worldCamera.position).normalize();
    const dist = THREE.MathUtils.clamp(viewDist * 2.0, 0.6, 1.6);
    return out.copy(worldCamera.position).addScaledVector(this.tmpV, dist);
  }

  update(dt: number, f: ViewModelFrame): void {
    const m = this.current;
    const def = this.currentDef;
    if (!def) return;
    const ads = f.adsEase;

    // Hip -> ADS position: optic centre lands exactly on the screen centre.
    const adsX = -m.sight.x;
    const adsY = -m.sight.y;
    const adsZ = -m.adsDistance - m.sight.z;
    let px = THREE.MathUtils.lerp(m.hipOffset.x, adsX, ads);
    let py = THREE.MathUtils.lerp(m.hipOffset.y, adsY, ads);
    let pz = THREE.MathUtils.lerp(m.hipOffset.z, adsZ, ads);
    let rx = 0;
    let ry = 0;
    let rz = 0;

    // Head-bob (weapon only — the camera stays rock steady).
    const bobTarget = f.onGround && !f.sliding ? THREE.MathUtils.clamp(f.speed / 7.5, 0, 1.4) : 0;
    this.bobAmount += (bobTarget - this.bobAmount) * (1 - Math.exp(-10 * dt));
    const phase = f.strideDistance * 2.6;
    const bobScale = this.bobAmount * (1 - 0.88 * ads);
    px += Math.sin(phase * 0.5) * 0.009 * bobScale;
    py += -Math.abs(Math.cos(phase * 0.5)) * 0.009 * bobScale + 0.0045 * bobScale;
    rz += Math.sin(phase * 0.5) * 0.015 * bobScale;

    // Mouse sway (spring) — cosmetic lag on the weapon only.
    const swayScale = 1 - 0.85 * ads;
    const tx = THREE.MathUtils.clamp(-f.mouseDX * 0.00022, -0.04, 0.04) * swayScale;
    const ty = THREE.MathUtils.clamp(f.mouseDY * 0.00022, -0.04, 0.04) * swayScale;
    const k = 140;
    const d = 18;
    this.swayVel.x += ((tx - this.sway.x) * k - this.swayVel.x * d) * dt;
    this.swayVel.y += ((ty - this.sway.y) * k - this.swayVel.y * d) * dt;
    this.sway.x += this.swayVel.x * dt;
    this.sway.y += this.swayVel.y * dt;
    px += this.sway.x * 0.35;
    py += this.sway.y * 0.35;
    ry += this.sway.x * 1.2;
    rx += this.sway.y * 1.0;
    rz += this.sway.x * 1.4;

    // Landing dip
    py -= f.landDip * 0.35 * (1 - 0.7 * ads);

    // Sprint pose
    this.sprintBlend += ((f.sprinting && f.state !== 'reloading' ? 1 : 0) - this.sprintBlend) * (1 - Math.exp(-9 * dt));
    const sp = this.sprintBlend * (1 - ads);
    px += 0.03 * sp;
    py -= 0.035 * sp;
    rx -= 0.22 * sp;
    ry += 0.55 * sp;
    rz += 0.28 * sp;
    if (f.sprinting) {
      py += Math.sin(phase) * 0.006 * sp;
    }

    // Slide tilt
    this.slideBlend += ((f.sliding ? 1 : 0) - this.slideBlend) * (1 - Math.exp(-10 * dt));
    rz += 0.22 * this.slideBlend * (1 - ads * 0.8);
    py -= 0.012 * this.slideBlend * (1 - ads);

    // Crouch subtle lower
    if (f.crouching && !f.sliding) py -= 0.004 * (1 - ads);

    // Recoil kick (exponential spring back)
    this.kickZ *= Math.exp(-16 * dt);
    this.kickPitch *= Math.exp(-14 * dt);
    this.kickYaw *= Math.exp(-14 * dt);
    this.kickRoll *= Math.exp(-12 * dt);
    pz += this.kickZ;
    py += this.kickZ * 0.15;
    rx += this.kickPitch;
    ry += this.kickYaw;
    rz += this.kickRoll;

    // Reload / equip / bolt animations
    m.mag.position.copy(m.magRest);
    if (def.ammo.reloadStyle === 'shell') m.mag.visible = false;
    else m.mag.visible = true;

    if (f.state === 'reloading') {
      if (def.ammo.reloadStyle === 'magazine') {
        const t = f.stateProgress;
        const env = smooth(0.0, 0.14, t) * (1 - smooth(0.84, 1.0, t));
        rz -= 0.5 * env;
        rx += 0.18 * env;
        py -= 0.04 * env;
        px -= 0.03 * env;
        // mag out
        if (t > 0.16 && t < 0.42) {
          const o = smooth(0.16, 0.38, t);
          m.mag.position.y -= o * 0.3;
          m.mag.position.z += o * 0.04;
          m.mag.visible = t < 0.38;
        } else if (t >= 0.42 && t < 0.62) {
          const i = 1 - smooth(0.42, 0.6, t);
          m.mag.position.y -= i * 0.25;
          m.mag.position.z += i * 0.03;
        }
        // seat bump
        const seat = smooth(0.6, 0.63, t) * (1 - smooth(0.63, 0.7, t));
        py += seat * 0.012;
        rx -= seat * 0.06;
        // charging handle / bolt release on empty reloads
        if (f.reloadEmpty) {
          const ch = smooth(0.7, 0.76, t) * (1 - smooth(0.76, 0.84, t));
          pz += ch * 0.025;
          rz -= ch * 0.15;
        }
      } else {
        // Shell-by-shell: tilt up and roll, push each shell into the loading port.
        const env = 1;
        rz -= 0.45 * env;
        rx += 0.25 * env;
        py -= 0.03 * env;
        m.mag.visible = f.shellPulse < 0.95;
        const sp2 = f.shellPulse;
        m.mag.position.y = m.magRest.y - (1 - smooth(0.0, 0.7, sp2)) * 0.1;
        m.mag.position.z = m.magRest.z + (1 - smooth(0.0, 0.7, sp2)) * 0.05;
        const push = smooth(0.7, 0.85, sp2) * (1 - smooth(0.85, 1, sp2));
        py += push * 0.006;
      }
    } else if (f.state === 'equipping') {
      const e = 1 - smooth(0, 1, f.stateProgress);
      py -= 0.22 * e;
      rx -= 0.9 * e;
      rz += 0.2 * e;
    }

    // Bolt-action cycle / pistol slide
    if (m.bolt) {
      m.bolt.position.copy(m.boltRest);
      m.bolt.rotation.set(0, 0, 0);
      if (m.boltKind === 'bolt-action' && f.state === 'cycling') {
        const t = f.stateProgress;
        const lift = smooth(0.05, 0.25, t) * (1 - smooth(0.75, 0.95, t));
        const pull = smooth(0.25, 0.45, t) * (1 - smooth(0.55, 0.75, t));
        m.bolt.rotation.z = lift * 1.1;
        m.bolt.position.z += pull * 0.09;
        rz -= 0.12 * Math.max(lift, pull) * (1 - ads);
        rx += 0.05 * pull;
      } else if (m.boltKind === 'slide') {
        this.slideKick *= Math.exp(-30 * dt);
        const back = f.magEmpty && f.state !== 'reloading' ? 1 : this.slideKick;
        m.bolt.position.z += back * 0.028;
      }
    }

    m.root.position.set(px, py, pz);
    m.root.rotation.set(rx, ry, rz, 'YXZ');

    // Viewmodel FOV narrows slightly in ADS to enlarge the optic window.
    const fovScale = 1 + 0.25 * (Math.min(f.magnification, 2) - 1) + 0.08 * ads;
    const fov = this.baseFov / fovScale;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // Fullscreen scopes hide the viewmodel at full magnification.
    m.root.visible = !(def.ads.fullscreenScope && ads > 0.9);

    // Muzzle flash
    this.flashTimer -= dt;
    const flashOn = this.flashTimer > 0;
    this.flash.visible = flashOn;
    if (flashOn) {
      const a = Math.min(1, this.flashTimer / 0.04);
      for (const mat of this.flashMats) mat.opacity = a;
    }
  }
}
