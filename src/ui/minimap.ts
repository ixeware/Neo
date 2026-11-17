// Minimap: the low-poly map from above, villages, every unit as a pen dot, and the camera footprint.
import type { Sim } from '../sim/sim';
import { UNITS } from '../sim/defs';
import type { Stage } from '../render/scene';
import type { Terrain } from '../world/terrain';
import { paintRoads } from '../render/roads';
import { drawPerkGlyph } from '../render/placeMarks';

const PEN = ['#2a52d1', '#d8361f'];
const IS_HERO = UNITS.map(d => !!d.hero);

/** A ready image, or a painter that draws the base map at the minimap's exact pixel size. */
export type MinimapBase = HTMLCanvasElement | ((g: CanvasRenderingContext2D, w: number, h: number) => void);

export class Minimap {
  private g: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private last = 0;
  constructor(private c: HTMLCanvasElement, map: MinimapBase, private t: Terrain, private sim: Sim, private stage: Stage) {
    this.g = c.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = c.width; this.base.height = c.height;
    const bg = this.base.getContext('2d')!;
    if (typeof map === 'function') map(bg, c.width, c.height);
    else { bg.imageSmoothingQuality = 'high'; bg.drawImage(map, 0, 0, c.width, c.height); }
    paintRoads(bg, c.width, c.height); // real roads and streets, thin, on the base image
    const move = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * t.W, z = t.z0 + ((e.clientY - r.top) / r.height) * (t.H - t.z0);
      stage.flyTo(x, z, stage.dist, 400);
    };
    let down = false;
    c.addEventListener('pointerdown', e => { e.stopPropagation(); down = true; c.setPointerCapture(e.pointerId); move(e); });
    c.addEventListener('pointermove', e => { if (down) move(e); });
    c.addEventListener('pointerup', () => { down = false; });
  }

  draw(now: number) {
    if (now - this.last < 150) return;
    this.last = now;
    // the whole map, z0..H (v4: it reaches north to Grozny); oz shifts world z to the canvas top
    const g = this.g, W = this.c.width, H = this.c.height, sx = W / this.t.W, sz = H / (this.t.H - this.t.z0), oz = -this.t.z0 * sz;
    g.drawImage(this.base, 0, 0);
    const st = this.sim.st;
    for (const p of st.pts) {
      if (p.kind === 2) { this.kiosk(p.x * sx, p.z * sz + oz, p.owner); continue; }
      if (p.kind === 3) { this.place(p.x * sx, p.z * sz + oz, p.owner, p.perk ?? ''); continue; } // v3 capture places
      const r = p.kind === 0 ? 11 : 8;
      g.lineWidth = 3;
      g.strokeStyle = p.owner >= 0 ? PEN[p.owner] : '#f4f6f8';
      g.fillStyle = p.owner >= 0 ? PEN[p.owner] + '55' : 'rgba(244,246,248,.35)';
      g.beginPath();
      if (p.kind === 0) g.rect(p.x * sx - r, p.z * sz + oz - r, r * 2, r * 2); else g.arc(p.x * sx, p.z * sz + oz, r, 0, Math.PI * 2);
      g.fill(); g.stroke();
    }
    const heroes: number[] = [];
    for (let i = 0; i < st.units.length; i++) {
      const u = st.units[i];
      if (u.t === 5 || IS_HERO[u.t]) { heroes.push(i); continue; }
      g.fillStyle = PEN[u.s];
      const s = u.t === 13 ? 6 : 4;
      g.fillRect(u.x * sx - s / 2, u.z * sz + oz - s / 2, s, s);
    }
    // heroes and bosses on top: bigger dot with a paper ring
    g.lineWidth = 2; g.strokeStyle = '#f4f6f8';
    for (const i of heroes) {
      const u = st.units[i], r = u.t === 5 ? 6 : 4.2;
      g.fillStyle = PEN[u.s];
      g.beginPath(); g.arc(u.x * sx, u.z * sz + oz, r, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // camera footprint
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
      const r = this.stage.canvas.getBoundingClientRect();
      return this.stage.pick(r.left + u * r.width, r.top + v * r.height * 0.98 + (v ? 0 : r.height * 0.12));
    });
    g.strokeStyle = '#23262b'; g.lineWidth = 2.5;
    if (corners.every(c => c)) {
      g.beginPath();
      corners.forEach((c, i) => (i ? g.lineTo(c!.x * sx, c!.z * sz + oz) : g.moveTo(c!.x * sx, c!.z * sz + oz)));
      g.closePath(); g.stroke();
    } else {
      const tg = this.stage.target, s = this.stage.dist * 0.6;
      g.strokeRect((tg.x - s) * sx, (tg.z - s * 0.6) * sz + oz, s * 2 * sx, s * 1.2 * sz);
    }
  }

  /** v3 capture place: a small square in the owner's ink with the perk drawn in it. */
  private place(x: number, y: number, owner: number, perk: string) {
    const g = this.g, r = 9;
    g.lineWidth = 2.5; g.strokeStyle = '#23262b';
    g.fillStyle = owner >= 0 ? PEN[owner] : '#f4f6f8';
    g.beginPath(); g.rect(x - r, y - r, r * 2, r * 2); g.fill(); g.stroke();
    drawPerkGlyph(g, perk, x, y + 0.5, r * 1.7, owner >= 0 ? '#f4f6f8' : '#23262b');
  }

  /** Донер Бей: a little doner spit (meat cone on a skewer) in the owner's ink. */
  private kiosk(x: number, y: number, owner: number) {
    const g = this.g;
    g.lineWidth = 2.5; g.strokeStyle = '#23262b';
    g.beginPath(); g.moveTo(x, y - 15); g.lineTo(x, y + 14); g.stroke();
    g.fillStyle = owner >= 0 ? PEN[owner] : '#c9853f';
    g.beginPath();
    g.moveTo(x - 8, y - 10); g.lineTo(x + 8, y - 10); g.lineTo(x + 4, y + 9); g.lineTo(x - 4, y + 9); g.closePath();
    g.fill(); g.stroke();
    g.strokeStyle = 'rgba(244,246,248,.8)'; g.lineWidth = 1.5;
    for (const k of [-4, 1, 6]) { g.beginPath(); g.moveTo(x - 7 + (k + 10) * 0.2, y + k); g.lineTo(x + 7 - (k + 10) * 0.2, y + k); g.stroke(); }
  }
}
