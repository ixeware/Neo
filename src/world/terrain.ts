// Real terrain between Starye Atagi and Kurchaloy, and (v4) central Grozny north of the old edge.
// World units: 1 unit = 100 m. x grows east, z grows south. The map spans x 0..W and z z0..H: the
// origin never moved when the map grew north (v4: z0 = −36), so every point, place, road and save
// keeps its coordinates. Every grid (heights, land cover, nav) starts at row z = z0.
import { TERRAIN_META as M, HEIGHTS_B64, LANDCOVER_B64, BUILT_B64 } from '../data/terrain';

export const LC = { TREE: 0, GRASS: 1, CROP: 2, BUILT: 3, BARE: 4, WATER: 5, WET: 6 } as const;
export const EXAG = 2.2; // vertical exaggeration so the foothills read on screen
export const NAV = 2; // world units per nav cell

export interface Village { key: string; name: string; x: number; z: number; r: number; cells: number }

export interface Terrain {
  W: number; H: number; // east and south edges in world units (x 0..W, z z0..H)
  /** North edge (world z of every grid's first row): −36 since v4, 0 before. */
  z0: number;
  gw: number; gh: number; // height grid cells (vertices = gw+1 x gh+1), gh = H − z0
  heightsM: Float32Array; // metres at vertices
  lcw: number; lch: number; lcCell: number; // land cover grid (cells of lcCell metres)
  lc: Uint8Array; built: Uint8Array;
  nw: number; nh: number; // nav grid
  navCost: Uint16Array; // 0 = blocked, otherwise 9..60 (10 = open field)
  villages: Village[];
  meta: typeof M;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function inflate(b64: string): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([b64ToBytes(b64) as BlobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function loadTerrain(): Promise<Terrain> {
  const [hRaw, lc, built] = await Promise.all([inflate(HEIGHTS_B64), inflate(LANDCOVER_B64), inflate(BUILT_B64)]);
  const z0 = M.z0, gw = M.gw, gh = M.gh - z0;
  // z0 must keep the 3×3 order blocks (6 units) and the sim's 4-unit hash aligned to the origin
  if (z0 % 12 !== 0) throw new Error('terrain z0 must be a multiple of 12');
  const h16 = new Uint16Array(hRaw.buffer, hRaw.byteOffset, (gw + 1) * (gh + 1));
  const heightsM = new Float32Array(h16.length);
  for (let i = 0; i < h16.length; i++) heightsM[i] = h16[i] / 4;
  const t: Terrain = {
    W: gw, H: M.gh, z0, gw, gh, heightsM,
    lcw: M.lcw, lch: lc.length / M.lcw, lcCell: M.lcCell, lc, built,
    nw: Math.ceil(gw / NAV), nh: Math.ceil(gh / NAV),
    navCost: new Uint16Array(0),
    villages: M.villages.map(v => ({ ...v })),
    meta: M,
  };
  t.navCost = buildNav(t, h16);
  for (const b of BRIDGES) layBridge(t, b);
  return t;
}

// Real crossings over the Argun: Starye–Novye Atagi, Chechen-Aul, Argun town.
export interface Bridge { name: string; x0: number; z0: number; x1: number; z1: number }
export const BRIDGES: Bridge[] = [
  { name: 'Мост Атаги — Новые Атаги', x0: 66, z0: 193.5, x1: 84, z1: 188.5 },
  { name: 'Мост у Чечен-Аула', x0: 104, z0: 108, x1: 124, z1: 104 },
  { name: 'Мост в Аргуне', x0: 136, z0: 44, x1: 158, z1: 38 },
];

function layBridge(t: Terrain, b: Bridge) {
  const len = Math.sqrt((b.x1 - b.x0) ** 2 + (b.z1 - b.z0) ** 2);
  const n = Math.ceil(len * 2);
  for (let k = 0; k <= n; k++) {
    const x = b.x0 + ((b.x1 - b.x0) * k) / n, z = b.z0 + ((b.z1 - b.z0) * k) / n;
    for (const o of [-0.8, 0, 0.8]) t.navCost[navIndex(t, x, z + o)] = 9;
  }
}

// Integer-only nav cost so every client builds the identical grid. Row j is z = z0 + j·NAV; the rows
// with z >= 0 come from the pre-v4 data unchanged, so their costs are exactly the pre-v4 grid's.
function buildNav(t: Terrain, h16: Uint16Array): Uint16Array {
  const { nw, nh, gw, lcw, lch } = t;
  const cost = new Uint16Array(nw * nh);
  const per = (NAV * 100) / t.lcCell; // land-cover cells per nav cell side (4)
  const base = [15, 10, 10, 9, 11, 34, 20];
  const counts = new Int32Array(7);
  for (let j = 0; j < nh; j++) {
    for (let i = 0; i < nw; i++) {
      counts.fill(0);
      for (let b = 0; b < per; b++) for (let a = 0; a < per; a++) {
        const x = i * per + a, z = j * per + b;
        if (x >= lcw || z >= lch) continue;
        counts[t.lc[z * lcw + x]]++;
      }
      let best = 1, bc = -1;
      for (let k = 0; k < 7; k++) if (counts[k] > bc) { bc = counts[k]; best = k; }
      if (counts[LC.WATER] * 3 >= per * per) best = LC.WATER;
      // slope from quarter-metre heights over the nav cell (2 x 100 m)
      let maxd = 0;
      const x0 = Math.min(i * NAV, gw), z0 = Math.min(j * NAV, t.gh);
      const x1 = Math.min(x0 + NAV, gw), z1 = Math.min(z0 + NAV, t.gh);
      const hv = (x: number, z: number) => h16[z * (gw + 1) + x];
      const pairs = [[x0, z0, x1, z0], [x0, z1, x1, z1], [x0, z0, x0, z1], [x1, z0, x1, z1], [x0, z0, x1, z1], [x1, z0, x0, z1]];
      for (const p of pairs) {
        const d = Math.abs(hv(p[0], p[1]) - hv(p[2], p[3]));
        if (d > maxd) maxd = d;
      }
      // maxd quarter-metres over ~200-280 m. grade*1000 ~= maxd*1000/(4*200)
      const grade1000 = Math.floor((maxd * 1000) / 800);
      if (grade1000 > 330) { cost[j * nw + i] = 0; continue; }
      cost[j * nw + i] = base[best] + Math.floor(grade1000 / 9);
    }
  }
  return cost;
}

/** Height in metres, bilinear, world coords. */
export function heightM(t: Terrain, x: number, z: number): number {
  const gx = Math.max(0, Math.min(t.gw - 0.0001, x));
  const gz = Math.max(0, Math.min(t.gh - 0.0001, z - t.z0));
  const i = Math.floor(gx), j = Math.floor(gz);
  const fx = gx - i, fz = gz - j;
  const W = t.gw + 1, h = t.heightsM;
  const a = h[j * W + i], b = h[j * W + i + 1], c = h[(j + 1) * W + i], d = h[(j + 1) * W + i + 1];
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

// Render-only: once the low-poly map is built, heightY follows the drawn surface exactly so houses,
// units, labels and effects sit on the faces. The sim never calls heightY (it uses navCost only).
let renderSurface: ((x: number, z: number) => number) | null = null;
export function setRenderSurface(fn: ((x: number, z: number) => number) | null) { renderSurface = fn; }

/** Ground height in world units (the rendered surface when one is set, else the bilinear heightmap). */
export function heightY(t: Terrain, x: number, z: number): number {
  if (renderSurface) return renderSurface(x, z);
  return (heightM(t, x, z) / 100) * EXAG;
}

// Grid rows are counted from z0, but every lookup floors the plain world coordinate first and then adds
// a whole number of rows (−z0 / cell): the same float maths as before the map grew, so a unit standing
// south of z = 0 lands in exactly the cell it did before v4 (bit-identical flow fields and replays).
const lcRow = (t: Terrain, z: number) => Math.floor((z * 100) / t.lcCell) - (t.z0 * 100) / t.lcCell;
/** Nav row under world z (not clamped). */
export const navRow = (t: Terrain, z: number) => Math.floor(z / NAV) - t.z0 / NAV;

export function lcAt(t: Terrain, x: number, z: number): number {
  return t.lc[lcIndex(t, x, z)];
}

/** Land-cover / built-up grid cell under (x, z) (clamped to the map). */
export function lcIndex(t: Terrain, x: number, z: number): number {
  const i = Math.max(0, Math.min(t.lcw - 1, Math.floor((x * 100) / t.lcCell)));
  const j = Math.max(0, Math.min(t.lch - 1, lcRow(t, z)));
  return j * t.lcw + i;
}

export function navIndex(t: Terrain, x: number, z: number): number {
  const i = Math.max(0, Math.min(t.nw - 1, Math.floor(x / NAV)));
  const j = Math.max(0, Math.min(t.nh - 1, navRow(t, z)));
  return j * t.nw + i;
}

/** World x of the centre of nav cell `cell`. */
export function cellX(t: Terrain, cell: number): number { return ((cell % t.nw) + 0.5) * NAV; }
/** World z of the centre of nav cell `cell` (exact: whole and half units only). */
export function cellZ(t: Terrain, cell: number): number { return (Math.floor(cell / t.nw) + 0.5) * NAV + t.z0; }

/**
 * Nav cell in the middle of the 3×3-cell block around (x, z). The blocks are aligned to the world
 * origin (z0 is a multiple of 3 cells), so they cover the same ground as before the map grew north.
 */
export function blockCell(t: Terrain, x: number, z: number): number {
  const ci = Math.max(0, Math.min(t.nw - 1, Math.floor(x / NAV))), cj = Math.max(0, Math.min(t.nh - 1, navRow(t, z)));
  return Math.min(t.nh - 1, cj - (cj % 3) + 1) * t.nw + Math.min(t.nw - 1, ci - (ci % 3) + 1);
}

/** Inside the map with a one-unit margin (where units may stand). */
export function inMap(t: Terrain, x: number, z: number): boolean {
  return x >= 1 && z >= t.z0 + 1 && x <= t.W - 1 && z <= t.H - 1;
}

export function passable(t: Terrain, x: number, z: number): boolean {
  if (x < 1 || z < t.z0 + 1 || x > t.W - 1 || z > t.H - 1) return false;
  return t.navCost[navIndex(t, x, z)] > 0;
}
