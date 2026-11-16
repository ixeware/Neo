// Map labels (villages, high-rises, bosses, heroes, Донер Бей) as DOM pinned to 3D points.
// One read pass (projection) and one write pass per frame, so the DOM never thrashes layout.
import * as THREE from 'three';
import { heightY, type Terrain } from '../world/terrain';
import { SIDE_TAG, VILLAGE_NOTE } from '../data/lore';
import { DONER, PERK_TEXT, type PerkId } from '../data/heroes';
import { HEROES as HERO_TYPES } from '../sim/defs';
import { unitLabel } from './hud';
import { UF, type Sim } from '../sim/sim';
import type { Stage } from '../render/scene';
import type { HqBuilding } from '../render/world';
import { US, type UnitView } from '../render/units';
import { heroHeight, heroScale } from '../render/heroes';

interface L { el: HTMLElement; x: number; y: number; z: number; kind: 'v' | 'hq' | 'boss' | 'note' | 'doner'; idx: number; nm?: HTMLElement; sub?: HTMLElement; key?: string }
/** Hero name tag. x/z are smoothed toward the unit's tick position. */
interface H { el: HTMLElement; id: number; t: number; s: 0 | 1; x: number; z: number; w: number; h: number; sx: number; sy: number; on: boolean; seen: number; flee: boolean }

const MAX_HERO_DIST = 135;

export class Labels {
  private list: L[] = [];
  private heroes = new Map<number, H>();
  private root: HTMLElement;
  private v = new THREE.Vector3();
  private cw = innerWidth; private ch = innerHeight;
  private frame = 0; private lastSet = 0;
  side: 0 | 1 = 0;

  constructor(root: HTMLElement, private t: Terrain, private sim: Sim, private stage: Stage, private hqs: HqBuilding[], private units: UnitView) {
    this.root = root;
    root.innerHTML = '';
    sim.st.pts.forEach((p, i) => {
      if (p.kind === 0) {
        const el = document.createElement('div');
        el.className = `lbl lbl-hq s${p.side}`;
        el.innerHTML = `<div class="nm">${SIDE_TAG[p.side as 0 | 1].hq}</div><div class="fl"></div>`;
        root.append(el);
        this.list.push({ el, x: p.x, y: 0, z: p.z, kind: 'hq', idx: i, sub: el.querySelector('.fl') as HTMLElement });
      } else {
        const doner = p.kind === 2;
        // v3 capture places (stadium, car wash, gym, market) carry a perk: show what it gives
        const perk = (p as { perk?: string }).perk;
        const perkText = perk && perk in PERK_TEXT ? PERK_TEXT[perk as PerkId] : '';
        const el = document.createElement('div');
        el.className = doner ? 'lbl lbl-v lbl-doner' : perkText ? 'lbl lbl-v lbl-place' : 'lbl lbl-v';
        el.innerHTML = `<div class="nm"></div><div class="sub"></div>`;
        const nm = el.querySelector('.nm') as HTMLElement, sub = el.querySelector('.sub') as HTMLElement;
        nm.textContent = doner ? DONER.clean : p.name;
        sub.textContent = doner ? DONER.note : perkText || (VILLAGE_NOTE[p.key] ?? '');
        if (perkText) el.title = `${p.name}: ${perkText}`;
        root.append(el);
        this.list.push({ el, x: p.x, y: heightY(t, p.x, p.z) + (doner ? 4.2 : 3.4), z: p.z, kind: doner ? 'doner' : 'v', idx: i, nm, key: '' });
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
    const resize = () => { this.cw = stage.canvas.clientWidth || innerWidth; this.ch = stage.canvas.clientHeight || innerHeight; };
    addEventListener('resize', resize);
    resize();
  }

  /** «Донер Гей» only with the 18+ layer on. */
  setSpicy(on: boolean) {
    for (const l of this.list) if (l.kind === 'doner') l.nm!.textContent = on ? DONER.spicy : DONER.clean;
  }

  /** Drop all hero tags (new war, new session). */
  reset() { for (const h of this.heroes.values()) h.el.remove(); this.heroes.clear(); }

  private project(x: number, y: number, z: number): { x: number; y: number; vis: boolean } {
    const v = this.v.set(x, y, z).project(this.stage.camera);
    const sx = (v.x * 0.5 + 0.5) * this.cw, sy = (-v.y * 0.5 + 0.5) * this.ch;
    return { x: sx, y: sy, vis: v.z < 1 && v.z > -1 && sx > -60 && sy > -60 && sx < this.cw + 60 && sy < this.ch + 60 };
  }

  update(dt = 1 / 60) {
    const st = this.sim.st, d = this.stage.dist;
    this.frame++;
    // ---- read pass: where everything lands on screen
    const pos: { x: number; y: number; vis: boolean; show: boolean }[] = [];
    for (const l of this.list) {
      let x = l.x, y = l.y, z = l.z, show = true;
      if (l.kind === 'hq') {
        const hq = this.hqs[l.idx];
        y = hq.group.position.y + hq.height + 2.4;
      } else if (l.kind === 'boss') {
        const b = this.units.bossPos(l.idx as 0 | 1);
        x = b.x; y = b.y + this.units.bosses[l.idx].height + (b.active ? 1.4 : 0.8); z = b.z;
        show = this.units.bosses[l.idx].root.visible && d < 140;
      } else if (l.kind === 'note') {
        show = false;
      }
      const p = this.project(x, y, z);
      pos.push({ ...p, show });
    }
    const heroesOn = d < MAX_HERO_DIST;
    if (heroesOn) this.readHeroes(dt);
    else if (this.heroes.size) for (const h of this.heroes.values()) h.on = false;

    // ---- write pass
    this.list.forEach((l, i) => {
      const p = pos[i];
      if (l.kind === 'hq') {
        const sd = st.sides[l.idx];
        const txt = sd.floors === 1 ? 'последний этаж!' : l.idx === 0 && sd.floors < 4 ? `${sd.floors} эт. · 4-й ищем…` : `${sd.floors} эт.`;
        if (l.sub!.textContent !== txt) l.sub!.textContent = txt;
      } else if (l.kind === 'v' || l.kind === 'doner') {
        const o = st.pts[l.idx].owner, k = `nm${o >= 0 ? ` o${o}` : ''}`;
        if (l.key !== k) { l.key = k; l.nm!.className = k; }
      }
      if (!p.show || !p.vis) { if (l.el.style.display !== 'none') l.el.style.display = 'none'; return; }
      l.el.style.display = '';
      l.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      l.el.classList.toggle('far', d > 150);
      l.el.classList.toggle('vfar', (l.kind === 'v' && d > 330) || (l.kind === 'doner' && d > 260));
    });
    for (const h of this.heroes.values()) {
      if (!h.on) { if (h.el.style.display !== 'none') h.el.style.display = 'none'; continue; }
      h.el.style.display = '';
      h.el.style.transform = `translate(${h.sx.toFixed(1)}px, ${h.sy.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  /** Hero tags: follow the units, then hide the ones that would sit on top of each other. */
  private readHeroes(dt: number) {
    const st = this.sim.st, now = performance.now();
    // membership changes ~8×/s; positions every frame (every other frame on low-power devices)
    if (now - this.lastSet > 120) {
      this.lastSet = now;
      for (const s of [0, 1] as const) for (const t of HERO_TYPES) {
        const id = st.sides[s].hero[t];
        if (id < 0) continue;
        const u = this.sim.unit(id);
        if (!u) continue;
        let h = this.heroes.get(id);
        if (!h) {
          const el = document.createElement('div');
          el.className = `lbl lbl-hero s${s}${s === this.side ? ' me' : ''}`;
          el.textContent = unitLabel(t, s);
          this.root.append(el);
          h = { el, id, t, s, x: u.x, z: u.z, w: 0, h: 0, sx: 0, sy: 0, on: false, seen: now, flee: false };
          this.heroes.set(id, h);
        }
        h.seen = now;
        const flee = t === 11 && (u.f & UF.FLEE) !== 0;
        if (flee !== h.flee) { h.flee = flee; h.el.textContent = flee ? `${unitLabel(t, s)} · бежит` : unitLabel(t, s); h.w = 0; }
      }
      for (const [id, h] of this.heroes) if (now - h.seen > 400) { h.el.remove(); this.heroes.delete(id); }
    }
    if (this.stage.lowPower && this.frame & 1) return;
    const k = Math.min(1, dt * 12), zk = this.units.zoomK;
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const list = [...this.heroes.values()];
    for (const h of list) {
      const u = this.sim.unit(h.id);
      if (!u) { h.on = false; continue; }
      h.x += (u.x - h.x) * k; h.z += (u.z - h.z) * k;
      if (!h.w) { h.w = h.el.offsetWidth || 60; h.h = h.el.offsetHeight || 18; }
      const top = heroHeight(h.t, h.s) * heroScale(h.t, h.s) * US * zk;
      const p = this.project(h.x, heightY(this.t, h.x, h.z) + top + 0.55, h.z);
      h.sx = p.x; h.sy = p.y; h.on = p.vis;
    }
    // own side first, then the ones nearer the camera (lower on screen)
    list.sort((a, b) => (a.s === this.side ? 0 : 1) - (b.s === this.side ? 0 : 1) || b.sy - a.sy);
    for (const h of list) {
      if (!h.on) continue;
      const fits = (y: number) => !placed.some(r => h.sx - h.w / 2 < r.x1 && h.sx + h.w / 2 > r.x0 && y - h.h < r.y1 && y > r.y0);
      let y = h.sy;
      if (!fits(y)) { y = h.sy - h.h - 3; if (!fits(y)) { h.on = false; continue; } }
      h.sy = y;
      placed.push({ x0: h.sx - h.w / 2 - 2, y0: y - h.h - 1, x1: h.sx + h.w / 2 + 2, y1: y + 1 });
    }
  }
}
