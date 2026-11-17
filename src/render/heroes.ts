// Heroes, mercenaries, summons and rides (unit types 6..15) plus the street-food
// buildings. Same boxy, big-headed chibi style as models.ts: every unit merges into one
// vertex-coloured geometry so a crowd instances cheaply. Units face +z and stand on y=0.
import * as THREE from 'three';
import { Builder, PAL } from './models';
import { body, strokeText, propUnitGeometry, propUnitScale, propUnitHeight } from './props';
import { aminaGeometry } from './girls';

type V3 = [number, number, number];
type Col = THREE.Color;
const col = (s: string) => new THREE.Color(s);
/** Linear colour above 1.0: on Lambert + ACES it reads as self-lit (screens, eyes, embers). */
const glow = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const lift = (c: Col, k: number) => new THREE.Color(c.r * k, c.g * k, c.b * k);

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const CYL8 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const CYL12 = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const ICO = new THREE.IcosahedronGeometry(0.5, 0);
const ICO1 = new THREE.IcosahedronGeometry(0.5, 1);
const CONE6 = new THREE.ConeGeometry(0.5, 1, 6);
const BOWL = new THREE.CylinderGeometry(0.5, 0.32, 1, 10);

const C = {
  jogger: col('#33353c'),
  sweat: col('#6c6f77'),
  black: col('#17181b'),
  shoeBlack: col('#151515'),
  screen: glow(0.42, 1.05, 2.0),
  phone: glow(0.55, 1.25, 2.3),
  ember: glow(2.2, 0.62, 0.08),
  eye: glow(2.2, 0.6, 0.05),
  page: col('#f7f3e6'),
  journal: col('#2f5e46'),
  red: col('#d32a1c'),
  pen: col('#2148b8'),
  glasses: col('#101010'),
  lens: col('#cfe0ea'),
  cap: col('#3a3631'),
  noodle: col('#ecd08a'),
  sauce: col('#b5452a'),
  herb: col('#4c8a2e'),
  bowlBlue: col('#2f62b8'),
  neon: col('#c9f23a'),
  stone: [col('#8a867d'), col('#78746c'), col('#958f84'), col('#67635c')],
  moss: col('#5d7b39'),
  carWhite: col('#f1efe9'),
  yellow: col('#f2c12e'),
  yellowRoof: col('#f6d25c'),
  checker: col('#f5c518'),
  tyre: col('#1b1b1d'),
  hub: col('#a9adb3'),
  bumper: col('#3a3c40'),
  tail: col('#b3241a'),
  chicken: col('#f5f1e6'),
  comb: col('#d9271c'),
  beak: col('#f3a41f'),
  toy: col('#ff7f1e'),
};

const _e = new THREE.Euler(), _v = new THREE.Vector3();
/** A box (or other primitive) in a limb frame: pivot + rotation, `at` is its centre in that frame. */
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

// ---- 7-segment glyphs (numbers on hoodies, bibs and route plates) -------------------------
const SEGS: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg' };
/**
 * Flat digits on an axis-aligned surface. `dir` is the reading direction as seen by a viewer
 * facing that surface: '+x' for a +z face, '-x' for a -z face, '+z' for a -x face, '-z' for a +x face.
 */
function glyphs(b: Builder, c: Col, text: string, centre: V3, dir: '+x' | '-x' | '+z' | '-z', h: number, th = h * 0.16, depth = 0.012) {
  const w = h * 0.55, gap = h * 0.16, dot = th * 1.25;
  const widths = [...text].map(ch => (ch === '.' ? dot : w));
  const total = widths.reduce((a, x) => a + x, 0) + gap * (text.length - 1);
  const sx = dir === '+x' ? 1 : dir === '-x' ? -1 : 0, sz = dir === '+z' ? 1 : dir === '-z' ? -1 : 0;
  const alongX = sx !== 0;
  let u = -total / 2;
  const put = (du: number, dv: number, lu: number, lv: number) => {
    const p: V3 = [centre[0] + sx * du, centre[1] + dv, centre[2] + sz * du];
    b.box(c, p, alongX ? [lu, lv, depth] : [depth, lv, lu]);
  };
  [...text].forEach((ch, i) => {
    const cw = widths[i];
    const cu = u + cw / 2;
    if (ch === '.') put(cu, -h / 2 + dot / 2, dot, dot);
    else {
      const s = SEGS[ch] ?? '';
      const hw = w / 2 - th / 2, hh = h / 2 - th / 2;
      if (s.includes('a')) put(cu, hh, w, th);
      if (s.includes('g')) put(cu, 0, w, th);
      if (s.includes('d')) put(cu, -hh, w, th);
      if (s.includes('f')) put(cu - hw, hh / 2, th, h / 2);
      if (s.includes('b')) put(cu + hw, hh / 2, th, h / 2);
      if (s.includes('e')) put(cu - hw, -hh / 2, th, h / 2);
      if (s.includes('c')) put(cu + hw, -hh / 2, th, h / 2);
    }
    u += cw + gap;
  });
}

// ---- the villager body, posable -----------------------------------------------------------
/** Shoulder/hip rotation, plus the forearm/shin rotation (absolute) when the elbow/knee bends. */
interface Limb { up?: V3; lo?: V3 }
interface Fig {
  top: Col; sleeve?: Col; pants?: Col; shoe?: Col; skin?: Col;
  w?: number; lw?: number;
  armL?: Limb; armR?: Limb; legL?: Limb; legR?: Limb;
  tee?: boolean; bare?: boolean; shorts?: boolean;
  stripe?: Col;
  beard?: 'stubble' | 'full' | 'none';
  hair?: 'short' | 'buzz' | 'none';
}
interface FigOut { handL: V3; handR: V3 }

/** Same proportions as person() in models.ts; +x is the character's left. */
function figure(b: Builder, o: Fig): FigOut {
  const w = o.w ?? 1, lw = o.lw ?? 1;
  const skin = o.skin ?? PAL.skin, pants = o.pants ?? PAL.pants, shoe = o.shoe ?? PAL.shoe;
  for (const s of [1, -1]) {
    const L = s > 0 ? o.legL : o.legR;
    const hip: V3 = [0.08 * s * lw, 0.32, 0];
    const up = L?.up ?? [0, 0, 0];
    if (L?.lo) {
      seg(b, pants, hip, up, [0, -0.08, 0], [0.125 * lw, 0.18, 0.145]);
      const knee = along(hip, up, [0, -0.15, 0]);
      seg(b, o.shorts ? skin : pants, knee, L.lo, [0, -0.07, 0], [0.105 * lw, 0.15, 0.125]);
      seg(b, shoe, knee, L.lo, [0, -0.14, 0.025], [0.13 * lw, 0.06, 0.19]);
      if (o.stripe) seg(b, o.stripe, hip, up, [0.066 * s * lw, -0.08, 0], [0.012, 0.16, 0.02]);
    } else {
      if (o.shorts) {
        seg(b, pants, hip, up, [0, -0.07, 0], [0.13 * lw, 0.15, 0.15]);
        seg(b, skin, hip, up, [0, -0.2, 0], [0.105 * lw, 0.17, 0.12]);
      } else seg(b, pants, hip, up, [0, -0.15, 0], [0.12 * lw, 0.3, 0.14]);
      seg(b, shoe, hip, up, [0, -0.29, 0.025], [0.13 * lw, 0.06, 0.19]);
      if (o.stripe) seg(b, o.stripe, hip, up, [0.066 * s * lw, -0.14, 0], [0.012, 0.28, 0.02]);
    }
  }
  b.box(o.top, [0, 0.47, 0], [0.36 * w, 0.32, 0.22]);
  if (o.stripe) {
    b.box(o.stripe, [0, 0.47, 0.112], [0.025, 0.3, 0.01]);
    b.box(o.stripe, [-0.181 * w, 0.47, 0], [0.012, 0.28, 0.1]);
    b.box(o.stripe, [0.181 * w, 0.47, 0], [0.012, 0.28, 0.1]);
  }
  const sleeve = o.bare ? skin : (o.sleeve ?? o.top);
  const hands: V3[] = [];
  for (const s of [1, -1]) {
    const A = s > 0 ? o.armL : o.armR;
    const sh: V3 = [0.23 * w * s, 0.61, 0];
    const up = A?.up ?? [0, 0, 0];
    if (A?.lo) {
      seg(b, sleeve, sh, up, [0, -0.08, 0], [0.09 * lw, 0.18, 0.11]);
      const el = along(sh, up, [0, -0.155, 0]);
      seg(b, o.tee ? skin : sleeve, el, A.lo, [0, -0.075, 0], [0.085 * lw, 0.16, 0.1]);
      hands.push(seg(b, skin, el, A.lo, [0, -0.175, 0], [0.08 * Math.max(1, lw * 0.9), 0.07, 0.09]));
      if (o.stripe && !o.tee) seg(b, o.stripe, sh, up, [0.047 * s * lw, -0.08, 0], [0.012, 0.16, 0.05]);
    } else {
      if (o.tee) {
        seg(b, sleeve, sh, up, [0, -0.08, 0], [0.1 * lw, 0.17, 0.12]);
        seg(b, skin, sh, up, [0, -0.225, 0], [0.085 * lw, 0.15, 0.1]);
      } else seg(b, sleeve, sh, up, [0, -0.15, 0], [0.09 * lw, 0.3, 0.11]);
      hands.push(seg(b, skin, sh, up, [0, -0.32, 0], [0.08 * Math.max(1, lw * 0.9), 0.06, 0.09]));
      if (o.stripe && !o.tee) seg(b, o.stripe, sh, up, [0.047 * s * lw, -0.15, 0], [0.012, 0.28, 0.05]);
    }
  }
  // head
  b.box(skin, [0, 0.79, 0], [0.27, 0.27, 0.25]);
  b.box(PAL.black, [-0.06, 0.81, 0.126], [0.04, 0.035, 0.01]);
  b.box(PAL.black, [0.06, 0.81, 0.126], [0.04, 0.035, 0.01]);
  const beard = o.beard ?? 'stubble';
  if (beard === 'stubble') b.box(PAL.skin2, [0, 0.7, 0.03], [0.275, 0.09, 0.23]);
  else if (beard === 'full') {
    b.box(PAL.hair, [0, 0.705, 0.03], [0.285, 0.12, 0.235]);
    b.box(PAL.hair, [0, 0.64, 0.07], [0.2, 0.06, 0.13]);
    b.box(PAL.hair, [0, 0.752, 0.13], [0.13, 0.025, 0.02]); // усы
    b.box(PAL.hair, [-0.14, 0.79, -0.01], [0.012, 0.14, 0.17]); // бакенбарды
    b.box(PAL.hair, [0.14, 0.79, -0.01], [0.012, 0.14, 0.17]);
  }
  const hair = o.hair ?? 'short';
  if (hair === 'short') b.box(PAL.hair, [0, 0.94, -0.01], [0.28, 0.05, 0.26]);
  else if (hair === 'buzz') {
    const buzz = col('#3b2e26');
    b.box(buzz, [0, 0.932, -0.01], [0.276, 0.02, 0.256]);
    b.box(buzz, [0, 0.86, -0.128], [0.27, 0.12, 0.01]);
  }
  return { handL: hands[0], handR: hands[1] };
}

/** Thin slab with a coloured face on its local +z or -z side (phones, monitors, pages). */
function slab(b: Builder, body: Col, face: Col | null, at: V3, rot: V3, size: V3, faceSide = 1, inset = 0.82) {
  b.add(BOX, body, at, rot, size);
  if (face) seg(b, face, at, rot, [0, 0, faceSide * (size[2] / 2 + 0.003)], [size[0] * inset, size[1] * inset, 0.006]);
}

// ---- the heroes --------------------------------------------------------------------------
// Чимаев, Амин, админ and ersno use body() from props.ts (same proportions as figure(), but with
// adjustable leg / torso length, baggy pants and brown eyes). Heights: Амин > Чимаев > админ > ersno.

/** Чимаев: пацан с рыжевато-каштановыми волосами, чёрный атласный бомбер с красными рукавами и BULLS. */
function chimaev(b: Builder, team: Col) {
  const satin = col('#16171b'), red = col('#c41f2b'), hair = col('#6b3a1d'), hairL = col('#8e4c25');
  const f = body(b, {
    top: satin, sleeve: red, cuff: satin, pants: col('#26272c'), shoe: PAL.white, sole: team,
    w: 0.9, lw: 0.88, leg: 1.04, beard: 'none',
    legL: { up: [-0.3, 0, 0] }, legR: { up: [0.26, 0, 0] },
    armL: { up: [0.38, 0, -0.06] },
    armR: { up: [-0.35, 0, 0.1], lo: [-1.75, 0, 0.55] },
  });
  const tw = 0.36 * 0.9, hy = f.headY;
  // резинки: низ, ворот (красные с чёрной полоской), молния
  b.box(red, [0, f.hipY + 0.016, 0], [tw + 0.014, 0.05, 0.234]);
  b.box(satin, [0, f.hipY + 0.016, 0], [tw + 0.018, 0.012, 0.238]);
  b.box(red, [0, f.topY + 0.012, -0.006], [0.215, 0.04, 0.17]);
  b.box(satin, [0, f.topY + 0.012, -0.006], [0.219, 0.01, 0.174]);
  b.box(PAL.steel, [0, (f.hipY + f.topY) / 2, 0.112], [0.01, f.topY - f.hipY - 0.07, 0.004]);
  // атласный блик на плечах
  b.box(col('#2a2c33'), [0, f.topY - 0.02, -0.02], [tw + 0.004, 0.03, 0.2]);
  // рогатая бычья голова на груди
  const mx = 0.075, my = f.topY - 0.085, mz = 0.112;
  b.box(red, [mx, my, mz], [0.042, 0.036, 0.006]);
  b.box(red, [mx, my - 0.026, mz], [0.024, 0.018, 0.006]);
  b.box(red, [mx - 0.032, my + 0.02, mz], [0.034, 0.01, 0.006], [0, 0, -0.62]);
  b.box(red, [mx + 0.032, my + 0.02, mz], [0.034, 0.01, 0.006], [0, 0, 0.62]);
  b.box(red, [mx - 0.046, my + 0.04, mz], [0.01, 0.018, 0.006]);
  b.box(red, [mx + 0.046, my + 0.04, mz], [0.01, 0.018, 0.006]);
  // BULLS дугой во всю спину: красные буквы с белой обводкой
  const back: V3 = [0, f.topY - 0.1, -0.111];
  const lt = { w: 0.046, gap: 0.012, arch: 0.018, inset: 0.016 };
  strokeText(b, PAL.white, 'BULLS', back, '-z', 0.078, { ...lt, th: 0.028, lift: 0.001 });
  strokeText(b, red, 'BULLS', back, '-z', 0.078, { ...lt, th: 0.016, lift: 0.0025 });
  // волосы: каштановые с рыжиной, чуб вверх
  b.box(hair, [0, hy + 0.15, -0.012], [0.284, 0.06, 0.27]);
  b.box(hairL, [0.025, hy + 0.188, 0.055], [0.19, 0.05, 0.12], [-0.28, 0.18, 0]);
  b.box(hair, [-0.06, hy + 0.172, 0.09], [0.12, 0.045, 0.08], [-0.35, -0.2, 0.1]);
  b.box(hairL, [0.07, hy + 0.18, -0.06], [0.09, 0.03, 0.09], [0, 0.5, 0.2]);
  b.box(hair, [0, hy + 0.06, -0.13], [0.276, 0.18, 0.02]);
  for (const s of [-1, 1]) {
    b.box(hair, [0.138 * s, hy + 0.085, -0.03], [0.012, 0.11, 0.19]);
    b.box(hair, [0.06 * s, hy + 0.058, 0.128], [0.06, 0.014, 0.008]); // брови
  }
  // телефон в чехле цвета села, экраном к себе
  const h = f.handR;
  slab(b, team, C.phone, [h[0] + 0.01, h[1] + 0.06, h[2] + 0.015], [0.75, 0, 0], [0.085, 0.13, 0.016], -1);
}

/** Амин (ex-WOU): высокий, тёмные волосы, карие глаза, чёрная кожанка, чёрная рубашка, тёмные джинсы. */
function amin(b: Builder, team: Col) {
  const leather = col('#242429'), shine = col('#4a4b55'), shirt = col('#070708'), jeans = col('#1f2c4f'), hair = col('#17110d');
  const f = body(b, {
    top: leather, pants: jeans, shoe: col('#0c0c0d'), cuff: shine,
    w: 1.02, lw: 0.95, leg: 1.38, torso: 1.12, arm: 1.12, eyes: 'brown', beard: 'none',
    legL: { up: [-0.14, 0, 0.02] }, legR: { up: [0.12, 0, -0.03] },
    armL: { up: [0.05, 0, 0.14] },
    armR: { up: [-0.4, 0, 0.12], lo: [-1.85, 0, 0.5] },
  });
  const tw = 0.36 * 1.02, hy = f.headY, top = f.topY;
  // расстёгнутый ворот: чёрная рубашка, уголки воротника, пуговицы
  b.box(shirt, [0, top - 0.1, 0.112], [0.13, 0.19, 0.006]);
  for (const s of [-1, 1]) b.box(shirt, [0.04 * s, top - 0.012, 0.1], [0.06, 0.03, 0.04], [0, 0, 0.55 * s]);
  for (let k = 0; k < 3; k++) b.box(col('#33343a'), [0, top - 0.07 - k * 0.05, 0.116], [0.01, 0.01, 0.004]);
  // лацканы косухи, косая молния, карманы, погоны, низ
  for (const s of [-1, 1]) {
    b.box(shine, [0.075 * s, top - 0.085, 0.115], [0.055, 0.2, 0.008], [0, 0, -0.32 * s]);
    b.box(PAL.steel, [0.1 * s, f.hipY + 0.085, 0.114], [0.06, 0.006, 0.004], [0, 0, 0.4 * s]);
    b.box(shine, [0.165 * s, top + 0.004, 0], [0.08, 0.012, 0.06]);
  }
  b.box(PAL.steel, [-0.045, (f.hipY + top) / 2 - 0.02, 0.114], [0.008, (top - f.hipY) * 0.62, 0.004], [0, 0, -0.16]);
  b.box(shine, [0, f.hipY + 0.008, 0], [tw + 0.012, 0.045, 0.232]);
  // волосы: тёмные, уложены назад
  b.box(hair, [0, hy + 0.15, -0.012], [0.285, 0.065, 0.27]);
  b.box(hair, [0.015, hy + 0.178, 0.05], [0.23, 0.055, 0.15], [-0.22, 0, 0]);
  b.box(hair, [0, hy + 0.05, -0.13], [0.276, 0.2, 0.02]);
  for (const s of [-1, 1]) {
    b.box(hair, [0.138 * s, hy + 0.09, -0.03], [0.012, 0.1, 0.19]);
    b.box(hair, [0.062 * s, hy + 0.064, 0.127], [0.07, 0.018, 0.008]); // густые брови
  }
  // телефон в правой: рейджбайтит, экраном к себе
  const h = f.handR;
  slab(b, C.black, C.phone, [h[0] + 0.01, h[1] + 0.065, h[2] + 0.015], [0.75, 0, 0], [0.085, 0.14, 0.016], -1);
  // ноутбук под рукой, крышка в цвет села (Пентагон сам себя не взломает)
  const l = f.handL;
  b.box(col('#9ea3aa'), [l[0] + 0.05, l[1] + 0.08, l[2] + 0.01], [0.026, 0.2, 0.29]);
  b.box(team, [l[0] + 0.064, l[1] + 0.08, l[2] + 0.01], [0.004, 0.17, 0.26]);
  b.box(PAL.white, [l[0] + 0.067, l[1] + 0.11, l[2] + 0.05], [0.003, 0.05, 0.05]);
}

/** Админ: лохматые тёмно-каштановые волосы с длинной чёлкой, светлая кожа, кремовая футболка, рюкзак, журнал с «Н». */
function admin(b: Builder, team: Col) {
  const tee = col('#ece2cc'), skin = col('#efcdb3'), hair = col('#3a291d'), hair2 = col('#4d3626'), pack = col('#141416');
  const f = body(b, {
    top: tee, pants: col('#384055'), shoe: col('#ecebe6'), sole: col('#c9c6bf'), skin, tee: true, eyes: 'brown', beard: 'none',
    armL: { up: [-0.3, 0, -0.05], lo: [-1.25, 0, -0.35] },
    armR: { up: [-0.55, 0, 0.12], lo: [-2.0, 0, 0.6] },
  });
  const hy = f.headY, top = f.topY, mid = (f.hipY + top) / 2;
  b.box(lift(tee, 0.86), [0, top - 0.008, 0.108], [0.12, 0.022, 0.012]); // ворот
  // рюкзак на правом плече: лямка спереди, сам рюкзак за спиной, бегунок в цвет села
  b.box(pack, [-0.04, mid + 0.03, -0.2], [0.29, 0.33, 0.15]);
  b.box(lift(pack, 1.6), [-0.04, mid - 0.04, -0.286], [0.23, 0.13, 0.03]);
  b.box(pack, [-0.04, mid + 0.21, -0.2], [0.1, 0.03, 0.03]);
  b.box(team, [0.06, mid + 0.12, -0.28], [0.035, 0.04, 0.012]);
  b.box(pack, [-0.13, top + 0.012, -0.03], [0.06, 0.026, 0.26]);
  b.box(pack, [-0.12, top - 0.12, 0.113], [0.05, 0.24, 0.012], [0, 0, 0.08]);
  b.box(col('#4a4a4e'), [-0.115, top - 0.17, 0.12], [0.06, 0.025, 0.006]);
  // повязка старосты в цвет села на левом рукаве
  b.box(team, [0.235, f.shY - 0.075, 0.004], [0.112, 0.05, 0.13], [-0.3, 0, -0.05]);
  // лохматые волосы и длинная чёлка до бровей
  b.box(hair, [0, hy + 0.15, -0.012], [0.3, 0.08, 0.285]);
  b.box(hair2, [0.04, hy + 0.195, 0.0], [0.12, 0.04, 0.14], [0.2, 0.4, 0.25]);
  b.box(hair, [-0.07, hy + 0.19, -0.07], [0.1, 0.04, 0.12], [-0.3, -0.5, -0.2]);
  b.box(hair2, [0.09, hy + 0.18, -0.1], [0.08, 0.04, 0.1], [0.3, 0.2, 0.35]);
  b.box(hair, [0, hy + 0.03, -0.136], [0.29, 0.26, 0.03]);
  for (const s of [-1, 1]) b.box(hair, [0.142 * s, hy + 0.055, -0.02], [0.02, 0.19, 0.22]);
  const strands: [number, number][] = [[-0.1, -0.22], [-0.05, 0.16], [0.0, -0.08], [0.05, 0.2], [0.1, -0.14]];
  strands.forEach(([x, rz], i) => b.box(i % 2 ? hair2 : hair, [x, hy + 0.1 - (i % 2) * 0.012, 0.132], [0.066, 0.11, 0.03], [-0.12, 0, rz]));
  // журнал посещаемости раскрыт и развёрнут к врагу: кто отсутствует
  const hL = f.handL;
  const j: V3 = [hL[0] - 0.13, hL[1] + 0.05, hL[2] + 0.04];
  const jr: V3 = [0.75, 0, 0];
  seg(b, C.journal, j, jr, [0, 0, 0], [0.36, 0.025, 0.24]);
  seg(b, C.page, j, jr, [-0.088, 0.018, 0], [0.165, 0.014, 0.215]);
  seg(b, C.page, j, jr, [0.088, 0.018, 0], [0.165, 0.014, 0.215]);
  seg(b, C.journal, j, jr, [0, 0.026, 0], [0.012, 0.004, 0.22]);
  for (let k = 0; k < 4; k++) seg(b, col('#8fa8d0'), j, jr, [0.088, 0.027, -0.075 + k * 0.045], [0.13, 0.004, 0.008]);
  // красная «Н» на левой странице
  seg(b, C.red, j, jr, [-0.125, 0.028, 0.0], [0.018, 0.004, 0.12]);
  seg(b, C.red, j, jr, [-0.055, 0.028, 0.0], [0.018, 0.004, 0.12]);
  seg(b, C.red, j, jr, [-0.09, 0.028, 0.0], [0.07, 0.004, 0.016]);
  // ручка
  const hR = f.handR;
  b.box(C.pen, [hR[0] + 0.02, hR[1] + 0.0, hR[2] + 0.04], [0.02, 0.02, 0.13], [1.2, 0.5, 0]);
}

/** Мохьмад (ersno, тип 9): чуть ниже Чимаева, оверсайз пуховик и широченные джинсы, веер чужих банковских карт в обеих руках. */
function ersno(b: Builder, team: Col) {
  const puffer = col('#30333a'), puff2 = col('#41454e'), jeans = col('#8796ad');
  const W = 1.34;
  const f = body(b, {
    top: puffer, cuff: puff2, pants: jeans, shoe: PAL.white, sole: col('#d8d4cc'), chunky: true,
    w: W, lw: 1.3, leg: 0.92, arm: 1.02, baggy: 1.5, beard: 'stubble',
    legL: { up: [0, 0, 0.06] }, legR: { up: [0, 0, -0.06] },
    armL: { up: [-0.8, 0, 0.12], lo: [-2.05, 0, -0.3] },
    armR: { up: [-0.8, 0, -0.12], lo: [-2.05, 0, 0.3] },
  });
  const tw = 0.36 * W, hy = f.headY, top = f.topY;
  // пуховик: длинный низ поверх джинсов, стёжка, высокий ворот, капюшон, молния
  b.box(puffer, [0, f.hipY - 0.025, 0], [tw + 0.02, 0.09, 0.25]);
  for (let k = 0; k < 3; k++) b.box(puff2, [0, f.hipY + 0.045 + k * 0.1, 0], [tw + 0.03, 0.05, 0.255]);
  b.box(puffer, [0, top + 0.025, -0.01], [0.3, 0.075, 0.23]);
  b.box(team, [0, top + 0.064, -0.01], [0.24, 0.006, 0.17]);
  b.box(puff2, [0, top + 0.01, -0.14], [0.28, 0.12, 0.09]);
  b.box(PAL.steel, [0, (f.hipY + top) / 2, 0.128], [0.01, top - f.hipY, 0.004]);
  b.box(team, [0, top - 0.06, 0.132], [0.022, 0.035, 0.006]);
  // ёжик
  const buzz = col('#2f241d');
  b.box(buzz, [0, hy + 0.142, -0.01], [0.276, 0.02, 0.256]);
  b.box(buzz, [0, hy + 0.07, -0.128], [0.27, 0.12, 0.01]);
  for (const s of [-1, 1]) b.box(buzz, [0.137 * s, hy + 0.075, -0.04], [0.006, 0.1, 0.15]);
  // веер чужих банковских карт в каждой руке, с чипами
  const cards = [col('#e5b53a'), col('#1fa463'), col('#202024'), col('#2c6fe0'), col('#c23a8f'), col('#e8e6e0')];
  const chip = col('#d9b25a');
  for (const [hd, s] of [[f.handL, 1], [f.handR, -1]] as const) {
    for (let k = 0; k < 4; k++) {
      const rot: V3 = [-0.45, 0, (k - 1.5) * 0.36 * s + 0.15 * s];
      const piv: V3 = [hd[0], hd[1] + 0.015, hd[2] + 0.04];
      const c = cards[(k + (s > 0 ? 0 : 3)) % cards.length];
      seg(b, c, piv, rot, [0, 0.07, k * 0.006], [0.095, 0.145, 0.006]);
      seg(b, chip, piv, rot, [-0.02, 0.1, k * 0.006 + 0.0035], [0.028, 0.022, 0.002]);
    }
  }
}

function bekhan(b: Builder, team: Col, dark: Col) {
  const f = figure(b, {
    top: team, pants: dark, stripe: PAL.white, shoe: C.shoeBlack, w: 1.1, lw: 1.05, hair: 'none',
    armL: { up: [-0.3, 0, -0.08], lo: [-1.35, 0, -0.5] },
    armR: { up: [-0.3, 0, 0.08], lo: [-1.35, 0, 0.5] },
  });
  // кепка-аэродром
  b.add(CYL12, C.cap, [0, 0.957, 0.045], [0.06, 0, 0], [0.5, 0.04, 0.47]);
  b.add(CYL12, C.cap, [0, 0.99, 0.0], [0, 0, 0], [0.3, 0.05, 0.28]);
  b.box(C.cap, [0, 1.02, 0], [0.04, 0.02, 0.04]);
  b.box(PAL.hair, [0, 0.75, 0.128], [0.13, 0.03, 0.02]); // усы
  // миска лагмана
  const bx = (f.handL[0] + f.handR[0]) / 2, by = (f.handL[1] + f.handR[1]) / 2 + 0.06, bz = (f.handL[2] + f.handR[2]) / 2 + 0.02;
  b.add(BOWL, PAL.white, [bx, by, bz], [0, 0, 0], [0.26, 0.1, 0.26]);
  b.add(CYL12, C.bowlBlue, [bx, by + 0.04, bz], [0, 0, 0], [0.265, 0.025, 0.265]);
  b.add(CYL12, C.noodle, [bx, by + 0.05, bz], [0, 0, 0], [0.22, 0.02, 0.22]);
  b.box(C.sauce, [bx - 0.04, by + 0.065, bz + 0.02], [0.06, 0.02, 0.05]);
  b.box(C.sauce, [bx + 0.05, by + 0.065, bz - 0.03], [0.05, 0.02, 0.05]);
  b.box(C.herb, [bx + 0.01, by + 0.068, bz + 0.05], [0.03, 0.015, 0.03]);
  b.box(C.herb, [bx + 0.03, by + 0.068, bz + 0.02], [0.025, 0.015, 0.025]);
  b.box(C.noodle, [bx - 0.01, by + 0.1, bz - 0.01], [0.012, 0.09, 0.012], [0.2, 0, 0.3]); // вилка с лапшой
  b.box(PAL.steel, [bx - 0.03, by + 0.165, bz - 0.02], [0.012, 0.07, 0.012], [0.2, 0, 0.3]);
}

function adam(b: Builder, team: Col) {
  figure(b, {
    top: team, pants: team, shoe: C.neon, w: 0.86, lw: 0.9, bare: true, shorts: true, beard: 'none', hair: 'short',
    legL: { up: [-0.95, 0, 0], lo: [-0.12, 0, 0] },
    legR: { up: [0.55, 0, 0], lo: [1.5, 0, 0] },
    armL: { up: [0.85, 0, -0.08], lo: [-0.2, 0, 0] },
    armR: { up: [-0.85, 0, 0.1], lo: [-2.0, 0, 0.1] },
  });
  b.box(PAL.white, [0, 0.875, 0], [0.282, 0.045, 0.262]); // повязка
  b.box(PAL.white, [-0.02, 0.86, -0.15], [0.03, 0.06, 0.05], [0.4, 0, 0]);
  b.box(PAL.white, [0, 0.48, 0.112], [0.17, 0.13, 0.008]); // номер
  glyphs(b, PAL.black, '11', [0, 0.48, 0.117], '+x', 0.08, 0.014, 0.005);
  b.box(lift(team, 0.6), [0, 0.32, 0], [0.315, 0.04, 0.225]); // пояс шорт
}

function mohmad(b: Builder, team: Col) {
  const suit = col('#737782');
  const f = figure(b, {
    top: suit, pants: suit, stripe: team, w: 1.12, lw: 1.08, beard: 'full', hair: 'short',
    armL: { up: [-2.6, 0, 0.28] },
    armR: { up: [-1.25, 0, 0.12] },
    legL: { up: [-0.12, 0, 0.05] }, legR: { up: [0.1, 0, -0.05] },
  });
  b.box(PAL.white, [0, 0.6, 0.112], [0.09, 0.06, 0.01]); // футболка в вороте
  b.box(PAL.hair, [0, 0.858, 0.128], [0.2, 0.03, 0.014]); // брови сдвинуты
  // в поднятой руке светится камень призыва
  const h = f.handL;
  b.add(ICO, C.ember, [h[0] + 0.02, h[1] + 0.1, h[2] + 0.03], [0.4, 0.3, 0], [0.13, 0.17, 0.13]);
  b.add(ICO, lift(C.stone[0], 0.9), [h[0] + 0.02, h[1] + 0.06, h[2] + 0.03], [0, 0.5, 0], [0.12, 0.08, 0.12]);
}

function golem(b: Builder, team: Col) {
  const S = C.stone;
  const crystal = lift(team, 1.7);
  // ноги-тумбы
  for (const s of [-1, 1]) {
    b.box(S[1], [0.2 * s, 0.17, 0], [0.26, 0.34, 0.28]);
    b.box(S[3], [0.21 * s, 0.05, 0.04], [0.32, 0.1, 0.36]);
  }
  b.box(S[3], [0, 0.4, -0.02], [0.6, 0.18, 0.4]);
  // валун-туловище, сутулый
  b.add(ICO, S[0], [0, 0.78, -0.04], [0.2, 0.3, 0], [1.0, 0.78, 0.74]);
  b.box(S[2], [0, 0.82, 0.22], [0.5, 0.36, 0.14], [0.15, 0, 0]);
  b.box(crystal, [0, 0.83, 0.295], [0.1, 0.16, 0.02], [0.15, 0, 0.785]); // руна в цвет села
  b.box(S[1], [-0.12, 0.62, 0.27], [0.2, 0.14, 0.1], [0, 0, 0.3]);
  // плечи и руки до земли
  for (const s of [-1, 1]) {
    b.add(ICO, S[2], [0.48 * s, 1.0, 0], [0.4, s, 0], [0.44, 0.4, 0.44]);
    b.box(S[1], [0.56 * s, 0.74, 0.04], [0.22, 0.38, 0.24], [0.12, 0, 0.12 * s]);
    b.box(S[0], [0.6 * s, 0.38, 0.1], [0.32, 0.36, 0.32], [0.08, 0, 0.05 * s]);
    b.box(S[3], [0.6 * s, 0.17, 0.12], [0.3, 0.1, 0.3]);
    b.box(C.moss, [0.48 * s, 1.17, -0.02], [0.2, 0.05, 0.2], [0, 0.3, 0]);
  }
  // голова-блок между плеч, щели глаз светятся
  b.box(S[2], [0, 1.13, 0.16], [0.38, 0.3, 0.32]);
  b.box(S[3], [0, 1.24, 0.29], [0.42, 0.08, 0.1]);
  b.box(C.eye, [-0.085, 1.155, 0.322], [0.1, 0.028, 0.01]);
  b.box(C.eye, [0.085, 1.155, 0.322], [0.1, 0.028, 0.01]);
  b.box(S[1], [0, 1.03, 0.3], [0.26, 0.06, 0.06]);
  b.box(C.moss, [0.05, 1.29, 0.12], [0.24, 0.04, 0.2]);
  // кристаллы растут из спины
  b.add(CONE6, crystal, [0.18, 1.2, -0.3], [-0.5, 0, -0.3], [0.12, 0.34, 0.12]);
  b.add(CONE6, crystal, [-0.12, 1.16, -0.34], [-0.6, 0, 0.35], [0.1, 0.26, 0.1]);
  b.add(CONE6, crystal, [0.0, 1.27, -0.22], [-0.25, 0, 0], [0.13, 0.4, 0.13]);
}

/** Пассажир у окна: голова чуть выступает из стекла, чтобы было видно, что едут пацаны. */
function rider(b: Builder, x: number, y: number, z: number, cap = false) {
  b.box(PAL.skin, [x, y, z], [0.15, 0.14, 0.13]);
  b.box(cap ? PAL.grey : PAL.hair, [x, y + 0.085, z], [0.152, 0.04, 0.135]);
}

function wheels(b: Builder, xs: number, zs: number[], r: number, wdt: number) {
  for (const z of zs) for (const s of [-1, 1]) {
    b.add(CYL8, C.tyre, [xs * s, r, z], [0, 0, Math.PI / 2], [r * 2, wdt, r * 2]);
    b.add(CYL6, C.hub, [(xs + wdt * 0.08) * s, r, z], [0, 0, Math.PI / 2], [r * 1.1, wdt, r * 1.1]);
  }
}

function taxi(b: Builder, team: Col) {
  const W = C.carWhite;
  b.box(W, [0, 0.29, 0], [0.74, 0.24, 1.72]);
  b.box(W, [0, 0.36, 0.64], [0.72, 0.1, 0.42]);
  b.box(PAL.glass, [0, 0.52, -0.08], [0.66, 0.24, 0.92]);
  b.box(W, [0, 0.645, -0.1], [0.62, 0.03, 0.78]);
  b.box(W, [0, 0.52, -0.08], [0.07, 0.24, 0.93]); // средняя стойка
  b.box(team, [0, 0.235, 0], [0.752, 0.06, 1.62]); // полоса в цвет села
  // шашечки на дверях
  for (let k = 0; k < 10; k++) {
    const z = -0.42 + k * 0.08;
    b.box(PAL.black, [0, k % 2 ? 0.345 : 0.305, z], [0.754, 0.04, 0.08]);
  }
  // гребешок «ТАКСИ»
  b.box(C.black, [0, 0.67, -0.05], [0.12, 0.02, 0.1]);
  b.box(C.checker, [0, 0.725, -0.05], [0.42, 0.11, 0.16]);
  for (let k = 0; k < 7; k++) {
    const x = -0.18 + k * 0.06;
    b.box(PAL.black, [x, k % 2 ? 0.703 : 0.743, -0.05], [0.06, 0.04, 0.166]);
  }
  wheels(b, 0.37, [0.52, -0.52], 0.135, 0.11);
  b.box(PAL.white, [-0.26, 0.31, 0.862], [0.14, 0.06, 0.02]);
  b.box(PAL.white, [0.26, 0.31, 0.862], [0.14, 0.06, 0.02]);
  b.box(PAL.white, [0, 0.23, 0.862], [0.22, 0.07, 0.02]);
  b.box(C.tail, [-0.28, 0.33, -0.862], [0.14, 0.06, 0.02]);
  b.box(C.tail, [0.28, 0.33, -0.862], [0.14, 0.06, 0.02]);
  b.box(C.bumper, [0, 0.19, 0.87], [0.74, 0.06, 0.04]);
  b.box(C.bumper, [0, 0.19, -0.87], [0.74, 0.06, 0.04]);
  // таксист и трое пацанов
  rider(b, 0.265, 0.5, 0.12);
  rider(b, -0.265, 0.5, 0.12, true);
  rider(b, 0.265, 0.5, -0.32, true);
  rider(b, -0.265, 0.5, -0.32);
  // локоть таксиста в окне
  b.box(team, [0.36, 0.44, 0.16], [0.12, 0.07, 0.15]);
  b.box(PAL.skin, [0.4, 0.44, 0.25], [0.06, 0.06, 0.06]);
}

function marshrutka(b: Builder, team: Col) {
  const Y = C.yellow;
  b.box(Y, [0, 0.35, 0], [0.86, 0.38, 2.26]);
  b.box(Y, [0, 0.74, -0.31], [0.84, 0.44, 1.63]);
  b.box(Y, [0, 0.585, 0.97], [0.82, 0.13, 0.32]); // капот
  // наклонная кабина + лобовое
  const cab: V3 = [0, 0.66, 0.525], rot: V3 = [-0.73, 0, 0];
  b.add(BOX, Y, cab, rot, [0.84, 0.48, 0.36]);
  seg(b, PAL.glass, cab, rot, [0, 0.01, 0.183], [0.76, 0.42, 0.01]);
  b.box(PAL.glass, [0, 0.76, 0.42], [0.85, 0.18, 0.2]);
  // окна салона, задняя дверь
  b.box(PAL.glass, [0, 0.79, -0.36], [0.852, 0.21, 1.42]);
  rider(b, 0.355, 0.77, 0.42); // водитель
  rider(b, 0.355, 0.77, -0.2, true);
  rider(b, -0.355, 0.77, -0.45);
  rider(b, 0.355, 0.77, -0.8);
  b.box(PAL.glass, [0, 0.79, -1.126], [0.68, 0.22, 0.01]);
  b.box(C.yellowRoof, [0, 0.975, -0.31], [0.8, 0.035, 1.58]);
  b.box(team, [0, 0.5, -0.02], [0.866, 0.065, 2.2]); // полоса в цвет села
  // табличка «150» на крыше и на борту у двери
  b.box(PAL.white, [0, 1.04, 0.43], [0.4, 0.13, 0.05]);
  glyphs(b, PAL.black, '150', [0, 1.04, 0.458], '+x', 0.09, 0.016, 0.006);
  b.box(PAL.white, [-0.43, 0.79, 0.12], [0.01, 0.13, 0.28]);
  glyphs(b, PAL.black, '150', [-0.436, 0.79, 0.12], '+z', 0.085, 0.015, 0.004);
  // перед/зад
  b.box(C.bumper, [0, 0.43, 1.134], [0.44, 0.1, 0.01]);
  b.box(PAL.white, [-0.3, 0.45, 1.134], [0.15, 0.08, 0.01]);
  b.box(PAL.white, [0.3, 0.45, 1.134], [0.15, 0.08, 0.01]);
  b.box(C.bumper, [0, 0.2, 1.14], [0.88, 0.08, 0.06]);
  b.box(C.bumper, [0, 0.2, -1.14], [0.88, 0.08, 0.06]);
  b.box(C.tail, [-0.34, 0.42, -1.132], [0.1, 0.12, 0.01]);
  b.box(C.tail, [0.34, 0.42, -1.132], [0.1, 0.12, 0.01]);
  b.box(C.bumper, [0.45, 0.66, 0.62], [0.06, 0.05, 0.03]); // зеркала
  b.box(C.bumper, [-0.45, 0.66, 0.62], [0.06, 0.05, 0.03]);
  wheels(b, 0.39, [0.72, -0.72], 0.16, 0.12);
}

function chicken(b: Builder, team: Col) {
  const W = C.chicken;
  b.add(ICO1, W, [0, 0.31, -0.03], [0, 0, 0], [0.36, 0.32, 0.46]);
  b.add(ICO, W, [0, 0.42, -0.24], [-0.6, 0, 0], [0.2, 0.24, 0.12]); // хвост
  b.add(ICO, lift(W, 0.86), [0, 0.5, -0.27], [-0.8, 0, 0], [0.12, 0.18, 0.08]);
  b.box(W, [0, 0.53, 0.14], [0.18, 0.2, 0.18]);
  for (let k = 0; k < 3; k++) b.box(C.comb, [0, 0.655 + (k === 1 ? 0.015 : 0), 0.08 + k * 0.05], [0.04, 0.07, 0.05]);
  b.box(C.beak, [0, 0.53, 0.265], [0.07, 0.05, 0.08]);
  b.box(C.comb, [0, 0.47, 0.235], [0.04, 0.06, 0.03]);
  b.box(PAL.black, [-0.091, 0.565, 0.18], [0.008, 0.035, 0.035]);
  b.box(PAL.black, [0.091, 0.565, 0.18], [0.008, 0.035, 0.035]);
  // бандана в цвет села, концы по ветру
  b.box(team, [0, 0.6, 0.14], [0.19, 0.045, 0.19]);
  b.box(team, [0.03, 0.59, 0.02], [0.03, 0.035, 0.12], [0.3, 0.4, 0]);
  b.box(team, [-0.02, 0.57, 0.02], [0.03, 0.035, 0.11], [0.6, -0.3, 0]);
  // крылья; правое держит игрушечный пистолет
  b.box(lift(W, 0.92), [0.18, 0.32, -0.04], [0.05, 0.17, 0.27], [0.1, 0, -0.08]);
  b.box(lift(W, 0.92), [-0.17, 0.33, 0.06], [0.05, 0.12, 0.28], [-0.2, 0, 0.15]);
  b.box(C.toy, [-0.2, 0.33, 0.21], [0.04, 0.05, 0.14]);
  b.box(C.toy, [-0.2, 0.29, 0.17], [0.035, 0.07, 0.035]);
  b.box(PAL.black, [-0.2, 0.33, 0.29], [0.03, 0.03, 0.02]);
  // лапы
  for (const s of [-1, 1]) {
    b.box(C.beak, [0.07 * s, 0.08, 0.0], [0.03, 0.16, 0.03]);
    b.box(C.beak, [0.07 * s, 0.01, 0.04], [0.09, 0.02, 0.1]);
  }
}

// ---- public API ---------------------------------------------------------------------------
export const HERO_TYPES = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

/** Merged vertex-coloured geometry for unit types 6..18 (instancing, like unitGeometry): 16–17 from props.ts, 18 (Амина) from girls.ts. */
export function heroGeometry(type: number, side: 0 | 1): THREE.BufferGeometry {
  if (type === 16 || type === 17) return propUnitGeometry(type, side);
  if (type === 18) return aminaGeometry(side);
  const b = new Builder();
  const team = PAL.side[side], dark = PAL.sideDark[side];
  switch (type) {
    case 6: chimaev(b, team); break;
    case 7: amin(b, team); break;
    case 8: admin(b, team); break;
    case 9: ersno(b, team); break;
    case 10: bekhan(b, team, dark); break;
    case 11: adam(b, team); break;
    case 12: mohmad(b, team); break;
    case 13: golem(b, team); break;
    case 14: if (side === 0) taxi(b, team); else marshrutka(b, team); break;
    case 15: chicken(b, team); break;
    default: b.box(team, [0, 0.5, 0], [0.4, 1, 0.3]);
  }
  const g = b.build();
  if (type === 11) g.rotateX(0.16); // спринтер наклонён вперёд
  // poses can lift or sink a foot: put the lowest point exactly on the ground
  g.computeBoundingBox();
  const lo = g.boundingBox!.min.y;
  if (Math.abs(lo) > 1e-4) { g.translate(0, -lo, 0); g.computeBoundingBox(); }
  g.computeBoundingSphere();
  return g;
}

/** Extra scale on top of the renderer's ×1.7 unit scale. */
export function heroScale(type: number, side: 0 | 1): number {
  if (type === 16 || type === 17) return propUnitScale(type, side);
  switch (type) {
    case 6: return 1.05;
    case 7: return 1.05;
    case 9: return 1.04;
    case 10: return 1.05;
    case 12: return 1.1;
    case 13: return 1.1;
    case 14: return side === 0 ? 1.0 : 0.85;
    case 15: return 0.72;
    default: return 1.0;
  }
}

const heights = new Map<number, number>();
/** Model-space top of the unit (before heroScale and the ×1.7 unit scale): for health bars. */
export function heroHeight(type: number, side: 0 | 1): number {
  if (type === 16 || type === 17) return propUnitHeight(type, side);
  const k = type * 2 + side;
  let h = heights.get(k);
  if (h === undefined) {
    const g = heroGeometry(type, side);
    h = g.boundingBox!.max.y;
    g.dispose();
    heights.set(k, h);
  }
  return h;
}

/** Vehicles: no leaning/rolling walk cycle in the renderer. */
export const isVehicle = (type: number) => type === 14 || type === 16;

// ---- street food and village decor ----------------------------------------------------------
/** Canvas texture that repaints itself once the web fonts it uses have loaded. */
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, fonts: string[]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const paint = () => { g.clearRect(0, 0, w, h); draw(g, w, h); tex.needsUpdate = true; };
  paint();
  const fs = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (fs && fonts.length) Promise.all(fonts.map(f => fs.load(f))).then(paint, () => { /* system font it is */ });
  return { tex, paint };
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

const DISPLAY = 'Unbounded, "Arial Black", sans-serif';
const HAND = 'Caveat, "Segoe Print", "Comic Sans MS", cursive';

function signPlane(tex: THREE.Texture, w: number, h: number) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
}

function solid(b: Builder) {
  const m = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function plasticChair(b: Builder, c: Col, x: number, z: number, ry: number) {
  const p: V3 = [x, 0, z], r: V3 = [0, ry, 0];
  seg(b, c, p, r, [0, 0.24, 0], [0.22, 0.03, 0.22]);
  seg(b, c, p, r, [0, 0.38, -0.1], [0.22, 0.26, 0.03]);
  seg(b, c, p, r, [-0.1, 0.12, 0], [0.025, 0.24, 0.2]);
  seg(b, c, p, r, [0.1, 0.12, 0], [0.025, 0.24, 0.2]);
}

function cafeTable(b: Builder, c: Col, x: number, z: number) {
  b.add(CYL12, c, [x, 0.42, z], [0, 0, 0], [0.52, 0.03, 0.52]);
  b.add(CYL8, c, [x, 0.21, z], [0, 0, 0], [0.06, 0.42, 0.06]);
  b.add(CYL8, c, [x, 0.015, z], [0, 0, 0], [0.3, 0.03, 0.3]);
}

/** The vertical doner: pole, stacked meat cone, tomato on top. Spin it with `rotation.y`. */
function donerSpit(scale = 1): THREE.Group {
  const b = new Builder();
  const browns = ['#9a5a2b', '#ad6a33', '#8b4e25', '#b8773d', '#94552a'].map(col);
  b.add(CYL8, PAL.steel, [0, 0.5, 0], [0, 0, 0], [0.035, 1.0, 0.035]);
  b.add(CYL12, PAL.steel, [0, 0.02, 0], [0, 0, 0], [0.34, 0.04, 0.34]); // поддон
  const n = 6;
  for (let k = 0; k < n; k++) {
    const r = 0.12 + (k / (n - 1)) * 0.085;
    b.add(new THREE.CylinderGeometry(r + 0.012, r, 0.11, 9), browns[k % browns.length], [0, 0.12 + k * 0.105, 0], [0, k * 0.7, 0]);
  }
  // поджаристые бока, чтобы было видно, что крутится
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    b.box(col('#5e3216'), [Math.sin(a) * 0.17, 0.42, Math.cos(a) * 0.17], [0.05, 0.5, 0.04], [0, a, -0.12]);
  }
  b.add(ICO, col('#e23b1b'), [0, 0.8, 0], [0, 0, 0], [0.13, 0.1, 0.13]); // помидор
  b.add(ICO, C.herb, [0, 0.86, 0], [0, 0, 0], [0.05, 0.04, 0.05]);
  const g = new THREE.Group();
  g.add(solid(b));
  g.scale.setScalar(scale);
  return g;
}

export interface DonerBey { group: THREE.Group; spit: THREE.Group; setSign(text: string): void }

/**
 * «Донер Бей»: the Grozny street-food pavilion at the north-west corner of the map.
 * About 4.4 × 3.6 units with the terrace, front (counter, sign) faces +z, ground at y=0.
 */
export function donerBey(): DonerBey {
  const group = new THREE.Group();
  const b = new Builder();
  const wall = col('#efe3c6'), wall2 = col('#d9c7a2'), roof = col('#5b5751'), trim = col('#b3261e'), trim2 = col('#f0b429');
  const pave = col('#a9a397'), steel = PAL.steel, dark = col('#3a2f28');
  const warm = glow(1.35, 1.05, 0.62);
  b.box(pave, [0, 0.04, 0.5], [4.4, 0.08, 3.6]);
  b.box(col('#8f897d'), [0, 0.085, -0.05], [3.9, 0.03, 2.4]);
  // зал (слева) и кухня (справа, с открытым окном раздачи)
  b.box(wall, [-0.75, 0.78, -0.05], [2.1, 1.4, 2.1]);
  b.box(wall, [1.05, 0.78, -0.4], [1.5, 1.4, 1.4]);
  b.box(wall, [1.78, 0.78, 0.65], [0.06, 1.4, 0.7]); // боковина ниши
  b.box(col('#cdb791'), [1.05, 0.78, 0.31], [1.44, 1.3, 0.02]); // задняя стенка ниши
  // плитка внизу
  b.box(trim, [-0.75, 0.22, 1.0], [2.12, 0.28, 0.04]);
  b.box(trim, [-1.81, 0.22, -0.05], [0.04, 0.28, 2.12]);
  // витрина зала: тёплый свет внутри
  b.box(warm, [-0.95, 0.82, 1.01], [1.5, 0.66, 0.03]);
  for (let k = 0; k < 4; k++) b.box(wall2, [-1.7 + k * 0.5, 0.82, 1.03], [0.05, 0.7, 0.03]);
  b.box(wall2, [-0.95, 0.5, 1.03], [1.55, 0.05, 0.04]);
  b.box(wall2, [-0.95, 1.16, 1.03], [1.55, 0.05, 0.04]);
  // дверь
  b.box(dark, [0.0, 0.62, 1.01], [0.42, 1.0, 0.04]);
  b.box(lift(warm, 0.85), [0.0, 0.66, 1.035], [0.32, 0.82, 0.01]);
  b.box(steel, [0.13, 0.62, 1.05], [0.03, 0.18, 0.02]);
  // маркиза в полоску над витриной
  for (let k = 0; k < 6; k++) {
    const x = -1.75 + 0.16 + k * 0.32;
    b.box(k % 2 ? PAL.white : trim, [x, 1.27, 1.25], [0.32, 0.035, 0.6], [0.42, 0, 0]);
    b.box(k % 2 ? PAL.white : trim, [x, 1.1, 1.53], [0.32, 0.1, 0.02]);
  }
  // крыша и фриз; над раздачей открыто, чтобы вертел было видно сверху
  b.box(roof, [-0.75, 1.52, -0.05], [2.2, 0.1, 2.35]);
  b.box(roof, [1.05, 1.52, -0.45], [1.6, 0.1, 1.6]);
  b.box(wall2, [-0.75, 1.47, 1.1], [2.2, 0.2, 0.06]);
  b.box(trim2, [-0.75, 1.4, 1.135], [2.2, 0.04, 0.02]);
  b.box(wall2, [1.05, 1.47, 0.36], [1.6, 0.2, 0.06]);
  b.box(trim2, [1.05, 1.4, 0.395], [1.6, 0.04, 0.02]);
  // прилавок
  b.box(col('#6e3d22'), [1.05, 0.34, 0.82], [1.44, 0.52, 0.34]);
  b.box(trim2, [1.05, 0.44, 0.995], [1.44, 0.06, 0.01]);
  b.box(steel, [1.05, 0.62, 0.8], [1.5, 0.04, 0.4]);
  // гриль-стенка за вертелом: светятся тэны
  const spitX = 0.62, spitZ = 0.68;
  b.box(col('#2a2724'), [spitX, 1.0, 0.36], [0.56, 0.8, 0.08]);
  for (let k = 0; k < 5; k++) b.box(C.ember, [spitX, 0.7 + k * 0.15, 0.405], [0.42, 0.05, 0.01]);
  // витрина с лавашами и касса
  b.box(steel, [1.45, 0.72, 0.72], [0.5, 0.18, 0.3]);
  b.box(glow(1.1, 1.2, 1.25), [1.45, 0.72, 0.875], [0.44, 0.13, 0.01]);
  for (let k = 0; k < 3; k++) b.box(col('#e8cf98'), [1.3 + k * 0.15, 0.85, 0.72], [0.12, 0.07, 0.2]);
  b.box(C.black, [1.68, 0.7, 0.62], [0.12, 0.1, 0.12]);
  // на крыше: вытяжка и кондиционер
  b.add(CYL8, steel, [1.3, 1.85, -0.6], [0, 0, 0], [0.18, 0.6, 0.18]);
  b.add(CYL8, steel, [1.3, 2.18, -0.6], [0, 0, 0], [0.28, 0.06, 0.28]);
  b.box(col('#e3e1dc'), [-1.2, 1.7, -0.7], [0.6, 0.3, 0.4]);
  b.box(col('#9a9892'), [-1.2, 1.7, -0.49], [0.4, 0.2, 0.02]);
  // каркас вывески на крыше
  b.box(col('#2b2622'), [0, 2.03, 0.1], [3.5, 0.86, 0.1]);
  b.box(col('#2b2622'), [-1.4, 1.62, 0.1], [0.08, 0.2, 0.08]);
  b.box(col('#2b2622'), [1.4, 1.62, 0.1], [0.08, 0.2, 0.08]);
  // уличный холодильник с напитками
  b.box(col('#d9dde0'), [-2.0, 0.58, 0.72], [0.36, 1.0, 0.34]);
  b.box(glow(1.05, 1.15, 1.25), [-2.0, 0.62, 0.895], [0.28, 0.8, 0.01]);
  const bottles = [col('#c42a1c'), col('#e88b1f'), col('#3b8f3a'), col('#2b5fb0')];
  for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) b.box(bottles[(r + k) % 4], [-2.08 + k * 0.08, 0.3 + r * 0.19, 0.9], [0.045, 0.12, 0.02]);
  // столики, один под зонтом
  const plastic = col('#f1f0ea');
  cafeTable(b, plastic, -1.25, 1.95);
  plasticChair(b, plastic, -1.6, 1.95, Math.PI / 2);
  plasticChair(b, plastic, -0.9, 1.95, -Math.PI / 2);
  plasticChair(b, plastic, -1.25, 2.3, Math.PI);
  b.add(CYL8, steel, [-1.25, 0.8, 1.95], [0, 0, 0], [0.03, 0.8, 0.03]);
  b.add(new THREE.ConeGeometry(0.62, 0.26, 8), trim, [-1.25, 1.25, 1.95]);
  b.add(new THREE.ConeGeometry(0.64, 0.05, 8), PAL.white, [-1.25, 1.1, 1.95]);
  cafeTable(b, plastic, 0.35, 1.95);
  plasticChair(b, plastic, 0.0, 1.95, Math.PI / 2);
  plasticChair(b, plastic, 0.7, 1.95, -Math.PI / 2);
  // урна и штендер
  b.add(CYL8, col('#3f6b3c'), [1.25, 0.19, 1.55], [0, 0, 0], [0.22, 0.34, 0.22]);
  b.box(C.black, [1.75, 0.32, 1.55], [0.36, 0.56, 0.03], [0.22, -0.3, 0]);
  b.box(C.black, [1.79, 0.32, 1.43], [0.36, 0.56, 0.03], [-0.22, -0.3, 0]);
  b.box(PAL.white, [1.7, 0.36, 1.6], [0.26, 0.04, 0.005], [0.22, -0.3, 0]);
  b.box(trim2, [1.7, 0.26, 1.62], [0.22, 0.04, 0.005], [0.22, -0.3, 0]);
  group.add(solid(b));

  // вертел (крутится)
  const spit = donerSpit(1.15);
  spit.position.set(spitX, 0.64, spitZ);
  group.add(spit);

  // вывеска с обеих сторон
  let text = 'ДОНЕР БЕЙ';
  const sign = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#b3261e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f0b429'; g.fillRect(0, h - 26, w, 12); g.fillRect(0, 14, w, 6);
    g.strokeStyle = '#fff3d6'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
    // значок: конус донера на вертеле
    const cx = 120, cy = h / 2 + 4;
    g.fillStyle = '#fff3d6'; g.fillRect(cx - 4, cy - 92, 8, 184);
    g.fillStyle = '#7a3c16';
    g.beginPath(); g.moveTo(cx - 54, cy - 70); g.lineTo(cx + 54, cy - 70); g.lineTo(cx + 34, cy + 66); g.lineTo(cx - 34, cy + 66); g.closePath(); g.fill();
    g.strokeStyle = '#c47a3a'; g.lineWidth = 7;
    for (let k = 0; k < 4; k++) { const y = cy - 46 + k * 30; g.beginPath(); g.moveTo(cx - 46 + k * 4, y); g.lineTo(cx + 46 - k * 4, y + 8); g.stroke(); }
    g.fillStyle = '#e23b1b'; g.beginPath(); g.arc(cx, cy - 84, 18, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff3d6';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    fitFont(g, text, '900', DISPLAY, 132, w - 300);
    g.fillText(text, w / 2 + 92, h / 2 + 6);
  }, ['900 120px Unbounded']);
  const front = signPlane(sign.tex, 3.36, 0.8);
  front.position.set(0, 2.03, 0.155);
  const back = signPlane(sign.tex, 3.36, 0.8);
  back.position.set(0, 2.03, 0.045); back.rotation.y = Math.PI;
  group.add(front, back);

  // меню над прилавком
  const menu = canvasTex(512, 256, (g, w) => {
    g.fillStyle = '#1f1b18'; g.fillRect(0, 0, w, 256);
    g.fillStyle = '#f0b429'; g.font = `800 34px ${DISPLAY}`; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText('МЕНЮ', 24, 36);
    const rows: [string, string][] = [['Донер', '280'], ['Шаурма', '250'], ['Шаурма XL', '350'], ['Айран', '70']];
    g.font = '600 30px "Golos Text", Arial, sans-serif';
    rows.forEach(([a, p], i) => {
      const y = 92 + i * 44;
      g.fillStyle = '#fff3d6'; g.textAlign = 'left'; g.fillText(a, 28, y);
      g.textAlign = 'right'; g.fillText(`${p} ₽`, w - 28, y);
    });
  }, ['800 34px Unbounded', '600 30px "Golos Text"']);
  const board = signPlane(menu.tex, 0.62, 0.31);
  board.position.set(1.36, 1.12, 0.325);
  group.add(board);

  return { group, spit, setSign(t: string) { text = t; sign.paint(); } };
}

/** «Фудзи»: Курчалой's own shawarma kiosk, with the sad note about shawarma in batter. ~2.4 wide.
 *  Its small spit is `group.userData.spit` (spin it like donerBey().spit). */
export function fudzi(): THREE.Group {
  const group = new THREE.Group();
  const b = new Builder();
  const panel = col('#eef1ef'), band = col('#2f8a8a'), roof = col('#3f4447'), steel = PAL.steel, hole = col('#3b2b22');
  b.box(col('#a39d91'), [0, 0.04, 0.25], [2.4, 0.08, 2.0]);
  b.box(panel, [0, 0.7, 0], [1.8, 1.24, 1.2]);
  b.box(band, [0, 0.24, 0], [1.82, 0.3, 1.22]);
  b.box(band, [0, 1.25, 0], [1.82, 0.06, 1.22]);
  b.box(roof, [0, 1.36, 0.05], [2.0, 0.08, 1.42]);
  // окно раздачи: рамка, тёмный проём, полочка
  b.box(steel, [0.2, 0.86, 0.605], [1.06, 0.6, 0.01]);
  b.box(hole, [0.2, 0.86, 0.612], [0.98, 0.53, 0.006]);
  b.box(glow(1.0, 0.82, 0.55), [0.2, 1.08, 0.616], [0.96, 0.05, 0.004]);
  b.box(steel, [0.2, 0.57, 0.72], [1.1, 0.04, 0.24]);
  b.box(col('#e8cf98'), [0.5, 0.61, 0.72], [0.22, 0.04, 0.14]);
  // дверь сбоку
  b.box(col('#c9cecc'), [0.91, 0.62, -0.15], [0.02, 0.95, 0.42]);
  b.box(steel, [0.925, 0.62, -0.02], [0.02, 0.12, 0.03]);
  // каркас вывески
  b.box(col('#2b2622'), [0, 1.66, 0.55], [1.86, 0.52, 0.08]);
  b.box(col('#2b2622'), [-0.7, 1.45, 0.55], [0.06, 0.12, 0.06]);
  b.box(col('#2b2622'), [0.7, 1.45, 0.55], [0.06, 0.12, 0.06]);
  // стул и ящик с бутылками
  plasticChair(b, band, -0.85, 1.05, 0.4);
  b.box(col('#b5452a'), [0.95, 0.12, 0.95], [0.34, 0.2, 0.26]);
  for (let k = 0; k < 3; k++) b.add(CYL8, col('#5a3a22'), [0.85 + k * 0.1, 0.28, 0.95], [0, 0, 0], [0.05, 0.16, 0.05]);
  group.add(solid(b));

  const spit = donerSpit(0.42);
  spit.position.set(-0.08, 0.59, 0.72);
  group.add(spit);
  group.userData.spit = spit; // можно крутить, как у Донер Бея

  const sign = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#fbfaf5'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2f8a8a'; g.fillRect(0, h - 14, w, 14);
    // гора со снежной шапкой и красное солнце
    const mx = 70, my = h - 22;
    g.fillStyle = '#4f6f8f'; g.beginPath(); g.moveTo(mx - 52, my); g.lineTo(mx, my - 78); g.lineTo(mx + 52, my); g.closePath(); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(mx - 18, my - 51); g.lineTo(mx, my - 78); g.lineTo(mx + 18, my - 51); g.lineTo(mx + 7, my - 56); g.lineTo(mx, my - 49); g.lineTo(mx - 8, my - 56); g.closePath(); g.fill();
    g.fillStyle = '#d32a1c'; g.beginPath(); g.arc(mx + 34, my - 70, 11, 0, Math.PI * 2); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    fitFont(g, 'ФУДЗИ', '900', DISPLAY, 84, w - 170);
    g.fillText('ФУДЗИ', w / 2 + 55, h / 2 - 2);
  }, ['900 80px Unbounded']);
  const s1 = signPlane(sign.tex, 1.8, 0.45);
  s1.position.set(0, 1.66, 0.595);
  const s2 = signPlane(sign.tex, 1.8, 0.45);
  s2.position.set(0, 1.66, 0.505); s2.rotation.y = Math.PI;
  group.add(s1, s2);

  // грустная записка, приклеенная скотчем
  const note = canvasTex(256, 192, (g, w, h) => {
    g.fillStyle = '#fffdf3'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#a9c4e8'; g.lineWidth = 2;
    for (let y = 40; y < h; y += 30) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = '#e59a9a'; g.beginPath(); g.moveTo(30, 0); g.lineTo(30, h); g.stroke();
    g.fillStyle = 'rgba(240, 220, 140, 0.8)'; g.fillRect(w / 2 - 34, 0, 68, 18);
    g.fillStyle = '#2141a8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 44px ${HAND}`;
    g.fillText('шаурма', w / 2 + 10, 58);
    g.fillText('в кляре', w / 2 + 10, 104);
    // грустная рожица ручкой
    g.strokeStyle = '#2141a8'; g.lineWidth = 4;
    const fx = w / 2 + 10, fy = 152;
    g.beginPath(); g.arc(fx, fy, 22, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(fx, fy + 16, 11, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    g.fillRect(fx - 10, fy - 9, 5, 6); g.fillRect(fx + 5, fy - 9, 5, 6);
  }, ['700 44px Caveat']);
  const paper = signPlane(note.tex, 0.48, 0.36);
  paper.position.set(-0.58, 0.9, 0.605); paper.rotation.z = 0.06;
  group.add(paper);
  return group;
}

/** Курчалой «КАЧАЛКА»: gym door with a sign, tractor tyre and barbell outside. ~3 wide. */
export function gym(): THREE.Group {
  const group = new THREE.Group();
  const b = new Builder();
  const conc = col('#b9b3a7'), conc2 = col('#a39d90'), steel = PAL.steel, team = PAL.side[1], metal = col('#55595d');
  b.box(conc2, [0, 0.04, 0.35], [3.0, 0.08, 2.5]);
  b.box(conc, [0, 0.68, 0], [2.7, 1.28, 1.7]);
  b.box(conc2, [0, 1.36, 0], [2.8, 0.1, 1.8]);
  b.box(conc2, [0, 0.22, 0.86], [2.7, 0.3, 0.03]);
  // железная дверь под козырьком
  b.box(col('#2c3237'), [0, 0.55, 0.86], [0.62, 0.95, 0.04]);
  b.box(col('#4d5961'), [0, 0.55, 0.885], [0.54, 0.86, 0.01]);
  b.box(steel, [0.2, 0.55, 0.9], [0.04, 0.14, 0.03]);
  b.box(col('#6b6f73'), [0, 1.08, 1.05], [1.0, 0.05, 0.42]);
  // окна с решёткой
  for (const x of [-0.9, 0.9]) {
    b.box(col('#33404a'), [x, 0.82, 0.855], [0.42, 0.3, 0.02]);
    for (let k = 0; k < 4; k++) b.box(C.black, [x - 0.15 + k * 0.1, 0.82, 0.87], [0.02, 0.32, 0.02]);
  }
  b.box(team, [0, 1.27, 0.86], [2.7, 0.08, 0.03]);
  // покрышка от трактора
  b.add(new THREE.TorusGeometry(0.3, 0.13, 5, 10), col('#202022'), [1.0, 0.13, 1.25], [Math.PI / 2, 0, 0]);
  // штанга на стойках
  b.add(CYL8, steel, [-0.85, 0.5, 1.3], [0, 0, Math.PI / 2], [0.03, 1.1, 0.03]);
  for (const s of [-1, 1]) {
    b.add(CYL12, C.black, [-0.85 + s * 0.42, 0.5, 1.3], [0, 0, Math.PI / 2], [0.32, 0.06, 0.32]);
    b.add(CYL12, team, [-0.85 + s * 0.48, 0.5, 1.3], [0, 0, Math.PI / 2], [0.24, 0.05, 0.24]);
    b.box(metal, [-0.85 + s * 0.3, 0.24, 1.3], [0.04, 0.48, 0.04]);
    b.box(metal, [-0.85 + s * 0.3, 0.02, 1.3], [0.2, 0.04, 0.2]);
  }
  // турник сбоку
  b.box(metal, [-1.55, 0.7, 0.2], [0.05, 1.4, 0.05]);
  b.box(metal, [-1.55, 0.7, 1.0], [0.05, 1.4, 0.05]);
  b.add(CYL8, steel, [-1.55, 1.38, 0.6], [Math.PI / 2, 0, 0], [0.035, 0.85, 0.035]);
  // каркас вывески на крыше
  b.box(C.black, [0, 1.72, 0.74], [2.1, 0.58, 0.08]);
  for (const x of [-0.8, 0.8]) b.box(C.black, [x, 1.45, 0.74], [0.06, 0.1, 0.06]);
  group.add(solid(b));
  const sign = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#d8361f'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff8ea'; g.lineWidth = 5; g.strokeRect(8, 8, w - 16, h - 16);
    // гантель
    g.fillStyle = '#fff8ea';
    g.fillRect(28, h / 2 - 5, 74, 10);
    g.fillRect(30, h / 2 - 26, 14, 52); g.fillRect(86, h / 2 - 26, 14, 52);
    g.fillRect(20, h / 2 - 18, 8, 36); g.fillRect(102, h / 2 - 18, 8, 36);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    fitFont(g, 'КАЧАЛКА', '900', DISPLAY, 72, w - 160);
    g.fillText('КАЧАЛКА', w / 2 + 52, h / 2 + 3);
  }, ['900 72px Unbounded']);
  const s1 = signPlane(sign.tex, 2.0, 0.5);
  s1.position.set(0, 1.72, 0.785);
  const s2 = signPlane(sign.tex, 2.0, 0.5);
  s2.position.set(0, 1.72, 0.695); s2.rotation.y = Math.PI;
  group.add(s1, s2);
  return group;
}

/** Атаги «ТАКСИ»: a stand with a bench under a shelter and a checker sign. ~2.4 wide. */
export function taxiStand(): THREE.Group {
  const group = new THREE.Group();
  const b = new Builder();
  const team = PAL.side[0], post = col('#5d6066'), steel = PAL.steel, wood = col('#8a5a35');
  b.box(col('#a9a397'), [0, 0.03, 0.1], [2.4, 0.06, 1.2]);
  b.box(col('#d8d2c4'), [0, 0.07, 0.62], [2.4, 0.08, 0.1]); // бордюр
  // навес
  for (const x of [-0.75, 0.75]) b.box(post, [x, 0.6, -0.25], [0.06, 1.1, 0.06]);
  b.box(team, [0, 1.16, -0.05], [1.8, 0.06, 0.75], [-0.08, 0, 0]);
  b.box(col('#c9d6e0'), [0, 0.68, -0.28], [1.5, 0.75, 0.02]);
  // скамейка
  b.box(wood, [0, 0.32, -0.08], [1.25, 0.05, 0.3]);
  b.box(wood, [0, 0.5, -0.24], [1.25, 0.18, 0.04]);
  for (const x of [-0.5, 0.5]) b.box(post, [x, 0.16, -0.08], [0.05, 0.3, 0.26]);
  // столб с табличкой
  b.add(CYL8, steel, [1.0, 0.85, 0.35], [0, 0, 0], [0.05, 1.7, 0.05]);
  b.box(C.black, [1.0, 1.42, 0.35], [0.82, 0.52, 0.04]);
  group.add(solid(b));
  const sign = canvasTex(256, 160, (g, w, h) => {
    g.fillStyle = '#f5c518'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#111';
    for (let r = 0; r < 2; r++) for (let k = 0; k < 16; k++) if ((k + r) % 2 === 0) { g.fillRect(k * 16, r * 16, 16, 16); g.fillRect(k * 16, h - 32 + r * 16, 16, 16); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    fitFont(g, 'ТАКСИ', '900', DISPLAY, 60, w - 24);
    g.fillText('ТАКСИ', w / 2, h / 2 - 12);
    g.font = '700 26px "Golos Text", Arial, sans-serif';
    g.fillText('по 100 ₽', w / 2, h / 2 + 30);
  }, ['900 60px Unbounded', '700 26px "Golos Text"']);
  const s1 = signPlane(sign.tex, 0.78, 0.48);
  s1.position.set(1.0, 1.42, 0.374);
  const s2 = signPlane(sign.tex, 0.78, 0.48);
  s2.position.set(1.0, 1.42, 0.326); s2.rotation.y = Math.PI;
  group.add(s1, s2);
  return group;
}
