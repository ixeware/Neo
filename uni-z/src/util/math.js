import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Piecewise-linear lookup in [[x, y], ...] sorted by x
export function interp1(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const a = table[i - 1], b = table[i];
      return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
    }
  }
  return table[table.length - 1][1];
}

// Centripetal Catmull-Rom through 2D points, fixed number of samples per segment (stable vertex correspondence)
export function sampleCurve2D(points, perSeg) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, 'centripetal');
  const n = (points.length - 1) * perSeg;
  const out = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= n; i++) { curve.getPoint(i / n, v); out.push([v.x, v.y]); }
  return out;
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

// Miter offset of a simple polygon; d > 0 grows it outward
export function offsetPolygon(poly, d) {
  const ccw = polygonArea(poly) > 0;
  const n = poly.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
    const e1 = norm2([p1[0] - p0[0], p1[1] - p0[1]]), e2 = norm2([p2[0] - p1[0], p2[1] - p1[1]]);
    // outward normals (right of the edge for CCW)
    const n1 = ccw ? [e1[1], -e1[0]] : [-e1[1], e1[0]];
    const n2 = ccw ? [e2[1], -e2[0]] : [-e2[1], e2[0]];
    let m = norm2([n1[0] + n2[0], n1[1] + n2[1]]);
    let len = d / Math.max(0.25, m[0] * n1[0] + m[1] * n1[1]);
    out.push([p1[0] + m[0] * len, p1[1] + m[1] * len]);
  }
  return out;
}
function norm2(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Seeded PRNG for deterministic procedural content
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth 2D value noise (deterministic), returns ~[-1, 1]
export function makeNoise2D(seed = 1) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512), grad = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; grad[i] = rnd() * 2 - 1; }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const v00 = grad[perm[X + perm[Y]]], v10 = grad[perm[X + 1 + perm[Y]]];
    const v01 = grad[perm[X + perm[Y + 1]]], v11 = grad[perm[X + 1 + perm[Y + 1]]];
    const u = fade(xf), v = fade(yf);
    return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
  };
}
