import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Fast ray probes against the closed car body, used to place details exactly on the curved skin.
export class SurfaceProbe {
  constructor(meshes) {
    const geos = [];
    for (const m of meshes) {
      m.updateMatrixWorld(true);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', m.geometry.attributes.position.clone());
      if (m.geometry.attributes.normal) g.setAttribute('normal', m.geometry.attributes.normal.clone());
      if (m.geometry.index) g.setIndex(m.geometry.index.clone());
      g.applyMatrix4(m.matrixWorld);
      geos.push(g.index ? g.toNonIndexed() : g);
    }
    this.geometry = mergeGeometries(geos);
    this.bvh = new MeshBVH(this.geometry);
    this.ray = new THREE.Ray();
    this._n = new THREE.Vector3();
  }

  // Closest hit along a ray. Returns { point, normal } with the normal facing the ray origin.
  cast(origin, dir) {
    this.ray.origin.copy(origin); this.ray.direction.copy(dir).normalize();
    const hit = this.bvh.raycastFirst(this.ray, THREE.DoubleSide);
    if (!hit) return null;
    const n = this.smoothNormal(hit);
    if (n.dot(this.ray.direction) > 0) n.negate();
    return { point: hit.point.clone(), normal: n, distance: hit.distance };
  }

  smoothNormal(hit) {
    const N = this.geometry.attributes.normal;
    if (!N || !hit.face) return hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
    const { a, b, c } = hit.face;
    const tri = new THREE.Triangle(
      new THREE.Vector3().fromBufferAttribute(this.geometry.attributes.position, a),
      new THREE.Vector3().fromBufferAttribute(this.geometry.attributes.position, b),
      new THREE.Vector3().fromBufferAttribute(this.geometry.attributes.position, c));
    const bary = tri.getBarycoord(hit.point, new THREE.Vector3());
    const n = new THREE.Vector3()
      .addScaledVector(new THREE.Vector3().fromBufferAttribute(N, a), bary.x)
      .addScaledVector(new THREE.Vector3().fromBufferAttribute(N, b), bary.y)
      .addScaledVector(new THREE.Vector3().fromBufferAttribute(N, c), bary.z);
    return n.lengthSq() > 1e-8 ? n.normalize() : hit.face.normal.clone();
  }

  front(x, y) { return this.cast(new THREE.Vector3(x, y, 4), new THREE.Vector3(0, 0, -1)); }
  rear(x, y) { return this.cast(new THREE.Vector3(x, y, -4), new THREE.Vector3(0, 0, 1)); }
  side(sign, z, y) { return this.cast(new THREE.Vector3(sign * 3, y, z), new THREE.Vector3(-sign, 0, 0)); }
  top(x, z) { return this.cast(new THREE.Vector3(x, 3, z), new THREE.Vector3(0, -1, 0)); }

  // Horizontal ray from outside towards an inner centre (cx, y, cz) at heading theta (0 = +Z, +90° = +X)
  polar(cx, cz, y, theta) {
    const d = new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta));
    const o = new THREE.Vector3(cx, y, cz).addScaledVector(d, 4);
    return this.cast(o, d.negate());
  }

  // Conforming grid patch: sampler(u, v) → hit | null over u, v in [0, 1]; returns BufferGeometry or null
  patch(sampler, nu, nv, lift = 0.002) {
    const pos = [], nrm = [], uv = [], idx = [], ok = [];
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv, h = sampler(u, v);
        ok.push(!!h);
        if (h) { pos.push(...h.point.clone().addScaledVector(h.normal, lift).toArray()); nrm.push(...h.normal.toArray()); }
        else { pos.push(0, 0, 0); nrm.push(0, 0, 1); }
        uv.push(u, v);
      }
    }
    const W = nu + 1;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      if (ok[a] && ok[b] && ok[c] && ok[d]) idx.push(a, b, c, b, d, c);
    }
    if (!idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    fixWindingToNormals(g);
    return g;
  }
}

// Make triangle winding agree with the stored vertex normals (so FrontSide materials render)
export function fixWindingToNormals(g) {
  const P = g.attributes.position, N = g.attributes.normal, I = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  let agree = 0;
  for (let i = 0; i < I.length; i += 3) {
    a.fromBufferAttribute(P, I[i]); b.fromBufferAttribute(P, I[i + 1]); c.fromBufferAttribute(P, I[i + 2]);
    b.sub(a); c.sub(a); b.cross(c);
    n.fromBufferAttribute(N, I[i]);
    agree += b.dot(n) > 0 ? 1 : -1;
  }
  if (agree < 0) for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; }
  return g;
}

// Orient an object so its local +Z follows the surface normal and local +Y is close to world up
export function orientToSurface(obj, point, normal, up = new THREE.Vector3(0, 1, 0)) {
  const z = normal.clone().normalize();
  let x = new THREE.Vector3().crossVectors(up, z);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  obj.position.copy(point);
  return obj;
}
