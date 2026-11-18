// Animated life of the toon map: chimney smoke, laundry and bunting waving, chickens in the yards, sheep on the
// meadows, ducks at the bridges, flocks of birds. Everything that moves in a map chunk is ONE mesh (one draw
// call) animated in the vertex shader: a vertex carries its model-space position, the world point it lives at
// and four animation numbers. Nothing is simulated and nothing is random at run time.
import * as THREE from 'three';
import { LC, EXAG, BRIDGES, heightY, type Terrain } from '../../../world/terrain';
import { hash2, tinClass, type Tin } from '../../lowpoly';
import { C, native } from '../../style';
import { GC } from './colors';
import { KitBuilder, G as GEO, type Kit } from './kits';
import type { HouseSpot, Plaza, ShoreEdge } from './paint';

const K_WALK = 0, K_CLOTH = 1, K_SMOKE = 2, K_BIRD = 3;
const CHUNK = 56;

interface Acc { pos: number[]; home: number[]; anim: number[]; col: number[]; idx: number[]; sx: number; sz: number; n: number }
interface LifeChunk { mesh: THREE.Mesh; x: number; z: number }
const chunks: LifeChunk[] = [];
let birds: THREE.Mesh | null = null;
const uTime = { value: 0 };

export interface LifeEnv {
  t: Terrain; tin: Tin; low: boolean;
  houses: (HouseSpot & { h: number })[]; plazas: Plaza[]; shore: ShoreEdge[];
  /** scatter's test: may a thing of radius r stand here (roads, water, houses, build zones, other things)? */
  free: (x: number, z: number, r: number) => boolean;
}

function lifeMaterial(): THREE.Material {
  const m = native(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  m.onBeforeCompile = sh => {
    sh.uniforms.gTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aHome;\nattribute vec4 aAnim;\nuniform float gTime;')
      .replace('#include <begin_vertex>', /* glsl */`
	vec3 transformed = position;
	{
		float ph = aAnim.y, t = gTime;
		if ( aAnim.x < 0.5 ) { // a walker: steps around its home in bursts, nose along the path (z = radius, w = speed)
			float th = ph + aAnim.w * ( t + 3.2 * sin( t * 0.31 + ph * 3.0 ) );
			float c = cos( th ), s = sin( th );
			float go = 1.0 + cos( t * 0.31 + ph * 3.0 ); // 0 while it stands
			if ( aAnim.w < 0.0 ) transformed.xz = - transformed.xz;
			transformed.y *= 1.0 + 0.1 * min( go, 1.0 ) * sin( t * 11.0 + ph * 5.0 );
			transformed = vec3( transformed.x * c - transformed.z * s, transformed.y, transformed.x * s + transformed.z * c ) + vec3( c, 0.0, s ) * aAnim.z;
		} else if ( aAnim.x < 1.5 ) { // cloth: z = how free the vertex is (0 on the line)
			float w = sin( t * 2.6 + ph + position.x * 5.0 + position.z * 5.0 );
			transformed += vec3( 0.07 * w, 0.03 * abs( w ), 0.07 * cos( t * 2.1 + ph ) ) * aAnim.z;
		} else if ( aAnim.x < 2.5 ) { // a smoke puff: rises z, grows, drifts east and is gone (w = speed)
			float f = fract( t * aAnim.w + ph );
			transformed = transformed * ( sin( f * 3.1416 ) * ( 0.55 + f ) ) + vec3( f * f * 0.5, f * aAnim.z, f * 0.12 );
		} else { // a bird on a wide circle (z = radius, w = angular speed), wings beating
			float th = ph + aAnim.w * t;
			float c = cos( th ), s = sin( th );
			transformed.y += abs( transformed.x ) * 0.7 * sin( t * 6.0 + ph * 40.0 );
			if ( aAnim.w < 0.0 ) transformed.xz = - transformed.xz;
			transformed = vec3( transformed.x * c - transformed.z * s, transformed.y, transformed.x * s + transformed.z * c ) + vec3( c, 0.0, s ) * aAnim.z;
		}
		transformed += aHome;
	}`);
  };
  m.customProgramCacheKey = () => 'toon-life';
  return m;
}

/** Append a kit to a chunk. `w` gives the per-vertex anim.z (cloth freedom) instead of `a2`. */
function add(a: Acc, kit: Kit, hx: number, hy: number, hz: number, kind: number, ph: number, a2: number, a3: number,
  o: { s?: number; ry?: number; c1?: THREE.Color; c2?: THREE.Color; w?: (y: number) => number } = {}) {
  const base = a.pos.length / 3, P = kit.pos, n = P.length / 3, s = o.s ?? 1, c = Math.cos(o.ry ?? 0), sn = Math.sin(o.ry ?? 0);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3] * s, y = P[i * 3 + 1] * s, z = P[i * 3 + 2] * s;
    a.pos.push(x * c + z * sn, y, -x * sn + z * c);
    a.home.push(hx, hy, hz);
    a.anim.push(kind, ph, o.w ? o.w(P[i * 3 + 1]) : a2, a3);
    const tc = kit.tint[i] === 1 ? o.c1 : kit.tint[i] === 2 ? o.c2 : undefined;
    a.col.push(Math.min(255, kit.col[i * 3] * (tc ? tc.r : 1) * 255), Math.min(255, kit.col[i * 3 + 1] * (tc ? tc.g : 1) * 255), Math.min(255, kit.col[i * 3 + 2] * (tc ? tc.b : 1) * 255));
  }
  for (let i = 0; i < kit.idx.length; i++) a.idx.push(base + kit.idx[i]);
  a.sx += hx; a.sz += hz; a.n++;
}

function toMesh(a: Acc, material: THREE.Material, y: number, r: number): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
  g.setAttribute('aHome', new THREE.Float32BufferAttribute(a.home, 3));
  g.setAttribute('aAnim', new THREE.Float32BufferAttribute(a.anim, 4));
  g.setAttribute('color', new THREE.BufferAttribute(Uint8Array.from(a.col), 3, true));
  g.setIndex(a.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(a.idx, 1) : new THREE.Uint16BufferAttribute(a.idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(a.sx / a.n, y, a.sz / a.n), r);
  const m = new THREE.Mesh(g, material);
  m.matrixAutoUpdate = false;
  m.receiveShadow = true;
  return m;
}

export function buildLife(parent: THREE.Object3D, env: LifeEnv) {
  const { t, tin, low, houses, plazas, free } = env;
  const H = hash2, hexes = (h: readonly string[]) => h.map(x => new THREE.Color(x));
  const CLOTH = hexes(GC.cloth), HEN = hexes(GC.chicken), AWN = hexes(GC.awning);
  const pick = <T>(arr: readonly T[], h: number): T => arr[Math.min(arr.length - 1, Math.floor(h * arr.length))];
  const K = (f: (b: KitBuilder) => void) => { const b = new KitBuilder(); f(b); return b.build(); };
  const white = new THREE.Color(GC.sheep), dark = new THREE.Color(GC.sheepHead), smoke = new THREE.Color('#e4e8f4');
  const kit = {
    // nose towards +z
    hen: K(b => {
      b.add(GEO.octa, 1, [0, 0.085, -0.01], [0.13, 0.13, 0.2]);
      b.add(GEO.octa, 1, [0, 0.17, 0.08], [0.08, 0.09, 0.08]);
      b.add(GEO.tetra, C.danger, [0, 0.225, 0.08], [0.06, 0.06, 0.06]);
      if (!low) b.add(GEO.tetra, C.gold, [0, 0.16, 0.135], [0.04, 0.04, 0.06]);
    }),
    sheep: K(b => {
      b.add(low ? GEO.octa : GEO.ico, white, [0, 0.17, 0], low ? [0.3, 0.26, 0.4] : [0.26, 0.22, 0.34], [0.3, 0, 0]);
      b.add(GEO.box, dark, [0, 0.19, 0.19], [0.1, 0.11, 0.12]);
      if (!low) b.box(dark, [0, 0.04, 0], [0.14, 0.08, 0.22]);
    }),
    duck: K(b => {
      b.add(GEO.octa, 1, [0, 0.04, 0], [0.13, 0.1, 0.22]);
      b.add(GEO.octa, 2, [0, 0.12, 0.08], [0.07, 0.08, 0.07]);
      b.add(GEO.tetra, C.gold, [0, 0.11, 0.13], [0.04, 0.03, 0.06]);
    }),
    puff: K(b => { b.add(low ? GEO.octa : GEO.ico, smoke, [0, 0, 0], [0.24, 0.2, 0.24], [0.3, 0.4, 0]); }),
    post: K(b => { b.add(GEO.cyl3, C.woodDark, [0, 0.17, 0], [0.05, 0.34, 0.05]); }),
    // a hanging cloth 0.1 wide: the top edge (y = 0) holds on the line
    cloth: K(b => { b.add(GEO.box, 1, [0, -0.08, 0], [0.1, 0.16, 0.012]); }),
    line: K(b => { b.add(GEO.box, C.ink, [0, 0, 0], [1, 0.03, 0.03]); }),
    // a pennant: a triangle hanging from the line
    pennant: K(b => { b.add(GEO.cone4, 1, [0, -0.07, 0], [0.11, -0.14, 0.02]); }),
    pole: K(b => { b.add(GEO.cyl3, C.trim, [0, 0.45, 0], [0.06, 0.9, 0.06]); b.add(GEO.octa, C.gold, [0, 0.94, 0], [0.1, 0.1, 0.1]); }),
    // a white dove: a small body and two swept wings (the beat lifts the tips)
    bird: K(b => {
      b.add(GEO.octa, C.white, [0, 0, 0], [0.07, 0.06, 0.22]);
      b.add(GEO.cone4, C.white, [-0.12, 0, -0.02], [0.1, 0.24, 0.012], [0, 0.35, Math.PI / 2]);
      b.add(GEO.cone4, C.white, [0.12, 0, -0.02], [0.1, 0.24, 0.012], [0, -0.35, -Math.PI / 2]);
    }),
  };
  const accs = new Map<number, Acc>();
  const acc = (x: number, z: number) => {
    const k = Math.floor(x / CHUNK) * 1000 + Math.floor((z - t.z0) / CHUNK);
    let a = accs.get(k);
    if (!a) accs.set(k, (a = { pos: [], home: [], anim: [], col: [], idx: [], sx: 0, sz: 0, n: 0 }));
    return a;
  };
  const dens = low ? 0.5 : 1;
  let nSmoke = 0, nLine = 0, nHen = 0, nSheep = 0, nDuck = 0;

  // ---- the villages: smoke from one chimney in six, a laundry line in one yard in eight, chickens --------------
  houses.forEach((h, i) => {
    const c = Math.cos(h.ry), s = Math.sin(h.ry);
    const at = (lx: number, lz: number) => [h.x + lx * c + lz * s, h.z - lx * s + lz * c] as const;
    const y = heightY(t, h.x, h.z), a = acc(h.x, h.z);
    const r1 = H(i, 1201), r2 = H(i, 1202), r3 = H(i, 1203);
    if (r1 < 0.13 * dens) { // smoke: the puffs follow each other up
      const [x, z] = at(h.w * 0.2, -h.d * 0.12), top = y + h.h * 1.5 + 0.02, np = 2;
      for (let k = 0; k < np; k++) add(a, kit.puff, x, top, z, K_SMOKE, r2 + k / np, 0.55 + r3 * 0.25, 0.16 + r3 * 0.06, { s: 0.8 + r2 * 0.4 });
      nSmoke++;
    }
    if (r2 < 0.125 * dens) { // laundry between two posts beside the house
      const [x, z] = at(h.w / 2 + 0.2, -h.d * 0.1);
      if (free(x, z, 0.1)) {
        const gy = heightY(t, x, z), L = 0.4;
        for (const e of [-1, 1]) add(a, kit.post, x + (e * L / 2) * s, gy, z + (e * L / 2) * c, K_CLOTH, 0, 0, 0);
        add(a, kit.line, x, gy + 0.32, z, K_CLOTH, 0, 0, 0, { s: L, ry: h.ry + Math.PI / 2 });
        const nc = low ? 2 : 3;
        for (let k = 0; k < nc; k++) {
          const f = ((k + 0.5) / nc - 0.5) * L * 0.86;
          add(a, kit.cloth, x + f * s, gy + 0.32, z + f * c, K_CLOTH, r3 * 6 + k, 0, 0, { ry: h.ry + Math.PI / 2, c1: pick(CLOTH, H(i, 1300 + k)), s: 0.9 + H(i, 1310 + k) * 0.5, w: yy => Math.min(1, -yy / 0.16) });
        }
        nLine++;
      }
    }
    if (r3 < 0.24 * dens) { // a hen or two in the yard, in front of the house
      const [x, z] = r2 > 0.5 ? at((r1 - 0.5) * h.w, -h.d / 2 - 0.26) : at(-h.w / 2 - 0.26, (r1 - 0.5) * h.d);
      const rad = 0.08 + r2 * 0.1;
      if (free(x, z, 0.1)) {
        const gy = heightY(t, x, z) + 0.01, nh = r1 > 0.6 && !low ? 2 : 1;
        for (let k = 0; k < nh; k++) add(a, kit.hen, x, gy, z, K_WALK, r1 * 6.28 + k * 2.6, rad * (1 + k * 0.5), (0.5 + r2 * 0.5) * (k ? -1 : 1), { c1: pick(HEN, H(i, 1400 + k)), s: 0.95 + r1 * 0.3 });
        nHen += nh;
      }
    }
  });

  // ---- bunting around the markets, the village flags, the capture places and the squares ------------------------
  plazas.forEach((p, pi) => {
    if (p.kind !== 'market' && p.kind !== 'flag' && p.kind !== 'place' && p.kind !== 'city' && p.kind !== 'stadium') return;
    const n = p.kind === 'city' ? 6 : 5, a0 = H(pi, 1501) * 6.28, rad = p.r - 0.3, a = acc(p.x, p.z);
    const pts: { x: number; z: number; y: number; ok: boolean }[] = [];
    for (let k = 0; k < n; k++) {
      const ang = a0 + (k / n) * Math.PI * 2, x = p.x + Math.sin(ang) * rad, z = p.z + Math.cos(ang) * rad;
      const ok = free(x, z, 0.12);
      pts.push({ x, z, y: heightY(t, x, z), ok });
      if (ok) add(a, kit.pole, x, pts[k].y, z, K_CLOTH, 0, 0, 0);
    }
    for (let k = 0; k < n; k++) {
      const A = pts[k], B = pts[(k + 1) % n];
      if (!A.ok || !B.ok || (low && k % 2)) continue;
      const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz), ry = Math.atan2(-dz, dx), m = Math.max(3, Math.round(L / 0.3));
      for (let q = 0; q < m; q++) {
        const f = (q + 0.5) / m, sag = 0.22 * 4 * f * (1 - f);
        add(a, kit.pennant, A.x + dx * f, A.y + (B.y - A.y) * f + 0.86 - sag, A.z + dz * f, K_CLOTH, pi + q * 0.9, 0, 0, { ry, c1: pick(AWN, H(pi * 7 + k, q)), s: 1.25, w: yy => Math.min(1, -yy / 0.14) });
      }
    }
  });

  // ---- sheep on the meadows (flocks), ducks on the water by the bridges ------------------------------------------
  const T = tin.tri, X = tin.x, Z = tin.z, Y = tin.y;
  for (let f = 0; f < tin.nt; f++) {
    if (tin.cls[f] !== LC.GRASS) continue;
    const i0 = T[f * 3], i1 = T[f * 3 + 1], i2 = T[f * 3 + 2];
    const area = Math.abs((X[i1] - X[i0]) * (Z[i2] - Z[i0]) - (Z[i1] - Z[i0]) * (X[i2] - X[i0])) / 2;
    const hM = (((Y[i0] + Y[i1] + Y[i2]) / 3) / EXAG) * 100;
    if (H(f, 1601) > area * (hM > 250 ? 0.012 : 0.006) * dens || tin.nrm[f * 3 + 1] < 0.9) continue;
    const cx = (X[i0] + X[i1] + X[i2]) / 3, cz = (Z[i0] + Z[i1] + Z[i2]) / 3, n = Math.round((6 + H(f, 1602) * 8) * (low ? 0.6 : 1));
    for (let k = 0; k < n; k++) {
      const ang = H(f, 1610 + k) * 6.28, rr = 0.25 + Math.sqrt(H(f, 1630 + k)) * 1.5, x = cx + Math.cos(ang) * rr, z = cz + Math.sin(ang) * rr;
      if (tinClass(tin, x, z) !== LC.GRASS || !free(x, z, 0.3)) continue;
      add(acc(x, z), kit.sheep, x, heightY(t, x, z), z, K_WALK, H(f, 1650 + k) * 6.28, 0.08 + H(f, 1670 + k) * 0.14, (0.07 + H(f, 1690 + k) * 0.08) * (k % 2 ? 1 : -1), { s: 0.85 + H(f, 1700 + k) * 0.35 });
      nSheep++;
    }
  }
  BRIDGES.forEach((b, bi) => {
    const dx = b.x1 - b.x0, dz = b.z1 - b.z0, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
    for (let k = 0; k < 7; k++) {
      const d = len * (0.2 + 0.6 * H(bi, 1801 + k)), off = (1.2 + H(bi, 1810 + k) * 2.2) * (k % 2 ? 1 : -1);
      const x = b.x0 + ux * d - uz * off, z = b.z0 + uz * d + ux * off;
      if (tinClass(tin, x, z) !== LC.WATER) continue;
      const drake = k % 3 === 0;
      add(acc(x, z), kit.duck, x, heightY(t, x, z) + 0.015, z, K_WALK, H(bi, 1820 + k) * 6.28, 0.25 + H(bi, 1830 + k) * 0.5, 0.12 * (k % 2 ? 1 : -1), { c1: drake ? white : HEN[1], c2: drake ? C.fir[0] : HEN[1], s: 1.1 });
      nDuck++;
    }
  });

  // ... and a few along the banks
  env.shore.forEach((e, i) => {
    if (H(i, 1901) > 0.05 * dens) return;
    const mx = (e.ax + e.bx) / 2, mz = (e.az + e.bz) / 2, dx = e.bx - e.ax, dz = e.bz - e.az, L = Math.hypot(dx, dz) || 1;
    for (const sd of [-1, 1]) {
      const cx = mx - (dz / L) * sd * 0.7, cz = mz + (dx / L) * sd * 0.7;
      if (tinClass(tin, cx, cz) !== LC.WATER || tinClass(tin, cx - (dz / L) * sd * 0.6, cz + (dx / L) * sd * 0.6) !== LC.WATER) continue;
      for (let k = 0; k < 3; k++) {
        const drake = k === 0;
        add(acc(cx, cz), kit.duck, cx, heightY(t, cx, cz) + 0.015, cz, K_WALK, H(i, 1910 + k) * 6.28 + k * 0.5, 0.2 + k * 0.12, 0.11 * (i % 2 ? 1 : -1), { c1: drake ? white : HEN[1], c2: drake ? C.fir[0] : HEN[1], s: 1.1 });
        nDuck++;
      }
      break;
    }
  });

  const material = lifeMaterial();
  for (const a of accs.values()) {
    if (!a.n) continue;
    const mesh = toMesh(a, material, 4, CHUNK * 0.75 + 4);
    mesh.name = 'ground-life';
    parent.add(mesh);
    chunks.push({ mesh, x: a.sx / a.n, z: a.sz / a.n });
  }

  // ---- three flocks of birds for the whole map: a V on a slow wide circle --------------------------------------
  const fl: Acc = { pos: [], home: [], anim: [], col: [], idx: [], sx: 0, sz: 0, n: 0 };
  const spots = [t.villages.find(v => v.key === 'atagi'), t.villages.find(v => v.key === 'kurchaloy'), t.villages.find(v => v.key === 'shali')];
  spots.forEach((v, k) => {
    if (!v) return;
    const R = 13 + k * 4, y = heightY(t, v.x, v.z) + 7 + k, w = (k % 2 ? -1 : 1) * 0.045, ph0 = k * 2.1;
    for (let j = -3; j <= 3; j++) add(fl, kit.bird, v.x, y - Math.abs(j) * 0.05, v.z, K_BIRD, ph0 - Math.abs(j) * 0.02 * Math.sign(w), R + j * 0.3, w, { s: 0.9 });
  });
  if (fl.n) {
    birds = toMesh(fl, material, 0, 1);
    birds.name = 'ground-birds';
    birds.frustumCulled = false;
    birds.receiveShadow = false;
    parent.add(birds);
  }
  console.info(`life: smoke ${nSmoke}, laundry ${nLine}, hens ${nHen}, sheep ${nSheep}, ducks ${nDuck} in ${chunks.length} chunks`);
}

/** Once a frame: the clock, and which chunks' life is drawn (it is under a few pixels beyond `far`). */
export function updateLife(cam: { x: number; y: number; z: number }, low: boolean) {
  uTime.value = (performance.now() / 1000) % 3600;
  const far = low ? 85 : 120;
  for (const c of chunks) {
    const vis = Math.hypot(c.x - cam.x, c.z - cam.z, cam.y) < far;
    if (c.mesh.visible !== vis) c.mesh.visible = vis;
  }
  if (birds) { const vis = cam.y < 150; if (birds.visible !== vis) birds.visible = vis; }
}
