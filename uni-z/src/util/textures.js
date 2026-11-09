import * as THREE from 'three';
import { mulberry32, makeNoise2D, clamp } from './math.js';

// All textures are generated in code (no external images).

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function canvasTexture(c, { repeat = [1, 1], srgb = false, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// Height field (Float32Array, 0..1) → tangent-space normal map
export function heightToNormalTexture(height, w, h, strength = 2, opts = {}) {
  const c = makeCanvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
  const at = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(c, opts);
}

// Metallic flake: per-cell random micro normals
export function flakeNormal(size = 512, seed = 7) {
  const rnd = mulberry32(seed);
  const c = makeCanvas(size, size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 2) * 0.9;
    const nx = Math.cos(a) * r, ny = Math.sin(a) * r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    img.data[i * 4] = (nx * 0.5 + 0.5) * 255; img.data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255; img.data[i * 4 + 2] = (nz * 0.5 + 0.5) * 255; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = canvasTexture(c, { repeat: [30, 30] });
  t.magFilter = THREE.NearestFilter;
  return t;
}

// Fine plastic / leather grain
export function grainNormal(size = 256, scale = 24, seed = 3, strength = 1.5) {
  const n = makeNoise2D(seed), hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x / size) * scale, v = (y / size) * scale;
    hgt[y * size + x] = 0.5 + 0.35 * n(u, v) + 0.15 * n(u * 3.1, v * 3.1);
  }
  return heightToNormalTexture(hgt, size, size, strength, { repeat: [6, 6] });
}

// Tyre tread: circumferential grooves + sipes, U along circumference
export function treadNormal() {
  const w = 1024, h = 128, hgt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = y / h;
      let d = 1;
      for (const g of [0.22, 0.42, 0.58, 0.78]) d = Math.min(d, Math.abs(v - g) / 0.025);
      let groove = d < 1 ? 0 : 1;
      const block = (x + (v > 0.5 ? 9 : 0)) % 32;
      const sipe = Math.abs(((x + v * 60) % 32) - 16) < 1.2 && v > 0.08 && v < 0.92 ? 0.4 : 1;
      const shoulder = (v < 0.12 || v > 0.88) && block < 3 ? 0.2 : 1;
      hgt[y * w + x] = groove * sipe * shoulder;
    }
  }
  return heightToNormalTexture(hgt, w, h, 6, { repeat: [3, 1] });
}

// Sidewall lettering (generic, no brand) as a normal map. U along circumference.
export function sidewallNormal(label) {
  const w = 2048, h = 128, c = makeCanvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 54px Arial, sans-serif'; ctx.textBaseline = 'middle';
  ctx.fillText(label, 120, h / 2); ctx.fillText(label, 1144, h / 2);
  ctx.font = 'bold 30px Arial, sans-serif';
  ctx.fillText('TUBELESS  RADIAL', 560, h / 2); ctx.fillText('M+S  XL', 1600, h / 2);
  const d = ctx.getImageData(0, 0, w, h).data, hgt = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hgt[i] = d[i * 4] / 255;
  return heightToNormalTexture(hgt, w, h, 2.5, { repeat: [1, 1] });
}

export function asphaltTextures(seed = 11) {
  const size = 512, rnd = mulberry32(seed), n = makeNoise2D(seed);
  const c = makeCanvas(size, size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, big = n(x / 64, y / 64) * 0.5 + n(x / 13, y / 13) * 0.25;
    const grain = rnd();
    const v = 52 + big * 14 + (grain > 0.92 ? 30 : grain * 10);
    img.data[i * 4] = v; img.data[i * 4 + 1] = v + 1; img.data[i * 4 + 2] = v + 3; img.data[i * 4 + 3] = 255;
    hgt[i] = grain * 0.6 + big * 0.4;
  }
  ctx.putImageData(img, 0, 0);
  return { map: canvasTexture(c, { srgb: true, repeat: [1, 1] }), normalMap: heightToNormalTexture(hgt, size, size, 1.2) };
}

export function groundTexture(kind, seed = 5) {
  const size = 512, rnd = mulberry32(seed), n = makeNoise2D(seed);
  const c = makeCanvas(size, size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  const base = { grass: [62, 92, 46], gravel: [128, 120, 108], snow: [228, 234, 240], dirt: [104, 86, 64], ice: [196, 214, 228], concrete: [150, 150, 146] }[kind];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, f = n(x / 40, y / 40) * 0.6 + n(x / 9, y / 9) * 0.3 + (rnd() - 0.5) * (kind === 'gravel' ? 0.9 : 0.35);
    const k = 1 + f * (kind === 'snow' || kind === 'ice' ? 0.05 : 0.18);
    img.data[i] = clamp(base[0] * k, 0, 255); img.data[i + 1] = clamp(base[1] * k, 0, 255); img.data[i + 2] = clamp(base[2] * k, 0, 255); img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(c, { srgb: true });
}

// Radial/trapezoid dark fade for the borderless grille
export function grilleFadeTexture() {
  const w = 512, h = 256, c = makeCanvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / (w - 1), v = y / (h - 1);
    const halfW = 0.5 * (0.68 + 0.32 * (1 - v)); // inverted trapezoid
    const dx = Math.abs(u - 0.5) / halfW, edge = Math.max(dx, Math.abs(v - 0.5) * 2);
    const a = clamp((1 - edge) / 0.35, 0, 1);
    const i = (y * w + x) * 4;
    img.data[i] = 6; img.data[i + 1] = 7; img.data[i + 2] = 9; img.data[i + 3] = a * a * 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = canvasTexture(c, { srgb: true });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Dotted ceramic frit gradient for glass edges (alpha), v = 0 at the edge
export function fritTexture() {
  const w = 64, h = 64, c = makeCanvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const r = Math.max(0, 3.8 * (1 - y / 6));
    ctx.beginPath(); ctx.arc(x * 8 + 4, y * 8 + 4, r, 0, Math.PI * 2); ctx.fill();
  }
  return canvasTexture(c);
}

// Text label texture (plates, lettering, badges)
export function labelTexture(text, { w = 1024, h = 256, font = 'bold 150px Arial, sans-serif', fg = '#111', bg = null, border = null, spacing = 0, align = 'center' } = {}) {
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = h * 0.05; ctx.strokeRect(h * 0.04, h * 0.04, w - h * 0.08, h - h * 0.08); }
  ctx.fillStyle = fg; ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = align;
  if (spacing) { try { ctx.letterSpacing = `${spacing}px`; } catch (e) { /* older canvas */ } }
  ctx.fillText(text, align === 'center' ? w / 2 : h * 0.3, h / 2 + h * 0.03);
  const t = canvasTexture(c, { srgb: true });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function plateTexture(format) {
  if (format === 'CN') {
    const t = labelTexture('UNI·Z 2026', { w: 880, h: 280, font: 'bold 150px Arial, sans-serif', fg: '#ffffff', bg: '#1d4fb5', border: '#ffffff', spacing: 6 });
    return t;
  }
  // RU-style white plate with a region box; demo text, not a registration number
  const w = 1040, h = 224, c = makeCanvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f4f2'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 8; ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.beginPath(); ctx.moveTo(800, 6); ctx.lineTo(800, h - 6); ctx.stroke();
  ctx.fillStyle = '#111'; ctx.font = 'bold 150px Arial, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillText('UNI·Z', 400, h / 2 + 8);
  ctx.font = 'bold 96px Arial, sans-serif'; ctx.fillText('26', 920, h / 2 - 18);
  ctx.font = 'bold 30px Arial, sans-serif'; ctx.fillText('DEMO', 920, h / 2 + 62);
  const t = canvasTexture(c, { srgb: true });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Headlight beam cookie: bright below a horizontal cut-off with a step-up on the right (right-hand traffic)
export function beamCookie(high = false) {
  const s = 256, c = makeCanvas(s, s), ctx = c.getContext('2d'), img = ctx.createImageData(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const u = x / s - 0.5, v = 0.5 - y / s;
    const r = Math.hypot(u, v) * 2;
    const cut = high ? 0.25 : (u > 0.04 ? 0.04 + (u - 0.04) * 0.25 : 0.0);
    let k = v < cut ? 1 : Math.max(0, 1 - (v - cut) * (high ? 4 : 28));
    k *= clamp(1.15 - r, 0, 1);
    const i = (y * s + x) * 4, val = clamp(k * 255, 0, 255);
    img.data[i] = val; img.data[i + 1] = val; img.data[i + 2] = val * 0.96; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = canvasTexture(c, { srgb: true });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function carpetNormal() { return grainNormal(256, 90, 21, 2.5); }
export function leatherNormal() { return grainNormal(256, 40, 13, 1.2); }

// Perforated fabric / stitched panel pattern for seat inserts
export function seatInsertNormal() {
  const w = 256, h = 256, hgt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x % 16, sy = y % 16;
    const perf = Math.hypot(sx - 8, sy - 8) < 2 ? 0 : 1;
    const seam = (y % 64) < 2 ? 0.3 : 1;
    hgt[y * w + x] = perf * seam;
  }
  return heightToNormalTexture(hgt, w, h, 2, { repeat: [3, 3] });
}
