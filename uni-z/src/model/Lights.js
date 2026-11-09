import * as THREE from 'three';
import { DETAILS, FRONT, sToZ, AXLES } from '../config/geometry.js';
import { orientToSurface } from './Surface.js';
import { beamCookie } from '../util/textures.js';
import { lerp, smoothstep } from '../util/math.js';

const TURN_OFF = new THREE.Color(0.05, 0.03, 0.01), TURN_ON = new THREE.Color(5.0, 2.0, 0.15);

// Grid of surface hits along a horizontal contour: rows = heights, cols = headings.
function contourGrid(probe, { cz, ys, headings }) {
  return ys.map((y) => headings.map((h) => probe.polar(0, cz, y, h)));
}

// Strip mesh from a sub-range of the grid, lifted along the surface normal
function stripMesh(grid, { rows = [0, grid.length - 1], cols = [0, grid[0].length - 1], lift = 0.004, material, name }) {
  const pos = [], nrm = [], uv = [], idx = [];
  const nr = rows[1] - rows[0] + 1, nc = cols[1] - cols[0] + 1;
  for (let r = rows[0]; r <= rows[1]; r++) {
    for (let c = cols[0]; c <= cols[1]; c++) {
      const h = grid[r][c];
      const p = h ? h.point.clone().addScaledVector(h.normal, lift) : new THREE.Vector3();
      pos.push(p.x, p.y, p.z);
      const n = h ? h.normal : new THREE.Vector3(0, 0, 1);
      nrm.push(n.x, n.y, n.z);
      uv.push((c - cols[0]) / Math.max(1, nc - 1), (r - rows[0]) / Math.max(1, nr - 1));
    }
  }
  for (let r = 0; r < nr - 1; r++) for (let c = 0; c < nc - 1; c++) {
    const a = r * nc + c, b = a + 1, d = a + nc, e = d + 1;
    const ok = [a, b, d, e].every((k) => grid[rows[0] + Math.floor(k / nc)][cols[0] + (k % nc)]);
    if (ok) idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // winding to agree with normals
  const P = g.attributes.position, A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  let agree = 0;
  for (let i = 0; i < idx.length; i += 3) {
    A.fromBufferAttribute(P, idx[i]); B.fromBufferAttribute(P, idx[i + 1]); C.fromBufferAttribute(P, idx[i + 2]);
    B.sub(A); C.sub(A); B.cross(C);
    agree += B.dot(new THREE.Vector3().fromBufferAttribute(g.attributes.normal, idx[i])) > 0 ? 1 : -1;
  }
  if (agree < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); }
  const m = new THREE.Mesh(g, material);
  m.name = name || material.name;
  return m;
}

// Instanced boxes placed on grid points of one row
function pixelRow(grid, row, cols, { size, lift, material, step = 1, name }) {
  const list = [];
  for (let c = cols[0]; c <= cols[1]; c += step) if (grid[row][c]) list.push(grid[row][c]);
  const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const inst = new THREE.InstancedMesh(geo, material, list.length);
  const o = new THREE.Object3D();
  list.forEach((h, i) => {
    orientToSurface(o, h.point.clone().addScaledVector(h.normal, lift), h.normal);
    o.updateMatrix();
    inst.setMatrixAt(i, o.matrix);
  });
  inst.name = name || 'pixels';
  return inst;
}

export class CarLights {
  constructor(model, probe, quality) {
    this.model = model;
    this.M = model.M;
    this.quality = quality;
    this.state = { mode: 'drl', high: false, turn: 0, hazard: false, brake: 0, reverse: false, fog: false, welcome: 0 };
    this.blink = 0;
    this.groups = { front: new THREE.Group(), rearBody: new THREE.Group(), rearGate: new THREE.Group() };
    this.groups.front.name = 'Headlights'; this.groups.rearBody.name = 'Taillights_Body'; this.groups.rearGate.name = 'Taillight_Center';
    this.buildHeadlights(probe);
    this.buildTaillights(probe);
    this.buildSources();
    model.body.add(this.groups.front, this.groups.rearBody);
    model.attach('tailgate', this.groups.rearGate);
    this.apply();
  }

  // Headlights hidden in the grille's upper corners: a slim, sharp light guide (DRL) along the top edge that
  // wraps onto the fender, a sequential amber turn signal under it, and two LED projector modules.
  buildHeadlights(probe) {
    const F = FRONT, M = this.M;
    const cz = sToZ(650);
    this.headlightMeta = [];
    this.turnSeq = [];
    const g = this.groups.front;
    for (const sign of [1, -1]) {
      const start = probe.front(sign * F.drl.from[0], F.drl.from[1]);
      const wrap = probe.side(sign, sToZ(F.drl.wrapS), F.drl.wrapY);
      if (!start || !wrap) continue;
      const th0 = Math.atan2(Math.abs(start.point.x), start.point.z - cz);
      const th1 = Math.atan2(Math.abs(wrap.point.x), wrap.point.z - cz);
      const N = 56, rows = [[], []], seq = [];
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const th = sign * lerp(th0, th1, Math.pow(t, 0.92));
        const yMid = lerp(F.drl.from[1], F.drl.wrapY, smoothstep(0, 1, t * 1.15));
        const half = (F.drl.width / 2) * (t > 0.8 ? 1 - ((t - 0.8) / 0.2) * 0.75 : 1);
        rows[0].push(probe.polar(0, cz, yMid - half, th));
        rows[1].push(probe.polar(0, cz, yMid + half, th));
        if (t > 0.42 && t < 0.93 && i % 2 === 0) seq.push(probe.polar(0, cz, yMid - half - 0.0075, th));
      }
      g.add(stripMesh(rows, { lift: 0.0045, material: M.led_drl, name: 'DRL' }));
      // sequential turn signal: instanced segments with per-instance HDR colour
      const segs = seq.filter(Boolean);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      mat.name = 'turn_seq';
      const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.005, 0.003), mat, segs.length);
      const o = new THREE.Object3D();
      segs.forEach((h, i) => {
        orientToSurface(o, h.point.clone().addScaledVector(h.normal, 0.004), h.normal);
        o.updateMatrix(); inst.setMatrixAt(i, o.matrix); inst.setColorAt(i, TURN_OFF);
      });
      inst.name = 'Turn_Front_Seq';
      g.add(inst);
      this.turnSeq.push({ inst, side: sign, n: segs.length });
      // LED projector modules in the wing-free upper corners of the grille
      for (const [px, py] of F.projectors) {
        const h = probe.front(sign * px, py);
        if (!h) continue;
        const proj = new THREE.Group();
        const R = F.projectorR, ring = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.004, R - 0.004, 0.01, 32, 1, true), M.reflector);
        ring.rotation.x = Math.PI / 2;
        const lensDisc = new THREE.Mesh(new THREE.CircleGeometry(R - 0.008, 32), M.led_beam);
        lensDisc.position.z = 0.005;
        const bezel = new THREE.Mesh(new THREE.RingGeometry(R - 0.004, R, 32), M.housing);
        bezel.position.z = 0.004;
        proj.add(ring, lensDisc, bezel);
        orientToSurface(proj, h.point.clone().addScaledVector(h.normal, 0.003), h.normal);
        proj.name = 'Projector';
        g.add(proj);
        this.headlightMeta.push({ sign, point: h.point.clone(), normal: h.normal.clone() });
      }
    }
    // keep one beam per side for the real light sources
    this.headlightMeta = this.headlightMeta.filter((m, i, arr) => arr.findIndex((o) => o.sign === m.sign) === i);
  }

  buildTaillights(probe) {
    const D = DETAILS.taillight, M = this.M;
    const cz = sToZ(4250);
    const ys = [];
    for (let i = 0; i <= 5; i++) ys.push(lerp(D.hLow, D.hHigh, i / 5) / 1000);
    const wrap = probe.side(1, sToZ(D.sideToS), 1.067);
    if (!wrap) return;
    const thMax = Math.atan2(wrap.point.x, cz - wrap.point.z);
    const N = 141, headings = [];
    for (let i = 0; i < N; i++) {
      const t = (i / (N - 1)) * 2 - 1; // −1..1
      headings.push(Math.PI - thMax * Math.sign(t) * Math.pow(Math.abs(t), 0.9));
    }
    const grid = contourGrid(probe, { cz, ys, headings });
    // split columns into centre (on the tailgate) and outer segments by |x|
    const xs = grid[2].map((h) => (h ? h.point.x : 0));
    const split = 0.728, gap = 0.012;
    let cL = -1, cR = -1;
    xs.forEach((x, i) => { if (Math.abs(x) < split - gap / 2) { if (cL < 0) cL = i; cR = i; } });
    const segs = [
      { cols: [cL, cR], group: this.groups.rearGate, centre: true },
      { cols: [0, cL - 2], group: this.groups.rearBody },
      { cols: [cR + 2, N - 1], group: this.groups.rearBody },
    ];
    this.tailMeta = [];
    for (const sg of segs) {
      if (sg.cols[1] <= sg.cols[0]) continue;
      sg.group.add(stripMesh(grid, { cols: sg.cols, lift: 0.003, material: M.housing, name: 'Tail_Housing' }));
      sg.group.add(stripMesh(grid, { cols: sg.cols, lift: 0.010, material: M.lens_red, name: 'Tail_Lens' }));
      sg.group.add(pixelRow(grid, 3, sg.cols, { size: [0.010, 0.016, 0.003], lift: 0.006, material: M.led_tail, step: 1, name: 'Tail_Pixels' }));
      if (!sg.centre) {
        sg.group.add(pixelRow(grid, 1, sg.cols, { size: [0.010, 0.010, 0.003], lift: 0.006, material: M.led_amber, step: 1, name: 'Turn_Rear' }));
      }
    }
    // reverse lamps, rear fog and reflectors in the bumper corners
    const lamp = (x, y, w, h, mat, name) => {
      const hit = probe.rear(x, y);
      if (!hit) return;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      orientToSurface(m, hit.point.clone().addScaledVector(hit.normal, 0.003), hit.normal);
      m.name = name;
      this.groups.rearBody.add(m);
    };
    for (const sign of [1, -1]) {
      lamp(sign * 0.69, 0.585, 0.024, 0.10, M.led_reverse, 'Reverse');
      lamp(sign * 0.725, 0.585, 0.016, 0.10, sign > 0 ? M.led_fog : M.reflector_red, sign > 0 ? 'Fog_Rear' : 'Reflector');
    }
  }

  buildSources() {
    const q = this.quality;
    this.sources = { low: [], high: [], reverse: null, tail: null };
    const cookieLow = beamCookie(false), cookieHigh = beamCookie(true);
    for (const meta of this.headlightMeta || []) {
      for (const kind of ['low', 'high']) {
        const s = new THREE.SpotLight(0xfff4e8, 0, kind === 'low' ? 70 : 140, kind === 'low' ? 0.62 : 0.42, 0.55, 1.4);
        s.position.copy(meta.point).add(new THREE.Vector3(0, 0, 0.05));
        s.target.position.set(meta.sign * (kind === 'low' ? 1.6 : 0.6), kind === 'low' ? -0.4 : 0.3, 25);
        s.map = kind === 'low' ? cookieLow : cookieHigh;
        s.castShadow = kind === 'low' && q.shadows >= 2048 && meta.sign > 0;
        s.shadow.mapSize.set(1024, 1024);
        s.shadow.bias = -0.0005;
        s.name = `Beam_${kind}_${meta.sign > 0 ? 'L' : 'R'}`;
        this.model.root.add(s, s.target);
        this.sources[kind].push(s);
      }
    }
    const rev = new THREE.SpotLight(0xffffff, 0, 25, 0.9, 0.7, 1.6);
    rev.position.set(0, 0.55, sToZ(4740));
    rev.target.position.set(0, -0.4, sToZ(4740) - 8);
    this.model.root.add(rev, rev.target);
    this.sources.reverse = rev;
    const tail = new THREE.PointLight(0xff2020, 0, 6, 2);
    tail.position.set(0, 0.8, sToZ(5900));
    this.model.root.add(tail);
    this.sources.tail = tail;
  }

  set(patch) { Object.assign(this.state, patch); this.apply(); }

  cycleMode() {
    const order = ['off', 'drl', 'park', 'low', 'auto'];
    const i = order.indexOf(this.state.mode);
    this.set({ mode: order[(i + 1) % order.length] });
    return this.state.mode;
  }

  isNightOn() { return this.state.mode === 'low' || (this.state.mode === 'auto' && this.night); }

  apply() {
    const M = this.M, st = this.state;
    const beamsOn = this.isNightOn();
    const tailOn = beamsOn || st.mode === 'park' || st.mode === 'drl' || st.mode === 'auto';
    const blinkOn = this.blink % 1 < 0.5;
    const turnL = (st.hazard || st.turn > 0) && blinkOn;
    const turnR = (st.hazard || st.turn < 0) && blinkOn;
    const welcome = st.welcome > 0;
    M.led_drl.emissiveIntensity = st.mode === 'off' ? 0 : (turnL || turnR ? 1.2 : 6.5) * (welcome ? 1.4 : 1);
    M.led_beam.emissiveIntensity = beamsOn ? (st.high ? 12 : 8) : 0.0;
    M.led_tail.emissiveIntensity = st.brake > 0.05 ? 7 : tailOn || welcome ? 1.6 : 0;
    M.led_brake.emissiveIntensity = st.brake > 0.05 ? 9 : 0;
    M.led_reverse.emissiveIntensity = st.reverse ? 6 : 0;
    M.led_fog.emissiveIntensity = st.fog ? 5 : 0;
    // amber: drive per-side via two cloned materials would cost draw calls; both sides share one material,
    // so we light it when either side is active and hide the inactive side's meshes instead.
    M.led_amber.emissiveIntensity = turnL || turnR ? 9 : 0;
    for (const m of this.amberMeshes()) m.visible = m.userData.side > 0 ? turnL || !(turnL || turnR) : turnR || !(turnL || turnR);
    // the studio is lit with far weaker units than the road at night: scale the lamps to the scene
    const k = this.sourceScale ?? 1;
    for (const s of this.sources.low) s.intensity = beamsOn ? 2600 * k : 0;
    for (const s of this.sources.high) s.intensity = beamsOn && st.high ? 7000 * k : 0;
    this.sources.reverse.intensity = st.reverse ? 40 * k : 0;
    this.sources.tail.intensity = st.brake > 0.05 && this.night ? 2.5 * k : 0;
  }

  amberMeshes() {
    if (!this._amber) {
      this._amber = [];
      this.model.root.traverse((o) => {
        if (o.material === this.M.led_amber) { const c = new THREE.Vector3(); new THREE.Box3().setFromObject(o).getCenter(c); o.userData.side = Math.sign(c.x) || 1; this._amber.push(o); }
      });
    }
    return this._amber;
  }

  // front turn signals sweep outward during the "on" half of each blink
  updateSequential() {
    const st = this.state, phase = this.blink % 1;
    const active = st.turn !== 0 || st.hazard;
    for (const t of this.turnSeq || []) {
      const sideOn = active && (st.hazard || (t.side > 0 ? st.turn > 0 : st.turn < 0)) && phase < 0.5;
      const lit = sideOn ? Math.ceil(Math.min(1, phase / 0.32) * t.n) : 0;
      for (let i = 0; i < t.n; i++) t.inst.setColorAt(i, i < lit ? TURN_ON : TURN_OFF);
      t.inst.instanceColor.needsUpdate = true;
    }
  }

  update(dt, { night = false } = {}) {
    this.night = night;
    const st = this.state;
    const prev = this.blink % 1 < 0.5;
    if (st.turn !== 0 || st.hazard) this.blink += dt * 1.5; else this.blink = 0;
    const now = this.blink % 1 < 0.5;
    if (st.welcome > 0) st.welcome = Math.max(0, st.welcome - dt);
    this.apply();
    this.updateSequential();
    return prev !== now && (st.turn !== 0 || st.hazard); // true on blinker toggle (for the click sound)
  }
}
