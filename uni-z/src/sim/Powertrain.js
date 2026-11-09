import { POWERTRAINS, ICE_VARIANTS } from '../config/vehicle.js';
import { interp1, clamp, lerp } from '../util/math.js';

const RPM_PER_RADS = 60 / (2 * Math.PI);
const THROTTLE_MAP = { Eco: (t) => Math.pow(t, 1.6) * 0.85, Normal: (t) => Math.pow(t, 1.15), Sport: (t) => Math.pow(t, 0.85) };
const SHIFT = {
  Eco: { up: [2100, 1700], down: [1150, 1200] },
  Normal: { up: [2500, 3300], down: [1350, 1700] },
  Sport: { up: [3600, 2600], down: [2200, 1600] },
};

// 1.5T + 7DCT and PHEV iDD drive units. Output: torque per driven (front) wheel.
export class Powertrain {
  constructor(kind = 'ICE', iceVariant = 'CN188') {
    this.kind = kind;
    this.ice = POWERTRAINS.ICE;
    this.phev = POWERTRAINS.PHEV;
    this.curve = ICE_VARIANTS[iceVariant].torqueCurve;
    this.variant = iceVariant;
    this.mode = 'Normal';
    this.selector = 'P';    // P R N D
    this.gear = 1;          // 1..7 for the DCT
    this.manual = false;
    this.rpm = this.ice.idleRpm;
    this.boost = 0;
    this.shiftTimer = 0;
    this.fuelL = this.ice.fuelTankL * 0.7;
    this.soc = 0.82;
    this.engineOn = false;
    this.parallel = false;
    this.highDemandT = 0;
    this.powerKw = 0;
    this.regenTorque = 0;
    this.brakeBlend = 1;
    this.fuelRateLph = 0;
    this.autoReverse = true;
    this.reverseHold = 0;
  }

  setMode(m) { this.mode = m; }

  // driver intent → selector (P/R/N/D) with the "hold brake at standstill to reverse" convenience
  handleSelector(input, speed, dt) {
    if (input.select) { this.selector = input.select; input.select = null; }
    if (!this.autoReverse) return;
    const still = Math.abs(speed) < 0.4;
    if (this.selector === 'P' && (input.throttle > 0.05 || input.brake > 0.05)) this.selector = 'D';
    if (still && this.selector === 'D' && input.brake > 0.5 && input.throttle < 0.05) {
      this.reverseHold += dt;
      if (this.reverseHold > 0.45) { this.selector = 'R'; this.reverseHold = 0; }
    } else if (still && this.selector === 'R' && input.throttle > 0.5 && input.brake < 0.05) {
      this.reverseHold += dt;
      if (this.reverseHold > 0.2) { this.selector = 'D'; this.reverseHold = 0; }
    } else this.reverseHold = 0;
  }

  // In R the pedals swap meaning (arcade convention): S drives backwards, W brakes.
  pedals(input) {
    if (this.selector === 'R') return { throttle: input.brake, brake: input.throttle };
    return { throttle: input.throttle, brake: input.brake };
  }

  // wheelOmega: mean driven-wheel speed (rad/s); speed: forward speed (m/s); mass for regen scaling
  update(dt, { throttle, brake, wheelOmega, speed, mass, wheelRadius, shiftUp, shiftDown, tcsFactor = 1 }) {
    return this.kind === 'PHEV'
      ? this.updatePHEV(dt, throttle, brake, wheelOmega, speed, mass, wheelRadius, tcsFactor)
      : this.updateICE(dt, throttle, brake, wheelOmega, speed, shiftUp, shiftDown, tcsFactor);
  }

  torqueAt(rpm) { return interp1(this.curve, rpm); }

  updateICE(dt, throttleIn, brake, wOmega, speed, shiftUp, shiftDown, tcsFactor) {
    const ice = this.ice;
    const thr = THROTTLE_MAP[this.mode](clamp(throttleIn, 0, 1)) * tcsFactor;
    const sel = this.selector;
    if (sel === 'P' || sel === 'N') {
      const target = ice.idleRpm + thr * 4800;
      this.rpm = lerp(this.rpm, target, 1 - Math.exp(-dt * (thr > this.rpm / 6000 ? 5 : 2.5)));
      this.powerKw = 0; this.fuelRateLph = 0.7 + thr * 4;
      this.burnFuel(dt);
      return { torquePerWheel: 0, locked: sel === 'P' };
    }
    // gear changes
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    const ratioOf = (g) => (sel === 'R' ? ice.reverseRatio : ice.gearRatios[g - 1]) * ice.finalDrive;
    const wheelRpm = Math.abs(wOmega) * RPM_PER_RADS;
    if (sel === 'D') {
      if (this.manual) {
        if (shiftUp && this.gear < 7) { this.gear++; this.shiftTimer = ice.shiftTimeS; }
        if (shiftDown && this.gear > 1 && wheelRpm * ratioOf(this.gear - 1) < ice.redlineRpm) { this.gear--; this.shiftTimer = ice.shiftTimeS; }
        if (wheelRpm * ratioOf(this.gear) < 1000 && this.gear > 1) { this.gear--; this.shiftTimer = ice.shiftTimeS; }
      } else if (this.shiftTimer <= 0) {
        const sh = SHIFT[this.mode];
        const up = Math.min(ice.redlineRpm - 150, sh.up[0] + thr * sh.up[1]);
        const down = sh.down[0] + thr * sh.down[1];
        const rpmHere = wheelRpm * ratioOf(this.gear);
        if (rpmHere > up && this.gear < 7) { this.gear++; this.shiftTimer = ice.shiftTimeS; }
        else if (this.gear > 1 && (rpmHere < down || (throttleIn > 0.95 && wheelRpm * ratioOf(this.gear - 1) < 5600 && rpmHere < 4200))) { this.gear--; this.shiftTimer = ice.shiftTimeS; }
      }
    } else this.gear = 1;
    const ratio = ratioOf(this.gear);
    const rpmWheels = wheelRpm * ratio;
    // launch clutch: slips until the wheels catch up with the launch speed
    const launchRpm = ice.idleRpm + 550 + thr * 1900;
    const slipping = rpmWheels < launchRpm && thr > 0.02;
    let targetRpm = slipping ? Math.max(rpmWheels, launchRpm) : Math.max(rpmWheels, ice.idleRpm * (thr > 0 ? 1 : 0.98));
    if (!slipping && rpmWheels < ice.idleRpm) targetRpm = ice.idleRpm;
    this.rpm = lerp(this.rpm, targetRpm, 1 - Math.exp(-dt * (slipping ? 7 : 25)));
    // turbo
    const boostTarget = this.rpm > ice.turboOnsetRpm ? thr : thr * 0.35;
    this.boost += (boostTarget - this.boost) * Math.min(1, dt / ice.turboLagS);
    let te = this.torqueAt(this.rpm) * thr * (0.62 + 0.38 * this.boost);
    if (thr < 0.02) te = -(14 + this.rpm * 0.0045); // engine braking
    if (this.rpm > ice.limiterRpm) te = Math.min(te, 0);
    // creep in D/R with no pedal (idle torque through the slipping clutch)
    const creepMax = ice.creepKmh / 3.6;
    if (thr < 0.02 && brake < 0.05 && Math.abs(speed) < creepMax) te = 22 * (1 - Math.abs(speed) / creepMax);
    else if (thr < 0.02 && Math.abs(speed) < 3) te = 0;
    if (this.shiftTimer > 0) te *= 0.4;
    if (speed * 3.6 > ice.vmaxKmh && te > 0) te *= Math.max(0, 1 - (speed * 3.6 - ice.vmaxKmh) / 3);
    const dir = sel === 'R' ? -1 : 1;
    const torquePerWheel = (te * ratio * ice.driveEfficiency) / 2 * dir;
    this.powerKw = Math.max(0, te) * this.rpm / RPM_PER_RADS / 1000;
    this.fuelRateLph = 0.6 + this.powerKw * 0.245 / 0.745 * 1.0;
    this.burnFuel(dt);
    return { torquePerWheel, locked: false };
  }

  burnFuel(dt) { this.fuelL = Math.max(0, this.fuelL - (this.fuelRateLph / 3600) * dt); }

  updatePHEV(dt, throttleIn, brake, wOmega, speed, mass, wheelR, tcsFactor) {
    const P = this.phev;
    const thr = THROTTLE_MAP[this.mode](clamp(throttleIn, 0, 1)) * tcsFactor;
    const sel = this.selector;
    const motorOmega = Math.abs(wOmega) * P.reduction;
    this.rpm = motorOmega * RPM_PER_RADS;
    let tm = 0;
    if (sel === 'D' || sel === 'R') {
      const pMax = (this.soc > 0.03 || this.engineOn ? P.motorPowerKw : 40) * 1000;
      const tMax = Math.min(P.motorTorqueNm, pMax / Math.max(1, motorOmega));
      tm = thr * tMax;
      if (motorOmega * RPM_PER_RADS > P.motorMaxRpm) tm = 0;
      if (Math.abs(speed) * 3.6 > P.vmaxKmh && tm > 0) tm *= Math.max(0, 1 - (Math.abs(speed) * 3.6 - P.vmaxKmh) / 3);
      // regenerative braking: coast + pedal, blended with friction brakes
      const v = Math.abs(speed);
      let regenForce = 0;
      if (thr < 0.02 && v > 1.5) regenForce = 0.05 * mass * 9.81 * (this.mode === 'Eco' ? 1.5 : 1);
      if (brake > 0.02 && v > 1.0) regenForce += Math.min(brake, 0.4) / 0.4 * P.regenMaxG * mass * 9.81 * 0.85;
      if (this.soc > 0.97) regenForce = 0;
      const regenTorqueMotor = (regenForce * wheelR) / P.reduction;
      if (regenForce > 0) tm = -Math.min(regenTorqueMotor, P.motorTorqueNm);
      this.brakeBlend = brake > 0.02 ? clamp(1 - (regenForce / (mass * 9.81 * Math.max(0.05, brake))) * 0.9, 0.15, 1) : 1;
      // creep
      const creepMax = 6 / 3.6;
      if (thr < 0.02 && brake < 0.05 && v < creepMax) tm = 18 * (1 - v / creepMax);
    }
    const pElec = tm >= 0 ? (tm * motorOmega) / P.driveEfficiency : tm * motorOmega * P.driveEfficiency;
    this.powerKw = (tm * motorOmega) / 1000;
    // engine as generator (series), direct drive at cruise (parallel)
    const demandHigh = this.powerKw > 120;
    this.highDemandT = demandHigh ? this.highDemandT + dt : Math.max(0, this.highDemandT - dt);
    const vKmh = Math.abs(speed) * 3.6;
    const wantEngine = this.soc < P.evSocMin || this.highDemandT > 0.6 || vKmh > 125 || (this.mode !== 'Eco' && this.soc < 0.32);
    if (wantEngine && sel !== 'P') this.engineOn = true;
    if (this.engineOn && this.soc > P.evSocMin + 0.08 && this.highDemandT === 0 && vKmh < 115) this.engineOn = false;
    this.parallel = this.engineOn && vKmh > P.parallelKmh && thr < 0.6;
    const pGen = this.engineOn ? Math.min(P.engineKw * 0.9, 25 + Math.max(0, this.powerKw) * 0.5) * 1000 * P.generatorEfficiency : 0;
    const pBatt = pElec - pGen;
    this.soc = clamp(this.soc - (pBatt * dt) / (P.batteryUsableKwh * 3.6e6), 0, 1);
    this.fuelRateLph = this.engineOn ? (pGen / 1000) * 0.235 / 0.745 + 0.5 : 0;
    this.burnFuel(dt);
    this.engineRpm = this.engineOn ? (this.parallel ? 1900 + vKmh * 12 : 1800 + pGen / 1000 * 30) : 0;
    const dir = sel === 'R' ? -1 : 1;
    return { torquePerWheel: (tm * P.reduction * P.driveEfficiency) / 2 * dir, locked: sel === 'P' };
  }

  gearLabel() {
    if (this.selector !== 'D') return this.selector;
    if (this.kind === 'PHEV') return 'D';
    return this.manual ? `M${this.gear}` : `D${this.gear}`;
  }
}
