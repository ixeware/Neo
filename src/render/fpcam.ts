// First person («Вселиться»): the camera rides a unit from its interpolated sim positions, in the
// unit's eyes or over its shoulder (V). Wide lens (FOV 70), short near plane; whatever stands
// right next to the camera (other units, houses, trees) is dithered away instead of filling the
// view (NearFade: a patch on the opaque materials, compiled in from boot and switched by a define).
// Leaving puts the RTS camera back over the unit.
import * as THREE from 'three';
import { heightY, type Terrain } from '../world/terrain';
import type { Stage } from './scene';
import type { UnitView } from './units';

// ---- near fade ------------------------------------------------------------------------------
const NF = { uNfPos: { value: new THREE.Vector3() }, uNfR: { value: 0 } };
const patched: THREE.Material[] = [];
/** Scene parts whose meshes fade (NearFade.install); walked again for materials made later. */
const roots: THREE.Object3D[] = [];
let fadeOn = false;
let sweepAt = 0;
/** While first person is on, look for materials made since (a high-rise floor, a place flag) this often (ms). */
const SWEEP_MS = 1000;

/** Built-in mesh materials whose shaders have the chunks the patch hooks into (not Sprite / Points / Line / Shader). */
const fadeable = (mat: THREE.Material) => mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.MeshLambertMaterial
  || mat instanceof THREE.MeshPhongMaterial || mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshToonMaterial
  || mat instanceof THREE.MeshMatcapMaterial;

/**
 * Adds the near-camera dither to a material (off until NearFade.set(true)), opaque or transparent, lit
 * or MeshBasic (signs, glass, rings). `userData.noNearFade` keeps one out. Returns true when newly patched.
 */
function patch(mat: THREE.Material): boolean {
  if (mat.userData.nearFade || mat.userData.noNearFade || !fadeable(mat)) return false;
  mat.userData.nearFade = true;
  const prev = mat.onBeforeCompile;
  const own = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey.bind(mat) : null;
  const prevKey = own ?? (() => prev.toString());
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uNfPos = NF.uNfPos; sh.uniforms.uNfR = NF.uNfR;
    sh.vertexShader = 'varying vec3 vNfW;\n' + sh.vertexShader.replace('#include <project_vertex>', [
      '#include <project_vertex>',
      'vec4 nfW = vec4(transformed, 1.0);',
      '#ifdef USE_INSTANCING',
      'nfW = instanceMatrix * nfW;',
      '#endif',
      'vNfW = (modelMatrix * nfW).xyz;',
    ].join('\n'));
    sh.fragmentShader = 'uniform vec3 uNfPos;\nuniform float uNfR;\nvarying vec3 vNfW;\n' + sh.fragmentShader.replace('void main() {', [
      'void main() {',
      '#ifdef NEAR_FADE',
      '{ float nfD = distance(vNfW, uNfPos);',
      '  if (nfD < uNfR) { float nfA = smoothstep(uNfR * 0.55, uNfR, nfD);',
      '    float nfN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));',
      '    if (nfA < nfN) discard; } }',
      '#endif',
    ].join('\n'));
  };
  mat.customProgramCacheKey = () => prevKey() + (mat.defines && 'NEAR_FADE' in mat.defines ? '|nearfade1' : '|nearfade0');
  patched.push(mat);
  return true;
}

/** The define on or off for one patched material (a recompile the first time, cached after). */
function define(m: THREE.Material, on: boolean) {
  const has = !!m.defines && 'NEAR_FADE' in m.defines;
  if (has === on) return;
  m.defines = { ...(m.defines ?? {}) };
  if (on) m.defines.NEAR_FADE = ''; else delete m.defines.NEAR_FADE;
  m.needsUpdate = true;
}

/** Patches the materials of every mesh under the roots that has none yet; returns how many were new. */
function sweep(): number {
  let n = 0;
  for (const r of roots) r.traverse(o => {
    if (!(o as THREE.Mesh).isMesh) return; // sprites, points and lines have other shaders
    const m = (o as THREE.Mesh).material;
    for (const q of Array.isArray(m) ? m : [m]) if (q && patch(q)) { n++; if (fadeOn) define(q, true); }
  });
  return n;
}

export const NearFade = {
  /**
   * Fade the meshes under these roots near the first-person camera (call at boot, before the first
   * frame, for everything that exists then: world, units, decor). Materials made later under the same
   * roots are picked up when first person starts and every SWEEP_MS while it is on.
   */
  install(...rs: THREE.Object3D[]) {
    for (const r of rs) if (!roots.includes(r)) roots.push(r);
    sweep();
  },
  /** Switch the dither on (radius r around pos) or off. Switching recompiles once per material, then it is cached. */
  set(on: boolean) {
    fadeOn = on;
    if (on) { sweep(); sweepAt = performance.now(); }
    for (const m of patched) define(m, on);
  },
  /** While on: patch materials made since the last look (FpCam.update calls it every frame; it walks the roots once a second). */
  tick(now: number) {
    if (!fadeOn || now - sweepAt < SWEEP_MS) return;
    sweepAt = now;
    sweep();
  },
  at(x: number, y: number, z: number, r: number) { NF.uNfPos.value.set(x, y, z); NF.uNfR.value = r; },
  /** For tests: patched material count, and how many of the materials under the roots are not patched. */
  stats() {
    let total = 0, missing = 0;
    const seen = new Set<THREE.Material>();
    for (const r of roots) r.traverse(o => {
      if (!(o as THREE.Mesh).isMesh) return;
      const m = (o as THREE.Mesh).material;
      for (const q of Array.isArray(m) ? m : [m]) {
        if (!q || seen.has(q)) continue;
        seen.add(q); total++;
        if (!q.userData.nearFade && !q.userData.noNearFade && fadeable(q)) missing++;
      }
    });
    return { patched: patched.length, total, missing, on: fadeOn };
  },
};

// ---- the camera ----------------------------------------------------------------------------
export type FpMode = 'fp' | 'tps';

export class FpCam {
  /** The unit ridden, -1 = none. */
  id = -1;
  mode: FpMode = 'fp';
  /** Heading (forward = (sin, cos), like the units' yaw) and pitch (radians, + looks up). */
  yaw = 0; pitch = -0.12;
  private pos = new THREE.Vector3(); private look = new THREE.Vector3();
  private p = { x: 0, z: 0 };
  private saved: { fov: number; near: number; far: number; dist: number; yaw: number } | null = null;
  private fresh = true;
  private lastTop = 1.6;
  alpha = () => 1;

  constructor(private stage: Stage, private units: UnitView, private t: Terrain) {}

  get on() { return this.id >= 0; }

  /** Ride unit `id`. */
  enter(id: number, alpha: () => number) {
    const st = this.stage, cam = st.camera;
    if (!this.saved) this.saved = { fov: cam.fov, near: cam.near, far: cam.far, dist: st.dist, yaw: st.yaw };
    this.id = id; this.alpha = alpha; this.fresh = true;
    const h = this.units.headOf(id);
    if (h) this.yaw = h.yaw;
    this.pitch = -0.12;
    cam.fov = 70; cam.near = 0.06; cam.far = 700; cam.updateProjectionMatrix();
    st.dist = 30; // shadows and fog tuned for close up
    st.fp = dt => this.update(dt);
    this.units.hideId = this.mode === 'fp' ? id : -1;
    NearFade.set(true);
  }

  /** Back to the RTS camera, looking at where the unit stands now. */
  exit() {
    if (this.id < 0) return;
    const st = this.stage, cam = st.camera, s = this.saved;
    const q = this.units.renderPos(this.id);
    this.id = -1;
    st.fp = null;
    this.units.hideId = -1;
    NearFade.set(false);
    if (s) { cam.fov = s.fov; cam.near = s.near; cam.far = s.far; cam.updateProjectionMatrix(); st.yaw = this.yaw + Math.PI; st.dist = Math.max(28, Math.min(60, s.dist)); }
    if (q) { st.target.set(q.x, q.y, q.z); st.flyTo(q.x, q.z, st.dist, 300); }
    this.saved = null;
  }

  toggleMode() {
    this.mode = this.mode === 'fp' ? 'tps' : 'fp';
    this.units.hideId = this.on && this.mode === 'fp' ? this.id : -1;
    this.fresh = true;
  }

  turn(dYaw: number, dPitch: number) {
    this.yaw += dYaw;
    this.pitch = Math.max(-1.1, Math.min(0.6, this.pitch + dPitch));
  }

  /** Forward and right on the ground for the stick (unit vectors in x, z). */
  axes() {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    return { fx: s, fz: c, rx: -c, rz: s };
  }

  private update(dt: number) {
    const st = this.stage, cam = st.camera;
    if (!this.units.lerpPos(this.id, this.alpha(), this.p)) return;
    const h = this.units.headOf(this.id);
    if (h && h.top > 0.2) this.lastTop = h.top;
    const x = this.p.x, z = this.p.z, gy = heightY(this.t, x, z), top = this.lastTop;
    const { fx, fz } = this.axes(), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    if (this.mode === 'fp') {
      this.look.set(x + fx * 0.22, gy + top * 0.9, z + fz * 0.22);
    } else {
      // over the shoulder: behind and a little to the right, never inside a hill
      const back = 3.2 + top * 0.8, side = 0.7;
      const bx = x - fx * back * cp - fz * side, bz = z - fz * back * cp + fx * side;
      this.look.set(bx, Math.max(gy + top + 0.9 - sp * back, heightY(this.t, bx, bz) + 0.6), bz);
    }
    const k = this.fresh ? 1 : 1 - Math.exp(-dt * (this.mode === 'fp' ? 30 : 12));
    this.fresh = false;
    this.pos.lerp(this.look, k);
    if (k === 1) this.pos.copy(this.look);
    cam.position.copy(this.pos);
    cam.lookAt(this.pos.x + fx * cp * 10, this.pos.y + sp * 10, this.pos.z + fz * cp * 10);
    st.target.set(x, gy, z);
    NearFade.at(this.pos.x, this.pos.y, this.pos.z, this.mode === 'fp' ? 4 : 2.6);
    NearFade.tick(performance.now());
  }
}
