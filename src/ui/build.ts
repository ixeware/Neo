// Build mode: the «Стройка» palette, placing a building with a ghost, the panel of a selected building.
// Everything sits in the deck's place (Hud.deckAlt), so the bank, the minimap, the command bar, the chat and
// the сход sheet restack on its measured size and nothing is ever covered. The sim decides what is allowed
// (Sim.canBuild* / canUp / canSell / canRep / canFire, docs/v5/BASE.md §12); this file only asks and sends
// 'bld' commands. Drawing is src/render/baseView.ts, texts are src/ui/buildText.ts.
import './build.css';
import type { Sim, FxEv } from '../sim/sim';
import { BUILDINGS, BKEY, BASE, BF, bldStats, type BFam, type Side } from '../sim/defs';
import { snapCell, wallLine, refund, repairCost, bldVisible, bldIncome } from '../sim/bld';
import { cellX, cellZ, heightY, type Terrain } from '../world/terrain';
import type { Stage, InputMods } from '../render/scene';
import type { BaseView } from '../render/baseView';
import type { Hud } from './hud';
import type { Control } from './control';
import type { Session, CmdBody } from '../net/session';
import { bldText, bldFeed } from './buildText';

const h = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  build: svg('<path d="M14 4l6 6-2.5 2.5-6-6z"/><path d="M12.5 8.5L4 17l3 3 8.5-8.5"/>'),
  def: svg('<path d="M8 21V11H6V5h3v2h2V5h2v2h2V5h3v6h-2v10z"/>'),
  wall: svg('<path d="M3 7h18v11H3zM3 12.5h18M9 7v5.5M15 7v5.5M12 12.5V18"/>'),
  trap: svg('<path d="M3 19h18M5 19l2.5-8 2.5 8M10 19l2-11 2 11M14 19l2.5-8 2.5 8"/>'),
  eco: svg('<circle cx="12" cy="12" r="8.5"/><path d="M10 17V7h3a2.5 2.5 0 010 5h-4.5M8.5 14.5H13"/>'),
  sup: svg('<path d="M12 3l2.6 5.6 6 .7-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.3l6-.7z"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  ok: svg('<path d="M4.5 12.5l5 5L20 7"/>'),
};
/** Palette tabs: the sim's six families in five groups. */
const FAMS: { icon: string; name: string; fams: BFam[] }[] = [
  { icon: ICON.def, name: 'Защита', fams: ['def'] },
  { icon: ICON.wall, name: 'Стены', fams: ['wall'] },
  { icon: ICON.trap, name: 'Ловушки', fams: ['trap'] },
  { icon: ICON.eco, name: 'Хозяйство', fams: ['eco'] },
  { icon: ICON.sup, name: 'Особое', fams: ['sup', 'super'] },
];
const FAM_OF = (t: number) => FAMS.findIndex(f => f.fams.includes(BUILDINGS[t].fam));
const POOR = 'Голда не на балике', FAST = 'Не так быстро';
/** A deny reason short enough for a card. */
function shortWhy(why: string): string {
  const m = /Прорабская (\d)/.exec(why);
  if (m) return `Прорабская ${m[1]} ур.`;
  if (why.startsWith('Сначала')) return 'нужна Прорабская';
  if (why.startsWith('Больше')) return 'максимум';
  if (why.startsWith('База застроена')) return 'база полна';
  if (why.startsWith('Забора хватит')) return 'лимит забора';
  if (why.startsWith('Жди')) return 'после войны';
  return why;
}
const sec = (ticks: number) => `${Math.max(0, Math.ceil(ticks / 10))} с`;
const rub = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');

export interface BuildDeps {
  sim: Sim; stage: Stage; hud: Hud; terrain: Terrain; base: BaseView; control: Control;
  session: () => Session | null; side: () => Side; pid: () => string; playing: () => boolean; spicy: () => boolean;
  sound: { click(): void; deny(): void; deploy(): void; coin(): void; floorUp(): void; rumble(): void; stamp(): void; swish(): void; cluck(n?: number): void; jingle(): void; whoosh(): void; quake(): void; pop(): void; shot(k: number): void };
  /** A line in the chat feed: who, text, priority 0..3, the side whose pen writes it. */
  say: (who: string, text: string, prio: 0 | 1 | 2 | 3, side?: number) => void;
  /** A deny reason in the player's wording (lore.deny). */
  deny: (why: string) => string;
  near: (x: number, z: number, r?: number) => boolean;
}

type Mode = 'off' | 'pal' | 'place' | 'sel' | 'aim';
interface Cell { x: number; z: number; ok: boolean }

export class Build {
  mode: Mode = 'off';
  /** Building type being placed, -1 none. */
  placing = -1;
  /** Selected building id, -1 none. */
  selId = -1;
  private fam = 0;
  private lastT = -1;
  private touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  /** The ghost: anchor cell centre and, for a wall, the nav cells of the line. */
  private g = { has: false, x: 0, z: 0, cells: [] as number[] };
  private aimAt: { x: number; z: number } | null = null;
  private drag: { kind: 'move' | 'line'; ox: number; oy: number } | null = null;
  /** A pointer taken by grab() is still down (its moves and its end come through box()). */
  private held = false;
  private mouse: { x: number; y: number } | null = null;
  private ev = { cells: [] as Cell[], n: 0, price: 0, why: null as string | null };
  private root: HTMLElement; private pal: HTMLElement; private bar: HTMLElement; private sel: HTMLElement; private why: HTMLElement;
  private chips: HTMLButtonElement[] = []; private nextBtn: HTMLButtonElement; private sumEl: HTMLElement; private repBtn: HTMLButtonElement; private cardRow: HTMLElement;
  private cards = new Map<number, { el: HTMLButtonElement; key: string }>();
  private btn: HTMLButtonElement;
  private rowKey = ''; private selKey = ''; private barKey = ''; private whyKey = '';
  private lastPaint = 0; private sellArm = 0; private putAt = 0;
  private pr = { x: 0, y: 0, vis: false };
  private cds = new Map<string, number>();

  constructor(private d: BuildDeps) {
    const root = this.root = h('div', 'bld');
    root.hidden = true;
    root.addEventListener('pointerdown', e => e.stopPropagation());
    // ---- palette: family chips + one row of cards
    this.pal = h('div', 'bpal');
    const fams = h('div', 'bfams');
    const x = h('button', 'bchip bchip-x paper', ICON.x) as HTMLButtonElement;
    x.type = 'button'; x.title = 'Закрыть стройку (Esc)'; x.setAttribute('aria-label', 'Закрыть стройку');
    x.addEventListener('click', () => { d.sound.click(); this.close(); });
    fams.append(x);
    FAMS.forEach((f, i) => {
      const b = h('button', 'bchip paper', `${f.icon}<span>${f.name}</span>`) as HTMLButtonElement;
      b.type = 'button';
      b.addEventListener('click', () => { d.sound.click(); this.setFam(i); });
      this.chips.push(b); fams.append(b);
    });
    // a phone held sideways has no room for five chips: one button walks through the families
    this.nextBtn = h('button', 'bchip bchip-next paper') as HTMLButtonElement;
    this.nextBtn.type = 'button';
    this.nextBtn.addEventListener('click', () => { d.sound.click(); this.setFam((this.fam + 1) % FAMS.length); });
    fams.append(this.nextBtn);
    this.repBtn = h('button', 'bchip bchip-rep paper') as HTMLButtonElement;
    this.repBtn.type = 'button'; this.repBtn.hidden = true;
    this.repBtn.addEventListener('click', () => this.repairAll());
    this.sumEl = h('span', 'bsum');
    fams.append(this.repBtn, this.sumEl);
    this.cardRow = h('div', 'bcards');
    this.pal.append(fams, this.cardRow);
    // ---- placing on a phone, aiming a superweapon: a short bar
    this.bar = h('div', 'bbar paper', `<div class="bb-t"><b class="bb-n"></b><span class="bb-w"></span></div><button type="button" class="bb-ok" aria-label="Поставить">${ICON.ok}</button><button type="button" class="bb-x" aria-label="Отмена">${ICON.x}</button>`);
    this.bar.querySelector('.bb-ok')!.addEventListener('click', () => this.confirm(false));
    this.bar.querySelector('.bb-x')!.addEventListener('click', () => { d.sound.click(); this.back(); });
    // ---- a selected building
    this.sel = h('div', 'bsel paper');
    this.sel.addEventListener('click', e => { const a = (e.target as HTMLElement).closest?.('[data-a]') as HTMLElement | null; if (a) this.act(a.dataset.a!); });
    root.append(this.pal, this.bar, this.sel);
    d.hud.deckEl.append(root);
    // the reason / price next to the ghost
    this.why = h('div', 'bwhy');
    this.why.hidden = true;
    d.hud.root.append(this.why);
    // «Стройка»: at the end of the bank slip (its measured width moves the command bar and the hint)
    this.btn = h('button', 'bank-build', `${ICON.build}<span>Стройка</span>`) as HTMLButtonElement;
    this.btn.type = 'button'; this.btn.title = 'Стройка (B)'; this.btn.setAttribute('aria-label', 'Стройка');
    this.btn.addEventListener('pointerdown', e => e.stopPropagation());
    this.btn.addEventListener('click', () => { d.sound.click(); this.toggle(); });
    d.hud.bankEl.append(this.btn);
    addEventListener('pointerdown', e => { this.touch = e.pointerType !== 'mouse'; }, true);
  }

  private me() { return this.d.sim.st.players[this.d.pid()]; }
  private cool(key: string, ms: number) { const now = performance.now(); if ((this.cds.get(key) ?? 0) > now) return false; this.cds.set(key, now + ms); return true; }
  private name(t: number) { return bldText(t, this.d.spicy()).name; }

  // ---- modes --------------------------------------------------------------------------------------------
  /** Which panel stands in the deck's place. */
  private show() {
    const m = this.mode, hud = this.d.hud;
    const el = m === 'off' ? null : m === 'sel' ? this.sel : m === 'aim' || (m === 'place' && this.touch) ? this.bar : this.pal;
    this.pal.hidden = el !== this.pal; this.bar.hidden = el !== this.bar; this.sel.hidden = el !== this.sel;
    this.root.hidden = !el;
    hud.deckEl.classList.toggle('alt', !!el);
    hud.deckAlt = el ? this.root : null;
    hud.root.classList.toggle('building', m === 'pal' || m === 'place');
    this.btn.classList.toggle('on', m === 'pal' || m === 'place');
    this.barKey = this.selKey = '';
    this.d.base.selected = m === 'sel' || m === 'aim' ? this.selId : -1;
    if (m !== 'place') { this.placing = -1; this.g.has = false; this.drag = null; }
    if (m !== 'aim') this.aimAt = null;
    hud.layout();
    this.paint(performance.now(), true);
  }
  toggle() { if (this.mode === 'pal' || this.mode === 'place') this.close(); else this.open(); }
  open() {
    const d = this.d;
    if (!d.playing() || d.control.fp.on) return;
    d.hud.select(-1);
    this.mode = 'pal'; this.selId = -1;
    this.show();
    // the build zone must be in view
    const z = d.sim.buildZone(d.side());
    d.stage.project(z.x, heightY(d.terrain, z.x, z.z), z.z, this.pr);
    if (!this.pr.vis || d.stage.dist > 120) d.stage.flyTo(z.x, z.z, Math.min(d.stage.dist, 62));
    if (this.cool('tip', 60000)) d.hud.note(this.touch ? 'Стройка: выбери постройку, тащи её пальцем и жми ✓' : 'Стройка: выбери постройку и кликни по земле у своей высотки. Shift — ставить ещё, ПКМ — отмена', 5200);
  }
  close() { if (this.mode === 'off') return; this.mode = 'off'; this.selId = -1; this.show(); }
  /** One step back: placing → the palette, aiming → the building, the rest → closed. */
  private back() {
    if (this.mode === 'place') { this.mode = 'pal'; this.show(); }
    else if (this.mode === 'aim') { this.mode = 'sel'; this.show(); }
    else this.close();
  }
  private setFam(i: number) { this.fam = i; this.rowKey = ''; if (this.mode === 'place') { this.mode = 'pal'; this.show(); } else this.paint(performance.now(), true); }

  /** Take building type t in hand. */
  pick(t: number) {
    const d = this.d, D = BUILDINGS[t];
    if (!D || !d.playing()) return;
    const why = d.sim.canBuildType(d.side(), t, this.me());
    if (why && why !== FAST) { d.sound.deny(); d.hud.note(`${this.name(t)}: ${d.deny(why)}`); return; }
    if (this.mode === 'place' && this.placing === t) { d.sound.click(); this.back(); return; }
    d.sound.click();
    d.hud.select(-1);
    this.fam = FAM_OF(t);
    this.mode = 'place'; this.selId = -1;
    this.show();
    this.placing = t; this.lastT = t;
    this.g.has = false;
    const at = this.touch ? { x: innerWidth / 2, y: innerHeight * 0.4 } : this.mouse; // a phone: the screen centre
    const p = at ? d.stage.pick(at.x, at.y) : null;
    if (p) this.moveGhost(p.x, p.z);
    const tx = bldText(t, d.spicy());
    d.hud.note(`${tx.name}. ${tx.blurb}`, 5200);
    this.paint(performance.now(), true);
  }
  select(id: number) {
    const d = this.d;
    d.control.clear();
    d.hud.select(-1);
    this.mode = 'sel'; this.selId = id; this.sellArm = 0;
    this.show();
  }
  private deselect() { this.close(); }

  private moveGhost(x: number, z: number) {
    const c = snapCell(this.d.terrain, x, z);
    this.g.has = true; this.g.x = c.x; this.g.z = c.z; this.g.cells = [c.c];
  }

  /** What the ghost would build right now: per cell, the count, the price and the first reason. */
  private evalGhost() {
    const d = this.d, sim = d.sim, side = d.side(), me = this.me(), t = this.placing, D = BUILDINGS[t], out = this.ev;
    out.cells = []; out.n = 0; out.price = 0; out.why = null;
    if (!this.g.has || !D) return out;
    const price = sim.bcost(side, t, 1);
    if (D.line) {
      const caps = sim.bldCaps(side);
      let room = Math.min(caps.wallMax - caps.walls, Math.floor(sim.st.sides[side].money / Math.max(1, price)));
      for (const c of this.g.cells) {
        const x = cellX(d.terrain, c), z = cellZ(d.terrain, c);
        let w = sim.canBuild(side, t, x, z, me);
        if (!w && room <= 0) w = caps.wallMax - caps.walls <= out.n ? 'Забора хватит: подними Прорабскую' : POOR;
        if (!w) { out.n++; room--; } else out.why ??= w;
        out.cells.push({ x, z, ok: !w });
      }
      if (out.n) out.why = null;
    } else {
      out.why = sim.canBuild(side, t, this.g.x, this.g.z, me);
      out.cells.push({ x: this.g.x, z: this.g.z, ok: !out.why });
      out.n = out.why ? 0 : 1;
    }
    out.price = out.n * price;
    return out;
  }

  /** Send the build command for the ghost. `keep`: stay in hand for the next one. */
  private confirm(keep: boolean) {
    const d = this.d, s = d.session(), side = d.side(), t = this.placing, D = BUILDINGS[t];
    if (this.mode === 'aim') return;
    if (!s || this.mode !== 'place' || !D || !this.g.has) return;
    const ev = this.evalGhost();
    if (!ev.n) { d.sound.deny(); if (ev.why) d.hud.note(d.deny(ev.why), 2200); return; }
    const body = (D.line ? { k: 'bld', s: side, op: 'put', b: t, cells: this.g.cells.slice() } : { k: 'bld', s: side, op: 'put', b: t, x: this.g.x, z: this.g.z }) as CmdBody;
    s.submit(body);
    d.sound.deploy(); this.putAt = performance.now();
    const last = ev.cells[ev.cells.length - 1];
    d.stage.project(last.x, heightY(d.terrain, last.x, last.z) + 2, last.z, this.pr);
    if (this.pr.vis) d.hud.tip(this.pr.x, this.pr.y, `−${ev.price} ₽`);
    if (D.line) { const c = this.g.cells[this.g.cells.length - 1]; this.g.x = cellX(d.terrain, c); this.g.z = cellZ(d.terrain, c); this.g.cells = [c]; return; } // a fence goes on
    if (!keep) { this.mode = 'pal'; this.show(); }
  }
  private repairAll() {
    const d = this.d, s = d.session();
    if (!s) return;
    s.submit({ k: 'bld', s: d.side(), op: 'rep', n: 0 } as CmdBody);
    d.sound.click();
  }
  private act(a: string) {
    const d = this.d, sim = d.sim, side = d.side(), me = this.me(), id = this.selId, b = sim.building(id), s = d.session();
    if (a === 'x') { d.sound.click(); this.deselect(); return; }
    if (!b || !s || b.s !== side) return;
    const why = a === 'up' ? sim.canUp(side, id, me) : a === 'rep' ? sim.canRep(side, id, me) : a === 'sell' ? sim.canSell(side, id, me) : a === 'fire' ? sim.canFire(side, id, b.x, b.z, me) : 'Нет такой постройки';
    if (why) { d.sound.deny(); d.hud.note(d.deny(why), 2400); return; }
    if (a === 'fire') { d.sound.click(); this.mode = 'aim'; this.show(); d.hud.note(this.touch ? 'Куда кидаем арбуз? Тапни по карте' : 'Куда кидаем арбуз? Кликни по карте. ПКМ — отмена', 4200); return; }
    if (a === 'sell' && performance.now() > this.sellArm) { this.sellArm = performance.now() + 4000; d.sound.click(); this.selKey = ''; return; } // the second tap sells
    s.submit({ k: 'bld', s: side, op: a as 'up' | 'sell' | 'rep', n: id } as CmdBody);
    d.sound.click();
    if (a === 'sell') this.deselect();
  }
  private fire(x: number, z: number) {
    const d = this.d, s = d.session(), side = d.side();
    const why = d.sim.canFire(side, this.selId, x, z, this.me());
    if (why || !s) { d.sound.deny(); if (why) d.hud.note(d.deny(why), 2400); return; }
    s.submit({ k: 'bld', s: side, op: 'fire', n: this.selId, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 } as CmdBody);
    this.mode = 'sel'; this.show();
  }

  // ---- input (hooked from src/main.ts and bindInput) --------------------------------------------------------
  /** A click / tap on the map. true = taken. */
  tap(x: number, y: number, m: InputMods): boolean {
    const d = this.d;
    if (!d.playing()) return false;
    this.touch = m.touch;
    if (this.mode === 'place') {
      const p = d.stage.pick(x, y);
      if (p) { this.moveGhost(p.x, p.z); if (!m.touch) this.confirm(m.shift); }
      return true;
    }
    if (this.mode === 'aim') { const p = d.stage.pick(x, y); if (p) this.fire(p.x, p.z); return true; }
    // a building under the pointer; units come first (src/ui/control.ts picks them)
    const c = d.control;
    if (c.amove || c.pickAt(x, y, m.touch, 'own') || (c.sel.size && c.pickAt(x, y, m.touch, 'enemy'))) return false;
    const b = d.base.pick(x, y, m.touch);
    if (!b) { if (this.mode === 'sel') { this.deselect(); return true; } return false; }
    if (b.s !== d.side() && c.sel.size) return c.issue('attack', undefined, undefined, undefined, b.id); // «ломайте это»
    d.sound.click();
    if (this.mode === 'sel' && this.selId === b.id) this.deselect(); else this.select(b.id);
    return true;
  }
  /** Right click. true = taken. */
  order(x: number, y: number): boolean {
    const d = this.d;
    if (this.mode === 'place' || this.mode === 'aim') { this.back(); return true; }
    const c = d.control;
    if (d.playing() && c.sel.size && !c.pickAt(x, y, false, 'enemy')) {
      const b = d.base.pick(x, y, false);
      if (b && b.s !== d.side()) { c.issue('attack', undefined, undefined, undefined, b.id); return true; }
    }
    return false;
  }
  hover(x: number, y: number) { this.mouse = { x, y }; }
  /**
   * Pointer down on the map while placing: true = this drag belongs to the ghost (the camera does not pan).
   * Phone: the finger is on the ghost (it follows the finger) or on a wall's end (the line follows).
   * Desktop: only walls — press, drag a line, release.
   */
  grab(x: number, y: number, m: InputMods): boolean {
    const d = this.d;
    if (this.mode !== 'place' || !d.playing()) return false;
    const D = BUILDINGS[this.placing];
    this.touch = m.touch;
    if (!m.touch) {
      if (!D?.line) return false;
      const p = d.stage.pick(x, y);
      if (!p) return false;
      this.moveGhost(p.x, p.z);
      this.drag = { kind: 'line', ox: 0, oy: 0 };
      return (this.held = true);
    }
    if (!this.g.has) return false;
    const T = d.terrain, near = (wx: number, wz: number) => { d.stage.project(wx, heightY(T, wx, wz) + 0.6, wz, this.pr); return this.pr.vis && Math.hypot(this.pr.x - x, this.pr.y - y) < 48; };
    if (D?.line) {
      const e = this.g.cells[this.g.cells.length - 1];
      if (!near(cellX(T, e), cellZ(T, e)) && !near(this.g.x, this.g.z)) return false;
      this.drag = { kind: 'line', ox: this.pr.x - x, oy: this.pr.y - y };
      return (this.held = true);
    }
    if (!near(this.g.x, this.g.z)) return false;
    this.drag = { kind: 'move', ox: this.pr.x - x, oy: this.pr.y - y };
    return (this.held = true);
  }
  /** The drag bindInput reports as a rubber band. undefined = not ours (unit control takes it). */
  box(phase: 'start' | 'move' | 'end' | 'cancel', _x0: number, _y0: number, x1: number, y1: number, m: InputMods): boolean | undefined {
    if (!this.held) return this.mode === 'place' || this.mode === 'aim' ? false : undefined; // no rubber band while building: the finger pans
    if (phase === 'end' || phase === 'cancel') this.held = false;
    if (!this.drag) return true; // build mode ended under the finger: the rest of this drag is nobody's
    const d = this.d;
    if (phase === 'move') {
      const p = d.stage.pick(x1 + this.drag.ox, y1 + this.drag.oy);
      if (p) { if (this.drag.kind === 'move') this.moveGhost(p.x, p.z); else this.g.cells = wallLine(d.terrain, this.g.x, this.g.z, p.x, p.z); }
    } else {
      const line = this.drag.kind === 'line';
      this.drag = null;
      if (phase === 'end' && line && !m.touch) this.confirm(true);
    }
    return true;
  }
  /** Keys: B the palette, digits pick, R the last building again, Esc one step back. true = taken. */
  key(e: KeyboardEvent): boolean {
    const d = this.d;
    if (!d.playing() || (e.target as HTMLElement)?.tagName === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey || d.control.fp.on) return false;
    if (e.code === 'KeyB') { if (!e.repeat) { d.sound.click(); this.toggle(); } return true; }
    if (e.code === 'KeyR' && this.lastT >= 0) { if (!e.repeat) { if (this.mode === 'off' || this.mode === 'sel') { this.mode = 'pal'; this.selId = -1; } this.placing = -1; this.pick(this.lastT); } return true; }
    if (this.mode === 'off') return false;
    if (e.code === 'Escape') { this.back(); return true; }
    if (this.mode === 'pal' || this.mode === 'place') {
      const k = '1234567890'.indexOf(e.key), list = this.types();
      if (k >= 0 && !e.shiftKey) { if (list[k] !== undefined && !e.repeat) this.pick(list[k]); return true; }
    }
    return false;
  }
  /** R is «the last building again» once something was built: it must not zoom the camera. */
  keyBusy(code: string): boolean { return code === 'KeyR' && this.lastT >= 0 && this.d.playing(); }

  // ---- painting -----------------------------------------------------------------------------------------
  private types(): number[] {
    const f = FAMS[this.fam], out: number[] = [];
    BUILDINGS.forEach((b, t) => { if (f.fams.includes(b.fam)) out.push(t); });
    return out.sort((a, b) => Number(BUILDINGS[b].key === 'prorab') - Number(BUILDINGS[a].key === 'prorab'));
  }

  /** Every frame: the ghost, the zone, the panels (the panels at 5 Hz), then the buildings themselves. */
  update(now: number, dt: number, alpha: number, zoomK: number) {
    const d = this.d, base = d.base, side = d.side();
    base.side = side;
    if (!d.playing() || d.control.fp.on) { if (this.mode !== 'off') this.close(); }
    if (this.mode === 'place') {
      if (!this.touch && !this.drag && this.mouse) { const p = d.stage.pick(this.mouse.x, this.mouse.y); if (p) this.moveGhost(p.x, p.z); }
      const ev = this.evalGhost(), D = BUILDINGS[this.placing];
      base.setGhost(this.placing, ev.cells, D.range?.[0] ?? 0, D.min ?? 0);
      this.paintWhy(ev);
    } else if (this.mode === 'aim') {
      if (!this.touch && this.mouse) { const p = d.stage.pick(this.mouse.x, this.mouse.y); if (p) this.aimAt = { x: p.x, z: p.z }; }
      base.setGhost(-2, this.aimAt ? [{ x: this.aimAt.x, z: this.aimAt.z, ok: true }] : [], BUILDINGS[BKEY.arbuzomet].sp ?? 5);
      this.why.hidden = true;
    } else { base.setGhost(-1, []); this.why.hidden = true; }
    base.showZone(this.mode === 'pal' || this.mode === 'place' ? side : -1);
    if (this.mode !== 'off') this.paint(now, false);
    base.update(now, dt, alpha, zoomK);
  }

  private paintWhy(ev: { cells: Cell[]; n: number; price: number; why: string | null }) {
    const d = this.d, el = this.why, c = ev.cells[ev.cells.length - 1];
    if (!c) { el.hidden = true; return; }
    d.stage.project(c.x, heightY(d.terrain, c.x, c.z) + 3.2, c.z, this.pr);
    el.hidden = !this.pr.vis;
    if (!this.pr.vis) return;
    const text = ev.n ? (ev.cells.length > 1 ? `${ev.n} шт. · ${ev.price} ₽` : `${ev.price} ₽`) : d.deny(ev.why ?? '');
    const key = `${text}|${ev.n ? 1 : 0}`;
    if (key !== this.whyKey) { this.whyKey = key; el.textContent = text; el.className = `bwhy ${ev.n ? 'ok' : 'bad'}`; }
    el.style.transform = `translate(${Math.round(this.pr.x)}px, ${Math.round(this.pr.y)}px) translate(-50%, -100%)`;
  }

  private paint(now: number, force: boolean) {
    if (!force && now - this.lastPaint < 200) return;
    this.lastPaint = now;
    if (!this.pal.hidden) this.paintPal();
    if (!this.bar.hidden) this.paintBar();
    if (!this.sel.hidden) this.paintSel(now);
  }

  private paintPal() {
    const d = this.d, sim = d.sim, side = d.side(), me = this.me(), spicy = d.spicy();
    const rk = `${this.fam}|${side}|${spicy ? 1 : 0}`;
    if (rk !== this.rowKey) {
      this.rowKey = rk;
      this.cardRow.innerHTML = '';
      this.cardRow.scrollLeft = 0;
      this.cards.clear();
      this.types().forEach((t, i) => {
        const tx = bldText(t, spicy), fi = FAM_OF(t);
        const b = h('button', `bcard paper s${side}`, `<span class="key">${'1234567890'[i] ?? ''}</span><i class="bi bi-${BUILDINGS[t].fam}">${FAMS[fi].icon}</i><span class="bn">${esc(tx.name)}</span><span class="bc"></span><span class="bq"></span><span class="bl"></span>`) as HTMLButtonElement;
        b.type = 'button'; b.dataset.t = String(t);
        b.title = `${tx.name}. ${tx.blurb}`;
        b.addEventListener('click', () => { this.mouse = null; this.pick(t); }); // the mouse is on the card: the ghost waits for it over the map
        this.cardRow.append(b);
        this.cards.set(t, { el: b, key: '' });
      });
      this.chips.forEach((c, i) => c.classList.toggle('on', i === this.fam));
      this.nextBtn.textContent = `${FAMS[this.fam].name} ▸`;
    }
    const caps = sim.bldCaps(side);
    for (const [t, c] of this.cards) {
      const D = BUILDINGS[t], why = sim.canBuildType(side, t, me), price = sim.bcost(side, t, 1), have = sim.bldCount(side, t), cap = D.cap || caps.wallMax;
      const lock = !!why && why !== FAST && why !== POOR, poor = why === POOR, on = this.mode === 'place' && this.placing === t;
      const key = `${price}|${have}|${cap}|${lock ? why : ''}|${poor ? 1 : 0}|${on ? 1 : 0}`;
      if (key === c.key) continue;
      c.key = key;
      c.el.classList.toggle('lock', lock); c.el.classList.toggle('poor', poor); c.el.classList.toggle('sel', on);
      c.el.setAttribute('aria-disabled', lock || poor ? 'true' : 'false');
      (c.el.querySelector('.bc') as HTMLElement).textContent = `${price} ₽`;
      (c.el.querySelector('.bq') as HTMLElement).textContent = `${have}/${cap}`;
      (c.el.querySelector('.bl') as HTMLElement).textContent = lock ? shortWhy(why!) : '';
    }
    // the base in one line, and «repair everything»
    const bl = sim.baseLevel(side), inc = bldIncome(sim, side);
    const sum = `База ${bl} ур. · построек ${caps.n}/${caps.max} · забор ${caps.walls}/${caps.wallMax}${inc > 0 ? ` · +${rub(inc)} ₽/с` : ''}`;
    if (this.sumEl.textContent !== sum) this.sumEl.textContent = sum;
    let rep = 0;
    for (const b of sim.st.bld) if (b.s === side && b.hp < b.mhp && b.up <= sim.st.tick) rep += repairCost(b);
    this.repBtn.hidden = rep <= 0;
    if (rep > 0) { const s = `Починить всё · ${rep} ₽`; if (this.repBtn.textContent !== s) this.repBtn.textContent = s; }
    this.chips[4].classList.toggle('need', bl === 0 && this.fam !== 4);
  }

  private paintBar() {
    const d = this.d;
    let n = '', w = '', ok = true, aim = this.mode === 'aim';
    if (aim) { n = this.name(BKEY.arbuzomet); w = 'Тапни по карте: туда прилетит арбуз'; }
    else {
      const ev = this.ev, t = this.placing, D = BUILDINGS[t];
      if (!D) return;
      n = `${this.name(t)} · ${ev.n > 1 ? `${ev.n} шт. · ` : ''}${ev.n ? ev.price : d.sim.bcost(d.side(), t, 1)} ₽`;
      ok = ev.n > 0;
      w = ok ? (D.line ? 'Тяни от забора пальцем — пойдёт линия. Потом ✓' : 'Тащи постройку пальцем, потом ✓') : d.deny(ev.why ?? 'Тут не построишь');
    }
    const key = `${n}|${w}|${ok ? 1 : 0}|${aim ? 1 : 0}`;
    if (key === this.barKey) return;
    this.barKey = key;
    (this.bar.querySelector('.bb-n') as HTMLElement).textContent = n;
    const we = this.bar.querySelector('.bb-w') as HTMLElement;
    we.textContent = w; we.classList.toggle('bad', !ok);
    const okb = this.bar.querySelector('.bb-ok') as HTMLElement;
    okb.hidden = aim; okb.classList.toggle('off', !ok);
  }

  private paintSel(now: number) {
    const d = this.d, sim = d.sim, side = d.side(), me = this.me(), b = sim.building(this.selId), tick = sim.st.tick;
    if (!b || !bldVisible(b, side)) { this.close(); return; }
    const D = BUILDINGS[b.t], tx = bldText(b.t, d.spicy()), own = b.s === side, building = b.up > tick, lvNow = Math.max(1, building ? b.lv - 1 : b.lv);
    let status = '';
    if (building) status = b.lv === 1 ? `строится: ${sec(b.up - tick)}` : `улучшается: ${sec(b.up - tick)}`;
    else if (D.fam === 'super') { const k = Math.min(1, (tick - b.v) / (D.key === 'sabvufer' ? BASE.subCharge : BASE.arbCharge)); status = !sim.bldOn(b) ? 'выключено' : k >= 1 ? 'заряжен' : `заряд ${Math.floor(k * 100)}%`; }
    else if (!sim.bldOn(b)) status = D.key === 'tesla' ? 'нет генератора или света' : 'выключено';
    else if (own && D.hid && !(b.f & BF.SEEN)) status = 'спрятано: чужие не видят';
    else if (D.fam === 'trap' && b.cd > tick) status = `взводится: ${sec(b.cd - tick)}`;
    const cur = bldStats(b.t, lvNow), canGrow = own && !building && b.lv < 3, nxt = canGrow ? bldStats(b.t, b.lv + 1) : null;
    const stats = cur.slice(1).map(([l, v], i) => { const nv = nxt?.[i + 1]?.[1]; return `<span class="bs-st">${esc(l)} <b>${esc(v)}${nv && nv !== v ? `<i> → ${esc(nv)}</i>` : ''}</b></span>`; }).join('');
    let btns = '';
    if (own) {
      const wu = sim.canUp(side, b.id, me), wr = sim.canRep(side, b.id, me), ws = sim.canSell(side, b.id, me);
      const up = b.lv >= 3 ? 'Макс. уровень' : `Улучшить · ${sim.bcost(side, b.t, b.lv + 1)} ₽`;
      const arm = now < this.sellArm;
      btns = `<button type="button" class="bs-b bs-up${wu ? ' off' : ''}" data-a="up">${up}</button>`
        + `<button type="button" class="bs-b bs-rep${wr ? ' off' : ''}" data-a="rep">${b.hp >= b.mhp ? 'Целое' : `Починить · ${repairCost(b)} ₽`}</button>`
        + `<button type="button" class="bs-b bs-sell${ws ? ' off' : ''}${arm ? ' arm' : ''}" data-a="sell">${arm ? `Точно? +${refund(b)} ₽` : `Продать · +${refund(b)} ₽`}</button>`;
      if (D.key === 'arbuzomet') btns = `<button type="button" class="bs-b bs-fire${sim.canFire(side, b.id, b.x, b.z, me) ? ' off' : ''}" data-a="fire">Огонь!</button>` + btns;
    }
    const hp = Math.max(0, Math.ceil(b.hp)), k = Math.max(0, Math.min(1, b.hp / b.mhp));
    const html = `<div class="bs-h"><i class="bi bi-${D.fam}">${FAMS[FAM_OF(b.t)].icon}</i><b class="bs-n s${b.s}">${esc(tx.name)}</b><span class="bs-lv">ур. ${b.lv}${own ? '' : ' · чужое'}</span><button type="button" class="bs-x" data-a="x" aria-label="Закрыть">${ICON.x}</button></div>`
      + `<div class="bs-hp"><span class="bs-bar"><i class="${k < 0.35 ? 'low' : ''}" style="width:${Math.round(k * 100)}%"></i></span><span class="num">${hp}/${b.mhp}</span>${status ? `<em>${esc(status)}</em>` : ''}</div>`
      + `<div class="bs-d">${esc(tx.blurb)}</div><div class="bs-stats">${stats}</div>`
      + (own ? `<div class="bs-btns">${btns}</div>` : `<div class="bs-d bs-foe">Выдели своих и ${this.touch ? 'тапни' : 'кликни правой'} по постройке: пойдут ломать</div>`);
    if (html === this.selKey) return;
    this.selKey = html;
    this.sel.innerHTML = html;
    this.sel.className = `bsel paper s${b.s}`;
  }

  // ---- sim events → effects, sounds, the feed ---------------------------------------------------------------
  /** true when the event belongs to the base (the caller's own handling is not needed). */
  fx(e: FxEv, now: number): boolean {
    const d = this.d, taken = d.base.fx(e, now), side = d.side();
    if (e.e === 'bld') {
      const D = BUILDINGS[e.t], mine = e.s === side, near = d.near(e.x, e.z, 70), spicy = d.spicy();
      if (!D) return true;
      const say = (kind: Parameters<typeof bldFeed>[0], prio: 0 | 1 | 2 | 3, n = e.n, gap = 5000) => { if (this.cool(kind + e.t + e.s, gap)) d.say('Прораб', bldFeed(kind, e.t, spicy, n), prio, mine ? side : e.s); };
      switch (e.k) {
        case 'put': if (mine ? now - this.putAt > 800 && near : near && !D.hid) d.sound.deploy(); break; // my own one sounded when sent
        case 'up': if (mine) d.sound.coin(); break;
        case 'done':
          if (!mine) break;
          if (!D.line) { d.sound.floorUp(); if (e.lv > 1) say('up', 1, e.lv); else say('built', 1); }
          break;
        case 'sell': if (mine) { d.sound.coin(); if (near) this.tipAt(e.x, e.z, `+${e.n} ₽`, 'tip-plus'); } break;
        case 'rep': if (mine) d.sound.coin(); break;
        case 'die':
          if (mine || near) d.sound.rumble();
          if (near) d.stage.shake(0.35);
          if (!D.line) { if (mine) say('lost', 2, 0, 2500); else { say('broke', 1, e.n, 2500); if (near && e.n > 0) this.tipAt(e.x, e.z, `+${e.n} ₽`, 'tip-plus'); } }
          if (this.selId === e.id) this.close();
          break;
        case 'trap': if (mine || near) d.sound.stamp(); if (mine) say('trap', 1, e.n, 8000); else say('trapped', 1, e.n, 8000); break;
        case 'seen': if (!mine) { if (near) d.sound.swish(); if (D.fam !== 'trap') say('seen', 0); } break;
        case 'hatch': if (mine || near) d.sound.cluck(3); break;
        case 'charge': if (mine) { d.sound.jingle(); say('charged', 2); if (D.key === 'arbuzomet') d.hud.note(`${this.name(e.t)} заряжен: выбери его и жми «Огонь!»`, 5200); } else say('theirCharged', 2); break;
        case 'stun': if (mine || near) d.sound.stamp(); break;
        case 'wave': d.sound.quake(); say('wave', 2, e.n); break;
        case 'fire': d.sound.whoosh(); say('fire', 2); break;
      }
    } else if (e.e === 'zap') { const b = d.sim.building(e.id); if (b && d.near(b.x, b.z, 60)) d.sound.swish(); }
    else if (e.e === 'shot' && taken) { if (d.near(e.x, e.z, 60)) d.sound.shot(0); }
    else if (e.e === 'newWar') this.reset();
    return taken;
  }
  private tipAt(x: number, z: number, text: string, cls = '') {
    const d = this.d;
    d.stage.project(x, heightY(d.terrain, x, z) + 2.4, z, this.pr);
    if (this.pr.vis) d.hud.tip(this.pr.x, this.pr.y, text, cls);
  }

  /** A new session or war: out of build mode; the views are rebuilt from the state. */
  reset() { this.close(); this.d.base.reset(); this.rowKey = ''; }
}
