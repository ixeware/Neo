// «Кто в игре»: a paper card listing who is online (nickname, side ink, what they do: «ведёт
// Борца», «выделил 12», «смотрит»), the nickname field, and the «<ник> ведёт» tags over every
// possessed unit (in that player's side ink). Data: a PresenceSource (src/net/presence.ts) plus
// the sim: who drives which unit is the sim's word (U.o.p = Player.n → State.players → pid → roster).
import { OM, type Sim } from '../sim/sim';
import type { Side } from '../sim/defs';
import type { Stage } from '../render/scene';
import type { UnitView } from '../render/units';
import type { PresenceSource, RosterEntry } from '../net/presence';
import { cleanNick, NICK_MAX } from '../net/presence';
import type { Hud } from './hud';
import { unitLabel } from './hud';

export interface RosterDeps {
  sim: Sim; stage: Stage; units: UnitView; hud: Hud; root: HTMLElement; labels: HTMLElement;
  side(): Side;
  pid(): string;
  playing(): boolean;
  nick(): string;
  setNick(n: string): void;
  /** The unit this player rides in first person (its own tag is hidden then), -1 none. */
  riding(): number;
  /** How many units this player has selected (their own row is live, not from presence). */
  selected(): number;
}

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 20c.6-4.4 2.6-6.5 5.5-6.5s4.9 2.1 5.5 6.5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.6 13.7c.5-.1.9-.2 1.4-.2 2.3 0 3.9 1.8 4.4 5.5"/></svg>';
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

interface Tag { el: HTMLElement; id: number; key: string; seen: number }

export class Roster {
  private list: RosterEntry[] = [];
  private unsub: (() => void) | null = null;
  private card: HTMLElement; private rows: HTMLElement; private head: HTMLElement; private input: HTMLInputElement;
  private open = false; private paintAt = 0;
  private tags = new Map<number, Tag>();
  private frame = 0;
  private pr = { x: 0, y: 0, vis: false };
  btn: HTMLButtonElement;

  constructor(private d: RosterDeps) {
    this.btn = d.hud.addTool(ICON, 'Кто в игре', () => this.toggle());
    this.btn.classList.add('tb-roster');
    const c = this.card = h('div', 'roster paper');
    c.hidden = true;
    c.innerHTML = `<div class="ro-h"><b>Кто в игре</b><span class="ro-n"></span><button type="button" class="ro-x" aria-label="Закрыть">×</button></div>
      <ul class="ro-list"></ul>
      <label class="ro-nick"><span>Твой ник</span><input type="text" maxlength="${NICK_MAX}" autocomplete="off" spellcheck="false" placeholder="Ты"></label>`;
    this.rows = c.querySelector('.ro-list')!; this.head = c.querySelector('.ro-n')!; this.input = c.querySelector('input')!;
    c.addEventListener('pointerdown', e => e.stopPropagation());
    c.querySelector('.ro-x')!.addEventListener('click', () => this.toggle(false));
    const save = () => { const n = cleanNick(this.input.value); this.input.value = n; if (n !== d.nick()) { d.setNick(n); this.paint(); } };
    this.input.addEventListener('change', save);
    this.input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { save(); this.input.blur(); } if (e.key === 'Escape') this.input.blur(); });
    this.input.addEventListener('keyup', e => e.stopPropagation());
    d.root.append(c);
  }

  /** Listen to a new presence source (new session or transport). */
  attach(src: PresenceSource) {
    this.unsub?.();
    this.list = [];
    this.unsub = src.onRoster(l => { this.list = l; if (this.open) this.paint(); });
  }

  toggle(on = !this.open) {
    this.open = on;
    this.card.hidden = !on;
    this.btn.classList.toggle('on', on);
    if (on) { this.input.value = this.d.nick(); this.paint(); }
  }

  /** Display name of whoever has player number n in the sim (null when nobody known). */
  nameOf(n: number): { name: string; me: boolean } | null {
    const st = this.d.sim.st;
    let pid = '';
    for (const k of Object.keys(st.players)) if (st.players[k].n === n) { pid = k; break; }
    if (!pid) return null;
    if (pid === this.d.pid()) return { name: this.d.nick() || 'Ты', me: true };
    const e = this.list.find(x => x.pid === pid);
    return { name: e?.name || `Игрок ${n + 1}`, me: false };
  }

  private status(e: RosterEntry): string {
    const sim = this.d.sim;
    const me = e.pid === this.d.pid();
    const ctl = me ? this.d.riding() : e.ctl ?? -1;
    let u = ctl > 0 ? sim.unit(ctl) : undefined;
    if (!me && !(u && u.o?.m === OM.POSSESS)) { // the sim's word beats a stale presence field
      const n = sim.st.players[e.pid]?.n;
      u = n === undefined ? undefined : sim.st.units.find(q => q.o?.m === OM.POSSESS && q.o.p === n && q.hp > 0);
    }
    if (u && u.hp > 0 && u.o?.m === OM.POSSESS) return `ведёт: ${unitLabel(u.t, u.s as Side)}`;
    const sel = me ? this.d.selected() : e.sel ?? 0;
    if (sel > 0) return `выделил ${sel}`;
    return 'смотрит';
  }

  private paint() {
    this.paintAt = performance.now();
    const me = this.d.pid(), sim = this.d.sim;
    const list = [...this.list];
    if (!list.some(e => e.pid === me)) list.unshift({ pid: me, name: this.d.nick(), side: this.d.playing() ? this.d.side() : -1, me: true });
    // players the sim heard from in the last 2 minutes but the presence transport does not list (no names there)
    const st = sim.st;
    for (const pid of Object.keys(st.players)) {
      const p = st.players[pid];
      if (pid === me || list.some(e => e.pid === pid) || st.tick - Math.max(p.last, p.joined) > 1200) continue;
      let ctl = 0;
      for (const u of st.units) if (u.o && u.o.m === OM.POSSESS && u.o.p === p.n && u.hp > 0) { ctl = u.id; break; }
      list.push({ pid, name: `Игрок ${p.n + 1}`, side: p.s, ...(ctl ? { ctl } : {}) });
    }
    list.sort((a, b) => (a.pid === me ? -1 : b.pid === me ? 1 : 0) || a.side - b.side);
    const rows: string[] = [];
    const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
    for (const e of list) {
      const isMe = e.pid === me, side = isMe && this.d.playing() ? this.d.side() : e.side;
      rows.push(`<li class="ro-row s${side}"><i class="ro-dot"></i><b class="ro-name"></b>${isMe ? '<span class="ro-me">ты</span>' : ''}<span class="ro-st">${esc(this.status(e))}</span></li>`);
    }
    // the AI commanders, when a side has one
    for (const s of [0, 1] as Side[]) if (sim.aiActive(s)) rows.push(`<li class="ro-row s${s} ro-ai"><i class="ro-dot"></i><b class="ro-name">ИИ</b><span class="ro-st">командует ${s === 0 ? 'Атагами' : 'Курчалоем'}</span></li>`);
    this.rows.innerHTML = rows.join('');
    // names as text (untrusted)
    const names = this.rows.querySelectorAll('.ro-row:not(.ro-ai) .ro-name');
    list.forEach((e, i) => { if (names[i]) names[i].textContent = e.pid === me ? (this.d.nick() || 'Ты') : (e.name || 'Игрок'); });
    const n = list.length;
    this.head.textContent = n === 1 ? 'только ты' : `${n} в сети`;
  }

  /** Every frame: the «<ник> ведёт» tags; the open card refreshes about once a second. */
  update(now: number) {
    if (this.open && now - this.paintAt > 1000) this.paint();
    this.frame++;
    const st = this.d.sim.st, seen = this.frame, riding = this.d.riding();
    const playing = this.d.playing();
    if (playing && (!this.d.stage.lowPower || (this.frame & 1) === 0)) {
      for (const u of st.units) {
        const o = u.o;
        if (!o || o.m !== OM.POSSESS || u.hp <= 0) continue;
        const who = this.nameOf(o.p!);
        if (!who) continue;
        let t = this.tags.get(u.id);
        const key = `${who.name}|${u.s}|${who.me ? 1 : 0}`;
        if (!t) { t = { el: h('div', 'lbl lbl-drive'), id: u.id, key: '', seen }; this.d.labels.append(t.el); this.tags.set(u.id, t); }
        t.seen = seen;
        if (t.key !== key) {
          t.key = key;
          t.el.className = `lbl lbl-drive s${u.s}${who.me ? ' me' : ''}`;
          t.el.textContent = who.me ? `${who.name === 'Ты' ? 'ты' : who.name} ведёшь` : `${who.name} ведёт`;
        }
        const p = this.d.units.renderPos(u.id);
        if (!p || u.id === riding) { t.el.style.display = 'none'; continue; }
        this.d.stage.project(p.x, p.y + p.top + 1.1, p.z, this.pr);
        if (!this.pr.vis) { t.el.style.display = 'none'; continue; }
        t.el.style.display = '';
        t.el.style.transform = `translate(${this.pr.x.toFixed(1)}px, ${this.pr.y.toFixed(1)}px) translate(-50%, -100%)`;
      }
    }
    for (const [id, t] of this.tags) if (!playing || seen - t.seen > 2) { t.el.remove(); this.tags.delete(id); }
  }
}
