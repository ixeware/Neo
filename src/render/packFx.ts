// The admin's ultimate «Курение убивает» on the map: the parody pack drops out of the sky onto the
// crowd, bounces, stands there with its radius drawn on the ground until the sim says it is gone,
// then shrinks away. It follows st.packs (so a reload or a resumed game shows the packs that are
// still lying there) and the FxEv 'pack' only adds the drop and the landing. Reads the sim only.
import * as THREE from 'three';
import { cigPack, type CigPack } from './props';
import { drapedRing } from './world';
import { PAL } from './models';
import { heightY, type Terrain } from '../world/terrain';
import type { Pack, State } from '../sim/sim';
import type { Particles } from './fx';
import type { Stage } from './scene';

interface Live {
  key: string; p: Pack; pack: CigPack; ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial; fill: THREE.Mesh;
  /** wall-clock seconds: drop start (−1 = was already lying there), landed, shrink start */
  t0: number; landed: boolean; gone: number; ry: number; jit: number; y: number;
}

const DROP_H = 24, DROP_T = 0.5, SHRINK_T = 0.45;
const keyOf = (p: Pack) => `${p.s}:${p.id}:${p.at}`;

/** Head-and-shoulders crop of a full-figure portrait (transparent PNG): the top of its opaque box. */
function headCrop(img: HTMLImageElement): HTMLCanvasElement {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  try {
    const d = g.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  } catch { x0 = 0; x1 = w - 1; y0 = 0; y1 = h - 1; }
  if (x1 <= x0 || y1 <= y0) return c;
  const bh = (y1 - y0) * 0.52, bw = Math.min(x1 - x0, bh * 1.25), cx = (x0 + x1) / 2;
  const out = document.createElement('canvas');
  out.width = Math.round(bw * 2); out.height = Math.round(bh * 2);
  out.getContext('2d')!.drawImage(c, cx - bw / 2, y0, bw, bh, 0, 0, out.width, out.height);
  return out;
}

function toCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
}

export class PackView {
  private group = new THREE.Group();
  private live = new Map<string, Live>();
  private pool: CigPack[][] = [[], []];
  private portrait: (HTMLCanvasElement | null)[] = [null, null];
  private spicy: boolean;
  private low: boolean;
  private time = performance.now() / 1000;
  /** packs the 'pack' event announced since the last sync: drop these from the sky */
  private fresh: { s: number; id: number; x: number; z: number }[] = [];

  constructor(parent: THREE.Object3D, private t: Terrain, private stage: Stage, private particles: Particles, adminPortraits: (string | undefined)[], spicy: boolean) {
    parent.add(this.group);
    this.spicy = spicy;
    this.low = stage.lowPower;
    adminPortraits.forEach((src, s) => {
      if (!src) return;
      const img = new Image();
      img.onload = () => {
        // the small card portrait shows the whole figure: crop it to the head; the passport-style one is ready as is
        this.portrait[s] = (img.naturalWidth || img.width) < 240 ? headCrop(img) : toCanvas(img);
        for (const p of this.pool[s]) p.setPortrait(this.portrait[s]);
        for (const l of this.live.values()) if (l.p.s === s) l.pack.setPortrait(this.portrait[s]);
      };
      img.src = src;
    });
  }

  setSpicy(on: boolean) {
    if (this.spicy === on) return;
    this.spicy = on;
    for (const side of this.pool) for (const p of side) p.setSpicy(on);
    for (const l of this.live.values()) l.pack.setSpicy(on);
  }

  /** FxEv 'pack': the next sync drops this one from the sky. */
  onPack(e: { s: number; id: number; x: number; z: number }) {
    this.fresh.push({ s: e.s, id: e.id, x: e.x, z: e.z });
  }

  private take(s: 0 | 1): CigPack {
    const p = this.pool[s].pop() ?? cigPack({ spicy: this.spicy, portrait: this.portrait[s] });
    p.setSpicy(this.spicy);
    if (this.low) p.group.traverse(o => { o.castShadow = false; });
    p.group.visible = true;
    this.group.add(p.group);
    return p;
  }

  private release(l: Live) {
    l.pack.group.removeFromParent();
    this.pool[l.p.s].push(l.pack);
    l.ring.removeFromParent(); l.ring.geometry.dispose(); l.ringMat.dispose();
    l.fill.removeFromParent(); l.fill.geometry.dispose();
    this.live.delete(l.key);
  }

  private start(p: Pack, drop: boolean) {
    const s = (p.s === 1 ? 1 : 0) as 0 | 1;
    const pack = this.take(s);
    const ringMat = new THREE.MeshBasicMaterial({ color: PAL.side[s], transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const ring = new THREE.Mesh(drapedRing(this.t, p.x, p.z, p.r, 0.38, this.low ? 48 : 80), ringMat);
    ring.renderOrder = 3; ring.frustumCulled = false;
    // a faint smoky disc inside the radius
    const fill = new THREE.Mesh(drapedRing(this.t, p.x, p.z, p.r * 0.5, p.r, this.low ? 32 : 56), new THREE.MeshBasicMaterial({ color: '#8c8f86', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    fill.renderOrder = 2; fill.frustumCulled = false;
    this.group.add(ring, fill);
    const y = heightY(this.t, p.x, p.z) - 0.05;
    // face the camera as it is now (the face is on +z), with a little tilt so it reads as dropped
    const jit = (((p.id * 7919) % 100) / 100 - 0.5) * 0.5, ry = this.stage.yaw + jit;
    const l: Live = { key: keyOf(p), p, pack, ring, ringMat, fill, t0: drop ? this.time : -1, landed: !drop, gone: -1, ry, jit, y };
    pack.group.position.set(p.x, drop ? y + DROP_H : y, p.z);
    pack.group.rotation.set(0, ry, 0);
    pack.group.scale.setScalar(1);
    this.live.set(l.key, l);
  }

  private land(l: Live) {
    l.landed = true;
    const { x, z } = l.p, y = l.y;
    const tg = this.stage.target, d = Math.hypot(tg.x - x, tg.z - z);
    if (d < 60 && this.stage.dist < 170) this.stage.shake(0.32 * (1 - d / 60) + 0.08);
    if (d < 110) {
      const k = this.low ? 0.5 : 1;
      this.particles.emit(x, y + 0.2, z, { n: Math.round(18 * k), color: '#d9cdb4', size: 0.8, life: 0.9, spread: 3.2, up: 0.7, grav: 0.3, grow: 0.9, jitter: 1.2 });
      this.particles.emit(x, y + 1.5, z, { n: Math.round(14 * k), color: '#a9a69d', size: 0.6, life: 1.6, spread: 2.2, up: 0.6, grav: -0.2, grow: 1.1, wob: 0.6, jitter: 1.5 });
    }
  }

  /** Every frame: follow st.packs, animate drops, bounces and the shrink. */
  update(dt: number, st: State) {
    // wall clock, like the sim's ticks: a slow frame rate must not stretch the drop past the pack's life
    this.time = performance.now() / 1000;
    const now = this.time;
    const seen = new Set<string>();
    for (const p of st.packs) {
      const k = keyOf(p);
      seen.add(k);
      const l = this.live.get(k);
      if (!l) this.start(p, st.tick - p.at <= 3 || this.fresh.some(f => f.s === p.s && f.id === p.id && Math.abs(f.x - p.x) + Math.abs(f.z - p.z) < 1e-3));
      else if (l.gone >= 0) { l.gone = -1; l.pack.group.scale.setScalar(1); } // came back (rewind)
    }
    this.fresh.length = 0;
    for (const l of this.live.values()) {
      if (!seen.has(l.key) && l.gone < 0) l.gone = now;
      const g = l.pack.group;
      let alpha = 1;
      if (l.gone >= 0) {
        const f = (now - l.gone) / SHRINK_T;
        if (f >= 1) { this.release(l); continue; }
        const k = Math.max(0.01, 1 - f * f);
        g.scale.set(k, k, k);
        g.rotation.y = l.ry + f * 2.5;
        g.position.y = l.y + f * 0.6;
        alpha = 1 - f;
      } else if (!l.landed) {
        const f = Math.min(1, (now - l.t0) / DROP_T);
        g.position.y = l.y + DROP_H * (1 - f * f);
        g.rotation.set(Math.sin(f * 9) * 0.25 * (1 - f), l.ry + (1 - f) * 1.4, Math.cos(f * 7) * 0.2 * (1 - f));
        alpha = f;
        if (f >= 1) { g.rotation.set(0, l.ry, 0); this.land(l); l.t0 = now; }
      } else if (l.t0 >= 0) {
        // two little bounces and a squash, then stand still
        const a = now - l.t0;
        if (a < 0.9) {
          const b = Math.abs(Math.sin(a * Math.PI / 0.3)) * Math.exp(-a * 5) * 1.1;
          g.position.y = l.y + b;
          const sq = a < 0.08 ? 1 - (0.08 - a) * 3 : 1;
          g.scale.set(1 + (1 - sq) * 0.5, sq, 1 + (1 - sq) * 0.5);
          g.rotation.z = Math.sin(a * 14) * 0.06 * Math.exp(-a * 4);
          g.rotation.y = l.ry;
        } else { g.position.y = l.y; g.scale.setScalar(1); g.rotation.z = 0; l.t0 = -1; }
      }
      // keep the face (+z) turned to the camera, slowly, so the admin's photo stays readable
      if (l.gone < 0) {
        let d = this.stage.yaw + l.jit - l.ry;
        while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
        l.ry += d * Math.min(1, dt * 1.5);
        if (l.landed && l.t0 < 0) g.rotation.y = l.ry;
      }
      // the radius: pulses gently while the pack lies there
      const ra = l.landed ? 0.55 + Math.sin(now * 3.2) * 0.2 : 0;
      l.ringMat.opacity = ra * alpha;
      (l.fill.material as THREE.MeshBasicMaterial).opacity = (l.landed ? 0.16 : 0) * alpha;
    }
  }

  clear() { for (const l of [...this.live.values()]) this.release(l); this.fresh.length = 0; }
}
