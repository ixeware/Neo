// Villages, forests, landmarks and the two high-rises the whole war is about.
import * as THREE from 'three';
import { LC, BRIDGES, heightY, passable, type Terrain } from '../world/terrain';
import { hash2 } from './terrainMesh';
import { Builder, PAL, houseGeometries, treeGeometry, facadeTexture } from './models';
import { HQ } from '../sim/defs';
import type { Pt } from '../sim/sim';

const WALLS = ['#efe6d6', '#e5d3b3', '#d9c3a0', '#f2ede2', '#c99c78', '#e8dcc0', '#d8cbb6'].map(c => new THREE.Color(c));
const ROOFS = ['#4f7a4a', '#8b3a2f', '#3e5f8a', '#6b6f75', '#7a4a2c', '#a8452f', '#557e7a'].map(c => new THREE.Color(c));
const LEAVES = ['#3f6a35', '#4b7a3a', '#365c2e', '#58803f', '#2f5229'].map(c => new THREE.Color(c));

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

export function buildVillages(t: Terrain, pts: Pt[], parent: THREE.Object3D, hq = true) {
  const items: Item[] = [];
  const cw = t.lcCell / 100;
  const avoid = pts.slice(0, 2).map(p => ({ x: p.x, z: p.z, r: 6.2 }));
  const shali = pts.find(p => p.key === 'shali')!;
  avoid.push({ x: shali.x, z: shali.z, r: 3.6 });
  for (const p of pts.slice(0, 2)) avoid.push({ x: p.x + (p.side === 0 ? -6 : 7), z: p.z + 4, r: 2 });
  for (const p of pts.slice(0, 2)) avoid.push({ x: p.x + (p.side === 0 ? -4.6 : 5.6), z: p.z - 3.4, r: 2.5 });
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

export function buildTrees(t: Terrain, parent: THREE.Object3D, hq = true) {
  const items: Item[] = [];
  const cw = t.lcCell / 100;
  for (let j = 0; j < t.lch; j++) for (let i = 0; i < t.lcw; i++) {
    const c = t.lc[j * t.lcw + i];
    const k = hq ? 1 : 0.5;
    const p = (c === LC.TREE ? (j * cw > 215 ? 0.03 : 0.06) : c === LC.GRASS ? 0.008 : c === LC.WET ? 0.04 : 0) * k;
    if (!p || hash2(i * 13 + 1, j * 17 + 3) > p) continue;
    const x = (i + hash2(i, j + 5)) * cw, z = (j + hash2(i + 8, j)) * cw;
    const s = 0.5 + hash2(i + 1, j + 2) * 0.45;
    items.push({ x, z, y: heightY(t, x, z) - 0.03, ry: hash2(i, j) * 6.28, sx: s, sy: s * (0.9 + hash2(j, i) * 0.4), sz: s, c: LEAVES[Math.floor(hash2(i + 4, j + 4) * LEAVES.length)] });
  }
  const geo = treeGeometry();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  chunked(items, [geo], [mat], [false], parent, 60, false);
  return items.length;
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

/** Mosque: dome on drum + minarets. */
export function mosque(big: boolean): THREE.Group {
  const b = new Builder();
  const white = new THREE.Color('#f1ede4'), dome = new THREE.Color(big ? '#b9c7d2' : '#4f8a5b'), gold = new THREE.Color('#d6b04c');
  const s = big ? 1.3 : 0.6;
  b.box(white, [0, 0.5 * s, 0], [2.6 * s, 1.0 * s, 2.6 * s]);
  b.add(new THREE.CylinderGeometry(0.9, 0.95, 0.5, 16), white, [0, 1.25 * s, 0], [0, 0, 0], [s, s, s]);
  b.add(new THREE.SphereGeometry(0.95, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), dome, [0, 1.5 * s, 0], [0, 0, 0], [s, s * 1.15, s]);
  b.add(new THREE.ConeGeometry(0.06, 0.4, 6), gold, [0, 2.75 * s, 0], [0, 0, 0], [s, s, s]);
  const minarets = big ? [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]] : [[1.6, 1.4]];
  for (const [x, z] of minarets) {
    const h = big ? 4.4 : 3.6;
    b.add(new THREE.CylinderGeometry(0.16, 0.2, h, 8), white, [x * s, (h / 2) * s, z * s], [0, 0, 0], [s, s, s]);
    b.add(new THREE.CylinderGeometry(0.26, 0.2, 0.12, 8), white, [x * s, h * 0.78 * s, z * s], [0, 0, 0], [s, s, s]);
    b.add(new THREE.ConeGeometry(0.18, 0.6, 8), dome, [x * s, (h + 0.3) * s, z * s], [0, 0, 0], [s, s, s]);
  }
  if (big) for (const [x, z] of [[-0.95, 0], [0.95, 0], [0, -0.95], [0, 0.95]]) b.add(new THREE.SphereGeometry(0.42, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), dome, [x * s, 1.0 * s, z * s], [0, 0, 0], [s, s, s]);
  const m = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.castShadow = true; m.receiveShadow = true;
  const g = new THREE.Group(); g.add(m);
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
    const tex = facadeTexture(side === 0 ? 'brick' : 'panel', side);
    tex.repeat.set(side === 0 ? 1.4 : 2.2, 1);
    const end = facadeTexture(side === 0 ? 'brick' : 'panel', side);
    end.repeat.set(side === 0 ? 0.9 : 0.6, 1);
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
    const p = this.p;
    const col = p.owner === 0 ? PAL.side[0] : p.owner === 1 ? PAL.side[1] : new THREE.Color('#efe6d2');
    this.flagMat.color.copy(col);
    const lead = p.prog < 0 ? 0 : p.prog > 0 ? 1 : -1;
    const frac = Math.abs(p.prog) / 100;
    this.progMat.color.copy(lead >= 0 ? PAL.side[lead] : col);
    const arc = Math.round(frac * 96);
    if (arc !== this.lastArc) {
      this.lastArc = arc;
      this.progGeo.setDrawRange(0, arc * 6);
    }
    this.ringMat.color.copy(p.owner >= 0 ? PAL.side[p.owner] : new THREE.Color('#f2ead8'));
    const pa = this.flag.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) { const x = (i % 9) / 8; pa.setZ(i, Math.sin(time * 3.4 + x * 4 + p.x) * 0.12 * x); }
    pa.needsUpdate = true;
  }
}

export { HQ };
