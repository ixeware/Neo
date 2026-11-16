// Renders the real unit models into small images for cards and the side picker.
import * as THREE from 'three';
import { unitGeometry, islamRig, zurabRig } from '../render/models';

export interface Portraits { units: string[][]; bosses: string[] }

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
  const shot = (obj: THREE.Object3D, w: number, h: number, height: number, yaw: number) => {
    r.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
    obj.rotation.y = yaw;
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
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
  const units: string[][] = [[], []];
  for (const side of [0, 1] as const) for (let t = 0; t < 5; t++) {
    const m = new THREE.Mesh(unitGeometry(t, side), mat);
    units[side].push(shot(m, 172, 144, 1, t === 3 ? 0.9 : 0.5));
    m.geometry.dispose();
  }
  const bosses = [islamRig(mat), zurabRig(mat)].map((rig, s) => {
    if (s === 1) { rig.armL.rotation.z = 1.5; rig.armR.rotation.z = -1.5; }
    else { rig.armR.rotation.set(-2.7, 0, -0.35); }
    return shot(rig.root, 256, 336, rig.height, 0.45);
  });
  r.dispose();
  r.forceContextLoss();
  return { units, bosses };
}
