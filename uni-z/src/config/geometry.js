// Body geometry tables (master prompt, sections 6–7). Drawing axes: s = mm from the front bumper tip
// rearwards, h = mm above ground, w = half-width in mm. Scene axes: +Y up, +Z forward, +X = car's left.

export const MID_S = 2347.5; // wheelbase midpoint, mm from the front tip
export const sToZ = (s) => (MID_S - s) / 1000;
export const zToS = (z) => MID_S - z * 1000;

export const AXLES = { frontS: 950, rearS: 3745, wheelCentreH: 365, halfTrack: 801.5 };

// Lower body stations: s, h_top, h_bot, w_max, h_wmax, w_top, crown
export const LOWER = [
  [5, 640, 480, 470, 560, 380, 1],
  [20, 720, 410, 650, 575, 530, 1],
  [50, 815, 345, 780, 600, 620, 1],
  [110, 905, 300, 860, 640, 680, 1],
  [180, 918, 282, 900, 710, 710, 1],
  [320, 937, 270, 930, 780, 724, 1],
  [550, 960, 265, 940, 830, 730, 1],
  [950, 1005, 250, 945, 870, 740, 1],
  [1300, 1050, 205, 945, 905, 745, 1],
  [1500, 1095, 190, 945, 930, 800, 1],
  [1700, 1110, 185, 945, 950, 890, 0],
  [2000, 1120, 185, 945, 960, 890, 0],
  [2300, 1125, 185, 945, 965, 890, 0],
  [2600, 1130, 185, 945, 970, 890, 0],
  [2900, 1135, 185, 945, 975, 890, 0],
  [3300, 1145, 190, 945, 978, 890, 0],
  [3745, 1165, 220, 945, 982, 890, 0],
  [4000, 1195, 260, 942, 990, 887, 0],
  [4200, 1255, 290, 935, 1000, 880, 0],
  [4320, 1235, 305, 925, 1005, 870, 0],
  [4420, 1210, 320, 912, 1010, 857, 0],
  [4530, 1180, 335, 885, 1012, 830, 0],
  [4640, 1140, 348, 835, 1010, 780, 1],
  [4680, 1095, 356, 805, 990, 740, 1],
  [4705, 1050, 365, 775, 960, 720, 1],
];

// Greenhouse stations: s, h_top, h_belt, w_top, w_belt
export const GREEN = [
  [1500, 1100, 1100, 700, 700],
  [1640, 1170, 1108, 692, 880],
  [1700, 1205, 1110, 690, 890],
  [2000, 1405, 1120, 680, 890],
  [2300, 1585, 1125, 675, 890],
  [2600, 1648, 1130, 672, 890],
  [2900, 1660, 1135, 672, 890],
  [3300, 1648, 1145, 665, 890],
  [3745, 1612, 1165, 650, 890],
  [4000, 1583, 1195, 635, 887],
  [4200, 1555, 1255, 615, 880],
  [4320, 1535, 1235, 605, 870],
  [4420, 1415, 1205, 612, 850],
  [4530, 1290, 1170, 642, 815],
  [4640, 1140, 1140, 690, 780],
];

export const LOFT = {
  lowerPerSeg: 6,
  lowerRings: 260,
  greenPerSeg: 8,
  greenRings: 440,
  capFrontBulgeM: 0.005,
  capRearBulgeM: 0.025,
  maxHalfWidthM: 0.945,
  minUnderbodyM: 0.18,
};

// Greenhouse point rows (greenPerSeg = 8): G0 = 0, G1 = 8, G2 = 16 (roof edge), G3 = 24 (top of side glass), G4 = 32 (belt)
export const GROWS = { G2: 16, G3: 24, G4: 32 };

export const GZONES = {
  cowlS: 1500,
  sailEndS: 1640,
  headerS: 2330,
  bPillar: [2830, 2900],
  cPillar: [3700, 3760],
  dloTailS: 4180,
  tailgateFromS: 4250,
  roofEndS: 4260,
  sunroof: { fromS: 2380, toS: 3950, halfW: 0.56, slideToS: 3000 },
};

export const CAVITIES = {
  cabin: { fromS: 1600, toS: 4560, insetW: 45, raiseTop: 350, raiseBottom: 120, bulgeM: 0.02 },
  engine: { fromS: 150, toS: 1480, skin: 30, depth: 180, insetW: 50, bulgeM: 0.015 },
  arch: { radius: 415, length: 500, centreX: 800, wall: 22 },
};

export const PANEL_GAP_MM = 4;

// Side-view outlines (s, h) for doors, applied to |x| in [0.45, 1.3] m
export const DOOR_OUTLINES = {
  front: [[1625, 300], [1625, 1000], [1650, 1110], [1950, 1345], [2250, 1540], [2600, 1600], [2865, 1600], [2865, 300]],
  rear: [[2885, 300], [2885, 1600], [3300, 1588], [3700, 1550], [3720, 1520], [3720, 800], [3527, 742], [3412, 645], [3336, 514], [3310, 365], [3310, 300]],
};
// Hood: top view, s range and half-width = w_top(s) − 10 mm; vertical prism from y = 0.84 m
export const HOOD = { fromS: 115, toS: 1495, edgeInsetMm: 10, bottomY: 0.84 };
// Tailgate: rear view outline (x, h) in metres/mm, prism along Z from s = 4560
export const TAILGATE = {
  fromS: 4560,
  outline: [[-700, 1320], [700, 1320], [740, 1060], [660, 760], [620, 720], [-620, 720], [-660, 760], [-740, 1060]],
};

export const HINGES = {
  doorFront: { s: 1625, x: 0.905, maxDeg: 68 },
  doorRear: { s: 2885, x: 0.915, maxDeg: 70 },
  hood: { s: 1482, h: 1085, maxDeg: 55 },
  tailgate: { s: 4245, h: 1560, maxDeg: 85 },
  fuelDoor: { s: 4150, h: 1000, side: -1 },
  chargeDoor: { s: 1250, h: 950, side: 1 },
};

export const DETAILS = {
  headlight: { fromS: 30, toS: 330, hLow: 795, hHigh: 865, xInner: 470, xOuter: 880 },
  grille: { topH: 780, topHalfW: 620, botH: 330, botHalfW: 420, pitch: 26, dotMin: 4, dotMax: 14 },
  lElements: { xIn: 620, xOut: 820, hLow: 300, hHigh: 560 },
  emblemFront: { h: 760, width: 190 },
  plateFront: { h: 420 },
  mirror: { s: [1700, 1880], h: [1100, 1230], outerX: 1040 },
  handles: { front: { s: [2480, 2650], h: 1010 }, rear: { s: [3390, 3560], h: 1030 } },
  rails: { fromS: 2400, toS: 4150, x: 600, heightMm: 30 },
  sharkFin: { s: 4100, length: 180, height: 65 },
  spoiler: { fromS: 4225, toS: 4420, halfW: 600, thick: 40 },
  taillight: { hLow: 1045, hHigh: 1090, halfW: 800, sideToS: 4600, centreHalfW: 620 },
  lettering: { h: 970 },
  plateRear: { h: 870 },
  exhaust: { xIn: 470, xOut: 690, hLow: 405, hHigh: 462 },
  reflectors: { hLow: 450, hHigh: 600 },
  wipers: { s: 1520 },
};

export const INTERIOR = {
  driverEye: [2800, 1240, 370],
  driverHPoint: [2700, 620, 370],
  wheelCentre: [2260, 990, 370],
  wheelDiameterMm: 370,
  wheelTiltDeg: 22,
  pedals: { s: 1850, h: [330, 470] },
  dashTopH: 1060,
  cluster: { centre: [2170, 1075, 370], size: [244, 91] },
  centreScreen: { centre: [2050, 1065, 0], size: [323, 182], yawDeg: 8 },
  joystick: [2450, 720, 0],
  console: { s: [2350, 2950], h: [600, 760] },
  rearHPoint: [3550, 680, 400],
  trunkFloorH: 720,
};

// Section control points (master prompt 6.3). Tables in mm → metres; returns [y, h] pairs from top centre down.
export function lowerCP([s, hTop, hBot, wMax, hWMax, wTop, crown]) {
  [hTop, hBot, wMax, hWMax, wTop] = [hTop, hBot, wMax, hWMax, wTop].map((v) => v / 1000);
  const c = 0.06 * wTop * crown, dhl = hWMax - hBot, k = Math.min(1, dhl / 0.5);
  const dw = wMax - wTop, dh = hTop - c - hWMax;
  return [[0, hTop], [0.5 * wTop, hTop - 0.25 * c], [wTop, hTop - c],
    [wTop + 0.7 * dw, hTop - c - 0.4 * dh], [wMax, hWMax],
    [wMax - 0.018, hBot + 0.55 * dhl], [wMax - 0.06 * k, hBot + 0.12 * dhl],
    [wMax - 0.13 * k, hBot], [0.5 * (wMax - 0.13 * k), hBot], [0, hBot]];
}

export function greenCP([s, hTop, hBelt, wTop, wBelt]) {
  [hTop, hBelt, wTop, wBelt] = [hTop, hBelt, wTop, wBelt].map((v) => v / 1000);
  const q = Math.min(1, Math.max(0, (hTop - hBelt) / 0.3)), c = 0.06 * wTop * q;
  return [[0, hTop], [0.5 * wTop, hTop - 0.25 * c], [wTop, hTop - c],
    [wTop + 0.035 * q, hTop - c - 0.055 * q], [wBelt, hBelt]];
}

// Linear interpolation of a station table column (by s) — used for outlines (hood width, belt height…)
export function tableAt(table, s, col) {
  if (s <= table[0][0]) return table[0][col];
  for (let i = 1; i < table.length; i++) {
    if (s <= table[i][0]) {
      const a = table[i - 1], b = table[i], t = (s - a[0]) / (b[0] - a[0]);
      return a[col] + (b[col] - a[col]) * t;
    }
  }
  return table[table.length - 1][col];
}
