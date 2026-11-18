// A small modelling kit for the architecture track: primitives merged into one flat-shaded, vertex-coloured
// geometry (like Builder in models.ts) with a transform stack, tapered and chamfered boxes, roofs and beams.
// Every shape is closed or reads as closed from the game camera; normals are per face.
import * as THREE from 'three';

type Col = THREE.Color;
const unitShapes = new Map<string, Float32Array>();
function shape(key: string, make: () => THREE.BufferGeometry): Float32Array {
  let a = unitShapes.get(key);
  if (!a) {
    const g = make(), n = g.index ? g.toNonIndexed() : g;
    a = new Float32Array(n.attributes.position.array);
    g.dispose(); if (n !== g) n.dispose();
    unitShapes.set(key, a);
  }
  return a;
}
/** Triangles of a set of convex polygons, each turned to face away from the centre of all the points. */
function polys(key: string, faces: number[][][]): Float32Array {
  let a = unitShapes.get(key);
  if (a) return a;
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (const f of faces) for (const p of f) { cx += p[0]; cy += p[1]; cz += p[2]; n++; }
  cx /= n; cy /= n; cz /= n;
  const out: number[] = [];
  for (const f of faces) {
    const [a0, b0, c0] = f;
    const ux = b0[0] - a0[0], uy = b0[1] - a0[1], uz = b0[2] - a0[2], vx = c0[0] - a0[0], vy = c0[1] - a0[1], vz = c0[2] - a0[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const flip = nx * (a0[0] - cx) + ny * (a0[1] - cy) + nz * (a0[2] - cz) < 0;
    for (let i = 1; i + 1 < f.length; i++) for (const p of flip ? [f[0], f[i + 1], f[i]] : [f[0], f[i], f[i + 1]]) out.push(p[0], p[1], p[2]);
  }
  a = new Float32Array(out);
  if (key) unitShapes.set(key, a);
  return a;
}
const BOX = () => shape('box', () => new THREE.BoxGeometry(1, 1, 1));
const r2 = (v: number) => Math.round(v * 100) / 100;

export class Kit {
  pos: number[] = []; nor: number[] = []; col: number[] = [];
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  private p = new THREE.Vector3(); private s = new THREE.Vector3(); private a = new THREE.Vector3(); private b = new THREE.Vector3(); private c = new THREE.Vector3();

  /** Everything added until pop() is moved / turned / scaled as a group. */
  push(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1): this {
    this.q.setFromEuler(this.e.set(rx, ry, rz));
    this.stack.push(new THREE.Matrix4().compose(this.p.set(x, y, z), this.q, this.s.set(s, s, s)).premultiply(this.stack[this.stack.length - 1]));
    return this;
  }
  pop(): this { if (this.stack.length > 1) this.stack.pop(); return this; }

  /** A unit shape (triangle soup) placed with position, scale and rotation. */
  put(P: Float32Array, c: Col, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0): this {
    this.q.setFromEuler(this.e.set(rx, ry, rz));
    return this.mat(P, c, this.m.compose(this.p.set(x, y, z), this.q, this.s.set(sx, sy, sz)));
  }
  private mat(P: Float32Array, c: Col, local: THREE.Matrix4): this {
    const M = local.premultiply(this.stack[this.stack.length - 1]), { a, b, c: cc } = this;
    for (let i = 0; i < P.length; i += 9) {
      a.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(M); b.set(P[i + 3], P[i + 4], P[i + 5]).applyMatrix4(M); cc.set(P[i + 6], P[i + 7], P[i + 8]).applyMatrix4(M);
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = cc.x - a.x, vy = cc.y - a.y, vz = cc.z - a.z;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-12) continue;
      nx /= l; ny /= l; nz /= l;
      this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, cc.x, cc.y, cc.z);
      for (let k = 0; k < 3; k++) { this.nor.push(nx, ny, nz); this.col.push(c.r, c.g, c.b); }
    }
    return this;
  }

  /** Box centred at (x, y, z). */
  box(c: Col, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) { return this.put(BOX(), c, x, y, z, sx, sy, sz, rx, ry, rz); }
  /** Cylinder centred at (x, y, z): diameter d (dz along z when given), height h, n sides. */
  cyl(c: Col, x: number, y: number, z: number, d: number, h: number, n = 8, rx = 0, ry = 0, rz = 0, dz = d) { return this.put(shape(`cy${n}`, () => new THREE.CylinderGeometry(0.5, 0.5, 1, n)), c, x, y, z, d, h, dz, rx, ry, rz); }
  /** Tapered cylinder centred at (x, y, z): bottom diameter d0, top d1. */
  tap(c: Col, x: number, y: number, z: number, d0: number, d1: number, h: number, n = 8, rx = 0, ry = 0, rz = 0) {
    const k = r2(d1 / d0);
    return this.put(shape(`tp${n}|${k}`, () => new THREE.CylinderGeometry(0.5 * k, 0.5, 1, n)), c, x, y, z, d0, h, d0, rx, ry, rz);
  }
  cone(c: Col, x: number, y: number, z: number, d: number, h: number, n = 6, rx = 0, ry = 0, rz = 0) { return this.put(shape(`co${n}`, () => new THREE.ConeGeometry(0.5, 1, n)), c, x, y, z, d, h, d, rx, ry, rz); }
  /** Faceted ball centred at (x, y, z): diameter d, squashed by sy / sz. */
  ball(c: Col, x: number, y: number, z: number, d: number, det = 0, sy = 1, sz = 1) { return this.put(shape(`ic${det}`, () => new THREE.IcosahedronGeometry(0.5, det)), c, x, y, z, d, d * sy, d * sz); }
  /** Half ball standing on y. */
  dome(c: Col, x: number, y: number, z: number, d: number, h: number, n = 8) { return this.put(shape(`dm${n}`, () => new THREE.SphereGeometry(0.5, n, 3, 0, Math.PI * 2, 0, Math.PI / 2)), c, x, y, z, d, h * 2, d); }
  /** Hip roof standing on y: w × d eaves, height h, ridge along x of length `ridge` × w. */
  hip(c: Col, x: number, y: number, z: number, w: number, d: number, h: number, ridge = 0.4, ry = 0) {
    const r = r2(ridge) / 2;
    const A = [-0.5, 0, 0.5], B = [0.5, 0, 0.5], Cc = [0.5, 0, -0.5], D = [-0.5, 0, -0.5], R0 = [-r, 1, 0], R1 = [r, 1, 0];
    return this.put(polys(`hip${r}`, [[A, B, R1, R0], [Cc, D, R0, R1], [B, Cc, R1], [D, A, R0], [A, D, Cc, B]]), c, x, y, z, w, h, d, 0, ry, 0);
  }
  /** Gable roof (a prism) standing on y, ridge along x. */
  gable(c: Col, x: number, y: number, z: number, w: number, d: number, h: number, ry = 0) { return this.hip(c, x, y, z, w, d, h, 1, ry); }
  /** Tapered box standing on y: w0 × d0 at the bottom, w1 × d1 at the top. */
  tbox(c: Col, x: number, y: number, z: number, w0: number, d0: number, w1: number, d1: number, h: number, ry = 0) {
    const a = w1 / w0 / 2, b = d1 / d0 / 2;
    const P = [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, -0.5], [-0.5, 0, -0.5], [-a, 1, b], [a, 1, b], [a, 1, -b], [-a, 1, -b]];
    return this.put(polys(`tb${r2(a)}|${r2(b)}`, [[P[0], P[1], P[5], P[4]], [P[1], P[2], P[6], P[5]], [P[2], P[3], P[7], P[6]], [P[3], P[0], P[4], P[7]], [P[4], P[5], P[6], P[7]], [P[0], P[3], P[2], P[1]]]), c, x, y, z, w0, h, d0, 0, ry, 0);
  }
  /** Box with chamfered vertical edges (an eight-sided footprint), centred at (x, y, z); k = chamfer as a share of the shorter side. */
  bev(c: Col, x: number, y: number, z: number, w: number, h: number, d: number, k = 0.14, ry = 0) {
    const ch = Math.min(w, d) * k, ax = 0.5 - ch / w, az = 0.5 - ch / d;
    const ring = (yy: number) => [[-ax, yy, 0.5], [ax, yy, 0.5], [0.5, yy, az], [0.5, yy, -az], [ax, yy, -0.5], [-ax, yy, -0.5], [-0.5, yy, -az], [-0.5, yy, az]];
    const lo = ring(-0.5), hi = ring(0.5), faces: number[][][] = [hi, lo];
    for (let i = 0; i < 8; i++) faces.push([lo[i], lo[(i + 1) % 8], hi[(i + 1) % 8], hi[i]]);
    return this.put(polys(`bv${r2(ax)}|${r2(az)}`, faces), c, x, y, z, w, h, d, 0, ry, 0);
  }
  /** A straight bar of thickness t (t2 across) from one point to another. */
  beam(c: Col, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t: number, t2 = t) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dx, dy, dz) || 1e-6;
    this.q.setFromUnitVectors(this.a.set(0, 1, 0), this.b.set(dx / len, dy / len, dz / len));
    return this.mat(BOX(), c, this.m.compose(this.p.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), this.q, this.s.set(t, len, t2)));
  }
  /** A flat quad given by four corners (seen from both sides when `both`). */
  quad(c: Col, A: number[], B: number[], Cc: number[], D: number[], both = false) {
    const P = [...A, ...B, ...Cc, ...A, ...Cc, ...D];
    if (both) P.push(...A, ...Cc, ...B, ...A, ...D, ...Cc);
    return this.mat(new Float32Array(P), c, this.m.identity());
  }

  /** Drops the faces that look straight down below height `yMax`: nobody sees the underside of a thing that stands on the ground. */
  dropBottoms(yMax = 0.45): this {
    const { pos, nor, col } = this, P: number[] = [], N: number[] = [], Cc: number[] = [];
    for (let i = 0; i < pos.length; i += 9) {
      if (nor[i + 1] < -0.95 && pos[i + 1] < yMax && pos[i + 4] < yMax && pos[i + 7] < yMax) continue;
      for (let j = i; j < i + 9; j++) { P.push(pos[j]); N.push(nor[j]); Cc.push(col[j]); }
    }
    this.pos = P; this.nor = N; this.col = Cc;
    return this;
  }
  get tris() { return this.pos.length / 9; }
  get empty() { return this.pos.length === 0; }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
