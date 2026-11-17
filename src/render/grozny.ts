// v4: Grozny. New unit models (ИПИТовец, Оператор, Стукач с комиссионки, Квадрик, Синяя бэха), the
// Grozny landmarks (ГГНТУ, ЧГУ, ЖК «Шайба», Ансар, the «Принглс» easter egg) and the city-fill
// apartment blocks. Same chibi low-poly, flat-shaded, vertex-coloured style as models.ts / heroes.ts /
// props.ts: a unit merges into one geometry so a crowd instances cheaply, a building is one solid
// mesh plus canvas sign planes that repaint when the web fonts load. Everything faces +z and stands
// on y = 0.
import * as THREE from 'three';
import { Builder, PAL } from './models';
import { body, strokeText, type V3, type Face } from './props';

type Col = THREE.Color;
const col = (s: string) => new THREE.Color(s);
/** Linear colour above 1.0: on Lambert + ACES it reads as self-lit (screens, lamps, LEDs). */
const glow = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const lift = (c: Col, k: number) => new THREE.Color(c.r * k, c.g * k, c.b * k);

const BOX = new THREE.BoxGeometry(1, 1, 1);
const PLANE = new THREE.PlaneGeometry(1, 1);
const CYL6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const CYL8 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const CYL12 = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const ICO = new THREE.IcosahedronGeometry(0.5, 0);
const HALF_PI = Math.PI / 2;

// ---- small geometry helpers (same conventions as props.ts) -------------------------------------
const _e = new THREE.Euler(), _v = new THREE.Vector3();
/** A primitive in a limb frame: pivot + rotation, `at` is its centre in that frame. */
function seg(b: Builder, c: Col, piv: V3, rot: V3, at: V3, size: V3, g: THREE.BufferGeometry = BOX): V3 {
  _e.set(rot[0], rot[1], rot[2]);
  _v.set(at[0], at[1], at[2]).applyEuler(_e);
  const p: V3 = [piv[0] + _v.x, piv[1] + _v.y, piv[2] + _v.z];
  b.add(g, c, p, rot, size);
  return p;
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
const trisOf = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

const FACES: Record<Face, { u: V3; v: V3; n: V3; r: V3 }> = {
  '+z': { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1], r: [0, 0, 0] },
  '-z': { u: [-1, 0, 0], v: [0, 1, 0], n: [0, 0, -1], r: [0, Math.PI, 0] },
  '+x': { u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0], r: [0, HALF_PI, 0] },
  '-x': { u: [0, 0, 1], v: [0, 1, 0], n: [-1, 0, 0], r: [0, -HALF_PI, 0] },
  '+y': { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0], r: [-HALF_PI, 0, 0] },
};

/** Two triangles, p0..p3 counter-clockwise as seen from the side they face. */
function quad(b: Builder, c: Col, p0: V3, p1: V3, p2: V3, p3: V3) {
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  for (const p of [p0, p1, p2, p0, p2, p3]) {
    b.pos.push(p[0], p[1], p[2]); b.nor.push(nx, ny, nz); b.col.push(c.r, c.g, c.b);
  }
}

/** Like quad(), but turned to face `want` whatever order the corners come in (curved bands, mirrored sides). */
function quadFacing(b: Builder, c: Col, want: V3, p0: V3, p1: V3, p2: V3, p3: V3) {
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
  const d = (ay * bz - az * by) * want[0] + (az * bx - ax * bz) * want[1] + (ax * by - ay * bx) * want[2];
  if (d >= 0) quad(b, c, p0, p1, p2, p3); else quad(b, c, p0, p3, p2, p1);
}

/** A flat rectangle (2 triangles) on an axis-aligned face, `lift` in front of `centre`. */
function flat(b: Builder, c: Col, centre: V3, face: Face, w: number, h: number, lift = 0.002) {
  const F = FACES[face];
  const p: V3 = [centre[0] + F.n[0] * lift, centre[1] + F.n[1] * lift, centre[2] + F.n[2] * lift];
  const at = (du: number, dv: number): V3 => [p[0] + F.u[0] * du + F.v[0] * dv, p[1] + F.u[1] * du + F.v[1] * dv, p[2] + F.u[2] * du + F.v[2] * dv];
  quad(b, c, at(-w / 2, -h / 2), at(w / 2, -h / 2), at(w / 2, h / 2), at(-w / 2, h / 2));
}

/** A stroke between two points (u, v) on a face around `centre`: lettering, code glyphs, cracks. */
function stroke(b: Builder, c: Col, centre: V3, face: Face, u0: number, v0: number, u1: number, v1: number, th: number, lift = 0.003) {
  const F = FACES[face];
  const du = u1 - u0, dv = v1 - v0, len = Math.hypot(du, dv) || 1;
  const nu = -dv / len * th / 2, nv = du / len * th / 2;
  const at = (u: number, v: number): V3 => [0, 1, 2].map(a => centre[a] + F.u[a] * u + F.v[a] * v + F.n[a] * lift) as V3;
  quad(b, c, at(u0 - nu, v0 - nv), at(u1 - nu, v1 - nv), at(u1 + nu, v1 + nv), at(u0 + nu, v0 + nv));
}

/** Hip roof with a ridge along x (w ≥ d): 4 sloped faces, no bottom. */
function hipRoof(b: Builder, c: Col, cx: number, y: number, cz: number, w: number, d: number, h: number) {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const r = Math.max(0, w / 2 - d / 2);
  const ra: V3 = [cx - r, y + h, cz], rb: V3 = [cx + r, y + h, cz];
  quad(b, c, [x0, y, z1], [x1, y, z1], rb, ra); // front
  quad(b, c, [x1, y, z0], [x0, y, z0], ra, rb); // back
  quad(b, c, [x1, y, z1], [x1, y, z0], rb, rb); // right hip
  quad(b, c, [x0, y, z0], [x0, y, z1], ra, ra); // left hip
}

// ---- canvas signs (repaint once the web fonts are in) ---------------------------------------
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
  return tex;
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

interface SignStyle { bg: string; fg: string; border?: string; sub?: string; subFg?: string }
function signTex(text: string, st: SignStyle, w = 512, h = 128) {
  return canvasTex(w, h, g => {
    g.fillStyle = st.bg; g.fillRect(0, 0, w, h);
    if (st.border) { g.strokeStyle = st.border; g.lineWidth = Math.max(4, h * 0.045); g.strokeRect(h * 0.07, h * 0.07, w - h * 0.14, h - h * 0.14); }
    g.fillStyle = st.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const maxW = w - h * 0.4;
    if (st.sub) {
      fitFont(g, text, '900', DISPLAY, h * 0.48, maxW); g.fillText(text, w / 2, h * 0.4);
      g.fillStyle = st.subFg ?? st.fg; fitFont(g, st.sub, '700', TEXT, h * 0.22, maxW); g.fillText(st.sub, w / 2, h * 0.79);
    } else {
      fitFont(g, text, '900', DISPLAY, h * 0.62, maxW); g.fillText(text, w / 2, h * 0.54);
    }
  });
}

/** Sign plane facing +z of its parent, turned by `ry`. */
function addSign(group: THREE.Object3D, tex: THREE.Texture, w: number, h: number, p: V3, ry = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  m.position.set(p[0], p[1], p[2]); m.rotation.y = ry;
  group.add(m);
  return m;
}

const SOLID = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
function solid(g: THREE.BufferGeometry) {
  const m = new THREE.Mesh(g, SOLID);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ---- palette ------------------------------------------------------------------------------------
const K = {
  ink: col('#121214'), black: col('#17181b'), steel: PAL.steel, chrome: col('#d3d8de'), chromeD: col('#80868e'),
  tyre: col('#151517'), glass: col('#1c2733'), winDark: col('#34404a'), winBlue: col('#3d5a73'),
  pave: col('#a9a397'), pave2: col('#8f897d'), conc: col('#c4bdb0'), asphalt: col('#55575b'),
  grass: col('#5f9a45'), leaf: [col('#4f8a3a'), col('#5e9a40'), col('#3f7a35'), col('#76a948')], trunk: col('#6b4a31'), metal: col('#5d6066'),
  warm: glow(1.35, 1.05, 0.62), cool: glow(1.0, 1.15, 1.3), lamp: glow(2.1, 2.0, 1.8), code: glow(0.32, 1.9, 0.5),
  paper: col('#f4f1e8'), kraft: col('#c79f62'), bread: col('#d9a45a'),
};

// ======================================================================================
// UNITS
// ======================================================================================
export type V4UnitKey = 'ipit' | 'operator' | 'snitch' | 'drone' | 'bmw';
export const V4_UNIT_KEYS: V4UnitKey[] = ['ipit', 'operator', 'snitch', 'drone', 'bmw'];
export const V4_UNIT_NAMES: Record<V4UnitKey, string> = {
  ipit: 'ИПИТовец', operator: 'Оператор', snitch: 'Стукач с комиссионки', drone: 'Квадрик', bmw: 'Синяя бэха',
};

/** ИПИТовец: hoodie in the village colour, headphones, glasses, backpack, laptop shown to the enemy with green code. */
function ipit(b: Builder, team: Col) {
  const joggers = col('#2b2e36'), pack = col('#24262b'), cans = col('#141518'), hair = col('#231a14');
  const f = body(b, {
    top: team, cuff: lift(team, 0.7), pants: joggers, shoe: PAL.white, sole: col('#d6d2ca'), chunky: true, beard: 'none', lw: 0.96,
    legL: { up: [-0.16, 0, 0.02] }, legR: { up: [0.14, 0, -0.02] },
    armL: { up: [-0.62, 0, -0.08], lo: [-1.42, 0, -0.5] },
    armR: { up: [-0.62, 0, 0.08], lo: [-1.42, 0, 0.5] },
  });
  const hy = f.headY, top = f.topY, mid = (f.hipY + top) / 2;
  // худи: капюшон за спиной, карман-кенгуру, шнурки
  b.box(lift(team, 0.82), [0, top + 0.012, -0.105], [0.27, 0.09, 0.1]);
  flat(b, lift(team, 0.8), [0, f.hipY + 0.07, 0.11], '+z', 0.22, 0.09);
  for (const s of [-1, 1]) b.box(PAL.white, [0.035 * s, top - 0.06, 0.113], [0.012, 0.1, 0.006]);
  // рюкзак со стикером </>
  b.box(pack, [0, mid + 0.02, -0.19], [0.27, 0.3, 0.14]);
  b.box(lift(pack, 1.5), [0, mid - 0.05, -0.263], [0.21, 0.12, 0.02]);
  for (const s of [-1, 1]) {
    b.box(pack, [0.09 * s, top + 0.01, -0.03], [0.04, 0.025, 0.24]);
    b.box(pack, [0.09 * s, mid + 0.03, 0.113], [0.035, 0.26, 0.01]);
  }
  const st: V3 = [0, mid + 0.07, -0.261];
  for (const [u0, v0, u1, v1] of [[-0.075, 0, -0.04, 0.03], [-0.075, 0, -0.04, -0.03], [-0.015, -0.035, 0.015, 0.035], [0.075, 0, 0.04, 0.03], [0.075, 0, 0.04, -0.03]])
    stroke(b, team, st, '-z', u0, v0, u1, v1, 0.014);
  // лохматые волосы, очки, наушники
  b.box(hair, [0, hy + 0.15, -0.012], [0.285, 0.065, 0.27]);
  b.box(hair, [0.04, hy + 0.17, 0.08], [0.16, 0.05, 0.1], [-0.3, 0.3, 0.15]);
  b.box(hair, [-0.06, hy + 0.165, 0.1], [0.1, 0.04, 0.07], [-0.4, -0.3, -0.1]);
  b.box(hair, [0, hy + 0.05, -0.13], [0.276, 0.2, 0.02]);
  for (const s of [-1, 1]) {
    flat(b, K.ink, [0.062 * s, hy + 0.02, 0.125], '+z', 0.085, 0.065, 0.004);
    flat(b, col('#9fe0c4'), [0.062 * s, hy + 0.02, 0.125], '+z', 0.062, 0.042, 0.007);
    b.box(cans, [0.152 * s, hy + 0.11, -0.005], [0.022, 0.12, 0.04]);
    b.box(cans, [0.158 * s, hy - 0.005, 0], [0.05, 0.11, 0.11]);
    flat(b, team, [0.183 * s, hy - 0.005, 0], s > 0 ? '+x' : '-x', 0.07, 0.07);
  }
  flat(b, K.ink, [0, hy + 0.025, 0.125], '+z', 0.04, 0.012, 0.005);
  b.box(cans, [0, hy + 0.19, -0.005], [0.31, 0.028, 0.045]);
  // ноутбук: экраном к врагу (смотри, взломал), зелёный код
  const lx = (f.handL[0] + f.handR[0]) / 2, ly = (f.handL[1] + f.handR[1]) / 2 + 0.04, lz = (f.handL[2] + f.handR[2]) / 2;
  const z0 = lz - 0.06;
  b.box(col('#b9bec5'), [lx, ly, z0 + 0.11], [0.32, 0.02, 0.22]);
  flat(b, col('#2a2d33'), [lx, ly + 0.01, z0 + 0.13], '+y', 0.27, 0.12);
  const piv: V3 = [lx, ly + 0.01, z0], lr: V3 = [-0.22, 0, 0];
  seg(b, col('#b9bec5'), piv, lr, [0, 0.11, 0], [0.32, 0.22, 0.016]);
  seg(b, col('#0b1610'), piv, lr, [0, 0.112, 0.0095], [0.29, 0.19, 0.004]);
  const code: [number, number, number][] = [[-0.09, 0.19, 0.08], [-0.06, 0.165, 0.13], [-0.03, 0.14, 0.1], [-0.07, 0.115, 0.06], [-0.01, 0.09, 0.16], [-0.08, 0.065, 0.05], [-0.04, 0.04, 0.12]];
  for (const [x, y, w] of code) seg(b, K.code, piv, lr, [x + w / 2, y, 0.0125], [w, 0.012, 0.002]);
  seg(b, K.code, piv, lr, [0.1, 0.04, 0.0125], [0.02, 0.022, 0.002]); // курсор
}

/** Оператор: anonymous, gender-neutral. Dark hood up, the face is just shadow, a phone raised like a camera. */
function operator(b: Builder, team: Col) {
  // charcoal, not pure black: the folds still read under the game light
  const hood = col('#2c2e35'), hood2 = col('#383b44'), shadow = col('#060607');
  const f = body(b, {
    top: hood, cuff: team, pants: col('#2a2c33'), shoe: col('#151517'), sole: team, lw: 0.94, beard: 'none',
    legL: { up: [-0.12, 0, 0.04] }, legR: { up: [0.16, 0, -0.03] },
    armL: { up: [-1.45, 0, -0.28], lo: [-2.55, 0, -0.62] },
    armR: { up: [-1.45, 0, 0.28], lo: [-2.55, 0, 0.62] },
  });
  const hy = f.headY, top = f.topY;
  // капюшон поверх головы, лицо в тени, кант в цвет села
  b.box(hood, [0, hy + 0.018, -0.014], [0.33, 0.33, 0.3]);
  b.box(hood, [0, hy + 0.17, -0.05], [0.16, 0.06, 0.2], [0.35, 0, 0]);
  flat(b, shadow, [0, hy - 0.01, 0.136], '+z', 0.21, 0.22, 0.002);
  flat(b, team, [0, hy + 0.11, 0.136], '+z', 0.25, 0.024, 0.003);
  for (const s of [-1, 1]) flat(b, team, [0.115 * s, hy - 0.01, 0.136], '+z', 0.024, 0.25, 0.003);
  b.box(hood, [0, hy - 0.12, -0.135], [0.25, 0.16, 0.06]);
  // карман-кенгуру и шнурки
  flat(b, hood2, [0, f.hipY + 0.07, 0.11], '+z', 0.22, 0.09);
  for (const s of [-1, 1]) b.box(team, [0.04 * s, top - 0.06, 0.113], [0.012, 0.1, 0.006]);
  // телефон горизонтально перед лицом, в светлом чехле (читается на тёмном худи), вспышка смотрит на врага
  const px = (f.handL[0] + f.handR[0]) / 2, py = (f.handL[1] + f.handR[1]) / 2 + 0.04, pz = Math.max(f.handL[2], f.handR[2]) + 0.05;
  b.box(col('#d5d9df'), [px, py, pz], [0.21, 0.115, 0.02]);
  flat(b, glow(0.55, 1.25, 2.3), [px, py, pz - 0.01], '-z', 0.19, 0.095, 0.002);
  b.box(K.ink, [px + 0.06, py + 0.022, pz + 0.013], [0.07, 0.05, 0.008]);
  flat(b, col('#0a0a0b'), [px + 0.075, py + 0.022, pz + 0.018], '+z', 0.026, 0.026, 0.002);
  flat(b, glow(3.0, 2.9, 2.5), [px + 0.043, py + 0.022, pz + 0.018], '+z', 0.02, 0.02, 0.003);
  // большие пальцы держат телефон за края
  for (const s of [-1, 1]) b.box(PAL.skin, [px + 0.1 * s, py - 0.015, pz - 0.004], [0.03, 0.05, 0.035]);
}

/** Стукач с комиссионки: generic thin student in a too-big grey jacket, pointing, folder of зачётки under the arm. */
function snitch(b: Builder, team: Col) {
  const suit = col('#8c9097'), suitD = col('#6d7178'), shirt = col('#f2efe8'), trousers = col('#3b4050'), shoe = col('#5a3a24'), hair = col('#2a1e16');
  const W = 0.84;
  const f = body(b, {
    top: suit, pants: trousers, shoe, w: W, lw: 0.82, leg: 1.06, torso: 1.04, beard: 'none', eyes: 'brown',
    legL: { up: [0.02, 0, 0.03] }, legR: { up: [-0.03, 0, -0.03] },
    armL: { up: [0.05, 0, 0.2], lo: [-1.15, 0, 0.12] },
    armR: { up: [-1.5, 0, 0.04] },
  });
  const hy = f.headY, top = f.topY, tw = 0.36 * W;
  // пиджак на три размера больше: длинный, плечи торчат
  b.box(suit, [0, (f.hipY - 0.12 + top) / 2, -0.004], [tw + 0.07, top - f.hipY + 0.12, 0.26]);
  for (const s of [-1, 1]) b.box(suit, [0.155 * s, f.shY + 0.005, 0], [0.12, 0.07, 0.25]);
  // рубашка, галстук в цвет села, лацканы, пуговицы
  flat(b, shirt, [0, top - 0.07, 0.126], '+z', 0.085, 0.14);
  flat(b, team, [0, top - 0.09, 0.126], '+z', 0.028, 0.15, 0.004);
  flat(b, lift(team, 0.75), [0, top - 0.018, 0.126], '+z', 0.04, 0.03, 0.005);
  for (const s of [-1, 1]) stroke(b, suitD, [0, 0, 0.126], '+z', 0.05 * s, top - 0.005, 0.03 * s, top - 0.16, 0.035, 0.004);
  for (let k = 0; k < 2; k++) flat(b, K.ink, [0, f.hipY + 0.03 + k * 0.07, 0.126], '+z', 0.018, 0.018, 0.004);
  // белые носки из-под коротких брюк
  for (const s of [-1, 1]) b.box(PAL.white, [0.08 * s * 0.82, 0.078, 0], [0.105, 0.032, 0.15]);
  // указывает пальцем
  const hr = f.handR;
  seg(b, PAL.skin, hr, [-1.5, 0, 0.04], [0, -0.06, 0.01], [0.022, 0.08, 0.022]);
  seg(b, PAL.skin, hr, [-1.5, 0, 0.04], [0.03, -0.015, 0.02], [0.02, 0.04, 0.02]);
  // папка с зачётками под мышкой
  const hl = f.handL;
  const fx = hl[0] + 0.045, fy = hl[1] + 0.1, fz = hl[2] - 0.07;
  b.box(team, [fx, fy, fz], [0.028, 0.24, 0.32]);
  const zb = col('#1f3a7a');
  for (let k = 0; k < 3; k++) b.box(k === 1 ? col('#2b4f95') : zb, [fx, fy + 0.13 + (k % 2) * 0.015, fz - 0.08 + k * 0.08], [0.02, 0.05, 0.065]);
  // аккуратный пробор, бровь домиком, ухмылка
  b.box(hair, [0, hy + 0.15, -0.012], [0.284, 0.06, 0.27]);
  b.box(hair, [-0.04, hy + 0.168, 0.04], [0.2, 0.04, 0.2], [0, 0, -0.12]);
  b.box(hair, [0, hy + 0.05, -0.13], [0.276, 0.2, 0.02]);
  for (const s of [-1, 1]) b.box(hair, [0.138 * s, hy + 0.09, -0.03], [0.012, 0.1, 0.19]);
  stroke(b, hair, [0, hy, 0.125], '+z', -0.09, 0.07, -0.035, 0.07, 0.016, 0.004);
  stroke(b, hair, [0, hy, 0.125], '+z', 0.035, 0.065, 0.09, 0.09, 0.016, 0.004);
  stroke(b, col('#7a3f2a'), [0, hy, 0.125], '+z', -0.03, -0.075, 0.04, -0.06, 0.012, 0.004);
}

/** Rotor hubs of the quadcopter in model space (before the unit scale and the hover lift). */
const DRONE_H = 0.6;
export const V4_DRONE_ROTORS: V3[] = [[0.3, DRONE_H + 0.085, 0.27], [-0.3, DRONE_H + 0.085, 0.27], [0.3, DRONE_H + 0.085, -0.27], [-0.3, DRONE_H + 0.085, -0.27]];

/** Квадрик: hobby quadcopter, LED arms in the village colour, camera gimbal; carries конспекты (Атаги) or шаурма (Курчалой). */
function drone(b: Builder, team: Col, side: 0 | 1) {
  const shell = col('#ecebe7'), shell2 = col('#c4c7cc'), dark = col('#26282d'), led = lift(team, 2.2), blur = col('#d9dde2');
  const H = DRONE_H;
  b.box(shell, [0, H, 0], [0.24, 0.09, 0.36]);
  b.box(shell2, [0, H + 0.055, -0.02], [0.18, 0.035, 0.26]);
  b.box(dark, [0, H - 0.055, -0.01], [0.17, 0.03, 0.26]);
  flat(b, led, [0, H, 0.18], '+z', 0.12, 0.02, 0.002);
  for (const [x, y, z] of V4_DRONE_ROTORS) {
    const L = Math.hypot(x, z), ry = Math.atan2(x, z);
    b.add(BOX, shell2, [x / 2, H + 0.01, z / 2], [0, ry, 0], [0.045, 0.035, L]);
    b.add(BOX, led, [x * 0.55, H + 0.03, z * 0.55], [0, ry, 0], [0.02, 0.006, L * 0.62]);
    b.add(CYL8, dark, [x, H + 0.035, z], [0, 0, 0], [0.075, 0.07, 0.075]);
    b.add(CYL6, led, [x, H - 0.005, z], [0, 0, 0], [0.04, 0.012, 0.04]);
    // размытый диск винта + две «лопасти»
    b.add(new THREE.RingGeometry(0.05, 0.2, 12), blur, [x, y, z], [-HALF_PI, 0, 0]);
    const a = (x > 0 ? 0.4 : 1.2) + (z > 0 ? 0 : 0.7);
    b.add(PLANE, col('#7d828a'), [x, y + 0.002, z], [-HALF_PI, 0, a], [0.38, 0.022, 1]);
  }
  // подвес с камерой
  b.box(dark, [0, H - 0.085, 0.15], [0.04, 0.04, 0.04]);
  b.box(dark, [0, H - 0.125, 0.155], [0.085, 0.07, 0.075]);
  flat(b, col('#0b1118'), [0, H - 0.125, 0.193], '+z', 0.045, 0.045, 0.002);
  flat(b, glow(0.6, 1.0, 1.8), [0, H - 0.125, 0.193], '+z', 0.016, 0.016, 0.004);
  // полозья
  for (const s of [-1, 1]) {
    b.box(dark, [0.085 * s, H - 0.105, 0.07], [0.014, 0.09, 0.014]);
    b.box(dark, [0.085 * s, H - 0.105, -0.09], [0.014, 0.09, 0.014]);
    b.box(dark, [0.085 * s, H - 0.155, -0.01], [0.016, 0.016, 0.3]);
  }
  // груз на верёвочке
  b.box(K.paper, [0, H - 0.27, -0.02], [0.006, 0.24, 0.006]);
  if (side === 1) {
    // пакет с шаурмой
    b.box(K.kraft, [0, 0.1, -0.02], [0.17, 0.2, 0.11]);
    b.box(lift(K.kraft, 0.85), [0, 0.215, -0.02], [0.17, 0.03, 0.06]);
    b.add(CYL8, K.bread, [0.03, 0.19, 0.0], [0.5, 0, 0.3], [0.07, 0.16, 0.07]);
    b.add(CYL8, col('#f3efe3'), [0.055, 0.265, 0.035], [0.5, 0, 0.3], [0.072, 0.02, 0.072]);
    flat(b, team, [0, 0.11, 0.035], '+z', 0.09, 0.05);
  } else {
    // пачка конспектов, перетянутая лентой в цвет села
    b.box(K.paper, [0, 0.055, -0.02], [0.2, 0.11, 0.15]);
    for (let k = 0; k < 3; k++) flat(b, col('#c9c3b4'), [0, 0.025 + k * 0.03, 0.055], '+z', 0.19, 0.006);
    b.box(team, [0, 0.055, -0.02], [0.03, 0.115, 0.155]);
    b.box(team, [0, 0.055, -0.02], [0.205, 0.115, 0.03]);
    b.box(K.paper, [0.06, 0.125, 0.02], [0.13, 0.008, 0.1], [0, 0.4, 0.1]);
  }
}

/** Синяя бэха: generic sporty blue sedan (no roundel), low, wide hips, quad exhaust, «380i» on the boot. */
function bmw(b: Builder, team: Col) {
  const P = col('#1d4fb3'), P2 = col('#173f8f'), glass = col('#141c26'), rim = col('#b7bcc3');
  const W = 0.78;
  // боковой профиль кузова, выдавленный по ширине
  const prof = new THREE.Shape();
  const pts: [number, number][] = [[-0.9, 0.12], [-0.925, 0.28], [-0.9, 0.4], [-0.86, 0.43], [-0.5, 0.44], [0.3, 0.44], [0.72, 0.4], [0.9, 0.35], [0.935, 0.27], [0.91, 0.12]];
  prof.moveTo(pts[0][0], pts[0][1]);
  for (const [z, y] of pts.slice(1)) prof.lineTo(z, y);
  const bodyG = new THREE.ExtrudeGeometry(prof, { depth: W, bevelEnabled: false });
  b.add(bodyG, P, [W / 2, 0, 0], [0, -HALF_PI, 0]);
  bodyG.dispose();
  // стеклянная крыша-«капля»
  const gh = new THREE.Shape();
  const gp: [number, number][] = [[-0.6, 0.43], [-0.36, 0.615], [0.04, 0.63], [0.34, 0.43]];
  gh.moveTo(gp[0][0], gp[0][1]);
  for (const [z, y] of gp.slice(1)) gh.lineTo(z, y);
  const ghG = new THREE.ExtrudeGeometry(gh, { depth: W - 0.1, bevelEnabled: false });
  b.add(ghG, glass, [(W - 0.1) / 2, 0, 0], [0, -HALF_PI, 0]);
  ghG.dispose();
  b.box(P, [0, 0.632, -0.155], [W - 0.13, 0.018, 0.36]);
  for (const s of [-1, 1]) {
    const x = ((W - 0.1) / 2) * s, f: Face = s > 0 ? '+x' : '-x';
    flat(b, P, [x, 0.53, -0.14], f, 0.07, 0.19, 0.003); // стойка B
    flat(b, P2, [x, 0.455, -0.13], f, 0.92, 0.025, 0.003);
    // широкие бёдра и передние крылья
    b.box(P, [0.395 * s, 0.27, -0.53], [0.06, 0.15, 0.46]);
    b.box(P, [0.39 * s, 0.27, 0.56], [0.045, 0.13, 0.4]);
    // порог с полосой в цвет села, зеркала с крышками в цвет села
    b.box(K.black, [0.395 * s, 0.14, 0.01], [0.04, 0.05, 0.62]);
    flat(b, team, [0.415 * s, 0.155, 0.01], f, 0.6, 0.02, 0.002);
    b.box(P, [0.415 * s, 0.47, 0.3], [0.06, 0.045, 0.07]);
    flat(b, team, [0.445 * s, 0.47, 0.3], f, 0.065, 0.04, 0.002);
    // колёса: широкие задние
    for (const [z, w] of [[0.56, 0.13], [-0.54, 0.16]] as const) {
      b.add(CYL12, K.tyre, [0.36 * s, 0.15, z], [0, 0, HALF_PI], [0.3, w, 0.3]);
      b.add(CYL8, rim, [(0.36 + w / 2 - 0.005) * s, 0.15, z], [0, 0, HALF_PI], [0.2, 0.012, 0.2]);
      flat(b, K.ink, [(0.36 + w / 2 + 0.002) * s, 0.15, z], f, 0.05, 0.05, 0.002);
    }
  }
  // морда: две ноздри решётки, угловатые фары, воздухозаборник
  for (const s of [-1, 1]) {
    b.box(K.chrome, [0.07 * s, 0.31, 0.918], [0.12, 0.085, 0.02]);
    b.box(K.ink, [0.07 * s, 0.31, 0.924], [0.095, 0.065, 0.02]);
    stroke(b, K.lamp, [0, 0, 0.93], '+z', 0.17 * s, 0.355, 0.35 * s, 0.335, 0.035, 0.003);
    flat(b, K.lamp, [0.3 * s, 0.32, 0.932], '+z', 0.06, 0.02, 0.003);
  }
  flat(b, K.ink, [0, 0.19, 0.913], '+z', 0.6, 0.07, 0.004);
  // корма: L-образные фонари, диффузор, четыре трубы, шильдик «380i»
  for (const s of [-1, 1]) {
    flat(b, col('#b3241a'), [0.28 * s, 0.37, -0.903], '-z', 0.2, 0.05, 0.004);
    flat(b, col('#b3241a'), [0.355 * s, 0.33, -0.912], '-z', 0.05, 0.06, 0.004);
    flat(b, glow(1.7, 0.28, 0.16), [0.28 * s, 0.372, -0.903], '-z', 0.17, 0.016, 0.007);
    for (const dx of [0.2, 0.29]) b.add(CYL6, K.chrome, [dx * s, 0.135, -0.915], [HALF_PI, 0, 0], [0.055, 0.06, 0.055]);
  }
  flat(b, K.ink, [0, 0.14, -0.913], '-z', 0.74, 0.06, 0.004);
  const badge: V3 = [-0.2, 0.355, -0.9];
  strokeText(b, K.chrome, '380', badge, '-z', 0.045, { th: 0.009, w: 0.026, gap: 0.009, lift: 0.006 });
  flat(b, K.chrome, [-0.2 - 0.06, 0.348, -0.9], '-z', 0.009, 0.03, 0.006);
  flat(b, K.chrome, [-0.2 - 0.06, 0.371, -0.9], '-z', 0.009, 0.009, 0.006);
  // плавник антенны
  b.box(K.ink, [0, 0.655, -0.29], [0.04, 0.035, 0.09]);
}

/** Merged vertex-coloured geometry for the v4 units, grounded, facing +z (instancing, like unitGeometry). */
export function v4UnitGeometry(key: V4UnitKey, side: 0 | 1): THREE.BufferGeometry {
  const b = new Builder();
  const team = PAL.side[side];
  switch (key) {
    case 'ipit': ipit(b, team); break;
    case 'operator': operator(b, team); break;
    case 'snitch': snitch(b, team); break;
    case 'drone': drone(b, team, side); break;
    case 'bmw': bmw(b, team); break;
    default: b.box(team, [0, 0.5, 0], [0.4, 1, 0.3]);
  }
  return grounded(b.build());
}

/** Extra scale on top of the renderer's ×1.7 unit scale (same convention as heroScale). */
export function v4UnitScale(key: V4UnitKey, _side: 0 | 1): number {
  switch (key) {
    case 'snitch': return 1.02;
    case 'drone': return 1.0;
    case 'bmw': return 1.0;
    default: return 1.0;
  }
}

const v4Heights = new Map<string, number>();
/** Model-space top of the unit (before v4UnitScale and ×1.7): for health bars. The drone adds v4HoverHeight on top. */
export function v4UnitHeight(key: V4UnitKey, side: 0 | 1): number {
  const k = key + side;
  let h = v4Heights.get(k);
  if (h === undefined) {
    const g = v4UnitGeometry(key, side);
    h = g.boundingBox!.max.y;
    g.dispose();
    v4Heights.set(k, h);
  }
  return h;
}

/** No walk cycle (no leaning / bobbing steps): the car and the drone. */
export const isV4Vehicle = (key: string) => key === 'bmw' || key === 'drone';
/** Flies: render it `v4HoverHeight` above the terrain, ignore unit collisions visually. */
export const isFlying = (key: string) => key === 'drone';
/** World units (after all scaling) between the ground and the model's y = 0 for flying units. */
export const v4HoverHeight = (key: string) => (key === 'drone' ? 1.2 : 0);

/** Two-blade propeller (centred, horizontal) to spin on top of V4_DRONE_ROTORS if the renderer wants motion. */
export function v4DronePropGeometry(): THREE.BufferGeometry {
  const b = new Builder();
  b.box(col('#5d6168'), [0, 0, 0], [0.38, 0.008, 0.03]);
  b.add(CYL6, col('#26282d'), [0, 0.006, 0], [0, 0, 0], [0.04, 0.02, 0.04]);
  const g = b.build();
  g.computeBoundingBox();
  return g;
}

// ======================================================================================
// CITY FILL: apartment blocks for instancing
// ======================================================================================
export const CITY_FLOORS = [5, 9, 12, 16] as const;
/** Storey height of the fill blocks (village houses are ~0.24 per storey). */
export const CITY_FH = 0.26;
const CITY_FOOT: [number, number][] = [[3.0, 0.95], [3.4, 1.05], [2.6, 1.25], [1.6, 1.5]];
const CITY_WALL = ['#e6d4b0', '#efe9dd', '#d9b98c', '#c77a5c', '#e8bfa0', '#d6d1c6', '#ead9bd'].map(col);
const CITY_ACCENT = ['#b8573e', '#3f8f8a', '#3e6fb0', '#d39b3a', '#8e3b3b', '#f3efe6', '#6f8f3f'].map(col);
const CITY_WIN = [col('#36424d'), col('#3d5a73'), col('#2f3a44')];

/** Footprint [width x, depth z] of a city block kind (0: 5 эт., 1: 9 эт., 2: 12 эт., 3: 16 эт.). */
export function cityBlockFootprint(kind: number): [number, number] {
  return CITY_FOOT[Math.max(0, Math.min(3, kind | 0))];
}
/** Height to the top of the parapet. */
export function cityBlockHeight(kind: number): number {
  return CITY_FLOORS[Math.max(0, Math.min(3, kind | 0))] * CITY_FH + 0.16;
}

function rnd(seed: number) {
  let s = (seed * 2654435761 + 12345) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * A Grozny apartment block, ≤ 400 triangles: 5, 9, 12 or 16 floors, window rows, coloured loggia stacks,
 * entrance canopies on the +z side, roof parapet and lift room. Centred on x/z, grounded, facing +z.
 * Same (kind, seed) gives the same geometry: cache it per pair and instance it.
 */
export function cityBlock(kind: number, seed: number): THREE.BufferGeometry {
  kind = Math.max(0, Math.min(3, kind | 0));
  const r = rnd(seed * 7 + kind * 131 + 1);
  const n = CITY_FLOORS[kind], fh = CITY_FH;
  const [w, d] = CITY_FOOT[kind];
  const h = n * fh;
  const wall = CITY_WALL[Math.floor(r() * CITY_WALL.length)];
  let acc = CITY_ACCENT[Math.floor(r() * CITY_ACCENT.length)];
  if (acc.equals(wall)) acc = CITY_ACCENT[0];
  const win = CITY_WIN[Math.floor(r() * CITY_WIN.length)];
  const plinth = lift(wall, 0.62), trim = lift(wall, 0.86);
  const b = new Builder();
  b.box(wall, [0, h / 2, 0], [w, h, d]);
  b.box(trim, [0, h + 0.06, 0], [w + 0.05, 0.12, d + 0.05]);
  b.box(lift(wall, 0.75), [w * (r() > 0.5 ? 0.22 : -0.22), h + 0.2, -d * 0.1], [Math.min(0.5, w * 0.25), 0.28, d * 0.45]);
  const faces: Face[] = kind === 3 ? ['+z', '-z', '+x', '-x'] : ['+z', '-z'];
  const band = fh * 0.42;
  for (const face of faces) {
    const F = { '+z': [0, 0, d / 2], '-z': [0, 0, -d / 2], '+x': [w / 2, 0, 0], '-x': [-w / 2, 0, 0] }[face as '+z'] as V3;
    const fw = face === '+z' || face === '-z' ? w : d;
    flat(b, plinth, [F[0], 0.07, F[2]], face, fw, 0.14);
    for (let k = 1; k < n; k++) flat(b, win, [F[0], k * fh + fh * 0.5, F[2]], face, fw - 0.16, band);
    // простенки: режут ленты на окна
    const cols = kind === 3 ? 3 : Math.max(4, Math.round(fw / 0.55));
    for (let c = 0; c <= cols; c++) {
      const u = -fw / 2 + 0.08 + ((fw - 0.16) * c) / cols;
      flat(b, wall, [F[0] + (face === '+x' || face === '-x' ? 0 : u), fh + (h - fh) / 2, F[2] + (face === '+x' ? -u : face === '-x' ? u : 0)], face, 0.07, h - fh, 0.004);
    }
    // верхний этаж: полоса-корона в акцентный цвет у новостроек
    if (kind >= 2) flat(b, acc, [F[0], h - 0.04, F[2]], face, fw, 0.08, 0.003);
  }
  // торцы пластин: колонка окон
  if (kind < 3) for (const s of [-1, 1]) {
    for (let k = 1; k < n; k++) flat(b, win, [(w / 2) * s, k * fh + fh * 0.5, 0], s > 0 ? '+x' : '-x', 0.22, band);
    flat(b, plinth, [(w / 2) * s, 0.07, 0], s > 0 ? '+x' : '-x', d, 0.14);
  }
  // лоджии стопками: цветные, остеклённые
  const stacks = kind === 0 ? 3 : kind === 1 ? 3 : 2;
  const sw = kind === 3 ? 0.42 : 0.5;
  for (const s of [1, -1]) {
    const zf = (d / 2) * s, face: Face = s > 0 ? '+z' : '-z';
    for (let k = 0; k < stacks; k++) {
      const x = (-w / 2 + (w * (k + 0.5)) / stacks) + (s > 0 ? 0 : (r() - 0.5) * 0.1);
      const hb = h - fh;
      b.box(acc, [x, fh + hb / 2, zf + 0.05 * s], [sw, hb, 0.1]);
      for (let f = 1; f < n; f++) flat(b, win, [x, f * fh + fh * 0.58, zf + 0.1 * s], face, sw - 0.08, fh * 0.48);
    }
  }
  // подъезды с козырьками
  const doors = kind === 0 ? 4 : kind === 1 ? 4 : kind === 2 ? 2 : 1;
  for (let k = 0; k < doors; k++) {
    const x = doors === 1 ? 0 : -w / 2 + (w * (k + 0.5)) / doors + (kind < 2 ? w / doors / 2 - 0.08 : 0) * (k === doors - 1 ? -1 : 0) * 0;
    const xx = stacks && doors > 1 ? x + w / doors * 0.25 : x;
    b.box(trim, [xx, fh * 0.92, d / 2 + 0.14], [0.3, 0.04, 0.28]);
    flat(b, K.ink, [xx, fh * 0.42, d / 2], '+z', 0.16, fh * 0.8, 0.006);
  }
  return grounded(b.build());
}

// ======================================================================================
// LANDMARKS
// ======================================================================================
export type GroznyKey = 'ggntu' | 'chgu' | 'shaiba' | 'ansar' | 'pringles';
export const GROZNY_KEYS: GroznyKey[] = ['ggntu', 'chgu', 'shaiba', 'ansar', 'pringles'];
export interface GroznyOpts {
  side?: 0 | 1;
  /** 18+ variants (the Принглс easter egg) */
  spicy?: boolean;
  /** Ансар only: start closed (sign taken down, door taped, «ЗАКРЫТО») */
  closed?: boolean;
}

function tree(b: Builder, x: number, z: number, s = 1, k = 0) {
  b.add(CYL6, K.trunk, [x, 0.3 * s, z], [0, 0, 0], [0.12 * s, 0.6 * s, 0.12 * s]);
  b.add(ICO, K.leaf[k % 4], [x, 0.85 * s, z], [0, k, 0], [0.8 * s, 0.75 * s, 0.8 * s]);
  b.add(ICO, K.leaf[(k + 1) % 4], [x + 0.12 * s, 1.15 * s, z - 0.05 * s], [0.4, k * 2, 0], [0.5 * s, 0.5 * s, 0.5 * s]);
}
function lampPost(b: Builder, x: number, z: number, h = 1.3) {
  b.add(CYL6, K.metal, [x, h / 2, z], [0, 0, 0], [0.05, h, 0.05]);
  b.add(ICO, K.warm, [x, h + 0.05, z], [0, 0, 0], [0.16, 0.16, 0.16]);
}

// ---- ГГНТУ: L-shaped corner building, glass tower on the corner with a stepped crown, castle attic ------
const GG = {
  cream: col('#ece6d8'), stone: col('#8a8c91'), stoneD: col('#6b6d72'), glass: col('#2c5d99'), mull: col('#a9bdd2'),
  crown: col('#4f5259'), crown2: col('#666a72'), cornice: col('#efede7'),
};

/** One wing along x (centred), front façade at z = 0 facing +z, depth `D` to the back. */
function ggWing(len: number, D: number, H: number, turrets: number[], ipit: number | null) {
  const b = new Builder();
  b.box(GG.cream, [0, H / 2, -D / 2], [len, H, D]);
  for (const face of ['+z', '-z'] as Face[]) {
    const z = face === '+z' ? 0 : -D;
    flat(b, GG.stoneD, [0, 0.17, z], face, len, 0.34);
    const n = Math.round(len / 0.78);
    for (let k = 0; k < n; k++) {
      const x = -len / 2 + (len * (k + 0.5)) / n;
      if (ipit !== null && face === '+z' && Math.abs(x - ipit) < 0.55) continue;
      flat(b, GG.glass, [x, 0.36 + (H - 0.44) / 2, z], face, 0.46, H - 0.44, 0.003);
    }
    for (let f = 1; f < 4; f++) flat(b, GG.mull, [0, 0.36 + ((H - 0.44) * f) / 4, z], face, len - 0.1, 0.03, 0.005);
  }
  for (const s of [-1, 1]) {
    for (const dz of [-0.55, -D + 0.55]) flat(b, GG.glass, [(len / 2) * s, 0.36 + (H - 0.44) / 2, dz], s > 0 ? '+x' : '-x', 0.46, H - 0.44, 0.003);
  }
  // каменный аттик с зубцами
  b.box(GG.stone, [0, H + 0.2, -D / 2 - 0.06], [len, 0.4, D - 0.2]);
  b.add(BOX, GG.stoneD, [0, H + 0.08, -0.12], [-0.6, 0, 0], [len, 0.06, 0.3]);
  const m = Math.floor(len / 0.85);
  for (let k = 0; k < m; k++) b.box(GG.stone, [-len / 2 + (len * (k + 0.5)) / m, H + 0.48, -0.2], [0.26, 0.16, 0.16]);
  // круглые башенки
  for (const x of turrets) {
    b.add(CYL8, GG.stone, [x, H + 0.55, -0.3], [0, 0, 0], [0.5, 0.7, 0.5]);
    b.add(CYL8, GG.stoneD, [x, H + 0.95, -0.3], [0, 0, 0], [0.62, 0.14, 0.62]);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      b.box(GG.stone, [x + Math.cos(a) * 0.24, H + 1.08, -0.3 + Math.sin(a) * 0.24], [0.13, 0.13, 0.13]);
    }
    b.add(new THREE.ConeGeometry(0.5, 1, 8), GG.stoneD, [x, H + 0.15, -0.3], [Math.PI, 0, 0], [0.5, 0.3, 0.5]);
  }
  // вход ИПИТ: козырёк, двери
  if (ipit !== null) {
    b.box(K.ink, [ipit, 0.5, 0.005], [0.7, 0.92, 0.02]);
    flat(b, K.cool, [ipit, 0.48, 0.016], '+z', 0.56, 0.8, 0.002);
    flat(b, K.ink, [ipit, 0.48, 0.016], '+z', 0.02, 0.8, 0.004);
    b.box(GG.stoneD, [ipit, 1.02, 0.25], [1.15, 0.06, 0.5]);
    for (const s of [-1, 1]) b.box(K.metal, [ipit + 0.5 * s, 0.5, 0.45], [0.04, 1.0, 0.04]);
  }
  return b.build();
}

function ggntu(g: THREE.Group) {
  const a = 1.25, HT = 8.4, HW = 2.55, D = 2.3, L = 7.0;
  // frame F: the tower axis-aligned, wing A along -x, wing B along -z; rotated -45° so the corner looks at +z
  const inner = new THREE.Group();
  inner.rotation.y = -Math.PI / 4;
  g.add(inner);
  const b = new Builder();
  // башня: стеклянные грани, каменные углы, белый карниз, ступенчатая пирамида
  b.box(GG.glass, [0, HT / 2, 0], [2 * a - 0.1, HT, 2 * a - 0.1]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(GG.stone, [(a - 0.17) * sx, HT / 2, (a - 0.17) * sz], [0.4, HT, 0.4]);
  for (const face of ['+z', '-z', '+x', '-x'] as Face[]) {
    const F = { '+z': [0, 0, a - 0.05], '-z': [0, 0, -a + 0.05], '+x': [a - 0.05, 0, 0], '-x': [-a + 0.05, 0, 0] }[face as '+z'] as V3;
    for (let k = 1; k < 14; k++) flat(b, GG.mull, [F[0], k * 0.6, F[2]], face, 2 * a - 0.8, 0.035, 0.004);
    for (const u of [-0.42, 0, 0.42]) {
      const p: V3 = [F[0] + (face === '+z' || face === '-z' ? u : 0), HT / 2, F[2] + (face === '+x' || face === '-x' ? u : 0)];
      flat(b, GG.mull, p, face, 0.03, HT - 0.1, 0.004);
    }
  }
  b.box(GG.cornice, [0, HT + 0.08, 0], [2 * a + 0.5, 0.16, 2 * a + 0.5]);
  for (let k = 0; k < 6; k++) {
    const s = 2 * a + 0.2 - k * 0.42;
    b.box(k % 2 ? GG.crown2 : GG.crown, [0, HT + 0.26 + k * 0.19, 0], [s, 0.2, s]);
  }
  b.box(GG.crown, [0, HT + 1.42, 0], [0.18, 0.2, 0.18]);
  // крылья (A вдоль -x, B вдоль -z), фасады продолжают грани башни
  const wa = ggWing(L, D, HW, [L / 2 - 0.45, -L / 2 + 0.45], -L / 2 + 1.3);
  mergeInto(b, wa, place([-a - L / 2 + 0.05, 0, a - 0.15]));
  wa.dispose();
  const wb = ggWing(L, D, HW, [L / 2 - 0.45, -L / 2 + 0.45], null);
  mergeInto(b, wb, place([a - 0.15, 0, -a - L / 2 + 0.05], [0, HALF_PI, 0]));
  wb.dispose();
  inner.add(solid(b.build()));
  addSign(inner, signTex('ИПИТ', { bg: '#1f4f9a', fg: '#ffffff', sub: 'институт IT', subFg: '#cfe0ff' }, 256, 128), 1.0, 0.42, [-a - L / 2 + 0.05 + (-L / 2 + 1.3), 1.32, a - 0.15 + 0.03]);

  // world frame: plaza, entrance on the corner, «ГГНТУ» band
  const w = new Builder();
  const cz = a * Math.SQRT2; // the tower corner
  w.box(K.pave, [0, 0.03, cz - 1.6], [7.6, 0.06, 5.0]);
  w.box(K.pave2, [0, 0.065, cz + 0.55], [3.4, 0.02, 1.2]);
  w.box(K.ink, [0, 0.6, cz - 0.05], [1.5, 1.2, 0.6]);
  flat(w, K.cool, [0, 0.55, cz + 0.25], '+z', 1.2, 0.95, 0.003);
  flat(w, K.ink, [0, 0.55, cz + 0.25], '+z', 0.03, 0.95, 0.006);
  w.box(col('#e8e2d2'), [0, 1.42, cz + 0.2], [2.9, 0.5, 0.12]);
  w.box(GG.stoneD, [0, 1.17, cz + 0.42], [2.6, 0.05, 0.5]);
  lampPost(w, -2.2, cz + 0.7, 1.4);
  lampPost(w, 2.2, cz + 0.7, 1.4);
  tree(w, -3.0, cz - 1.0, 0.9, 1);
  tree(w, 3.0, cz - 1.0, 0.9, 2);
  g.add(solid(w.build()));
  const band = canvasTex(1024, 160, (c, W, H) => {
    c.fillStyle = '#efe9d8'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#26282d'; c.textBaseline = 'middle';
    c.textAlign = 'center';
    fitFont(c, '100', '900', DISPLAY, 70, 120); c.fillText('100', 100, 62);
    fitFont(c, 'ЛЕТ · 1920–2020', '700', TEXT, 22, 170); c.fillText('ЛЕТ · 1920–2020', 100, 118);
    fitFont(c, 'ГГНТУ', '900', DISPLAY, 112, 420); c.fillText('ГГНТУ', 470, 86);
    c.strokeStyle = '#b3261e'; c.lineWidth = 8; c.beginPath(); c.arc(735, 80, 40, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#26282d'; c.beginPath(); c.arc(735, 80, 22, 0, Math.PI * 2); c.fill();
    c.textAlign = 'left';
    fitFont(c, 'ГРОЗНЕНСКИЙ НЕФТЯНОЙ', '700', TEXT, 22, 210); c.fillText('ГРОЗНЕНСКИЙ НЕФТЯНОЙ', 795, 62);
    fitFont(c, 'ТЕХНИЧЕСКИЙ УНИВЕРСИТЕТ', '700', TEXT, 22, 210); c.fillText('ТЕХНИЧЕСКИЙ УНИВЕРСИТЕТ', 795, 98);
    c.fillStyle = '#b3261e'; c.fillRect(0, H - 10, W, 10);
  });
  addSign(g, band, 2.8, 0.44, [0, 1.42, cz + 0.265]);
  return { size: [12.4, 9.8] as [number, number] };
}

// ---- ЧГУ: cream classical block, white pilasters, arched gables on the end risalits, dark granite portico --------
function chgu(g: THREE.Group) {
  const cream = col('#ead9b2'), white = col('#f4f1ea'), granite = col('#3f3936'), granite2 = col('#5a524d'), roof = col('#5f5853'), win = col('#33404c');
  const b = new Builder();
  const W = 10.0, D = 2.4, G = 0.68, F = 0.62, HW = G + 3 * F, z0 = -0.6, front = z0 + D / 2;
  b.box(K.pave, [0, 0.03, 0.4], [11.6, 0.06, 5.2]);
  // газоны и дорожка
  for (const s of [-1, 1]) b.box(K.grass, [3.1 * s, 0.07, 2.2], [3.6, 0.03, 1.4]);
  // основной корпус
  b.box(granite, [0, G / 2, z0], [W, G, D]);
  b.box(cream, [0, G + (3 * F) / 2, z0], [W, 3 * F, D]);
  b.box(white, [0, G + 0.03, z0], [W + 0.06, 0.06, D + 0.06]);
  b.box(white, [0, HW + 0.05, z0], [W + 0.14, 0.1, D + 0.14]);
  hipRoof(b, roof, 0, HW + 0.1, z0, W + 0.1, D + 0.1, 0.75);
  // торцевые ризалиты с дугами
  for (const s of [-1, 1]) {
    const x = (W / 2 - 1.1) * s, rz = front + 0.18;
    b.box(granite, [x, G / 2, rz - 0.3], [2.2, G, 0.62]);
    b.box(cream, [x, G + (3 * F) / 2 + 0.07, rz - 0.3], [2.2, 3 * F + 0.14, 0.62]);
    b.box(white, [x, HW + 0.2, rz - 0.3], [2.32, 0.1, 0.72]);
    const arch = new THREE.Shape();
    arch.absarc(0, 0, 0.8, 0, Math.PI, false);
    arch.lineTo(0.8, 0);
    const ag = new THREE.ExtrudeGeometry(arch, { depth: 0.5, bevelEnabled: false, curveSegments: 8 });
    b.add(ag, cream, [x, HW + 0.25, rz - 0.52], [0, 0, 0]);
    const ring = new THREE.Shape();
    ring.absarc(0, 0, 0.92, 0, Math.PI, false);
    ring.absarc(0, 0, 0.8, Math.PI, 0, true);
    const rg = new THREE.ExtrudeGeometry(ring, { depth: 0.6, bevelEnabled: false, curveSegments: 8 });
    b.add(rg, roof, [x, HW + 0.25, rz - 0.6], [0, 0, 0]);
    ag.dispose(); rg.dispose();
    flat(b, white, [x, HW + 0.55, rz + 0.0], '+z', 0.36, 0.36, 0.004);
    flat(b, win, [x, HW + 0.55, rz + 0.0], '+z', 0.26, 0.26, 0.007);
    // пилястры ризалита
    for (const p of [-1, 1]) flat(b, white, [x + 1.0 * p, G + (3 * F) / 2, rz + 0.01], '+z', 0.14, 3 * F, 0.003);
    for (let f = 0; f < 3; f++) for (const dx of [-0.45, 0.45]) {
      flat(b, white, [x + dx, G + F * f + F * 0.52, rz + 0.01], '+z', 0.36, 0.48, 0.004);
      flat(b, win, [x + dx, G + F * f + F * 0.52, rz + 0.01], '+z', 0.26, 0.4, 0.007);
    }
    for (const dx of [-0.45, 0.45]) flat(b, col('#c9c2b2'), [x + dx, G * 0.5, rz + 0.01], '+z', 0.3, 0.4, 0.004);
  }
  // окна основного фасада
  const bays = [-2.85, -2.25, -1.65, 1.65, 2.25, 2.85];
  for (let f = 0; f < 3; f++) for (const x of bays) {
    flat(b, white, [x, G + F * f + F * 0.52, front], '+z', 0.36, 0.48, 0.004);
    flat(b, win, [x, G + F * f + F * 0.52, front], '+z', 0.26, 0.4, 0.007);
  }
  for (const x of bays) flat(b, col('#c9c2b2'), [x, G * 0.5, front], '+z', 0.3, 0.4, 0.004);
  for (const x of [-3.2, -1.3, 1.3, 3.2]) flat(b, white, [x, G + (3 * F) / 2, front], '+z', 0.12, 3 * F, 0.003);
  // задний фасад и торцы: ленты окон
  for (let f = 0; f < 4; f++) {
    flat(b, win, [0, f === 0 ? G * 0.5 : G + F * (f - 1) + F * 0.52, z0 - D / 2], '-z', W - 0.6, 0.32, 0.004);
    for (const s of [-1, 1]) flat(b, win, [(W / 2) * s, f === 0 ? G * 0.5 : G + F * (f - 1) + F * 0.52, z0], s > 0 ? '+x' : '-x', 1.4, 0.32, 0.004);
  }
  for (let k = 0; k < 12; k++) flat(b, cream, [-W / 2 + 0.6 + k * ((W - 1.2) / 11), HW / 2, z0 - D / 2], '-z', 0.12, HW, 0.006);
  // портал из тёмного гранита
  const pz = front + 0.4;
  b.box(granite, [0, 1.0, pz - 0.2], [2.5, 2.0, 0.5]);
  b.box(granite, [0, 1.72, pz + 0.02], [2.62, 0.62, 0.26]);
  b.box(granite2, [0, 2.1, pz + 0.02], [2.8, 0.16, 0.3]);
  for (const x of [-1.05, -0.36, 0.36, 1.05]) b.box(granite2, [x, 0.705, pz + 0.06], [0.18, 1.41, 0.18]);
  flat(b, K.warm, [0, 0.6, pz + 0.05], '+z', 0.55, 1.0, 0.003);
  flat(b, K.ink, [0, 0.6, pz + 0.05], '+z', 0.025, 1.0, 0.006);
  b.box(K.conc, [0, 0.09, pz + 0.45], [2.8, 0.06, 0.6]);
  // низкая кованая ограда
  for (const s of [-1, 1]) {
    b.box(K.ink, [3.2 * s, 0.42, 3.0], [3.6, 0.03, 0.03]);
    b.box(K.ink, [3.2 * s, 0.12, 3.0], [3.6, 0.03, 0.03]);
    for (let k = 0; k < 7; k++) b.box(K.ink, [(1.4 + k * 0.6) * s, 0.25, 3.0], [0.025, 0.5, 0.025]);
  }
  tree(b, -5.1, 1.2, 0.95, 0);
  tree(b, 5.1, 1.2, 0.95, 3);
  g.add(solid(b.build()));
  const sign = canvasTex(512, 128, (c, w, h) => {
    c.fillStyle = '#2a2523'; c.fillRect(0, 0, w, h);
    const gold = c.createLinearGradient(0, 0, 0, h);
    gold.addColorStop(0, '#f6dd8a'); gold.addColorStop(1, '#c79a3a');
    c.fillStyle = gold; c.textAlign = 'center'; c.textBaseline = 'middle';
    fitFont(c, 'ЧГУ', '900', DISPLAY, 66, 300); c.fillText('ЧГУ', w / 2, 52);
    fitFont(c, 'ГОСУДАРСТВЕННЫЙ УНИВЕРСИТЕТ', '700', TEXT, 22, 440); c.fillText('ГОСУДАРСТВЕННЫЙ УНИВЕРСИТЕТ', w / 2, 104);
  });
  addSign(g, sign, 2.36, 0.59, [0, 1.72, pz + 0.156]);
  return { size: [11.6, 5.4] as [number, number] };
}

// ---- ЖК «Шайба»: a 20-storey disc standing on its edge, diamond lattice, two balcony stacks, white rim ----------
const SH = { glass: col('#4a6688'), frame: col('#eeeae2'), lattice: col('#b9c0c8'), strip: col('#e7e2d8'), slit: col('#3a4553'), podium: col('#d9d2c4') };

function shaiba(g: THREE.Group) {
  const R = 7.6, T = 3.6, P = 0.95, yc = P + 0.62 * R, cut = P - yc; // circle centre height and the cut (relative)
  const b = new Builder();
  const arcShape = (r: number) => {
    const t0 = Math.asin(Math.max(-1, cut / r));
    const s = new THREE.Shape();
    s.moveTo(r * Math.cos(t0), cut);
    s.absarc(0, 0, r, t0, Math.PI - t0, false);
    s.lineTo(r * Math.cos(t0), cut);
    return s;
  };
  // стеклянное ядро
  const core = new THREE.ExtrudeGeometry(arcShape(R - 0.08), { depth: T - 0.2, bevelEnabled: false, curveSegments: 40 });
  b.add(core, SH.glass, [0, yc, -(T - 0.2) / 2]);
  core.dispose();
  // белые обода спереди и сзади (заходят на торец)
  const band = (ro: number, ri: number) => {
    const to = Math.asin(cut / ro), ti = Math.asin(cut / ri);
    const s = new THREE.Shape();
    s.moveTo(ro * Math.cos(to), cut);
    s.absarc(0, 0, ro, to, Math.PI - to, false);
    s.lineTo(-ri * Math.cos(ti), cut);
    s.absarc(0, 0, ri, Math.PI - ti, ti, true);
    s.lineTo(ro * Math.cos(to), cut);
    return s;
  };
  const rimG = new THREE.ExtrudeGeometry(band(R + 0.05, R - 0.5), { depth: 0.5, bevelEnabled: false, curveSegments: 40 });
  b.add(rimG, SH.frame, [0, yc, T / 2 - 0.36]);
  b.add(rimG, SH.frame, [0, yc, -T / 2 - 0.14]);
  rimG.dispose();
  // торец: белые рёбра поперёк стеклянной ленты
  for (let k = 1; k < 24; k++) {
    const t = Math.asin(cut / R) + ((Math.PI - 2 * Math.asin(cut / R)) * k) / 24;
    const x = Math.cos(t) * (R - 0.06), y = yc + Math.sin(t) * (R - 0.06);
    const nx = Math.cos(t), ny = Math.sin(t);
    const tx = -ny * 0.09, ty = nx * 0.09;
    const zf = T / 2 - 0.36, zb = -T / 2 + 0.36;
    quadFacing(b, SH.frame, [nx, ny, 0], [x - tx + nx * 0.01, y - ty + ny * 0.01, zb], [x - tx + nx * 0.01, y - ty + ny * 0.01, zf], [x + tx + nx * 0.01, y + ty + ny * 0.01, zf], [x + tx + nx * 0.01, y + ty + ny * 0.01, zb]);
  }
  // фасады: ромбическая сетка, огоньки в узлах, две белые стопки балконов
  const Ri = R - 0.5, alpha = 1.05, sp = 1.55;
  const d1: [number, number] = [Math.cos(alpha), Math.sin(alpha)], d2: [number, number] = [-Math.cos(alpha), Math.sin(alpha)];
  const inside = (x: number, y: number, m: number) => x * x + y * y < (Ri - m) ** 2 && y > cut + 0.15 + m;
  for (const fz of [1, -1]) {
    const face: Face = fz > 0 ? '+z' : '-z';
    const zf = fz * (T / 2 - 0.1);
    const C: V3 = [0, yc, zf];
    for (const d of [d1, d2]) {
      const nrm: [number, number] = [-d[1], d[0]];
      for (let k = -6; k <= 6; k++) {
        const o = k * sp + 0.4;
        // chord of the inner circle on the line p = nrm*o + d*t
        const disc = Ri * Ri - o * o;
        if (disc <= 0.2) continue;
        let t0 = -Math.sqrt(disc), t1 = Math.sqrt(disc);
        // clip to y >= cut + 0.15
        const yAt = (t: number) => nrm[1] * o + d[1] * t;
        const tc = (cut + 0.15 - nrm[1] * o) / d[1];
        if (yAt(t0) < cut + 0.15) t0 = Math.max(t0, tc);
        if (yAt(t1) < cut + 0.15) t1 = Math.min(t1, tc);
        if (t1 - t0 < 0.3) continue;
        const u = (t: number) => (nrm[0] * o + d[0] * t) * fz;
        stroke(b, SH.lattice, C, face, u(t0), yAt(t0), u(t1), yAt(t1), 0.07, 0.01);
      }
    }
    // узлы
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
      const o1 = i * sp + 0.4, o2 = j * sp + 0.4;
      // solve nrm1*o1 + d1*t = nrm2*o2 + d2*s via the line normals: point·nrm1 = o1, point·nrm2 = o2
      const n1: [number, number] = [-d1[1], d1[0]], n2: [number, number] = [-d2[1], d2[0]];
      const det = n1[0] * n2[1] - n1[1] * n2[0];
      const x = (o1 * n2[1] - o2 * n1[1]) / det, y = (n1[0] * o2 - n2[0] * o1) / det;
      if (!inside(x, y, 0.35)) continue;
      flat(b, glow(2.2, 1.7, 0.95), [x, yc + y, zf], face, 0.17, 0.17, 0.016);
    }
    for (const sx of [-0.33, 0.33]) {
      const x = sx * R, top = Math.sqrt(Ri * Ri - x * x) - 0.15;
      const h = top - cut;
      b.box(SH.strip, [x, yc + cut + h / 2, zf + fz * 0.08], [1.25, h, 0.18]);
      for (let f = 0; f < 20; f++) {
        const y = cut + 0.35 + f * ((h - 0.5) / 20);
        if (y > top - 0.15) break;
        flat(b, SH.slit, [x, yc + y, zf + fz * 0.17], face, 1.05, 0.12, 0.004);
      }
    }
    // тёплая подсветка по внутренней кромке обода
    const t0 = Math.asin(cut / (R - 0.52)), t1 = Math.PI - t0;
    for (let k = 0; k < 32; k++) {
      const a0 = t0 + ((t1 - t0) * k) / 32, a1 = t0 + ((t1 - t0) * (k + 1)) / 32;
      const r0 = R - 0.52, r1 = R - 0.6;
      const p = (r: number, a: number): V3 => [Math.cos(a) * r * fz, yc + Math.sin(a) * r, fz * (T / 2 + 0.145)];
      quadFacing(b, glow(1.6, 1.25, 0.7), [0, 0, fz], p(r1, a0), p(r0, a0), p(r0, a1), p(r1, a1));
    }
  }
  // подиум: магазины, светящаяся линия, вход
  const pw = 2 * Math.sqrt(R * R - cut * cut) + 0.6, pd = T + 1.6;
  b.box(SH.podium, [0, P / 2, 0], [pw, P, pd]);
  b.box(lift(SH.podium, 0.85), [0, P + 0.04, 0], [pw + 0.08, 0.08, pd + 0.08]);
  for (const fz of [1, -1]) {
    const face: Face = fz > 0 ? '+z' : '-z';
    flat(b, K.warm, [0, 0.4, (fz * pd) / 2], face, pw - 1.0, 0.55, 0.003);
    for (let k = 0; k < 9; k++) flat(b, K.ink, [-(pw - 1.0) / 2 + ((pw - 1.0) * k) / 8, 0.4, (fz * pd) / 2], face, 0.06, 0.56, 0.006);
    flat(b, glow(1.7, 1.35, 0.8), [0, P + 0.09, (fz * (pd + 0.08)) / 2], face, pw - 0.4, 0.035, 0.003);
  }
  b.box(lift(SH.podium, 0.7), [0, 0.86, pd / 2 + 0.45], [3.4, 0.07, 0.9]);
  for (const s of [-1, 1]) b.box(K.metal, [1.6 * s, 0.42, pd / 2 + 0.85], [0.05, 0.84, 0.05]);
  // площадь, деревья, фонари
  b.box(K.pave, [0, 0.03, 1.4], [pw + 2.4, 0.06, pd + 4.2]);
  for (const s of [-1, 1]) {
    tree(b, (pw / 2 + 0.4) * s, pd / 2 + 1.6, 1.0, s > 0 ? 1 : 2);
    tree(b, (pw / 2 - 1.8) * s, pd / 2 + 2.4, 0.85, s > 0 ? 3 : 0);
    lampPost(b, 3.2 * s, pd / 2 + 1.7, 1.4);
  }
  g.add(solid(b.build()));
  addSign(g, signTex('ЖК «ШАЙБА»', { bg: '#1f2a36', fg: '#f3e6c4', border: '#f3e6c4' }, 512, 96), 3.0, 0.56, [0, 1.25, pd / 2 + 0.92]);
  return { size: [pw + 2.4, pd + 4.2] as [number, number] };
}

// ---- Ансар: small two-storey IT office; closed = sign down, tape, «ЗАКРЫТО» -----------------------------
function ansar(g: THREE.Group, closed: boolean) {
  const white = col('#f0f0ec'), frame = col('#2b2f36'), green = col('#17a36b'), b = new Builder();
  const W = 3.8, D = 2.4, H1 = 1.05, H2 = 1.0, z0 = -0.4, front = z0 + D / 2;
  b.box(K.pave, [0, 0.03, 0.35], [4.8, 0.06, 3.7]);
  b.box(frame, [0, H1 / 2, z0], [W, H1, D]);
  b.box(white, [0, H1 + H2 / 2, z0], [W, H2, D]);
  b.box(lift(white, 0.85), [0, H1 + H2 + 0.05, z0], [W + 0.08, 0.1, D + 0.08]);
  b.box(green, [-W / 2 + 0.12, (H1 + H2) / 2, front + 0.04], [0.24, H1 + H2, 0.1]);
  // второй этаж: лента окон
  flat(b, K.winBlue, [0.15, H1 + 0.5, front], '+z', W - 0.7, 0.42, 0.003);
  for (let k = 0; k < 5; k++) flat(b, white, [-1.4 + k * 0.78, H1 + 0.5, front], '+z', 0.05, 0.42, 0.006);
  for (const s of [-1, 1]) flat(b, K.winBlue, [(W / 2) * s, H1 + 0.5, z0], s > 0 ? '+x' : '-x', 1.6, 0.42, 0.003);
  flat(b, K.winBlue, [0, H1 + 0.5, z0 - D / 2], '-z', W - 0.6, 0.42, 0.003);
  // короб вывески
  b.box(col('#3a3e45'), [0.12, H1 + 0.02, front + 0.06], [W - 0.4, 0.4, 0.1]);
  for (const x of [-1.2, 0.0, 1.2]) b.box(K.chromeD, [x, H1 + 0.02, front + 0.115], [0.04, 0.04, 0.01]);
  // крыша: кондиционеры, антенна
  b.box(col('#d8d8d2'), [1.0, H1 + H2 + 0.24, z0 - 0.3], [0.5, 0.28, 0.4]);
  b.box(col('#d8d8d2'), [0.3, H1 + H2 + 0.2, z0 - 0.5], [0.4, 0.2, 0.3]);
  b.box(K.metal, [-1.2, H1 + H2 + 0.45, z0 - 0.6], [0.03, 0.8, 0.03]);
  // витрина: рамы, дверь справа
  for (let k = 0; k < 5; k++) flat(b, frame, [-1.5 + k * 0.62, 0.48, front], '+z', 0.05, 0.86, 0.008);
  b.box(K.conc, [1.35, 0.08, front + 0.3], [0.9, 0.05, 0.5]);
  tree(b, -2.25, 1.3, 0.75, 2);
  g.add(solid(b.build()));

  // open: lit glass, monitors, sign, poster
  const open = new THREE.Group(), shut = new THREE.Group();
  const ob = new Builder();
  flat(ob, K.cool, [-0.25, 0.48, front], '+z', 2.4, 0.84, 0.004);
  for (const x of [-1.15, -0.55, 0.05, 0.65]) {
    flat(ob, K.ink, [x, 0.42, front], '+z', 0.32, 0.22, 0.006);
    flat(ob, x < 0 ? K.code : glow(0.5, 1.2, 2.2), [x, 0.42, front], '+z', 0.26, 0.16, 0.008);
  }
  flat(ob, K.cool, [1.35, 0.46, front], '+z', 0.56, 0.84, 0.004);
  flat(ob, K.ink, [1.35, 0.46, front], '+z', 0.03, 0.84, 0.008);
  open.add(solid(ob.build()));
  const signT = canvasTex(1024, 128, (c, w, h) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#17a36b'; c.fillRect(14, 14, h - 28, h - 28);
    c.strokeStyle = '#ffffff'; c.lineWidth = 9; c.lineCap = 'round'; c.lineJoin = 'round';
    const m = h / 2;
    c.beginPath(); c.moveTo(48, m - 22); c.lineTo(30, m); c.lineTo(48, m + 22); c.stroke();
    c.beginPath(); c.moveTo(70, m + 26); c.lineTo(84, m - 26); c.stroke();
    c.beginPath(); c.moveTo(97, m - 22); c.lineTo(115, m); c.lineTo(97, m + 22); c.stroke();
    c.fillStyle = '#1b1d22'; c.textBaseline = 'middle'; c.textAlign = 'left';
    fitFont(c, 'ANSAR', '900', DISPLAY, 82, 360); c.fillText('ANSAR', 150, m + 4);
    c.fillStyle = '#17a36b';
    fitFont(c, '· школа программирования', '700', TEXT, 46, 490); c.fillText('· школа программирования', 520, m + 2);
  });
  const signM = addSign(open, signT, W - 0.5, (W - 0.5) / 8, [0.12, H1 + 0.02, front + 0.115]);
  addSign(open, signTex('НАБОР ОТКРЫТ', { bg: '#17a36b', fg: '#ffffff', sub: 'с нуля до джуна', subFg: '#e6fff3' }, 256, 128), 0.6, 0.3, [-1.1, 0.72, front + 0.012]);
  // closed: dark glass, tape across, «ЗАКРЫТО», the sign taken down and leaning on the wall
  const cb = new Builder();
  flat(cb, col('#232b33'), [-0.25, 0.48, front], '+z', 2.4, 0.84, 0.004);
  flat(cb, col('#232b33'), [1.35, 0.46, front], '+z', 0.56, 0.84, 0.004);
  for (const a of [0.42, -0.42]) {
    cb.add(BOX, col('#d8261c'), [0.3, 0.5, front + 0.05], [0, 0, a], [3.4, 0.07, 0.01]);
    for (let k = -3; k <= 3; k++) cb.add(BOX, PAL.white, [0.3 + Math.cos(a) * k * 0.45, 0.5 + Math.sin(a) * k * 0.45, front + 0.056], [0, 0, a], [0.16, 0.072, 0.008]);
  }
  shut.add(solid(cb.build()));
  addSign(shut, signTex('ЗАКРЫТО', { bg: '#ffffff', fg: '#c8261c', border: '#c8261c' }, 256, 96), 0.5, 0.19, [1.35, 0.62, front + 0.07]);
  const fallen = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.5, (W - 0.5) / 8), (signM.material as THREE.MeshBasicMaterial).clone());
  fallen.position.set(2.15, 0.2, front - 0.3);
  fallen.rotation.set(-0.1, -HALF_PI + 0.15, 0.08);
  fallen.scale.setScalar(0.62);
  shut.add(fallen);
  const back = new THREE.Mesh(new THREE.BoxGeometry((W - 0.5) * 0.62, ((W - 0.5) / 8) * 0.62, 0.04), new THREE.MeshLambertMaterial({ color: '#3a3e45' }));
  back.position.set(2.17, 0.2, front - 0.3);
  back.rotation.copy(fallen.rotation);
  back.translateZ(-0.025);
  shut.add(back);
  g.add(open, shut);
  const setClosed = (on: boolean) => { open.visible = !on; shut.visible = on; g.userData.closed = on; };
  setClosed(closed);
  g.userData.setClosed = setClosed;
  return { size: [4.8, 3.7] as [number, number] };
}

// ---- «Принглс»: generic red chips tube, easter egg. ~0.55 tall at ×1 ------------------------------------------
function pringles(g: THREE.Group, spicy: boolean) {
  const r = 0.13, h = 0.5;
  const tex = canvasTex(512, 256, (c, w, hh) => {
    c.fillStyle = '#c8102e'; c.fillRect(0, 0, w, hh);
    c.fillStyle = '#a00c24'; c.fillRect(0, 0, w, 18); c.fillRect(0, hh - 18, w, 18);
    for (const cx of [128, 384]) {
      c.fillStyle = '#f2c14e'; c.beginPath(); c.ellipse(cx, 92, 70, 44, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#e3a92f'; c.beginPath(); c.ellipse(cx + 6, 98, 50, 26, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      fitFont(c, 'ПРИНГЛС', '900', DISPLAY, 46, 220); c.fillText('ПРИНГЛС', cx, 182);
    }
  });
  const side = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16, 1, true), new THREE.MeshLambertMaterial({ map: tex }));
  side.position.y = h / 2 + 0.012;
  const b = new Builder();
  b.add(CYL12, K.chromeD, [0, 0.006, 0], [0, 0, 0], [r * 2 + 0.006, 0.012, r * 2 + 0.006]);
  b.add(CYL12, col('#b8bcc2'), [0, h + 0.012, 0], [0, 0, 0], [r * 2 - 0.01, 0.004, r * 2 - 0.01]);
  if (spicy) {
    // крышка снята и валяется рядом, а из банки торчит кухонная губка
    b.add(CYL12, col('#d8d2c4'), [0.27, 0.012, 0.08], [0, 0, 0], [r * 2 + 0.02, 0.024, r * 2 + 0.02]);
    b.add(BOX, col('#f3d34a'), [0.01, h + 0.06, 0], [0.18, 0, 0.12], [0.16, 0.13, 0.1]);
    b.add(BOX, col('#3f8f3a'), [0.0, h + 0.13, 0.0], [0.18, 0, 0.12], [0.165, 0.03, 0.105]);
  } else {
    b.add(CYL12, col('#d8d2c4'), [0, h + 0.03, 0], [0, 0, 0], [r * 2 + 0.02, 0.036, r * 2 + 0.02]);
    b.add(CYL12, col('#c9c2b4'), [0, h + 0.05, 0], [0, 0, 0], [r * 2 - 0.04, 0.006, r * 2 - 0.04]);
  }
  g.add(solid(b.build()), side);
  side.castShadow = true;
  return { size: [0.5, 0.4] as [number, number] };
}

/**
 * Measured extents of each landmark at ×1 (no DOM needed, for map placement / keep-clear checks):
 * w × d is the axis-aligned bounding box on the ground, (cx, cz) its centre relative to the landmark origin
 * (ГГНТУ's origin is the corner tower, so its box sits behind it), h the top. groznyLandmark() also measures
 * the real box into userData.bounds; the lineup's v4bld view prints it and flags a box bigger than this table.
 */
export const GROZNY_FOOTPRINT: Record<GroznyKey, { w: number; d: number; cx: number; cz: number; h: number }> = {
  ggntu: { w: 13.8, d: 14.5, cx: 0, cz: -4.3, h: 9.9 },
  chgu: { w: 11.6, d: 5.2, cx: 0, cz: 0.4, h: 3.7 },
  shaiba: { w: 15.3, d: 9.4, cx: 0, cz: 1.4, h: 13.3 },
  ansar: { w: 4.9, d: 3.8, cx: 0, cz: 0.3, h: 3.1 },
  pringles: { w: 0.5, d: 0.4, cx: 0.1, cz: 0, h: 0.7 }, // the 18+ one (lid on the ground) is the bigger
};

/**
 * A Grozny landmark. Front faces +z, ground at y = 0: one solid mesh plus MeshBasicMaterial canvas signs
 * that repaint when the fonts load. userData: { kind, footprint: [w, d] (measured bbox), centre: [cx, cz]
 * (bbox centre), lot: [w, d] (the paved lot it was drawn on), bounds: { x0, x1, z0, z1, h }, tris }.
 * Ансар also gets userData.setClosed(on) (and opts.closed for the initial state); the bounds and tris
 * of Ансар cover both the open and the closed dressing.
 */
export function groznyLandmark(key: GroznyKey, opts: GroznyOpts = {}): THREE.Group {
  const g = new THREE.Group();
  let lot: [number, number];
  switch (key) {
    case 'ggntu': lot = ggntu(g).size; break;
    case 'chgu': lot = chgu(g).size; break;
    case 'shaiba': lot = shaiba(g).size; break;
    case 'ansar': lot = ansar(g, !!opts.closed).size; break;
    case 'pringles': lot = pringles(g, !!opts.spicy).size; break;
    default: lot = [1, 1];
  }
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(g);
  let t = 0;
  g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) t += trisOf(m.geometry); });
  const r1 = (v: number) => Math.round(v * 10) / 10;
  g.userData.kind = key;
  g.userData.footprint = [r1(bb.max.x - bb.min.x), r1(bb.max.z - bb.min.z)];
  g.userData.centre = [r1((bb.min.x + bb.max.x) / 2), r1((bb.min.z + bb.max.z) / 2)];
  g.userData.lot = lot;
  g.userData.bounds = { x0: bb.min.x, x1: bb.max.x, z0: bb.min.z, z1: bb.max.z, h: bb.max.y };
  g.userData.tris = t;
  return g;
}

/** Ансар: take the sign down and tape the door (true), or reopen (false). No-op for other landmarks. */
export function setLandmarkClosed(g: THREE.Group, on: boolean) {
  const f = g.userData.setClosed as ((on: boolean) => void) | undefined;
  if (f) f(on);
}
