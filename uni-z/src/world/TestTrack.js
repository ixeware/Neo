import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { asphaltTextures, groundTexture, labelTexture, makeCanvas } from '../util/textures.js';
import { makeNoise2D, mulberry32, clamp, smoothstep, lerp } from '../util/math.js';
import { TIRE_MODEL } from '../config/vehicle.js';

// Test ground: closed circuit + skidpad, slalom, speed bumps, 15 % hill, gravel, wet, snow and ice zones.
const SURF = ['grass', 'asphalt', 'wet', 'gravel', 'snow', 'ice'];
const GRID = { x0: -420, z0: -470, w: 860, h: 1100, cell: 1 };

export const ZONES = {
  skidpad: { cx: -140, cz: 260, r: 40, pad: 50 },
  slalom: { x0: -82, x1: -48, z0: -210, z1: 110, coneX: -65, coneStep: 20 },
  bumps: { x0: -132, x1: -108, z0: -210, z1: 110, at: [-150, -95, -40, 15, 70], height: 0.075, length: 3.7 },
  hill: { x0: -172, x1: -148, zUp0: -190, zUp1: -170, zDn0: -110, zDn1: -90, height: 3.0 },
  gravel: { x0: 40, x1: 170, z0: -220, z1: 0 },
  snow: { x0: 40, x1: 170, z0: 60, z1: 220 },
  ice: { x0: 80, x1: 130, z0: 100, z1: 180 },
  wet: { x0: -6.5, x1: 6.5, z0: 120, z1: 185 },
  parking: { x0: 14, x1: 36, z0: -90, z1: -20 },
};

const CIRCUIT = [[0, -250], [0, 0], [0, 350], [-30, 450], [-110, 500], [-200, 470], [-250, 400], [-262, 300], [-232, 222], [-282, 150], [-252, 80], [-262, -50], [-300, -150], [-282, -262], [-200, -332], [-100, -342], [-28, -312]];

export class TestTrack {
  constructor(quality) {
    this.group = new THREE.Group();
    this.group.name = 'TestTrack';
    this.noise = makeNoise2D(42);
    this.buildCircuit();
    this.buildSurfaceGrid();
    this.buildGround();
    this.buildPads();
    this.buildProps();
    this.buildCones();
    this.buildSky(quality);
    this.start = { position: new THREE.Vector3(0, 0, -20), heading: 0 };
  }

  // ---------------------------------------------------------------- geometry of the circuit
  buildCircuit() {
    const curve = new THREE.CatmullRomCurve3(CIRCUIT.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    this.curve = curve;
    this.length = curve.getLength();
    const n = Math.ceil(this.length / 2);
    this.centre = curve.getSpacedPoints(n);
    this.track2D = this.centre.filter((_, i) => i % 6 === 0).map((p) => [p.x, p.z]);
  }

  buildSurfaceGrid() {
    const g = GRID, data = new Uint8Array(g.w * g.h); // 0 = grass
    const set = (x, z, v) => { const i = Math.floor(x - g.x0), j = Math.floor(z - g.z0); if (i >= 0 && j >= 0 && i < g.w && j < g.h) data[j * g.w + i] = v; };
    const rect = (r, v) => { for (let z = r.z0; z < r.z1; z++) for (let x = r.x0; x < r.x1; x++) set(x + 0.5, z + 0.5, v); };
    for (let k = 0; k < this.length; k += 1) {
      const p = this.curve.getPointAt(k / this.length);
      for (let dz = -7; dz <= 7; dz++) for (let dx = -7; dx <= 7; dx++) if (dx * dx + dz * dz <= 6.6 * 6.6) set(p.x + dx, p.z + dz, 1);
    }
    const S = ZONES.skidpad;
    for (let z = -S.pad; z <= S.pad; z++) for (let x = -S.pad; x <= S.pad; x++) if (x * x + z * z <= S.pad * S.pad) set(S.cx + x, S.cz + z, 1);
    rect(ZONES.slalom, 1); rect(ZONES.bumps, 1); rect(ZONES.hill, 1); rect(ZONES.parking, 1);
    rect(ZONES.gravel, 3); rect(ZONES.snow, 4); rect(ZONES.ice, 5); rect(ZONES.wet, 2);
    rect({ x0: -6, x1: 14, z0: -70, z1: -40 }, 1); // pit link to the parking lot
    this.grid = data;
  }

  surfaceAt(x, z) {
    const g = GRID, i = Math.floor(x - g.x0), j = Math.floor(z - g.z0);
    if (i < 0 || j < 0 || i >= g.w || j >= g.h) return TIRE_MODEL.surfaces.grass;
    return TIRE_MODEL.surfaces[SURF[this.grid[j * g.w + i]]];
  }
  surfaceKey(x, z) {
    const g = GRID, i = Math.floor(x - g.x0), j = Math.floor(z - g.z0);
    if (i < 0 || j < 0 || i >= g.w || j >= g.h) return 'grass';
    return SURF[this.grid[j * g.w + i]];
  }

  heightAt(x, z) {
    let h = 0;
    const B = ZONES.bumps;
    if (x > B.x0 && x < B.x1 && z > B.z0 && z < B.z1) {
      for (const z0 of B.at) { const d = Math.abs(z - z0); if (d < B.length / 2) h += B.height * Math.cos((d / B.length) * Math.PI) ** 2; }
    }
    const Hl = ZONES.hill;
    if (x > Hl.x0 - 2 && x < Hl.x1 + 2) {
      const edge = smoothstep(Hl.x0 - 2, Hl.x0 + 1, x) * (1 - smoothstep(Hl.x1 - 1, Hl.x1 + 2, x));
      let p = 0;
      if (z >= Hl.zUp0 && z < Hl.zUp1) p = smoothstep(Hl.zUp0, Hl.zUp1, z);
      else if (z >= Hl.zUp1 && z < Hl.zDn0) p = 1;
      else if (z >= Hl.zDn0 && z < Hl.zDn1) p = 1 - smoothstep(Hl.zDn0, Hl.zDn1, z);
      h += Hl.height * p * edge;
    }
    const G = ZONES.gravel;
    if (x > G.x0 && x < G.x1 && z > G.z0 && z < G.z1) {
      const e = smoothstep(G.x0, G.x0 + 6, x) * smoothstep(G.z0, G.z0 + 6, z) * (1 - smoothstep(G.x1 - 6, G.x1, x)) * (1 - smoothstep(G.z1 - 6, G.z1, z));
      h += e * (0.35 * this.noise(x / 22, z / 22) + 0.05 * this.noise(x / 2.5, z / 2.5) + 0.015 * this.noise(x * 1.7, z * 1.7));
    }
    return h;
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.15;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z), hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  }

  // ---------------------------------------------------------------- meshes
  buildGround() {
    const grassTex = groundTexture('grass'); grassTex.repeat.set(500, 500);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true; ground.name = 'Grass';
    this.group.add(ground);
    // road ribbon with markings
    const c = makeCanvas(256, 1024), ctx = c.getContext('2d');
    const asphalt = asphaltTextures(7);
    ctx.drawImage(asphalt.map.image, 0, 0, 256, 1024);
    ctx.fillStyle = 'rgba(235,235,230,0.92)';
    ctx.fillRect(10, 0, 7, 1024); ctx.fillRect(239, 0, 7, 1024);
    for (let y = 0; y < 1024; y += 256) ctx.fillRect(125, y, 6, 110);
    const roadTex = new THREE.CanvasTexture(c); roadTex.colorSpace = THREE.SRGBColorSpace; roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping; roadTex.anisotropy = 8;
    asphalt.normalMap.repeat.set(1, 1);
    this.roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.86, normalMap: asphalt.normalMap, normalScale: new THREE.Vector2(0.4, 0.4) });
    const pos = [], uv = [], idx = [];
    const n = this.centre.length;
    let dist = 0;
    for (let i = 0; i <= n; i++) {
      const p = this.centre[i % n], q = this.centre[(i + 1) % n];
      const t = new THREE.Vector3().subVectors(q, p).normalize();
      const side = new THREE.Vector3(-t.z, 0, t.x);
      for (const s of [-6, 6]) { const v = p.clone().addScaledVector(side, s); pos.push(v.x, 0.012, v.z); uv.push(s < 0 ? 0 : 1, dist / 24); }
      if (i > 0) dist += this.centre[i % n].distanceTo(this.centre[(i - 1) % n]);
      if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const road = new THREE.Mesh(g, this.roadMat);
    if (road.geometry.attributes.normal.array[1] < 0) { road.material.side = THREE.DoubleSide; }
    road.receiveShadow = true; road.name = 'Circuit';
    this.group.add(road);
    // start / finish line
    const chk = makeCanvas(256, 32), cx = chk.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { cx.fillStyle = (i + j) % 2 ? '#111' : '#eee'; cx.fillRect(i * 16, j * 16, 16, 16); }
    const chkTex = new THREE.CanvasTexture(chk); chkTex.colorSpace = THREE.SRGBColorSpace;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.5), new THREE.MeshStandardMaterial({ map: chkTex, roughness: 0.8 }));
    line.rotation.x = -Math.PI / 2; line.position.set(0, 0.016, 0);
    this.group.add(line);
  }

  heightMesh(x0, x1, z0, z1, step, material, lift = 0.012) {
    const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, this.heightAt(p.getX(i), p.getZ(i)) + lift);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    return m;
  }

  buildPads() {
    const asphalt = asphaltTextures(3);
    asphalt.map.repeat.set(12, 12); asphalt.normalMap.repeat.set(12, 12);
    const padMat = new THREE.MeshStandardMaterial({ map: asphalt.map, normalMap: asphalt.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.88 });
    const S = ZONES.skidpad;
    const skid = new THREE.Mesh(new THREE.CircleGeometry(S.pad, 96), padMat); skid.rotation.x = -Math.PI / 2; skid.position.set(S.cx, 0.011, S.cz); skid.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.RingGeometry(S.r - 0.15, S.r + 0.15, 160), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7 }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(S.cx, 0.014, S.cz);
    this.group.add(skid, ring);
    const rectMesh = (r, mat, y = 0.011) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0), mat); m.rotation.x = -Math.PI / 2; m.position.set((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2); m.receiveShadow = true; return m; };
    this.group.add(rectMesh(ZONES.slalom, padMat), rectMesh(ZONES.parking, padMat), rectMesh({ x0: -6, x1: 14, z0: -70, z1: -40 }, padMat));
    this.group.add(this.heightMesh(ZONES.bumps.x0, ZONES.bumps.x1, ZONES.bumps.z0, ZONES.bumps.z1, 0.5, padMat));
    this.group.add(this.heightMesh(ZONES.hill.x0 - 2, ZONES.hill.x1 + 2, ZONES.hill.zUp0 - 5, ZONES.hill.zDn1 + 5, 1, padMat));
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe8c22a, roughness: 0.6 });
    for (const z0 of ZONES.bumps.at) { const stripe = new THREE.Mesh(new THREE.BoxGeometry(ZONES.bumps.x1 - ZONES.bumps.x0, 0.01, 0.4), yellow); stripe.position.set((ZONES.bumps.x0 + ZONES.bumps.x1) / 2, this.heightAt(-120, z0) + 0.014, z0); this.group.add(stripe); }
    const gravelTex = groundTexture('gravel'); gravelTex.repeat.set(60, 100);
    this.group.add(this.heightMesh(ZONES.gravel.x0, ZONES.gravel.x1, ZONES.gravel.z0, ZONES.gravel.z1, 1.25, new THREE.MeshStandardMaterial({ map: gravelTex, roughness: 0.97 }), 0.0));
    const snowTex = groundTexture('snow'); snowTex.repeat.set(30, 40);
    this.group.add(rectMesh(ZONES.snow, new THREE.MeshStandardMaterial({ map: snowTex, roughness: 0.75 }), 0.009));
    const iceTex = groundTexture('ice'); iceTex.repeat.set(10, 16);
    this.group.add(rectMesh(ZONES.ice, new THREE.MeshPhysicalMaterial({ map: iceTex, roughness: 0.08, clearcoat: 1, metalness: 0 }), 0.011));
    const wetMat = new THREE.MeshPhysicalMaterial({ color: 0x1b1d20, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.7 });
    this.group.add(rectMesh(ZONES.wet, wetMat, 0.014));
    // parking bays
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.7 });
    for (let z = -88; z <= -22; z += 2.6) { const l = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.12), lineMat); l.rotation.x = -Math.PI / 2; l.position.set(30.5, 0.015, z); this.group.add(l); }
  }

  buildProps() {
    const rnd = mulberry32(9);
    // lamp posts along the main straight
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 9, 8); poleGeo.translate(0, 4.5, 0);
    const headGeo = new THREE.BoxGeometry(1.4, 0.18, 0.4); headGeo.translate(-0.6, 9, 0);
    const poles = [], heads = [];
    for (let z = -240; z <= 340; z += 40) for (const side of [-1, 1]) { poles.push([side * 10, z, side]); }
    const poleMesh = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.7, roughness: 0.4 }), poles.length);
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff1d6, emissiveIntensity: 0 });
    const headMesh = new THREE.InstancedMesh(headGeo, this.lampMat, poles.length);
    const o = new THREE.Object3D();
    poles.forEach(([x, z, side], i) => { o.position.set(x, 0, z); o.rotation.set(0, side > 0 ? 0 : Math.PI, 0); o.updateMatrix(); poleMesh.setMatrixAt(i, o.matrix); headMesh.setMatrixAt(i, o.matrix); });
    poleMesh.castShadow = true;
    this.group.add(poleMesh, headMesh);
    this.lampPositions = poles.map(([x, z, side]) => new THREE.Vector3(x - side * 0.6, 8.9, z));
    // trees outside the asphalt
    const trunk = new THREE.CylinderGeometry(0.15, 0.22, 2.4, 6); trunk.translate(0, 1.2, 0);
    const crown = new THREE.ConeGeometry(1.6, 4.5, 7); crown.translate(0, 4.4, 0);
    const N = 700, trunks = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 }), N);
    const crowns = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: 0x2f5a2c, roughness: 0.85 }), N);
    let k = 0;
    while (k < N) {
      const x = -420 + rnd() * 840, z = -470 + rnd() * 1100;
      let clear = true;
      for (let dz = -6; dz <= 6 && clear; dz += 3) for (let dx = -6; dx <= 6 && clear; dx += 3) if (this.surfaceKey(x + dx, z + dz) !== 'grass') clear = false;
      if (!clear || (Math.abs(x) < 25 && z > -260 && z < 360)) continue;
      const s = 0.7 + rnd() * 0.8;
      o.position.set(x, 0, z); o.rotation.set(0, rnd() * 6, 0); o.scale.set(s, s, s); o.updateMatrix();
      trunks.setMatrixAt(k, o.matrix); crowns.setMatrixAt(k, o.matrix); k++;
    }
    crowns.castShadow = true;
    this.group.add(trunks, crowns);
    // pit building and braking boards
    const pit = new THREE.Mesh(new THREE.BoxGeometry(18, 7, 60), new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.8 }));
    pit.position.set(52, 3.5, 0); pit.castShadow = true; pit.receiveShadow = true;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 56), new THREE.MeshStandardMaterial({ color: 0x1d2a38, metalness: 0.6, roughness: 0.15, emissive: 0x334455, emissiveIntensity: 0.2 }));
    glass.position.set(42.9, 4.6, 0);
    this.group.add(pit, glass);
    for (const [z, label] of [[250, '100'], [300, '50'], [325, '25']]) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0), new THREE.MeshStandardMaterial({ map: labelTexture(label, { w: 256, h: 180, font: 'bold 120px Arial, sans-serif', fg: '#111', bg: '#f4f4f0' }) }));
      board.position.set(8.5, 1.2, z); board.rotation.y = -Math.PI / 2 + 0.4;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), new THREE.MeshStandardMaterial({ color: 0x777777 })); post.position.set(8.5, 0.4, z);
      this.group.add(board, post);
    }
    const sign = (text, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.9), new THREE.MeshStandardMaterial({ map: labelTexture(text, { w: 1024, h: 230, font: 'bold 120px Arial, sans-serif', fg: '#f4f4f0', bg: '#1f3e66' }) })); m.position.set(x, 1.6, z); m.rotation.y = ry; this.group.add(m); };
    sign('СКИДПАД', -140, 205, 0); sign('СЛАЛОМ', -65, -215, 0); sign('ЛЕЖАЧИЕ', -120, -215, 0); sign('ГОРКА 15%', -160, -205, 0);
    sign('ГРАВИЙ', 105, -225, 0); sign('СНЕГ / ЛЁД', 105, 55, 0);
  }

  buildCones() {
    const geo = new THREE.ConeGeometry(0.16, 0.7, 14); geo.translate(0, 0.35, 0);
    const band = new THREE.CylinderGeometry(0.105, 0.125, 0.12, 14, 1, true); band.translate(0, 0.38, 0);
    this.cones = [];
    const S = ZONES.slalom;
    for (let z = S.z0 + 20; z < S.z1 - 10; z += S.coneStep) this.cones.push({ home: new THREE.Vector3(S.coneX, 0, z) });
    for (let a = 0; a < 24; a++) { const ang = (a / 24) * Math.PI * 2; this.cones.push({ home: new THREE.Vector3(ZONES.skidpad.cx + Math.cos(ang) * 43.5, 0, ZONES.skidpad.cz + Math.sin(ang) * 43.5) }); }
    for (const c of this.cones) { c.pos = c.home.clone(); c.vel = new THREE.Vector3(); c.tilt = 0; c.tiltAxis = new THREE.Vector3(1, 0, 0); c.spin = 0; }
    this.coneMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xff5a14, roughness: 0.6 }), this.cones.length);
    this.coneBand = new THREE.InstancedMesh(band, new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5, emissive: 0x666666, emissiveIntensity: 0.2 }), this.cones.length);
    this.coneMesh.castShadow = true;
    this.group.add(this.coneMesh, this.coneBand);
    this.updateConeMatrices();
  }

  resetCones() { for (const c of this.cones) { c.pos.copy(c.home); c.vel.set(0, 0, 0); c.tilt = 0; c.spin = 0; } this.updateConeMatrices(); }

  updateConeMatrices() {
    const o = new THREE.Object3D();
    this.cones.forEach((c, i) => {
      o.position.copy(c.pos);
      o.quaternion.setFromAxisAngle(c.tiltAxis, c.tilt);
      o.updateMatrix();
      this.coneMesh.setMatrixAt(i, o.matrix); this.coneBand.setMatrixAt(i, o.matrix);
    });
    this.coneMesh.instanceMatrix.needsUpdate = true; this.coneBand.instanceMatrix.needsUpdate = true;
  }

  // Light cones (3.5 kg) knocked by the car's footprint (oriented box)
  updateCones(dt, carPos, carQuat, carVel) {
    let hits = 0;
    const inv = carQuat.clone().invert(), local = new THREE.Vector3();
    for (const c of this.cones) {
      local.copy(c.pos).sub(carPos).applyQuaternion(inv);
      if (Math.abs(local.x) < 1.05 && Math.abs(local.z - 0.05) < 2.45 && local.y > -1 && local.y < 1.2) {
        const push = carVel.clone(); push.y = 0;
        if (push.length() > 0.3) { c.vel.copy(push).multiplyScalar(1.15).add(new THREE.Vector3(0, push.length() * 0.18, 0)); c.tiltAxis.set(push.z, 0, -push.x).normalize(); hits++; }
        else { const away = new THREE.Vector3(local.x, 0, 0).applyQuaternion(carQuat).normalize(); c.pos.addScaledVector(away, 0.05); }
      }
      if (c.vel.lengthSq() > 1e-4 || c.pos.y > 0.001) {
        c.vel.y -= 9.81 * dt;
        c.pos.addScaledVector(c.vel, dt);
        const floor = this.heightAt(c.pos.x, c.pos.z);
        if (c.pos.y < floor) { c.pos.y = floor; c.vel.y = Math.abs(c.vel.y) * 0.25; c.vel.x *= 0.82; c.vel.z *= 0.82; }
        c.tilt = Math.min(Math.PI / 2, c.tilt + dt * 6 * Math.min(1, c.vel.length()));
        if (c.vel.length() < 0.05 && c.pos.y - floor < 0.01) c.vel.set(0, 0, 0);
      }
    }
    this.updateConeMatrices();
    return hits;
  }

  // ---------------------------------------------------------------- sky, sun, time of day
  buildSky(quality) {
    this.sky = new Sky();
    this.sky.scale.setScalar(4000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 2.2; u.rayleigh.value = 0.9; u.mieCoefficient.value = 0.0025; u.mieDirectionalG.value = 0.82;
    this.group.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
    this.sun.castShadow = quality.shadows > 0;
    this.sun.shadow.mapSize.set(quality.shadows || 1024, quality.shadows || 1024);
    Object.assign(this.sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 120 });
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x3a4a2a, 0.5);
    this.group.add(this.sun, this.sun.target, this.hemi);
    this.lampLights = [];
    for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xffe2b5, 0, 30, 1.6); this.group.add(l); this.lampLights.push(l); }
  }

  // t: hours 0..24
  setTimeOfDay(t, renderer, scene) {
    this.time = t;
    const elev = Math.sin(((t - 6) / 12) * Math.PI) * 62; // degrees above horizon
    const az = 180 + (t - 12) * 15;
    const phi = THREE.MathUtils.degToRad(90 - elev), theta = THREE.MathUtils.degToRad(az);
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(sunDir);
    this.sunDir = sunDir;
    const day = clamp((elev + 6) / 16, 0, 1);
    this.night = day < 0.35;
    this.sun.intensity = 5.5 * day;
    this.sun.color.setHSL(0.09, 0.6, lerp(0.55, 0.92, day));
    this.hemi.intensity = lerp(0.04, 0.9, day);
    this.lampMat.emissiveIntensity = this.night ? 2.2 : 0;
    if (renderer && scene) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      const skyClone = new Sky(); skyClone.scale.setScalar(1000);
      for (const k of Object.keys(this.sky.material.uniforms)) skyClone.material.uniforms[k].value = this.sky.material.uniforms[k].value;
      envScene.add(skyClone);
      if (this.envMap) this.envMap.dispose();
      this.envMap = pmrem.fromScene(envScene, 0).texture;
      pmrem.dispose();
      scene.environment = this.envMap;
      scene.environmentIntensity = lerp(0.04, 0.55, day);
      scene.background = null;
    }
    return this.night;
  }

  follow(target) {
    // keep the sun's shadow frustum and a few street lights around the car
    const d = this.sunDir || new THREE.Vector3(0.3, 0.8, 0.3);
    this.sun.position.copy(target).addScaledVector(d, 60);
    this.sun.target.position.copy(target);
    if (this.night) {
      const sorted = this.lampPositions.map((p) => [p.distanceToSquared(target), p]).sort((a, b) => a[0] - b[0]);
      this.lampLights.forEach((l, i) => { l.position.copy(sorted[i][1]); l.intensity = 160; });
    } else this.lampLights.forEach((l) => (l.intensity = 0));
  }
}
