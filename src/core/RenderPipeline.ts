import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * RenderPipeline — HDR forward renderer tuned for high frame rates.
 *
 *  world pass (HalfFloat, 4x MSAA)  ->  viewmodel pass (depth cleared, same HDR target)
 *  -> bloom (half-res mip chain)    ->  OutputPass (ACES Filmic tone map + sRGB)
 *
 * The viewmodel is rendered with its own camera/FOV so weapon geometry never clips
 * into walls and stays independent of the zoomed world FOV during ADS.
 */
export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private renderScale = 1;

  constructor(
    container: HTMLElement,
    worldScene: THREE.Scene,
    worldCamera: THREE.PerspectiveCamera,
    viewmodelScene: THREE.Scene,
    viewmodelCamera: THREE.PerspectiveCamera,
  ) {
    const renderer = new THREE.WebGLRenderer({
      antialias: false, // MSAA is done on the HDR render target instead
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.id = 'game-canvas';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: 4,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    const composer = new EffectComposer(renderer, target);

    const worldPass = new RenderPass(worldScene, worldCamera);
    const viewmodelPass = new RenderPass(viewmodelScene, viewmodelCamera);
    viewmodelPass.clear = false;
    viewmodelPass.clearDepth = true;

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.45, 0.95);

    composer.addPass(worldPass);
    composer.addPass(viewmodelPass);
    composer.addPass(this.bloomPass);
    composer.addPass(new OutputPass());
    this.composer = composer;

    this.resize();
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  setRenderScale(scale: number): void {
    this.renderScale = THREE.MathUtils.clamp(scale, 0.5, 2);
    this.resize();
  }

  setBloom(enabled: boolean): void {
    this.bloomPass.enabled = enabled;
  }

  setExposure(exposure: number): void {
    this.renderer.toneMappingExposure = exposure;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, 2) * this.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
