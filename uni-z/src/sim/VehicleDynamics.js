import * as THREE from 'three';
import { MASS, SUSPENSION, TIRE_MODEL, BRAKES, STEERING, AERO, CHASSIS, TIRES } from '../config/vehicle.js';
import { AXLES, sToZ } from '../config/geometry.js';
import { Powertrain } from './Powertrain.js';
import { clamp, lerp } from '../util/math.js';

const G = 9.81, DEG = Math.PI / 180;
const WHEEL_INERTIA = 1.25; // kg·m², wheel + tyre + disc

// Simplified Magic Formula
export function magic(x, B, C, D, E) { const Bx = B * x; return D * Math.sin(C * Math.atan(Bx - E * (Bx - Math.atan(Bx)))); }

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();

// Rigid body (CoG frame) on four ray-cast suspension corners with Magic Formula tyres.
// World access: { heightAt(x, z), normalAt(x, z, out), surfaceAt(x, z) }.
export class VehicleDynamics {
  constructor(world, opts = {}) {
    this.world = world;
    this.assists = { abs: true, tcs: true, esp: true };
    this.flags = { abs: false, tcs: false, esp: false };
    this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3(); this.angVel = new THREE.Vector3();
    this.force = new THREE.Vector3(); this.torque = new THREE.Vector3();
    this.accelG = { x: 0, z: 0 };
    this.prevVel = new THREE.Vector3();
    this.tcsFactor = 1;
    this.steerAngle = 0;
    this.configure(opts);
  }

  configure({ powertrain = 'ICE', iceVariant = 'CN188', wheelSize = 19 } = {}) {
    const m = MASS[powertrain];
    this.kind = powertrain;
    this.mass = m.curbKg + MASS.driverKg;
    this.cogH = m.cogHeightM;
    const zF = sToZ(AXLES.frontS), zR = sToZ(AXLES.rearS);
    this.wheelbase = zF - zR;
    this.track = (2 * AXLES.halfTrack) / 1000;
    this.cogZ = zF - (1 - m.frontShare) * this.wheelbase;
    const L = 4.73, W = 1.89, H = 1.6, k = 0.85;
    this.inertia = new THREE.Vector3((this.mass / 12) * (H * H + L * L) * k * 0.8, (this.mass / 12) * (W * W + L * L) * k, (this.mass / 12) * (W * W + H * H) * k);
    this.R = TIRES[wheelSize].radiusM;
    this.wheelSize = wheelSize;
    const S = SUSPENSION, scale = powertrain === 'PHEV' ? S.phevSpringScale : 1;
    const Ls = 0.2, half = S.travelM / 2;
    this.wheels = [];
    for (const [s, side] of [[AXLES.frontS, 1], [AXLES.frontS, -1], [AXLES.rearS, 1], [AXLES.rearS, -1]]) {
      const front = s === AXLES.frontS;
      const k = (front ? S.springFrontNpm : S.springRearNpm) * scale;
      const load = (this.mass * G * (front ? m.frontShare : 1 - m.frontShare)) / 2;
      this.wheels.push({
        front, side, k, damp: front ? S.damperFront : S.damperRear, arb: front ? S.antiRollFrontNpm : S.antiRollRearNpm,
        mount: new THREE.Vector3((side * AXLES.halfTrack) / 1000, AXLES.wheelCentreH / 1000 + Ls - this.cogH, sToZ(s) - this.cogZ),
        Ls, Lmin: Ls - half, Lmax: Ls + half, L0: Ls + load / k, L: Ls, Lprev: Ls, x: 0,
        omega: 0, spin: 0, steer: 0, Fz: 0, Fx: 0, Fy: 0, slip: 0, slipAngle: 0, contact: false, locked: false,
        surface: 'asphalt', anchor: null, brakeT: 0, espT: 0, absActive: false,
        point: new THREE.Vector3(), centre: new THREE.Vector3(),
      });
    }
    const prev = this.powertrain;
    this.powertrain = new Powertrain(powertrain, iceVariant);
    if (prev) { this.powertrain.mode = prev.mode; this.powertrain.selector = prev.selector === 'R' ? 'R' : prev.selector; }
  }

  // Place the car at rest: pos = ground point under the wheelbase midpoint, heading about +Y
  reset(pos, heading = 0) {
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    const dR = this.R - TIRES[19].radiusM;
    const ground = this.world.heightAt(pos.x, pos.z);
    this.pos.set(0, this.cogH + dR, this.cogZ).applyQuaternion(this.quat).add(new THREE.Vector3(pos.x, ground, pos.z));
    this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0); this.prevVel.set(0, 0, 0);
    for (const w of this.wheels) { w.L = w.Lprev = w.Ls; w.omega = 0; w.anchor = null; w.slip = 0; }
    this.powertrain.selector = 'P';
    this.powertrain.gear = 1;
  }

  get speed() { return this.vel.dot(v4.set(0, 0, 1).applyQuaternion(this.quat)); }

  // Model root pose (origin on the ground under the wheelbase midpoint at rest)
  rootPose(outPos, outQuat) {
    outQuat.copy(this.quat);
    outPos.set(0, this.cogH, this.cogZ).applyQuaternion(this.quat).multiplyScalar(-1).add(this.pos);
  }

  step(dt, input) {
    const pt = this.powertrain, q = this.quat, W = this.wheels;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const speed = this.vel.dot(fwd);
    pt.handleSelector(input, speed, dt);
    const ped = pt.pedals(input);

    // steering with speed-dependent limit and Ackermann geometry (+ = left)
    const vAbs = Math.abs(speed);
    const maxDeg = lerp(STEERING.maxWheelAngleDeg, STEERING.highSpeedAngleDeg, clamp((vAbs * 3.6 - 20) / 130, 0, 1));
    const d = clamp(input.steer, -1, 1) * maxDeg * DEG;
    this.steerAngle = d;
    if (Math.abs(d) > 1e-4) {
      const Rt = this.wheelbase / Math.tan(Math.abs(d));
      const inner = Math.atan(this.wheelbase / (Rt - this.track / 2)), outer = Math.atan(this.wheelbase / (Rt + this.track / 2));
      const sgn = Math.sign(d);
      W[0].steer = sgn * (sgn > 0 ? inner : outer); // front-left
      W[1].steer = sgn * (sgn > 0 ? outer : inner); // front-right
    } else { W[0].steer = W[1].steer = 0; }

    const drive = pt.update(dt, {
      throttle: ped.throttle, brake: ped.brake, wheelOmega: (W[0].omega + W[1].omega) / 2, speed, mass: this.mass,
      wheelRadius: this.R, shiftUp: input.shiftUp, shiftDown: input.shiftDown, tcsFactor: this.assists.tcs ? this.tcsFactor : 1,
    });
    input.shiftUp = input.shiftDown = false;

    const F = this.force.set(0, -this.mass * G, 0), T = this.torque.set(0, 0, 0);
    const addForce = (f, at) => { F.add(f); T.add(v1.subVectors(at, this.pos).cross(f)); };
    const down = v2.copy(up).negate();

    // ---- suspension
    for (const w of W) {
      const M = w.centre.copy(w.mount).applyQuaternion(q).add(this.pos);
      let t = w.Ls + this.R;
      for (let it = 0; it < 3; it++) {
        const px = M.x + down.x * t, pz = M.z + down.z * t;
        const h = this.world.heightAt(px, pz);
        t = (M.y - h) / Math.max(0.2, -down.y);
      }
      const L = t - this.R;
      w.contact = L <= w.Lmax;
      w.Lraw = L;
      w.L = clamp(L, w.Lmin, w.Lmax);
      const Lvel = (w.L - w.Lprev) / dt;
      w.Lprev = w.L;
      w.x = w.Ls - w.L;
      if (w.contact) {
        let Fs = w.k * (w.L0 - w.L);
        Fs += -(Lvel < 0 ? w.damp.bump : w.damp.rebound) * Lvel;
        if (w.L < w.Lmin + 0.02) Fs += 90000 * (w.Lmin + 0.02 - w.L);
        if (L < w.Lmin) Fs += 260000 * (w.Lmin - L) - 4000 * Math.min(0, this.vel.dot(up));
        w.Fsus = Math.max(0, Fs);
      } else w.Fsus = 0;
    }
    for (const [a, b] of [[0, 1], [2, 3]]) {
      if (!W[a].contact || !W[b].contact) continue;
      const fa = W[a].arb * (W[a].x - W[b].x);
      W[a].Fsus = Math.max(0, W[a].Fsus + fa);
      W[b].Fsus = Math.max(0, W[b].Fsus - fa);
    }

    // ---- tyres
    let absAny = false, tcsSlip = 0;
    const TM = TIRE_MODEL;
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      const M = w.centre; // mount (world) – becomes wheel centre below
      w.centre.addScaledVector(down, w.L);
      if (!w.contact) {
        w.Fz = w.Fx = w.Fy = 0; w.anchor = null;
        // free-spinning wheel: drive / brake torques only
        const Tb = this.brakeTorque(w, ped, input);
        w.omega += (w.front ? drive.torquePerWheel : 0) / WHEEL_INERTIA * dt;
        const bd = (Tb * dt) / WHEEL_INERTIA;
        w.omega = Math.abs(w.omega) <= bd ? 0 : w.omega - Math.sign(w.omega) * bd;
        w.spin += w.omega * dt;
        continue;
      }
      addForce(v3.copy(up).multiplyScalar(w.Fsus), v4.copy(w.mount).applyQuaternion(q).add(this.pos));
      const Fz = w.Fsus;
      const P = w.point.copy(w.centre).addScaledVector(down, this.R);
      const n = this.world.normalAt(P.x, P.z, new THREE.Vector3());
      const wf = new THREE.Vector3().copy(fwd).multiplyScalar(Math.cos(w.steer)).addScaledVector(left, Math.sin(w.steer));
      wf.addScaledVector(n, -n.dot(wf)).normalize();
      const wl = new THREE.Vector3().crossVectors(n, wf);
      const vc = new THREE.Vector3().subVectors(P, this.pos);
      vc.crossVectors(this.angVel, vc).add(this.vel);
      const vx = vc.dot(wf), vy = vc.dot(wl);
      const surf = this.world.surfaceAt(P.x, P.z);
      w.surface = surf.label; w.surfaceKey = surf.key;
      const mu = surf.mu * clamp(1 - TM.loadSensitivityPerKn * (Fz - 4000) / 1000, 0.75, 1.15);
      const D = mu * Fz;
      const V = Math.max(Math.abs(vx), TM.lowSpeedFloorMps);
      // wheel spin: implicit update using the secant longitudinal stiffness
      let Tb = this.brakeTorque(w, ped, input);
      if (this.assists.abs && Tb > 0 && Math.abs(vx) > 1.5 && w.slip < -BRAKES.absSlipTarget) {
        Tb *= clamp(1 - (-w.slip - BRAKES.absSlipTarget) / 0.05, 0.05, 1);
        w.absActive = true; absAny = true;
      } else w.absActive = false;
      const Td = w.front ? drive.torquePerWheel : 0;
      const Cx0 = surf.B * surf.C * D;
      const Fx0 = magic(w.slip, surf.B, surf.C, D, surf.E);
      const Cs = Math.abs(w.slip) > 1e-3 ? clamp(Fx0 / w.slip, 0.05 * Cx0, Cx0) : Cx0;
      const I = WHEEL_INERTIA + (w.front && this.kind === 'ICE' ? 0.6 : 0.2);
      let om = (w.omega + (dt / I) * (Td + (Cs * this.R * vx) / V)) / (1 + (dt * Cs * this.R * this.R) / (I * V));
      const bd = (Tb * dt) / I;
      w.locked = false;
      if (drive.locked && w.front) { om = 0; w.locked = true; }
      else if (Math.abs(om) <= bd) { om = 0; w.locked = Tb > 50; }
      else om -= Math.sign(om) * bd;
      w.omega = om;
      w.spin += om * dt;
      const kappa = (om * this.R - vx) / V;
      const alpha = Math.atan2(vy, V);
      w.slip = kappa; w.slipAngle = alpha;
      let Fx = magic(kappa, surf.B, surf.C, D, surf.E);
      let Fy = -magic(alpha, surf.B * 1.2, TM.lateralC, D, surf.E);
      const m = Math.hypot(Fx, Fy) / Math.max(1e-6, D);
      if (m > 1) { Fx /= m; Fy /= m; }
      Fx -= surf.rolling * Fz * Math.tanh(vx / 0.4);
      // static hold when the wheel is locked at (near) standstill
      if (w.locked && Math.abs(vx) < 0.3 && Math.abs(vy) < 0.3) {
        if (!w.anchor) w.anchor = P.clone();
        const dx = new THREE.Vector3().subVectors(w.anchor, P);
        const fAnchor = dx.multiplyScalar(60000).addScaledVector(vc, -3500);
        const fx = fAnchor.dot(wf), fy = fAnchor.dot(wl);
        if (Math.hypot(fx, fy) < D) { Fx = fx; Fy = fy; } else w.anchor = null;
      } else w.anchor = null;
      w.Fz = Fz; w.Fx = Fx; w.Fy = Fy;
      if (w.front) tcsSlip = Math.max(tcsSlip, kappa * Math.sign(Td || 1));
      addForce(new THREE.Vector3().addScaledVector(wf, Fx).addScaledVector(wl, Fy), P);
    }

    // ---- aerodynamics
    const v = this.vel.length();
    if (v > 0.01) F.addScaledVector(this.vel, -0.5 * AERO.rhoKgM3 * CHASSIS.cd * CHASSIS.frontalAreaM2 * v);

    // ---- body-to-ground contact (keeps a rolled or bottomed-out car out of the ground)
    for (const cx of [-0.9, 0.9]) for (const cy of [0.2 - this.cogH, 1.58 - this.cogH]) for (const cz of [2.33 - this.cogZ, -2.36 - this.cogZ]) {
      const p = v3.set(cx, cy, cz).applyQuaternion(q).add(this.pos);
      const h = this.world.heightAt(p.x, p.z);
      if (p.y >= h) continue;
      const vp = v4.subVectors(p, this.pos); vp.crossVectors(this.angVel, vp).add(this.vel);
      const fn = Math.max(0, 140000 * (h - p.y) - 9000 * Math.min(0, vp.y));
      const vt = new THREE.Vector3(vp.x, 0, vp.z);
      const ft = vt.lengthSq() > 1e-6 ? vt.normalize().multiplyScalar(-Math.min(0.7 * fn, vt.length() * 8000 + 0.7 * fn)) : vt;
      addForce(new THREE.Vector3(ft.x, fn, ft.z), p.clone());
    }

    // ---- assists for the next step
    this.flags.abs = absAny;
    this.tcsFactor = tcsSlip > BRAKES.tcsSlipLimit ? clamp(1 - (tcsSlip - BRAKES.tcsSlipLimit) / 0.08, 0.1, 1) : Math.min(1, this.tcsFactor + dt * 2);
    this.flags.tcs = this.assists.tcs && this.tcsFactor < 0.98;
    this.updateESP(speed, up, dt);

    // ---- integrate (semi-implicit Euler)
    this.prevVel.copy(this.vel);
    this.vel.addScaledVector(F, dt / this.mass);
    this.pos.addScaledVector(this.vel, dt);
    const qi = q.clone().invert();
    const wb = this.angVel.clone().applyQuaternion(qi);
    const tb = T.clone().applyQuaternion(qi);
    const Iv = this.inertia;
    const Iw = new THREE.Vector3(Iv.x * wb.x, Iv.y * wb.y, Iv.z * wb.z);
    const gyro = new THREE.Vector3().crossVectors(wb, Iw);
    wb.x += ((tb.x - gyro.x) / Iv.x) * dt; wb.y += ((tb.y - gyro.y) / Iv.y) * dt; wb.z += ((tb.z - gyro.z) / Iv.z) * dt;
    this.angVel.copy(wb.applyQuaternion(q));
    const dq = new THREE.Quaternion(this.angVel.x * dt * 0.5, this.angVel.y * dt * 0.5, this.angVel.z * dt * 0.5, 0).multiply(q);
    q.x += dq.x; q.y += dq.y; q.z += dq.z; q.w += dq.w; q.normalize();
    const acc = v3.subVectors(this.vel, this.prevVel).divideScalar(dt);
    this.accelG.z = lerp(this.accelG.z, acc.dot(fwd) / G, 0.1);
    this.accelG.x = lerp(this.accelG.x, acc.dot(left) / G, 0.1);
    for (const w of W) w.centre.copy(w.mount).applyQuaternion(q).add(this.pos).addScaledVector(down, w.L);
  }

  brakeTorque(w, ped, input) {
    let Tb = ped.brake * (w.front ? BRAKES.maxTorqueFrontNm : BRAKES.maxTorqueRearNm) * (this.kind === 'PHEV' ? this.powertrain.brakeBlend : 1);
    if (!w.front && input.handbrake) Tb += BRAKES.handbrakeTorqueNm;
    return Tb + (w.espT || 0);
  }

  updateESP(speed, up, dt) {
    for (const w of this.wheels) w.espT = 0;
    this.flags.esp = false;
    if (!this.assists.esp || Math.abs(speed) < 5) return;
    const r = this.angVel.dot(up);
    const vch = 24;
    let rRef = (speed * this.steerAngle) / (this.wheelbase * (1 + (speed / vch) ** 2));
    const lim = (0.85 * G) / Math.max(1, Math.abs(speed));
    rRef = clamp(rRef, -lim, lim);
    const err = r - rRef;
    if (Math.abs(err) < 0.07) return;
    const t = clamp((Math.abs(err) - 0.07) * 5000, 0, 1800);
    const oversteer = Math.abs(r) > Math.abs(rRef) && Math.sign(r) === Math.sign(rRef || r);
    if (oversteer) this.wheels[r > 0 ? 1 : 0].espT = t;        // brake the outer front
    else this.wheels[rRef > 0 ? 2 : 3].espT = t * 0.7;           // brake the inner rear
    this.tcsFactor = Math.min(this.tcsFactor, 0.6);
    this.flags.esp = true;
  }
}
