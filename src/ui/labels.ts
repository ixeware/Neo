// Map labels (villages, high-rises, bosses, heroes, Донер Бей, capture places, the real 2GIS places
// up close, the Донер Бей signpost on the north edge) as DOM pinned to 3D points.
// One read pass (projection) and one write pass per frame, so the DOM never thrashes layout (sizes are measured
// once per text / zoom state and cached). Then a screen-space pass declutters them by priority:
// high-rise > village > capture place / Донер Бей > boss > 2GIS landmark > the Донер Бей signpost > hero.
// A lower label that would overlap a higher one first drops its second line, then hides.
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
import { landmarkPlan, type LmSpot } from '../render/landmarks';
import { CAPTURE_PLACES, DONER_REAL } from '../data/places';

/** Perk icons for the capture-place labels (pen drawings, currentColor). */
const PERK_ICON: Record<string, string> = {
  sportiki: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="14.5" cy="4.5" r="2.2" fill="currentColor" stroke="none"/><path d="M13 8l-2.5 6 4.5 3-1 5M10.5 14l-3 3.5H3.5M12.5 9.5l5 2.5M12.5 9.5L8 9l-2 3"/></svg>',
  gelik: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 16v-5l4-.4L7 6h10l1 4.6 4 .4v5z"/><circle cx="7" cy="17" r="2.6"/><circle cx="17" cy="17" r="2.6"/><rect x="9" y="7.6" width="2.8" height="2.6" fill="#fff"/><rect x="13" y="7.6" width="2.8" height="2.6" fill="#fff"/></svg>',
  gym: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="11" width="14" height="2.2"/><rect x="3.5" y="6.5" width="3.2" height="11"/><rect x="17.3" y="6.5" width="3.2" height="11"/><rect x="1" y="8.5" width="2.4" height="7"/><rect x="20.6" y="8.5" width="2.4" height="7"/></svg>',
  market: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M9 21V3h5a4.5 4.5 0 010 9H6M6 16.5h9"/></svg>',
};
const GIS_KEY = new Set(CAPTURE_PLACES.filter(c => c.src === '2gis').map(c => c.key));
/** Landmark labels show up close only; phones get fewer of them. */
const LM_DIST = 46, LM_DIST_PHONE = 36;

/** A real place's name tag up close (with a tiny «2ГИС» tick when it is a 2GIS point). */
interface LmL { el: HTMLElement; l: LmSpot; y: number; w: number; h: number; sx: number; sy: number; on: boolean; d2: number }

interface L {
  el: HTMLElement; x: number; y: number; z: number; kind: 'v' | 'hq' | 'boss' | 'note' | 'doner'; idx: number; nm?: HTMLElement; sub?: HTMLElement; key?: string; sx?: number; sy?: number; shown?: boolean;
  /** a capture place (perk) rather than a village */
  place?: boolean;
  /** cached sizes: the whole label and the name line alone, valid while mkey holds */
  w?: number; h?: number; nw?: number; nh?: number; mkey?: string;
  /** 0 whole, 1 name only, 2 hidden (decluttered) */
  dc?: number;
}
type Rect = { x0: number; y0: number; x1: number; y1: number };
const hits = (r: Rect, list: Rect[]) => list.some(q => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
/** Screen priority of a map label (lower first). */
const PRIO = (l: L) => (l.kind === 'hq' ? 0 : l.kind === 'v' ? (l.place ? 2 : 1) : l.kind === 'doner' ? 2 : 3);
/** Hero name tag. x/z are smoothed toward the unit's tick position. */
interface H { el: HTMLElement; id: number; t: number; s: 0 | 1; x: number; z: number; w: number; h: number; sx: number; sy: number; on: boolean; seen: number; flee: boolean }

const MAX_HERO_DIST = 135;

export class Labels {
  private list: L[] = [];
  private lms: LmL[] = [];
  private edge: { el: HTMLElement; x: number; y: number; z: number; w?: number; h?: number } | null = null;
  private phone = Math.min(innerWidth, innerHeight) < 600;
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
        this.list.push({ el, x: p.x, y: 0, z: p.z, kind: 'hq', idx: i, nm: el.querySelector('.nm') as HTMLElement, sub: el.querySelector('.fl') as HTMLElement });
      } else {
        const doner = p.kind === 2;
        // v3 capture places (stadium, car wash, gym, market) carry a perk: show what it gives
        const perk = (p as { perk?: string }).perk;
        const perkText = perk && perk in PERK_TEXT ? PERK_TEXT[perk as PerkId] : '';
        const el = document.createElement('div');
        el.className = doner ? 'lbl lbl-v lbl-doner' : perkText ? `lbl lbl-v lbl-place pk-${perk}` : 'lbl lbl-v';
        el.innerHTML = `<div class="nm"></div><div class="sub"></div>`;
        const nm = el.querySelector('.nm') as HTMLElement, sub = el.querySelector('.sub') as HTMLElement;
        nm.textContent = doner ? DONER.clean : p.name;
        if (perkText) {
          // the perk as a pen icon before the name, and the «2ГИС» tick (CSS shows it only up close)
          nm.insertAdjacentHTML('afterbegin', `<i class="pk" aria-hidden="true">${PERK_ICON[perk!] ?? ''}</i>`);
          if (GIS_KEY.has(p.key)) nm.insertAdjacentHTML('beforeend', '<span class="gis" title="Точка из 2ГИС">2ГИС</span>');
        }
        sub.textContent = doner ? DONER.note : perkText || (VILLAGE_NOTE[p.key] ?? '');
        if (perkText) el.title = `${p.name}: ${perkText}`;
        root.append(el);
        this.list.push({ el, x: p.x, y: heightY(t, p.x, p.z) + (doner ? 4.2 : 3.4), z: p.z, kind: doner ? 'doner' : 'v', idx: i, nm, sub, key: '', place: !!perkText });
      }
    });
    for (const s of [0, 1]) {
      const el = document.createElement('div');
      el.className = 'lbl lbl-boss';
      el.innerHTML = `<div class="nm">${SIDE_TAG[s].boss}</div>`;
      root.append(el);
      this.list.push({ el, x: 0, y: 0, z: 0, kind: 'boss', idx: s, nm: el.querySelector('.nm') as HTMLElement });
    }
    // the real 2GIS places (capture places have their own label above)
    for (const l of landmarkPlan(t)) {
      if (l.capture) continue;
      const el = document.createElement('div');
      el.className = `lbl lbl-lm${l.side === 0 ? ' s0' : l.side === 1 ? ' s1' : ''}`;
      el.innerHTML = `<span class="nm"></span>${l.real ? '<span class="gis" title="Точка из 2ГИС">2ГИС</span>' : ''}`;
      (el.firstElementChild as HTMLElement).textContent = l.name;
      el.style.display = 'none';
      root.append(el);
      this.lms.push({ el, l, y: heightY(t, l.x, l.z) + l.h + 0.45, w: 0, h: 0, sx: 0, sy: 0, on: false, d2: 0 });
    }
    // Донер Бей's real address is off the north edge: a sign over the edge above pts[8]
    const dp = sim.st.pts.find(p => p.kind === 2);
    if (dp) {
      const el = document.createElement('div');
      el.className = 'lbl lbl-edge';
      el.innerHTML = `<b>${DONER_REAL.name}</b> — ${DONER_REAL.address.replace(/, (\d)/, ' $1')} · 2,6 км <span class="up">↑</span>`;
      el.style.display = 'none';
      root.append(el);
      this.edge = { el, x: dp.x, y: heightY(t, dp.x, 1.6) + 3.2, z: 1.6 };
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
    for (const l of this.list) if (l.kind === 'doner') { l.nm!.textContent = on ? DONER.spicy : DONER.clean; l.mkey = ''; }
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
      l.shown = p.show && p.vis; l.sx = p.x; l.sy = p.y;
      if (!p.show || !p.vis) { if (l.el.style.display !== 'none') l.el.style.display = 'none'; return; }
      l.el.style.display = '';
      l.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      l.el.classList.toggle('far', d > 150);
      l.el.classList.toggle('vfar', (l.kind === 'v' && d > 330) || (l.kind === 'doner' && d > 260));
    });
    this.root.classList.toggle('near', d < (this.phone ? LM_DIST_PHONE : LM_DIST));
    const placed = this.declutter();
    this.updateLandmarks(d, placed);
    if (this.edge) {
      const e = this.edge, p = this.project(e.x, e.y, e.z);
      let on = p.vis && d > 28 && d < 230;
      if (on) {
        if (!e.w) { e.el.style.display = ''; e.w = e.el.offsetWidth || 200; e.h = e.el.offsetHeight || 22; }
        const r = { x0: p.x - e.w / 2 - 2, y0: p.y - e.h! - 2, x1: p.x + e.w / 2 + 2, y1: p.y + 2 };
        if (hits(r, placed)) on = false; else placed.push(r);
      }
      if (!on) { if (e.el.style.display !== 'none') e.el.style.display = 'none'; }
      else { e.el.style.display = ''; e.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`; }
    }
    // hero tags come last: one over a place or a village name steps aside
    for (const h of this.heroes.values()) {
      if (h.on && hits({ x0: h.sx - h.w / 2, y0: h.sy - h.h, x1: h.sx + h.w / 2, y1: h.sy }, placed)) h.on = false;
      if (!h.on) { if (h.el.style.display !== 'none') h.el.style.display = 'none'; continue; }
      h.el.style.display = '';
      h.el.style.transform = `translate(${h.sx.toFixed(1)}px, ${h.sy.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  /**
   * Screen-space pass over the high-rise, village, place, Донер Бей and boss labels shown this frame, by priority:
   * a label that would overlap one already placed drops its second line, and if it still overlaps, hides.
   * Returns the rects taken, for the smaller names placed after these.
   */
  private declutter(): Rect[] {
    const placed: Rect[] = [];
    const shown = this.list.filter(l => l.shown && l.kind !== 'note' && !l.el.classList.contains('vfar'));
    shown.sort((a, b) => PRIO(a) - PRIO(b) || b.sy! - a.sy!); // equal rank: the nearer (lower on screen) first
    for (const l of shown) {
      // sizes: measured once per text and zoom state (the second line hides when far)
      const far = l.el.classList.contains('far');
      const mk = `${far ? 1 : 0}|${l.nm?.textContent ?? ''}|${l.sub?.textContent ?? ''}`;
      if (l.mkey !== mk) {
        l.el.classList.remove('nosub'); l.el.style.visibility = '';
        l.w = l.el.offsetWidth; l.h = l.el.offsetHeight;
        l.nw = l.nm ? l.nm.offsetWidth : l.w; l.nh = l.nm ? l.nm.offsetHeight : l.h;
        l.mkey = mk; l.dc = 0;
      }
      const x = l.sx!, y = l.sy!;
      const full = { x0: x - l.w! / 2 - 2, y0: y - l.h! - 2, x1: x + l.w! / 2 + 2, y1: y + 2 };
      // without its second line the label shrinks to the name, still hanging from the anchor (translate(-50%, -100%))
      const name = { x0: x - l.nw! / 2 - 2, y0: y - l.nh! - 2, x1: x + l.nw! / 2 + 2, y1: y + 2 };
      let dc = 2, r: Rect | null = null;
      if (!hits(full, placed)) { dc = 0; r = full; }
      else if (l.nh! < l.h! - 1 && !hits(name, placed)) { dc = 1; r = name; }
      if (r) placed.push(r);
      if (l.dc !== dc) {
        l.dc = dc;
        l.el.classList.toggle('nosub', dc === 1);
        l.el.style.visibility = dc === 2 ? 'hidden' : '';
      }
    }
    for (const l of this.list) if (!l.shown && l.dc) { l.dc = 0; l.el.classList.remove('nosub'); l.el.style.visibility = ''; }
    return placed;
  }

  /** Names of the real places up close: nearest to the view centre first, never on top of each other or of the labels placed above. */
  private updateLandmarks(d: number, placed: Rect[]) {
    const max = this.phone ? 6 : 12, near = d < (this.phone ? LM_DIST_PHONE : LM_DIST);
    if (!near) { for (const m of this.lms) if (m.on) { m.on = false; m.el.style.display = 'none'; } return; }
    if (this.stage.lowPower && this.frame & 1) return;
    const tg = this.stage.target, R = 22 + d * 0.5;
    // keep clear of the HUD: the top slips and the deck
    const y0 = this.ch * 0.13, y1 = this.ch * 0.76, x0 = this.cw * 0.05, x1 = this.cw * 0.95;
    const cand: LmL[] = [];
    for (const m of this.lms) {
      m.d2 = (m.l.x - tg.x) ** 2 + (m.l.z - tg.z) ** 2;
      if (m.d2 > R * R) { m.on = false; continue; }
      const p = this.project(m.l.x, m.y, m.l.z);
      m.sx = p.x; m.sy = p.y; m.on = p.vis && p.y > y0 && p.y < y1 && p.x > x0 && p.x < x1;
      if (m.on) cand.push(m);
    }
    cand.sort((a, b) => a.d2 - b.d2);
    // the village, high-rise and place labels are placed already (declutter): keep the small names off them
    let n = 0;
    for (const m of cand) {
      if (n >= max) { m.on = false; continue; }
      if (!m.w) { m.el.style.display = ''; m.w = m.el.offsetWidth || 80; m.h = m.el.offsetHeight || 16; }
      const x0 = m.sx - m.w / 2 - 2, x1 = m.sx + m.w / 2 + 2, y0 = m.sy - m.h - 1, y1 = m.sy + 1;
      if (placed.some(r => x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0)) { m.on = false; continue; }
      placed.push({ x0, y0, x1, y1 });
      n++;
    }
    for (const m of this.lms) {
      if (!m.on) { if (m.el.style.display !== 'none') m.el.style.display = 'none'; continue; }
      m.el.style.display = '';
      m.el.style.transform = `translate(${m.sx.toFixed(1)}px, ${m.sy.toFixed(1)}px) translate(-50%, -100%)`;
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
