// The base on screen: draws Sim.st.bld every frame (docs/v5/BASE.md §2, §8) — models, construction, damage,
// hp bars, range rings, the build zone, the placement ghost, tower shots and trap effects.
// Models: simple placeholders per building key, written against the style module (C / mat), so they read
// in both graphics styles. The real art plugs in through setBaseModelFactory(); a missing model falls back
// to the placeholder. Hidden things (BUILDINGS[t].hid) are drawn faintly for their owner and not at all for
// the other side until BF.SEEN.
import * as THREE from 'three';
import { heightY, type Terrain } from '../world/terrain';
import type { Sim, FxEv } from '../sim/sim';
import { BUILDINGS, BKEY, BASE, BF, TICK_MS, type Side } from '../sim/defs';
import { bldVisible, type B } from '../sim/bld';
import { Builder, sebozol } from './models';
import { C, TEAM, mat, native, groundShadow } from './style';
import { drapedRing } from './world';
import type { Particles, Shots } from './fx';
import type { Stage } from './scene';
import { baseModel, baseGhostGeometry, wallKit } from './toon/base/models'; // the art: one model per key and level, the wall kit

/** A model for building `key` at `level` (1..3) of `side`, standing on y = 0, facing +z; null = use the placeholder. A child named 'head' turns to the target. */
export type BaseModelFactory = (key: string, level: number, side: Side) => THREE.Object3D | null;
let factory: BaseModelFactory | null = baseModel, factoryVer = 0;
/** The art track's models: called once per (key, level, side, state) and cached per building. */
export function setBaseModelFactory(fn: BaseModelFactory | null) { factory = fn; factoryVer++; }

const CY = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const CONE = new THREE.ConeGeometry(0.5, 1, 6);
const ICO = new THREE.IcosahedronGeometry(0.5, 0);
const PI = Math.PI;
const geoCache = new Map<string, { geo: THREE.BufferGeometry; h: number }>();

/** Placeholder models: family silhouettes of docs/v5/ART.md §5 (towers tall with a weapon on top, traps flat, economy squat with an awning, support with a sign). */
export function placeholder(key: string, lv: number, side: Side): { geo: THREE.BufferGeometry; h: number } {
  const ck = `${key}|${lv}|${side}`;
  const hit = geoCache.get(ck);
  if (hit) return hit;
  const b = new Builder(), T = TEAM[side], d = BUILDINGS[BKEY[key]];
  const body = [C.wood, C.wall[2], C.marble][lv - 1], dark = [C.woodDark, C.concrete, C.metal][lv - 1];
  const bx = (c: THREE.Color, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) => b.box(c, [x, y, z], [sx, sy, sz], [rx, ry, rz]);
  const cy = (c: THREE.Color, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) => b.add(CY, c, [x, y, z], [rx, ry, rz], [sx, sy, sz]);
  const ic = (c: THREE.Color, x: number, y: number, z: number, s: number, sy = s) => b.add(ICO, c, [x, y, z], [0, 0, 0], [s, sy, s]);
  /** Tower: plinth, team band, neck, a head wider than the neck, a team flag. Returns the y of the platform top. */
  const tower = (h: number, w = 0.72) => {
    bx(dark, 0, 0.12, 0, w + 0.5, 0.24, w + 0.5);
    bx(T.main, 0, 0.3, 0, w + 0.3, 0.14, w + 0.3);
    bx(body, 0, h / 2 + 0.2, 0, w, h, w);
    bx(dark, 0, h + 0.3, 0, w + 0.5, 0.22, w + 0.5);
    bx(C.woodDark, -(w + 0.4) / 2, h + 0.85, -(w + 0.4) / 2, 0.07, 0.9, 0.07);
    bx(T.main, -(w + 0.4) / 2 + 0.2, h + 1.15, -(w + 0.4) / 2, 0.36, 0.24, 0.05);
    return h + 0.41;
  };
  /** A shop-like box with a team awning over the front. */
  const shop = (w: number, h: number, dp: number) => {
    bx(T.main, 0, 0.07, 0, w + 0.16, 0.14, dp + 0.16);
    bx(body, 0, h / 2 + 0.1, 0, w, h, dp);
    bx(dark, 0, h + 0.16, 0, w + 0.12, 0.12, dp + 0.12);
    bx(T.main, 0, h - 0.05, dp / 2 + 0.28, w + 0.2, 0.09, 0.7, 0.3);
  };
  let studZ = 0.4, studY = 0.55;
  switch (key) {
    case 'rogatka': { const y = tower(1.3); bx(C.woodDark, 0, y + 0.25, 0, 0.16, 0.5, 0.16); bx(C.woodDark, -0.27, y + 0.75, 0, 0.13, 0.7, 0.13, 0, 0, 0.4); bx(C.woodDark, 0.27, y + 0.75, 0, 0.13, 0.7, 0.13, 0, 0, -0.4); bx(C.danger, 0, y + 0.95, -0.14, 0.72, 0.09, 0.09); ic(C.concrete, 0, y + 0.9, -0.3, 0.3); break; }
    case 'sebozol': { const y = tower(1.2, 0.8); bx(C.metalDark, 0, y + 0.14, 0, 0.6, 0.28, 0.6); sebozol(b, 3.2, [0, y + 0.95, 0.05]); break; }
    case 'sperm': { const y = tower(1.2); cy(C.white, 0, y + 0.45, -0.15, 0.8, 0.8, 0.8); cy(C.metalDark, 0, y + 0.45, 0.5, 0.26, 0.8, 0.26, PI / 2); cy(C.white, 0, y + 0.45, 0.95, 0.34, 0.14, 0.34, PI / 2); break; }
    case 'tesla': { bx(C.metalDark, 0, 0.2, 0, 1.3, 0.4, 1.3); bx(T.main, 0, 0.45, 0, 1.1, 0.12, 1.1); cy(C.woodDark, 0, 1.2, 0, 0.22, 1.5, 0.22); for (let i = 0; i < 3; i++) cy(C.metal, 0, 0.8 + i * 0.4, 0, 0.95 - i * 0.2, 0.13, 0.95 - i * 0.2); ic(C.magic, 0, 2.25, 0, 0.6); studZ = 0.66; studY = 0.2; break; }
    case 'gantel': { const y = tower(0.8, 1); cy(C.metalDark, 0, y + 0.5, 0.1, 0.6, 1.1, 0.6, 0.55); cy(C.metal, 0, y + 1.15, 0.5, 0.1, 0.8, 0.1, 0, 0, PI / 2); cy(C.cloth, -0.42, y + 1.15, 0.5, 0.4, 0.16, 0.4, 0, 0, PI / 2); cy(C.cloth, 0.42, y + 1.15, 0.5, 0.4, 0.16, 0.4, 0, 0, PI / 2); break; }
    case 'antidron': { const y = tower(1.5, 0.6); b.add(CONE, C.metal, [0, y + 0.45, 0.15], [-PI / 2 + 0.6, 0, 0], [1, 0.4, 1]); cy(C.metalDark, 0, y + 0.6, 0.35, 0.1, 1, 0.1, PI / 2 - 0.6); ic(C.danger, 0, y + 0.86, 0.75, 0.16); break; }
    case 'kamera': { bx(dark, 0, 0.12, 0, 0.8, 0.24, 0.8); bx(T.main, 0, 0.3, 0, 0.6, 0.12, 0.6); cy(C.metalDark, 0, 1.2, 0, 0.16, 2, 0.16); bx(C.white, 0, 2.3, 0.2, 0.42, 0.32, 0.8); bx(C.glass, 0, 2.3, 0.62, 0.26, 0.22, 0.06); bx(C.metalDark, 0, 2.5, 0.25, 0.5, 0.06, 0.95); ic(C.danger, 0.15, 2.42, 0.6, 0.08); studY = 0.2; break; }
    case 'kuryatnik': { for (const x of [-0.6, 0.6]) for (const z of [-0.5, 0.5]) bx(C.woodDark, x, 0.25, z, 0.12, 0.5, 0.12); bx(body, 0, 0.95, 0, 1.5, 0.9, 1.3); bx(T.main, -0.42, 1.62, 0, 1, 0.1, 1.5, 0, 0, 0.5); bx(T.main, 0.42, 1.62, 0, 1, 0.1, 1.5, 0, 0, -0.5); bx(C.ink, 0, 0.9, 0.66, 0.36, 0.42, 0.04); bx(C.woodDark, 0, 0.3, 1, 0.32, 0.06, 0.9, 0.55); ic(C.white, 0.5, 2, 0, 0.34); bx(C.danger, 0.5, 2.2, 0.05, 0.08, 0.12, 0.14); studZ = 0.67; studY = 1.25; break; }
    case 'bukva_n': { const y = tower(1.6, 0.66); bx(C.magic, -0.32, y + 0.55, 0, 0.18, 1.1, 0.18); bx(C.magic, 0.32, y + 0.55, 0, 0.18, 1.1, 0.18); bx(C.magic, 0, y + 0.55, 0, 0.6, 0.18, 0.18); break; }
    case 'zabor': { const h = 0.8 + lv * 0.15, c = [C.fence[2], C.wall[3], C.concrete][lv - 1]; bx(T.main, 0, h / 2 + 0.1, 0, 0.36, h + 0.2, 0.36); bx(c, 0, h / 2, 0, 2, h, 0.2); studZ = 0.2; studY = 0.3; break; }
    case 'shlagbaum': { bx(T.main, -0.75, 0.07, 0, 0.5, 0.14, 0.5); bx(C.metalDark, -0.75, 0.6, 0, 0.3, 1.1, 0.3); bx(C.metalDark, 0.85, 0.4, 0, 0.14, 0.8, 0.14); for (let i = 0; i < 5; i++) bx(i % 2 ? C.danger : C.white, -0.6 + i * 0.36, 0.95, 0, 0.36, 0.12, 0.12); bx(dark, -1.05, 0.95, 0, 0.3, 0.26, 0.26); studZ = 0.16; studY = 0.5; break; }
    case 'grabli': { bx(C.earth[1], 0, 0.03, 0, 1.3, 0.06, 1.3); bx(C.wood, 0, 0.1, 0.1, 0.08, 0.08, 1.2); bx(C.metalDark, 0, 0.1, -0.5, 0.7, 0.08, 0.1); for (let i = 0; i < 4; i++) bx(C.danger, -0.27 + i * 0.18, 0.18, -0.5, 0.06, 0.14, 0.06); studZ = 0.6; studY = 0.08; break; }
    case 'yama': { cy(C.ink, 0, 0.03, 0, 1.6, 0.06, 1.6); bx(C.woodDark, 0, 0.09, 0, 1.7, 0.06, 0.1, 0, 0.5); bx(C.woodDark, 0, 0.11, 0, 1.6, 0.06, 0.1, 0, -0.7); bx(C.leaf[0], 0.3, 0.14, 0.2, 0.5, 0.06, 0.4, 0, 0.3); bx(C.gold, -0.4, 0.14, -0.3, 0.2, 0.06, 0.2); studZ = 0.8; studY = 0.08; break; }
    case 'lezhak': { for (let i = 0; i < 5; i++) bx(i % 2 ? C.ink : C.gold, -0.72 + i * 0.36, 0.1, 0, 0.36, 0.2, 0.56); studZ = 0.3; studY = 0.1; break; }
    case 'nychka': { bx(C.woodDark, 0, 0.15, 0, 0.66, 0.3, 0.5); bx(C.gold, 0, 0.2, 0.26, 0.14, 0.12, 0.04); bx(C.leaf[2], -0.4, 0.1, 0.1, 0.4, 0.2, 0.5, 0, 0.4); bx(C.leaf[0], 0.42, 0.08, -0.1, 0.36, 0.16, 0.4); studZ = 0.27; studY = 0.08; break; }
    case 'sobaka': { bx(body, 0, 0.4, 0, 0.95, 0.8, 1.05); bx(T.main, -0.27, 0.95, 0, 0.66, 0.09, 1.2, 0, 0, 0.55); bx(T.main, 0.27, 0.95, 0, 0.66, 0.09, 1.2, 0, 0, -0.55); bx(C.ink, 0, 0.32, 0.53, 0.44, 0.5, 0.04); cy(C.gold, 0.7, 0.07, 0.5, 0.36, 0.14, 0.36); studZ = 0.54; studY = 0.7; break; }
    case 'larek': { shop(1.6, 1.2, 1.2); bx(C.glass, 0, 0.8, 0.61, 1.1, 0.5, 0.04); bx(C.trim, 0, 0.5, 0.7, 1.3, 0.08, 0.24); bx(C.gold, 0, 1.6, -0.2, 0.9, 0.34, 0.1); bx(C.woodDark, 1, 0.2, 0.3, 0.34, 0.4, 0.34); studZ = 0.62; studY = 0.3; break; }
    case 'shaurma': { shop(1.5, 1.3, 1.2); bx(C.glass, 0.3, 0.85, 0.61, 0.6, 0.5, 0.04); cy(C.metal, -0.45, 1, 0.8, 0.06, 1, 0.06); b.add(CONE, C.roof[3], [-0.45, 1, 0.8], [PI, 0, 0], [0.44, 0.7, 0.44]); cy(C.metalDark, 0.5, 1.75, -0.3, 0.2, 0.6, 0.2); studZ = 0.62; studY = 0.3; break; }
    case 'seyf': { bx(T.main, 0, 0.07, 0, 1.36, 0.14, 1.26); bx(C.metalDark, 0, 0.75, 0, 1.2, 1.3, 1.1); bx(C.metal, 0, 0.75, 0.56, 0.9, 1, 0.04); cy(C.gold, 0, 0.8, 0.6, 0.34, 0.06, 0.34, PI / 2); bx(C.gold, 0.3, 0.8, 0.6, 0.08, 0.3, 0.05); bx(dark, 0, 1.46, 0, 1.3, 0.12, 1.2); studZ = 0.59; studY = 0.3; break; }
    case 'zagon': { for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; bx(C.wood, Math.cos(a) * 0.9, 0.3, Math.sin(a) * 0.9, 0.12, 0.6, 0.12); } for (const [x, z, sx, sz] of [[0, 0.9, 1.9, 0.07], [0, -0.9, 1.9, 0.07], [0.9, 0, 0.07, 1.9], [-0.9, 0, 0.07, 1.9]]) bx(dark, x, 0.4, z, sx, 0.08, sz); for (const [x, z] of [[-0.3, 0.2], [0.35, -0.2], [0.1, 0.45]]) { ic(C.white, x, 0.3, z, 0.42, 0.34); bx(C.ink, x + 0.2, 0.36, z + 0.1, 0.14, 0.14, 0.14); } bx(T.main, 0.9, 0.85, 0.9, 0.3, 0.2, 0.05); bx(C.woodDark, 0.76, 0.6, 0.9, 0.06, 0.8, 0.06); studZ = 0.94; studY = 0.2; break; }
    case 'prorab': { bx(T.main, 0, 0.07, 0, 1.86, 0.14, 1.36); bx(body, 0, 0.75, 0, 1.7, 1.2, 1.2); bx(T.main, 0, 1.42, 0, 1.86, 0.12, 1.36); bx(C.door, -0.45, 0.6, 0.61, 0.4, 0.9, 0.04); bx(C.glass, 0.35, 0.85, 0.61, 0.6, 0.4, 0.04); bx(C.gold, 0.62, 1.9, -0.35, 0.14, 2.6, 0.14); bx(C.gold, 0.15, 3.1, -0.35, 1.6, 0.12, 0.12); bx(C.ink, -0.5, 2.8, -0.35, 0.04, 0.5, 0.04); bx(C.metalDark, -0.5, 2.5, -0.35, 0.2, 0.16, 0.2); studZ = 0.62; studY = 1.2; break; }
    case 'kachalka': { shop(1.6, 1.5, 1.3); bx(C.door, 0, 0.6, 0.66, 0.5, 1, 0.04); cy(C.metal, 0, 2, 0, 0.1, 1.3, 0.1, 0, 0, PI / 2); cy(C.cloth, -0.62, 2, 0, 0.6, 0.2, 0.6, 0, 0, PI / 2); cy(C.cloth, 0.62, 2, 0, 0.6, 0.2, 0.6, 0, 0, PI / 2); bx(dark, 0, 1.8, 0, 0.12, 0.3, 0.12); studZ = 0.67; studY = 1.25; break; }
    case 'garazh': { bx(T.main, 0, 0.07, 0, 1.96, 0.14, 1.56); bx(body, 0, 0.75, 0, 1.8, 1.3, 1.4); bx(C.metal, 0, 0.6, 0.71, 1.3, 1, 0.04); for (let i = 0; i < 3; i++) bx(C.metalDark, 0, 0.3 + i * 0.3, 0.74, 1.3, 0.04, 0.02); bx(T.main, 0, 1.5, 0, 2, 0.12, 1.6, 0.08); cy(C.ink, 1.05, 0.28, 0.4, 0.56, 0.2, 0.56, 0, 0, PI / 2); studZ = 0.72; studY = 1.25; break; }
    case 'vyshka': { bx(C.concrete, 0, 0.12, 0, 0.9, 0.24, 0.9); bx(T.main, 0, 0.3, 0, 0.7, 0.12, 0.7); bx(C.metalDark, 0, 1.8, 0, 0.24, 3.2, 0.24); for (let i = 0; i < 3; i++) { bx(C.metal, 0, 1 + i * 0.8, 0, 0.9 - i * 0.22, 0.08, 0.08); bx(C.metal, 0, 1 + i * 0.8, 0, 0.08, 0.08, 0.9 - i * 0.22); } ic(C.white, 0.3, 2.7, 0.25, 0.5, 0.5); ic(C.danger, 0, 3.5, 0, 0.22); studY = 0.2; studZ = 0.46; break; }
    case 'generator': { bx(T.main, 0, 0.07, 0, 1.66, 0.14, 1.16); bx(C.metal, 0, 0.6, 0, 1.5, 0.9, 1); bx(C.metalDark, -0.3, 1.2, 0, 0.7, 0.34, 0.7); cy(C.metalDark, 0.45, 1.45, 0, 0.18, 0.9, 0.18); bx(C.gold, 0.05, 0.75, 0.51, 0.16, 0.36, 0.04, 0, 0, 0.5); bx(C.gold, -0.05, 0.5, 0.51, 0.16, 0.36, 0.04, 0, 0, 0.5); studZ = 0.52; studY = 0.25; break; }
    case 'sabvufer': { bx(T.main, 0, 0.07, 0, 1.86, 0.14, 1.46); bx(C.cloth, 0, 1.15, 0, 1.7, 2, 1.3); cy(C.metalDark, 0, 1.55, 0.66, 1.1, 0.08, 1.1, PI / 2); cy(C.gold, 0, 1.55, 0.72, 0.44, 0.08, 0.44, PI / 2); cy(C.metalDark, 0, 0.6, 0.66, 0.6, 0.08, 0.6, PI / 2); bx(T.main, 0, 2.2, 0, 1.8, 0.1, 1.4); studZ = 0.67; studY = 0.25; break; }
    case 'arbuzomet': { bx(T.main, 0, 0.07, 0, 1.7, 0.14, 1.9); for (const x of [-0.6, 0.6]) { bx(C.wood, x, 0.8, 0.25, 0.14, 1.6, 0.14, 0.3); bx(C.wood, x, 0.8, -0.25, 0.14, 1.6, 0.14, -0.3); } bx(C.woodDark, 0, 1.55, 0, 1.4, 0.14, 0.14); bx(C.woodDark, 0, 1.75, -0.35, 0.16, 0.16, 2.4, 0.5); bx(C.concrete, 0, 1.25, 0.6, 0.5, 0.5, 0.5); ic(C.mosqueGreen, 0, 2.6, -1.35, 0.8); bx(C.danger, 0, 2.6, -1.35, 0.3, 0.84, 0.06); studZ = 0.96; studY = 0.2; break; }
    default: bx(T.main, 0, 0.07, 0, 1.5, 0.14, 1.5); bx(body, 0, 0.6, 0, 1.3, 1, 1.3);
  }
  // level: 1–3 gold studs on the front (the level also changes the materials above)
  for (let i = 0; i < lv; i++) bx(C.gold, (i - (lv - 1) / 2) * 0.22, studY, studZ, 0.12, 0.12, 0.06);
  const geo = b.build();
  // each level adds mass: +12 % per level (walls keep their cell)
  if (!d?.line) { const k = 1 + (lv - 1) * 0.12; geo.scale(k, k, k); }
  geo.computeBoundingBox();
  const out = { geo, h: geo.boundingBox!.max.y };
  geoCache.set(ck, out);
  return out;
}

interface View { key: string; g: THREE.Group; body: THREE.Object3D; turn: THREE.Object3D; h: number; scaf: THREE.Mesh | null; yaw: number; smoke: number; stamp: number; rise: boolean }
interface Zap { pts: number[]; until: number }
interface Melon { m: THREE.Mesh; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t0: number; t1: number }

const BAR_CAP = 320, ZAP_CAP = 64, GHOST_CAP = 16;
const TMP = { x: 0, y: 0, vis: false }, TMP2 = { x: 0, y: 0, vis: false };

export class BaseView {
  group = new THREE.Group();
  /** Whose eyes: hidden enemy things are not drawn. */
  side: Side = 0;
  private views = new Map<number, View>();
  private frame = 0;
  private ver = -1;
  private faint = new Map<THREE.Material, THREE.Material>();
  private scafGeo: THREE.BufferGeometry;
  // walls (instanced: post + arms towards the neighbouring wall cells)
  private posts: THREE.InstancedMesh[] = []; private arms: THREE.InstancedMesh[] = [];
  private wallKey = '';
  private shadow: THREE.Mesh | null = null; private shadowKey = '';
  // hp / construction bars
  private bars: THREE.InstancedMesh; private nb = 0;
  // rings: selection range, ghost range and minimum range, build zone (outer and keep-out)
  private rings: THREE.Mesh[] = [];
  private ringKey = ['', '', '', '', ''];
  private ghostMesh: THREE.InstancedMesh | null = null; private ghostT = -1; private ghostKey = '';
  private ghostMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.78, depthWrite: false, vertexColors: true });
  private zaps: Zap[] = []; private zapMesh: THREE.InstancedMesh;
  private melons: Melon[] = [];
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private s = new THREE.Vector3(); private right = new THREE.Vector3();
  private col = new THREE.Color();
  private Z = new THREE.Vector3(0, 0, 1);
  /** Selected building id (its ring is drawn), -1 none. */
  selected = -1;

  constructor(private t: Terrain, private sim: Sim, private stage: Stage, private particles: Particles, private shots: Shots) {
    this.group.name = 'base';
    const sb = new Builder();
    for (const [x, z] of [[-0.95, -0.95], [0.95, -0.95], [0.95, 0.95], [-0.95, 0.95]]) sb.box(C.wood, [x, 1.1, z], [0.09, 2.2, 0.09]);
    for (const y of [0.8, 1.6]) { sb.box(C.wood, [0, y, 0.95], [2, 0.08, 0.08]); sb.box(C.wood, [0, y, -0.95], [2, 0.08, 0.08]); sb.box(C.wood, [0.95, y, 0], [0.08, 0.08, 2]); sb.box(C.wood, [-0.95, y, 0], [0.08, 0.08, 2]); }
    for (let i = 0; i < 6; i++) sb.box(i % 2 ? C.ink : C.gold, [-0.8 + i * 0.32, 0.35, 0.97], [0.32, 0.14, 0.04]);
    this.scafGeo = sb.build();
    for (let lv = 1; lv <= 3; lv++) { // one pair per level: sheet metal, brick, concrete (toon/base/models.ts)
      const kit = wallKit(lv);
      this.posts.push(new THREE.InstancedMesh(kit.post, mat.solid(), 96));
      this.arms.push(new THREE.InstancedMesh(kit.arm, mat.solid(), 384));
    }
    for (const im of [...this.posts, ...this.arms]) { im.count = 0; im.frustumCulled = false; im.castShadow = true; im.visible = false; this.group.add(im); }
    this.bars = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true }), BAR_CAP);
    this.bars.count = 0; this.bars.frustumCulled = false; this.bars.renderOrder = 6;
    this.group.add(this.bars);
    const ringCol = [C.gold, C.heal, C.danger, C.white, C.danger];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), mat.unlit(ringCol[i], { opacity: i === 3 ? 0.85 : 0.75, side: THREE.DoubleSide, ground: true }));
      m.visible = false; m.renderOrder = 3; m.frustumCulled = false;
      this.rings.push(m); this.group.add(m);
    }
    this.zapMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat.unlit(C.magic), ZAP_CAP);
    this.zapMesh.count = 0; this.zapMesh.frustumCulled = false; this.zapMesh.visible = false;
    this.group.add(this.zapMesh);
  }

  private y(x: number, z: number) { return heightY(this.t, x, z); }

  private faintOf(m: THREE.Material): THREE.Material {
    let f = this.faint.get(m);
    if (!f) { f = m.clone(); f.transparent = true; f.opacity = 0.5; f.depthWrite = false; native(f); this.faint.set(m, f); }
    return f;
  }

  private make(b: B, lv: number, faint: boolean, key: string): View {
    const d = BUILDINGS[b.t];
    const g = new THREE.Group();
    let body = factory?.(d.key, lv, b.s) ?? null, h = 0;
    if (body) h = new THREE.Box3().setFromObject(body).max.y;
    else { const p = placeholder(d.key, lv, b.s); body = new THREE.Mesh(p.geo, mat.solid()); h = p.h; }
    body.traverse(o => {
      const me = o as THREE.Mesh;
      if (!me.isMesh) return;
      me.castShadow = !faint && h > 0.35;
      if (faint) me.material = Array.isArray(me.material) ? me.material.map(x => this.faintOf(x)) : this.faintOf(me.material);
    });
    g.add(body);
    g.position.set(b.x, this.y(b.x, b.z), b.z);
    this.group.add(g);
    return { key, g, body, turn: body.getObjectByName('head') ?? body, h, scaf: null, yaw: b.s === 0 ? PI / 2 : -PI / 2, smoke: 0, stamp: 0, rise: false };
  }
  private drop(v: View) { this.group.remove(v.g); }

  /** Sync with the state. `now` in ms, `alpha` the render fraction of the current tick, `zoomK` the bar scale (as for units). */
  update(now: number, dt: number, alpha: number, zoomK: number) {
    const st = this.sim.st, tick = st.tick, side = this.side, cam = this.stage.camera;
    if (this.ver !== factoryVer) { this.ver = factoryVer; for (const v of this.views.values()) this.drop(v); this.views.clear(); }
    this.frame++;
    this.nb = 0;
    this.right.setFromMatrixColumn(cam.matrixWorld, 0);
    let wk = '', sk = '';
    const walls: B[] = [];
    for (const b of st.bld) {
      if (!bldVisible(b, side)) continue;
      const d = BUILDINGS[b.t], building = b.up > tick, hpK = b.hp / b.mhp;
      if (d.line) {
        walls.push(b);
        wk += `${b.id}.${b.lv}${building ? 'u' : ''}${hpK < 0.5 ? 'd' : ''},`;
        if (hpK < 1 || b.id === this.selected) this.bar(b.x, this.y(b.x, b.z) + 1.5, b.z, 1.3 * zoomK, hpK, hpK < 0.35 ? C.danger : C.heal);
        continue;
      }
      const lv = building && b.lv > 1 ? b.lv - 1 : b.lv, faint = !!d.hid && !(b.f & BF.SEEN);
      const key = `${b.t}|${lv}|${b.s}|${faint ? 1 : 0}`;
      let v = this.views.get(b.id);
      if (!v || v.key !== key) { if (v) this.drop(v); v = this.make(b, lv, faint, key); this.views.set(b.id, v); }
      v.stamp = this.frame;
      if (d.solid) sk += `${b.id}.${lv},`;
      // construction: the body rises out of the scaffolding
      const rise = building && b.lv === 1;
      if (building) {
        if (!v.scaf) { v.scaf = new THREE.Mesh(this.scafGeo, mat.solid()); v.scaf.scale.setScalar(Math.max(0.5, Math.min(1.1, v.h / 2.2))); v.g.add(v.scaf); }
        const f = Math.max(0, Math.min(1, (tick + alpha - b.at) / Math.max(1, b.up - b.at)));
        if (rise) v.body.scale.y = 0.4 + 0.6 * f;
        this.bar(b.x, v.g.position.y + v.h + 0.75 * zoomK, b.z, 1.6 * zoomK, rise ? f : Math.max(0, 1 - (b.up - tick - alpha) / Math.max(1, BUILDINGS[b.t].bt[b.lv - 1])), C.gold);
      } else if (v.scaf) { v.g.remove(v.scaf); v.scaf = null; }
      if (v.rise && !rise) v.body.scale.y = 1;
      v.rise = rise;
      // towers turn to what they aim at
      if (d.dmg && b.tg >= 0 && d.fam === 'def') {
        const u = this.sim.unit(b.tg);
        if (u) { let dy = Math.atan2(u.x - b.x, u.z - b.z) - v.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); v.yaw += dy * Math.min(1, dt * 10); }
      }
      v.turn.rotation.y = v.yaw;
      // damage: a lean under two thirds, smoke under a third
      v.body.rotation.z = hpK < 0.66 ? (hpK < 0.33 ? 0.09 : 0.045) : 0;
      if (hpK < 0.33 && now > v.smoke) { v.smoke = now + 500; this.particles.emit(b.x, v.g.position.y + v.h * 0.8, b.z, { n: 1, color: '#6a6672', size: 0.36, life: 1.2, spread: 0.3, up: 1.3, grav: -0.2, grow: 0.8 }); }
      if (hpK < 1 || b.id === this.selected) this.bar(b.x, v.g.position.y + v.h + 0.4 * zoomK, b.z, 1.6 * zoomK, hpK, hpK < 0.35 ? C.danger : hpK < 0.66 ? C.gold : C.heal);
    }
    for (const [id, v] of this.views) if (v.stamp !== this.frame) { this.drop(v); this.views.delete(id); }
    if (wk !== this.wallKey) { this.wallKey = wk; this.buildWalls(walls, tick); }
    if (sk !== this.shadowKey) { this.shadowKey = sk; this.buildShadow(); }
    this.bars.count = this.nb;
    if (this.nb) { this.bars.instanceMatrix.needsUpdate = true; if (this.bars.instanceColor) this.bars.instanceColor.needsUpdate = true; }
    this.ringFor(0, this.selected);
    this.drawZaps(now);
    this.drawMelons(now);
  }

  /** One bar = two quads facing the camera: a dark back and the fill. */
  private bar(x: number, y: number, z: number, w: number, f: number, c: THREE.Color) {
    if (this.nb + 2 > BAR_CAP) return;
    const h = w * 0.11, cam = this.stage.camera;
    this.s.set(w + h * 0.5, h * 1.5, 1);
    this.m4.compose(this.v.set(x, y, z), cam.quaternion, this.s);
    this.bars.setMatrixAt(this.nb, this.m4); this.bars.setColorAt(this.nb++, C.ink);
    const k = Math.max(0.02, Math.min(1, f));
    this.s.set(w * k, h, 1);
    this.v.set(x, y, z).addScaledVector(this.right, -(w * (1 - k)) / 2);
    this.m4.compose(this.v, cam.quaternion, this.s);
    this.bars.setMatrixAt(this.nb, this.m4); this.bars.setColorAt(this.nb++, c);
  }

  private buildWalls(walls: B[], tick: number) {
    const np = [0, 0, 0], na = [0, 0, 0]; // per level: the panels are neutral, the posts carry the team colour
    let total = 0;
    const isWall = (x: number, z: number, s: Side) => { const o = this.sim.bldAt(x, z); return !!o && o.s === s && !!BUILDINGS[o.t].line && bldVisible(o, this.side); };
    for (const b of walls) {
      if (total++ >= 96) break;
      const lv = b.up > tick && b.lv > 1 ? b.lv - 1 : b.lv, hh = (0.8 + lv * 0.15) * (b.up > tick && b.lv === 1 ? 0.5 : 1) * (b.hp / b.mhp < 0.5 ? 0.85 : 1);
      const y = this.y(b.x, b.z);
      this.m4.compose(this.v.set(b.x, y, b.z), this.q.identity(), this.s.set(1, hh + 0.2, 1));
      const L = lv - 1, posts = this.posts[L], arms = this.arms[L];
      posts.setMatrixAt(np[L], this.m4);
      posts.setColorAt(np[L]++, TEAM[b.s].main);
      const C2 = BASE.cell;
      let any = 0;
      const arm = (dx: number, dz: number) => {
        if (na[L] >= 384) return;
        this.q.setFromAxisAngle(this.v.set(0, 1, 0), Math.atan2(dx, dz));
        this.m4.compose(this.v.set(b.x, y, b.z), this.q, this.s.set(1, hh / 0.86, 1));
        arms.setMatrixAt(na[L], this.m4);
        arms.setColorAt(na[L]++, this.col.setScalar(b.hp / b.mhp < 0.5 ? 0.78 : 1));
      };
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isWall(b.x + dx * C2, b.z + dz * C2, b.s)) { arm(dx, dz); any++; }
      if (!any) { arm(1, 0); arm(-1, 0); } // a lone segment still reads as a piece of fence
    }
    for (let L = 0; L < 3; L++) { this.posts[L].count = np[L]; this.arms[L].count = na[L]; }
    for (const im of [...this.posts, ...this.arms]) { im.visible = im.count > 0; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }

  /** Phone tier of the new style: one merged sheet of fake shadows for every solid building (null elsewhere). */
  private buildShadow() {
    if (this.shadow) { this.group.remove(this.shadow); this.shadow.geometry.dispose(); this.shadow = null; }
    const pos: number[] = [];
    let material: THREE.Material | null = null;
    for (const [id, v] of this.views) {
      const b = this.sim.building(id);
      if (!b || !BUILDINGS[b.t].solid) continue;
      const s = groundShadow(1.5, 1.5, v.h * 0.8);
      if (!s) return;
      material = s.material as THREE.Material;
      const p = s.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) pos.push(p.getX(i) + b.x, p.getY(i) + v.g.position.y + 0.04, p.getZ(i) + b.z);
      s.geometry.dispose();
    }
    if (!material || !pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.shadow = new THREE.Mesh(g, material);
    this.shadow.renderOrder = 1; this.shadow.frustumCulled = false;
    this.group.add(this.shadow);
  }

  // ---- rings ---------------------------------------------------------------------------------------------
  private ring(i: number, key: string, x = 0, z = 0, r = 0, w = 0.3) {
    const m = this.rings[i];
    if (key === this.ringKey[i]) return;
    this.ringKey[i] = key;
    m.geometry.dispose();
    m.visible = r > 0;
    m.geometry = r > 0 ? drapedRing(this.t, x, z, r, w, r > 12 ? 128 : 72) : new THREE.BufferGeometry();
  }
  private ringFor(i: number, id: number) {
    const b = id >= 0 ? this.sim.building(id) : undefined;
    if (!b || !bldVisible(b, this.side)) { this.ring(i, ''); return; }
    const d = BUILDINGS[b.t], lv = Math.max(1, b.up > this.sim.st.tick ? b.lv - 1 : b.lv), r = d.range ? d.range[lv - 1] : 1.5;
    this.ring(i, `${id}|${r}`, b.x, b.z, r, d.range ? 0.28 : 0.2);
  }
  /** The build zone of `side` on the ground (outer edge and the keep-out around the high-rise), or -1 to hide. */
  showZone(side: number) {
    if (side < 0) { this.ring(3, ''); this.ring(4, ''); return; }
    const z = this.sim.buildZone(side as Side);
    this.ring(3, `z${side}|${z.r}`, z.x, z.z, z.r, 0.4);
    this.ring(4, `k${side}|${z.keep}`, z.x, z.z, z.keep, 0.25);
  }

  /**
   * The placement ghost: building type `t` on `cells` (green where it may stand, red where not), with the
   * range ring (and the mortar's minimum) around the first cell. No cells = no ghost. t = -2: only a ring of
   * radius `range` (aiming a superweapon).
   */
  setGhost(t: number, cells: { x: number; z: number; ok: boolean }[], range = 0, min = 0) {
    const key = cells.map(c => `${c.x},${c.z},${c.ok ? 1 : 0}`).join(';') + `|${t}|${range}`;
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    if (!cells.length || t === -2) {
      if (this.ghostMesh) this.ghostMesh.visible = false;
      if (cells.length) this.ring(1, key, cells[0].x, cells[0].z, range, 0.35); else this.ring(1, '');
      this.ring(2, '');
      return;
    }
    if (this.ghostT !== t || !this.ghostMesh) {
      if (this.ghostMesh) this.group.remove(this.ghostMesh);
      const d = BUILDINGS[t];
      const geo = baseGhostGeometry(d.key, this.side) ?? (d.line ? new THREE.BoxGeometry(1.9, 1, 1.9).translate(0, 0.5, 0) : placeholder(d.key, 1, this.side).geo);
      this.ghostMesh = new THREE.InstancedMesh(geo, this.ghostMat, GHOST_CAP);
      this.ghostMesh.frustumCulled = false; this.ghostMesh.renderOrder = 5;
      this.group.add(this.ghostMesh);
      this.ghostT = t;
    }
    const im = this.ghostMesh, n = Math.min(GHOST_CAP, cells.length);
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      this.m4.compose(this.v.set(c.x, this.y(c.x, c.z) + 0.02, c.z), this.q.identity(), this.s.set(1, 1, 1));
      im.setMatrixAt(i, this.m4);
      im.setColorAt(i, c.ok ? C.heal : C.danger);
    }
    im.count = n; im.visible = true;
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    this.ring(1, range > 0 ? `g${cells[0].x},${cells[0].z},${range}` : '', cells[0].x, cells[0].z, range, 0.28);
    this.ring(2, min > 0 ? `m${cells[0].x},${cells[0].z},${min}` : '', cells[0].x, cells[0].z, min, 0.2);
  }

  /** Top of a building above the ground (for labels and tips). */
  heightOf(id: number): number { return this.views.get(id)?.h ?? 1.1; }

  /** The visible building under a screen point, or null. */
  pick(cx: number, cy: number, touch: boolean): B | null {
    let best: B | null = null, bd = Infinity;
    const R = touch ? 30 : 16, st = this.stage;
    for (const b of this.sim.st.bld) {
      if (!bldVisible(b, this.side)) continue;
      const y = this.y(b.x, b.z), h = this.views.get(b.id)?.h ?? 1;
      st.project(b.x, y + 0.1, b.z, TMP);
      if (!TMP.vis) continue;
      const fx = TMP.x, fy = TMP.y;
      st.project(b.x + 0.9, y + 0.1, b.z, TMP2);
      const foot = Math.hypot(TMP2.x - fx, TMP2.y - fy);
      st.project(b.x, y + h, b.z, TMP2);
      // distance to the segment foot → top
      const vx = TMP2.x - fx, vy = TMP2.y - fy, l2 = vx * vx + vy * vy || 1;
      const k = Math.max(0, Math.min(1, ((cx - fx) * vx + (cy - fy) * vy) / l2));
      const dd = Math.hypot(cx - fx - vx * k, cy - fy - vy * k) + (BUILDINGS[b.t].line ? 5 : 0);
      if (dd < Math.max(R, foot) && dd < bd) { bd = dd; best = b; }
    }
    return best;
  }

  // ---- effects ---------------------------------------------------------------------------------------------
  /** Decoration for a sim event; true when the event is a base event (the caller need not draw it). */
  fx(e: FxEv, now: number): boolean {
    const P = this.particles;
    switch (e.e) {
      case 'bld': {
        if (e.s !== this.side && BUILDINGS[e.t]?.hid && e.k !== 'seen' && e.k !== 'trap' && e.k !== 'die') return true; // nothing gives a hidden thing away
        const y = this.y(e.x, e.z);
        if (e.k === 'put' || e.k === 'up') P.emit(e.x, y + 0.2, e.z, { n: 10, color: '#d9cdb4', size: 0.5, life: 0.7, spread: 1.6, up: 0.6, grav: 0.4, grow: 0.8 });
        else if (e.k === 'done') P.emit(e.x, y + 1.6, e.z, { n: 12, color: C.gold, size: 0.2, life: 0.9, spread: 1.6, up: 2.2, grav: 4 });
        else if (e.k === 'sell') P.emit(e.x, y + 0.8, e.z, { n: 10, color: C.gold, size: 0.22, life: 0.8, spread: 1.2, up: 2.6, grav: 5 });
        else if (e.k === 'rep') P.emit(e.x, y + 1, e.z, { n: 8, color: C.heal, size: 0.22, life: 0.8, spread: 1, up: 1.6, grav: 1 });
        else if (e.k === 'die') {
          P.emit(e.x, y + 0.5, e.z, { n: 26, color: '#bdb3a2', size: 0.8, life: 1.2, spread: 2, up: 1, grav: 0.3, grow: 1.1 });
          P.emit(e.x, y + 0.8, e.z, { n: 14, color: TEAM[e.s].main, size: 0.26, life: 1, spread: 2.6, up: 3, grav: 7 });
          P.emit(e.x, y + 0.8, e.z, { n: 10, color: C.wood, size: 0.3, life: 1.1, spread: 2.4, up: 3.4, grav: 8 });
        } else if (e.k === 'trap') { this.burst(e.x, y, e.z, BUILDINGS[e.t]?.sp ?? 1.4, BUILDINGS[e.t]?.key === 'nychka' ? C.heal : C.danger); }
        else if (e.k === 'seen') P.emit(e.x, y + 0.6, e.z, { n: 12, color: C.white, size: 0.3, life: 0.6, spread: 1.6, up: 1.2, grav: 1 });
        else if (e.k === 'hatch') P.emit(e.x, y + 1.2, e.z, { n: 14, color: C.white, size: 0.18, life: 1.1, spread: 1.8, up: 2, grav: 2, wob: 1 });
        else if (e.k === 'charge') P.emit(e.x, y + 2.4, e.z, { n: 24, color: C.gold, size: 0.26, life: 1.2, spread: 2, up: 3, grav: 3 });
        else if (e.k === 'stun') this.burst(e.x, y, e.z, BUILDINGS[e.t]?.range?.[0] ?? 6, C.magic);
        else if (e.k === 'wave') { this.burst(e.x, y, e.z, 12, C.white); this.burst(e.x, y, e.z, 6, C.magic); }
        else if (e.k === 'fire') P.emit(e.x, y + 2.4, e.z, { n: 16, color: '#d9cdb4', size: 0.6, life: 0.9, spread: 1.4, up: 2, grav: 0.4, grow: 1 });
        return true;
      }
      case 'bhit':
        P.emit(e.x, this.y(e.x, e.z) + 0.9, e.z, { n: 3, color: '#e8d9b8', size: 0.26, life: 0.4, spread: 1.6, up: 1.4, grav: 4 });
        return true;
      case 'zap': {
        const pts: number[] = [];
        for (let i = 0; i + 1 < e.pts.length; i += 2) pts.push(e.pts[i], this.y(e.pts[i], e.pts[i + 1]) + (i ? 0.8 : this.heightOf(e.id)), e.pts[i + 1]);
        this.zaps.push({ pts, until: now + 240 });
        if (pts.length >= 6) P.emit(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1], { n: 6, color: C.magic, size: 0.2, life: 0.4, spread: 1.6, up: 1, grav: 2 });
        return true;
      }
      case 'shot': {
        if (e.k < BASE.shotK) return false;
        const t = e.k - BASE.shotK, key = BUILDINGS[t]?.key, src = this.sim.bldAt(e.x, e.z);
        const y0 = this.y(e.x, e.z) + (src ? this.heightOf(src.id) * 0.85 : 2), y1 = this.y(e.tx, e.tz) + 0.6;
        const t1 = now + Math.max(1, e.at - this.sim.st.tick) * TICK_MS;
        if (key === 'arbuzomet') { this.melon(e.x, y0, e.z, e.tx, y1, e.tz, now, t1); return true; }
        const look = key === 'sebozol' ? 2 : key === 'gantel' ? 1 : key === 'antidron' ? 0 : 5;
        this.shots.add(look, e.x, y0, e.z, e.tx, y1, e.tz, now, key === 'sperm' ? now + 160 : t1);
        return true;
      }
      case 'pulse':
        if (e.key === 'arbuz') { const y = this.y(e.x, e.z); this.burst(e.x, y, e.z, e.r, C.danger); P.emit(e.x, y + 0.6, e.z, { n: 40, color: C.mosqueGreen, size: 0.4, life: 1.2, spread: 5, up: 5, grav: 8 }); this.stage.shake(0.8); }
        return false;
      default: return false;
    }
  }
  /** A ring of puffs of radius r. */
  private burst(x: number, y: number, z: number, r: number, c: THREE.Color) {
    const n = Math.max(8, Math.min(28, Math.round(r * 5)));
    for (let k = 0; k < n; k++) { const a = (k / n) * PI * 2; this.particles.emit(x + Math.cos(a) * r * 0.6, y + 0.3, z + Math.sin(a) * r * 0.6, { n: 2, color: c, size: 0.4, life: 0.7, spread: Math.max(1, r * 0.5), up: 0.9, grav: 1, grow: 0.8 }); }
  }
  private drawZaps(now: number) {
    let n = 0, keep = 0;
    for (const z of this.zaps) {
      if (z.until <= now) continue;
      this.zaps[keep++] = z;
      for (let i = 0; i + 5 < z.pts.length && n + 2 <= ZAP_CAP; i += 3) {
        const ax = z.pts[i], ay = z.pts[i + 1], az = z.pts[i + 2], bx = z.pts[i + 3], by = z.pts[i + 4], bz = z.pts[i + 5];
        const mx = (ax + bx) / 2 + (Math.random() - 0.5) * 0.8, my = (ay + by) / 2 + (Math.random() - 0.5) * 0.8, mz = (az + bz) / 2 + (Math.random() - 0.5) * 0.8;
        n = this.zapSeg(n, ax, ay, az, mx, my, mz);
        n = this.zapSeg(n, mx, my, mz, bx, by, bz);
      }
    }
    this.zaps.length = keep;
    this.zapMesh.count = n; this.zapMesh.visible = n > 0;
    if (n) this.zapMesh.instanceMatrix.needsUpdate = true;
  }
  private zapSeg(n: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    this.v.set(bx - ax, by - ay, bz - az);
    const len = this.v.length() || 0.01;
    this.q.setFromUnitVectors(this.Z, this.v.divideScalar(len));
    this.m4.compose(this.v.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), this.q, this.s.set(0.12, 0.12, len));
    this.zapMesh.setMatrixAt(n, this.m4);
    return n + 1;
  }
  private melon(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t0: number, t1: number) {
    const m = new THREE.Mesh(ICO, mat.plain(C.mosqueGreen));
    m.scale.setScalar(1.3);
    this.group.add(m);
    this.melons.push({ m, x0, y0, z0, x1, y1, z1, t0, t1 });
  }
  private drawMelons(now: number) {
    let keep = 0;
    for (const s of this.melons) {
      const f = (now - s.t0) / Math.max(1, s.t1 - s.t0);
      if (f >= 1) { this.group.remove(s.m); continue; }
      this.melons[keep++] = s;
      const d = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
      s.m.position.set(s.x0 + (s.x1 - s.x0) * f, s.y0 + (s.y1 - s.y0) * f + Math.sin(PI * f) * Math.min(40, 6 + d * 0.25), s.z0 + (s.z1 - s.z0) * f);
      s.m.rotation.set(f * 9, 0, f * 5);
    }
    this.melons.length = keep;
  }

  /** A new session or a new world: forget every view. */
  reset() {
    for (const v of this.views.values()) this.drop(v);
    this.views.clear(); this.wallKey = '?'; this.shadowKey = '?'; this.zaps.length = 0;
    for (const s of this.melons) this.group.remove(s.m);
    this.melons.length = 0;
    this.selected = -1;
    this.setGhost(-1, []); this.showZone(-1);
  }
}
