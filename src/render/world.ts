// Villages, forests, landmarks and the two high-rises the whole war is about.
import * as THREE from 'three';
import { LC, BRIDGES, heightY, passable, lcAt, type Terrain } from '../world/terrain';
import { hash2 } from './terrainMesh';
import type { Tin } from './lowpoly';
import { treeGeometries, treeSpots } from './trees';
import { Builder, PAL, houseGeometries, facadeTexture } from './models';
import { tri, quad, archAt } from './props';
import { HQ } from '../sim/defs';
import type { Pt } from '../sim/sim';

const WALLS = ['#efe6d6', '#e5d3b3', '#d9c3a0', '#f2ede2', '#c99c78', '#e8dcc0', '#d8cbb6'].map(c => new THREE.Color(c));
const ROOFS = ['#4f7a4a', '#8b3a2f', '#3e5f8a', '#6b6f75', '#7a4a2c', '#a8452f', '#557e7a'].map(c => new THREE.Color(c));

interface Item { x: number; z: number; y: number; ry: number; sx: number; sy: number; sz: number; c: THREE.Color; c2?: THREE.Color }

function chunked(items: Item[], geos: THREE.BufferGeometry[], mats: THREE.Material[], useC2: boolean[], parent: THREE.Object3D, chunk = 50, shadows = true) {
  const buckets = new Map<number, Item[]>();
  for (const it of items) {
    const k = Math.floor(it.x / chunk) * 1000 + Math.floor(it.z / chunk);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(it);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (const list of buckets.values()) {
    geos.forEach((geo, gi) => {
      const im = new THREE.InstancedMesh(geo, mats[gi], list.length);
      list.forEach((it, i) => {
        e.set(0, it.ry, 0); q.setFromEuler(e);
        p.set(it.x, it.y, it.z); s.set(it.sx, it.sy, it.sz);
        m.compose(p, q, s);
        im.setMatrixAt(i, m);
        im.setColorAt(i, useC2[gi] ? it.c2! : it.c);
      });
      im.castShadow = shadows; im.receiveShadow = true;
      im.computeBoundingSphere();
      parent.add(im);
    });
  }
}

// ---- decor spots (Фудзи, качалка, такси, Донер Бей) -------------------------------------------
/** Where decor.ts puts a village building: centre, facing (rotation.y) and a keep-clear radius. */
export interface DecorSpot { key: 'fudzi' | 'gym' | 'taxi'; x: number; z: number; ry: number; r: number }
/** Донер Бей keeps houses and trees this far from pts[8] (its terrace reaches about 3.2). */
export const DONER_CLEAR = 3.6;
/** High-rise rotation, as HqBuilding.place sets it. */
const HQ_ROT = [0.35, -0.25];

let spotCache: { t: Terrain; spots: DecorSpot[] } | null = null;
/**
 * Village decor spots, a pure function of the terrain (so world.ts and decor.ts agree without
 * passing anything around): Фудзи and the gym in Курчалой, the taxi stand in Старые Атаги.
 * They sit on built-up, flat, passable ground, clear of the high-rise, its zone ring, the mosque,
 * the idle boss and the bridges, on the side the opening camera looks at.
 */
export function decorSpots(t: Terrain): DecorSpot[] {
  if (spotCache && spotCache.t === t) return spotCache.spots;
  const want: { key: DecorSpot['key']; village: string; r: number; side: 0 | 1; radii: number[]; prefer: number }[] = [
    { key: 'taxi', village: 'atagi', r: 1.5, side: 0, radii: [8.5, 9.5, 10.5, 11.5, 12.5], prefer: 0.6 },
    { key: 'fudzi', village: 'kurchaloy', r: 1.8, side: 1, radii: [9, 10, 11, 12, 17.5, 19, 20.5, 22], prefer: -0.4 },
    { key: 'gym', village: 'kurchaloy', r: 2.2, side: 1, radii: [9, 10, 11, 12, 17.5, 19, 20.5, 22], prefer: 0.5 },
  ];
  const spots: DecorSpot[] = [];
  for (const w of want) {
    const v = t.villages.find(q => q.key === w.village);
    if (!v) continue;
    const s = w.side, rot = HQ_ROT[s];
    const bossX = v.x + (s === 0 ? -4.6 : 5.6) * Math.cos(rot) + -3.4 * Math.sin(rot);
    const bossZ = v.z - (s === 0 ? -4.6 : 5.6) * Math.sin(rot) + -3.4 * Math.cos(rot);
    const keep = [
      { x: v.x, z: v.z, r: 6.5 }, // high-rise
      { x: v.x + (s === 0 ? -6 : 7), z: v.z + 4, r: 2.8 }, // mosque
      { x: bossX, z: bossZ, r: 2.6 }, // the boss waits here
      { x: v.x + (s === 0 ? 4 : -4), z: v.z + 1, r: 2.2 }, // boss spawn
      ...spots.map(o => ({ x: o.x, z: o.z, r: o.r + 4 })),
    ];
    let best: DecorSpot | null = null, bestScore = -Infinity;
    for (const R of w.radii) for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2; // 0 = south (+z), towards the opening camera
      const x = v.x + Math.sin(a) * R, z = v.z + Math.cos(a) * R;
      const r = w.r;
      if (Math.abs(R - 15) < r + 0.8) continue; // HQ zone ring
      if (keep.some(o => (o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + r) ** 2)) continue;
      if (BRIDGES.some(br => segDist(x, z, br.x0, br.z0, br.x1, br.z1) < r + 1.6)) continue;
      let lo = Infinity, hi = -Infinity, ok = true;
      for (const [ox, oz] of [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r], [0, r], [0, -r], [r, 0], [-r, 0]]) {
        const px = x + ox * 0.8, pz = z + oz * 0.8;
        if (!passable(t, px, pz) || lcAt(t, px, pz) === LC.WATER) { ok = false; break; }
        const h = heightY(t, px, pz);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      if (!ok || hi - lo > 0.45) continue;
      // built-up density around the spot (5×5 land-cover cells, about 2.5 units): stay in the village
      const ci = Math.floor((x * 100) / t.lcCell), cj = Math.floor((z * 100) / t.lcCell);
      let built = 0;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
        const bi = Math.max(0, Math.min(t.lcw - 1, ci + i)), bj = Math.max(0, Math.min(t.lch - 1, cj + j));
        built += t.built[bj * t.lcw + bi] / 255 / 25;
      }
      if (built < 0.3) continue;
      let da = Math.abs(a - w.prefer); if (da > Math.PI) da = Math.PI * 2 - da;
      const score = -(hi - lo) * 3 + built * 2 + Math.cos(da) * 0.9 - R * 0.03;
      if (score > bestScore) {
        bestScore = score;
        // face the opening camera (south, turned towards the village side it comes from), a bit towards the centre
        const toC = Math.atan2(v.x - x, v.z - z);
        const cam = s === 0 ? -0.5 : 0.5;
        let dd = toC - cam; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2;
        best = { key: w.key, x, z, ry: cam + Math.max(-0.6, Math.min(0.6, dd * 0.3)), r };
      }
    }
    if (best) spots.push(best);
  }
  spotCache = { t, spots };
  return spots;
}

/** Spots buildVillages kept clear last time (decor + Донер Бей), for buildTrees. */
let clearSpots: { x: number; z: number; r: number }[] = [];

export function buildVillages(t: Terrain, pts: Pt[], parent: THREE.Object3D, hq = true) {
  const items: Item[] = [];
  const cw = t.lcCell / 100;
  const avoid = pts.slice(0, 2).map(p => ({ x: p.x, z: p.z, r: 6.2 }));
  const shali = pts.find(p => p.key === 'shali')!;
  avoid.push({ x: shali.x, z: shali.z, r: 3.6 });
  for (const p of pts.slice(0, 2)) avoid.push({ x: p.x + (p.side === 0 ? -6 : 7), z: p.z + 4, r: 2 });
  for (const p of pts.slice(0, 2)) avoid.push({ x: p.x + (p.side === 0 ? -4.6 : 5.6), z: p.z - 3.4, r: 2.5 });
  // Донер Бей and the village decor (decor.ts builds them on these spots)
  clearSpots = decorSpots(t).map(d => ({ x: d.x, z: d.z, r: d.r + 0.5 }));
  const doner = pts.find(p => p.key === 'doner');
  if (doner) clearSpots.push({ x: doner.x, z: doner.z, r: DONER_CLEAR });
  avoid.push(...clearSpots);
  for (let j = 0; j < t.lch; j++) for (let i = 0; i < t.lcw; i++) {
    const b = t.built[j * t.lcw + i];
    if (b < 95) continue;
    const r = hash2(i * 3 + 11, j * 7 + 5);
    if (r > (b / 255) * (hq ? 0.5 : 0.3)) continue;
    const x = (i + 0.2 + hash2(i, j + 99) * 0.6) * cw, z = (j + 0.2 + hash2(i + 77, j) * 0.6) * cw;
    if (!passable(t, x, z) || t.lc[j * t.lcw + i] === LC.WATER) continue;
    if (avoid.some(a => (a.x - x) ** 2 + (a.z - z) ** 2 < a.r * a.r)) continue;
    if (BRIDGES.some(br => segDist(x, z, br.x0, br.z0, br.x1, br.z1) < 1.2)) continue;
    const blockRot = Math.floor(hash2(Math.floor(i / 10), Math.floor(j / 10)) * 4) * (Math.PI / 2) + hash2(Math.floor(i / 10), 3) * 0.5;
    const two = hash2(i + 5, j + 13) > 0.78;
    items.push({
      x, z, y: heightY(t, x, z) - 0.02, ry: blockRot,
      sx: 0.3 + hash2(i, j + 1) * 0.14, sy: two ? 0.42 : 0.24 + hash2(i + 2, j) * 0.06, sz: 0.3 + hash2(i + 3, j) * 0.14,
      c: WALLS[Math.floor(hash2(i + 9, j + 9) * WALLS.length)], c2: ROOFS[Math.floor(hash2(i + 19, j + 3) * ROOFS.length)],
    });
  }
  const { body, roof } = houseGeometries();
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  chunked(items, [body, roof], [mat, mat], [false, true], parent, 50, hq);
  return items.length;
}

/** Low-poly forests on the TIN's forest faces (clumped; about half with lowPower). Returns the tree count. */
export function buildTrees(t: Terrain, parent: THREE.Object3D, hq: boolean, tin: Tin) {
  // keep bridges, high-rises, mosques and village flags clear
  const marks = t.villages.map(v => ({ x: v.x, z: v.z, r2: (v.key === 'atagi' || v.key === 'kurchaloy' ? 10 : v.key === 'shali' ? 4.8 : 1.8) ** 2 }));
  // decor and Донер Бей (clearSpots is filled by buildVillages, which runs first)
  for (const d of decorSpots(t)) marks.push({ x: d.x, z: d.z, r2: (d.r + 0.6) ** 2 });
  for (const c of clearSpots) marks.push({ x: c.x, z: c.z, r2: (c.r + 0.4) ** 2 });
  const clear = (x: number, z: number) =>
    marks.some(m => (m.x - x) ** 2 + (m.z - z) ** 2 < m.r2) || BRIDGES.some(br => segDist(x, z, br.x0, br.z0, br.x1, br.z1) < 1.8);
  const spots = treeSpots(t, tin, hq, clear);
  const geo = treeGeometries();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  chunked(spots.broad, [geo.broad], [mat], [false], parent, 60, hq);
  chunked(spots.fir, [geo.fir], [mat], [false], parent, 60, hq);
  return spots.broad.length + spots.fir.length;
}

function segDist(px: number, pz: number, x0: number, z0: number, x1: number, z1: number) {
  const dx = x1 - x0, dz = z1 - z0;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / (dx * dx + dz * dz)));
  const qx = x0 + dx * t - px, qz = z0 + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

export function buildBridges(t: Terrain, parent: THREE.Object3D) {
  const mat = new THREE.MeshLambertMaterial({ color: '#a7a39a' });
  const rail = new THREE.MeshLambertMaterial({ color: '#6f6c66' });
  for (const b of BRIDGES) {
    const dx = b.x1 - b.x0, dz = b.z1 - b.z0, len = Math.sqrt(dx * dx + dz * dz);
    const y = Math.max(heightY(t, b.x0, b.z0), heightY(t, b.x1, b.z1)) + 0.12;
    const g = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 1.1), mat);
    g.add(deck);
    for (const s of [-0.55, 0.55]) { const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.18, 0.06), rail); r.position.set(0, 0.14, s); g.add(r); }
    for (let k = 1; k < len / 3; k++) {
      const x = -len / 2 + k * 3;
      const pier = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.5, 0.9), mat);
      pier.position.set(x, -1.3, 0); g.add(pier);
    }
    g.position.set((b.x0 + b.x1) / 2, y, (b.z0 + b.z1) / 2);
    g.rotation.y = -Math.atan2(dz, dx);
    g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    parent.add(g);
  }
}

// ---- mosques ---------------------------------------------------------------------------
// After photos of the Шали mosque «Гордость мусульман» (white marble, pale domes with gold finials,
// four slender minarets with two balconies each, a tall portal with a pointed-arch niche), the
// brick village mosques around Атаги (yellow brick, green profiled-metal hip roof, one brick minaret
// with a green spire) and the Ottoman-style Курчалой central mosque (cream stone, lead-grey domes,
// pencil minarets with red rings). Front (entrance) is +z; one vertex-coloured mesh each.
const MC = {
  marble: new THREE.Color('#f4f1ea'), marble2: new THREE.Color('#e4dfd4'), domeW: new THREE.Color('#d6e5ec'),
  gold: new THREE.Color('#d9b24a'), win: new THREE.Color('#41556a'), niche: new THREE.Color('#e9dcb8'), door: new THREE.Color('#5a4632'),
  brick: new THREE.Color('#c88a57'), brick2: new THREE.Color('#b57849'), trim: new THREE.Color('#efe8da'), green: new THREE.Color('#2f7f63'),
  stone: new THREE.Color('#e8dcc3'), lead: new THREE.Color('#7c8794'), ring: new THREE.Color('#b8342a'), pave: new THREE.Color('#d9d3c6'),
};
const cyl = (n: number, open = false) => new THREE.CylinderGeometry(0.5, 0.5, 1, n, 1, open);
const MG = {
  c6: cyl(6), c8: cyl(8), c8o: cyl(8, true), c12o: cyl(12, true), c16o: cyl(16, true),
  cone4: new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1, true).rotateY(Math.PI / 4), cone8: new THREE.ConeGeometry(0.5, 1, 8, 1, true),
  hemi16: new THREE.SphereGeometry(1, 16, 5, 0, Math.PI * 2, 0, Math.PI / 2), hemi12: new THREE.SphereGeometry(1, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2),
  hemi8: new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), ico: new THREE.IcosahedronGeometry(0.5, 0),
};
type P3 = [number, number, number];
/** Gold finial: a small ball and a spike, standing on y. */
function finial(b: Builder, x: number, y: number, z: number, s = 1) {
  b.add(MG.ico, MC.gold, [x, y + 0.04 * s, z], [0, 0, 0], [0.09 * s, 0.09 * s, 0.09 * s]);
  b.add(MG.cone8, MC.gold, [x, y + 0.17 * s, z], [0, 0, 0], [0.05 * s, 0.22 * s, 0.05 * s]);
}
/** Arched openings around a vertical n-gon tube of radius r (one per face). */
function ringArches(b: Builder, c: THREE.Color, x: number, y: number, z: number, r: number, n: number, w: number, h: number, every = 1) {
  const ap = r * Math.cos(Math.PI / n);
  for (let k = 0; k < n; k += every) {
    const a = ((k + 0.5) / n) * Math.PI * 2;
    archAt(b, c, [x + Math.sin(a) * ap, y, z + Math.cos(a) * ap], a, w, h, 0.004);
  }
}
/** Box without its bottom face (10 tris). */
function slab(b: Builder, c: THREE.Color, p: P3, s: P3) {
  const [x, y, z] = p, [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
  const x0 = x - hx, x1 = x + hx, y0 = y - hy, y1 = y + hy, z0 = z - hz, z1 = z + hz;
  quad(b, c, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0]);
  quad(b, c, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
  quad(b, c, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1]);
  quad(b, c, [x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0]);
  quad(b, c, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
}
/** Hip roof over a w × d rectangle at y0, ridge along x (6 tris). */
function hip(b: Builder, c: THREE.Color, x: number, y0: number, z: number, w: number, d: number, h: number, ridge: number) {
  const A: P3 = [x - w / 2, y0, z + d / 2], B: P3 = [x + w / 2, y0, z + d / 2], C: P3 = [x + w / 2, y0, z - d / 2], D: P3 = [x - w / 2, y0, z - d / 2];
  const R0: P3 = [x - ridge / 2, y0 + h, z], R1: P3 = [x + ridge / 2, y0 + h, z];
  quad(b, c, A, B, R1, R0, [0, 1, 1]);
  quad(b, c, C, D, R0, R1, [0, 1, -1]);
  tri(b, c, B, C, R1, [1, 1, 0]);
  tri(b, c, D, A, R0, [-1, 1, 0]);
}
/** Dome on a drum: the drum is an open n-gon with arched windows, the dome a faceted hemisphere. */
function domeOn(b: Builder, x: number, y: number, z: number, r: number, drumH: number, dome: THREE.Color, drum: THREE.Color, big: boolean, rise = 1.1) {
  if (drumH > 0) {
    b.add(big ? MG.c16o : MG.c12o, drum, [x, y + drumH / 2, z], [0, 0, 0], [r * 2, drumH, r * 2]);
    ringArches(b, MC.win, x, y + drumH * 0.5, z, r, big ? 16 : 12, r * 0.22, drumH * 0.62, 2);
  }
  b.add(big ? MG.hemi16 : r > 0.3 ? MG.hemi12 : MG.hemi8, dome, [x, y + drumH, z], [0, 0, 0], [r * 1.02, r * rise, r * 1.02]);
  finial(b, x, y + drumH + r * rise - 0.01, z, Math.max(0.5, r * 1.1));
}

/** Шали «Гордость мусульман»: footprint about 4.3 × 5.0, minarets 6.4 high. */
function shaliMosque(b: Builder) {
  const M = MC.marble;
  slab(b, MC.pave, [0, 0.06, 0.25], [4.4, 0.12, 5.0]);
  // prayer hall and the cornice
  slab(b, M, [0, 0.72, -0.15], [2.9, 1.2, 2.9]);
  slab(b, MC.marble2, [0, 1.35, -0.15], [3.0, 0.07, 3.0]);
  // arcades on three sides (pointed arches)
  for (const s of [-1, 1]) {
    slab(b, M, [s * 1.73, 0.5, -0.15], [0.56, 0.76, 2.9]);
    for (let k = 0; k < 5; k++) archAt(b, MC.win, [s * 2.01, 0.47, -1.25 + k * 0.55], s * Math.PI / 2, 0.3, 0.5);
  }
  slab(b, M, [0, 0.5, 1.58], [4.02, 0.76, 0.56]);
  for (const x of [-1.6, -1.05, 1.05, 1.6]) archAt(b, MC.win, [x, 0.47, 1.86], 0, 0.3, 0.5);
  // the hall's own windows: a clerestory row over the arcades, tall arches on the qibla wall
  for (const s of [-1, 1]) for (const z of [-1.05, -0.5, 0.05, 0.6]) archAt(b, MC.win, [s * 1.45, 1.1, z - 0.15], s * Math.PI / 2, 0.16, 0.34);
  for (const x of [-1.0, -0.5, 0, 0.5, 1.0]) archAt(b, MC.win, [x, 0.75, -1.6], Math.PI, 0.2, 0.62);
  // the portal: a tall block with a pointed-arch niche, gold frame, door
  slab(b, M, [0, 0.98, 1.75], [1.25, 1.72, 0.5]);
  slab(b, MC.marble2, [0, 1.87, 1.75], [1.31, 0.06, 0.56]);
  archAt(b, MC.gold, [0, 0.98, 2.0], 0, 0.94, 1.42, 0.003);
  archAt(b, MC.niche, [0, 0.95, 2.0], 0, 0.8, 1.3, 0.006);
  archAt(b, MC.door, [0, 0.42, 2.0], 0, 0.34, 0.56, 0.009);
  // main dome on a drum, four smaller domes at the corners of the hall roof
  domeOn(b, 0, 1.38, -0.15, 0.8, 0.42, MC.domeW, M, true, 1.12);
  for (const [x, z] of [[-0.98, -1.13], [0.98, -1.13], [-0.98, 0.83], [0.98, 0.83]]) domeOn(b, x, 1.38, z, 0.34, 0.14, MC.domeW, M, false, 1.05);
  // four minarets: square foot, octagonal shaft, two balconies, a lantern with arches, a small dome
  for (const [x, z] of [[-1.98, -1.95], [1.98, -1.95], [-1.98, 2.45], [1.98, 2.45]]) {
    slab(b, M, [x, 0.62, z], [0.5, 1.0, 0.5]);
    b.add(MG.c8o, M, [x, 2.62, z], [0, 0, 0], [0.3, 3.0, 0.3]);
    b.add(MG.c8o, M, [x, 4.72, z], [0, 0, 0], [0.25, 1.2, 0.25]);
    for (const [y, r] of [[4.12, 0.5], [5.32, 0.44]]) {
      b.add(MG.c8, M, [x, y, z], [0, 0, 0], [r, 0.12, r]);
      b.add(MG.c8o, MC.gold, [x, y + 0.1, z], [0, 0, 0], [r * 0.98, 0.07, r * 0.98]);
    }
    b.add(MG.c8o, M, [x, 5.6, z], [0, 0, 0], [0.24, 0.42, 0.24]);
    ringArches(b, MC.win, x, 5.6, z, 0.12, 8, 0.06, 0.24, 2);
    domeOn(b, x, 5.81, z, 0.14, 0, MC.domeW, M, false, 1.4);
  }
}

/** Village mosque of Атаги: brick hall under a green hip roof, corner turrets, one brick minaret. */
function brickMosque(b: Builder) {
  const B = MC.brick;
  slab(b, MC.pave, [0, 0.05, 0.05], [1.85, 0.1, 1.6]);
  slab(b, B, [0, 0.48, 0], [1.6, 0.76, 1.3]);
  slab(b, MC.trim, [0, 0.89, 0], [1.68, 0.06, 1.38]);
  hip(b, MC.green, 0, 0.92, 0, 1.78, 1.48, 0.36, 0.5);
  // tall arched windows with a white surround, the door under a green canopy
  const win = (p: P3, ry: number) => { archAt(b, MC.trim, p, ry, 0.19, 0.42, 0.003); archAt(b, MC.win, p, ry, 0.13, 0.35, 0.006); };
  for (const x of [-0.45, 0, 0.45]) win([x, 0.5, -0.65], Math.PI);
  for (const x of [-0.45, 0.45]) win([x, 0.5, 0.65], 0);
  for (const s of [-1, 1]) for (const z of [-0.3, 0.3]) win([s * 0.8, 0.5, z], s * Math.PI / 2);
  archAt(b, MC.door, [0, 0.36, 0.65], 0, 0.26, 0.5, 0.006);
  slab(b, MC.green, [0, 0.66, 0.78], [0.42, 0.04, 0.26]);
  // corner turrets with green caps
  for (const [x, z] of [[0.8, 0.65], [0.8, -0.65], [-0.8, -0.65]]) {
    slab(b, MC.brick2, [x, 0.6, z], [0.16, 1.0, 0.16]);
    b.add(MG.cone4, MC.green, [x, 1.2, z], [0, 0, 0], [0.18, 0.2, 0.18]);
    finial(b, x, 1.28, z, 0.45);
  }
  // the minaret on the front-left corner: square foot, octagonal brick shaft, balcony, lantern, green spire
  const mx = -0.86, mz = 0.72;
  slab(b, MC.brick2, [mx, 0.55, mz], [0.34, 1.1, 0.34]);
  slab(b, MC.trim, [mx, 1.12, mz], [0.38, 0.05, 0.38]);
  b.add(MG.c8o, B, [mx, 1.5, mz], [0, 0, 0], [0.26, 0.76, 0.26]);
  b.add(MG.c8, MC.trim, [mx, 1.9, mz], [0, 0, 0], [0.4, 0.05, 0.4]);
  b.add(MG.c8o, MC.lead, [mx, 1.96, mz], [0, 0, 0], [0.39, 0.08, 0.39]);
  b.add(MG.c8o, B, [mx, 2.07, mz], [0, 0, 0], [0.22, 0.3, 0.22]);
  ringArches(b, MC.win, mx, 2.07, mz, 0.11, 8, 0.05, 0.17, 2);
  b.add(MG.cone8, MC.green, [mx, 2.42, mz], [0, 0, 0], [0.3, 0.42, 0.3]);
  finial(b, mx, 2.62, mz, 0.6);
}

/** Курчалой: Ottoman-style hall with a lead dome on a drum, small corner domes, a domed portico, two pencil minarets. */
function ottomanMosque(b: Builder) {
  const S = MC.stone;
  slab(b, MC.pave, [0, 0.05, 0.1], [2.15, 0.1, 2.25]);
  slab(b, S, [0, 0.48, -0.2], [1.5, 0.76, 1.5]);
  slab(b, MC.marble2, [0, 0.88, -0.2], [1.56, 0.05, 1.56]);
  for (const s of [-1, 1]) for (const z of [-0.6, -0.2, 0.2]) archAt(b, MC.win, [s * 0.75, 0.52, z], s * Math.PI / 2, 0.14, 0.3);
  for (const x of [-0.4, 0, 0.4]) archAt(b, MC.win, [x, 0.52, -0.95], Math.PI, 0.14, 0.3);
  domeOn(b, 0, 0.9, -0.2, 0.52, 0.2, MC.lead, S, false, 1.0);
  for (const [x, z] of [[-0.52, -0.72], [0.52, -0.72], [-0.52, 0.32], [0.52, 0.32]]) domeOn(b, x, 0.9, z, 0.19, 0.07, MC.lead, S, false, 0.95);
  // portico: three arches, three small domes
  slab(b, S, [0, 0.36, 0.78], [1.5, 0.52, 0.46]);
  for (const x of [-0.45, 0, 0.45]) archAt(b, MC.win, [x, 0.33, 1.01], 0, 0.28, 0.4);
  for (const x of [-0.45, 0, 0.45]) domeOn(b, x, 0.62, 0.78, 0.16, 0, MC.lead, S, false, 0.9);
  // two pencil minarets at the front corners: stone foot, white shaft, two balconies over red rings, lead cone
  for (const s of [-1, 1]) {
    const x = s * 0.98, z = 0.62;
    slab(b, S, [x, 0.4, z], [0.26, 0.6, 0.26]);
    b.add(MG.cone4, S, [x, 0.79, z], [0, 0, 0], [0.26, 0.18, 0.26]);
    b.add(MG.c8o, MC.marble, [x, 1.5, z], [0, 0, 0], [0.15, 1.5, 0.15]);
    for (const y of [1.45, 1.95]) {
      b.add(MG.c8o, MC.ring, [x, y - 0.06, z], [0, 0, 0], [0.16, 0.03, 0.16]);
      b.add(MG.c8, MC.marble, [x, y, z], [0, 0, 0], [0.24, 0.06, 0.24]);
    }
    b.add(MG.cone8, MC.lead, [x, 2.43, z], [0, 0, 0], [0.16, 0.42, 0.16]);
    finial(b, x, 2.62, z, 0.45);
  }
}

let mosqueMat: THREE.Material | null = null;
/**
 * Mosque model. `big`: the Шали «Гордость мусульман». Otherwise a village mosque: `style` 0 (default) is
 * the brick-and-green-roof kind of the Атаги villages, 1 the Ottoman-style Курчалой one. Entrance faces +z.
 * `userData.tris` has the triangle count (Шали ≈ 3.2k, village ones under 1k).
 */
export function mosque(big: boolean, style: 0 | 1 = 0): THREE.Group {
  const b = new Builder();
  if (big) shaliMosque(b); else if (style === 1) ottomanMosque(b); else brickMosque(b);
  const geo = b.build();
  mosqueMat ??= new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const m = new THREE.Mesh(geo, mosqueMat);
  m.castShadow = true; m.receiveShadow = true;
  const g = new THREE.Group(); g.add(m);
  g.userData.tris = geo.attributes.position.count / 3;
  return g;
}

// ---- the high-rises -------------------------------------------------------------------
export class HqBuilding {
  group = new THREE.Group();
  floors: THREE.Group[] = [];
  ghost?: THREE.LineSegments;
  roof: THREE.Group;
  flag: THREE.Mesh;
  private dust: { t: number; m: THREE.Mesh }[] = [];
  private shake = 0;
  readonly fh: number; readonly len: number; readonly dep: number;
  private mats: THREE.Material[];
  falling: { g: THREE.Group; t: number }[] = [];

  constructor(public side: 0 | 1, public max: number) {
    this.fh = side === 0 ? 1.0 : 0.84;
    this.len = side === 0 ? 4.8 : 7.8;
    this.dep = side === 0 ? 3.0 : 2.2;
    // front / back: brick — the whole front once, stairwell over the one entrance; panel — one section
    // per entrance (4), stairwell over each canopy. Ends: three windows / the blind panel wall.
    const tex = facadeTexture(side === 0 ? 'brick' : 'panel', side, 'long');
    tex.repeat.set(side === 0 ? 1 : 4, 1);
    const end = facadeTexture(side === 0 ? 'brick' : 'panel', side, 'end');
    const plain = new THREE.MeshLambertMaterial({ color: side === 0 ? '#9b5236' : '#d9d3c5' });
    this.mats = [new THREE.MeshLambertMaterial({ map: end }), new THREE.MeshLambertMaterial({ map: end }), plain, plain, new THREE.MeshLambertMaterial({ map: tex }), new THREE.MeshLambertMaterial({ map: tex })];
    this.roof = new THREE.Group();
    const rb = new Builder();
    rb.box(new THREE.Color('#5c5a55'), [0, 0.06, 0], [this.len + 0.12, 0.12, this.dep + 0.12]);
    rb.box(new THREE.Color('#8d8a83'), [this.len * 0.3, 0.3, 0], [0.6, 0.45, 0.6]);
    rb.box(PAL.side[side], [-this.len * 0.18, 0.34, this.dep / 2 + 0.02], [this.len * 0.5, 0.5, 0.06]); // вывеска
    const roofMesh = new THREE.Mesh(rb.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    roofMesh.castShadow = true;
    this.roof.add(roofMesh);
    const sign = this.signMesh(side === 0 ? 'АТАГИ' : 'КУРЧАЛОЙ');
    sign.position.set(-this.len * 0.18, 0.34, this.dep / 2 + 0.06);
    this.roof.add(sign);
    // flagpole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), new THREE.MeshLambertMaterial({ color: '#d9d9d9' }));
    pole.position.set(this.len * 0.4, 0.8, -this.dep * 0.3);
    this.roof.add(pole);
    this.flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5, 6, 1), new THREE.MeshLambertMaterial({ color: PAL.side[side], side: THREE.DoubleSide }));
    this.flag.position.set(this.len * 0.4 + 0.4, 1.35, -this.dep * 0.3);
    this.roof.add(this.flag);
    this.group.add(this.roof);
    // entrance canopies on ground floor
    const eb = new Builder();
    const n = side === 0 ? 1 : 4;
    for (let k = 0; k < n; k++) {
      const x = n === 1 ? 0 : -this.len / 2 + (k + 0.5) * (this.len / n);
      eb.box(new THREE.Color('#6d6a64'), [x, 0.42, this.dep / 2 + 0.18], [0.5, 0.05, 0.36]);
      eb.box(new THREE.Color('#3b2f28'), [x, 0.2, this.dep / 2 + 0.01], [0.3, 0.4, 0.02]);
    }
    const ent = new THREE.Mesh(eb.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.group.add(ent);
  }

  private signMesh(text: string) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = this.side === 0 ? '#2a52d1' : '#d8361f'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#fff8ea';
    g.font = '800 38px Unbounded, "Arial Black", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 34, 240);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(this.len * 0.5, 0.5 * 0.92), new THREE.MeshBasicMaterial({ map: tex }));
  }

  private makeFloor(): THREE.Group {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(this.len, this.fh, this.dep), this.mats);
    m.position.y = this.fh / 2;
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(this.len + 0.06, 0.04, this.dep + 0.06), new THREE.MeshLambertMaterial({ color: this.side === 0 ? '#7d412b' : '#bdb6a6' }));
    ledge.position.y = this.fh;
    g.add(ledge);
    return g;
  }

  setFloors(n: number, animate: boolean) {
    while (this.floors.length < n) {
      const f = this.makeFloor();
      f.position.y = this.floors.length * this.fh;
      if (animate) { f.scale.y = 0.01; (f.userData as { grow: number }).grow = 0; }
      this.group.add(f);
      this.floors.push(f);
    }
    while (this.floors.length > n) {
      const f = this.floors.pop()!;
      if (animate) this.falling.push({ g: f, t: 0 }); else this.group.remove(f);
      this.shake = animate ? 1 : 0;
    }
    this.roof.position.y = this.floors.length * this.fh;
    this.updateGhost();
  }

  private updateGhost() {
    if (this.side !== 0) return;
    const want = this.floors.length < 4;
    if (want && !this.ghost) {
      const e = new THREE.EdgesGeometry(new THREE.BoxGeometry(this.len, this.fh, this.dep));
      this.ghost = new THREE.LineSegments(e, new THREE.LineDashedMaterial({ color: '#2a52d1', dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.9 }));
      this.ghost.computeLineDistances();
      this.group.add(this.ghost);
    }
    if (this.ghost) {
      this.ghost.visible = want;
      this.ghost.position.y = this.floors.length * this.fh + this.fh / 2 + 0.55;
    }
  }

  get height() { return this.floors.length * this.fh; }

  update(dt: number, time: number) {
    for (const f of this.floors) {
      const u = f.userData as { grow?: number };
      if (u.grow !== undefined) { u.grow = Math.min(1, u.grow + dt * 1.5); f.scale.y = 0.01 + 0.99 * easeOutBack(u.grow); if (u.grow >= 1) delete u.grow; }
    }
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      f.g.position.y -= dt * (1 + f.t * 6);
      f.g.rotation.z = Math.sin(f.t * 9) * 0.05 * (1 - f.t);
      f.g.scale.y = Math.max(0.05, 1 - f.t * 0.9);
      if (f.t > 1.1) { this.group.remove(f.g); this.falling.splice(i, 1); }
    }
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 1.4); this.group.position.x = this.baseX + Math.sin(time * 60) * 0.08 * this.shake; }
    // flag wave
    const pa = this.flag.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      const x = (i % 7) / 6;
      pa.setZ(i, Math.sin(time * 4 + x * 5) * 0.08 * x);
    }
    pa.needsUpdate = true;
    if (this.ghost) (this.ghost.material as THREE.LineDashedMaterial).opacity = 0.55 + Math.sin(time * 3) * 0.35;
    for (const d of this.dust) d.t += dt;
  }

  baseX = 0;
  place(t: Terrain, p: Pt) {
    const y = heightY(t, p.x, p.z);
    this.group.position.set(p.x, y - 0.05, p.z);
    this.baseX = p.x;
    this.group.rotation.y = this.side === 0 ? 0.35 : -0.25;
  }
}

function easeOutBack(x: number) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }

/** Ground ribbon that follows the terrain (zones, capture rings). */
export function drapedRing(t: Terrain, cx: number, cz: number, r: number, w: number, seg = 96, arc = 1): THREE.BufferGeometry {
  const pos: number[] = [];
  const n = Math.max(3, Math.round(seg * arc));
  for (let k = 0; k <= n; k++) {
    const a = (k / seg) * Math.PI * 2 - Math.PI / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (const rr of [r - w / 2, r + w / 2]) {
      const x = cx + ca * rr, z = cz + sa * rr;
      pos.push(x, heightY(t, x, z) + 0.12, z);
    }
  }
  const idx: number[] = [];
  for (let k = 0; k < n; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/**
 * The sim replaces its points on every new game, new war and load, so markers look their point up
 * by key in the live list (decor.ts registers it from the Sim). Without it they keep the first object.
 */
let livePoints: (() => Pt[]) | null = null;
export function followPoints(get: (() => Pt[]) | null) { livePoints = get; }

const NEUTRAL = new THREE.Color('#efe6d2'), RING_NEUTRAL = new THREE.Color('#f2ead8');

export class VillageMarker {
  group = new THREE.Group();
  ring: THREE.Mesh; prog: THREE.Mesh; flag: THREE.Mesh; pole: THREE.Mesh;
  private progGeo: THREE.BufferGeometry;
  private lastArc = -1;
  private ringMat: THREE.MeshBasicMaterial; private progMat: THREE.MeshBasicMaterial; private flagMat: THREE.MeshLambertMaterial;
  constructor(t: Terrain, public p: Pt) {
    this.ringMat = new THREE.MeshBasicMaterial({ color: '#f2ead8', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.progMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(drapedRing(t, p.x, p.z, p.r, 0.25), this.ringMat);
    this.progGeo = drapedRing(t, p.x, p.z, p.r, 0.55, 96, 1);
    this.prog = new THREE.Mesh(this.progGeo, this.progMat);
    this.ring.renderOrder = 2; this.prog.renderOrder = 3;
    this.group.add(this.ring, this.prog);
    const y = heightY(t, p.x, p.z);
    this.pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), new THREE.MeshLambertMaterial({ color: '#e9e4d8' }));
    this.pole.position.set(p.x, y + 1.6, p.z);
    this.flagMat = new THREE.MeshLambertMaterial({ color: '#efe6d2', side: THREE.DoubleSide });
    this.flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.75, 8, 1), this.flagMat);
    this.flag.position.set(p.x + 0.6, y + 2.75, p.z);
    this.pole.castShadow = true; this.flag.castShadow = true;
    this.group.add(this.pole, this.flag);
  }
  update(time: number) {
    if (livePoints) {
      const list = livePoints();
      if (list.indexOf(this.p) < 0) { const q = list.find(o => o.key === this.p.key); if (q) this.p = q; }
    }
    const p = this.p;
    const col = p.owner === 0 ? PAL.side[0] : p.owner === 1 ? PAL.side[1] : NEUTRAL;
    this.flagMat.color.copy(col);
    const lead = p.prog < 0 ? 0 : p.prog > 0 ? 1 : -1;
    const frac = Math.abs(p.prog) / 100;
    this.progMat.color.copy(lead >= 0 ? PAL.side[lead] : col);
    const arc = Math.round(frac * 96);
    if (arc !== this.lastArc) {
      this.lastArc = arc;
      this.progGeo.setDrawRange(0, arc * 6);
    }
    this.ringMat.color.copy(p.owner >= 0 ? PAL.side[p.owner] : RING_NEUTRAL);
    const pa = this.flag.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) { const x = (i % 9) / 8; pa.setZ(i, Math.sin(time * 3.4 + x * 4 + p.x) * 0.12 * x); }
    pa.needsUpdate = true;
  }
}

export { HQ };
