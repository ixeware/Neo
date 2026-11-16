// Low-poly terrain meshes from the TIN (see lowpoly.ts): faceted land with one colour per face,
// a glinting river channel, and the dark diorama skirt around the edges.
import * as THREE from 'three';
import { LC, type Terrain } from '../world/terrain';
import type { Tin } from './lowpoly';

export { hash2 } from './lowpoly';

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Non-indexed geometry of the faces that pass `keep`: flat normals, per-face colour (linear). */
function faceGeometry(tin: Tin, keep: (cls: number) => boolean, lift = 0): THREE.BufferGeometry {
  let n = 0;
  for (let f = 0; f < tin.nt; f++) if (keep(tin.cls[f])) n++;
  const pos = new Float32Array(n * 9), nor = new Float32Array(n * 9), col = new Float32Array(n * 9);
  const T = tin.tri, X = tin.x, Y = tin.y, Z = tin.z;
  let o = 0;
  for (let f = 0; f < tin.nt; f++) {
    if (!keep(tin.cls[f])) continue;
    const r = lin(tin.rgb[f * 3]), g = lin(tin.rgb[f * 3 + 1]), b = lin(tin.rgb[f * 3 + 2]);
    for (let k = 0; k < 3; k++) {
      const v = T[f * 3 + k];
      pos[o] = X[v]; pos[o + 1] = Y[v] + lift; pos[o + 2] = Z[v];
      nor[o] = tin.nrm[f * 3]; nor[o + 1] = tin.nrm[f * 3 + 1]; nor[o + 2] = tin.nrm[f * 3 + 2];
      col[o] = r; col[o + 1] = g; col[o + 2] = b;
      o += 3;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

export function terrainMesh(t: Terrain, tin: Tin): THREE.Group {
  const group = new THREE.Group();
  const land = new THREE.Mesh(faceGeometry(tin, c => c !== LC.WATER), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  land.receiveShadow = true;
  land.name = 'terrain';
  group.add(land);

  // skirt: the map sits on a table like a printed relief model
  const skirtMat = new THREE.MeshLambertMaterial({ color: '#3b3128', side: THREE.DoubleSide });
  const base = -2.2;
  for (const side of tin.border) {
    const n = side.length;
    const sp = new Float32Array(n * 6);
    for (let k = 0; k < n; k++) {
      const v = side[k];
      sp.set([tin.x[v], tin.y[v], tin.z[v], tin.x[v], base, tin.z[v]], k * 6);
    }
    const si: number[] = [];
    for (let k = 0; k < n - 1; k++) { const a = k * 2; si.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setIndex(si);
    sg.computeVertexNormals();
    group.add(new THREE.Mesh(sg, skirtMat));
  }
  return group;
}

/** The Argun and ponds: the water faces of the same TIN, faceted and shiny. */
export function waterMesh(t: Terrain, tin: Tin): THREE.Mesh {
  const m = new THREE.Mesh(
    faceGeometry(tin, c => c === LC.WATER),
    new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, specular: '#9fcfdf', shininess: 55 }),
  );
  m.receiveShadow = true;
  m.name = 'water';
  return m;
}
