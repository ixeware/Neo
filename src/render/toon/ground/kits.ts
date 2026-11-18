// Low-poly kits of the ground track: trees, bushes, field and river things, village and roadside props.
// A kit is a small indexed mesh without normals (the toon materials are flat-shaded from screen derivatives)
// whose vertices carry either a fixed palette colour or a tint slot the placement fills in (crown colour,
// awning colour, car paint…). scatter.ts merges thousands of them into one mesh per map chunk.
import * as THREE from 'three';
import { C, restyle } from '../../style';
import { GC } from './colors';

export interface Kit {
  pos: Float32Array; idx: Uint16Array;
  /** linear rgb per vertex: the colour itself, or a multiplier of the tint when `tint` is set */
  col: Float32Array;
  /** 0 = fixed colour, 1 | 2 = tint slot A | B */
  tint: Uint8Array;
  tris: number;
  /** the cheap stand-in drawn from afar (trees only) */
  far?: Kit;
}

type V3 = [number, number, number];
const col = (hex: string) => new THREE.Color(hex);
const WHITE = new THREE.Color(1, 1, 1);

export const G = {
  ico: new THREE.IcosahedronGeometry(0.5, 0),
  octa: new THREE.OctahedronGeometry(0.5, 0),
  tetra: new THREE.TetrahedronGeometry(0.5, 0),
  box: new THREE.BoxGeometry(1, 1, 1),
  cone6: new THREE.ConeGeometry(0.5, 1, 6, 1, true),
  cone5: new THREE.ConeGeometry(0.5, 1, 5, 1, true),
  cone4: new THREE.ConeGeometry(0.5, 1, 4, 1, true),
  cyl3: new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 1, true),
  cyl4: new THREE.CylinderGeometry(0.5, 0.5, 1, 4, 1, true),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, false),
  cyl6o: new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, true),
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, false),
};

/** Collects parts into one kit; each part is welded by position so same-coloured faces share vertices. */
export class KitBuilder {
  private pos: number[] = []; private col: number[] = []; private tint: number[] = []; private idx: number[] = [];
  private m = new THREE.Matrix4(); private v = new THREE.Vector3();

  /**
   * Add a geometry. `c`: a colour, or a tint slot (1 | 2) optionally with a multiplier `k` (a darker tier).
   * `r` is an Euler rotation (x, y, z). `drop` removes faces whose centre is below y = drop (hidden undersides).
   */
  add(g: THREE.BufferGeometry, c: THREE.Color | 1 | 2, p: V3 = [0, 0, 0], s: V3 = [1, 1, 1], r: V3 = [0, 0, 0], k = 1, drop = -Infinity): this {
    this.m.compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s));
    const P = g.getAttribute('position'), I = g.index;
    const n = I ? I.count : P.count, weld = new Map<string, number>();
    const cc = typeof c === 'number' ? WHITE : c, slot = typeof c === 'number' ? c : 0;
    const tri: number[] = [];
    for (let i = 0; i < n; i++) {
      this.v.fromBufferAttribute(P, I ? I.getX(i) : i).applyMatrix4(this.m);
      const key = `${Math.round(this.v.x * 2000)},${Math.round(this.v.y * 2000)},${Math.round(this.v.z * 2000)}`;
      let vi = weld.get(key);
      if (vi === undefined) {
        vi = this.pos.length / 3;
        weld.set(key, vi);
        this.pos.push(this.v.x, this.v.y, this.v.z);
        this.col.push(cc.r * k, cc.g * k, cc.b * k);
        this.tint.push(slot);
      }
      tri.push(vi);
      if (tri.length === 3) {
        const cy = (this.pos[tri[0] * 3 + 1] + this.pos[tri[1] * 3 + 1] + this.pos[tri[2] * 3 + 1]) / 3;
        if (cy >= drop && tri[0] !== tri[1] && tri[1] !== tri[2] && tri[0] !== tri[2]) this.idx.push(tri[0], tri[1], tri[2]);
        tri.length = 0;
      }
    }
    return this;
  }
  /** A box standing on y = p.y − s.y/2; its bottom face is dropped when it sits on the ground. */
  box(c: THREE.Color | 1 | 2, p: V3, s: V3, ry = 0, k = 1): this {
    return this.add(G.box, c, p, s, [0, ry, 0], k, p[1] - s[1] / 2 < 0.02 ? p[1] - s[1] / 2 + 1e-3 : -Infinity);
  }
  build(): Kit {
    return { pos: new Float32Array(this.pos), idx: new Uint16Array(this.idx), col: new Float32Array(this.col), tint: new Uint8Array(this.tint), tris: this.idx.length / 3 };
  }
}

/** A kit from an existing vertex-coloured model geometry (the parked Гелик, the blue BMW): old colours restyled. */
export function kitFromGeometry(g: THREE.BufferGeometry, scale: number): Kit {
  const src = g.index ? g.toNonIndexed() : g;
  const P = src.getAttribute('position'), Cc = src.getAttribute('color');
  const n = P.count, pos = new Float32Array(n * 3), colr = new Float32Array(n * 3), idx = new Uint16Array(n);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    pos[i * 3] = P.getX(i) * scale; pos[i * 3 + 1] = P.getY(i) * scale; pos[i * 3 + 2] = P.getZ(i) * scale;
    if (Cc) restyle(c.setRGB(Cc.getX(i), Cc.getY(i), Cc.getZ(i))).toArray(colr, i * 3); else colr.set([0.5, 0.5, 0.5], i * 3);
    idx[i] = i;
  }
  if (src !== g) src.dispose();
  return { pos, idx, col: colr, tint: new Uint8Array(n), tris: n / 3 };
}

// ---- the kits ------------------------------------------------------------------------------------------------
// Sizes are world units (1 = 100 m at chibi scale: a village house is 0.3–0.45 wide, a tree about 1.2 tall).
// Tint slot 1 is the main colour of the thing (crown, flowers, paint), slot 2 a second one.

const TRUNK = C.trunk;

function trunk(b: KitBuilder, h: number, r = 0.08) { b.add(G.cyl3, TRUNK, [0, h / 2 - 0.03, 0], [r * 2, h + 0.06, r * 2]); }
/** Far stand-ins: a gem for a round crown, a pyramid for a fir (no trunk: it is under a pixel wide out there). */
function farKit(shape: 'round' | 'cone' | 'poplar', y: number, w: number, h: number): Kit {
  const b = new KitBuilder();
  if (shape === 'cone') b.add(G.cone4, 1, [0, y, 0], [w, h, w]);
  else b.add(G.octa, 1, [0, y, 0], [w, h, w], [0, 0.6, 0]);
  return b.build();
}

export interface Kits {
  round: Kit; round2: Kit; cone: Kit; poplar: Kit; fruit: Kit; bush: Kit; bushes: Kit; flowers: Kit;
  bale: Kit; haystack: Kit; reeds: Kit; boulder: Kit; rocks: Kit;
  bench: Kit; lamp: Kit; well: Kit; sign: Kit; shelter: Kit; stall: Kit; woodpile: Kit; car: Kit; scarecrow: Kit; crates: Kit; stump: Kit;
  pier: Kit; brail: Kit; abut: Kit;
}

/** Build every kit once. `low`: the phone tier's cheaper versions. */
export function buildKits(low: boolean): Kits {
  const K = (f: (b: KitBuilder) => void, far?: Kit) => { const b = new KitBuilder(); f(b); const k = b.build(); k.far = far; return k; };
  const fRound = farKit('round', 0.86, 1.05, 1.1), fCone = farKit('cone', 0.85, 0.9, 1.5), fPoplar = farKit('poplar', 1.2, 0.56, 2.1), fFruit = farKit('round', 0.6, 0.8, 0.8);
  const wood = C.wood, woodDark = C.woodDark;
  return {
    // round broadleaf: a chunky crown on a short trunk
    round: K(b => { trunk(b, 0.5); b.add(G.ico, 1, [0, 0.92, 0], [1.0, 0.9, 1.0], [0.3, 0.5, 0]); }, fRound),
    // a bigger one with a second, lighter lobe
    round2: K(b => {
      trunk(b, 0.55, 0.1);
      b.add(G.ico, 1, [-0.08, 0.95, 0], [1.05, 0.92, 1.05], [0.2, 0.2, 0.1]);
      if (!low) b.add(G.ico, 1, [0.3, 1.22, 0.12], [0.62, 0.56, 0.62], [0.5, 1.1, 0], 1.12);
    }, fRound),
    // fir: stacked cones, darker towards the ground
    cone: K(b => {
      trunk(b, 0.3, 0.07);
      b.add(G.cone6, 1, [0, 0.62, 0], [0.86, 0.74, 0.86], [0, 0, 0], 0.9);
      b.add(G.cone6, 1, [0, 1.02, 0], [0.62, 0.66, 0.62], [0, 0.5, 0]);
      if (!low) b.add(G.cone5, 1, [0, 1.36, 0], [0.4, 0.5, 0.4], [0, 0.2, 0], 1.1);
    }, fCone),
    // pyramid poplar: the tall thin one along the roads
    poplar: K(b => { trunk(b, 0.4, 0.07); b.add(G.ico, 1, [0, 1.25, 0], [0.5, 2.0, 0.5], [0, 0.4, 0]); }, fPoplar),
    // fruit tree: small, light crown with red or gold dots
    fruit: K(b => {
      trunk(b, 0.34, 0.07);
      b.add(G.ico, 1, [0, 0.64, 0], [0.78, 0.66, 0.78], [0.2, 0.9, 0]);
      const dots: V3[] = low ? [[0.3, 0.72, 0.16], [-0.18, 0.86, 0.2]] : [[0.3, 0.72, 0.16], [-0.18, 0.86, 0.2], [0.02, 0.6, 0.36], [-0.3, 0.62, -0.12]];
      for (const d of dots) b.add(G.tetra, 2, d, [0.22, 0.22, 0.22], [d[0] * 5, d[2] * 7, 0]);
    }, fFruit),
    bush: K(b => { b.add(G.ico, 1, [0, 0.16, 0], [0.56, 0.42, 0.56], [0.4, 0.3, 0], 1, 0.04); }),
    // a hedge clump: three lobes
    bushes: K(b => {
      b.add(G.ico, 1, [0, 0.18, 0], [0.6, 0.46, 0.6], [0.4, 0.3, 0], 1, 0.04);
      b.add(G.ico, 1, [0.36, 0.13, 0.1], [0.44, 0.34, 0.44], [0.1, 1.3, 0], 0.92, 0.04);
      if (!low) b.add(G.octa, 1, [-0.3, 0.1, 0.2], [0.4, 0.34, 0.4], [0.9, 0.2, 0], 1.08, 0.04);
    }),
    // a flower bed: a low green cushion with bright dots
    flowers: K(b => {
      b.add(G.ico, C.leaf[3], [0, 0.05, 0], [0.62, 0.2, 0.62], [0.4, 0.3, 0], 1, 0.03);
      const dots: V3[] = low ? [[0.14, 0.17, 0.1], [-0.16, 0.17, -0.06], [0, 0.18, -0.2]] : [[0.14, 0.17, 0.1], [-0.16, 0.17, -0.06], [0, 0.18, -0.2], [-0.06, 0.18, 0.2], [0.22, 0.16, -0.12]];
      dots.forEach((d, i) => b.add(G.tetra, i % 2 ? 2 : 1, d, [0.17, 0.17, 0.17], [i, i * 2, 0]));
    }),
    // round hay bale lying on its side
    bale: K(b => {
      b.add(G.cyl6, col(GC.hay), [0, 0.15, 0], [0.3, 0.3, 0.3], [Math.PI / 2, 0, 0]);
    }),
    haystack: K(b => {
      b.add(G.cyl6o, col(GC.hay), [0, 0.14, 0], [0.56, 0.3, 0.56]);
      b.add(G.cone6, col(GC.hayDark), [0, 0.47, 0], [0.64, 0.4, 0.64]);
    }),
    reeds: K(b => {
      const sp: [number, number, number][] = low ? [[0, 0, 0.5], [0.12, 0.06, 0.4]] : [[0, 0, 0.52], [0.13, 0.06, 0.42], [-0.1, 0.1, 0.46], [0.02, -0.12, 0.36]];
      for (const [x, z, h] of sp) {
        b.add(G.cone4, col(GC.reed), [x, h / 2, z], [0.11, h, 0.11]);
        b.add(G.octa, col(GC.reedHead), [x, h * 0.86, z], [0.08, 0.16, 0.08]);
      }
    }),
    boulder: K(b => { b.add(G.ico, 1, [0, 0.1, 0], [0.5, 0.34, 0.42], [0.5, 0.3, 0.2], 1, 0.0); }),
    rocks: K(b => {
      b.add(G.ico, 1, [0, 0.1, 0], [0.44, 0.32, 0.38], [0.5, 0.3, 0.2], 1, 0.0);
      b.add(G.octa, 1, [0.3, 0.06, 0.08], [0.26, 0.2, 0.24], [0.3, 0.8, 0], 0.9, 0.0);
    }),
    // ---- village and roadside props ----
    bench: K(b => {
      b.box(wood, [0, 0.13, 0], [0.42, 0.05, 0.15]);
      b.box(wood, [0, 0.24, -0.075], [0.42, 0.12, 0.04]);
      b.box(C.metalDark, [-0.16, 0.055, 0], [0.05, 0.11, 0.14]);
      b.box(C.metalDark, [0.16, 0.055, 0], [0.05, 0.11, 0.14]);
    }),
    lamp: K(b => {
      b.add(G.cyl3, C.metalDark, [0, 0.42, 0], [0.07, 0.84, 0.07]);
      b.box(C.metalDark, [0.1, 0.84, 0], [0.26, 0.05, 0.06]);
      b.box(C.glassLit, [0.2, 0.79, 0], [0.13, 0.07, 0.1]);
    }),
    well: K(b => {
      b.add(G.cyl6, C.concrete, [0, 0.1, 0], [0.34, 0.2, 0.34], [0, 0, 0], 1, 0.02);
      b.add(G.cyl6, C.water[0], [0, 0.205, 0], [0.24, 0.01, 0.24], [0, 0, 0], 1, 0.2);
      b.box(woodDark, [-0.15, 0.3, 0], [0.05, 0.4, 0.05]);
      b.box(woodDark, [0.15, 0.3, 0], [0.05, 0.4, 0.05]);
      b.add(G.cone4, 1, [0, 0.58, 0], [0.56, 0.2, 0.56], [0, Math.PI / 4, 0]);
    }),
    // a road sign: slot 1 is the plate colour
    sign: K(b => {
      b.add(G.cyl3, C.metal, [0, 0.27, 0], [0.05, 0.54, 0.05]);
      b.box(1, [0, 0.62, 0], [0.26, 0.26, 0.04]);
      b.box(C.white, [0, 0.62, 0.012], [0.14, 0.14, 0.03]);
    }),
    // a bus shelter: slot 1 is the roof
    shelter: K(b => {
      b.box(1, [0, 0.5, 0], [0.86, 0.06, 0.42]);
      b.box(C.balcony, [0, 0.25, -0.18], [0.8, 0.44, 0.04]);
      b.box(C.metalDark, [-0.38, 0.24, 0.14], [0.05, 0.48, 0.05]);
      b.box(C.metalDark, [0.38, 0.24, 0.14], [0.05, 0.48, 0.05]);
      b.box(wood, [0, 0.12, -0.08], [0.56, 0.05, 0.13]);
    }),
    // a market stall: counter with goods under a two-coloured awning (slots 1 and 2)
    stall: K(b => {
      b.box(wood, [0, 0.12, 0], [0.56, 0.24, 0.3]);
      b.box(C.roof[6], [-0.14, 0.28, 0.02], [0.2, 0.1, 0.2]);
      b.box(C.leaf[3], [0.14, 0.28, 0.02], [0.2, 0.1, 0.2]);
      b.box(woodDark, [-0.27, 0.3, -0.16], [0.04, 0.6, 0.04]);
      b.box(woodDark, [0.27, 0.3, -0.16], [0.04, 0.6, 0.04]);
      for (let k = 0; k < 4; k++) b.add(G.box, k % 2 ? 2 : 1, [-0.24 + k * 0.16, 0.6, 0.02], [0.16, 0.04, 0.5], [0.32, 0, 0]);
    }),
    woodpile: K(b => {
      b.box(wood, [0, 0.08, 0], [0.42, 0.16, 0.16]);
      b.box(woodDark, [0, 0.2, 0], [0.42, 0.08, 0.1]);
    }),
    // a toy car: slot 1 is the paint
    car: K(b => {
      b.box(1, [0, 0.13, 0], [0.3, 0.14, 0.62]);
      b.box(C.glass, [0, 0.245, -0.03], [0.26, 0.1, 0.32]);
      b.box(1, [0, 0.305, -0.03], [0.27, 0.025, 0.3]);
      b.box(C.cloth, [0, 0.055, 0.19], [0.33, 0.11, 0.13]);
      b.box(C.cloth, [0, 0.055, -0.19], [0.33, 0.11, 0.13]);
      if (!low) { b.box(C.glassLit, [0, 0.14, 0.312], [0.24, 0.05, 0.01]); b.box(C.danger, [0, 0.14, -0.312], [0.24, 0.04, 0.01]); }
    }),
    scarecrow: K(b => {
      b.add(G.cyl3, woodDark, [0, 0.3, 0], [0.05, 0.6, 0.05]);
      b.box(1, [0, 0.42, 0], [0.46, 0.16, 0.08]);
      b.add(G.ico, col(GC.hay), [0, 0.63, 0], [0.18, 0.18, 0.18]);
      b.add(G.cone5, woodDark, [0, 0.76, 0], [0.26, 0.12, 0.26]);
    }),
    crates: K(b => {
      b.box(wood, [0, 0.09, 0], [0.2, 0.18, 0.2]);
      b.box(1, [0.2, 0.07, 0.05], [0.16, 0.14, 0.16], 0.4);
      if (!low) b.box(wood, [0.04, 0.25, 0.02], [0.16, 0.14, 0.16], 0.2, 0.9);
    }),
    stump: K(b => { b.add(G.cyl6, TRUNK, [0, 0.07, 0], [0.22, 0.14, 0.22], [0, 0, 0], 1, 0.02); }),
    // ---- bridge dressing (local z runs along the deck, y = 0 is the deck top) ----
    pier: K(b => {
      b.add(G.box, C.concrete, [0, -0.95, 0], [0.9, 1.6, 0.34], [0, 0, 0], 0.86);
      b.add(G.box, C.concrete, [0, -0.2, 0], [1.3, 0.12, 0.5]);
    }),
    // a railing section: two posts and a coloured handrail (slot 1)
    brail: K(b => {
      b.add(G.box, C.trim, [0, 0.17, -0.5], [0.1, 0.34, 0.1]);
      b.add(G.box, C.trim, [0, 0.17, 0.5], [0.1, 0.34, 0.1]);
      b.add(G.box, 1, [0, 0.3, 0], [0.07, 0.07, 2.0]);
      b.add(G.box, 1, [0, 0.14, 0], [0.05, 0.05, 2.0], [0, 0, 0], 0.85);
    }),
    abut: K(b => {
      b.add(G.box, C.concrete, [0, -0.3, 0], [1.6, 0.9, 0.5], [0, 0, 0], 0.92);
      b.add(G.box, C.trim, [-0.72, 0.28, 0], [0.16, 0.56, 0.16]);
      b.add(G.box, C.trim, [0.72, 0.28, 0], [0.16, 0.56, 0.16]);
      b.add(G.octa, C.gold, [-0.72, 0.64, 0], [0.2, 0.2, 0.2]);
      b.add(G.octa, C.gold, [0.72, 0.64, 0], [0.2, 0.2, 0.2]);
    }),
  };
}
