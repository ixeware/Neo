import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TIRES } from '../config/vehicle.js';
import { sidewallNormal } from '../util/textures.js';
import { lerp } from '../util/math.js';

const sidewallCache = {};

// Lathe around the axle (X axis). profile: [[radius, axial], ...]
function lathe(profile, segments = 96) {
  const g = new THREE.LatheGeometry(profile.map(([r, a]) => new THREE.Vector2(r, a)), segments);
  g.rotateZ(-Math.PI / 2); // lathe axis Y → X; axial coordinate becomes +X (outboard)
  return g;
}

function tireGeometries(spec) {
  const R = spec.radiusM, W = spec.widthM, rimR = spec.rimInch * 0.0254 / 2, H = R - rimR;
  const h = W / 2;
  const tread = lathe([
    [R - 0.022, -h + 0.006], [R - 0.008, -h + 0.016], [R - 0.001, -h + 0.034], [R, -h + 0.06], [R, h - 0.06], [R - 0.001, h - 0.034], [R - 0.008, h - 0.016], [R - 0.022, h - 0.006],
  ], 128);
  const side = (sign) => lathe(sign > 0
    ? [[R - 0.022, h - 0.006], [rimR + H * 0.7, h + 0.003], [rimR + H * 0.35, h + 0.002], [rimR + 0.012, h - 0.012]]
    : [[rimR + 0.012, -h + 0.012], [rimR + H * 0.35, -h - 0.002], [rimR + H * 0.7, -h - 0.003], [R - 0.022, -h + 0.006]], 128);
  return { tread, outer: side(1), inner: side(-1), R, W, rimR };
}

function spokeShape(len, w0, w1) {
  const s = new THREE.Shape();
  s.moveTo(0, -w0 / 2); s.lineTo(len, -w1 / 2); s.quadraticCurveTo(len + w1 * 0.3, 0, len, w1 / 2); s.lineTo(0, w0 / 2); s.closePath();
  return s;
}

function rimGeometry(spec, design) {
  const { rimR, W } = { rimR: spec.rimInch * 0.0254 / 2, W: spec.widthM };
  const faceX = W / 2 - 0.022; // outboard face plane
  const barrel = lathe([
    [rimR + 0.012, faceX + 0.006], [rimR + 0.014, faceX - 0.004], [rimR - 0.004, faceX - 0.012], [rimR - 0.006, -W / 2 + 0.02], [rimR + 0.012, -W / 2 + 0.008], [rimR + 0.014, -W / 2 + 0.002],
  ], 96);
  const hub = lathe([[0.08, faceX - 0.05], [0.075, faceX - 0.012], [0.042, faceX - 0.002], [0.034, faceX + 0.004], [0.0005, faceX + 0.004]], 48);
  const spokes = [];
  const count = design === 'turbine' ? 10 : 5;
  const inner = 0.07, outer = rimR - 0.006;
  for (let i = 0; i < count; i++) {
    const base = (i / count) * Math.PI * 2;
    const arms = design === 'turbine' ? [[0, 0.04, 0.028, 0.24]] : [[-0.16, 0.042, 0.03, 0], [0.16, 0.042, 0.03, 0]];
    for (const [off, w0, w1, twist] of arms) {
      const g = new THREE.ExtrudeGeometry(spokeShape(outer - inner, w0, w1), { depth: 0.026, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, steps: 1, curveSegments: 6 });
      // shape plane (x radial, y tangential), depth along +Z → map: radial r, tangential t, axial z
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const r = inner + p.getX(k), t = p.getY(k), z = p.getZ(k);
        const f = Math.max(0, (r - inner) / (outer - inner));
        const ang = base + off * (1 - 0.55 * f) + twist * f;
        const concave = 0.034 * Math.pow(Math.max(0, (r - inner) / (outer - inner)), 1.4); // dished face: spokes sink towards the rim
        const ax = faceX - 0.026 + z - concave * 0.6;
        const y = Math.cos(ang) * r - Math.sin(ang) * t, zz = Math.sin(ang) * r + Math.cos(ang) * t;
        p.setXYZ(k, ax, y, zz);
      }
      g.computeVertexNormals();
      spokes.push(g);
    }
  }
  // keep the extrude groups apart: caps (machined face) vs sides (dark pockets)
  const pick = (groupIndex) => mergeGeometries(spokes.map((g) => {
    const grp = g.groups.find((x) => x.materialIndex === groupIndex);
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const a = g.attributes[name];
      out.setAttribute(name, new THREE.BufferAttribute(a.array.slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize), a.itemSize));
    }
    return out;
  }));
  return { barrel, hub, spokeFace: pick(0), spokeSide: pick(1), faceX, rimR };
}

export function buildWheel(M, size, design, side) {
  const spec = TIRES[size];
  const root = new THREE.Group(); root.name = 'WheelRoot';
  const steer = new THREE.Group(); steer.name = 'SteerPivot';
  const spin = new THREE.Group(); spin.name = 'Spin';
  const visual = new THREE.Group(); // mirrored for right-hand wheels so the face points outboard
  visual.rotation.y = side > 0 ? 0 : Math.PI;
  root.add(steer); steer.add(spin); spin.add(visual);

  const t = tireGeometries(spec);
  if (!sidewallCache[spec.label]) sidewallCache[spec.label] = sidewallNormal(spec.label);
  const sideMat = M.sidewall.clone();
  sideMat.normalMap = sidewallCache[spec.label];
  sideMat.normalScale = new THREE.Vector2(0.8, 0.8);
  const tread = new THREE.Mesh(t.tread, M.rubber);
  const outer = new THREE.Mesh(t.outer, sideMat);
  const inner = new THREE.Mesh(t.inner, M.sidewall);
  const r = rimGeometry(spec, design);
  const barrel = new THREE.Mesh(r.barrel, M.rim_dark);
  const hub = new THREE.Mesh(r.hub, M.rim_dark);
  const spokes = new THREE.Mesh(r.spokeFace, M.rim_face);
  const spokeSides = new THREE.Mesh(r.spokeSide, M.rim_dark);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 32), M.black_gloss);
  cap.rotation.z = Math.PI / 2; cap.position.x = r.faceX + 0.006;
  const capRing = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.003, 8, 32), M.chrome);
  capRing.rotation.y = Math.PI / 2; capRing.position.x = r.faceX + 0.008;
  const nutGeo = new THREE.CylinderGeometry(0.0095, 0.0095, 0.02, 6);
  nutGeo.rotateZ(Math.PI / 2);
  const nuts = new THREE.InstancedMesh(nutGeo, M.satin, 5);
  const o = new THREE.Object3D();
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.3; o.position.set(r.faceX - 0.004, Math.cos(a) * 0.0572, Math.sin(a) * 0.0572); o.updateMatrix(); nuts.setMatrixAt(i, o.matrix); }
  // brake disc + hat
  const discR = size >= 20 ? 0.172 : 0.162;
  const disc = new THREE.Mesh(lathe([[0.09, -0.014], [discR, -0.014], [discR, 0.014], [0.09, 0.014], [0.09, -0.014]], 72), M.brake_disc);
  disc.position.x = -0.035;
  const hat = new THREE.Mesh(lathe([[0.0, 0.03], [0.09, 0.03], [0.09, -0.02]], 40), M.brake_hat);
  hat.position.x = -0.035;
  visual.add(tread, outer, inner, barrel, hub, spokes, spokeSides, cap, capRing, nuts, disc, hat);
  for (const m of [tread, outer, inner, barrel, spokes]) { m.castShadow = true; m.receiveShadow = true; }

  // caliper on the knuckle (does not spin)
  const cal = new THREE.Shape();
  const a0 = 1.95, a1 = 2.75, ri = discR - 0.045, ro = discR + 0.012;
  cal.absarc(0, 0, ro, a0, a1, false);
  cal.absarc(0, 0, ri, a1, a0, true);
  const calGeo = new THREE.ExtrudeGeometry(cal, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 2, curveSegments: 12 });
  calGeo.translate(0, 0, -0.035);
  calGeo.rotateY(Math.PI / 2);
  const caliper = new THREE.Mesh(calGeo, M.caliper);
  caliper.position.x = side * -0.035;
  caliper.castShadow = true;
  steer.add(caliper);

  root.userData = { steer, spin, radius: spec.radiusM, size, design, side };
  return root;
}

export const WHEEL_DESIGNS = { 19: 'double', 20: 'turbine' };
