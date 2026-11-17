// The toon side of the game's main renderer (scene.ts): haze, the per-frame shader uniforms and the
// outline pipeline. Created through styleStage() in style.ts, only in the toon style.
import * as THREE from 'three';
import { TOON_HEX } from './palette';
import { TOON_U } from './shading';
import { ToonPipeline } from './post';

/** Strength of the drifting cloud shadows on the sun term (0 = none). */
const CLOUD_SHADOW = 0.3;

export class ToonStage {
  pipeline: ToonPipeline;
  private t0 = performance.now();

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, low: boolean, msaa: boolean) {
    this.pipeline = new ToonPipeline(renderer, msaa ? 4 : 0, low);
    const haze = new THREE.Color(TOON_HEX.haze);
    scene.background = haze;
    scene.fog = new THREE.Fog(haze, 200, 700);
  }

  /** Distance haze: starts later than the classic fog so the play field stays crisp. */
  haze(fog: THREE.Fog, dist: number) {
    fog.near = Math.max(170, dist * 2.1);
    fog.far = fog.near + 560;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const time = (performance.now() - this.t0) / 1000;
    // cloud shadows only for this render: portraits and tool renderers share the shader uniforms
    TOON_U.a[0] = time; TOON_U.a[1] = CLOUD_SHADOW;
    camera.updateMatrixWorld();
    TOON_U.cam.set(camera.matrixWorld.elements);
    this.pipeline.render(scene, camera, time);
    TOON_U.a[1] = 0;
  }
}
