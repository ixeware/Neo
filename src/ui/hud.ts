// HUD: notebook slips around the map. DOM is refreshed ~10×/s, not every frame.
import { UNITS, HQ, CARDS, VOTERS, SIDE_FULL, SHOP, EVENTS, EVENT_EVERY, canBuy, type Side } from '../sim/defs';
import { cardTitle, type Sim } from '../sim/sim';
import { SIDE_TAG } from '../data/lore';
import { HEROES, heroForUnit } from '../data/heroes';
import type { Portraits } from './portraits';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const fmt = (n: number) => Math.floor(n).toLocaleString('ru-RU').replace(/,/g, ' ');
const mmss = (ticks: number) => { const s = Math.max(0, Math.ceil(ticks / 10)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Keyboard order across both tabs: 1–9, 0, then - and =. */
export const DECK_KEYS = '1234567890-=';

/** Short handwritten initials for portrait fallbacks (types without a rendered portrait yet). */
const INITIALS: Record<number, [string, string]> = {
  0: ['П×3', 'П×3'], 1: ['Бр', 'Бр'], 2: ['Сн', 'Мг'], 3: ['Бар', 'Км'], 4: ['Бл', 'Шм'], 5: ['Ис', 'Зу'],
  6: ['Ч5.5', 'Ч5.5'], 7: ['WOU', 'WOU'], 8: ['адм', 'адм'], 9: ['ers', 'ers'], 10: ['Бх', 'Бх'], 11: ['Ад', 'Ад'],
  12: ['Мх', 'Мх'], 13: ['Гл', 'Гл'], 14: ['Тк', 'Мр'], 15: ['Кр', 'Кр'],
};
/** <img> of the unit portrait, or a side-coloured tile with initials when there is none. */
export function portraitHtml(p: Portraits, s: Side, t: number, cls = 'pimg', tone: number = s): string {
  const src = t === 5 ? p.bosses?.[s] : p.units?.[s]?.[t];
  if (src) return `<img class="${cls}" alt="" draggable="false" src="${src}">`;
  const ini = INITIALS[t]?.[s] ?? UNITS[t]?.name[s].slice(0, 2) ?? '?';
  return `<span class="${cls} pf t${tone}" aria-hidden="true"><span>${esc(ini)}</span></span>`;
}

/** One line on what the unit does (for the info card). */
export function unitRole(t: number, s: Side): string {
  const d = UNITS[t];
  switch (d.key) {
    case 'squad': return 'Пехота: трое за одну цену';
    case 'wrestler': return 'Держит линию, отбрасывает';
    case 'ranged': return s === 0 ? 'Стрелок: бьёт издалека и больно' : 'Стрелок: гантель бьёт по площади';
    case 'fast': return 'Быстрый таран, отбрасывает';
    case 'healer': return 'Лечит своих рядом';
    case 'ride': return `Транспорт: везёт ${d.carry![s]} пацанов к селу и уезжает. Сам не дерётся`;
    case 'chimaev': return 'Бежит только к вражеской высотке и бьёт её втрое. «Землетряс» достаёт и её';
    case 'wou': return 'Враги рядом бьют только его. Пока жив, +2 ₽/с. «Взломать Пентагон»: турель и доход соседей — ноль';
    case 'admin': return '«Н»: враги рядом стоят 3 секунды. Свои рядом ходят быстрее';
    case 'ersno': return 'Огромный танк. Каждым ударом отбрасывает';
    case 'bekhan': return 'Свои рядом получают на 15% меньше урона. Раз за жизнь ест лагман: +50% здоровья';
    case 'adam': return 'Не дерётся, от драки убегает. Село берёт за четверых';
    case 'mohmad': return 'Приводит Голема. Голем падает — камни летят во все стороны';
  }
  return ['Ближний бой', 'Дальний бой', 'Быстрый', 'Лечит', 'Босс'][d.kind] ?? '';
}

const ICON = {
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9c1.5 1.5 1.5 4.5 0 6M19 6c3 3 3 9 0 12"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path d="M10 18V5l10-2v13"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 21V9l8-6 8 6v12z"/><path d="M10 21v-6h4v6"/></svg>',
};

export interface HudOpts {
  portraits: Portraits;
  onCard(t: number): void;
  onTab?(k: number): void;
  onVote(o: number): void;
  onMenu(): void;
  onSound(): boolean;
  onMusic(): boolean;
  onHome(): void;
}

export class Hud {
  root: HTMLElement;
  side: Side = 0;
  selected = -1;
  private sides: HTMLElement[] = [];
  private towers: HTMLElement[] = [];
  private stats: HTMLElement[] = [];
  private scoreEl: HTMLElement; private warEl: HTMLElement; private clockEl: HTMLElement;
  private moneyEl: HTMLElement; private incEl: HTMLElement;
  private cards = new Map<number, HTMLButtonElement>();
  private deck: HTMLElement;
  private tabBtns: HTMLButtonElement[] = [];
  private rows: HTMLElement[] = [];
  private tab = 0;
  private tabTypes: number[][] = [[], []];
  /** Deck order for keys 1–0, - and =. */
  order: number[] = [];
  private blocked = new Map<number, string>();
  private info: HTMLElement;
  private infoT = 0;
  private evEl: HTMLElement;
  private evKey = '';
  private tipT = 0;
  private vote: HTMLElement;
  private feed: HTMLElement;
  private overEl: HTMLElement | null = null;
  private hintEl: HTMLElement;
  miniCanvas: HTMLCanvasElement;
  private voteKey = '';
  private lastPaint = 0;

  constructor(root: HTMLElement, private o: HudOpts) {
    this.root = root;
    root.innerHTML = '';
    const top = h('div', 'top');
    for (const s of [0, 1] as Side[]) {
      const el = h('div', `side s${s} paper ${s ? 'k' : 'a'}`);
      const tower = h('div', 'tower');
      const who = h('div', 'who');
      who.innerHTML = `<span class="vname">${SIDE_TAG[s].short}</span><span class="hqn">${SIDE_TAG[s].hq}</span>`;
      const st = h('span', 'stat');
      who.append(st);
      el.append(tower, who);
      this.sides.push(el); this.towers.push(tower); this.stats.push(st);
    }
    const center = h('div', 'center');
    const score = h('div', 'score paper');
    this.warEl = h('span', 'war');
    this.scoreEl = h('span', 'num');
    score.append(this.warEl, this.scoreEl);
    this.clockEl = h('div', 'clock');
    this.evEl = h('div', 'evchip');
    this.evEl.hidden = true;
    center.append(score, this.clockEl, this.evEl);
    top.append(this.sides[0], center, this.sides[1]);

    const bank = h('div', 'bank paper');
    this.moneyEl = h('span', 'money num');
    this.incEl = h('span', 'inc');
    bank.append(this.moneyEl, this.incEl);

    this.deck = h('div', 'deck');
    const tabs = h('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    ['Юниты', 'Пацаны'].forEach((label, k) => {
      const b = h('button', 'tab', `<span>${label}</span><i class="tab-n"></i>`) as HTMLButtonElement;
      b.type = 'button'; b.setAttribute('role', 'tab');
      b.addEventListener('pointerdown', e => e.stopPropagation());
      b.addEventListener('click', () => { o.onTab?.(k); this.setTab(k); });
      this.tabBtns.push(b); tabs.append(b);
    });
    this.rows = [0, 1].map(() => { const r = h('div', 'cards'); r.setAttribute('role', 'tabpanel'); return r; });
    this.deck.append(tabs, ...this.rows);
    this.info = h('div', 'cardinfo paper');
    this.info.hidden = true;
    this.info.addEventListener('pointerdown', e => { e.stopPropagation(); this.hideInfo(); });
    // a touch anywhere else closes a long-press card
    document.addEventListener('pointerdown', e => { if (!this.info.hidden && !(e.target as HTMLElement).closest?.('.card')) this.hideInfo(); }, true);

    const mini = h('div', 'mini paper');
    this.miniCanvas = h('canvas') as HTMLCanvasElement;
    this.miniCanvas.width = 456; this.miniCanvas.height = 312;
    mini.append(this.miniCanvas);

    this.vote = h('div', 'vote paper');
    this.vote.hidden = true;
    this.feed = h('div', 'feed');
    this.feed.innerHTML = '<span class="hd">беседа «безапасные»</span>';

    const tools = h('div', 'toolbar');
    const mk = (icon: string, label: string, fn: (b: HTMLButtonElement) => void) => {
      const b = h('button', 'tb', icon) as HTMLButtonElement;
      b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
      b.addEventListener('click', () => fn(b));
      tools.append(b);
      return b;
    };
    mk(ICON.menu, 'Меню', () => o.onMenu());
    mk(ICON.home, 'К своей высотке', () => o.onHome());
    mk(ICON.sound, 'Звук', b => b.classList.toggle('off', !o.onSound()));
    mk(ICON.music, 'Музыка', b => b.classList.toggle('off', !o.onMusic()));

    this.hintEl = h('div', 'hint');
    root.append(top, bank, this.deck, mini, this.vote, this.feed, tools, this.hintEl, this.info);
  }

  setSide(s: Side) {
    this.side = s;
    this.sides[0].classList.toggle('me', s === 0);
    this.sides[1].classList.toggle('me', s === 1);
    const all = SHOP.filter(t => canBuy(s, t));
    this.tabTypes = [all.filter(t => !UNITS[t].hero), all.filter(t => UNITS[t].hero)];
    this.order = [...this.tabTypes[0], ...this.tabTypes[1]];
    this.cards.clear();
    this.rows.forEach((row, k) => {
      row.innerHTML = '';
      for (const t of this.tabTypes[k]) {
        const d = UNITS[t], i = this.order.indexOf(t);
        const b = h('button', `card paper${d.hero ? ' hero' : ''}`) as HTMLButtonElement;
        b.type = 'button';
        b.innerHTML = `<span class="key">${DECK_KEYS[i] ?? ''}</span>${portraitHtml(this.o.portraits, s, t)}<span class="cn">${esc(d.name[s])}</span><span class="cc"></span><span class="st"></span><span class="cdbar"></span>`;
        b.setAttribute('aria-label', `${d.name[s]}: ${unitRole(t, s)}`);
        this.bindCard(b, t);
        this.cards.set(t, b);
        row.append(b);
      }
    });
    this.blocked.clear();
    this.setTab(0);
    this.select(-1);
  }

  /** Tap selects; long-press (touch) or hover (mouse) opens the info card. */
  private bindCard(b: HTMLButtonElement, t: number) {
    let lp = 0, fired = false, hov = 0, x0 = 0, y0 = 0;
    b.addEventListener('contextmenu', e => e.preventDefault());
    b.addEventListener('pointerdown', e => {
      e.stopPropagation();
      if (e.pointerType === 'mouse') return;
      fired = false; x0 = e.clientX; y0 = e.clientY;
      clearTimeout(lp);
      lp = window.setTimeout(() => { fired = true; this.showInfo(t, b); try { navigator.vibrate?.(8); } catch { /* not allowed */ } }, 420);
    });
    const cancel = () => clearTimeout(lp);
    b.addEventListener('pointerup', cancel);
    b.addEventListener('pointercancel', cancel);
    b.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse' && Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 12) cancel(); });
    b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { clearTimeout(hov); hov = window.setTimeout(() => this.showInfo(t, b), 380); } });
    b.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { clearTimeout(hov); this.hideInfo(); } else cancel(); });
    b.addEventListener('click', e => {
      if (fired) { fired = false; e.preventDefault(); return; }
      this.o.onCard(t);
    });
  }

  setTab(k: number) {
    this.tab = k;
    this.tabBtns.forEach((b, i) => { b.classList.toggle('on', i === k); b.setAttribute('aria-selected', String(i === k)); });
    this.rows.forEach((r, i) => { r.hidden = i !== k; });
    this.hideInfo();
  }

  /** Unit type behind keyboard slot i (0-based), or -1. */
  typeAt(i: number) { return this.order[i] ?? -1; }

  /** Why this card can't be used right now ('' = it can). */
  cardBlocked(t: number) { return this.blocked.get(t) ?? ''; }

  select(t: number) {
    this.selected = t;
    this.cards.forEach((b, k) => b.classList.toggle('sel', k === t));
    if (t >= 0) {
      const k = UNITS[t].hero ? 1 : 0;
      if (k !== this.tab) this.setTab(k);
    }
    this.hint(this.blurb(t));
  }

  /** A short wiggle on a card (a hero may be called again). */
  flash(t: number) {
    const b = this.cards.get(t);
    if (!b) return;
    b.classList.remove('ready'); void b.offsetWidth; b.classList.add('ready');
    setTimeout(() => b.classList.remove('ready'), 1400);
  }

  private showInfo(t: number, card: HTMLElement) {
    const s = this.side, d = UNITS[t], hid = heroForUnit(t, s), lore = hid ? HEROES[hid] : null;
    const tag = lore ? (lore.side === 'merc' ? 'наёмник, за обе стороны' : `герой ${lore.side === 'atagi' ? 'Атагов' : 'Курчалоя'}`) : d.key === 'ride' ? 'транспорт' : 'юнит';
    const stats = `${d.hp} hp${d.count > 1 ? ` ×${d.count}` : ''} · ${d.cost[s]} ₽${d.respawn ? ` · после гибели ${Math.round(d.respawn / 10)} с` : ''}`;
    const q = lore?.quote;
    this.info.className = `cardinfo paper s${s}`;
    this.info.innerHTML = `<div class="ci-h"><b class="ci-n">${esc(d.name[s])}</b><span class="ci-tag">${esc(tag)}</span></div>
      ${lore ? `<div class="ci-t">${esc(lore.title)}</div>` : ''}
      <div class="ci-r">${esc(unitRole(t, s))}</div>
      <div class="ci-b">${esc(lore ? lore.bio : d.blurb[s])}</div>
      ${q ? `<div class="ci-q">«${esc(q.t)}»${q.who ? ` <span>— ${esc(q.who)}</span>` : ''}</div>` : ''}
      <div class="ci-s">${esc(stats)}</div>`;
    this.info.hidden = false;
    const r = card.getBoundingClientRect(), W = innerWidth;
    const w = this.info.offsetWidth;
    const x = Math.max(8, Math.min(W - w - 8, r.left + r.width / 2 - w / 2));
    this.info.style.left = `${x}px`;
    this.info.style.bottom = `${Math.max(8, innerHeight - r.top + 14)}px`;
    clearTimeout(this.infoT);
    this.infoT = window.setTimeout(() => this.hideInfo(), 9000);
  }
  hideInfo() { if (!this.info.hidden) this.info.hidden = true; }

  hint(text: string) { clearTimeout(this.tipT); this.hintEl.classList.remove('rot'); this.hintEl.textContent = text; }
  private blurb(t: number) { return t >= 0 ? `${UNITS[t].blurb[this.side]}. Тапни по кругу у своего села` : ''; }
  /** A short note on the hint line (why a card can't be used); then the line returns to the selected card. */
  note(text: string, ms = 3200) {
    this.hint(text);
    this.tipT = window.setTimeout(() => this.hint(this.blurb(this.selected)), ms);
  }
  /** A rotating tip from HINTS; shows for a while unless something else takes the line. */
  rotateTip(text: string, ms = 7000) {
    if (this.selected >= 0) return false;
    this.hintEl.textContent = text; this.hintEl.classList.add('rot');
    clearTimeout(this.tipT);
    this.tipT = window.setTimeout(() => { if (this.hintEl.classList.contains('rot')) { this.hintEl.textContent = ''; this.hintEl.classList.remove('rot'); } }, ms);
    return true;
  }

  update(sim: Sim, pid: string, wall: number) {
    if (wall - this.lastPaint < 90) return;
    this.lastPaint = wall;
    const st = sim.st, me = this.side;
    for (const s of [0, 1] as Side[]) {
      const sd = st.sides[s];
      const slots = Math.max(sd.floors, Math.ceil(sd.hq / HQ.floorHp[s]));
      let html = '';
      for (let i = 0; i < slots; i++) {
        const f = Math.max(0, Math.min(1, (sd.hq - i * HQ.floorHp[s]) / HQ.floorHp[s]));
        html += `<i><b style="width:${(f * 100).toFixed(0)}%"></b></i>`;
      }
      if (s === 0 && slots < 4) html += '<i class="ghost" title="4-й этаж: ищем"></i>';
      if (this.towers[s].innerHTML !== html) this.towers[s].innerHTML = html;
      const villages = st.pts.filter(p => p.kind === 1 && p.owner === s).length;
      const boss = sd.boss >= 0 ? ' · босс в деле' : '';
      this.stats[s].textContent = `${sd.floors} эт. · ${villages} сёл${boss}`;
    }
    this.warEl.textContent = `Война №${st.era}`;
    this.scoreEl.innerHTML = `<span class="a">${st.sides[0].wins}</span> : <span class="k">${st.sides[1].wins}</span>`;
    if (st.winner >= 0) this.clockEl.textContent = `новая война через ${mmss(400 - (st.tick - st.overAt))}`;
    else if (st.votes[me].open) this.clockEl.textContent = `сход идёт · ${mmss(st.votes[me].end - st.tick)}`;
    else this.clockEl.textContent = `до схода ${mmss(st.nextVote - st.tick)}`;
    const sd = st.sides[me], now = st.tick;
    this.moneyEl.textContent = `${fmt(sd.money)} ₽`;
    const zero = st.ev.black > now ? 'свет яц везде — доход 0' : sd.black > now ? 'свет яц — доход 0' : sd.hack > now ? 'Пентагон взломан — доход 0' : '';
    this.incEl.textContent = zero || `+${Math.round(sd.income)} ₽/с${sd.poor > now ? ' · аура нищеты ×0,5' : ''}${sd.inc > now ? ' · мы в плюсе' : ''}`;
    this.incEl.classList.toggle('off', !!zero || sd.poor > now);
    const pl = st.players[pid];
    const cdLeft = pl ? Math.max(0, pl.cd - now) : 0;
    let ready = 0;
    for (const [t, b] of this.cards) {
      const cost = sim.cost(me, t), d = UNITS[t];
      const w = d.hero ? sim.heroWait(me, t) : 0;
      const state = w === -1 ? 'field' : w === -2 ? 'away' : w > 0 ? 'cool' : '';
      const poor = sd.money < cost;
      this.blocked.set(t, w === -1 ? `${d.name[me]} уже на поле` : w === -2 ? 'На парах. Завтра учимся' : w > 0 ? 'Ещё не вернулся' : '');
      if (d.hero && !state && !poor) ready++;
      const key = `${state}|${poor ? 1 : 0}|${cost}|${w > 0 ? w : 0}`;
      if (b.dataset.k !== key) {
        b.dataset.k = key;
        b.classList.toggle('poor', poor && !state);
        b.classList.toggle('field', state === 'field');
        b.classList.toggle('away', state === 'away');
        b.classList.toggle('cool', state === 'cool');
        b.classList.toggle('sale', cost < d.cost[me]);
        (b.querySelector('.cc') as HTMLElement).innerHTML = cost < d.cost[me] ? `<s>${d.cost[me]}</s> ${cost} ₽` : `${cost} ₽`;
        (b.querySelector('.st') as HTMLElement).textContent = state === 'field' ? 'на поле' : state === 'away' ? 'на парах' : state === 'cool' ? mmss(w * 10) : '';
        b.setAttribute('aria-disabled', String(!!state));
      }
      (b.querySelector('.cdbar') as HTMLElement).style.width = `${(cdLeft / 6) * 100}%`;
    }
    if (this.selected >= 0 && this.blocked.get(this.selected)) this.select(-1);
    const n = this.tabBtns[1].querySelector('.tab-n') as HTMLElement;
    const nt = ready ? String(ready) : '';
    if (n.textContent !== nt) n.textContent = nt;
    this.paintEvent(sim);
    this.paintVote(sim, pid);
  }

  /** The world event that is on right now: a sticker with title and countdown. */
  private paintEvent(sim: Sim) {
    const st = sim.st, ev = st.ev, now = st.tick, key = ev.last;
    let until = 0;
    switch (key) {
      case 'jam': until = ev.jam; break;
      case 'blackout': until = ev.black; break;
      case 'sale': until = ev.sale; break;
      case 'friday': until = ev.friday; break;
      case 'flood': until = ev.flood; break;
      case 'classes': for (const a of st.away) until = Math.max(until, a.back); break;
      case 'cancel': until = ev.next - EVENT_EVERY + 30; break;
    }
    const on = !!key && until > now && st.winner === -1;
    if (!on) { if (!this.evEl.hidden) { this.evEl.hidden = true; this.evKey = ''; } return; }
    if (this.evKey !== key) {
      this.evKey = key;
      const E = EVENTS.find(e => e.key === key);
      const fx: Record<string, string> = {
        jam: 'у Аргуна все еле ползут', blackout: 'доход у всех ноль', classes: 'герои ушли на пары',
        sale: 'Донер Бей платит и лечит вдвое', cancel: 'сход прямо сейчас',
        friday: this.side === 0 ? 'такси по 100 за полцены' : 'у Атагов такси за полцены', flood: 'в воде еле идут',
      };
      this.evEl.className = `evchip ev-${key}`;
      this.evEl.innerHTML = `<b>${esc(E?.title ?? key)}</b><span class="et num"></span><span class="ef">${esc(fx[key] ?? '')}</span>`;
      this.evEl.hidden = false;
    }
    const t = this.evEl.querySelector('.et') as HTMLElement;
    const txt = mmss(until - now);
    if (t.textContent !== txt) t.textContent = txt;
  }

  private paintVote(sim: Sim, pid: string) {
    const st = sim.st, v = st.votes[this.side];
    if (!v.open && v.result === -2 && st.tick < v.end) { // «Где наша обещанная четырёхдневка»
      if (this.voteKey !== 'skip' + v.start) {
        this.voteKey = 'skip' + v.start;
        this.vote.hidden = false;
        this.vote.classList.add('done');
        this.vote.innerHTML = `<h3><span>Сход отменили</span></h3><div class="stamp ${this.side ? 'k' : 'a'}">четырёхдневка</div><div class="who">«Где наша обещанная четырёхдневка». Соседи отменили наш сход</div>`;
      }
      return;
    }
    const showResult = !v.open && v.result >= 0 && st.tick - v.resultAt < 70;
    if (!v.open && !showResult) { this.vote.hidden = true; this.voteKey = ''; return; }
    this.vote.hidden = false;
    const tally = sim.tally(this.side);
    const total = tally.reduce((a, b) => a + b, 0) || 1;
    const village = v.focusPt >= 0 ? st.pts[v.focusPt].name : '';
    const key = `${v.start}:${v.open}`;
    if (key !== this.voteKey) {
      this.voteKey = key;
      this.vote.classList.toggle('done', !v.open);
      if (v.open) {
        this.vote.innerHTML = `<h3><span>Сход · ${SIDE_TAG[this.side].short}</span><span class="num" data-t></span></h3>
          <div class="lead hand">Админ издал указ: голосуем</div>
          ${v.opts.map((c, i) => `<button type="button" class="opt" data-o="${i}"><span class="bar"></span><span class="n"></span><span class="t">${esc(cardTitle(CARDS[c], village))}</span><span class="q">${esc(CARDS[c].quote)}</span></button>`).join('')}
          <div class="time"><b></b></div><div class="who"></div>`;
        this.vote.querySelectorAll<HTMLButtonElement>('.opt').forEach(b => {
          b.addEventListener('pointerdown', e => e.stopPropagation());
          b.addEventListener('click', () => this.o.onVote(Number(b.dataset.o)));
        });
      } else {
        const c = CARDS[v.opts[v.result]];
        this.vote.innerHTML = `<h3><span>Сход решил</span></h3><div class="stamp ${this.side ? 'k' : 'a'}">${esc(cardTitle(c, village))}</div><div class="who">${esc(c.quote)}</div>`;
      }
    }
    if (v.open) {
      const mine = v.ballots[pid];
      this.vote.querySelectorAll<HTMLButtonElement>('.opt').forEach((b, i) => {
        (b.querySelector('.bar') as HTMLElement).style.width = `${(tally[i] / total) * 100}%`;
        (b.querySelector('.n') as HTMLElement).textContent = String(tally[i]);
        b.classList.toggle('mine', mine === i);
      });
      (this.vote.querySelector('[data-t]') as HTMLElement).textContent = mmss(v.end - st.tick);
      (this.vote.querySelector('.time b') as HTMLElement).style.width = `${((v.end - st.tick) / (v.end - v.start)) * 100}%`;
      const voted = VOTERS[this.side].filter((_, i) => v.npcAt[i] <= st.tick);
      const humans = Object.keys(v.ballots).length;
      (this.vote.querySelector('.who') as HTMLElement).textContent =
        `Проголосовали: ${[...(humans ? [`${humans} чел. (×2)`] : []), ...voted].join(', ') || 'пока никто'}`;
    }
  }

  feedMsg(who: string, text: string, side: number) {
    const m = h('div', 'msg');
    const cls = side === 0 ? 'a' : side === 1 ? 'k' : '';
    m.innerHTML = `<b class="${cls}">${esc(who)}:</b>${esc(text)}`;
    this.feed.append(m);
    const msgs = this.feed.querySelectorAll('.msg');
    if (msgs.length > 4) msgs[0].remove();
    setTimeout(() => m.classList.add('out'), 9000);
    setTimeout(() => m.remove(), 9700);
  }

  private bannerEl: HTMLElement | null = null;
  private bannerT = 0;
  banner(big: string, small: string, side: number, ms = 2600) {
    this.bannerEl?.remove();
    const b = h('div', 'banner');
    b.innerHTML = `<div class="big ${side === 0 ? 's0' : side === 1 ? 's1' : 'n'}">${esc(big)}</div>${small ? `<div class="small">${esc(small)}</div>` : ''}`;
    this.root.append(b);
    this.bannerEl = b;
    clearTimeout(this.bannerT);
    this.bannerT = window.setTimeout(() => b.remove(), ms);
  }

  tip(x: number, y: number, text: string, cls = '') {
    const t = h('div', cls ? `tip ${cls}` : 'tip');
    t.textContent = text;
    t.style.left = `${x}px`; t.style.top = `${y}px`;
    this.root.append(t);
    setTimeout(() => t.remove(), 1400);
  }

  showOver(sim: Sim, win: boolean, taunt: string) {
    this.hideOver();
    const st = sim.st, w = st.winner as Side;
    const el = h('div', 'over');
    const row = (label: string, a: number | string, k: number | string) => `<span>${label}</span><span class="num a">${a}</span><span class="num k">${k}</span>`;
    el.innerHTML = `<div class="sheet paper">
      <div class="who ${w ? 'k' : 'a'}">${win ? 'Победа' : 'Поражение'}: ${SIDE_FULL[w]}</div>
      <div class="taunt hand ${w ? 'k' : 'a'}">«${esc(taunt)}»</div>
      <div class="tbl"><span></span><span class="a">Атаги</span><span class="k">Курчалой</span>
        ${row('Войн выиграно', st.sides[0].wins, st.sides[1].wins)}
        ${row('Убито', st.sides[0].kills, st.sides[1].kills)}
        ${row('Поставлено юнитов', st.sides[0].deployed, st.sides[1].deployed)}
        ${row('Этажей осталось', st.sides[0].floors, st.sides[1].floors)}</div>
      <div class="next">Война не кончается. Следующая начнётся сама, через 40 секунд.</div>
    </div>`;
    el.addEventListener('pointerdown', e => e.stopPropagation());
    el.addEventListener('click', () => this.hideOver());
    this.root.append(el);
    this.overEl = el;
  }
  hideOver() { this.overEl?.remove(); this.overEl = null; }
  get overOpen() { return !!this.overEl; }
}
