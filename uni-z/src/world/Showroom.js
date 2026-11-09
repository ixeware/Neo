import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

// Dark studio with strip softboxes: the strips draw long highlights along the body sides.
export class Showroom {
  constructor(renderer, quality) {
    this.group = new THREE.Group();
    this.group.name = 'Showroom';
    this.renderer = renderer;
    this.buildEnvironment();
    this.buildStage(quality);
  }

  buildEnvironment() {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x07080a);
    const box = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 30), new THREE.MeshBasicMaterial({ color: 0x0b0d10, side: THREE.BackSide }));
    box.position.y = 6;
    env.add(box);
    const strip = (w, h, intensity, pos, rot) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity * 1.02), side: THREE.DoubleSide }));
      m.position.set(...pos); m.rotation.set(...rot); env.add(m);
    };
    strip(10, 5, 3.2, [0, 12.5, 0], [Math.PI / 2, 0, 0]);          // overhead softbox
    strip(14, 0.9, 9.0, [0, 5.0, 9], [0, Math.PI, 0]);            // front strip
    strip(14, 0.9, 9.0, [0, 5.0, -9], [0, 0, 0]);                 // rear strip
    strip(0.9, 14, 5.0, [-10, 4.5, 0], [Math.PI / 2, Math.PI / 2, 0]);
    strip(0.9, 14, 5.0, [10, 4.5, 0], [Math.PI / 2, -Math.PI / 2, 0]);
    strip(16, 1.4, 4.5, [-11, 2.4, 0], [0, Math.PI / 2, 0]);     // low side strips → beltline highlight
    strip(16, 1.4, 4.5, [11, 2.4, 0], [0, -Math.PI / 2, 0]);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(env, 0.035).texture;
    pmrem.dispose();
  }

  buildStage(quality) {
    const g = this.group;
    // floor: radial vignette texture
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(256, 256, 20, 256, 256, 256);
    grd.addColorStop(0, '#3a3e45'); grd.addColorStop(0.45, '#23262b'); grd.addColorStop(1, '#0d0f12');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(160,170,185,0.10)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(256, 256, 150, 0, Math.PI * 2); ctx.stroke();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.floorMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.0, transparent: !!quality.reflector, opacity: quality.reflector ? 0.86 : 1 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 96), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = 'StudioFloor';
    g.add(floor);
    this.floor = floor;
    if (quality.reflector) {
      const refl = new Reflector(new THREE.CircleGeometry(16, 96), { textureWidth: 1024, textureHeight: 1024, color: 0x6a6f78, clipBias: 0.003 });
      refl.rotation.x = -Math.PI / 2; refl.position.y = -0.002;
      g.add(refl);
      this.reflector = refl;
    }
    // turntable ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.45, 3.52, 128), new THREE.MeshStandardMaterial({ color: 0x4fb6ff, emissive: 0x4fb6ff, emissiveIntensity: 0.35, roughness: 0.4 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002;
    g.add(ring);
    // key light with soft shadow + rims
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 9, 5);
    key.castShadow = quality.shadows > 0;
    key.shadow.mapSize.set(quality.shadows || 1024, quality.shadows || 1024);
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 25 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
    g.add(key, key.target);
    const rim1 = new THREE.DirectionalLight(0xbfd8ff, 0.9); rim1.position.set(-6, 4, -6); g.add(rim1);
    const fill = new THREE.HemisphereLight(0xdfe8ff, 0x101216, 0.35); g.add(fill);
    this.lightsList = [key, rim1, fill];
    // backdrop cyclorama
    const cyc = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0c0e11, side: THREE.BackSide }));
    g.add(cyc);
  }

  setNight(on) {
    for (const l of this.lightsList) {
      if (l.userData.base === undefined) l.userData.base = l.intensity;
      l.intensity = l.userData.base * (on ? 0.12 : 1);
    }
  }
}
