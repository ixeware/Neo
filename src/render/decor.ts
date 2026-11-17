// Street food and village decor: Донер Бей at pts[8] (with its capture ring and flag), Фудзи and
// the gym in Курчалой, the taxi stand in Старые Атаги, and a model for every real 2GIS place
// (landmarks.ts plans the spots). Placement comes from world.ts decorSpots() and landmarkSpots(),
// which buildVillages also uses to keep houses off these spots. v4: Грозный (city.ts): the apartment
// blocks with their LOD, the city landmarks and Донер Бей at its real spot on ул. Мира. Render-only:
// reads the sim, never writes.
import * as THREE from 'three';
import { donerBey, fudzi, gym, taxiStand } from './heroes';
import { decorSpots, followPoints, mosque, VillageMarker, updateWorldLod } from './world';
import { updateRoadLod } from './roads';
import { landmark, gelikProp } from './props';
import { landmarkPlan, type LmSpot } from './landmarks';
import { isLowPower } from './scene';
import { heightY, type Terrain } from '../world/terrain';
import { PT_DONER, type Sim, type Pt } from '../sim/sim';
import { DONER } from '../data/heroes';
import { DONER_REAL } from '../data/places';
import { cityPlan, CityFill, buildCityLandmarks, type CityLandmarks } from './city';

export { landmarkSpots, landmarkPlan, fudziSpot } from './landmarks';

export interface Decor { update(dt: number): void; setSpicy(on: boolean): void; landmarks: Landmarks; city: { fill: CityFill; landmarks: CityLandmarks } }
/** What the decor needs to know about the camera (Stage has it) for its level of detail. */
export interface DecorView { target: { x: number; z: number }; dist: number; camera?: { position: { x: number; y: number; z: number } } }

/** Pavilion front faces south-south-east: towards the plain and the opening camera. */
const DONER_RY = 0.3;

/** Lowest ground under a footprint (local half-sizes, rotated): the building sinks a little rather than floats. */
function groundY(t: Terrain, x: number, z: number, ry: number, hx: number, hz0: number, hz1: number) {
  const c = Math.cos(ry), s = Math.sin(ry);
  let lo = heightY(t, x, z);
  for (const [lx, lz] of [[-hx, hz0], [hx, hz0], [-hx, hz1], [hx, hz1], [0, hz0], [0, hz1], [-hx, 0], [hx, 0]]) {
    const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
    lo = Math.min(lo, heightY(t, wx, wz));
  }
  return lo - 0.05;
}

/** Soft grey puff for the grill smoke. */
function puffTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  r.addColorStop(0, 'rgba(150,145,138,0.95)');
  r.addColorStop(0.55, 'rgba(168,162,154,0.55)');
  r.addColorStop(1, 'rgba(200,195,186,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Puff { s: THREE.Sprite; age: number; life: number; drift: number }

// ---- real 2GIS places --------------------------------------------------------------------------
/** Short sign text for a place (the model's sign is small): «Торговый центр «Атаги»» → «ТЦ «АТАГИ»». */
const SIGN_SHORT: [RegExp, string][] = [
  [/^Торговый центр/, 'ТЦ'], [/^Автомойка самообслуживания/, 'АВТОМОЙКА'], [/^Автомойка и СТО/, 'МОЙКА · СТО'],
  [/^Футбольное поле.*/, 'ФУТБОЛ'], [/^Спортшкола дзюдо/, 'ДЗЮДО'], [/^Районная больница/, 'БОЛЬНИЦА'],
  [/^Центральный парк.*/, 'ПАРК'], [/^Школьный стадион.*/, 'СТАДИОН'], [/^Стадион.*/, 'СТАДИОН'],
  [/^Супермаркет у трассы/, 'СУПЕРМАРКЕТ'], [/^Ресторан у трассы/, 'РЕСТОРАН'], [/^Заправка.*/, 'АЗС'],
  [/^Шаурма на углу/, 'ШАУРМА'], [/^Спорткомплекс/, 'СПОРТКОМПЛЕКС'],
  [/ (Новых Атагов|Шали|Автуров|Чечен-Аула|Цоцин-Юрта|Курчалоя)$/, ''], [/^Школа (Цоцин-Юрта|Новых Атагов)$/, 'ШКОЛА'],
];
export function signName(name: string): string {
  let s = name;
  for (const [re, to] of SIGN_SHORT) s = s.replace(re, to);
  return s.toUpperCase();
}

/** Copies vertex-coloured meshes into one geometry per bucket (world space): a few draw calls for all the places. */
class Merger {
  private parts = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; small: boolean; cx: number; cz: number }>();
  add(m: THREE.Mesh, key: string, small: boolean, cx: number, cz: number) {
    const g = m.geometry, a = g.attributes;
    if (!a.position || !a.normal || !a.color) return false;
    let b = this.parts.get(key);
    if (!b) this.parts.set(key, (b = { mat: m.material as THREE.Material, geos: [], small, cx, cz }));
    const c = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(c.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') c.deleteAttribute(k);
    b.geos.push(c);
    return true;
  }
  build(parent: THREE.Object3D, shadows: boolean): { mesh: THREE.Mesh; small: boolean; cx: number; cz: number }[] {
    const out: { mesh: THREE.Mesh; small: boolean; cx: number; cz: number }[] = [];
    for (const b of this.parts.values()) {
      let n = 0;
      for (const g of b.geos) n += g.attributes.position.count;
      const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
      let o = 0;
      for (const g of b.geos) {
        P.set(g.attributes.position.array as Float32Array, o); N.set(g.attributes.normal.array as Float32Array, o);
        C.set(g.attributes.color.array as Float32Array, o);
        o += g.attributes.position.count * 3;
        g.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, b.mat);
      mesh.castShadow = shadows; mesh.receiveShadow = true;
      parent.add(mesh);
      out.push({ mesh, small: b.small, cx: b.cx, cz: b.cz });
    }
    return out;
  }
}

interface LmView { l: LmSpot; signs: THREE.Object3D[]; top: number }
export interface Landmarks { list: LmView[]; update(view: DecorView | undefined): void; tris: number }

/**
 * Builds every planned landmark: props.landmark models (scaled to the map, facing their village),
 * small mosques, parked Гелики at the car washes, спортики at the stadium places. The solid parts
 * are merged per 60-unit chunk (small places in their own chunks so low-power devices can drop
 * them away from the camera); the canvas signs stay separate and only show up close.
 */
function buildLandmarks(root: THREE.Object3D, t: Terrain, low: boolean): Landmarks {
  const merge = new Merger();
  const list: LmView[] = [];
  const holder = new THREE.Group();
  holder.name = 'landmarks';
  root.add(holder);
  let tris = 0;
  for (const l of landmarkPlan(t)) {
    const outer = new THREE.Group();
    const c = Math.cos(l.ry), sn = Math.sin(l.ry);
    /** world (x, z) of a point given in outer's local frame */
    const wx = (lx: number, lz: number) => l.x + lx * c + lz * sn, wz = (lx: number, lz: number) => l.z - lx * sn + lz * c;
    let top = 2, y0: number;
    /** things that stand outside the levelled pad (the crowd, the parked Гелик): each on its own ground */
    const loose: { o: THREE.Object3D; lx: number; lz: number; k: number }[] = [];
    if (l.kind === 'mosque') {
      const m = mosque(false);
      outer.add(m);
      top = 2.4;
      const hr = l.r * 0.75;
      y0 = groundY(t, l.x, l.z, l.ry, hr, -hr, hr);
    } else {
      const g = landmark(l.kind, { name: signName(l.name), side: l.side, crowd: l.crowd });
      const bd = g.userData.bounds as { x0: number; x1: number; z0: number; z1: number; h: number };
      const ox = -((bd.x0 + bd.x1) / 2) * l.s, oz = -((bd.z0 + bd.z1) / 2) * l.s;
      g.scale.setScalar(l.s);
      g.position.set(ox, 0, oz);
      outer.add(g);
      top = bd.h * l.s;
      // the flat ones (a pitch is 6 cm tall here) vanish into a slope: stand on the footprint's highest
      // point and put a levelled earth pad under it down to the lowest one
      const hx = ((bd.x1 - bd.x0) / 2) * l.s, hz = ((bd.z1 - bd.z0) / 2) * l.s;
      let lo = Infinity, hi = -Infinity;
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
        const y = heightY(t, wx((hx * i) / 3, (hz * j) / 3), wz((hx * i) / 3, (hz * j) / 3));
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
      y0 = hi - 0.03;
      if (hi - lo > 0.04) {
        const depth = hi - lo + 0.12;
        const pad = new THREE.BoxGeometry(hx * 2 + 0.08, depth, hz * 2 + 0.08);
        pad.translate(0, -depth / 2 - 0.004, 0);
        const n = pad.attributes.position.count, col = new Float32Array(n * 3), top0 = new THREE.Color('#bfae8c'), side = new THREE.Color('#a8936d');
        for (let i = 0; i < n; i++) (pad.attributes.normal.getY(i) > 0.5 ? top0 : side).toArray(col, i * 3);
        pad.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const main = g.children.find(o => (o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material as THREE.MeshLambertMaterial).vertexColors) as THREE.Mesh | undefined;
        if (main) outer.add(new THREE.Mesh(pad, main.material));
        else pad.dispose();
      }
      const crowd = g.userData.crowd as THREE.Object3D | undefined;
      if (crowd) loose.push({ o: crowd, lx: ox + crowd.position.x * l.s, lz: oz + crowd.position.z * l.s, k: l.s });
      if (l.gelik) {
        // a second one waits its turn on the forecourt (the first is in the foam in bay one), at building
        // scale and inside the footprint, so it never ends up on a neighbour's pitch
        const car = gelikProp(l.side ?? 1);
        car.scale.setScalar(l.s);
        car.rotation.y = Math.PI / 2 + 0.22;
        car.position.set(ox + 0.45 * l.s, 0.07 * l.s, oz + Math.min(1.95, bd.z1 - 0.7) * l.s);
        outer.add(car);
      }
    }
    outer.position.set(l.x, y0, l.z);
    for (const q of loose) q.o.position.y = (heightY(t, wx(q.lx, q.lz), wz(q.lx, q.lz)) - 0.03 - y0) / q.k;
    outer.rotation.y = l.ry;
    holder.add(outer);
    outer.updateMatrixWorld(true);
    const signs: THREE.Object3D[] = [];
    const meshes: THREE.Mesh[] = [];
    outer.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) meshes.push(m); });
    const ck = `${Math.floor(l.x / 60)}:${Math.floor(l.z / 60)}`;
    for (const m of meshes) {
      const mat = m.material as THREE.MeshLambertMaterial;
      tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      if (!Array.isArray(m.material) && mat.vertexColors && merge.add(m, `${ck}:${mat.uuid}:${l.small ? 's' : 'b'}`, l.small, l.x, l.z)) {
        m.removeFromParent();
        continue;
      }
      // canvas signs: re-parent to the holder with their world transform, shown only up close
      m.updateWorldMatrix(true, false);
      m.matrixWorld.decompose(m.position, m.quaternion, m.scale);
      m.removeFromParent();
      m.castShadow = false;
      m.visible = false;
      holder.add(m);
      signs.push(m);
    }
    outer.removeFromParent();
    list.push({ l, signs, top });
  }
  const chunks = merge.build(holder, !low);
  let next = 0;
  return {
    list, tris,
    update(view) {
      if (!view) return;
      const now = performance.now();
      if (now < next) return;
      next = now + 120;
      const tx = view.target.x, tz = view.target.z, d = view.dist;
      // signs: readable only close up
      const signR = d < 75 ? 34 + d * 0.5 : -1;
      for (const v of list) {
        const on = signR > 0 && (v.l.x - tx) ** 2 + (v.l.z - tz) ** 2 < signR * signR && !(low && v.l.small && d > 45);
        if (v.signs.length && v.signs[0].visible !== on) for (const s of v.signs) s.visible = on;
      }
      // low power: small places only near the camera; from the overview (where a school is 3 px) none at all
      if (low) for (const c of chunks) {
        c.mesh.visible = c.small ? d < 110 && (c.cx - tx) ** 2 + (c.cz - tz) ** 2 < 95 * 95 : d < 170;
      }
    },
  };
}

export function buildDecor(parent: THREE.Object3D, sim: Sim, view?: DecorView): Decor {
  const t = sim.terrain;
  const root = new THREE.Group();
  root.name = 'decor';
  parent.add(root);
  const low = isLowPower();
  // keep the village flags in step with the sim's current points (they are replaced every war)
  followPoints(() => sim.st.pts);

  // ---- Донер Бей -----------------------------------------------------------------------------
  // v4: the pavilion stands at its real spot in Grozny (city.ts draws it). Until the v4 sim moves pts[8]
  // there, the old pavilion stays on the sim's point so the fight around it still has a building.
  const pts = sim.st.pts;
  // the sim always has pts[8]; the fallback only keeps a broken save from taking the decor down
  const donerPt = (): Pt => sim.st.pts.find(p => p.key === 'doner') ?? sim.st.pts[PT_DONER] ?? { key: 'doner', name: DONER.clean, x: 30, z: 12, r: 6, kind: 2, side: -1, owner: -1, prog: 0 };
  const dp: Pt = pts.find(p => p.key === 'doner') ?? donerPt();
  const atReal = (p: Pt) => (p.x - DONER_REAL.x) ** 2 + (p.z - DONER_REAL.z) ** 2 < 9;
  const db = donerBey();
  const dy = groundY(t, dp.x, dp.z, DONER_RY, 2.2, -1.25, 2.3);
  db.group.position.set(dp.x, dy, dp.z);
  db.group.rotation.y = DONER_RY;
  db.group.visible = !atReal(dp);
  root.add(db.group);
  let spicy: boolean | null = null;

  // ---- Грозный: blocks with LOD, landmarks, the real Донер Бей --------------------------------------
  const city = { fill: new CityFill(t, cityPlan(t), low, !low), landmarks: buildCityLandmarks(t, { doner: donerBey, busstop: (name, side) => landmark('busstop', { name, side }) }, !low) };
  root.add(city.fill.group, city.landmarks.group);
  city.landmarks.doner?.setSign(DONER.clean.toUpperCase()); // v4 content policy: the real place keeps its real name, 18+ or not
  for (const sg of city.landmarks.signs) sg.visible = false;
  console.info(`city: ${city.fill.count} blocks, landmarks ${Math.round(city.landmarks.tris / 1000)}k tris`);

  // capture ring + flag on the sim's point; the pole stands at the back corner so it clears the pavilion
  // (rebuilt where the point is whenever the sim moves it)
  let marker = new VillageMarker(t, dp), markerAt = { x: NaN, z: NaN };
  const placeMarker = (p: Pt) => {
    marker.group.removeFromParent();
    marker = new VillageMarker(t, p);
    markerAt = { x: p.x, z: p.z };
    const ry = atReal(p) ? (city.landmarks.doner?.group.parent?.rotation.y ?? DONER_RY) : DONER_RY;
    const k = atReal(p) ? 0.72 : 1;
    const c = Math.cos(ry), s = Math.sin(ry);
    const lx = 2.05 * k, lz = -1.15 * k;
    const px = p.x + lx * c + lz * s, pz = p.z - lx * s + lz * c;
    const py = heightY(t, px, pz);
    marker.pole.position.set(px, py + 1.6, pz);
    marker.flag.position.set(px + 0.6, py + 2.75, pz);
    root.add(marker.group);
  };
  placeMarker(dp);

  // grill smoke out of the roof vent (local 1.3, 2.2, -0.6)
  const vent = new THREE.Vector3(1.3, 2.25, -0.6);
  db.group.updateMatrixWorld(true);
  vent.applyMatrix4(db.group.matrixWorld);
  const puffMap = puffTexture();
  const puffs: Puff[] = [];
  const nPuff = low ? 4 : 8;
  for (let k = 0; k < nPuff; k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffMap, transparent: true, depthWrite: false, opacity: 0 }));
    s.renderOrder = 4;
    root.add(s);
    puffs.push({ s, age: (k / nPuff) * 2.6, life: 2.6, drift: (k * 0.37) % 1 });
  }

  // ---- village decor ---------------------------------------------------------------------------
  const spins: THREE.Object3D[] = [db.spit];
  if (city.landmarks.doner) spins.push(city.landmarks.doner.spit);
  for (const d of decorSpots(t)) {
    const g = d.key === 'fudzi' ? fudzi() : d.key === 'gym' ? gym() : taxiStand();
    const [hx, hz0, hz1] = d.key === 'fudzi' ? [1.2, -0.75, 1.25] : d.key === 'gym' ? [1.6, -0.9, 1.6] : [1.2, -0.5, 0.7];
    g.position.set(d.x, groundY(t, d.x, d.z, d.ry, hx, hz0, hz1), d.z);
    g.rotation.y = d.ry;
    root.add(g);
    const sp = g.userData.spit as THREE.Object3D | undefined;
    if (sp) spins.push(sp);
  }
  if (low) root.traverse(o => { o.castShadow = false; });
  const lm = buildLandmarks(root, t, low);
  console.info(`landmarks ${lm.list.length}, ${Math.round(lm.tris / 1000)}k tris`);

  let time = 0, nextCity = 0;
  return {
    landmarks: lm, city,
    update(dt: number) {
      time += dt;
      lm.update(view);
      city.fill.update(view);
      const now = performance.now();
      if (now > nextCity) {
        nextCity = now + 150;
        // distance LOD: houses and trees thin out with the camera distance, streets go from far out
        if (view?.camera) updateWorldLod(view.camera.position);
        if (view) updateRoadLod(view.dist);
        // the sim's Донер Бей point: follow it if a save or the v4 sim moved it
        const p = donerPt();
        if (Math.abs(p.x - markerAt.x) + Math.abs(p.z - markerAt.z) > 0.3) {
          placeMarker(p);
          db.group.visible = !atReal(p);
          if (db.group.visible) db.group.position.set(p.x, groundY(t, p.x, p.z, DONER_RY, 2.2, -1.25, 2.3), p.z);
        }
        // city signs: readable only up close
        if (view) {
          const tx = view.target.x, tz = view.target.z, R = view.dist < 75 ? 30 + view.dist * 0.5 : -1;
          for (const sg of city.landmarks.signs) {
            const at = sg.userData.at as [number, number];
            const on = R > 0 && (at[0] - tx) ** 2 + (at[1] - tz) ** 2 < R * R;
            if (sg.visible !== on) sg.visible = on;
          }
        }
      }
      for (const s of spins) s.rotation.y += dt * 1.4;
      marker.update(time);
      for (const p of puffs) {
        p.age += dt;
        if (p.age >= p.life) { p.age -= p.life; p.drift = (p.drift + 0.618) % 1; }
        const f = p.age / p.life;
        const k = 0.45 + f * 1.5;
        p.s.position.set(vent.x + (p.drift - 0.5) * 0.3 + f * 0.6, vent.y + f * 2.4, vent.z + f * 0.25);
        p.s.scale.set(k, k, k);
        (p.s.material as THREE.SpriteMaterial).opacity = Math.min(1, f * 6) * (1 - f) * 0.8;
      }
    },
    setSpicy(on: boolean) {
      if (spicy === on) return;
      spicy = on;
      db.setSign(DONER.clean.toUpperCase()); // one name, 18+ or not
    },
  };
}
