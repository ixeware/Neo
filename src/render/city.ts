// v4 «Грозный»: the city on the map's northern band (z0 ≤ z < 0) and the Grozny part south of it.
// Render-only, a pure function of the terrain (every client draws the same city):
//   - CITY_SITES: the landmarks (ГГНТУ, ЧГУ and its other building, ЖК «Шайба», Ансар and the «Ансар.
//     Филиал» sign, Донер Бей at its real spot on ул. Мира) and the two stop shelters, at the positions
//     src/data/season.ts CITY_POINTS / CITY_DECOR give the sim (tools/citycheck.ts checks both agree);
//   - cityPlan(): apartment blocks (grozny.ts cityBlock kinds 0..3) along the real OSM streets of the
//     city, set back from the ribbons, off the water, clear of the landmarks and of the capture circles;
//   - CityFill: the blocks as instanced meshes with distance LOD (full block near the view, a box
//     further out), so the overview pays ~10 triangles per block.
import * as THREE from 'three';
import { LC, BRIDGES, heightY, passable, lcAt, type Terrain } from '../world/terrain';
import { roadNet, roadClearance, ROAD_HALF, RC, ALL_MASK, type KeepOut } from './roads';
import { hash2 } from './lowpoly';
import { cityBlock, cityBlockFootprint, cityBlockHeight, groznyLandmark, GROZNY_FOOTPRINT, type GroznyKey } from './grozny';
import { CITY_POINTS } from '../data/season';

// ---- the city area ----------------------------------------------------------------------------------
/** Centre and half-axes of the city fill (central Grozny; the map's west edge cuts the rest). */
export const CITY = { x: 25, z: -14, rx: 27, rz: 25, name: 'Грозный' } as const;
/** Where the «Грозный» map label sits (over the centre, by the mosque and Грозный-Сити). */
export const CITY_LABEL = { x: 24, z: -17 } as const;

/** 0 at the city centre, 1 on the edge of the fill (ellipse). */
export function cityQ(x: number, z: number): number {
  const a = (x - CITY.x) / CITY.rx, b = (z - CITY.z) / CITY.rz;
  return Math.sqrt(a * a + b * b);
}
/** Village houses stay out of the city's core and middle ring (blocks there); the outer ring mixes both. */
export const CITY_HOUSES_FROM = 0.72;

// ---- landmarks ------------------------------------------------------------------------------------------
export type SiteModel = GroznyKey | 'doner' | 'busstop' | 'sign';
export interface CitySite {
  /** CITY_POINTS / CITY_DECOR key */
  key: string;
  model: SiteModel;
  /** map tag up close */
  name: string;
  /** model origin, facing (rotation.y: local +z turned that way) and scale */
  x: number; z: number; ry: number; s: number;
  /** sign text (stops, the branch sign) */
  sign?: string;
  /** stop shelter colour */
  side?: 0 | 1;
}

/**
 * The landmarks as drawn (tools/citycheck.ts --solve proposed them): each as near its 2GIS point as the
 * dense centre allows — off the big roads (trunk / primary / secondary and rails; smaller ribbons are cut
 * under them), off the Сунжа, no two touching, the front towards the game camera. At their 2GIS points
 * ГГНТУ (25.4, −22.8) and ЖК «Шайба» (22.5, −22.8) overlap at any scale that reads, so both shrank
 * (×0.19 and ×0.2 of building scale) and moved 2.25 and 1.0; Донер Бей moved 1.75 from ул. Мира 83/1
 * (21.2, −26.4) to clear the street; ЧГУ 1.0, Ансар 1.25; the others stand on their points. The stop
 * shelters stand at the edge of their deploy circle, next to a street, open to it.
 */
export const CITY_SITES: CitySite[] = [
  { key: 'ggntu', model: 'ggntu', name: 'ГГНТУ', x: 26.82, z: -24.55, ry: 0, s: 0.19 },
  { key: 'shaiba', model: 'shaiba', name: 'ЖК «Шайба»', x: 21.55, z: -22.49, ry: -0.52, s: 0.2 },
  { key: 'chgu', model: 'chgu', name: 'ЧГУ', x: 30.35, z: -12.69, ry: -1.05, s: 0.36 },
  { key: 'chgu2', model: 'chgu', name: 'ЧГУ, другой корпус', x: 48.8, z: -16.6, ry: 0, s: 0.3 },
  { key: 'ansar', model: 'ansar', name: 'Ансар', x: 31.6, z: 4.85, ry: 0.52, s: 0.55 },
  { key: 'ansar2', model: 'sign', name: 'Ансар. Филиал', x: 11.6, z: -23.5, ry: 0, s: 1, sign: 'АНСАР · ФИЛИАЛ' },
  { key: 'doner', model: 'doner', name: 'Донер Бей', x: 20.08, z: -27.74, ry: -0.79, s: 0.72 },
  { key: 'stopA', model: 'busstop', name: 'Остановка 55-й у молла', x: 6.94, z: -15.43, ry: 2.55, s: 0.5, sign: 'ОСТАНОВКА · 55', side: 0 },
  { key: 'stopK', model: 'busstop', name: 'Автостанция: маршрутка 150', x: 41.69, z: -27.63, ry: 0.71, s: 0.5, sign: 'АВТОСТАНЦИЯ · 150', side: 1 },
];

/** Ground box of each model at ×1 around its origin (w along x, d along z, centre cx, cz). */
const FOOT: Record<SiteModel, { w: number; d: number; cx: number; cz: number; h: number }> = {
  ...GROZNY_FOOTPRINT,
  doner: { w: 4.4, d: 3.6, cx: 0, cz: 0.5, h: 2.6 },
  busstop: { w: 3.3, d: 1.6, cx: 0, cz: 0, h: 1.7 },
  sign: { w: 1.7, d: 0.3, cx: 0, cz: 0, h: 1.5 },
};

/** A site's footprint as an oriented rectangle in world units: centre, half sizes, rotation.y. */
export interface Rect { x: number; z: number; hx: number; hz: number; ry: number }
export function siteRect(s: CitySite, pad = 0): Rect {
  const f = FOOT[s.model], c = Math.cos(s.ry), n = Math.sin(s.ry);
  const lx = f.cx * s.s, lz = f.cz * s.s;
  // rotation.y: local (lx, lz) → world (lx·cos + lz·sin, −lx·sin + lz·cos)
  return { x: s.x + lx * c + lz * n, z: s.z - lx * n + lz * c, hx: (f.w * s.s) / 2 + pad, hz: (f.d * s.s) / 2 + pad, ry: s.ry };
}
/** Height of a site's model as drawn. */
export const siteHeight = (s: CitySite) => FOOT[s.model].h * s.s;

/** Is (x, z) inside the rectangle (grown by `pad`)? */
export function inRect(r: Rect, x: number, z: number, pad = 0): boolean {
  const dx = x - r.x, dz = z - r.z, c = Math.cos(r.ry), n = Math.sin(r.ry);
  const lx = dx * c - dz * n, lz = dx * n + dz * c;
  return Math.abs(lx) <= r.hx + pad && Math.abs(lz) <= r.hz + pad;
}

/** Separating-axis overlap test of two oriented rectangles (with a gap). */
export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  const ax = [Math.cos(a.ry), Math.sin(a.ry)], bx = [Math.cos(b.ry), Math.sin(b.ry)];
  // local x axis of rotation.y in world (x, z): (cos, −sin); local z: (sin, cos)
  const axes = [[ax[0], -ax[1]], [ax[1], ax[0]], [bx[0], -bx[1]], [bx[1], bx[0]]];
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [ux, uz] of axes) {
    const ra = a.hx * Math.abs(ax[0] * ux - ax[1] * uz) + a.hz * Math.abs(ax[1] * ux + ax[0] * uz);
    const rb = b.hx * Math.abs(bx[0] * ux - bx[1] * uz) + b.hz * Math.abs(bx[1] * ux + bx[0] * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb + gap) return false;
  }
  return true;
}

/** Capture / deploy circles of the city points (the fill leaves them open as plazas). */
export function cityCircles(): { key: string; x: number; z: number; r: number }[] {
  return CITY_POINTS.map(p => ({ key: p.key, x: p.x, z: p.z, r: p.r }));
}

/**
 * Where roads.ts must not lay ribbons: under the city landmarks, every class but the main roads and the
 * rails (the sites were chosen off those: tools/citycheck.ts).
 */
export function cityKeepOut(): KeepOut[] {
  return CITY_SITES.filter(s => s.model !== 'sign').map(s => {
    const r = siteRect(s, 0.05);
    return { x: r.x, z: r.z, r: 0, hx: r.hx, hz: r.hz, ry: r.ry, cls: [RC.ROAD, RC.STREET, RC.TRACK] };
  });
}

// ---- the block plan ------------------------------------------------------------------------------------
export interface CityBlockItem { x: number; z: number; y: number; ry: number; kind: number; seed: number; s: number }
export interface CityPlan {
  blocks: CityBlockItem[];
  /** occupancy grid (0.5 units, from z0) of the block footprints: trees and village houses keep off */
  occ: Uint8Array; ow: number; oh: number; z0: number;
  rects: Rect[];
}

/** Block variants per kind (cityBlock seeds): each (kind, seed) is one instanced geometry. */
export const CITY_SEEDS = 3;
/** Scale of the fill blocks (cityBlock is drawn at building scale; the map's houses are about ×0.5 of that). */
const BLOCK_S = 0.5;
/** Kind mix (0: 5 эт., 1: 9 эт., 2: 12 эт., 3: 16 эт.) by ring: centre, middle, outer. */
const MIX = [[0.12, 0.38, 0.3, 0.2], [0.42, 0.4, 0.13, 0.05], [0.72, 0.24, 0.04, 0]];

function pickKind(q: number, h: number): number {
  const m = MIX[q < 0.42 ? 0 : q < 0.72 ? 1 : 2];
  let a = 0;
  for (let k = 0; k < 4; k++) { a += m[k]; if (h < a) return k; }
  return 0;
}

let planCache: { t: Terrain; plan: CityPlan } | null = null;
/** Why block sites were refused in the last plan (tools/citycheck.ts prints it). */
export const cityPlanStats: Record<string, number> = {};

export function cityPlan(t: Terrain): CityPlan {
  if (planCache && planCache.t === t) return planCache.plan;
  const net = roadNet();
  const ow = Math.ceil(t.W * 2), oh = Math.ceil((t.H - t.z0) * 2), occ = new Uint8Array(ow * oh);
  const rects: Rect[] = [], blocks: CityBlockItem[] = [];
  const siteRects = CITY_SITES.map(s => siteRect(s, s.model === 'sign' ? 0.2 : 0.35));
  const circles = cityCircles().map(c => ({ x: c.x, z: c.z, r: c.r * (c.key.startsWith('stop') ? 0.62 : 0.8) }));
  // the old Донер Бей pavilion (sim pts[8] stays near 30, 12 until the v4 sim moves it) and its ring
  circles.push({ x: 30, z: 12, r: 4.2 });
  // a 1-unit hash of the placed rectangles for the overlap test
  const gw = Math.ceil(t.W), gh = Math.ceil(t.H - t.z0), head = new Int32Array(gw * gh).fill(-1), next: number[] = [];
  const cellOf = (x: number, z: number) => Math.min(gh - 1, Math.max(0, Math.floor(z - t.z0))) * gw + Math.min(gw - 1, Math.max(0, Math.floor(x)));
  const fits = (r: Rect, gap: number) => {
    const R = Math.max(r.hx, r.hz) + 2.2;
    const i0 = Math.max(0, Math.floor(r.x - R)), i1 = Math.min(gw - 1, Math.floor(r.x + R));
    const j0 = Math.max(0, Math.floor(r.z - t.z0 - R)), j1 = Math.min(gh - 1, Math.floor(r.z - t.z0 + R));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      for (let p = head[j * gw + i]; p >= 0; p = next[p]) if (rectsOverlap(r, rects[p], gap)) return false;
    }
    return true;
  };
  const CORNERS = [[1, 1], [-1, 1], [1, -1], [-1, -1], [0, 1], [0, -1], [1, 0], [-1, 0], [0, 0], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]];
  let lo = 0;
  /** Can a block of half sizes hx × hz (rotation.y = ry) stand at (x, z)? Leaves the lowest ground in `lo`. */
  const st = cityPlanStats;
  for (const k of Object.keys(st)) delete st[k];
  const no = (why: string) => { st[why] = (st[why] ?? 0) + 1; return false; };
  const site = (x: number, z: number, ry: number, hx: number, hz: number): boolean => {
    if (x < 1.5 || z < t.z0 + 1.5 || x > t.W - 1.5 || z > t.H - 1.5) return no('edge');
    if (!passable(t, x, z)) return no('blocked');
    for (const c of circles) if ((c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + Math.min(hx, hz)) ** 2) return no('circle');
    const r: Rect = { x, z, hx, hz, ry };
    for (const s of siteRects) if (rectsOverlap(r, s, 0)) return no('landmark');
    for (const br of BRIDGES) if (segDist(x, z, br.x0, br.z0, br.x1, br.z1) < Math.max(hx, hz) + 1) return no('bridge');
    const c = Math.cos(ry), n = Math.sin(ry);
    // off the water and every ribbon: corners, edge midpoints, centre and the inner quarter points
    for (const [a, b] of CORNERS) {
      const lx = a * hx, lz = b * hz, px = x + lx * c + lz * n, pz = z - lx * n + lz * c;
      if (roadClearance(px, pz, ALL_MASK) < 0.06) return no('ribbon');
      if (lcAt(t, px, pz) === LC.WATER) return no('water');
    }
    if (!fits(r, 0.14)) return no('overlap');
    st.ok = (st.ok ?? 0) + 1;
    lo = Infinity;
    for (let k = 0; k < 5; k++) { const [a, b] = CORNERS[k === 4 ? 8 : k]; lo = Math.min(lo, heightY(t, x + a * hx * c + b * hz * n, z - a * hx * n + b * hz * c)); }
    return true;
  };
  const place = (x: number, z: number, ry: number, kind: number, seed: number, s: number, hx: number, hz: number) => {
    const r: Rect = { x, z, hx, hz, ry };
    const id = rects.length;
    rects.push(r);
    const k = cellOf(x, z);
    next.push(head[k]); head[k] = id;
    blocks.push({ x, z, y: lo - 0.03, ry, kind, seed, s });
    // occupancy at 0.5 units, a little beyond the walls
    const R = Math.hypot(hx, hz) + 0.3;
    for (let oz = Math.floor((z - R - t.z0) * 2); oz <= Math.ceil((z + R - t.z0) * 2); oz++) for (let ox = Math.floor((x - R) * 2); ox <= Math.ceil((x + R) * 2); ox++) {
      if (ox < 0 || oz < 0 || ox >= ow || oz >= oh) continue;
      if (inRect(r, (ox + 0.5) / 2, (oz + 0.5) / 2 + t.z0, 0.25)) occ[oz * ow + ox] = 1;
    }
  };
  const halfOf = (kind: number, s: number): [number, number] => { const [w, d] = cityBlockFootprint(kind); return [(w * s) / 2, (d * s) / 2]; };
  const x0 = CITY.x - CITY.rx, x1 = CITY.x + CITY.rx, z0 = CITY.z - CITY.rz, z1 = CITY.z + CITY.rz;

  // 1. blocks along the streets, main roads first (the bake sorts the lines by class), facing the street
  for (let li = 0; li < net.lines.length; li++) {
    const l = net.lines[li];
    if (l.c > RC.STREET || l.deck !== undefined) continue;
    const n = l.x.length;
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (let k = 0; k < n; k++) { bx0 = Math.min(bx0, l.x[k]); bx1 = Math.max(bx1, l.x[k]); bz0 = Math.min(bz0, l.z[k]); bz1 = Math.max(bz1, l.z[k]); }
    if (bx1 < x0 || bx0 > x1 || bz1 < z0 || bz0 > z1) continue;
    const hw = ROAD_HALF[l.c];
    let total = 0;
    for (let k = 0; k + 1 < n; k++) total += Math.hypot(l.x[k + 1] - l.x[k], l.z[k + 1] - l.z[k]);
    if (total < 1.2) continue;
    for (const side of [1, -1]) {
      let seg = 0, segS = 0, segL = Math.hypot(l.x[1] - l.x[0], l.z[1] - l.z[0]);
      let s = 0.3 + hash2(li, side + 31) * 0.6;
      for (let k = 0; s < total - 0.4; k++) {
        const h1 = hash2(li * 7 + k, side + 131), h2 = hash2(li * 13 + k, side + 232), h3 = hash2(li + k * 17, side + 333);
        // look the kind up at the plot's rough position first
        const pf = Math.min(total, s + 0.8);
        while (seg < n - 2 && pf > segS + segL) { segS += segL; seg++; segL = Math.hypot(l.x[seg + 1] - l.x[seg], l.z[seg + 1] - l.z[seg]); }
        if (segL < 1e-4) { s += 0.5; continue; }
        const dx = (l.x[seg + 1] - l.x[seg]) / segL, dz = (l.z[seg + 1] - l.z[seg]) / segL;
        const qx = l.x[seg] + dx * (pf - segS), qz = l.z[seg] + dz * (pf - segS);
        const q = cityQ(qx, qz);
        if (q > 1) { s += 1.2; continue; }
        // the outer ring thins out into the private houses
        const keep = q < 0.72 ? 0.97 : 0.97 - (q - 0.72) * 2.2;
        if (hash2(li * 3 + k, side + 434) >= keep) { s += 0.9; continue; }
        // the wanted block first, then smaller: the same kind scaled down, then a compact tower / a 5-storey
        const k0 = pickKind(q, h1), alt = q < 0.72 && h2 > 0.55 ? 3 : 0, j = 0.94 + h3 * 0.12;
        let done = false;
        for (const [kind, sc] of [[k0, BLOCK_S * j], [k0, 0.42 * j], [alt, 0.42 * j], [k0, 0.35 * j], [alt, 0.35 * j]] as [number, number][]) {
          const [hx, hz] = halfOf(kind, sc);
          const at = s + hx;
          if (at > total - 0.2) break;
          let sg = seg, sS = segS, sL = segL;
          while (sg < n - 2 && at > sS + sL) { sS += sL; sg++; sL = Math.hypot(l.x[sg + 1] - l.x[sg], l.z[sg + 1] - l.z[sg]); }
          const ex = (l.x[sg + 1] - l.x[sg]) / (sL || 1), ez = (l.z[sg + 1] - l.z[sg]) / (sL || 1), f = Math.min(sL, at - sS);
          const nx = -ez * side, nz = ex * side;
          const off = hw + 0.1 + h2 * 0.08 + hz;
          const x = l.x[sg] + ex * f + nx * off, z = l.z[sg] + ez * f + nz * off;
          const ry = Math.atan2(-nx, -nz); // local +z (the entrances) looks at the street
          if (!site(x, z, ry, hx, hz)) continue;
          place(x, z, ry, kind, Math.floor(h2 * CITY_SEEDS), sc, hx, hz);
          s += hx * 2 + 0.18 + h3 * 0.3;
          done = true;
          break;
        }
        if (!done) s += 0.35;
      }
    }
  }

  // 2. courtyard blocks: a sparse grid inside the centre and the middle ring, turned like the nearest street
  const probe = { seg: -1 };
  for (let gz = Math.ceil(z0); gz < z1; gz += 1.7) for (let gx = Math.ceil(x0); gx < x1; gx += 1.7) {
    const hj = hash2(Math.floor(gx * 7), Math.floor(gz * 7 + 900));
    const x = gx + (hj - 0.5) * 0.9, z = gz + (hash2(Math.floor(gx * 5 + 33), Math.floor(gz * 5)) - 0.5) * 0.9;
    const q = cityQ(x, z);
    if (q > 0.8 || hash2(Math.floor(gx * 3), Math.floor(gz * 3 + 77)) > (q < 0.42 ? 0.85 : 0.55)) continue;
    if (lcAt(t, x, z) !== LC.BUILT) continue;
    if (roadClearance(x, z, (1 << RC.MAIN) | (1 << RC.ROAD) | (1 << RC.STREET), 9, probe) > 4 || probe.seg < 0) continue;
    const sg = probe.seg, ry = Math.atan2(-(net.sz1[sg] - net.sz0[sg]), net.sx1[sg] - net.sx0[sg]) + (hj > 0.5 ? Math.PI / 2 : 0);
    const k0 = pickKind(q, hash2(Math.floor(gx * 11), Math.floor(gz * 13))), j = 0.94 + hj * 0.12;
    for (const [kind, sc] of [[k0, BLOCK_S * j], [k0, 0.42 * j], [3, 0.38 * j]] as [number, number][]) {
      const [hx, hz] = halfOf(kind, sc);
      if (!site(x, z, ry, hx, hz)) continue;
      place(x, z, ry, kind, Math.floor(hash2(Math.floor(gx), Math.floor(gz)) * CITY_SEEDS), sc, hx, hz);
      break;
    }
  }
  const plan: CityPlan = { blocks, occ, ow, oh, z0: t.z0, rects };
  planCache = { t, plan };
  return plan;
}

/** Is (x, z) on a city block (or right next to one)? */
export function cityOccupied(plan: CityPlan, x: number, z: number): boolean {
  const i = Math.floor(x * 2), j = Math.floor((z - plan.z0) * 2);
  return i >= 0 && j >= 0 && i < plan.ow && j < plan.oh && plan.occ[j * plan.ow + i] === 1;
}

function segDist(px: number, pz: number, x0: number, z0: number, x1: number, z1: number) {
  const dx = x1 - x0, dz = z1 - z0;
  const k = Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / (dx * dx + dz * dz)));
  const qx = x0 + dx * k - px, qz = z0 + dz * k - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

// ---- drawing: the fill with LOD ---------------------------------------------------------------------------
/** What the city needs to know about the camera for its level of detail (Stage has it). */
export interface CityView { target: { x: number; z: number }; dist: number }

/** Far LOD: a box without a bottom (10 triangles), walls white (the instance colour tints), roof a touch darker. */
function farBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  g.translate(0, 0.5, 0);
  const pos = g.attributes.position, nor = g.attributes.normal, keep: number[] = [];
  for (let f = 0; f < pos.count / 3; f++) if (nor.getY(f * 3) > -0.5) keep.push(f);
  const P = new Float32Array(keep.length * 9), N = new Float32Array(keep.length * 9), C = new Float32Array(keep.length * 9);
  keep.forEach((f, i) => {
    for (let k = 0; k < 9; k++) { P[i * 9 + k] = (pos.array as Float32Array)[f * 9 + k]; N[i * 9 + k] = (nor.array as Float32Array)[f * 9 + k]; }
    const top = nor.getY(f * 3) > 0.5;
    for (let v = 0; v < 3; v++) { const s = top ? 0.72 : 1; C[i * 9 + v * 3] = s; C[i * 9 + v * 3 + 1] = s; C[i * 9 + v * 3 + 2] = s * 1.02; }
  });
  g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return out;
}

/** Average wall colour of a block geometry (its largest colour by area), for the far box. */
function wallColour(g: THREE.BufferGeometry): THREE.Color {
  const P = g.attributes.position.array as ArrayLike<number>, C = g.attributes.color.array as ArrayLike<number>;
  const area = new Map<string, { a: number; r: number; g: number; b: number }>();
  const v = (i: number) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  for (let f = 0; f < P.length / 9; f++) {
    const a = v(f * 3), b = v(f * 3 + 1), c = v(f * 3 + 2);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    const A = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
    const r = C[f * 9], gg = C[f * 9 + 1], bb = C[f * 9 + 2], key = `${r.toFixed(3)},${gg.toFixed(3)},${bb.toFixed(3)}`;
    const e = area.get(key) ?? { a: 0, r, g: gg, b: bb };
    e.a += A; area.set(key, e);
  }
  let best = { a: -1, r: 1, g: 1, b: 1 };
  for (const e of area.values()) if (e.a > best.a) best = e;
  return new THREE.Color(best.r, best.g, best.b);
}

export class CityFill {
  group = new THREE.Group();
  private items: CityBlockItem[];
  private near: THREE.InstancedMesh[] = [];
  private far: THREE.InstancedMesh;
  private geoOf: Int32Array;
  private farScale: [number, number, number][] = [];
  private walls: THREE.Color[] = [];
  private last = { x: 1e9, z: 1e9, r: -1 };
  private next = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  private p = new THREE.Vector3(); private sv = new THREE.Vector3();
  /** Triangles of one full block per geometry (for the stats). */
  readonly tris: number[] = [];
  /** Blocks drawn in full right now. */
  nearCount = 0;

  constructor(t: Terrain, plan: CityPlan, private low: boolean, shadows: boolean) {
    this.group.name = 'city-fill';
    this.items = plan.blocks;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const counts = new Int32Array(4 * CITY_SEEDS);
    this.geoOf = new Int32Array(this.items.length);
    this.items.forEach((b, i) => { const g = b.kind * CITY_SEEDS + b.seed; this.geoOf[i] = g; counts[g]++; });
    const walls = this.walls;
    for (let g = 0; g < 4 * CITY_SEEDS; g++) {
      const kind = Math.floor(g / CITY_SEEDS), geo = cityBlock(kind, (g % CITY_SEEDS) + 1);
      walls.push(wallColour(geo));
      this.tris.push(geo.attributes.position.count / 3);
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, counts[g]));
      im.count = 0;
      im.castShadow = shadows; im.receiveShadow = true;
      im.frustumCulled = false; // the visible set changes with the view; the boxes below cover the rest
      im.name = 'city-near';
      this.near.push(im);
      this.group.add(im);
    }
    const box = farBox();
    this.far = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), Math.max(1, this.items.length));
    this.far.name = 'city-far';
    this.far.castShadow = false; this.far.receiveShadow = true;
    this.far.frustumCulled = false;
    this.group.add(this.far);
    // far boxes: the walls only (no loggias / canopies), the block's height to the parapet
    for (let i = 0; i < this.items.length; i++) {
      const b = this.items[i], [w, d] = cityBlockFootprint(b.kind);
      this.farScale.push([(w - 0.05) * b.s, cityBlockHeight(b.kind) * b.s, (d - 0.38) * b.s]);
    }
    this.relayout(1e9, 1e9, 0);
  }

  /** Radius around the view target drawn in full (0 from far out: boxes only). */
  private radius(dist: number): number {
    if (dist > 150) return 0;
    return this.low ? 12 + dist * 0.22 : 22 + dist * 0.42;
  }

  update(view: CityView | undefined) {
    if (!view) return;
    const now = performance.now();
    if (now < this.next) return;
    this.next = now + 140;
    const r = this.radius(view.dist), tx = view.target.x, tz = view.target.z;
    if (Math.abs(r - this.last.r) < 2.5 && (r === 0 || Math.hypot(tx - this.last.x, tz - this.last.z) < 2)) return;
    this.relayout(tx, tz, r);
  }

  private relayout(tx: number, tz: number, r: number) {
    this.last = { x: tx, z: tz, r };
    const r2 = r * r, fill = new Int32Array(this.near.length);
    let nf = 0;
    for (let i = 0; i < this.items.length; i++) {
      const b = this.items[i];
      this.e.set(0, b.ry, 0); this.q.setFromEuler(this.e); this.p.set(b.x, b.y, b.z);
      if (r > 0 && (b.x - tx) ** 2 + (b.z - tz) ** 2 < r2) {
        const g = this.geoOf[i];
        this.sv.set(b.s, b.s, b.s);
        this.m.compose(this.p, this.q, this.sv);
        this.near[g].setMatrixAt(fill[g]++, this.m);
      } else {
        const s = this.farScale[i];
        this.sv.set(s[0], s[1], s[2]);
        this.m.compose(this.p, this.q, this.sv);
        this.far.setMatrixAt(nf, this.m);
        this.far.setColorAt(nf, this.walls[this.geoOf[i]]);
        nf++;
      }
    }
    let nn = 0;
    this.near.forEach((im, g) => { im.count = fill[g]; nn += fill[g]; im.instanceMatrix.needsUpdate = true; });
    this.far.count = nf;
    this.far.instanceMatrix.needsUpdate = true;
    if (this.far.instanceColor) this.far.instanceColor.needsUpdate = true;
    this.nearCount = nn;
  }

  /** Number of blocks in the fill. */
  get count(): number { return this.items.length; }

  /** Triangles drawn right now (for the budget checks). */
  get drawnTris(): number {
    let n = this.far.count * 10;
    this.near.forEach((im, g) => { n += im.count * this.tris[g]; });
    return n;
  }
}

// ---- drawing: landmarks -------------------------------------------------------------------------------------
/** A board on two posts with a canvas sign (the «Ансар. Филиал» branch). */
function signBoard(text: string): THREE.Group {
  const g = new THREE.Group();
  const post = new THREE.MeshLambertMaterial({ color: '#3a3e45' });
  for (const x of [-0.7, 0.7]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.5, 0.07), post);
    m.position.set(x, 0.75, 0);
    g.add(m);
  }
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const ctx = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const paint = () => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 512, 160);
    ctx.fillStyle = '#17a36b'; ctx.fillRect(14, 14, 132, 132);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 11; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(62, 46); ctx.lineTo(36, 80); ctx.lineTo(62, 114); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(98, 46); ctx.lineTo(124, 80); ctx.lineTo(98, 114); ctx.stroke();
    ctx.fillStyle = '#1b1d22'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const [a, b] = text.split(' · ');
    ctx.font = '900 52px Unbounded, "Arial Black", sans-serif'; ctx.fillText(a, 166, 62, 330);
    ctx.fillStyle = '#0c6a44';
    ctx.font = '800 34px "Golos Text", Arial, sans-serif'; ctx.fillText((b ?? '').toLowerCase(), 168, 118, 330);
    tex.needsUpdate = true;
  };
  paint();
  (document as Document & { fonts?: FontFaceSet }).fonts?.load('900 52px Unbounded').then(paint, () => { /* system font */ });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.53), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  board.position.set(0, 1.3, 0.05);
  g.add(board);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.58, 0.05), post);
  back.position.set(0, 1.3, 0);
  g.add(back);
  return g;
}

export interface CityLandmarks {
  group: THREE.Group;
  /** sign meshes per site (shown only up close) */
  signs: THREE.Object3D[];
  tris: number;
  /** the real-spot Донер Бей (its spit turns, its sign follows the 18+ switch) */
  doner?: { group: THREE.Group; spit: THREE.Object3D; setSign(text: string): void };
}

/** Lowest ground under a site's footprint, a little below so it never floats. */
function siteGround(t: Terrain, s: CitySite): number {
  const r = siteRect(s), c = Math.cos(r.ry), n = Math.sin(r.ry);
  let lo = heightY(t, r.x, r.z);
  for (const [a, b] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const lx = a * r.hx, lz = b * r.hz;
    lo = Math.min(lo, heightY(t, r.x + lx * c + lz * n, r.z - lx * n + lz * c));
  }
  return lo - 0.04;
}

/**
 * The city landmarks. `make` builds the models the city does not own (Донер Бей's pavilion, the stop
 * shelter from props.landmark), so this module needs no DOM-only imports beyond THREE.
 */
export function buildCityLandmarks(t: Terrain, make: { doner(): { group: THREE.Group; spit: THREE.Group; setSign(text: string): void }; busstop(name: string, side: 0 | 1): THREE.Group }, shadows: boolean): CityLandmarks {
  const group = new THREE.Group();
  group.name = 'city-landmarks';
  const signs: THREE.Object3D[] = [];
  let tris = 0, doner: CityLandmarks['doner'];
  for (const s of CITY_SITES) {
    let g: THREE.Group;
    if (s.model === 'doner') { const d = make.doner(); g = d.group; doner = d; }
    else if (s.model === 'busstop') g = make.busstop(s.sign ?? 'ОСТАНОВКА', s.side ?? 0);
    else if (s.model === 'sign') g = signBoard(s.sign ?? s.name.toUpperCase());
    else g = groznyLandmark(s.model, { closed: false });
    const outer = new THREE.Group();
    g.scale.multiplyScalar(s.s);
    outer.add(g);
    outer.position.set(s.x, siteGround(t, s), s.z);
    outer.rotation.y = s.ry;
    outer.name = 'city-' + s.key;
    outer.userData.site = s;
    group.add(outer);
    outer.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      if ((m.material as THREE.Material).type === 'MeshBasicMaterial') { m.castShadow = false; m.userData.at = [s.x, s.z]; signs.push(m); }
      else { m.castShadow = shadows; m.receiveShadow = true; }
    });
  }
  return { group, signs, tris, doner };
}

/**
 * Map tags of the city landmarks (labels.ts shows them up close): name, position, height of the model.
 * Донер Бей has none: its address label (labels.ts) is its tag.
 */
export function cityTags(t: Terrain): { name: string; x: number; z: number; y: number; real: boolean }[] {
  return CITY_SITES.filter(s => s.key !== 'doner').map(s => ({ name: s.name, x: s.x, z: s.z, y: heightY(t, s.x, s.z) + siteHeight(s) + 0.45, real: !s.key.startsWith('stop') }));
}
