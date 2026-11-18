// The ground and nature of the toon style, in one place. Everything here runs only in toon.
//
// How it is hooked in without touching files of other tracks (docs/v5/notes/ART-GROUND.md):
//   terrainMesh.ts  terrainMesh()  → groundLand(): the land material with the ground paint; the land mesh's
//                                    onBeforeRender is the per-frame tick (groundTick)
//   roads.ts        buildRoads()   → groundRoads(): remembers the world group everything is added to
//   trees.ts        treeSpots()    → groundBuild(): called by world.ts buildTrees after the villages exist;
//                                    paints the ground, plants and furnishes the map; the old trees get no spots
import * as THREE from 'three';
import type { Terrain } from '../../../world/terrain';
import type { Tin } from '../../lowpoly';
import { GroundMask } from './mask';
import { toonLandMaterial } from './landMat';
import { paintGround, shoreEdges, hqSpots, HQ_ROT, type HouseSpot } from './paint';
import { HQ } from '../../../sim/defs';
import { BASE } from '../../../sim/bdefs';
import { buildScatter, updateScatterLod } from './scatter';

interface Ground {
  t: Terrain; tin: Tin; mask: GroundMask; low: boolean;
  parent: THREE.Object3D | null;
  built: boolean;
}
let G: Ground | null = null;

/** The land material (terrainMesh.ts). Creates the empty ground paint; groundBuild() fills it. */
export function groundLand(t: Terrain, tin: Tin, low: boolean): THREE.Material {
  const mask = new GroundMask(t.W, t.z0, t.H, low ? 1024 : 2048);
  G = { t, tin, mask, low, parent: null, built: false };
  const hq = [new THREE.Vector4(), new THREE.Vector4()];
  for (const h of hqSpots(t)) hq[h.side].set(h.x, h.z, HQ.radius[h.side] + BASE.keep + 0.7, HQ_ROT[h.side]);
  return toonLandMaterial(mask, hq);
}

/** The group the world is built into (roads.ts buildRoads gets it first). */
export function groundRoads(parent: THREE.Object3D) { if (G) G.parent = parent; }

/** The village houses as world.ts drew them: read back from its instanced meshes (named 'houses'). */
function readHouses(parent: THREE.Object3D): HouseSpot[] {
  const out: HouseSpot[] = [], seen = new Set<number>();
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
  parent.traverse(o => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh || im.name !== 'houses') return;
    for (let i = 0; i < im.instanceMatrix.count; i++) {
      im.getMatrixAt(i, m);
      m.decompose(p, q, s);
      const key = Math.round(p.x * 50) * 100003 + Math.round(p.z * 50);
      if (seen.has(key)) continue;
      seen.add(key);
      e.setFromQuaternion(q, 'YXZ');
      out.push({ x: p.x, z: p.z, ry: e.y, w: Math.abs(s.x), d: Math.abs(s.z) });
    }
  });
  return out;
}

/**
 * Paint, plant and furnish (trees.ts treeSpots calls it once the villages stand). `skip` is world.ts's
 * keep-clear test for trees: bridges, landmarks, the decor, roads, city blocks.
 */
export function groundBuild(skip: (x: number, z: number) => boolean) {
  if (!G || G.built) return;
  G.built = true;
  const t0 = performance.now();
  const { t, tin, mask } = G;
  const houses = G.parent ? readHouses(G.parent) : [];
  const shore = shoreEdges(tin);
  const plazas = paintGround(mask, t, tin, houses, shore);
  mask.flush();
  if (G.parent) buildScatter(G.parent, { t, tin, low: G.low, houses, plazas, shore, skip });
  console.info(`ground: ${houses.length} yards, ${plazas.length} plazas, ${shore.length} shore edges, ${(performance.now() - t0).toFixed(0)} ms`);
}

/** Once a frame, from the land mesh (the main camera only: portraits and tools do not draw the land). */
export function groundTick(camera: THREE.Camera) {
  if (!G || !G.built) return;
  updateScatterLod(camera.position, G.low);
}
