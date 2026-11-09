import * as THREE from 'three';
import { buildBodyShell } from './BodyShell.js';
import { SurfaceProbe } from './Surface.js';
import { buildDetails } from './Details.js';
import { CarLights } from './Lights.js';
import { buildWheel, WHEEL_DESIGNS } from './Wheels.js';
import { applyPaint } from './Materials.js';
import { Interior } from './Interior.js';
import { Screens } from '../ui/Screens.js';
import { sToZ, HINGES, AXLES } from '../config/geometry.js';
import { PAINTS, TIRES, VERSIONS } from '../config/vehicle.js';
import { easeInOutCubic } from '../util/math.js';
import { mergeStatic } from '../util/merge.js';

// Assembles the procedural car: body shell parts → meshes on hinged pivots, then details, lights, wheels, interior.
export class VehicleModel {
  constructor(materials) {
    this.M = materials;
    this.root = new THREE.Group();
    this.root.name = 'UNI_Z';
    this.body = new THREE.Group(); this.body.name = 'Body';
    this.root.add(this.body);
    this.pivots = {};
    this.open = {}; // part → { target 0/1, t 0..1 }
    this.partMeshes = {};
    this.stats = {};
    this.config = { paint: PAINTS[0].id, wheels: 19, rails: true, handles: 'mechanical', twoTone: false, version: 'RU-2026', plate: 'RU' };
  }

  meshFromSoup(soup, name) {
    const { geometry, keys } = soup.toGeometry();
    const mats = keys.map((k) => this.M[k] || this.M.paint);
    const mesh = new THREE.Mesh(geometry, mats);
    mesh.name = name;
    mesh.userData.slots = keys;
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  // Pivot group whose origin is the hinge; child geometry keeps its world coordinates.
  addPivot(name, origin, children, open) {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.copy(origin);
    const inner = new THREE.Group();
    inner.position.copy(origin).multiplyScalar(-1);
    for (const c of children) if (c) inner.add(c);
    pivot.add(inner);
    pivot.userData.inner = inner;
    pivot.userData.base = origin.clone();
    pivot.userData.apply = open; // (pivot, t) => void
    this.body.add(pivot);
    this.pivots[name] = pivot;
    this.open[name] = { target: 0, t: 0 };
    return pivot;
  }

  attach(part, obj) {
    const pv = this.pivots[part];
    (pv ? pv.userData.inner : this.body).add(obj);
    return obj;
  }

  build({ quality, onStep } = {}) {
    const step = (s) => onStep && onStep(s);
    step('Кузов: лофт и CSG');
    const shell = buildBodyShell();
    this.stats.shell = shell.stats;
    const P = shell.parts;
    this.bodyMesh = this.meshFromSoup(P.body, 'BodyShell');
    this.greenMesh = this.meshFromSoup(P.green, 'Greenhouse');
    this.body.add(this.bodyMesh, this.greenMesh);

    const rad = THREE.MathUtils.degToRad;
    const doorFront = sToZ(HINGES.doorFront.s), doorRear = sToZ(HINGES.doorRear.s);
    const doors = [
      ['door_fl', new THREE.Vector3(HINGES.doorFront.x, 0, doorFront), -1, HINGES.doorFront.maxDeg],
      ['door_fr', new THREE.Vector3(-HINGES.doorFront.x, 0, doorFront), 1, HINGES.doorFront.maxDeg],
      ['door_rl', new THREE.Vector3(HINGES.doorRear.x, 0, doorRear), -1, HINGES.doorRear.maxDeg],
      ['door_rr', new THREE.Vector3(-HINGES.doorRear.x, 0, doorRear), 1, HINGES.doorRear.maxDeg],
    ];
    for (const [name, origin, sign, maxDeg] of doors) {
      const mesh = this.meshFromSoup(P[name], name);
      this.partMeshes[name] = mesh;
      this.addPivot(name, origin, [mesh], (pv, t) => { pv.rotation.y = sign * rad(maxDeg) * t; pv.rotation.z = -sign * rad(1.2) * t; });
    }
    this.partMeshes.hood = this.meshFromSoup(P.hood, 'hood');
    this.addPivot('hood', new THREE.Vector3(0, HINGES.hood.h / 1000, sToZ(HINGES.hood.s)), [this.partMeshes.hood], (pv, t) => { pv.rotation.x = -rad(HINGES.hood.maxDeg) * t; });
    this.partMeshes.tailgate = this.meshFromSoup(P.tailgate, 'tailgate');
    this.addPivot('tailgate', new THREE.Vector3(0, HINGES.tailgate.h / 1000, sToZ(HINGES.tailgate.s)), [this.partMeshes.tailgate], (pv, t) => { pv.rotation.x = rad(HINGES.tailgate.maxDeg) * t; });
    if (P.sunroof) {
      this.partMeshes.sunroof = this.meshFromSoup(P.sunroof, 'sunroof');
      this.addPivot('sunroof', new THREE.Vector3(0, 0, 0), [this.partMeshes.sunroof], (pv, t) => { pv.position.set(0, 0.032 * Math.min(1, t * 5), -0.36 * t); });
    }

    step('Детали: решётка, зеркала, спойлер');
    const t0 = performance.now();
    this.probe = new SurfaceProbe([this.bodyMesh, this.greenMesh, ...Object.values(this.partMeshes)]);
    this.details = buildDetails(this, this.probe, { plate: this.config.plate });
    step('Оптика');
    this.lights = new CarLights(this, this.probe, quality || { shadows: 0 });
    this.stats.detailsMs = performance.now() - t0;

    step('Салон и экраны');
    this.screens = new Screens();
    this.interior = new Interior(this, this.screens);
    this.interior.setVersion(VERSIONS[this.config.version]);
    step('Колёса');
    this.buildWheels(this.config.wheels);
    this.mirrorFold = { target: 0, t: 0 };
    this.optimize();
    return this;
  }

  // Fewer draw calls: merge static meshes per material (animated / toggled nodes are kept as they are)
  optimize() {
    const I = this.interior;
    const keepInterior = new Set(['SteeringColumn', 'Pedal_Brake', 'Pedal_Throttle', 'Selector_Joystick']);
    this.stats.mergedInterior = mergeStatic(I.root, (o) => keepInterior.has(o.name) || o === I.legRest);
    const keepBody = /^(Mirror_|Handle_|Plate_|RoofRails|Headlights|Taillights|Taillight_Center|Interior|BodyShell|Greenhouse|Grille_Dots|FuelDoor|ChargeDoor)/;
    this.stats.mergedBody = mergeStatic(this.body, (o) => keepBody.test(o.name) || !!this.pivots[o.name]);
    for (const pv of Object.values(this.pivots)) {
      this.stats.mergedBody += mergeStatic(pv.userData.inner, (o) => keepBody.test(o.name) || o === this.partMeshes[pv.name]);
    }
  }

  buildWheels(size) {
    if (this.wheels) for (const w of this.wheels) this.root.remove(w);
    this.wheels = [];
    const R = TIRES[size].radiusM;
    for (const [s, sideX, name] of [[AXLES.frontS, 1, 'Wheel_FL'], [AXLES.frontS, -1, 'Wheel_FR'], [AXLES.rearS, 1, 'Wheel_RL'], [AXLES.rearS, -1, 'Wheel_RR']]) {
      const w = buildWheel(this.M, size, WHEEL_DESIGNS[size], sideX);
      w.name = name;
      w.position.set(sideX * AXLES.halfTrack / 1000, AXLES.wheelCentreH / 1000, sToZ(s));
      w.userData.rest = w.position.clone();
      w.userData.front = s === AXLES.frontS;
      this.root.add(w);
      this.wheels.push(w);
    }
    this.config.wheels = size;
    // keep the tyres on the floor in the showroom: lift the car by the radius difference
    this.rideOffset = R - TIRES[19].radiusM;
  }

  // ---------------------------------------------------------------- configuration API
  setPaint(idOrHex) {
    const paint = PAINTS.find((p) => p.id === idOrHex) || { color: idOrHex, metalness: 0.6, roughness: 0.32, flake: 0.1 };
    applyPaint(this.M, paint);
    this.config.paint = paint.id || idOrHex;
  }

  setWheels(size) { if (size !== this.config.wheels) this.buildWheels(size); }

  setRails(on) { this.config.rails = on; if (this.details?.rails) this.details.rails.visible = on; }

  setHandles(style) {
    this.config.handles = style;
    for (const h of this.details?.handles || []) {
      for (const m of h.userData.mechanical) m.visible = style === 'mechanical';
      for (const m of h.userData.flush) m.visible = style === 'flush';
    }
  }

  setTwoTone(on) {
    this.config.twoTone = on;
    const slotMat = on ? this.M.black_gloss : this.M.paint;
    for (const mesh of [this.greenMesh, this.partMeshes.sunroof]) {
      if (!mesh) continue;
      mesh.material = mesh.userData.slots.map((k) => (k === 'paint_roof' ? slotMat : this.M[k] || this.M.paint));
    }
  }

  setVersion(id) {
    this.config.version = id;
    const v = VERSIONS[id];
    if (this.interior) this.interior.setVersion(v);
  }

  foldMirrors(on) { this.mirrorFold.target = on ? 1 : 0; }

  setOpen(name, open) { if (this.open[name]) this.open[name].target = open ? 1 : 0; }
  toggle(name) { if (this.open[name]) this.open[name].target = this.open[name].target ? 0 : 1; return this.open[name]?.target; }
  anyOpen() { return Object.values(this.open).some((o) => o.target > 0 || o.t > 0); }
  closeAll() { for (const o of Object.values(this.open)) o.target = 0; }

  // Wheel pose from the simulation (or showroom defaults)
  setWheelPose(i, { steer = 0, spin = 0, drop = 0 } = {}) {
    const w = this.wheels[i];
    if (!w) return;
    w.userData.steer.rotation.y = steer;
    w.userData.spin.rotation.x = spin;
    w.position.y = w.userData.rest.y - drop;
  }

  update(dt) {
    for (const [name, st] of Object.entries(this.open)) {
      if (st.t === st.target) continue;
      const speed = name === 'tailgate' ? 0.7 : name === 'sunroof' ? 0.5 : name === 'hood' ? 0.8 : 1.1;
      st.t = st.target > st.t ? Math.min(st.target, st.t + dt * speed) : Math.max(st.target, st.t - dt * speed);
      const pv = this.pivots[name];
      pv.userData.apply(pv, easeInOutCubic(st.t));
    }
    const mf = this.mirrorFold;
    if (mf && mf.t !== mf.target) {
      mf.t = mf.target > mf.t ? Math.min(1, mf.t + dt * 1.5) : Math.max(0, mf.t - dt * 1.5);
      for (const m of this.details.mirrors) m.userData.fold.rotation.y = m.userData.sign * 1.15 * easeInOutCubic(mf.t);
    }
  }
}
