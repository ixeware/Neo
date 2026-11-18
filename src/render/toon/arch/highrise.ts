// The two high-rises in the new style (world.ts HqBuilding uses these behind TOON): one merged, vertex-coloured
// geometry per floor (so floors still drop one by one), one for the roof with its turret, one for the ground
// around the entrances. Атаги: a red-brick трёхэтажка with yellow-brick corners and white balconies;
// Курчалой: a panel пятиэтажка with four entrances, loggia columns and a mural on its end walls.
// Local frame: x along the long side, the front (entrances) towards +z, a floor from y = 0 to fh.
import * as THREE from 'three';
import { C, TEAM } from '../../style';
import { Kit } from '../kit';
import { hash2 } from '../../lowpoly';

type Col = THREE.Color;
const H = Math.PI / 2;
const cache = new Map<string, THREE.BufferGeometry>();
const once = (key: string, make: () => Kit) => { let g = cache.get(key); if (!g) { g = make().build(); cache.set(key, g); } return g; };

/** A window on a wall facing ±z (rz = 0) or ±x (rz = 1): a pale frame standing 0.03 proud, glass, a sill. `out` = +1 / −1 side of the wall. */
function win(k: Kit, glass: Col, along: number, y: number, face: number, out: number, w: number, hh: number, onX = false, sill = true) {
  const f = 0.03 * out, p = (a: number, yy: number, o: number, sa: number, sy: number, so: number, c: Col) => onX ? k.box(c, face + o, yy, a, so, sy, sa) : k.box(c, a, yy, face + o, sa, sy, so);
  p(along, y, f / 2, w + 0.1, hh + 0.1, 0.03, C.trim);
  p(along, y, f + 0.005 * out, w, hh, 0.012, glass);
  p(along, y, f + 0.012 * out, 0.035, hh, 0.012, C.trim);
  if (sill) p(along, y - hh / 2 - 0.06, f, w + 0.18, 0.05, 0.09, C.trim);
}
const lit = (side: number, i: number, j: number, n = 5) => (hash2(side * 31 + i * 7 + 3, j * 13 + i) * n | 0) === 0;
const glassOf = (side: number, i: number, j: number) => lit(side, i, j) ? C.glassLit : C.glass;

/** A balcony on the front (+z) at x: a slab, a solid parapet in `c`, a rail on top; sometimes laundry, a dish or a box. */
function balcony(k: Kit, x: number, z: number, w: number, c: Col, extra: number, fh: number) {
  const d = 0.34, y = 0.06;
  k.box(C.concrete, x, y, z + d / 2, w, 0.06, d);
  k.box(c, x, y + 0.2, z + d - 0.02, w, 0.34, 0.05);
  for (const s of [-1, 1]) k.box(c, x + s * (w / 2 - 0.025), y + 0.2, z + d / 2, 0.05, 0.34, d);
  k.box(C.metalDark, x, y + 0.39, z + d - 0.02, w + 0.04, 0.04, 0.08);
  if (extra === 1) { // laundry on a line
    k.box(C.metalDark, x, fh * 0.74, z + d - 0.03, w, 0.02, 0.02);
    const cols = [C.white, C.roof[2], C.roof[6], C.wall[5]];
    for (let i = 0; i < 3; i++) k.box(cols[(i + Math.abs(x * 10 | 0)) % 4], x - w / 2 + 0.14 + i * (w - 0.28) / 2, fh * 0.74 - 0.1, z + d - 0.03, 0.15, 0.2, 0.02);
  } else if (extra === 2) { // a satellite dish
    k.push(x + w / 2 - 0.1, y + 0.56, z + d + 0.02, -0.5, 0.5, 0);
    k.cyl(C.white, 0, 0, 0, 0.3, 0.04, 8, H); k.box(C.metalDark, 0, 0, 0.09, 0.03, 0.03, 0.16);
    k.pop();
  } else if (extra === 3) { // a flower box
    k.box(C.woodDark, x, y + 0.46, z + d + 0.03, w * 0.7, 0.08, 0.1);
    for (let i = 0; i < 3; i++) k.box([C.danger, C.gold, C.wall[5]][i], x - w * 0.22 + i * w * 0.22, y + 0.53, z + d + 0.03, 0.09, 0.07, 0.08);
  }
}
/** An air conditioner under a window on the front. */
function aircon(k: Kit, x: number, y: number, z: number) {
  k.box(C.white, x, y, z + 0.07, 0.3, 0.2, 0.14);
  k.box(C.metalDark, x - 0.04, y, z + 0.145, 0.15, 0.13, 0.012);
}

/** One storey: `i` = 0 is the ground floor (doors, plinth), the others alternate their details. */
export function hqFloorGeo(side: 0 | 1, len: number, fh: number, dep: number, i: number): THREE.BufferGeometry {
  const v = i === 0 ? 0 : 1 + ((i - 1) % 3);
  return once(`f|${side}|${v}`, () => {
    const k = new Kit(), T = TEAM[side], hz = dep / 2, hx = len / 2;
    if (side === 0) {
      // ---- Атаги: brick ----
      const brick = C.wall[2], quoin = C.wall[3];
      k.box(brick, 0, fh / 2, 0, len, fh, dep);
      if (v === 0) k.box(C.concrete, 0, 0.09, 0, len + 0.08, 0.18, dep + 0.08);
      k.box(C.trim, 0, fh - 0.045, 0, len + 0.12, 0.09, dep + 0.12);
      k.box(quoin, 0, fh - 0.13, 0, len + 0.05, 0.06, dep + 0.05);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(quoin, sx * (hx - 0.07), fh / 2 - 0.05, sz * (hz - 0.07), 0.2, fh - 0.1, 0.2);
      const n = 5, step = len / n;
      for (let b = 0; b < n; b++) {
        const x = -hx + (b + 0.5) * step;
        if (b === 2) { // the stairwell over the entrance: a tall strip of glass
          k.box(quoin, x, fh / 2, hz + 0.02, 0.74, fh, 0.05);
          if (v === 0) { k.box(C.trim, x, 0.37, hz + 0.05, 0.5, 0.74, 0.04); k.box(C.door, x, 0.35, hz + 0.062, 0.4, 0.68, 0.03); k.box(C.gold, x + 0.13, 0.36, hz + 0.08, 0.04, 0.08, 0.02); }
          else win(k, glassOf(side, v, b), x, fh * 0.48, hz + 0.045, 1, 0.34, fh * 0.66, false, false);
        } else {
          const bal = v > 0 && (b === 0 || b === 4 || (v === 2 && b === 3));
          win(k, glassOf(side, v, b), x, bal ? fh * 0.47 : fh * 0.52, hz, 1, bal ? 0.42 : 0.5, bal ? fh * 0.66 : fh * 0.5, false, !bal);
          if (bal) balcony(k, x, hz, 0.78, b === 3 ? T.light : C.trim, ((v + b) % 4), fh);
          else if ((v + b) % 3 === 1 && v > 0) aircon(k, x + 0.12, fh * 0.13, hz);
        }
        win(k, glassOf(side, v + 5, b), x, fh * 0.52, -hz, -1, 0.5, fh * 0.5);
      }
      for (const sx of [-1, 1]) for (const z of [-0.8, 0, 0.8]) win(k, glassOf(side, v + 9 + sx, z * 5 + 4), z, fh * 0.52, sx * hx, sx, 0.46, fh * 0.5, true);
      for (const sx of [-1, 1]) k.box(C.metalDark, sx * (hx - 0.26), fh / 2, hz + 0.05, 0.07, fh, 0.07); // drain pipes
    } else {
      // ---- Курчалой: panels, four entrances ----
      const pan = C.panel[0], seam = C.panel[1];
      k.box(pan, 0, fh / 2, 0, len, fh, dep);
      if (v === 0) k.box(C.metalDark, 0, 0.08, 0, len + 0.06, 0.16, dep + 0.06);
      k.box(seam, 0, fh - 0.025, 0, len + 0.05, 0.05, dep + 0.05);
      const ns = 4, sw = len / ns, cols = [C.balcony, T.light, C.roof[5], C.wall[5]];
      for (let s = 0; s < ns; s++) {
        const x = -hx + (s + 0.5) * sw;
        k.box(seam, x - sw / 2 + 0.001, fh / 2, 0, 0.05, fh, dep + 0.03);
        // the stairwell: a slightly proud shaft with its window half a floor up
        k.box(seam, x, fh / 2, hz + 0.03, 0.5, fh, 0.06);
        if (v === 0) { k.box(C.trim, x, 0.31, hz + 0.065, 0.36, 0.62, 0.03); k.box(C.door, x, 0.29, hz + 0.075, 0.28, 0.56, 0.03); }
        else win(k, glassOf(side, v, s * 3), x, fh * 0.5, hz + 0.06, 1, 0.24, fh * 0.42, false, false);
        // a loggia on the left, a window on the right; they swap in every other section
        const flip = s % 2 ? -1 : 1, xl = x - flip * 0.62, xr = x + flip * 0.62;
        win(k, glassOf(side, v, s * 3 + 1), xl, v === 0 ? fh * 0.56 : fh * 0.5, hz, 1, 0.4, v === 0 ? fh * 0.44 : fh * 0.6, false, v === 0);
        if (v > 0) balcony(k, xl, hz, 0.7, cols[s], (v + s) % 4 === 2 ? 0 : (v * 2 + s) % 4, fh);
        win(k, glassOf(side, v, s * 3 + 2), xr, fh * 0.56, hz, 1, 0.46, fh * 0.46);
        if (v > 0 && (v + s) % 3 === 0) aircon(k, xr + 0.1, fh * 0.14, hz);
        for (const dx of [-0.5, 0.5]) win(k, glassOf(side, v + 6, s * 2 + (dx > 0 ? 1 : 0)), x + dx, fh * 0.56, -hz, -1, 0.44, fh * 0.46);
      }
      k.box(seam, hx - 0.001, fh / 2, 0, 0.05, fh, dep + 0.03);
      // blind end walls: a mural in the team colours climbs them floor by floor
      for (const sx of [-1, 1]) {
        const xw = sx * (hx + 0.012);
        k.box(T.main, xw, fh / 2, 0, 0.03, fh, 0.5);
        k.box(C.gold, xw + sx * 0.008, fh / 2, 0, 0.03, fh * 0.42, 0.9, v % 2 ? 0.5 : -0.5, 0, 0);
        k.box(T.light, xw, fh / 2, (v % 2 ? 0.62 : -0.62), 0.03, fh * 0.5, 0.3);
      }
    }
    return k;
  });
}

/** The roof: slab and parapet with a team band, lift boxes, a water tank, an antenna, dishes and the turret that guards the house. */
export function hqRoofGeo(side: 0 | 1, len: number, dep: number): THREE.BufferGeometry {
  return once(`r|${side}`, () => {
    const k = new Kit(), T = TEAM[side], hx = len / 2, hz = dep / 2;
    k.box(C.roof[4], 0, 0.05, 0, len + 0.14, 0.1, dep + 0.14);
    // parapet: four bars, the team band outside
    for (const s of [-1, 1]) {
      k.box(C.concrete, 0, 0.2, s * (hz + 0.02), len + 0.2, 0.24, 0.1);
      k.box(C.concrete, s * (hx + 0.02), 0.2, 0, 0.1, 0.24, dep + 0.1);
      k.box(T.main, 0, 0.19, s * (hz + 0.075), len + 0.22, 0.13, 0.03);
      k.box(T.main, s * (hx + 0.075), 0.19, 0, 0.03, 0.13, dep + 0.22);
    }
    // lift / stair boxes with a door and a little roof
    const boxes = side === 0 ? [len * 0.3] : [-len * 0.3, len * 0.12];
    for (const x of boxes) {
      k.box(C.panel[1], x, 0.34, -0.1, 0.7, 0.5, 0.7);
      k.box(C.roof[4], x, 0.62, -0.1, 0.82, 0.07, 0.82);
      k.box(C.door, x, 0.3, 0.26, 0.24, 0.4, 0.03);
    }
    // a water tank on legs
    const tx = side === 0 ? -len * 0.36 : len * 0.36;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(C.metalDark, tx + sx * 0.2, 0.3, -hz * 0.4 + sz * 0.2, 0.06, 0.42, 0.06);
    k.cyl(C.gold, tx, 0.72, -hz * 0.4, 0.62, 0.46, 8);
    k.cone(C.metalDark, tx, 1.02, -hz * 0.4, 0.66, 0.16, 8);
    // an antenna mast and two dishes
    const ax = side === 0 ? -len * 0.08 : -len * 0.44;
    k.box(C.metalDark, ax, 0.9, -hz * 0.5, 0.07, 1.6, 0.07);
    for (const y of [1.2, 1.5]) k.box(C.metal, ax, y, -hz * 0.5, 0.56 - (y - 1.2), 0.05, 0.05);
    k.box(C.danger, ax, 1.74, -hz * 0.5, 0.12, 0.12, 0.12);
    for (const [dx, ry] of [[0.5, 0.6], [-0.42, -0.8]]) {
      k.push(ax + dx, 0.42, -hz * 0.55, 0, ry, 0);
      k.box(C.metalDark, 0, -0.14, 0, 0.06, 0.3, 0.06);
      k.push(0, 0.04, 0, -0.7, 0, 0); k.cyl(C.white, 0, 0, 0, 0.42, 0.05, 8, H); k.box(C.metalDark, 0, 0, 0.12, 0.03, 0.03, 0.2); k.pop();
      k.pop();
    }
    // vents
    for (const x of side === 0 ? [0.5] : [-0.6, 1.4, 2.6]) { k.box(C.metal, x, 0.2, hz * 0.45, 0.26, 0.22, 0.26); k.box(C.metalDark, x, 0.33, hz * 0.45, 0.32, 0.05, 0.32); }
    // the turret: an armoured tub in the team colour with a twin gun
    const ux = side === 0 ? len * 0.02 : len * 0.33, uz = hz * 0.1;
    k.cyl(C.metalDark, ux, 0.17, uz, 0.9, 0.16, 8, 0, Math.PI / 8);
    k.tap(T.main, ux, 0.42, uz, 0.74, 0.56, 0.36, 8, 0, Math.PI / 8);
    k.cyl(T.dark, ux, 0.62, uz, 0.6, 0.06, 8, 0, Math.PI / 8);
    k.push(ux, 0.6, uz, -0.32, side === 0 ? 0.9 : -0.9, 0);
    for (const s of [-1, 1]) { k.box(C.metalDark, s * 0.11, 0.06, 0.42, 0.1, 0.1, 0.84); k.box(C.gold, s * 0.11, 0.06, 0.82, 0.13, 0.13, 0.08); }
    k.box(C.metal, 0, 0.06, 0.06, 0.4, 0.2, 0.3);
    k.pop();
    return k;
  });
}

/** Around the entrances: an apron with a kerb, steps, canopies in the team colour, benches, lamps, flower beds, a notice board. */
export function hqGroundGeo(side: 0 | 1, len: number, dep: number): THREE.BufferGeometry {
  return once(`g|${side}`, () => {
    const k = new Kit(), T = TEAM[side], hx = len / 2, hz = dep / 2;
    k.bev(C.concrete, 0, -0.1, 0.25, len + 1.3, 0.34, dep + 1.8, 0.08);
    k.bev(C.yard[2], 0, 0.075, 0.25, len + 1.1, 0.02, dep + 1.6, 0.08);
    const n = side === 0 ? 1 : 4;
    for (let e = 0; e < n; e++) {
      const x = n === 1 ? 0 : -hx + (e + 0.5) * (len / n), z = hz;
      k.box(C.concrete, x, 0.11, z + 0.22, 0.7, 0.06, 0.44); k.box(C.concrete, x, 0.15, z + 0.13, 0.6, 0.06, 0.26);
      for (const s of [-1, 1]) k.box(C.metalDark, x + s * 0.3, 0.42, z + 0.4, 0.05, 0.62, 0.05);
      k.box(T.main, x, 0.76, z + 0.24, 0.8, 0.07, 0.5, 0.12);
      k.box(T.dark, x, 0.71, z + 0.48, 0.82, 0.09, 0.04);
    }
    // benches by the door, a lamp at each end, flower beds along the front, a bin
    const bench = (x: number, z: number) => { k.box(C.wood, x, 0.2, z, 0.5, 0.05, 0.18); k.box(C.wood, x, 0.34, z - 0.09, 0.5, 0.16, 0.04); for (const s of [-1, 1]) k.box(C.metalDark, x + s * 0.2, 0.13, z, 0.05, 0.1, 0.16); };
    const lamp = (x: number, z: number) => { k.box(C.metalDark, x, 0.75, z, 0.07, 1.3, 0.07); k.box(C.metalDark, x, 1.4, z + 0.1, 0.09, 0.06, 0.3); k.box(C.glassLit, x, 1.36, z + 0.2, 0.16, 0.08, 0.16); };
    const bed = (x: number, z: number, w: number) => {
      k.box(C.wall[3], x, 0.13, z, w, 0.1, 0.3);
      k.box(C.leaf[0], x, 0.2, z, w - 0.08, 0.08, 0.22);
      for (let i = 0; i < 4; i++) k.box([C.danger, C.gold, C.wall[5], C.white][i], x - w / 2 + 0.16 + i * (w - 0.32) / 3, 0.27, z + (i % 2 ? 0.04 : -0.04), 0.09, 0.08, 0.09);
    };
    if (side === 0) {
      bench(-0.85, hz + 0.34); bench(0.85, hz + 0.34);
      bed(-1.75, hz + 0.3, 0.9); bed(1.75, hz + 0.3, 0.9);
    } else for (let e = 0; e < 4; e++) { const x = -hx + (e + 0.5) * (len / 4); bench(x + 0.62, hz + 0.3); bed(x - 0.66, hz + 0.28, 0.66); }
    lamp(-hx - 0.3, hz + 0.75); lamp(hx + 0.3, hz + 0.75);
    k.box(C.metalDark, hx * 0.5, 0.2, hz + 0.86, 0.14, 0.22, 0.14); // a bin
    // a notice board by the path
    const nx = side === 0 ? -hx * 0.62 : hx * 0.74;
    for (const s of [-1, 1]) k.box(C.woodDark, nx + s * 0.22, 0.35, hz + 0.95, 0.05, 0.56, 0.05);
    k.box(C.wood, nx, 0.5, hz + 0.95, 0.52, 0.34, 0.04);
    for (let i = 0; i < 3; i++) k.box([C.white, C.gold, C.white][i], nx - 0.15 + i * 0.15, 0.5 + (i % 2) * 0.04, hz + 0.975, 0.11, 0.15, 0.01);
    k.dropBottoms(0.3);
    return k;
  });
}
