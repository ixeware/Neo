// Reference data for the Changan UNI-Z (single source of truth). Units: SI unless the name says otherwise.
// "≈" values in the master prompt are estimates and live here as tunable parameters.

export const DIMS = {
  CN: { lengthM: 4.730, widthM: 1.890, heightM: 1.680, heightNoRailsM: 1.660, wheelbaseM: 2.795 },
  RU: { lengthM: 4.718, widthM: 1.880, heightM: 1.676, heightNoRailsM: 1.676, wheelbaseM: 2.780 },
};

export const CHASSIS = {
  trackFrontM: 1.603,
  trackRearM: 1.603,
  frontOverhangM: 0.950,
  rearOverhangM: 0.985,
  groundClearanceM: 0.180,
  cd: 0.338,
  frontalAreaM2: 2.62,
};

export const TIRES = {
  19: { label: '225/55 R19', widthM: 0.225, aspect: 0.55, rimInch: 19, radiusM: 0.365 },
  20: { label: '245/50 R20', widthM: 0.245, aspect: 0.50, rimInch: 20, radiusM: 0.377 },
};

// Paint palette: starting values, calibrate against photos.
export const PAINTS = [
  { id: 'interstellar_gray', name: 'Межзвёздный серый', cn: '星际灰', color: '#5e636a', metalness: 0.65, roughness: 0.35, flake: 0.10 },
  { id: 'star_black', name: 'Звёздный чёрный', cn: '星钻黑', color: '#0c0d10', metalness: 0.55, roughness: 0.32, flake: 0.12 },
  { id: 'star_white', name: 'Звёздный белый', cn: '星辰白', color: '#e7e8ea', metalness: 0.0, roughness: 0.30, flake: 0.04, iridescence: 0.15 },
  { id: 'moon_silver', name: 'Лунное серебро', cn: '月华银', color: '#b9bdc2', metalness: 0.85, roughness: 0.28, flake: 0.12, since: 'CN-2026-PHEV' },
];

export const VERSIONS = {
  'RU-2026': {
    label: 'Россия 2026 («Люкс» / «Техно»)',
    steeringWheel: 'two-spoke',
    selector: 'joystick',
    legRest: false,
    sunroof: true,
    wheelsDefault: 19,
    plate: 'RU',
    powertrainDefault: 'ICE',
    iceVariant: 'RU147',
  },
  'CN-2024-25': {
    label: 'Китай 2024–25',
    steeringWheel: 'two-spoke',
    selector: 'joystick',
    legRest: false,
    sunroof: true,
    wheelsDefault: 19,
    plate: 'CN',
    powertrainDefault: 'ICE',
    iceVariant: 'CN188',
  },
  'CN-2026-PHEV': {
    label: 'Китай 2026 PHEV',
    steeringWheel: 'three-spoke',
    selector: 'column',
    legRest: true,
    sunroof: true,
    wheelsDefault: 19,
    plate: 'CN',
    powertrainDefault: 'PHEV',
    iceVariant: 'CN188',
  },
};

// Engine torque curves: [rpm, N·m]. CN188 follows the official 138 kW / 300 N·m; RU147 is the 108 kW / 280 N·m tune.
export const ICE_VARIANTS = {
  CN188: {
    label: '1.5T 188 л.с. / 300 Н·м',
    powerKw: 138,
    torqueCurve: [[700, 120], [1000, 170], [1500, 300], [4000, 300], [4500, 290], [5500, 240], [6200, 205], [6500, 180]],
  },
  RU147: {
    label: '1.5T 147 л.с. / 280 Н·м',
    powerKw: 108,
    torqueCurve: [[700, 110], [1000, 160], [1500, 280], [3500, 280], [4500, 230], [5500, 188], [6200, 160], [6500, 140]],
  },
};

export const POWERTRAINS = {
  ICE: {
    label: '1.5T + 7DCT',
    idleRpm: 750,
    redlineRpm: 6200,
    limiterRpm: 6400,
    engineInertiaKgM2: 0.15,
    turboLagS: 0.4,
    turboOnsetRpm: 1800,
    gearRatios: [3.85, 2.35, 1.51, 1.08, 0.86, 0.71, 0.60],
    reverseRatio: 3.6,
    finalDrive: 4.10,
    driveEfficiency: 0.92,
    shiftTimeS: 0.2,
    creepKmh: 6,
    fuelTankL: 55,
    vmaxKmh: 200,
  },
  PHEV: {
    label: 'PHEV iDD (Blue Whale)',
    motorPowerKw: 158,
    motorTorqueNm: 330,
    motorMaxRpm: 16000,
    reduction: 9.5,
    engineKw: 72,
    engineTorqueNm: 125,
    generatorEfficiency: 0.92,
    batteryKwh: 18.4,
    batteryUsableKwh: 16.5,
    batteryVoltage: 330,
    regenMaxG: 0.25,
    evSocMin: 0.25,
    parallelKmh: 70,
    driveEfficiency: 0.93,
    vmaxKmh: 185,
  },
};

export const MASS = {
  ICE: { curbKg: 1510, cogHeightM: 0.58, frontShare: 0.59 },
  PHEV: { curbKg: 1715, cogHeightM: 0.56, frontShare: 0.54 },
  driverKg: 75,
};

export const SUSPENSION = {
  springFrontNpm: 33000,
  springRearNpm: 27000,
  phevSpringScale: 1.08,
  damperFront: { bump: 2400, rebound: 3600 },
  damperRear: { bump: 2000, rebound: 3000 },
  travelM: 0.19,
  antiRollFrontNpm: 15000,
  antiRollRearNpm: 8000,
  mountHeightM: 0.62, // strut top mount height above ground at static ride (wheel centre at 0.365)
};

export const TIRE_MODEL = {
  // Simplified Magic Formula, coefficients per surface: [B, C, D(mu), E]
  surfaces: {
    asphalt: { label: 'асфальт', B: 10, C: 1.9, mu: 1.0, E: 0.97, rolling: 0.011 },
    wet: { label: 'мокрый асфальт', B: 12, C: 2.3, mu: 0.75, E: 1.0, rolling: 0.012 },
    gravel: { label: 'гравий', B: 7, C: 1.6, mu: 0.6, E: 0.9, rolling: 0.03 },
    grass: { label: 'трава', B: 6, C: 1.6, mu: 0.45, E: 0.9, rolling: 0.04 },
    snow: { label: 'снег', B: 5, C: 2.0, mu: 0.3, E: 1.0, rolling: 0.025 },
    ice: { label: 'лёд', B: 4, C: 2.0, mu: 0.1, E: 1.0, rolling: 0.012 },
  },
  lateralC: 1.4,
  loadSensitivityPerKn: 0.05,
  lowSpeedFloorMps: 2.0,
};

for (const [k, v] of Object.entries(TIRE_MODEL.surfaces)) v.key = k;

export const BRAKES = {
  maxTorqueFrontNm: 2600,
  maxTorqueRearNm: 1300,
  absSlipTarget: 0.12,
  tcsSlipLimit: 0.10,
  handbrakeTorqueNm: 2200,
};

export const STEERING = {
  maxWheelAngleDeg: 36,
  highSpeedAngleDeg: 8,
  ratio: 14.5,
};

export const AERO = { rhoKgM3: 1.225 };

export const SELFTEST_TARGETS = {
  ICE: { zeroTo100S: [8.0, 9.5], brake100To0M: [37, 43], skidpadG: [0.78, 0.92], vmaxKmh: [190, 202] },
  PHEV: { zeroTo100S: [6.8, 8.2], brake100To0M: [37, 43], skidpadG: [0.76, 0.92], vmaxKmh: [178, 187] },
};
