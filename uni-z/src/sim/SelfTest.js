import * as THREE from 'three';
import { VehicleDynamics } from './VehicleDynamics.js';
import { TIRE_MODEL, SELFTEST_TARGETS, STEERING } from '../config/vehicle.js';

// Headless dynamics checks (master prompt 11, "Самотест"). Runs the same physics as the game at 240 Hz.
const DT = 1 / 240;
const flat = (slope = 0) => ({
  heightAt: (x, z) => slope * z,
  normalAt: (x, z, out) => out.set(0, 1, -slope).normalize(),
  surfaceAt: () => TIRE_MODEL.surfaces.asphalt,
});
const input = (o = {}) => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false, select: null, ...o });

function make(kind, world = flat()) {
  const car = new VehicleDynamics(world, { powertrain: kind, iceVariant: 'CN188', wheelSize: 19 });
  car.reset(new THREE.Vector3(0, 0, 0), 0);
  return car;
}

export function runSelfTest(kind = 'ICE') {
  const res = { kind };
  // 1. settle from the reset pose
  {
    const car = make(kind), inp = input();
    let t = 0, settled = null;
    for (; t < 4; t += DT) {
      car.step(DT, inp);
      if (t > 0.2 && settled === null && car.vel.length() < 0.01 && car.angVel.length() < 0.01) settled = t;
    }
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    car.rootPose(p, q);
    res.settleS = settled ?? 99;
    res.rideHeightErrMm = p.y * 1000;
  }
  // 2. 0–100 km/h, 3. top speed (same run)
  {
    const car = make(kind), inp = input({ throttle: 1, select: 'D' });
    let t = 0, t100 = null, vmax = 0;
    for (; t < 75; t += DT) {
      car.step(DT, inp);
      const kmh = car.speed * 3.6;
      if (t100 === null && kmh >= 100) t100 = t;
      vmax = Math.max(vmax, kmh);
    }
    res.zeroTo100S = t100 ?? 99;
    res.vmaxKmh = vmax;
  }
  // 4. 100–0 km/h braking distance
  {
    const car = make(kind), inp = input({ throttle: 1, select: 'D' });
    let t = 0;
    while (car.speed * 3.6 < 100 && t < 40) { car.step(DT, inp); t += DT; }
    inp.throttle = 0; inp.brake = 1;
    const start = car.pos.clone();
    for (t = 0; t < 12 && car.speed > 0.3; t += DT) car.step(DT, inp);
    res.brake100To0M = car.pos.distanceTo(start);
  }
  // 5. skidpad R = 40 m: pure-pursuit steering, speed raised until the car leaves the circle
  {
    const R = 40;
    let best = 0;
    for (let v = 12; v <= 24; v += 0.5) {
      const car = make(kind);
      // start on the circle (centre at (-R, 0)), heading +Z, already at speed
      car.reset(new THREE.Vector3(0, 0, 0), 0);
      car.powertrain.selector = 'D';
      const fwd = new THREE.Vector3(0, 0, 1);
      car.vel.copy(fwd).multiplyScalar(v);
      for (const w of car.wheels) w.omega = v / car.R;
      const inp = input();
      let ok = true, latErr = 0;
      for (let t = 0; t < 10; t += DT) {
        const c = new THREE.Vector3(-R, 0, 0);
        const p = car.pos.clone(); p.y = 0;
        const rel = p.clone().sub(c);
        const r = rel.length();
        latErr = r - R;
        const ang = Math.atan2(rel.z, rel.x) + 8 / R; // look-ahead 8 m along the circle (counter-clockwise = left turn)
        const target = new THREE.Vector3(c.x + Math.cos(ang) * R, 0, c.z + Math.sin(ang) * R);
        const h = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quat); h.y = 0; h.normalize();
        const toT = target.clone().sub(p).normalize();
        const cross = h.z * toT.x - h.x * toT.z; // >0 → target to the left
        const alpha = Math.asin(Math.max(-1, Math.min(1, cross)));
        const delta = Math.atan((2 * car.wheelbase * Math.sin(alpha)) / 8);
        const maxDeg = STEERING.maxWheelAngleDeg + (STEERING.highSpeedAngleDeg - STEERING.maxWheelAngleDeg) * Math.max(0, Math.min(1, (Math.abs(car.speed) * 3.6 - 20) / 130));
        inp.steer = Math.max(-1, Math.min(1, delta / ((maxDeg * Math.PI) / 180)));
        const err = v - car.speed;
        inp.throttle = Math.max(0, Math.min(1, err * 0.6 + 0.25));
        inp.brake = err < -0.8 ? 0.2 : 0;
        car.step(DT, inp);
        if (t > 3 && Math.abs(latErr) > 2.5) { ok = false; break; }
      }
      if (!ok) break;
      best = v;
    }
    res.skidpadG = (best * best) / R / 9.81;
  }
  // 6. hill hold on 15 % with the handbrake only (selector N)
  {
    const car = make(kind, flat(0.15));
    car.powertrain.selector = 'N';
    const inp = input({ handbrake: true });
    for (let t = 0; t < 1.5; t += DT) car.step(DT, inp);
    const p0 = car.pos.clone();
    for (let t = 0; t < 5; t += DT) car.step(DT, inp);
    res.hillCreepM = car.pos.distanceTo(p0);
  }
  const T = SELFTEST_TARGETS[kind];
  const within = (v, [a, b]) => v >= a * 0.85 && v <= b * 1.15;
  res.checks = {
    settle: res.settleS < 1.5,
    rideHeight: Math.abs(res.rideHeightErrMm) < 20,
    zeroTo100: within(res.zeroTo100S, T.zeroTo100S),
    brake: within(res.brake100To0M, T.brake100To0M),
    skidpad: within(res.skidpadG, T.skidpadG),
    vmax: within(res.vmaxKmh, T.vmaxKmh),
    hillHold: res.hillCreepM < 0.05,
  };
  res.pass = Object.values(res.checks).every(Boolean);
  return res;
}
