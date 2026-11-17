// Where the real 2GIS places stand on the map: a pure plan (no THREE, no DOM) that world.ts uses to
// keep houses, trees and the village decor clear, and decor.ts uses to build the models.
//
// Every PLACES entry gets a model (props.landmark for school/stadium/market/…, a small mosque for
// mosques unless one is already drawn within MOSQUE_SKIP), Фудзи keeps the hand-made kiosk, and the
// four CAPTURE_PLACES get a bigger model beside (never on) their ring centre. A spot keeps its 2GIS
// point when it can; otherwise it moves to the nearest spot (≤ 3.5 units) that clears the
// high-rises, the idle bosses, the drawn mosques, the bridges, the water, every point's flag and
// Донер Бей, and the other landmarks. Models face the centre of their village.
import { BRIDGES, LC, heightM, lcAt, lcIndex, passable, type Terrain } from '../world/terrain';
import { TERRAIN_META } from '../data/terrain';
import { PLACES, CAPTURE_PLACES, type PlaceKind } from '../data/places';
import { roadClearance, RC } from './roads';

export interface LmSpot {
  /** PLACES id or CAPTURE_PLACES key */
  id: string;
  name: string;
  /** props.landmark kind, or 'mosque' */
  kind: string;
  village: string;
  /** model centre (the footprint centre), facing (rotation.y: local +z turned to face its village) and scale */
  x: number; z: number; ry: number; s: number;
  /** keep-clear radius around x,z */
  r: number;
  /** model height (for labels) */
  h: number;
  /** the 2GIS point itself (labels sit there) */
  px: number; pz: number;
  /** real (2GIS) or placed by hand */
  real: boolean;
  /** village colour of the model, if any */
  side?: 0 | 1;
  /** CAPTURE_PLACES key when this is a capture place's building */
  capture?: string;
  /** спортики hanging out in front (stadium / gym capture places) */
  crowd?: number;
  /** a parked Гелик next to it (car wash, parking) */
  gelik?: boolean;
  /** small and cheap to lose: hidden far from the camera on low-power devices */
  small: boolean;
}

/** Footprints of props.landmark at building scale (w along x, d along z), our scale for the map, height at building scale. */
const FOOT: Record<string, [number, number, number, number]> = {
  stadium: [10, 7.2, 0.44, 3.6], school: [6, 5, 0.55, 2.4], shop: [4.2, 3.4, 0.55, 1.5], market: [6, 5, 0.52, 2.6], cafe: [4.4, 3.8, 0.55, 1.9],
  busstop: [3.3, 1.6, 0.55, 1.7], carwash: [6, 5, 0.52, 1.8], parking: [6, 4.6, 0.52, 1.9], fuel: [6, 5.1, 0.52, 2.0], clinic: [5.2, 4.3, 0.55, 2.4],
  park: [6, 6, 0.5, 2.0], gym: [5, 4, 0.55, 2.3], other: [3.4, 2.8, 0.55, 1.8],
  // world.ts mosque(false): 1.56 square body, the minaret at (0.96, 0.84), 2.5 to the tip
  mosque: [2.4, 2.4, 1, 2.5],
};
const SMALL = new Set(['busstop', 'shop', 'cafe']);
/** Keep-clear radius of a w × d footprint at scale s: most of the way to the corners (houses are tested by their centre). */
const footR = (w: number, d: number, s: number) => 0.5 * Math.max(Math.max(w, d), 0.88 * Math.hypot(w, d)) * s;
/** A drawn mosque within this distance makes a 2GIS mosque redundant (Шали's big one, the HQ ones). */
export const MOSQUE_SKIP = 3;
/** Capture-place buildings are a bit bigger: they are what the fight is about. */
const CAPTURE_K = 1.1;
/** The four capture places: which building they get. */
const CAPTURE_KIND: Record<string, { kind: string; crowd?: number; gelik?: boolean }> = {
  atagi_stadium: { kind: 'stadium', crowd: 4 },
  atagi_wash: { kind: 'carwash', gelik: true },
  kurch_gym: { kind: 'stadium', crowd: 5 },
  kurch_market: { kind: 'shop' }, // «Супермаркет у трассы»: a shop front, the perk is the market's +3 ₽/s
};
const HQ_ROT = [0.35, -0.25];
/** High-rise footprints as circles (Атаги 4.8 × 3.0, Курчалой 7.8 × 2.2). */
const HQ_R = [3.2, 4.3];
/** Донер Бей (sim.findDoner looks next to 30, 12, far from every landmark): keep a wide berth anyway. */
const DONER_AT = { x: 30, z: 12, r: 6 };

interface Circle { x: number; z: number; r: number }

function segDist(px: number, pz: number, x0: number, z0: number, x1: number, z1: number) {
  const dx = x1 - x0, dz = z1 - z0;
  const k = Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / (dx * dx + dz * dz)));
  const qx = x0 + dx * k - px, qz = z0 + dz * k - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

interface V { key: string; x: number; z: number }
const villages: readonly V[] = TERRAIN_META.villages;
const village = (key: string): V => villages.find(v => v.key === key)!;

/**
 * Mosques main.ts draws itself: Шали's big one on the village point, one small one next to each
 * high-rise (p.x − 6 / + 7, p.z + 4). Keep in step with main.ts.
 */
export function drawnMosques(): Circle[] {
  const sh = village('shali'), a = village('atagi'), k = village('kurchaloy');
  return [{ x: sh.x, z: sh.z, r: 2.7 }, { x: a.x - 6, z: a.z + 4, r: 1.6 }, { x: k.x + 7, z: k.z + 4, r: 1.6 }];
}

/** Fixed things a landmark must not cover: high-rises, idle bosses, boss spawns, drawn mosques, flags, Донер Бей. */
function fixedKeep(): Circle[] {
  const keep: Circle[] = [];
  for (const s of [0, 1] as const) {
    const v = village(s === 0 ? 'atagi' : 'kurchaloy'), rot = HQ_ROT[s];
    keep.push({ x: v.x, z: v.z, r: HQ_R[s] });
    const ox = s === 0 ? -4.6 : 5.6, oz = -3.4;
    keep.push({ x: v.x + ox * Math.cos(rot) + oz * Math.sin(rot), z: v.z - ox * Math.sin(rot) + oz * Math.cos(rot), r: 1.6 }); // idle boss
    keep.push({ x: v.x + (s === 0 ? 4 : -4), z: v.z + 1, r: 1.2 }); // boss spawn
  }
  keep.push(...drawnMosques());
  // flags on every point (villages, capture places) and the units that gather there
  for (const v of villages) if (v.key !== 'atagi' && v.key !== 'kurchaloy') keep.push({ x: v.x, z: v.z, r: 1.4 });
  for (const c of CAPTURE_PLACES) keep.push({ x: c.x, z: c.z, r: 1.4 });
  keep.push(DONER_AT);
  return keep;
}

function okSpot(t: Terrain | null, x: number, z: number, r: number, keep: Circle[]): boolean {
  if (x < r + 1 || z < TERRAIN_META.z0 + r + 1 || x > TERRAIN_META.gw - r - 1 || z > TERRAIN_META.gh - r - 1) return false;
  for (const k of keep) if ((k.x - x) ** 2 + (k.z - z) ** 2 < (k.r + r) ** 2) return false;
  for (const b of BRIDGES) if (segDist(x, z, b.x0, b.z0, b.x1, b.z1) < r + 1.1) return false;
  if (roadClearance(x, z, (1 << RC.MAIN) | (1 << RC.ROAD) | (1 << RC.RAIL)) < r * 0.8) return false; // not on a main road
  if (!t) return true;
  let lo = Infinity, hi = -Infinity;
  for (const [ox, oz] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const px = x + ox * r * 0.8, pz = z + oz * r * 0.8;
    if (!passable(t, px, pz) || lcAt(t, px, pz) === LC.WATER) return false;
    const h = heightM(t, px, pz);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  return hi - lo < 14 + r * 6; // metres across the footprint: no cliff edges
}

/** Nearest valid spot to (x0, z0) within maxR, or null. */
function settle(t: Terrain | null, x0: number, z0: number, r: number, keep: Circle[], minR = 0, maxR = 3.5): { x: number; z: number } | null {
  if (minR === 0 && okSpot(t, x0, z0, r, keep)) return { x: x0, z: z0 };
  for (let R = Math.max(0.4, minR); R <= maxR + 1e-6; R += 0.4) {
    const n = Math.max(8, Math.round(R * 8));
    let best: { x: number; z: number } | null = null, bs = -Infinity;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, x = x0 + Math.sin(a) * R, z = z0 + Math.cos(a) * R;
      if (!okSpot(t, x, z, r, keep)) continue;
      // tie-break: stay in town (more built-up cover) and away from the nearest obstacle
      const built = t ? builtAt(t, x, z) : 0;
      let clear = Infinity;
      for (const c of keep) clear = Math.min(clear, Math.sqrt((c.x - x) ** 2 + (c.z - z) ** 2) - c.r - r);
      const sc = built * 2 + Math.min(clear, 2) * 0.5;
      if (sc > bs) { bs = sc; best = { x, z }; }
    }
    if (best) return best;
  }
  return null;
}

function builtAt(t: Terrain, x: number, z: number) {
  const c0 = lcIndex(t, x, z), ci = c0 % t.lcw, cj = (c0 - ci) / t.lcw;
  let b = 0;
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
    const bi = Math.max(0, Math.min(t.lcw - 1, ci + i)), bj = Math.max(0, Math.min(t.lch - 1, cj + j));
    b += t.built[bj * t.lcw + bi] / 255 / 25;
  }
  return b;
}

/** Facing that turns local +z towards (cx, cz); the opening camera's south when the target is too close. */
function face(x: number, z: number, cx: number, cz: number) {
  const dx = cx - x, dz = cz - z;
  if (dx * dx + dz * dz < 2.25) return 0;
  // quantise to 15° so neighbours line up like a street
  const a = Math.atan2(dx, dz), q = Math.PI / 12;
  return Math.round(a / q) * q;
}

const VILLAGE_KEY: Record<string, string> = { atagi: 'atagi', novatagi: 'novatagi', kurchaloy: 'kurchaloy', shali: 'shali' };
function nearestVillage(x: number, z: number): V {
  let best: V = villages[0], bd = Infinity;
  for (const v of villages) { const d = (v.x - x) ** 2 + (v.z - z) ** 2; if (d < bd) { bd = d; best = v; } }
  return best;
}

let cache: { t: Terrain | null; fudzi: FudziSpot; plan: LmSpot[]; spots: Circle[] } | null = null;
let lastT: Terrain | null = null;

export interface FudziSpot { key: 'fudzi'; x: number; z: number; ry: number; r: number }

function build(t: Terrain | null) {
  const keep = fixedKeep();
  // ---- Фудзи: the hand-placed kiosk (kurch_fuji) at its spot, nudged off Зураб's idle corner
  const fp = PLACES.find(p => p.id === 'kurch_fuji');
  const fk = village('kurchaloy');
  const f0 = fp ? { x: fp.x, z: fp.z } : { x: fk.x + 6, z: fk.z - 1 };
  const fs = settle(t, f0.x, f0.z, 1.6, keep, 0, 4) ?? f0;
  const fudzi: FudziSpot = { key: 'fudzi', x: fs.x, z: fs.z, ry: face(fs.x, fs.z, fs.x - 0.2, fs.z + 3) || 0.2, r: 1.8 };
  keep.push({ x: fudzi.x, z: fudzi.z, r: 1.6 });

  const plan: LmSpot[] = [];
  const mosques = drawnMosques();
  // capture places first (they matter most), then the bigger landmarks, then the small ones
  for (const c of CAPTURE_PLACES) {
    const ck = CAPTURE_KIND[c.key] ?? { kind: 'other' };
    const [w, d, s0, h0] = FOOT[ck.kind] ?? FOOT.other;
    const s = s0 * CAPTURE_K, r = footR(w, d, s) + (ck.crowd ? 0.5 : 0);
    // beside the flag, never on it: out from the centre until it clears the pole and the gathering units
    const keepC = keep.filter(k => !(Math.abs(k.x - c.x) < 1e-6 && Math.abs(k.z - c.z) < 1e-6));
    keepC.push({ x: c.x, z: c.z, r: 1.6 });
    const spot = settle(t, c.x, c.z, r, [...keepC, ...plan], r + 1.6, r + 4.5);
    if (!spot) continue;
    plan.push({
      id: c.key, name: c.name, kind: ck.kind, village: c.side === 0 ? 'atagi' : 'kurchaloy', x: spot.x, z: spot.z,
      ry: face(spot.x, spot.z, c.x, c.z), s, r, h: h0 * s, px: c.x, pz: c.z, real: c.src === '2gis', side: c.side, capture: c.key,
      crowd: ck.crowd, gelik: ck.gelik, small: false,
    });
  }
  const order = PLACES.filter(p => p.id !== 'kurch_fuji')
    .map(p => ({ p, k: p.kind as PlaceKind }))
    .sort((a, b) => Number(SMALL.has(a.k)) - Number(SMALL.has(b.k)));
  for (const { p, k } of order) {
    if (k === 'mosque' && mosques.some(m => (m.x - p.x) ** 2 + (m.z - p.z) ** 2 < MOSQUE_SKIP * MOSQUE_SKIP)) continue;
    const kind = k === 'other' ? 'other' : k;
    const [w, d, s, h0] = FOOT[kind] ?? FOOT.other;
    // a crowded corner: settle for the tighter circle (the old one) rather than lose a real place
    let r = footR(w, d, s), spot = settle(t, p.x, p.z, r, [...keep, ...plan]);
    if (!spot) { r = 0.46 * Math.max(w, d) * s; spot = settle(t, p.x, p.z, r, [...keep, ...plan], 0, 4.5); }
    if (!spot) continue;
    const vk = VILLAGE_KEY[p.village] ? village(VILLAGE_KEY[p.village]) : nearestVillage(p.x, p.z);
    const side = p.village === 'atagi' || p.village === 'novatagi' ? 0 : p.village === 'kurchaloy' ? 1 : undefined;
    plan.push({
      id: p.id, name: p.name, kind, village: p.village, x: spot.x, z: spot.z, ry: face(spot.x, spot.z, vk.x, vk.z), s, r, h: h0 * s,
      px: p.x, pz: p.z, real: p.real, side, gelik: kind === 'parking' || kind === 'carwash', small: SMALL.has(kind),
    });
  }
  const spots: Circle[] = plan.map(l => ({ x: l.x, z: l.z, r: l.r + 0.25 }));
  spots.push({ x: fudzi.x, z: fudzi.z, r: fudzi.r + 0.3 });
  return { t, fudzi, plan, spots };
}

function get(t?: Terrain) {
  const tt = t ?? lastT;
  if (t) lastT = t;
  if (!cache || cache.t !== tt) cache = build(tt ?? null);
  return cache;
}

/** Every landmark model with its spot, facing and scale (cached per terrain). */
export function landmarkPlan(t?: Terrain): LmSpot[] { return get(t).plan; }

/** Keep-clear circles of the landmark models and Фудзи: houses, trees and the village decor stay out. */
export function landmarkSpots(t?: Terrain): { x: number; z: number; r: number }[] { return get(t).spots; }

/** Where Фудзи stands (its real spot from PLACES, moved off Зураб's idle corner if needed). */
export function fudziSpot(t?: Terrain): FudziSpot { return get(t).fudzi; }
