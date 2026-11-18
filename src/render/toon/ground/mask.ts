// The ground paint of the toon style: four signed distance fields over the whole map in one small texture,
// drawn by the land shader (landMat.ts) as crisp flat shapes that follow the relief exactly — plazas, paths
// and house yards (R), bare earth and river gravel (G), garden lawns (B), vegetable plots (A). No geometry,
// no draw calls: the phone tier gets the same ground as the desktop.
// A texel holds 128 + distance × SCALE (inside a shape < 128). Shapes are stamped with min(), so a channel is
// the union of everything stamped into it; `cut` takes a shape back out.
import * as THREE from 'three';

/** Distance range kept on each side of an outline (world units). */
export const MASK_RANGE = 1.2;
const SCALE = 127 / MASK_RANGE;

export const CH = { PAVE: 0, EARTH: 1, LAWN: 2, PLOT: 3 } as const;

export class GroundMask {
  readonly w: number; readonly h: number; readonly data: Uint8Array;
  /** Texels per world unit. */
  readonly k: number;
  private tex: THREE.DataTexture | null = null;

  constructor(readonly W: number, readonly z0: number, readonly H: number, texW: number) {
    this.k = texW / W;
    this.w = texW; this.h = Math.ceil((H - z0) * this.k);
    this.data = new Uint8Array(this.w * this.h * 4).fill(255);
  }

  /** Stamp (or cut) every texel of the box around a shape; `sd` is the shape's signed distance. */
  private stamp(ch: number, x0: number, z0: number, x1: number, z1: number, sd: (x: number, z: number) => number, cut = false) {
    const k = this.k, pad = MASK_RANGE;
    const i0 = Math.max(0, Math.floor((x0 - pad) * k)), i1 = Math.min(this.w - 1, Math.ceil((x1 + pad) * k));
    const j0 = Math.max(0, Math.floor((z0 - pad - this.z0) * k)), j1 = Math.min(this.h - 1, Math.ceil((z1 + pad - this.z0) * k));
    const d = this.data;
    for (let j = j0; j <= j1; j++) {
      const z = (j + 0.5) / k + this.z0;
      for (let i = i0; i <= i1; i++) {
        const v = sd((i + 0.5) / k, z) * SCALE, o = (j * this.w + i) * 4 + ch;
        if (cut) { const c = 128 - v; if (c > d[o]) d[o] = c > 255 ? 255 : c; }
        else { const c = 128 + v; if (c < d[o]) d[o] = c < 0 ? 0 : c; }
      }
    }
  }

  disc(ch: number, x: number, z: number, r: number, cut = false) {
    this.stamp(ch, x - r, z - r, x + r, z + r, (px, pz) => Math.hypot(px - x, pz - z) - r, cut);
  }
  /** A ring of radius r and half-width hw. */
  ring(ch: number, x: number, z: number, r: number, hw: number) {
    this.stamp(ch, x - r - hw, z - r - hw, x + r + hw, z + r + hw, (px, pz) => Math.abs(Math.hypot(px - x, pz - z) - r) - hw);
  }
  /** A capsule: the segment a–b widened by hw. */
  seg(ch: number, ax: number, az: number, bx: number, bz: number, hw: number, cut = false) {
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
    this.stamp(ch, Math.min(ax, bx) - hw, Math.min(az, bz) - hw, Math.max(ax, bx) + hw, Math.max(az, bz) + hw, (px, pz) => {
      const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
      return Math.hypot(ax + dx * t - px, az + dz * t - pz) - hw;
    }, cut);
  }
  /** An oriented rectangle (rotation.y = ry, half sizes hx × hz) with corners rounded by `round`. */
  rect(ch: number, x: number, z: number, hx: number, hz: number, ry = 0, round = 0, cut = false) {
    const c = Math.cos(ry), s = Math.sin(ry), R = Math.hypot(hx, hz);
    const ix = hx - round, iz = hz - round;
    this.stamp(ch, x - R, z - R, x + R, z + R, (px, pz) => {
      const dx = px - x, dz = pz - z;
      const qx = Math.abs(dx * c - dz * s) - ix, qz = Math.abs(dx * s + dz * c) - iz;
      return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - round;
    }, cut);
  }

  /** Signed distance of channel `ch` at a world point (nearest texel; ±MASK_RANGE at most). */
  at(ch: number, x: number, z: number): number {
    const i = Math.max(0, Math.min(this.w - 1, Math.floor(x * this.k))), j = Math.max(0, Math.min(this.h - 1, Math.floor((z - this.z0) * this.k)));
    return (this.data[(j * this.w + i) * 4 + ch] - 128) / SCALE;
  }

  get texture(): THREE.DataTexture {
    if (!this.tex) {
      const t = new THREE.DataTexture(this.data, this.w, this.h, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.colorSpace = THREE.NoColorSpace;
      t.needsUpdate = true;
      this.tex = t;
    }
    return this.tex;
  }
  /** After stamping: upload again. */
  flush() { if (this.tex) this.tex.needsUpdate = true; }
  /** uv = xz × (sx, sz) + (ox, oz). */
  get transform(): [number, number, number, number] { return [1 / this.W, 1 / (this.H - this.z0), 0, -this.z0 / (this.H - this.z0)]; }
}
