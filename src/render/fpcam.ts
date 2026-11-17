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

/** Adds the near-camera dither to a material (off until NearFade.set(true)). Idempotent. */
function patch(mat: THREE.Material) {
  if (mat.userData.nearFade || !(mat instanceof THREE.MeshLambertMaterial || mat instanceof THREE.MeshPhongMaterial || mat instanceof THREE.MeshStandardMaterial)) return;
  if (mat.transparent) return; // decals and rings stay as they are
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
      '  if (nfD < uNfR) { float nfA = smoothstep(uNfR * 0.3, uNfR, nfD);',
      '    float nfN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));',
      '    if (nfA < nfN) discard; } }',
      '#endif',
    ].join('\n'));
  };
  mat.customProgramCacheKey = () => prevKey() + (mat.defines && 'NEAR_FADE' in mat.defines ? '|nearfade1' : '|nearfade0');
  patched.push(mat);
}

export const NearFade = {
  /** Patch every opaque lit material under these roots (call once at boot, before the first frame). */
  install(...roots: THREE.Object3D[]) {
    for (const r of roots) r.traverse(o => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach(patch);
    });
  },
  /** Switch the dither on (radius r around pos) or off. Switching recompiles once per material, then it is cached. */
  set(on: boolean) {
    for (const m of patched) {
      const has = !!m.defines && 'NEAR_FADE' in m.defines;
      if (has === on) continue;
      m.defines = { ...(m.defines ?? {}) };
      if (on) m.defines.NEAR_FADE = ''; else delete m.defines.NEAR_FADE;
      m.needsUpdate = true;
    }
  },
  at(x: number, y: number, z: number, r: number) { NF.uNfPos.value.set(x, y, z); NF.uNfR.value = r; },
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
  }
}
