// What gets painted on the ground (mask.ts), by rules from the real map data: yards along every village
// street and under every house, gardens and vegetable plots behind the houses, plazas with radial paths
// around the high-rises (the build zone), mosques, capture places, stadiums, markets, stops and Грозный's
// squares, footpaths from each plaza to the nearest street, gravel along the Аргун.
import { LC, BRIDGES, lcIndex, type Terrain } from '../../../world/terrain';
import { HQ } from '../../../sim/defs';
import { BASE } from '../../../sim/bdefs';
import { CAPTURE_PLACES } from '../../../data/places';
import { hash2, type Tin } from '../../lowpoly';
import { roadNet, roadClearance, RC, ROAD_HALF, ALL_MASK } from '../../roads';
import { landmarkPlan } from '../../landmarks';
import { decorSpots } from '../../world';
import { CITY_SITES, siteRect, cityCircles, cityPlan } from '../../city';
import { CH, type GroundMask } from './mask';

export interface HouseSpot { x: number; z: number; ry: number; w: number; d: number }
/** A paved round place: props stand around it (scatter.ts). `kind` picks the furniture. */
export interface Plaza { x: number; z: number; r: number; kind: 'hq' | 'mosque' | 'flag' | 'place' | 'market' | 'stadium' | 'stop' | 'school' | 'park' | 'shop' | 'city'; side?: 0 | 1 }
/** A shore edge of the drawn river (land on the left of a→b is not guaranteed: use the TIN class to tell). */
export interface ShoreEdge { ax: number; az: number; bx: number; bz: number }

const STREETS = 0b111; // RC.MAIN | RC.ROAD | RC.STREET (a literal: this module sits in an import cycle with roads.ts)
/** High-rise rotation (world.ts HqBuilding.place). */
export const HQ_ROT = [0.35, -0.25];

/** The two high-rise points (pts[0], pts[1] of the sim are these villages). */
export function hqSpots(t: Terrain): { x: number; z: number; side: 0 | 1 }[] {
  const out: { x: number; z: number; side: 0 | 1 }[] = [];
  for (const [key, side] of [['atagi', 0], ['kurchaloy', 1]] as const) {
    const v = t.villages.find(q => q.key === key);
    if (v) out.push({ x: v.x, z: v.z, side });
  }
  return out;
}
/** Biggest build zone radius (base level 3): nothing solid of ours stands inside it. */
export const ZONE_MAX = BASE.zone + BASE.zoneStep * 3;

/** Shore edges of the TIN water (edges of water faces whose two ends touch land). */
export function shoreEdges(tin: Tin): ShoreEdge[] {
  const land = new Uint8Array(tin.np), T = tin.tri, out: ShoreEdge[] = [];
  for (let f = 0; f < tin.nt; f++) if (tin.cls[f] !== LC.WATER) { land[T[f * 3]] = 1; land[T[f * 3 + 1]] = 1; land[T[f * 3 + 2]] = 1; }
  const seen = new Set<number>();
  for (let f = 0; f < tin.nt; f++) {
    if (tin.cls[f] !== LC.WATER) continue;
    for (let e = 0; e < 3; e++) {
      const a = T[f * 3 + e], b = T[f * 3 + (e + 1) % 3];
      if (!land[a] || !land[b]) continue;
      const key = a < b ? a * tin.np + b : b * tin.np + a;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ax: tin.x[a], az: tin.z[a], bx: tin.x[b], bz: tin.z[b] });
    }
  }
  return out;
}

export function paintGround(mask: GroundMask, t: Terrain, tin: Tin, houses: HouseSpot[], shore: ShoreEdge[]): Plaza[] {
  const net = roadNet();
  const built = (x: number, z: number) => t.built[lcIndex(t, x, z)];
  const plazas: Plaza[] = [];

  // ---- yards along the village streets (a pavement on each side) ------------------------------------
  for (const l of net.lines) {
    if (l.c > RC.STREET) continue;
    const hw = ROAD_HALF[l.c] + (l.c === RC.STREET ? 0.3 : 0.24);
    for (let i = 0; i + 1 < l.x.length; i++) {
      const mx = (l.x[i] + l.x[i + 1]) / 2, mz = (l.z[i] + l.z[i + 1]) / 2;
      if (built(mx, mz) < 70) continue;
      mask.seg(CH.PAVE, l.x[i], l.z[i], l.x[i + 1], l.z[i + 1], hw);
    }
  }

  // ---- every house: a yard under it, a garden or a vegetable plot behind it ---------------------------
  houses.forEach((h, i) => {
    const c = Math.cos(h.ry), s = Math.sin(h.ry); // local +z (the street side) in world: (s, c)
    mask.rect(CH.PAVE, h.x + s * 0.06, h.z + c * 0.06, h.w / 2 + 0.17, h.d / 2 + 0.2, h.ry, 0.12);
    const g = hash2(i * 7 + 3, 911), gd = 0.3 + hash2(i, 77) * 0.32;
    if (g > 0.78) return;
    const off = h.d / 2 + 0.2 + gd / 2 + 0.03, gx = h.x - s * off, gz = h.z - c * off;
    if (roadClearance(gx, gz, ALL_MASK) < gd / 2 + 0.12 || tinWater(tin, gx, gz)) return;
    mask.rect(g < 0.34 ? CH.PLOT : CH.LAWN, gx, gz, h.w / 2 + 0.1 + hash2(i, 5) * 0.12, gd / 2, h.ry, 0.05);
  });

  // ---- gravel along the Аргун ---------------------------------------------------------------------------
  shore.forEach((e, i) => {
    const w = 0.2 + hash2(i, 31) * 0.3;
    mask.seg(CH.EARTH, e.ax, e.az, e.bx, e.bz, w);
  });
  for (const b of BRIDGES) { mask.disc(CH.EARTH, b.x0, b.z0, 1.5); mask.disc(CH.EARTH, b.x1, b.z1, 1.5); }

  // ---- plazas ---------------------------------------------------------------------------------------------
  const disc = (p: Plaza, paths = 3) => { mask.disc(CH.PAVE, p.x, p.z, p.r); plazas.push(p); if (paths) footpaths(mask, p.x, p.z, p.r, paths); };
  // the high-rises: a round plaza, eight spokes and a ring road on the edge of the first build zone
  for (const h of hqSpots(t)) {
    const r0 = HQ.radius[h.side] + BASE.keep + 0.7, rot = HQ_ROT[h.side];
    mask.disc(CH.PAVE, h.x, h.z, r0);
    plazas.push({ x: h.x, z: h.z, r: r0, kind: 'hq', side: h.side });
    mask.ring(CH.PAVE, h.x, h.z, BASE.zone + 0.2, 0.3);
    for (let k = 0; k < 8; k++) {
      const a = rot + (k / 8) * Math.PI * 2 + Math.PI / 8, ca = Math.sin(a), sa = Math.cos(a);
      mask.seg(CH.PAVE, h.x + ca * (r0 - 0.3), h.z + sa * (r0 - 0.3), h.x + ca * BASE.zone, h.z + sa * BASE.zone, k % 2 ? 0.26 : 0.36);
    }
    const mx = h.x + (h.side === 0 ? -6 : 7), mz = h.z + 4; // the village mosque next to it (main.ts)
    disc({ x: mx, z: mz, r: 2.2, kind: 'mosque' }, 0);
  }
  for (const v of t.villages) {
    if (v.key === 'atagi' || v.key === 'kurchaloy') continue;
    if (v.key === 'shali') { disc({ x: v.x, z: v.z, r: 4.3, kind: 'mosque' }, 4); continue; }
    disc({ x: v.x, z: v.z, r: 1.7, kind: 'flag' }, 3); // the village flag
  }
  // the real places: every landmark stands on a paved yard, the big ones on a plaza
  for (const l of landmarkPlan(t)) {
    const kind: Plaza['kind'] = l.capture ? 'place' : l.kind === 'mosque' ? 'mosque' : l.kind === 'market' ? 'market' : l.kind === 'stadium' ? 'stadium'
      : l.kind === 'busstop' ? 'stop' : l.kind === 'school' ? 'school' : l.kind === 'park' ? 'park' : 'shop';
    if (kind === 'park') { mask.disc(CH.LAWN, l.x, l.z, l.r + 0.6); mask.ring(CH.PAVE, l.x, l.z, l.r + 0.6, 0.16); plazas.push({ x: l.x, z: l.z, r: l.r + 0.6, kind }); footpaths(mask, l.x, l.z, l.r + 0.6, 2); continue; }
    disc({ x: l.x, z: l.z, r: l.r + (kind === 'place' || kind === 'market' ? 0.9 : kind === 'stop' ? 0.25 : 0.45), kind }, kind === 'stop' ? 1 : 3);
  }
  for (const c of CAPTURE_PLACES) mask.ring(CH.PAVE, c.x, c.z, c.r, 0.14); // the capture ring as a kerb line
  for (const d of decorSpots(t)) disc({ x: d.x, z: d.z, r: d.r + 0.45, kind: 'shop' }, 2);
  // Грозный: paved courtyards under the blocks, yards under the landmarks, the squares
  for (const r of cityPlan(t).rects) mask.rect(CH.PAVE, r.x, r.z, r.hx + 0.22, r.hz + 0.22, r.ry, 0.15);
  for (const s of CITY_SITES) { const r = siteRect(s, 0.45); mask.rect(CH.PAVE, r.x, r.z, r.hx, r.hz, r.ry, 0.3); }
  for (const c of cityCircles()) disc({ x: c.x, z: c.z, r: Math.min(3.2, c.r * 0.6), kind: 'city' }, 4);
  return plazas;
}

function tinWater(tin: Tin, x: number, z: number) {
  const i = Math.floor(x / tin.gs), j = Math.floor((z - tin.z0) / tin.gs);
  if (i < 0 || j < 0 || i >= tin.gw || j >= tin.gh) return true;
  for (let k = tin.cellStart[j * tin.gw + i]; k < tin.cellStart[j * tin.gw + i + 1]; k++) if (tin.cls[tin.cellTri[k]] === LC.WATER) return true;
  return false;
}

/** Footpaths from the edge of a plaza to the streets around it: the `n` shortest of eight directions. */
function footpaths(mask: GroundMask, x: number, z: number, r: number, n: number) {
  const found: { d: number; x: number; z: number; a: number }[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.3, ca = Math.cos(a), sa = Math.sin(a);
    for (let d = r + 0.2; d < r + 7; d += 0.2) {
      const px = x + ca * d, pz = z + sa * d;
      if (roadClearance(px, pz, STREETS) < 0.02) { if (d > r + 0.45) found.push({ d, x: px, z: pz, a }); break; }
    }
  }
  found.sort((p, q) => p.d - q.d);
  for (const f of found.slice(0, n)) mask.seg(CH.PAVE, x + Math.cos(f.a) * (r - 0.2), z + Math.sin(f.a) * (r - 0.2), f.x, f.z, 0.2);
}
