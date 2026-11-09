import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DETAILS, sToZ, zToS, LOWER, CAVITIES, tableAt } from '../config/geometry.js';
import { orientToSurface } from './Surface.js';
import { grilleFadeTexture, labelTexture, plateTexture } from '../util/textures.js';
import { lerp, smoothstep, clamp } from '../util/math.js';

// Exterior details placed on the body surface with ray probes.
export function buildDetails(model, probe, opts = {}) {
  const M = model.M;
  const out = { mirrors: [], handles: [], rails: null, plates: [], badges: [] };
  const body = model.body;

  // ---------------------------------------------------------------- grille (borderless dot matrix)
  {
    const G = DETAILS.grille;
    const fadeTex = grilleFadeTexture();
    const decalMat = new THREE.MeshStandardMaterial({ map: fadeTex, transparent: true, roughness: 0.35, metalness: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    decalMat.name = 'grille_fade';
    const x0 = -0.70, x1 = 0.70, y0 = (G.botH - 40) / 1000, y1 = (G.topH + 30) / 1000;
    const decal = probe.patch((u, v) => probe.front(lerp(x0, x1, u), lerp(y0, y1, v)), 56, 24, 0.0015);
    if (decal) { const m = new THREE.Mesh(decal, decalMat); m.name = 'Grille_Fade'; body.add(m); }

    const dotGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1);
    dotGeo.rotateX(Math.PI / 2);
    const density = opts.grilleDensity ?? 1;
    const dots = [];
    const pitch = G.pitch / 1000 / Math.sqrt(density);
    const hwAt = (y) => lerp(G.botHalfW, G.topHalfW, (y * 1000 - G.botH) / (G.topH - G.botH)) / 1000;
    let row = 0;
    for (let y = G.botH / 1000 - 0.03; y <= G.topH / 1000 + 0.01; y += pitch * 0.866, row++) {
      for (let x = -0.9 + (row % 2) * pitch / 2; x <= 0.9; x += pitch) {
        const d = Math.min(hwAt(y) - Math.abs(x), G.topH / 1000 - y, y - G.botH / 1000) * 1000; // mm inside the trapezoid
        if (d < -45) continue;
        const f = smoothstep(-45, 110, d);
        const size = lerp(1.5, G.dotMax, f) / 1000;
        if (size < 0.002) continue;
        // keep clear of the emblem and plate
        if (Math.abs(x) < 0.12 && Math.abs(y - DETAILS.emblemFront.h / 1000) < 0.06) continue;
        if (Math.abs(x) < 0.29 && Math.abs(y - DETAILS.plateFront.h / 1000) < 0.075) continue;
        dots.push([x, y, size]);
      }
    }
    // L-shaped dot elements in the lower bumper corners
    const L = DETAILS.lElements;
    for (const sign of [1, -1]) {
      for (let y = L.hLow / 1000; y <= L.hHigh / 1000; y += 0.024) for (let x = (L.xOut - 50) / 1000; x <= L.xOut / 1000; x += 0.024) dots.push([sign * x, y, lerp(5, 11, (y * 1000 - L.hLow) / (L.hHigh - L.hLow)) / 1000]);
      for (let x = L.xIn / 1000; x < (L.xOut - 50) / 1000; x += 0.024) for (let y = L.hLow / 1000; y <= (L.hLow + 50) / 1000; y += 0.024) dots.push([sign * x, y, lerp(4, 10, (x * 1000 - L.xIn) / (L.xOut - L.xIn)) / 1000]);
    }
    const inst = new THREE.InstancedMesh(dotGeo, M.grille_dot_edge, dots.length);
    const o = new THREE.Object3D();
    let n = 0;
    for (const [x, y, size] of dots) {
      const hit = probe.front(x, y);
      if (!hit || hit.normal.z < 0.25) continue;
      orientToSurface(o, hit.point.clone().addScaledVector(hit.normal, 0.0025), hit.normal);
      o.scale.set(size, size, 0.004);
      o.updateMatrix();
      inst.setMatrixAt(n++, o.matrix);
    }
    inst.count = n;
    inst.name = 'Grille_Dots';
    body.add(inst);
    out.grilleDots = n;
  }

  // ---------------------------------------------------------------- front emblem (simplified V badge)
  {
    const s = new THREE.Shape();
    s.moveTo(-0.095, 0.05); s.lineTo(-0.062, 0.05); s.lineTo(0, -0.028); s.lineTo(0.062, 0.05); s.lineTo(0.095, 0.05); s.lineTo(0.012, -0.055); s.lineTo(-0.012, -0.055); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2 });
    const hit = probe.front(0, DETAILS.emblemFront.h / 1000);
    if (hit) {
      const m = new THREE.Mesh(g, M.chrome);
      orientToSurface(m, hit.point.clone().addScaledVector(hit.normal, 0.004), hit.normal);
      m.name = 'Emblem_Front';
      body.add(m);
      out.badges.push(m);
    }
  }

  // ---------------------------------------------------------------- plates
  const plate = (format, hit, parent, name) => {
    if (!hit) return null;
    const [w, h] = format === 'CN' ? [0.44, 0.14] : [0.52, 0.112];
    const grp = new THREE.Group();
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.02, h + 0.02), M.trim_black);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: plateTexture(format), roughness: 0.4, metalness: 0.1 }));
    face.position.z = 0.002;
    grp.add(back, face);
    orientToSurface(grp, hit.point.clone().addScaledVector(hit.normal, 0.012), hit.normal);
    grp.name = name;
    grp.userData.format = format;
    parent.add(grp);
    return grp;
  };
  out.plateFront = plate(opts.plate || 'RU', probe.front(0, DETAILS.plateFront.h / 1000), body, 'Plate_Front');
  out.plateRearHit = probe.rear(0, DETAILS.plateRear.h / 1000);

  // ---------------------------------------------------------------- mirrors (on the front doors, foldable)
  for (const sign of [1, -1]) {
    const hit = probe.side(sign, sToZ(1765), 1.105);
    if (!hit) continue;
    const base = new THREE.Group();
    base.position.copy(hit.point);
    const fold = new THREE.Group();
    base.add(fold);
    const arm = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.05, 0.13, 2, 0.015), M.black_gloss);
    arm.position.set(sign * 0.03, 0.025, -0.01);
    const shell = new THREE.SphereGeometry(1, 28, 18);
    const p = shell.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      // blend the sphere towards a superellipsoid → rounded-box housing
      const n4 = Math.pow(x ** 4 + y ** 4 + z ** 4, 0.25) || 1;
      x = x * 0.45 + (x / n4) * 0.55; y = y * 0.45 + (y / n4) * 0.55; z = z * 0.45 + (z / n4) * 0.55;
      z = Math.max(z, -0.42); // flat back for the glass
      const taper = 1 - 0.18 * (x * sign + 1) / 2; // slimmer towards the outer tip
      p.setXYZ(i, x * 0.112, y * 0.064 * taper, z * 0.056 + (x * sign) * 0.018);
    }
    shell.computeVertexNormals();
    const cap = new THREE.Mesh(shell, M.paint);
    cap.position.set(sign * 0.105, 0.08, -0.02);
    cap.castShadow = true;
    const glass = new THREE.Mesh(new THREE.CircleGeometry(1, 32), M.mirror_glass);
    glass.scale.set(0.1, 0.05, 1);
    glass.rotation.y = Math.PI;
    glass.position.set(sign * 0.105, 0.08, -0.02 - 0.0225);
    const rep = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.007, 0.01), M.led_amber);
    rep.position.set(sign * 0.12, 0.035, 0.012);
    rep.rotation.z = sign * 0.15;
    fold.add(arm, cap, glass, rep);
    base.name = sign > 0 ? 'Mirror_L' : 'Mirror_R';
    base.userData.fold = fold; base.userData.sign = sign;
    model.attach(sign > 0 ? 'door_fl' : 'door_fr', base);
    out.mirrors.push(base);
  }

  // ---------------------------------------------------------------- door handles
  const H = DETAILS.handles;
  for (const [door, spec] of [['f', H.front], ['r', H.rear]]) {
    for (const sign of [1, -1]) {
      const sMid = (spec.s[0] + spec.s[1]) / 2;
      const hit = probe.side(sign, sToZ(sMid), spec.h / 1000);
      if (!hit) continue;
      const grp = new THREE.Group();
      const pocket = new THREE.Mesh(new THREE.CircleGeometry(1, 24), M.mesh_dark);
      pocket.scale.set(0.085, 0.022, 1);
      pocket.position.z = 0.0012;
      const handle = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.03, 0.022, 3, 0.011), M.paint);
      handle.position.z = 0.012;
      const strip = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.006, 0.006, 2, 0.003), M.chrome);
      strip.position.set(0, 0.012, 0.022);
      const flush = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.032, 0.006, 2, 0.003), M.black_gloss);
      flush.position.z = 0.003;
      flush.visible = false;
      grp.add(pocket, handle, strip, flush);
      grp.userData = { mechanical: [pocket, handle, strip], flush: [flush] };
      orientToSurface(grp, hit.point, hit.normal);
      grp.name = `Handle_${door}${sign > 0 ? 'L' : 'R'}`;
      model.attach(`door_${door}${sign > 0 ? 'l' : 'r'}`, grp);
      out.handles.push(grp);
    }
  }

  // ---------------------------------------------------------------- spoiler with high-mount stop lamp
  {
    const S = DETAILS.spoiler;
    const roofAt = (x, s) => probe.top(x, sToZ(s))?.point.y ?? 1.5;
    const sections = [];
    const NX = 25;
    for (let i = 0; i < NX; i++) {
      const t = i / (NX - 1), x = lerp(-S.halfW, S.halfW, t) / 1000;
      const taper = 1 - Math.pow(Math.abs(t * 2 - 1), 6) * 0.55;
      const r0 = roofAt(x * 0.98, S.fromS + 10), rMid = roofAt(x * 0.98, 4335);
      const te = lerp(4330, S.toS, taper);
      sections.push([
        [S.fromS, r0 + 0.003], [4330, r0 + 0.012 * taper], [te, r0 - 0.004], [te - 6, r0 - 0.036 * taper - 0.004], [4335, rMid + 0.0], [S.fromS + 25, r0 - 0.004],
      ].map(([s, y]) => new THREE.Vector3(x, y, sToZ(s))));
    }
    const g = loftSections(sections);
    const m = new THREE.Mesh(g, M.paint);
    m.castShadow = true;
    m.name = 'Spoiler';
    model.attach('tailgate', m);
    const chmsl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.006, 0.01), M.led_brake);
    const te = sections[Math.floor(NX / 2)][3];
    chmsl.position.copy(te).add(new THREE.Vector3(0, 0.0, 0.004));
    chmsl.name = 'CHMSL';
    model.attach('tailgate', chmsl);
  }

  // ---------------------------------------------------------------- roof rails
  {
    const R = DETAILS.rails;
    const grp = new THREE.Group(); grp.name = 'RoofRails';
    for (const sign of [1, -1]) {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const s = lerp(R.fromS, R.toS, i / 16), hit = probe.top(sign * R.x / 1000, sToZ(s));
        if (hit) pts.push(hit.point.clone().add(new THREE.Vector3(0, R.heightMm / 1000 - 0.008 * Math.sin((i / 16) * Math.PI) * 0, 0)));
      }
      if (pts.length < 4) continue;
      // ends dip down to the roof (feet)
      pts[0].y -= 0.03; pts[pts.length - 1].y -= 0.03;
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.012, 10, false), M.satin);
      tube.scale.set(1, 1, 1);
      tube.castShadow = true;
      grp.add(tube);
      for (const f of [0.0, 1.0]) {
        const p = curve.getPoint(f);
        const foot = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.03, 0.09, 2, 0.01), M.black_gloss);
        foot.position.copy(p).add(new THREE.Vector3(0, -0.006, f === 0 ? -0.03 : 0.03));
        grp.add(foot);
      }
    }
    body.add(grp);
    out.rails = grp;
  }

  // ---------------------------------------------------------------- shark-fin antenna
  {
    const F = DETAILS.sharkFin;
    const sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.lineTo(F.length / 1000, 0); sh.quadraticCurveTo(F.length / 1000 * 0.98, F.height / 1000 * 0.6, F.length / 1000 * 0.82, F.height / 1000);
    sh.quadraticCurveTo(F.length / 1000 * 0.3, F.height / 1000 * 0.6, 0, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 3 });
    g.translate(-F.length / 1000 / 2, 0, -0.025);
    g.rotateY(Math.PI / 2);
    const hit = probe.top(0, sToZ(F.s));
    if (hit) {
      const m = new THREE.Mesh(g, M.black_gloss);
      m.position.copy(hit.point).add(new THREE.Vector3(0, -0.004, 0));
      m.rotation.y = Math.PI;
      m.name = 'SharkFin';
      body.add(m);
    }
  }

  // ---------------------------------------------------------------- cowl panel and wipers
  {
    const cowl = probe.patch((u, v) => probe.top(lerp(-0.72, 0.72, u), sToZ(lerp(1488, 1522, v))), 36, 3, 0.002);
    if (cowl) { const m = new THREE.Mesh(cowl, M.trim_black); m.name = 'Cowl'; body.add(m); }
    const wiper = (xa, xb, sa, sb, name) => {
      const a = probe.top(xa, sToZ(sa)), b = probe.top(xb, sToZ(sb));
      if (!a || !b) return;
      const pa = a.point.clone().addScaledVector(a.normal, 0.012), pb = b.point.clone().addScaledVector(b.normal, 0.012);
      const len = pa.distanceTo(pb);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.012, len), M.trim_black);
      m.position.copy(pa).add(pb).multiplyScalar(0.5);
      m.lookAt(pb);
      m.name = name;
      body.add(m);
    };
    wiper(0.5, -0.08, 1532, 1560, 'Wiper_L');
    wiper(-0.06, -0.62, 1536, 1566, 'Wiper_R');
  }

  // ---------------------------------------------------------------- rear: exhaust trims, lettering, badge, wiper, plate
  {
    const E = DETAILS.exhaust;
    for (const sign of [1, -1]) {
      const cx = sign * (E.xIn + E.xOut) / 2000, cy = (E.hLow + E.hHigh) / 2000;
      const hit = probe.rear(cx, cy);
      if (!hit) continue;
      const w = (E.xOut - E.xIn) / 1000, h = (E.hHigh - E.hLow) / 1000, c = 0.014;
      const poly = (W, H, C) => { const s = new THREE.Shape(); s.moveTo(-W / 2 + C, -H / 2); s.lineTo(W / 2 - C, -H / 2); s.lineTo(W / 2, -H / 2 + C); s.lineTo(W / 2, H / 2 - C); s.lineTo(W / 2 - C, H / 2); s.lineTo(-W / 2 + C, H / 2); s.lineTo(-W / 2, H / 2 - C); s.lineTo(-W / 2, -H / 2 + C); s.closePath(); return s; };
      const outer = poly(w, h, c), inner = poly(w - 0.016, h - 0.016, c * 0.7);
      outer.holes.push(new THREE.Path(inner.getPoints()));
      const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.008, bevelEnabled: false }), M.chrome);
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(inner), M.mesh_dark);
      fill.position.z = 0.002;
      const grp = new THREE.Group(); grp.add(frame, fill);
      orientToSurface(grp, hit.point.clone().addScaledVector(hit.normal, 0.002), hit.normal);
      grp.name = 'ExhaustTrim';
      body.add(grp);
    }
    const letters = probe.patch((u, v) => probe.rear(lerp(0.42, -0.42, u), lerp(0.948, 0.992, v)), 40, 2, 0.0025);
    if (letters) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xe8ebef, metalness: 1, roughness: 0.18, alphaMap: labelTexture('CHANGAN', { w: 2048, h: 128, font: '600 104px Arial, sans-serif', fg: '#fff', spacing: 46 }), transparent: true, depthWrite: false });
      mat.name = 'lettering';
      const m = new THREE.Mesh(letters, mat); m.name = 'Lettering_CHANGAN';
      model.attach('tailgate', m);
    }
    const badge = probe.patch((u, v) => probe.rear(lerp(-0.44, -0.6, u), lerp(0.80, 0.83, v)), 8, 1, 0.0025);
    if (badge) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xe8ebef, metalness: 1, roughness: 0.2, alphaMap: labelTexture('UNI-Z', { w: 512, h: 96, font: 'italic 700 78px Arial, sans-serif', fg: '#fff', spacing: 8 }), transparent: true, depthWrite: false });
      mat.name = 'badge_uniz';
      const m = new THREE.Mesh(badge, mat); m.name = 'Badge_UNIZ';
      model.attach('tailgate', m);
    }
    out.plateRear = plate(opts.plate || 'RU', out.plateRearHit, model.pivots.tailgate.userData.inner, 'Plate_Rear');
    const a = probe.top(0, sToZ(4585)), b = probe.top(0.28, sToZ(4520));
    if (a && b) {
      const pa = a.point.clone().addScaledVector(a.normal, 0.012), pb = b.point.clone().addScaledVector(b.normal, 0.012);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.01, pa.distanceTo(pb)), M.trim_black);
      m.position.copy(pa).add(pb).multiplyScalar(0.5); m.lookAt(pb); m.name = 'RearWiper';
      model.attach('tailgate', m);
    }
  }

  // ---------------------------------------------------------------- fuel / charge doors (outlines on the fenders)
  const flap = (sign, s, h, w, hh, name) => {
    const g = probe.patch((u, v) => probe.side(sign, sToZ(s + (u - 0.5) * w * 1000), h + (v - 0.5) * hh), 10, 6, 0.0018);
    const ring = probe.patch((u, v) => probe.side(sign, sToZ(s + (u - 0.5) * (w + 0.008) * 1000), h + (v - 0.5) * (hh + 0.008)), 10, 6, 0.0012);
    if (!g || !ring) return;
    const grp = new THREE.Group(); grp.name = name;
    grp.add(new THREE.Mesh(ring, M.jamb), new THREE.Mesh(g, M.paint));
    body.add(grp);
    return grp;
  };
  out.fuelDoor = flap(-1, 4150, 1.0, 0.17, 0.12, 'FuelDoor');
  out.chargeDoor = flap(1, 1250, 0.95, 0.15, 0.11, 'ChargeDoor');

  // ---------------------------------------------------------------- engine bay (visible with the hood open)
  {
    const grp = new THREE.Group(); grp.name = 'EngineBay';
    const cover = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.07, 0.42, 4, 0.025), M.piano);
    cover.position.set(0.02, 0, sToZ(820));
    const strut = (x) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.04, 20), M.metal_dark); c.position.set(x, 0, sToZ(980)); return c; };
    const battery = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.12, 0.17, 2, 0.01), M.trim_black); battery.position.set(-0.46, 0, sToZ(560));
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 18), M.plastic_light); tank.position.set(0.47, 0, sToZ(520));
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.04, 0.05), M.trim_black); bar.position.set(0, 0, sToZ(260));
    grp.add(cover, strut(0.56), strut(-0.56), battery, tank, bar);
    // the bay floor is the engine cavity's lower skin (see BodyShell.engineCavityGeometry): rest every part on it
    for (const c of grp.children) {
      const box = new THREE.Box3().setFromObject(c);
      c.position.y = engineBayFloorY(zToS(c.position.z)) + (box.max.y - box.min.y) / 2 + 0.004;
    }
    body.add(grp);
  }

  return out;
}

// Loft through closed cross-sections (arrays of Vector3 with equal counts), capped at both ends
export function loftSections(sections) {
  const n = sections[0].length, pos = [], idx = [];
  for (const sec of sections) for (const p of sec) pos.push(p.x, p.y, p.z);
  for (let i = 0; i < sections.length - 1; i++) for (let j = 0; j < n; j++) {
    const a = i * n + j, b = i * n + ((j + 1) % n), c = (i + 1) * n + j, d = (i + 1) * n + ((j + 1) % n);
    idx.push(a, c, b, b, c, d);
  }
  const capC = (sec, base, flip) => {
    const ci = pos.length / 3, c = new THREE.Vector3();
    sec.forEach((p) => c.add(p)); c.multiplyScalar(1 / n);
    pos.push(c.x, c.y, c.z);
    for (let j = 0; j < n; j++) { const a = base + j, b = base + ((j + 1) % n); if (flip) idx.push(ci, b, a); else idx.push(ci, a, b); }
  };
  capC(sections[0], 0, false);
  capC(sections[sections.length - 1], (sections.length - 1) * n, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // ensure outward winding using the signed volume
  let vol = 0; const P = pos, I = idx;
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
    vol += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  if (vol < 0) { for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; } g.setIndex(I); g.computeVertexNormals(); }
  return g;
}

// Engine bay floor height (m) at station s, mirroring engineCavityGeometry's section rule
export function engineBayFloorY(s) {
  const c = CAVITIES.engine;
  const ht = tableAt(LOWER, s, 1), hwm = tableAt(LOWER, s, 4);
  const top = ht - c.skin, hW = Math.min(hwm - 30, top - 40);
  return Math.min(hW - 60, top - c.depth) / 1000;
}
