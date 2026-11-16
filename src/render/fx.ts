// Particles (dust, sparks, dandruff) and thrown things (bullets, dumbbells, slippers…).
import * as THREE from 'three';
import { Builder, PAL } from './models';

const MAXP = 4000;

export class Particles {
  points: THREE.Points;
  private pos = new Float32Array(MAXP * 3);
  private col = new Float32Array(MAXP * 3);
  private size = new Float32Array(MAXP);
  private alpha = new Float32Array(MAXP);
  private vel = new Float32Array(MAXP * 3);
  private life = new Float32Array(MAXP);
  private max = new Float32Array(MAXP);
  private grow = new Float32Array(MAXP);
  private grav = new Float32Array(MAXP);
  private wob = new Float32Array(MAXP);
  private n = 0;
  private cursor = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { scale: { value: 400 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale;
        void main(){ vC=color; vA=alpha; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*scale/-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 d=gl_PointCoord-.5; float r=dot(d,d); if(r>.25) discard; gl_FragColor=vec4(vC, vA*smoothstep(.25,.12,r)); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setScale(px: number) { (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = px; }

  private colors = new Map<string, THREE.Color>();
  emit(x: number, y: number, z: number, o: { n: number; color: THREE.Color | string; size: number; life: number; spread: number; up?: number; grav?: number; grow?: number; wob?: number; jitter?: number }) {
    let c: THREE.Color;
    if (typeof o.color === 'string') {
      c = this.colors.get(o.color) ?? new THREE.Color(o.color);
      if (this.colors.size < 256) this.colors.set(o.color, c);
    } else c = o.color;
    for (let k = 0; k < o.n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAXP;
      if (this.n < MAXP) this.n++;
      const j = o.jitter ?? 0.3;
      this.pos[i * 3] = x + (Math.random() - 0.5) * j; this.pos[i * 3 + 1] = y + Math.random() * j * 0.5; this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * j;
      const a = Math.random() * Math.PI * 2, s = Math.random() * o.spread;
      this.vel[i * 3] = Math.cos(a) * s; this.vel[i * 3 + 1] = (o.up ?? 1) * (0.5 + Math.random()); this.vel[i * 3 + 2] = Math.sin(a) * s;
      const v = 0.85 + Math.random() * 0.3;
      this.col[i * 3] = c.r * v; this.col[i * 3 + 1] = c.g * v; this.col[i * 3 + 2] = c.b * v;
      this.size[i] = o.size * (0.7 + Math.random() * 0.6);
      this.life[i] = o.life * (0.7 + Math.random() * 0.6); this.max[i] = this.life[i];
      this.grow[i] = o.grow ?? 0; this.grav[i] = o.grav ?? 2; this.wob[i] = o.wob ?? 0;
      this.alpha[i] = 1;
    }
  }

  update(dt: number, time: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const f = Math.max(0, this.life[i] / this.max[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      const drag = 1 - Math.min(1, dt * 2.5);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag;
      if (this.wob[i]) { this.vel[i * 3] += Math.sin(time * 6 + i) * this.wob[i] * dt; this.vel[i * 3 + 2] += Math.cos(time * 5 + i * 1.3) * this.wob[i] * dt; }
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = Math.min(1, f * 2.2);
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    for (const k of ['position', 'color', 'size', 'alpha']) (g.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ---- projectiles -------------------------------------------------------------------
interface Shot { k: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t0: number; t1: number; spin: number }

/** Shot looks, by the `shot` fx kind (UnitDef.shot). An unknown kind is drawn as kind 0. */
export const SHOT_KINDS = 8;
const SHOT_CAP = 256;

/** Linear colour above 1.0 reads as self-lit under ACES (like the screens in heroes.ts). */
const glow = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

function projGeo(k: number): THREE.BufferGeometry {
  const b = new Builder();
  switch (k) {
    case 0: b.box(new THREE.Color('#ffe08a'), [0, 0, 0], [0.06, 0.06, 0.7]); break;
    case 1:
      b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 6), PAL.steel, [0, 0, 0], [0, 0, Math.PI / 2]);
      b.add(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 8), PAL.black, [-0.17, 0, 0], [0, 0, Math.PI / 2]);
      b.add(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 8), PAL.black, [0.17, 0, 0], [0, 0, Math.PI / 2]);
      break;
    case 2: b.add(new THREE.IcosahedronGeometry(0.22, 0), PAL.white); break;
    case 3: // тапок
      b.box(new THREE.Color('#2a5c8a'), [0, 0, 0], [0.16, 0.04, 0.38]);
      b.box(new THREE.Color('#d9d2c2'), [0, 0.04, 0.06], [0.17, 0.05, 0.08]);
      break;
    case 4: b.add(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 8), PAL.bread, [0, 0, 0], [Math.PI / 2, 0, 0]); break;
    case 5: b.add(new THREE.IcosahedronGeometry(0.12, 1), PAL.white); break;
    case 6: { // WOU: a glowing chat bubble off his monitor, «…» on top and on both sides
      const screen = glow(0.32, 0.78, 1.6), ink = new THREE.Color('#10203a');
      b.box(screen, [0, 0, 0], [0.42, 0.24, 0.32]);
      b.box(screen, [-0.1, -0.15, -0.1], [0.1, 0.1, 0.1], [0.5, 0, 0.6]); // хвостик
      for (const x of [-0.11, 0, 0.11]) b.box(ink, [x, 0.121, 0], [0.055, 0.012, 0.055]);
      for (const s of [-1, 1]) for (const z of [-0.09, 0, 0.09]) b.box(ink, [0.211 * s, 0.01, z], [0.012, 0.055, 0.05]);
      break;
    }
    case 7: { // админ: a page out of the journal with a red «Н»
      const page = new THREE.Color('#f7f3e6'), red = new THREE.Color('#d32a1c'), rule = new THREE.Color('#a9c4e8');
      b.box(page, [0, 0, 0], [0.34, 0.012, 0.42]);
      for (const z of [-0.14, 0.14]) b.box(rule, [0, 0.008, z], [0.32, 0.004, 0.012]);
      b.box(red, [-0.07, 0.012, 0], [0.045, 0.006, 0.26]);
      b.box(red, [0.07, 0.012, 0], [0.045, 0.006, 0.26]);
      b.box(red, [0, 0.012, 0], [0.14, 0.006, 0.045]);
      break;
    }
  }
  return b.build();
}

export class Shots {
  group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private live: Shot[] = [];
  private counts = new Int32Array(SHOT_KINDS);
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  private v = new THREE.Vector3(); private s = new THREE.Vector3(1, 1, 1);
  constructor() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const basic = new THREE.MeshBasicMaterial({ vertexColors: true });
    for (let k = 0; k < SHOT_KINDS; k++) {
      const im = new THREE.InstancedMesh(projGeo(k), k === 0 || k === 6 ? basic : mat, SHOT_CAP);
      im.count = 0; im.frustumCulled = false; im.visible = false;
      this.meshes.push(im); this.group.add(im);
    }
  }
  add(k: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t0: number, t1: number) {
    if (this.live.length > 1200) return;
    const kind = Number.isInteger(k) && k >= 0 && k < SHOT_KINDS ? k : 0;
    this.live.push({ k: kind, x0, y0, z0, x1, y1, z1, t0, t1, spin: Math.random() * 6 });
  }
  update(now: number, onLand: (s: Shot) => void) {
    const counts = this.counts, live = this.live;
    counts.fill(0);
    let keep = 0;
    for (let n = 0; n < live.length; n++) {
      const s = live[n];
      const f = (now - s.t0) / Math.max(1, s.t1 - s.t0);
      if (f >= 1) { onLand(s); continue; }
      live[keep++] = s;
      if (f < 0) continue;
      const im = this.meshes[s.k];
      const i = counts[s.k]++;
      if (i >= SHOT_CAP) continue;
      const arc = s.k === 0 ? 0 : s.k === 3 ? 2.2 : s.k === 6 ? 0.5 : s.k === 7 ? 1.1 : 1.4;
      const x = s.x0 + (s.x1 - s.x0) * f, z = s.z0 + (s.z1 - s.z0) * f;
      const y = s.y0 + (s.y1 - s.y0) * f + Math.sin(Math.PI * f) * arc;
      this.v.set(x, y, z);
      const yaw = Math.atan2(s.x1 - s.x0, s.z1 - s.z0);
      if (s.k === 0) this.e.set(0, yaw, 0);
      else if (s.k === 6) this.e.set(Math.sin(f * 9 + s.spin) * 0.15, yaw, 0); // the bubble floats, barely wobbles
      else if (s.k === 7) this.e.set(Math.sin(f * 11 + s.spin) * 0.5, yaw + f * 5 + s.spin, Math.cos(f * 9) * 0.35); // a page flutters
      else this.e.set(f * 14 + s.spin, yaw, f * 6);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v, this.q, this.s);
      im.setMatrixAt(i, this.m);
    }
    live.length = keep;
    for (let k = 0; k < SHOT_KINDS; k++) {
      const im = this.meshes[k], n = Math.min(SHOT_CAP, counts[k]);
      im.count = n; im.visible = n > 0;
      if (n) im.instanceMatrix.needsUpdate = true;
    }
  }
}
export type { Shot };
