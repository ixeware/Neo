// Map labels (villages, high-rises, bosses) as DOM pinned to 3D points.
import { heightY, type Terrain } from '../world/terrain';
import { SIDE_TAG, VILLAGE_NOTE } from '../data/lore';
import type { Sim } from '../sim/sim';
import type { Stage } from '../render/scene';
import type { HqBuilding } from '../render/world';
import type { UnitView } from '../render/units';

interface L { el: HTMLElement; x: number; y: number; z: number; kind: 'v' | 'hq' | 'boss' | 'note'; idx: number; nm?: HTMLElement; sub?: HTMLElement }

export class Labels {
  private list: L[] = [];
  private tmp = { x: 0, y: 0, vis: false };
  constructor(root: HTMLElement, t: Terrain, private sim: Sim, private stage: Stage, private hqs: HqBuilding[], private units: UnitView) {
    root.innerHTML = '';
    sim.st.pts.forEach((p, i) => {
      if (p.kind === 0) {
        const el = document.createElement('div');
        el.className = `lbl lbl-hq s${p.side}`;
        el.innerHTML = `<div class="nm">${SIDE_TAG[p.side as 0 | 1].hq}</div><div class="fl"></div>`;
        root.append(el);
        this.list.push({ el, x: p.x, y: 0, z: p.z, kind: 'hq', idx: i, sub: el.querySelector('.fl') as HTMLElement });
      } else {
        const el = document.createElement('div');
        el.className = 'lbl lbl-v';
        el.innerHTML = `<div class="nm">${p.name}</div><div class="sub">${VILLAGE_NOTE[p.key] ?? ''}</div>`;
        root.append(el);
        this.list.push({ el, x: p.x, y: heightY(t, p.x, p.z) + 3.4, z: p.z, kind: 'v', idx: i, nm: el.querySelector('.nm') as HTMLElement });
      }
    });
    for (const s of [0, 1]) {
      const el = document.createElement('div');
      el.className = 'lbl lbl-boss';
      el.innerHTML = `<div class="nm">${SIDE_TAG[s].boss}</div>`;
      root.append(el);
      this.list.push({ el, x: 0, y: 0, z: 0, kind: 'boss', idx: s });
    }
    const note = document.createElement('div');
    note.className = 'lbl lbl-note';
    note.textContent = '4-й этаж? ищем…';
    root.append(note);
    this.list.push({ el: note, x: 0, y: 0, z: 0, kind: 'note', idx: 0 });
  }

  update() {
    const st = this.sim.st, d = this.stage.dist;
    for (const l of this.list) {
      let x = l.x, y = l.y, z = l.z, show = true;
      if (l.kind === 'hq') {
        const hq = this.hqs[l.idx];
        y = hq.group.position.y + hq.height + 2.4;
        const sd = st.sides[l.idx];
        l.sub!.textContent = sd.floors === 1 ? 'последний этаж!' : l.idx === 0 && sd.floors < 4 ? `${sd.floors} эт. · 4-й ищем…` : `${sd.floors} эт.`;
      } else if (l.kind === 'v') {
        const p = st.pts[l.idx];
        l.nm!.className = `nm${p.owner >= 0 ? ` o${p.owner}` : ''}`;
      } else if (l.kind === 'boss') {
        const b = this.units.bossPos(l.idx as 0 | 1);
        x = b.x; y = b.y + this.units.bosses[l.idx].height + (b.active ? 1.4 : 0.8); z = b.z;
        show = this.units.bosses[l.idx].root.visible && d < 140;
      } else if (l.kind === 'note') {
        const hq = this.hqs[0];
        show = false;
        const g = hq.group.position;
        x = g.x; z = g.z; y = g.y + hq.height + hq.fh + 0.9;
      }
      this.stage.project(x, y, z, this.tmp);
      if (!show || !this.tmp.vis) { l.el.style.display = 'none'; continue; }
      l.el.style.display = '';
      l.el.style.transform = `translate(${this.tmp.x.toFixed(1)}px, ${this.tmp.y.toFixed(1)}px) translate(-50%, -100%)`;
      l.el.classList.toggle('far', d > 150);
      l.el.classList.toggle('vfar', l.kind === 'v' && d > 330);
    }
  }
}
