// Street food and village decor: Донер Бей at pts[8] (with its capture ring and flag), Фудзи and
// the gym in Курчалой, the taxi stand in Старые Атаги. Placement comes from world.ts decorSpots(),
// which buildVillages also uses to keep houses off these spots. Render-only: reads the sim, never writes.
import * as THREE from 'three';
import { donerBey, fudzi, gym, taxiStand } from './heroes';
import { decorSpots, followPoints, VillageMarker } from './world';
import { isLowPower } from './scene';
import { heightY, type Terrain } from '../world/terrain';
import { PT_DONER, type Sim, type Pt } from '../sim/sim';
import { DONER } from '../data/heroes';

export interface Decor { update(dt: number): void; setSpicy(on: boolean): void }

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

export function buildDecor(parent: THREE.Object3D, sim: Sim): Decor {
  const t = sim.terrain;
  const root = new THREE.Group();
  root.name = 'decor';
  parent.add(root);
  const low = isLowPower();
  // keep the village flags in step with the sim's current points (they are replaced every war)
  followPoints(() => sim.st.pts);

  // ---- Донер Бей -----------------------------------------------------------------------------
  const pts = sim.st.pts;
  // the sim always has pts[8]; the fallback only keeps a broken save from taking the decor down
  const dp: Pt = pts.find(p => p.key === 'doner') ?? pts[PT_DONER] ?? { key: 'doner', name: DONER.clean, x: 30, z: 12, r: 6, kind: 2, side: -1, owner: -1, prog: 0 };
  const db = donerBey();
  const dy = groundY(t, dp.x, dp.z, DONER_RY, 2.2, -1.25, 2.3);
  db.group.position.set(dp.x, dy, dp.z);
  db.group.rotation.y = DONER_RY;
  root.add(db.group);
  let spicy: boolean | null = null;

  // capture ring + flag; the pole stands at the back corner so it clears the pavilion
  const marker = new VillageMarker(t, dp);
  {
    const c = Math.cos(DONER_RY), s = Math.sin(DONER_RY);
    const lx = 2.05, lz = -1.15;
    const px = dp.x + lx * c + lz * s, pz = dp.z - lx * s + lz * c;
    const py = heightY(t, px, pz);
    marker.pole.position.set(px, py + 1.6, pz);
    marker.flag.position.set(px + 0.6, py + 2.75, pz);
    root.add(marker.group);
  }

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

  let time = 0;
  return {
    update(dt: number) {
      time += dt;
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
      db.setSign((on ? DONER.spicy : DONER.clean).toUpperCase());
    },
  };
}
