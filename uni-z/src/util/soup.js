import * as THREE from 'three';

// Triangle soup with a material key per triangle. Used to post-process CSG output:
// re-assign materials by region, split panels apart, then build grouped BufferGeometries.
export class TriSoup {
  constructor(capacity = 1024) {
    this.n = 0;
    this.pos = new Float32Array(capacity * 9);
    this.nrm = new Float32Array(capacity * 9);
    this.uv = new Float32Array(capacity * 6);
    this.key = new Array(capacity);
  }

  ensure(extra) {
    const need = this.n + extra;
    if (need * 9 <= this.pos.length) return;
    const cap = Math.max(need, Math.ceil(this.pos.length / 9) * 2);
    const grow = (a, k) => { const b = new Float32Array(cap * k); b.set(a); return b; };
    this.pos = grow(this.pos, 9); this.nrm = grow(this.nrm, 9); this.uv = grow(this.uv, 6);
    this.key.length = cap;
  }

  // Copy triangle i of another soup
  pushFrom(src, i, key = src.key[i]) {
    this.ensure(1);
    const j = this.n++;
    this.pos.set(src.pos.subarray(i * 9, i * 9 + 9), j * 9);
    this.nrm.set(src.nrm.subarray(i * 9, i * 9 + 9), j * 9);
    this.uv.set(src.uv.subarray(i * 6, i * 6 + 6), j * 6);
    this.key[j] = key;
  }

  pushTri(p, n, uv, key) {
    this.ensure(1);
    const j = this.n++;
    this.pos.set(p, j * 9); this.nrm.set(n, j * 9); this.uv.set(uv || [0, 0, 0, 0, 0, 0], j * 6);
    this.key[j] = key;
  }

  static fromGeometry(geo, keyOfMaterialIndex) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.attributes.position.array, N = g.attributes.normal?.array, U = g.attributes.uv?.array;
    const triCount = P.length / 9;
    const soup = new TriSoup(triCount + 16);
    const groups = g.groups.length ? g.groups : [{ start: 0, count: triCount * 3, materialIndex: 0 }];
    for (const grp of groups) {
      const key = typeof keyOfMaterialIndex === 'function' ? keyOfMaterialIndex(grp.materialIndex) : keyOfMaterialIndex[grp.materialIndex] ?? keyOfMaterialIndex;
      for (let v = grp.start; v < grp.start + grp.count; v += 3) {
        const t = v / 3, j = soup.n++;
        soup.pos.set(P.subarray(t * 9, t * 9 + 9), j * 9);
        if (N) soup.nrm.set(N.subarray(t * 9, t * 9 + 9), j * 9);
        if (U) soup.uv.set(U.subarray(t * 6, t * 6 + 6), j * 6);
        soup.key[j] = key;
      }
    }
    if (!N) soup.recomputeFlatNormals();
    return soup;
  }

  recomputeFlatNormals() {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      const o = i * 9;
      a.fromArray(this.pos, o); b.fromArray(this.pos, o + 3); c.fromArray(this.pos, o + 6);
      b.sub(a); c.sub(a); b.cross(c).normalize();
      for (let k = 0; k < 3; k++) { this.nrm[o + k * 3] = b.x; this.nrm[o + k * 3 + 1] = b.y; this.nrm[o + k * 3 + 2] = b.z; }
    }
  }

  centroid(i, out = new THREE.Vector3()) {
    const o = i * 9, p = this.pos;
    return out.set((p[o] + p[o + 3] + p[o + 6]) / 3, (p[o + 1] + p[o + 4] + p[o + 7]) / 3, (p[o + 2] + p[o + 5] + p[o + 8]) / 3);
  }

  faceNormal(i, out = new THREE.Vector3()) {
    const o = i * 9, p = this.pos;
    const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
    const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
    return out.set(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx).normalize();
  }

  // fn(i, key, centroid, faceNormal) → new key (or same)
  remap(fn) {
    const c = new THREE.Vector3(), nm = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      this.centroid(i, c); this.faceNormal(i, nm);
      this.key[i] = fn(i, this.key[i], c, nm);
    }
    return this;
  }

  // fn(i, key, centroid, faceNormal) → bucket name (or null to drop)
  partition(fn) {
    const out = new Map(), c = new THREE.Vector3(), nm = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      this.centroid(i, c); this.faceNormal(i, nm);
      const b = fn(i, this.key[i], c, nm);
      if (b == null) continue;
      if (!out.has(b)) out.set(b, new TriSoup(256));
      out.get(b).pushFrom(this, i);
    }
    return out;
  }

  append(other) { for (let i = 0; i < other.n; i++) this.pushFrom(other, i); return this; }

  translate(x, y, z) {
    for (let i = 0; i < this.n * 3; i++) { this.pos[i * 3] += x; this.pos[i * 3 + 1] += y; this.pos[i * 3 + 2] += z; }
    return this;
  }

  // Build a non-indexed BufferGeometry with one group per key; returns { geometry, keys }
  toGeometry(order) {
    const byKey = new Map();
    for (let i = 0; i < this.n; i++) {
      const k = this.key[i];
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(i);
    }
    const keys = [...byKey.keys()].sort((a, b) => (order ? order.indexOf(a) - order.indexOf(b) : 0));
    const P = new Float32Array(this.n * 9), N = new Float32Array(this.n * 9), U = new Float32Array(this.n * 6);
    const geo = new THREE.BufferGeometry();
    let t = 0;
    keys.forEach((k, mi) => {
      const list = byKey.get(k);
      geo.addGroup(t * 3, list.length * 3, mi);
      for (const i of list) {
        P.set(this.pos.subarray(i * 9, i * 9 + 9), t * 9);
        N.set(this.nrm.subarray(i * 9, i * 9 + 9), t * 9);
        U.set(this.uv.subarray(i * 6, i * 6 + 6), t * 6);
        t++;
      }
    });
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    return { geometry: geo, keys };
  }
}
