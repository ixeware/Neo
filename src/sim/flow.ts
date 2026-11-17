// Integer Dijkstra flow fields over the nav grid. Deterministic on every client.
import { NAV, type Terrain } from '../world/terrain';

export interface Flow { dist: Int32Array; dx: Int8Array; dz: Int8Array }

const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NZ = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * Flow field towards the disc (gx, gz, gr). v4 map: the grid also covers the band north of the old map
 * edge (z0 ≤ z < 0, Grozny). A goal south of that edge is reached without entering the band: a cell
 * with z ≥ 0 never routes through it, so south of z = 0 every field is exactly the pre-v4 one and no
 * unit wanders into the city unless its goal is there. Cells in the band still lead out to the goal.
 */
export function buildFlow(t: Terrain, gx: number, gz: number, gr: number): Flow {
  const { nw, nh, navCost } = t;
  const nr = -t.z0 / NAV; // first nav row with z >= 0
  const fence = nr > 0 && gz >= 0;
  const N = nw * nh;
  const dist = new Int32Array(N).fill(0x3fffffff);
  // binary heap of (dist, idx)
  let hd = new Int32Array(1024), hi = new Int32Array(1024), hn = 0;
  const push = (d: number, i: number) => {
    if (hn >= hd.length) {
      const nd = new Int32Array(hd.length * 2); nd.set(hd); hd = nd;
      const ni = new Int32Array(hi.length * 2); ni.set(hi); hi = ni;
    }
    let k = hn++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hd[p] < d || (hd[p] === d && hi[p] < i)) break;
      hd[k] = hd[p]; hi[k] = hi[p]; k = p;
    }
    hd[k] = d; hi[k] = i;
  };
  const pop = () => {
    const d = hd[0], i = hi[0];
    const ld = hd[--hn], li = hi[hn];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= hn) break;
      if (c + 1 < hn && (hd[c + 1] < hd[c] || (hd[c + 1] === hd[c] && hi[c + 1] < hi[c]))) c++;
      if (ld < hd[c] || (ld === hd[c] && li < hi[c])) break;
      hd[k] = hd[c]; hi[k] = hi[c]; k = c;
    }
    hd[k] = ld; hi[k] = li;
    return [d, i];
  };
  const r2 = gr * gr, z0 = t.z0;
  for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
    const cx = (i + 0.5) * NAV - gx, cz = (j + 0.5) * NAV + z0 - gz;
    if (cx * cx + cz * cz <= r2) {
      const idx = j * nw + i;
      dist[idx] = 0; push(0, idx);
    }
  }
  while (hn > 0) {
    const [d, idx] = pop();
    if (d > dist[idx]) continue;
    const i = idx % nw, j = (idx - i) / nw;
    const c0 = navCost[idx] || 60;
    for (let k = 0; k < 8; k++) {
      const ni = i + NX[k], nj = j + NZ[k];
      if (ni < 0 || nj < 0 || ni >= nw || nj >= nh) continue;
      if (fence && j < nr && nj >= nr) continue; // a southern cell's path stays south
      const n = nj * nw + ni;
      const c1 = navCost[n];
      if (c1 === 0) continue;
      let step = c0 + c1;
      if (k >= 4) {
        // no corner cutting through blocked cells
        if (navCost[j * nw + ni] === 0 || navCost[nj * nw + i] === 0) continue;
        step = Math.floor((step * 14142) / 10000);
      }
      const nd = d + step;
      if (nd < dist[n]) { dist[n] = nd; push(nd, n); }
    }
  }
  const dx = new Int8Array(N), dz = new Int8Array(N);
  for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
    const idx = j * nw + i;
    let best = dist[idx], bk = -1;
    for (let k = 0; k < 8; k++) {
      const ni = i + NX[k], nj = j + NZ[k];
      if (ni < 0 || nj < 0 || ni >= nw || nj >= nh) continue;
      if (fence && j >= nr && nj < nr) continue;
      const n = nj * nw + ni;
      if (navCost[n] === 0) continue;
      if (k >= 4 && (navCost[j * nw + ni] === 0 || navCost[nj * nw + i] === 0)) continue;
      if (dist[n] < best) { best = dist[n]; bk = k; }
    }
    if (bk >= 0) { dx[idx] = NX[bk]; dz[idx] = NZ[bk]; }
  }
  return { dist, dx, dz };
}

const D = 0.7071067811865476;
/** Smoothed flow direction at a world position. Returns false if no direction. */
export function flowDir(t: Terrain, f: Flow, x: number, z: number, out: { x: number; z: number }): boolean {
  // world-frame floats as before v4, then a whole-row offset (bit-identical south of z = 0)
  const fx = x / NAV - 0.5, fz = z / NAV - 0.5;
  const i0 = Math.floor(fx), j0 = Math.floor(fz);
  const tx = fx - i0, tz = fz - j0, jz = -t.z0 / NAV;
  let vx = 0, vz = 0;
  for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
    const i = i0 + a, j = j0 + b + jz;
    if (i < 0 || j < 0 || i >= t.nw || j >= t.nh) continue;
    const idx = j * t.nw + i;
    if (t.navCost[idx] === 0) continue;
    const w = (a ? tx : 1 - tx) * (b ? tz : 1 - tz);
    let ex = f.dx[idx], ez = f.dz[idx];
    if (ex !== 0 && ez !== 0) { ex *= D; ez *= D; }
    vx += ex * w; vz += ez * w;
  }
  const l2 = vx * vx + vz * vz;
  if (l2 < 1e-6) return false;
  const l = Math.sqrt(l2);
  out.x = vx / l; out.z = vz / l;
  return true;
}
