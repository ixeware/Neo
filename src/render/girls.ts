// Fictional lore NPCs (invented for the game, not real people): the collectable girls from the
// course and Вайнаг, the commission snitch. Same boxy, big-headed chibi as models.ts / heroes.ts /
// props.ts: body() proportions, everyday modest clothes, one merged vertex-coloured geometry per
// model, flat-shaded, facing +z and grounded at y = 0. Unit scale like the other units: the
// renderer multiplies by ×1.7 (US in units.ts).
//
//   girlGeometry('a1' | 'ryzhulka' | 'altushka' | 'operator')  the named four
//   girlGeometry('g1'..'g14')                                   random girls (look keyed by the number)
//   girlGeometry('random', n) / any other id                    a stable random look (hash of id + n)
//   girlGeometry('amina') / aminaGeometry(side)                  Амина, the Атаги tank (unit type 18)
//   vainagGeometry(side)                                         Вайнаг, team armband by side
//
// Амина and Оператор (best friends) are big girls: bigGirl() below, Оператор at OPERATOR_K × Амина.
import * as THREE from 'three';
import { Builder, PAL } from './models';
import { body, type BodyOut, type Limb } from './props';

type V3 = [number, number, number];
type Col = THREE.Color;
const col = (s: string) => new THREE.Color(s);
/** Linear colour above 1.0: on Lambert + ACES it reads as self-lit (screens, flash). */
const glow = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const lift = (c: Col, k: number) => new THREE.Color(c.r * k, c.g * k, c.b * k);

const BOX = new THREE.BoxGeometry(1, 1, 1);
const PLANE = new THREE.PlaneGeometry(1, 1);
const CYL8 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const ICO = new THREE.IcosahedronGeometry(0.5, 0);
/** A-line skirt / coat hem: octagon, flats facing front, back and sides; top Ø 0.739, bottom Ø 0.924 across the flats. */
const FLARE = new THREE.CylinderGeometry(0.4, 0.5, 1, 8, 1).rotateY(Math.PI / 8);
const FLARE_TOP = 0.8 * Math.cos(Math.PI / 8);
/** Umbrella canopy: shallow 8-panel cone. */
const CANOPY = new THREE.ConeGeometry(0.5, 1, 8, 1).rotateY(Math.PI / 8);

const C = {
  phone: glow(0.55, 1.25, 2.3),
  flash: glow(2.6, 2.4, 1.9),
  lens: col('#0d0f12'),
  page: col('#f7f3e6'),
  ink: col('#1c1c22'),
  steel: col('#b9bec4'),
  white: col('#f2efe6'),
  lips: col('#b4646a'),
  lash: col('#141012'),
};

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

/** Thin slab with a coloured face on its local +z or -z side (phones, folders, booklets). */
function slab(b: Builder, body: Col, face: Col | null, at: V3, rot: V3, size: V3, faceSide = 1, inset = 0.82) {
  b.add(BOX, body, at, rot, size);
  if (face) seg(b, face, at, rot, [0, 0, faceSide * (size[2] / 2 + 0.003)], [size[0] * inset, size[1] * inset, 0.006]);
}

/** Put the lowest vertex exactly on the ground and refresh the bounds. */
function grounded(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  const lo = g.boundingBox!.min.y;
  if (Math.abs(lo) > 1e-4) { g.translate(0, -lo, 0); g.computeBoundingBox(); }
  g.computeBoundingSphere();
  return g;
}

// ---- tiny stroke lettering on any tilted face (folder, зачётка) -------------------------------
// Strokes in a unit cell (x right, y up), [x0, y0, x1, y1] per stroke. Only the letters used here.
const GLYPH: Record<string, number[]> = {
  'А': [0, 0, 0.5, 1, 0.5, 1, 1, 0, 0.2, 0.36, 0.8, 0.36],
  'Д': [0.16, 0.22, 0.36, 1, 0.36, 1, 0.86, 1, 0.86, 1, 0.86, 0.22, 0, 0.22, 1, 0.22, 0, 0.22, 0, 0, 1, 0.22, 1, 0],
  'Е': [0, 0, 0, 1, 0, 1, 1, 1, 0, 0.5, 0.8, 0.5, 0, 0, 1, 0],
  'Ё': [0, 0, 0, 1, 0, 1, 1, 1, 0, 0.5, 0.8, 0.5, 0, 0, 1, 0, 0.2, 1.3, 0.32, 1.3, 0.68, 1.3, 0.8, 1.3],
  'З': [0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0.3, 0.5, 1, 0.5],
  'К': [0, 0, 0, 1, 0, 0.45, 1, 1, 0.32, 0.62, 1, 0],
  'Н': [0, 0, 0, 1, 1, 0, 1, 1, 0, 0.5, 1, 0.5],
  'Т': [0, 1, 1, 1, 0.5, 1, 0.5, 0],
  'Ч': [0, 1, 0, 0.5, 0, 0.5, 1, 0.5, 1, 1, 1, 0],
};
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _eo = new THREE.Euler();
const ZAX = new THREE.Vector3(0, 0, 1);
/** Flat letters on the local +z face of a frame (`centre` on the surface, `rot` the frame rotation). */
function letters(b: Builder, c: Col, text: string, centre: V3, rot: V3, h: number, th = h * 0.17, liftBy = 0.0025) {
  const w = h * 0.62, gap = h * 0.22;
  const chars = [...text];
  const total = chars.length * w + (chars.length - 1) * gap;
  _qa.setFromEuler(_eo.set(rot[0], rot[1], rot[2]));
  chars.forEach((ch, i) => {
    const s = GLYPH[ch];
    if (!s) return;
    const cu = -total / 2 + i * (w + gap) + w / 2;
    for (let j = 0; j < s.length; j += 4) {
      const x0 = -w / 2 + th / 2 + s[j] * (w - th), y0 = -h / 2 + th / 2 + s[j + 1] * (h - th);
      const x1 = -w / 2 + th / 2 + s[j + 2] * (w - th), y1 = -h / 2 + th / 2 + s[j + 3] * (h - th);
      const p = along(centre, rot, [cu + (x0 + x1) / 2, (y0 + y1) / 2, liftBy]);
      _qb.setFromAxisAngle(ZAX, Math.atan2(y1 - y0, x1 - x0)).premultiply(_qa);
      _eo.setFromQuaternion(_qb);
      b.add(PLANE, c, p, [_eo.x, _eo.y, _eo.z], [Math.hypot(x1 - x0, y1 - y0) + th, th, 1]);
    }
  });
}

// ---- the girl body: body() at slimmer, slightly shorter multipliers -------------------------
interface GirlBody {
  top: Col; sleeve?: Col; legs: Col; shoe: Col; sole?: Col; skin?: Col; cuff?: Col;
  w?: number; lw?: number; leg?: number; torso?: number; arm?: number; baggy?: number; chunky?: boolean; tee?: boolean;
  armL?: Limb; armR?: Limb; legL?: Limb; legR?: Limb;
  eyes?: 'dot' | 'brown';
}
interface Girl extends BodyOut { w: number; lw: number; skin: Col; legX: number }

function girlBody(b: Builder, o: GirlBody): Girl {
  const w = o.w ?? 0.86, lw = o.lw ?? 0.86, skin = o.skin ?? PAL.skin;
  const f = body(b, {
    top: o.top, sleeve: o.sleeve, pants: o.legs, shoe: o.shoe, sole: o.sole, skin, cuff: o.cuff,
    w, lw, leg: o.leg ?? 0.98, torso: o.torso ?? 0.95, arm: o.arm ?? 0.98, baggy: o.baggy, chunky: o.chunky, tee: o.tee,
    armL: o.armL, armR: o.armR, legL: o.legL ?? { up: [-0.05, 0, 0.03] }, legR: o.legR ?? { up: [0.05, 0, -0.03] },
    eyes: o.eyes ?? 'dot', beard: 'none',
  });
  // neck in the gap under the head, a short lash line over each eye and a small mouth
  b.box(skin, [0, f.topY + 0.02, -0.005], [0.11, 0.05, 0.1]);
  const hy = f.headY, ez = 0.125;
  for (const s of [-1, 1]) {
    b.box(C.lash, [0.062 * s, hy + 0.041, ez + 0.004], [0.058, 0.01, 0.006]);
    b.box(C.lash, [0.094 * s, hy + 0.046, ez + 0.004], [0.022, 0.01, 0.006], [0, 0, 0.55 * s]);
  }
  b.box(C.lips, [0, hy - 0.058, ez + 0.002], [0.05, 0.016, 0.006]);
  const pw = 0.12 * lw * (o.baggy ?? 1);
  return { ...f, w, lw, skin, legX: Math.max(0.08 * lw, pw / 2 + 0.012) };
}

// ---- hair ----------------------------------------------------------------------------------
type HairStyle = 'long' | 'shoulder' | 'bob' | 'pony' | 'bun' | 'braid';
type Fringe = 'straight' | 'side' | 'part';
interface HairOpts { style: HairStyle; c: Col; fringe?: Fringe; high?: boolean; tie?: Col; ends?: Col; locks?: Col }

function hair(b: Builder, f: Girl, o: HairOpts) {
  const hy = f.headY, top = f.topY, c = o.c;
  const yTop = hy + 0.17;
  // cap + a little crown volume
  b.box(c, [0, hy + 0.15, -0.01], [0.292, 0.066, 0.28]);
  b.box(c, [0, hy + 0.188, -0.035], [0.25, 0.03, 0.2]);
  const tied = o.style === 'pony' || o.style === 'bun' || o.style === 'braid';
  const backBot = o.style === 'long' ? top - 0.17 : o.style === 'shoulder' ? top - 0.03 : o.style === 'bob' ? hy - 0.1 : hy - 0.07;
  const sideBot = o.style === 'long' ? hy - 0.16 : o.style === 'shoulder' ? hy - 0.13 : o.style === 'bob' ? hy - 0.1 : hy - 0.02;
  b.box(c, [0, (yTop + backBot) / 2, -0.145], [o.style === 'long' ? 0.3 : 0.292, yTop - backBot, 0.05]);
  if (o.ends && o.style !== 'bob' && !tied) b.box(o.ends, [0, backBot + 0.055, -0.146], [0.306, 0.11, 0.054]);
  for (const s of [-1, 1]) {
    b.box(o.locks ?? c, [0.149 * s, (yTop + sideBot) / 2, -0.025], [0.034, yTop - sideBot, 0.21]);
    if (o.style === 'long' || o.style === 'shoulder') {
      // hair falling behind the shoulders
      const dy = o.style === 'long' ? 0.13 : 0.07;
      b.box(c, [0.12 * s, top + 0.02 - dy / 2, -0.1], [0.07, dy + 0.06, 0.07]);
    }
    if (o.style === 'bob') b.box(c, [0.13 * s, hy - 0.085, 0.07], [0.04, 0.05, 0.08]); // bob tips forward
  }
  // fringe
  const fr = o.fringe ?? 'part';
  if (fr === 'straight') {
    b.box(c, [0, hy + 0.098, 0.128], [0.282, 0.06, 0.032]);
  } else if (fr === 'side') {
    b.box(c, [0.025, hy + 0.104, 0.128], [0.22, 0.055, 0.03], [0, 0, -0.24]);
    b.box(c, [-0.088, hy + 0.122, 0.128], [0.09, 0.045, 0.03]);
  } else {
    for (const s of [-1, 1]) b.box(c, [0.072 * s, hy + 0.117, 0.127], [0.14, 0.044, 0.03], [0, 0, 0.28 * s]);
  }
  const tie = o.tie ?? lift(c, 0.6);
  if (o.style === 'pony') {
    const piv: V3 = [0, hy + (o.high ? 0.13 : 0.05), -0.165];
    b.box(tie, piv, [0.07, 0.05, 0.05]);
    const L = o.high ? 0.3 : 0.24;
    seg(b, c, piv, [0.32, 0, 0], [0, -L / 2 + 0.01, -0.012], [0.09, L, 0.075]);
    seg(b, c, piv, [0.2, 0, 0], [0, -L - 0.025, -0.02], [0.06, 0.07, 0.05]);
  } else if (o.style === 'bun') {
    b.add(ICO, c, [0, hy + 0.205, -0.085], [0.3, 0.4, 0], [0.15, 0.13, 0.15]);
    b.box(tie, [0, hy + 0.17, -0.07], [0.09, 0.025, 0.09]);
  } else if (o.style === 'braid') {
    let y = hy - 0.04;
    for (let k = 0; k < 4; k++) {
      const sz = 0.075 - k * 0.006;
      b.box(c, [(k % 2 ? 0.01 : -0.01), y, -0.165 - k * 0.004], [sz, 0.075, sz * 0.85], [0, 0, k % 2 ? 0.2 : -0.2]);
      y -= 0.065;
    }
    b.box(tie, [0, y + 0.02, -0.18], [0.05, 0.03, 0.045]);
    b.box(c, [0, y - 0.015, -0.18], [0.04, 0.05, 0.035]);
  }
}

// ---- clothes ---------------------------------------------------------------------------------
/** A-line skirt or coat hem from the waist down to `bot`. */
function skirt(b: Builder, f: Girl, c: Col, bot: number, widen = 1) {
  const topY = f.hipY + 0.045, H = topY - bot;
  const W = (0.36 * f.w + 0.014) / FLARE_TOP, D = (0.22 + 0.014) / FLARE_TOP;
  b.add(FLARE, c, [0, topY - H / 2, 0], [0, 0, 0], [W * widen, H, D * widen]);
}

/** Hoodie extras: hem band, hood behind the neck, kangaroo pocket, drawstrings. */
function hoodie(b: Builder, f: Girl, c: Col, o: { long?: number; strings?: Col } = {}) {
  const tw = 0.36 * f.w, dk = lift(c, 0.78), L = o.long ?? 0;
  b.box(c, [0, f.hipY - 0.01 - L / 2, 0], [tw + 0.016, 0.07 + L, 0.234]);
  b.box(dk, [0, f.hipY - 0.045 - L, 0], [tw + 0.02, 0.025, 0.238]);
  b.box(c, [0, f.topY + 0.015, -0.1], [0.27, 0.1, 0.1]);
  b.box(dk, [0, f.topY + 0.045, -0.085], [0.17, 0.035, 0.06]);
  b.box(dk, [0, f.hipY + 0.06 - L * 0.4, 0.114], [tw * 0.62, 0.1, 0.008]);
  const st = o.strings ?? C.white;
  for (const s of [-1, 1]) b.box(st, [0.035 * s, f.topY - 0.055, 0.116], [0.012, 0.1, 0.006]);
}

// ---- accessories -----------------------------------------------------------------------------
/** Phone in a raised hand, screen towards her face (glows). */
function phoneInHand(b: Builder, h: V3, caseC: Col) {
  slab(b, caseC, C.phone, [h[0] + 0.01, h[1] + 0.06, h[2] + 0.015], [0.75, 0, 0], [0.08, 0.13, 0.016], -1);
}

// ---- the named four --------------------------------------------------------------------------
/** A1: из Атагов. Тёмные длинные волосы, бежевое пальто, шарф, телефон, синий значок-сердечко. */
function a1(b: Builder) {
  const coat = col('#cdb48c'), coatD = col('#a88e66'), hairC = col('#160f0c'), scarf = col('#c6d3e0');
  const f = girlBody(b, {
    top: coat, legs: col('#2a2b33'), shoe: col('#3b2a22'), sole: col('#1c1512'), skin: col('#d8a882'), eyes: 'brown',
    armL: { up: [0.05, 0, 0.1] },
    armR: { up: [-0.4, 0, 0.12], lo: [-1.8, 0, 0.55] },
  });
  const tw = 0.36 * f.w, top = f.topY;
  skirt(b, f, coat, 0.12, 1.02);
  // пояс, борт, пуговицы, лацканы
  b.box(coatD, [0, f.hipY + 0.05, 0], [tw + 0.014, 0.03, 0.234]);
  b.box(col('#8a6e48'), [0.02, f.hipY + 0.05, 0.118], [0.04, 0.034, 0.006]);
  b.box(coatD, [-0.015, (f.hipY + top) / 2 - 0.08, 0.119], [0.008, top - f.hipY + 0.1, 0.004]);
  for (let k = 0; k < 2; k++) b.box(col('#5d4a32'), [0.025, top - 0.11 - k * 0.08, 0.12], [0.018, 0.018, 0.006]);
  for (const s of [-1, 1]) b.box(coatD, [0.06 * s, top - 0.05, 0.115], [0.05, 0.11, 0.008], [0, 0, -0.35 * s]);
  // светлый шарф на шее, конец свисает
  b.box(scarf, [0, top + 0.012, 0.0], [0.2, 0.055, 0.19]);
  b.box(scarf, [-0.05, top - 0.07, 0.122], [0.055, 0.15, 0.02], [0, 0, 0.08]);
  // синий значок-сердечко на лацкане (чернила Атагов)
  const heart = lift(PAL.side[0], 1.25), hp: V3 = [0.075, top - 0.085, 0.123];
  b.box(heart, [hp[0] - 0.008, hp[1], hp[2]], [0.02, 0.03, 0.006], [0, 0, 0.6]);
  b.box(heart, [hp[0] + 0.008, hp[1], hp[2]], [0.02, 0.03, 0.006], [0, 0, -0.6]);
  hair(b, f, { style: 'long', c: hairC, fringe: 'part' });
  phoneInHand(b, f.handR, col('#3a2f36'));
}

/** Рыжулька: из деканата. Рыжий высокий хвост, белая блузка, тёмная юбка до колена, папка «ДЕКАНАТ». */
function ryzhulka(b: Builder) {
  const blouse = col('#f4f1ea'), skirtC = col('#262a3a'), ginger = col('#c4561c');
  const skin = col('#ebc6a8');
  const f = girlBody(b, {
    top: blouse, legs: lift(skin, 0.9), shoe: col('#18181b'), skin, eyes: 'brown', cuff: col('#e3ded2'),
    armL: { up: [-0.25, 0, -0.12], lo: [-1.5, 0, -1.0] },
    armR: { up: [0.06, 0, -0.1] },
  });
  const top = f.topY;
  skirt(b, f, skirtC, 0.14);
  b.box(lift(skirtC, 0.75), [0, f.hipY + 0.05, 0], [0.36 * f.w + 0.016, 0.026, 0.236]); // пояс юбки
  // воротник и пуговицы
  for (const s of [-1, 1]) b.box(blouse, [0.04 * s, top - 0.008, 0.1], [0.07, 0.03, 0.05], [0, 0, 0.5 * s]);
  for (let k = 0; k < 3; k++) b.box(col('#d9d3c6'), [0, top - 0.06 - k * 0.055, 0.113], [0.012, 0.012, 0.004]);
  hair(b, f, { style: 'pony', c: ginger, high: true, fringe: 'side', tie: col('#2a2d3a') });
  // папка «ДЕКАНАТ» прижата к груди: бордовая обложка, торчат листы
  const fc: V3 = [0.02, top - 0.14, 0.142], fr: V3 = [-0.06, 0, 0.06];
  const red = col('#8e2420');
  seg(b, red, fc, fr, [0, 0, 0], [0.2, 0.26, 0.022]);
  seg(b, C.page, fc, fr, [0.008, 0.012, -0.004], [0.18, 0.27, 0.014]);
  seg(b, C.page, fc, fr, [0, 0.03, 0.0125], [0.168, 0.05, 0.003]);
  letters(b, red, 'ДЕКАНАТ', along(fc, fr, [0, 0.03, 0.014]), fr, 0.022, 0.0042, 0.0015);
  // ладонь держит её снизу
  const h = f.handL;
  b.box(f.skin, [h[0], h[1] + 0.01, h[2] + 0.02], [0.07, 0.055, 0.06]);
}

/** Альтушка: чёрно-розовые волосы с чёлкой, чокер, оверсайз чёрное худи с цепью, ботинки на платформе. */
function altushka(b: Builder) {
  const hood = col('#151518'), pants = col('#1e1f24'), boot = col('#0f0f11'), pink = col('#e0569a'), hairC = col('#0e0d10');
  const skin = col('#efd2bf');
  const f = girlBody(b, {
    top: hood, legs: pants, shoe: boot, sole: col('#2c2c30'), skin, eyes: 'brown', chunky: true,
    w: 1.08, lw: 0.92, arm: 1.06, leg: 0.9, cuff: lift(hood, 1.6),
    armL: { up: [0.06, 0, 0.14] }, armR: { up: [-0.1, 0, -0.16], lo: [-0.5, 0, -0.1] },
    legL: { up: [-0.03, 0, 0.07] }, legR: { up: [0.03, 0, -0.07] },
  });
  hoodie(b, f, hood, { long: 0.06, strings: pink });
  // цепь от кармана к бедру
  for (let k = 0; k < 6; k++) {
    const t = k / 5, a = t * Math.PI;
    b.box(C.steel, [-0.06 - t * 0.12, f.hipY - 0.04 - Math.sin(a) * 0.06, 0.122 - t * 0.02], [0.022, 0.018, 0.01], [0, 0, k % 2 ? 0.6 : -0.6]);
  }
  // чокер с колечком: ремешок под подбородком, кольцо видно на груди
  b.box(C.ink, [0, f.topY + 0.022, -0.004], [0.122, 0.022, 0.112]);
  b.box(C.steel, [0, f.topY - 0.012, 0.114], [0.024, 0.024, 0.006]);
  b.box(C.ink, [0, f.topY - 0.012, 0.117], [0.012, 0.012, 0.004]);
  // ботинки на платформе: голенище + толстая подошва
  for (const s of [-1, 1]) {
    const x = f.legX * s;
    b.box(boot, [x + 0.003 * s, 0.1, 0.004], [0.13 * f.lw + 0.02, 0.12, 0.165]);
    b.box(col('#232327'), [x, -0.028, 0.025], [0.14, 0.056, 0.21]);
    b.box(col('#4a4a52'), [x, -0.028, 0.132], [0.142, 0.012, 0.004]);
    b.box(C.steel, [x + 0.07 * s, 0.11, 0.03], [0.006, 0.014, 0.03]); // пряжка
  }
  // волосы: чёрные сверху, розовые пряди у лица и розовые концы, прямая чёлка
  hair(b, f, { style: 'long', c: hairC, fringe: 'straight', locks: pink, ends: pink });
  for (const s of [-1, 1]) b.box(pink, [0.118 * s, f.headY - 0.03, 0.128], [0.036, 0.2, 0.024]);
}

// ---- big girls: Амина (unit 18) and her friend Оператор, who is even bigger ----------------------
// Chibi like everyone else, just big and round: short thick legs, wide hips, a barrel torso with a
// rounded belly and shoulders, a big round-cheeked head with a smile and blush. Cute, not a joke:
// the silhouette says «tank». Coordinates are for Амина (k = 1: 1.47 tall, 1.0 wide at the waist
// before the ×1.7 unit scale, the biggest infantry on the field); Оператор is the same body ×OPERATOR_K.
const CYL10 = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const ICO1 = new THREE.IcosahedronGeometry(0.5, 1);
/** Оператор is bigger than Амина by this factor (whole model). */
export const OPERATOR_K = 1.14;

interface BigOpts { top: Col; legs: Col; shoe: Col; sole: Col; skin: Col; stripe?: Col; brow: Col }
interface BigGirl { shL: V3; shR: V3; headY: number; faceZ: number; collarY: number; skin: Col }

function bigGirl(b: Builder, o: BigOpts): BigGirl {
  const { top, legs, skin } = o;
  for (const s of [-1, 1]) {
    b.box(o.shoe, [0.17 * s, 0.055, 0.045], [0.21, 0.09, 0.31]); // chunky sneakers
    b.box(o.sole, [0.17 * s, 0.014, 0.045], [0.22, 0.028, 0.32]);
    b.box(legs, [0.165 * s, 0.22, 0], [0.22, 0.27, 0.25]); // thick legs
    if (o.stripe) b.box(o.stripe, [(0.165 + 0.111) * s, 0.22, 0], [0.012, 0.25, 0.05]);
  }
  b.add(CYL10, legs, [0, 0.41, 0], [0, 0, 0], [0.88, 0.2, 0.62]); // wide hips
  b.add(CYL10, top, [0, 0.69, 0], [0, 0, 0], [1.0, 0.42, 0.68]); // barrel torso
  b.add(ICO1, top, [0, 0.64, 0.05], [0, 0, 0], [0.94, 0.52, 0.74]); // round belly
  b.add(ICO1, top, [0, 0.88, -0.01], [0, 0, 0], [0.92, 0.27, 0.62]); // round shoulders
  const collarY = 1.0;
  b.box(skin, [0, collarY + 0.02, -0.01], [0.2, 0.06, 0.18]); // neck
  // head: big, round cheeks
  const headY = 1.24, faceZ = 0.2;
  b.box(skin, [0, headY, 0], [0.46, 0.4, 0.4]);
  b.box(skin, [0, headY - 0.115, 0.008], [0.5, 0.17, 0.41]); // chubby cheeks and chin
  const ink = C.lash;
  for (const s of [-1, 1]) {
    b.box(col('#f4f0e8'), [0.092 * s, headY + 0.03, faceZ + 0.002], [0.088, 0.062, 0.006]);
    b.box(col('#5a3519'), [0.086 * s, headY + 0.028, faceZ + 0.005], [0.05, 0.056, 0.004]);
    b.box(col('#1a0f08'), [0.086 * s, headY + 0.028, faceZ + 0.0075], [0.024, 0.032, 0.002]);
    b.box(col('#ffffff'), [0.076 * s, headY + 0.042, faceZ + 0.0085], [0.012, 0.012, 0.002]); // eye shine
    b.box(ink, [0.092 * s, headY + 0.067, faceZ + 0.004], [0.09, 0.014, 0.006]);
    b.box(ink, [0.138 * s, headY + 0.072, faceZ + 0.004], [0.028, 0.012, 0.006], [0, 0, 0.55 * s]);
    b.box(o.brow, [0.092 * s, headY + 0.112, faceZ + 0.004], [0.085, 0.018, 0.006], [0, 0, -0.12 * s]); // friendly brows
    b.box(col('#ea9d93'), [0.165 * s, headY - 0.07, faceZ + 0.021], [0.075, 0.042, 0.004]); // blush
  }
  b.box(lift(skin, 0.9), [0, headY - 0.025, faceZ + 0.012], [0.04, 0.035, 0.024]); // nose
  // smile: a little upturned line
  b.box(C.lips, [0, headY - 0.088, faceZ + 0.021], [0.075, 0.018, 0.006]);
  for (const s of [-1, 1]) b.box(C.lips, [0.045 * s, headY - 0.08, faceZ + 0.021], [0.028, 0.016, 0.006], [0, 0, 0.55 * s]);
  return { shL: [0.46, 0.86, 0], shR: [-0.46, 0.86, 0], headY, faceZ, collarY, skin };
}

/** A thick arm from the shoulder: upper and fore sleeve, a fist; returns the fist centre. */
function bigArm(b: Builder, g: BigGirl, sh: V3, up: V3, lo: V3, sleeve: Col, stripe?: Col, side = 1): V3 {
  seg(b, sleeve, sh, up, [0, -0.11, 0], [0.18, 0.25, 0.19]);
  if (stripe) seg(b, stripe, sh, up, [0.093 * side, -0.11, 0], [0.012, 0.22, 0.05]);
  const el = along(sh, up, [0, -0.215, 0]);
  seg(b, sleeve, el, lo, [0, -0.085, 0], [0.165, 0.19, 0.175]);
  if (stripe) seg(b, stripe, el, lo, [0.086 * side, -0.08, 0], [0.012, 0.17, 0.05]);
  return seg(b, g.skin, el, lo, [0, -0.205, 0], [0.15, 0.12, 0.16]);
}

/** Long dark hair around the big head; `tail`: a high ponytail with a scrunchie, else a bun on top. */
function bigHair(b: Builder, g: BigGirl, c: Col, tie: Col, tail: boolean) {
  const hy = g.headY, fz = g.faceZ;
  b.box(c, [0, hy + 0.215, -0.01], [0.48, 0.09, 0.43]);
  b.box(c, [0, hy + 0.268, -0.04], [0.4, 0.04, 0.3]);
  b.box(c, [0, hy + (tail ? 0.02 : 0.05), -0.208], [0.48, tail ? 0.38 : 0.32, 0.06]);
  for (const s of [-1, 1]) b.box(c, [0.243 * s, hy + 0.08, -0.04], [0.04, 0.26, 0.32]);
  // side-swept fringe
  b.box(c, [0.06, hy + 0.158, fz + 0.012], [0.3, 0.07, 0.035], [0, 0, -0.2]);
  b.box(c, [-0.155, hy + 0.178, fz + 0.012], [0.15, 0.06, 0.035]);
  if (tail) {
    const piv: V3 = [0, hy + 0.21, -0.25];
    b.box(tie, piv, [0.13, 0.075, 0.09]);
    seg(b, c, piv, [0.45, 0, 0], [0, -0.2, -0.025], [0.15, 0.4, 0.12]);
    seg(b, c, piv, [0.3, 0, 0], [0, -0.42, -0.05], [0.1, 0.1, 0.08]);
  } else {
    b.add(ICO, c, [0, hy + 0.33, -0.08], [0.3, 0.4, 0], [0.24, 0.2, 0.24]);
    b.box(tie, [0, hy + 0.27, -0.07], [0.13, 0.03, 0.13]);
  }
}

/** Амина: синий спортивный костюм с белыми полосками, высокий хвост, руки в боки — танк Атагов. */
function amina(b: Builder, team: Col) {
  const white = col('#f4f2ec'), dark = lift(team, 0.72);
  const g = bigGirl(b, { top: team, legs: dark, shoe: white, sole: col('#c9c6bf'), skin: col('#e2b291'), stripe: white, brow: col('#2a1a12') });
  // tracksuit: white collar, zip, a small round badge, hem band
  b.box(white, [0, g.collarY - 0.005, 0], [0.36, 0.05, 0.32]);
  b.box(white, [0, 0.86, 0.343], [0.018, 0.2, 0.008]);
  b.box(white, [0, 0.755, 0.348], [0.03, 0.04, 0.008]); // zip pull
  b.box(white, [0.2, 0.87, 0.33], [0.06, 0.06, 0.008]);
  b.box(team, [0.2, 0.87, 0.335], [0.03, 0.03, 0.004]);
  b.add(CYL10, dark, [0, 0.5, 0], [0, 0, 0], [1.02, 0.05, 0.7]);
  // hands on hips
  for (const s of [-1, 1]) bigArm(b, g, s > 0 ? g.shL : g.shR, [0, 0, 0.75 * s], [0, 0, -0.55 * s], team, white, s);
  bigHair(b, g, col('#2a1a12'), lift(team, 1.25), true);
}

/** Оператор: подруга Амины и ещё больше её. Оливковое худи, пучок, телефон поднят как камера, вспышка горит. */
function operator(b: Builder) {
  const hood = col('#6d7a5a'), hoodD = lift(hood, 0.78), jeans = col('#3a4a6a');
  const g = bigGirl(b, { top: hood, legs: jeans, shoe: col('#efece4'), sole: col('#c9c6bf'), skin: col('#dcae8c'), brow: col('#3a2416') });
  // hoodie: hood behind the neck, hem band, kangaroo pocket, drawstrings
  b.box(hood, [0, g.collarY + 0.02, -0.2], [0.4, 0.15, 0.16]);
  b.box(hoodD, [0, g.collarY + 0.06, -0.17], [0.26, 0.05, 0.1]);
  b.add(CYL10, hoodD, [0, 0.5, 0], [0, 0, 0], [1.02, 0.06, 0.7]);
  b.box(hoodD, [0, 0.58, 0.408], [0.44, 0.14, 0.01]);
  for (const s of [-1, 1]) b.box(C.white, [0.055 * s, 0.93, 0.342], [0.014, 0.13, 0.006]);
  // left hand rests on the belly, right arm up: the phone filming over everybody's heads
  bigArm(b, g, g.shL, [0.25, 0, 0.42], [-0.9, 0, 0.12], hood);
  const hr = bigArm(b, g, g.shR, [-2.85, 0, -0.16], [-3.0, 0, -0.06], hood);
  const pc: V3 = [hr[0] + 0.005, hr[1] + 0.12, hr[2] + 0.03], pr: V3 = [-0.12, 0, 0.05];
  slab(b, col('#2b2d33'), C.phone, pc, pr, [0.13, 0.22, 0.026], -1);
  seg(b, C.lens, pc, pr, [0.03, 0.075, 0.016], [0.042, 0.042, 0.008]);
  seg(b, C.flash, pc, pr, [-0.03, 0.075, 0.016], [0.044, 0.044, 0.012]);
  seg(b, g.skin, pc, pr, [0, -0.07, 0.006], [0.13, 0.065, 0.04]); // fingers
  bigHair(b, g, col('#4a2e1c'), col('#2a2d33'), false);
}

// ---- random girls ---------------------------------------------------------------------------
const PALETTE = {
  hair: ['#17110d', '#2e1d14', '#4a2e1c', '#6b3f22', '#8c6239', '#b98a52', '#dcbc7c', '#7a2e1a'].map(col),
  skin: ['#efd2bb', '#e6bd9c', '#d6a582', '#c98d66', '#b97c56'].map(col),
  top: ['#c94f5a', '#e2a948', '#5a7fa8', '#8e74b8', '#3f7a5a', '#e9e2d0', '#30353f', '#d9849a', '#a35a3a', '#8a8f99', '#4a8f8c', '#efe9dc', '#7a2f3f', '#a8b45e'].map(col),
  jeans: ['#3b4a6b', '#7f93b3', '#1d1e22', '#c9b48f', '#55606e'].map(col),
  skirt: ['#2b2d3a', '#6b3a3a', '#3e4b3a', '#c8b89a', '#4a3a5a', '#7a6a58'].map(col),
  shoe: [['#efece4', '#c9c6bf'], ['#18181b', '#2c2c30'], ['#6b4a31', '#3b2a1e']].map(([a, s]) => [col(a), col(s)] as const),
  acc: ['#c94f5a', '#3d6fb0', '#e2a948', '#3f7a5a', '#f2efe6', '#8e74b8', '#18181b', '#d9849a', '#4a8f8c'].map(col),
};
type Outfit = 'sweater' | 'jacket' | 'coat' | 'hoodie';
type Bottom = 'jeans' | 'skirt' | 'midi' | 'wide';
type Acc = 'bag' | 'coffee' | 'phone' | 'umbrella' | 'headphones' | 'books';
const STYLES: HairStyle[] = ['long', 'pony', 'bob', 'shoulder', 'bun', 'braid'];
const OUTFITS: Outfit[] = ['sweater', 'jacket', 'coat', 'hoodie'];
const BOTTOMS: Bottom[] = ['jeans', 'skirt', 'wide', 'midi'];
const ACCS: Acc[] = ['bag', 'coffee', 'phone', 'umbrella', 'headphones', 'books'];
const FRINGES: Fringe[] = ['part', 'straight', 'side'];

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = (seed | 0) + 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GirlLook {
  style: HairStyle; fringe: Fringe; hair: Col; skin: Col;
  outfit: Outfit; top: Col; inner: Col; bottom: Bottom; legs: Col; shoe: Col; sole: Col;
  acc: Acc; accC: Col; leg: number; torso: number;
}

/**
 * The look of random girl #v. Every category and colour cycles through its list with a step co-prime
 * to the list length, so neighbouring numbers never share a top colour, hair or accessory; only the
 * height jitter comes from a seeded PRNG.
 */
export function girlLook(v: number): GirlLook {
  const n = Math.abs(Math.floor(v));
  const r = rng(n * 7919 + 17);
  const cyc = <T,>(a: readonly T[], step: number, off: number) => a[(n * step + off) % a.length];
  const outfit = cyc(OUTFITS, 3, 1);
  const bottom = BOTTOMS[(n + Math.floor(n / 4)) % BOTTOMS.length];
  let top = cyc(PALETTE.top, 5, 3);
  const inner = cyc(PALETTE.top, 5, 10);
  if (outfit === 'jacket') top = [col('#3b5a86'), col('#2a2a2e'), col('#7a5a3c'), col('#4d5a3c')][Math.floor(n / 4) % 4];
  const [shoe, sole] = cyc(PALETTE.shoe, 1, 2);
  return {
    style: cyc(STYLES, 5, 2 + Math.floor(n / STYLES.length) * 2), // shifted each lap so style and accessory don't pair up again
    fringe: FRINGES[(n * 2 + Math.floor(n / 3)) % FRINGES.length],
    hair: cyc(PALETTE.hair, 3, 1), skin: cyc(PALETTE.skin, 2, 1),
    outfit, top, inner, bottom,
    legs: bottom === 'jeans' || bottom === 'wide' ? cyc(PALETTE.jeans, 2, 0) : cyc(PALETTE.skirt, 5, 1),
    shoe, sole,
    acc: cyc(ACCS, 1, 0), accC: cyc(PALETTE.acc, 4, 2),
    leg: 0.94 + r() * 0.1, torso: 0.93 + r() * 0.05,
  };
}

function randomGirl(b: Builder, v: number) {
  const L = girlLook(v);
  const poses: Record<Acc, { armL?: Limb; armR?: Limb }> = {
    bag: { armL: { up: [0.04, 0, 0.1] }, armR: { up: [-0.25, 0, 0.1], lo: [-0.9, 0, 0.45] } },
    coffee: { armL: { up: [0.06, 0, 0.1] }, armR: { up: [-0.3, 0, 0.12], lo: [-1.65, 0, 0.35] } },
    phone: { armL: { up: [0.05, 0, 0.1] }, armR: { up: [-0.4, 0, 0.12], lo: [-1.8, 0, 0.55] } },
    umbrella: { armL: { up: [0.05, 0, 0.1] }, armR: { up: [-0.4, 0, -0.1], lo: [-1.75, 0, 0.1] } },
    headphones: { armL: { up: [0.12, 0, 0.12] }, armR: { up: [0.12, 0, -0.12] } },
    books: { armL: { up: [-0.25, 0, -0.12], lo: [-1.5, 0, -1.0] }, armR: { up: [0.06, 0, -0.1] } },
  };
  const skirtish = L.bottom === 'skirt' || L.bottom === 'midi';
  const legs = skirtish ? (L.style === 'bun' || L.style === 'braid' ? lift(L.skin, 0.88) : col('#26262c')) : L.legs;
  const coatC = L.outfit === 'coat' ? L.top : null;
  const f = girlBody(b, {
    top: L.outfit === 'jacket' ? L.inner : L.top, sleeve: L.top, legs, shoe: L.shoe, sole: L.sole, skin: L.skin,
    leg: L.leg, torso: L.torso, baggy: L.bottom === 'wide' ? 1.45 : 1, chunky: L.shoe.r > 0.8,
    cuff: L.outfit === 'sweater' || L.outfit === 'hoodie' ? lift(L.top, 0.82) : undefined,
    ...poses[L.acc],
  });
  const tw = 0.36 * f.w, top = f.topY, mid = (f.hipY + top) / 2;
  // bottoms: skirts over the legs; the other two are body() legs
  if (L.bottom === 'skirt') skirt(b, f, L.legs, 0.14 * L.leg);
  else if (L.bottom === 'midi') skirt(b, f, L.legs, 0.07, 1.05);
  // tops
  if (L.outfit === 'sweater') {
    b.box(lift(L.top, 0.82), [0, f.hipY + 0.005, 0], [tw + 0.012, 0.035, 0.232]);
    b.box(lift(L.top, 0.82), [0, top + 0.005, -0.005], [0.17, 0.035, 0.15]);
  } else if (L.outfit === 'jacket') {
    // open jacket over a coloured top: two front panels, collar
    for (const s of [-1, 1]) {
      b.box(L.top, [0.12 * s * f.w, mid, 0.004], [0.13 * f.w, top - f.hipY + 0.02, 0.232]);
      b.box(lift(L.top, 0.8), [0.075 * s, top - 0.03, 0.118], [0.04, 0.09, 0.006], [0, 0, -0.35 * s]);
    }
    b.box(L.top, [0, mid, -0.005], [tw + 0.012, top - f.hipY + 0.02, 0.22]);
    b.box(L.top, [0, top + 0.012, -0.03], [0.24, 0.04, 0.16]);
  } else if (L.outfit === 'coat' && coatC) {
    // A-line coat hem: to the knee over trousers, a short flare that sits outside a skirt
    skirt(b, f, coatC, skirtish ? f.hipY - 0.1 : 0.17, 1.04);
    b.box(lift(coatC, 0.8), [0, f.hipY + 0.05, 0], [tw + 0.016, 0.026, 0.236]);
    for (const s of [-1, 1]) b.box(lift(coatC, 0.85), [0.06 * s, top - 0.05, 0.115], [0.05, 0.11, 0.008], [0, 0, -0.35 * s]);
    b.box(L.inner, [0, top + 0.01, 0], [0.19, 0.05, 0.18]); // шарф
  } else if (L.outfit === 'hoodie') {
    hoodie(b, f, L.top);
  }
  hair(b, f, { style: L.style, c: L.hair, fringe: L.fringe, tie: L.accC });
  // accessory
  const hr = f.handR, hl = f.handL;
  switch (L.acc) {
    case 'bag': {
      // сумка через плечо: ремень по диагонали, сумка у правого бедра
      b.box(lift(L.accC, 0.7), [-0.005, mid + 0.04, 0.118], [0.024, 0.42, 0.008], [0, 0, -0.62]);
      b.box(lift(L.accC, 0.7), [0.005, mid + 0.04, -0.118], [0.024, 0.42, 0.008], [0, 0, 0.62]);
      b.box(L.accC, [-0.19, f.hipY + 0.03, 0.04], [0.06, 0.13, 0.17]);
      b.box(lift(L.accC, 0.75), [-0.222, f.hipY + 0.06, 0.04], [0.004, 0.06, 0.15]);
      b.box(col('#c8a24a'), [-0.224, f.hipY + 0.04, 0.04], [0.004, 0.015, 0.03]);
      break;
    }
    case 'coffee': {
      const cp: V3 = [hr[0] + 0.005, hr[1] + 0.07, hr[2] + 0.02];
      b.add(CYL8, C.white, cp, [0, 0, 0], [0.06, 0.1, 0.06]);
      b.add(CYL8, col('#9a6a3a'), [cp[0], cp[1] - 0.005, cp[2]], [0, 0, 0], [0.066, 0.045, 0.066]);
      b.add(CYL8, col('#2a2420'), [cp[0], cp[1] + 0.056, cp[2]], [0, 0, 0], [0.066, 0.016, 0.066]);
      break;
    }
    case 'phone':
      phoneInHand(b, hr, L.accC);
      break;
    case 'umbrella': {
      // зонт: ручка в руке сбоку, трость вверх мимо головы, купол над головой
      const base: V3 = [hr[0], hr[1] - 0.02, hr[2]];
      const rot: V3 = [-0.24, 0, 0.12];
      const len = f.headY + 0.25 - base[1];
      seg(b, C.ink, base, rot, [0, len / 2, 0], [0.018, len + 0.04, 0.018]);
      seg(b, C.ink, base, rot, [0, -0.03, 0.03], [0.02, 0.02, 0.07]);
      const tipC = along(base, rot, [0, len, 0]);
      seg(b, L.accC, tipC, rot, [0, 0.055, 0], [0.66, 0.13, 0.66], CANOPY);
      seg(b, lift(L.accC, 0.75), tipC, rot, [0, -0.01, 0], [0.62, 0.012, 0.62], CYL8);
      seg(b, C.ink, tipC, rot, [0, 0.135, 0], [0.016, 0.04, 0.016]);
      break;
    }
    case 'headphones': {
      const hy = f.headY;
      b.box(L.accC, [0, hy + 0.205, -0.0], [0.33, 0.026, 0.05]);
      for (const s of [-1, 1]) {
        b.box(L.accC, [0.163 * s, hy + 0.13, 0], [0.024, 0.12, 0.05]);
        b.box(lift(L.accC, 0.75), [0.172 * s, hy + 0.02, 0.0], [0.04, 0.11, 0.1]);
      }
      break;
    }
    case 'books': {
      const bc: V3 = [0.02, top - 0.15, 0.15], br: V3 = [-0.06, 0, 0.06];
      seg(b, L.accC, bc, br, [0, 0, 0], [0.19, 0.25, 0.028]);
      seg(b, C.page, bc, br, [0.004, 0, -0.022], [0.17, 0.23, 0.018]);
      seg(b, col('#3f6a8a'), bc, br, [-0.01, 0.01, -0.042], [0.2, 0.24, 0.024]);
      seg(b, C.page, bc, br, [0, 0.05, 0.0145], [0.12, 0.035, 0.003]);
      b.box(f.skin, [hl[0], hl[1] + 0.01, hl[2] + 0.02], [0.07, 0.055, 0.06]);
      break;
    }
  }
}

// ---- Вайнаг ------------------------------------------------------------------------------------
/** Вайнаг: худой, высокий, весь в чёрном, длинная тёмная борода; тычет пальцем в зачётку. */
function vainag(b: Builder, team: Col) {
  const jacket = col('#16171a'), jacket2 = col('#2a2c31'), pants = col('#1b1c20'), shoe = col('#0b0b0d'), hairC = col('#2a1c13');
  const skin = col('#c99572');
  const W = 0.82, LW = 0.8;
  const armL: Limb = { up: [-0.55, 0, -0.06], lo: [-1.62, 0, -0.3] };
  const armR: Limb = { up: [-0.75, 0, 0.3], lo: [-1.5, 0, 0.98] };
  const f = body(b, {
    top: jacket, pants, shoe, sole: col('#26262a'), skin, cuff: jacket2,
    w: W, lw: LW, leg: 1.24, torso: 1.1, arm: 1.12, eyes: 'brown', beard: 'none',
    armL, armR, legL: { up: [-0.04, 0, 0.03] }, legR: { up: [0.04, 0, -0.03] },
  });
  const tw = 0.36 * W, hy = f.headY, top = f.topY;
  // чёрная куртка: воротник-стойка, молния, низ, карманы
  b.box(jacket2, [0, top + 0.02, -0.008], [0.2, 0.05, 0.17]);
  b.box(C.steel, [0, (f.hipY + top) / 2, 0.113], [0.008, top - f.hipY - 0.02, 0.004]);
  b.box(jacket2, [0, f.hipY + 0.008, 0], [tw + 0.012, 0.04, 0.232]);
  for (const s of [-1, 1]) b.box(jacket2, [0.075 * s, f.hipY + 0.08, 0.113], [0.06, 0.006, 0.004]);
  // повязка дежурного в цвет села на левом плече, с белой полосой
  const shL: V3 = [0.23 * W, f.shY, 0];
  seg(b, team, shL, armL.up!, [0, -0.078, 0], [0.09 * LW + 0.02, 0.056, 0.13]);
  seg(b, C.white, shL, armL.up!, [0, -0.078, 0], [0.09 * LW + 0.024, 0.012, 0.134]);
  // короткие волосы, брови сведены к переносице
  b.box(hairC, [0, hy + 0.148, -0.012], [0.284, 0.06, 0.272]);
  b.box(hairC, [0, hy + 0.06, -0.13], [0.276, 0.2, 0.02]);
  for (const s of [-1, 1]) {
    b.box(hairC, [0.139 * s, hy + 0.085, -0.035], [0.012, 0.12, 0.18]);
    b.box(hairC, [0.06 * s, hy + 0.062, 0.128], [0.068, 0.016, 0.008], [0, 0, 0.24 * s]);
  }
  // длинная тёмная борода до груди: по линии челюсти, усы отдельно (лицо открыто), клин вниз
  b.box(hairC, [0, hy - 0.105, 0.012], [0.286, 0.066, 0.242]);
  for (const s of [-1, 1]) b.box(hairC, [0.139 * s, hy - 0.045, 0.045], [0.016, 0.13, 0.12]);
  for (const s of [-1, 1]) {
    b.box(hairC, [0.036 * s, hy - 0.04, 0.131], [0.075, 0.022, 0.014], [0, 0, -0.12 * s]);
    b.box(hairC, [0.072 * s, hy - 0.068, 0.131], [0.022, 0.05, 0.012]);
  }
  b.box(hairC, [0, hy - 0.175, 0.062], [0.2, 0.1, 0.11], [0.1, 0, 0]);
  b.box(hairC, [0, hy - 0.255, 0.086], [0.14, 0.09, 0.08], [0.15, 0, 0]);
  b.box(hairC, [0, hy - 0.32, 0.1], [0.07, 0.06, 0.05], [0.2, 0, 0]);
  // зачётка в левой руке, обложкой к врагу: «ЗАЧЁТКА»
  const hl = f.handL;
  const zc: V3 = [hl[0] - 0.03, hl[1] + 0.085, hl[2] + 0.035], zr: V3 = [-0.18, 0.12, 0];
  const cover = col('#21406b');
  seg(b, cover, zc, zr, [0, 0, 0], [0.12, 0.16, 0.024]);
  seg(b, C.page, zc, zr, [0.006, 0, -0.002], [0.11, 0.15, 0.02]);
  letters(b, col('#d9c27a'), 'ЗАЧЁТКА', along(zc, zr, [0, 0.035, 0.012]), zr, 0.018, 0.0036, 0.0012);
  seg(b, col('#d9c27a'), zc, zr, [0, -0.025, 0.0125], [0.06, 0.004, 0.002]);
  b.box(skin, [hl[0], hl[1] + 0.02, hl[2] + 0.03], [0.06, 0.06, 0.06]);
  // правая: указательный палец в зачётку
  const elR = along([-0.23 * W, f.shY, 0], armR.up!, [0, -0.155 * 1.12, 0]);
  seg(b, skin, elR, armR.lo!, [0, -0.16 * 1.12 - 0.08, 0], [0.022, 0.06, 0.022]);
}

// ---- public API ----------------------------------------------------------------------------------
export const NAMED_GIRL_IDS = ['a1', 'ryzhulka', 'altushka', 'operator'] as const;
export const RANDOM_GIRL_COUNT = 14;
/** Every collectable look: the named four, then g1..g14 (random looks #1..#14). */
export const GIRL_IDS: readonly string[] = [...NAMED_GIRL_IDS, ...Array.from({ length: RANDOM_GIRL_COUNT }, (_, i) => `g${i + 1}`)];

/** Random-look number for an id: 'g7' → 7, 'random' + variant → variant, any other id → a stable hash. */
function lookNumber(id: string, variant = 0): number {
  const m = /^g(\d+)$/.exec(id);
  if (m) return Number(m[1]);
  if (id === 'random') return variant;
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 997) + 100 + variant * 1009;
}

/**
 * Merged vertex-coloured geometry for a collectable girl (neutral NPC, no team colour), grounded,
 * facing +z, unit scale (the renderer's ×1.7 applies). `variant` only matters for 'random' and
 * for unknown ids (picks another stable look). The caller owns the geometry.
 */
export function girlGeometry(id: string, variant = 0): THREE.BufferGeometry {
  const b = new Builder();
  switch (id) {
    case 'a1': a1(b); break;
    case 'ryzhulka': ryzhulka(b); break;
    case 'altushka': altushka(b); break;
    case 'operator': operator(b); break;
    case 'amina': amina(b, PAL.side[0]); break;
    default: randomGirl(b, lookNumber(id, variant));
  }
  const g = b.build();
  if (id === 'operator') g.scale(OPERATOR_K, OPERATOR_K, OPERATOR_K); // она больше Амины
  return grounded(g);
}

/** Амина (unit type 18): tracksuit in the side colour, merged, grounded, facing +z, unit scale. Used by heroGeometry. */
export function aminaGeometry(side: 0 | 1): THREE.BufferGeometry {
  const b = new Builder();
  amina(b, PAL.side[side]);
  return grounded(b.build());
}

const heights = new Map<string, number>();
/** Model-space top of the girl (before the ×1.7 unit scale): for health bars / pick rings. */
export function girlHeight(id: string, variant = 0): number {
  const k = `${id}#${variant}`;
  let h = heights.get(k);
  if (h === undefined) {
    const g = girlGeometry(id, variant);
    h = g.boundingBox!.max.y;
    g.dispose();
    heights.set(k, h);
  }
  return h;
}

/** Вайнаг: merged geometry, armband in the side's colour, grounded, facing +z, unit scale. */
export function vainagGeometry(side: 0 | 1): THREE.BufferGeometry {
  const b = new Builder();
  vainag(b, lift(PAL.side[side], 1.15));
  return grounded(b.build());
}

let vainagH = 0;
/** Model-space top of Вайнаг (same for both sides). */
export function vainagHeight(): number {
  if (!vainagH) {
    const g = vainagGeometry(0);
    vainagH = g.boundingBox!.max.y;
    g.dispose();
  }
  return vainagH;
}
