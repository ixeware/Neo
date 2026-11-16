// HUD: notebook slips around the map. DOM is refreshed ~10×/s, not every frame.
import { UNITS, HQ, CARDS, VOTERS, SIDE_FULL, type Side } from '../sim/defs';
import { cardTitle, type Sim } from '../sim/sim';
import { SIDE_TAG } from '../data/lore';
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

const ICON = {
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9c1.5 1.5 1.5 4.5 0 6M19 6c3 3 3 9 0 12"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path d="M10 18V5l10-2v13"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 21V9l8-6 8 6v12z"/><path d="M10 21v-6h4v6"/></svg>',
};

export interface HudOpts {
  portraits: Portraits;
  onCard(i: number): void;
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
  private cards: HTMLButtonElement[] = [];
  private deck: HTMLElement;
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
    center.append(score, this.clockEl);
    top.append(this.sides[0], center, this.sides[1]);

    const bank = h('div', 'bank paper');
    this.moneyEl = h('span', 'money num');
    this.incEl = h('span', 'inc');
    bank.append(this.moneyEl, this.incEl);

    this.deck = h('div', 'deck');
    for (let i = 0; i < 5; i++) {
      const b = h('button', 'card paper') as HTMLButtonElement;
      b.type = 'button';
      b.addEventListener('pointerdown', e => e.stopPropagation());
      b.addEventListener('click', () => o.onCard(i));
      this.cards.push(b); this.deck.append(b);
    }

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
    root.append(top, bank, this.deck, mini, this.vote, this.feed, tools, this.hintEl);
  }

  setSide(s: Side) {
    this.side = s;
    this.sides[0].classList.toggle('me', s === 0);
    this.sides[1].classList.toggle('me', s === 1);
    this.cards.forEach((b, i) => {
      const d = UNITS[i];
      b.innerHTML = `<span class="key">${i + 1}</span><img alt="" src="${this.o.portraits.units[s][i]}"><span class="cn">${d.name[s]}</span><span class="cc">${d.cost[s]} ₽</span><span class="cdbar"></span>`;
      b.title = `${d.name[s]} — ${d.blurb[s]}`;
    });
    this.select(-1);
  }

  select(i: number) {
    this.selected = i;
    this.cards.forEach((b, k) => b.classList.toggle('sel', k === i));
    this.hint(i >= 0 ? `${UNITS[i].blurb[this.side]}. Тапни по кругу у своего села` : '');
  }

  hint(text: string) { this.hintEl.textContent = text; }

  update(sim: Sim, pid: string, now: number) {
    if (now - this.lastPaint < 90) return;
    this.lastPaint = now;
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
    const sd = st.sides[me];
    this.moneyEl.textContent = `${fmt(sd.money)} ₽`;
    const black = sd.black > st.tick;
    this.incEl.textContent = black ? 'свет яц — доход 0' : `+${Math.round(sd.income)} ₽/с${sd.inc > st.tick ? ' · мы в плюсе' : ''}`;
    this.incEl.classList.toggle('off', black);
    const pl = st.players[pid];
    const cdLeft = pl ? Math.max(0, pl.cd - st.tick) : 0;
    this.cards.forEach((b, i) => {
      const poor = sd.money < UNITS[i].cost[me];
      b.classList.toggle('poor', poor);
      const bar = b.querySelector('.cdbar') as HTMLElement;
      bar.style.width = `${(cdLeft / 6) * 100}%`;
    });
    this.paintVote(sim, pid);
  }

  private paintVote(sim: Sim, pid: string) {
    const st = sim.st, v = st.votes[this.side];
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

  tip(x: number, y: number, text: string) {
    const t = h('div', 'tip');
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
