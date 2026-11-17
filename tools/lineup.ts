// Dev-only lineup of every unit model and the street-food buildings, lit like the game.
// `npm run dev`, then open /tools/lineup.html?view=…
//   all · heroes · units[&half=2] (old next to new) · hero&t=6..17[&side=0|1] (four angles)
//   bld · doner · decor · game[&dist=38] (in-game camera) · portraits (same framing as the HUD cards)
//   v3 (reworked heroes vs the old Чимаев height) · plate (КРА 95 close-up) · crowd (спортики + гелик)
//   pack (pack face textures) · pack3d · lm[&crowd=4] (all landmarks) · lm1&k=stadium · game2[&dist=38]
//   v4: v4units (new units, both sides, next to old ones) · v4unit&k=ipit[&side=] (four angles) · v4game[&dist=38]
//       v4bld (Grozny landmarks) · v4bld1&k=shaiba[&dist=38] · v4bldgame[&dist=38] · city[&dist=38] (6×6 blocks
//       next to the Атаги HQ) · skyline (Шайба vs the Курчалой пятиэтажка, ГГНТУ, ЧГУ, blocks)
// Extras: &yaw= &pitch= (camera), &spicy (18+ sign), &anim (spin the doner / drone props), &noshadow.
import * as THREE from 'three';
import { unitGeometry, unitScale, islamRig, zurabRig, houseGeometries } from '../src/render/models';
import { heroGeometry, heroScale, donerBey, fudzi, gym, taxiStand, HERO_TYPES } from '../src/render/heroes';
import { propUnitGeometry, propUnitScale, gelikProp, sportikiCrowd, cigPackTexture, cigPack, landmark, LANDMARK_KINDS, PROP_TYPES } from '../src/render/props';
import { mosque, HqBuilding } from '../src/render/world';
import { styleStage, ground } from '../src/render/style'; // `?gfx=classic|toon` picks the look, as in the game
import {
  v4UnitGeometry, v4UnitScale, v4HoverHeight, isFlying, v4DronePropGeometry, V4_DRONE_ROTORS, V4_UNIT_KEYS, V4_UNIT_NAMES,
  groznyLandmark, setLandmarkClosed, GROZNY_KEYS, GROZNY_FOOTPRINT, cityBlock, cityBlockFootprint, cityBlockHeight, CITY_FLOORS, type V4UnitKey, type GroznyKey,
} from '../src/render/grozny';

const US = 1.7; // renderer's unit scale (units.ts)
const BS = 1.45; // boss scale
const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'all';
/** World height of the old «Чимаев 5.5» (model top 1.006 × heroScale 1.05 × 1.7) for the v3 comparison. */
const OLD_CHIMAEV = 1.006 * 1.05 * US;

const NAMES: Record<number, [string, string]> = {
  0: ['Пацаны', 'Пацаны'], 1: ['Борец', 'Борец 115 кг'], 2: ['Снайпер', 'Метатель гантелей'], 3: ['Баран', 'Камри без прав'], 4: ['Бежни лор', 'Шаурмист'],
  6: ['Чимаев', 'Чимаев'], 7: ['Амин', 'Амин'], 8: ['админ', 'админ'], 9: ['Мохьмад', 'Мохьмад'], 10: ['Бекхан', 'Бекхан'],
  11: ['Адам', 'Адам'], 12: ['Мохьмад (старый)', 'Мохьмад (старый)'], 13: ['Голем', 'Голем'], 14: ['Такси по 100', 'Маршрутка 150 ₽'], 15: ['Курица', 'Курица'],
  16: ['Гелик КРА 95', 'Гелик КРА 95'], 17: ['Спортик', 'Спортик'], 18: ['Амина', 'Амина'],
};
const LM_LABEL: Record<string, string> = {
  stadium: 'Стадион', school: 'Школа', shop: 'Продукты', market: 'Рынок', cafe: 'Кафе', busstop: 'Остановка',
  carwash: 'Автомойка', parking: 'Парковка', fuel: 'АЗС', clinic: 'Поликлиника', park: 'Парк', gym: 'Спортзал',
};
const GZ_LABEL: Record<GroznyKey, string> = { ggntu: 'ГГНТУ', chgu: 'ЧГУ', shaiba: 'ЖК «Шайба»', ansar: 'Ансар', pringles: 'Принглс' };

// ---- renderer, lights: same as src/render/scene.ts ----------------------------------------
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = !q.has('noshadow');
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#d9c9a8');
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1400);
const hemi = new THREE.HemisphereLight('#fff4e0', '#6d6a4c', 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffe2b0', 1.9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), ground(new THREE.MeshLambertMaterial({ color: '#b3ad7c' })));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
/** Toon: the same outline pass as the game (no cloud shadows, mode pinned); classic: null. */
const toon = styleStage(renderer, scene, hemi, sun, false, true, { clouds: false, pin: true });
const draw = () => { if (toon) toon.render(scene, camera); else renderer.render(scene, camera); };

const unitMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const placed: THREE.Object3D[] = [];
interface Lbl { text: string; sub: string; at: THREE.Vector3; side: number }
const labels: Lbl[] = [];

const isProp = (type: number) => type === 16 || type === 17;
function geoFor(type: number, side: 0 | 1) { return isProp(type) ? propUnitGeometry(type, side) : type < 6 ? unitGeometry(type, side) : heroGeometry(type, side); }
function scaleFor(type: number, side: 0 | 1) { return US * (isProp(type) ? propUnitScale(type, side) : type < 6 ? unitScale(type, side) : heroScale(type, side)); }

/** Put one unit on the ground, as the renderer would scale it. */
function unit(type: number, side: 0 | 1, x: number, z: number, yaw = 0, label = true) {
  const g = geoFor(type, side);
  const m = new THREE.Mesh(g, unitMat);
  const s = scaleFor(type, side);
  m.scale.setScalar(s);
  m.position.set(x, 0, z);
  m.rotation.y = yaw;
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m); placed.push(m);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  if (label) labels.push({ text: NAMES[type]?.[side] ?? `#${type}`, sub: `${g.attributes.position.count / 3} тр · ×${(s / US).toFixed(2)} · h ${(bb.max.y * s).toFixed(2)}`, at: new THREE.Vector3(x, bb.max.y * s + 0.25, z), side });
}

function addObj(o: THREE.Object3D, x: number, z: number, ry = 0) {
  o.position.set(x, 0, z);
  o.rotation.y = ry;
  o.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  scene.add(o); placed.push(o);
  return o;
}
function trisOf(o: THREE.Object3D) {
  let t = 0;
  o.traverse(c => { const g = (c as THREE.Mesh).geometry; if (g) t += (g.index ? g.index.count : g.attributes.position.count) / 3; });
  return t;
}

/** Transparent head-and-shoulders render of the admin hero, for the pack face. */
function adminPortrait(side: 0 | 1 = 0): HTMLCanvasElement {
  const pc = document.createElement('canvas');
  const r = new THREE.WebGLRenderer({ canvas: pc, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(420, 460, false);
  r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
  const ps = new THREE.Scene();
  ps.add(new THREE.HemisphereLight('#fff6e6', '#6b6450', 1.7));
  const ls = new THREE.DirectionalLight('#ffe7c4', 2.0); ls.position.set(-2, 4, 3); ps.add(ls);
  const g = heroGeometry(8, side); g.computeBoundingBox();
  const top = g.boundingBox!.max.y;
  ps.add(new THREE.Mesh(g, unitMat));
  const cam = new THREE.PerspectiveCamera(30, 420 / 460, 0.05, 20);
  cam.position.set(0.22, top - 0.24, 1.55); cam.lookAt(0, top - 0.3, 0);
  r.setClearColor(0x000000, 0);
  r.render(ps, cam);
  const out = document.createElement('canvas');
  out.width = 420; out.height = 460;
  out.getContext('2d')!.drawImage(pc, 0, 0);
  r.dispose(); r.forceContextLoss();
  return out;
}

function boss(side: 0 | 1, x: number, z: number) {
  const rig = side === 0 ? islamRig(unitMat) : zurabRig(unitMat);
  rig.root.position.set(x, 0, z);
  rig.root.scale.setScalar(BS);
  scene.add(rig.root); placed.push(rig.root);
  labels.push({ text: side === 0 ? 'Ислам (босс)' : 'Зураб (босс)', sub: 'для масштаба', at: new THREE.Vector3(x, rig.height * BS + 0.3, z), side });
}

function row(types: number[], side: 0 | 1, z: number, x0 = 0, gap = 0.9, withBoss = false) {
  let x = x0;
  for (const t of types) {
    const g = geoFor(t, side); g.computeBoundingBox();
    const w = (g.boundingBox!.max.x - g.boundingBox!.min.x) * scaleFor(t, side);
    x += w / 2;
    unit(t, side, x, z);
    x += w / 2 + gap;
  }
  if (withBoss) { x += 0.6; boss(side, x + 0.6, z); x += 2.4; }
  return x;
}

const spinners: THREE.Object3D[] = [];
function buildings(z: number, x0: number) {
  const items: { obj: THREE.Object3D; w: number; name: string; h: number }[] = [];
  const db = donerBey();
  if (q.has('spicy')) db.setSign('ДОНЕР ГЕЙ');
  db.spit.rotation.y = 0.6;
  spinners.push(db.spit);
  items.push({ obj: db.group, w: 4.4, name: 'Донер Бей', h: 2.5 });
  items.push({ obj: fudzi(), w: 2.4, name: 'Фудзи', h: 2.0 });
  items.push({ obj: gym(), w: 3.4, name: 'Качалка', h: 1.6 });
  items.push({ obj: taxiStand(), w: 2.5, name: 'Такси-стоянка', h: 1.7 });
  const m = mosque(false);
  items.push({ obj: m, w: 2.6, name: 'мечеть (для масштаба)', h: 2.5 });
  const hq = new HqBuilding(0, 4); hq.setFloors(3, false);
  items.push({ obj: hq.group, w: 5.2, name: 'высотка Атагов', h: 3.8 });
  let x = x0;
  for (const it of items) {
    x += it.w / 2;
    it.obj.position.set(x, 0, z);
    it.obj.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(it.obj); placed.push(it.obj);
    let tris = 0;
    it.obj.traverse(o => { const g = (o as THREE.Mesh).geometry; if (g) tris += (g.index ? g.index.count : g.attributes.position.count) / 3; });
    labels.push({ text: it.name, sub: `${tris} тр`, at: new THREE.Vector3(x, it.h + 0.3, z), side: -1 });
    x += it.w / 2 + 1.0;
  }
  return x;
}

// ---- v4: Grozny units, landmarks, city blocks ------------------------------------------------
const props: THREE.Object3D[] = [];
let propMat: THREE.Material | null = null;
/** One v4 unit as the renderer would place it (×1.7 × v4UnitScale, the drone `v4HoverHeight` above the ground). */
function v4unit(key: V4UnitKey, side: 0 | 1, x: number, z: number, yaw = 0, label = true) {
  const g = v4UnitGeometry(key, side);
  const s = US * v4UnitScale(key, side);
  const root = new THREE.Group();
  const m = new THREE.Mesh(g, unitMat);
  m.castShadow = true; m.receiveShadow = true;
  root.add(m);
  root.scale.setScalar(s);
  const lift = isFlying(key) ? v4HoverHeight(key) : 0;
  root.position.set(x, lift, z);
  root.rotation.y = yaw;
  if (key === 'drone') {
    // spinning two-blade props on the rotor hubs (static blurred discs are already in the merged mesh)
    propMat ??= new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const pg = v4DronePropGeometry();
    V4_DRONE_ROTORS.forEach((p, i) => {
      const pm = new THREE.Mesh(pg, propMat!);
      pm.position.set(p[0], p[1] + 0.012, p[2]);
      pm.rotation.y = i * 0.9;
      root.add(pm); props.push(pm);
    });
  }
  scene.add(root); placed.push(root);
  const bb = g.boundingBox!;
  const top = bb.max.y * s + lift;
  if (label) {
    const fp = `${((bb.max.x - bb.min.x) * s).toFixed(2)}×${((bb.max.z - bb.min.z) * s).toFixed(2)}`;
    labels.push({ text: V4_UNIT_NAMES[key], sub: `${g.attributes.position.count / 3} тр · ×${(s / US).toFixed(2)} · h ${top.toFixed(2)} · ${fp}`, at: new THREE.Vector3(x, top + 0.25, z), side });
  }
  return { w: (bb.max.x - bb.min.x) * s, top };
}
function v4row(keys: V4UnitKey[], side: 0 | 1, z: number, x0 = 0, gap = 0.9, old: number[] = []) {
  let x = x0;
  for (const k of keys) {
    const g = v4UnitGeometry(k, side); g.computeBoundingBox();
    const w = (g.boundingBox!.max.x - g.boundingBox!.min.x) * US * v4UnitScale(k, side);
    g.dispose();
    x += w / 2; v4unit(k, side, x, z); x += w / 2 + gap;
  }
  for (const t of old) {
    const g = geoFor(t, side); g.computeBoundingBox();
    const w = (g.boundingBox!.max.x - g.boundingBox!.min.x) * scaleFor(t, side);
    x += w / 2; unit(t, side, x, z); x += w / 2 + gap;
  }
  return x;
}
/** A Grozny landmark on the ground with a label: tris, footprint, bbox, height. */
function gz(key: GroznyKey, x: number, z: number, opts: Parameters<typeof groznyLandmark>[1] = {}, ry = 0, label = true, title?: string) {
  const o = groznyLandmark(key, opts);
  addObj(o, x, z, ry);
  if (label) {
    const bb = new THREE.Box3().setFromObject(o), sz = bb.getSize(new THREE.Vector3());
    const [fw, fd] = o.userData.footprint as [number, number], [cx, cz] = o.userData.centre as [number, number];
    const F = GROZNY_FOOTPRINT[key];
    const drift = fw > F.w + 0.15 || fd > F.d + 0.15 || sz.y > F.h + 0.15 || Math.abs(F.cz - cz) > 0.3 ? ' · > GROZNY_FOOTPRINT!' : '';
    labels.push({ text: title ?? GZ_LABEL[key], sub: `${o.userData.tris} тр · ${fw}×${fd} @ (${cx}, ${cz}) · h ${sz.y.toFixed(1)}${drift}`, at: new THREE.Vector3(x, sz.y + 0.4, z), side: -1 });
  }
  return o;
}
const blockGeo = new Map<string, THREE.BufferGeometry>();
const blockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
function block(kind: number, seed: number, x: number, z: number, ry = 0) {
  const k = `${kind}:${seed}`;
  let g = blockGeo.get(k);
  if (!g) { g = cityBlock(kind, seed); blockGeo.set(k, g); }
  const m = new THREE.Mesh(g, blockMat);
  m.position.set(x, 0, z); m.rotation.y = ry;
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m); placed.push(m);
  return m;
}
/** Village houses as world.ts instances them (body + hip roof, ~0.3–0.44 wide), for scale. */
function houses(x0: number, z0: number, n: number) {
  const { body, roof } = houseGeometries();
  const wall = new THREE.MeshLambertMaterial({ color: '#d9cbb0' }), rf = new THREE.MeshLambertMaterial({ color: '#8a3f2c', flatShading: true });
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group();
    const two = i % 3 === 0;
    for (const [geo, mat] of [[body, wall], [roof, rf]] as const) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; g.add(m); }
    g.scale.set(0.38, two ? 0.42 : 0.26, 0.36);
    g.position.set(x0 + (i % 4) * 0.8, 0, z0 + Math.floor(i / 4) * 0.8);
    scene.add(g); placed.push(g);
  }
}
function hq(side: 0 | 1, floors: number, x: number, z: number, ry = 0) {
  const h = new HqBuilding(side, Math.max(floors, 4));
  h.setFloors(floors, false);
  addObj(h.group, x, z, ry);
  const top = floors * h.fh;
  labels.push({ text: side === 0 ? `высотка Атагов (${floors} эт.)` : `пятиэтажка Курчалоя (${floors} эт.)`, sub: `h ${top.toFixed(1)} + крыша`, at: new THREE.Vector3(x, top + 1.9, z), side });
  return h;
}

// ---- views ------------------------------------------------------------------------------
const OLD = [0, 1, 2, 3, 4];
const HEROES: number[] = [...HERO_TYPES, 18]; // 18: Амина (girls.ts via heroGeometry)
const yaw = Number(q.get('yaw') ?? 0);
let pitch = Number(q.get('pitch') ?? 0.5);
let tight = 1.0;
let gameCam: { x: number; z: number; dist: number } | null = null;

if (view === 'all') {
  const x1 = row([...OLD, ...HEROES], 0, 2.2, 0, 0.8, true);
  row([...OLD, ...HEROES], 1, -2.2, 0, 0.8, true);
  buildings(-10, Math.max(0, x1 / 2 - 14));
  pitch = 0.62;
} else if (view === 'heroes') {
  row(HEROES, 0, 1.8, 0, 0.7);
  row(HEROES, 1, -1.8, 0, 0.7);
  pitch = Number(q.get('pitch') ?? 0.42);
} else if (view === 'units') {
  // old units next to the new ones, both sides
  const half = q.get('half');
  const list = half === '2' ? [3, 4, 11, 12, 13, 14, 15] : [0, 1, 2, 6, 7, 8, 9, 10];
  row(list, 0, 1.8, 0, 0.7);
  row(list, 1, -1.8, 0, 0.7);
  pitch = Number(q.get('pitch') ?? 0.42);
} else if (view === 'hero') {
  const t = Number(q.get('t') ?? 6);
  const yaws = [0, 0.75, Math.PI / 2, Math.PI];
  const only = q.get('side');
  for (const side of [0, 1] as const) {
    if (only !== null && Number(only) !== side) continue;
    const g = geoFor(t, side); g.computeBoundingBox();
    const s = scaleFor(t, side), bb = g.boundingBox!;
    const step = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * s + 0.5;
    const dz = (Math.max(bb.max.z - bb.min.z, bb.max.x - bb.min.x) * s) / 2 + 0.6;
    yaws.forEach((a, i) => unit(t, side, i * step, side === 0 ? dz : -dz, a, i === 0));
  }
  pitch = Number(q.get('pitch') ?? 0.32);
} else if (view === 'bld') {
  buildings(0, 0);
  pitch = Number(q.get('pitch') ?? 0.5);
  tight = 0.95;
} else if (view === 'decor') {
  const items: [THREE.Object3D, number][] = [[fudzi(), 2.6], [gym(), 3.4], [taxiStand(), 2.6]];
  let x = 0;
  for (const [o, w] of items) {
    x += w / 2; o.position.set(x, 0, 0); x += w / 2 + 0.6;
    o.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    scene.add(o); placed.push(o);
  }
  pitch = Number(q.get('pitch') ?? 0.45);
} else if (view === 'doner') {
  const db = donerBey();
  if (q.has('spicy')) db.setSign('ДОНЕР ГЕЙ');
  scene.add(db.group); placed.push(db.group);
  spinners.push(db.spit);
  db.group.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  unit(10, 0, 2.9, 2.2, -0.6, false);
  unit(15, 1, -2.5, 2.6, 0.5, false);
  pitch = Number(q.get('pitch') ?? 0.55);
  tight = 0.9;
} else if (view === 'game') {
  // how it reads at the in-game default zoom (dist 38, stage pitch formula)
  let x = 0;
  for (const t of [0, 1, 4, ...HEROES, ...PROP_TYPES]) {
    for (const side of [0, 1] as const) unit(t, side, x, side === 0 ? 1.4 : -1.4, side === 0 ? 1.2 : -1.6, false);
    x += t === 14 || t === 13 || t === 16 ? 3.6 : 2.3;
  }
  gameCam = { x: x / 2, z: 0, dist: Number(q.get('dist') ?? 38) };
} else if (view === 'v3') {
  // reworked heroes in both villages, against the height of the old «Чимаев 5.5» (red bar behind each row)
  const list = [0, 6, 7, 8, 9, 17];
  let x1 = 0;
  for (const [side, z] of [[0, 1.6], [1, -1.6]] as const) {
    x1 = row(list, side, z, 0, 0.75);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(x1 + 0.4, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: '#d8361f' }));
    bar.position.set(x1 / 2 - 0.2, OLD_CHIMAEV, z - 0.45);
    scene.add(bar); placed.push(bar);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, OLD_CHIMAEV, 0.05), new THREE.MeshBasicMaterial({ color: '#d8361f' }));
    post.position.set(x1 + 0.25, OLD_CHIMAEV / 2, z - 0.45);
    scene.add(post); placed.push(post);
  }
  labels.push({ text: 'старый «Чимаев 5.5»', sub: `h ${OLD_CHIMAEV.toFixed(2)}`, at: new THREE.Vector3(x1 + 0.25, OLD_CHIMAEV + 0.3, 1.15), side: 1 });
  pitch = Number(q.get('pitch') ?? 0.3);
} else if (view === 'plate') {
  // «КРА 95» close-up: one гелик nose to the camera, one tail to the camera
  for (const [side, x, ry, txt] of [[1, -1.0, 0, 'перед'], [0, 1.0, Math.PI, 'зад']] as const) {
    const m = new THREE.Mesh(propUnitGeometry(16, side), unitMat);
    m.scale.setScalar(US); m.position.set(x, 0, 0); m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    labels.push({ text: txt, sub: side ? 'Курчалой' : 'Атаги', at: new THREE.Vector3(x, 1.05, 1.7), side });
  }
  const fit = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.95, 0.3), new THREE.MeshBasicMaterial({ visible: false }));
  fit.position.set(0, 0.55, 1.62);
  scene.add(fit); placed.push(fit);
  pitch = Number(q.get('pitch') ?? 0.16);
} else if (view === 'crowd') {
  // decor at building scale (×1.0) next to the unit versions (×1.7)
  const a = addObj(sportikiCrowd(5, 0), -3.2, 0, 0.15);
  const c = addObj(sportikiCrowd(4, 1), 2.4, 0, -0.15);
  labels.push({ text: 'спортики ×5 (Атаги)', sub: `${trisOf(a)} тр · декор ×1.0`, at: new THREE.Vector3(-3.2, 2.0, 0), side: 0 });
  labels.push({ text: 'спортики ×4 (Курчалой)', sub: `${trisOf(c)} тр · декор ×1.0`, at: new THREE.Vector3(2.4, 2.0, 0), side: 1 });
  const gp = addObj(gelikProp(0), 6.2, 0.4, -0.5);
  labels.push({ text: 'gelikProp', sub: `${trisOf(gp)} тр · ×1.0`, at: new THREE.Vector3(6.2, 1.6, 0.4), side: 0 });
  unit(17, 0, -6.8, 1.4, 0.4);
  unit(17, 1, 8.4, 1.6, -0.4);
  unit(16, 1, 10.8, 0.2, -0.6);
  pitch = Number(q.get('pitch') ?? 0.42);
} else if (view === 'pack3d') {
  const portrait = adminPortrait(0);
  const items: [boolean, HTMLCanvasElement | null, string][] = [[false, null, 'чистый'], [true, null, '18+'], [true, portrait, '18+ · портрет-рендер']];
  items.forEach(([spicy, por, txt], i) => {
    const p = cigPack({ spicy, portrait: por });
    addObj(p.group, -3.2 + i * 3.2, 0, (1 - i) * 0.3);
    labels.push({ text: `пачка: ${txt}`, sub: `${trisOf(p.group)} тр · h ${p.height}`, at: new THREE.Vector3(-3.2 + i * 3.2, p.height + 0.5, 0), side: -1 });
  });
  // как ульта: выскакивает над врагами
  const pop = cigPack({ spicy: true });
  pop.group.position.set(7.0, 1.3, 0.2); pop.group.rotation.set(0.22, -0.45, 0.12);
  pop.group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  scene.add(pop.group); placed.push(pop.group);
  unit(8, 0, -1.6, 1.9, 0.4);
  unit(0, 1, 6.4, 0.9, 0.3, false); unit(1, 1, 7.6, 1.2, -0.4, false); unit(17, 1, 8.4, 0.2, -0.8, false);
  pitch = Number(q.get('pitch') ?? 0.28);
} else if (view === 'lm' || view === 'lm1') {
  const crowd = Number(q.get('crowd') ?? 0);
  const kinds = view === 'lm1' ? [q.get('k') ?? 'stadium'] : LANDMARK_KINDS;
  kinds.forEach((k, i) => {
    const o = landmark(k, { side: (i % 2) as 0 | 1, crowd });
    const x = (i % 4) * 11.5, z = -Math.floor(i / 4) * 10;
    addObj(o, x, z);
    const bb = new THREE.Box3().setFromObject(o), sz = bb.getSize(new THREE.Vector3());
    const [fw, fd] = o.userData.footprint as [number, number];
    labels.push({ text: LM_LABEL[k] ?? k, sub: `${o.userData.tris} тр · ${fw}×${fd} (bbox ${sz.x.toFixed(1)}×${sz.z.toFixed(1)}, h ${sz.y.toFixed(1)})`, at: new THREE.Vector3(x, sz.y + 0.5, z), side: -1 });
  });
  if (view === 'lm1') { unit(0, 0, 3.4, 4.2, 0.3, false); unit(17, 1, 4.4, 4.0, -0.3, false); }
  pitch = Number(q.get('pitch') ?? (view === 'lm1' ? 0.5 : 0.62));
  tight = view === 'lm1' ? 0.95 : 1.0;
} else if (view === 'houses') {
  // village house kits, instanced like world.ts (wall / roof instance colours; &vc turns vertexColors on):
  // the three variants up front, then a mock street — two rows of plots facing a road, at the game camera
  const kit = houseGeometries();
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: q.has('vc') });
  const walls = ['#efe6d6', '#e5d3b3', '#d9c3a0', '#f2ede2', '#c99c78', '#e8dcc0', '#d8cbb6'].map(c => new THREE.Color(c));
  const roofs = ['#4f7a4a', '#8b3a2f', '#3e5f8a', '#6b6f75', '#7a4a2c', '#a8452f', '#557e7a'].map(c => new THREE.Color(c));
  const rnd = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const spots: { v: number; x: number; z: number; ry: number; s: number; sy: number; w: number; r: number }[] = [];
  kit.variants.forEach((_, v) => spots.push({ v, x: -2.2 + v * 1.1, z: 1.9, ry: 0, s: 0.42, sy: 0.27, w: v + 1, r: v * 2 + 1 }));
  for (let k = 0; k < 9; k++) for (const side of [1, -1]) {
    const i = k * 2 + (side > 0 ? 0 : 1);
    const v = rnd(i) < 0.3 ? 0 : rnd(i + 7) < 0.5 ? 1 : 2;
    spots.push({ v, x: -4 + k * 0.62 + rnd(i + 3) * 0.08, z: side * 0.62, ry: side > 0 ? Math.PI : 0, s: 0.3 + rnd(i + 5) * 0.12, sy: rnd(i + 9) > 0.78 ? 0.42 : 0.24 + rnd(i + 2) * 0.06, w: Math.floor(rnd(i + 11) * 7), r: Math.floor(rnd(i + 13) * 7) });
  }
  const road = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.42), new THREE.MeshLambertMaterial({ color: '#8d8a83' }));
  road.rotation.x = -Math.PI / 2; road.position.set(-1.2, 0.005, 0); road.receiveShadow = true;
  scene.add(road);
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion();
  kit.variants.forEach((kv, v) => {
    const list = spots.filter(s => s.v === v);
    for (const [geo, roof] of [[kv.body, false], [kv.roof, true]] as const) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((s, i) => {
        qq.setFromEuler(new THREE.Euler(0, s.ry, 0));
        im.setMatrixAt(i, m4.compose(new THREE.Vector3(s.x, 0, s.z), qq, new THREE.Vector3(s.s, s.sy, s.s)));
        im.setColorAt(i, roof ? roofs[s.r % 7] : walls[s.w % 7]);
      });
      im.castShadow = true; im.receiveShadow = true;
      scene.add(im); placed.push(im);
    }
    labels.push({ text: kv.kind, sub: `${kv.tris} тр`, at: new THREE.Vector3(-2.2 + v * 1.1, 0.5, 1.9), side: -1 });
  });
  if (q.has('units')) { unit(0, 0, 2.6, 0.2, -0.6, false); unit(16, 1, 3.6, 2.4, 2.2, false); }
  if (q.has('dist')) gameCam = { x: -1.2, z: 0.9, dist: Number(q.get('dist')) };
  pitch = Number(q.get('pitch') ?? 0.62);
} else if (view === 'mosques') {
  // Шали (big), the Атаги brick mosque (style 0) and the Курчалой Ottoman one (style 1), a пацан for scale
  const items: [THREE.Group, number, string][] = [[mosque(true), -3.2, 'Шали «Гордость мусульман»'], [mosque(false, 0), 1.6, 'мечеть Атагов (style 0)'], [mosque(false, 1), 4.6, 'мечеть Курчалоя (style 1)']];
  for (const [o, x, name] of items) {
    addObj(o, x, 0, Number(q.get('ry') ?? 0));
    const sz = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
    labels.push({ text: name, sub: `${o.userData.tris} тр · h ${sz.y.toFixed(2)}`, at: new THREE.Vector3(x, sz.y + 0.35, 0), side: -1 });
  }
  unit(0, 0, 3.1, 1.6, 0.3, false);
  if (q.has('dist')) gameCam = { x: 0.6, z: 0, dist: Number(q.get('dist')) };
  pitch = Number(q.get('pitch') ?? 0.32);
} else if (view === 'game2') {
  // a village corner at the in-game camera: stadium, gym, carwash, park, гелики and спортики around
  addObj(landmark('stadium', { side: 1, name: 'СТАДИОН', crowd: 4 }), 0, -2);
  addObj(landmark('gym', { side: 1 }), -9.5, 1.5, 0.3);
  addObj(landmark('carwash', { side: 1 }), 9.5, 1.0, -0.25);
  addObj(landmark('shop', { side: 0 }), -8.0, 8.5, 0.2);
  addObj(landmark('busstop', { side: 0 }), 1.0, 6.8);
  addObj(landmark('park'), 9.0, 9.0);
  unit(16, 1, -3.5, 6.0, 0.9, false); unit(16, 0, 4.2, 8.4, -2.4, false);
  for (let k = 0; k < 4; k++) unit(17, (k % 2) as 0 | 1, -2 + k * 1.3, 9.5 - (k % 2) * 0.8, 1.2 * (k % 2 ? -1 : 1), false);
  unit(6, 1, 2.8, 4.2, 0.5, false); unit(7, 0, 4.4, 4.6, -0.3, false); unit(8, 0, -0.8, 4.0, 0.2, false); unit(9, 1, -1.9, 4.6, 0.8, false);
  gameCam = { x: 0, z: 3, dist: Number(q.get('dist') ?? 38) };
} else if (view === 'v4units') {
  // the new units in both villages, then old ones for comparison (Пацаны, Амин, админ, Гелик)
  v4row(V4_UNIT_KEYS, 0, 2.6, 0, 0.75, [0, 7, 8, 16]);
  v4row(V4_UNIT_KEYS, 1, -2.6, 0, 0.75, [0, 7, 8, 16]);
  pitch = Number(q.get('pitch') ?? 0.5);
} else if (view === 'v4unit') {
  const k = (q.get('k') ?? 'ipit') as V4UnitKey;
  // &a=0..3 keeps one of the four angles (front, three-quarter, side, back) for a close look
  const yaws = [0, 0.75, Math.PI / 2, Math.PI].filter((_, i) => !q.has('a') || Number(q.get('a')) === i);
  const only = q.get('side');
  for (const side of [0, 1] as const) {
    if (only !== null && Number(only) !== side) continue;
    const g = v4UnitGeometry(k, side); g.computeBoundingBox();
    const s = US * v4UnitScale(k, side), bb = g.boundingBox!;
    const ext = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * s;
    g.dispose();
    yaws.forEach((a, i) => v4unit(k, side, i * (ext + 0.5), side === 0 ? ext / 2 + 0.6 : -ext / 2 - 0.6, a, i === 0));
  }
  pitch = Number(q.get('pitch') ?? 0.3);
} else if (view === 'v4game') {
  // how they read at the in-game zoom: each new unit in both colours, among old units
  let x = 0;
  for (const k of V4_UNIT_KEYS) {
    for (const side of [0, 1] as const) v4unit(k, side, x, side === 0 ? 1.4 : -1.4, side === 0 ? 1.0 : -1.8, false);
    x += k === 'bmw' ? 3.4 : 2.4;
  }
  for (const t of [0, 7, 8, 16]) {
    for (const side of [0, 1] as const) unit(t, side, x, side === 0 ? 1.4 : -1.4, side === 0 ? 1.2 : -1.6, false);
    x += t === 16 ? 3.6 : 2.3;
  }
  gameCam = { x: x / 2 - 1, z: 0, dist: Number(q.get('dist') ?? 38) };
} else if (view === 'v4bld' || view === 'v4bldgame') {
  // all five, front to the camera, with a few units for scale; Ансар open and closed; Принглс clean and 18+
  const spicy = q.has('spicy');
  gz('ggntu', 0, 0);
  gz('chgu', 14, 1.5);
  gz('shaiba', 28.5, 0);
  gz('ansar', 40, 2.2);
  gz('ansar', 46, 2.2, { closed: true }, 0, true, 'Ансар · закрыт');
  // one label for the pair (two would stack on top of each other at this zoom)
  gz('pringles', 50.4, 4.4, { spicy: false }, 0.3, false);
  gz('pringles', 51.4, 4.4, { spicy: true }, -0.3, view === 'v4bld', 'Принглс · обычный и 18+');
  unit(0, 0, 2.6, 6.4, 0.3, false); v4unit('ipit', 0, 3.4, 6.2, -0.2, false); v4unit('bmw', 1, 31.5, 7.0, -0.9, false);
  v4unit('operator', 1, 13.4, 5.2, 0.4, false); v4unit('snitch', 0, 15.2, 5.4, -0.3, false); v4unit('drone', 0, 42.0, 4.8, 0.6, false);
  if (spicy) labels.push({ text: '&spicy', sub: 'показаны 18+ варианты', at: new THREE.Vector3(52, 1.4, 4.4), side: -1 });
  if (view === 'v4bldgame') gameCam = { x: Number(q.get('x') ?? 24), z: 2, dist: Number(q.get('dist') ?? 38) };
  else { pitch = Number(q.get('pitch') ?? 0.42); tight = 1.0; }
} else if (view === 'v4bld1') {
  const k = (q.get('k') ?? 'shaiba') as GroznyKey;
  if (k === 'ansar') {
    gz('ansar', -2.8, 0, {}, 0, true, 'Ансар · открыт');
    const shut = gz('ansar', 2.8, 0, {}, 0, true, 'Ансар · setClosed(true)');
    setLandmarkClosed(shut, true);
    v4unit('ipit', 0, -1.6, 2.6, 0.5, false); unit(0, 1, 5.9, 2.0, -0.6, false); unit(1, 1, 6.7, 1.4, -0.3, false); // beside, not in front of the shut door
  } else if (k === 'pringles') {
    gz('pringles', -0.45, 0, { spicy: false }, 0.25, true, 'Принглс');
    gz('pringles', 0.45, 0, { spicy: true }, -0.25, true, 'Принглс · 18+');
  } else {
    const o = gz(k, 0, 0, { side: 0, spicy: q.has('spicy') });
    const b = o.userData.bounds as { z1: number };
    unit(0, 0, -1.8, b.z1 + 0.8, 0.3, false); v4unit('ipit', 0, -0.6, b.z1 + 1.0, -0.2, false); v4unit('bmw', 1, 2.4, b.z1 + 1.0, -0.8, false);
  }
  if (q.has('dist')) gameCam = { x: 0, z: 1, dist: Number(q.get('dist')) };
  else { pitch = Number(q.get('pitch') ?? (k === 'shaiba' ? 0.2 : k === 'pringles' ? 0.4 : 0.32)); tight = 0.95; }
} else if (view === 'city') {
  // 6×6 city blocks (every kind, several seeds) next to the Атаги HQ and a patch of village houses
  const step = 4.6;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    const kind = (i * 7 + j * 3 + (i * j) % 3) % 4;
    const [fw] = cityBlockFootprint(kind);
    const ry = (i + j) % 3 === 0 ? Math.PI / 2 : 0;
    block(kind, i * 6 + j, i * step + (ry ? 0 : (step - fw) * 0.2), -j * step, ry);
  }
  hq(0, 3, -8.5, -4);
  houses(-11.2, 0.4, 12);
  labels.push({ text: 'сельские дома', sub: 'как в world.ts', at: new THREE.Vector3(-10, 1.0, 1.2), side: -1 });
  for (const kind of [0, 1, 2, 3]) {
    const g = cityBlock(kind, 1);
    const [fw, fd] = cityBlockFootprint(kind);
    labels.push({ text: `${CITY_FLOORS[kind]} эт.`, sub: `${g.attributes.position.count / 3} тр · ${fw}×${fd} · h ${cityBlockHeight(kind).toFixed(2)}`, at: new THREE.Vector3(-14 + kind * 4.2, cityBlockHeight(kind) + 0.6, 6), side: -1 });
    g.dispose();
    block(kind, 1, -14 + kind * 4.2, 6);
  }
  if (q.has('dist')) gameCam = { x: 7, z: -8, dist: Number(q.get('dist')) };
  else pitch = Number(q.get('pitch') ?? 0.55);
} else if (view === 'skyline') {
  // Шайба must tower over everything: the Курчалой пятиэтажка, the Атаги HQ, ГГНТУ, ЧГУ and the 16-storey blocks
  gz('shaiba', 0, 0);
  hq(1, 5, -12, 2.5, 0);
  hq(0, 3, 12.5, 3, 0);
  gz('ggntu', 25, -4, {}, 0, true);
  gz('chgu', -26, -2, {}, 0, true);
  block(3, 2, -8.9, -6.5); block(3, 5, 9.0, -6.5); block(2, 3, 18.5, 4.5); block(1, 4, -19, 5.5); block(0, 7, 4.5, 8);
  labels.push({ text: '16 эт.', sub: `h ${cityBlockHeight(3).toFixed(2)}`, at: new THREE.Vector3(-8.9, cityBlockHeight(3) + 0.6, -6.5), side: -1 });
  const m = mosque(false); addObj(m, -20, -6);
  unit(0, 0, 3.6, 6.8, 0.2, false); unit(16, 1, -3.5, 6.6, 0.8, false);
  pitch = Number(q.get('pitch') ?? 0.14);
}

// ---- girls + Вайнаг (fictional lore NPCs, src/render/girls.ts) -------------------------------
//   girls (all looks + Вайнаг both sides, next to Пацаны / админ / Амин) · girlsr (random looks, close)
//   girls1&id=a1|ryzhulka|altushka|operator|g1..g14|vainag0|vainag1 (four angles)
//   girlsgame[&dist=38] (in-game camera) · friends (Амина and Оператор next to Пацаны, Борец, Голем, Чимаев).
//   One self-contained block: own import, own nav links.
if (view === 'girls' || view === 'girls1' || view === 'girlsr' || view === 'girlsgame' || view === 'friends') {
  const G = await import('../src/render/girls');
  const GNAME: Record<string, string> = { a1: 'A1', ryzhulka: 'Рыжулька', altushka: 'Альтушка', operator: 'Оператор', amina: 'Амина' };
  const gname = (id: string) => GNAME[id] ?? `Студентка #${id.slice(1)}`;
  const npc = (g: THREE.BufferGeometry, x: number, z: number, yaw0: number, text: string | null, sub: string, side: number) => {
    const m = new THREE.Mesh(g, unitMat);
    m.scale.setScalar(US); m.position.set(x, 0, z); m.rotation.y = yaw0;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m); placed.push(m);
    g.computeBoundingBox();
    const top = g.boundingBox!.max.y * US;
    if (text) labels.push({ text, sub: `${g.attributes.position.count / 3} тр · h ${top.toFixed(2)} ${sub}`, at: new THREE.Vector3(x, top + 0.25, z), side });
    return (g.boundingBox!.max.x - g.boundingBox!.min.x) * US;
  };
  if (view === 'friends') {
    // the two friends: Оператор (bigger) next to Амина (unit 18), for scale among the usual crowd
    let x = 0;
    for (const [t, s] of [[0, 0], [1, 0], [6, 1]] as const) { unit(t, s, x, 0.4); x += 1.25; }
    x += 0.5; unit(18, 0, x, 0.4); x += 2.6;
    npc(G.girlGeometry('operator'), x, 0.4, 0, 'Оператор', `×${G.OPERATOR_K} Амины`, -1); x += 2.7;
    unit(13, 0, x, 0.4);
    pitch = Number(q.get('pitch') ?? 0.3);
  } else if (view === 'girls') {
    // row 1: the named four + Вайнаг (both sides) next to existing units; row 2: random looks
    let x = 0;
    for (const [t, s] of [[0, 0], [8, 0], [7, 1]] as const) { unit(t, s, x, 1.9); x += 1.05; }
    for (const id of G.NAMED_GIRL_IDS) { x += 0.15; npc(G.girlGeometry(id), x + 0.35, 1.9, 0, gname(id), '', -1); x += 1.05; }
    for (const s of [0, 1] as const) { npc(G.vainagGeometry(s), x + 0.4, 1.9, 0, 'Вайнаг', s ? '· Курчалой' : '· Атаги', s); x += 1.15; }
    G.GIRL_IDS.filter(id => id.startsWith('g')).forEach((id, i) => {
      const look = G.girlLook(Number(id.slice(1)));
      npc(G.girlGeometry(id), 0.6 + (i % 7) * 1.6 + (i < 7 ? 0 : 0.8), i < 7 ? -1.4 : -4.4, 0, `#${id.slice(1)} ${look.acc}`, '', -1);
    });
    pitch = Number(q.get('pitch') ?? 0.62);
  } else if (view === 'girlsr') {
    // random looks only, two rows, close
    G.GIRL_IDS.filter(id => id.startsWith('g')).forEach((id, i) => {
      npc(G.girlGeometry(id), (i % 7) * 1.15, i < 7 ? 1.3 : -1.3, 0, `#${id.slice(1)}`, `· ${G.girlLook(Number(id.slice(1))).acc}`, -1);
    });
    pitch = Number(q.get('pitch') ?? 0.3);
  } else if (view === 'girls1') {
    const id = q.get('id') ?? 'a1';
    const yaws = [0, 0.75, Math.PI / 2, Math.PI];
    yaws.forEach((a, i) => {
      const g = id === 'vainag0' || id === 'vainag1' ? G.vainagGeometry(id === 'vainag1' ? 1 : 0) : G.girlGeometry(id);
      npc(g, i * 1.35, 0, a, i === 0 ? (id.startsWith('vainag') ? 'Вайнаг' : gname(id)) : null, '', -1);
    });
    pitch = Number(q.get('pitch') ?? 0.22);
    tight = 0.92;
  } else {
    // как в игре: перемешаны с пацанами и героями, дистанция 38
    const ids = [...G.GIRL_IDS];
    ids.forEach((id, i) => npc(G.girlGeometry(id), (i % 9) * 2.3, i < 9 ? 1.6 : -1.4, i % 2 ? 1.2 : -0.9, null, '', -1));
    npc(G.vainagGeometry(0), 21.5, 1.6, 0.6, null, '', 0);
    npc(G.vainagGeometry(1), 21.5, -1.4, -0.8, null, '', 1);
    unit(0, 0, 24.0, 1.6, 1.2, false); unit(8, 0, 24.0, -1.4, -1.6, false); unit(7, 1, 26.3, 1.6, 1.2, false); unit(6, 1, 26.3, -1.4, -1.6, false);
    gameCam = { x: 13.2, z: 0, dist: Number(q.get('dist') ?? 38) };
  }
  queueMicrotask(() => {
    const bar = document.getElementById('bar')!;
    for (const [v, txt] of [['girls', 'девушки + Вайнаг'], ['girlsr', 'случайные'], ['girlsgame', 'девушки в игре'], ['friends', 'Амина и Оператор'], ...[...G.NAMED_GIRL_IDS, 'amina', 'vainag0', 'vainag1', 'g1'].map(id => [`girls1&id=${id}`, id.startsWith('vainag') ? `Вайнаг ${id.slice(-1)}` : gname(id)])]) {
      const a = document.createElement('a');
      a.href = `?view=${v}`; a.textContent = txt;
      const lq = new URLSearchParams(`view=${v}`);
      if ([...lq].every(([k, val]) => (k === 'view' ? view : q.get(k)) === val)) a.className = 'on';
      bar.append(a);
    }
  });
}

// ---- camera ---------------------------------------------------------------------------------
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
resize();

const target = new THREE.Vector3();
if (gameCam) {
  const k = (gameCam.dist - 7) / (300 - 7);
  const p = 0.62 + Math.pow(Math.max(0, k), 0.6) * 0.62;
  target.set(gameCam.x, 0, gameCam.z);
  camera.position.set(target.x + Math.sin(yaw) * Math.cos(p) * gameCam.dist, Math.sin(p) * gameCam.dist, target.z + Math.cos(yaw) * Math.cos(p) * gameCam.dist);
  camera.lookAt(target);
} else {
  // fit the projected bounding box (leave room for the nav bar and labels on top)
  const box = new THREE.Box3();
  for (const o of placed) box.expandByObject(o);
  box.max.y += 0.6;
  const corners: THREE.Vector3[] = [];
  for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 0.9, th = tv * camera.aspect;
  box.getCenter(target);
  const place = (d: number) => { camera.position.copy(target).addScaledVector(dir, d); camera.lookAt(target); camera.updateMatrixWorld(); };
  const extent = () => {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    const inv = camera.matrixWorldInverse;
    for (const p of corners) {
      const v = p.clone().applyMatrix4(inv);
      const x = v.x / -v.z, y = v.y / -v.z;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { x0, x1, y0, y1 };
  };
  let d = 30;
  for (let it = 0; it < 4; it++) {
    let lo = 1, hi = 600;
    for (let k = 0; k < 40; k++) {
      d = (lo + hi) / 2; place(d);
      const e = extent();
      if (e.x1 - e.x0 > 2 * th || e.y1 - e.y0 > 2 * tv) lo = d; else hi = d;
    }
    d = hi * tight; place(d);
    const e = extent();
    // recentre: move the target so the projected box sits in the middle (slightly low for the nav)
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    target.addScaledVector(right, ((e.x0 + e.x1) / 2) * d).addScaledVector(up, ((e.y0 + e.y1) / 2 + 0.03) * d);
  }
  place(d);
}
const span = 60;
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = 200; sc.updateProjectionMatrix();
sun.position.set(target.x - 45, target.y + 70, target.z + 40);
sun.target.position.copy(target);

// ---- DOM labels + nav -----------------------------------------------------------------------
const nav = document.getElementById('bar')!;
for (const [v, txt] of [['all', 'всё'], ['heroes', 'новые'], ['units', 'сравнение 1'], ['units&half=2', 'сравнение 2'], ['hero&t=6', 'крупно'], ['bld', 'здания'], ['doner', 'донер'], ['decor', 'декор'], ['game', 'как в игре'], ['portraits', 'портреты'],
  ['v3', 'v3 герои'], ['plate', 'КРА 95'], ['crowd', 'спортики'], ['pack', 'пачка 2D'], ['pack3d', 'пачка 3D'], ['lm', 'места'], ['game2', 'места в игре'],
  ['v4units', 'v4 юниты'], ['v4unit&k=ipit', 'v4 крупно'], ['v4game', 'v4 в игре'], ['v4bld', 'Грозный'], ['v4bld1&k=shaiba', 'Грозный крупно'], ['v4bldgame', 'Грозный в игре'],
  ['city', 'кварталы'], ['skyline', 'силуэт'], ['houses', 'дома'], ['houses&dist=14', 'улица в игре'], ['mosques', 'мечети']]) {
  const a = document.createElement('a');
  a.href = `?view=${v}`; a.textContent = txt;
  const lq = new URLSearchParams(`view=${v}`);
  if ([...lq].every(([k, val]) => (k === 'view' ? view : q.get(k)) === val) && lq.has('half') === q.has('half')) a.className = 'on';
  nav.append(a);
}
if (view === 'hero') for (const t of [...HEROES, ...PROP_TYPES]) {
  const a = document.createElement('a');
  a.href = `?view=hero&t=${t}`; a.textContent = NAMES[t][0];
  if (Number(q.get('t') ?? 6) === t) a.className = 'on';
  nav.append(a);
}
if (view === 'v4unit') for (const k of V4_UNIT_KEYS) {
  const a = document.createElement('a');
  a.href = `?view=v4unit&k=${k}`; a.textContent = V4_UNIT_NAMES[k];
  if ((q.get('k') ?? 'ipit') === k) a.className = 'on';
  nav.append(a);
}
if (view === 'v4bld1') for (const k of GROZNY_KEYS) {
  const a = document.createElement('a');
  a.href = `?view=v4bld1&k=${k}`; a.textContent = GZ_LABEL[k];
  if ((q.get('k') ?? 'shaiba') === k) a.className = 'on';
  nav.append(a);
}
if (view === 'lm' || view === 'lm1') for (const k of LANDMARK_KINDS) {
  const a = document.createElement('a');
  a.href = `?view=lm1&k=${k}`; a.textContent = LM_LABEL[k];
  if (view === 'lm1' && q.get('k') === k) a.className = 'on';
  nav.append(a);
}
function drawLabels() {
  const root = document.getElementById('labels')!;
  root.innerHTML = '';
  for (const l of labels) {
    const v = l.at.clone().project(camera);
    if (v.z > 1) continue;
    const el = document.createElement('div');
    el.className = `lbl s${l.side}`;
    el.innerHTML = `${l.text}<small>${l.sub}</small>`;
    el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
    root.append(el);
  }
}

// ---- portraits: same framing as src/ui/portraits.ts -------------------------------------------
function portraits() {
  canvas.style.display = 'none';
  const grid = document.getElementById('grid')!;
  grid.style.display = 'flex';
  const pc = document.createElement('canvas');
  const r = new THREE.WebGLRenderer({ canvas: pc, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const ps = new THREE.Scene();
  ps.add(new THREE.HemisphereLight('#fff6e6', '#6b6450', 1.6));
  const ls = new THREE.DirectionalLight('#ffe7c4', 2.2);
  ls.position.set(-2, 4, 3);
  ps.add(ls);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const shot = (obj: THREE.Object3D, w: number, h: number, height: number, a: number) => {
    r.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
    obj.rotation.y = a;
    ps.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const sp = Math.max(size.y, size.x * h / w, size.z * 0.8) * 1.12;
    const d = sp / 2 / Math.tan((cam.fov * Math.PI) / 360);
    cam.position.set(c.x + d * 0.35, c.y + sp * 0.22, c.z + d);
    cam.lookAt(c.x, c.y - height * 0.02, c.z);
    r.setClearColor(0x000000, 0);
    r.render(ps, cam);
    const url = pc.toDataURL('image/png');
    ps.remove(obj);
    return url;
  };
  for (const side of [0, 1] as const) for (const t of [...OLD, ...HEROES, ...PROP_TYPES]) {
    const m = new THREE.Mesh(geoFor(t, side), unitMat);
    const fig = document.createElement('figure');
    const img = new Image();
    img.src = shot(m, 172, 144, 1, t === 3 || t === 14 || t === 16 ? 0.9 : 0.5);
    fig.append(img, NAMES[t][side]);
    fig.style.borderBottom = `3px solid ${side ? '#d8361f' : '#2a52d1'}`;
    grid.append(fig);
  }
}

// ---- pack faces (2D): clean / 18+, drawn caricature / model render ---------------------------------
function packFaces() {
  canvas.style.display = 'none';
  const grid = document.getElementById('grid')!;
  grid.style.display = 'flex';
  const portrait = adminPortrait(0);
  const items: [boolean, HTMLCanvasElement | null, string][] = [
    [false, null, 'чистый · рисованный админ'], [true, null, '18+ · рисованный админ'],
    [false, portrait, 'чистый · рендер модели'], [true, portrait, '18+ · рендер модели'],
  ];
  for (const [spicy, por, cap] of items) {
    const c = cigPackTexture({ spicy, portrait: por });
    c.style.width = '264px'; c.style.height = '422px'; c.style.display = 'block';
    const fig = document.createElement('figure');
    fig.append(c, cap);
    grid.append(fig);
  }
  const fig = document.createElement('figure');
  fig.append(portrait, 'portrait (рендер)');
  portrait.style.width = '210px'; portrait.style.display = 'block'; portrait.style.background = '#cfc6b3';
  grid.append(fig);
}

// ---- go ---------------------------------------------------------------------------------------
const w = window as Window & { __lineupReady?: boolean; __spin?: (a: number) => void; __info?: string };
w.__spin = (a: number) => { for (const s of spinners) s.rotation.y = a; for (const p of props) p.rotation.y = a * 9; draw(); };
w.__info = labels.map(l => `${l.text} [${l.sub}]`).join(' | ');
async function go() {
  if (view === 'portraits') { portraits(); w.__lineupReady = true; return; }
  if (view === 'pack') {
    packFaces();
    try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 3000))]); } catch { /* no fonts api */ }
    await new Promise(r => setTimeout(r, 600));
    w.__lineupReady = true;
    return;
  }
  try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 3000))]); } catch { /* no fonts api */ }
  await new Promise(r => setTimeout(r, 300));
  draw();
  drawLabels();
  w.__lineupReady = true;
  if (q.has('anim')) {
    const loop = (t: number) => { for (const s of spinners) s.rotation.y = t / 600; for (const p of props) p.rotation.y = t / 40; draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
addEventListener('resize', () => { resize(); draw(); drawLabels(); });
void go();
