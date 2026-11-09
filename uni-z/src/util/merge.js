import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Merge static single-material meshes under `container` into one mesh per material (fewer draw calls).
// keep(o) → true for nodes that animate or toggle; their whole subtree is left untouched.
export function mergeStatic(container, keep = () => false) {
  container.updateMatrixWorld(true);
  const inv = container.matrixWorld.clone().invert();
  const buckets = new Map();
  const victims = [];
  const visit = (o) => {
    if (o !== container && keep(o)) return;
    if (o.isMesh && !o.isInstancedMesh && !Array.isArray(o.material) && o.visible && !o.isSkinnedMesh) {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.clearGroups();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      const key = o.material.uuid + (o.castShadow ? 's' : '') + (o.receiveShadow ? 'r' : '');
      if (!buckets.has(key)) buckets.set(key, { material: o.material, castShadow: o.castShadow, receiveShadow: o.receiveShadow, geos: [], count: 0 });
      const b = buckets.get(key);
      b.geos.push(g); b.count++;
      victims.push(o);
    }
    for (const c of [...o.children]) visit(c);
  };
  visit(container);
  let merged = 0;
  for (const b of buckets.values()) {
    if (b.count < 2) { b.skip = true; continue; }
    const geo = mergeGeometries(b.geos, false);
    if (!geo) { b.skip = true; continue; }
    const m = new THREE.Mesh(geo, b.material);
    m.name = `Merged_${b.material.name || 'mat'}`;
    m.castShadow = b.castShadow; m.receiveShadow = b.receiveShadow;
    container.add(m);
    merged += b.count;
  }
  const skipMats = new Set([...buckets.values()].filter((b) => b.skip).map((b) => b.material.uuid));
  for (const o of victims) {
    if (skipMats.has(o.material.uuid)) continue;
    o.parent?.remove(o);
    o.geometry.dispose();
  }
  return merged;
}
