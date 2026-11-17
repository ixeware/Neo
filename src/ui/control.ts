// Unit control, Red Alert 2 style, on top of the auto behaviour (units still pick their own goals
// until a player orders them; «Авто» gives them back):
//   desktop  click own unit = select (Shift adds), drag a box on the ground = select own units,
//            double-click = every own unit of that type on screen, right click = go / hit,
//            A then click = attack-move, S = stop (hold), G = auto, Ctrl+1..9 = remember a group,
//            Shift+1..9 = call it back (twice = fly there), V = ride the selected unit, Esc = clear.
//   phone    tap own unit = select (more taps add), long-press then drag = box, with a selection
//            tap ground = go and tap an enemy = hit; the command bar does the rest:
//            [Атака с ходу] [Стоп] [Авто] [Все мои] [Вселиться] [×] [1] [2] [3] (long-press saves).
// A deck card in hand always wins: the tap deploys. Orders go out as Cmd 'ord' (src/sim/sim.ts);
// only this player's own selection is drawn (src/render/selection.ts).
import './control.css';
import { canControl, OM, ORD_MAX, type OrdMode, type Sim, type U } from '../sim/sim';
import { UNITS, type Side } from '../sim/defs';
import type { Stage, InputMods } from '../render/scene';
import type { UnitView } from '../render/units';
import { SelectionView } from '../render/selection';
import type { Session, CmdBody } from '../net/session';
import type { Hud } from './hud';
import { unitLabel } from './hud';
import { Possess } from './fp';
import type { Terrain } from '../world/terrain';

export interface ControlDeps {
  sim: Sim; stage: Stage; units: UnitView; hud: Hud; terrain: Terrain; root: HTMLElement;
  session(): Session | null;
  side(): Side;
  pid(): string;
  playing(): boolean;
  sound: { click(): void; deny(): void };
  /** This player's presence changed (selection size, ridden unit). */
  onPresence?(p: { sel?: number; ctl?: number }): void;
}

const ICON = {
  amove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/></svg>',
  hold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M9 12h6"/></svg>',
  auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 12a8 8 0 01-14 5.3M4 12a8 8 0 0114-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/></svg>',
  all: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="7" r="2.6"/><circle cx="16" cy="7" r="2.6"/><path d="M3.5 19c.5-4 2.2-6 4.5-6s4 2 4.5 6M11.5 19c.5-4 2.2-6 4.5-6s4 2 4.5 6"/></svg>',
  fp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const touchUi = () => matchMedia?.('(pointer: coarse)').matches ?? false;

export class Control {
  /** This player's selection, in the order it was made. */
  readonly sel = new Set<number>();
  private groups: number[][] = Array.from({ length: 10 }, () => []);
  /** «Атака с ходу» armed: the next click on the map is an attack-move. */
  amove = false;
  view: SelectionView;
  fp: Possess;
  private bar: HTMLElement;
  private countEl: HTMLElement;
  private groupBtns: HTMLButtonElement[] = [];
  private boxEl: HTMLElement;
  private lastTap = { t: 0, x: 0, y: 0, id: -1, prev: [] as number[] };
  private lastRecall = { g: -1, t: 0 };
  private barKey = '';
  private hoverAt: { x: number; y: number } | null = null; private hoverRaf = 0;
  private pubSel = -1; private pubAt = 0;
  private pr = { x: 0, y: 0, vis: false };

  constructor(private d: ControlDeps) {
    this.view = new SelectionView(d.terrain, d.sim, d.units, d.stage.lowPower);
    d.stage.scene.add(this.view.group);
    this.fp = new Possess({ ...d, onPresence: p => d.onPresence?.(p) });
    // the command bar
    this.bar = h('div', 'cmdbar');
    this.bar.hidden = true;
    this.bar.addEventListener('pointerdown', e => e.stopPropagation());
    this.countEl = h('button', 'cb-n paper');
    (this.countEl as HTMLButtonElement).type = 'button';
    this.countEl.title = 'Снять выделение';
    this.countEl.addEventListener('click', () => this.clear());
    const grid = h('div', 'cb-grid');
    const btn = (key: string, icon: string, label: string, title: string, fn: () => void) => {
      const b = h('button', `cb cb-${key} paper`, `${icon}<span>${label}</span>`) as HTMLButtonElement;
      b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
      b.addEventListener('click', () => { fn(); });
      grid.append(b);
      return b;
    };
    btn('amove', ICON.amove, 'Атака с ходу', 'Атака с ходу (A): идут и бьют всех по пути', () => this.armAmove(!this.amove));
    btn('hold', ICON.hold, 'Стоп', 'Стоп (S): стоят и бьют, кто подойдёт', () => this.issue('hold'));
    btn('auto', ICON.auto, 'Авто', 'Авто (G): сами выбирают, куда идти', () => this.issue('auto'));
    btn('all', ICON.all, 'Все мои', 'Выделить всех своих', () => this.selectAll());
    btn('fp', ICON.fp, 'Вселиться', 'Вселиться (V): управлять от первого лица', () => this.possessSelected());
    btn('x', ICON.x, 'Снять', 'Снять выделение (Esc)', () => this.clear());
    for (let g = 1; g <= 3; g++) this.groupBtns.push(this.groupButton(g, grid));
    this.bar.append(this.countEl, grid);
    d.root.append(this.bar);
    this.boxEl = h('div', 'selbox');
    this.boxEl.hidden = true;
    document.body.append(this.boxEl);
  }

  /** [1] [2] [3]: tap calls the group back, a long press (or right click) remembers the selection. */
  private groupButton(g: number, parent: HTMLElement): HTMLButtonElement {
    const b = h('button', 'cb cb-g paper', `<b class="num">${g}</b><i></i>`) as HTMLButtonElement;
    b.type = 'button'; b.title = `Группа ${g}: тап — выделить, долгое нажатие — запомнить (Ctrl+${g} / Shift+${g})`;
    let lp = 0, saved = false;
    b.addEventListener('pointerdown', () => { saved = false; clearTimeout(lp); lp = window.setTimeout(() => { saved = true; this.saveGroup(g); try { navigator.vibrate?.(12); } catch { /* not allowed */ } }, 500); });
    const stop = () => clearTimeout(lp);
    b.addEventListener('pointerup', stop); b.addEventListener('pointerleave', stop); b.addEventListener('pointercancel', stop);
    b.addEventListener('contextmenu', e => { e.preventDefault(); stop(); saved = true; this.saveGroup(g); });
    b.addEventListener('click', () => { if (saved) { saved = false; return; } this.recall(g); });
    parent.append(b);
    return b;
  }

  // ---- what may be selected / ordered ----------------------------------------------------
  private myN() { return this.d.sim.st.players[this.d.pid()]?.n ?? -1; }
  /** Own unit this player may order now. */
  private mine(u: U | undefined): u is U {
    if (!u || u.hp <= 0 || u.s !== this.d.side() || !canControl(u.t)) return false;
    return !(u.o && u.o.m === OM.POSSESS && u.o.p !== this.myN());
  }
  /** Screen position of a unit's middle and its picking radius (px). */
  private screen(u: U, touch: boolean): { x: number; y: number; r: number } | null {
    const p = this.d.units.renderPos(u.id);
    if (!p) return null;
    const pr = this.pr;
    this.d.stage.project(p.x, p.y + p.top * 0.5, p.z, pr);
    if (!pr.vis) return null;
    const x = pr.x, y = pr.y;
    this.d.stage.project(p.x, p.y + p.top, p.z, pr);
    return { x, y, r: Math.max(touch ? 26 : 15, Math.abs(y - pr.y) * 1.25) };
  }
  /** The unit under a screen point: own (controllable) or enemy, closest relative to its size. */
  pickAt(x: number, y: number, touch: boolean, want: 'own' | 'enemy'): U | null {
    let best: U | null = null, bs = 1;
    const side = this.d.side();
    for (const u of this.d.sim.st.units) {
      if (u.hp <= 0) continue;
      if (want === 'own' ? !this.mine(u) : u.s === side) continue;
      const p = this.screen(u, touch);
      if (!p) continue;
      const s = Math.hypot(x - p.x, y - p.y) / p.r;
      if (s < bs) { bs = s; best = u; }
    }
    return best;
  }

  // ---- selection ------------------------------------------------------------------------------
  setSel(ids: Iterable<number>, add = false) {
    if (!add) this.sel.clear();
    for (const id of ids) this.sel.add(id);
    if (!this.sel.size) this.armAmove(false);
  }
  clear() { this.sel.clear(); this.armAmove(false); }
  selectAll() {
    const ids = this.d.sim.st.units.filter(u => this.mine(u)).map(u => u.id);
    this.setSel(ids);
    this.d.sound.click();
    this.d.hud.note(ids.length ? `Все свои: ${ids.length}` : 'Своих на поле нет');
  }
  private typeOnScreen(t: number): number[] {
    const out: number[] = [];
    for (const u of this.d.sim.st.units) if (u.t === t && this.mine(u) && this.screen(u, false)) out.push(u.id);
    return out;
  }
  private saveGroup(g: number) {
    const ids = [...this.sel].filter(id => this.mine(this.d.sim.unit(id)));
    if (!ids.length) { this.d.hud.note(`Группа ${g}: сначала выдели своих`); return; }
    this.groups[g] = ids;
    this.d.sound.click();
    this.d.hud.note(`Группа ${g} запомнена: ${ids.length}`);
    this.barKey = '';
  }
  private recall(g: number) {
    const ids = this.groups[g].filter(id => this.mine(this.d.sim.unit(id)));
    this.groups[g] = ids;
    if (!ids.length) { this.d.hud.note(touchUi() ? `Группа ${g} пустая: долгое нажатие — запомнить` : `Группа ${g} пустая: Ctrl+${g} — запомнить`); return; }
    const now = performance.now();
    if (this.lastRecall.g === g && now - this.lastRecall.t < 600) { // twice: fly to them
      let x = 0, z = 0;
      for (const id of ids) { const u = this.d.sim.unit(id)!; x += u.x; z += u.z; }
      this.d.stage.flyTo(x / ids.length, z / ids.length, Math.min(this.d.stage.dist, 70));
    }
    this.lastRecall = { g, t: now };
    this.setSel(ids);
    this.d.sound.click();
  }

  // ---- orders --------------------------------------------------------------------------------
  private submit(b: CmdBody) { this.d.session()?.submit(b); }
  /** Orders the selection. Returns false when there is nobody to order. */
  issue(m: OrdMode, x?: number, z?: number, tg?: number): boolean {
    const sim = this.d.sim, side = this.d.side();
    let list = [...this.sel].map(id => sim.unit(id)).filter((u): u is U => this.mine(u));
    if (!list.length) { this.d.sound.deny(); this.d.hud.note('Некого: выдели своих'); return false; }
    if (m === 'move' || m === 'attackMove') {
      // formation slots: rows by z, each row by x, so the group keeps its shape
      const cols = Math.ceil(Math.sqrt(list.length));
      list = list.sort((a, b) => a.z - b.z || a.id - b.id);
      const rows: U[] = [];
      for (let i = 0; i < list.length; i += cols) rows.push(...list.slice(i, i + cols).sort((a, b) => a.x - b.x || a.id - b.id));
      list = rows;
    }
    const ids = list.map(u => u.id), r = (v: number) => Math.round(v * 100) / 100;
    for (let i = 0; i < ids.length; i += ORD_MAX) {
      const body: Record<string, unknown> = { k: 'ord', s: side, ids: ids.slice(i, i + ORD_MAX), m };
      if (x !== undefined && z !== undefined) { body.x = r(x); body.z = r(z); body.fi = i; body.fn = ids.length; }
      if (tg !== undefined) body.tg = tg;
      this.submit(body as unknown as CmdBody);
    }
    this.d.sound.click();
    const n = ids.length, who = n === 1 ? unitLabel(list[0].t, side) : `${n} юн.`;
    if (m === 'move') { this.view.mark('move', x!, z!); }
    else if (m === 'attackMove') { this.view.mark('amove', x!, z!); this.d.hud.note(`${who}: атака с ходу`, 1600); }
    else if (m === 'attack') { const t = sim.unit(tg!); if (t) this.view.mark('attack', t.x, t.z, t.id); }
    else if (m === 'hold') this.d.hud.note(`${who}: стоят на месте`, 1600);
    else if (m === 'auto') this.d.hud.note(`${who}: снова сами`, 1600);
    if (m !== 'attackMove') this.armAmove(false);
    return true;
  }
  armAmove(on: boolean) {
    if (on && !this.sel.size) { this.d.hud.note('Сначала выдели своих'); return; }
    this.amove = on;
    this.d.stage.canvas.classList.toggle('cur-amove', on);
    this.bar.querySelector('.cb-amove')?.classList.toggle('on', on);
    if (on) this.d.hud.note(touchUi() ? 'Атака с ходу: тапни, куда идти' : 'Атака с ходу: кликни, куда идти', 2400);
  }
  /** Ride a selected unit (the only one, else the first). */
  possessSelected(id?: number) {
    const u = id !== undefined ? this.d.sim.unit(id) : [...this.sel].map(i => this.d.sim.unit(i)).find(x => this.mine(x));
    if (!this.mine(u)) { this.d.sound.deny(); this.d.hud.note('Выдели своего, чтобы вселиться'); return; }
    this.armAmove(false);
    this.fp.enter(u.id);
  }

  // ---- input (from bindInput via main.ts) -------------------------------------------------------
  /**
   * A tap or left click on the map when no deck card is in hand. Returns false when it meant nothing
   * (no selection and no unit there), so the caller can explain.
   */
  tap(x: number, y: number, m: InputMods): boolean {
    if (!this.d.playing()) return false;
    const now = performance.now();
    const own = this.pickAt(x, y, m.touch, 'own');
    const foe = own ? null : this.pickAt(x, y, m.touch, 'enemy');
    if (this.amove) {
      if (foe) this.issue('attack', undefined, undefined, foe.id);
      else { const p = this.d.stage.pick(x, y); if (p) this.issue('attackMove', p.x, p.z); }
      this.armAmove(false);
      return true;
    }
    if (own) {
      const lt = this.lastTap, dbl = lt.id === own.id && now - lt.t < 340 && Math.hypot(x - lt.x, y - lt.y) < 30;
      if (dbl) {
        this.lastTap = { t: 0, x, y, id: -1, prev: [] };
        if (lt.prev.length === 1 && lt.prev[0] === own.id) { this.possessSelected(own.id); return true; }
        this.setSel(this.typeOnScreen(own.t));
        this.d.sound.click();
        this.d.hud.note(`${unitLabel(own.t, own.s as Side)}: ${this.sel.size} на экране`, 1600);
        return true;
      }
      this.lastTap = { t: now, x, y, id: own.id, prev: [...this.sel] };
      if (m.touch) this.sel.add(own.id);
      else if (m.shift) { if (this.sel.has(own.id)) this.sel.delete(own.id); else this.sel.add(own.id); }
      else this.setSel([own.id]);
      this.d.sound.click();
      return true;
    }
    if (!this.sel.size) return false;
    if (m.touch || foe) { // phone: a tap with a selection is an order; a click on an enemy is one too
      if (foe) this.issue('attack', undefined, undefined, foe.id);
      else { const p = this.d.stage.pick(x, y); if (p) this.issue('move', p.x, p.z); }
      return true;
    }
    this.clear(); // desktop: a click on empty ground lets go
    return true;
  }

  /** Short right click: go there, or hit the enemy under the cursor. */
  order(x: number, y: number) {
    if (!this.d.playing() || !this.sel.size) return;
    const foe = this.pickAt(x, y, false, 'enemy');
    if (this.amove) { this.armAmove(false); }
    if (foe) { this.issue('attack', undefined, undefined, foe.id); return; }
    const p = this.d.stage.pick(x, y);
    if (p) this.issue('move', p.x, p.z);
  }

  box(phase: 'start' | 'move' | 'end' | 'cancel', x0: number, y0: number, x1: number, y1: number, m: InputMods) {
    const el = this.boxEl;
    if (phase === 'cancel' || !this.d.playing()) { el.hidden = true; return; }
    const l = Math.min(x0, x1), t = Math.min(y0, y1), w = Math.abs(x1 - x0), hh = Math.abs(y1 - y0);
    if (phase !== 'end') {
      el.hidden = false;
      el.style.transform = `translate(${l}px, ${t}px)`; el.style.width = `${w}px`; el.style.height = `${hh}px`;
      return;
    }
    el.hidden = true;
    if (w < 6 && hh < 6) return;
    const ids: number[] = [];
    for (const u of this.d.sim.st.units) {
      if (!this.mine(u)) continue;
      const p = this.screen(u, m.touch);
      if (p && p.x >= l && p.x <= l + w && p.y >= t && p.y <= t + hh) ids.push(u.id);
    }
    this.setSel(ids, !m.touch && m.shift);
    if (ids.length) { this.d.sound.click(); this.d.hud.note(`Выделено: ${this.sel.size}`, 1400); }
  }

  hover(x: number, y: number) {
    this.hoverAt = { x, y };
    if (this.hoverRaf) return;
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = 0;
      const a = this.hoverAt, c = this.d.stage.canvas;
      if (!a || !this.d.playing() || this.fp.on) { c.classList.remove('cur-own', 'cur-foe'); return; }
      const own = this.pickAt(a.x, a.y, false, 'own'), foe = !own && this.sel.size ? this.pickAt(a.x, a.y, false, 'enemy') : null;
      c.classList.toggle('cur-own', !!own); c.classList.toggle('cur-foe', !!foe);
    });
  }

  /** Keys that are commands right now and must not move the camera. */
  keyBusy(code: string): boolean {
    if (this.fp.on) return true;
    return this.sel.size > 0 && (code === 'KeyA' || code === 'KeyS');
  }

  /** Keyboard; true when the key was a control command (the caller then ignores it). */
  key(e: KeyboardEvent): boolean {
    if (!this.d.playing() || (e.target as HTMLElement)?.tagName === 'INPUT') return false;
    if (this.fp.on) return this.fp.key(e);
    const dg = /^Digit([1-9])$/.exec(e.code);
    if (dg && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.saveGroup(Number(dg[1])); return true; }
    if (dg && e.shiftKey) { e.preventDefault(); this.recall(Number(dg[1])); return true; }
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
    if (e.code === 'Escape') { if (this.amove) { this.armAmove(false); return true; } this.clear(); return false; }
    if (!this.sel.size) return false;
    switch (e.code) {
      case 'KeyA': this.armAmove(true); return true;
      case 'KeyS': this.issue('hold'); return true;
      case 'KeyG': this.issue('auto'); return true;
      case 'KeyV': this.possessSelected(); return true;
    }
    return false;
  }

  /** Every frame, after units.update(). */
  update(now: number, dt: number) {
    const sim = this.d.sim;
    // dead, gone or taken over units leave the selection
    for (const id of this.sel) if (!this.mine(sim.unit(id))) this.sel.delete(id);
    if (!this.sel.size && this.amove) this.armAmove(false);
    this.fp.update(now, dt);
    const show = this.d.playing() && !this.fp.on;
    this.d.units.alwaysBar = this.sel.size ? this.sel : null;
    this.view.update(show ? this.sel : [], now, this.d.units.zoomK, this.fp.on ? this.fp.id : -1);
    // the bar: only while something is selected
    const n = show ? this.sel.size : 0;
    const key = `${n}|${this.groups.slice(1, 4).map(g => g.length).join(',')}`;
    if (key !== this.barKey) {
      this.barKey = key;
      this.bar.hidden = n === 0;
      this.d.root.classList.toggle('has-sel', n > 0);
      if (n) this.countEl.innerHTML = `<b class="num">${n}</b> <span>${n === 1 ? this.oneName() : 'выделено'}</span>`;
      this.groupBtns.forEach((b, i) => { (b.querySelector('i') as HTMLElement).textContent = this.groups[i + 1].length ? String(this.groups[i + 1].length) : ''; });
    }
    if (this.sel.size !== this.pubSel && now - this.pubAt > 500) { this.pubSel = this.sel.size; this.pubAt = now; this.d.onPresence?.({ sel: this.sel.size }); }
  }
  private oneName(): string {
    const u = this.d.sim.unit(this.sel.values().next().value!);
    return u ? unitLabel(u.t, u.s as Side) : 'выделен';
  }

  /** New war or new session: nothing selected, nobody ridden, no groups. */
  reset() {
    this.fp.exit(false);
    this.clear();
    this.groups = Array.from({ length: 10 }, () => []);
    this.view.clear();
    this.view.setSide(this.d.side());
    this.d.root.classList.toggle('s1', this.d.side() === 1);
    this.barKey = '';
  }
}

/** For tests and the roster: a unit's type name as players see it. */
export const typeName = (t: number, s: Side) => (UNITS[t] ? unitLabel(t, s) : '');
