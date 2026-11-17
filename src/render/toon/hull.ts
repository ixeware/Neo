// Outlines for the places the game's depth pass (post.ts) does not reach.
//
// inkSticker(): the outline for a finished 2D render with a transparent background (portraits,
// thumbnails) — the picture's own silhouette in ink behind it. Use this one.
//
// Inverted hull: a copy of the mesh pushed out along smoothed normals by a fixed number of pixels and
// drawn back-face-only in ink. It doubles the triangles and the draw calls of what it wraps, inks only
// silhouettes, and only reads well on closed, roughly convex meshes (open kits such as the house walls
// and roofs get a partial line). hullOutline() is there for one closed hero object; `?ol=hull` hulls the
// whole scene instead of running the depth pass — the comparison mode behind the numbers in
// docs/v5/ART.md §10, not a shipping mode.
import * as THREE from 'three';
import { TOON_HEX } from './palette';

/**
 * Ink outline around a 2D render with a transparent background: returns a new canvas of the same size
 * with the picture's silhouette drawn in ink `px` pixels around it. Keep a `px` margin free in the source.
 */
export function inkSticker(src: HTMLCanvasElement, px = 2): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const sil = document.createElement('canvas');
  sil.width = w; sil.height = h;
  const sg = sil.getContext('2d')!;
  sg.drawImage(src, 0, 0);
  sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = TOON_HEX.ink;
  sg.fillRect(0, 0, w, h);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const g = out.getContext('2d')!;
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; g.drawImage(sil, Math.cos(a) * px, Math.sin(a) * px); }
  g.drawImage(src, 0, 0);
  return out;
}

const cache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
const mats = new Map<number, THREE.Material>();
const vp = new THREE.Vector4();

/**
 * Geometry with the same vertices as `src` and normals averaged over every vertex at the same position
 * (flat-shaded models have split normals: extruding along those would tear the hull at every edge).
 */
function smoothed(src: THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(src);
  if (g) return g;
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count, acc = new Map<string, [number, number, number]>(), keys: string[] = new Array(n);
  const tri = new THREE.Triangle(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3();
  const key = (v: THREE.Vector3) => `${Math.round(v.x * 2000)}|${Math.round(v.y * 2000)}|${Math.round(v.z * 2000)}`;
  const idx = src.index;
  const count = idx ? idx.count : n;
  for (let i = 0; i + 2 < count; i += 3) {
    const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
    tri.set(a, b, c).getNormal(fn);
    const corners: [number, THREE.Vector3][] = [[ia, a], [ib, b], [ic, c]];
    for (const [iv, v] of corners) {
      const k = (keys[iv] = key(v));
      const s = acc.get(k);
      if (s) { s[0] += fn.x; s[1] += fn.y; s[2] += fn.z; } else acc.set(k, [fn.x, fn.y, fn.z]);
    }
  }
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = keys[i] ? acc.get(keys[i]) : undefined;
    if (!s) continue;
    const l = Math.hypot(s[0], s[1], s[2]) || 1;
    nor[i * 3] = s[0] / l; nor[i * 3 + 1] = s[1] / l; nor[i * 3 + 2] = s[2] / l;
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', pos);
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (idx) g.setIndex(idx);
  g.boundingSphere = src.boundingSphere; g.boundingBox = src.boundingBox;
  cache.set(src, g);
  return g;
}

/** Ink material that widens the mesh by `px` pixels on screen (works for instanced meshes too). */
function hullMaterial(px: number): THREE.Material {
  const k = Math.round(px * 100);
  let m = mats.get(k);
  if (!m) {
    const mm = new THREE.MeshBasicMaterial({ color: TOON_HEX.ink, side: THREE.BackSide });
    const u = { value: new THREE.Vector2(0.002, 0.002) };
    mm.onBeforeCompile = sh => {
      sh.uniforms.uHull = u;
      sh.vertexShader = 'uniform vec2 uHull;\n' + sh.vertexShader.replace('#include <project_vertex>', /* glsl */`#include <project_vertex>
	{
		vec4 hq = vec4( transformed + normal * 0.02, 1.0 );
		#ifdef USE_INSTANCING
		hq = instanceMatrix * hq;
		#endif
		vec4 hc = projectionMatrix * modelViewMatrix * hq;
		vec2 hd = hc.xy / hc.w - gl_Position.xy / gl_Position.w;
		gl_Position.xy += hd / max( length( hd ), 1e-6 ) * uHull * gl_Position.w;
	}`);
    };
    mm.customProgramCacheKey = () => 'toon-hull';
    mm.onBeforeRender = r => { r.getCurrentViewport(vp); u.value.set((2 * px) / Math.max(1, vp.z), (2 * px) / Math.max(1, vp.w)); };
    mats.set(k, (m = mm));
  }
  return m;
}

/**
 * Add an ink hull to every plain mesh under `root` (as a child of each mesh, so it follows animation).
 * `px` is the line width in pixels. Returns the hull meshes: remove and dispose them to take it off.
 */
export function hullOutline(root: THREE.Object3D, px = 1.5): THREE.Mesh[] {
  const made: THREE.Mesh[] = [];
  const list: THREE.Mesh[] = [];
  root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.hull && !(m as unknown as THREE.InstancedMesh).isInstancedMesh && m.geometry?.getAttribute('position')) list.push(m); });
  for (const m of list) {
    const h = new THREE.Mesh(smoothed(m.geometry), hullMaterial(px));
    h.userData.hull = true;
    h.castShadow = false; h.receiveShadow = false;
    m.add(h);
    made.push(h);
  }
  return made;
}

/**
 * Comparison mode (`?ol=hull`): hull every opaque lit mesh under `root` that is not marked ground(),
 * instanced ones included (the hull shares the instance matrices). Call again now and then to catch
 * meshes made later. Returns how many hulls were added.
 */
export function hullScene(root: THREE.Object3D, px = 1.3): number {
  const list: THREE.Mesh[] = [];
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.hull || m.userData.hulled || !m.geometry?.getAttribute('position')) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material & { isMeshLambertMaterial?: boolean; isMeshPhongMaterial?: boolean };
    if (!mat || mat.transparent || !(mat.isMeshLambertMaterial || mat.isMeshPhongMaterial) || (mat.defines && 'STYLE_GROUND' in mat.defines)) return;
    list.push(m);
  });
  for (const m of list) {
    m.userData.hulled = true;
    const g = smoothed(m.geometry), im = m as unknown as THREE.InstancedMesh;
    let h: THREE.Mesh;
    if (im.isInstancedMesh) {
      const hi = new THREE.InstancedMesh(g, hullMaterial(px), im.instanceMatrix.count);
      hi.instanceMatrix = im.instanceMatrix;
      hi.count = im.count;
      hi.boundingSphere = im.boundingSphere;
      hi.frustumCulled = im.frustumCulled;
      hi.onBeforeRender = () => { hi.count = im.count; };
      h = hi;
    } else h = new THREE.Mesh(g, hullMaterial(px));
    h.userData.hull = true;
    h.castShadow = false; h.receiveShadow = false;
    m.add(h);
  }
  return list.length;
}
