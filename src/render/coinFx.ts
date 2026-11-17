// ersno's «переводы»: gold coins arc from the robbed side towards the thief (a hit moves a few,
// «Списание с карты» throws a fan of them plus a flash of bank cards). Instanced, pooled, only
// near the camera. Reads FxEv only.
import * as THREE from 'three';
import { heightY, type Terrain } from '../world/terrain';
import type { Particles } from './fx';
import type { Stage } from './scene';

interface Coin { on: boolean; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; h: number; t0: number; dur: number; spin: number; card: number }

const MAX = 64;
const CARD_COLS = ['#d8b13a', '#2f9a5a', '#1d1f24', '#2a62c9', '#e48fb5', '#f2efe6'];

export class CoinFx {
  private coins: Coin[] = [];
  private mesh: THREE.InstancedMesh;
  private cards: THREE.InstancedMesh;
  private time = performance.now() / 1000;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  private v = new THREE.Vector3(); private s = new THREE.Vector3(); private c = new THREE.Color();
  private low: boolean;

  constructor(parent: THREE.Object3D, private t: Terrain, private stage: Stage, private particles: Particles, private hqs: { x: number; z: number }[]) {
    this.low = stage.lowPower;
    const coin = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10);
    coin.rotateX(Math.PI / 2); // face +z, spins about y
    this.mesh = new THREE.InstancedMesh(coin, new THREE.MeshLambertMaterial({ color: '#f2c12e', emissive: '#7a5a10', emissiveIntensity: 0.6 }), MAX);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.visible = false;
    const card = new THREE.BoxGeometry(0.5, 0.32, 0.02);
    this.cards = new THREE.InstancedMesh(card, new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#333333' }), 16);
    this.cards.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(16 * 3).fill(1), 3);
    this.cards.count = 0; this.cards.frustumCulled = false; this.cards.visible = false;
    parent.add(this.mesh, this.cards);
    for (let i = 0; i < MAX; i++) this.coins.push({ on: false, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, h: 0, t0: 0, dur: 1, spin: 0, card: -1 });
  }

  private near(x: number, z: number, r = 70) {
    const tg = this.stage.target;
    return (tg.x - x) ** 2 + (tg.z - z) ** 2 < r * r && this.stage.dist < 160;
  }

  private slot(): Coin {
    let c = this.coins.find(o => !o.on);
    if (!c) { c = this.coins[0]; for (const o of this.coins) if (o.t0 < c.t0) c = o; }
    return c;
  }

  /** FxEv 'steal': s = thief side, v = robbed side, x,z = the thief. */
  steal(e: { s: number; v: number; x: number; z: number; n: number; k: string }) {
    if (!this.near(e.x, e.z)) return;
    this.time = performance.now() / 1000;
    const big = e.k === 'card';
    const hq = this.hqs[e.v] ?? { x: e.x, z: e.z };
    let dx = hq.x - e.x, dz = hq.z - e.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const gy = heightY(this.t, e.x, e.z);
    const n = big ? (this.low ? 10 : 18) : Math.max(1, Math.min(this.low ? 2 : 4, Math.round(e.n / 2)));
    const from = big ? 5 : 2.2;
    for (let i = 0; i < n; i++) {
      const c = this.slot();
      // a fan from the robbed side, landing in the thief's hands
      const a = (Math.random() - 0.5) * (big ? 1.6 : 0.9);
      const ca = Math.cos(a), sa = Math.sin(a);
      const ox = dx * ca - dz * sa, oz = dx * sa + dz * ca;
      const r = from * (0.7 + Math.random() * 0.5);
      c.on = true;
      c.x0 = e.x + ox * r; c.z0 = e.z + oz * r; c.y0 = heightY(this.t, c.x0, c.z0) + 0.6 + Math.random() * 0.6;
      c.x1 = e.x + (Math.random() - 0.5) * 0.3; c.z1 = e.z + (Math.random() - 0.5) * 0.3; c.y1 = gy + 1.5;
      c.h = (big ? 3.2 : 1.6) + Math.random() * 0.8;
      c.t0 = this.time + i * (big ? 0.035 : 0.07);
      c.dur = (big ? 0.75 : 0.55) + Math.random() * 0.2;
      c.spin = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 6);
      c.card = big && i % 3 === 0 ? Math.floor(Math.random() * CARD_COLS.length) : -1;
    }
    if (big) {
      // a gold flash where the money lands
      this.particles.emit(e.x, gy + 1.6, e.z, { n: this.low ? 8 : 16, color: '#ffd84a', size: 0.32, life: 0.8, spread: 2.2, up: 1.6, grav: 2.4, jitter: 0.4 });
    }
  }

  update(_dt: number) {
    this.time = performance.now() / 1000; // wall clock: the arc takes as long at 15 fps as at 60
    const now = this.time;
    let n = 0, nc = 0;
    for (const c of this.coins) {
      if (!c.on) continue;
      const f = (now - c.t0) / c.dur;
      if (f < 0) continue;
      if (f >= 1) {
        c.on = false;
        if (Math.random() < 0.35) this.particles.emit(c.x1, c.y1, c.z1, { n: 1, color: '#ffe680', size: 0.2, life: 0.35, spread: 0.6, up: 0.6, grav: 1 });
        continue;
      }
      const e = f * f * (3 - 2 * f);
      this.v.set(c.x0 + (c.x1 - c.x0) * e, c.y0 + (c.y1 - c.y0) * e + Math.sin(f * Math.PI) * c.h, c.z0 + (c.z1 - c.z0) * e);
      const k = f > 0.85 ? (1 - f) / 0.15 : 1;
      if (c.card >= 0 && nc < 16) {
        this.e.set(0.4, now * c.spin * 0.4, Math.sin(now * 9 + c.spin) * 0.6);
        this.q.setFromEuler(this.e); this.s.set(k, k, k);
        this.m.compose(this.v, this.q, this.s);
        this.cards.setMatrixAt(nc, this.m);
        this.cards.setColorAt(nc, this.c.set(CARD_COLS[c.card]));
        nc++;
      } else if (n < MAX) {
        this.e.set(0, now * c.spin, 0.3);
        this.q.setFromEuler(this.e); this.s.set(k, k, k);
        this.m.compose(this.v, this.q, this.s);
        this.mesh.setMatrixAt(n++, this.m);
      }
    }
    this.mesh.count = n; this.mesh.visible = n > 0;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
    this.cards.count = nc; this.cards.visible = nc > 0;
    if (nc) { this.cards.instanceMatrix.needsUpdate = true; if (this.cards.instanceColor) this.cards.instanceColor.needsUpdate = true; }
  }

  clear() { for (const c of this.coins) c.on = false; this.mesh.count = 0; this.mesh.visible = false; this.cards.count = 0; this.cards.visible = false; }
}
