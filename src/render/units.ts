// Draws sim units: instanced crowds, articulated bosses, health bars, hero markers and
// state marks (stunned «Н», taunted «!», scared «!!» by the admin's pack, poison, Адам's speed
// streaks, the снюс / LOOP buzz and the «отходняк» slump). Reads sim state only.
import * as THREE from 'three';
import { unitGeometry, unitScale, islamRig, zurabRig, PAL, type Rig } from './models';
import { heroGeometry, heroScale, heroHeight } from './heroes';
import { isLowPower } from './scene';
import { heightY, type Terrain } from '../world/terrain';
import { UNITS, BUFF } from '../sim/defs';
import { UF, type Sim, type U } from '../sim/sim';
import type { Particles } from './fx';

interface Vis {
  px: number; pz: number; x: number; z: number; yaw: number; phase: number; atk: number; hit: number; lastCd: number; seen: number;
  /** When the current stun was first seen (ms), -1 when not stunned. */
  nAt: number;
  /** Next poison fleck (ms). */
  fleck: number;
  /** Last drawn position: feet and the top of the model (for labels and effects). */
  rx: number; ry: number; rz: number; top: number;
}

const NT = UNITS.length;
const CAP = 170;
const BAR_MAX = CAP * 2 + 16;
const MARK_MAX = 200;
export const US = 1.7;
export const BS = 1.45; // units read better a bit larger than true scale

const isHero = (t: number) => t >= 6 && t <= 12;
/** Instances per side and type: heroes are unique per side, summons and rides are few. */
const capFor = (t: number) => (isHero(t) ? 4 : t === 13 ? 8 : t === 14 ? 40 : t === 16 ? 6 : CAP);
/** Cars move without the walk cycle (no lean or roll, a low bob). */
const isCar = (t: number, s: number) => t === 14 || t === 16 || (t === 3 && s === 1);

/** Model-space top of each unit type (before scaling). */
function modelTop(t: number, s: 0 | 1) {
  if (t >= 6) return heroHeight(t, s);
  if (t === 3) return s === 1 ? 0.7 : 0.85;
  return t === 4 && s === 1 ? 1.1 : 1.0;
}
const typeScale = (t: number, s: 0 | 1) => (t >= 6 ? heroScale(t, s) : unitScale(t, s));

/** Red ballpoint/teacher's-pen glyph on a transparent canvas: «Н» (absent) or «!» (taunted). */
function glyphTexture(ch: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const paint = () => {
    g.clearRect(0, 0, 128, 128);
    g.save();
    g.translate(64, 70); g.rotate(-0.12);
    g.font = '700 118px Caveat, "Segoe Print", "Comic Sans MS", cursive';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.strokeStyle = '#fbfaf5'; g.lineWidth = 16; g.strokeText(ch, 0, 0);
    g.fillStyle = color; g.fillText(ch, 0, 0);
    g.restore();
    tex.needsUpdate = true;
  };
  paint();
  const fs = (document as Document & { fonts?: FontFaceSet }).fonts;
  fs?.load('700 118px Caveat').then(paint, () => { /* fallback font */ });
  return tex;
}

/** Down-pointing chevron (pen-drawn «v» over a hero's head), in the XY plane. */
function chevronGeometry(w: number, h: number, th: number, z = 0): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, h / 2);
  s.lineTo(-w / 2 + th, h / 2);
  s.lineTo(0, -h / 2 + th * 1.25);
  s.lineTo(w / 2 - th, h / 2);
  s.lineTo(w / 2, h / 2);
  s.lineTo(0, -h / 2);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.translate(0, 0, z);
  return g;
}

/** Three motion lines trailing behind a runner (local -z), for Адам on the run. */
function streakGeometry(): THREE.BufferGeometry {
  const parts = [[-0.22, 0.75, 0.55], [0.2, 0.55, 0.7], [-0.05, 0.32, 0.5]].map(([x, y, len]) => {
    const b = new THREE.BoxGeometry(0.035, 0.035, len);
    b.translate(x, y, -0.35 - len / 2);
    return b;
  });
  const pos: number[] = [];
  for (const p of parts) { const a = p.toNonIndexed().attributes.position.array; for (let i = 0; i < a.length; i++) pos.push(a[i]); p.dispose(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function billboards(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, order: number, colors = false) {
  const im = new THREE.InstancedMesh(geo, mat, cap);
  im.count = 0; im.frustumCulled = false; im.renderOrder = order; im.visible = false;
  if (colors) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
  return im;
}

export class UnitView {
  group = new THREE.Group();
  /** inst[side][type]; type 5 (the boss) is drawn by the rigs and has no instanced mesh. */
  private inst: (THREE.InstancedMesh | null)[][] = [[], []];
  private caps: number[] = [];
  private vis = new Map<number, Vis>();
  private bars: THREE.InstancedMesh; private barsFg: THREE.InstancedMesh;
  // hero markers and state marks
  private heroRing: THREE.InstancedMesh;
  private chevOut: THREE.InstancedMesh; private chevIn: THREE.InstancedMesh;
  private markN: THREE.InstancedMesh; private markBang: THREE.InstancedMesh; private markScared: THREE.InstancedMesh;
  private streaks: THREE.InstancedMesh;
  bosses: Rig[];
  private bossVis: ({ x: number; z: number; yaw: number; phase: number; atk: number; active: boolean; dead: number })[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private q2 = new THREE.Quaternion(); private e = new THREE.Euler();
  private v = new THREE.Vector3(); private s = new THREE.Vector3(); private c = new THREE.Color(); private off = new THREE.Vector3();
  private nrm = new THREE.Vector3(); private up = new THREE.Vector3(0, 1, 0);
  private red = new THREE.Color('#ff3b2f'); private boneWhite = new THREE.Color('#fbfaf5');
  private counts = new Int32Array(2 * NT);
  /** Per side × type: extra scale and model-space top, looked up once. */
  private kScale = new Float32Array(2 * NT); private kTop = new Float32Array(2 * NT);
  private frame = 0;
  private lowPower = isLowPower();
  hqPos: { x: number; z: number; rot: number }[] = [];

  constructor(private t: Terrain, private sim: Sim, private particles: Particles) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (let type = 0; type < NT; type++) this.caps.push(capFor(type));
    for (const side of [0, 1] as const) for (let type = 0; type < NT; type++) {
      if (type === 5) continue;
      this.kScale[side * NT + type] = typeScale(type, side);
      this.kTop[side * NT + type] = modelTop(type, side);
    }
    for (const side of [0, 1] as const) for (let type = 0; type < NT; type++) {
      if (type === 5) { this.inst[side].push(null); continue; }
      const cap = this.caps[type];
      const geo = type < 6 ? unitGeometry(type, side) : heroGeometry(type, side);
      const im = new THREE.InstancedMesh(geo, mat, cap);
      im.count = 0; im.castShadow = true; im.frustumCulled = false; im.visible = false;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      this.inst[side].push(im); this.group.add(im);
    }
    const bg = new THREE.PlaneGeometry(1, 0.11);
    this.bars = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ color: '#15130f', depthTest: true }), BAR_MAX);
    const fgG = new THREE.PlaneGeometry(1, 0.07); fgG.translate(0.5, 0, 0.001);
    this.barsFg = new THREE.InstancedMesh(fgG, new THREE.MeshBasicMaterial({ color: '#ffffff' }), BAR_MAX);
    this.barsFg.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BAR_MAX * 3), 3);
    this.bars.frustumCulled = false; this.barsFg.frustumCulled = false;
    this.bars.renderOrder = 6; this.barsFg.renderOrder = 7;
    this.group.add(this.bars, this.barsFg);

    // a team-coloured ring under each hero and a pen chevron over its head, readable at overview zoom
    const ringG = new THREE.RingGeometry(0.44, 0.54, 28, 1); ringG.rotateX(-Math.PI / 2);
    this.heroRing = billboards(ringG, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), 16, 3, true);
    const chevMat = (c: string) => new THREE.MeshBasicMaterial({ color: c, depthTest: false, depthWrite: false, transparent: true, side: THREE.DoubleSide });
    this.chevOut = billboards(chevronGeometry(0.78, 0.52, 0.27), chevMat('#fbfaf5'), 16, 8);
    this.chevIn = billboards(chevronGeometry(0.6, 0.38, 0.15, 0.01), chevMat('#ffffff'), 16, 9, true);
    const plane = new THREE.PlaneGeometry(1, 1);
    const markMat = (tex: THREE.Texture) => new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, alphaTest: 0.05 });
    this.markN = billboards(plane, markMat(glyphTexture('Н', '#d32a1c')), MARK_MAX, 8);
    this.markBang = billboards(plane, markMat(glyphTexture('!', '#d8361f')), MARK_MAX, 8);
    // «Курение убивает»: a blue-pen «!!» over everybody running from the pack
    this.markScared = billboards(plane, markMat(glyphTexture('!!', '#1f4fc4')), MARK_MAX, 8);
    this.streaks = billboards(streakGeometry(), new THREE.MeshBasicMaterial({ color: '#fbfaf5', transparent: true, opacity: 0.8, depthWrite: false }), 8, 4);
    this.group.add(this.heroRing, this.chevOut, this.chevIn, this.markN, this.markBang, this.markScared, this.streaks);

    const bmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.bosses = [islamRig(bmat), zurabRig(bmat)];
    for (const b of this.bosses) this.group.add(b.root);
    this.bossVis = [0, 1].map(() => ({ x: 0, z: 0, yaw: 0, phase: 0, atk: -9, active: false, dead: -99 }));
  }

  /** Called after each sim step. */
  capture(now: number) {
    this.frame++;
    for (const u of this.sim.st.units) {
      let v = this.vis.get(u.id);
      if (!v) {
        v = { px: u.x, pz: u.z, x: u.x, z: u.z, yaw: u.s === 0 ? 1.2 : -1.6, phase: Math.random() * 6, atk: -9, hit: -9, lastCd: 0, seen: this.frame, nAt: -1, fleck: 0, rx: u.x, ry: 0, rz: u.z, top: 1 };
        this.vis.set(u.id, v);
      }
      v.px = v.x; v.pz = v.z; v.x = u.x; v.z = u.z; v.seen = this.frame;
      if (u.cd > v.lastCd) v.atk = now;
      if (u.hit === 0) v.hit = now;
      v.lastCd = u.cd;
    }
    if (this.frame % 50 === 0) for (const [id, v] of this.vis) if (this.frame - v.seen > 5) this.vis.delete(id);
  }

  resetVis() { this.vis.clear(); }

  /** Where unit `id` was last drawn: feet (x, y, z) and the top of its model; null for a unit it never drew. */
  renderPos(id: number): { x: number; y: number; z: number; top: number } | null {
    const v = this.vis.get(id);
    return v ? { x: v.rx, y: v.ry, z: v.rz, top: v.top } : null;
  }

  zoomK = 1;
  update(alpha: number, now: number, dt: number, cam: THREE.Camera) {
    const counts = this.counts;
    counts.fill(0);
    let nb = 0, nRing = 0, nChev = 0, nN = 0, nBang = 0, nStreak = 0, nScared = 0;
    const camQ = cam.quaternion, cp = cam.position;
    const st = this.sim.st, tick = st.tick;
    const boss0 = st.sides[0].boss, boss1 = st.sides[1].boss;
    const zk = this.zoomK;
    // card buffs per side: 1 снюс / энергетик, 2 LOOP / эспрессо, 3 both, 4 «отходняк»
    const buzz = [0, 1].map(s => {
      const sd = st.sides[s] as { snus?: number; loop?: number };
      const sn = sd.snus ?? 0, lp = sd.loop ?? 0;
      return (sn > tick ? 1 : 0) | (lp > tick ? 2 : 0) | (sn > 0 && tick >= sn && tick < sn + BUFF.offFor ? 4 : 0);
    });
    const fx = !this.lowPower && (buzz[0] | buzz[1]) !== 0;
    for (const u of st.units) {
      const v = this.vis.get(u.id);
      if (!v) continue;
      const x = v.px + (v.x - v.px) * alpha, z = v.pz + (v.z - v.pz) * alpha;
      const dx = v.x - v.px, dz = v.z - v.pz;
      const moving = dx * dx + dz * dz > 1e-5;
      let want = v.yaw;
      if (moving) want = Math.atan2(dx, dz);
      else if (u.tg >= 0) { const o = this.sim.unit(u.tg); if (o) want = Math.atan2(o.x - u.x, o.z - u.z); }
      else if (u.tg === -2) { const e = st.pts[1 - u.s]; want = Math.atan2(e.x - u.x, e.z - u.z); }
      let d = want - v.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      v.yaw += d * Math.min(1, dt * 10);
      if (moving) v.phase += Math.sqrt(dx * dx + dz * dz) * dt * 60;
      if (u.t === 5) { this.updateBoss(u, x, z, v, now, dt); continue; }
      const type = u.t >= 0 && u.t < NT ? u.t : 0;
      const im = this.inst[u.s][type];
      if (!im) continue;
      const ci = u.s * NT + type;
      const i = counts[ci]++;
      if (i >= this.caps[type]) continue;
      const s = u.s as 0 | 1;
      const ks = this.kScale[ci], sc = ks * US * zk;
      const car = isCar(type, s);
      // gait: cars bob low, the chicken hops, the Голем stomps
      const freq = car ? 0.5 : type === 15 ? 2.4 : type === 13 ? 0.7 : 1.3;
      const amp = car ? 0.05 : type === 15 ? 0.22 : type === 13 ? 0.1 : 0.18;
      const bob = moving ? Math.abs(Math.sin(v.phase * freq)) * amp : 0;
      const at = (now - v.atk) / 250;
      const lunge = at >= 0 && at < 1 ? Math.sin(at * Math.PI) * 0.4 : 0;
      const y = heightY(this.t, x, z);
      this.v.set(x + Math.sin(v.yaw) * lunge, y + bob, z + Math.cos(v.yaw) * lunge);
      const lean = moving && !car ? (type === 11 ? 0.14 : 0.1) : 0;
      this.e.set(lean + (lunge && !car ? 0.25 : 0), v.yaw, moving && !car ? Math.sin(v.phase * 1.3) * 0.08 : 0);
      this.q.setFromEuler(this.e);
      const stun = u.stun > tick;
      this.s.set(sc, sc * (stun ? 0.8 : 1), sc);
      this.m.compose(this.v, this.q, this.s);
      im.setMatrixAt(i, this.m);
      // tint: hit flash, slowed (blue), poisoned (green), stunned (washed out)
      const ht = (now - v.hit) / 150;
      const f = ht >= 0 && ht < 1 ? 1 + (1 - ht) * 1.4 : 1;
      let r = f, g = f, b = f;
      if (u.slow > tick) { r *= 1.25; g *= 1.25; b *= 1.69; }
      const psn = u.psn > tick;
      if (psn) { r *= 0.72; g *= 1.3; b *= 0.62; }
      if (stun) { r = r * 0.8 + 0.25; g = g * 0.8 + 0.25; b = b * 0.8 + 0.25; }
      this.c.setRGB(r, g, b);
      im.setColorAt(i, this.c);

      const top = this.kTop[ci] * sc;
      v.rx = x; v.ry = y; v.rz = z; v.top = top;
      const hero = isHero(type);
      const camD2 = (cp.x - x) ** 2 + (cp.z - z) ** 2;
      // health bar: wounded units, and heroes always (they are worth watching)
      const barY = y + top + 0.2;
      let cs = 0;
      if ((u.hp < u.mhp || hero) && nb < BAR_MAX) this.bar(nb++, x, barY, z, hero ? 1.5 : 1.1, Math.max(0, u.hp / u.mhp), u.s, camQ);
      if (hero && nRing < 16) {
        // ground ring, tilted to the slope
        const h = 0.6;
        const hx = heightY(this.t, x + h, z) - heightY(this.t, x - h, z), hz = heightY(this.t, x, z + h) - heightY(this.t, x, z - h);
        this.nrm.set(-hx, 2 * h, -hz).normalize();
        this.q2.setFromUnitVectors(this.up, this.nrm);
        const rs = Math.max(1, ks) * US * Math.min(zk, 1.8) * (type === 9 ? 1.2 : 1);
        this.v.set(x, y + 0.1, z); this.s.set(rs, rs, rs);
        this.m.compose(this.v, this.q2, this.s);
        this.heroRing.setMatrixAt(nRing, this.m);
        this.heroRing.setColorAt(nRing, PAL.side[s]);
        nRing++;
        // chevron over the head (bobs gently; bigger when zoomed out)
        // about 16 px on screen however far the camera is
        const cd = Math.sqrt(camD2 + (cp.y - y) ** 2);
        cs = Math.max(0.75 * Math.max(1, zk * 0.95), cd * 0.017);
        this.v.set(x, barY + 0.45 * cs + 0.15 + Math.sin(now / 260 + u.id) * 0.08 * cs, z); this.s.set(cs, cs, cs);
        this.m.compose(this.v, camQ, this.s);
        this.chevOut.setMatrixAt(nChev, this.m);
        this.chevIn.setMatrixAt(nChev, this.m);
        this.chevIn.setColorAt(nChev, PAL.side[s]);
        nChev++;
      }
      // «Н» over anybody stunned, «!» over anybody taunted by WOU, «!!» over anybody scared by the pack
      const markY = barY + (hero ? cs * 1.15 + 0.2 : 0.45);
      const scared = u.fr > tick;
      // marks stay legible when zoomed out (about 9 px minimum)
      const mk = stun || u.tt > tick || scared ? Math.max(1, Math.sqrt(camD2 + (cp.y - y) ** 2) * 0.0095 / (0.55 + 0.25 * zk)) : 1;
      if (stun) {
        if (v.nAt < 0) v.nAt = now;
        if (nN < MARK_MAX) {
          const pop = Math.min(1, (now - v.nAt) / 160);
          const left = (u.stun - tick) * 100; // ms
          const k = mk * (0.55 + 0.25 * zk) * (pop < 1 ? 0.4 + pop * 0.75 : 1 + Math.sin((now - v.nAt) / 90) * 0.04) * Math.min(1, left / 200 + 0.3);
          this.v.set(x, markY + k * 0.5, z); this.s.set(k, k, k);
          this.m.compose(this.v, camQ, this.s);
          this.markN.setMatrixAt(nN++, this.m);
        }
      } else v.nAt = -1;
      if (!stun && u.tt > tick && nBang < MARK_MAX) {
        const k = mk * (0.42 + 0.2 * zk) * (1 + Math.abs(Math.sin(now / 140 + u.id)) * 0.12);
        this.v.set(x, markY + k * 0.5, z); this.s.set(k, k, k);
        this.m.compose(this.v, camQ, this.s);
        this.markBang.setMatrixAt(nBang++, this.m);
      }
      if (scared && !stun && !(u.tt > tick) && nScared < MARK_MAX) {
        // a nervous little jitter, and sweat drops near the camera
        const k = mk * (0.4 + 0.2 * zk) * (1 + Math.abs(Math.sin(now / 90 + u.id * 1.7)) * 0.1);
        this.v.set(x + Math.sin(now / 37 + u.id) * 0.05 * k, markY + k * 0.5, z); this.s.set(k, k, k);
        this.m.compose(this.v, camQ, this.s);
        this.markScared.setMatrixAt(nScared++, this.m);
        if (!this.lowPower && camD2 < 70 * 70 && Math.random() < dt * 3) this.particles.emit(x, y + top * 0.92, z, { n: 1, color: '#9fd3ff', size: 0.15 * Math.min(zk, 1.6), life: 0.55, spread: 0.7, up: 0.9, grav: 5, jitter: 0.4 });
      }
      // снюс / LOOP: a faint buzz of sparks; «отходняк»: a grey sigh now and then (near the camera only)
      const bz = fx ? buzz[u.s] : 0;
      if (bz && camD2 < 55 * 55 && Math.random() < dt * (bz & 3 ? 1.6 : 0.7)) {
        if (bz & 1) this.particles.emit(x, y + top * 0.5, z, { n: 1, color: '#c8f04a', size: 0.13 * Math.min(zk, 1.6), life: 0.5, spread: 0.5, up: 2.2, grav: 0.6, jitter: 0.6 });
        else if (bz & 2) this.particles.emit(x, y + top * 0.6, z, { n: 1, color: '#bff5ec', size: 0.15 * Math.min(zk, 1.6), life: 0.75, spread: 0.4, up: 1.1, grav: -0.2, wob: 1, jitter: 0.6 });
        else this.particles.emit(x, y + top * 0.95, z, { n: 1, color: '#a29f96', size: 0.24 * Math.min(zk, 1.6), life: 0.8, spread: 0.3, up: 0.2, grav: 0.5, grow: 0.6, jitter: 0.3 });
      }
      // poison: green bubbles now and then (only near the camera)
      if (psn && now > v.fleck && camD2 < 110 * 110) {
        v.fleck = now + (this.lowPower ? 520 : 260) + Math.random() * 200;
        this.particles.emit(x, y + top * 0.85, z, { n: 1, color: '#8fe04a', size: 0.22 * Math.min(zk, 1.6), life: 0.9, spread: 0.3, up: 0.7, grav: -0.2, wob: 0.8, jitter: 0.5 });
      }
      // Адам on the run: motion lines and a little dust
      if (type === 11 && (u.f & UF.FLEE) && moving && nStreak < 8) {
        const k = sc * (0.85 + Math.sin(now / 45 + u.id) * 0.15);
        this.e.set(0, v.yaw, 0); this.q2.setFromEuler(this.e);
        this.v.set(x, y, z); this.s.set(sc, sc, k);
        this.m.compose(this.v, this.q2, this.s);
        this.streaks.setMatrixAt(nStreak++, this.m);
        if (!this.lowPower && camD2 < 80 * 80 && Math.random() < dt * 14) this.particles.emit(x - Math.sin(v.yaw) * 0.5, y + 0.1, z - Math.cos(v.yaw) * 0.5, { n: 1, color: '#d9cdb4', size: 0.35, life: 0.5, spread: 0.4, up: 0.3, grav: 0.2, grow: 0.8 });
      }
    }
    for (let side = 0; side < 2; side++) {
      for (let type = 0; type < NT; type++) {
        const im = this.inst[side][type];
        if (!im) continue;
        const n = Math.min(this.caps[type], counts[side * NT + type]);
        im.count = n; im.visible = n > 0;
        if (!n) continue;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
    // bosses (idle at home when not on the field)
    for (let k = 0; k < 2; k++) {
      const s = k as 0 | 1;
      const id = s === 0 ? boss0 : boss1;
      const bv = this.bossVis[s];
      const u = id >= 0 ? this.sim.unit(id) : undefined;
      if (!u) {
        bv.active = false;
        this.idleBoss(s, now, dt);
      } else if (nb < BAR_MAX) {
        this.bar(nb++, bv.x, heightY(this.t, bv.x, bv.z) + this.bosses[s].height * BS + 0.6, bv.z, 3.2, Math.max(0, u.hp / u.mhp), s, camQ);
      }
    }
    this.flush(this.bars, nb); this.flush(this.barsFg, nb);
    this.flush(this.heroRing, nRing);
    this.flush(this.chevOut, nChev); this.flush(this.chevIn, nChev);
    this.flush(this.markN, nN); this.flush(this.markBang, nBang); this.flush(this.markScared, nScared);
    this.flush(this.streaks, nStreak);
  }

  private flush(im: THREE.InstancedMesh, n: number) {
    im.count = n; im.visible = n > 0;
    if (!n) return;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  private bar(i: number, x: number, y: number, z: number, w: number, f: number, side: number, q: THREE.Quaternion) {
    this.v.set(x, y, z); this.s.set(w, 1, 1);
    this.m.compose(this.v, q, this.s);
    this.bars.setMatrixAt(i, this.m);
    // foreground: shift left edge
    this.off.set(-w / 2, 0, 0).applyQuaternion(q);
    this.v.set(x + this.off.x, y + this.off.y, z + this.off.z); this.s.set(Math.max(0.001, w * f), 1, 1);
    this.m.compose(this.v, q, this.s);
    this.barsFg.setMatrixAt(i, this.m);
    this.barsFg.setColorAt(i, f < 0.3 ? this.red : PAL.side[side]);
  }

  private updateBoss(u: U, x: number, z: number, v: Vis, now: number, dt: number) {
    const s = u.s as 0 | 1;
    const rig = this.bosses[s], bv = this.bossVis[s];
    bv.active = true; bv.x = x; bv.z = z; bv.yaw = v.yaw;
    const y = heightY(this.t, x, z);
    v.rx = x; v.ry = y; v.rz = z; v.top = rig.height * BS;
    rig.root.visible = true;
    rig.root.position.set(x, y, z);
    rig.root.rotation.y = v.yaw;
    const moving = Math.abs(v.x - v.px) + Math.abs(v.z - v.pz) > 1e-4;
    const at = (now - v.atk) / (s === 1 ? 420 : 320);
    this.pose(rig, s, moving ? v.phase * 0.5 : now / 1000, moving, at, now);
    const sc = u.stun > this.sim.st.tick ? 0.9 : 1;
    rig.root.scale.setScalar(sc * BS * Math.min(1.6, this.zoomK));
    if (s === 0) this.dandruff(rig, now, moving ? 3 : 1);
    void dt;
  }

  private idleBoss(s: 0 | 1, now: number, dt: number) {
    const rig = this.bosses[s];
    const hq = this.hqPos[s];
    if (!hq) { rig.root.visible = false; return; }
    const ox = s === 0 ? -4.6 : 5.6, oz = -3.4;
    const c = Math.cos(hq.rot), sn = Math.sin(hq.rot);
    const x = hq.x + ox * c + oz * sn, z = hq.z - ox * sn + oz * c;
    rig.root.visible = true;
    rig.root.position.set(x, heightY(this.t, x, z), z);
    rig.root.rotation.y = s === 0 ? 1.0 : -1.2;
    rig.root.scale.setScalar(BS);
    this.pose(rig, s, now / 1000, false, -9, now, true);
    if (s === 0) this.dandruff(rig, now, 1);
    void dt;
  }

  private pose(rig: Rig, s: 0 | 1, ph: number, moving: boolean, at: number, now: number, idle = false) {
    const sw = moving ? Math.sin(ph * 2.2) : 0;
    rig.legL.rotation.x = sw * 0.6; rig.legR.rotation.x = -sw * 0.6;
    rig.body.position.y = moving ? Math.abs(Math.sin(ph * 2.2)) * 0.08 : 0;
    if (at >= 0 && at < 1) {
      // attack: Zurab slams both fists, Islam flicks his hair
      const k = Math.sin(at * Math.PI);
      if (s === 1) { rig.armL.rotation.x = -2.6 * k; rig.armR.rotation.x = -2.6 * k; rig.body.rotation.x = 0.35 * k; }
      else { rig.armR.rotation.x = -1.8 * k; rig.armL.rotation.x = 0.3 * k; rig.head.rotation.z = Math.sin(at * 18) * 0.35; }
      return;
    }
    rig.body.rotation.x = 0;
    if (idle && s === 1) {
      // Zurab flexes: double biceps
      const k = (Math.sin(now / 700) + 1) / 2;
      rig.armL.rotation.set(0, 0, 1.4 * k + 0.2); rig.armR.rotation.set(0, 0, -1.4 * k - 0.2);
      rig.armL.children[0].rotation.x = 0; rig.armR.children[0].rotation.x = 0;
      rig.head.rotation.z = Math.sin(now / 900) * 0.08;
      return;
    }
    if (idle && s === 0) {
      // Islam scratches his head
      const k = (Math.sin(now / 500) + 1) / 2;
      rig.armR.rotation.set(-2.6 - 0.3 * k, 0, -0.35); rig.armL.rotation.set(0, 0, 0.05);
      rig.head.rotation.z = Math.sin(now / 160) * 0.06;
      return;
    }
    rig.armL.rotation.set(-sw * 0.5, 0, s === 1 ? 0.25 : 0.05); rig.armR.rotation.set(sw * 0.5, 0, s === 1 ? -0.25 : -0.05);
    rig.head.rotation.z = 0;
  }

  private dandruff(rig: Rig, now: number, rate: number) {
    if (Math.random() > 0.35 * rate) return;
    const p = this.off;
    rig.head.getWorldPosition(p);
    this.particles.emit(p.x, p.y + 0.42 * rig.root.scale.y, p.z, { n: 2, color: this.boneWhite, size: 0.12, life: 1.8, spread: 0.2, up: -0.05, grav: 0.18, wob: 0.6, jitter: 0.5 });
    void now;
  }

  bossPos(s: 0 | 1) { const r = this.bosses[s].root; return { x: r.position.x, y: r.position.y, z: r.position.z, active: this.bossVis[s].active }; }

  /** Model height of a unit type before the renderer's scale (×US×zoom). */
  static unitHeight(t: number) { return t === 5 ? 2.6 : t >= 6 ? heroHeight(t, 0) * heroScale(t, 0) : UNITS[t].kind === 2 ? 0.8 : 1.0; }
}

