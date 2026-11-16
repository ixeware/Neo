// Dev-only lineup of every unit model and the street-food buildings, lit like the game.
// `npm run dev`, then open /tools/lineup.html?view=…
//   all · heroes · units[&half=2] (old next to new) · hero&t=6..15[&side=0|1] (four angles)
//   bld · doner · decor · game[&dist=38] (in-game camera) · portraits (same framing as the HUD cards)
// Extras: &yaw= &pitch= (camera), &spicy (18+ sign), &anim (spin the doner), &noshadow.
import * as THREE from 'three';
import { unitGeometry, unitScale, islamRig, zurabRig } from '../src/render/models';
import { heroGeometry, heroScale, donerBey, fudzi, gym, taxiStand, HERO_TYPES } from '../src/render/heroes';
import { mosque, HqBuilding } from '../src/render/world';

const US = 1.7; // renderer's unit scale (units.ts)
const BS = 1.45; // boss scale
const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'all';

const NAMES: Record<number, [string, string]> = {
  0: ['Пацаны', 'Пацаны'], 1: ['Борец', 'Борец 115 кг'], 2: ['Снайпер', 'Метатель гантелей'], 3: ['Баран', 'Камри без прав'], 4: ['Бежни лор', 'Шаурмист'],
  6: ['Чимаев 5.5', 'Чимаев 5.5'], 7: ['WOU', 'WOU'], 8: ['админ', 'админ'], 9: ['ersno', 'ersno'], 10: ['Бекхан', 'Бекхан'],
  11: ['Адам', 'Адам'], 12: ['Мохьмад', 'Мохьмад'], 13: ['Голем', 'Голем'], 14: ['Такси по 100', 'Маршрутка 150 ₽'], 15: ['Курица', 'Курица'],
};

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
scene.add(new THREE.HemisphereLight('#fff4e0', '#6d6a4c', 1.6));
const sun = new THREE.DirectionalLight('#ffe2b0', 1.9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: '#b3ad7c' }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const unitMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const placed: THREE.Object3D[] = [];
interface Lbl { text: string; sub: string; at: THREE.Vector3; side: number }
const labels: Lbl[] = [];

function geoFor(type: number, side: 0 | 1) { return type < 6 ? unitGeometry(type, side) : heroGeometry(type, side); }
function scaleFor(type: number, side: 0 | 1) { return US * (type < 6 ? unitScale(type, side) : heroScale(type, side)); }

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
  if (label) labels.push({ text: NAMES[type]?.[side] ?? `#${type}`, sub: `${g.attributes.position.count / 3} тр · ×${(s / US).toFixed(2)}`, at: new THREE.Vector3(x, bb.max.y * s + 0.25, z), side });
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

// ---- views ------------------------------------------------------------------------------
const OLD = [0, 1, 2, 3, 4];
const HEROES = [...HERO_TYPES];
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
  for (const t of [0, 1, 4, ...HEROES]) {
    for (const side of [0, 1] as const) unit(t, side, x, side === 0 ? 1.4 : -1.4, side === 0 ? 1.2 : -1.6, false);
    x += t === 14 || t === 13 ? 3.6 : 2.3;
  }
  gameCam = { x: x / 2, z: 0, dist: Number(q.get('dist') ?? 38) };
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
for (const [v, txt] of [['all', 'всё'], ['heroes', 'новые'], ['units', 'сравнение 1'], ['units&half=2', 'сравнение 2'], ['hero&t=6', 'крупно'], ['bld', 'здания'], ['doner', 'донер'], ['decor', 'декор'], ['game', 'как в игре'], ['portraits', 'портреты']]) {
  const a = document.createElement('a');
  a.href = `?view=${v}`; a.textContent = txt;
  const lq = new URLSearchParams(`view=${v}`);
  if ([...lq].every(([k, val]) => (k === 'view' ? view : q.get(k)) === val) && lq.has('half') === q.has('half')) a.className = 'on';
  nav.append(a);
}
if (view === 'hero') for (const t of HEROES) {
  const a = document.createElement('a');
  a.href = `?view=hero&t=${t}`; a.textContent = NAMES[t][0];
  if (Number(q.get('t') ?? 6) === t) a.className = 'on';
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
  for (const side of [0, 1] as const) for (const t of [...OLD, ...HEROES]) {
    const m = new THREE.Mesh(geoFor(t, side), unitMat);
    const fig = document.createElement('figure');
    const img = new Image();
    img.src = shot(m, 172, 144, 1, t === 3 || t === 14 ? 0.9 : 0.5);
    fig.append(img, NAMES[t][side]);
    fig.style.borderBottom = `3px solid ${side ? '#d8361f' : '#2a52d1'}`;
    grid.append(fig);
  }
}

// ---- go ---------------------------------------------------------------------------------------
const w = window as Window & { __lineupReady?: boolean; __spin?: (a: number) => void };
w.__spin = (a: number) => { for (const s of spinners) s.rotation.y = a; renderer.render(scene, camera); };
async function go() {
  if (view === 'portraits') { portraits(); w.__lineupReady = true; return; }
  try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 3000))]); } catch { /* no fonts api */ }
  await new Promise(r => setTimeout(r, 300));
  renderer.render(scene, camera);
  drawLabels();
  w.__lineupReady = true;
  if (q.has('anim')) {
    const loop = (t: number) => { for (const s of spinners) s.rotation.y = t / 600; renderer.render(scene, camera); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
addEventListener('resize', () => { resize(); renderer.render(scene, camera); drawLabels(); });
void go();
