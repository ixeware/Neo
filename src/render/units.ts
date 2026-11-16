// Draws sim units: instanced crowds, articulated bosses, health bars.
import * as THREE from 'three';
import { unitGeometry, unitScale, islamRig, zurabRig, PAL, type Rig } from './models';
import { heightY, type Terrain } from '../world/terrain';
import { UNITS } from '../sim/defs';
import type { Sim, U } from '../sim/sim';
import type { Particles } from './fx';

interface Vis { px: number; pz: number; x: number; z: number; yaw: number; phase: number; atk: number; hit: number; lastCd: number; seen: number }

const CAP = 170;
export const US = 1.7;
export const BS = 1.45; // units read better a bit larger than true scale

export class UnitView {
  group = new THREE.Group();
  private inst: THREE.InstancedMesh[][] = [[], []];
  private vis = new Map<number, Vis>();
  private bars: THREE.InstancedMesh; private barsFg: THREE.InstancedMesh;
  bosses: Rig[];
  private bossVis: ({ x: number; z: number; yaw: number; phase: number; atk: number; active: boolean; dead: number })[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  private v = new THREE.Vector3(); private s = new THREE.Vector3(); private c = new THREE.Color();
  private frame = 0;
  hqPos: { x: number; z: number; rot: number }[] = [];

  constructor(private t: Terrain, private sim: Sim, private particles: Particles) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (const side of [0, 1] as const) for (let type = 0; type < 5; type++) {
      const im = new THREE.InstancedMesh(unitGeometry(type, side), mat, CAP);
      im.count = 0; im.castShadow = true; im.frustumCulled = false;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
      this.inst[side].push(im); this.group.add(im);
    }
    const bg = new THREE.PlaneGeometry(1, 0.11);
    this.bars = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ color: '#15130f', depthTest: true }), CAP * 2 + 2);
    const fgG = new THREE.PlaneGeometry(1, 0.07); fgG.translate(0.5, 0, 0.001);
    this.barsFg = new THREE.InstancedMesh(fgG, new THREE.MeshBasicMaterial({ color: '#ffffff' }), CAP * 2 + 2);
    this.barsFg.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((CAP * 2 + 2) * 3), 3);
    this.bars.frustumCulled = false; this.barsFg.frustumCulled = false;
    this.bars.renderOrder = 6; this.barsFg.renderOrder = 7;
    this.group.add(this.bars, this.barsFg);
    const bmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.bosses = [islamRig(bmat), zurabRig(bmat)];
    for (const b of this.bosses) this.group.add(b.root);
    this.bossVis = [0, 1].map(() => ({ x: 0, z: 0, yaw: 0, phase: 0, atk: -9, active: false, dead: -99 }));
  }

  /** Called after each sim step. */
  capture(now: number) {
    this.frame++;
    for (const u of this.sim.st.units) {
      let v = this.vis.get(u.id);
      if (!v) { v = { px: u.x, pz: u.z, x: u.x, z: u.z, yaw: u.s === 0 ? 1.2 : -1.6, phase: Math.random() * 6, atk: -9, hit: -9, lastCd: 0, seen: this.frame }; this.vis.set(u.id, v); }
      v.px = v.x; v.pz = v.z; v.x = u.x; v.z = u.z; v.seen = this.frame;
      if (u.cd > v.lastCd) v.atk = now;
      if (u.hit === 0) v.hit = now;
      v.lastCd = u.cd;
    }
    if (this.frame % 50 === 0) for (const [id, v] of this.vis) if (this.frame - v.seen > 5) this.vis.delete(id);
  }

  resetVis() { this.vis.clear(); }

  zoomK = 1;
  update(alpha: number, now: number, dt: number, cam: THREE.Camera) {
    const counts = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
    let nb = 0;
    const camQ = cam.quaternion;
    const bossIds = [this.sim.st.sides[0].boss, this.sim.st.sides[1].boss];
    for (const u of this.sim.st.units) {
      const v = this.vis.get(u.id);
      if (!v) continue;
      const x = v.px + (v.x - v.px) * alpha, z = v.pz + (v.z - v.pz) * alpha;
      const dx = v.x - v.px, dz = v.z - v.pz;
      const moving = dx * dx + dz * dz > 1e-5;
      let want = v.yaw;
      if (moving) want = Math.atan2(dx, dz);
      else if (u.tg >= 0) { const o = this.sim.unit(u.tg); if (o) want = Math.atan2(o.x - u.x, o.z - u.z); }
      else if (u.tg === -2) { const e = this.sim.st.pts[1 - u.s]; want = Math.atan2(e.x - u.x, e.z - u.z); }
      let d = want - v.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      v.yaw += d * Math.min(1, dt * 10);
      if (moving) v.phase += Math.sqrt(dx * dx + dz * dz) * dt * 60;
      if (u.t === 5) { this.updateBoss(u, x, z, v, now, dt); continue; }
      const im = this.inst[u.s][u.t];
      const i = counts[u.s][u.t]++;
      if (i >= CAP) continue;
      const sc = unitScale(u.t, u.s) * US * this.zoomK;
      const isCar = u.t === 3 && u.s === 1;
      const bob = moving ? Math.abs(Math.sin(v.phase * (isCar ? 0.5 : 1.3))) * (isCar ? 0.05 : 0.18) : 0;
      const at = (now - v.atk) / 250;
      const lunge = at >= 0 && at < 1 ? Math.sin(at * Math.PI) * 0.4 : 0;
      const y = heightY(this.t, x, z);
      this.v.set(x + Math.sin(v.yaw) * lunge, y + bob, z + Math.cos(v.yaw) * lunge);
      const lean = moving && !isCar ? 0.1 : 0;
      this.e.set(lean + (lunge ? 0.25 : 0), v.yaw, moving && !isCar ? Math.sin(v.phase * 1.3) * 0.08 : 0);
      this.q.setFromEuler(this.e);
      const stun = u.stun > this.sim.st.tick;
      this.s.set(sc, sc * (stun ? 0.8 : 1), sc);
      this.m.compose(this.v, this.q, this.s);
      im.setMatrixAt(i, this.m);
      const ht = (now - v.hit) / 150;
      const f = ht >= 0 && ht < 1 ? 1 + (1 - ht) * 1.4 : 1;
      const slow = u.slow > this.sim.st.tick ? 1.25 : 1;
      this.c.setRGB(f * slow, f * slow, f * (slow > 1 ? 1.35 : 1));
      im.setColorAt(i, this.c);
      // health bar for wounded
      if (u.hp < u.mhp && nb < CAP * 2) {
        this.bar(nb++, x, y + (u.t === 3 && u.s === 1 ? 0.85 : 1.2) * sc, z, 1.1, u.hp / u.mhp, u.s, camQ);
      }
    }
    for (let side = 0; side < 2; side++) {
      for (let type = 0; type < 5; type++) {
        const im = this.inst[side][type];
        im.count = Math.min(CAP, counts[side][type]);
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
    // bosses (idle at home when not on the field)
    for (const s of [0, 1] as const) {
      const bv = this.bossVis[s];
      const alive = bossIds[s] >= 0 && this.sim.unit(bossIds[s]);
      if (!alive) {
        bv.active = false;
        this.idleBoss(s, now, dt);
      } else {
        const u = this.sim.unit(bossIds[s])!;
        if (nb < CAP * 2 + 2) this.bar(nb++, bv.x, heightY(this.t, bv.x, bv.z) + this.bosses[s].height * BS + 0.6, bv.z, 3.2, u.hp / u.mhp, s, camQ);
      }
    }
    this.bars.count = nb; this.barsFg.count = nb;
    this.bars.instanceMatrix.needsUpdate = true; this.barsFg.instanceMatrix.needsUpdate = true;
    if (this.barsFg.instanceColor) this.barsFg.instanceColor.needsUpdate = true;
  }

  private bar(i: number, x: number, y: number, z: number, w: number, f: number, side: number, q: THREE.Quaternion) {
    this.v.set(x, y, z); this.s.set(w, 1, 1);
    this.m.compose(this.v, q, this.s);
    this.bars.setMatrixAt(i, this.m);
    // foreground: shift left edge
    const off = new THREE.Vector3(-w / 2, 0, 0).applyQuaternion(q);
    this.v.set(x + off.x, y + off.y, z + off.z); this.s.set(Math.max(0.001, w * f), 1, 1);
    this.m.compose(this.v, q, this.s);
    this.barsFg.setMatrixAt(i, this.m);
    this.barsFg.setColorAt(i, f < 0.3 ? new THREE.Color('#ff3b2f') : PAL.side[side]);
  }

  private updateBoss(u: U, x: number, z: number, v: Vis, now: number, dt: number) {
    const s = u.s as 0 | 1;
    const rig = this.bosses[s], bv = this.bossVis[s];
    bv.active = true; bv.x = x; bv.z = z; bv.yaw = v.yaw;
    const y = heightY(this.t, x, z);
    rig.root.visible = true;
    rig.root.position.set(x, y, z);
    rig.root.rotation.y = v.yaw;
    const moving = Math.abs(v.x - v.px) + Math.abs(v.z - v.pz) > 1e-4;
    const at = (now - v.atk) / (s === 1 ? 420 : 320);
    this.pose(rig, s, moving ? v.phase * 0.5 : now / 1000, moving, at, now);
    const sc = u.stun > this.sim.st.tick ? 0.9 : 1;
    rig.root.scale.setScalar(sc * BS * Math.min(1.6, this.zoomK));
    if (s === 0) this.dandruff(rig, now, moving ? 3 : 1);
    void dt;
  }

  private idleBoss(s: 0 | 1, now: number, dt: number) {
    const rig = this.bosses[s];
    const hq = this.hqPos[s];
    if (!hq) { rig.root.visible = false; return; }
    const ox = s === 0 ? -4.6 : 5.6, oz = -3.4;
    const c = Math.cos(hq.rot), sn = Math.sin(hq.rot);
    const x = hq.x + ox * c + oz * sn, z = hq.z - ox * sn + oz * c;
    rig.root.visible = true;
    rig.root.position.set(x, heightY(this.t, x, z), z);
    rig.root.rotation.y = s === 0 ? 1.0 : -1.2;
    rig.root.scale.setScalar(BS);
    this.pose(rig, s, now / 1000, false, -9, now, true);
    if (s === 0) this.dandruff(rig, now, 1);
    void dt;
  }

  private pose(rig: Rig, s: 0 | 1, ph: number, moving: boolean, at: number, now: number, idle = false) {
    const sw = moving ? Math.sin(ph * 2.2) : 0;
    rig.legL.rotation.x = sw * 0.6; rig.legR.rotation.x = -sw * 0.6;
    rig.body.position.y = moving ? Math.abs(Math.sin(ph * 2.2)) * 0.08 : 0;
    if (at >= 0 && at < 1) {
      // attack: Zurab slams both fists, Islam flicks his hair
      const k = Math.sin(at * Math.PI);
      if (s === 1) { rig.armL.rotation.x = -2.6 * k; rig.armR.rotation.x = -2.6 * k; rig.body.rotation.x = 0.35 * k; }
      else { rig.armR.rotation.x = -1.8 * k; rig.armL.rotation.x = 0.3 * k; rig.head.rotation.z = Math.sin(at * 18) * 0.35; }
      return;
    }
    rig.body.rotation.x = 0;
    if (idle && s === 1) {
      // Zurab flexes: double biceps
      const k = (Math.sin(now / 700) + 1) / 2;
      rig.armL.rotation.set(0, 0, 1.4 * k + 0.2); rig.armR.rotation.set(0, 0, -1.4 * k - 0.2);
      rig.armL.children[0].rotation.x = 0; rig.armR.children[0].rotation.x = 0;
      rig.head.rotation.z = Math.sin(now / 900) * 0.08;
      return;
    }
    if (idle && s === 0) {
      // Islam scratches his head
      const k = (Math.sin(now / 500) + 1) / 2;
      rig.armR.rotation.set(-2.6 - 0.3 * k, 0, -0.35); rig.armL.rotation.set(0, 0, 0.05);
      rig.head.rotation.z = Math.sin(now / 160) * 0.06;
      return;
    }
    rig.armL.rotation.set(-sw * 0.5, 0, s === 1 ? 0.25 : 0.05); rig.armR.rotation.set(sw * 0.5, 0, s === 1 ? -0.25 : -0.05);
    rig.head.rotation.z = 0;
  }

  private dandruff(rig: Rig, now: number, rate: number) {
    if (Math.random() > 0.35 * rate) return;
    const p = new THREE.Vector3();
    rig.head.getWorldPosition(p);
    this.particles.emit(p.x, p.y + 0.42 * rig.root.scale.y, p.z, { n: 2, color: '#fbfaf5', size: 0.12, life: 1.8, spread: 0.2, up: -0.05, grav: 0.18, wob: 0.6, jitter: 0.5 });
    void now;
  }

  bossPos(s: 0 | 1) { const r = this.bosses[s].root; return { x: r.position.x, y: r.position.y, z: r.position.z, active: this.bossVis[s].active }; }

  static unitHeight(t: number) { return t === 5 ? 2.6 : UNITS[t].kind === 2 ? 0.8 : 1.0; }
}
