// Low-poly trees for the TIN map: clumps of chunky broadleaves in the plain and gullies,
// stacked-cone firs up in the Black Mountains. Placement is hashed, so every client sees the same forest.
import * as THREE from 'three';
import { LC, EXAG, heightY, type Terrain } from '../world/terrain';
import { Builder } from './models';
import { hash2, tinClass, type Tin } from './lowpoly';

export interface TreeSpot { x: number; z: number; y: number; ry: number; sx: number; sy: number; sz: number; c: THREE.Color }

const BROAD = ['#4b803b', '#5a8f45', '#3f7135', '#689a4b', '#52783a', '#7fa24f'].map(c => new THREE.Color(c));
const FIR = ['#2f5b3c', '#386645', '#2a5136', '#41704a'].map(c => new THREE.Color(c));
// trunk vertex colour is multiplied by the green instance colour, so it is pre-tinted to come out brown
const TRUNK = new THREE.Color(1.0, 0.42, 0.5);

export function treeGeometries() {
  const broad = new Builder()
    .add(new THREE.CylinderGeometry(0.06, 0.09, 0.5, 5, 1, true), TRUNK, [0, 0.25, 0])
    .add(new THREE.IcosahedronGeometry(0.5, 0), new THREE.Color('#ffffff'), [0, 0.86, 0], [0.3, 0.5, 0], [1, 0.86, 1])
    .build();
  const fir = new Builder()
    .add(new THREE.CylinderGeometry(0.05, 0.07, 0.35, 5, 1, true), TRUNK, [0, 0.17, 0])
    .add(new THREE.ConeGeometry(0.42, 0.78, 6, 1), new THREE.Color('#ffffff'), [0, 0.68, 0])
    .add(new THREE.ConeGeometry(0.3, 0.62, 6, 1, true), new THREE.Color('#ffffff'), [0, 1.08, 0], [0, 0.5, 0])
    .build();
  return { broad, fir };
}

/**
 * Tree positions on the TIN. Forest faces get clumps (2–5 trees), open meadows a lone tree now and then.
 * `skip(x, z)` lets the caller keep bridges and landmarks clear. lowPower plants about half.
 */
export function treeSpots(t: Terrain, tin: Tin, hq: boolean, skip: (x: number, z: number) => boolean) {
  const broad: TreeSpot[] = [], fir: TreeSpot[] = [];
  const dens = hq ? 1 : 0.5;
  const T = tin.tri, X = tin.x, Z = tin.z, Y = tin.y;
  for (let f = 0; f < tin.nt; f++) {
    const cls = tin.cls[f];
    const rate = cls === LC.TREE ? 0.05 : cls === LC.GRASS ? 0.0035 : cls === LC.WET ? 0.04 : cls === LC.BUILT ? 0.006 : 0;
    if (!rate) continue;
    const a = T[f * 3], b = T[f * 3 + 1], c = T[f * 3 + 2];
    const area = Math.abs((X[b] - X[a]) * (Z[c] - Z[a]) - (Z[b] - Z[a]) * (X[c] - X[a])) / 2;
    const want = area * rate * dens;
    const n = Math.floor(want + hash2(f, 77));
    for (let k = 0; k < n; k++) {
      const s = Math.sqrt(hash2(f * 5 + k, 11)), r2 = hash2(f * 3 + k, 23);
      const cx = (1 - s) * X[a] + s * (1 - r2) * X[b] + s * r2 * X[c];
      const cz = (1 - s) * Z[a] + s * (1 - r2) * Z[b] + s * r2 * Z[c];
      const hM = (((Y[a] + Y[b] + Y[c]) / 3) / EXAG) * 100;
      const forest = cls === LC.TREE;
      const size = forest ? 2 + Math.floor(hash2(f + k, 41) * 4) : 1 + Math.floor(hash2(f + k, 43) * 1.6);
      for (let q = 0; q < size; q++) {
        const ang = hash2(f * 13 + k, q + 5) * Math.PI * 2, rad = q === 0 ? 0 : 0.45 + hash2(f * 17 + k, q + 9) * 0.6;
        const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
        if (x < 0.6 || z < tin.z0 + 0.6 || x > tin.W - 0.6 || z > tin.H - 0.6) continue;
        if (tinClass(tin, x, z) !== cls || skip(x, z)) continue;
        const h = hash2(Math.floor(x * 31), Math.floor(z * 37));
        const isFir = forest && (hM > 560 || (hM > 380 && h < (hM - 380) / 220));
        const sc = (forest ? 0.85 : 0.72) + hash2(Math.floor(z * 29), Math.floor(x * 23)) * 0.5;
        const stretch = 0.9 + hash2(q + 3, f) * 0.3;
        const spot: TreeSpot = {
          x, z, y: heightY(t, x, z) - 0.05, ry: h * 6.283,
          sx: sc, sy: sc * stretch * (isFir ? 1.15 : 1), sz: sc * (0.88 + hash2(f, q + 1) * 0.24),
          c: isFir ? FIR[Math.floor(h * FIR.length)] : BROAD[Math.floor(hash2(f * 3 + q, 5) * BROAD.length)],
        };
        (isFir ? fir : broad).push(spot);
      }
    }
  }
  return { broad, fir };
}
