// Start screen: pick a village, difficulty, 18+ layer; continue the endless war.
// Two more pages behind the notebook tabs: «Кто есть кто» (heroes) and «Ачивки».
import { SIDE_TAG, HINTS } from '../data/lore';
import { HEROES, ROSTER_ORDER, HERO_UNIT, ACHIEVEMENTS, UNIT_TEXT, GELIK_T, SPORTIK_T, type HeroId } from '../data/heroes';
import { UNITS } from '../sim/defs';
import { portraitHtml, unitRole } from './hud';
import type { Portraits } from './portraits';

export type MenuTab = 'play' | 'who' | 'ach';
export interface MenuState {
  canContinue: { era: number; side: 0 | 1; wins: [number, number] } | null;
  diff: number; spicy: boolean;
  shared: { available: boolean; online: number[]; era: number; wins: [number, number]; note?: string; who?: string } | null;
  tab?: MenuTab;
  /** Unlocked achievement ids. */
  achieved?: Set<string>;
}
export interface MenuActions {
  start(side: 0 | 1, diff: number): void;
  resume(): void;
  shared(side: 0 | 1): void;
  setDiff(d: number): void;
  setSpicy(on: boolean): void;
}

const DIFF = ['Легко', 'Нормально', 'Как Зураб'];
const TABS: [MenuTab, string][] = [['play', 'Война'], ['who', 'Кто есть кто'], ['ach', 'Ачивки']];
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function playPage(p: Portraits, s: MenuState): string {
  const cont = s.canContinue;
  const sh = s.shared;
  const tip = HINTS[Math.floor(Math.random() * HINTS.length)];
  return `${cont ? `<div class="m-row"><button type="button" class="m-cont" id="m-resume">Продолжить войну №${cont.era} за ${cont.side ? 'Курчалой' : 'Атаги'} · счёт ${cont.wins[0]}:${cont.wins[1]}</button></div>` : ''}
    <div class="m-sides">
      ${[0, 1].map(i => {
        const t = SIDE_TAG[i];
        return `<button type="button" class="pick paper s${i}" data-side="${i}">
          <img alt="${t.boss}" src="${p.bosses[i]}">
          <span class="p-in">
            <span class="p-v">${t.title}</span>
            <span class="p-hq">${t.hq}: ${t.hqNote}</span>
            <span class="p-boss">Босс: ${t.boss}. ${t.bossNote}</span>
            <span class="p-q">${t.motto}</span>
            <span class="p-go">${cont ? 'Новая война за ' : 'Играть за '}${t.short}</span>
          </span>
        </button>`;
      }).join('')}
    </div>
    <div class="m-row">
      <div class="m-box paper"><h4>Сложность</h4><div class="seg" id="m-diff">${DIFF.map((d, i) => `<button type="button" aria-pressed="${i === s.diff}" data-d="${i}">${d}</button>`).join('')}</div></div>
      <div class="m-box paper"><h4>Пошлятина из чата</h4><div class="seg" id="m-spicy"><button type="button" aria-pressed="${s.spicy}" data-v="1">18+ вкл</button><button type="button" aria-pressed="${!s.spicy}" data-v="0">выкл</button></div></div>
      <div class="m-box paper m-how"><h4>Как играть</h4><ol>
        <li>Выбери юнита внизу и тапни по кругу у своего села или захваченного. Вкладка «Пацаны» — герои и наёмники.</li>
        <li>Юниты сами идут брать сёла: Шали, Автуры, Цоцин-Юрт, Аргун. Каждое село даёт деньги, Донер Бей у Грозного — ещё и лечит.</li>
        <li>Раз в полторы минуты сход: голосуй за решение, твой голос считается за два.</li>
        <li>Снеси все этажи вражеской высотки. На последнем этаже выходит финальный босс.</li>
      </ol><p class="m-tip"><b>Совет:</b> ${esc(tip)}</p></div>
    </div>
    ${sh ? `<div class="m-box paper m-mp">${sh.available
      ? `<h4>Общая война с пацанами</h4><span>Один мир на всех, кто открыл эту ссылку. Война №${sh.era}, счёт <b class="a">${sh.wins[0]}</b>:<b class="k">${sh.wins[1]}</b>. Сейчас в игре: Атаги — ${sh.online[0]}, Курчалой — ${sh.online[1]}.${sh.who ? ` Онлайн: ${esc(sh.who)}.` : ''}</span>
         <div class="m-row"><button type="button" class="m-cont" data-shared="0">В общую войну за Атаги</button><button type="button" class="m-cont" data-shared="1">В общую войну за Курчалой</button></div>`
      : `<h4>Общая война</h4><span>${esc(sh.note ?? 'Общий мир работает, когда игра открыта по ссылке claude.ai и у тебя есть право редактировать. Сейчас играешь один против ИИ, прогресс хранится в этом браузере.')}</span>`}</div>` : ''}
    <p class="m-foot">Карта — настоящий кусок Чечни между Старыми Атагами и Курчалоем: рельеф AWS Terrain Tiles, леса, поля и застройка ESA WorldCover 2021 (10 м). Река Аргун, мосты и сёла на своих местах. Управление как в Red Alert 2: рамка или клик — выделить своих, правый клик (на телефоне тап) по земле — идти, по врагу — бить, A — атака с ходу, S — стоп, G — авто, Ctrl+1…9 / Shift+1…9 — группы; карта — правой кнопкой, WASD или пальцем, колесо или щипок — зум, Q/E или два пальца — поворот; 1–0 — карточки, долгое нажатие на карточку — кто это; «Вселиться» (V) — вести бойца от первого лица.</p>`;
}

function rosterCard(p: Portraits, id: HeroId, spicy: boolean): string {
  const h = HEROES[id], t = HERO_UNIT[id];
  const s: 0 | 1 = h.side === 'kurchaloy' ? 1 : 0;
  const tone = h.side === 'merc' ? 2 : s;
  const tag = h.side === 'atagi' ? 'Атаги' : h.side === 'kurchaloy' ? 'Курчалой' : 'наёмник, за обе стороны';
  const d = UNITS[t];
  const meta = t === 5 ? 'Босс. Выходит сам, когда у высотки остаётся последний этаж'
    : `${d.cost[s]} ₽ · ${d.hp} hp · один на сторону, после гибели ${Math.round((d.respawn ?? 0) / 10)} с`;
  const q = h.quote.spicy && !spicy ? null : h.quote;
  return `<article class="who-card paper c${tone}">
    <div class="who-pic">${portraitHtml(p, s, t, 'who-img', tone)}</div>
    <div class="who-in">
      <div class="who-h"><b class="who-n">${esc(h.name)}</b><span class="who-tag">${esc(tag)}</span></div>
      <div class="who-t">${esc(h.title)}</div>
      <p class="who-b">${esc(h.bio)}</p>
      ${q ? `<div class="who-q">«${esc(q.t)}»${q.who ? ` <span>— ${esc(q.who)}</span>` : ''}</div>` : ''}
      <div class="who-m">${esc(meta)}</div>
    </div>
  </article>`;
}

/** Not a hero, but worth a card: Гелик and Спортики (only once the sim has these unit types). */
function unitCard(p: Portraits, t: number, spicy: boolean): string {
  const u = UNIT_TEXT[t], d = UNITS[t];
  if (!u || !d) return '';
  const both = d.avail[0] && d.avail[1];
  const s: 0 | 1 = d.avail[0] ? 0 : 1, tone = both ? 2 : s;
  const meta = `${d.cost[s]} ₽ · ${d.hp} hp${d.count > 1 ? ` ×${d.count}` : ''} · ${both ? 'за обе стороны' : s ? 'только Курчалой' : 'только Атаги'}`;
  const q = u.quote.spicy && !spicy ? null : u.quote;
  return `<article class="who-card paper c${tone}">
    <div class="who-pic">${portraitHtml(p, s, t, 'who-img', tone)}</div>
    <div class="who-in">
      <div class="who-h"><b class="who-n">${esc(u.name)}</b><span class="who-tag">${esc(u.tag)}</span></div>
      <div class="who-t">${esc(u.title)}</div>
      <p class="who-b">${esc(u.blurb)}</p>
      <p class="who-b">${esc(unitRole(t, s))}</p>
      ${q ? `<div class="who-q">«${esc(q.t)}»${q.who ? ` <span>— ${esc(q.who)}</span>` : ''}</div>` : ''}
      <div class="who-m">${esc(meta)}</div>
    </div>
  </article>`;
}

function whoPage(p: Portraits, s: MenuState): string {
  const extra = [GELIK_T, SPORTIK_T].map(t => unitCard(p, t, s.spicy)).join('');
  return `<div class="m-page">
    <p class="m-lead">Все, кто воюет за самое высокое здание. Герой может быть только один на сторону. Наёмники играют за любую сторону — за кого позовут.</p>
    <div class="who-list">${ROSTER_ORDER.map(id => rosterCard(p, id, s.spicy)).join('')}</div>
    ${extra ? `<p class="m-lead">Ещё на районе: техника и пацаны, которых можно позвать из вкладки «Юниты».</p>
    <div class="who-list">${extra}</div>` : ''}
  </div>`;
}

function achPage(s: MenuState): string {
  const got = s.achieved ?? new Set<string>();
  const n = ACHIEVEMENTS.filter(a => got.has(a.id)).length;
  return `<div class="m-page">
    <p class="m-lead">Открыто <b class="num">${n}</b> из ${ACHIEVEMENTS.length}. Считаются за свою сторону, хранятся в этом браузере.</p>
    <ol class="ach-list">${ACHIEVEMENTS.map(a => {
      const on = got.has(a.id);
      const title = s.spicy && a.spicyTitle ? a.spicyTitle : a.title;
      const q = on && a.quote && (s.spicy || !a.quote.spicy) ? a.quote : null;
      return `<li class="ach-row paper${on ? ' on' : ''}">
        <span class="ach-mark" aria-label="${on ? 'есть' : 'пока нет'}">${on ? 'есть' : '?'}</span>
        <span class="ach-in"><b>${esc(title)}</b><span class="ach-desc">${esc(a.desc)}</span>${q ? `<span class="ach-quote">«${esc(q.t)}»${q.who ? ` — ${esc(q.who)}` : ''}</span>` : ''}</span>
      </li>`;
    }).join('')}</ol>
  </div>`;
}

export function renderMenu(root: HTMLElement, p: Portraits, s: MenuState, a: MenuActions) {
  root.hidden = false;
  const tab = s.tab ?? 'play';
  root.innerHTML = `<div class="m-wrap">
    <header class="m-head">
      <h1 class="m-title">ВЫСОТКА</h1>
      <div class="m-sub">Старые Атаги <span class="x">×</span> Курчалой. Война за самое высокое здание, на настоящем рельефе</div>
      <div class="m-note">«Не успокоюсь, пока 4 этажа не найду» — Ислам. «Для тебя это как небоскрёб» — Зураб.</div>
    </header>
    <nav class="m-tabs" role="tablist">${TABS.map(([k, label]) => `<button type="button" role="tab" class="m-tab${k === tab ? ' on' : ''}" aria-selected="${k === tab}" data-tab="${k}">${label}${k === 'ach' && s.achieved?.size ? ` <i class="num">${s.achieved.size}</i>` : ''}</button>`).join('')}</nav>
    ${tab === 'play' ? playPage(p, s) : tab === 'who' ? whoPage(p, s) : achPage(s)}
  </div>`;
  root.querySelectorAll<HTMLButtonElement>('.m-tab').forEach(b => b.addEventListener('click', () => {
    s.tab = b.dataset.tab as MenuTab;
    renderMenu(root, p, s, a);
    root.scrollTop = 0;
  }));
  root.querySelectorAll<HTMLButtonElement>('.pick').forEach(b => b.addEventListener('click', () => a.start(Number(b.dataset.side) as 0 | 1, s.diff)));
  root.querySelector('#m-resume')?.addEventListener('click', () => a.resume());
  root.querySelectorAll<HTMLButtonElement>('[data-shared]').forEach(b => b.addEventListener('click', () => a.shared(Number(b.dataset.shared) as 0 | 1)));
  root.querySelectorAll<HTMLButtonElement>('#m-diff button').forEach(b => b.addEventListener('click', () => {
    s.diff = Number(b.dataset.d); a.setDiff(s.diff);
    root.querySelectorAll<HTMLButtonElement>('#m-diff button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  root.querySelectorAll<HTMLButtonElement>('#m-spicy button').forEach(b => b.addEventListener('click', () => {
    s.spicy = b.dataset.v === '1'; a.setSpicy(s.spicy);
    root.querySelectorAll<HTMLButtonElement>('#m-spicy button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
}
