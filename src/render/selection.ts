// Unit control visuals: rings in our ink under the selected units (one instanced mesh), thin
// lines to where they are going (not on low-power devices), and order markers on the ground for
// about a second (a pen flag for «идти», a red one for «атака с ходу», a crosshair for «бить»).
// Only this player's own selection is drawn here.
import * as THREE from 'three';
import { heightY, type Terrain } from '../world/terrain';
import { UNITS } from '../sim/defs';
import { OM, type Sim } from '../sim/sim';
import { PAL } from './models';
import type { UnitView } from './units';

const RING_MAX = 400;
const LINE_MAX = 96;
const MARK_LIFE = 1100;
const RED = new THREE.Color('#d8361f');

interface Mark { kind: 'move' | 'amove' | 'attack'; x: number; z: number; id: number; at: number; obj: THREE.Object3D }

function flagObject(color: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  const ink = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.5, 0.07), new THREE.MeshBasicMaterial({ color: '#23262b', transparent: true, depthWrite: false }));
  pole.position.y = 0.75;
  const tri = new THREE.Shape();
  tri.moveTo(0, 0); tri.lineTo(0.75, -0.22); tri.lineTo(0, -0.46); tri.closePath();
  const flag = new THREE.Mesh(new THREE.ShapeGeometry(tri), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, depthWrite: false }));
  flag.position.set(0.035, 1.5, 0);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 28).rotateX(-Math.PI / 2), ink);
  ring.position.y = 0.06; ring.name = 'ring';
  g.add(pole, flag, ring);
  g.renderOrder = 9;
  g.traverse(o => { o.renderOrder = 9; });
  return g;
}

function crossObject(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: RED, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 32).rotateX(-Math.PI / 2), m);
  g.add(ring);
  for (let k = 0; k < 4; k++) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.5).rotateX(-Math.PI / 2), m);
    const a = (k * Math.PI) / 2;
    t.position.set(Math.sin(a) * 0.95, 0, Math.cos(a) * 0.95);
    t.rotation.y = a;
    g.add(t);
  }
  g.traverse(o => { o.renderOrder = 10; });
  return g;
}

export class SelectionView {
  group = new THREE.Group();
  private rings: THREE.InstancedMesh;
  private ringMat: THREE.MeshBasicMaterial;
  private lines: THREE.LineSegments;
  private linePos = new Float32Array(LINE_MAX * 6);
  private lineCol = new Float32Array(LINE_MAX * 6);
  private marks: Mark[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0); private nrm = new THREE.Vector3();
  private side: 0 | 1 = 0;

  constructor(private t: Terrain, private sim: Sim, private units: UnitView, private lowPower: boolean) {
    this.ringMat = new THREE.MeshBasicMaterial({ color: PAL.side[0], transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    // a double pen stroke: the ring and a fainter inner one
    const a = new THREE.RingGeometry(0.5, 0.6, 30), b = new THREE.RingGeometry(0.38, 0.42, 30);
    const pos: number[] = [], idx: number[] = [];
    for (const g of [a, b]) {
      const base = pos.length / 3, p = g.attributes.position.array, ix = g.index!.array;
      for (let i = 0; i < p.length; i++) pos.push(p[i]);
      for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(geo, this.ringMat, RING_MAX);
    this.rings.count = 0; this.rings.frustumCulled = false; this.rings.renderOrder = 3;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(this.lineCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false }));
    this.lines.frustumCulled = false; this.lines.renderOrder = 8;
    this.group.add(this.rings, this.lines);
  }

  setSide(s: 0 | 1) { this.side = s; this.ringMat.color.copy(PAL.side[s]); }

  /** An order marker on the ground for about a second; `id` = the attacked unit (the crosshair follows it). */
  mark(kind: Mark['kind'], x: number, z: number, id = -1) {
    const obj = kind === 'attack' ? crossObject() : flagObject(kind === 'amove' ? RED : PAL.side[this.side]);
    this.group.add(obj);
    this.marks.push({ kind, x, z, id, at: performance.now(), obj });
    while (this.marks.length > 6) this.drop(0);
  }

  private drop(i: number) {
    const k = this.marks[i];
    this.group.remove(k.obj);
    k.obj.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); if (m.material) (m.material as THREE.Material).dispose(); });
    this.marks.splice(i, 1);
  }

  clear() { while (this.marks.length) this.drop(0); this.rings.count = 0; this.lines.geometry.setDrawRange(0, 0); }

  /** Rings and lines for the selected ids (after units.update(): drawn positions are current). */
  update(ids: Iterable<number>, now: number, zk: number, hide = -1) {
    let n = 0, nl = 0;
    const lp = this.linePos, lc = this.lineCol;
    for (const id of ids) {
      if (id === hide) continue;
      const u = this.sim.unit(id), p = this.units.renderPos(id);
      if (!u || !p || u.hp <= 0) continue;
      if (n < RING_MAX) {
        const h = 0.6, x = p.x, z = p.z;
        const hx = heightY(this.t, x + h, z) - heightY(this.t, x - h, z), hz = heightY(this.t, x, z + h) - heightY(this.t, x, z - h);
        this.nrm.set(-hx, 2 * h, -hz).normalize();
        this.q.setFromUnitVectors(this.up, this.nrm);
        const r = Math.max(0.75, UNITS[u.t]?.radius ?? 0.5) * 1.55 * Math.min(zk, 1.8);
        this.v.set(x, p.y + 0.08, z); this.s.set(r, r, r);
        this.m.compose(this.v, this.q, this.s);
        this.rings.setMatrixAt(n++, this.m);
      }
      // a thin line to where it goes (or whom it chases)
      const o = u.o;
      if (this.lowPower || !o || nl >= LINE_MAX) continue;
      let tx = 0, tz = 0, ty = 0, red = false;
      if (o.m === OM.MOVE || o.m === OM.AMOVE) { tx = o.x; tz = o.z; ty = heightY(this.t, tx, tz); red = o.m === OM.AMOVE; }
      else if (o.m === OM.ATTACK) { const q = this.units.renderPos(o.tg); if (!q) continue; tx = q.x; tz = q.z; ty = q.y; red = true; }
      else continue;
      if ((tx - p.x) ** 2 + (tz - p.z) ** 2 < 1) continue;
      const c = red ? RED : PAL.side[this.side], b = nl * 6;
      lp[b] = p.x; lp[b + 1] = p.y + 0.15; lp[b + 2] = p.z; lp[b + 3] = tx; lp[b + 4] = ty + 0.15; lp[b + 5] = tz;
      lc[b] = c.r; lc[b + 1] = c.g; lc[b + 2] = c.b; lc[b + 3] = c.r; lc[b + 4] = c.g; lc[b + 5] = c.b;
      nl++;
    }
    this.rings.count = n; this.rings.visible = n > 0;
    if (n) this.rings.instanceMatrix.needsUpdate = true;
    const g = this.lines.geometry;
    g.setDrawRange(0, nl * 2); this.lines.visible = nl > 0;
    if (nl) { (g.attributes.position as THREE.BufferAttribute).needsUpdate = true; (g.attributes.color as THREE.BufferAttribute).needsUpdate = true; }
    // markers: pop in, follow an attacked unit, fade out
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const k = this.marks[i], age = now - k.at;
      if (age > MARK_LIFE) { this.drop(i); continue; }
      if (k.id >= 0) { const q = this.units.renderPos(k.id); if (q) { k.x = q.x; k.z = q.z; } }
      const pop = Math.min(1, age / 140), fade = age > MARK_LIFE - 350 ? (MARK_LIFE - age) / 350 : 1;
      const sc = (0.6 + pop * 0.4) * Math.min(zk, 2) * (k.kind === 'attack' ? 1 + Math.sin(age / 90) * 0.06 : 1);
      k.obj.position.set(k.x, heightY(this.t, k.x, k.z) + (k.kind === 'attack' ? 0.12 : 0.02), k.z);
      k.obj.scale.setScalar(sc);
      if (k.kind === 'attack') k.obj.rotation.y = age / 600;
      k.obj.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined; if (m) m.opacity = fade; });
      const ring = k.obj.getObjectByName('ring');
      if (ring) { const r = 1 + (age / MARK_LIFE) * 1.2; ring.scale.set(r, 1, r); }
    }
  }
}
