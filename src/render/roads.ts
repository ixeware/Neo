// Real roads, streets, rails and small rivers from OpenStreetMap (src/data/roads.ts, baked by
// tools/bake_roads.py), draped on the low-poly map as flat ribbons: one mesh (one draw call) per class.
// Render-only: the sim never sees any of this. world.ts uses roadNet()/roadClearance() to line the
// village houses up along the streets and to keep houses and trees off the ribbons.
import * as THREE from 'three';
import { ROADS_META, ROADS_B64, HOUSES_B64 } from '../data/roads';
import { LC, BRIDGES, heightY, lcAt, type Terrain } from '../world/terrain';
import { tinClass, type Tin } from './lowpoly';

/** Road classes, in the order tools/bake_roads.py writes them. */
export const RC = { MAIN: 0, ROAD: 1, STREET: 2, TRACK: 3, RAIL: 4, RIVER: 5, STREAM: 6 } as const;
/** Ribbon half-widths per class (world units; 1 unit = 100 m, so a highway reads at chibi scale). */
export const ROAD_HALF = [0.175, 0.14, 0.1, 0.075, 0.08, 0.15, 0.065];
const LIFT = [0.045, 0.045, 0.04, 0.035, 0.045, 0.03, 0.03];
/**
 * Colours (sRGB). The scene light is warm (sun #ffe2b0, sky #fff4e0), so the asphalt greys lean a little
 * blue to come out neutral on the sand-coloured village faces; tracks are dirt, streams the TIN's water.
 */
const COLOR = ['#ffffff', '#ffffff', '#7b7f87', '#a98e68', '#ffffff', '#4aa9c2', '#55b0c6'];
const ASPHALT = '#5a5d64', ASPHALT_EDGE = '#9a9a9a', DASH = '#efe9d8';

export interface RoadLine {
  c: number; x: Float32Array; z: Float32Array;
  /** Set on the links from a game bridge (BRIDGES index): the line starts on that deck. */
  deck?: number;
}
export interface RealHouse { x: number; z: number; ry: number; w: number; d: number }
export interface RoadNet {
  lines: RoadLine[];
  /** OSM house footprints (Старые Атаги, Курчалой): centre, rotation.y of the long side, size. */
  houses: RealHouse[];
  /** Segment soup + uniform 1-unit grid (CSR) for clearance queries. */
  sx0: Float32Array; sz0: Float32Array; sx1: Float32Array; sz1: Float32Array; sc: Uint8Array;
  gw: number; gh: number; cellStart: Uint32Array; cellSeg: Uint32Array;
}

/** A keep-clear disc (HQ, mosques, decor) or, with `hx`/`hz`/`ry`, an oriented rectangle. `cls`: classes it cuts (default all). */
export interface KeepOut { x: number; z: number; r: number; hx?: number; hz?: number; ry?: number; cls?: number[] }

let net: RoadNet | null = null;
/** The crop the bake clips to (Terrain W × H). */
const ROADS_W = 398, ROADS_H = 272;

function b64(s: string): Uint8Array {
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The decoded network (cached; decoding takes a few ms). */
export function roadNet(): RoadNet {
  if (net) return net;
  const q = ROADS_META.q, buf = b64(ROADS_B64);
  let p = 0;
  const vi = () => { let v = 0, s = 0, b = 0; do { b = buf[p++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return v; };
  const zz = () => { const v = vi(); return v % 2 ? -(v + 1) / 2 : v / 2; };
  const lines: RoadLine[] = [];
  let nseg = 0;
  while (p < buf.length) {
    const c = buf[p++], n = vi();
    const x = new Float32Array(n), z = new Float32Array(n);
    let qx = vi(), qz = vi();
    x[0] = qx / q; z[0] = qz / q;
    for (let i = 1; i < n; i++) { qx += zz(); qz += zz(); x[i] = qx / q; z[i] = qz / q; }
    lines.push({ c, x, z });
    nseg += n - 1;
  }
  const hb = b64(HOUSES_B64), houses: RealHouse[] = [];
  for (let i = 0; i + 7 <= hb.length; i += 7) {
    houses.push({
      x: (hb[i] | (hb[i + 1] << 8)) / q, z: (hb[i + 2] | (hb[i + 3] << 8)) / q,
      ry: (hb[i + 4] / 255) * Math.PI, w: hb[i + 5] / 100, d: hb[i + 6] / 100,
    });
  }
  lines.push(...bridgeLinks(lines));
  for (const l of lines) if (l.deck !== undefined) nseg += l.x.length - 1;
  // segment soup + grid
  const sx0 = new Float32Array(nseg), sz0 = new Float32Array(nseg), sx1 = new Float32Array(nseg), sz1 = new Float32Array(nseg);
  const sc = new Uint8Array(nseg);
  let k = 0;
  for (const l of lines) {
    for (let i = 0; i + 1 < l.x.length; i++, k++) { sx0[k] = l.x[i]; sz0[k] = l.z[i]; sx1[k] = l.x[i + 1]; sz1[k] = l.z[i + 1]; sc[k] = l.c; }
  }
  const gw = Math.ceil(ROADS_W), gh = Math.ceil(ROADS_H), pad = 0.45;
  // one pass over the segments collects (cell, segment) pairs, a counting sort turns them into CSR
  let pc = new Int32Array(nseg * 6), ps = new Int32Array(nseg * 6), np = 0;
  const cellStart = new Uint32Array(gw * gh + 1);
  for (let s = 0; s < nseg; s++) {
    const ax = sx0[s], az = sz0[s], bx = sx1[s], bz = sz1[s];
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - pad)), i1 = Math.min(gw - 1, Math.floor(Math.max(ax, bx) + pad));
    const j0 = Math.max(0, Math.floor(Math.min(az, bz) - pad)), j1 = Math.min(gh - 1, Math.floor(Math.max(az, bz) + pad));
    const small = i1 - i0 <= 1 && j1 - j0 <= 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      // only cells the (padded) segment really passes
      if (!small && segDist(i + 0.5, j + 0.5, ax, az, bx, bz) >= 0.71 + pad) continue;
      if (np === pc.length) { const a = new Int32Array(np * 2); a.set(pc); pc = a; const b = new Int32Array(np * 2); b.set(ps); ps = b; }
      const c = j * gw + i;
      pc[np] = c; ps[np++] = s; cellStart[c + 1]++;
    }
  }
  for (let c = 0; c < gw * gh; c++) cellStart[c + 1] += cellStart[c];
  const fill = cellStart.slice(0, gw * gh), cellSeg = new Uint32Array(np);
  for (let e = 0; e < np; e++) cellSeg[fill[pc[e]]++] = ps[e];
  net = { lines, houses, sx0, sz0, sx1, sz1, sc, gw, gh, cellStart, cellSeg };
  return net;
}

/**
 * The three game bridges (BRIDGES) are not where OSM has its Argun bridges, so each deck end gets a
 * link to the closest road, street or (failing those) track ahead of it, up to 12 units away.
 */
function bridgeLinks(lines: RoadLine[]): RoadLine[] {
  const out: RoadLine[] = [];
  BRIDGES.forEach((b, bi) => {
    const dx = b.x1 - b.x0, dz = b.z1 - b.z0, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    for (const [ex, ez, sg] of [[b.x0, b.z0, -1], [b.x1, b.z1, 1]] as const) {
      const ox = ux * sg, oz = uz * sg; // outwards from the deck
      let best = Infinity, bx = 0, bz = 0, bc: number = RC.ROAD;
      for (const l of lines) {
        if (l.c > RC.TRACK) continue;
        for (let i = 0; i + 1 < l.x.length; i++) {
          const x0 = l.x[i], z0 = l.z[i], sx = l.x[i + 1] - x0, sz = l.z[i + 1] - z0, sl = sx * sx + sz * sz;
          const f = sl > 0 ? Math.max(0, Math.min(1, ((ex - x0) * sx + (ez - z0) * sz) / sl)) : 0;
          const px = x0 + sx * f, pz = z0 + sz * f, d = Math.hypot(px - ex, pz - ez);
          if (d > 12 || d < 1e-3) continue;
          const cos = ((px - ex) * ox + (pz - ez) * oz) / d;
          if (cos < 0.15) continue; // behind the end: that is the river
          const score = d * (1.6 - cos * 0.6) * (l.c === RC.TRACK ? 2 : 1);
          if (score < best) { best = score; bx = px; bz = pz; bc = l.c === RC.TRACK ? RC.TRACK : RC.ROAD; }
        }
      }
      if (best === Infinity) continue;
      out.push({
        c: bc, deck: bi,
        x: new Float32Array([ex - ox * 0.4, ex + ox * 0.5, bx]), z: new Float32Array([ez - oz * 0.4, ez + oz * 0.5, bz]),
      });
    }
  });
  return out;
}

export function segDist(px: number, pz: number, x0: number, z0: number, x1: number, z1: number) {
  const dx = x1 - x0, dz = z1 - z0, L = dx * dx + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / L)) : 0;
  const qx = x0 + dx * t - px, qz = z0 + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

/** Land classes (roads + rail) and all classes, as bit masks for roadClearance. */
export const LAND_MASK = 0b11111, ALL_MASK = 0b1111111;

/**
 * Distance from (x, z) to the nearest ribbon edge of the classes in `mask` (negative: on the ribbon).
 * Sees the segments passing within about 0.45 units of the point's 1-unit cell; returns `far` when
 * there are none (so `< far` also means "a road is within about half a unit or so").
 * With `out`, also the nearest segment index (-1 when none).
 */
export function roadClearance(x: number, z: number, mask = LAND_MASK, far = 9, out?: { seg: number }): number {
  const n = roadNet();
  const i = Math.floor(x), j = Math.floor(z);
  if (out) out.seg = -1;
  if (i < 0 || j < 0 || i >= n.gw || j >= n.gh) return far;
  const c = j * n.gw + i;
  let best = far;
  const X0 = n.sx0, Z0 = n.sz0, X1 = n.sx1, Z1 = n.sz1;
  for (let k = n.cellStart[c]; k < n.cellStart[c + 1]; k++) {
    const s = n.cellSeg[k], cls = n.sc[s];
    if (!((mask >> cls) & 1)) continue;
    const hw = ROAD_HALF[cls], lim = best + hw;
    const x0 = X0[s], z0 = Z0[s], dx = X1[s] - x0, dz = Z1[s] - z0, L = dx * dx + dz * dz;
    let t = L > 0 ? ((x - x0) * dx + (z - z0) * dz) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = x0 + dx * t - x, qz = z0 + dz * t - z, d2 = qx * qx + qz * qz;
    if (d2 < lim * lim) { best = Math.sqrt(d2) - hw; if (out) out.seg = s; }
  }
  return best;
}

// ---- ribbons ---------------------------------------------------------------------------------------------
interface Acc { pos: number[]; col: number[]; uv: number[]; idx: number[] }
const acc = (): Acc => ({ pos: [], col: [], uv: [], idx: [] });

function inKeep(keep: KeepOut[], c: number, x: number, z: number): boolean {
  for (const k of keep) {
    if (k.cls && k.cls.indexOf(c) < 0) continue;
    const dx = x - k.x, dz = z - k.z;
    if (k.hx !== undefined) {
      const R = k.hx + (k.hz ?? k.hx);
      if (dx * dx + dz * dz > R * R) continue;
      const cs = Math.cos(k.ry ?? 0), sn = Math.sin(k.ry ?? 0);
      // world → local for rotation.y: local x = dx·cos − dz·sin, local z = dx·sin + dz·cos
      const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
      if (Math.abs(lx) < k.hx && Math.abs(lz) < (k.hz ?? k.hx)) return true;
    } else if (dx * dx + dz * dz < k.r * k.r) return true;
  }
  return false;
}

/** Scratch for one polyline's dense samples (boot-time only). */
let SX = new Float64Array(4096), SZ = new Float64Array(4096), SH = new Float64Array(4096), SS = new Float64Array(4096);
let SF = new Uint8Array(4096); // 1 keep, 2 water, 4 cut (inside a keep-out)
function grow(n: number) {
  if (n <= SX.length) return;
  const m = Math.max(n, SX.length * 2);
  const g = (a: Float64Array) => { const b = new Float64Array(m); b.set(a); return b; };
  SX = g(SX); SZ = g(SZ); SH = g(SH); SS = g(SS);
  const f = new Uint8Array(m); f.set(SF); SF = f;
}

interface Ctx { t: Terrain; tin?: Tin; W: number; H: number; step: number; tolH: number; keep: KeepOut[] }

function isWater(cx: Ctx, x: number, z: number) {
  return cx.tin ? tinClass(cx.tin, x, z) === LC.WATER : lcAt(cx.t, x, z) === LC.WATER;
}

/**
 * Drape one polyline: dense samples (≤ step), keep-out and water flags, then a 1D Douglas–Peucker on
 * the height profile so flat stretches stay one long quad. Calls `emit` for each continuous run.
 */
function drapeLine(cx: Ctx, l: RoadLine, start: { y: number } | null, emit: (n: number, idx: Int32Array) => void) {
  const c = l.c, water = c === RC.RIVER || c === RC.STREAM;
  // dense samples
  let n = 0;
  const N = l.x.length;
  let s = 0;
  for (let i = 0; i < N; i++) {
    const x0 = l.x[i], z0 = l.z[i];
    if (i > 0) {
      const px = l.x[i - 1], pz = l.z[i - 1], L = Math.hypot(x0 - px, z0 - pz), k = Math.max(1, Math.ceil(L / cx.step));
      for (let q = 1; q < k; q++) {
        grow(n + 1);
        SX[n] = px + ((x0 - px) * q) / k; SZ[n] = pz + ((z0 - pz) * q) / k; SS[n] = s + (L * q) / k; SF[n] = 0; n++;
      }
      s += L;
    }
    grow(n + 1);
    SX[n] = x0; SZ[n] = z0; SS[n] = s; SF[n] = 1; n++;
  }
  // only the keep-outs near this line's box are worth testing
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < N; i++) { x0 = Math.min(x0, l.x[i]); x1 = Math.max(x1, l.x[i]); z0 = Math.min(z0, l.z[i]); z1 = Math.max(z1, l.z[i]); }
  const keep = cx.keep.filter(k => {
    const R = k.hx !== undefined ? k.hx + (k.hz ?? k.hx) : k.r;
    return k.x + R > x0 && k.x - R < x1 && k.z + R > z0 && k.z - R < z1 && (!k.cls || k.cls.indexOf(c) >= 0);
  });
  for (let i = 0; i < n; i++) {
    SH[i] = heightY(cx.t, SX[i], SZ[i]);
    if (isWater(cx, SX[i], SZ[i])) SF[i] |= 2;
    if (keep.length && inKeep(keep, c, SX[i], SZ[i])) SF[i] |= 4;
  }
  if (water) {
    for (let i = 0; i < n; i++) if (SF[i] & 2) SF[i] |= 4; // the TIN already draws this water
  } else {
    // land roads cross the TIN water on a flat deck between the banks
    for (let i = 0; i < n; i++) {
      if (!(SF[i] & 2)) continue;
      let j = i;
      while (j + 1 < n && SF[j + 1] & 2) j++;
      const a = i - 1, b = j + 1;
      const ha = a >= 0 ? SH[a] : SH[b < n ? b : j], hb = b < n ? SH[b] : ha;
      const sa = a >= 0 ? SS[a] : SS[i], sb = b < n ? SS[b] : SS[j];
      for (let k = i; k <= j; k++) {
        const f = sb > sa ? (SS[k] - sa) / (sb - sa) : 0;
        SH[k] = Math.max(SH[k], ha + (hb - ha) * f) + 0.06;
        SF[k] |= 1;
      }
      if (a >= 0) SF[a] |= 1;
      if (b < n) SF[b] |= 1;
      i = j;
    }
  }
  if (start) { SH[0] = start.y; SF[1 < n ? 1 : 0] |= 1; }
  // runs outside the keep-outs
  let i = 0;
  const idx = new Int32Array(n);
  while (i < n) {
    while (i < n && SF[i] & 4) i++;
    let j = i;
    while (j + 1 < n && !(SF[j + 1] & 4)) j++;
    if (j > i) {
      // 1D Douglas–Peucker on (s, h) inside [i, j]
      SF[i] |= 1; SF[j] |= 1;
      const stack = [i, j];
      while (stack.length) {
        const b = stack.pop()!, a = stack.pop()!;
        let worst = -1, wd = cx.tolH;
        for (let k = a + 1; k < b; k++) {
          const f = (SS[k] - SS[a]) / (SS[b] - SS[a] || 1);
          const d = Math.abs(SH[k] - (SH[a] + (SH[b] - SH[a]) * f));
          if (d > wd) { wd = d; worst = k; }
        }
        if (worst >= 0) { SF[worst] |= 1; stack.push(a, worst, worst, b); }
      }
      let m = 0;
      for (let k = i; k <= j; k++) if (SF[k] & 1) idx[m++] = k;
      // a polyline vertex on a straight run with flat ground adds nothing: drop it
      let w = 0;
      for (let k = 0; k < m; k++) {
        if (k > 0 && k < m - 1) {
          const a = idx[w - 1], b = idx[k], d = idx[k + 1];
          const ux = SX[b] - SX[a], uz = SZ[b] - SZ[a], vx = SX[d] - SX[b], vz = SZ[d] - SZ[b];
          const cr = Math.abs(ux * vz - uz * vx) / (Math.hypot(ux, uz) * Math.hypot(vx, vz) || 1);
          const f = (SS[b] - SS[a]) / (SS[d] - SS[a] || 1);
          if (cr < 0.02 && Math.abs(SH[b] - (SH[a] + (SH[d] - SH[a]) * f)) < cx.tolH * 0.5) continue;
        }
        idx[w++] = idx[k];
      }
      if (w >= 2) emit(w, idx);
    }
    i = j + 1;
  }
}

function ribbon(cx: Ctx, a: Acc, l: RoadLine, rgb: THREE.Color, uMode: 'len' | 'gap' | 'none', period: number, start: { y: number } | null) {
  const hw = ROAD_HALF[l.c], lift = LIFT[l.c];
  const land = l.c !== RC.RIVER && l.c !== RC.STREAM;
  drapeLine(cx, l, start, (n, idx) => {
    const base = a.pos.length / 3;
    for (let k = 0; k < n; k++) {
      const p = idx[k];
      const kp = idx[Math.max(0, k - 1)], kn = idx[Math.min(n - 1, k + 1)];
      // miter normal
      let dx0 = SX[p] - SX[kp], dz0 = SZ[p] - SZ[kp], dx1 = SX[kn] - SX[p], dz1 = SZ[kn] - SZ[p];
      const l0 = Math.hypot(dx0, dz0), l1 = Math.hypot(dx1, dz1);
      if (l0 > 1e-6) { dx0 /= l0; dz0 /= l0; } else { dx0 = dx1 / (l1 || 1); dz0 = dz1 / (l1 || 1); }
      if (l1 > 1e-6) { dx1 /= l1; dz1 /= l1; } else { dx1 = dx0; dz1 = dz0; }
      let tx = dx0 + dx1, tz = dz0 + dz1;
      const tl = Math.hypot(tx, tz);
      if (tl < 1e-4) { tx = dx1; tz = dz1; } else { tx /= tl; tz /= tl; }
      const cosHalf = Math.max(0.5, tx * dx1 + tz * dz1);
      const nx = -tz * (hw / cosHalf), nz = tx * (hw / cosHalf);
      let x = SX[p], z = SZ[p];
      // land ribbons run on a little past their ends so junctions and corners close up
      if (land && (k === 0 || k === n - 1)) {
        const ex = k === 0 ? -dx1 : dx0, ez = k === 0 ? -dz1 : dz0;
        const ext = l.c <= RC.ROAD ? hw * 0.6 : hw;
        const ox = x + ex * ext, oz = z + ez * ext;
        if (ox > 0.05 && oz > 0.05 && ox < cx.W - 0.05 && oz < cx.H - 0.05 && !(start && k === 0)) { x = ox; z = oz; }
      }
      const lx = Math.max(0, Math.min(cx.W, x + nx)), lz = Math.max(0, Math.min(cx.H, z + nz));
      const rx = Math.max(0, Math.min(cx.W, x - nx)), rz = Math.max(0, Math.min(cx.H, z - nz));
      let yl: number, yr: number;
      const deck = (SF[p] & 2) && land;
      if (deck || (start && p === 0)) { yl = yr = SH[p]; }
      else {
        const hc = x === SX[p] && z === SZ[p] ? SH[p] : heightY(cx.t, x, z);
        yl = heightY(cx.t, lx, lz); yr = heightY(cx.t, rx, rz);
        const bulge = Math.max(0, Math.max(hc, SH[p]) - (yl + yr) / 2);
        yl += bulge; yr += bulge;
      }
      a.pos.push(lx, yl + lift, lz, rx, yr + lift, rz);
      a.col.push(rgb.r, rgb.g, rgb.b, rgb.r, rgb.g, rgb.b);
      const u = uMode === 'len' ? SS[p] / period : uMode === 'gap' ? 0.75 : 0;
      a.uv.push(u, 0, u, 1);
      if (k > 0) {
        const A0 = base + (k - 1) * 2, B0 = A0 + 1, A1 = A0 + 2, B1 = A0 + 3;
        a.idx.push(A0, A1, B0, B0, A1, B1);
      }
    }
  });
}

function lineLength(l: RoadLine) {
  let s = 0;
  for (let i = 0; i + 1 < l.x.length; i++) s += Math.hypot(l.x[i + 1] - l.x[i], l.z[i + 1] - l.z[i]);
  return s;
}

function toMesh(a: Acc, mat: THREE.Material, name: string): THREE.Mesh | null {
  if (!a.idx.length) return null;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(a.pos), nor = new Float32Array(a.pos.length);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(a.col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(a.idx, 1) : new THREE.Uint16BufferAttribute(a.idx, 1));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  m.receiveShadow = true;
  return m;
}

function stripeTexture(kind: 'main' | 'rail'): THREE.CanvasTexture {
  // u (canvas x) runs along the road, v (canvas y) across it
  const c = document.createElement('canvas');
  c.width = 64; c.height = 16;
  const g = c.getContext('2d')!;
  if (kind === 'main') {
    g.fillStyle = ASPHALT; g.fillRect(0, 0, 64, 16);
    g.fillStyle = ASPHALT_EDGE; g.fillRect(0, 1, 64, 1); g.fillRect(0, 14, 64, 1);
    g.fillStyle = DASH; g.fillRect(0, 7, 34, 2); // dash then gap (u 0.75 is always in the gap)
  } else {
    g.fillStyle = '#9b9182'; g.fillRect(0, 0, 64, 16);
    g.fillStyle = '#5e4b3b';
    for (let x = 0; x < 64; x += 16) g.fillRect(x + 2, 2, 7, 12); // sleepers
    g.fillStyle = '#45464b'; g.fillRect(0, 4, 64, 2); g.fillRect(0, 10, 64, 2); // rails
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Vertex-coloured, flat-shaded like the TIN; a bigger polygon offset wins where classes overlap. */
function material(map: THREE.Texture | null, offset: number) {
  const m = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true, map, flatShading: true });
  m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -offset;
  return m;
}

/**
 * Roads, streets, tracks, rails and small rivers as draped ribbons. lowPower drops tracks and the
 * painted lines and drapes a little coarser. `keep` cuts the ribbons under buildings (HQs, mosques,
 * decor); `tin` lets roads bridge the drawn river exactly where its faces are.
 */
export function buildRoads(parent: THREE.Object3D, t: Terrain, opts: { lowPower: boolean; tin?: Tin; keep?: KeepOut[] }): { group: THREE.Group } {
  const t0 = performance.now();
  const n = roadNet();
  const low = opts.lowPower;
  const cx: Ctx = { t, tin: opts.tin, W: t.W, H: t.H, step: low ? 0.7 : 0.5, tolH: low ? 0.03 : 0.014, keep: opts.keep ?? [] };
  const group = new THREE.Group();
  group.name = 'roads';
  const A = { main: acc(), street: acc(), track: acc(), rail: acc(), water: acc() };
  const white = new THREE.Color(1, 1, 1);
  const lin = (hex: string) => new THREE.Color(hex);
  const asphalt = lin(ASPHALT);
  for (const l of n.lines) {
    if (l.deck !== undefined) { // a link from a game bridge's deck down to the street network
      const b = BRIDGES[l.deck];
      const y = Math.max(heightY(t, b.x0, b.z0), heightY(t, b.x1, b.z1)) + 0.12 + 0.07 - LIFT[l.c] + 0.005; // deck top (buildBridges)
      if (l.c === RC.ROAD) ribbon(cx, A.main, l, low ? asphalt : white, low ? 'none' : 'gap', 1, { y });
      else if (!low) ribbon(cx, A.track, l, lin(COLOR[3]), 'none', 1, { y });
      continue;
    }
    switch (l.c) {
      // short main-road pieces (junction stubs) get no centre line: crossing dashes only clutter
      case RC.MAIN: ribbon(cx, A.main, l, low ? asphalt : white, low ? 'none' : lineLength(l) < 1.5 ? 'gap' : 'len', 0.62, null); break;
      case RC.ROAD: ribbon(cx, A.main, l, low ? asphalt : white, low ? 'none' : 'gap', 1, null); break;
      case RC.STREET: ribbon(cx, A.street, l, lin(COLOR[2]), 'none', 1, null); break;
      case RC.TRACK: if (!low) ribbon(cx, A.track, l, lin(COLOR[3]), 'none', 1, null); break;
      case RC.RAIL: ribbon(cx, A.rail, l, low ? lin('#7d7366') : white, low ? 'none' : 'len', 0.25, null); break;
      default: ribbon(cx, A.water, l, lin(COLOR[l.c]), 'none', 1, null);
    }
  }
  const mainTex = low ? null : stripeTexture('main');
  const railTex = low ? null : stripeTexture('rail');
  const meshes = [
    toMesh(A.water, material(null, 2), 'roads-water'),
    toMesh(A.track, material(null, 2), 'roads-track'),
    toMesh(A.street, material(null, 4), 'roads-street'),
    toMesh(A.rail, material(railTex, 5), 'roads-rail'),
    toMesh(A.main, material(mainTex, 6), 'roads-main'),
  ];
  for (const m of meshes) if (m) group.add(m);
  parent.add(group);
  let tris = 0;
  for (const m of meshes) if (m) tris += (m.geometry.index!.count / 3);
  console.info(`roads: ${n.lines.length} lines, ${tris} triangles, ${(performance.now() - t0).toFixed(0)} ms`);
  return { group };
}

/** Main roads and village streets, thin, on the minimap base (map pixels: w × h for the whole crop). */
export function paintRoads(g: CanvasRenderingContext2D, w: number, h: number) {
  const n = roadNet(), kx = w / ROADS_W, kz = h / ROADS_H;
  const s = Math.max(0.6, Math.min(2, w / 260));
  const pass = (cls: number[], color: string, width: number) => {
    g.strokeStyle = color; g.lineWidth = width;
    g.beginPath();
    for (const l of n.lines) {
      if (cls.indexOf(l.c) < 0) continue;
      g.moveTo(l.x[0] * kx, l.z[0] * kz);
      for (let i = 1; i < l.x.length; i++) g.lineTo(l.x[i] * kx, l.z[i] * kz);
    }
    g.stroke();
  };
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  pass([RC.RIVER, RC.STREAM], 'rgba(62,150,190,.75)', 0.8 * s);
  pass([RC.STREET], 'rgba(96,90,82,.42)', 0.55 * s);
  pass([RC.ROAD], 'rgba(84,79,72,.7)', 0.9 * s);
  pass([RC.MAIN], 'rgba(74,69,63,.9)', 1.5 * s);
  g.restore();
}
