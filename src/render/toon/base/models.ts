// The player-built base: one model per building key (docs/v5/BASE.md §6), three levels, both teams.
// Written against the palette roles and the material factory, so the same models serve both graphics
// styles. Silhouette families (docs/v5/ART.md §5): towers are tall with a comic weapon on top, traps lie
// flat, economy is squat under an awning, support carries a big sign, superweapons are the biggest things
// in a base. Levels: 1 wood and sheet metal, 2 brick and concrete, 3 marble and metal with gold — each
// level is bigger and gets a different top. Team colour: roof or awning, a band at the foot, a flag.
// No sim or UI imports: the building keys are the only contract.
import * as THREE from 'three';
import { C, TEAM, mat } from '../../style';
import { Kit } from '../kit';

type Col = THREE.Color;
type Team = (typeof TEAM)[number];
interface Ctx { k: Kit; h: Kit; lv: number; T: Team; M: Mats; g: number }
interface Mats { body: Col; body2: Col; base: Col; dark: Col; trim: Col }
/** Draws into c.k (the body) and c.h (the part that turns to the target, +z = aim); returns the head's pivot when it has one. */
type Fn = (c: Ctx) => number[] | void;

const PI = Math.PI, H = PI / 2, O8 = PI / 8;
const BOTTLE = { white: new THREE.Color('#f5f8f7'), teal: new THREE.Color('#1aa597'), cap: new THREE.Color('#f07a1a'), capD: new THREE.Color('#c85e0e') }; // the Себозол bottle (as models.ts)
const MELON = new THREE.Color('#2f9a3e'), MELON2 = new THREE.Color('#1a6a36'), MEAT = new THREE.Color('#b0603a'), TAN = new THREE.Color('#c98a4e');

const mats = (lv: number): Mats => ({
  body: [C.wood, C.wall[2], C.marble][lv - 1], body2: [C.woodDark, C.wall[3], C.metal][lv - 1],
  base: [C.earth[1], C.concrete, C.marble][lv - 1], dark: [C.woodDark, C.concrete, C.metalDark][lv - 1], trim: [C.woodDark, C.trim, C.gold][lv - 1],
});

// ---- shared parts ----------------------------------------------------------------------------------------
/** The pad a building stands on and the team band around its foot. */
function pad({ k, M, T, lv }: Ctx, w: number, d: number, bw = w - 0.3, bd = d - 0.3, z = 0) {
  k.bev(M.base, 0, 0.05, z, w, 0.1, d, 0.1);
  if (lv === 3) k.bev(C.gold, 0, 0.12, z, w - 0.16, 0.05, d - 0.16, 0.1);
  k.box(T.main, 0, 0.2, z, bw, 0.16, bd);
}
/** Level: one to three gold studs on the front. */
function studs({ k, lv }: Ctx, y: number, z: number, x = 0) { for (let i = 0; i < lv; i++) k.box(C.gold, x + (i - (lv - 1) / 2) * 0.2, y, z, 0.12, 0.12, 0.07); }
function flag(k: Kit, T: Team, x: number, y: number, z: number, hh = 0.9) {
  k.box(C.metalDark, x, y + hh / 2, z, 0.07, hh, 0.07);
  k.box(T.main, x + 0.23, y + hh - 0.15, z, 0.4, 0.28, 0.05);
}
/** Two sloped slabs over a gable (ridge along x, or along z with ry = π/2). */
function roof2(k: Kit, c: Col, x: number, y: number, z: number, w: number, d: number, hh: number, ry = 0, t = 0.09) {
  const half = d / 2, len = Math.hypot(half, hh) + 0.06, a = Math.atan2(hh, half);
  k.push(x, y, z, 0, ry, 0);
  for (const s of [-1, 1]) k.box(c, 0, hh / 2 + 0.02, s * half / 2, w, t, len, s * a, 0, 0);
  k.pop();
}
/** A tower's neck and platform (the head stands on it): timber frame → brick shaft → marble column with a crown. Returns the platform top. */
function tower(c: Ctx, hh: number, w = 0.66): number {
  const { k, lv, T } = c;
  if (lv === 1) {
    k.bev(C.earth[1], 0, 0.04, 0, w + 0.95, 0.08, w + 0.95, 0.16);
    const o = w / 2 + 0.22, i = w / 2 + 0.02;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.beam(C.wood, sx * o, 0.05, sz * o, sx * i, hh, sz * i, 0.14);
    for (const s of [-1, 1]) { k.beam(C.woodDark, -o, 0.42, s * o, i, hh - 0.18, s * i, 0.09); k.beam(C.woodDark, s * o, 0.42, o, s * i, hh - 0.18, -i, 0.09); }
    k.box(T.main, 0, 0.26, 0, w + 0.4, 0.2, w + 0.4);
    k.box(C.woodDark, 0, hh - 0.04, 0, w + 0.24, 0.1, w + 0.24);
    k.box(C.wood, 0, hh + 0.07, 0, w + 0.6, 0.13, w + 0.6);
    return hh + 0.135;
  }
  if (lv === 2) {
    k.bev(C.concrete, 0, 0.07, 0, w + 1, 0.14, w + 1, 0.12);
    k.box(T.main, 0, 0.24, 0, w + 0.52, 0.2, w + 0.52);
    k.tbox(C.wall[2], 0, 0.34, 0, w + 0.34, w + 0.34, w + 0.08, w + 0.08, hh - 0.34);
    k.box(C.trim, 0, 0.34 + (hh - 0.34) * 0.55, 0, w + 0.26, 0.1, w + 0.26);
    k.tbox(C.concrete, 0, hh, 0, w + 0.1, w + 0.1, w + 0.7, w + 0.7, 0.17);
    k.box(C.concrete, 0, hh + 0.23, 0, w + 0.76, 0.13, w + 0.76);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(C.wall[2], sx * (w / 2 + 0.3), hh + 0.36, sz * (w / 2 + 0.3), 0.16, 0.14, 0.16);
    return hh + 0.295;
  }
  k.bev(C.marble, 0, 0.06, 0, w + 1.1, 0.12, w + 1.1, 0.16);
  k.bev(C.gold, 0, 0.15, 0, w + 0.86, 0.06, w + 0.86, 0.16);
  k.cyl(T.main, 0, 0.29, 0, w + 0.62, 0.22, 8, 0, O8);
  k.tap(C.marble, 0, 0.4 + (hh - 0.4) / 2, 0, w + 0.42, w + 0.1, hh - 0.4, 8, 0, O8);
  k.cyl(C.gold, 0, 0.4 + (hh - 0.4) * 0.62, 0, w + 0.3, 0.1, 8, 0, O8);
  k.tap(C.metal, 0, hh + 0.09, 0, w + 0.16, w + 0.84, 0.18, 8, 0, O8);
  k.cyl(C.metal, 0, hh + 0.245, 0, w + 0.9, 0.13, 8, 0, O8);
  for (let a = 0; a < 8; a += 2) { const an = a * PI / 4 + PI / 4, r = w / 2 + 0.34; k.box(C.gold, Math.sin(an) * r, hh + 0.4, Math.cos(an) * r, 0.2, 0.18, 0.2, 0, an, 0); }
  return hh + 0.31;
}
function hen(k: Kit, x: number, y: number, z: number, s = 1, ry = 0, body: Col = C.white) {
  k.push(x, y, z, 0, ry, 0, s);
  k.ball(body, 0, 0.17, 0, 0.32, 0, 0.9, 1.25);
  k.ball(body, 0, 0.36, 0.15, 0.2);
  k.box(C.danger, 0, 0.48, 0.14, 0.06, 0.09, 0.13);
  k.box(C.gold, 0, 0.35, 0.27, 0.07, 0.06, 0.09);
  k.box(body, 0, 0.26, -0.21, 0.09, 0.18, 0.1, -0.5);
  k.pop();
}
function sheep(k: Kit, x: number, z: number, ry: number, s = 1, horns?: Col) {
  k.push(x, 0.07, z, 0, ry, 0, s);
  k.box(C.ink, 0, 0.09, 0, 0.2, 0.18, 0.34);
  k.ball(C.white, 0, 0.31, 0, 0.46, 0, 0.82, 1.25);
  k.box(C.ink, 0, 0.37, 0.3, 0.17, 0.19, 0.2);
  if (horns) for (const s2 of [-1, 1]) k.box(horns, s2 * 0.13, 0.46, 0.26, 0.08, 0.08, 0.18);
  k.pop();
}
function melon(k: Kit, x: number, y: number, z: number, d: number, fine = false) {
  k.ball(MELON, x, y, z, d, fine ? 1 : 0);
  k.cyl(MELON2, x, y, z, d * 1.02, d * 0.13, 8, 0, 0.5, H, d * 1.02);
  if (fine) k.cyl(MELON2, x, y, z, d * 1.02, d * 0.13, 8, 0, 2.1, H, d * 1.02);
}
function tuft(k: Kit, x: number, z: number, s = 1) {
  k.cone(C.leaf[1], x, 0.14 * s, z, 0.2 * s, 0.3 * s, 4, 0.2, 0.5, 0);
  k.cone(C.leaf[3], x + 0.12 * s, 0.1 * s, z + 0.06, 0.16 * s, 0.22 * s, 4, -0.2, 0, 0.25);
}
function coins(k: Kit, x: number, z: number, n: number, y = 0.1) { for (let i = 0; i < n; i++) k.cyl(C.gold, x + (i % 2) * 0.03, y + 0.04 + i * 0.075, z, 0.28, 0.065, 8); }
function crate(k: Kit, x: number, y: number, z: number, s: number, ry = 0, c: Col = C.wood) {
  k.box(c, x, y + s / 2, z, s, s, s, 0, ry, 0);
  k.box(C.woodDark, x, y + s / 2, z, s * 1.06, s * 0.2, s * 1.06, 0, ry, 0);
}
/** A shop front: glass with a pale frame and a counter under it. */
function shopWindow(k: Kit, x: number, y: number, z: number, w: number, hh: number, glass: Col = C.glass) {
  k.box(C.trim, x, y, z, w + 0.1, hh + 0.1, 0.05);
  k.box(glass, x, y, z + 0.02, w, hh, 0.05);
  k.box(C.trim, x, y - hh / 2 - 0.05, z + 0.12, w + 0.2, 0.08, 0.28);
}
/** A striped awning (team colour and white) sloping down towards +z. */
function awning(k: Kit, T: Team, x: number, y: number, z: number, w: number, d = 0.6, n = 5) {
  for (let i = 0; i < n; i++) k.box(i % 2 ? C.white : T.main, x - w / 2 + (i + 0.5) * w / n, y, z + d / 2, w / n, 0.08, d, 0.36);
}

// ---- towers ----------------------------------------------------------------------------------------------
const MODELS: Record<string, Fn> = {
  /** Рогатка: a giant slingshot. */
  rogatka: c => {
    const { k, h, lv, g, T } = c, y = tower(c, 1.05 + lv * 0.22, 0.6), wc = lv === 3 ? C.metal : C.wood;
    h.cyl(C.metalDark, 0, 0.07, 0, 0.6 * g, 0.14, 8);
    h.push(0, 0.14, 0, 0, 0, 0, g);
    h.box(wc, 0, 0.3, 0, 0.19, 0.6, 0.19);
    for (const s of [-1, 1]) {
      h.beam(wc, 0, 0.52, 0, s * 0.46, 1.22, 0, 0.17);
      h.box(lv === 3 ? C.gold : C.woodDark, s * 0.48, 1.28, 0, 0.23, 0.16, 0.23);
      h.beam(C.danger, s * 0.46, 1.2, 0, 0, 0.9, -0.66, 0.09);
      if (lv >= 2) h.beam(C.danger, s * 0.46, 1.04, 0, 0, 0.82, -0.66, 0.09);
    }
    h.box(C.door, 0, 0.87, -0.68, 0.34, 0.28, 0.12);
    h.ball(C.concrete, 0, 0.9, -0.58, 0.34);
    h.pop();
    if (lv >= 2) { k.box(C.woodDark, -0.46, y + 0.1, 0.44, 0.3, 0.2, 0.3); k.ball(C.concrete, -0.5, y + 0.25, 0.44, 0.2); k.ball(C.rock, -0.38, y + 0.27, 0.48, 0.18); }
    flag(k, T, 0.5 + lv * 0.04, y, -0.5 - lv * 0.04, 0.8);
    studs(c, lv === 1 ? 0.26 : 0.26, 0.6 + lv * 0.04);
    return [0, y, 0];
  },
  /** Пушка Себозола: a shampoo bottle for a barrel. */
  sebozol: c => {
    const { k, h, lv, g, T } = c, y = tower(c, 0.62 + lv * 0.16, 0.86);
    h.cyl(C.metalDark, 0, 0.08, 0, 0.9 * g, 0.16, 8);
    for (const s of [-1, 1]) h.tbox(lv === 1 ? C.wood : C.metal, s * 0.4 * g, 0.16, 0, 0.14, 0.6 * g, 0.14, 0.3 * g, 0.62 * g);
    h.cyl(C.metalDark, 0, 0.62 * g, 0, 0.16, 0.96 * g, 6, 0, 0, H);
    h.push(0, 0.62 * g, 0, 0.82, 0, 0, g * 0.9);
    h.bev(BOTTLE.white, 0, 0.1, 0, 0.68, 1.1, 0.5, 0.26);
    h.bev(BOTTLE.teal, 0, 0.04, 0, 0.71, 0.5, 0.53, 0.26);
    h.box(BOTTLE.white, 0, 0.06, 0.27, 0.4, 0.16, 0.02);
    h.tbox(BOTTLE.white, 0, 0.65, 0, 0.6, 0.44, 0.3, 0.3, 0.2);
    h.cyl(BOTTLE.cap, 0, 1.0, 0, 0.38, 0.3, 8);
    h.box(BOTTLE.capD, 0, 1.17, 0.06, 0.3, 0.06, 0.2);
    if (lv === 3) { h.cyl(C.gold, 0, 0.84, 0, 0.44, 0.09, 8); h.cyl(C.gold, 0, -0.44, 0, 0.6, 0.09, 8, 0, 0, 0, 0.44); }
    if (lv >= 2) { h.ball(C.white, 0.1, 1.3, 0.04, 0.26); h.ball(C.white, -0.12, 1.42, -0.02, 0.2); h.ball(C.white, 0.02, 1.55, 0.08, 0.14); }
    h.pop();
    if (lv >= 2) for (let i = 0; i < lv - 1; i++) { const x = -0.52 + i * 0.3; k.bev(BOTTLE.white, x, y + 0.2, 0.52, 0.2, 0.3, 0.16, 0.25); k.box(BOTTLE.cap, x, y + 0.4, 0.52, 0.12, 0.1, 0.12); }
    flag(k, T, 0.6 + lv * 0.05, y, -0.6 - lv * 0.05, 0.7);
    studs(c, 0.26, 0.74 + lv * 0.04);
    return [0, y, 0];
  },
  /** Сгущёнкомёт: a tin of condensed milk with a nozzle and a drip. */
  sperm: c => {
    const { k, h, lv, g, T } = c, y = tower(c, 0.9 + lv * 0.18, 0.66);
    h.cyl(C.metalDark, 0, 0.07, 0, 0.66 * g, 0.14, 8);
    h.box(C.metalDark, 0, 0.32 * g, -0.12, 0.24, 0.5 * g, 0.24);
    h.push(0, 0.72 * g, 0, -0.12, 0, 0, g);
    h.cyl(C.white, 0, 0, -0.14, 0.7, 0.84, 8, H, 0, O8);
    h.cyl(C.dome, 0, 0, -0.14, 0.73, 0.4, 8, H, 0, O8);
    for (const z of [-0.58, 0.3]) h.cyl(lv === 3 ? C.gold : C.metal, 0, 0, z, 0.76, 0.07, 8, H, 0, O8);
    h.tap(C.metalDark, 0, 0, 0.56, 0.36, 0.17, 0.48, 8, H);
    h.cyl(lv === 3 ? C.gold : C.metal, 0, 0, 0.82, 0.24, 0.08, 8, H);
    h.ball(C.white, 0, -0.06, 0.93, 0.22); h.ball(C.white, 0, -0.26, 0.95, 0.15);
    if (lv >= 2) { h.cyl(C.white, 0, 0.5, -0.2, 0.4, 0.44, 8); h.cyl(C.dome, 0, 0.5, -0.2, 0.43, 0.2, 8); h.cyl(C.metal, 0, 0.74, -0.2, 0.42, 0.05, 8); }
    h.pop();
    k.cyl(C.white, 0.38, y + 0.02, 0.4, 0.42, 0.04, 8); // a puddle
    flag(k, T, -0.5 - lv * 0.04, y, -0.5 - lv * 0.04, 0.8);
    studs(c, 0.26, 0.63 + lv * 0.04);
    return [0, y, 0];
  },
  /** Тесла: a coil risen out of a hatch in the ground. */
  tesla: c => {
    const { k, lv, g, T } = c, top = 1.35 + lv * 0.36;
    k.bev(C.metalDark, 0, 0.06, 0, 1.56 * g, 0.12, 1.56 * g, 0.1);
    k.box(C.ink, 0, 0.13, 0, 1.16 * g, 0.03, 1.16 * g);
    for (const s of [-1, 1]) {
      k.push(s * 0.6 * g, 0.12, 0, 0, 0, -s * 0.95);
      k.box(C.metal, s * 0.3 * g, 0.03, 0, 0.6 * g, 0.08, 1.14 * g);
      for (const z of [-0.3, 0.3]) k.box(C.gold, s * 0.3 * g, 0.08, z * g, 0.5 * g, 0.03, 0.16 * g);
      k.pop();
    }
    k.cyl(T.main, 0, 0.24, 0, 0.74 * g, 0.22, 8, 0, O8);
    k.cyl(lv === 1 ? C.woodDark : C.concrete, 0, 0.3 + top / 2, 0, 0.28 * g, top, 8);
    const n = 3 + lv;
    for (let i = 0; i < n; i++) k.cyl(C.roof[6], 0, 0.56 + i * (top - 0.5) / n, 0, (0.6 - i * 0.03) * g, 0.12, 8, 0, O8);
    k.ball(lv === 3 ? C.gold : C.metal, 0, top + 0.42, 0, 1.0 * g, 1, 0.4);
    k.ball(C.magic, 0, top + 0.72, 0, 0.36 * g, 0);
    if (lv >= 2) for (const s of [-1, 1]) { k.cyl(C.concrete, s * 0.56 * g, 0.5, 0.3 * s, 0.14, 0.7, 6); k.ball(C.magic, s * 0.56 * g, 0.92, 0.3 * s, 0.2); }
    studs(c, 0.16, 0.8 * g);
    void T;
  },
  /** Гантелемёт: a mortar loaded with a dumbbell. */
  gantel: c => {
    const { k, h, lv, g, T } = c, y = tower(c, 0.46 + lv * 0.14, 1.0);
    h.cyl(C.metalDark, 0, 0.08, 0, 1.0 * g, 0.16, 8);
    h.push(0, 0.16, 0, 0, 0, 0, g);
    h.push(0, 0.16, -0.22, 0.55, 0, 0);
    h.tap(C.metalDark, 0, 0.5, 0, 0.7, 0.6, 1.0, 8, 0, O8);
    h.cyl(lv === 3 ? C.gold : C.metal, 0, 1.02, 0, 0.72, 0.12, 8, 0, O8);
    h.cyl(C.metal, 0, 1.32, 0, 0.11, 1.0, 6, 0, 0, H);
    for (const s of [-1, 1]) {
      h.cyl(C.cloth, s * 0.42, 1.32, 0, 0.5, 0.16, 8, 0, 0, H);
      if (lv >= 2) h.cyl(lv === 3 ? C.gold : C.danger, s * 0.56, 1.32, 0, 0.36, 0.12, 8, 0, 0, H);
    }
    h.pop();
    for (const s of [-1, 1]) h.beam(C.metal, s * 0.42, 0.02, 0.52, s * 0.2, 0.78, 0.26, 0.1);
    h.pop();
    // spare iron on the platform
    for (let i = 0; i < lv; i++) { const x = -0.56 + i * 0.26; k.cyl(C.cloth, x, y + 0.2, 0.62, 0.4, 0.12, 8, H); }
    flag(k, T, 0.66 + lv * 0.05, y, -0.66 - lv * 0.05, 0.7);
    studs(c, 0.26, 0.8 + lv * 0.04);
    return [0, y, 0];
  },
  /** Антидрон: thin barrels and a dish looking up. */
  antidron: c => {
    const { k, h, lv, g, T } = c, y = tower(c, 1.35 + lv * 0.22, 0.56);
    h.cyl(C.metalDark, 0, 0.07, 0, 0.56 * g, 0.14, 8);
    h.bev(C.metal, 0, 0.36 * g, 0, 0.44 * g, 0.5 * g, 0.44 * g, 0.2);
    h.push(0, 0.52 * g, 0, -0.62, 0, 0, g);
    h.box(C.metalDark, 0, 0, 0.1, 0.56, 0.3, 0.5);
    const bs = lv >= 2 ? [[-0.17, 0.08], [0.17, 0.08], [-0.17, -0.1], [0.17, -0.1]] : [[-0.15, 0], [0.15, 0]];
    for (const [x, yy] of bs) { h.cyl(C.metalDark, x, yy, 0.72, 0.11, 0.9, 6, H); h.cyl(lv === 3 ? C.gold : C.danger, x, yy, 1.2, 0.15, 0.12, 6, H); }
    h.pop();
    h.push(-0.42 * g, 0.62 * g, 0, -0.7, 0, 0, g);
    h.cone(C.white, 0, 0, 0.1, 0.56, 0.2, 8, -H);
    h.cyl(C.metalDark, 0, 0, 0.26, 0.07, 0.3, 6, H); h.ball(C.danger, 0, 0, 0.42, 0.12);
    h.pop();
    flag(k, T, 0.44 + lv * 0.04, y, -0.44 - lv * 0.04, 0.7);
    studs(c, 0.26, 0.58 + lv * 0.04);
    return [0, y, 0];
  },
  /** Камера «60»: a speed camera over a limit sign. */
  kamera: c => {
    const { k, lv, g, T, M } = c, top = 1.75 + lv * 0.3, pole = lv === 1 ? C.wood : C.metalDark;
    k.bev(M.base, 0, 0.06, 0, 1.0 * g, 0.12, 1.0 * g, 0.16);
    k.box(T.main, 0, 0.22, 0, 0.56, 0.2, 0.56);
    k.box(pole, 0, top / 2 + 0.1, 0, 0.17, top, 0.17);
    // the «60» sign
    const ys = top * 0.56;
    k.cyl(C.danger, 0, ys, 0.11, 0.74, 0.06, 12, H);
    k.cyl(C.white, 0, ys, 0.13, 0.54, 0.06, 12, H);
    const seg = (x: number, bars: number[][]) => { for (const [bx, by, bw, bh] of bars) k.box(C.ink, x + bx * 0.1, ys + by * 0.1, 0.17, bw * 0.1, bh * 0.1, 0.02); };
    seg(-0.11, [[0, 1.2, 1.4, 0.5], [-0.5, 0, 0.5, 2.9], [0, 0, 1.4, 0.5], [0.5, -0.6, 0.5, 1.4], [0, -1.2, 1.4, 0.5]]);
    seg(0.12, [[0, 1.2, 1.4, 0.5], [-0.5, 0, 0.5, 2.9], [0.5, 0, 0.5, 2.9], [0, -1.2, 1.4, 0.5]]);
    // cameras on a cross arm
    const cam = (x: number) => {
      k.push(x, top + 0.02, 0.06, 0.26, 0, 0);
      k.box(C.white, 0, 0, 0.1, 0.4, 0.32, 0.74);
      k.box(C.metalDark, 0, 0.19, 0.16, 0.48, 0.07, 0.92);
      k.cyl(C.glass, 0, 0, 0.5, 0.26, 0.08, 8, H);
      k.box(C.danger, 0.13, 0.1, 0.48, 0.08, 0.08, 0.04);
      k.pop();
    };
    const xs = lv === 1 ? [0.36] : lv === 2 ? [-0.42, 0.42] : [-0.6, 0, 0.6];
    k.box(pole, lv === 1 ? 0.18 : 0, top - 0.02, 0, lv === 1 ? 0.5 : lv === 2 ? 1.0 : 1.4, 0.11, 0.11);
    for (const x of xs) cam(x);
    if (lv >= 2) k.box(C.gold, 0, top + 0.34, 0.06, 0.3, 0.22, 0.2); // the flash
    if (lv === 3) { k.box(pole, 0, top + 0.16, 0, 0.1, 0.3, 0.1); k.ball(C.gold, 0, top + 0.56, 0.06, 0.2); }
    flag(k, T, 0, top + (lv >= 2 ? 0.44 : 0.1), -0.02, 0.6);
    studs(c, 0.2, 0.3);
  },
  /** Курятник: a coop on stilts with a ramp and hens on guard. */
  kuryatnik: c => {
    const { k, lv, g, T, M } = c, w = 1.3 * g, d = 1.05 * g, y0 = 0.46, hh = 0.74 * g;
    pad(c, w + 0.6, d + 0.9, w + 0.3, d + 0.3, 0.1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(C.woodDark, sx * (w / 2 - 0.1), y0 / 2 + 0.2, sz * (d / 2 - 0.1), 0.13, y0, 0.13);
    k.box([C.wood, C.wall[0], C.marble][lv - 1], 0, y0 + 0.28 + hh / 2, 0, w, hh, d);
    k.box(M.trim, 0, y0 + 0.24, 0, w + 0.1, 0.1, d + 0.1);
    k.gable([C.wood, C.wall[0], C.marble][lv - 1], 0, y0 + 0.28 + hh, 0, w, d - 0.02, 0.5 * g);
    roof2(k, T.main, 0, y0 + 0.28 + hh, 0, w + 0.3, d + 0.24, 0.5 * g + 0.06);
    k.box(T.dark, 0, y0 + 0.36 + hh + 0.5 * g, 0, w + 0.34, 0.1, 0.14);
    k.box(C.ink, -0.26 * g, y0 + 0.28 + 0.25 * g, d / 2 + 0.01, 0.36 * g, 0.46 * g, 0.04);
    k.beam(C.wood, -0.26 * g, y0 + 0.26, d / 2, -0.26 * g, 0.12, d / 2 + 0.72, 0.07, 0.32);
    k.box(C.crop[0], 0.3 * g, y0 + 0.28 + 0.32 * g, d / 2 + 0.06, 0.4 * g, 0.2 * g, 0.14); // the nest
    k.ball(C.white, 0.3 * g, y0 + 0.34 + 0.42 * g, d / 2 + 0.1, 0.16, 0, 1.25);
    hen(k, 0.2, y0 + 0.36 + hh + 0.5 * g, 0, 1.15 * g, 0.5);
    hen(k, 0.5, 0.1, d / 2 + 0.5, 1, -0.5);
    if (lv >= 2) hen(k, -0.7, 0.1, d / 2 + 0.36, 0.95, 0.8, C.wall[1]);
    if (lv === 3) { hen(k, -0.46, y0 + 0.36 + hh + 0.5 * g, 0, 1.0, -0.6, C.gold); k.box(C.gold, 0, y0 + 0.3, d / 2 + 0.02, w * 0.9, 0.07, 0.04); }
    flag(k, T, w / 2, y0 + 0.28 + hh, -d / 2, 0.9);
    studs(c, 0.2, d / 2 + 0.28);
  },
  /** Вышка «Н»: the letter on a mast. */
  bukva_n: c => {
    const { k, lv, g, T } = c, y = tower(c, 1.1 + lv * 0.26, 0.6), s = g * 1.08, t = 0.24 * s, hN = 1.16 * s, wN = 0.9 * s, y0 = y + 0.22;
    k.box(C.metalDark, 0, y + 0.11, 0, 0.36, 0.22, 0.36);
    for (const sx of [-1, 1]) {
      k.box(C.magic, sx * (wN / 2 - t / 2), y0 + hN / 2, 0, t, hN, t * 1.1);
      if (lv >= 2) for (const yy of [0, hN]) k.box(lv === 3 ? C.gold : C.ink, sx * (wN / 2 - t / 2), y0 + yy, 0, t * 1.3, 0.09, t * 1.4);
    }
    k.box(C.magic, 0, y0 + hN / 2, 0, wN - t * 1.6, t * 0.9, t);
    if (lv === 3) { const r = 0.86 * s, cy = y0 + hN / 2; for (let i = 0; i < 8; i++) { const a = i * PI / 4 + O8, b = a + PI / 4; k.beam(C.gold, Math.cos(a) * r, cy + Math.sin(a) * r, 0, Math.cos(b) * r, cy + Math.sin(b) * r, 0, 0.1); } }
    flag(k, T, 0.46 + lv * 0.04, y, -0.46 - lv * 0.04, 0.6);
    studs(c, 0.26, 0.6 + lv * 0.04);
  },

  // ---- walls ---------------------------------------------------------------------------------------------
  /** Забор: one post and two panels (the game draws walls instanced from wallKit()). */
  zabor: c => { const { k, lv, T } = c; wallPost(k, lv, T.main, false); for (const s of [-1, 1]) { k.push(0, 0, 0, 0, s * H, 0); wallArm(k, lv, false); k.pop(); } },
  /** Шлагбаум: a striped boom on a cabinet, with a «кирпич» sign. */
  shlagbaum: c => {
    const { k, lv, g, T, M } = c, x0 = -0.7, yb = 0.84 + lv * 0.06;
    k.bev(M.base, x0, 0.05, 0, 0.74, 0.1, 0.74, 0.14);
    k.box(T.main, x0, 0.18, 0, 0.56, 0.16, 0.56);
    k.bev([C.metal, C.wall[3], C.marble][lv - 1], x0, 0.26 + yb / 2, 0, 0.44, yb, 0.44, 0.14);
    k.box(C.metalDark, x0, 0.3 + yb, 0, 0.52, 0.08, 0.52);
    k.ball(lv === 3 ? C.gold : C.danger, x0, 0.42 + yb, 0, 0.2);
    const n = 5, L = 1.56, z = 0.3;
    for (let i = 0; i < n; i++) k.box(i % 2 ? C.white : C.danger, x0 + 0.1 + (i + 0.5) * L / n, yb, z, L / n, 0.14, 0.11);
    k.box(C.metalDark, x0 - 0.2, yb, z, 0.34, 0.24, 0.2); // counterweight
    k.box(C.metalDark, x0, yb, 0.24, 0.12, 0.12, 0.14);
    k.box(C.metalDark, 0.9, yb / 2 - 0.02, z, 0.12, yb - 0.1, 0.12);
    k.box(C.metalDark, 0.9, yb - 0.1, z, 0.22, 0.07, 0.24);
    k.cyl(C.danger, x0, 0.34 + yb * 0.42, 0.23, 0.36, 0.05, 10, H);
    k.box(C.white, x0, 0.34 + yb * 0.42, 0.26, 0.24, 0.08, 0.03);
    if (lv >= 2) { // the guard's booth
      k.box([C.wood, C.wall[3], C.marble][lv - 1], 0.2, 0.55, -0.5, 0.7, 0.9, 0.6);
      k.box(C.glass, 0.2, 0.7, -0.19, 0.4, 0.3, 0.04);
      k.box(T.main, 0.2, 1.05, -0.46, 0.84, 0.1, 0.8, 0.12);
      k.bev(M.base, 0.2, 0.05, -0.5, 0.9, 0.1, 0.8, 0.14);
    }
    if (lv === 3) { k.box(C.gold, x0, 0.26 + yb * 0.9, 0, 0.47, 0.07, 0.47); k.cyl(C.gold, 0.2, 1.2, -0.5, 0.2, 0.14, 8); }
    studs(c, 0.18, 0.3, x0);
    void g;
  },

  // ---- traps ---------------------------------------------------------------------------------------------
  /** Грабли: rakes in the grass, teeth up. */
  grabli: c => {
    const { k, lv } = c;
    k.bev(C.earth[1], 0, 0.03, 0, 1.5, 0.06, 1.5, 0.22);
    const rake = (x: number, z: number, ry: number) => {
      k.push(x, 0.07, z, 0, ry, 0);
      k.box(C.wood, 0, 0.04, 0.12, 0.09, 0.08, 1.2);
      k.box(C.metalDark, 0, 0.05, -0.5, 0.74, 0.1, 0.12);
      for (let i = 0; i < 4; i++) k.cone(lv === 3 ? C.gold : C.danger, -0.28 + i * 0.187, 0.2, -0.5, 0.12, 0.22, 4);
      k.pop();
    };
    rake(0, 0, lv === 1 ? 0.4 : 0.7);
    if (lv >= 2) rake(0.1, 0.05, -0.75);
    if (lv === 3) rake(-0.1, -0.1, 2.9);
    tuft(k, -0.5, 0.42); tuft(k, 0.52, -0.3, 0.9);
    studs(c, 0.1, 0.72);
  },
  /** Яма: a pit under planks and leaves. */
  yama: c => {
    const { k, lv, g } = c;
    k.cyl(C.earth[1], 0, 0.04, 0, 1.75 * g, 0.08, 10);
    k.cyl(C.ink, 0, 0.07, 0, 1.3 * g, 0.06, 10);
    for (let i = 0; i < 5; i++) { const a = i * 1.26 + 0.3; k.box(C.earth[0], Math.cos(a) * 0.76 * g, 0.1, Math.sin(a) * 0.76 * g, 0.4, 0.14, 0.26, 0, -a + H, 0.1); }
    k.box(C.wood, 0, 0.15, 0, 1.56 * g, 0.06, 0.17, 0, 0.5);
    k.box(C.woodDark, 0.05, 0.19, 0, 1.46 * g, 0.06, 0.17, 0, -0.62);
    k.box(C.leaf[0], 0.3, 0.24, 0.26, 0.5, 0.05, 0.34, 0, 0.3);
    k.box(C.leaf[3], -0.34, 0.24, -0.2, 0.4, 0.05, 0.3, 0, -0.5);
    if (lv >= 2) for (const [x, z] of [[-0.3, 0.3], [0.32, -0.3], [0, -0.05]].slice(0, lv)) k.cone(lv === 3 ? C.metal : C.trim, x, 0.24, z, 0.16, 0.34, 4);
    studs(c, 0.1, 0.86 * g);
  },
  /** Лежачий полицейский: a striped bump across the road. */
  lezhak: c => {
    const { k, lv } = c, n = 5, L = 1.8, hh = 0.3 + lv * 0.06;
    for (let i = 0; i < n; i++) k.cyl(i % 2 ? C.ink : C.gold, -L / 2 + (i + 0.5) * L / n, 0.02, 0, hh, L / n, 6, 0, 0, H, 0.66);
    if (lv >= 2) for (const s of [-1, 1]) k.box(C.white, 0, 0.03, s * 0.52, L, 0.05, 0.1);
    if (lv === 3) for (let i = 0; i < 6; i++) k.cone(C.metal, -0.75 + i * 0.3, 0.14, 0.52, 0.14, 0.26, 4);
    studs(c, 0.06, 0.74);
  },
  /** Нычка: a stash dug in under a bush, the lid ajar. */
  nychka: c => {
    const { k, lv, g } = c, box = lv === 3 ? C.metalDark : C.woodDark, lid = lv === 3 ? C.metal : C.wood;
    k.bev(C.earth[1], 0, 0.03, 0, 1.36, 0.06, 1.2, 0.22);
    k.box(box, 0, 0.17, 0, 0.72 * g, 0.3, 0.52 * g);
    k.box(C.heal, 0, 0.31, 0, 0.58 * g, 0.06, 0.38 * g);
    k.box(lid, 0, 0.44, -0.26 * g, 0.76 * g, 0.07, 0.54 * g, -0.8);
    k.box(C.gold, 0, 0.2, 0.26 * g + 0.01, 0.13, 0.13, 0.05);
    if (lv >= 2) { k.box(box, 0.5, 0.12, 0.3, 0.3, 0.2, 0.3, 0, 0.4); k.box(C.heal, 0.5, 0.23, 0.3, 0.2, 0.05, 0.2, 0, 0.4); }
    k.ball(C.leaf[2], -0.5, 0.2, 0.12, 0.54, 0, 0.7); k.ball(C.leaf[0], 0.46, 0.18, -0.26, 0.44, 0, 0.7);
    studs(c, 0.08, 0.6);
  },
  /** Злая собака: a kennel, a bowl and a head looking out. */
  sobaka: c => {
    const { k, lv, g, T, M } = c, w = 0.92 * g, d = 1.0 * g, hh = 0.6 * g, zc = -0.24, wall = [C.wood, C.wall[2], C.marble][lv - 1];
    k.bev(M.base, 0, 0.04, 0.1, 1.6, 0.08, 1.8, 0.16);
    k.box(wall, 0, 0.08 + hh / 2, zc, w, hh, d);
    k.gable(wall, 0, 0.08 + hh, zc, d - 0.02, w, 0.44 * g, H);
    roof2(k, T.main, 0, 0.08 + hh, zc, d + 0.22, w + 0.26, 0.44 * g + 0.06, H);
    const zf = zc + d / 2;
    k.box(C.ink, 0, 0.08 + 0.27 * g, zf + 0.01, 0.46 * g, 0.52 * g, 0.04);
    // the dog
    k.box(TAN, 0, 0.36 * g, zf + 0.08, 0.34 * g, 0.3 * g, 0.3 * g);
    k.box(C.trim, 0, 0.3 * g, zf + 0.26 * g, 0.2 * g, 0.16 * g, 0.2 * g);
    k.box(C.ink, 0, 0.36 * g, zf + 0.37 * g, 0.1, 0.08, 0.06);
    for (const s of [-1, 1]) { k.box(C.woodDark, s * 0.15 * g, 0.54 * g, zf + 0.04, 0.11, 0.14, 0.09); k.box(lv === 3 ? C.danger : C.ink, s * 0.09 * g, 0.44 * g, zf + 0.24 * g, 0.06, 0.06, 0.04); }
    k.cyl(lv === 3 ? C.gold : C.metal, 0.52, 0.13, 0.62, 0.34, 0.11, 8); k.cyl(MEAT, 0.52, 0.19, 0.62, 0.24, 0.04, 8);
    k.box(C.metalDark, -0.56, 0.24, 0.66, 0.09, 0.36, 0.09);
    k.box(C.gold, -0.56, 0.58, 0.66, 0.4, 0.3, 0.06); k.box(C.ink, -0.56, 0.62, 0.7, 0.07, 0.14, 0.02); k.box(C.ink, -0.56, 0.49, 0.7, 0.07, 0.06, 0.02);
    if (lv >= 2) { k.beam(C.white, 0.1, 0.12, 0.8, 0.38, 0.12, 0.92, 0.07); k.ball(C.white, 0.1, 0.12, 0.8, 0.12); k.ball(C.white, 0.38, 0.12, 0.92, 0.12); }
    studs(c, 0.08 + hh + 0.14 * g, zf + 0.03);
  },

  // ---- economy -------------------------------------------------------------------------------------------
  /** Ларёк: a kiosk with a sign, crates and a fridge. */
  larek: c => {
    const { k, lv, g, T, M } = c, w = 1.46 * g, d = 1.0 * g, hh = 1.12 * g, top = 0.1 + hh;
    pad(c, w + 0.5, d + 0.7, w + 0.14, d + 0.14, 0.1);
    k.box([C.balcony, C.wall[3], C.marble][lv - 1], 0, 0.1 + hh / 2, 0, w, hh, d);
    shopWindow(k, 0, 0.1 + hh * 0.6, d / 2, w * 0.7, hh * 0.4);
    for (const [x, col] of [[-0.3, C.danger], [0, C.gold], [0.3, C.heal]] as [number, Col][]) k.box(col, x * g, 0.1 + hh * 0.5, d / 2 + 0.07, 0.14, 0.24, 0.08);
    k.box(M.dark, 0, top + 0.06, 0, w + 0.16, 0.12, d + 0.16);
    awning(k, T, 0, top - 0.12, d / 2, w + 0.1, 0.62);
    // the sign
    k.box(C.gold, 0, top + 0.42, -0.1, w * 0.84, 0.46, 0.12);
    k.box(T.dark, 0, top + 0.42, -0.1, w * 0.84 + 0.1, 0.56, 0.06);
    k.box(C.ink, 0, top + 0.48, -0.03, w * 0.56, 0.1, 0.02); k.box(C.ink, -0.1, top + 0.32, -0.03, w * 0.36, 0.08, 0.02);
    for (const s of [-1, 1]) k.box(M.dark, s * w * 0.3, top + 0.16, -0.1, 0.09, 0.14, 0.09);
    crate(k, w / 2 + 0.24, 0.1, 0.34, 0.34); crate(k, w / 2 + 0.26, 0.44, 0.32, 0.28, 0.4, C.crop[0]);
    if (lv >= 2) { k.box(C.white, -w / 2 - 0.24, 0.52, 0.3, 0.38, 0.84, 0.36); k.box(C.danger, -w / 2 - 0.24, 0.99, 0.3, 0.4, 0.12, 0.38); k.box(C.glass, -w / 2 - 0.24, 0.52, 0.49, 0.28, 0.6, 0.03); }
    if (lv === 3) { k.box(C.metalDark, w * 0.36, top + 0.9, -0.1, 0.08, 0.5, 0.08); k.cyl(C.gold, w * 0.36, top + 1.36, -0.1, 0.5, 0.1, 10, H); k.box(C.ink, w * 0.36, top + 1.36, -0.03, 0.1, 0.26, 0.03); }
    flag(k, T, -w / 2, top + 0.1, -d / 2, 0.8);
    studs(c, 0.26, d / 2 + 0.03);
  },
  /** Шаурмечная: a stall with a spit in the window and a giant roll on the roof. */
  shaurma: c => {
    const { k, lv, g, T, M } = c, w = 1.4 * g, d = 1.0 * g, hh = 1.16 * g, top = 0.1 + hh;
    pad(c, w + 0.5, d + 0.9, w + 0.14, d + 0.14, 0.14);
    k.box([C.wall[1], C.wall[2], C.marble][lv - 1], 0, 0.1 + hh / 2, 0, w, hh, d);
    shopWindow(k, 0.06, 0.1 + hh * 0.6, d / 2, w * 0.74, hh * 0.44, C.ink);
    // the spit
    const xs = -0.28 * g, ysp = 0.1 + hh * 0.62;
    k.cyl(C.metal, xs, ysp, d / 2 + 0.16, 0.07, hh * 0.5, 6);
    k.tap(MEAT, xs, ysp, d / 2 + 0.16, 0.2, 0.38, hh * 0.34, 8);
    k.ball(C.danger, xs, ysp + hh * 0.2, d / 2 + 0.16, 0.14);
    k.box(C.heal, 0.3 * g, 0.1 + hh * 0.5, d / 2 + 0.2, 0.3, 0.1, 0.16); k.box(C.danger, 0.3 * g, 0.1 + hh * 0.5 + 0.08, d / 2 + 0.2, 0.2, 0.08, 0.12);
    k.box(M.dark, 0, top + 0.06, 0, w + 0.16, 0.12, d + 0.16);
    awning(k, T, 0, top - 0.12, d / 2, w + 0.1, 0.66);
    k.cyl(C.metalDark, 0.46 * g, top + 0.42, -0.26, 0.2, 0.7, 8); k.cone(C.metalDark, 0.46 * g, top + 0.84, -0.26, 0.36, 0.16, 8);
    // the roll on the roof
    const rs = 0.74 + lv * 0.2;
    k.push(-0.26 * g, top + 0.12 + 0.42 * rs, 0, 0, 0, 0.42, rs);
    k.cyl(C.wall[1], 0, 0.06, 0, 0.44, 0.9, 8);
    k.cyl(lv === 3 ? C.gold : C.metal, 0, -0.22, 0, 0.48, 0.46, 8);
    k.ball(C.leaf[3], 0.04, 0.5, 0.02, 0.36); k.ball(C.danger, -0.1, 0.54, 0.08, 0.2); k.ball(MEAT, 0.06, 0.56, -0.1, 0.22);
    k.pop();
    // a stand-up table
    k.cyl(C.white, 0.74, 0.7, 0.86, 0.5, 0.07, 8); k.cyl(C.metalDark, 0.74, 0.4, 0.86, 0.09, 0.6, 6); k.cyl(C.metalDark, 0.74, 0.13, 0.86, 0.32, 0.06, 8);
    if (lv >= 2) k.box(C.danger, 0.74, 0.8, 0.86, 0.1, 0.16, 0.1);
    flag(k, T, w / 2, top + 0.1, -d / 2, 0.8);
    studs(c, 0.26, d / 2 + 0.03);
  },
  /** Сейф: a safe the size of a shed. */
  seyf: c => {
    const { k, lv, g, T, M } = c, s = g * 1.1, yc = 0.14 + 0.6 * s, zf = 0.5 * s;
    pad(c, 1.24 * s + 0.5, 1.0 * s + 0.6, 1.24 * s + 0.14, 1.0 * s + 0.14, 0.05);
    k.bev(C.metalDark, 0, yc, 0, 1.2 * s, 1.2 * s, 1.0 * s, 0.1);
    k.box(lv === 3 ? C.marble : C.metal, 0, yc, zf + 0.03, 0.9 * s, 0.9 * s, 0.09);
    if (lv === 3) k.cyl(C.gold, 0, yc, zf + 0.08, 0.74 * s, 0.07, 12, H);
    k.cyl(C.gold, 0.1 * s, yc, zf + 0.13, 0.42 * s, 0.07, 8, H);
    k.box(C.gold, 0.1 * s, yc, zf + 0.17, 0.56 * s, 0.08, 0.05); k.box(C.gold, 0.1 * s, yc, zf + 0.17, 0.08, 0.56 * s, 0.05);
    for (const yy of [-0.26, 0.26]) k.box(C.metalDark, -0.47 * s, yc + yy * s, zf + 0.08, 0.1, 0.18, 0.1);
    k.box(C.heal, -0.28 * s, yc + 0.22 * s, zf + 0.09, 0.14, 0.18, 0.04);
    k.box(T.main, 0, 0.14 + 1.2 * s + 0.05, 0, 1.26 * s, 0.1, 1.06 * s);
    k.box(M.dark, 0, 0.14 + 1.2 * s + 0.13, 0, 1.0 * s, 0.08, 0.8 * s);
    coins(k, 0.5 * s, zf + 0.3, 2 + lv); coins(k, 0.76 * s, zf + 0.12, 1 + lv);
    if (lv >= 2) for (let i = 0; i < 3; i++) k.tbox(C.gold, -0.6 * s + (i % 2) * 0.2 + (i === 2 ? 0.1 : 0), 0.1 + (i === 2 ? 0.13 : 0), zf + 0.26, 0.2, 0.36, 0.14, 0.3, 0.13);
    if (lv === 3) { k.ball(C.wall[1], -0.2, 0.3, zf + 0.5, 0.4, 0, 1.1); k.box(C.gold, -0.2, 0.5, zf + 0.5, 0.2, 0.08, 0.2); }
    flag(k, T, 0.5 * s, 0.14 + 1.2 * s + 0.1, -0.4 * s, 0.7);
    studs(c, 0.14 + 1.06 * s, zf + 0.09);
  },
  /** Бараний загон: a pen with a growing flock. */
  zagon: c => {
    const { k, lv, T } = c, r = 0.82 + lv * 0.05, n = 8, post = lv === 3 ? C.trim : C.wood, rail = lv === 1 ? C.woodDark : C.trim;
    k.cyl(C.yard[1], 0, 0.035, 0, r * 2 + 0.36, 0.07, 10);
    const P = (i: number) => { const a = (i / n) * PI * 2 + O8; return [Math.sin(a) * r, Math.cos(a) * r]; };
    for (let i = 0; i < n; i++) {
      const [x, z] = P(i), [x1, z1] = P(i + 1);
      k.box(post, x, 0.36, z, 0.13, 0.66, 0.13, 0, (i / n) * PI * 2 + O8, 0);
      if (lv === 3) k.box(C.gold, x, 0.72, z, 0.17, 0.08, 0.17, 0, (i / n) * PI * 2 + O8, 0);
      if (i === n - 1) { k.beam(T.main, x, 0.38, z, x1, 0.38, z1, 0.4, 0.07); continue; } // the gate, towards +z
      k.beam(rail, x, 0.46, z, x1, 0.46, z1, 0.22, 0.07);
    }
    const flock: number[][] = [[-0.26, 0.2, 0.4], [0.34, -0.1, -0.9], [0.06, 0.42, 2.4], [-0.3, -0.36, 1.5], [0.36, 0.34, 0.2]];
    for (let i = 0; i < 2 + lv; i++) sheep(k, flock[i][0], flock[i][1], flock[i][2], i === 0 ? 1.1 : 0.94, i === 0 && lv === 3 ? C.gold : i === 0 ? C.wall[1] : undefined);
    k.cyl(C.crop[0], 0.04, 0.24, -0.5, 0.4, 0.4, 8, 0, 0.3, H);
    if (lv >= 2) { // a lean-to at the back
      for (const s of [-1, 1]) k.box(C.woodDark, s * 0.44, 0.52, -r + 0.14, 0.1, 0.94, 0.1);
      k.box(T.main, 0, 1.04, -r + 0.3, 1.14, 0.09, 0.74, 0.3);
    }
    const [gx, gz] = P(0);
    flag(k, T, gx, 0.66, gz, 0.74);
    studs(c, 0.14, r + 0.12);
  },

  // ---- support and tech ----------------------------------------------------------------------------------
  /** Прорабская: site cabins stacked by level, under a tower crane. */
  prorab: c => {
    const { k, lv, T, M } = c, w = 1.5, d = 1.0, ch = 0.82;
    pad(c, w + 0.6, d + 0.8, w + 0.16, d + 0.16, 0.1);
    const cols = [C.roof[5], C.wall[3], C.marble];
    for (let i = 0; i < lv; i++) {
      const y = 0.12 + i * (ch + 0.1), x = i % 2 ? 0.1 : -0.06, cw = w - i * 0.12;
      k.box(cols[lv - 1 - i] ?? cols[0], x, y + ch / 2, 0, cw, ch, d);
      for (const s of [-1, 1]) k.box(C.metalDark, x + s * (cw / 2 - 0.04), y + ch / 2, d / 2 - 0.03, 0.09, ch, 0.09);
      k.box(C.door, x - cw * 0.28, y + ch * 0.44, d / 2 + 0.02, 0.3, ch * 0.78, 0.04);
      k.box(C.trim, x + cw * 0.16, y + ch * 0.56, d / 2 + 0.01, 0.6, 0.38, 0.04); k.box(C.glass, x + cw * 0.16, y + ch * 0.56, d / 2 + 0.03, 0.5, 0.28, 0.04);
      k.box(i === lv - 1 ? T.main : C.metalDark, x, y + ch + 0.05, 0, cw + 0.12, 0.1, d + 0.12);
      if (i > 0) k.beam(C.metalDark, x - cw / 2 - 0.3, y - ch - 0.1 + 0.1, d / 2 + 0.2, x - cw * 0.28, y + 0.02, d / 2 + 0.2, 0.09, 0.26); // stairs
    }
    // the crane
    const top = 2.1 + lv * 0.62, cx = 0.58, cz = -0.34, crane = C.gold;
    k.box(C.concrete, cx, 0.2, cz, 0.5, 0.2, 0.5);
    for (let i = 0; i < 4; i++) { const sx = i & 1 ? 1 : -1, sz = i & 2 ? 1 : -1; k.box(crane, cx + sx * 0.09, top / 2 + 0.2, cz + sz * 0.09, 0.08, top - 0.2, 0.08); }
    for (let y = 0.6; y < top - 0.2; y += 0.5) k.box(C.ink, cx, y, cz, 0.27, 0.07, 0.27);
    k.box(C.white, cx, top - 0.06, cz, 0.36, 0.3, 0.36); k.box(C.glass, cx, top - 0.04, cz + 0.17, 0.28, 0.18, 0.04);
    k.box(crane, cx - 0.56, top + 0.18, cz, 2.0, 0.12, 0.12); k.box(crane, cx - 0.5, top + 0.4, cz, 1.2, 0.07, 0.07);
    k.beam(crane, cx, top + 0.62, cz, cx - 1.5, top + 0.24, cz, 0.07); k.beam(crane, cx, top + 0.62, cz, cx + 0.4, top + 0.24, cz, 0.07);
    k.box(crane, cx, top + 0.4, cz, 0.12, 0.5, 0.12);
    k.box(C.concrete, cx + 0.38, top + 0.06, cz, 0.3, 0.26, 0.24);
    k.box(C.ink, cx - 1.2, top - 0.2, cz, 0.06, 0.66, 0.06);
    k.box(C.wall[2], cx - 1.2, top - 0.62, cz, 0.34, 0.2, 0.3); k.box(C.wood, cx - 1.2, top - 0.75, cz, 0.4, 0.06, 0.36);
    flag(k, T, cx, top + 0.62, cz, 0.6);
    // the yard: a cone, bricks
    k.cone(C.danger, -0.82, 0.3, 0.72, 0.26, 0.4, 6); k.box(C.danger, -0.82, 0.12, 0.72, 0.32, 0.05, 0.32); k.cyl(C.white, -0.82, 0.3, 0.72, 0.17, 0.08, 6);
    k.box(C.wall[2], 0.7, 0.2, 0.74, 0.44, 0.2, 0.3); k.box(C.wall[2], 0.66, 0.38, 0.74, 0.3, 0.16, 0.3, 0, 0.2);
    if (lv === 3) k.dome(C.gold, 0.06, 0.12 + 3 * (ch + 0.1), 0.1, 0.4, 0.24);
    studs(c, 0.26, d / 2 + 0.11);
    void M;
  },
  /** Качалка: a gym under a giant dumbbell. */
  kachalka: c => {
    const { k, lv, g, T, M } = c, w = 1.46 * g, d = 1.1 * g, hh = 1.1 * g, top = 0.1 + hh;
    pad(c, w + 0.5, d + 1.0, w + 0.14, d + 0.14, 0.18);
    k.box([C.metal, C.wall[2], C.marble][lv - 1], 0, 0.1 + hh / 2, 0, w, hh, d);
    k.box(M.dark, 0, top + 0.05, 0, w + 0.14, 0.1, d + 0.14);
    k.hip(T.main, 0, top + 0.1, 0, w + 0.26, d + 0.26, 0.36 * g, 0.5);
    k.box(C.trim, -0.36 * g, 0.1 + 0.44 * g, d / 2 + 0.01, 0.48 * g, 0.92 * g, 0.04); k.box(C.door, -0.36 * g, 0.1 + 0.42 * g, d / 2 + 0.03, 0.4 * g, 0.84 * g, 0.04);
    k.box(C.trim, 0.3 * g, 0.1 + hh * 0.58, d / 2 + 0.01, 0.6 * g, 0.5 * g, 0.04); k.box(C.glass, 0.3 * g, 0.1 + hh * 0.58, d / 2 + 0.03, 0.52 * g, 0.42 * g, 0.04);
    // the sign
    const ys = top + 0.36 * g + 0.56, dc = lv === 3 ? C.gold : C.cloth;
    for (const s of [-1, 1]) k.box(C.metalDark, s * 0.2, ys - 0.3, 0, 0.1, 0.5, 0.1);
    k.cyl(C.metal, 0, ys, 0, 0.14, 1.3 * g, 6, 0, 0, H);
    for (const s of [-1, 1]) { k.cyl(dc, s * 0.5 * g, ys, 0, 0.7 * g, 0.2, 8, 0, 0, H); k.cyl(lv === 1 ? C.metalDark : C.danger, s * 0.68 * g, ys, 0, 0.48 * g, 0.16, 8, 0, 0, H); }
    // a bench press by the door
    const bx = 0.5 * g, bz = d / 2 + 0.52;
    k.box(C.danger, bx, 0.38, bz, 0.3, 0.1, 0.74); k.box(C.metalDark, bx, 0.22, bz, 0.12, 0.24, 0.6);
    for (const s of [-1, 1]) k.box(C.metalDark, bx + s * 0.3, 0.52, bz - 0.26, 0.09, 0.84, 0.09);
    k.cyl(C.metal, bx, 0.92, bz - 0.26, 0.09, 1.06, 6, 0, 0, H);
    for (const s of [-1, 1]) k.cyl(C.cloth, bx + s * 0.46, 0.92, bz - 0.26, 0.4, 0.12, 8, 0, 0, H);
    if (lv >= 2) { k.box(C.metalDark, -w / 2 - 0.3, 0.84, 0.36, 0.09, 1.5, 0.09); k.box(C.metalDark, -w / 2 - 0.14, 1.56, 0.36, 0.42, 0.09, 0.09); k.cyl(C.danger, -w / 2 - 0.06, 1.06, 0.36, 0.3, 0.8, 8); }
    if (lv === 3) { k.tap(C.gold, 0.86 * g, 0.36, d / 2 + 0.2, 0.14, 0.3, 0.3, 8); k.box(C.gold, 0.86 * g, 0.16, d / 2 + 0.2, 0.24, 0.1, 0.24); }
    studs(c, 0.26, d / 2 + 0.03);
  },
  /** Гараж: a tin shell with a car nosing out. */
  garazh: c => {
    const { k, lv, g, T, M } = c, w = 1.6 * (1 + (lv - 1) * 0.07), d = 1.2, hh = 1.0 + lv * 0.1, top = 0.1 + hh;
    pad(c, w + 0.5, d + 0.8, w + 0.14, d + 0.14, 0.1);
    k.box([C.metal, C.wall[3], C.marble][lv - 1], 0, 0.1 + hh / 2, 0, w, hh, d);
    if (lv === 1) for (let i = -2; i <= 2; i++) k.box(C.metalDark, w / 2 + 0.01, 0.1 + hh / 2, i * 0.24, 0.03, hh - 0.1, 0.07);
    k.box(C.ink, 0, 0.1 + hh * 0.4, d / 2 + 0.01, w * 0.7, hh * 0.76, 0.04);
    k.box(C.trim, 0, 0.1 + hh * 0.68, d / 2 + 0.06, w * 0.7, hh * 0.28, 0.08);
    for (const yy of [0.6, 0.74]) k.box(C.metalDark, 0, 0.1 + hh * yy, d / 2 + 0.11, w * 0.7, 0.05, 0.02);
    // the nose of a car
    k.bev(C.cloth, 0, 0.36, d / 2 + 0.16, w * 0.52, 0.4, 0.5, 0.2);
    for (const s of [-1, 1]) { k.box(C.gold, s * w * 0.18, 0.4, d / 2 + 0.42, 0.16, 0.12, 0.04); k.cyl(C.ink, s * w * 0.25, 0.22, d / 2 + 0.2, 0.3, 0.12, 8, 0, 0, H); }
    k.box(C.white, 0, 0.26, d / 2 + 0.42, 0.3, 0.1, 0.03);
    k.box(M.dark, 0, top + 0.03, 0, w + 0.1, 0.07, d + 0.1);
    k.box(T.main, 0, top + 0.14, 0.02, w + 0.24, 0.11, d + 0.3, 0.09);
    for (let i = 0; i < 3; i++) k.cyl(C.ink, -w / 2 - 0.28, 0.17 + i * 0.15, 0.36, 0.46, 0.13, 8);
    k.cyl(C.roof[5], w / 2 + 0.26, 0.38, 0.3, 0.38, 0.56, 8); k.cyl(C.gold, w / 2 + 0.26, 0.4, 0.3, 0.4, 0.09, 8);
    if (lv >= 2) { // a wrench for a sign
      const wr = lv === 3 ? C.gold : C.metal;
      k.push(0, top + 0.62, 0, 0, 0, 0.5);
      k.box(wr, 0, 0, 0, 0.9, 0.16, 0.1); k.box(wr, 0.5, 0.11, 0, 0.26, 0.12, 0.1); k.box(wr, 0.5, -0.11, 0, 0.26, 0.12, 0.1); k.cyl(wr, -0.5, 0, 0, 0.3, 0.1, 8, H);
      k.pop();
      k.box(M.dark, 0, top + 0.3, 0, 0.1, 0.4, 0.1);
    }
    flag(k, T, -w / 2, top + 0.14, -d / 2, 0.76);
    studs(c, 0.26, d / 2 + 0.03, w * 0.42);
    void g;
  },
  /** Вышка связи: a red and white lattice mast with dishes. */
  vyshka: c => {
    const { k, lv, T, M } = c, top = 2.5 + lv * 0.46, o = 0.44, i0 = 0.09, y0 = 0.3, segs = 4;
    k.bev(M.base, 0, 0.06, 0, 1.4, 0.12, 1.4, 0.16);
    k.box(T.main, 0, 0.22, 0, 1.0, 0.2, 1.0);
    for (let s = 0; s < segs; s++) {
      const f0 = s / segs, f1 = (s + 1) / segs, r0 = o + (i0 - o) * f0, r1 = o + (i0 - o) * f1, ya = y0 + (top - y0) * f0, yb = y0 + (top - y0) * f1;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.beam(s % 2 ? C.white : C.danger, sx * r0, ya, sz * r0, sx * r1, yb, sz * r1, 0.11);
      k.box(C.metalDark, 0, yb, 0, r1 * 2 + 0.14, 0.08, r1 * 2 + 0.14);
    }
    k.box(C.metalDark, 0, top + 0.2, 0, 0.1, 0.5, 0.1);
    k.ball(lv === 3 ? C.gold : C.danger, 0, top + 0.5, 0, 0.24);
    const dish = (y: number, ry: number, s: number) => { k.push(0, y, 0, 0, ry, 0, s); k.cyl(C.white, 0, 0, 0.36, 0.56, 0.16, 10, H); k.cyl(C.metalDark, 0, 0, 0.2, 0.12, 0.3, 6, H); k.pop(); };
    dish(top * 0.74, 0.5, 1);
    if (lv >= 2) dish(top * 0.58, -1.2, 0.9);
    if (lv === 3) { dish(top * 0.86, 2.4, 0.8); for (let i = 0; i < 3; i++) { const a = i * 2.09 + 0.3; k.box(C.trim, Math.sin(a) * 0.24, top - 0.2, Math.cos(a) * 0.24, 0.14, 0.5, 0.09, 0, a, 0); } }
    k.box(C.metal, 0.5, 0.42, 0.5, 0.4, 0.56, 0.3); k.box(C.heal, 0.5, 0.56, 0.66, 0.1, 0.1, 0.03);
    flag(k, T, 0, top * 0.4, 0.32, 0.5);
    studs(c, 0.22, 0.52);
  },
  /** Генератор: a yellow diesel set with an exhaust, a barrel and a bolt. */
  generator: c => {
    const { k, lv, g, T, M } = c, w = 1.36 * g, d = 0.9 * g, hh = 0.8 * g, y0 = 0.24, body = lv === 3 ? C.marble : C.gold, top = y0 + hh;
    pad(c, w + 0.6, d + 0.7, w + 0.14, d + 0.14, 0.05);
    for (const s of [-1, 1]) k.box(C.metalDark, 0, 0.2, s * d * 0.3, w + 0.14, 0.14, 0.16);
    k.bev(body, 0, y0 + hh / 2, 0, w, hh, d, 0.12);
    k.box(C.metalDark, 0, top + 0.04, 0, w * 0.86, 0.08, d * 0.8);
    for (let i = 0; i < 3; i++) k.box(C.ink, -w * 0.2, y0 + hh * (0.28 + 0.22 * i), d / 2 + 0.01, w * 0.4, 0.09, 0.04);
    k.box(C.metalDark, w * 0.27, y0 + hh * 0.56, d / 2 + 0.02, w * 0.28, hh * 0.52, 0.05);
    k.box(C.heal, w * 0.21, y0 + hh * 0.66, d / 2 + 0.05, 0.1, 0.1, 0.03); k.box(C.danger, w * 0.33, y0 + hh * 0.66, d / 2 + 0.05, 0.1, 0.1, 0.03);
    // exhaust
    const ex = (x: number) => { k.cyl(C.metalDark, x, top + 0.34, -d * 0.16, 0.18, 0.6, 8); k.box(C.metalDark, x, top + 0.7, -d * 0.16, 0.3, 0.05, 0.3, 0.4); };
    ex(-w * 0.3); if (lv === 3) ex(-w * 0.08);
    // the bolt
    const bx = w * 0.22, by = top + 0.2, bc = lv === 3 ? C.gold : C.magic;
    k.beam(bc, bx + 0.14, by + 0.62, 0, bx - 0.1, by + 0.3, 0, 0.14, 0.09); k.beam(bc, bx - 0.12, by + 0.34, 0, bx + 0.14, by + 0.3, 0, 0.12, 0.09); k.beam(bc, bx + 0.12, by + 0.32, 0, bx - 0.1, by - 0.04, 0, 0.14, 0.09);
    k.cyl(C.danger, w / 2 + 0.28, 0.4, 0.06, 0.4, 0.6, 8); k.cyl(C.white, w / 2 + 0.28, 0.44, 0.06, 0.42, 0.1, 8);
    if (lv >= 2) { k.box(C.metalDark, -w / 2 - 0.3, 0.6, 0.2, 0.1, 1.0, 0.1); k.box(C.metalDark, -w / 2 - 0.3, 1.06, 0.2, 0.5, 0.08, 0.08); for (const s of [-1, 1]) k.box(C.dome, -w / 2 - 0.3 + s * 0.2, 1.16, 0.2, 0.09, 0.14, 0.09); }
    flag(k, T, w / 2 - 0.1, top + 0.08, -d / 2 + 0.1, 0.7);
    studs(c, 0.26, d / 2 + 0.03);
    void M;
  },

  // ---- superweapons ----------------------------------------------------------------------------------------
  /** Сабвуфер: a wall of speakers. */
  sabvufer: c => {
    const { k, lv, T } = c, d = 0.9;
    const cab = (x: number, y: number, w: number, hh: number) => {
      k.bev(C.cloth, x, y + hh / 2, 0, w, hh, d, 0.08);
      k.box(C.metalDark, x, y + hh / 2, d / 2 + 0.01, w - 0.14, hh - 0.14, 0.04);
      const r = Math.min(w, hh) * 0.68;
      k.cyl(C.ink, x, y + hh / 2, d / 2 + 0.04, r, 0.06, 10, H);
      k.cyl(C.metal, x, y + hh / 2, d / 2 + 0.07, r * 0.66, 0.05, 10, H);
      k.ball(C.gold, x, y + hh / 2, d / 2 + 0.08, r * 0.3, 0, 1, 0.5);
    };
    const wT = lv === 1 ? 1.3 : 1.84;
    pad(c, wT + 0.5, d + 0.6, wT + 0.14, d + 0.14, 0.05);
    let top = 0.12;
    if (lv === 1) { cab(0, top, 1.3, 1.3); top += 1.3; }
    else { for (let r = 0; r < lv - 1; r++) { cab(-0.46, top, 0.9, 1.0); cab(0.46, top, 0.9, 1.0); top += 1.0; } cab(0, top, 1.2, 0.9); top += 0.9; }
    // the amp on top: an equaliser and a horn
    k.box(C.metalDark, 0, top + 0.18, 0, 0.9, 0.36, d * 0.8);
    for (let i = 0; i < 5; i++) k.box([C.heal, C.heal, C.gold, C.gold, C.danger][i], -0.3 + i * 0.15, top + 0.12 + (i * 37 % 5) * 0.03, d * 0.4 + 0.01, 0.1, 0.12 + (i * 37 % 5) * 0.05, 0.04);
    k.box(T.main, 0, top + 0.41, 0, 1.0, 0.1, d * 0.8 + 0.1);
    k.cone(lv === 3 ? C.gold : C.metal, 0, top + 0.72, 0.16, 0.66, 0.5, 8, -H);
    k.box(C.metalDark, 0, top + 0.56, -0.06, 0.14, 0.24, 0.14);
    flag(k, T, wT / 2 - 0.1, lv === 1 ? 1.42 : 1.12 + (lv - 2) * 1.0, -0.2, 0.7);
    studs(c, 0.26, d / 2 + 0.03);
  },
  /** Арбузомёт: a trebuchet loaded with a watermelon. */
  arbuzomet: c => {
    const { k, lv, g, T } = c, s = g, wood = lv === 3 ? C.metal : C.wood, dark = lv === 1 ? C.woodDark : C.metalDark;
    pad(c, 1.7 * s, 2.0 * s, 1.3 * s, 1.6 * s);
    for (const sx of [-1, 1]) {
      const x = sx * 0.52 * s;
      k.box(wood, x, 0.36, 0, 0.16, 0.14, 1.6 * s);
      k.beam(wood, x, 0.4, 0.6 * s, x, 1.56 * s, 0, 0.15); k.beam(wood, x, 0.4, -0.6 * s, x, 1.56 * s, 0, 0.15);
      k.box(dark, x, 0.86 * s, 0, 0.1, 0.1, 0.64 * s);
    }
    k.cyl(dark, 0, 1.56 * s, 0, 0.16, 1.3 * s, 6, 0, 0, H);
    k.beam(C.woodDark, 0, 0.92 * s, 0.6 * s, 0, 2.3 * s, -1.0 * s, 0.16);
    k.box(C.concrete, 0, 0.74 * s, 0.66 * s, 0.56 * s, 0.5 * s, 0.46 * s);
    if (lv >= 2) k.box(lv === 3 ? C.gold : C.metalDark, 0, 0.74 * s, 0.66 * s, 0.6 * s, 0.12, 0.5 * s);
    k.cyl(wood, 0, 2.3 * s, -1.02 * s, 0.56 * s, 0.09, 8);
    melon(k, 0, 2.3 * s + 0.36 * s, -1.02 * s, 0.68 * s, true);
    // ammunition
    melon(k, 0.86 * s, 0.38, 0.7, 0.5); melon(k, 0.7 * s, 0.34, 0.24, 0.42);
    if (lv >= 2) melon(k, 0.96 * s, 0.34, 0.3, 0.4);
    k.dome(MELON, -0.84 * s, 0.14, 0.76, 0.5, 0.25); // a cut one
    k.cyl(C.danger, -0.84 * s, 0.14, 0.76, 0.44, 0.04, 8);
    flag(k, T, -0.52 * s, 1.56 * s, 0, 0.8);
    studs(c, 0.26, 0.82 * s);
  },
};

// ---- walls: instanced by the game (post + panels towards the neighbours) ---------------------------------
/** Real height of a wall panel by level (baseView scales the kit to it). */
const WALL_H = [0.95, 1.1, 1.25];
/** One panel from the post's centre to the middle of the gap (z = 0 … 1): профнастил → кирпич → бетон. */
function wallArm(k: Kit, lv: number, unit = true) {
  const hh = WALL_H[lv - 1], sy = unit ? 0.86 / hh : 1;
  if (lv === 1) {
    const sheet = C.fence[2], rib = sheet.clone().lerp(C.white, 0.22);
    k.box(sheet, 0, hh * 0.5 * sy, 0.5, 0.07, (hh - 0.1) * sy, 1);
    k.box(C.metalDark, 0, (hh - 0.06) * sy, 0.5, 0.11, 0.09 * sy, 1);
    for (const s of [-1, 1]) for (const z of [0.36, 0.68, 1.0]) {
      const x0 = s * 0.035, x1 = s * 0.08, y0 = 0.08 * sy, y1 = (hh - 0.1) * sy;
      k.quad(rib, [x0, y0, z - 0.1], [x1, y0, z - 0.05], [x1, y1, z - 0.05], [x0, y1, z - 0.1], true);
      k.quad(rib, [x1, y0, z - 0.05], [x1, y0, z + 0.05], [x1, y1, z + 0.05], [x1, y1, z - 0.05], true);
      if (z < 1) k.quad(rib, [x1, y0, z + 0.05], [x0, y0, z + 0.1], [x0, y1, z + 0.1], [x1, y1, z + 0.05], true);
    }
  } else if (lv === 2) {
    k.box(C.concrete, 0, 0.09 * sy, 0.5, 0.3, 0.18 * sy, 1);
    k.box(C.wall[3], 0, hh * 0.52 * sy, 0.5, 0.22, (hh - 0.2) * sy, 1);
    k.box(C.wall[2], 0, hh * 0.56 * sy, 0.6, 0.25, 0.2 * sy, 0.8);
    k.box(C.trim, 0, (hh - 0.05) * sy, 0.5, 0.32, 0.1 * sy, 1);
  } else {
    k.box(C.metalDark, 0, 0.1 * sy, 0.5, 0.32, 0.2 * sy, 1);
    k.box(C.concrete, 0, hh * 0.54 * sy, 0.5, 0.17, (hh - 0.2) * sy, 1);
    for (const s of [-1, 1]) for (const z of [0.42, 0.82]) k.put(pyr(), C.panel[0], s * 0.085, hh * 0.56 * sy, z, 0.34, 0.07, 0.56 * sy, 0, 0, -s * H);
    k.box(C.metal, 0, (hh - 0.04) * sy, 0.5, 0.24, 0.08 * sy, 1);
  }
}
let PYR: Float32Array | null = null;
/** A flat four-sided pyramid (the diamond of a concrete fence panel), base in the x–z plane, apex +y. */
function pyr(): Float32Array {
  if (PYR) return PYR;
  const P = [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5]], A = [0, 1, 0], out: number[] = [];
  for (let i = 0; i < 4; i++) out.push(...P[(i + 1) % 4], ...P[i], ...A);
  return (PYR = new Float32Array(out));
}
/** A wall post, unit height (baseView scales it); `c` white = the instance colour shows as it is. */
function wallPost(k: Kit, lv: number, c: Col, unit = true) {
  const hh = WALL_H[lv - 1] + 0.2, sy = unit ? 1 / hh : 1, dk = c.clone().multiplyScalar(0.72);
  if (lv === 1) { k.box(c, 0, hh * 0.5 * sy, 0, 0.2, hh * sy, 0.2); k.box(dk, 0, (hh - 0.03) * sy, 0, 0.3, 0.07 * sy, 0.3); k.box(dk, 0, 0.06 * sy, 0, 0.32, 0.12 * sy, 0.32); }
  else if (lv === 2) { k.box(c, 0, (hh - 0.1) * 0.5 * sy, 0, 0.42, (hh - 0.1) * sy, 0.42); k.box(dk, 0, 0.1 * sy, 0, 0.5, 0.2 * sy, 0.5); k.tbox(dk, 0, (hh - 0.14) * sy, 0, 0.54, 0.54, 0.14, 0.14, 0.18 * sy); }
  else { k.bev(c, 0, (hh - 0.14) * 0.5 * sy, 0, 0.44, (hh - 0.14) * sy, 0.44, 0.2); k.box(dk, 0, 0.11 * sy, 0, 0.54, 0.22 * sy, 0.54); k.box(dk, 0, (hh - 0.16) * sy, 0, 0.56, 0.1 * sy, 0.56); k.tbox(c, 0, (hh - 0.11) * sy, 0, 0.4, 0.4, 0.2, 0.2, 0.14 * sy); }
}
const wallCache: ({ post: THREE.BufferGeometry; arm: THREE.BufferGeometry } | undefined)[] = [];
/**
 * The instanced wall kit of a level (1..3): `post` is 1 unit tall and takes the team colour as its instance
 * colour, `arm` is 0.86 tall, runs from z = 0 to 1 and carries its own colours (профнастил / кирпич / бетон).
 * Draw both with mat.solid(). Shared geometries: don't dispose.
 */
export function wallKit(level: number) {
  const lv = Math.max(1, Math.min(3, level | 0));
  let w = wallCache[lv];
  if (!w) { const p = new Kit(), a = new Kit(); wallPost(p, lv, C.white); wallArm(a, lv); wallCache[lv] = w = { post: p.build(), arm: a.build() }; }
  return w;
}

// ---- the factory -----------------------------------------------------------------------------------------
/** Every building key that has a model here. */
export const BASE_KEYS = Object.keys(MODELS);
interface Built { body: THREE.BufferGeometry; head: THREE.BufferGeometry | null; pivot: number[]; h: number; tris: number }
const built = new Map<string, Built>();
function build(key: string, level: number, side: 0 | 1): Built | null {
  const fn = MODELS[key];
  if (!fn) return null;
  const lv = Math.max(1, Math.min(3, level | 0)), ck = `${key}|${lv}|${side}`;
  let b = built.get(ck);
  if (!b) {
    const k = new Kit(), h = new Kit();
    const pivot = fn({ k, h, lv, T: TEAM[side], M: mats(lv), g: 1 + (lv - 1) * 0.13 }) ?? [0, 0, 0];
    const body = k.build(), head = h.empty ? null : h.build();
    b = { body, head, pivot, h: Math.max(body.boundingBox!.max.y, head ? head.boundingBox!.max.y + pivot[1] : 0), tris: k.tris + h.tris };
    built.set(ck, b);
  }
  return b;
}
/**
 * The model of building `key` at `level` (1..3) for `side`, standing on y = 0 with its front towards +z.
 * A child named 'head' turns to the target (its +z is the aim); buildings that do not aim get an empty one,
 * so their fronts stay turned to the camera. Geometry is cached and shared; null for an unknown key.
 */
export function baseModel(key: string, level: number, side: 0 | 1): THREE.Object3D | null {
  const b = build(key, level, side);
  if (!b) return null;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(b.body, mat.solid()));
  const head: THREE.Object3D = b.head ? new THREE.Mesh(b.head, mat.solid()) : new THREE.Object3D();
  head.name = 'head';
  head.position.set(b.pivot[0], b.pivot[1], b.pivot[2]);
  g.add(head);
  g.userData.tris = b.tris;
  return g;
}
/** The same factory by key, for tools. */
export const BASE_MODELS: Record<string, (level: number, side: 0 | 1) => THREE.Object3D> = Object.fromEntries(BASE_KEYS.map(k => [k, (level: number, side: 0 | 1) => baseModel(k, level, side)!]));
/** Height and triangle count of a model (labels, bars, budgets). */
export function baseModelInfo(key: string, level: number, side: 0 | 1 = 0): { h: number; tris: number } | null {
  const b = build(key, level, side);
  return b && { h: b.h, tris: b.tris };
}

const ghosts = new Map<string, THREE.BufferGeometry>();
/**
 * One merged geometry of a level-1 model for the placement ghost (the head turned the way it will stand),
 * colours lifted towards white so a green / red tint keeps the shapes readable. null for an unknown key.
 */
export function baseGhostGeometry(key: string, side: 0 | 1): THREE.BufferGeometry | null {
  const ck = `${key}|${side}`;
  let g = ghosts.get(ck);
  if (g) return g;
  const b = build(key, 1, side);
  if (!b) return null;
  const pos: number[] = [...(b.body.attributes.position.array as Float32Array)], col: number[] = [...(b.body.attributes.color.array as Float32Array)];
  if (b.head) {
    const P = b.head.attributes.position.array as Float32Array, s = side === 0 ? 1 : -1; // yaw ±π/2: +z → ±x
    for (let i = 0; i < P.length; i += 3) pos.push(b.pivot[0] + s * P[i + 2], b.pivot[1] + P[i + 1], b.pivot[2] - s * P[i]);
    col.push(...(b.head.attributes.color.array as Float32Array));
  }
  for (let i = 0; i < col.length; i++) col[i] = 0.45 + col[i] * 0.55;
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  ghosts.set(ck, g);
  return g;
}
