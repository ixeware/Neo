import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  LOWER, GREEN, LOFT, GROWS, GZONES, CAVITIES, PANEL_GAP_MM, DOOR_OUTLINES, HOOD, TAILGATE,
  AXLES, MID_S, sToZ, zToS, lowerCP, greenCP, tableAt,
} from '../config/geometry.js';
import { sampleCurve2D, offsetPolygon } from '../util/math.js';
import { TriSoup } from '../util/soup.js';

const MID_M = MID_S / 1000;

// ---------------------------------------------------------------- loft
// Builds an indexed loft through station cross-sections (master prompt 6.3).
// closed = full ring (lower body); open = belt → roof → belt (greenhouse).
export const ROW_V = 0.05; // uv.v step per section point when rowUV is on
function buildLoft(stations, cpFn, { perSeg, rings, closed, capFront = 0, capRear = 0, maxHalfW = 9, minY = -9, rowUV = false }) {
  const secs = stations.map((st) => ({ s: st[0] / 1000, pts: sampleCurve2D(cpFn(st), perSeg) }));
  const NP = secs[0].pts.length;
  const curves = [];
  for (let i = 0; i < NP; i++) {
    curves.push(new THREE.CatmullRomCurve3(secs.map((sc) => new THREE.Vector3(sc.pts[i][0], sc.pts[i][1], sc.s)), false, 'centripetal'));
  }
  // ring layout
  const order = []; // [pointIndex, side]
  if (closed) {
    order.push([0, 0]);
    for (let i = 1; i < NP - 1; i++) order.push([i, -1]);
    order.push([NP - 1, 0]);
    for (let i = NP - 2; i >= 1; i--) order.push([i, 1]);
  } else {
    for (let i = NP - 1; i >= 1; i--) order.push([i, 1]);
    order.push([0, 0]);
    for (let i = 1; i < NP; i++) order.push([i, -1]);
  }
  const L = order.length;
  const pos = [], uv = [], ringS = [];
  const v = new THREE.Vector3();
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);
    const ring = curves.map((c) => c.getPoint(t, new THREE.Vector3()));
    let sAvg = 0;
    for (const p of ring) sAvg += p.z;
    ringS.push((sAvg / ring.length) * 1000);
    let arc = 0, prev = null;
    for (const [i, side] of order) {
      const p = ring[i];
      const y = Math.min(p.x, maxHalfW), h = Math.max(p.y, minY);
      v.set(side === 0 ? 0 : side * y, h, MID_M - p.z);
      if (prev) arc += prev.distanceTo(v);
      prev = v.clone();
      pos.push(v.x, v.y, v.z);
      uv.push(p.z * 1.5, rowUV ? i * ROW_V : arc * 1.5);
    }
  }
  const index = [];
  const segs = closed ? L : L - 1;
  for (let r = 0; r < rings - 1; r++) {
    for (let i = 0; i < segs; i++) {
      const a = r * L + i, b = r * L + ((i + 1) % L), c = (r + 1) * L + i, d = (r + 1) * L + ((i + 1) % L);
      index.push(a, c, b, b, c, d);
    }
  }
  if (closed) {
    const dome = (ringStart, dir, bulge) => {
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < L; i++) { const j = (ringStart + i) * 3; cx += pos[j]; cy += pos[j + 1]; cz += pos[j + 2]; }
      cx /= L; cy /= L; cz /= L;
      let prev = ringStart;
      for (const f of [0.75, 0.5, 0.25]) {
        const start = pos.length / 3, lift = bulge * (1 - f * f);
        for (let i = 0; i < L; i++) {
          const j = (ringStart + i) * 3;
          pos.push(cx + (pos[j] - cx) * f, cy + (pos[j + 1] - cy) * f, pos[j + 2] + dir * lift);
          uv.push(uv[(ringStart + i) * 2], uv[(ringStart + i) * 2 + 1] * f);
        }
        for (let i = 0; i < L; i++) {
          const a = prev + i, b = prev + ((i + 1) % L), c = start + i, d = start + ((i + 1) % L);
          if (dir > 0) index.push(a, b, c, b, d, c); else index.push(a, c, b, b, c, d);
        }
        prev = start;
      }
      const ctr = pos.length / 3;
      pos.push(cx, cy, cz + dir * bulge); uv.push(0, 0);
      for (let i = 0; i < L; i++) {
        if (dir > 0) index.push(prev + i, prev + ((i + 1) % L), ctr); else index.push(prev + i, ctr, prev + ((i + 1) % L));
      }
    };
    dome(0, +1, capFront);
    dome((rings - 1) * L, -1, capRear);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  if (closed && signedVolume(geo) < 0) flipWinding(geo);
  geo.computeVertexNormals();
  return { geometry: geo, ringLen: L, rings, order, ringS, NP };
}

function signedVolume(geo) {
  const p = geo.attributes.position.array, idx = geo.index.array;
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return vol / 6;
}
function flipWinding(geo) {
  const idx = geo.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  geo.index.needsUpdate = true;
}

// Brushes need identical attribute sets (position, uv, normal) and an outward winding.
function prepBrush(geo, uvMode = 'planar') {
  let g = geo.index ? geo : mergeVertices(geo);
  if (!g.index) g = mergeVertices(g);
  if (!g.attributes.uv || uvMode === 'planar') {
    const p = g.attributes.position.array, uv = new Float32Array((p.length / 3) * 2);
    for (let i = 0; i < p.length / 3; i++) { uv[i * 2] = p[i * 3 + 2] * 2; uv[i * 2 + 1] = (p[i * 3] + p[i * 3 + 1]) * 2; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  if (signedVolume(g) < 0) flipWinding(g);
  g.computeVertexNormals();
  return g;
}

function cleanPositionsOnly(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position.clone());
  if (geo.index) g.setIndex(geo.index.clone());
  return mergeVertices(g, 1e-5);
}

// Closed prism from a 2D polygon. map(u, v, w) → [x, y, z]
function prism(poly, map, w0, w1) {
  const contour = poly.map(([u, v]) => new THREE.Vector2(u, v));
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const n = contour.length, pos = [], index = [];
  for (const w of [w0, w1]) for (const c of contour) pos.push(...map(c.x, c.y, w));
  for (const [a, b, c] of tris) { index.push(a, c, b); index.push(n + a, n + b, n + c); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; index.push(i, j, n + i, j, n + j, n + i); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  if (signedVolume(g) < 0) flipWinding(g);
  return g;
}

function stationRows(table, fromS, toS) {
  const cols = table[0].length;
  const at = (s) => { const row = [s]; for (let c = 1; c < cols; c++) row.push(tableAt(table, s, c)); return row; };
  const rows = [at(fromS)];
  for (const r of table) if (r[0] > fromS + 20 && r[0] < toS - 20) rows.push([...r]);
  rows.push(at(toS));
  return rows;
}

// ---------------------------------------------------------------- cavities, arches, panels
function cabinCavityGeometry() {
  const c = CAVITIES.cabin;
  const rows = stationRows(LOWER, c.fromS, c.toS).map(([s, ht, hb, wm, hwm, wt]) =>
    [s, ht + c.raiseTop, hb + c.raiseBottom, wm - c.insetW, hwm, Math.max(10, wt - c.insetW), 0]);
  return buildLoft(rows, lowerCP, { perSeg: 4, rings: 120, closed: true, capFront: c.bulgeM, capRear: c.bulgeM }).geometry;
}

function engineCavityGeometry() {
  const c = CAVITIES.engine;
  const rows = stationRows(LOWER, c.fromS, c.toS).map(([s, ht, hb, wm, hwm, wt]) => {
    const top = ht - c.skin, wMax = wm - c.insetW, hW = Math.min(hwm - 30, top - 40);
    return [s, top, Math.min(hW - 60, top - c.depth), wMax, hW, Math.max(10, wt - 30), 1];
  });
  return buildLoft(rows, lowerCP, { perSeg: 4, rings: 80, closed: true, capFront: c.bulgeM, capRear: c.bulgeM }).geometry;
}

function archGeometry(radius, length) {
  const parts = [];
  for (const s of [AXLES.frontS, AXLES.rearS]) {
    for (const side of [1, -1]) {
      const g = new THREE.CylinderGeometry(radius, radius, length, 64, 1, false);
      g.rotateZ(Math.PI / 2);
      g.translate(side * CAVITIES.arch.centreX / 1000, AXLES.wheelCentreH / 1000, sToZ(s));
      parts.push(cleanPositionsOnly(g));
    }
  }
  return mergeGeometries(parts);
}

function panelPrisms(offsetMm) {
  const parts = [];
  // doors (side view s,h → prism along X)
  for (const [key, outline] of Object.entries(DOOR_OUTLINES)) {
    const poly = offsetPolygon(outline, offsetMm);
    for (const side of [1, -1]) {
      const [x0, x1] = side > 0 ? [0.45, 1.3] : [-1.3, -0.45];
      parts.push(prism(poly, (u, v, w) => [w, v / 1000, sToZ(u)], x0, x1));
    }
  }
  // hood (top view s, x → prism along Y)
  const hoodPoly = [];
  for (let s = HOOD.fromS; s <= HOOD.toS; s += 40) hoodPoly.push([s, -(tableAt(LOWER, s, 5) - HOOD.edgeInsetMm)]);
  for (let s = HOOD.toS; s >= HOOD.fromS; s -= 40) hoodPoly.push([s, tableAt(LOWER, s, 5) - HOOD.edgeInsetMm]);
  parts.push(prism(offsetPolygon(dedupe(hoodPoly), offsetMm), (u, v, w) => [v / 1000, w, sToZ(u)], HOOD.bottomY, 1.8));
  // tailgate (rear view x, h → prism along Z)
  parts.push(prism(offsetPolygon(TAILGATE.outline, offsetMm), (u, v, w) => [u / 1000, v / 1000, w], sToZ(4820), sToZ(TAILGATE.fromS)));
  return mergeGeometries(parts.map((g) => cleanPositionsOnly(g)));
}
function dedupe(poly) { return poly.filter((p, i) => i === 0 || Math.hypot(p[0] - poly[i - 1][0], p[1] - poly[i - 1][1]) > 1e-6); }

const keyMat = (name) => { const m = new THREE.MeshBasicMaterial(); m.name = name; return m; };

// ---------------------------------------------------------------- greenhouse zoning
function classifyGreen(s, rowLo, rowHi, x) {
  const z = GZONES, { G2, G3, G4 } = GROWS;
  const ax = Math.abs(x);
  const left = x > 0;
  if (rowHi <= G2) { // top surface: windshield / roof / rear glass
    if (s < z.headerS) {
      if (rowLo >= G2 - 2 || s < z.cowlS + 30) return { key: 'black_gloss', bucket: 'fixed' };
      return { key: 'glass_windshield', bucket: 'fixed' };
    }
    if (s > z.roofEndS) {
      const bucket = s >= z.tailgateFromS ? 'tailgate' : 'fixed';
      if (rowLo >= G2 - 2 || s > 4612) return { key: 'black_gloss', bucket };
      return { key: 'glass_rear', bucket };
    }
    const sr = z.sunroof;
    if (ax < sr.halfW && s > sr.fromS && s < sr.toS) {
      const edge = ax > sr.halfW - 0.035 || s < sr.fromS + 35 || s > sr.toS - 35 || Math.abs(s - sr.slideToS) < 18;
      const bucket = s < sr.slideToS ? 'sunroof' : 'fixed';
      return { key: edge ? 'black_gloss' : 'glass_sunroof', bucket };
    }
    return { key: 'paint_roof', bucket: 'fixed' };
  }
  if (rowHi <= G3) { // roof edge strip
    if (s < z.headerS) return { key: 'black_gloss', bucket: 'fixed' }; // A-pillar
    if (s > z.dloTailS) return { key: 'black_gloss', bucket: 'fixed' }; // D-pillar → floating roof
    return { key: 'paint_roof', bucket: 'fixed' };
  }
  // side band G3..G4
  if (s < z.sailEndS) return { key: 'black_gloss', bucket: 'fixed' };
  const frame = (from, to) => rowLo < G3 + 1 || rowHi > G4 - 1 || s < from + 16 || s > to - 16;
  if (s < z.bPillar[0]) return { key: frame(z.sailEndS, z.bPillar[0]) ? 'black_gloss' : 'glass_side', bucket: left ? 'door_fl' : 'door_fr' };
  if (s < z.bPillar[1]) return { key: 'black_gloss', bucket: 'fixed' };
  if (s < z.cPillar[0]) return { key: frame(z.bPillar[1], z.cPillar[0]) ? 'black_gloss' : 'glass_side', bucket: left ? 'door_rl' : 'door_rr' };
  if (s < z.cPillar[1]) return { key: 'black_gloss', bucket: 'fixed' };
  if (s < z.dloTailS) return { key: rowLo < G3 + 1 ? 'black_gloss' : 'glass_side', bucket: 'fixed' };
  return { key: 'black_gloss', bucket: 'fixed' };
}

function buildGreenhouse() {
  const loft = buildLoft(GREEN, greenCP, { perSeg: LOFT.greenPerSeg, rings: LOFT.greenRings, closed: false });
  const g = loft.geometry;
  const P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv.array;
  // make sure normals point outward (roof centre normal must point up)
  const midRing = Math.floor(loft.rings / 2), centre = midRing * loft.ringLen + (loft.NP - 1);
  const flip = N[centre * 3 + 1] < 0;
  const buckets = new Map();
  const get = (b) => { if (!buckets.has(b)) buckets.set(b, new TriSoup(4096)); return buckets.get(b); };
  const head = new TriSoup(4096);
  const sg = flip ? -1 : 1;
  const tri = (ids, key, bucket, soup = get(bucket)) => {
    const p = [], n = [], uv = [];
    const seq = flip ? [ids[0], ids[2], ids[1]] : ids;
    for (const id of seq) { p.push(P[id * 3], P[id * 3 + 1], P[id * 3 + 2]); n.push(sg * N[id * 3], sg * N[id * 3 + 1], sg * N[id * 3 + 2]); uv.push(U[id * 2], U[id * 2 + 1]); }
    soup.pushTri(p, n, uv, key);
  };
  const L = loft.ringLen, NP = loft.NP;
  const row = (j) => Math.abs(j - (NP - 1));
  for (let r = 0; r < loft.rings - 1; r++) {
    const s = (loft.ringS[r] + loft.ringS[r + 1]) / 2;
    for (let j = 0; j < L - 1; j++) {
      const a = r * L + j, b = r * L + j + 1, c = (r + 1) * L + j, d = (r + 1) * L + j + 1;
      const r0 = row(j), r1 = row(j + 1);
      const x = (P[a * 3] + P[d * 3]) / 2;
      const { key, bucket } = classifyGreen(s, Math.min(r0, r1), Math.max(r0, r1), x);
      tri([a, c, b], key, bucket); tri([b, c, d], key, bucket);
      // headliner: inner copy of the roof (without the sunroof opening)
      if (Math.max(r0, r1) <= GROWS.G3 - 2 && s > GZONES.headerS + 20 && s < GZONES.roofEndS - 10) {
        const sr = GZONES.sunroof;
        const inSun = Math.abs(x) < sr.halfW - 0.02 && s > sr.fromS + 20 && s < sr.toS - 20;
        if (!inSun) {
          const inset = (id) => [P[id * 3] - N[id * 3] * 0.022 * (flip ? -1 : 1), P[id * 3 + 1] - N[id * 3 + 1] * 0.022 * (flip ? -1 : 1), P[id * 3 + 2] - N[id * 3 + 2] * 0.022 * (flip ? -1 : 1)];
          const push = (i0, i1, i2) => {
            const seq = flip ? [i0, i1, i2] : [i0, i2, i1];
            head.pushTri(seq.flatMap(inset), seq.flatMap((id) => [-N[id * 3], -N[id * 3 + 1], -N[id * 3 + 2]].map((v) => v * (flip ? -1 : 1))), seq.flatMap((id) => [U[id * 2] * 4, U[id * 2 + 1] * 4]), 'headliner');
          };
          push(a, c, b); push(b, c, d);
        }
      }
    }
  }
  get('fixed').append(head);
  return buckets;
}

// ---------------------------------------------------------------- main build
export function buildBodyShell() {
  const t0 = performance.now();
  const lower = buildLoft(LOWER, lowerCP, {
    perSeg: LOFT.lowerPerSeg, rings: LOFT.lowerRings, closed: true,
    capFront: LOFT.capFrontBulgeM, capRear: LOFT.capRearBulgeM, maxHalfW: LOFT.maxHalfWidthM, minY: LOFT.minUnderbodyM, rowUV: true,
  });
  const tLoft = performance.now();

  const ev = new Evaluator();
  ev.attributes = ['position', 'uv', 'normal'];
  ev.useGroups = true;
  const M = Object.fromEntries(['paint', 'liner', 'interior', 'engine', 'jamb'].map((k) => [k, keyMat(k)]));
  const brush = (geo, mat) => { const b = new Brush(geo, mat); b.updateMatrixWorld(); return b; };

  // cavities (cabin + engine bay) keep a wall around the wheel wells
  const cab = prepBrush(cleanPositionsOnly(cabinCavityGeometry()));
  const eng = prepBrush(cleanPositionsOnly(engineCavityGeometry()));
  const cavGeo = mergeGeometries([cab, eng], true);
  let cav = brush(cavGeo, [M.interior, M.engine]);
  const walls = brush(prepBrush(archGeometry((CAVITIES.arch.radius + CAVITIES.arch.wall) / 1000, (CAVITIES.arch.length + 2 * CAVITIES.arch.wall) / 1000)), M.interior);
  cav = ev.evaluate(cav, walls, SUBTRACTION);

  let body = brush(lower.geometry, M.paint);
  body = ev.evaluate(body, brush(prepBrush(archGeometry(CAVITIES.arch.radius / 1000, CAVITIES.arch.length / 1000)), M.liner), SUBTRACTION);
  body.updateMatrixWorld();
  cav.updateMatrixWorld();
  body = ev.evaluate(body, cav, SUBTRACTION);
  body.updateMatrixWorld();
  const half = PANEL_GAP_MM / 2;
  const panels = ev.evaluate(body, brush(prepBrush(panelPrisms(-half)), M.jamb), INTERSECTION);
  body = ev.evaluate(body, brush(prepBrush(panelPrisms(+half)), M.jamb), SUBTRACTION);
  const tCsg = performance.now();

  const keyOf = (brushResult) => (i) => {
    const m = Array.isArray(brushResult.material) ? brushResult.material[i] : brushResult.material;
    return m?.name || 'paint';
  };
  // Rocker / front lip / rear diffuser: section rows from P6 (index 6 * perSeg) down, read back from uv.v
  const trimRow = 6 * LOFT.lowerPerSeg;
  const lowerTrim = (soup) => (i, key, c) => {
    if (key !== 'paint') return key;
    const u = soup.uv, row = (u[i * 6 + 1] + u[i * 6 + 3] + u[i * 6 + 5]) / 3 / ROW_V;
    const s = zToS(c.z);
    if (s > 15 && s < 4700 && row > trimRow - 0.02) return 'trim_black';
    return key;
  };
  const bodySoup = TriSoup.fromGeometry(body.geometry, keyOf(body));
  bodySoup.remap(lowerTrim(bodySoup));
  const panelSoup = TriSoup.fromGeometry(panels.geometry, keyOf(panels));
  panelSoup.remap(lowerTrim(panelSoup));
  const panelParts = panelSoup.partition((i, k, c) => {
    const s = zToS(c.z);
    if (s < 1560) return 'hood';
    if (s > 4500) return 'tailgate';
    const front = s < 2875;
    return (front ? 'door_f' : 'door_r') + (c.x > 0 ? 'l' : 'r');
  });
  const green = buildGreenhouse();
  const tEnd = performance.now();

  const parts = { body: bodySoup };
  for (const [k, v] of panelParts) parts[k] = v;
  for (const [k, v] of green) {
    if (k === 'fixed') parts.green = v;
    else parts[k] = parts[k] ? parts[k].append(v) : v;
  }
  let tris = 0;
  for (const v of Object.values(parts)) tris += v.n;
  return {
    parts, // name → TriSoup (keys = material slots)
    stats: { loftMs: tLoft - t0, csgMs: tCsg - tLoft, greenMs: tEnd - tCsg, totalMs: tEnd - t0, tris },
  };
}
