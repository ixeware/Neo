// Renders the real unit models into small images for cards and the side picker.
import * as THREE from 'three';
import { unitGeometry, islamRig, zurabRig } from '../render/models';
import { heroGeometry } from '../render/heroes';
import { UNITS } from '../sim/defs';

/**
 * `units[side][type]`: a 172×144 PNG data URL for every unit type 0..15 (UNITS.length), drawn in
 * that side's colours. Index 5 (the boss) holds the same image as `bosses[side]`.
 * `bosses[side]`: a 256×336 PNG data URL of Ислам (0) / Зураб (1).
 */
export interface Portraits {
  units: string[][]; bosses: string[];
  /** v3: the admin head-and-shoulders (320×352 PNG data URL per side) for his cigarette pack («Курение убивает»). */
  admin?: string[];
}

export function makePortraits(): Portraits {
  const canvas = document.createElement('canvas');
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#fff6e6', '#6b6450', 1.6));
  const sun = new THREE.DirectionalLight('#ffe7c4', 2.2);
  sun.position.set(-2, 4, 3);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const box = new THREE.Box3(), c = new THREE.Vector3(), size = new THREE.Vector3();
  const shot = (obj: THREE.Object3D, w: number, h: number, height: number, yaw: number) => {
    r.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
    obj.rotation.y = yaw;
    scene.add(obj);
    box.setFromObject(obj);
    box.getCenter(c);
    box.getSize(size);
    const span = Math.max(size.y, size.x * h / w, size.z * 0.8) * 1.12;
    const d = span / 2 / Math.tan((cam.fov * Math.PI) / 360);
    cam.position.set(c.x + d * 0.35, c.y + span * 0.22, c.z + d);
    cam.lookAt(c.x, c.y - height * 0.02, c.z);
    r.setClearColor(0x000000, 0);
    r.render(scene, cam);
    const url = canvas.toDataURL('image/png');
    scene.remove(obj);
    return url;
  };
  const bosses = [islamRig(mat), zurabRig(mat)].map((rig, s) => {
    if (s === 1) { rig.armL.rotation.z = 1.5; rig.armR.rotation.z = -1.5; }
    else { rig.armR.rotation.set(-2.7, 0, -0.35); }
    return shot(rig.root, 256, 336, rig.height, 0.45);
  });
  const units: string[][] = [[], []];
  for (const side of [0, 1] as const) for (let t = 0; t < UNITS.length; t++) {
    if (t === 5) { units[side].push(bosses[side]); continue; }
    const m = new THREE.Mesh(t < 6 ? unitGeometry(t, side) : heroGeometry(t, side), mat);
    // cars are shown three-quarter so the whole body reads
    units[side].push(shot(m, 172, 144, 1, t === 3 || t === 14 ? 0.9 : 0.5));
    m.geometry.dispose();
  }
  // the admin's face for the pack: head and shoulders, a little from his left, like a passport photo
  const admin = ([0, 1] as const).map(side => {
    const g = heroGeometry(8, side);
    g.computeBoundingBox();
    const top = g.boundingBox!.max.y;
    const m = new THREE.Mesh(g, mat);
    r.setSize(320, 352, false);
    cam.aspect = 320 / 352; cam.updateProjectionMatrix();
    scene.add(m);
    cam.position.set(0.22, top - 0.24, 1.55); cam.lookAt(0, top - 0.3, 0);
    r.setClearColor(0x000000, 0);
    r.render(scene, cam);
    const url = canvas.toDataURL('image/png');
    scene.remove(m); g.dispose();
    return url;
  });
  r.dispose();
  r.forceContextLoss();
  return { units, bosses, admin };
}
