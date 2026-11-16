// Terrain mesh + painted map texture (real land cover, hill shading, contour lines).
import * as THREE from 'three';
import { LC, EXAG, heightM, type Terrain } from '../world/terrain';

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

// plain sRGB bytes (THREE.Color would hand back linear values)
const hex = (s: string) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const BASE: number[][] = [
  hex('#4c6b3c'), // tree
  hex('#9aa463'), // grass
  hex('#c4b47a'), // crop
  hex('#cdbfa2'), // built
  hex('#b5a78d'), // bare
  hex('#4f8db5'), // water
  hex('#71917a'), // wetland
];
const FIELDS = [hex('#cbbb82'), hex('#b2ad6c'), hex('#bea079'), hex('#d2c695'), hex('#a7ab6a'), hex('#c4ad7a'), hex('#bab577')];

export interface PaintedMap { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }

export function paintMap(t: Terrain): PaintedMap {
  const S = 3; // texels per land-cover cell (~17 m)
  const TW = t.lcw * S, TH = t.lch * S;
  const canvas = document.createElement('canvas');
  canvas.width = TW; canvas.height = TH;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(TW, TH);
  const d = img.data;
  const mPerTex = t.lcCell / S;
  const toWorld = mPerTex / 100;
  // height samples per texel (metres) for shading + contours
  const H = new Float32Array(TW * TH);
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) H[y * TW + x] = heightM(t, (x + 0.5) * toWorld, (y + 0.5) * toWorld);
  const sun = new THREE.Vector3(-0.55, 0.62, 0.55).normalize();
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      const i = y * TW + x;
      const wx = (x + (vnoise(x * 0.07, y * 0.07) - 0.5) * 2.4 * S) / S, wy = (y + (vnoise(x * 0.07 + 17, y * 0.07 + 5) - 0.5) * 2.4 * S) / S;
      const c = t.lc[Math.max(0, Math.min(t.lch - 1, Math.floor(wy))) * t.lcw + Math.max(0, Math.min(t.lcw - 1, Math.floor(wx)))];
      let col: number[];
      const n = vnoise(x * 0.09, y * 0.09) * 0.6 + vnoise(x * 0.4, y * 0.4) * 0.4;
      if (c === LC.CROP) {
        // fields: tilted parcels with furrows
        const bx = Math.floor((x + y * 0.18) / 33), by = Math.floor((y - x * 0.12) / 22);
        const f = FIELDS[Math.floor(hash2(bx, by) * FIELDS.length)];
        const dir = hash2(by, bx) > 0.5;
        const furrow = ((dir ? x : y) % 5) === 0 ? 0.95 : 1;
        col = [f[0] * furrow, f[1] * furrow, f[2] * furrow];
      } else if (c === LC.WATER) {
        const w = BASE[5];
        const e = vnoise(x * 0.3, y * 0.3);
        col = [w[0] + e * 25, w[1] + e * 25, w[2] + e * 18];
      } else {
        col = BASE[c].slice();
      }
      const k = 0.9 + n * 0.2;
      let r = col[0] * k, gg = col[1] * k, b = col[2] * k;
      // hill shading
      const hx = (H[y * TW + Math.min(TW - 1, x + 1)] - H[y * TW + Math.max(0, x - 1)]) / (2 * mPerTex) * EXAG;
      const hz = (H[Math.min(TH - 1, y + 1) * TW + x] - H[Math.max(0, y - 1) * TW + x]) / (2 * mPerTex) * EXAG;
      const nl = 1 / Math.sqrt(hx * hx + 1 + hz * hz);
      const lam = Math.max(0, (-hx * sun.x + sun.y - hz * sun.z) * nl);
      const shade = 0.86 + 0.22 * lam;
      r *= shade; gg *= shade; b *= shade;
      // contours every 50 m, bolder every 250 m
      if (c !== LC.WATER && x > 0 && y > 0) {
        const h0 = H[i], hl = H[i - 1], hu = H[i - TW];
        const c50 = Math.floor(h0 / 50) !== Math.floor(hl / 50) || Math.floor(h0 / 50) !== Math.floor(hu / 50);
        if (c50) {
          const big = Math.floor(h0 / 250) !== Math.floor(hl / 250) || Math.floor(h0 / 250) !== Math.floor(hu / 250);
          const m = big ? 0.72 : 0.86;
          r *= m; gg *= m; b *= m;
        }
      }
      d[i * 4] = Math.min(255, r); d[i * 4 + 1] = Math.min(255, gg); d[i * 4 + 2] = Math.min(255, b); d[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // soften the 50 m land-cover grid a touch
  g.filter = 'blur(0.8px)';
  g.drawImage(canvas, 0, 0);
  g.filter = 'none';
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { canvas, texture };
}

export function terrainMesh(t: Terrain, map: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  const W = t.gw + 1, Hh = t.gh + 1;
  const pos = new Float32Array(W * Hh * 3), uv = new Float32Array(W * Hh * 2);
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    pos[k * 3] = i; pos[k * 3 + 1] = (t.heightsM[k] / 100) * EXAG; pos[k * 3 + 2] = j;
    uv[k * 2] = i / t.gw; uv[k * 2 + 1] = 1 - j / t.gh;
  }
  const idx = new Uint32Array(t.gw * t.gh * 6);
  let p = 0;
  for (let j = 0; j < t.gh; j++) for (let i = 0; i < t.gw; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    idx[p++] = a; idx[p++] = c; idx[p++] = b;
    idx[p++] = b; idx[p++] = c; idx[p++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  map.flipY = true;
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  group.add(mesh);

  // skirt: the map sits on a table like a printed relief model
  const skirtMat = new THREE.MeshLambertMaterial({ color: '#3b3128' });
  const base = -2.2;
  const edge = (pts: [number, number][]) => {
    const n = pts.length;
    const sp = new Float32Array(n * 2 * 3);
    for (let k = 0; k < n; k++) {
      const [x, z] = pts[k];
      const h = (heightM(t, x, z) / 100) * EXAG;
      sp.set([x, h, z], k * 6); sp.set([x, base, z], k * 6 + 3);
    }
    const si: number[] = [];
    for (let k = 0; k < n - 1; k++) { const a = k * 2; si.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setIndex(si);
    sg.computeVertexNormals();
    const m = new THREE.Mesh(sg, skirtMat);
    m.material.side = THREE.DoubleSide;
    group.add(m);
  };
  const N: [number, number][] = [], Sx: [number, number][] = [], E: [number, number][] = [], Wx: [number, number][] = [];
  for (let i = 0; i <= t.gw; i++) { N.push([i, 0]); Sx.push([i, t.gh]); }
  for (let j = 0; j <= t.gh; j++) { Wx.push([0, j]); E.push([t.gw, j]); }
  edge(N); edge(Sx); edge(E); edge(Wx);
  return group;
}

/** Shiny water overlay built from water cells of the land-cover grid. */
export function waterMesh(t: Terrain): THREE.Mesh {
  const pos: number[] = [];
  const cw = t.lcCell / 100;
  for (let j = 0; j < t.lch; j++) for (let i = 0; i < t.lcw; i++) {
    if (t.lc[j * t.lcw + i] !== LC.WATER) continue;
    const x0 = i * cw, x1 = x0 + cw, z0 = j * cw, z1 = z0 + cw;
    const y = (x: number, z: number) => (heightM(t, x, z) / 100) * EXAG + 0.03;
    const a = [x0, y(x0, z0), z0], b = [x1, y(x1, z0), z0], c = [x0, y(x0, z1), z1], d = [x1, y(x1, z1), z1];
    pos.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshPhongMaterial({ color: '#5a9cc4', specular: '#ffffff', shininess: 70, transparent: true, opacity: 0.82 }));
  m.receiveShadow = true;
  return m;
}

export { hash2 };
