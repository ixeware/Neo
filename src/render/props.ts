// v3 props: гелики с номерами «КРА 95», спортики, the admin's cigarette-pack ultimate and the
// landmark buildings for the real places of Старые Атаги and Курчалой. Same chibi low-poly,
// flat-shaded, vertex-coloured style as models.ts / heroes.ts: units merge into one geometry so
// they instance cheaply, buildings are one solid mesh plus canvas sign planes. Everything faces +z
// and stands on y = 0.
import * as THREE from 'three';
import { Builder, PAL } from './models';

export type V3 = [number, number, number];
type Col = THREE.Color;
const col = (s: string) => new THREE.Color(s);
/** Linear colour above 1.0: on Lambert + ACES it reads as self-lit (screens, lamps). */
const glow = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const lift = (c: Col, k: number) => new THREE.Color(c.r * k, c.g * k, c.b * k);

const BOX = new THREE.BoxGeometry(1, 1, 1);
const PLANE = new THREE.PlaneGeometry(1, 1);
const CYL6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const CYL8 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const CYL12 = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const ICO = new THREE.IcosahedronGeometry(0.5, 0);
const CONE6 = new THREE.ConeGeometry(0.5, 1, 6);
/** Square pyramid with a 1×1 base, apex at +0.5: hip roofs. */
const HIP = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4);
const HALF_PI = Math.PI / 2;

const _e = new THREE.Euler(), _v = new THREE.Vector3();
/** A primitive in a limb frame: pivot + rotation, `at` is its centre in that frame. */
function seg(b: Builder, c: Col, piv: V3, rot: V3, at: V3, size: V3, g: THREE.BufferGeometry = BOX): V3 {
  _e.set(rot[0], rot[1], rot[2]);
  _v.set(at[0], at[1], at[2]).applyEuler(_e);
  const p: V3 = [piv[0] + _v.x, piv[1] + _v.y, piv[2] + _v.z];
  b.add(g, c, p, rot, size);
  return p;
}
function along(piv: V3, rot: V3, at: V3): V3 {
  _e.set(rot[0], rot[1], rot[2]);
  _v.set(at[0], at[1], at[2]).applyEuler(_e);
  return [piv[0] + _v.x, piv[1] + _v.y, piv[2] + _v.z];
}

/** Copies a finished vertex-coloured geometry into a builder through a matrix (keeps its colours). */
function mergeInto(b: Builder, g: THREE.BufferGeometry, m: THREE.Matrix4) {
  const P = g.attributes.position.array, N = g.attributes.normal.array, C = g.attributes.color.array;
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < P.length; i += 3) {
    v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(m);
    n.set(N[i], N[i + 1], N[i + 2]).applyMatrix3(nm).normalize();
    b.pos.push(v.x, v.y, v.z); b.nor.push(n.x, n.y, n.z); b.col.push(C[i], C[i + 1], C[i + 2]);
  }
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
function place(p: V3, rot: V3 = [0, 0, 0], s = 1) {
  _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
  return _m.compose(new THREE.Vector3(...p), _q, new THREE.Vector3(s, s, s));
}

/** Put the lowest vertex exactly on the ground and refresh the bounds. */
function grounded(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  const lo = g.boundingBox!.min.y;
  if (Math.abs(lo) > 1e-4) { g.translate(0, -lo, 0); g.computeBoundingBox(); }
  g.computeBoundingSphere();
  return g;
}

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

// ---- flat stroke lettering: 2 triangles per stroke, vertex-coloured ---------------------------
// Strokes in a unit cell (x right, y up), drawn as thin quads. Enough for plates and jackets.
const STROKES: Record<string, number[]> = {
  '0': [0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0],
  '1': [0.62, 0, 0.62, 1, 0.62, 1, 0.2, 0.72],
  '2': [0, 1, 1, 1, 1, 1, 1, 0.5, 1, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0, 0, 1, 0],
  '3': [0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0.25, 0.5, 1, 0.5],
  '4': [0, 1, 0, 0.45, 0, 0.45, 1, 0.45, 0.75, 1, 0.75, 0],
  '5': [1, 1, 0, 1, 0, 1, 0, 0.5, 0, 0.5, 1, 0.5, 1, 0.5, 1, 0, 1, 0, 0, 0],
  '6': [1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0.5, 1, 0.5, 0, 0.5],
  '7': [0, 1, 1, 1, 1, 1, 0.35, 0],
  '8': [0, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 0.5, 1, 0.5, 0, 0, 1, 0],
  '9': [1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0, 0.5, 0, 0.5, 1, 0.5, 0, 0, 1, 0],
  'А': [0, 0, 0.5, 1, 0.5, 1, 1, 0, 0.2, 0.36, 0.8, 0.36],
  'В': [0, 0, 0, 1, 0, 1, 0.78, 1, 0.78, 1, 0.78, 0.52, 0, 0.52, 1, 0.52, 1, 0.52, 1, 0, 1, 0, 0, 0],
  'Е': [0, 0, 0, 1, 0, 1, 1, 1, 0, 0.5, 0.8, 0.5, 0, 0, 1, 0],
  'К': [0, 0, 0, 1, 0, 0.45, 1, 1, 0.32, 0.62, 1, 0],
  'М': [0, 0, 0, 1, 0, 1, 0.5, 0.42, 0.5, 0.42, 1, 1, 1, 1, 1, 0],
  'Н': [0, 0, 0, 1, 1, 0, 1, 1, 0, 0.5, 1, 0.5],
  'О': [0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0],
  'Р': [0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0.48, 1, 0.48, 0, 0.48],
  'С': [1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0],
  'Т': [0, 1, 1, 1, 0.5, 1, 0.5, 0],
  'У': [0, 1, 0.5, 0.45, 1, 1, 0.22, 0],
  'Х': [0, 0, 1, 1, 0, 1, 1, 0],
  'B': [0, 0, 0, 1, 0, 1, 0.78, 1, 0.78, 1, 0.78, 0.52, 0, 0.52, 1, 0.52, 1, 0.52, 1, 0, 1, 0, 0, 0],
  'L': [0, 1, 0, 0, 0, 0, 1, 0],
  'S': [1, 1, 0, 1, 0, 1, 0, 0.5, 0, 0.5, 1, 0.5, 1, 0.5, 1, 0, 1, 0, 0, 0],
  'U': [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1],
};
export type Face = '+z' | '-z' | '+x' | '-x' | '+y';
const FACES: Record<Face, { u: V3; v: V3; n: V3; r: V3 }> = {
  '+z': { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1], r: [0, 0, 0] },
  '-z': { u: [-1, 0, 0], v: [0, 1, 0], n: [0, 0, -1], r: [0, Math.PI, 0] },
  '+x': { u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0], r: [0, HALF_PI, 0] },
  '-x': { u: [0, 0, 1], v: [0, 1, 0], n: [-1, 0, 0], r: [0, -HALF_PI, 0] },
  '+y': { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0], r: [-HALF_PI, 0, 0] },
};

/**
 * Flat lettering on an axis-aligned face, read the right way round by someone looking at that face.
 * `centre` is the middle of the text block (already on the surface; it is pushed out by `lift`).
 * `arch` bends the baseline up in the middle (varsity lettering). Returns the triangle count.
 */
export function strokeText(b: Builder, c: Col, text: string, centre: V3, face: Face, h: number,
  o: { th?: number; w?: number; gap?: number; arch?: number; lift?: number; inset?: number; font?: Record<string, number[]> } = {}) {
  const th = o.th ?? h * 0.16, w = o.w ?? h * 0.62, gap = o.gap ?? h * 0.2, arch = o.arch ?? 0, eps = o.lift ?? 0.003;
  // stroke centre lines are laid out with `inset` (default: th), so a thicker pass with the same inset outlines a thinner one
  const it = o.inset ?? th;
  const F = FACES[face];
  const chars = [...text];
  const total = chars.length * w + (chars.length - 1) * gap;
  let n = 0;
  chars.forEach((ch, i) => {
    const s = o.font?.[ch] ?? STROKES[ch];
    const cu = -total / 2 + i * (w + gap) + w / 2;
    const k = total > 0 ? cu / (total / 2) : 0;
    const cv = arch * (1 - k * k);
    if (!s) return;
    for (let j = 0; j < s.length; j += 4) {
      const x0 = -w / 2 + it / 2 + s[j] * (w - it), y0 = -h / 2 + it / 2 + s[j + 1] * (h - it);
      const x1 = -w / 2 + it / 2 + s[j + 2] * (w - it), y1 = -h / 2 + it / 2 + s[j + 3] * (h - it);
      const du = cu + (x0 + x1) / 2, dv = cv + (y0 + y1) / 2;
      const len = Math.hypot(x1 - x0, y1 - y0) + th;
      const a = Math.atan2(y1 - y0, x1 - x0);
      const p: V3 = [0, 1, 2].map(ax => centre[ax] + F.u[ax] * du + F.v[ax] * dv + F.n[ax] * eps) as V3;
      b.add(PLANE, c, p, [F.r[0], F.r[1], a], [len, th, 1]);
      n += 2;
    }
  });
  return n;
}

// ---- a posable villager with adjustable proportions (tall, short, oversized) -----------------
export interface Limb { up?: V3; lo?: V3 }
export interface BodyOpts {
  top: Col; sleeve?: Col; pants?: Col; shoe?: Col; sole?: Col; skin?: Col;
  /** torso width, limb thickness, leg / torso / arm length and head size multipliers */
  w?: number; lw?: number; leg?: number; torso?: number; arm?: number; head?: number;
  armL?: Limb; armR?: Limb; legL?: Limb; legR?: Limb;
  /** short sleeves (forearms are skin) */
  tee?: boolean;
  /** tracksuit stripes along the arms, legs and the zip */
  stripe?: Col; stripes?: 1 | 2;
  /** rib band at the end of the sleeves */
  cuff?: Col;
  /** pants width multiplier; above ~1.2 the hems stack over the shoes */
  baggy?: number;
  /** chunky sneakers */
  chunky?: boolean;
  beard?: 'stubble' | 'none';
  /** 'brown': white, brown iris, pupil (for close-ups); 'dot': the classic black dots */
  eyes?: 'dot' | 'brown';
}
export interface BodyOut { handL: V3; handR: V3; hipY: number; shY: number; topY: number; headY: number; hs: number }

/** Same proportions as person()/figure() at the default multipliers; +x is the character's left. */
export function body(b: Builder, o: BodyOpts): BodyOut {
  const w = o.w ?? 1, lw = o.lw ?? 1, L = o.leg ?? 1, T = o.torso ?? 1, A = o.arm ?? 1, hs = o.head ?? 1, bag = o.baggy ?? 1;
  const skin = o.skin ?? PAL.skin, pants = o.pants ?? PAL.pants, shoe = o.shoe ?? PAL.shoe;
  const ns = o.stripe ? (o.stripes ?? 1) : 0;
  const hipY = 0.32 * L;
  const pw = 0.12 * lw * bag, pd = 0.14 * (1 + (bag - 1) * 0.75);
  const sw = (o.chunky ? 0.15 : 0.13) * lw, sh = o.chunky ? 0.075 : 0.06, sd = o.chunky ? 0.215 : 0.19;
  const stripes = (piv: V3, rot: V3, x: number, y: number, len: number) => {
    for (let k = 0; k < ns; k++) seg(b, o.stripe!, piv, rot, [x, y, ns === 2 ? (k ? 0.022 : -0.022) : 0], [0.012, len, ns === 2 ? 0.016 : 0.02]);
  };
  for (const s of [1, -1]) {
    const Lm = s > 0 ? o.legL : o.legR;
    const hip: V3 = [Math.max(0.08 * lw, pw / 2 + 0.012) * s, hipY, 0];
    const up = Lm?.up ?? [0, 0, 0];
    const foot = (piv: V3, rot: V3, d: number) => {
      seg(b, shoe, piv, rot, [0, -d + sh / 2, 0.025], [sw, sh, sd]);
      if (o.sole) seg(b, o.sole, piv, rot, [0, -d + 0.013, 0.025], [sw + 0.01, 0.026, sd + 0.01]);
    };
    if (Lm?.lo) {
      const t1 = 0.15 * L, d2 = hipY - t1;
      seg(b, pants, hip, up, [0, -t1 / 2 + 0.012, 0], [pw + 0.005, t1 + 0.045, pd + 0.005]);
      const knee = along(hip, up, [0, -t1, 0]);
      const sl = d2 - sh + 0.03;
      seg(b, pants, knee, Lm.lo, [0, -sl / 2 + 0.015, 0], [pw * 0.92, sl, pd * 0.92]);
      foot(knee, Lm.lo, d2);
      if (ns) stripes(hip, up, (pw / 2 + 0.004) * s, -t1 / 2, t1);
    } else {
      const len = hipY - sh + 0.012;
      seg(b, pants, hip, up, [0, -len / 2, 0], [pw, len, pd]);
      if (bag > 1.15) seg(b, pants, hip, up, [0, -hipY + sh + 0.02, 0.006], [pw * 1.14, 0.07, pd * 1.14]);
      foot(hip, up, hipY);
      if (ns) stripes(hip, up, (pw / 2 + 0.004) * s, -len / 2, len * 0.9);
    }
  }
  const botY = hipY - 0.01, topY = botY + 0.32 * T, shY = hipY + 0.29 * T;
  b.box(o.top, [0, (botY + topY) / 2, 0], [0.36 * w, topY - botY, 0.22]);
  if (ns) {
    b.box(o.stripe!, [0, (botY + topY) / 2, 0.112], [0.022, (topY - botY) * 0.94, 0.01]);
    for (const s of [1, -1]) b.box(o.stripe!, [0.181 * w * s, (botY + topY) / 2, 0], [0.012, (topY - botY) * 0.86, 0.1]);
  }
  const sleeve = o.sleeve ?? o.top;
  const aw = 0.09 * lw, ad = 0.11, hw = 0.08 * Math.max(1, lw * 0.9);
  const hands: V3[] = [];
  for (const s of [1, -1]) {
    const Am = s > 0 ? o.armL : o.armR;
    const shp: V3 = [0.23 * w * s, shY, 0];
    const up = Am?.up ?? [0, 0, 0];
    if (Am?.lo) {
      const u1 = 0.155 * A, u2 = 0.16 * A;
      seg(b, sleeve, shp, up, [0, -u1 / 2, 0], [aw, u1 + 0.03, ad]);
      const el = along(shp, up, [0, -u1, 0]);
      seg(b, o.tee ? skin : sleeve, el, Am.lo, [0, -u2 / 2 + 0.005, 0], [aw * 0.95, u2, ad * 0.92]);
      if (o.cuff && !o.tee) seg(b, o.cuff, el, Am.lo, [0, -u2 + 0.022, 0], [aw + 0.014, 0.036, ad + 0.012]);
      hands.push(seg(b, skin, el, Am.lo, [0, -u2 - 0.02, 0], [hw, 0.07, 0.09]));
      if (ns && !o.tee) stripes(shp, up, (aw / 2 + 0.003) * s, -u1 / 2, u1);
    } else {
      const len = 0.3 * A;
      if (o.tee) {
        seg(b, sleeve, shp, up, [0, -0.08, 0], [0.1 * lw, 0.17, 0.12]);
        seg(b, skin, shp, up, [0, -(0.16 + len) / 2, 0], [0.085 * lw, len - 0.15, 0.1]);
      } else seg(b, sleeve, shp, up, [0, -len / 2, 0], [aw, len, ad]);
      if (o.cuff && !o.tee) seg(b, o.cuff, shp, up, [0, -len + 0.02, 0], [aw + 0.014, 0.036, ad + 0.012]);
      hands.push(seg(b, skin, shp, up, [0, -len - 0.02, 0], [hw, 0.06, 0.09]));
      if (ns && !o.tee) stripes(shp, up, (aw / 2 + 0.003) * s, -len / 2, len * 0.9);
    }
  }
  // head
  const headY = topY + 0.16 * hs;
  b.box(skin, [0, headY, 0], [0.27 * hs, 0.27 * hs, 0.25 * hs]);
  const ez = 0.125 * hs;
  if (o.eyes === 'brown') {
    for (const s of [-1, 1]) {
      b.box(col('#f4f0e8'), [0.062 * s * hs, headY + 0.02 * hs, ez + 0.002], [0.058 * hs, 0.04 * hs, 0.006]);
      b.box(col('#6b3f1f'), [0.056 * s * hs, headY + 0.018 * hs, ez + 0.005], [0.032 * hs, 0.036 * hs, 0.004]);
      b.box(col('#1a0f08'), [0.056 * s * hs, headY + 0.018 * hs, ez + 0.0075], [0.015 * hs, 0.02 * hs, 0.002]);
    }
  } else {
    b.box(PAL.black, [-0.06 * hs, headY + 0.02 * hs, ez + 0.001], [0.04 * hs, 0.035 * hs, 0.01]);
    b.box(PAL.black, [0.06 * hs, headY + 0.02 * hs, ez + 0.001], [0.04 * hs, 0.035 * hs, 0.01]);
  }
  if ((o.beard ?? 'stubble') === 'stubble') b.box(PAL.skin2, [0, headY - 0.09 * hs, 0.03 * hs], [0.275 * hs, 0.09 * hs, 0.23 * hs]);
  return { handL: hands[0], handR: hands[1], hipY, shY, topY, headY, hs };
}

/** Short buzz cut on a body() head. */
function buzz(b: Builder, f: BodyOut, c = col('#3b2e26')) {
  const h = f.hs;
  b.box(c, [0, f.headY + 0.142 * h, -0.01 * h], [0.276 * h, 0.02, 0.256 * h]);
  b.box(c, [0, f.headY + 0.07 * h, -0.128 * h], [0.27 * h, 0.12 * h, 0.01]);
  for (const s of [-1, 1]) b.box(c, [0.137 * s * h, f.headY + 0.075 * h, -0.04 * h], [0.006, 0.1 * h, 0.15 * h]);
}

// ---- palette -------------------------------------------------------------------------------------
const K = {
  paint: col('#232429'), paint2: col('#34363e'), roof: col('#2b2d33'), glass: col('#3a4c61'), glassF: col('#557089'),
  rail: col('#5a5e67'), trim: col('#141518'), grille: col('#0d0e11'), mesh: col('#0a0b0d'), seam: col('#0b0b0d'), lens: col('#2a2f37'),
  chrome: col('#d3d8de'), chromeD: col('#80868e'), tyre: col('#141416'), rim: col('#3a3d44'),
  plate: col('#f4f3ee'), ink: col('#111111'), lamp: glow(2.2, 2.1, 1.8), amber: col('#f29a1f'), tail: col('#b3241a'),
  flagW: col('#f5f5f5'), flagB: col('#2457c5'), flagR: col('#d22f27'),
  suit: col('#1f2125'), sneaker: col('#f4f2ec'), sole: col('#cfccc4'),
  pave: col('#a9a397'), pave2: col('#8f897d'), conc: col('#c4bdb0'), asphalt: col('#55575b'), line: col('#f1efe6'),
  grass: col('#5f9a45'), grass2: col('#6dab50'), leaf: [col('#4f8a3a'), col('#5e9a40'), col('#3f7a35'), col('#76a948')],
  trunk: col('#6b4a31'), wood: col('#8a5a35'), steel: PAL.steel, dark: col('#2b2622'), metal: col('#5d6066'),
  warm: glow(1.35, 1.05, 0.62), cool: glow(1.0, 1.15, 1.3), winDark: col('#34404a'), winBlue: col('#3d5a73'),
};

// ---- Гелик (unit type 16) ---------------------------------------------------------------------
// After the Mercedes-AMG G 63 (W463, 2018+): 4873 × 1984 × 1966 mm with the spare wheel, wheelbase
// 2890, 22" wheels. About 0.4 model units per metre, with chibi big wheels and a slightly taller
// greenhouse (cabin ≈ lower body). Hand-built faces: the bottoms and the insides of add-ons are left
// out so the whole car, both plates included, stays under 900 triangles.

/** One flat triangle, wound so its normal points along `out`. */
export function tri(b: Builder, c: Col, p0: V3, p1: V3, p2: V3, out: V3) {
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  let q1 = p1, q2 = p2;
  if (nx * out[0] + ny * out[1] + nz * out[2] < 0) { q1 = p2; q2 = p1; nx = -nx; ny = -ny; nz = -nz; }
  for (const p of [p0, q1, q2]) { b.pos.push(p[0], p[1], p[2]); b.nor.push(nx, ny, nz); b.col.push(c.r, c.g, c.b); }
}
export function quad(b: Builder, c: Col, p0: V3, p1: V3, p2: V3, p3: V3, out: V3) {
  tri(b, c, p0, p1, p2, out);
  tri(b, c, p0, p2, p3, out);
}
/**
 * A convex side profile, points as (z, y), extruded across x0 < x1. `caps` keeps the x0 / x1 ends,
 * `skip` lists the profile edges (i → i+1) that stay open (hidden bottoms, joins).
 */
export function prismX(b: Builder, c: Col, prof: [number, number][], x0: number, x1: number, caps: [boolean, boolean] = [true, true], skip: number[] = []) {
  const n = prof.length;
  let cz = 0, cy = 0;
  for (const [z, y] of prof) { cz += z / n; cy += y / n; }
  const P = (x: number, i: number): V3 => [x, prof[i][1], prof[i][0]];
  for (let i = 1; i < n - 1; i++) {
    if (caps[0]) tri(b, c, P(x0, 0), P(x0, i), P(x0, i + 1), [-1, 0, 0]);
    if (caps[1]) tri(b, c, P(x1, 0), P(x1, i), P(x1, i + 1), [1, 0, 0]);
  }
  for (let i = 0; i < n; i++) {
    if (skip.includes(i)) continue;
    const j = (i + 1) % n, [za, ya] = prof[i], [zb, yb] = prof[j];
    let oz = yb - ya, oy = za - zb;
    if (oz * ((za + zb) / 2 - cz) + oy * ((ya + yb) / 2 - cy) < 0) { oz = -oz; oy = -oy; }
    quad(b, c, P(x0, i), P(x1, i), P(x1, j), P(x0, j), [0, oy, oz]);
  }
}
/** A flat n-gon on an axis face (n triangles), `lift` off the surface. */
export function disc(b: Builder, c: Col, centre: V3, face: Face, r: number, n = 8, lift = 0.002, rot = Math.PI / n) {
  const F = FACES[face];
  const o: V3 = [centre[0] + F.n[0] * lift, centre[1] + F.n[1] * lift, centre[2] + F.n[2] * lift];
  const at = (a: number): V3 => [0, 1, 2].map(k => o[k] + (F.u[k] * Math.cos(a) + F.v[k] * Math.sin(a)) * r) as V3;
  for (let k = 0; k < n; k++) tri(b, c, o, at(rot + (k / n) * Math.PI * 2), at(rot + ((k + 1) / n) * Math.PI * 2), F.n);
}
/** A flat quad (2 triangles) lying on an axis-aligned face, `lift` in front of `centre`. */
function flat(b: Builder, c: Col, centre: V3, face: Face, w: number, h: number, lift = 0.002) {
  const F = FACES[face];
  b.add(PLANE, c, [centre[0] + F.n[0] * lift, centre[1] + F.n[1] * lift, centre[2] + F.n[2] * lift], F.r, [w, h, 1]);
}
/** Frame on a vertical surface turned `ry` about y (ry = 0 faces +z): u along the surface, n out of it. */
function yawFrame(ry: number) {
  return { u: [Math.cos(ry), 0, -Math.sin(ry)] as V3, n: [Math.sin(ry), 0, Math.cos(ry)] as V3 };
}
/** A flat w × h rectangle on a vertical surface facing `ry` (2 tris), `lift` off it. */
export function panelAt(b: Builder, c: Col, centre: V3, ry: number, w: number, h: number, lift = 0.003) {
  const { u, n } = yawFrame(ry);
  const P = (du: number, dv: number): V3 => [centre[0] + u[0] * du + n[0] * lift, centre[1] + dv, centre[2] + u[2] * du + n[2] * lift];
  quad(b, c, P(-w / 2, -h / 2), P(w / 2, -h / 2), P(w / 2, h / 2), P(-w / 2, h / 2), n);
}
/** A pointed-arch opening (window, door, niche) facing `ry`: a rectangle under a gable (3 tris). */
export function archAt(b: Builder, c: Col, centre: V3, ry: number, w: number, h: number, lift = 0.003) {
  const { u, n } = yawFrame(ry);
  const P = (du: number, dv: number): V3 => [centre[0] + u[0] * du + n[0] * lift, centre[1] + dv, centre[2] + u[2] * du + n[2] * lift];
  const s = h / 2 - w * 0.55;
  quad(b, c, P(-w / 2, -h / 2), P(w / 2, -h / 2), P(w / 2, s), P(-w / 2, s), n);
  tri(b, c, P(-w / 2, s), P(w / 2, s), P(0, h / 2), n);
}
/** Open 8-sided tube (16 triangles): tyres, with the caps drawn as discs where they show. */
const TYRE = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, true);

/** The plate typeface: rounded ГОСТ glyphs as chamfered strokes (anything missing falls back to STROKES). */
const PLATE_FONT: Record<string, number[]> = {
  '0': [0.3, 0, 0.7, 0, 0.7, 0, 1, 0.2, 1, 0.2, 1, 0.8, 1, 0.8, 0.7, 1, 0.7, 1, 0.3, 1, 0.3, 1, 0, 0.8, 0, 0.8, 0, 0.2, 0, 0.2, 0.3, 0],
  '9': [1, 0.52, 0.22, 0.52, 0.22, 0.52, 0, 0.68, 0, 0.68, 0, 0.84, 0, 0.84, 0.22, 1, 0.22, 1, 0.78, 1, 0.78, 1, 1, 0.84, 1, 0.84, 1, 0.18, 1, 0.18, 0.75, 0, 0.75, 0, 0.08, 0],
  '5': [1, 1, 0.02, 1, 0.02, 1, 0, 0.56, 0, 0.56, 0.75, 0.56, 0.75, 0.56, 1, 0.4, 1, 0.4, 1, 0.16, 1, 0.16, 0.75, 0, 0.75, 0, 0, 0],
  'Р': [0, 0, 0, 1, 0, 1, 0.75, 1, 0.75, 1, 1, 0.84, 1, 0.84, 1, 0.62, 1, 0.62, 0.75, 0.46, 0.75, 0.46, 0, 0.46],
  'R': [0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0.5, 1, 0.5, 0, 0.5, 0.4, 0.5, 1, 0],
};

/**
 * Russian type-1 plate (ГОСТ Р 50577-2018, 520 × 112 mm): black frame, white field, «К 095 РА» with the
 * letters a size smaller than the digits on one baseline, a rule, then the region box: «95», «RUS» and the
 * tricolour. `W` is the plate width in model units (the real proportions are kept). About 140 triangles.
 */
function plate(b: Builder, c: V3, face: '+z' | '-z', W = 0.42, series: [string, string, string] = ['К', '095', 'РА'], region = '95') {
  const H = (W * 112) / 520;
  const dir = face === '+z' ? 1 : -1; // reading direction along x
  const at = (u: number, v: number): V3 => [c[0] + dir * (u - 0.5) * W, c[1] + (v - 0.5) * H, c[2]];
  const ink = K.ink, txt = { font: PLATE_FONT, lift: 0.0045 };
  flat(b, ink, c, face, W, H, 0.001);
  flat(b, K.plate, c, face, W - H * 0.09, H * 0.87, 0.0025);
  flat(b, ink, at(0.745, 0.5), face, H * 0.035, H * 0.87, 0.0035);
  for (const u of [0.04, 0.96]) flat(b, K.chromeD, at(u, 0.5), face, H * 0.06, H * 0.06, 0.0035); // screws
  const base = 0.19, LH = 0.47, DH = 0.6; // baseline, letter and digit heights (of H)
  const letters = (s: string, u: number) =>
    strokeText(b, ink, s, at(u, base + LH / 2), face, LH * H, { ...txt, w: LH * H * 0.8, gap: H * 0.07, th: H * 0.075 });
  letters(series[0], 0.13);
  strokeText(b, ink, series[1], at(0.365, base + DH / 2), face, DH * H, { ...txt, w: DH * H * 0.62, gap: H * 0.07, th: H * 0.085 });
  letters(series[2], 0.615);
  strokeText(b, ink, region, at(0.86, 0.66), face, 0.42 * H, { ...txt, w: 0.42 * H * 0.66, gap: H * 0.06, th: H * 0.068 });
  strokeText(b, ink, 'RUS', at(0.815, 0.25), face, 0.16 * H, { ...txt, w: 0.16 * H * 0.7, gap: H * 0.03, th: H * 0.03 });
  [K.flagW, K.flagB, K.flagR].forEach((fc, i) => flat(b, fc, at(0.915, 0.31 - i * 0.065), face, W * 0.07, H * 0.065, 0.0045));
}

function gelik(b: Builder, team: Col) {
  const P = K.paint, P2 = K.paint2;
  const BW = 0.4, CW = 0.37;            // half widths: lower body, greenhouse
  const ZF = 0.87, ZR = -0.84;          // front fascia, rear door
  const SILL = 0.2, BELT = 0.54, ROOF = 0.9, NOSE = 0.5;
  const WS0 = 0.355, WS1 = 0.25;        // windscreen base / top (z): the only raked face
  const AXF = 0.6, AXR = -0.55, WR = 0.2; // axles, wheel radius (22" at chibi scale)
  const sides = [-1, 1] as const;
  const sideFace = (s: number): Face => (s > 0 ? '+x' : '-x');
  // ---- кузов-кирпич: lower tub (bonnet drops a little to the lamps), greenhouse, roof cap with drip rails
  prismX(b, P, [[ZR, SILL], [ZR, BELT], [WS0, BELT], [ZF, NOSE], [ZF, SILL]], -BW, BW, [true, true], [4]);
  prismX(b, P, [[ZR + 0.004, BELT - 0.01], [ZR + 0.004, ROOF], [WS1, ROOF], [WS0, BELT - 0.01]], -CW, CW, [true, true], [1, 3]);
  prismX(b, K.roof, [[ZR - 0.01, ROOF], [ZR - 0.01, ROOF + 0.03], [WS1 + 0.008, ROOF + 0.03], [WS1 + 0.018, ROOF]], -CW - 0.014, CW + 0.014, [true, true], [3]);
  // drip rails catching the light along the roof edges: they outline the box from the game camera
  const RL = ROOF + 0.031, rz = (ZR - 0.01 + WS1 + 0.01) / 2, rlen = WS1 - ZR + 0.01;
  for (const s of sides) flat(b, K.rail, [s * (CW + 0.002), RL, rz], '+y', 0.022, rlen, 0.001);
  // bonnet panel between the wings
  prismX(b, P2,[[WS0 + 0.012, BELT - 0.002], [ZF - 0.006, NOSE - 0.002], [ZF - 0.006, NOSE + 0.01], [WS0 + 0.012, BELT + 0.01]], -0.27, 0.27, [true, true], [0]);
  // ---- glass: raked windscreen, three side windows (B and C pillars in paint), rear window over the spare
  const ws = (t: number): [number, number] => [WS0 + (WS1 - WS0) * t, BELT + (ROOF - BELT) * t];
  const wl = Math.hypot(ROOF - BELT, WS0 - WS1), wn: V3 = [0, (WS0 - WS1) / wl, (ROOF - BELT) / wl];
  const off = (p: V3): V3 => [p[0] + wn[0] * 0.003, p[1] + wn[1] * 0.003, p[2] + wn[2] * 0.003];
  const [za, ya] = ws(0.07), [zb, yb] = ws(0.93);
  quad(b, K.glassF, off([-0.33, ya, za]), off([0.33, ya, za]), off([0.33, yb, zb]), off([-0.33, yb, zb]), wn);
  const y0 = BELT + 0.045, y1 = ROOF - 0.035;
  const aAt = (y: number) => WS0 + ((WS1 - WS0) * (y - BELT)) / (ROOF - BELT) - 0.035; // window edge along the A-pillar
  for (const s of sides) {
    const x = s * (CW + 0.002), o: V3 = [s, 0, 0];
    quad(b, K.glass, [x, y0, -0.02], [x, y0, aAt(y0)], [x, y1, aAt(y1)], [x, y1, -0.02], o);
    quad(b, K.glass, [x, y0, -0.43], [x, y0, -0.07], [x, y1, -0.07], [x, y1, -0.43], o);
    quad(b, K.glass, [x, y0, ZR + 0.05], [x, y0, -0.48], [x, y1, -0.48], [x, y1, ZR + 0.05], o);
  }
  flat(b, K.glass, [0, 0.745, ZR], '-z', 0.6, 0.25, 0.002);
  // ---- wheel arches: G 63 flares in satin black, as an arch band over each wheel
  for (const zc of [AXF, AXR]) for (const s of sides) {
    const xa = s > 0 ? BW - 0.01 : -BW - 0.055, xb = s > 0 ? BW + 0.055 : -BW + 0.01;
    const caps: [boolean, boolean] = s > 0 ? [false, true] : [true, false];
    const O = [[zc - 0.29, 0.17], [zc - 0.2, 0.465], [zc + 0.2, 0.465], [zc + 0.29, 0.17]] as [number, number][];
    const I = [[zc - 0.235, 0.17], [zc - 0.165, 0.415], [zc + 0.165, 0.415], [zc + 0.235, 0.17]] as [number, number][];
    for (let k = 0; k < 3; k++) prismX(b, P2, [O[k], O[k + 1], I[k + 1], I[k]], xa, xb, caps, [1, 2, 3]);
  }
  // ---- wheels: black tyres, dark rims, a small hub
  for (const z of [AXF, AXR]) for (const s of sides) {
    b.add(TYRE, K.tyre, [0.36 * s, WR, z], [0, 0, HALF_PI], [WR * 2, 0.14, WR * 2]);
    const c: V3 = [0.43 * s, WR, z];
    disc(b, K.tyre, c, sideFace(s), WR, 8, 0, 0);
    disc(b, K.rim, c, sideFace(s), WR * 0.68, 8, 0.004, 0);
    disc(b, K.chromeD, c, sideFace(s), WR * 0.2, 5, 0.007);
  }
  // ---- морда: round lamps with LED rings, Panamericana grille (vertical slats, plain round badge),
  // indicator pods on the ends of the wings, bumper with intakes, skid plate and the plate
  for (const s of sides) {
    const L: V3 = [0.29 * s, 0.415, ZF];
    disc(b, K.chrome, L, '+z', 0.09, 8, 0.002);
    disc(b, K.lamp, L, '+z', 0.074, 8, 0.004);
    disc(b, K.lens, L, '+z', 0.04, 6, 0.006);
    b.box(P, [0.335 * s, 0.522, 0.8], [0.07, 0.04, 0.12]);
    flat(b, K.amber, [0.335 * s, 0.522, 0.86], '+z', 0.06, 0.03);
  }
  flat(b, K.grille, [0, 0.425, ZF], '+z', 0.37, 0.16);
  for (let i = 0; i < 7; i++) flat(b, K.chrome, [-0.15 + i * 0.05, 0.425, ZF], '+z', 0.012, 0.14, 0.004);
  disc(b, K.chrome, [0, 0.425, ZF], '+z', 0.04, 8, 0.006);
  prismX(b, K.trim, [[ZF - 0.005, 0.13], [ZF - 0.005, 0.34], [0.95, 0.34], [0.965, 0.31], [0.965, 0.13]], -0.42, 0.42, [true, true], [0, 4]);
  flat(b, K.chromeD, [0, 0.15, 0.965], '+z', 0.56, 0.03);
  for (const s of sides) flat(b, K.mesh, [0.31 * s, 0.245, 0.965], '+z', 0.14, 0.1);
  plate(b, [0, 0.245, 0.965], '+z');
  // ---- корма: spare on the side-hinged door (cover in the village colour), lamps, bumper with the plate
  const sp: V3 = [0.05, 0.53, ZR - 0.065];
  b.add(TYRE, K.tyre, sp, [HALF_PI, 0, 0], [0.4, 0.12, 0.4]);
  disc(b, K.tyre, [sp[0], sp[1], ZR - 0.125], '-z', 0.2, 8, 0, 0);
  disc(b, team, [sp[0], sp[1], ZR - 0.125], '-z', 0.17, 8, 0.002, 0);
  disc(b, lift(team, 0.72), [sp[0], sp[1], ZR - 0.125], '-z', 0.105, 8, 0.004, 0);
  disc(b, K.chrome, [sp[0], sp[1], ZR - 0.125], '-z', 0.035, 6, 0.006);
  for (const s of sides) flat(b, K.tail, [0.345 * s, 0.39, ZR], '-z', 0.075, 0.12);
  flat(b, K.chrome, [-0.2, 0.455, ZR], '-z', 0.07, 0.016);
  prismX(b, K.trim, [[ZR, 0.13], [ZR, 0.31], [ZR - 0.06, 0.31], [ZR - 0.07, 0.29], [ZR - 0.07, 0.13]], -0.42, 0.42, [true, true], [0, 4]);
  plate(b, [0, 0.22, ZR - 0.07], '-z');
  // ---- бока: village-colour line, door shut lines, push-button handles, exposed hinges, running boards,
  // side exhausts ahead of the rear wheels, mirrors
  for (const s of sides) {
    const f = sideFace(s), x = BW * s;
    flat(b, team, [x, 0.49, -0.01], f, 1.64, 0.034);
    for (const z of [0.335, -0.035, -0.445]) flat(b, K.seam, [x, (SILL + BELT) / 2, z], f, 0.008, BELT - SILL - 0.01);
    for (const z of [0.0, -0.41]) flat(b, K.chrome, [x, 0.455, z], f, 0.06, 0.014, 0.003);
    for (const y of [0.29, 0.44]) flat(b, K.chromeD, [x, y, 0.318], f, 0.022, 0.04, 0.003);
    const xa = s > 0 ? BW - 0.02 : -BW - 0.07, xb = s > 0 ? BW + 0.07 : -BW + 0.02;
    prismX(b, K.chromeD, [[-0.25, 0.165], [-0.25, 0.19], [0.3, 0.19], [0.3, 0.165]], xa, xb, s > 0 ? [false, true] : [true, false], [0, 2, 3]);
    for (const z of [-0.175, -0.12]) {
      disc(b, K.chrome, [s * (BW + 0.05), 0.125, z], f, 0.024, 6, 0);
      disc(b, K.ink, [s * (BW + 0.05), 0.125, z], f, 0.014, 4, 0.002);
    }
    b.box(P, [0.425 * s, 0.615, 0.29], [0.06, 0.065, 0.1]);
  }
  // ---- антенна с флажком в цвет села
  b.box(K.ink, [-0.3, 1.02, -0.74], [0.01, 0.2, 0.01]);
  for (const f of ['+x', '-x'] as const) flat(b, team, [-0.3, 1.08, -0.81], f, 0.13, 0.08, 0.001);
}

// ---- Спортик (unit type 17) ---------------------------------------------------------------------
type Pose = 'walk' | 'squat' | 'lean' | 'phone' | 'arms';
const SUITS = [col('#1f2125'), col('#262a36'), col('#3a3d44')];

/** One guy of the squad: tracksuit with two stripes in the village colour, white sneakers, buzz cut. */
function sportik(b: Builder, team: Col, pose: Pose = 'walk', v = 0, lite = false) {
  const suit = SUITS[v % SUITS.length], stripe = lift(team, 1.2);
  const poses: Record<Pose, Partial<BodyOpts>> = {
    walk: { armL: { up: [0.25, 0, -0.14] }, armR: { up: [-0.22, 0, 0.14] }, legL: { up: [-0.22, 0, 0.04] }, legR: { up: [0.2, 0, -0.04] } },
    squat: {
      legL: { up: [-1.62, 0, -0.32], lo: [0.12, 0, -0.12] }, legR: { up: [-1.62, 0, 0.32], lo: [0.12, 0, 0.12] },
      armL: { up: [-1.05, 0, -0.18], lo: [-0.15, 0, 0.1] }, armR: { up: [-1.05, 0, 0.18], lo: [-0.15, 0, -0.1] },
    },
    lean: {
      legL: { up: [-0.28, 0, -0.06] }, legR: { up: [-0.22, 0, 0.16] },
      armL: { up: [-0.35, 0, 0.12], lo: [-1.57, 0, -1.15] }, armR: { up: [-0.35, 0, -0.12], lo: [-1.57, 0, 1.15] },
    },
    phone: {
      legL: { up: [0, 0, 0.05] }, legR: { up: [0, 0, -0.05] },
      armL: { up: [0.05, 0, -0.08] }, armR: { up: [-0.45, 0, 0.12], lo: [-2.0, 0, 0.55] },
    },
    arms: {
      legL: { up: [0, 0, 0.1] }, legR: { up: [0, 0, -0.1] },
      armL: { up: [-0.3, 0, 0.1], lo: [-1.57, 0, -1.15] }, armR: { up: [-0.3, 0, -0.1], lo: [-1.57, 0, 1.15] },
    },
  };
  const f = body(b, {
    top: suit, pants: suit, shoe: K.sneaker, sole: lite ? undefined : K.sole, stripe, stripes: lite ? 1 : 2, w: 1.1, lw: 1.02, chunky: true,
    beard: v % 2 ? 'none' : 'stubble', ...poses[pose],
  });
  buzz(b, f);
  // ворот олимпийки и бегунок
  if (!lite) b.box(suit, [0, f.topY + 0.005, -0.01], [0.24, 0.045, 0.2]);
  if (!lite) b.box(K.steel, [0, f.topY - 0.03, 0.118], [0.022, 0.03, 0.008]);
  // барсетка через плечо
  b.box(K.ink, [0, (f.shY + f.hipY) / 2 + 0.03, 0.118], [0.03, 0.4, 0.012], [0, 0, -0.75]);
  b.box(K.ink, [-0.13, f.hipY + 0.06, 0.12], [0.15, 0.11, 0.06]);
  b.box(col('#c8a24a'), [-0.13, f.hipY + 0.08, 0.152], [0.04, 0.014, 0.006]);
  if (v % 3 === 1) {
    // кепка
    const cap = col('#141518');
    b.box(cap, [0, f.headY + 0.155, -0.01], [0.29, 0.06, 0.27]);
    b.box(cap, [0, f.headY + 0.132, 0.16], [0.25, 0.022, 0.1]);
    b.box(stripe, [0, f.headY + 0.155, 0.126], [0.06, 0.03, 0.006]);
  }
  if (pose === 'phone') {
    const h = f.handR;
    b.box(K.ink, [h[0] + 0.01, h[1] + 0.06, h[2] + 0.015], [0.085, 0.13, 0.016], [0.75, 0, 0]);
    seg(b, glow(0.55, 1.25, 2.3), [h[0] + 0.01, h[1] + 0.06, h[2] + 0.015], [0.75, 0, 0], [0, 0, -0.01], [0.07, 0.11, 0.004]);
  }
  if (pose === 'squat') {
    // семечки в ладони
    const h = f.handL;
    b.box(col('#3a3532'), [h[0], h[1] + 0.035, h[2] + 0.01], [0.05, 0.012, 0.05]);
  }
  return f;
}

// ---- public: unit types 16 and 17 ---------------------------------------------------------------
export const GELIK = 16;
export const SPORTIK = 17;
export const PROP_TYPES = [GELIK, SPORTIK] as const;

/** Merged vertex-coloured geometry for unit types 16 (Гелик) and 17 (Спортик), grounded, facing +z. */
export function propUnitGeometry(type: number, side: 0 | 1): THREE.BufferGeometry {
  const b = new Builder();
  const team = PAL.side[side];
  if (type === GELIK) gelik(b, team);
  else if (type === SPORTIK) sportik(b, team, 'walk', side);
  else b.box(team, [0, 0.5, 0], [0.4, 1, 0.3]);
  return grounded(b.build());
}

/** Extra scale on top of the renderer's ×1.7 unit scale (same convention as heroScale). */
export function propUnitScale(type: number, _side: 0 | 1): number {
  return type === GELIK ? 1.0 : 1.0;
}

const propHeights = new Map<number, number>();
/** Model-space top of the unit (before propUnitScale and ×1.7): for health bars. */
export function propUnitHeight(type: number, side: 0 | 1): number {
  const k = type * 2 + side;
  let h = propHeights.get(k);
  if (h === undefined) {
    const g = propUnitGeometry(type, side);
    h = g.boundingBox!.max.y;
    g.dispose();
    propHeights.set(k, h);
  }
  return h;
}

/** Vehicles: no leaning/rolling walk cycle (treat like the Camry / taxi). */
export const isPropVehicle = (type: number) => type === GELIK;

const SOLID = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
function solid(g: THREE.BufferGeometry) {
  const m = new THREE.Mesh(g, SOLID);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

let gelikGeo: [THREE.BufferGeometry | null, THREE.BufferGeometry | null] = [null, null];
function gelikShared(side: 0 | 1) {
  return gelikGeo[side] ??= propUnitGeometry(GELIK, side);
}

/**
 * Parked Гелик for decor: the unit model at ×1.0 (building scale; length 1.94 with the spare, width 0.94 over the
 * running boards, height 1.12 to the antenna). Multiply by 1.7 to match the unit. The geometry is shared per side: don't dispose it.
 */
export function gelikProp(side: 0 | 1 = 1): THREE.Group {
  const g = new THREE.Group();
  g.add(solid(gelikShared(side)));
  g.userData.kind = 'gelik';
  return g;
}

/**
 * Idle «спортики»: a parked Гелик (side-on, nose to +x) and `n` guys in front of it —
 * leaning on the car, squatting, looking at the phone. One merged mesh, about 2.6 × 1.8 for n ≤ 5.
 */
export function sportikiCrowd(n: number, side: 0 | 1): THREE.Group {
  const b = new Builder();
  const team = PAL.side[side];
  mergeInto(b, gelikShared(side), place([0, 0, 0], [0, HALF_PI, 0]));
  const spots: { pose: Pose; p: V3; ry: number; rx?: number }[] = [
    { pose: 'lean', p: [-0.35, 0, 0.56], ry: 0.1, rx: -0.12 },
    { pose: 'squat', p: [0.25, 0, 0.98], ry: -0.35 },
    { pose: 'phone', p: [0.75, 0, 0.62], ry: -0.5 },
    { pose: 'squat', p: [-0.65, 0, 1.12], ry: 0.55 },
    { pose: 'arms', p: [1.25, 0, 0.9], ry: -0.9 },
    { pose: 'lean', p: [-1.05, 0, 0.55], ry: 0.25, rx: -0.12 },
    { pose: 'phone', p: [0.0, 0, 1.55], ry: 0.2 },
  ];
  for (let i = 0; i < n; i++) {
    const s = spots[i % spots.length];
    const off = Math.floor(i / spots.length) * 0.5;
    const pb = new Builder();
    sportik(pb, team, s.pose, i + side, true);
    const g = grounded(pb.build());
    mergeInto(b, g, place([s.p[0] + off, 0, s.p[2] + off], [s.rx ?? 0, s.ry, 0]));
    g.dispose();
  }
  const grp = new THREE.Group();
  grp.add(solid(grounded(b.build())));
  grp.userData.kind = 'sportiki';
  return grp;
}

// ---- canvas helpers --------------------------------------------------------------------------
const DISPLAY = 'Unbounded, "Arial Black", sans-serif';
const TEXT = '"Golos Text", Arial, sans-serif';
const SIGN_FONTS = ['900 60px Unbounded', '800 40px Unbounded', '700 26px "Golos Text"', '600 26px "Golos Text"'];

function whenFonts(fonts: string[], cb: () => void) {
  const fs = typeof document !== 'undefined' ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
  if (fs && fonts.length) Promise.all(fonts.map(f => fs.load(f))).then(cb, () => { /* system font it is */ });
}

/** Canvas texture that repaints itself once the web fonts it uses have loaded. */
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, fonts = SIGN_FONTS) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const paint = () => { g.clearRect(0, 0, w, h); draw(g, w, h); tex.needsUpdate = true; };
  paint();
  whenFonts(fonts, paint);
  return { tex, paint, canvas: c };
}

/** Largest font size (px) at which `text` fits in `maxW`. */
function fitFont(g: CanvasRenderingContext2D, text: string, weight: string, family: string, start: number, maxW: number) {
  let px = start;
  for (; px > 8; px -= 2) {
    g.font = `${weight} ${px}px ${family}`;
    if (g.measureText(text).width <= maxW) break;
  }
  return px;
}

function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---- the admin's ultimate: a parody cigarette pack -------------------------------------------------
export interface CigPackOpts {
  /** 18+ layer: «КУРЕНИЕ УБИВАЕТ … LESS SMELL»; clean: «ПРОГУЛ УБИВАЕТ … LESS ПРОГУЛОВ» */
  spicy: boolean;
  /** Head-and-shoulders picture of the admin (e.g. a transparent render of his 3D model). Null: a drawn caricature. */
  portrait?: CanvasImageSource | null;
  /** Called after the canvas repaints itself because the web fonts arrived (set texture.needsUpdate there). */
  onRepaint?: () => void;
}
export const PACK_TEX_W = 640;
export const PACK_TEX_H = 1024;
/** Fraction of the face height taken by the photo (top) part. */
const PHOTO = 0.53;

function panelBlock(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fh: number, cols: number) {
  g.fillStyle = '#eef2f5'; g.fillRect(x, y, w, h);
  const cw = w / cols;
  for (let r = 0; r * fh < h; r++) {
    const yy = y + r * fh;
    for (let c = 0; c < cols; c++) {
      const xx = x + c * cw;
      g.fillStyle = c % 2 ? '#3a73c9' : '#2a5bb0';
      g.fillRect(xx + cw * 0.04, yy + fh * 0.12, cw * 0.26, fh * 0.76);
      g.fillStyle = (r * 7 + c * 3) % 9 === 0 ? '#e9d79a' : '#2c3d50';
      g.fillRect(xx + cw * 0.4, yy + fh * 0.2, cw * 0.5, fh * 0.6);
      g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(xx + cw * 0.4, yy + fh * 0.2, cw * 0.5, fh * 0.1);
    }
    g.fillStyle = '#c3ccd6'; g.fillRect(x, yy + fh - 2, w, 2);
  }
  g.fillStyle = 'rgba(25, 45, 80, 0.22)'; g.fillRect(x, y, w * 0.07, h);
}

/** Flat caricature of the admin: messy dark-brown hair with a long fringe, brown eyes, cream tee, black backpack strap. */
function adminCaricature(g: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const skin = '#f3d6c1', skinS = '#e2b79c', hair = '#3a2a1f', hairH = '#5d4331', tee = '#eee5d1', teeS = '#d8ccb3';
  // плечи в кремовой футболке
  g.fillStyle = tee;
  g.beginPath();
  g.moveTo(cx - s * 1.35, cy + s * 1.9);
  g.quadraticCurveTo(cx - s * 1.25, cy + s * 0.78, cx - s * 0.36, cy + s * 0.64);
  g.lineTo(cx + s * 0.36, cy + s * 0.64);
  g.quadraticCurveTo(cx + s * 1.25, cy + s * 0.78, cx + s * 1.35, cy + s * 1.9);
  g.closePath(); g.fill();
  g.fillStyle = teeS;
  g.beginPath(); g.moveTo(cx - s * 0.75, cy + s * 1.1); g.quadraticCurveTo(cx - s * 0.6, cy + s * 1.5, cx - s * 0.7, cy + s * 1.9); g.lineTo(cx - s * 0.8, cy + s * 1.9); g.closePath(); g.fill();
  // шея и ворот
  g.fillStyle = skinS; g.fillRect(cx - s * 0.19, cy + s * 0.32, s * 0.38, s * 0.36);
  g.fillStyle = skin; g.beginPath(); g.ellipse(cx, cy + s * 0.64, s * 0.25, s * 0.1, 0, 0, Math.PI); g.fill();
  g.strokeStyle = teeS; g.lineWidth = s * 0.05; g.beginPath(); g.ellipse(cx, cy + s * 0.64, s * 0.27, s * 0.12, 0, 0, Math.PI); g.stroke();
  // лямка чёрного рюкзака на его левом плече
  g.fillStyle = '#141414';
  g.beginPath(); g.moveTo(cx + s * 0.5, cy + s * 0.7); g.lineTo(cx + s * 0.82, cy + s * 0.74); g.lineTo(cx + s * 0.74, cy + s * 1.9); g.lineTo(cx + s * 0.44, cy + s * 1.9); g.closePath(); g.fill();
  g.fillStyle = '#3c3c3c'; g.fillRect(cx + s * 0.5, cy + s * 1.28, s * 0.27, s * 0.09);
  // уши, лицо
  g.fillStyle = skinS;
  for (const d of [-1, 1]) { g.beginPath(); g.ellipse(cx + d * s * 0.43, cy + s * 0.04, s * 0.08, s * 0.13, 0, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = skin; g.beginPath(); g.ellipse(cx, cy, s * 0.42, s * 0.52, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(214, 160, 130, 0.35)';
  g.beginPath(); g.ellipse(cx, cy + s * 0.36, s * 0.3, s * 0.12, 0, 0, Math.PI * 2); g.fill();
  // карие глаза
  for (const d of [-1, 1]) {
    const ex = cx + d * s * 0.17, ey = cy - s * 0.01;
    g.fillStyle = '#fbf8f2'; g.beginPath(); g.ellipse(ex, ey, s * 0.09, s * 0.05, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6b3f1f'; g.beginPath(); g.arc(ex + s * 0.012, ey + s * 0.004, s * 0.043, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a0f08'; g.beginPath(); g.arc(ex + s * 0.012, ey + s * 0.004, s * 0.02, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(ex + s * 0.028, ey - s * 0.013, s * 0.011, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2b1d15'; g.lineWidth = s * 0.02;
    g.beginPath(); g.ellipse(ex, ey, s * 0.09, s * 0.05, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
  }
  // нос, рот
  g.strokeStyle = skinS; g.lineWidth = s * 0.028; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx + s * 0.01, cy + s * 0.04); g.lineTo(cx - s * 0.045, cy + s * 0.18); g.lineTo(cx + s * 0.03, cy + s * 0.2); g.stroke();
  g.strokeStyle = '#b4766a'; g.lineWidth = s * 0.024;
  g.beginPath(); g.moveTo(cx - s * 0.11, cy + s * 0.31); g.quadraticCurveTo(cx, cy + s * 0.33, cx + s * 0.12, cy + s * 0.295); g.stroke();
  // лохматые тёмно-каштановые волосы, длинная чёлка до бровей
  g.fillStyle = hair;
  g.beginPath();
  g.moveTo(cx - s * 0.47, cy + s * 0.16);
  g.quadraticCurveTo(cx - s * 0.6, cy - s * 0.5, cx - s * 0.25, cy - s * 0.7);
  g.lineTo(cx - s * 0.18, cy - s * 0.8); g.lineTo(cx - s * 0.05, cy - s * 0.72);
  g.lineTo(cx + s * 0.08, cy - s * 0.82); g.lineTo(cx + s * 0.18, cy - s * 0.72);
  g.quadraticCurveTo(cx + s * 0.55, cy - s * 0.66, cx + s * 0.5, cy - s * 0.2);
  g.lineTo(cx + s * 0.47, cy + s * 0.16); g.lineTo(cx + s * 0.4, cy - s * 0.02);
  const fringe = [[0.36, -0.09], [0.3, -0.19], [0.24, -0.08], [0.15, -0.2], [0.08, -0.07], [-0.01, -0.21], [-0.08, -0.08], [-0.16, -0.2], [-0.24, -0.07], [-0.31, -0.18], [-0.39, -0.03]];
  for (const [px, py] of fringe) g.lineTo(cx + px * s, cy + py * s);
  g.closePath(); g.fill();
  g.strokeStyle = hairH; g.lineWidth = s * 0.022;
  for (const [x0, y0, x1, y1] of [[-0.3, -0.55, -0.1, -0.25], [-0.05, -0.62, 0.05, -0.28], [0.15, -0.58, 0.22, -0.3], [0.32, -0.45, 0.3, -0.22], [-0.42, -0.3, -0.32, -0.12]]) {
    g.beginPath(); g.moveTo(cx + x0 * s, cy + y0 * s); g.quadraticCurveTo(cx + ((x0 + x1) / 2) * s + s * 0.05, cy + ((y0 + y1) / 2) * s, cx + x1 * s, cy + y1 * s); g.stroke();
  }
}

/** Repaints a pack face (640×1024) in place. */
export function paintCigPack(c: HTMLCanvasElement, o: CigPackOpts) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height, P = Math.round(H * PHOTO);
  g.save();
  g.clearRect(0, 0, W, H);
  // ---- фото: автобус, окно, панельная высотка
  g.fillStyle = '#bdb7aa'; g.fillRect(0, 0, W, P);
  const wx = W * 0.07, wy = P * 0.03, ww = W * 1.0, wh = P * 0.82;
  g.save();
  rrect(g, wx, wy, ww, wh, 26); g.clip();
  const sky = g.createLinearGradient(0, wy, 0, wy + wh);
  sky.addColorStop(0, '#2b98ad'); sky.addColorStop(0.55, '#6cc3c8'); sky.addColorStop(1, '#a8dbd3');
  g.fillStyle = sky; g.fillRect(wx, wy, ww, wh);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  for (const [x, y, r] of [[0.25, 0.12, 40], [0.36, 0.1, 30], [0.18, 0.16, 26]]) { g.beginPath(); g.ellipse(W * x, P * y, r * 1.8, r * 0.6, 0, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#9fc2b4';
  g.beginPath(); g.moveTo(wx, P * 0.7); g.lineTo(W * 0.2, P * 0.6); g.lineTo(W * 0.38, P * 0.66); g.lineTo(W * 0.6, P * 0.58); g.lineTo(W, P * 0.68); g.lineTo(W, P); g.lineTo(wx, P); g.closePath(); g.fill();
  panelBlock(g, W * 0.06, P * 0.42, W * 0.22, P * 0.5, 16, 4);
  panelBlock(g, W * 0.6, P * 0.05, W * 0.46, P * 0.85, 27, 5);
  g.restore();
  // уплотнитель и стойка окна
  g.strokeStyle = '#1d2023'; g.lineWidth = 16; rrect(g, wx, wy, ww, wh, 26); g.stroke();
  g.fillStyle = '#8f8a80'; g.fillRect(0, 0, wx - 8, P);
  g.fillStyle = '#d9d4c9'; g.fillRect(wx + 8, P * 0.17, ww, 9);
  // спинка сиденья
  g.fillStyle = '#284676'; rrect(g, W * 0.1, P * 0.6, W * 0.66, P * 0.6, 40); g.fill();
  g.fillStyle = '#35598f';
  for (let y = P * 0.64; y < P; y += 22) for (let x = W * 0.13 + (Math.round(y / 22) % 2) * 11; x < W * 0.74; x += 22) g.fillRect(x, y, 7, 7);
  // админ
  if (o.portrait) {
    const img = o.portrait as CanvasImageSource & { width: number; height: number };
    const iw = Number(img.width) || 1, ih = Number(img.height) || 1;
    const k = Math.min((W * 0.78) / iw, (P * 0.8) / ih);
    const dw = iw * k, dh = ih * k;
    g.save(); g.beginPath(); g.rect(0, 0, W, P); g.clip();
    g.drawImage(img, W * 0.42 - dw / 2, P - dh, dw, dh);
    g.restore();
  } else adminCaricature(g, W * 0.42, P * 0.6, P * 0.29);
  // предупреждение
  const warn = o.spicy ? ['КУРЕНИЕ', 'УБИВАЕТ'] : ['ПРОГУЛ', 'УБИВАЕТ'];
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
  const px = Math.min(fitFont(g, warn[0], '900', DISPLAY, 108, W - 56), fitFont(g, warn[1], '900', DISPLAY, 108, W - 56));
  g.font = `900 ${px}px ${DISPLAY}`;
  warn.forEach((t, i) => {
    const y = P * 0.17 + i * px * 1.02;
    g.strokeStyle = '#000'; g.lineWidth = px * 0.17; g.strokeText(t, W / 2, y);
    g.fillStyle = '#fff'; g.fillText(t, W / 2, y);
  });
  // плашка «подробнее»
  g.fillStyle = '#0b0b0b'; g.fillRect(0, P - 58, W, 58);
  g.fillStyle = '#fff'; g.textBaseline = 'middle';
  const info = 'Подробнее о последствиях ☎ спроси админа';
  fitFont(g, info, '600', TEXT, 28, W - 36);
  g.fillText(info, W / 2, P - 28);
  // ---- низ: тёмно-синий с треугольниками, свуш, птица, бренд
  const bg = g.createLinearGradient(0, P, 0, H);
  bg.addColorStop(0, '#0e1c40'); bg.addColorStop(1, '#03060d');
  g.fillStyle = bg; g.fillRect(0, P, W, H - P);
  const cell = 48, blues = ['#1b4596', '#2861c4', '#123272', '#3b7be0', '#0f2a5e'];
  for (let r = 0; r * cell < H - P + cell; r++) for (let q = -1; q * cell < W + cell; q++) {
    const x = q * cell + (r % 2 ? cell / 2 : 0), y = H - r * cell;
    const fade = Math.max(0, 1 - r / 7) * Math.min(1, (x + 80) / (W * 0.9));
    if (fade <= 0.02) continue;
    const h = Math.abs(q * 31 + r * 17) % 5;
    g.globalAlpha = 0.18 + 0.62 * fade * (0.5 + 0.5 * (Math.abs(q + r) % 2));
    g.fillStyle = blues[h];
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + cell / 2, y - cell); g.lineTo(x + cell, y); g.closePath(); g.fill();
    g.globalAlpha *= 0.6;
    g.fillStyle = blues[(h + 2) % 5];
    g.beginPath(); g.moveTo(x + cell / 2, y - cell); g.lineTo(x + cell * 1.5, y - cell); g.lineTo(x + cell, y); g.closePath(); g.fill();
  }
  g.globalAlpha = 1;
  // серебристо-синий свуш
  for (const [w, a, dy] of [[14, 0.95, 0], [5, 0.8, 26], [3, 0.6, 44]] as const) {
    const sw = g.createLinearGradient(0, 0, W, 0);
    sw.addColorStop(0, `rgba(220, 232, 250, ${a})`); sw.addColorStop(0.6, `rgba(150, 185, 235, ${a})`); sw.addColorStop(1, `rgba(60, 110, 210, ${a * 0.5})`);
    g.strokeStyle = sw; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-20, P + 420 + dy); g.bezierCurveTo(W * 0.3, P + 330 + dy, W * 0.65, P + 430 + dy, W + 20, P + 300 + dy); g.stroke();
  }
  g.fillStyle = '#c9d4e4'; g.fillRect(0, P, W, 4);
  // птичка
  const bx = W / 2, by = P + 92;
  const metal = g.createLinearGradient(0, by - 40, 0, by + 30);
  metal.addColorStop(0, '#ffffff'); metal.addColorStop(1, '#9fb4d3');
  g.fillStyle = metal;
  g.beginPath();
  g.moveTo(bx, by + 6);
  g.quadraticCurveTo(bx - 30, by - 30, bx - 78, by - 30); g.quadraticCurveTo(bx - 42, by - 10, bx - 30, by + 10);
  g.quadraticCurveTo(bx - 16, by + 14, bx - 8, by + 30); g.lineTo(bx, by + 20); g.lineTo(bx + 8, by + 30);
  g.quadraticCurveTo(bx + 16, by + 14, bx + 30, by + 10); g.quadraticCurveTo(bx + 42, by - 10, bx + 78, by - 30);
  g.quadraticCurveTo(bx + 30, by - 30, bx, by + 6);
  g.closePath(); g.fill();
  g.beginPath(); g.arc(bx, by - 6, 8, 0, Math.PI * 2); g.fill();
  // бренд
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const bp = fitFont(g, 'ВЫСОТКА', '900', DISPLAY, 84, W - 90);
  g.font = `900 ${bp}px ${DISPLAY}`;
  const silver = g.createLinearGradient(0, P + 150, 0, P + 150 + bp);
  silver.addColorStop(0, '#ffffff'); silver.addColorStop(1, '#b9c7dc');
  g.fillStyle = silver; g.fillText('ВЫСОТКА', W / 2, P + 160 + bp * 0.75);
  // XS
  g.font = `900 128px ${DISPLAY}`;
  g.textAlign = 'right';
  g.lineWidth = 8; g.strokeStyle = '#e8f0ff'; g.strokeText('XS', W - 34, H - 52);
  const xs = g.createLinearGradient(0, H - 190, 0, H - 52);
  xs.addColorStop(0, '#4f8ff0'); xs.addColorStop(1, '#1b3f95');
  g.fillStyle = xs; g.fillText('XS', W - 34, H - 52);
  // слоганы
  g.textAlign = 'left'; g.textBaseline = 'middle';
  const lines = o.spicy ? ['MORE ЭТАЖЕЙ', 'LESS SMELL'] : ['MORE ЭТАЖЕЙ', 'LESS ПРОГУЛОВ'];
  lines.forEach((t, i) => {
    const y = H - 150 + i * 46;
    g.fillStyle = '#9fc0f2';
    for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(40 + k * 16, y, 4.5, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#f2f6ff';
    fitFont(g, t, '700', TEXT, 30, W * 0.44);
    g.fillText(t, 96, y + 1);
  });
  g.restore();
}

/** The parody pack face as a canvas (640×1024). Repaints itself when Unbounded / Golos Text load. */
export function cigPackTexture(opts: CigPackOpts): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = PACK_TEX_W; c.height = PACK_TEX_H;
  paintCigPack(c, opts);
  whenFonts(['900 100px Unbounded', '700 30px "Golos Text"', '600 28px "Golos Text"'], () => { paintCigPack(c, opts); opts.onRepaint?.(); });
  return c;
}

export interface CigPack {
  group: THREE.Group;
  setPortrait(img: CanvasImageSource | null): void;
  setSpicy(on: boolean): void;
  /** world height of the pack as built (3.5) */
  height: number;
}

/** Remaps the v coordinates of a BoxGeometry's four side faces (+x, -x, +z, -z) into [v0, v1]. */
function remapV(geo: THREE.BoxGeometry, v0: number, v1: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const seen = new Set<number>();
  for (const gi of [0, 1, 4, 5]) {
    const gr = geo.groups[gi];
    for (let i = gr.start; i < gr.start + gr.count; i++) {
      const vi = geo.index ? geo.index.getX(i) : i;
      if (seen.has(vi)) continue;
      seen.add(vi);
      uv.setY(vi, v0 + uv.getY(vi) * (v1 - v0));
    }
  }
  uv.needsUpdate = true;
}

/**
 * The admin's ultimate as a 3D pack: «ВЫСОТКА XS» flip-top box with the parody face front and back,
 * lid ajar over a foil collar (filters show only with the 18+ layer), cellophane with a gold tear strip.
 * 2.2 wide × 3.5 tall × 0.86 deep, bottom at y = 0, face to +z.
 */
export function cigPack(opts: { spicy: boolean; portrait?: CanvasImageSource | null }): CigPack {
  const W = 2.2, H = 3.5, D = 0.86, cut = 0.78, Hb = H * cut, Hl = H - Hb;
  const st: CigPackOpts = { spicy: opts.spicy, portrait: opts.portrait ?? null };
  const face = cigPackTexture(st);
  const tex = new THREE.CanvasTexture(face);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  st.onRepaint = () => { tex.needsUpdate = true; };
  const side = canvasTex(256, 1024, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#132656'); bg.addColorStop(1, '#050a16');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#a9c2ea'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(w * 0.15, h); g.bezierCurveTo(w * 0.1, h * 0.6, w * 0.9, h * 0.5, w * 0.8, 0); g.stroke();
    g.save(); g.translate(w / 2, h * 0.55); g.rotate(-Math.PI / 2);
    g.fillStyle = '#eef3ff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitFont(g, 'ВЫСОТКА XS', '900', DISPLAY, 96, h * 0.7);
    g.fillText('ВЫСОТКА XS', 0, 0);
    g.restore();
    g.fillStyle = '#9fc0f2'; g.textAlign = 'center';
    g.font = `700 30px ${TEXT}`;
    g.fillText('20 ЭТАЖЕЙ', w / 2, h - 60);
  }, ['900 96px Unbounded', '700 30px "Golos Text"']);
  const faceMat = new THREE.MeshLambertMaterial({ map: tex, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.28 });
  const sideMat = new THREE.MeshLambertMaterial({ map: side.tex, emissive: new THREE.Color('#ffffff'), emissiveMap: side.tex, emissiveIntensity: 0.15 });
  const capMat = new THREE.MeshLambertMaterial({ color: '#0f1d44' });
  const mats = [sideMat, sideMat, capMat, capMat, faceMat, faceMat];
  const group = new THREE.Group();
  const bodyGeo = new THREE.BoxGeometry(W, Hb, D);
  remapV(bodyGeo, 0, cut);
  const bodyM = new THREE.Mesh(bodyGeo, mats);
  bodyM.position.y = Hb / 2;
  // крышка приоткрыта: шарнир сзади на линии отреза
  const hinge = new THREE.Group();
  hinge.position.set(0, Hb, -D / 2);
  const lidGeo = new THREE.BoxGeometry(W + 0.012, Hl, D + 0.012);
  remapV(lidGeo, cut, 1);
  const lid = new THREE.Mesh(lidGeo, mats);
  lid.position.set(0, Hl / 2, D / 2);
  hinge.add(lid);
  hinge.rotation.x = -0.3;
  // фольга и фильтры
  const ib = new Builder();
  ib.box(col('#d5dbe2'), [0, Hb + 0.12, 0], [W - 0.1, 0.42, D - 0.1]);
  ib.box(col('#eef1f4'), [0.4, Hb + 0.34, 0.02], [0.5, 0.05, D - 0.16], [0, 0, 0.25]);
  const ib2 = new Builder();
  for (const x of [-0.62, -0.2, 0.22, 0.64]) {
    ib2.add(CYL8, col('#d88a3d'), [x, Hb + 0.42, 0.06], [0, 0, 0], [0.34, 0.36, 0.34]);
    ib2.add(CYL8, col('#f1e7cf'), [x, Hb + 0.605, 0.06], [0, 0, 0], [0.3, 0.012, 0.3]);
  }
  const foil = new THREE.Mesh(ib.build(), SOLID);
  const filters = new THREE.Mesh(ib2.build(), SOLID);
  filters.visible = st.spicy;
  // целлофан с золотой ленточкой
  const cello = new THREE.Mesh(new THREE.BoxGeometry(W + 0.05, Hb + 0.02, D + 0.05), new THREE.MeshPhongMaterial({
    color: '#ffffff', specular: new THREE.Color('#ffffff'), shininess: 110, transparent: true, opacity: 0.1, depthWrite: false,
  }));
  cello.position.y = Hb / 2 + 0.01;
  const strip = new THREE.Mesh(new THREE.BoxGeometry(W + 0.06, 0.05, D + 0.06), new THREE.MeshLambertMaterial({ color: '#e0b443', emissive: '#6b4d0c' }));
  strip.position.y = Hb - 0.08;
  const sheen = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, h, w, 0);
    gr.addColorStop(0.3, 'rgba(0,0,0,0)'); gr.addColorStop(0.42, 'rgba(110,120,130,1)'); gr.addColorStop(0.47, 'rgba(0,0,0,0)');
    gr.addColorStop(0.55, 'rgba(0,0,0,0)'); gr.addColorStop(0.58, 'rgba(70,80,90,1)'); gr.addColorStop(0.62, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, []);
  const sheenMat = new THREE.MeshBasicMaterial({ map: sheen.tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const s1 = new THREE.Mesh(new THREE.PlaneGeometry(W, Hb), sheenMat);
  s1.position.set(0, Hb / 2, D / 2 + 0.03);
  const s2 = new THREE.Mesh(new THREE.PlaneGeometry(W, Hb), sheenMat);
  s2.position.set(0, Hb / 2, -D / 2 - 0.03); s2.rotation.y = Math.PI;
  for (const m of [bodyM, lid, foil, filters]) { m.castShadow = true; m.receiveShadow = true; }
  group.add(bodyM, hinge, foil, filters, cello, strip, s1, s2);
  group.userData.kind = 'cigpack';
  const repaint = () => { paintCigPack(face, st); tex.needsUpdate = true; };
  return {
    group, height: H,
    setPortrait(img) { st.portrait = img; repaint(); },
    setSpicy(on) { st.spicy = on; filters.visible = on; repaint(); },
  };
}

// ==== landmarks ============================================================================
interface SignStyle { bg: string; fg: string; border?: string; sub?: string; subFg?: string; icon?: (g: CanvasRenderingContext2D, x: number, y: number, s: number) => void }

function signTex(text: string, st: SignStyle, w = 512, h = 128) {
  return canvasTex(w, h, g => {
    g.fillStyle = st.bg; g.fillRect(0, 0, w, h);
    if (st.border) { g.strokeStyle = st.border; g.lineWidth = Math.max(4, h * 0.045); g.strokeRect(h * 0.07, h * 0.07, w - h * 0.14, h - h * 0.14); }
    let x0 = 0;
    if (st.icon) { st.icon(g, h * 0.62, h / 2, h * 0.62); x0 = h * 1.05; }
    g.fillStyle = st.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const cx = (x0 + w) / 2, maxW = w - x0 - h * 0.4;
    if (st.sub) {
      fitFont(g, text, '900', DISPLAY, h * 0.46, maxW); g.fillText(text, cx, h * 0.4);
      g.fillStyle = st.subFg ?? st.fg; fitFont(g, st.sub, '700', TEXT, h * 0.22, maxW); g.fillText(st.sub, cx, h * 0.77);
    } else {
      fitFont(g, text, '900', DISPLAY, h * 0.6, maxW); g.fillText(text, cx, h * 0.54);
    }
  });
}

/** Sign plane facing +z (rotated by `ry`); `back` adds the same sign facing the other way `depth` behind. */
function addSign(group: THREE.Group, tex: THREE.Texture, w: number, h: number, p: V3, ry = 0, back = 0) {
  const mk = () => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  const m = mk();
  m.position.set(p[0], p[1], p[2]); m.rotation.y = ry;
  group.add(m);
  if (back > 0) {
    const m2 = mk();
    m2.position.set(p[0] - Math.sin(ry) * back, p[1], p[2] - Math.cos(ry) * back); m2.rotation.y = ry + Math.PI;
    group.add(m2);
  }
}

function tree(b: Builder, x: number, z: number, s = 1, k = 0) {
  b.add(CYL6, K.trunk, [x, 0.3 * s, z], [0, 0, 0], [0.12 * s, 0.6 * s, 0.12 * s]);
  b.add(ICO, K.leaf[k % 4], [x, 0.85 * s, z], [0, k, 0], [0.8 * s, 0.75 * s, 0.8 * s]);
  b.add(ICO, K.leaf[(k + 1) % 4], [x + 0.12 * s, 1.15 * s, z - 0.05 * s], [0.4, k * 2, 0], [0.5 * s, 0.5 * s, 0.5 * s]);
}

function bench(b: Builder, x: number, z: number, ry = 0, c = K.wood) {
  const p: V3 = [x, 0, z], r: V3 = [0, ry, 0];
  seg(b, c, p, r, [0, 0.24, 0], [0.8, 0.04, 0.24]);
  seg(b, c, p, r, [0, 0.4, -0.11], [0.8, 0.14, 0.03]);
  for (const s of [-1, 1]) seg(b, K.metal, p, r, [0.34 * s, 0.12, 0], [0.04, 0.24, 0.22]);
}

function lampPost(b: Builder, x: number, z: number, h = 1.3) {
  b.add(CYL6, K.metal, [x, h / 2, z], [0, 0, 0], [0.05, h, 0.05]);
  b.add(ICO, K.warm, [x, h + 0.05, z], [0, 0, 0], [0.16, 0.16, 0.16]);
}

/** Row of windows on a +z facade: frame + glass + mullion. */
function windowsRow(b: Builder, xs: number[], y: number, z: number, w: number, h: number, frame: Col, glass: Col) {
  for (const x of xs) {
    b.box(frame, [x, y, z + 0.01], [w, h, 0.02]);
    b.box(glass, [x, y, z + 0.022], [w * 0.8, h * 0.84, 0.01]);
    b.box(frame, [x, y, z + 0.03], [0.025, h * 0.84, 0.006]);
  }
}

/** Windows on a ±x facade. */
function windowsSide(b: Builder, zs: number[], y: number, x: number, w: number, h: number, frame: Col, glass: Col) {
  const s = Math.sign(x);
  for (const z of zs) {
    b.box(frame, [x + s * 0.01, y, z], [0.02, h, w]);
    b.box(glass, [x + s * 0.022, y, z], [0.01, h * 0.84, w * 0.8]);
  }
}

function fence(b: Builder, x0: number, x1: number, z: number, gap?: [number, number], c = K.metal) {
  for (const y of [0.22, 0.46]) {
    if (gap) {
      b.box(c, [(x0 + gap[0]) / 2, y, z], [gap[0] - x0, 0.035, 0.035]);
      b.box(c, [(gap[1] + x1) / 2, y, z], [x1 - gap[1], 0.035, 0.035]);
    } else b.box(c, [(x0 + x1) / 2, y, z], [x1 - x0, 0.035, 0.035]);
  }
  const n = Math.max(2, Math.round((x1 - x0) / 0.8));
  for (let k = 0; k <= n; k++) {
    const x = x0 + (k / n) * (x1 - x0);
    if (gap && x > gap[0] + 0.05 && x < gap[1] - 0.05) continue;
    b.box(c, [x, 0.27, z], [0.045, 0.54, 0.045]);
  }
}

type LmCtx = { g: THREE.Group; b: Builder; team: Col; side: 0 | 1 | undefined; name: string };

function stadium({ g, b, team, name }: LmCtx) {
  b.box(K.conc, [0, 0.03, 0], [10, 0.06, 7]);
  b.box(col('#b4553a'), [0, 0.075, 0.45], [9.0, 0.03, 5.6]);
  b.box(K.grass, [0, 0.095, 0.45], [7.2, 0.03, 3.9]);
  for (let k = 1; k < 6; k += 2) b.box(K.grass2, [-3.6 + (k + 0.5) * 1.2, 0.112, 0.45], [1.2, 0.004, 3.9]);
  const y = 0.117, z0 = 0.45, hw = 3.45, hd = 1.8, L = K.line;
  b.box(L, [0, y, z0 - hd], [2 * hw, 0.006, 0.05]); b.box(L, [0, y, z0 + hd], [2 * hw, 0.006, 0.05]);
  b.box(L, [-hw, y, z0], [0.05, 0.006, 2 * hd]); b.box(L, [hw, y, z0], [0.05, 0.006, 2 * hd]);
  b.box(L, [0, y, z0], [0.05, 0.006, 2 * hd]);
  b.add(new THREE.RingGeometry(0.52, 0.58, 16), L, [0, y + 0.004, z0], [-HALF_PI, 0, 0]);
  for (const s of [-1, 1]) {
    b.box(L, [s * (hw - 0.6), y, z0], [0.05, 0.006, 1.7]);
    b.box(L, [s * (hw - 0.3), y, z0 - 0.85], [0.6, 0.006, 0.05]);
    b.box(L, [s * (hw - 0.3), y, z0 + 0.85], [0.6, 0.006, 0.05]);
    // ворота с сеткой
    for (const dz of [-0.42, 0.42]) b.box(PAL.white, [s * hw, 0.33, z0 + dz], [0.05, 0.44, 0.05]);
    b.box(PAL.white, [s * hw, 0.55, z0], [0.05, 0.05, 0.9]);
    b.box(col('#d9dcdf'), [s * (hw + 0.28), 0.32, z0], [0.02, 0.42, 0.84]);
    b.box(col('#d9dcdf'), [s * (hw + 0.14), 0.53, z0], [0.28, 0.015, 0.84]);
  }
  // трибуна у дальней кромки, сиденья в цвет
  for (let k = 0; k < 3; k++) {
    const zz = -2.62 - k * 0.32, hh = 0.2 + k * 0.22;
    b.box(K.conc, [0, hh / 2 + 0.06, zz], [8.2, hh, 0.33]);
    b.box(k % 2 ? PAL.white : team, [0, hh + 0.085, zz + 0.05], [8.0, 0.05, 0.15]);
  }
  b.box(K.conc, [0, 0.62, -3.45], [8.4, 1.14, 0.08]);
  for (const x of [-3.9, -1.3, 1.3, 3.9]) b.box(K.metal, [x, 0.98, -3.38], [0.08, 1.85, 0.08]);
  b.box(col('#ecebe6'), [0, 1.88, -2.95], [8.6, 0.06, 1.3], [-0.1, 0, 0]);
  b.box(team, [0, 1.98, -2.31], [8.6, 0.12, 0.04]);
  // табло-вывеска над трибуной
  b.box(K.dark, [0, 2.48, -2.6], [3.9, 0.74, 0.1]);
  for (const x of [-1.2, 1.2]) b.box(K.dark, [x, 2.05, -2.6], [0.08, 0.3, 0.08]);
  addSign(g, signTex(name, { bg: '#1d2a1f', fg: '#ffe9a8', border: '#ffe9a8' }).tex, 3.7, 0.62, [0, 2.48, -2.544], 0, 0.112);
  // прожекторы по углам
  for (const [x, z] of [[-4.75, -3.25], [4.75, -3.25], [-4.75, 3.25], [4.75, 3.25]]) {
    b.add(CYL6, K.metal, [x, 1.65, z], [0, 0, 0], [0.1, 3.3, 0.1]);
    const ry = Math.atan2(-x, -(z - z0));
    const head: V3 = [x, 3.35, z];
    seg(b, K.dark, head, [0, ry, 0], [0, 0, 0], [0.72, 0.44, 0.1]);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) seg(b, K.lamp, head, [0, ry, 0], [-0.22 + c * 0.22, -0.1 + r * 0.2, 0.053], [0.17, 0.15, 0.01]);
  }
  // невысокий забор спереди с калиткой
  fence(b, -4.9, 4.9, 3.4, [-0.6, 0.6], K.metal);
}

function school({ g, b, name }: LmCtx) {
  const wall = col('#efd9b0'), trim = PAL.white, roof = col('#3f7d5a'), plinth = col('#9c8f7c');
  b.box(K.pave, [0, 0.03, 0.3], [6, 0.06, 5]);
  const bz = -1.0, bd = 1.8, bw = 5.2, fh = 0.85, front = bz + bd / 2;
  b.box(plinth, [0, 0.2, bz], [bw + 0.04, 0.3, bd + 0.04]);
  b.box(wall, [0, 0.06 + fh, bz], [bw, fh * 2, bd]);
  b.box(trim, [0, 0.06 + fh, bz], [bw + 0.04, 0.05, bd + 0.04]);
  b.box(trim, [0, 0.06 + fh * 2 + 0.03, bz], [bw + 0.14, 0.08, bd + 0.14]);
  b.add(HIP, roof, [0, 0.06 + fh * 2 + 0.07 + 0.3, bz], [0, 0, 0], [bw + 0.2, 0.6, bd + 0.2]);
  const cols = [0, 1, 2, 3, 4, 5, 6].map(c => -bw / 2 + (c + 0.5) * (bw / 7));
  windowsRow(b, cols.filter((_, c) => c !== 3), 0.06 + fh * 0.55, front, 0.46, 0.52, trim, K.winDark);
  windowsRow(b, cols.filter((_, c) => c < 2 || c > 4), 0.06 + fh * 1.55, front, 0.46, 0.52, trim, K.winBlue);
  for (const x of [-bw / 2, bw / 2]) for (const fl of [0, 1]) windowsSide(b, [bz - 0.45, bz + 0.45], 0.06 + fh * (0.55 + fl), x, 0.46, 0.52, trim, K.winDark);
  // крыльцо с колоннами
  b.box(K.conc, [0, 0.1, front + 0.4], [1.5, 0.08, 0.8]);
  b.box(K.conc, [0, 0.05, front + 0.9], [1.5, 0.05, 0.25]);
  b.box(trim, [0, 0.86, front + 0.42], [1.65, 0.07, 0.95]);
  for (const s of [-1, 1]) b.add(CYL8, trim, [0.66 * s, 0.48, front + 0.78], [0, 0, 0], [0.12, 0.76, 0.12]);
  b.box(K.dark, [0, 0.47, front + 0.01], [0.74, 0.74, 0.03]);
  b.box(K.cool, [0, 0.49, front + 0.03], [0.62, 0.62, 0.01]);
  b.box(K.dark, [0, 0.49, front + 0.04], [0.025, 0.62, 0.006]);
  addSign(g, signTex(name, { bg: '#24497f', fg: '#ffffff' }).tex, 2.1, 0.5, [0, 0.06 + fh * 1.55, front + 0.012]);
  // двор: мини-поле, баскетбольное кольцо, деревья, скамейка, забор
  b.box(col('#4d8f4a'), [-1.55, 0.065, 1.75], [2.4, 0.012, 1.4]);
  for (const s of [-1, 1]) {
    b.box(PAL.white, [-1.55 + s * 1.15, 0.24, 1.75], [0.04, 0.32, 0.5]);
  }
  b.box(K.metal, [2.3, 0.75, 2.3], [0.06, 1.5, 0.06]);
  b.box(PAL.white, [2.3, 1.45, 2.18], [0.5, 0.36, 0.03]);
  b.add(new THREE.TorusGeometry(0.11, 0.015, 4, 10), col('#e2591e'), [2.3, 1.33, 2.05], [HALF_PI, 0, 0]);
  tree(b, 2.55, 0.55, 1.0, 1);
  tree(b, -2.65, 0.5, 0.9, 2);
  bench(b, 0.9, 1.25, 0);
  fence(b, -3.0, 3.0, 2.75, [-0.6, 0.6], col('#3f6b3c'));
}

function shop({ g, b, name }: LmCtx) {
  const wall = col('#f1e7d3'), tile = col('#2f7a5a'), bz = -0.45, bd = 1.8, bw = 3.4, bh = 1.3, front = bz + bd / 2;
  b.box(K.pave, [0, 0.03, 0.3], [4.2, 0.06, 3.3]);
  b.box(wall, [0, 0.06 + bh / 2, bz], [bw, bh, bd]);
  b.box(tile, [0, 0.22, bz], [bw + 0.02, 0.3, bd + 0.02]);
  b.box(col('#6b6f73'), [0, 0.06 + bh + 0.04, bz], [bw + 0.12, 0.08, bd + 0.12]);
  b.box(col('#7c7f83'), [0, 0.06 + bh + 0.085, bz], [bw - 0.1, 0.02, bd - 0.1]);
  // вывеска-короб
  b.box(col('#1f6f4f'), [0, 1.2, front + 0.03], [bw + 0.06, 0.38, 0.06]);
  addSign(g, signTex(name, { bg: '#1f6f4f', fg: '#fff6d8', border: '#f2c12e' }).tex, bw - 0.1, 0.34, [0, 1.2, front + 0.062]);
  // витрина и дверь
  b.box(K.warm, [-0.55, 0.66, front + 0.01], [1.7, 0.6, 0.02]);
  for (const x of [-1.38, -0.55, 0.28]) b.box(K.dark, [x, 0.66, front + 0.025], [0.05, 0.62, 0.01]);
  b.box(K.dark, [-0.55, 0.36, front + 0.025], [1.75, 0.05, 0.012]);
  b.box(K.dark, [-0.55, 0.96, front + 0.025], [1.75, 0.05, 0.012]);
  b.box(K.dark, [0.95, 0.52, front + 0.012], [0.52, 0.9, 0.03]);
  b.box(lift(K.warm, 0.8), [0.95, 0.56, front + 0.03], [0.4, 0.74, 0.01]);
  // маркиза
  for (let k = 0; k < 6; k++) b.box(k % 2 ? PAL.white : col('#2f8a5a'), [-1.3 + k * 0.3, 1.0, front + 0.25], [0.3, 0.03, 0.5], [0.45, 0, 0]);
  // ящики с фруктами и арбузы
  const fruit = [col('#f08a1c'), col('#d0281c'), col('#e8c72e')];
  for (let k = 0; k < 3; k++) {
    const x = -1.25 + k * 0.45;
    b.box(K.wood, [x, 0.18, front + 0.45], [0.4, 0.2, 0.3]);
    for (let j = 0; j < 4; j++) b.add(ICO, fruit[k], [x - 0.12 + (j % 2) * 0.24, 0.31, front + 0.39 + Math.floor(j / 2) * 0.12], [j, 0, 0], [0.11, 0.1, 0.11]);
  }
  for (const [x, z] of [[0.15, front + 0.5], [0.3, front + 0.72], [0.0, front + 0.75]]) b.add(ICO, col('#2f6b2a'), [x, 0.14, z], [0, x * 9, 0], [0.26, 0.22, 0.24]);
  // холодильник с напитками
  b.box(col('#d9dde0'), [1.55, 0.56, front + 0.25], [0.4, 0.98, 0.36]);
  b.box(K.cool, [1.55, 0.6, front + 0.435], [0.32, 0.78, 0.01]);
  const bottles = [col('#c42a1c'), col('#e88b1f'), col('#3b8f3a'), col('#2b5fb0')];
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) b.box(bottles[(r + k) % 4], [1.46 + k * 0.09, 0.36 + r * 0.24, front + 0.44], [0.05, 0.14, 0.01]);
  // кондиционер на боковой стене
  b.box(col('#e3e1dc'), [bw / 2 + 0.12, 1.0, bz], [0.2, 0.3, 0.56]);
}

function market({ g, b, name }: LmCtx) {
  b.box(K.pave, [0, 0.03, 0], [6, 0.06, 5]);
  const tops = [['#d0281c', '#ffffff'], ['#2a62c9', '#ffffff'], ['#2f8a5a', '#ffffff'], ['#f2b322', '#ffffff'], ['#7a3fb0', '#ffffff'], ['#e86a1c', '#ffffff']];
  const goods = [col('#d0281c'), col('#3f8a2e'), col('#a8743c'), col('#f08a1c'), col('#6a2e8a'), col('#e8c72e')];
  for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) {
    const i = r * 3 + k, x = -1.9 + k * 1.9, z = -1.5 + r * 1.9;
    b.box(K.wood, [x, 0.22, z], [1.3, 0.32, 0.6]);
    b.box(col('#c9a77a'), [x, 0.4, z], [1.36, 0.04, 0.66]);
    for (let j = 0; j < 6; j++) b.add(ICO, goods[(i + j) % 6], [x - 0.5 + (j % 3) * 0.5, 0.5, z - 0.12 + Math.floor(j / 3) * 0.24], [j, i, 0], [0.32, 0.18, 0.2]);
    for (const s of [-1, 1]) b.box(K.metal, [x + s * 0.62, 0.7, z - 0.32], [0.04, 1.3, 0.04]);
    const [c1, c2] = tops[i];
    for (let s = 0; s < 4; s++) b.box(col(s % 2 ? c2 : c1), [x - 0.525 + s * 0.35, 1.32, z], [0.35, 0.04, 0.9], [-0.25, 0, 0]);
  }
  // арка входа с вывеской
  for (const s of [-1, 1]) b.box(col('#6e4a2f'), [s * 1.3, 0.95, 2.25], [0.16, 1.9, 0.16]);
  b.box(col('#6e4a2f'), [0, 1.98, 2.25], [2.9, 0.12, 0.18]);
  b.box(col('#2b2622'), [0, 2.32, 2.25], [2.4, 0.56, 0.08]);
  addSign(g, signTex(name, { bg: '#b3261e', fg: '#fff3d6', border: '#f0b429' }).tex, 2.3, 0.5, [0, 2.32, 2.292], 0, 0.084);
  // мешки и ящики у входа
  for (const [x, z] of [[2.4, 1.3], [2.6, 0.9], [-2.5, 1.2]]) b.add(ICO, col('#d8c8a0'), [x, 0.2, z], [0, x, 0], [0.38, 0.42, 0.34]);
}

function cafe({ g, b, side, name }: LmCtx) {
  const wall = col('#f4f1ea'), wood = col('#6e4a2f'), accent = side === undefined ? col('#2f7d4f') : PAL.side[side], roofC = col('#4a3a30');
  const bz = -0.55, bd = 1.8, bw = 3.4, bh = 1.25, front = bz + bd / 2;
  b.box(K.pave, [0, 0.03, 0.35], [4.4, 0.06, 3.6]);
  b.box(wall, [0, 0.06 + bh / 2, bz], [bw, bh, bd]);
  b.box(wood, [0, 0.16, bz], [bw + 0.02, 0.2, bd + 0.02]);
  b.add(HIP, roofC, [0, 0.06 + bh + 0.26, bz], [0, 0, 0], [bw + 0.3, 0.52, bd + 0.3]);
  // окна в пол с тёплым светом
  for (const x of [-1.15, -0.35, 0.85]) {
    b.box(wood, [x, 0.66, front + 0.01], [0.66, 0.84, 0.03]);
    b.box(K.warm, [x, 0.66, front + 0.028], [0.56, 0.74, 0.01]);
  }
  b.box(wood, [0.25, 0.55, front + 0.012], [0.42, 0.9, 0.035]);
  b.box(lift(K.warm, 0.75), [0.25, 0.58, front + 0.032], [0.3, 0.7, 0.01]);
  // вывеска на фасаде
  b.box(K.dark, [0, 1.63, front + 0.2], [2.5, 0.46, 0.05]);
  for (const x of [-0.9, 0.9]) b.box(K.dark, [x, 1.38, front + 0.18], [0.05, 0.16, 0.05]);
  addSign(g, signTex(name, { bg: '#' + accent.getHexString(), fg: '#ffffff', border: '#ffffff' }).tex, 2.4, 0.4, [0, 1.63, front + 0.227]);
  // терраса: настил, перила, столики с зонтами
  b.box(wood, [0, 0.08, front + 0.85], [3.6, 0.05, 1.5]);
  for (const s of [-1, 1]) b.box(wood, [s * 1.78, 0.32, front + 0.85], [0.05, 0.05, 1.5]);
  b.box(wood, [-1.0, 0.32, front + 1.58], [1.6, 0.05, 0.05]);
  b.box(wood, [1.0, 0.32, front + 1.58], [1.6, 0.05, 0.05]);
  for (const [x, z] of [[-1.0, front + 0.85], [1.0, front + 0.85]]) {
    b.add(CYL12, PAL.white, [x, 0.42, z], [0, 0, 0], [0.5, 0.03, 0.5]);
    b.add(CYL8, K.metal, [x, 0.24, z], [0, 0, 0], [0.05, 0.36, 0.05]);
    b.add(CYL8, K.metal, [x, 0.8, z], [0, 0, 0], [0.03, 0.75, 0.03]);
    b.add(new THREE.ConeGeometry(0.5, 0.2, 8), accent, [x, 1.2, z]);
    for (const s of [-1, 1]) {
      const p: V3 = [x + s * 0.38, 0.06, z], r: V3 = [0, s * HALF_PI, 0];
      seg(b, wood, p, r, [0, 0.22, 0], [0.24, 0.03, 0.24]);
      seg(b, wood, p, r, [0, 0.38, -0.11], [0.24, 0.3, 0.03]);
    }
  }
  // гирлянда
  for (const s of [-1, 1]) b.add(CYL6, K.metal, [s * 1.75, 0.8, front + 1.55], [0, 0, 0], [0.05, 1.5, 0.05]);
  for (let k = 0; k <= 10; k++) {
    const t = k / 10, x = -1.75 + t * 3.5;
    b.box(glow(2.0, 1.6, 0.8), [x, 1.5 - Math.sin(t * Math.PI) * 0.18, front + 1.55], [0.05, 0.05, 0.05]);
  }
}

function busstop({ g, b, side, name }: LmCtx) {
  const roofC = side === undefined ? col('#3e6fb0') : PAL.side[side];
  b.box(K.pave, [0, 0.03, 0], [3.2, 0.06, 1.6]);
  b.box(K.conc, [0, 0.07, 0.74], [3.2, 0.08, 0.12]);
  for (const x of [-1.15, 1.15]) for (const z of [-0.5, 0.25]) b.box(K.metal, [x, 0.7, z], [0.05, 1.3, 0.05]);
  b.box(col('#b9cdd8'), [0, 0.78, -0.5], [2.3, 0.95, 0.025]);
  b.box(col('#b9cdd8'), [1.15, 0.78, -0.13], [0.025, 0.95, 0.7]);
  b.box(K.metal, [-1.15, 0.78, -0.13], [0.03, 1.0, 0.72]);
  b.box(roofC, [0, 1.38, -0.12], [2.6, 0.08, 1.05]);
  b.box(lift(roofC, 0.7), [0, 1.3, 0.4], [2.6, 0.12, 0.04]);
  b.box(K.wood, [0, 0.4, -0.32], [1.6, 0.05, 0.3]);
  for (const x of [-0.6, 0.6]) b.box(K.metal, [x, 0.2, -0.32], [0.05, 0.36, 0.26]);
  addSign(g, signTex(name, { bg: '#' + lift(roofC, 0.7).getHexString(), fg: '#ffffff' }, 512, 64).tex, 2.4, 0.11, [0, 1.3, 0.421]);
  // реклама на боковой стенке
  const ad = signTex('КАЧАЛКА', { bg: '#d8361f', fg: '#fff8ea', sub: 'первая тренировка бесплатно' }, 256, 256);
  addSign(g, ad.tex, 0.62, 0.62, [-1.13, 0.85, -0.13], HALF_PI);
  // столб с табличкой «А»
  b.add(CYL8, K.steel, [1.45, 0.85, 0.5], [0, 0, 0], [0.05, 1.7, 0.05]);
  b.box(K.dark, [1.45, 1.5, 0.5], [0.46, 0.46, 0.03]);
  const stop = canvasTex(256, 256, (gg, w, h) => {
    gg.fillStyle = '#f2c12e'; gg.fillRect(0, 0, w, h);
    gg.strokeStyle = '#111'; gg.lineWidth = 10; gg.strokeRect(10, 10, w - 20, h - 20);
    gg.fillStyle = '#111'; gg.textAlign = 'center'; gg.textBaseline = 'middle';
    gg.font = `900 150px ${DISPLAY}`; gg.fillText('А', w / 2, h / 2 + 8);
  }, ['900 150px Unbounded']);
  addSign(g, stop.tex, 0.42, 0.42, [1.45, 1.5, 0.517], 0, 0.034);
  b.add(CYL8, col('#2f5d3a'), [-1.5, 0.25, 0.45], [0, 0, 0], [0.26, 0.42, 0.26]);
}

function carwash({ g, b, side, name }: LmCtx) {
  const panel = col('#d7dade'), blue = col('#2a6fbd'), s: 0 | 1 = side ?? 1;
  b.box(K.pave, [0, 0.03, 0.25], [6, 0.06, 5]);
  b.box(col('#6f7377'), [0, 0.066, -0.6], [5.2, 0.01, 3.0]);
  for (const x of [-1.3, 1.3]) b.box(K.ink, [x, 0.073, -0.2], [0.9, 0.006, 0.12]);
  b.box(panel, [0, 0.86, -2.1], [5.3, 1.6, 0.1]);
  for (const x of [-2.62, 0, 2.62]) b.box(panel, [x, 0.86, -0.6], [0.1, 1.6, 3.0]);
  for (const x of [-2.62, 0, 2.62]) b.box(blue, [x, 0.2, -0.6], [0.11, 0.28, 3.02]);
  b.box(blue, [0, 0.2, -2.1], [5.32, 0.28, 0.11]);
  b.box(col('#9ea3a8'), [0, 1.7, -1.45], [5.5, 0.1, 1.5]);
  for (const z of [-0.3, 0.4]) b.box(K.metal, [0, 1.66, z], [5.3, 0.06, 0.08]);
  b.box(blue, [0, 1.5, 0.93], [5.5, 0.38, 0.08]);
  addSign(g, signTex(name, { bg: '#2a6fbd', fg: '#ffffff', sub: '24/7 · ЧЕРНЕНИЕ РЕЗИНЫ' }, 1024, 128).tex, 5.2, 0.34, [0, 1.5, 0.972]);
  // в первом боксе — гелик в пене
  mergeInto(b, gelikShared(s), place([-1.3, 0.07, -0.3]));
  for (const [x, y, z, r] of [[-1.3, 1.05, -0.15, 0.3], [-1.15, 1.04, -0.55, 0.24], [-1.45, 1.03, -0.75, 0.22], [-1.3, 0.62, 0.65, 0.26], [-0.9, 0.5, -0.05, 0.18], [-1.7, 0.45, 0.15, 0.2]]) {
    b.add(ICO, PAL.white, [x, y, z], [x, z, 0], [r * 1.4, r * 0.8, r * 1.2]);
  }
  // во втором — аппарат высокого давления, шланг, ведро
  b.box(col('#f2c12e'), [2.15, 0.36, -1.75], [0.36, 0.56, 0.3]);
  b.box(K.ink, [2.15, 0.66, -1.75], [0.3, 0.05, 0.24]);
  for (let k = 0; k < 6; k++) b.box(K.ink, [2.0 - k * 0.18, 0.08, -1.45 + k * 0.22], [0.2, 0.03, 0.03], [0, 0.9, 0]);
  b.add(CYL8, col('#2a6fbd'), [1.0, 0.18, -0.2], [0, 0, 0], [0.22, 0.24, 0.22]);
  // лужи
  for (const [x, z, w] of [[-1.0, 1.3, 1.2], [1.4, 1.6, 0.8], [0.2, 2.1, 0.6]]) b.box(col('#8fa7b8'), [x, 0.065, z], [w, 0.006, w * 0.5]);
  // штендер с ценами
  const price = canvasTex(256, 256, (gg, w, h) => {
    gg.fillStyle = '#ffffff'; gg.fillRect(0, 0, w, h);
    gg.fillStyle = '#2a6fbd'; gg.fillRect(0, 0, w, 64);
    gg.fillStyle = '#fff'; gg.textAlign = 'center'; gg.textBaseline = 'middle';
    gg.font = `900 34px ${DISPLAY}`; gg.fillText('ЦЕНЫ', w / 2, 34);
    gg.fillStyle = '#111'; gg.textAlign = 'left'; gg.font = `700 26px ${TEXT}`;
    [['Кузов', '300 ₽'], ['Комплекс', '600 ₽'], ['Гелик', '900 ₽']].forEach(([a, p], i) => {
      gg.textAlign = 'left'; gg.fillText(a, 20, 100 + i * 52);
      gg.textAlign = 'right'; gg.fillText(p, w - 20, 100 + i * 52);
    });
  });
  b.box(K.ink, [2.3, 0.32, 1.4], [0.5, 0.56, 0.03], [-0.2, -0.3, 0]);
  const board = new THREE.Group();
  board.position.set(2.3, 0.32, 1.4); board.rotation.set(-0.2, -0.3, 0);
  const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.48), new THREE.MeshBasicMaterial({ map: price.tex }));
  pm.position.z = 0.017;
  board.add(pm);
  g.add(board);
}

function parking({ g, b, side, name }: LmCtx) {
  const s: 0 | 1 = side ?? 1;
  b.box(K.asphalt, [0, 0.03, 0], [6, 0.06, 4.6]);
  for (let k = 0; k <= 3; k++) b.box(K.line, [-2.4 + k * 1.6, 0.064, -0.6], [0.06, 0.006, 2.4]);
  b.box(K.line, [0, 0.064, -1.8], [4.86, 0.006, 0.06]);
  mergeInto(b, gelikShared(s), place([-1.6, 0.06, -0.55]));
  mergeInto(b, gelikShared(s), place([0.0, 0.06, -0.65], [0, 0.04, 0]));
  // будка и шлагбаум
  b.box(col('#e8e4da'), [2.35, 0.55, 1.45], [0.8, 1.0, 0.8]);
  b.box(K.cool, [2.35, 0.7, 1.86], [0.6, 0.36, 0.01]);
  b.box(col('#6b6f73'), [2.35, 1.08, 1.45], [0.9, 0.06, 0.9]);
  b.box(K.metal, [1.75, 0.35, 1.6], [0.14, 0.6, 0.14]);
  for (let k = 0; k < 6; k++) b.box(k % 2 ? PAL.white : col('#d0281c'), [1.6 - k * 0.3, 0.6, 1.6], [0.3, 0.06, 0.06]);
  // знак «P»
  b.add(CYL8, K.steel, [-2.7, 0.8, 1.9], [0, 0, 0], [0.05, 1.6, 0.05]);
  const pTex = canvasTex(256, 320, (gg, w, h) => {
    gg.fillStyle = '#ffffff'; gg.fillRect(0, 0, w, h);
    gg.fillStyle = '#1f5fbf'; gg.fillRect(12, 12, w - 24, w - 24);
    gg.fillStyle = '#fff'; gg.textAlign = 'center'; gg.textBaseline = 'middle';
    gg.font = `900 170px ${DISPLAY}`; gg.fillText('P', w / 2, w / 2 + 6);
    gg.fillStyle = '#111'; fitFont(gg, name, '800', DISPLAY, 34, w - 20); gg.fillText(name, w / 2, w + 28);
  });
  b.box(K.dark, [-2.7, 1.55, 1.9], [0.52, 0.64, 0.03]);
  addSign(g, pTex.tex, 0.48, 0.6, [-2.7, 1.55, 1.917], 0, 0.034);
}

function fuel({ g, b, side, name }: LmCtx) {
  const brand = col('#2c8c4a'), brand2 = col('#f2c12e');
  b.box(K.asphalt, [0, 0.03, 0.3], [6, 0.06, 5]);
  // навес на четырёх опорах
  for (const x of [-1.5, 1.5]) for (const z of [0.25, 1.55]) b.box(PAL.white, [x, 0.85, z], [0.14, 1.6, 0.14]);
  b.box(PAL.white, [0, 1.75, 0.9], [4.2, 0.24, 2.6]);
  b.box(brand, [0, 1.75, 0.9], [4.22, 0.1, 2.62]);
  b.box(brand2, [0, 1.65, 0.9], [4.22, 0.03, 2.62]);
  // островки с колонками
  for (const x of [-0.75, 0.75]) {
    b.box(K.conc, [x, 0.1, 0.9], [0.5, 0.1, 1.4]);
    for (const z of [0.55, 1.25]) {
      b.box(PAL.white, [x, 0.5, z], [0.3, 0.72, 0.22]);
      b.box(brand, [x, 0.9, z], [0.32, 0.1, 0.24]);
      for (const s of [-1, 1]) {
        b.box(glow(0.6, 1.4, 0.9), [x + s * 0.152, 0.62, z], [0.006, 0.16, 0.14]);
        b.box(K.ink, [x + s * 0.17, 0.42, z + 0.05], [0.04, 0.14, 0.04]);
      }
    }
  }
  // магазин сзади
  const front = -0.75;
  b.box(col('#eef0ee'), [0, 0.66, -1.5], [3.8, 1.2, 1.5]);
  b.box(brand, [0, 1.36, -1.5], [3.9, 0.2, 1.6]);
  b.box(K.cool, [-0.55, 0.62, front + 0.01], [2.2, 0.7, 0.02]);
  for (const x of [-1.6, -0.9, -0.2, 0.5]) b.box(K.metal, [x, 0.62, front + 0.025], [0.04, 0.72, 0.01]);
  b.box(K.dark, [1.15, 0.5, front + 0.012], [0.55, 0.88, 0.03]);
  b.box(lift(K.cool, 0.8), [1.15, 0.52, front + 0.03], [0.45, 0.76, 0.01]);
  addSign(g, signTex(name, { bg: '#2c8c4a', fg: '#ffffff' }, 512, 96).tex, 2.2, 0.19, [0, 1.36, front + 0.052]);
  addSign(g, signTex(name, { bg: '#2c8c4a', fg: '#ffffff' }, 512, 96).tex, 2.2, 0.2, [0, 1.75, 2.212]);
  // стела с ценами
  b.box(brand, [2.45, 1.0, 2.4], [0.66, 2.0, 0.16]);
  const prices = canvasTex(256, 768, (gg, w, h) => {
    gg.fillStyle = '#2c8c4a'; gg.fillRect(0, 0, w, h);
    gg.fillStyle = '#f2c12e'; gg.fillRect(0, 150, w, 10);
    gg.fillStyle = '#fff'; gg.textAlign = 'center'; gg.textBaseline = 'middle';
    fitFont(gg, name, '900', DISPLAY, 90, w - 30); gg.fillText(name, w / 2, 80);
    [['АИ-92', '51.90'], ['АИ-95', '56.40'], ['ДТ', '68.10'], ['ГАЗ', '29.50']].forEach(([f, p], i) => {
      const y = 230 + i * 128;
      gg.fillStyle = '#163f24'; gg.fillRect(16, y - 50, w - 32, 100);
      gg.fillStyle = '#fff'; gg.font = `700 34px ${TEXT}`; gg.textAlign = 'left'; gg.fillText(f, 30, y - 16);
      gg.fillStyle = '#ffd25a'; gg.font = `800 50px ${DISPLAY}`; gg.textAlign = 'right'; gg.fillText(p, w - 26, y + 20);
    });
  });
  addSign(g, prices.tex, 0.6, 1.8, [2.45, 1.02, 2.482], 0, 0.164);
  if (side !== undefined) for (const z of [-0.25, 2.05]) b.box(PAL.side[side], [0, 1.875, z], [4.0, 0.012, 0.2]);
}

function clinic({ g, b, name }: LmCtx) {
  const wall = col('#f3f4f2'), band = col('#3a78c2'), bz = -0.8, bd = 1.9, bw = 4.6, fh = 0.9, front = bz + bd / 2;
  b.box(K.pave, [0, 0.03, 0.35], [5.2, 0.06, 4.3]);
  b.box(wall, [0, 0.06 + fh, bz], [bw, fh * 2, bd]);
  b.box(band, [0, 0.2, bz], [bw + 0.02, 0.28, bd + 0.02]);
  b.box(band, [0, 0.06 + fh, bz], [bw + 0.02, 0.06, bd + 0.02]);
  b.box(col('#d6d9dc'), [0, 0.06 + fh * 2 + 0.06, bz], [bw + 0.1, 0.14, bd + 0.1]);
  const xs = [0, 1, 2, 3, 4, 5].map(c => -bw / 2 + (c + 0.5) * (bw / 6));
  windowsRow(b, xs.filter((_, c) => c !== 2 && c !== 3), 0.06 + fh * 0.55, front, 0.5, 0.5, PAL.white, K.winBlue);
  windowsRow(b, xs, 0.06 + fh * 1.5, front, 0.5, 0.5, PAL.white, K.winBlue);
  for (const x of [-bw / 2, bw / 2]) windowsSide(b, [bz - 0.45, bz + 0.45], 0.06 + fh * 1.5, x, 0.5, 0.5, PAL.white, K.winBlue);
  // вход, козырёк, пандус
  b.box(K.dark, [0, 0.5, front + 0.012], [0.9, 0.82, 0.03]);
  b.box(K.cool, [0, 0.52, front + 0.03], [0.78, 0.7, 0.01]);
  b.box(PAL.white, [0, 1.02, front + 0.45], [1.6, 0.08, 0.95]);
  for (const s of [-1, 1]) b.box(K.steel, [0.72 * s, 0.54, front + 0.85], [0.06, 0.95, 0.06]);
  b.box(K.conc, [0, 0.1, front + 0.4], [1.6, 0.08, 0.8]);
  b.box(K.conc, [1.55, 0.07, front + 0.4], [1.5, 0.06, 0.5], [0, 0, 0.05]);
  b.box(K.steel, [1.55, 0.38, front + 0.66], [1.5, 0.03, 0.03]);
  // зелёный крест (аптечный) над входом
  b.box(PAL.white, [0, 1.36, front + 0.82], [0.5, 0.5, 0.06]);
  b.box(col('#1c9a3c'), [0, 1.36, front + 0.856], [0.36, 0.12, 0.012]);
  b.box(col('#1c9a3c'), [0, 1.36, front + 0.856], [0.12, 0.36, 0.012]);
  addSign(g, signTex(name, { bg: '#3a78c2', fg: '#ffffff' }, 1024, 128).tex, 3.4, 0.34, [0, 0.06 + fh * 2 + 0.06 + 0.25, front + 0.06]);
  b.box(col('#3a78c2'), [0, 0.06 + fh * 2 + 0.06 + 0.25, front + 0.03], [3.5, 0.4, 0.05]);
  bench(b, -1.6, front + 1.0, 0);
  tree(b, -2.2, 1.9, 0.9, 3);
  tree(b, 2.1, 1.9, 0.95, 0);
}

function park({ g, b, name }: LmCtx) {
  b.box(K.grass, [0, 0.03, 0], [6, 0.06, 6]);
  const path = col('#d8cdb4');
  b.box(path, [0, 0.064, 0], [0.7, 0.01, 6]);
  b.box(path, [0, 0.064, 0], [6, 0.01, 0.7]);
  b.add(CYL12, path, [0, 0.066, 0], [0, 0, 0], [2.4, 0.012, 2.4]);
  // фонтан
  b.add(CYL12, col('#b9b3a7'), [0, 0.17, 0], [0, 0, 0], [1.4, 0.22, 1.4]);
  b.add(CYL12, glow(0.45, 0.8, 1.05), [0, 0.27, 0], [0, 0, 0], [1.24, 0.02, 1.24]);
  b.add(CYL8, col('#b9b3a7'), [0, 0.5, 0], [0, 0, 0], [0.18, 0.5, 0.18]);
  b.add(CYL12, col('#b9b3a7'), [0, 0.76, 0], [0, 0, 0], [0.6, 0.08, 0.6]);
  b.add(CONE6, glow(1.2, 1.5, 1.8), [0, 0.98, 0], [0, 0, 0], [0.14, 0.4, 0.14]);
  for (const [x, z, ry] of [[0, 1.55, Math.PI], [0, -1.55, 0], [1.55, 0, -HALF_PI], [-1.55, 0, HALF_PI]] as const) bench(b, x + (x ? 0 : 0.75), z + (z ? 0 : 0.75), ry);
  for (const [x, z] of [[0.95, 0.95], [-0.95, 0.95], [0.95, -0.95], [-0.95, -0.95]]) lampPost(b, x, z, 1.3);
  const flowers = [col('#d0281c'), col('#f2c12e'), col('#d94f9a'), col('#f4f1ea')];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    b.box(col('#6b4a31'), [Math.cos(a) * 1.65, 0.09, Math.sin(a) * 1.65], [0.5, 0.06, 0.3]);
    for (let j = 0; j < 3; j++) b.add(ICO, flowers[(k + j) % 4], [Math.cos(a) * 1.65 + (j - 1) * 0.14, 0.15, Math.sin(a) * 1.65], [j, 0, 0], [0.12, 0.08, 0.12]);
  }
  let k = 0;
  for (const [x, z, s] of [[-2.3, -2.2, 1.0], [-1.4, -2.5, 0.85], [2.2, -2.3, 1.05], [2.5, -1.2, 0.8], [-2.5, 1.4, 0.9], [-2.2, 2.3, 1.0], [2.3, 1.6, 0.95], [1.5, 2.5, 0.8]]) tree(b, x, z, s, k++);
  // арка входа
  for (const s of [-1, 1]) b.box(col('#e9e2d2'), [s * 0.62, 0.72, 2.75], [0.18, 1.44, 0.18]);
  b.box(col('#e9e2d2'), [0, 1.5, 2.75], [1.6, 0.14, 0.22]);
  b.box(col('#2f6b3a'), [0, 1.82, 2.75], [1.5, 0.46, 0.08]);
  addSign(g, signTex(name, { bg: '#2f6b3a', fg: '#fff8ea' }, 512, 160).tex, 1.42, 0.42, [0, 1.82, 2.792], 0, 0.084);
}

function gymHall({ g, b, side, name }: LmCtx) {
  const team = side === undefined ? col('#d8361f') : PAL.side[side];
  const wall = col('#c9ccd0'), wall2 = col('#b4b8bd'), bz = -0.6, bd = 2.2, bw = 4.2, bh = 1.5, front = bz + bd / 2;
  b.box(K.pave, [0, 0.03, 0.3], [5, 0.06, 4]);
  b.box(wall, [0, 0.06 + bh / 2, bz], [bw, bh, bd]);
  for (let k = 0; k < 13; k++) b.box(wall2, [-bw / 2 + 0.16 + k * 0.32, 0.06 + bh / 2, front + 0.006], [0.05, bh, 0.012]);
  b.box(team, [0, 0.06 + bh - 0.06, bz], [bw + 0.02, 0.12, bd + 0.02]);
  b.box(col('#7c7f83'), [0, 0.06 + bh + 0.04, bz], [bw + 0.1, 0.08, bd + 0.1]);
  // большие окна: внутри видно тренажёры
  for (const x of [-1.25, 1.25]) {
    b.box(K.dark, [x, 0.8, front + 0.02], [1.2, 0.7, 0.03]);
    b.box(col('#7f9db2'), [x, 0.8, front + 0.04], [1.1, 0.6, 0.01]);
    b.box(K.ink, [x - 0.25, 0.7, front + 0.046], [0.5, 0.04, 0.004]);
    b.box(K.ink, [x + 0.2, 0.75, front + 0.046], [0.06, 0.3, 0.004]);
  }
  b.box(col('#2c3237'), [0, 0.55, front + 0.02], [0.6, 0.95, 0.04]);
  b.box(col('#6b6f73'), [0, 1.1, front + 0.25], [1.0, 0.05, 0.5]);
  // вывеска на крыше
  b.box(K.ink, [0, 1.95, front - 0.12], [2.6, 0.6, 0.08]);
  for (const x of [-1.0, 1.0]) b.box(K.ink, [x, 1.68, front - 0.12], [0.06, 0.14, 0.06]);
  const st: SignStyle = {
    bg: '#' + team.getHexString(), fg: '#fff8ea', border: '#fff8ea',
    icon: (gg, x, y, s) => {
      gg.fillStyle = '#fff8ea';
      gg.fillRect(x - s * 0.55, y - s * 0.06, s * 1.1, s * 0.12);
      gg.fillRect(x - s * 0.5, y - s * 0.32, s * 0.16, s * 0.64); gg.fillRect(x + s * 0.34, y - s * 0.32, s * 0.16, s * 0.64);
    },
  };
  addSign(g, signTex(name, st).tex, 2.5, 0.52, [0, 1.95, front - 0.075], 0, 0.09);
  // во дворе: турник, брусья, покрышка, груша
  for (const x of [-2.1, -1.3]) b.box(K.metal, [x, 0.7, 1.4], [0.05, 1.4, 0.05]);
  b.add(CYL8, K.steel, [-1.7, 1.38, 1.4], [0, 0, HALF_PI], [0.035, 0.85, 0.035]);
  for (const z of [1.0, 1.4]) b.box(K.steel, [-0.6, 0.55, z + 0.4], [0.7, 0.04, 0.04]);
  for (const x of [-0.9, -0.3]) for (const z of [1.4, 1.8]) b.box(K.metal, [x, 0.27, z], [0.04, 0.54, 0.04]);
  b.add(new THREE.TorusGeometry(0.3, 0.13, 5, 10), col('#202022'), [1.1, 0.13, 1.4], [HALF_PI, 0, 0]);
  b.box(K.metal, [2.0, 0.75, 1.0], [0.05, 1.5, 0.05]);
  b.box(K.metal, [1.8, 1.48, 1.0], [0.45, 0.05, 0.05]);
  b.add(CYL8, team, [1.62, 0.95, 1.0], [0, 0, 0], [0.26, 0.6, 0.26]);
  b.box(K.ink, [1.62, 1.33, 1.0], [0.012, 0.15, 0.012]);
}

function genericPlace({ g, b, side, name }: LmCtx) {
  const team = side === undefined ? col('#8b3a2f') : PAL.side[side];
  b.box(K.pave, [0, 0.03, 0.2], [3.4, 0.06, 2.8]);
  b.box(col('#e5d3b3'), [0, 0.66, -0.3], [2.8, 1.2, 1.6]);
  b.add(HIP, team, [0, 1.26 + 0.25, -0.3], [0, 0, 0], [3.0, 0.5, 1.8]);
  b.box(K.dark, [0, 0.5, 0.51], [0.5, 0.86, 0.03]);
  windowsRow(b, [-0.9, 0.9], 0.75, 0.5, 0.5, 0.5, PAL.white, K.winDark);
  b.box(K.dark, [0, 1.1, 0.54], [2.2, 0.3, 0.04]);
  addSign(g, signTex(name, { bg: '#2b2622', fg: '#fff8ea' }).tex, 2.1, 0.26, [0, 1.1, 0.562]);
}

export type LandmarkKind = 'stadium' | 'school' | 'shop' | 'market' | 'cafe' | 'busstop' | 'carwash' | 'parking' | 'fuel' | 'clinic' | 'park' | 'gym';
export const LANDMARK_KINDS: LandmarkKind[] = ['stadium', 'school', 'shop', 'market', 'cafe', 'busstop', 'carwash', 'parking', 'fuel', 'clinic', 'park', 'gym'];
const LM: Record<LandmarkKind, { name: string; size: [number, number]; build: (c: LmCtx) => void; crowdX: number }> = {
  stadium: { name: 'СТАДИОН', size: [10, 7.2], build: stadium, crowdX: 3.2 },
  school: { name: 'ШКОЛА №1', size: [6, 5], build: school, crowdX: 1.6 },
  shop: { name: 'ПРОДУКТЫ', size: [4.2, 3.4], build: shop, crowdX: 0.6 },
  market: { name: 'РЫНОК', size: [6, 5], build: market, crowdX: 2.0 },
  cafe: { name: 'КАФЕ', size: [4.4, 3.8], build: cafe, crowdX: 1.6 },
  busstop: { name: 'ОСТАНОВКА', size: [3.3, 1.6], build: busstop, crowdX: 0.4 },
  carwash: { name: 'АВТОМОЙКА', size: [6, 5], build: carwash, crowdX: 1.6 },
  parking: { name: 'ПАРКОВКА', size: [6, 4.6], build: parking, crowdX: 0.8 },
  fuel: { name: 'АЗС', size: [6, 5.1], build: fuel, crowdX: -1.8 },
  clinic: { name: 'ПОЛИКЛИНИКА', size: [5.2, 4.3], build: clinic, crowdX: 1.6 },
  park: { name: 'ПАРК', size: [6, 6], build: park, crowdX: 1.6 },
  gym: { name: 'СПОРТЗАЛ', size: [5, 4], build: gymHall, crowdX: 0.6 },
};
const ALIAS: Record<string, LandmarkKind> = {
  store: 'shop', produkty: 'shop', magazin: 'shop', bazaar: 'market', rynok: 'market', wash: 'carwash', moyka: 'carwash',
  gas: 'fuel', azs: 'fuel', petrol: 'fuel', hospital: 'clinic', pharmacy: 'clinic', bus: 'busstop', stop: 'busstop', sport: 'gym',
};

export interface LandmarkOpts {
  /** Sign text (Russian, short). Defaults: СТАДИОН, ШКОЛА №1, ПРОДУКТЫ, РЫНОК, КАФЕ, ОСТАНОВКА, АВТОМОЙКА, ПАРКОВКА, АЗС, ПОЛИКЛИНИКА, ПАРК, СПОРТЗАЛ */
  name?: string;
  /** village colour for seats, roofs, accents and the parked гелик */
  side?: 0 | 1;
  /** add sportikiCrowd(n) in front of it (part of the group; also in userData.crowd) */
  crowd?: number;
}

/**
 * A landmark building for a real place. Front faces +z, ground at y = 0, one solid mesh plus
 * MeshBasicMaterial canvas sign planes that repaint when the fonts load. Unknown kinds get a
 * small signed house. userData: { kind, footprint: [w, d], bounds: { x0, x1, z0, z1, h } (building only,
 * local units), tris, crowd? }.
 */
export function landmark(kind: string, opts: LandmarkOpts = {}): THREE.Group {
  const k = (LANDMARK_KINDS as string[]).includes(kind) ? (kind as LandmarkKind) : ALIAS[kind];
  const def = k ? LM[k] : null;
  const g = new THREE.Group();
  const b = new Builder();
  const ctx: LmCtx = { g, b, team: opts.side === undefined ? col('#2f8a5a') : PAL.side[opts.side], side: opts.side, name: opts.name ?? def?.name ?? kind.toUpperCase() };
  (def?.build ?? genericPlace)(ctx);
  const main = b.build();
  main.computeBoundingBox();
  const bb = main.boundingBox!;
  g.userData.bounds = { x0: bb.min.x, x1: bb.max.x, z0: bb.min.z, z1: bb.max.z, h: bb.max.y };
  g.add(solid(main));
  if (opts.crowd && opts.crowd > 0) {
    const crowd = sportikiCrowd(opts.crowd, opts.side ?? 1);
    // just in front of the paved front edge (the crowd adds ~2.3 to the depth in +z)
    const cx = def?.crowdX ?? 1.2;
    crowd.position.set(cx, 0, bb.max.z + 0.6);
    crowd.rotation.y = -0.15;
    g.add(crowd);
    g.userData.crowd = crowd;
  }
  let t = 0;
  g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) t += tris(m.geometry); });
  g.userData.kind = k ?? kind;
  g.userData.footprint = def?.size ?? [3.4, 2.8];
  g.userData.tris = t;
  return g;
}
