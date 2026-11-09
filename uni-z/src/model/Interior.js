import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { INTERIOR, sToZ } from '../config/geometry.js';
import { loftSections } from './Details.js';
import { lerp } from '../util/math.js';

const P = (s, h, x = 0) => new THREE.Vector3(x / 1000, h / 1000, sToZ(s));
const rbox = (w, h, d, r, mat, seg = 3) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999), mat);

// Cabin: dashboard, screens, steering wheel, selector, pedals, seats, console, door trims, ambient light.
export class Interior {
  constructor(model, screens) {
    this.model = model;
    this.M = model.M;
    this.screens = screens;
    this.root = new THREE.Group(); this.root.name = 'Interior';
    model.body.add(this.root);
    this.buildDash();
    this.buildScreens();
    this.buildSteering();
    this.buildConsole();
    this.buildPedals();
    this.buildSeats();
    this.buildDoorTrims();
    this.buildRoofItems();
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  }

  buildDash() {
    const M = this.M;
    // section in the side plane (s, h) lofted across the cabin width; slightly narrower towards the doors
    const sec = (x, k) => [
      [1650, 1078], [1900, 1072], [2060, 1060], [2140, 1035], [2170, 990], [2150, 940], [2105, 905], [2080, 760], [1980, 600], [1800, 520], [1660, 640], [1640, 900],
    ].map(([s, h]) => P(s + (1 - k) * 25, h - (1 - k) * 15, x));
    const sections = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, x = lerp(-760, 760, t), k = 1 - Math.pow(Math.abs(t * 2 - 1), 8) * 0.6;
      sections.push(sec(x, k));
    }
    const dash = new THREE.Mesh(loftSections(sections), M.plastic_soft);
    dash.name = 'Dashboard';
    // full-width slim air vent and trim strip, ambient light line under it
    const vent = rbox(1.36, 0.022, 0.03, 0.008, M.mesh_dark); vent.position.copy(P(2163, 978, 0));
    const trim = rbox(1.40, 0.008, 0.02, 0.003, M.satin); trim.position.copy(P(2168, 958, 0));
    const amb = new THREE.Mesh(new THREE.BoxGeometry(1.30, 0.004, 0.006), M.ambient); amb.position.copy(P(2172, 948, 0)); amb.name = 'Ambient_Dash';
    const glovebox = rbox(0.42, 0.13, 0.03, 0.01, M.plastic_light); glovebox.position.copy(P(2110, 840, -380)); glovebox.rotation.x = -0.3;
    this.root.add(dash, vent, trim, amb, glovebox);
    this.ambient = [amb];
  }

  buildScreens() {
    const M = this.M, I = INTERIOR;
    // 10.25" cluster behind the wheel
    const [cs, ch, cx] = I.cluster.centre, [cw, chh] = I.cluster.size;
    const cluster = new THREE.Group();
    const cBezel = rbox(cw / 1000 + 0.014, chh / 1000 + 0.014, 0.014, 0.004, M.screen_black);
    const cFace = new THREE.Mesh(new THREE.PlaneGeometry(cw / 1000, chh / 1000), this.screens.clusterMaterial);
    cFace.position.z = -0.0075; cFace.rotation.y = Math.PI;
    cluster.add(cBezel, cFace);
    cluster.position.copy(P(cs, ch, cx));
    cluster.rotation.x = -0.12;
    cluster.name = 'Cluster_10_25';
    // 14.6" floating centre screen on a slim stalk
    const [ss, sh, sx] = I.centreScreen.centre, [sw, shh] = I.centreScreen.size;
    const centre = new THREE.Group();
    const sBezel = rbox(sw / 1000 + 0.012, shh / 1000 + 0.012, 0.016, 0.005, M.screen_black);
    const sFace = new THREE.Mesh(new THREE.PlaneGeometry(sw / 1000, shh / 1000), this.screens.centreMaterial);
    sFace.position.z = -0.0085; sFace.rotation.y = Math.PI;
    const stalk = rbox(0.06, 0.07, 0.05, 0.01, M.piano); stalk.position.set(0, -0.09, 0.03);
    centre.add(sBezel, sFace, stalk);
    centre.position.copy(P(ss, sh, sx));
    centre.rotation.set(-0.14, THREE.MathUtils.degToRad(-I.centreScreen.yawDeg), 0);
    centre.name = 'CentreScreen_14_6';
    this.root.add(cluster, centre);
  }

  buildSteering() {
    const M = this.M, I = INTERIOR;
    const [ws, wh, wx] = I.wheelCentre;
    const col = new THREE.Group(); // steering column frame: local -Z points to the driver
    col.position.copy(P(ws, wh, wx));
    col.rotation.x = THREE.MathUtils.degToRad(-(90 - I.wheelTiltDeg)) + Math.PI / 2;
    const shroud = rbox(0.09, 0.08, 0.24, 0.03, M.plastic_soft); shroud.position.set(0, -0.01, 0.15);
    col.add(shroud);
    const wheel = new THREE.Group(); wheel.name = 'SteeringWheel';
    const R = I.wheelDiameterMm / 2000;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.0175, 14, 64), M.leather);
    rim.scale.set(1, 0.96, 1.15);
    const hub = rbox(0.11, 0.085, 0.05, 0.02, M.leather); hub.position.z = 0.012;
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.016, 20), M.chrome); badge.position.z = -0.015; badge.rotation.y = Math.PI;
    wheel.add(rim, hub, badge);
    this.spokes2 = new THREE.Group();
    for (const sgn of [1, -1]) {
      const sp = rbox(R * 0.95, 0.034, 0.02, 0.008, M.leather); sp.position.set(sgn * R * 0.52, -0.012, 0.006);
      const btn = rbox(0.05, 0.026, 0.008, 0.004, M.piano); btn.position.set(sgn * R * 0.55, 0.012, -0.006);
      this.spokes2.add(sp, btn);
    }
    this.spokes3 = new THREE.Group();
    for (const ang of [0, Math.PI, -Math.PI / 2]) {
      const sp = rbox(ang === -Math.PI / 2 ? 0.026 : R * 0.95, ang === -Math.PI / 2 ? R * 0.9 : 0.03, 0.02, 0.008, M.leather);
      sp.position.set(Math.cos(ang) * R * 0.52, Math.sin(ang) * R * 0.5, 0.006);
      this.spokes3.add(sp);
    }
    for (const sgn of [1, -1]) { // physical buttons on the 2026 wheel
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 12), M.satin); b.rotation.x = Math.PI / 2; b.position.set(sgn * (R * 0.42 + i * 0.016), 0.006, -0.012); this.spokes3.add(b); }
    }
    wheel.add(this.spokes2, this.spokes3);
    col.add(wheel);
    this.steeringWheel = wheel;
    // stalks: indicator (left) and wiper / column selector (right)
    const stalk = (side, len, mat) => { const s = rbox(len, 0.012, 0.012, 0.005, mat); s.position.set(side * (0.06 + len / 2), 0.0, 0.07); col.add(s); return s; };
    this.indicatorStalk = stalk(1, 0.11, M.plastic_soft);
    this.wiperStalk = stalk(-1, 0.1, M.plastic_soft);
    this.columnSelector = rbox(0.075, 0.02, 0.016, 0.006, M.satin);
    this.columnSelector.position.set(-0.1, 0.035, 0.065);
    col.add(this.columnSelector);
    col.name = 'SteeringColumn';
    this.root.add(col);
    this.column = col;
  }

  buildConsole() {
    const M = this.M;
    // floating bridge from the dash to the armrest, open storage below
    const bridge = rbox(0.21, 0.035, 0.72, 0.012, M.piano);
    bridge.position.copy(P(2440, 745, 0)); bridge.rotation.x = -0.18;
    const base = rbox(0.24, 0.16, 0.62, 0.03, M.plastic_soft); base.position.copy(P(2500, 470, 0));
    const charge = rbox(0.12, 0.004, 0.16, 0.003, M.mesh_dark); charge.position.copy(P(2260, 787, 0)); charge.rotation.x = -0.18;
    const arm = rbox(0.2, 0.08, 0.34, 0.03, M.leather); arm.position.copy(P(2850, 730, 0));
    const cup = (x) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.034, 0.02, 24, 1, true), M.ambient); c.position.copy(P(2620, 760, x)); c.material = M.ambient; return c; };
    this.root.add(bridge, base, charge, arm, cup(-45), cup(45));
    // joystick selector (2024-25 / RU)
    const joy = new THREE.Group();
    const knob = rbox(0.045, 0.06, 0.07, 0.02, M.leather); knob.position.y = 0.035;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 8, 24), M.satin); ring.rotation.x = Math.PI / 2;
    joy.add(knob, ring);
    joy.position.copy(P(INTERIOR.joystick[0], 770, 0));
    joy.rotation.x = -0.18;
    joy.name = 'Selector_Joystick';
    this.joystick = joy;
    this.root.add(joy);
  }

  buildPedals() {
    const M = this.M;
    const pedal = (x, w, h, name) => {
      const pivot = new THREE.Group();
      pivot.position.copy(P(1830, 560, x));
      const arm = rbox(0.016, 0.2, 0.016, 0.005, M.metal_dark); arm.position.set(0, -0.1, 0.02);
      const pad = rbox(w, h, 0.012, 0.006, M.trim_black); pad.position.set(0, -0.2, 0.04); pad.rotation.x = 0.35;
      pivot.add(arm, pad);
      pivot.name = name;
      this.root.add(pivot);
      return pivot;
    };
    this.brakePedal = pedal(320, 0.1, 0.07, 'Pedal_Brake');
    this.throttlePedal = pedal(470, 0.05, 0.12, 'Pedal_Throttle');
  }

  seat(x, { legRest = false } = {}) {
    const M = this.M, g = new THREE.Group();
    const cushion = rbox(0.5, 0.12, 0.52, 0.05, M.leather); cushion.position.set(0, 0, 0);
    const cIns = rbox(0.3, 0.02, 0.44, 0.01, M.fabric); cIns.position.set(0, 0.06, -0.01);
    const back = new THREE.Group();
    const bMain = rbox(0.5, 0.66, 0.13, 0.05, M.leather); bMain.position.set(0, 0.33, 0);
    const bIns = rbox(0.28, 0.52, 0.02, 0.01, M.fabric); bIns.position.set(0, 0.33, -0.066);
    const bolL = rbox(0.08, 0.5, 0.12, 0.035, M.leather); bolL.position.set(0.22, 0.3, -0.05); bolL.rotation.y = -0.35;
    const bolR = bolL.clone(); bolR.position.x = -0.22; bolR.rotation.y = 0.35;
    const head = rbox(0.27, 0.21, 0.11, 0.045, M.leather); head.position.set(0, 0.79, 0.01);
    back.add(bMain, bIns, bolL, bolR, head);
    back.position.set(0, 0.04, 0.24); back.rotation.x = 0.42;
    g.add(cushion, cIns, back);
    if (legRest) { const lr = rbox(0.42, 0.24, 0.05, 0.02, M.leather); lr.position.set(0, -0.15, -0.27); lr.rotation.x = 0.25; g.add(lr); this.legRest = lr; }
    const [hs, hh] = INTERIOR.driverHPoint;
    g.position.copy(P(hs - 60, hh - 40, x));
    g.rotation.x = -0.12;
    g.rotation.y = Math.PI; // seat faces forward (+Z); model built facing −Z
    g.rotation.order = 'YXZ';
    return g;
  }

  buildSeats() {
    const M = this.M;
    this.driverSeat = this.seat(370);
    this.passengerSeat = this.seat(-370, { legRest: true });
    this.root.add(this.driverSeat, this.passengerSeat);
    const [rs, rh] = INTERIOR.rearHPoint;
    const bench = new THREE.Group();
    const cushion = rbox(1.26, 0.13, 0.5, 0.05, M.leather); cushion.position.set(0, 0, 0);
    const back = rbox(1.26, 0.6, 0.12, 0.05, M.leather); back.position.set(0, 0.32, 0.25); back.rotation.x = 0.3;
    for (const x of [-0.42, 0, 0.42]) {
      const ins = rbox(0.3, 0.45, 0.02, 0.01, M.fabric); ins.position.set(x, 0.32, 0.18); ins.rotation.x = 0.3; bench.add(ins);
      const hr = rbox(0.24, 0.16, 0.09, 0.04, M.leather); hr.position.set(x, 0.68, 0.36); hr.rotation.x = 0.3; bench.add(hr);
    }
    bench.add(cushion, back);
    bench.position.copy(P(rs - 120, rh - 60, 0));
    bench.rotation.y = Math.PI;
    bench.rotation.x = -0.08;
    bench.rotation.order = 'YXZ';
    bench.name = 'RearBench';
    this.root.add(bench);
  }

  buildDoorTrims() {
    const M = this.M;
    const probe = this.model.probe;
    for (const [door, s0, s1] of [['f', 1720, 2800], ['r', 2960, 3640]]) {
      for (const sign of [1, -1]) {
        const g = new THREE.Group();
        const zMid = sToZ((s0 + s1) / 2), len = (s1 - s0) / 1000;
        // inner wall position: cast from the cabin centre outwards (hits the 45 mm cavity wall)
        const hit = probe.cast(new THREE.Vector3(0, 0.72, zMid), new THREE.Vector3(sign, 0, 0));
        const xIn = hit ? hit.point.x - sign * 0.004 : sign * 0.85;
        const armrest = rbox(0.07, 0.035, len * 0.62, 0.012, M.leather); armrest.position.set(xIn - sign * 0.035, 0.66, zMid - 0.05);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, len * 0.8), M.ambient); strip.position.set(xIn - sign * 0.004, 0.86, zMid);
        const trim = rbox(0.012, 0.04, len * 0.85, 0.005, M.satin); trim.position.set(xIn - sign * 0.006, 0.9, zMid);
        const spk = new THREE.Mesh(new THREE.CircleGeometry(0.075, 28), M.mesh_dark); spk.position.set(xIn - sign * 0.003, 0.42, sToZ(s0 + 220)); spk.rotation.y = -sign * Math.PI / 2;
        const handle = rbox(0.016, 0.025, 0.11, 0.008, M.chrome); handle.position.set(xIn - sign * 0.012, 0.8, sToZ(s0 + 140));
        g.add(armrest, strip, trim, spk, handle);
        g.name = `DoorTrim_${door}${sign > 0 ? 'L' : 'R'}`;
        this.model.attach(`door_${door}${sign > 0 ? 'l' : 'r'}`, g);
        this.ambient.push(strip);
      }
    }
  }

  buildRoofItems() {
    const M = this.M;
    const mirror = rbox(0.24, 0.07, 0.03, 0.02, M.plastic_soft); mirror.position.copy(P(2300, 1440, 0));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.055), M.mirror_glass); glass.position.copy(P(2316, 1440, 0)); glass.rotation.y = Math.PI;
    const dvr = rbox(0.06, 0.04, 0.05, 0.01, M.piano); dvr.position.copy(P(2265, 1505, 0));
    const visor = (x) => { const v = rbox(0.38, 0.17, 0.025, 0.02, M.headliner); v.position.copy(P(2330, 1535, x)); v.rotation.x = -1.35; return v; };
    this.root.add(mirror, glass, dvr, visor(330), visor(-330));
  }

  // ---------------------------------------------------------------- state from the configurator / simulation
  setVersion(v) {
    const three = v.steeringWheel === 'three-spoke';
    this.spokes2.visible = !three;
    this.spokes3.visible = three;
    this.joystick.visible = v.selector === 'joystick';
    this.columnSelector.visible = v.selector === 'column';
    if (this.legRest) this.legRest.visible = !!v.legRest;
  }

  setControls({ steerWheelRad = 0, throttle = 0, brake = 0, indicator = 0 }) {
    this.steeringWheel.rotation.z = steerWheelRad;
    this.throttlePedal.rotation.x = -throttle * 0.28;
    this.brakePedal.rotation.x = -brake * 0.22;
    this.indicatorStalk.rotation.z = indicator * 0.12;
  }

  setAmbient(color, intensity) {
    this.M.ambient.emissive.set(color);
    this.M.ambient.emissiveIntensity = intensity;
  }
}
