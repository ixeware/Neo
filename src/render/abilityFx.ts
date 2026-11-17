// Hero abilities, summons and rides on screen: ground rings draped on the terrain, dust and
// stones, Бекхан's lagman steam, the green glitch over a hacked high-rise, the админ's «Н»
// stamp, feathers, door puffs, Амина's «Плюхнулась» (ring, dust, «ПЛЮХ!») and Ислам's
// «Себозол-душ» (a fountain of shampoo bottles raining foam). Reads FxEv only; never touches the sim.
import * as THREE from 'three';
import type { FxEv } from '../sim/sim';
import { HERO, TICK_MS } from '../sim/defs';
import { heightY, type Terrain } from '../world/terrain';
import { PAL, sebozolGeometry } from './models';
import { decorSpots } from './world';
import type { Particles } from './fx';
import type { Stage } from './scene';

const HQ_KEY = ['atagi', 'kurchaloy'];
/** Rough high-rise height for the glitch overlay (3–6 floors × 1.0, 5–8 × 0.84). */
const HQ_H = [4.2, 5.2];
const HAND = 'Caveat, "Segoe Print", "Comic Sans MS", cursive';

interface Ring {
  mesh: THREE.Mesh; pos: Float32Array; mat: THREE.MeshBasicMaterial;
  on: boolean; x: number; z: number; r0: number; r1: number; w: number; age: number; life: number; alpha: number;
}
interface Stamp { s: THREE.Sprite; on: boolean; x: number; y: number; z: number; size: number; age: number; life: number; kind: string; aspect: number }
/** A Себозол bottle of the «Себозол-душ»: flies from the boss up and rains down at x1, z1 (seconds). */
interface Bottle { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t0: number; dur: number; arc: number; spin: number }
const BOTTLE_CAP = 32;
interface Emitter { kind: 'steam' | 'glitch'; x: number; y: number; z: number; until: number; next: number }
interface Hack { side: number; until: number; x: number; z: number; y: number }

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, font?: string) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const paint = () => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); g.save(); draw(g); g.restore(); tex.needsUpdate = true; };
  paint();
  const fs = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (font && fs) fs.load(font).then(paint, () => { /* system font */ });
  return tex;
}

export class AbilityFx {
  private group = new THREE.Group();
  private t: Terrain;
  private low: boolean;
  private seg: number;
  private rings: Ring[] = [];
  private stamps: Stamp[] = [];
  private emitters: Emitter[] = [];
  private hacks: Hack[] = [];
  private glitch: THREE.InstancedMesh;
  private hackSign: THREE.Sprite;
  private texN: THREE.Texture;
  private bottles: Bottle[] = [];
  private bottleMesh: THREE.InstancedMesh;
  private q = new THREE.Quaternion(); private eu = new THREE.Euler();
  private time = 0;
  private glitchNext = 0;
  private m = new THREE.Matrix4(); private v = new THREE.Vector3(); private s = new THREE.Vector3();
  private lastDie = new Map<number, { x: number; z: number }>();

  constructor(parent: THREE.Object3D, private particles: Particles, private stage: Stage) {
    this.t = stage.t;
    this.low = stage.lowPower;
    this.seg = this.low ? 40 : 72;
    parent.add(this.group);
    const nRings = this.low ? 8 : 16;
    for (let k = 0; k < nRings; k++) this.rings.push(this.makeRing());
    this.texN = canvasTexture(128, 128, g => {
      g.translate(64, 68); g.rotate(-0.14);
      g.font = `700 112px ${HAND}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.strokeStyle = '#fbfaf5'; g.lineWidth = 14; g.strokeText('Н', 0, 0);
      g.fillStyle = '#d32a1c'; g.fillText('Н', 0, 0);
    }, `700 124px Caveat`);
    const addStamps = (tex: THREE.Texture, kind: string, aspect: number, n: number) => {
      for (let k = 0; k < n; k++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
        sp.visible = false; sp.renderOrder = 9;
        this.group.add(sp);
        this.stamps.push({ s: sp, on: false, x: 0, y: 0, z: 0, size: 1, age: 0, life: 1, kind, aspect });
      }
    };
    addStamps(this.texN, 'n', 1, 4);
    // pen words over a blast: Амина's «ПЛЮХ!» in Атаги blue, Ислам's «СЕБОЗОЛ-ДУШ!» in teal
    const word = (text: string, color: string, w: number) => canvasTexture(w, 96, g => {
      g.translate(w / 2, 52); g.rotate(-0.06);
      g.font = `700 76px ${HAND}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.strokeStyle = '#fbfaf5'; g.lineWidth = 14; g.strokeText(text, 0, 0);
      g.fillStyle = color; g.fillText(text, 0, 0);
    }, `700 76px Caveat`);
    addStamps(word('ПЛЮХ!', '#2a52d1', 256), 'plyuh', 256 / 96, 2);
    addStamps(word('СЕБОЗОЛ-ДУШ!', '#128a7e', 512), 'sebozol', 512 / 96, 1);
    this.bottleMesh = new THREE.InstancedMesh(sebozolGeometry(1.5), new THREE.MeshLambertMaterial({ vertexColors: true }), BOTTLE_CAP);
    this.bottleMesh.count = 0; this.bottleMesh.visible = false; this.bottleMesh.frustumCulled = false;
    this.group.add(this.bottleMesh);
    // green scan-line bars over a hacked high-rise
    const nBars = this.low ? 10 : 22;
    this.glitch = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#3cf06a', transparent: true, opacity: 0.75, depthTest: false, depthWrite: false }), nBars * 2);
    this.glitch.count = 0; this.glitch.visible = false; this.glitch.frustumCulled = false; this.glitch.renderOrder = 10;
    this.group.add(this.glitch);
    const signTex = canvasTexture(256, 96, g => {
      g.fillStyle = '#0d1a12'; g.fillRect(6, 10, 244, 76);
      g.strokeStyle = '#3cf06a'; g.lineWidth = 4; g.strokeRect(6, 10, 244, 76);
      g.fillStyle = '#3cf06a'; g.font = '700 40px "Golos Text", ui-monospace, monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('> ВЗЛОМ_', 128, 50);
    }, '700 40px "Golos Text"');
    this.hackSign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex, transparent: true, depthTest: false, depthWrite: false }));
    this.hackSign.scale.set(3.6, 1.35, 1);
    this.hackSign.visible = false; this.hackSign.renderOrder = 11;
    this.group.add(this.hackSign);
  }

  private makeRing(): Ring {
    const n = this.seg;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let k = 0; k < n; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    g.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 3;
    this.group.add(mesh);
    return { mesh, pos, mat, on: false, x: 0, z: 0, r0: 0, r1: 1, w: 0.3, age: 0, life: 1, alpha: 1 };
  }

  private near(x: number, z: number, r = 90) {
    const t = this.stage.target;
    return (t.x - x) ** 2 + (t.z - z) ** 2 < r * r && this.stage.dist < 200;
  }

  /** Shake the camera if the blast is on screen, harder the closer it is. */
  private shake(x: number, z: number, amount: number) {
    const t = this.stage.target, d = Math.sqrt((t.x - x) ** 2 + (t.z - z) ** 2);
    if (d > 60 || this.stage.dist > 170) return;
    this.stage.shake(amount * (1 - d / 60));
  }

  private n(k: number) { return Math.max(1, Math.round(this.low ? k * 0.5 : k)); }

  /** Ground ring that grows from r0 to r1 over `life` seconds, fading out. */
  private ring(x: number, z: number, r0: number, r1: number, color: THREE.Color | string, life = 0.8, w = 0.35, alpha = 0.9) {
    let r = this.rings.find(o => !o.on);
    if (!r) { r = this.rings[0]; for (const o of this.rings) if (o.age / o.life > r.age / r.life) r = o; }
    r.on = true; r.x = x; r.z = z; r.r0 = r0; r.r1 = r1; r.w = w; r.age = 0; r.life = life; r.alpha = alpha;
    r.mat.color.set(color);
    r.mesh.visible = true;
  }

  private stamp(x: number, y: number, z: number, size: number, kind = 'n', life = 1.1) {
    const pool = this.stamps.filter(o => o.kind === kind);
    let st = pool.find(o => !o.on);
    if (!st) { st = pool[0]; for (const o of pool) if (o.age > st.age) st = o; }
    st.on = true; st.x = x; st.y = y; st.z = z; st.size = size; st.age = 0; st.life = life;
    st.s.visible = true;
  }

  /** «Себозол-душ»: bottles fly up out of Ислам and rain down over radius r, foaming where they land. */
  private shower(x: number, z: number, r: number) {
    const y = this.gy(x, z), n = this.n(14), t = this.time;
    for (let k = 0; k < n; k++) {
      if (this.bottles.length >= BOTTLE_CAP) this.bottles.shift();
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.4, d = r * (0.3 + Math.random() * 0.65);
      const x1 = x + Math.cos(a) * d, z1 = z + Math.sin(a) * d;
      this.bottles.push({ x0: x, y0: y + 2.8, z0: z, x1, y1: this.gy(x1, z1) + 0.25, z1, t0: t + k * 0.035, dur: 0.6 + Math.random() * 0.35, arc: 3 + Math.random() * 2, spin: Math.random() * 6 });
    }
    // the «душ»: a short drizzle of droplets falling over the whole circle
    for (let k = 0; k < this.n(10); k++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r;
      this.particles.emit(x + Math.cos(a) * d, y + 4.5 + Math.random(), z + Math.sin(a) * d, { n: 2, color: '#cfeefa', size: 0.16, life: 0.9, spread: 0.2, up: -2.5, grav: 6, jitter: 1.2 });
    }
    this.ring(x, z, 0.6, r, '#1aa597', 0.9, 0.4, 0.85);
    this.stamp(x, y + 5.2, z, 1.05, 'sebozol', 1.7);
  }

  private foamAt(x: number, y: number, z: number) {
    this.particles.emit(x, y, z, { n: this.n(6), color: '#ffffff', size: 0.34, life: 1.0, spread: 1.0, up: 0.5, grav: 0.25, grow: 0.5, wob: 0.8, jitter: 0.4 });
    this.particles.emit(x, y, z, { n: this.n(4), color: '#9fe3da', size: 0.22, life: 0.8, spread: 1.4, up: 0.8, grav: 0.4, wob: 1, jitter: 0.3 });
  }

  private gy(x: number, z: number) { return heightY(this.t, x, z); }

  private hqAt(s: number) {
    const v = this.t.villages.find(q => q.key === HQ_KEY[s]);
    return v ? { x: v.x, z: v.z } : null;
  }

  private dust(x: number, z: number, n: number, spread: number, size = 0.6) {
    this.particles.emit(x, this.gy(x, z) + 0.15, z, { n: this.n(n), color: '#d9cdb4', size, life: 0.9, spread, up: 0.6, grav: 0.35, grow: 0.9, jitter: 0.8 });
  }
  private stones(x: number, z: number, n: number, spread: number) {
    this.particles.emit(x, this.gy(x, z) + 0.3, z, { n: this.n(n), color: '#a1978a', size: 0.24, life: 0.9, spread, up: 3.2, grav: 9, jitter: 0.8 });
  }
  private feathers(x: number, y: number, z: number, n: number) {
    this.particles.emit(x, y, z, { n: this.n(n), color: '#f5f1e6', size: 0.2, life: 1.8, spread: 1.6, up: 1.6, grav: 0.6, wob: 1.6, jitter: 0.6 });
  }

  handleAll(list: FxEv[]) {
    for (const e of list) {
      switch (e.e) {
        case 'ability': {
          if (!this.near(e.x, e.z)) break;
          const y = this.gy(e.x, e.z);
          switch (e.key) {
            case 'quake':
              this.ring(e.x, e.z, 0.6, e.r, '#7a5a34', 0.7, 0.55);
              this.dust(e.x, e.z, 14, 3.2, 0.8);
              this.shake(e.x, e.z, 0.35);
              break;
            case 'hack':
              this.ring(e.x, e.z, 0.4, 3, '#3cf06a', 0.6, 0.25);
              this.particles.emit(e.x, y + 1.8, e.z, { n: this.n(14), color: '#5dff7a', size: 0.16, life: 1, spread: 1.4, up: 1.6, grav: 0.4, jitter: 0.6 });
              break;
            case 'n':
              this.ring(e.x, e.z, 0.5, e.r, '#d32a1c', 0.65, 0.3);
              this.particles.emit(e.x, y + 1.6, e.z, { n: this.n(12), color: '#f7f3e6', size: 0.24, life: 1.5, spread: 2.6, up: 1.4, grav: 0.8, wob: 1.2, jitter: 0.5 });
              break;
            case 'lagman':
              this.emitters.push({ kind: 'steam', x: e.x, y: y + 1.35, z: e.z, until: this.time + 3.2, next: 0 });
              this.particles.emit(e.x, y + 1, e.z, { n: this.n(10), color: '#8fe08a', size: 0.22, life: 1, spread: 1, up: 1.6, grav: 0.4 });
              this.ring(e.x, e.z, 0.4, 2.2, '#8fe08a', 0.7, 0.2, 0.7);
              break;
            case 'golem':
              this.ring(e.x, e.z, 0.3, 2.6, '#f08a2a', 0.6, 0.3);
              this.particles.emit(e.x, y + 0.6, e.z, { n: this.n(10), color: '#ffb35a', size: 0.2, life: 0.8, spread: 1.4, up: 2, grav: 1.5 });
              break;
            case 'bolt':
              this.dust(e.x, e.z, 8, 1.6, 0.5);
              this.particles.emit(e.x, y + 0.7, e.z, { n: this.n(10), color: '#fbfaf5', size: 0.14, life: 0.45, spread: 3.2, up: 0.2, grav: 0, jitter: 0.6 });
              break;
            case 'slam': // Амина «Плюхнулась»: the ground jumps, everybody around flies off
              this.ring(e.x, e.z, 0.4, e.r + 0.4, PAL.side[e.s], 0.55, 0.6, 0.95);
              this.ring(e.x, e.z, 0.2, e.r * 0.6, '#f5f1e6', 0.4, 0.3, 0.7);
              this.dust(e.x, e.z, 18, e.r * 0.9, 0.95);
              this.stones(e.x, e.z, 10, e.r * 0.7);
              this.stamp(e.x, y + 4.3, e.z, 1.2, 'plyuh', 1.0);
              this.shake(e.x, e.z, 0.55);
              break;
          }
          break;
        }
        case 'ult':
          if (e.s === 0 && this.near(e.x, e.z)) this.shower(e.x, e.z, e.r); // Ислам «Себозол-душ»
          break;
        case 'pulse': {
          if (!this.near(e.x, e.z)) break;
          const y = this.gy(e.x, e.z);
          if (e.key === 'quake') {
            this.ring(e.x, e.z, 0.5, e.r, '#8a6a3e', 0.55, 0.45, 0.85);
            this.dust(e.x, e.z, 10, e.r * 0.7, 0.75);
            this.stones(e.x, e.z, 8, e.r * 0.6);
            this.shake(e.x, e.z, 0.42);
          } else if (e.key === 'golem') {
            this.ring(e.x, e.z, 0.3, e.r + 0.6, '#6f6a60', 0.6, 0.6);
            this.stones(e.x, e.z, 22, 4);
            this.dust(e.x, e.z, 14, 2.6, 0.95);
            this.particles.emit(e.x, y + 0.5, e.z, { n: this.n(6), color: '#ff8a2a', size: 0.4, life: 0.4, spread: 2, up: 1, grav: 1 });
            this.shake(e.x, e.z, 0.6);
          } else {
            // chicken pops
            this.ring(e.x, e.z, 0.2, e.r, '#f3a41f', 0.4, 0.22, 0.8);
            this.particles.emit(e.x, y + 0.4, e.z, { n: this.n(5), color: '#ffcf5a', size: 0.36, life: 0.3, spread: 1.4, up: 1, grav: 2 });
            this.feathers(e.x, y + 0.4, e.z, 12);
          }
          break;
        }
        case 'taunt':
          if (!this.near(e.x, e.z)) break;
          this.ring(e.x, e.z, 0.6, e.r, PAL.side[e.s], 0.7, 0.18, 0.75);
          this.particles.emit(e.x, this.gy(e.x, e.z) + 2, e.z, { n: this.n(6), color: '#d8361f', size: 0.18, life: 0.6, spread: 2, up: 1.2, grav: 1.5 });
          break;
        case 'stunN':
          if (e.n > 0 && this.near(e.x, e.z)) this.stamp(e.x, this.gy(e.x, e.z) + 3.2, e.z, 2.2 + e.r * 0.15);
          break;
        case 'hack': {
          const hq = this.hqAt(e.v);
          if (!hq) break;
          // wall clock, like the sim's ticks: a slow phone must not stretch the 8 s
          const until = performance.now() + HERO.hackFor * TICK_MS;
          const old = this.hacks.find(h => h.side === e.v);
          if (old) old.until = until;
          else this.hacks.push({ side: e.v, until, x: hq.x, z: hq.z, y: this.gy(hq.x, hq.z) });
          break;
        }
        case 'unload': {
          if (!this.near(e.x, e.z)) break;
          const y = this.gy(e.x, e.z);
          this.dust(e.x, e.z, 8, 1.6, 0.55);
          this.particles.emit(e.x, y + 0.6, e.z, { n: this.n(8), color: PAL.side[e.s], size: 0.16, life: 0.7, spread: 2.2, up: 1.6, grav: 4 });
          this.ring(e.x, e.z, 0.4, 2.2, PAL.side[e.s], 0.5, 0.2, 0.7);
          break;
        }
        case 'summon': {
          if (!this.near(e.x, e.z)) break;
          const y = this.gy(e.x, e.z);
          if (e.t === 13) {
            this.ring(e.x, e.z, 0.2, 3, '#f08a2a', 0.8, 0.4);
            this.stones(e.x, e.z, 14, 2.4);
            this.dust(e.x, e.z, 12, 2.2, 0.8);
            this.shake(e.x, e.z, 0.25);
          } else if (e.t === 15) {
            this.feathers(e.x, y + 1, e.z, 10 + e.n * 3);
            this.ring(e.x, e.z, 0.5, 5, '#f3a41f', 0.7, 0.25, 0.8);
          }
          break;
        }
        case 'die': {
          this.lastDie.set(e.s * 32 + e.t, { x: e.x, z: e.z });
          if (!this.near(e.x, e.z)) break;
          const y = this.gy(e.x, e.z);
          if (e.t === 15) this.feathers(e.x, y + 0.4, e.z, 14);
          else if (e.t === 13) { this.stones(e.x, e.z, 12, 2.4); this.dust(e.x, e.z, 10, 2, 0.9); }
          else if (e.t === 14) this.particles.emit(e.x, y + 0.8, e.z, { n: this.n(10), color: '#4a4744', size: 0.7, life: 1.4, spread: 0.8, up: 1, grav: -0.3, grow: 0.9, jitter: 1 });
          break;
        }
        case 'heroDown': {
          const d = this.lastDie.get(e.s * 32 + e.t);
          if (!d || !this.near(d.x, d.z)) break;
          this.ring(d.x, d.z, 0.3, 3.4, PAL.side[e.s], 0.9, 0.35);
          this.particles.emit(d.x, this.gy(d.x, d.z) + 1, d.z, { n: this.n(16), color: PAL.side[e.s], size: 0.2, life: 1, spread: 2.4, up: 2.6, grav: 4 });
          break;
        }
        case 'heroBack': {
          if (e.id < 0) break;
          const hq = this.hqAt(e.s);
          if (!hq || !this.near(hq.x, hq.z)) break;
          this.ring(hq.x, hq.z, 1, 6, PAL.side[e.s], 0.8, 0.3, 0.8);
          break;
        }
        case 'gone': {
          if (!this.near(e.x, e.z)) break;
          const y = this.gy(e.x, e.z);
          if (e.t === 14) {
            this.particles.emit(e.x, y + 0.3, e.z, { n: this.n(8), color: '#9a958c', size: 0.6, life: 1.1, spread: 0.8, up: 0.4, grav: -0.2, grow: 1, jitter: 0.8 });
            this.dust(e.x, e.z, 6, 1.2, 0.5);
          } else {
            // ушёл на пары: тетрадные листки
            this.particles.emit(e.x, y + 1, e.z, { n: this.n(10), color: '#f7f3e6', size: 0.24, life: 1.4, spread: 1.4, up: 1.8, grav: 0.7, wob: 1.2 });
            this.ring(e.x, e.z, 0.3, 1.8, PAL.side[e.s], 0.5, 0.2, 0.7);
          }
          break;
        }
        case 'poison': {
          // «Шаурма в кляре из Фудзи»: a green burp over the kiosk
          if (!e.n) break;
          const f = decorSpots(this.t).find(d => d.key === 'fudzi');
          if (!f || !this.near(f.x, f.z)) break;
          this.particles.emit(f.x, this.gy(f.x, f.z) + 1.6, f.z, { n: this.n(12), color: '#b5cf6a', size: 0.5, life: 1.6, spread: 1.6, up: 0.7, grav: -0.12, grow: 0.6, wob: 0.8, jitter: 1.4 });
          break;
        }
        case 'dodge':
          if (!this.near(e.x, e.z, 60)) break;
          // «Шампунь +40 к удаче»: мыльные пузыри
          this.particles.emit(e.x, this.gy(e.x, e.z) + 0.9, e.z, { n: this.n(5), color: '#cfeaff', size: 0.2, life: 1.1, spread: 0.8, up: 0.8, grav: -0.3, wob: 1.2, jitter: 0.6 });
          break;
        case 'newWar':
          this.clear();
          break;
      }
    }
  }

  update(dt: number) {
    this.time += dt;
    const now = this.time;
    // rings
    const n = this.seg;
    for (const r of this.rings) {
      if (!r.on) continue;
      r.age += dt;
      const f = r.age / r.life;
      if (f >= 1) { r.on = false; r.mesh.visible = false; continue; }
      const e = 1 - (1 - f) * (1 - f) * (1 - f);
      const rad = r.r0 + (r.r1 - r.r0) * e, w = r.w * (1 - f * 0.5);
      const p = r.pos;
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        for (let j = 0; j < 2; j++) {
          const rr = j ? rad + w / 2 : Math.max(0, rad - w / 2);
          const x = r.x + ca * rr, z = r.z + sa * rr;
          const o = (k * 2 + j) * 3;
          p[o] = x; p[o + 1] = heightY(this.t, x, z) + 0.14; p[o + 2] = z;
        }
      }
      (r.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      r.mat.opacity = r.alpha * (f < 0.15 ? f / 0.15 : 1 - (f - 0.15) / 0.85);
    }
    // «Н» stamps: slam in big, settle, fade
    for (const st of this.stamps) {
      if (!st.on) continue;
      st.age += dt;
      const f = st.age / st.life;
      if (f >= 1) { st.on = false; st.s.visible = false; continue; }
      const slam = f < 0.14 ? 1.8 - (f / 0.14) * 0.8 : 1;
      const k = st.size * slam;
      st.s.position.set(st.x, st.y - (1 - slam) * 0.2 + (st.kind === 'n' ? 0 : f * 0.6), st.z);
      st.s.scale.set(k * st.aspect, k, 1);
      (st.s.material as THREE.SpriteMaterial).opacity = f < 0.1 ? f / 0.1 : f > 0.7 ? (1 - f) / 0.3 : 1;
    }
    // «Себозол-душ» bottles: up out of Ислам, tumbling, down into foam
    let nb0 = 0;
    for (let i = this.bottles.length - 1; i >= 0; i--) {
      const b = this.bottles[i], f = (now - b.t0) / b.dur;
      if (f >= 1) { this.foamAt(b.x1, b.y1, b.z1); this.bottles.splice(i, 1); continue; }
      if (f < 0) continue;
      this.v.set(b.x0 + (b.x1 - b.x0) * f, b.y0 + (b.y1 - b.y0) * f + Math.sin(Math.PI * f) * b.arc, b.z0 + (b.z1 - b.z0) * f);
      this.eu.set(f * 13 + b.spin, b.spin, f * 7);
      this.q.setFromEuler(this.eu);
      this.s.set(1, 1, 1);
      this.m.compose(this.v, this.q, this.s);
      this.bottleMesh.setMatrixAt(nb0++, this.m);
    }
    this.bottleMesh.count = nb0; this.bottleMesh.visible = nb0 > 0;
    if (nb0) this.bottleMesh.instanceMatrix.needsUpdate = true;
    // steam and other lingering emitters
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const em = this.emitters[i];
      if (now > em.until) { this.emitters.splice(i, 1); continue; }
      if (now < em.next || !this.near(em.x, em.z)) continue;
      em.next = now + (this.low ? 0.16 : 0.08);
      this.particles.emit(em.x, em.y, em.z, { n: 1, color: '#f4f1ea', size: 0.4, life: 1.3, spread: 0.15, up: 0.5, grav: -0.25, grow: 0.7, wob: 0.8, jitter: 0.25 });
    }
    // hacked high-rises: green scan lines, «> ВЗЛОМ_», rising bits
    let nb = 0;
    const wall = performance.now();
    let sign: Hack | null = null;
    for (let i = this.hacks.length - 1; i >= 0; i--) {
      const h = this.hacks[i];
      if (wall > h.until) { this.hacks.splice(i, 1); continue; }
      if (!this.near(h.x, h.z, 120)) continue;
      sign = sign ?? h;
      if (now >= this.glitchNext) {
        const H = HQ_H[h.side], camQ = this.stage.camera.quaternion;
        const bars = this.glitch.instanceMatrix.count / 2;
        for (let k = 0; k < bars; k++) {
          if (Math.random() < 0.25) continue;
          this.v.set(h.x + (Math.random() - 0.5) * 6, h.y + 0.3 + Math.random() * H, h.z + (Math.random() - 0.5) * 3);
          this.s.set(0.4 + Math.random() * (Math.random() < 0.2 ? 6 : 2.4), 0.04 + Math.random() * 0.22, 1);
          this.m.compose(this.v, camQ, this.s);
          this.glitch.setMatrixAt(nb++, this.m);
        }
        if (Math.random() < (this.low ? 0.3 : 0.6)) this.particles.emit(h.x, h.y + Math.random() * H, h.z, { n: 1, color: '#5dff7a', size: 0.18, life: 1, spread: 0.6, up: 0.8, grav: -0.3, jitter: 3 });
      }
    }
    if (now >= this.glitchNext) {
      this.glitchNext = now + 0.07;
      this.glitch.count = nb; this.glitch.visible = nb > 0;
      if (nb) this.glitch.instanceMatrix.needsUpdate = true;
      (this.glitch.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.random() * 0.4;
    }
    if (!this.hacks.length) { this.glitch.visible = false; this.glitch.count = 0; }
    this.hackSign.visible = !!sign && Math.sin(now * 9) > -0.6;
    if (sign) this.hackSign.position.set(sign.x, sign.y + HQ_H[sign.side] * 0.6, sign.z);
  }

  clear() {
    for (const r of this.rings) { r.on = false; r.mesh.visible = false; }
    for (const st of this.stamps) { st.on = false; st.s.visible = false; }
    this.emitters.length = 0;
    this.hacks.length = 0;
    this.bottles.length = 0; this.bottleMesh.count = 0; this.bottleMesh.visible = false;
    this.lastDie.clear();
    this.glitch.count = 0; this.glitch.visible = false;
    this.hackSign.visible = false;
  }
}
