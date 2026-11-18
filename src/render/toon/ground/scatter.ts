// Plants and props of the toon map, placed by rules from the real map data and merged into ONE mesh per map
// chunk (one draw call for every tree, bush, bale, bench, lamp, stall and parked car in it).
// Inside a chunk the objects are ordered big → small and shuffled within each class, so drawing a prefix of
// the index buffer is a level of detail: near, everything; further out the small props go, then the mid-size
// things, then the trees thin out (updateScatterLod).
// Placement is hashed from positions and indices only: every client sees the same map on every load.
// Nothing solid stands on a road, in water, in a house, or in a buildable cell of a build zone.
import * as THREE from 'three';
import { LC, EXAG, heightY, type Terrain } from '../../../world/terrain';
import { HQ } from '../../../sim/defs';
import { BASE } from '../../../sim/bdefs';
import { hash2, tinClass, type Tin } from '../../lowpoly';
import { roadNet, roadClearance, RC, ROAD_HALF, ALL_MASK } from '../../roads';
import { cityQ } from '../../city';
import { propUnitGeometry, GELIK } from '../../props';
import { v4UnitGeometry } from '../../grozny';
import { C, STYLE, mat } from '../../style';
import { GC } from './colors';
import { buildKits, kitFromGeometry, type Kit } from './kits';
import { hqSpots, ZONE_MAX, type HouseSpot, type Plaza, type ShoreEdge } from './paint';

/** LOD classes: 0 trees, 1 mid-size things seen from afar (bushes, bales, boulders), 2 small props. */
interface Item { kit: Kit; x: number; z: number; y: number; ry: number; sx: number; sy: number; sz: number; c1: THREE.Color; c2: THREE.Color; cls: 0 | 1 | 2 }

interface Chunk { mesh: THREE.Mesh; x: number; z: number; ends: Uint32Array; n: [number, number, number] }
const chunks: Chunk[] = [];
const CHUNK = 56;

const hexes = (a: readonly string[]) => a.map(h => new THREE.Color(h));

export interface ScatterEnv {
  t: Terrain; tin: Tin; low: boolean;
  houses: HouseSpot[]; plazas: Plaza[]; shore: ShoreEdge[];
  /** world.ts's keep-clear test for trees (bridges, landmarks, decor, roads, city blocks) */
  skip: (x: number, z: number) => boolean;
}

/** What scatter learned about the map and life.ts reuses. */
export interface ScatterOut { free: (x: number, z: number, r: number) => boolean; count: number; tris: number }

export function buildScatter(parent: THREE.Object3D, env: ScatterEnv): ScatterOut {
  const { t, tin, low, houses, plazas, shore, skip } = env;
  const K = buildKits(low);
  const LEAF = C.leaf, FIR = C.fir;
  const FRUITLEAF = [C.leaf[3], C.leaf[5], C.leaf[1]];
  const FRUIT = hexes(GC.fruit), FLOWER = hexes(GC.flower), BOULDER = hexes(GC.boulder), AWN = hexes(GC.awning), CAR = hexes(GC.car);
  const WHITE = new THREE.Color(1, 1, 1);
  const items: Item[] = [];
  const net = roadNet();
  const dens = low ? 0.5 : 1;
  const hqs = hqSpots(t);

  // ---- where things may stand ----------------------------------------------------------------------------
  // houses: 1-unit hash of centres
  const gw = Math.ceil(t.W), gh = Math.ceil(t.H - t.z0);
  const hHead = new Int32Array(gw * gh).fill(-1), hNext = new Int32Array(houses.length);
  houses.forEach((h, i) => {
    const k = Math.min(gh - 1, Math.max(0, Math.floor(h.z - t.z0))) * gw + Math.min(gw - 1, Math.max(0, Math.floor(h.x)));
    hNext[i] = hHead[k]; hHead[k] = i;
  });
  const inHouse = (x: number, z: number, r: number) => {
    const ci = Math.floor(x), cj = Math.floor(z - t.z0);
    for (let j = Math.max(0, cj - 1); j <= Math.min(gh - 1, cj + 1); j++) for (let i = Math.max(0, ci - 1); i <= Math.min(gw - 1, ci + 1); i++) {
      for (let p = hHead[j * gw + i]; p >= 0; p = hNext[p]) {
        const h = houses[p], dx = x - h.x, dz = z - h.z, c = Math.cos(h.ry), s = Math.sin(h.ry);
        if (Math.abs(dx * c - dz * s) < h.w / 2 + r && Math.abs(dx * s + dz * c) < h.d / 2 + r) return true;
      }
    }
    return false;
  };
  // our own things: half-unit hash of discs
  const og = 2, ow = gw * og, oh = gh * og;
  const oHead = new Int32Array(ow * oh).fill(-1), oNext: number[] = [], oX: number[] = [], oZ: number[] = [], oR: number[] = [];
  const taken = (x: number, z: number, r: number) => {
    const ci = Math.floor(x * og), cj = Math.floor((z - t.z0) * og), k = Math.ceil((r + 0.6) * og);
    for (let j = Math.max(0, cj - k); j <= Math.min(oh - 1, cj + k); j++) for (let i = Math.max(0, ci - k); i <= Math.min(ow - 1, ci + k); i++) {
      for (let p = oHead[j * ow + i]; p >= 0; p = oNext[p]) { const dx = oX[p] - x, dz = oZ[p] - z, rr = oR[p] + r; if (dx * dx + dz * dz < rr * rr) return true; }
    }
    return false;
  };
  const take = (x: number, z: number, r: number) => {
    const k = Math.min(oh - 1, Math.max(0, Math.floor((z - t.z0) * og))) * ow + Math.min(ow - 1, Math.max(0, Math.floor(x * og)));
    oNext.push(oHead[k]); oHead[k] = oX.length; oX.push(x); oZ.push(z); oR.push(r);
  };
  /** A buildable cell of a build zone may be anywhere from the keep-out ring to the widest zone (cells are 2 × 2). */
  const inZone = (x: number, z: number, r: number) => {
    for (const h of hqs) {
      const d = Math.hypot(x - h.x, z - h.z);
      if (d < ZONE_MAX + 1.45 + r && d > HQ.radius[h.side] + BASE.keep - 1.45 - r) return true;
    }
    return false;
  };
  /** May a thing of radius r stand here? Off the map edge, water, roads, houses, build zones and each other. */
  const free = (x: number, z: number, r: number, roadGap = 0.07): boolean => {
    if (x < 0.8 || z < t.z0 + 0.8 || x > t.W - 0.8 || z > t.H - 0.8) return false;
    if (inZone(x, z, r)) return false;
    if (roadClearance(x, z, ALL_MASK) < r + roadGap) return false;
    if (tinClass(tin, x, z) === LC.WATER) return false;
    if (inHouse(x, z, r + 0.03) || taken(x, z, r)) return false;
    return true;
  };
  const put = (kit: Kit, x: number, z: number, r: number, o: { ry?: number; s?: number; sy?: number; c1?: THREE.Color; c2?: THREE.Color; cls?: 0 | 1 | 2; sink?: number } = {}) => {
    const s = o.s ?? 1;
    items.push({ kit, x, z, y: heightY(t, x, z) - (o.sink ?? 0.02), ry: o.ry ?? 0, sx: s, sy: s * (o.sy ?? 1), sz: s, c1: o.c1 ?? WHITE, c2: o.c2 ?? WHITE, cls: o.cls ?? 2 });
    take(x, z, r);
  };
  const tryPut = (kit: Kit, x: number, z: number, r: number, o: Parameters<typeof put>[4] = {}, big = false) => {
    if (!free(x, z, r) || (big && skip(x, z))) return false;
    put(kit, x, z, r, o);
    return true;
  };
  const pick = <T>(a: readonly T[], h: number): T => a[Math.min(a.length - 1, Math.floor(h * a.length))];
  const H = hash2;

  // ---- plaza furniture: lamps, benches, flower beds, stalls, trees (before anything else claims the room) --
  plazas.forEach((p, pi) => {
    const ringOf = (kit: Kit, n: number, rad: number, r: number, a0: number, o: (k: number, a: number) => Parameters<typeof put>[4]) => {
      for (let k = 0; k < n; k++) { const a = a0 + (k / n) * Math.PI * 2; tryPut(kit, p.x + Math.sin(a) * rad, p.z + Math.cos(a) * rad, r, o(k, a)); }
    };
    const fl = (k: number) => ({ c1: pick(FLOWER, H(pi * 7 + k, 3)), c2: pick(FLOWER, H(pi * 5 + k, 9)), cls: 2 as const, ry: k });
    const a0 = H(pi, 17) * 6.28;
    if (p.kind === 'hq') {
      // only the keep-out core is free of build cells: flower beds, lamps and benches along the long sides
      const s = p.side ?? 0, rot = s === 0 ? 0.35 : -0.25, len = s === 0 ? 4.8 : 7.8, dep = s === 0 ? 3.0 : 2.2;
      const c = Math.cos(rot), sn = Math.sin(rot);
      const at = (lx: number, lz: number) => [p.x + lx * c + lz * sn, p.z - lx * sn + lz * c] as const;
      const n = s === 0 ? 4 : 6;
      for (let k = 0; k < n; k++) {
        const lx = -len / 2 + (k + 0.5) * (len / n);
        const [bx, bz] = at(lx, -dep / 2 - 0.42);
        tryPut(k % 2 ? K.bench : K.flowers, bx, bz, 0.2, k % 2 ? { ry: rot + Math.PI } : fl(k));
        if (k % 2 === 0) { const [fx, fz] = at(lx + len / n / 2, dep / 2 + 0.62); tryPut(K.flowers, fx, fz, 0.2, fl(k + 9)); }
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const [lx, lz] = at(sx * (len / 2 + 0.25), sz * (dep / 2 + 0.3)); tryPut(K.lamp, lx, lz, 0.1, { ry: rot + (sx < 0 ? Math.PI : 0) }); }
      return;
    }
    const lamps = p.kind === 'city' ? 6 : p.kind === 'flag' || p.kind === 'mosque' || p.kind === 'place' ? 4 : p.kind === 'market' || p.kind === 'stadium' || p.kind === 'school' || p.kind === 'park' ? 3 : 0;
    ringOf(K.lamp, lamps, p.r - 0.15, 0.1, a0, (_k, a) => ({ ry: a + Math.PI / 2 }));
    if (p.kind === 'market') {
      ringOf(K.stall, low ? 6 : 10, p.r - 0.5, 0.3, a0 + 0.3, (k, a) => ({ ry: a, c1: pick(AWN, H(pi + k, 5)), c2: WHITE }));
      ringOf(K.crates, 5, p.r - 0.1, 0.16, a0 + 0.9, (k) => ({ ry: k, c1: pick(AWN, H(pi + k, 7)) }));
    } else if (p.kind === 'stop') {
      tryPut(K.bench, p.x + Math.sin(a0) * (p.r - 0.2), p.z + Math.cos(a0) * (p.r - 0.2), 0.2, { ry: a0 + Math.PI });
      tryPut(K.sign, p.x + Math.sin(a0 + 2) * (p.r - 0.1), p.z + Math.cos(a0 + 2) * (p.r - 0.1), 0.1, { c1: C.fence[0] });
    } else {
      const nb = p.kind === 'shop' ? 1 : p.kind === 'city' || p.kind === 'park' ? 4 : 3;
      ringOf(K.bench, nb, p.r - 0.35, 0.2, a0 + 0.5, (_k, a) => ({ ry: a + Math.PI }));
      const nf = p.kind === 'shop' ? 2 : p.kind === 'park' ? 7 : 5;
      ringOf(K.flowers, nf, p.kind === 'park' ? p.r * 0.5 : p.r + 0.12, 0.26, a0 + 1.1, k => fl(k));
      if (p.kind === 'flag') tryPut(K.well, p.x + Math.sin(a0 + 2.6) * (p.r + 0.6), p.z + Math.cos(a0 + 2.6) * (p.r + 0.6), 0.25, { c1: pick(C.roof, H(pi, 3)) });
      if (p.kind === 'shop') tryPut(K.crates, p.x + Math.sin(a0 + 4) * (p.r - 0.1), p.z + Math.cos(a0 + 4) * (p.r - 0.1), 0.16, { c1: pick(AWN, H(pi, 7)) });
      const nt = p.kind === 'park' ? 7 : p.kind === 'city' || p.kind === 'school' || p.kind === 'stadium' ? 5 : p.kind === 'mosque' || p.kind === 'place' ? 4 : 0;
      for (let k = 0; k < nt; k++) {
        const a = a0 + 0.2 + (k / nt) * Math.PI * 2, rad = p.kind === 'park' ? p.r * (0.35 + 0.5 * H(pi, k)) : p.r + 0.75;
        const x = p.x + Math.sin(a) * rad, z = p.z + Math.cos(a) * rad;
        if (free(x, z, 0.3) && !skip(x, z)) put(p.kind === 'mosque' ? K.poplar : K.round2, x, z, 0.3, { cls: 0, c1: pick(LEAF, H(pi * 3 + k, 2)), s: 0.85 + H(pi, k + 4) * 0.3, ry: k });
      }
    }
  });

  // ---- along the roads: poplar rows, lamps, signs, parked cars, bus shelters ----------------------------------
  const builtAt = (x: number, z: number) => t.built[Math.max(0, Math.min(t.lch - 1, Math.floor((z - t.z0) * 100 / t.lcCell))) * t.lcw + Math.max(0, Math.min(t.lcw - 1, Math.floor(x * 100 / t.lcCell)))];
  const heavy: Kit[] = [];
  const heavyKit = (k: number) => {
    if (!heavy.length) {
      const g1 = propUnitGeometry(GELIK, 1), g2 = v4UnitGeometry('bmw', 0);
      heavy.push(kitFromGeometry(g1, 0.36), kitFromGeometry(g2, 0.36));
      g1.dispose(); g2.dispose();
    }
    return heavy[k % heavy.length];
  };
  let nCars = 0;
  net.lines.forEach((l, li) => {
    if (l.c > RC.STREET || l.deck !== undefined) return;
    const hw = ROAD_HALF[l.c];
    let s = H(li, 3) * 2, next = { pop: s + 1, lamp: s + 1.5, sign: s + 6 + H(li, 9) * 8, car: s + 2 + H(li, 4) * 6, stop: s + 10 + H(li, 6) * 20 };
    for (let i = 0; i + 1 < l.x.length; i++) {
      const ax = l.x[i], az = l.z[i], dx = l.x[i + 1] - ax, dz = l.z[i + 1] - az, L = Math.hypot(dx, dz);
      if (L < 1e-3) continue;
      const ux = dx / L, uz = dz / L, ry = Math.atan2(ux, uz);
      const at = (d: number, side: number, off: number) => [ax + ux * (d - s) - uz * side * off, az + uz * (d - s) + ux * side * off] as const;
      const end = s + L;
      // poplars: rows on the main roads through open country (a few in a row, then a gap)
      if (l.c <= RC.ROAD) while (next.pop < end) {
        const d = next.pop, run = Math.floor(d / 9);
        next.pop += 1.15;
        if (H(li * 3 + run, 77) > (l.c === RC.MAIN ? 0.5 : 0.3)) continue;
        const side = H(li, run) > 0.5 ? 1 : -1, [x, z] = at(d, side, hw + 0.42);
        if (builtAt(x, z) > 110 || H(li * 7 + Math.floor(d * 3), 5) > dens) continue;
        tryPut(K.poplar, x, z, 0.24, { cls: 0, c1: pick(LEAF, H(li, run + 3) * 0.5), s: 0.8 + H(Math.floor(d * 5), li) * 0.3, ry: d }, true);
      } else next.pop = end;
      // lamps in the built-up stretches, signs now and then
      while (next.lamp < end) {
        const d = next.lamp; next.lamp += l.c === RC.STREET ? 5.5 : 3.2;
        const side = Math.floor(d / 3.2) % 2 ? 1 : -1, [x, z] = at(d, side, hw + 0.13);
        if (builtAt(x, z) < 120 || (low && H(li, Math.floor(d)) > 0.5)) continue;
        tryPut(K.lamp, x, z, 0.08, { ry: ry + (side > 0 ? Math.PI / 2 : -Math.PI / 2) + Math.PI, cls: 2 });
      }
      if (l.c <= RC.ROAD) while (next.sign < end) {
        const d = next.sign; next.sign += 14 + H(li, Math.floor(d)) * 8;
        const [x, z] = at(d, 1, hw + 0.16);
        tryPut(K.sign, x, z, 0.08, { ry, c1: pick([C.fence[0], C.danger, C.gold, C.fence[0]], H(li, Math.floor(d) + 7)) });
      } else next.sign = end;
      // parked cars at the kerb in the villages and the city
      while (next.car < end) {
        const d = next.car, city = cityQ(ax, az) < 1;
        next.car += (city ? 3.5 : 7) / dens + H(li, Math.floor(d) + 31) * 6;
        const side = H(li, Math.floor(d) + 2) > 0.5 ? 1 : -1, [x, z] = at(d, side, hw + 0.2);
        if (builtAt(x, z) < 130) continue;
        const hv = H(li * 5 + Math.floor(d), 13) < (low ? 0.03 : 0.09);
        if (!free(x, z, 0.3, 0.02)) continue;
        nCars++;
        if (hv) put(heavyKit(nCars), x, z, 0.36, { ry: ry + (side > 0 ? 0 : Math.PI), sink: 0 });
        else put(K.car, x, z, 0.3, { ry: ry + (side > 0 ? 0 : Math.PI), c1: pick(CAR, H(li, Math.floor(d) + 11)), sink: 0 });
      }
      // a bus shelter now and then on the roads through a village
      if (l.c <= RC.ROAD) while (next.stop < end) {
        const d = next.stop; next.stop += 26 + H(li, Math.floor(d)) * 20;
        const side = H(li, Math.floor(d) + 8) > 0.5 ? 1 : -1, [x, z] = at(d, side, hw + 0.34);
        if (builtAt(x, z) < 140) continue;
        tryPut(K.shelter, x, z, 0.42, { ry: ry + (side > 0 ? -Math.PI / 2 : Math.PI / 2), c1: pick(C.roof, H(li, Math.floor(d) + 3)), cls: 2 });
      } else next.stop = end;
      s = end;
    }
  });

  // ---- every house: a fruit tree in the garden, bushes, a flower bed, firewood, a haystack, a bench ------------
  houses.forEach((h, i) => {
    const c = Math.cos(h.ry), s = Math.sin(h.ry); // local +x → (c, −s), local +z (street side) → (s, c)
    const at = (lx: number, lz: number) => [h.x + lx * c + lz * s, h.z - lx * s + lz * c] as const;
    const r1 = H(i, 101), r2 = H(i, 202), r3 = H(i, 303), r4 = H(i, 404);
    if (r1 < 0.62 * dens + 0.1) { // a tree behind the house
      const [x, z] = at((r2 - 0.5) * h.w, -h.d / 2 - 0.34 - r3 * 0.2);
      const fruit = r4 < 0.6;
      tryPut(fruit ? K.fruit : r4 < 0.85 ? K.round : K.round2, x, z, 0.22, { cls: 0, ry: r2 * 6, s: fruit ? 0.8 + r3 * 0.3 : 0.62 + r3 * 0.3, c1: fruit ? pick(FRUITLEAF, r2) : pick(LEAF, r3), c2: pick(FRUIT, r3) });
    }
    if (r2 < 0.4 * dens) { const [x, z] = at(-h.w / 2 - 0.2, (r3 - 0.5) * h.d); tryPut(r3 > 0.5 ? K.bushes : K.bush, x, z, 0.16, { cls: 1, c1: pick(LEAF, r4), ry: r1 * 6, s: 0.7 + r1 * 0.4 }); }
    if (r3 < 0.14 * dens) { const [x, z] = at(h.w / 2 - 0.08, h.d / 2 + 0.16); tryPut(K.flowers, x, z, 0.12, { c1: pick(FLOWER, r1), c2: pick(FLOWER, r2), s: 0.62, ry: r4 * 6 }); }
    if (r4 < 0.12 * dens) { const [x, z] = at(h.w / 2 + 0.14, -0.05); tryPut(K.woodpile, x, z, 0.12, { ry: h.ry + Math.PI / 2 }); }
    else if (r4 > 1 - 0.07 * dens) { const [x, z] = at(h.w / 2 + 0.3, -h.d / 2 - 0.3); tryPut(K.haystack, x, z, 0.26, { cls: 1, ry: r1 * 6, s: 0.8 + r2 * 0.3 }); }
    else if (r4 > 0.5 && r4 < 0.5 + 0.06 * dens) { const [x, z] = at(-h.w / 2 + 0.1, h.d / 2 + 0.17); tryPut(K.bench, x, z, 0.14, { ry: h.ry, s: 0.8 }); }
  });

  // ---- the river: reeds and boulders along the banks -------------------------------------------------------------
  shore.forEach((e, i) => {
    const mx = (e.ax + e.bx) / 2, mz = (e.az + e.bz) / 2, dx = e.bx - e.ax, dz = e.bz - e.az, L = Math.hypot(dx, dz) || 1;
    let nx = -dz / L, nz = dx / L;
    if (tinClass(tin, mx + nx * 0.25, mz + nz * 0.25) === LC.WATER) { nx = -nx; nz = -nz; } // towards the land
    const r1 = H(i, 61), r2 = H(i, 62), r3 = H(i, 63);
    if (r1 < 0.42 * dens) {
      const f = r2 - 0.5, x = mx + dx * f * 0.8 + nx * 0.12, z = mz + dz * f * 0.8 + nz * 0.12;
      tryPut(K.reeds, x, z, 0.14, { cls: 1, ry: r3 * 6, s: 0.8 + r3 * 0.5 });
    }
    if (r2 < 0.3 * dens) {
      const f = r3 - 0.5, off = 0.08 + r1 * 0.3, x = mx + dx * f * 0.8 + nx * off, z = mz + dz * f * 0.8 + nz * off;
      tryPut(r1 > 0.5 ? K.rocks : K.boulder, x, z, 0.2, { cls: 1, ry: r1 * 6, s: 0.7 + r3 * 0.7, c1: pick(BOULDER, r3), sink: 0.03 });
    }
  });

  // ---- the land itself: forests, lone trees and bushes on the meadows, hay on the mown fields, rocks up high ---
  const T = tin.tri, X = tin.x, Z = tin.z, Y = tin.y, F = tin.fld;
  for (let f = 0; f < tin.nt; f++) {
    const cls = tin.cls[f];
    if (cls === LC.WATER) continue;
    const a = T[f * 3], b = T[f * 3 + 1], c = T[f * 3 + 2];
    const area = Math.abs((X[b] - X[a]) * (Z[c] - Z[a]) - (Z[b] - Z[a]) * (X[c] - X[a])) / 2;
    const hM = (((Y[a] + Y[b] + Y[c]) / 3) / EXAG) * 100, ny = tin.nrm[f * 3 + 1];
    const pt = (k: number, salt: number) => {
      const s = Math.sqrt(H(f * 5 + k, salt)), r2 = H(f * 3 + k, salt + 12);
      return [(1 - s) * X[a] + s * (1 - r2) * X[b] + s * r2 * X[c], (1 - s) * Z[a] + s * (1 - r2) * Z[b] + s * r2 * Z[c]] as const;
    };
    const count = (rate: number, salt: number) => Math.floor(area * rate * dens + H(f, salt));
    if (cls === LC.CROP) {
      const per = F ? 1 / (Math.hypot(F[f * 4], F[f * 4 + 1]) || 1) : 0;
      if (per > 0.75) { // straw: round bales
        for (let k = 0, n = count(0.07, 91); k < n; k++) { const [x, z] = pt(k, 92); tryPut(K.bale, x, z, 0.2, { cls: 1, ry: H(f, k) * 3.14 }); }
      } else if (per < 0.32 && H(f, 95) < 0.05 * dens) { const [x, z] = pt(0, 96); tryPut(K.scarecrow, x, z, 0.2, { cls: 1, ry: H(f, 2) * 6, c1: pick(AWN, H(f, 3)) }); }
      continue;
    }
    // rocks on steep faces
    if (ny < 0.86 && cls !== LC.BUILT) for (let k = 0, n = count((0.9 - ny) * 0.9, 81); k < n; k++) { const [x, z] = pt(k, 82); tryPut(K.rocks, x, z, 0.22, { cls: 1, ry: H(f, k) * 6, s: 0.8 + H(f, k + 3) * 1.0, c1: pick(BOULDER, H(f, k + 5)), sink: 0.04 }); }
    const rate = cls === LC.TREE ? 0.05 : cls === LC.GRASS ? 0.0045 : cls === LC.WET ? 0.04 : cls === LC.BARE ? 0.002 : 0.004;
    for (let k = 0, n = count(rate, 77); k < n; k++) {
      const [cx, cz] = pt(k, 11);
      const forest = cls === LC.TREE;
      const size = forest ? 2 + Math.floor(H(f + k, 41) * 4) : 1 + Math.floor(H(f + k, 43) * 1.6);
      for (let q = 0; q < size; q++) {
        const ang = H(f * 13 + k, q + 5) * Math.PI * 2, rad = q === 0 ? 0 : 0.45 + H(f * 17 + k, q + 9) * 0.6;
        const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
        if (tinClass(tin, x, z) !== cls || skip(x, z) || !free(x, z, 0.2)) continue;
        const h = H(Math.floor(x * 31), Math.floor(z * 37)), h2 = H(Math.floor(z * 29), Math.floor(x * 23));
        const fir = forest && (hM > 560 || (hM > 380 && h < (hM - 380) / 220));
        const sc = (forest ? 0.85 : 0.72) + h2 * 0.5;
        if (fir) put(K.cone, x, z, 0.2, { cls: 0, ry: h * 6.28, s: sc, sy: 1.0 + H(q, f) * 0.3, c1: pick(FIR, h) });
        else put(h2 > 0.7 ? K.round2 : K.round, x, z, 0.2, { cls: 0, ry: h * 6.28, s: sc, sy: 0.9 + H(q + 3, f) * 0.3, c1: pick(LEAF, H(f * 3 + q, 5)) });
      }
    }
    // bushes: forest edges and meadows; flowers on the meadows
    if (cls === LC.GRASS || cls === LC.TREE || cls === LC.WET) {
      for (let k = 0, n = count(cls === LC.GRASS ? 0.012 : 0.02, 55); k < n; k++) { const [x, z] = pt(k, 56); if (!skip(x, z)) tryPut(H(f, k + 9) > 0.5 ? K.bushes : K.bush, x, z, 0.18, { cls: 1, ry: H(f, k) * 6, s: 0.7 + H(f, k + 2) * 0.6, c1: pick(LEAF, H(f, k + 4)) }); }
      if (cls === LC.GRASS && !low) for (let k = 0, n = count(0.004, 65); k < n; k++) { const [x, z] = pt(k, 66); tryPut(K.flowers, x, z, 0.2, { cls: 2, ry: H(f, k) * 6, s: 0.8, c1: pick(FLOWER, H(f, k + 1)), c2: pick(FLOWER, H(f, k + 2)) }); }
    }
  }

  // ---- merge per chunk ----------------------------------------------------------------------------------------------
  const buckets = new Map<number, Item[]>();
  for (const it of items) {
    const k = Math.floor(it.x / CHUNK) * 1000 + Math.floor((it.z - t.z0) / CHUNK);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(it);
  }
  const material = mat.solid();
  let tris = 0;
  for (const list of buckets.values()) {
    const key = (it: Item) => it.cls + hash2(Math.floor(it.x * 97), Math.floor(it.z * 89));
    list.sort((p, q) => key(p) - key(q));
    let nv = 0, ni = 0;
    for (const it of list) { nv += it.kit.pos.length / 3; ni += it.kit.idx.length; }
    const pos = new Float32Array(nv * 3), col = new Uint8Array(nv * 3), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const ends = new Uint32Array(list.length), n: [number, number, number] = [0, 0, 0];
    let v = 0, o = 0, cx = 0, cz = 0;
    list.forEach((it, li) => {
      const k = it.kit, P = k.pos, c = Math.cos(it.ry), s = Math.sin(it.ry), m = P.length / 3;
      for (let i = 0; i < m; i++) {
        const lx = P[i * 3] * it.sx, ly = P[i * 3 + 1] * it.sy, lz = P[i * 3 + 2] * it.sz, w = (v + i) * 3;
        pos[w] = it.x + lx * c + lz * s; pos[w + 1] = it.y + ly; pos[w + 2] = it.z - lx * s + lz * c;
        const tc = k.tint[i] === 1 ? it.c1 : k.tint[i] === 2 ? it.c2 : WHITE;
        col[w] = Math.min(255, Math.round(k.col[i * 3] * tc.r * 255)); col[w + 1] = Math.min(255, Math.round(k.col[i * 3 + 1] * tc.g * 255)); col[w + 2] = Math.min(255, Math.round(k.col[i * 3 + 2] * tc.b * 255));
      }
      for (let i = 0; i < k.idx.length; i++) idx[o + i] = v + k.idx[i];
      v += m; o += k.idx.length;
      ends[li] = o; n[it.cls]++;
      cx += it.x; cz += it.z;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.name = 'ground-scatter';
    mesh.castShadow = STYLE.shadows; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    parent.add(mesh);
    chunks.push({ mesh, x: cx / list.length, z: cz / list.length, ends, n });
    tris += ni / 3;
  }
  console.info(`scatter: ${items.length} things in ${chunks.length} chunks, ${Math.round(tris / 1000)}k triangles, cars ${nCars}`);
  return { free, count: items.length, tris };
}

/** LOD distances (camera to chunk): small props fade C0 → C1, mid-size things B0 → B1, then the trees thin out. */
const LOD = { c0: 60, c1: 115, b0: 115, b1: 190, k: 190, min: 0.3 };
const LOD_LOW = { c0: 45, c1: 95, b0: 95, b1: 150, k: 150, min: 0.3 };

/** Set every chunk's draw range for a camera position. */
export function updateScatterLod(cam: { x: number; y: number; z: number }, low: boolean) {
  const L = low ? LOD_LOW : LOD;
  for (const c of chunks) {
    const d = Math.hypot(c.x - cam.x, c.z - cam.z, cam.y);
    const [na, nb, nc] = c.n;
    let n: number;
    if (d <= L.c0) n = na + nb + nc;
    else if (d < L.c1) n = na + nb + Math.floor(nc * (1 - (d - L.c0) / (L.c1 - L.c0)));
    else if (d < L.b1) n = na + Math.floor(nb * (1 - (d - L.b0) / (L.b1 - L.b0)));
    else n = Math.max(Math.ceil(na * L.min), Math.ceil((na * L.k) / d));
    const count = n > 0 ? c.ends[Math.min(c.ends.length, n) - 1] : 0;
    const vis = count > 0;
    if (c.mesh.visible !== vis) c.mesh.visible = vis;
    if (c.mesh.geometry.drawRange.count !== count) c.mesh.geometry.setDrawRange(0, count);
  }
}
