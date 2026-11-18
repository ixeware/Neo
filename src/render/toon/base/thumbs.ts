// Small pictures of the base models for the build palette: every key is rendered once per side (on the first
// call, with a renderer of its own that is thrown away at once) and kept as a PNG data URL. Both styles.
import * as THREE from 'three';
import { TOON, styleRenderer, styleLights } from '../../style';
import { inkSticker } from '../hull';
import { BASE_KEYS, baseModel } from './models';

const SIZE = 112;
const cache: (Record<string, string> | null)[] = [null, null];

function render(side: 0 | 1): Record<string, string> {
  const out: Record<string, string> = {};
  const canvas = document.createElement('canvas');
  let r: THREE.WebGLRenderer;
  try { r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch { return out; }
  r.setPixelRatio(1);
  r.setSize(SIZE, SIZE, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight('#fff6e6', '#6b6450', 1.6), sun = new THREE.DirectionalLight('#ffe7c4', 2.2);
  sun.position.set(-3, 5, 2.5);
  scene.add(hemi, sun);
  styleRenderer(r); styleLights(hemi, sun);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
  const box = new THREE.Box3(), c = new THREE.Vector3(), dir = new THREE.Vector3(0.62, 0.74, 1).normalize(), v = new THREE.Vector3();
  for (const key of BASE_KEYS) {
    const o = baseModel(key, 1, side);
    if (!o) continue;
    const head = o.getObjectByName('head');
    if (head) head.rotation.y = 0.5; // the weapon points at the viewer's right
    scene.add(o);
    o.updateMatrixWorld(true);
    box.setFromObject(o).getCenter(c);
    cam.position.copy(c).addScaledVector(dir, 20);
    cam.lookAt(c);
    cam.updateMatrixWorld(true);
    // fit: the box corners in camera space
    let rx = 0.01, ry = 0.01;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(cam.matrixWorldInverse);
      rx = Math.max(rx, Math.abs(v.x)); ry = Math.max(ry, Math.abs(v.y));
    }
    const half = Math.max(rx, ry) * 1.08;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.updateProjectionMatrix();
    r.render(scene, cam);
    out[key] = (TOON ? inkSticker(canvas, 2) : canvas).toDataURL('image/png');
    scene.remove(o);
  }
  r.dispose();
  r.forceContextLoss();
  return out;
}

/** A PNG data URL of building `key` (level 1) in the colours of `side`, or null when there is no model or no WebGL. */
export function baseThumb(key: string, side: 0 | 1): string | null {
  const m = cache[side] ?? (cache[side] = render(side));
  return m[key] ?? null;
}
/** The picture as an <img> that fills its box, or `fallback` (the family icon). */
export function baseThumbHtml(key: string, side: 0 | 1, fallback: string): string {
  const url = baseThumb(key, side);
  return url ? `<img src="${url}" alt="" draggable="false" style="width:124%;height:124%;max-width:none;object-fit:contain;pointer-events:none">` : fallback;
}
