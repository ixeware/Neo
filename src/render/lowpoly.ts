// Low-poly map: a Delaunay TIN over the real relief and land cover.
// Points follow the Argun banks, forest / village / field outlines and steep relief, so every
// face gets one clean colour (no texture). Render-only: the sim never sees any of this.
import Delaunator from 'delaunator';
import { LC, EXAG, heightM, type Terrain } from '../world/terrain';

export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

export interface Tin {
  W: number; H: number;
  np: number; x: Float32Array; z: Float32Array; y: Float32Array;
  nt: number; tri: Uint32Array; // counter-clockwise seen from above (+y)
  cls: Uint8Array; // land-cover class per face (LC.*)
  rgb: Float32Array; // sRGB 0..1 per face
  nrm: Float32Array; // unit normal per face
  /** Border vertex indices per side, sorted along the edge: north (z=0), east (x=W), south (z=H), west (x=0). */
  border: [number[], number[], number[], number[]];
  /** Uniform grid → faces (CSR) for height lookups. */
  gs: number; gw: number; gh: number; cellStart: Uint32Array; cellTri: Uint32Array;
  ms: number;
}

const NC = 7;
// weights of the smoothed vote: thin forest strips in the gullies and the river must survive smoothing
const VOTE = [1.28, 0.95, 1.0, 1.12, 1.05, 1.9, 1.1];

// ---- palette (sRGB) -------------------------------------------------------------------------------------
type RGB = [number, number, number];
const hx = (s: string): RGB => [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];
const PAL = {
  grass: ['#a5b666', '#9aae5d', '#afbe6e'].map(hx),
  tree: ['#4e8141', '#5b8d48', '#447439'].map(hx),
  treeHigh: ['#3d6a43', '#47744a', '#355e3c'].map(hx),
  // wheat, straw, ochre, ploughed, sunflower, olive, young green
  crop: ['#dfc06e', '#e6d293', '#d4a962', '#c09667', '#a9b862', '#c7c375', '#b6c77f'].map(hx),
  cropW: [3, 1.5, 1.5, 1, 1.5, 2, 1.2],
  cropBase: hx('#d6c27c'),
  built: ['#dbc9a9', '#d2be9c', '#e2d3b7'].map(hx),
  bare: ['#cbbfa3', '#bfb195'].map(hx),
  water: ['#3ea5bf', '#53b7cc', '#46adc5'].map(hx),
  wet: ['#68a593', '#5d9b8a'].map(hx),
  rock: hx('#998b78'),
  meadow: hx('#b9b974'),
};
const CROP_CUM = (() => { const s = PAL.cropW.reduce((a, b) => a + b, 0); let c = 0; return PAL.cropW.map(w => (c += w / s)); })();

/** Deterministic xorshift for shuffles (render-only, same map on every client). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function shuffle(a: Uint32Array, seed: number) {
  const r = rng(seed);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const s = a[i]; a[i] = a[j]; a[j] = s; }
  return a;
}

// ---- point set with variable-radius rejection -------------------------------------------------------
class PointSet {
  x: number[] = []; z: number[] = []; kind: number[] = [];
  private gw: number; private gh: number;
  private heads: Int32Array; private next: number[] = [];
  constructor(W: number, H: number, private cell: number) {
    this.gw = Math.ceil(W / cell) + 1; this.gh = Math.ceil(H / cell) + 1;
    this.heads = new Int32Array(this.gw * this.gh).fill(-1);
  }
  free(x: number, z: number, r: number): boolean {
    const c = this.cell, gi = Math.floor(x / c), gj = Math.floor(z / c), k = Math.ceil(r / c), r2 = r * r;
    const X = this.x, Z = this.z, nx = this.next, hd = this.heads;
    const j0 = Math.max(0, gj - k), j1 = Math.min(this.gh - 1, gj + k), i0 = Math.max(0, gi - k), i1 = Math.min(this.gw - 1, gi + k);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (let p = hd[j * this.gw + i]; p >= 0; p = nx[p]) {
          const dx = X[p] - x, dz = Z[p] - z;
          if (dx * dx + dz * dz < r2) return false;
        }
      }
    }
    return true;
  }
  add(x: number, z: number, kind: number) {
    const id = this.x.length;
    this.x.push(x); this.z.push(z); this.kind.push(kind);
    const k = Math.floor(z / this.cell) * this.gw + Math.floor(x / this.cell);
    this.next.push(this.heads[k]); this.heads[k] = id;
    return id;
  }
  tryAdd(x: number, z: number, r: number, kind: number) {
    return this.free(x, z, r) ? this.add(x, z, kind) : -1;
  }
}

// point kinds
const K_BORDER = 0, K_WATER_EDGE = 1, K_EDGE = 2, K_PARCEL = 3, K_WATER_IN = 4, K_FILL = 5;

/** Smoothed land-cover vote. F: NC weights per cell (interleaved), A: winning class per cell. */
interface Votes { F: Float32Array; A: Uint8Array; cw: number; ch: number; cs: number }

function smoothVotes(t: Terrain): Votes {
  const cw = t.lcw, ch = t.lch, N = cw * ch, RW = cw * NC, lc = t.lc;
  const tmp = new Float32Array(N * NC), F = new Float32Array(N * NC);
  const v16 = VOTE.map(v => v / 16);
  for (let j = 0; j < ch; j++) {
    const row = j * cw;
    for (let i = 0; i < cw; i++) {
      const c = lc[row + i], v = v16[c], base = row * NC + c;
      tmp[base + Math.max(0, i - 2) * NC] += v;
      tmp[base + Math.max(0, i - 1) * NC] += 4 * v;
      tmp[base + i * NC] += 6 * v;
      tmp[base + Math.min(cw - 1, i + 1) * NC] += 4 * v;
      tmp[base + Math.min(cw - 1, i + 2) * NC] += v;
    }
  }
  for (let j = 0; j < ch; j++) {
    const r0 = Math.max(0, j - 2) * RW, r1 = Math.max(0, j - 1) * RW, r2 = j * RW, r3 = Math.min(ch - 1, j + 1) * RW, r4 = Math.min(ch - 1, j + 2) * RW;
    for (let k = 0; k < RW; k++) F[r2 + k] = (tmp[r0 + k] + tmp[r4 + k]) * 0.0625 + (tmp[r1 + k] + tmp[r3 + k]) * 0.25 + tmp[r2 + k] * 0.375;
  }
  const A = new Uint8Array(N);
  for (let p = 0, q = 0; p < N; p++, q += NC) {
    let best = 0, bv = F[q];
    for (let k = 1; k < NC; k++) if (F[q + k] > bv) { bv = F[q + k]; best = k; }
    A[p] = best;
  }
  return { F, A, cw, ch, cs: t.lcCell / 100 };
}

/** Bilinear vote at a world point, added into `out`; returns the leading class. */
function vote(V: Votes, x: number, z: number, out: Float32Array): number {
  const { F, cw, ch, cs } = V;
  const fx = Math.max(0, Math.min(cw - 1.001, x / cs - 0.5)), fz = Math.max(0, Math.min(ch - 1.001, z / cs - 0.5));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const p00 = (j * cw + i) * NC, p10 = p00 + NC, p01 = p00 + cw * NC, p11 = p01 + NC;
  const w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w01 = (1 - u) * v, w11 = u * v;
  let best = 0, bv = -1;
  for (let k = 0; k < NC; k++) {
    const o = out[k] + F[p00 + k] * w00 + F[p10 + k] * w10 + F[p01 + k] * w01 + F[p11 + k] * w11;
    out[k] = o;
    if (o > bv) { bv = o; best = k; }
  }
  return best;
}

/** Class outlines: zero crossings of the vote difference between neighbouring cells. */
function outlinePoints(V: Votes, pts: PointSet, edgeSeed: Uint8Array, W: number, H: number) {
  const { F, A, cw, ch, cs } = V;
  const cap = cw * ch;
  const ex = new Float32Array(cap), ez = new Float32Array(cap), ef = new Uint8Array(cap);
  let n = 0;
  const cross = (p: number, q: number, x0: number, z0: number, dx: number, dz: number) => {
    const a = A[p], b = A[q];
    const d0 = F[p * NC + a] - F[p * NC + b], d1 = F[q * NC + a] - F[q * NC + b];
    const s = d0 - d1 > 1e-6 ? Math.max(0, Math.min(1, d0 / (d0 - d1))) : 0.5;
    if (n >= cap) return;
    ex[n] = x0 + dx * s; ez[n] = z0 + dz * s;
    ef[n] = a === LC.WATER || b === LC.WATER ? 0 : a === LC.BUILT || b === LC.BUILT ? 1 : 2;
    n++;
    edgeSeed[p] = 1; edgeSeed[q] = 1;
  };
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const p = j * cw + i, a = A[p];
    if (i + 1 < cw && A[p + 1] !== a) cross(p, p + 1, (i + 0.5) * cs, (j + 0.5) * cs, cs, 0);
    if (j + 1 < ch && A[p + cw] !== a) cross(p, p + cw, (i + 0.5) * cs, (j + 0.5) * cs, 0, cs);
  }
  const order = new Uint32Array(n);
  for (let k = 0; k < n; k++) order[k] = k;
  shuffle(order, 9001);
  const R = [0.62, 0.86, 0.96], KIND = [K_WATER_EDGE, K_EDGE, K_EDGE];
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 0; k < n; k++) {
      const e = order[k];
      if (ef[e] !== pass) continue;
      const x = ex[e], z = ez[e];
      if (x < 0.3 || z < 0.3 || x > W - 0.3 || z > H - 0.3) continue;
      pts.tryAdd(x, z, R[pass], KIND[pass]);
    }
  }
}

// ---- parcels --------------------------------------------------------------------------------------------------
interface Seeds { xy: Float64Array; n: number; tone: Uint8Array; grid: Int32Array[]; gcell: number; gw: number; gh: number }

/** Field parcels: rows of strips; a few regions each with its own heading and strip size. */
function parcelSeeds(W: number, H: number): Seeds {
  const R = 64;
  const regs: { x: number; z: number; ca: number; sa: number; L: number; D: number }[] = [];
  for (let j = -1; j <= Math.ceil(H / R) + 1; j++) for (let i = -1; i <= Math.ceil(W / R) + 1; i++) {
    const h1 = hash2(i + 400, j + 900), h2 = hash2(i + 41, j + 77), h3 = hash2(i + 7, j + 3);
    const ang = 0.32 + (h1 - 0.5) * 0.9;
    regs.push({ x: (i + 0.2 + 0.6 * h2) * R, z: (j + 0.2 + 0.6 * h3) * R, ca: Math.cos(ang), sa: Math.sin(ang), L: 7 + hash2(i, j + 55) * 3, D: 3.4 + hash2(i + 9, j) * 1.4 });
  }
  const nearestReg = (x: number, z: number) => {
    let best = 0, bd = 1e18;
    for (let r = 0; r < regs.length; r++) { const dx = regs[r].x - x, dz = regs[r].z - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = r; } }
    return best;
  };
  const xs: number[] = [];
  regs.forEach((g, r) => {
    const ext = R * 1.25;
    for (let v = -Math.ceil(ext / g.D); v <= Math.ceil(ext / g.D); v++) {
      const rowOff = hash2(r * 31 + 5, v + 1000) * g.L;
      for (let u = -Math.ceil(ext / g.L); u <= Math.ceil(ext / g.L); u++) {
        const lu = u * g.L + rowOff + (hash2(u + 300, v + r * 17) - 0.5) * g.L * 0.3;
        const lv = v * g.D + (hash2(u + r * 13, v + 600) - 0.5) * g.D * 0.25;
        const x = g.x + lu * g.ca - lv * g.sa, z = g.z + lu * g.sa + lv * g.ca;
        if (x < -10 || z < -10 || x > W + 10 || z > H + 10) continue;
        if (nearestReg(x, z) !== r) continue;
        xs.push(x, z);
      }
    }
  });
  const n = xs.length / 2;
  const tone = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const h = hash2(i * 3 + 1, 4242);
    let k = 0;
    while (k < CROP_CUM.length - 1 && h > CROP_CUM[k]) k++;
    tone[i] = k;
  }
  const gcell = 6, gw = Math.ceil((W + 20) / gcell), gh = Math.ceil((H + 20) / gcell);
  const lists: number[][] = Array.from({ length: gw * gh }, () => []);
  for (let i = 0; i < n; i++) {
    const gi = Math.max(0, Math.min(gw - 1, Math.floor((xs[i * 2] + 10) / gcell))), gj = Math.max(0, Math.min(gh - 1, Math.floor((xs[i * 2 + 1] + 10) / gcell)));
    lists[gj * gw + gi].push(i);
  }
  return { xy: Float64Array.from(xs), n, tone, grid: lists.map(l => Int32Array.from(l)), gcell, gw, gh };
}

function nearestSeed(s: Seeds, x: number, z: number): number {
  const gi = Math.floor((x + 10) / s.gcell), gj = Math.floor((z + 10) / s.gcell);
  let best = -1, bd = 1e18;
  for (let r = 1; r <= 3; r++) {
    for (let j = Math.max(0, gj - r); j <= Math.min(s.gh - 1, gj + r); j++) for (let i = Math.max(0, gi - r); i <= Math.min(s.gw - 1, gi + r); i++) {
      const g = s.grid[j * s.gw + i];
      for (let q = 0; q < g.length; q++) { const k = g[q], dx = s.xy[k * 2] - x, dz = s.xy[k * 2 + 1] - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = k; } }
    }
    if (best >= 0 && Math.sqrt(bd) < r * s.gcell) break;
  }
  return best;
}

/** Points along the parcel borders (Voronoi edges of the seeds), only well inside fields. */
function parcelPoints(V: Votes, seeds: Seeds, pts: PointSet, edgeSeed: Uint8Array, W: number, H: number) {
  const sd = new Delaunator(seeds.xy);
  const T = sd.triangles, HE = sd.halfedges, xy = seeds.xy;
  const nf = T.length / 3;
  const ccx = new Float64Array(nf), ccz = new Float64Array(nf);
  for (let f = 0; f < nf; f++) {
    const a = T[f * 3], b = T[f * 3 + 1], c = T[f * 3 + 2];
    const ax = xy[a * 2], az = xy[a * 2 + 1], bx = xy[b * 2], bz = xy[b * 2 + 1], cx = xy[c * 2], cz = xy[c * 2 + 1];
    const d = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));
    const a2 = ax * ax + az * az, b2 = bx * bx + bz * bz, c2 = cx * cx + cz * cz;
    ccx[f] = (a2 * (bz - cz) + b2 * (cz - az) + c2 * (az - bz)) / d;
    ccz[f] = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  }
  const sc = new Float32Array(NC);
  const step = 1.3, { cw, ch, cs } = V;
  for (let e = 0; e < T.length; e++) {
    const o = HE[e];
    if (o < e) continue;
    const f1 = Math.floor(e / 3), f2 = Math.floor(o / 3);
    const x0 = ccx[f1], z0 = ccz[f1], x1 = ccx[f2], z1 = ccz[f2];
    const len = Math.sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0));
    if (!(len > 0.2) || len > 40) continue;
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n, z = z0 + ((z1 - z0) * k) / n;
      if (x < 1 || z < 1 || x > W - 1 || z > H - 1) continue;
      sc.fill(0);
      if (vote(V, x, z, sc) !== LC.CROP) continue;
      let second = 0;
      for (let q = 0; q < NC; q++) if (q !== LC.CROP && sc[q] > second) second = sc[q];
      if (sc[LC.CROP] - second < 0.35) continue;
      if (pts.tryAdd(x, z, 1.1, K_PARCEL) >= 0) edgeSeed[Math.min(ch - 1, Math.floor(z / cs)) * cw + Math.min(cw - 1, Math.floor(x / cs))] = 1;
    }
  }
}

/** Chamfer distance (in cells) to the nearest outline cell. */
function outlineDistance(edgeSeed: Uint8Array, cw: number, ch: number): Float32Array {
  const N = cw * ch, dist = new Float32Array(N);
  for (let p = 0; p < N; p++) dist[p] = edgeSeed[p] ? 0 : 1e9;
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const p = j * cw + i; let d = dist[p];
    if (i > 0) d = Math.min(d, dist[p - 1] + 1);
    if (j > 0) { d = Math.min(d, dist[p - cw] + 1); if (i > 0) d = Math.min(d, dist[p - cw - 1] + 1.414); if (i + 1 < cw) d = Math.min(d, dist[p - cw + 1] + 1.414); }
    dist[p] = d;
  }
  for (let j = ch - 1; j >= 0; j--) for (let i = cw - 1; i >= 0; i--) {
    const p = j * cw + i; let d = dist[p];
    if (i + 1 < cw) d = Math.min(d, dist[p + 1] + 1);
    if (j + 1 < ch) { d = Math.min(d, dist[p + cw] + 1); if (i + 1 < cw) d = Math.min(d, dist[p + cw + 1] + 1.414); if (i > 0) d = Math.min(d, dist[p + cw - 1] + 1.414); }
    dist[p] = d;
  }
  return dist;
}

/** Wanted point spacing from slope and curvature of the real heightmap (per height vertex). */
function reliefSpacing(t: Terrain, B: number): Float32Array {
  const gw1 = t.gw + 1, gh1 = t.gh + 1, hm = t.heightsM, k = EXAG / 100;
  const out = new Float32Array(gw1 * gh1);
  for (let j = 0; j < gh1; j++) for (let i = 0; i < gw1; i++) {
    const im = Math.max(0, i - 1), ip = Math.min(gw1 - 1, i + 1), jm = Math.max(0, j - 1), jp = Math.min(gh1 - 1, j + 1);
    const c = hm[j * gw1 + i];
    const gx = (hm[j * gw1 + ip] - hm[j * gw1 + im]) / (ip - im), gz = (hm[jp * gw1 + i] - hm[jm * gw1 + i]) / (jp - jm);
    const slope = Math.sqrt(gx * gx + gz * gz) * k;
    const curv = Math.abs(hm[j * gw1 + ip] + hm[j * gw1 + im] + hm[jp * gw1 + i] + hm[jm * gw1 + i] - 4 * c) * k;
    out[j * gw1 + i] = B / (1 + 0.9 * slope + 3 * curv);
  }
  return out;
}

function fillPoints(t: Terrain, V: Votes, pts: PointSet, dist: Float32Array, relief: Float32Array, W: number, H: number) {
  const { A, cw, ch, cs } = V;
  const gw1 = t.gw + 1, gh1 = t.gh + 1;
  const fs = 0.8;
  const nx = Math.floor(W / fs), nz = Math.floor(H / fs);
  const order = new Uint32Array(nx * nz);
  for (let k = 0; k < order.length; k++) order[k] = k;
  shuffle(order, 4242);
  for (let q = 0; q < order.length; q++) {
    const k = order[q], i = k % nx, j = (k - i) / nx;
    const x = (i + 0.15 + 0.7 * hash2(i * 3 + 1, j * 5 + 2)) * fs, z = (j + 0.15 + 0.7 * hash2(i * 7 + 3, j * 11 + 4)) * fs;
    if (x < 0.5 || z < 0.5 || x > W - 0.5 || z > H - 0.5) continue;
    const p = Math.min(ch - 1, Math.floor(z / cs)) * cw + Math.min(cw - 1, Math.floor(x / cs));
    const water = A[p] === LC.WATER;
    const rel = relief[Math.min(gh1 - 1, Math.round(z)) * gw1 + Math.min(gw1 - 1, Math.round(x))];
    let s = Math.min(Math.max(1.3, rel), 0.95 + 0.5 * dist[p] * cs);
    if (water) s = Math.min(s, 1.0);
    pts.tryAdd(x, z, 0.82 * s, water ? K_WATER_IN : K_FILL);
  }
}

export interface TinOptions { base?: number }

export function buildTin(t: Terrain, opt: TinOptions = {}): Tin {
  const t0 = performance.now();
  const W = t.W, H = t.H;
  const B = opt.base ?? 2.4; // spacing on flat open ground (world units)
  const V = smoothVotes(t);
  const { cw, ch } = V;
  const pts = new PointSet(W, H, 1);

  // map border: straight edges, no jitter
  const bstep = 1.4, nbx = Math.round(W / bstep), nbz = Math.round(H / bstep);
  for (let k = 0; k <= nbx; k++) { pts.add((k / nbx) * W, 0, K_BORDER); pts.add((k / nbx) * W, H, K_BORDER); }
  for (let k = 1; k < nbz; k++) { pts.add(0, (k / nbz) * H, K_BORDER); pts.add(W, (k / nbz) * H, K_BORDER); }

  const edgeSeed = new Uint8Array(cw * ch);
  outlinePoints(V, pts, edgeSeed, W, H);
  const seeds = parcelSeeds(W, H);
  parcelPoints(V, seeds, pts, edgeSeed, W, H);
  const dist = outlineDistance(edgeSeed, cw, ch);
  fillPoints(t, V, pts, dist, reliefSpacing(t, B), W, H);

  // ---- triangulate ----
  const np = pts.x.length;
  const xy = new Float64Array(np * 2);
  for (let i = 0; i < np; i++) { xy[i * 2] = pts.x[i]; xy[i * 2 + 1] = pts.z[i]; }
  const dl = new Delaunator(xy);
  const X = new Float32Array(np), Z = new Float32Array(np), Y = new Float32Array(np);
  const WDEPTH = 0.16;
  for (let i = 0; i < np; i++) {
    X[i] = pts.x[i]; Z[i] = pts.z[i];
    Y[i] = (heightM(t, X[i], Z[i]) / 100) * EXAG - (pts.kind[i] === K_WATER_IN ? WDEPTH : 0);
  }
  const T0 = dl.triangles, HE = dl.halfedges, nf0 = T0.length / 3;
  const remap = new Int32Array(nf0).fill(-1);
  const tri = new Uint32Array(T0.length);
  let nt = 0;
  for (let f = 0; f < nf0; f++) {
    let a = T0[f * 3], b = T0[f * 3 + 1], c = T0[f * 3 + 2];
    // counter-clockwise seen from +y (x right, z towards the viewer's bottom) ⇔ cross.y > 0
    const cr = (Z[b] - Z[a]) * (X[c] - X[a]) - (X[b] - X[a]) * (Z[c] - Z[a]);
    if (Math.abs(cr) < 1e-7) continue;
    if (cr < 0) { const s = b; b = c; c = s; }
    tri[nt * 3] = a; tri[nt * 3 + 1] = b; tri[nt * 3 + 2] = c;
    remap[f] = nt++;
  }

  // ---- classify faces by the smoothed vote, then drop single-face islands ----
  const cls = new Uint8Array(nt);
  {
    const acc = new Float32Array(NC);
    const kind = pts.kind;
    for (let f = 0; f < nt; f++) {
      const a = tri[f * 3], b = tri[f * 3 + 1], c = tri[f * 3 + 2];
      const gx = (X[a] + X[b] + X[c]) / 3, gz = (Z[a] + Z[b] + Z[c]) / 3;
      acc.fill(0);
      let k = vote(V, gx, gz, acc);
      // faces touching an outline: three more samples so the outline decides cleanly
      if (kind[a] < K_WATER_IN || kind[b] < K_WATER_IN || kind[c] < K_WATER_IN) {
        vote(V, (gx * 2 + X[a]) / 3, (gz * 2 + Z[a]) / 3, acc);
        vote(V, (gx * 2 + X[b]) / 3, (gz * 2 + Z[b]) / 3, acc);
        k = vote(V, (gx * 2 + X[c]) / 3, (gz * 2 + Z[c]) / 3, acc);
      }
      // a sliver between two banks whose middle is mostly water stays water so the river never breaks
      if (k !== LC.WATER && acc[LC.WATER] > acc[k] * 0.75 && (kind[a] === K_WATER_EDGE || kind[a] === K_WATER_IN) && (kind[b] === K_WATER_EDGE || kind[b] === K_WATER_IN) && (kind[c] === K_WATER_EDGE || kind[c] === K_WATER_IN)) k = LC.WATER;
      cls[f] = k;
    }
    const nb = new Int32Array(3), cnt = new Uint8Array(NC);
    for (let pass = 0; pass < 2; pass++) {
      for (let f0 = 0; f0 < nf0; f0++) {
        const f = remap[f0];
        if (f < 0) continue;
        let n = 0, same = 0;
        for (let e = 0; e < 3; e++) {
          const o = HE[f0 * 3 + e];
          if (o < 0) continue;
          const g = remap[Math.floor(o / 3)];
          if (g < 0) continue;
          nb[n++] = cls[g];
          if (cls[g] === cls[f]) same++;
        }
        if (same > 0 || n < 2) continue;
        cnt.fill(0);
        let best = nb[0];
        for (let q = 0; q < n; q++) if (++cnt[nb[q]] > cnt[best]) best = nb[q];
        if (cls[f] === LC.WATER && best !== LC.WATER && n === 2) continue;
        cls[f] = best;
      }
    }
  }

  // ---- colour + normals ----
  const rgb = new Float32Array(nt * 3), nrm = new Float32Array(nt * 3);
  const col: RGB = [0, 0, 0];
  const hb = blurredHeights(t, 3), gw1 = t.gw + 1;
  for (let f = 0; f < nt; f++) {
    const a = tri[f * 3], b = tri[f * 3 + 1], c = tri[f * 3 + 2];
    const ux = X[b] - X[a], uy = Y[b] - Y[a], uz = Z[b] - Z[a], vx = X[c] - X[a], vy = Y[c] - Y[a], vz = Z[c] - Z[a];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    nrm[f * 3] = nx; nrm[f * 3 + 1] = ny; nrm[f * 3 + 2] = nz;
    const gx = (X[a] + X[b] + X[c]) / 3, gz = (Z[a] + Z[b] + Z[c]) / 3;
    const hM = ((Y[a] + Y[b] + Y[c]) / 3 / EXAG) * 100;
    faceColour(col, cls[f], gx, gz, hM, ny, seeds);
    // ridges a touch lighter, gullies and valleys darker: reads as relief even from straight above
    const bi = Math.min(t.gw - 1, Math.floor(gx)), bj = Math.min(t.gh - 1, Math.floor(gz)), bu = gx - bi, bv = gz - bj;
    const hAvg = (hb[bj * gw1 + bi] * (1 - bu) + hb[bj * gw1 + bi + 1] * bu) * (1 - bv) + (hb[(bj + 1) * gw1 + bi] * (1 - bu) + hb[(bj + 1) * gw1 + bi + 1] * bu) * bv;
    const conv = cls[f] === LC.WATER ? 0 : Math.max(-0.13, Math.min(0.07, (hM - hAvg) * 0.0055));
    const j = (1 + conv) * (1 + (hash2(f * 7 + 3, Math.floor(gx * 13)) - 0.5) * 0.075);
    rgb[f * 3] = Math.min(1, col[0] * j); rgb[f * 3 + 1] = Math.min(1, col[1] * j); rgb[f * 3 + 2] = Math.min(1, col[2] * j);
  }

  // ---- border lists for the skirt ----
  const border: [number[], number[], number[], number[]] = [[], [], [], []];
  for (let i = 0; i < np; i++) {
    if (pts.kind[i] !== K_BORDER) continue;
    if (Z[i] === 0) border[0].push(i);
    if (X[i] === W) border[1].push(i);
    if (Z[i] === H) border[2].push(i);
    if (X[i] === 0) border[3].push(i);
  }
  border[0].sort((p, q) => X[p] - X[q]); border[2].sort((p, q) => X[p] - X[q]);
  border[1].sort((p, q) => Z[p] - Z[q]); border[3].sort((p, q) => Z[p] - Z[q]);

  const triOut = tri.slice(0, nt * 3);
  const grid = faceGrid(triOut, nt, X, Z, W, H);
  return { W, H, np, x: X, z: Z, y: Y, nt, tri: triOut, cls, rgb, nrm, border, ...grid, ms: performance.now() - t0 };
}

/** Box-blurred heightmap (metres), radius r cells, same grid as heightsM. */
function blurredHeights(t: Terrain, r: number): Float32Array {
  const w = t.gw + 1, h = t.gh + 1, src = t.heightsM;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let s = 0, n = 0;
    for (let d = -r; d <= r; d++) { const ii = i + d; if (ii >= 0 && ii < w) { s += src[j * w + ii]; n++; } }
    tmp[j * w + i] = s / n;
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let s = 0, n = 0;
    for (let d = -r; d <= r; d++) { const jj = j + d; if (jj >= 0 && jj < h) { s += tmp[jj * w + i]; n++; } }
    out[j * w + i] = s / n;
  }
  return out;
}

function faceGrid(tri: Uint32Array, nt: number, X: Float32Array, Z: Float32Array, W: number, H: number) {
  const gs = 1, gw = Math.ceil(W / gs), gh = Math.ceil(H / gs);
  const cellStart = new Uint32Array(gw * gh + 1);
  const bb = new Int32Array(nt * 4);
  for (let f = 0; f < nt; f++) {
    const a = tri[f * 3], b = tri[f * 3 + 1], c = tri[f * 3 + 2];
    const i0 = Math.max(0, Math.floor(Math.min(X[a], X[b], X[c]) / gs)), i1 = Math.min(gw - 1, Math.floor(Math.max(X[a], X[b], X[c]) / gs));
    const j0 = Math.max(0, Math.floor(Math.min(Z[a], Z[b], Z[c]) / gs)), j1 = Math.min(gh - 1, Math.floor(Math.max(Z[a], Z[b], Z[c]) / gs));
    bb[f * 4] = i0; bb[f * 4 + 1] = i1; bb[f * 4 + 2] = j0; bb[f * 4 + 3] = j1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cellStart[j * gw + i + 1]++;
  }
  for (let k = 0; k < gw * gh; k++) cellStart[k + 1] += cellStart[k];
  const fill = cellStart.slice(0, gw * gh);
  const cellTri = new Uint32Array(cellStart[gw * gh]);
  for (let f = 0; f < nt; f++) {
    for (let j = bb[f * 4 + 2]; j <= bb[f * 4 + 3]; j++) for (let i = bb[f * 4]; i <= bb[f * 4 + 1]; i++) cellTri[fill[j * gw + i]++] = f;
  }
  return { gs, gw, gh, cellStart, cellTri };
}

// ---- colour ----------------------------------------------------------------------------------------------------
function setMix(o: RGB, a: RGB, b: RGB, k: number) {
  o[0] = a[0] + (b[0] - a[0]) * k; o[1] = a[1] + (b[1] - a[1]) * k; o[2] = a[2] + (b[2] - a[2]) * k;
}
const pickN = (arr: RGB[], v: number) => arr[Math.max(0, Math.min(arr.length - 1, Math.floor(v * arr.length)))];

function faceColour(o: RGB, k: number, x: number, z: number, hM: number, ny: number, seeds: Seeds) {
  const hi = Math.max(0, Math.min(1, (hM - 330) / 420)); // 0 in the plain, 1 high in the Black Mountains
  switch (k) {
    case LC.TREE: {
      const n1 = vnoise(x * 0.11, z * 0.11) * 0.6 + vnoise(x * 0.045 + 9, z * 0.045 + 3) * 0.4;
      setMix(o, pickN(PAL.tree, n1), pickN(PAL.treeHigh, n1), hi);
      break;
    }
    case LC.CROP: {
      const s = nearestSeed(seeds, x, z);
      setMix(o, PAL.crop[s >= 0 ? seeds.tone[s] : 0], PAL.cropBase, 0.12); // one family of tones, not confetti
      setMix(o, o, PAL.meadow, hi * 0.6);
      break;
    }
    case LC.GRASS: setMix(o, pickN(PAL.grass, vnoise(x * 0.035 + 50, z * 0.035 + 20)), PAL.meadow, hi * 0.5); break;
    case LC.BUILT: setMix(o, pickN(PAL.built, vnoise(x * 0.11, z * 0.11)), PAL.built[0], 0); break;
    case LC.BARE: setMix(o, pickN(PAL.bare, vnoise(x * 0.2, z * 0.2)), PAL.bare[0], 0); break;
    case LC.WATER: setMix(o, pickN(PAL.water, hash2(Math.floor(x * 7), Math.floor(z * 7))), PAL.water[0], 0); break;
    default: setMix(o, pickN(PAL.wet, vnoise(x * 0.2, z * 0.2)), PAL.wet[0], 0);
  }
  // steep open faces turn rocky
  if (k !== LC.TREE && k !== LC.WATER && ny < 0.8) setMix(o, o, PAL.rock, Math.min(0.45, (0.8 - ny) * 1.6));
}

// ---- queries -------------------------------------------------------------------------------------------------------
let lastFace = 0;

function minBary(tin: Tin, f: number, x: number, z: number): number {
  const T = tin.tri, X = tin.x, Z = tin.z;
  const a = T[f * 3], b = T[f * 3 + 1], c = T[f * 3 + 2];
  const d = (Z[b] - Z[c]) * (X[a] - X[c]) + (X[c] - X[b]) * (Z[a] - Z[c]);
  const l1 = ((Z[b] - Z[c]) * (x - X[c]) + (X[c] - X[b]) * (z - Z[c])) / d;
  const l2 = ((Z[c] - Z[a]) * (x - X[c]) + (X[a] - X[c]) * (z - Z[c])) / d;
  return Math.min(l1, l2, 1 - l1 - l2);
}

/** Face index under (x, z), or -1 outside the map. */
export function tinFace(tin: Tin, x: number, z: number): number {
  if (lastFace < tin.nt && minBary(tin, lastFace, x, z) >= -1e-6) return lastFace;
  const i = Math.floor(x / tin.gs), j = Math.floor(z / tin.gs);
  if (i < 0 || j < 0 || i >= tin.gw || j >= tin.gh) return -1;
  const c = j * tin.gw + i;
  let best = -1, bm = -1e9;
  for (let k = tin.cellStart[c]; k < tin.cellStart[c + 1]; k++) {
    const f = tin.cellTri[k];
    const m = minBary(tin, f, x, z);
    if (m >= -1e-6) { lastFace = f; return f; }
    if (m > bm) { bm = m; best = f; }
  }
  return best;
}

/** Exact height of the rendered surface (world units), clamped to the map. */
export function tinHeight(tin: Tin, x: number, z: number): number {
  x = Math.max(0, Math.min(tin.W - 1e-4, x));
  z = Math.max(0, Math.min(tin.H - 1e-4, z));
  const f = tinFace(tin, x, z);
  if (f < 0) return 0;
  const T = tin.tri, X = tin.x, Z = tin.z, Y = tin.y;
  const a = T[f * 3], b = T[f * 3 + 1], c = T[f * 3 + 2];
  const d = (Z[b] - Z[c]) * (X[a] - X[c]) + (X[c] - X[b]) * (Z[a] - Z[c]);
  const l1 = ((Z[b] - Z[c]) * (x - X[c]) + (X[c] - X[b]) * (z - Z[c])) / d;
  const l2 = ((Z[c] - Z[a]) * (x - X[c]) + (X[a] - X[c]) * (z - Z[c])) / d;
  return l1 * Y[a] + l2 * Y[b] + (1 - l1 - l2) * Y[c];
}

/** Land-cover class of the face under (x, z), -1 outside. */
export function tinClass(tin: Tin, x: number, z: number): number {
  const f = tinFace(tin, x, z);
  return f < 0 ? -1 : tin.cls[f];
}

// ---- 2D map (minimap base) ---------------------------------------------------------------------------------------
const SUN = (() => { const v = [-0.45, 0.7, 0.4]; const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); return v.map(c => c / l); })();

/** Shaded sRGB colour of a face as seen from above (same sun as the 3D scene). */
export function faceShade(tin: Tin, f: number, out: RGB = [0, 0, 0]): RGB {
  const nx = tin.nrm[f * 3], ny = tin.nrm[f * 3 + 1], nz = tin.nrm[f * 3 + 2];
  const lam = Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]);
  const s = 0.7 + 0.42 * lam;
  out[0] = tin.rgb[f * 3] * s; out[1] = tin.rgb[f * 3 + 1] * s; out[2] = tin.rgb[f * 3 + 2] * s;
  return out;
}

/** Face index per sample of a (w·ss)×(h·ss) grid of sample centres, by rasterising every face once. */
export function rasterFaces(tin: Tin, w: number, h: number, ss = 2): Int32Array {
  const SW = w * ss, SH = h * ss, buf = new Int32Array(SW * SH).fill(-1);
  const kx = SW / tin.W, kz = SH / tin.H, T = tin.tri, X = tin.x, Z = tin.z;
  for (let f = 0; f < tin.nt; f++) {
    const a = T[f * 3], b = T[f * 3 + 1], c = T[f * 3 + 2];
    const ax = X[a] * kx - 0.5, az = Z[a] * kz - 0.5, bx = X[b] * kx - 0.5, bz = Z[b] * kz - 0.5, cx = X[c] * kx - 0.5, cz = Z[c] * kz - 0.5;
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), i1 = Math.min(SW - 1, Math.floor(Math.max(ax, bx, cx)));
    const j0 = Math.max(0, Math.ceil(Math.min(az, bz, cz))), j1 = Math.min(SH - 1, Math.floor(Math.max(az, bz, cz)));
    if (i0 > i1 || j0 > j1) continue;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (!d) continue;
    const e = -1e-9 * Math.abs(d);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const l1 = (bz - cz) * (i - cx) + (cx - bx) * (j - cz), l2 = (cz - az) * (i - cx) + (ax - cx) * (j - cz);
      // same sign as d for all three barycentrics → inside
      if (d > 0 ? l1 >= e && l2 >= e && d - l1 - l2 >= e : l1 <= -e && l2 <= -e && d - l1 - l2 <= -e) buf[j * SW + i] = f;
    }
  }
  // any sample a float tie left uncovered: ask the grid
  for (let j = 0; j < SH; j++) for (let i = 0; i < SW; i++) if (buf[j * SW + i] < 0) buf[j * SW + i] = tinFace(tin, (i + 0.5) / kx, (j + 0.5) / kz);
  return buf;
}

/** Paint the TIN into a 2D context: 2×2 samples per pixel, crisp and seamless (minimap base). */
export function paintTin(tin: Tin, g: CanvasRenderingContext2D, w: number, h: number) {
  const img = g.createImageData(w, h);
  const d = img.data;
  const shade = new Float32Array(tin.nt * 3);
  const c: RGB = [0, 0, 0];
  for (let f = 0; f < tin.nt; f++) { faceShade(tin, f, c); shade[f * 3] = c[0]; shade[f * 3 + 1] = c[1]; shade[f * 3 + 2] = c[2]; }
  const buf = rasterFaces(tin, w, h, 2), SW = w * 2;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    let r = 0, gg = 0, b = 0;
    for (let s = 0; s < 4; s++) {
      const f = buf[(py * 2 + (s >> 1)) * SW + px * 2 + (s & 1)];
      if (f < 0) continue;
      r += shade[f * 3]; gg += shade[f * 3 + 1]; b += shade[f * 3 + 2];
    }
    const i = (py * w + px) * 4;
    d[i] = Math.min(255, r * 63.75); d[i + 1] = Math.min(255, gg * 63.75); d[i + 2] = Math.min(255, b * 63.75); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
