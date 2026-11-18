// Village house kits of the new style, a drop-in for houseGeometries() of models.ts (world.ts picks by TOON).
// A kit is two instanced geometries in the unit box (x, z in ±0.5, walls from −0.25 to 1, roof above):
// `body` takes the wall colour and `roof` the roof colour as the instance colour; the vertex colours are
// multipliers on top of it, so windows, the door and the chimney are painted into the body, and the fence
// and gate (the same profiled sheet as the roof) into the roof — still two draw calls per chunk and variant.
// Three variants as before (plain / gate right / gate left) so world.ts keeps its placement:
//   0 a hip-roof house with a chimney, 1 the same behind a fence with a porch, 2 one with a side wing.
// The phone tier gets lighter kits (no side windows, no wing). Every kit has a `far` twin with the triangle
// count of the old houses (walls, roof, fence): world.ts swaps a chunk to it beyond HOUSE_NEAR.
import * as THREE from 'three';
import { STYLE } from '../../style';

type V3 = [number, number, number];
interface Kit3 { kind: 'plain' | 'gate' | 'gateL'; body: THREE.BufferGeometry; roof: THREE.BufferGeometry; tris: number; farBody: THREE.BufferGeometry; farRoof: THREE.BufferGeometry }

class Soup {
  pos: number[] = []; nor: number[] = []; col: number[] = [];
  tri(a: V3, b: V3, c: V3, out: V3, k: V3) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz; }
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(nx, ny, nz); this.col.push(k[0], k[1], k[2]); }
  }
  quad(a: V3, b: V3, c: V3, d: V3, out: V3, k: V3) { this.tri(a, b, c, out, k); this.tri(a, c, d, out, k); }
  /** An upright rectangle on a wall facing ±z (at z) or ±x (at x). */
  onZ(x0: number, x1: number, y0: number, y1: number, z: number, n: number, k: V3) { this.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, n], k); }
  onX(z0: number, z1: number, y0: number, y1: number, x: number, n: number, k: V3) { this.quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], [n, 0, 0], k); }
  /** Four sides and a top of a box (no bottom). */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, k: V3, top = true) {
    this.onZ(x0, x1, y0, y1, z1, 1, k); this.onZ(x0, x1, y0, y1, z0, -1, k); this.onX(z0, z1, y0, y1, x1, 1, k); this.onX(z0, z1, y0, y1, x0, -1, k);
    if (top) this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], k);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const W: V3 = [1, 1, 1];
const GLASS: V3 = [0.24, 0.38, 0.6], DOOR: V3 = [0.5, 0.31, 0.2], BRICK: V3 = [0.86, 0.46, 0.34], CAP: V3 = [0.5, 0.48, 0.52];
const FENCE: V3 = [0.8, 0.8, 0.8], POST: V3 = [1.25, 1.25, 1.25], WING: V3 = [0.9, 0.9, 0.9];
const LO = -0.25, P = 0.04; // walls reach below the ground; painted parts stand this far off the wall

/** Camera distance (to a chunk's centre) up to which the detailed kit is drawn. */
export const HOUSE_NEAR = () => (STYLE.tier === 'phone' ? 56 : 66);

let cache: { body: THREE.BufferGeometry; roof: THREE.BufferGeometry; variants: Kit3[] } | null = null;
/** The toon house kits, shaped like houseGeometries(): draw `body` and `roof` with a vertex-coloured material and instance colours. */
export function toonHouseKits() {
  if (cache) return cache;
  const lite = STYLE.tier === 'phone';
  const make = (kind: Kit3['kind'], far = false): Kit3 => {
    const b = new Soup(), r = new Soup();
    b.box(-0.5, 0.5, LO, 1, -0.5, 0.5, W, false);
    if (far) { // the distant kit: the same silhouette and colours with the triangle count of the old one
      const e = 0.63, y0 = 0.98, y1 = y0 + 0.74, rg = 0.22;
      const A: V3 = [-e, y0, e], B: V3 = [e, y0, e], Cc: V3 = [e, y0, -e], D: V3 = [-e, y0, -e], R0: V3 = [-rg, y1, 0], R1: V3 = [rg, y1, 0];
      r.quad(A, B, R1, R0, [0, 0.6, 0.8], W); r.quad(Cc, D, R0, R1, [0, 0.6, -0.8], W);
      r.tri(B, Cc, R1, [0.8, 0.6, 0], W); r.tri(D, A, R0, [-0.8, 0.6, 0], W);
      if (kind !== 'plain') {
        const gx = kind === 'gate' ? 0.32 : -0.32;
        for (const n of [1, -1]) r.onZ(-0.8, 0.8, LO, 0.58, 1.02, n, FENCE);
        r.onZ(gx - 0.26, gx + 0.26, LO, 0.68, 1.02 + P, 1, W);
      }
      const g = { kind, body: b.build(), roof: r.build(), tris: (b.pos.length + r.pos.length) / 9 };
      return { ...g, farBody: g.body, farRoof: g.roof };
    }
    // the front: a door and a window; the other walls get a window each on the desktop tier
    const dx = kind === 'gateL' ? -0.2 : 0.2;
    b.onZ(dx - 0.11, dx + 0.11, 0, 0.66, 0.5 + P, 1, DOOR);
    b.onZ(-dx - 0.17, -dx + 0.17, 0.36, 0.76, 0.5 + P, 1, GLASS);
    if (!lite) {
      b.onX(-0.2, 0.2, 0.36, 0.76, 0.5 + P, 1, GLASS);
      b.onX(-0.2, 0.2, 0.36, 0.76, -0.5 - P, -1, GLASS);
      b.onZ(-0.3, 0.02, 0.36, 0.76, -0.5 - P, -1, GLASS);
    }
    // a tall hip roof with a wide overhang, ridge along x
    const e = 0.63, h = 0.74, rg = 0.22, y0 = 0.98, y1 = y0 + h;
    const A: V3 = [-e, y0, e], B: V3 = [e, y0, e], Cc: V3 = [e, y0, -e], D: V3 = [-e, y0, -e], R0: V3 = [-rg, y1, 0], R1: V3 = [rg, y1, 0];
    r.quad(A, B, R1, R0, [0, 0.6, 0.8], W); r.quad(Cc, D, R0, R1, [0, 0.6, -0.8], W);
    r.tri(B, Cc, R1, [0.8, 0.6, 0], W); r.tri(D, A, R0, [-0.8, 0.6, 0], W);
    // a brick chimney with a dark cap (the fenced kits of the phone tier do without)
    if (!lite || kind === 'plain') {
      const cx = kind === 'gateL' ? 0.2 : -0.24;
      b.box(cx - 0.08, cx + 0.08, 1.2, 1.86, -0.3, -0.14, BRICK, false);
      b.quad([cx - 0.1, 1.86, -0.32], [cx + 0.1, 1.86, -0.32], [cx + 0.1, 1.86, -0.12], [cx - 0.1, 1.86, -0.12], [0, 1, 0], CAP);
    }
    if (kind !== 'plain') {
      // the street fence in the roof's sheet metal, lighter posts at the gate, the gate itself
      const z = 1.02, x0 = -0.8, x1 = 0.8, top = 0.58, gx = kind === 'gate' ? 0.32 : -0.32, g0 = gx - 0.26, g1 = gx + 0.26;
      for (const n of [1, -1]) { r.onZ(x0, g0, LO, top, z, n, FENCE); r.onZ(g1, x1, LO, top, z, n, FENCE); r.onZ(g0, g1, LO, top + 0.1, z, n, W); }
      if (!lite) for (const gp of [g0, g1]) for (const n of [1, -1]) r.onZ(gp - 0.05, gp + 0.05, LO, top + 0.22, z + n * P, n, POST);
    }
    if (kind === 'gate' && !lite) {
      // a porch roof over the door
      r.quad([dx - 0.22, 0.86, 0.5], [dx + 0.22, 0.86, 0.5], [dx + 0.22, 0.72, 0.78], [dx - 0.22, 0.72, 0.78], [0, 1, 0.3], W);
      b.onX(0.5, 0.76, 0, 0.1, dx - 0.2, -1, CAP); b.onX(0.5, 0.76, 0, 0.1, dx + 0.2, 1, CAP); b.onZ(dx - 0.2, dx + 0.2, 0, 0.1, 0.76, 1, CAP);
      b.quad([dx - 0.2, 0.1, 0.5], [dx + 0.2, 0.1, 0.5], [dx + 0.2, 0.1, 0.76], [dx - 0.2, 0.1, 0.76], [0, 1, 0], CAP);
    }
    if (kind === 'gateL' && !lite) {
      // a low side wing (the summer kitchen) under a lean-to roof
      const x0 = 0.5, x1 = 0.86, z0 = -0.36, z1 = 0.3, wy = 0.62;
      b.onZ(x0, x1, LO, wy, z1, 1, WING); b.onZ(x0, x1, LO, wy, z0, -1, WING); b.onX(z0, z1, LO, wy, x1, 1, WING);
      b.onZ(x0 + 0.08, x1 - 0.08, 0.22, 0.5, z1 + P, 1, GLASS);
      r.quad([x0, wy + 0.24, z0 - 0.06], [x0, wy + 0.24, z1 + 0.06], [x1 + 0.08, wy, z1 + 0.06], [x1 + 0.08, wy, z0 - 0.06], [0.4, 1, 0], W);
      b.tri([x0, wy, z1], [x1, wy, z1], [x0, wy + 0.24, z1], [0, 0, 1], WING); b.tri([x0, wy, z0], [x1, wy, z0], [x0, wy + 0.24, z0], [0, 0, -1], WING);
    }
    const f = make(kind, true);
    return { kind, body: b.build(), roof: r.build(), tris: (b.pos.length + r.pos.length) / 9, farBody: f.body, farRoof: f.roof };
  };
  const variants = [make('plain'), make('gate'), make('gateL')];
  cache = { body: variants[0].body, roof: variants[0].roof, variants };
  return cache;
}
