// Player-placed base buildings: the balance table and constants (docs/v5/BASE.md is the contract).
// Imports nothing, so src/sim/defs.ts re-exports it and the server bundle (api/_lib/admcheck.js) can use it.
// A building's type is its index in BUILDINGS: the table is append-only (indices live in saves).

/** Family: defence towers, walls, traps, economy, support / tech, superweapons. */
export type BFam = 'def' | 'wall' | 'trap' | 'eco' | 'sup' | 'super';
type L3 = [number, number, number];

export interface BDef {
  /** Stable key: the contract between the sim, the UI, the models and the texts. Never renamed. */
  key: string;
  fam: BFam;
  /** Clean provisional texts (the content track supplies the final ones by key). */
  name: string; blurb: string;
  /** 18+ wording, shown only with the 18+ layer on. The sim never reads it. */
  spicy18?: { name: string; blurb?: string };
  /** Base level («Прорабская») needed to build it: 0 = always. */
  tier: number;
  /** Max per side; 0 = the wall cap of the base level (BASE.walls). */
  cap: number;
  /** ₽: [build, upgrade to level 2, upgrade to level 3]. */
  cost: L3;
  hp: L3;
  /** Build / upgrade time in ticks per level. */
  bt: L3;
  /** Radius for attack reach (a nav cell is 2 × 2). */
  r: number;
  /** 0 nobody is blocked, 1 every enemy ground unit, 2 enemy vehicles (Kind.Fast) only. */
  solid: 0 | 1 | 2;
  /** Wall-like: never auto-targeted (only when it blocks), no gap rule. */
  wall?: true;
  /** Placed as a line of cells with one command. */
  line?: true;
  /** Hidden from the enemy until BF.SEEN. */
  hid?: true;
  /** Powered: off during a blackout or a hack. */
  pw?: true;
  /** Reach of what it does (shots, mark, trigger, heal, aura), per level. */
  range?: L3;
  /** Mortar: cannot hit closer than this. */
  min?: number;
  dmg?: L3;
  /** Ticks between actions (shots, pulses, hatches; traps: re-arm time). */
  rate?: L3;
  /** Splash / effect radius. */
  sp?: number;
  /** Projectile speed, units per tick (absent = the hit is instant). */
  proj?: number;
  /** The type's own per-level number: slow / stun / poison ticks, mark multiplier, ₽ hidden, hp bonus, price / range / cooldown multiplier, chickens. */
  eff?: L3;
  /** A second one: garage speed. */
  eff2?: L3;
  /** ₽ per second (Бараний загон: the maximum). */
  inc?: L3;
}

/** Building flags (B.f). SEEN: the enemy has seen this hidden thing; ADM: removed by the admin (no bounty). */
export const BF = { SEEN: 1, ADM: 2 } as const;

export const BASE = {
  /** Build zone radius around the own high-rise, plus zoneStep per base level. */
  zone: 15, zoneStep: 2,
  /** Keep-out around the own high-rise: HQ.radius + keep. */
  keep: 1.6,
  /** Keep-out around the centre of villages, places and Донер Бей. */
  ptKeep: 3,
  /** By base level 0..3: non-wall buildings, wall segments, highest building level. */
  caps: [10, 16, 23, 30], walls: [16, 24, 32, 40], maxLv: [1, 1, 2, 3],
  /** Cells in one wall-line command. */
  line: 16,
  /** A building may be sold by anyone of its side once its owner has been silent this long. */
  ownerIdle: 900,
  /** No repair within this many ticks of a hit. */
  repLock: 50,
  /** Sell refund and repair price as a share of what was paid; bounty share for the destroyer (+2 ₽). */
  refund: 0.5, bounty: 0.12,
  /** Per-player build cooldown: max(cd, ceil(₽ spent / spend)) ticks; after a sale sellCd. */
  cd: 5, spend: 12, sellCd: 15,
  /** The loser of a war: buildings ×disc for discFor ticks, and insPct of what its destroyed buildings cost (≤ insMax ₽). */
  disc: 0.75, discFor: 900, insPct: 0.5, insMax: 500,
  /** «Генератор» / «Вышка связи» reach; «Тесла» needs a generator within genR. */
  genR: 9, vyR: 8,
  /** Units that hit a building keep it while it is within reach + stick. */
  stick: 1.5,
  /** «Buildings only» units (UnitDef.bldg) and structure-busting pulses multiply damage against buildings by min(their factor, this); the high-rise takes the full factor. */
  bldgVs: 3,
  /** «Бараний загон»: +zagonStep ₽/s every zagonEvery ticks without a hit, from zagonBase. */
  zagonBase: 0.5, zagonStep: 0.5, zagonEvery: 300,
  /** Superweapons: charge time in ticks; the wave's trigger; the strike's flight time and its factor against buildings and the high-rise. */
  subCharge: 600, subMin: 4, subKnock: 5, subStun: 15,
  arbCharge: 900, arbDelay: 30, arbHq: 0.5,
  /** Traps and pulses: enemies needed. */
  nychkaMin: 2, nMin: 3,
  /** «Курятник» looks this far for enemies. */
  henR: 14,
  /** AI: one build action every aiEvery + rint(aiJit) ticks, only with bank ≥ price + aiReserve. */
  aiEvery: 150, aiJit: 100, aiReserve: 150,
  /** Projectile looks: FxEv 'shot'.k = shotK + building type. */
  shotK: 20,
};

export const BUILDINGS: BDef[] = [
  // ---- defence --------------------------------------------------------------------------------
  { key: 'rogatka', fam: 'def', name: 'Рогатка', blurb: 'Дёшево и сердито: бьёт по одному, зато часто',
    tier: 0, cap: 4, cost: [80, 100, 140], hp: [260, 360, 480], bt: [40, 60, 90], r: 1, solid: 1,
    range: [8.5, 8.5, 8.5], dmg: [9, 13, 18], rate: [7, 7, 7], proj: 2.4 },
  { key: 'sebozol', fam: 'def', name: 'Пушка Себозола', blurb: 'Кидает флакон шампуня: пена по площади, все в ней еле идут',
    tier: 1, cap: 2, cost: [180, 160, 220], hp: [380, 500, 650], bt: [60, 90, 120], r: 1, solid: 1,
    range: [9.5, 9.5, 9.5], dmg: [16, 22, 30], rate: [22, 22, 22], sp: 2.2, proj: 1.2, eff: [30, 30, 30] },
  { key: 'sperm', fam: 'def', name: 'Клеемёт', blurb: 'Липкая струя: урона мало, зато не убежишь',
    spicy18: { name: 'Спермострел' },
    tier: 1, cap: 2, cost: [160, 150, 200], hp: [320, 420, 540], bt: [60, 90, 120], r: 1, solid: 1,
    range: [7, 7, 7], dmg: [3, 4, 6], rate: [2, 2, 2], eff: [6, 6, 6] },
  { key: 'tesla', fam: 'def', name: 'Тесла', blurb: 'Сидит тихо, пока не подойдут. Потом молния по троим. Без генератора не работает',
    tier: 2, cap: 2, cost: [260, 220, 300], hp: [420, 540, 700], bt: [80, 110, 140], r: 1, solid: 0, hid: true, pw: true,
    range: [6.5, 6.5, 6.5], dmg: [38, 52, 70], rate: [16, 16, 16], sp: 3.5 },
  { key: 'gantel', fam: 'def', name: 'Гантелемёт', blurb: 'Миномёт из качалки: далеко, медленно и всем вокруг. Вблизи не достаёт',
    tier: 2, cap: 2, cost: [240, 200, 280], hp: [360, 480, 620], bt: [80, 110, 140], r: 1, solid: 1,
    range: [16, 16, 16], min: 5, dmg: [45, 62, 85], rate: [45, 45, 45], sp: 2.6, proj: 0.9 },
  { key: 'antidron', fam: 'def', name: 'Антидрон', blurb: 'Сбивает только то, что летает',
    tier: 2, cap: 2, cost: [150, 130, 180], hp: [280, 360, 460], bt: [60, 90, 120], r: 1, solid: 1, pw: true,
    range: [12, 12, 12], dmg: [30, 42, 58], rate: [8, 8, 8], proj: 3 },
  { key: 'kamera', fam: 'def', name: 'Камера', blurb: 'Сама не бьёт. Кого видит — тот получает больнее от всех',
    tier: 1, cap: 2, cost: [120, 100, 140], hp: [200, 260, 340], bt: [50, 70, 100], r: 0.9, solid: 1, pw: true,
    range: [9, 10.5, 12], eff: [1.15, 1.2, 1.25] },
  { key: 'kuryatnik', fam: 'def', name: 'Курятник', blurb: 'Враг рядом — из него вылетают боевые курицы',
    tier: 2, cap: 1, cost: [220, 180, 240], hp: [340, 440, 560], bt: [80, 110, 140], r: 1.1, solid: 1,
    range: [14, 14, 14], rate: [80, 80, 80], eff: [2, 2, 3] },
  { key: 'bukva_n', fam: 'def', name: 'Вышка «Н»', blurb: 'Раз в полминуты ставит «Н» всем, кто подошёл: стоят как вкопанные',
    tier: 3, cap: 1, cost: [280, 240, 320], hp: [320, 420, 540], bt: [100, 130, 160], r: 1, solid: 1, pw: true,
    range: [6, 6, 6], rate: [220, 190, 160], eff: [18, 22, 26] },
  // ---- walls ----------------------------------------------------------------------------------
  { key: 'zabor', fam: 'wall', name: 'Забор', blurb: 'Профнастил, потом кирпич, потом бетон. Чужие не пройдут, пока не сломают',
    tier: 0, cap: 0, cost: [15, 20, 30], hp: [220, 420, 700], bt: [10, 20, 30], r: 1, solid: 1, wall: true, line: true },
  { key: 'shlagbaum', fam: 'wall', name: 'Шлагбаум', blurb: 'Пешие проходят, чужие машины — нет',
    tier: 1, cap: 3, cost: [60, 60, 90], hp: [500, 750, 1000], bt: [30, 40, 60], r: 1, solid: 2, wall: true },
  // ---- traps ----------------------------------------------------------------------------------
  { key: 'grabli', fam: 'trap', name: 'Грабли', blurb: 'Первый, кто наступит, стоит и держится за лоб',
    tier: 0, cap: 4, cost: [30, 30, 40], hp: [80, 110, 150], bt: [10, 20, 30], r: 0.7, solid: 0, hid: true,
    range: [1.2, 1.2, 1.2], dmg: [10, 20, 30], rate: [150, 150, 150], eff: [25, 35, 45] },
  { key: 'yama', fam: 'trap', name: 'Яма', blurb: 'Прикрыта ветками. Проваливается вся компания',
    tier: 1, cap: 2, cost: [90, 80, 110], hp: [120, 160, 210], bt: [30, 40, 60], r: 0.9, solid: 0, hid: true,
    range: [1.4, 1.4, 1.4], dmg: [40, 60, 85], rate: [300, 300, 300], sp: 2.2, eff: [15, 20, 25] },
  { key: 'lezhak', fam: 'trap', name: 'Лежачий полицейский', blurb: 'Чужая машина на нём оставляет подвеску и стоит',
    tier: 1, cap: 3, cost: [60, 60, 80], hp: [150, 200, 260], bt: [20, 30, 40], r: 0.9, solid: 0, hid: true,
    range: [1.4, 1.4, 1.4], dmg: [80, 120, 170], rate: [120, 120, 120], eff: [20, 28, 36] },
  { key: 'nychka', fam: 'trap', name: 'Нычка', blurb: 'Кто-то спрятал и забыл. Откроют — облако, и всем плохо',
    tier: 2, cap: 2, cost: [80, 70, 100], hp: [100, 130, 170], bt: [30, 40, 60], r: 0.8, solid: 0, hid: true,
    range: [2.5, 2.5, 2.5], dmg: [10, 15, 20], rate: [400, 400, 400], sp: 3.5, eff: [80, 110, 140] },
  { key: 'sobaka', fam: 'trap', name: 'Злая собака', blurb: 'Сидит в будке и молчит. Пока не подойдёшь',
    tier: 1, cap: 2, cost: [100, 90, 120], hp: [300, 400, 520], bt: [30, 40, 60], r: 0.8, solid: 0, hid: true,
    range: [3, 3, 3], dmg: [14, 20, 28], rate: [6, 6, 6] },
  // ---- economy --------------------------------------------------------------------------------
  { key: 'larek', fam: 'eco', name: 'Ларёк', blurb: 'Торгует всем подряд. Капает понемногу, зато всегда',
    tier: 0, cap: 3, cost: [150, 150, 220], hp: [300, 400, 520], bt: [60, 90, 120], r: 1, solid: 1,
    inc: [1.5, 2.5, 4] },
  { key: 'shaurma', fam: 'eco', name: 'Шаурмечная', blurb: 'Свои рядом с ней лечатся. И немного выручки',
    tier: 1, cap: 2, cost: [200, 170, 230], hp: [320, 420, 540], bt: [60, 90, 120], r: 1, solid: 1,
    range: [6, 6, 6], rate: [10, 10, 10], eff: [0.01, 0.014, 0.018], inc: [0.5, 0.8, 1.2] },
  { key: 'seyf', fam: 'eco', name: 'Сейф', blurb: 'Часть общака лежит в нём: по номеру карты оттуда не списать',
    tier: 1, cap: 1, cost: [120, 110, 150], hp: [600, 800, 1000], bt: [50, 70, 100], r: 0.9, solid: 1,
    eff: [150, 250, 400] },
  { key: 'zagon', fam: 'eco', name: 'Бараний загон', blurb: 'Бараны плодятся, пока их никто не трогает. Тронули — начинай сначала',
    tier: 2, cap: 2, cost: [180, 160, 220], hp: [280, 370, 480], bt: [60, 90, 120], r: 1.1, solid: 1,
    inc: [3, 4.5, 6] },
  // ---- support and tech -----------------------------------------------------------------------
  { key: 'prorab', fam: 'sup', name: 'Прорабская', blurb: 'Уровень базы: новые постройки, больше места, улучшения',
    tier: 0, cap: 1, cost: [200, 400, 700], hp: [600, 900, 1300], bt: [80, 150, 250], r: 1.2, solid: 1 },
  { key: 'kachalka', fam: 'sup', name: 'Качалка', blurb: 'Пока стоит, наши выходят на поле крепче',
    tier: 2, cap: 1, cost: [220, 200, 280], hp: [450, 600, 780], bt: [80, 110, 140], r: 1.1, solid: 1,
    eff: [1.08, 1.12, 1.16] },
  { key: 'garazh', fam: 'sup', name: 'Гараж', blurb: 'Свои машины дешевле и едут быстрее',
    tier: 2, cap: 1, cost: [200, 180, 250], hp: [400, 520, 680], bt: [80, 110, 140], r: 1.1, solid: 1,
    eff: [0.85, 0.8, 0.75], eff2: [1.1, 1.15, 1.2] },
  { key: 'vyshka', fam: 'sup', name: 'Вышка связи', blurb: 'Связь есть: башни рядом бьют дальше',
    tier: 2, cap: 1, cost: [200, 180, 250], hp: [300, 400, 520], bt: [80, 110, 140], r: 0.9, solid: 1, pw: true,
    range: [8, 8, 8], eff: [1.1, 1.15, 1.2] },
  { key: 'generator', fam: 'sup', name: 'Генератор', blurb: 'Башни рядом бьют чаще. Тесла без него не включится',
    tier: 1, cap: 2, cost: [180, 160, 220], hp: [350, 460, 600], bt: [60, 90, 120], r: 1, solid: 1,
    range: [9, 9, 9], eff: [0.85, 0.8, 0.75] },
  // ---- superweapons ---------------------------------------------------------------------------
  { key: 'sabvufer', fam: 'super', name: 'Сабвуфер', blurb: 'Минуту качает бас у всех на виду, потом волна раскидывает всех, кто подошёл',
    tier: 3, cap: 1, cost: [500, 400, 600], hp: [500, 650, 850], bt: [150, 200, 250], r: 1.2, solid: 1, pw: true,
    range: [12, 12, 12], dmg: [30, 45, 60] },
  { key: 'arbuzomet', fam: 'super', name: 'Арбузомёт', blurb: 'Долго заряжается, зато арбуз прилетает куда скажешь',
    tier: 3, cap: 1, cost: [600, 450, 650], hp: [450, 600, 780], bt: [150, 200, 250], r: 1.2, solid: 1,
    dmg: [220, 300, 400], sp: 5 },
];

/** key → building type (index in BUILDINGS). */
export const BKEY: Record<string, number> = {};
BUILDINGS.forEach((d, i) => { BKEY[d.key] = i; });

/** AI build weights by key (0 = never on its own). Прорабская, Ларёк and the first Рогатки come first whatever the weights. */
export const AI_BW: Record<string, number> = {
  rogatka: 10, sebozol: 8, sperm: 6, tesla: 5, gantel: 6, antidron: 0, kamera: 4, kuryatnik: 4, bukva_n: 4,
  zabor: 5, shlagbaum: 2, grabli: 5, yama: 4, lezhak: 3, nychka: 3, sobaka: 4,
  larek: 9, shaurma: 4, seyf: 2, zagon: 5, prorab: 0, kachalka: 4, garazh: 3, vyshka: 3, generator: 5,
  sabvufer: 2, arbuzomet: 2,
};

const sec = (ticks: number) => `${Math.round(ticks) / 10} с`;
const pct = (m: number) => `${m >= 1 ? '+' : '−'}${Math.round(Math.abs(m - 1) * 100)}%`;
/** Short stat lines for an info panel: [label, value] pairs for level lv (1..3). Clean Russian, numbers from the table. */
export function bldStats(t: number, lv: number): [string, string][] {
  const d = BUILDINGS[t], i = Math.max(0, Math.min(2, lv - 1)), out: [string, string][] = [];
  if (!d) return out;
  out.push(['Прочность', String(d.hp[i])]);
  if (d.dmg) out.push(['Урон', String(d.dmg[i])]);
  if (d.range) out.push([d.fam === 'trap' && d.key !== 'sobaka' ? 'Срабатывает в' : 'Радиус', String(d.range[i])]);
  if (d.min) out.push(['Не ближе', String(d.min)]);
  if (d.sp) out.push(['По площади', String(d.sp)]);
  if (d.rate && d.key !== 'shaurma') out.push([d.fam === 'trap' && d.key !== 'sobaka' ? 'Перезарядка' : 'Раз в', sec(d.rate[i])]);
  if (d.inc) out.push([d.key === 'zagon' ? 'Доход до' : 'Доход', `${d.inc[i]} ₽/с`]);
  if (d.eff) {
    const e = d.eff[i];
    switch (d.key) {
      case 'sebozol': out.push(['Замедляет на', sec(e)]); break;
      case 'sperm': out.push(['Клеит до', sec(e * 10)]); break;
      case 'kamera': out.push(['Урон по отмеченным', pct(e)]); break;
      case 'kuryatnik': out.push(['Куриц за раз', String(e)]); break;
      case 'bukva_n': case 'grabli': case 'yama': case 'lezhak': out.push(['Оглушает на', sec(e)]); break;
      case 'nychka': out.push(['Травит', sec(e)]); break;
      case 'shaurma': out.push(['Лечит в секунду', `${Math.round(e * 1000) / 10}%`]); break;
      case 'seyf': out.push(['Прячет', `${e} ₽`]); break;
      case 'kachalka': out.push(['Здоровье своих', pct(e)]); break;
      case 'garazh': out.push(['Цена машин', pct(e)], ['Скорость машин', pct(d.eff2![i])]); break;
      case 'vyshka': out.push(['Дальность башен', pct(e)]); break;
      case 'generator': out.push(['Перезарядка башен', pct(e)]); break;
    }
  }
  if (d.key === 'sabvufer') out.push(['Заряд', sec(BASE.subCharge)]);
  if (d.key === 'arbuzomet') out.push(['Заряд', sec(BASE.arbCharge)]);
  return out;
}
