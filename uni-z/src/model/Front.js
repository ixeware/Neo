import * as THREE from 'three';
import { FRONT, zToS } from '../config/geometry.js';
import { orientToSurface } from './Surface.js';
import { pointInPolygon, smoothstep, lerp } from '../util/math.js';
import { makeCanvas, plateTexture } from '../util/textures.js';

// Front fascia of the UNI-Z: X-shaped black face (borderless grille that dissolves into the paint as
// "dragon scales", triangular air guides, trapezoidal lower intake), 56 chrome "flying wing" elements,
// V emblem and the front plate. Headlights live in the grille's upper corners (see Lights.js).

// half-shape (x >= 0, from the centre line round to the centre line) → full mirrored polygon
function mirrorHalf(half) {
  const right = half.map(([x, y]) => [x, y]);
  const left = half.filter(([x]) => x > 1e-6).map(([x, y]) => [-x, y]).reverse();
  return [...right, ...left];
}

export function frontPolygons() {
  return [
    mirrorHalf(FRONT.grille),
    mirrorHalf(FRONT.intake),
    FRONT.guide.map(([x, y]) => [x, y]),
    FRONT.guide.map(([x, y]) => [-x, y]),
  ];
}

// Half-width of a half outline (centre top → round → centre bottom) at height y
function halfWidthAt(half, y) {
  let best = 0;
  for (let i = 0; i < half.length - 1; i++) {
    const [x0, y0] = half[i], [x1, y1] = half[i + 1];
    if (y0 === y1 || (y - y0) * (y - y1) > 0) continue;
    best = Math.max(best, x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
  }
  return best;
}

// Top edge of the grille at x, continued flat past its outer corners
function grilleTopY(x) {
  const top = FRONT.grille.slice(0, FRONT.grilleTopVerts), ax = Math.abs(x);
  for (let i = 1; i < top.length; i++) {
    if (ax <= top[i][0]) return lerp(top[i - 1][1], top[i][1], (ax - top[i - 1][0]) / (top[i][0] - top[i - 1][0]));
  }
  return top[top.length - 1][1];
}

// The grille outline continued upwards past its top edge (the outer edges keep their slope). It only
// shapes the fade, so the halftone never thins out along the top edge, which is then cut crisp.
function grilleFadeShape() {
  const half = FRONT.grille, n = FRONT.grilleTopVerts, up = 0.2;
  const corner = half[n - 1], next = half[n];
  const k = up / Math.max(1e-6, corner[1] - next[1]);
  return mirrorHalf([
    ...half.slice(0, n).map(([x, y]) => [x, y + up]),
    [corner[0] + (corner[0] - next[0]) * k, corner[1] + up],
    ...half.slice(n),
  ]);
}

// Alpha mask: the grille dissolves into the paint through a diamond halftone ("dragon scales") except
// along its top edge, which is cut crisp at clipTop(x); the intake and the air guides are crisp shapes.
function halftoneMask(polys, crisp = [], clipTop = null) {
  const B = FRONT.bounds, W = 1536, H = Math.round((W * (B.y1 - B.y0)) / (B.x1 - B.x0));
  const k = 4, lw = W / k, lh = Math.round(H / k);
  const mmPerPx = ((B.x1 - B.x0) * 1000) / W;
  let m = new Float32Array(lw * lh);
  for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
    const x = B.x0 + ((i + 0.5) / lw) * (B.x1 - B.x0), y = B.y1 - ((j + 0.5) / lh) * (B.y1 - B.y0);
    m[j * lw + i] = polys.some((p) => pointInPolygon(x, y, p)) ? 1 : 0;
  }
  // soft edge: two separable box blurs, radius ≈ fade width / 2
  const r = Math.max(1, Math.round(FRONT.fadeMm / 2 / (mmPerPx * k)));
  const blur = (src) => {
    const a = new Float32Array(src.length), b = new Float32Array(src.length);
    for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) { let s = 0, n = 0; for (let d = -r; d <= r; d++) { const ii = i + d; if (ii >= 0 && ii < lw) { s += src[j * lw + ii]; n++; } } a[j * lw + i] = s / n; }
    for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) { let s = 0, n = 0; for (let d = -r; d <= r; d++) { const jj = j + d; if (jj >= 0 && jj < lh) { s += a[jj * lw + i]; n++; } } b[j * lw + i] = s / n; }
    return b;
  };
  const soft = blur(blur(m));
  const sample = (px, py) => {
    const i = Math.min(lw - 1, Math.max(0, Math.floor(px / k))), j = Math.min(lh - 1, Math.max(0, Math.floor(py / k)));
    return soft[j * lw + i];
  };
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  // solid core
  for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) if (soft[j * lw + i] > 0.93) ctx.fillRect(i * k - 1, j * k - 1, k + 2, k + 2);
  // diamond halftone band (rhombus tiling: half-width P/2, half-height 0.866P at full coverage)
  const P = 15 / mmPerPx; // 15 mm cells
  let row = 0;
  for (let y = 0; y < H + P; y += P * 0.866, row++) {
    for (let x = (row % 2) * P / 2; x < W + P; x += P) {
      const cov = smoothstep(0.06, 0.93, sample(x, y));
      if (cov < 0.03 || cov > 0.985) continue;
      const f = Math.sqrt(cov) * 1.04, rx = (P / 2) * f, ry = P * 0.866 * f;
      ctx.beginPath(); ctx.moveTo(x, y - ry); ctx.lineTo(x + rx, y); ctx.lineTo(x, y + ry); ctx.lineTo(x - rx, y); ctx.closePath(); ctx.fill();
    }
  }
  const toPx = ([x, y]) => [((x - B.x0) / (B.x1 - B.x0)) * W, ((B.y1 - y) / (B.y1 - B.y0)) * H];
  if (clipTop) {
    // everything above the top edge goes back to paint (anti-aliased vector edge)
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.moveTo(0, 0);
    for (let i = 0; i <= 240; i++) { const x = lerp(B.x0, B.x1, i / 240); ctx.lineTo(...toPx([x, clipTop(x)])); }
    ctx.lineTo(W, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
  }
  for (const poly of crisp) {
    ctx.beginPath();
    poly.forEach((p, i) => { const [px, py] = toPx(p); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.closePath(); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

// "Flying wing" element: long top bar with a short leg angled down towards the centre line
function wingGeometry(mirror) {
  const pts = [[-20, -16], [-12, -16], [2, 0], [60, 2], [64, 9], [-2, 9]].map(([x, y]) => [x - 22, y]);
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => { const X = (mirror ? -x : x) / 1000, Y = y / 1000; if (i) s.lineTo(X, Y); else s.moveTo(X, Y); });
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.0016, bevelSize: 0.0014, bevelSegments: 2, curveSegments: 1 });
  if (mirror) {
    // mirroring the outline flips the winding: swap two corners of every triangle back
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i += 3) for (const a of [p, n, uv]) {
      for (let c = 0; c < a.itemSize; c++) { const t = a.array[(i + 1) * a.itemSize + c]; a.array[(i + 1) * a.itemSize + c] = a.array[(i + 2) * a.itemSize + c]; a.array[(i + 2) * a.itemSize + c] = t; }
    }
    g.computeVertexNormals();
  }
  return g;
}

// Wing outline extents at scale 1 (metres, see wingGeometry incl. bevel), used to keep the lamps clear
const WING_BOX = { x: 0.044, yDown: 0.0175, yUp: 0.0105 };

export function wingLayout() {
  const R = FRONT.rows, out = [];
  R.y.forEach((y, ri) => {
    const n = R.counts[ri], skip = R.skipCentre[ri];
    const hw = Math.min(R.maxHalf?.[ri] ?? Infinity, halfWidthAt(FRONT.grille, y) - R.edgeMargin);
    const step = (2 * hw) / n;
    for (let k = 0; k < n; k++) {
      if (skip && Math.abs(k - (n - 1) / 2) < skip / 2) continue;
      const x = -hw + step * (k + 0.5), s = R.scale[ri] * 1.08;
      // never under a headlight projector (6 mm clearance round the bezel)
      const hitsLamp = FRONT.projectors.some(([px, py]) => {
        const dx = Math.max(0, Math.abs(Math.abs(x) - px) - WING_BOX.x * s);
        const dy = Math.max(0, py - (y + WING_BOX.yUp * s), (y - WING_BOX.yDown * s) - py);
        return Math.hypot(dx, dy) < FRONT.projectorR + 0.006;
      });
      if (!hitsLamp) out.push({ x, y, scale: s, row: ri });
    }
  });
  return out;
}

export function buildFront(model, probe, details) {
  const M = model.M, body = model.body;
  const B = FRONT.bounds;
  // black X-shaped face
  const [, ...crisp] = frontPolygons();
  // gloss black like the real car, reflections toned down a little so the face still reads black
  const mat = new THREE.MeshPhysicalMaterial({ color: 0x040506, roughness: 0.22, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.06, envMapIntensity: 0.8, alphaMap: halftoneMask([grilleFadeShape()], crisp, grilleTopY), alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.name = 'grille_face';
  // projected straight ahead: keep only the forward-facing nose (drops rays that graze past the corners
  // onto the fender top or into the wheel-arch wall)
  const face = probe.patch((u, v) => {
    const h = probe.front(lerp(B.x0, B.x1, u), lerp(B.y0, B.y1, v));
    return h && h.normal.z > 0.05 && zToS(h.point.z) < FRONT.maxS ? h : null;
  }, 96, 36, 0.0016);
  if (face) { const m = new THREE.Mesh(face, mat); m.name = 'Grille_Face'; body.add(m); }

  // 56 chrome "flying wing" elements in 6 rows (left half mirrored)
  const layout = wingLayout();
  const geoL = wingGeometry(false), geoR = wingGeometry(true);
  const instL = new THREE.InstancedMesh(geoL, M.grille_wing, layout.length), instR = new THREE.InstancedMesh(geoR, M.grille_wing, layout.length);
  const o = new THREE.Object3D();
  let nl = 0, nr = 0;
  for (const w of layout) {
    const hit = probe.front(w.x, w.y);
    if (!hit) continue;
    orientToSurface(o, hit.point.clone().addScaledVector(hit.normal, 0.0015), hit.normal);
    o.scale.setScalar(w.scale);
    o.updateMatrix();
    // elements on the viewer's left (x < 0) use the base outline, the others its mirror image
    if (w.x < 0) instL.setMatrixAt(nl++, o.matrix); else instR.setMatrixAt(nr++, o.matrix);
  }
  instL.count = nl; instR.count = nr;
  instL.name = 'Grille_Wings_R'; instR.name = 'Grille_Wings_L';
  body.add(instL, instR);
  details.grilleWings = nl + nr;

  // chrome strips inside the triangular air guides (parallel to the long edge)
  for (const sign of [1, -1]) {
    const [a, b, c] = FRONT.guide; // a top-outer, b bottom-outer, c inner tip; strips run parallel to a–c
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const e0 = [lerp(a[0], b[0], t), lerp(a[1], b[1], t)], e1 = [lerp(c[0], b[0], t), lerp(c[1], b[1], t)];
      const p0 = [lerp(e0[0], e1[0], 0.1), lerp(e0[1], e1[1], 0.1)], p1 = [lerp(e0[0], e1[0], 0.88), lerp(e0[1], e1[1], 0.88)];
      const h0 = probe.front(sign * p0[0], p0[1]), h1 = probe.front(sign * p1[0], p1[1]);
      if (!h0 || !h1) continue;
      const q0 = h0.point.clone().addScaledVector(h0.normal, 0.004), q1 = h1.point.clone().addScaledVector(h1.normal, 0.004);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.004, q0.distanceTo(q1)), M.chrome);
      strip.position.copy(q0).add(q1).multiplyScalar(0.5);
      strip.lookAt(q1);
      strip.name = 'Guide_Strip';
      body.add(strip);
    }
  }

  // simplified V emblem at the top of the grille
  {
    const s = new THREE.Shape(), W = FRONT.emblem.width / 2;
    s.moveTo(-W, 0.042); s.lineTo(-W * 0.64, 0.042); s.lineTo(0, -0.024); s.lineTo(W * 0.64, 0.042); s.lineTo(W, 0.042); s.lineTo(0.011, -0.047); s.lineTo(-0.011, -0.047); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2 });
    const hit = probe.front(0, FRONT.emblem.y);
    if (hit) {
      const m = new THREE.Mesh(g, M.chrome);
      orientToSurface(m, hit.point.clone().addScaledVector(hit.normal, 0.004), hit.normal);
      m.name = 'Emblem_Front';
      body.add(m);
    }
  }

  // front plate on the lower intake
  {
    const hit = probe.front(0, FRONT.plate.y);
    if (hit) {
      const format = model.config.plate || 'RU';
      const [w, h] = format === 'CN' ? [0.44, 0.14] : [0.52, 0.112];
      const grp = new THREE.Group();
      const back = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.02, h + 0.02), M.trim_black);
      const facePlate = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: plateTexture(format), roughness: 0.4, metalness: 0.1 }));
      facePlate.position.z = 0.002;
      grp.add(back, facePlate);
      orientToSurface(grp, hit.point.clone().addScaledVector(hit.normal, 0.014), hit.normal);
      grp.name = 'Plate_Front';
      body.add(grp);
      details.plateFront = grp;
    }
  }
}
