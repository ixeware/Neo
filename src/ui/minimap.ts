// Minimap: the painted relief, villages, every unit as a pen dot, and the camera footprint.
import type { Sim } from '../sim/sim';
import type { Stage } from '../render/scene';
import type { Terrain } from '../world/terrain';

const PEN = ['#2a52d1', '#d8361f'];

export class Minimap {
  private g: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private last = 0;
  constructor(private c: HTMLCanvasElement, map: HTMLCanvasElement, private t: Terrain, private sim: Sim, private stage: Stage) {
    this.g = c.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = c.width; this.base.height = c.height;
    const bg = this.base.getContext('2d')!;
    bg.imageSmoothingQuality = 'high';
    bg.drawImage(map, 0, 0, c.width, c.height);
    const move = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * t.W, z = ((e.clientY - r.top) / r.height) * t.H;
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
    const g = this.g, W = this.c.width, H = this.c.height, sx = W / this.t.W, sz = H / this.t.H;
    g.drawImage(this.base, 0, 0);
    const st = this.sim.st;
    for (const p of st.pts) {
      const r = p.kind === 0 ? 11 : 8;
      g.lineWidth = 3;
      g.strokeStyle = p.owner >= 0 ? PEN[p.owner] : '#f4f6f8';
      g.fillStyle = p.owner >= 0 ? PEN[p.owner] + '55' : 'rgba(244,246,248,.35)';
      g.beginPath();
      if (p.kind === 0) g.rect(p.x * sx - r, p.z * sz - r, r * 2, r * 2); else g.arc(p.x * sx, p.z * sz, r, 0, Math.PI * 2);
      g.fill(); g.stroke();
    }
    for (const u of st.units) {
      g.fillStyle = PEN[u.s];
      const s = u.t === 5 ? 9 : 4;
      g.fillRect(u.x * sx - s / 2, u.z * sz - s / 2, s, s);
    }
    // camera footprint
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
      const r = this.stage.canvas.getBoundingClientRect();
      return this.stage.pick(r.left + u * r.width, r.top + v * r.height * 0.98 + (v ? 0 : r.height * 0.12));
    });
    g.strokeStyle = '#23262b'; g.lineWidth = 2.5;
    if (corners.every(c => c)) {
      g.beginPath();
      corners.forEach((c, i) => (i ? g.lineTo(c!.x * sx, c!.z * sz) : g.moveTo(c!.x * sx, c!.z * sz)));
      g.closePath(); g.stroke();
    } else {
      const tg = this.stage.target, s = this.stage.dist * 0.6;
      g.strokeRect((tg.x - s) * sx, (tg.z - s * 0.6) * sz, s * 2 * sx, s * 1.2 * sz);
    }
  }
}
