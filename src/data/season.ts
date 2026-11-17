// v4: сезон на неделю, Грозный, прогресс игрока, коллекция, концовки. Только данные и чистые
// функции: из src/sim здесь ничего не импортируется, поэтому симуляция может брать отсюда числа так
// же, как берёт CAPTURE_PLACES из places.ts. Дизайн целиком описан в SPEC.md трека v4design.
//
// Время сезона — это тики симуляции (10 в секунду), то есть АКТИВНОЕ время мира: общий мир спит,
// пока никто не играет. Поле `ch` у всего контента — ИНДЕКС главы 0..6 (номер главы минус один).
//
// Политика текстов: никаких реальных девушек, «грязнулек» и «собери девочек»; никаких адресов и
// «кто на каком этаже живёт»; Ансар закрывают и снимают вывеску, а не взрывают; квадрики —
// хобби (камера, шаурма, конспекты); снюс и LOOP — только 18+ и всегда с чистым двойником;
// пошлятина про участников беседы — только spicy: true, без подробностей и с чистой заменой.

import type { Line } from './lore';

// ---- главы ---------------------------------------------------------------------------------------

export type ChapterId = 'vysotka' | 'gorod' | 'ansar' | 'chgu' | 'shaiba' | 'komissionka' | 'final';

/** Что открывается с главой (накопительно: всё, что открыла прошлая глава, остаётся). */
export type UnlockKey =
  | 'base'
  | 'grozny' | 'ggntu' | 'ipit' | 'ipitovets' | 'doner_real' | 'stops'
  | 'ansar' | 'ansar_hack' | 'drop'
  | 'chgu' | 'drone' | 'operator'
  | 'shaiba' | 'bmw'
  | 'komissionka' | 'snitch'
  | 'finale';

export interface Chapter {
  id: ChapterId;
  /** Номер главы для экрана, 1..7. */
  n: number;
  title: string;
  subtitle: string;
  unlocks: UnlockKey[];
  /** Беседа, когда глава начинается: в ленту по одной строке раз в полторы секунды. */
  intro: Line[];
  /** Стикер под счётом, пока идёт глава. */
  goal: string;
  /** Тизер в меню, пока глава ещё закрыта. */
  teaser: string;
  /** Ключ картинки для карточки главы (см. CHAPTER_ART). */
  art: string;
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'vysotka', n: 1, title: 'Высотка', subtitle: 'Атаги против Курчалоя. Как всегда',
    unlocks: ['base'],
    intro: [
      { t: 'Курчалой, ну как там, завидуете?', who: 'Ислам' },
      { t: 'Для тебя это как небоскрёб', who: 'Зураб' },
      { t: 'Не успокоюсь, пока 4 этажа не найду', who: 'Ислам' },
      { t: 'Сезон начался. Счёт сезона — в углу. Неделя игры, потом концовка' },
      { t: 'Ходи оглядывайся нахуй', who: 'Зураб', spicy: true },
    ],
    goal: 'Выигрывай войны: +10 в счёт сезона. Этаж соседей — +1, босс — +3',
    teaser: 'Атаги против Курчалоя',
    art: 'ch_vysotka',
  },
  {
    id: 'gorod', n: 2, title: 'Город', subtitle: 'Грозный открыт: ГГНТУ, ИПИТ и Донер Бей на своём месте',
    unlocks: ['grozny', 'ggntu', 'ipit', 'ipitovets', 'doner_real', 'stops'],
    intro: [
      { t: 'Г1алахь свет йуй? (в городе свет есть?)', who: 'админ' },
      { t: 'ggntu was never designed for you to win', who: 'Амин' },
      { t: 'Каких монстров примет ИПИТ', who: 'Ислам' },
      { t: 'Ипитовцы помогут', who: 'Амин' },
      { t: 'Донер Бей переехал на своё место. Ул. Мира, 83/1. Шаурма та же' },
      { t: 'В город: Атаги — от остановки 55-й у молла, Курчалой — с автостанции. Дорога +20% к цене' },
    ],
    goal: 'Держи ГГНТУ: +1 в сезон каждые 3 минуты и взломы ИПИТа',
    teaser: 'Грозный. ГГНТУ. ИПИТовцы взламывают что угодно',
    art: 'ch_gorod',
  },
  {
    id: 'ansar', n: 3, title: 'Ансар', subtitle: 'Школа программирования. Списывает без спроса',
    unlocks: ['ansar', 'ansar_hack', 'drop'],
    intro: [
      { t: 'Самая крутая школа программирования. Hello world за 9 месяцев', who: 'Чимаев' },
      { t: 'Сколько там стоит?', who: 'админ' },
      { t: '12к. За 6 уроков', who: 'Чимаев' },
      { t: 'Кого запишут в Ансар — тупеет, а подписка списывается. Пока вывеску не снимут' },
      { t: 'Админ теперь умеет «Дроп»: принимает всё на свою карту' },
      { t: 'Наши деньги в безопасности?', who: 'Ислам' },
    ],
    goal: 'Записали в Ансар — сними вывеску. Закрыл Ансар — +2 в сезон',
    teaser: 'Ансар. Если там учиться — тупеешь, а деньги списываются',
    art: 'ch_ansar',
  },
  {
    id: 'chgu', n: 4, title: 'ЧГУ', subtitle: 'Высокие студенты и квадрики над городом',
    unlocks: ['chgu', 'drone', 'operator'],
    intro: [
      { t: 'ЧГУ открыт. Средний рост — 180. Пацаны из Атагов ходят на носочках' },
      { t: 'Топ-1 ранкед чад ГГНТУ бросил вызов топ-1 ранкед чаду ЧГУ', who: 'Ислам' },
      { t: 'Свет и ракурс идеальный', who: 'Амин' },
      { t: 'Оппа, чесском-аккаунт', who: 'Ислам' },
      { t: 'Кто-то сидит сзади с телефоном. Оператор. Кто — неизвестно' },
    ],
    goal: 'ЧГУ: кого ставишь там — выходит высоким. +1 в сезон каждые 3 минуты',
    teaser: 'ЧГУ, квадрики и кто-то сзади с телефоном',
    art: 'ch_chgu',
  },
  {
    id: 'shaiba', n: 5, title: 'Шайба', subtitle: 'Самое высокое здание сезона. И синяя бэха',
    unlocks: ['shaiba', 'bmw'],
    intro: [
      { t: 'Почему Шайба в кадре', who: 'Амин' },
      { t: 'Трёхэтажка, пятиэтажка… а в центре Грозного стоит Шайба. Выше обеих' },
      { t: 'БМВ надо сначала разогнать, чтобы скидывать передачи', who: 'Амин' },
      { t: 'Напишите, как с СТО выедет ваша БМВ', who: 'Ислам' },
      { t: 'Для тебя это как небоскрёб. — Это и есть небоскрёб', who: 'Зураб и Чимаев' },
    ],
    goal: 'Держи Шайбу: +1 в сезон каждые 2 минуты и «вид с высоты»',
    teaser: 'ЖК «Шайба» и синяя бэха 380i',
    art: 'ch_shaiba',
  },
  {
    id: 'komissionka', n: 6, title: 'Комиссионка', subtitle: 'Герои пересдают. Стукач уже здесь',
    unlocks: ['komissionka', 'snitch'],
    intro: [
      { t: 'Математика комиссионка — самое страшное, что можно представить', who: 'Амин' },
      { t: 'Баля, никто комиссионку не сдал', who: 'Ислам' },
      { t: 'Физра, математика, малый предприятий, макро', who: 'Зураб' },
      { t: 'На комиссионке появился стукач. Сдаёт всех. Его ненавидят все' },
      { t: 'Баля, у меня ёбаные 4 комиссионки', who: 'Зураб', spicy: true },
    ],
    goal: 'Последняя глава перед финалом. Счёт сезона ещё можно развернуть',
    teaser: 'Комиссионка, сессия и стукач',
    art: 'ch_komissionka',
  },
  {
    id: 'final', n: 7, title: 'Финал', subtitle: 'Боссы злее. Ничья — это Донер Бей',
    unlocks: ['finale'],
    intro: [
      { t: 'Финал сезона. Ислам и Зураб на 25% крепче' },
      { t: 'Я копил ульту. Теперь отдыхайте, ребята', who: 'Ислам' },
      { t: 'Баля ма зверь йу со (ну я и зверь)', who: 'Зураб' },
      { t: 'Тяжело в учении, легко в бою ☝🏿', who: 'Чимаев' },
      { t: 'Кто впереди по очкам к концу главы — тот и в концовке' },
    ],
    goal: 'Финал: кто впереди по очкам — получает концовку. Разница меньше 15 — ничья',
    teaser: 'Финал сезона и концовка',
    art: 'ch_final',
  },
];

/** Описание картинок карточек глав (для рендера в стиле тетради). */
export const CHAPTER_ART: Record<string, string> = {
  ch_vysotka: 'Трёхэтажка и пятиэтажка на двух краях листа, между ними Шали и Аргун ручкой',
  ch_gorod: 'Силуэт Грозного на горизонте, ГГНТУ с колоннами, вывеска Донер Бея с вертелом',
  ch_ansar: 'Офис с вывеской «Ансар», на мониторе «hello world», рядом счётчик рублей вниз',
  ch_chgu: 'Корпус ЧГУ, у входа ростомер с отметкой 180, над крышей квадрик с камерой',
  ch_shaiba: 'Круглая высотка выше полей листа, у подъезда синяя БМВ с открытым капотом',
  ch_komissionka: 'Аудитория, на доске «КОМИССИОНКА», в последнем ряду фигура в капюшоне с телефоном',
  ch_final: 'Ислам с барсеткой и Зураб в стойке друг напротив друга, между ними счёт сезона',
};

// ---- сезон: время, счёт, конец ---------------------------------------------------------------------

export const SEASON = {
  chapters: 7,
  /** Длина глав 1–6 в первом сезоне: 75 минут активного времени. */
  chTicks: 45000,
  /** Сезон 2 и дальше: тот же контент открывается быстрее — главы 1–6 по 45 минут. */
  chTicksFast: 27000,
  finaleTicks: 45000,
  finaleTicksFast: 36000,
  /** Финал истёк: сезон кончается на ближайшем конце войны, но не позже чем через 10 минут. */
  overtime: 6000,
  /** Досрочный финал: с главы-индекса 3 (глава 4), разрыв ≥ 150 на конце войны → сразу глава 7. */
  decisive: 150, decisiveFrom: 3,
  /** В финале разрыв ≥ 250 на конце войны заканчивает сезон сразу. */
  decisiveEnd: 250,
  /** Разница меньше этой — ничья. */
  drawMargin: 15,
  /** Пауза на концовку и Зал славы, потом новый сезон (тики). */
  endPause: 1200,
  score: {
    war: 10,
    /** Победа андердога (отстаёт на underBy и больше на момент конца войны). */
    warUnder: 15, underBy: 50,
    floor: 1,
    boss: 3,
    ansarClose: 2,
    eventGoal: 2,
  },
  /** Сколько тиков держать городское место за 1 очко сезона. */
  hold: { ggntu: 1800, chgu: 1800, shaiba: 1200 },
  /** «Аура андердога»: +inc ₽/с за каждые `per` очков отставания, не больше `max`. */
  underdog: { per: 25, inc: 1, max: 4 },
  /** Деньги на старте войны после поражений подряд: [0, 1, 2+]. */
  comeback: [0, 150, 300],
  /** Финал: боссы крепче, злее и возвращаются быстрее. */
  finale: { bossHp: 1.25, bossDmg: 1.15, bossRespawn: 900 },
  /** Игрок считается активным для баффов коллекции, если действовал за последние 15 минут. */
  activeWindow: 9000,
  /** Пределы для админской настройки длины глав, минуты. */
  lenMin: 5, lenMax: 240,
} as const;

/** Длина главы `ch` (0..6) в сезоне `n`, в тиках. `chLen` — админская длина глав 1–6 в минутах. */
export function chapterTicks(n: number, ch: number, chLen?: number): number {
  const fast = n >= 2;
  if (ch >= SEASON.chapters - 1) return fast ? SEASON.finaleTicksFast : SEASON.finaleTicks;
  if (chLen && chLen >= SEASON.lenMin && chLen <= SEASON.lenMax) return Math.floor(chLen) * 600;
  return fast ? SEASON.chTicksFast : SEASON.chTicks;
}

/** Индекс главы, с которой открывается `key`. */
export function unlockChapter(key: UnlockKey): number {
  for (let i = 0; i < CHAPTERS.length; i++) if (CHAPTERS[i].unlocks.includes(key)) return i;
  return 0;
}

/** Открыт ли `key` в главе-индексе `ch`. */
export function isUnlocked(key: UnlockKey, ch: number): boolean {
  return unlockChapter(key) <= ch;
}

/** Итог сезона по счёту: -1 ничья, 0 Атаги, 1 Курчалой. */
export function seasonResult(a: number, k: number): -1 | 0 | 1 {
  if (Math.abs(a - k) < SEASON.drawMargin) return -1;
  return a > k ? 0 : 1;
}

// ---- баланс v4 (числа для симуляции; тики, если не сказано иначе) ---------------------------------

export const V4 = {
  /** Индексы новых типов юнитов в UNITS (по общему контракту). 18 занят Аминой (танк Атагов), поэтому v4 — с 19. */
  types: { ipit: 19, operator: 20, snitch: 21, drone: 22, bmw: 23 },
  /** Порядок карточек в магазине после Гелика (16): бэха, квадрик, ИПИТовцы, оператор, стукач. */
  shopAfterGelik: [23, 22, 19, 20, 21],
  /** Веса ИИ при покупке (ИПИТовцы — только пока сторона держит ГГНТУ). */
  ai: { ipit: 4, operator: 2, snitch: 3, drone: 4, bmw: 4 },
  /** Городские места (Pt.kind 4): радиус, вес цели для ИИ. */
  city: { r: 2.8, aiW: 1.15, aiShaiba: 1.3 },
  /** Остановки в городе (Pt.kind 6): зона высадки своей стороны, цена ×markup. */
  stop: { r: 4, markup: 1.2 },
  /** Донер Бей на настоящем месте: радиус захвата меньше, чтобы не наезжать на Шайбу. */
  doner: { r: 3 },
  /** ЧГУ «Высокие»: юниты, поставленные в круге ЧГУ его хозяином. */
  chgu: { hp: 1.15, range: 1.1, scale: 1.15 },
  /** Шайба «Вид с высоты»: раз в `every` хозяин получает деньги и разведку; дальнобойные рядом бьют дальше. */
  shaiba: { every: 900, money: 80, intel: 200, range: 1.1, rangeR: 30 },
  /** Ансар — нейтральная ловушка (Pt.kind 5). */
  ansar: {
    r: 3,
    signHp: 1500,
    /** После снятия вывески Ансар закрыт 5 минут, потом «новый поток». */
    closedFor: 3000,
    /** Записанная сторона «тупеет». */
    dmg: 0.8, spd: 0.85,
    /** Раз в wrongEvery каждый юнит с шансом wrongChance идёт не туда wrongFor тиков. */
    wrongEvery: 50, wrongChance: 0.15, wrongFor: 20,
    /** «Подписка списывается», ₽/с. */
    debit: 2,
    /** Предохранитель: запись кончается сама через 180 с («курс закончился»). */
    maxFor: 1800,
    /** Карточка «Пробный урок бесплатно»: запись на 90 с. */
    trialFor: 900,
    /** Снявшая вывеску сторона: +₽ (и +2 в сезон, см. SEASON.score.ansarClose). */
    closeMoney: 100,
    /** ИИ записанной стороны: вес цели «вывеска» и сколько юнитов слать. */
    aiW: 1.5, aiMin: 4,
  },
  /** ИПИТовцы ×2: авто-«Взлом» раз в 15 с. */
  ipitUnit: { turretR: 10, turretOff: 80, kraOff: 100, heroCd: 100 },
  /** Оператор: виден врагам только вплотную; «Ник спалили» Амину. */
  operator: { see: 2, keep: 5, nickR: 6, nickFor: 200, nickCd: 600, revealDrone: 8, revealMark: 80 },
  /** Стукач с комиссионки: «Сдал всех» и «Все его ненавидят». */
  snitch: { trigN: 3, mark: 1.25, markFor: 80, aura: 4, auraDmg: 0.9 },
  /** Квадрик: батарейка, шаурма, конспекты, камера. */
  drone: {
    life: 900,
    heal: 40, healN: 6, healR: 4, healTrig: 0.7, healTrigN: 2, healTrigR: 6,
    notesR: 3.5, notesStun: 20, notesTrigR: 5, notesTrigN: 3,
    reveal: 8,
  },
  /** Синяя бэха: «разогнать и скидывать передачи», «на СТО». */
  bmw: { accel: 30, accelSpd: 0.5, burst: 50, burstSpd: 1.6, burstDmg: 2, burstMin: 12, stoEvery: 600, stoChance: 0.2, stoFor: 300 },
  /** админ «Дроп»: урон по своим рядом уходит на него ×take. */
  drop: { r: 8, dur: 50, take: 0.5, cd: 400, first: 200, low: 0.5, lowN: 3, heroLow: 0.3, cardR: 1.5, cardMoney: 120 },
  /** Разведка (только для UI той стороны, но лежит в состоянии симуляции). */
  intel: { leak: 600, view: 200 },
  /** Новые мировые события. */
  events: {
    activ: { dur: 600, capMul: 2, pts: 2, money: 150 },
    ansarSet: { dur: 450 },
    sess: { dur: 400, hero: 0.7, heroLate: 0.6, unit: 1.1 },
    sto: { dur: 300, spd: 0.6 },
    view: { dur: 300, range: 1.15, pts: 2 },
    kom: { dur: 250, pass: 0.5, passHp: 1.1, failDmg: 0.9, failFor: 600 },
  },
  /** Новые карточки схода 34..42. */
  cards: {
    activDmg: 1.1, activFor: 300, activMoney: 100,
    brsPoorFor: 150,
    trialMoney: 150, trialSpd: 1.1, trialSpdFor: 200,
    tallFor: 300,
    gearsSpd: 1.4, gearsFor: 200,
    retakeHeal: 0.5,
    snitchR: 15, snitchFor: 100,
  },
} as const;

// ---- Грозный: места ----------------------------------------------------------------------------------

export type CityKey = 'doner' | 'ggntu' | 'chgu' | 'shaiba' | 'ansar' | 'stopA' | 'stopK';

export interface CityPoint {
  key: CityKey;
  /** Индекс в st.pts (8 — существующий Донер Бей, 13..18 — новые). */
  idx: number;
  name: string;
  /** 2 — Донер Бей; 4 — «город» (захват, перк, очки сезона); 5 — ловушка (Ансар); 6 — остановка стороны. */
  kind: 2 | 4 | 5 | 6;
  /** Сторона остановки; -1 у остальных. */
  side: -1 | 0 | 1;
  /** Глава-индекс, с которой место живое (до неё — серое, не берётся). */
  ch: number;
  /** Здание: настоящая позиция из 2GIS, мировые единицы. Для остановок — то же, что x, z. */
  bx: number; bz: number;
  /** Центр круга захвата / зоны: сдвинут от здания, чтобы круги в центре не наезжали. */
  x: number; z: number;
  r: number;
  /** Перк одной строкой (подробно — CITY_TEXT в v4lore.ts). */
  perk: string;
  /** Настоящее место (2GIS) или игровая точка, поставленная руками. */
  real: boolean;
}

/**
 * Предложенная раскладка. Мировые координаты: x = (lon − 45.665) / 0.49 × 398,
 * z = (43.3 − lat) / 0.245 × 272 (карта будет продлена на север до z ≈ −35). Картограф может
 * сдвинуть центр круга до 1.5 единицы на проходимую клетку с проходимым блоком 3×3, сохраняя
 * зазор ≥ 0.2 между кругами. Здания (bx, bz) рендер ставит на настоящие точки.
 */
export const CITY_POINTS: CityPoint[] = [
  { key: 'doner', idx: 8, name: 'Донер Бей', kind: 2, side: -1, ch: 1, bx: 21.2, bz: -26.4, x: 21.2, z: -26.4, r: 3.0, perk: '+5 ₽/с, свои рядом лечатся', real: true },
  { key: 'ggntu', idx: 13, name: 'ГГНТУ', kind: 4, side: -1, ch: 1, bx: 25.4, bz: -22.8, x: 27.6, z: -22.4, r: 2.8, perk: 'ИПИТ: взломы за рубли. +1 в сезон каждые 3 мин', real: true },
  { key: 'chgu', idx: 14, name: 'ЧГУ', kind: 4, side: -1, ch: 3, bx: 31.3, bz: -13.0, x: 31.8, z: -12.2, r: 3.2, perk: 'Высокие: +15% здоровья и +10% дальности. +1 в сезон каждые 3 мин', real: true },
  { key: 'shaiba', idx: 15, name: 'ЖК «Шайба»', kind: 4, side: -1, ch: 4, bx: 22.5, bz: -22.8, x: 22.2, z: -20.2, r: 2.8, perk: 'Вид с высоты: +80 ₽ и разведка раз в 90 с. +1 в сезон каждые 2 мин', real: true },
  { key: 'ansar', idx: 16, name: 'Ансар', kind: 5, side: -1, ch: 2, bx: 31.6, bz: 3.6, x: 31.6, z: 3.6, r: 3.0, perk: 'Ловушка: записанные тупеют и платят 2 ₽/с, пока вывеску не снимут', real: true },
  { key: 'stopA', idx: 17, name: 'Остановка 55-й у молла', kind: 6, side: 0, ch: 1, bx: 10.0, bz: -18.0, x: 10.0, z: -18.0, r: 4.0, perk: 'Атаги высаживаются в городе. Дорога +20% к цене', real: false },
  { key: 'stopK', idx: 18, name: 'Автостанция: маршрутка 150', kind: 6, side: 1, ch: 1, bx: 40.0, bz: -24.0, x: 40.0, z: -24.0, r: 4.0, perk: 'Курчалой высаживается в городе. Дорога +20% к цене', real: false },
];

/** Декор без точки симуляции (рендер ставит здание и вывеску). */
export const CITY_DECOR = [
  { key: 'chgu2', name: 'ЧГУ, другой корпус', bx: 48.8, bz: -16.6, ch: 3 },
  { key: 'ansar2', name: 'Ансар. Филиал', bx: 11.6, bz: -23.5, ch: 2 },
] as const;

/** Индекс точки по ключу (для симуляции и UI). */
export const CITY_IDX: Record<CityKey, number> = {
  doner: 8, ggntu: 13, chgu: 14, shaiba: 15, ansar: 16, stopA: 17, stopK: 18,
};

// ---- ГГНТУ: взломы ИПИТа --------------------------------------------------------------------------------

export type HackId = 'turret' | 'brs' | 'leak' | 'vote' | 'ansar' | 'drones';

export interface IpitHack {
  id: HackId;
  title: string;
  /** Что делает (всегда чисто). */
  desc: string;
  /** Цена в ₽ до скидок (бафф коллекции 'hack', не больше −25%). */
  price: number;
  /** Откат на сторону, тики. */
  cd: number;
  /** Длительность эффекта, тики (0 — мгновенный). */
  dur: number;
  /** Глава-индекс, с которой взлом доступен. */
  ch: number;
}

/** Порядок важен: команда { k: 'hack', h } — индекс в этом массиве. */
export const IPIT_HACKS: IpitHack[] = [
  { id: 'turret', title: 'Отключить турель', desc: 'Турель соседской высотки молчит 20 секунд', price: 220, cd: 900, dur: 200, ch: 1 },
  { id: 'brs', title: 'Взлом БРС', desc: 'Доход соседей — ноль на 15 секунд', price: 300, cd: 1200, dur: 150, ch: 1 },
  { id: 'leak', title: 'Слить следующую покупку', desc: 'Минуту видно кассу соседей, их покупки и их сход', price: 100, cd: 600, dur: 600, ch: 1 },
  { id: 'vote', title: 'Вброс на сходе', desc: 'Пока у соседей сход: +3 голоса за то, за что у них голосуют меньше всего', price: 200, cd: 1500, dur: 0, ch: 1 },
  { id: 'ansar', title: 'Записать соседей в Ансар', desc: 'Соседи тупеют и платят подписку, пока не снимут вывеску (до 3 минут)', price: 350, cd: 1800, dur: 1800, ch: 2 },
  { id: 'drones', title: 'Перехватить квадрики', desc: 'У всех соседских квадриков садится батарейка', price: 180, cd: 900, dur: 0, ch: 3 },
];

/** Причины отказа во взломе (FxEv 'deny' why). */
export const IPIT_DENY = {
  noGgntu: 'ГГНТУ не наш',
  locked: 'ИПИТ этому ещё не научился',
  cd: 'ИПИТовцы ещё взламывают прошлое',
  money: 'Голда не на балике',
  noVote: 'У соседей сейчас нет схода',
  ansarClosed: 'Ансар закрыт. Записывать некуда',
  already: 'Соседи уже учатся в Ансаре',
} as const;

// ---- игрок: опыт и звания (только UI, в симуляцию не попадает) ------------------------------------------

export interface Rank {
  id: string;
  title: string;
  /** Опыт, с которого звание. */
  xp: number;
  /** Слотов коллекции на этом звании. */
  slots: number;
  /** Печать рядом с именем в ленте и на доске. */
  stamp: string;
  /** Что пишет беседа при повышении. */
  up: Line;
}

export const RANKS: Rank[] = [
  { id: 'r0', title: 'Первокурсник', xp: 0, slots: 1, stamp: '', up: { t: 'Новенький я тут', who: 'Адам' } },
  { id: 'r1', title: 'Активист', xp: 250, slots: 2, stamp: 'значок', up: { t: 'Посвящение в активисты ГГНТУ', who: 'Амин' } },
  { id: 'r2', title: 'Староста', xp: 800, slots: 2, stamp: 'журнал', up: { t: 'Перекличка', who: 'админ' } },
  { id: 'r3', title: 'Отличник', xp: 1800, slots: 3, stamp: 'зачётка', up: { t: 'Ши отличник баля (два отличника, баля)', who: 'Зураб' } },
  { id: 'r4', title: 'Автомат', xp: 3200, slots: 3, stamp: 'печать «автомат»', up: { t: 'Баля, у меня по 3 из 4 экзаменов автомат', who: 'Ислам' } },
  { id: 'r5', title: 'Ранкед чад', xp: 5000, slots: 3, stamp: 'барсетка', up: { t: 'Ты dangerously close к моему уровню', who: 'Ислам' } },
  { id: 'r6', title: 'Легенда района', xp: 7500, slots: 3, stamp: 'золотая ручка', up: { t: 'Король клещ рояльчика (я про себя)', who: 'Зураб' } },
];

/** Звание по опыту. */
export function rankFor(xp: number): Rank {
  let r = RANKS[0];
  for (const k of RANKS) if (xp >= k.xp) r = k;
  return r;
}

/** Опыт (UI). Капы — за одну войну. */
export const XP = {
  warWin: 50, warLoss: 20, warMinDeploys: 3,
  mvp: 40, topLoser: 20,
  kill: 1, killCap: 80,
  capture: 5, floor: 10, vote: 3, hack: 5, ansarClosed: 15,
  firstWarOfDay: 25,
  seasonWin: 300, seasonDraw: 150, seasonLoss: 100,
  /** «Каждый день на паре»: +10% за каждый день подряд, не больше +50%. */
  streakStep: 0.1, streakMax: 0.5,
  /** Бонус «схода дня» на его ключ. */
  dailyBonus: 1.5,
  pollVote: 20,
} as const;

// ---- ежедневные задания ----------------------------------------------------------------------------------

/** Что UI считает для задания (из FxEv и состояния, как achievements.ts). */
export type QuestTrack =
  | 'deploy' | 'win' | 'vote' | 'kills' | 'caps' | 'floors' | 'heroes' | 'doner' | 'mvp' | 'friend'
  | 'hold_ggntu' | 'hack' | 'ansar' | 'drop' | 'drone' | 'tall' | 'hold_shaiba' | 'gears' | 'snitch'
  | 'floor4' | 'floorUp';

export interface QuestTemplate {
  id: string;
  /** {n} — сколько нужно. */
  title: string;
  /** Варианты n (выбирается хешем). */
  n: number[];
  xp: number;
  /** Сложное: в дне не больше одного. */
  hard?: true;
  /** Глава-индекс, с которой задание может выпасть. */
  ch: number;
  /** Только для этой стороны. */
  side?: 0 | 1;
  track: QuestTrack;
  quote?: Line;
}

export const DAILY_QUESTS: QuestTemplate[] = [
  { id: 'deploy', title: 'Поставь {n} юнитов', n: [15, 25], xp: 40, ch: 0, track: 'deploy', quote: { t: 'Чу вала!', who: 'Чимаев' } },
  { id: 'win', title: 'Выиграй войну', n: [1], xp: 100, hard: true, ch: 0, track: 'win', quote: { t: 'Исход очевиден', who: 'Чимаев' } },
  { id: 'vote', title: 'Проголосуй на {n} сходах', n: [3], xp: 40, ch: 0, track: 'vote', quote: { t: 'Голос Амина всё решит', who: 'Зураб' } },
  { id: 'kills', title: 'Твои юниты убьют {n} врагов', n: [30, 60], xp: 60, ch: 0, track: 'kills', quote: { t: 'Мы тебя по одиночке толпой забьём', who: 'Мохьмад' } },
  { id: 'caps', title: 'Возьми {n} села', n: [2, 3], xp: 50, ch: 0, track: 'caps', quote: { t: 'Йоккха Атаг1а — центр мира', who: 'Ислам' } },
  { id: 'floors', title: 'Снеси {n} этажа соседей', n: [2], xp: 60, ch: 0, track: 'floors', quote: { t: 'Подумаешь, ещё три башни снести — и ты бы выиграл' } },
  { id: 'heroes', title: 'Выведи {n} героев за одну войну', n: [2, 3], xp: 40, ch: 0, track: 'heroes', quote: { t: 'Мы отправляем сильнейшего', who: 'Ислам' } },
  { id: 'doner', title: 'Возьми Донер Бей', n: [1], xp: 50, ch: 0, track: 'doner', quote: { t: 'Донербей чохь цхьан кхет вай (в Донер Бее встретимся)', who: 'Зураб' } },
  { id: 'mvp', title: 'Стань тем, кто тащил', n: [1], xp: 120, hard: true, ch: 0, track: 'mvp', quote: { t: 'Я соло за Курчалой тащу', who: 'Чимаев' } },
  { id: 'friend', title: 'Сыграй войну, когда в ней есть кто-то ещё из беседы', n: [1], xp: 60, ch: 0, track: 'friend', quote: { t: 'Ловз г1о по-братски (пошли поиграем)', who: 'Бекхан' } },
  { id: 'floor4', title: 'Найди 4-й этаж (дострой трёхэтажку)', n: [1], xp: 80, hard: true, ch: 0, side: 0, track: 'floor4', quote: { t: 'Не успокоюсь, пока 4 этажа не найду', who: 'Ислам' } },
  { id: 'floorUp', title: 'Надстрой Бурдж-Халифу', n: [1], xp: 80, hard: true, ch: 0, side: 1, track: 'floorUp', quote: { t: 'Местный Бурдж-Халифа', who: 'Амин' } },
  { id: 'hold_ggntu', title: 'Держи ГГНТУ {n} минуты', n: [3, 4], xp: 80, ch: 1, track: 'hold_ggntu', quote: { t: 'ggntu was never designed for you to win', who: 'Амин' } },
  { id: 'hack', title: 'Закажи {n} взлома у ИПИТа', n: [2, 3], xp: 60, ch: 1, track: 'hack', quote: { t: 'Ипитовцы помогут', who: 'Амин' } },
  { id: 'ansar', title: 'Сними вывеску Ансара', n: [1], xp: 100, hard: true, ch: 2, track: 'ansar', quote: { t: 'Надо отменять подписку', who: 'Амин' } },
  { id: 'drop', title: 'Админ: прими на карту {n} урона', n: [500, 1000], xp: 70, ch: 2, track: 'drop', quote: { t: 'Наши деньги в безопасности?', who: 'Ислам' } },
  { id: 'drone', title: 'Запусти {n} квадрика', n: [3], xp: 50, ch: 3, track: 'drone', quote: { t: 'Свет и ракурс идеальный', who: 'Амин' } },
  { id: 'tall', title: 'Выведи {n} высоких из ЧГУ', n: [4, 8], xp: 60, ch: 3, track: 'tall', quote: { t: 'Средний рост — 180' } },
  { id: 'hold_shaiba', title: 'Держи Шайбу {n} минуты', n: [3, 4], xp: 90, ch: 4, track: 'hold_shaiba', quote: { t: 'Почему Шайба в кадре', who: 'Амин' } },
  { id: 'gears', title: 'Разгони синюю бэху {n} раза', n: [2, 3], xp: 50, ch: 4, track: 'gears', quote: { t: 'БМВ надо сначала разогнать, чтобы скидывать передачи', who: 'Амин' } },
  { id: 'snitch', title: 'Выведи стукача с комиссионки', n: [1], xp: 40, ch: 5, track: 'snitch', quote: { t: 'Баля, никто комиссионку не сдал', who: 'Ислам' } },
];

/** FNV-1a, 32 бита. Детерминированный хеш строки (для выбора заданий, схода дня). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Ключ «дня» YYYY-MM-DD по местному времени; день начинается в 04:00 («после клеш рояля»). */
export function dayKey(d: Date = new Date()): string {
  const t = new Date(d.getTime() - 4 * 3600 * 1000);
  const m = t.getMonth() + 1, dd = t.getDate();
  return `${t.getFullYear()}-${m < 10 ? '0' : ''}${m}-${dd < 10 ? '0' : ''}${dd}`;
}

export interface PickedQuest { id: string; title: string; n: number; xp: number; track: QuestTrack }

/**
 * Три задания на день для игрока `uid`: детерминированно по (uid, day, salt), не больше одного
 * сложного, только открытые главой `ch` и подходящие стороне. `salt` > 0 — после переброса.
 */
export function pickQuests(uid: string, day: string, ch: number, side: 0 | 1, salt = 0): PickedQuest[] {
  const pool = DAILY_QUESTS.filter(q => q.ch <= ch && (q.side === undefined || q.side === side));
  const out: PickedQuest[] = [];
  let hard = false;
  let h = hash32(`${uid}|${day}|${salt}`);
  for (let guard = 0; out.length < 3 && guard < 64; guard++) {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    const q = pool[h % pool.length];
    if (!q || out.some(o => o.id === q.id) || (q.hard && hard)) continue;
    if (q.hard) hard = true;
    const n = q.n[(h >>> 8) % q.n.length];
    out.push({ id: q.id, title: q.title.replace('{n}', String(n)), n, xp: q.xp, track: q.track });
  }
  return out;
}

// ---- коллекция ---------------------------------------------------------------------------------------------
// Карточки легенд беседы и вещей. Каждая даёт один маленький бафф. В общей войне надетые карты всех
// активных игроков стороны складываются в бафф стороны и режутся BUFF_CAPS — так это детерминировано
// и честно. Ключи xp и find — только для UI самого игрока, в симуляцию не идут.

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'cursed';

export const RARITY: Record<Rarity, { title: string; weight: number; dupXp: number; pen: string }> = {
  common: { title: 'Обычная', weight: 60, dupXp: 10, pen: 'синяя ручка' },
  rare: { title: 'Редкая', weight: 27, dupXp: 25, pen: 'зелёная ручка' },
  epic: { title: 'Эпическая', weight: 10, dupXp: 60, pen: 'фиолетовая ручка' },
  legendary: { title: 'Легендарная', weight: 3, dupXp: 150, pen: 'золотая ручка' },
  cursed: { title: 'Проклятая', weight: 0, dupXp: 5, pen: 'красная ручка, зачёркнуто' },
};

/** Ключи баффов. Порядок SIM_BUFF_KEYS — порядок массива sd.cb в симуляции. */
export type BuffKey = 'hp' | 'dmg' | 'spd' | 'inc' | 'start' | 'hero' | 'car' | 'heal' | 'cap' | 'luck' | 'hack' | 'drone' | 'stun' | 'xp' | 'find';
export const SIM_BUFF_KEYS: BuffKey[] = ['hp', 'dmg', 'spd', 'inc', 'start', 'hero', 'car', 'heal', 'cap', 'luck', 'hack', 'drone', 'stun'];
/** Только UI игрока: не складываются в бафф стороны. */
export const UI_BUFF_KEYS: BuffKey[] = ['xp', 'find'];

/**
 * Предел суммы на сторону (для xp/find — на игрока). Единицы: % для hp, dmg, spd, hero, car, heal,
 * cap, luck, hack, stun, xp, find; ₽/с для inc; ₽ для start; секунды для drone.
 */
export const BUFF_CAPS: Record<BuffKey, number> = {
  hp: 8, dmg: 6, spd: 6, inc: 4, start: 300, hero: 20, car: 15, heal: 20, cap: 15, luck: 6, hack: 25, drone: 30, stun: 20,
  xp: 50, find: 20,
};

/** Подписи баффов: {v} — значение. */
export const BUFF_TEXT: Record<BuffKey, string> = {
  hp: '+{v}% здоровья', dmg: '+{v}% урона', spd: '+{v}% скорости', inc: '+{v} ₽/с', start: '+{v} ₽ на старте войны',
  hero: '−{v}% к откату героев', car: '−{v}% к цене машин', heal: '+{v}% к лечению', cap: '+{v}% к захвату',
  luck: '+{v}% к увороту', hack: '−{v}% к цене взломов', drone: '+{v} с батарейки квадрика', stun: '+{v}% к «Н» и оглушениям',
  xp: '+{v}% опыта (тебе)', find: '+{v}% к шансу карточек (тебе)',
};

export interface Buff { key: BuffKey; value: number }

export interface CollectionCard {
  id: string;
  /** Название с выключенным 18+ (всегда чистое). */
  title: string;
  /** Название в 18+, если отличается. */
  spicyTitle?: string;
  rarity: Rarity;
  /** Ключ иконки для рендера карточки (см. CARD_ICONS). */
  icon: string;
  /** Описание (чистое). */
  desc: string;
  /** Описание в 18+, если отличается. */
  spicyDesc?: string;
  buff: Buff;
  /** Проклятые: ещё и минус. */
  curse?: Buff;
  /** Цитата на обороте. */
  quote?: Line;
  /** Глава-индекс, с которой карта может выпасть. */
  ch: number;
  /** true — есть 18+ вариант (spicyTitle / spicyDesc); бафф тот же. */
  spicy?: true;
  /** Не выпадает из обычных роллов: 'ansar' — выдаётся при записи в Ансар, 'fuji' — после «Шаурмы в кляре», 'season' — медаль сезона. */
  special?: 'ansar' | 'fuji' | 'season';
}

export const COLLECTION: CollectionCard[] = [
  // ---- обычные --------------------------------------------------------------------------------
  { id: 'lagman', title: 'Лагман Бекхана', rarity: 'common', icon: 'bowl', ch: 0,
    desc: 'Тарелка, вилка, дисциплина. Съедается один раз за жизнь', buff: { key: 'heal', value: 6 },
    quote: { t: 'Бекхан ест лагман', who: 'Зураб' } },
  { id: 'shaurma200', title: 'Шаурма за 200', rarity: 'common', icon: 'shawarma', ch: 0,
    desc: 'Атаги. Лучшая шаурма по мнению Атагов', buff: { key: 'heal', value: 5 },
    quote: { t: 'За 200 — лучшая шаурма в Атагах', who: 'Ислам' } },
  { id: 'shaurma250', title: 'Шаурма за 250', rarity: 'common', icon: 'shawarma_big', ch: 0,
    desc: 'Курчалой. На 50 ₽ дороже, на 50 ₽ сытнее', buff: { key: 'hp', value: 2 },
    quote: { t: 'Теория вкусной шаурмы в Курчалое', who: 'Чимаев' } },
  { id: 'taxi100', title: 'Чек: такси по 100', rarity: 'common', icon: 'receipt', ch: 0,
    desc: 'Экипажем. В тесноте, да не в обиде', buff: { key: 'car', value: 4 },
    quote: { t: 'Почему у таксиста режим вальгаллы включён???', who: 'Ислам' } },
  { id: 'marshrutka', title: 'Билет на маршрутку 150 ₽', rarity: 'common', icon: 'ticket', ch: 0,
    desc: 'Место не гарантируется. Стоять гарантируется', buff: { key: 'start', value: 50 },
    quote: { t: 'Ирахь хьа ва вез даимна (стоять всю дорогу)', who: 'Зураб' } },
  { id: 'creatine', title: 'Креатин с ВБ', rarity: 'common', icon: 'jar', ch: 0,
    desc: 'Банка на месяц. Хватило на неделю', buff: { key: 'hp', value: 2 },
    quote: { t: 'За 2500 это абонемент в зал и креатин с вб', who: 'Зураб' } },
  { id: 'cola', title: 'Кола', rarity: 'common', icon: 'cola', ch: 0,
    desc: 'Вторая рука для шампуня', buff: { key: 'spd', value: 1 },
    quote: { t: 'В одной руке шампунь, в другой кола', who: 'Ислам' } },
  { id: 'coffee', title: 'Кофе из кофейни', rarity: 'common', icon: 'coffee', ch: 0,
    desc: 'Вместо второй пары. Иногда и третьей', buff: { key: 'cap', value: 3 },
    quote: { t: 'На первую пару не приходим, на вторую опаздываем и выходим с кабинета, дальше в кофейню', who: 'Ислам' } },
  { id: 'chair', title: 'Стул админа', rarity: 'common', icon: 'chair', ch: 0,
    desc: 'Свой. Носит с собой', buff: { key: 'start', value: 40 },
    quote: { t: 'Я со своим стулом', who: 'админ' } },
  { id: 'pass_ggntu', title: 'Пропуск в ГГНТУ', rarity: 'common', icon: 'pass', ch: 1,
    desc: 'Охранник смотрит, но не читает', buff: { key: 'hack', value: 8 },
    quote: { t: 'ggntu was never designed for you to win', who: 'Амин' } },
  { id: 'konspekt', title: 'Конспект лекций', rarity: 'common', icon: 'notebook', ch: 3,
    desc: 'Чужой. Почерк не разобрать, но квадрик всё равно раздаёт', buff: { key: 'stun', value: 5 },
    quote: { t: 'А это надо конспектировать', who: 'Ислам' } },
  { id: 'sto_talon', title: 'Талон на СТО', rarity: 'common', icon: 'wrench', ch: 4,
    desc: 'Сход-развал без очереди. Почти', buff: { key: 'hp', value: 2 },
    quote: { t: 'Напишите, как с СТО выедет ваша БМВ', who: 'Ислам' } },

  // ---- редкие ---------------------------------------------------------------------------------
  { id: 'kra95', title: 'Номера КРА 95', rarity: 'rare', icon: 'plate', ch: 0,
    desc: 'Не номер, а характер. Машина под ними крепче', buff: { key: 'hp', value: 3 },
    quote: { t: 'Шучу, на S-класс Мерседес', who: 'Зураб' } },
  { id: 'ersno_card', title: 'Карта Мохьмада', rarity: 'rare', icon: 'bank_card', ch: 0,
    desc: 'Номер знают все. Деньги приходят сами', buff: { key: 'inc', value: 1 },
    quote: { t: 'Бизнес бабки', who: 'Мохьмад' } },
  { id: 'jurnal', title: 'Журнал с «Н»', rarity: 'rare', icon: 'journal', ch: 0,
    desc: 'Красная «Н» на каждой странице. Курчалою — две', buff: { key: 'stun', value: 10 },
    quote: { t: 'Н дилна хьун (тебе Н поставили)', who: 'админ' } },
  { id: 'chickengun', title: 'Чикен-ган', rarity: 'rare', icon: 'chicken', ch: 0,
    desc: 'Каждый должен скачать. Даже на паре', buff: { key: 'dmg', value: 2 },
    quote: { t: 'Каждый должен скачать чикенган', who: 'Ислам' } },
  { id: 'cups6000', title: 'Скрин: 6000 кубков', rarity: 'rare', icon: 'trophy', ch: 0,
    desc: 'Узник. Но кубки настоящие', buff: { key: 'xp', value: 10 },
    quote: { t: 'Теперь никто не назовёт меня узником 5 тыс. кубков', who: 'Зураб' } },
  { id: 'pack', title: 'Пачка с фото админа', rarity: 'rare', icon: 'pack', ch: 0,
    desc: 'Внутри пусто. На лицевой стороне — админ и надпись «Курение убивает»', buff: { key: 'stun', value: 6 },
    quote: { t: 'Эти твари меня вырезали', who: 'админ' } },
  { id: 'energy', title: 'Энергетик из ларька', spicyTitle: 'Снюс', rarity: 'rare', icon: 'can', ch: 0, spicy: true,
    desc: 'Банка из ларька у остановки. Бежишь быстрее, потом сдуваешься',
    spicyDesc: 'Под губу — и погнали. Потом отходняк', buff: { key: 'spd', value: 3 },
    quote: { t: 'Са адреналин хьал делар (у меня адреналин поднялся)', who: 'Ислам' } },
  { id: 'espresso', title: 'Двойной эспрессо', spicyTitle: 'Бамб LOOP', rarity: 'rare', icon: 'cup', ch: 0, spicy: true,
    desc: 'Две порции в одну чашку. Н не липнет, но потом сушняк',
    spicyDesc: 'Бамб LOOP под губу. Н не липнет, препод не видит', buff: { key: 'dmg', value: 3 },
    quote: { t: 'Мы под кофеином', who: 'Амин' } },
  { id: 'activist', title: 'Значок активиста ГГНТУ', rarity: 'rare', icon: 'badge', ch: 1,
    desc: 'Выдают после посвящения. Посвящение обязательное', buff: { key: 'cap', value: 5 },
    quote: { t: 'Обязательный ритуал', who: 'Амин' } },
  { id: 'drone_cam', title: 'Квадрик с камерой', rarity: 'rare', icon: 'drone', ch: 3,
    desc: 'Для красивых кадров и доставки шаурмы. Батарейка — лучше родной', buff: { key: 'drone', value: 15 },
    quote: { t: 'Свет и ракурс идеальный', who: 'Амин' } },
  { id: 'tall180', title: 'Ростомер «180»', rarity: 'rare', icon: 'ruler', ch: 3,
    desc: 'Из ЧГУ. Отметка 180 стёрта от частого использования', buff: { key: 'hp', value: 3 },
    quote: { t: 'Чел реально ростом с первый этаж Шайбы', who: 'Ислам' } },
  { id: 'bmw_keyfob', title: 'Брелок синей бэхи', rarity: 'rare', icon: 'keyfob', ch: 4,
    desc: '380i. Синяя. Разгоняется не сразу, зато потом скидывает передачи', buff: { key: 'car', value: 8 },
    quote: { t: 'БМВ надо сначала разогнать, чтобы скидывать передачи', who: 'Амин' } },
  { id: 'zachetka', title: 'Зачётка с комиссионки', rarity: 'rare', icon: 'zachetka', ch: 5,
    desc: 'Последняя подпись — с третьей попытки', buff: { key: 'hero', value: 8 },
    quote: { t: 'Мою зачётку не забудь', who: 'Ислам' } },

  // ---- эпические ------------------------------------------------------------------------------
  { id: 'bulls', title: 'Бомбер BULLS', rarity: 'epic', icon: 'bomber', ch: 0,
    desc: 'Чёрно-красный атлас. Хейтят все, завидуют все', buff: { key: 'spd', value: 4 },
    quote: { t: 'Буллс ю и (это BULLS)', who: 'Чимаев' } },
  { id: 'shampoo', title: 'Шампунь +40 к удаче', rarity: 'epic', icon: 'shampoo', ch: 0,
    desc: 'На этикетке так и написано. Почти', buff: { key: 'luck', value: 4 },
    quote: { t: 'Шампунь +40 к удаче', who: 'Чимаев' } },
  { id: 'golem', title: 'Фигурка Голема', rarity: 'epic', icon: 'golem', ch: 0,
    desc: 'Был всю игру. Теперь стоит на полке', buff: { key: 'hp', value: 4 },
    quote: { t: 'У меня Голем был всю игру', who: 'Мохьмад' } },
  { id: 'barsetka', title: 'Барсетка Ислама', rarity: 'epic', icon: 'barsetka', ch: 0,
    desc: 'Деньги хранятся в воздухе. Барсетка — для вида', buff: { key: 'start', value: 120 },
    quote: { t: 'Поэтому я храню свои деньги в воздухе. Ну и в невидимости иногда', who: 'Ислам' } },
  { id: 'doner_sauce', title: 'Фирменный соус Донер Бея', rarity: 'epic', icon: 'sauce', ch: 0,
    desc: 'Рецепт секретный. Наезжать на него нельзя', buff: { key: 'dmg', value: 3 },
    quote: { t: 'Зачем на секретный соус наезжать', who: 'Ислам' } },
  { id: 'monitors', title: 'Три монитора Амина', rarity: 'epic', icon: 'monitors', ch: 1,
    desc: 'На одном — чатгпт, на втором — шахматы, на третьем — Пентагон', buff: { key: 'hack', value: 15 },
    quote: { t: 'С таким количеством мониторов ты Пентагон взламывать не собираешься?', who: 'Зураб' } },
  { id: 'chess_screen', title: 'Фото экрана с шахматами', rarity: 'epic', icon: 'phone_photo', ch: 3,
    desc: 'Снято с последнего ряда. Ник замазан. Пока', buff: { key: 'hero', value: 10 },
    quote: { t: 'Оппа, чесском-аккаунт', who: 'Ислам' } },
  { id: 'shaiba_key', title: 'Ключ от смотровой Шайбы', rarity: 'epic', icon: 'key', ch: 4,
    desc: 'Открывает только смотровую. Вид на весь Грозный', buff: { key: 'cap', value: 8 },
    quote: { t: 'Почему Шайба в кадре', who: 'Амин' } },

  // ---- легендарные ----------------------------------------------------------------------------
  { id: 'tokens', title: '2 лярда токенов', rarity: 'legendary', icon: 'tokens', ch: 0,
    desc: 'За месяц. На запятые в чатгпт', buff: { key: 'inc', value: 2 },
    quote: { t: 'У меня 2 лярда токенов за месяц', who: 'Амин' } },
  { id: 'gelik_keys', title: 'Ключи от гелика', rarity: 'legendary', icon: 'car_keys', ch: 0,
    desc: 'КРА 95. Stage 2. Чей гелик — не спрашивай', buff: { key: 'car', value: 10 },
    quote: { t: 'Stage 2. 700 сил', who: 'Зураб' } },
  { id: 'floor4_key', title: 'Ключ от 4-го этажа', rarity: 'legendary', icon: 'key_gold', ch: 0,
    desc: 'Двери пока нет. Ключ уже есть', buff: { key: 'dmg', value: 4 },
    quote: { t: 'Не успокоюсь, пока 4 этажа не найду', who: 'Ислам' } },
  { id: 'pringles', title: 'Пачка Pringles', spicyTitle: 'Пачка Pringles «с губками»', rarity: 'legendary', icon: 'pringles', ch: 0, spicy: true,
    desc: 'Последняя пачка. Делиться никто не собирается',
    spicyDesc: 'Амин говорит, губки внутри — для посуды. Вопросов больше, чем ответов', buff: { key: 'heal', value: 10 },
    quote: { t: 'Колы хватает', who: 'админ' } },

  // ---- проклятые (не выпадают из роллов, выдаются за событие) ---------------------------------------
  { id: 'ansar_cert', title: 'Сертификат Ансара', rarity: 'cursed', icon: 'certificate', ch: 2, special: 'ansar',
    desc: 'Выдаётся при записи в Ансар. Hello world за 9 месяцев. Опыта больше, урона меньше',
    buff: { key: 'xp', value: 25 }, curse: { key: 'dmg', value: -2 },
    quote: { t: 'Бро продал хату, чтобы научиться писать hello world за 9 месяцев', who: 'Чимаев' } },
  { id: 'fuji', title: 'Шаурма в кляре из Фудзи', rarity: 'cursed', icon: 'shawarma_fried', ch: 0, special: 'fuji',
    desc: 'Выдаётся, когда твой сход выбрал «Шаурму в кляре». Сытно. Потом не очень',
    buff: { key: 'hp', value: 3 }, curse: { key: 'heal', value: -5 },
    quote: { t: 'Шаурма в кляре из Фудзи. Я отравился', who: 'Зураб' } },

  // ---- медаль сезона (только за конец сезона) -------------------------------------------------------
  { id: 'medal', title: 'Медаль сезона', rarity: 'legendary', icon: 'medal', ch: 0, special: 'season',
    desc: 'За то, что дожил до концовки. Номер сезона выбит на обороте', buff: { key: 'xp', value: 5 },
    quote: { t: 'Я СДЕЛАЛ ЭТО' } },
];

/** Описания иконок карточек (рендер рисует их ручкой в стиле тетради). */
export const CARD_ICONS: Record<string, string> = {
  bowl: 'тарелка лагмана с вилкой', shawarma: 'шаурма в бумаге', shawarma_big: 'большая шаурма с ценником 250',
  shawarma_fried: 'шаурма в кляре, рядом зелёная волнистая линия', receipt: 'чек с цифрой 100', ticket: 'билетик с цифрой 150',
  jar: 'банка креатина', cola: 'банка колы', coffee: 'стакан кофе с крышкой', chair: 'школьный стул',
  pass: 'пропуск с полосой ГГНТУ', notebook: 'тетрадь с конспектом', wrench: 'гаечный ключ и талон', plate: 'номерной знак КРА 95',
  bank_card: 'банковская карта', journal: 'журнал с красной «Н»', chicken: 'курица с пистолетом-игрушкой', trophy: 'кубок с числом 6000',
  pack: 'сигаретная пачка с портретом-наброском и плашкой «Курение убивает»', can: 'банка энергетика', cup: 'чашка эспрессо, две полоски пара',
  badge: 'значок активиста', drone: 'квадрокоптер с камерой', ruler: 'ростомер с отметкой 180', keyfob: 'брелок БМВ, синий',
  zachetka: 'зачётка с подписями', bomber: 'чёрно-красный атласный бомбер BULLS', shampoo: 'флакон шампуня с «+40»', golem: 'каменная фигурка',
  barsetka: 'барсетка', sauce: 'бутылочка соуса', monitors: 'три монитора', phone_photo: 'телефон, на экране шахматная доска',
  key: 'ключ с биркой «смотровая»', tokens: 'стопка жетонов с надписью 2B', car_keys: 'ключи от гелика с брелком КРА', key_gold: 'золотой ключ с цифрой 4',
  pringles: 'тубус чипсов', certificate: 'сертификат с печатью и «hello world»', medal: 'медаль на ленте',
};

/** Колоды ИИ-стороны в одиночной игре (по сложности), через тот же путь, что и у игроков. */
export const AI_DECKS: string[][] = [
  [],
  ['shaurma200', 'cola'],
  ['jurnal', 'kra95', 'chickengun'],
];

/** Индекс карты по id (для команды { k: 'eq', c: number[] }). -1 — нет такой. */
export function cardIndex(id: string): number {
  return COLLECTION.findIndex(c => c.id === id);
}

/** Название/описание карты с учётом 18+. */
export function collectionText(c: CollectionCard, spicy: boolean): { title: string; desc: string } {
  return {
    title: spicy && c.spicyTitle ? c.spicyTitle : c.title,
    desc: spicy && c.spicyDesc ? c.spicyDesc : c.desc,
  };
}

/** Подпись баффа карты: «+3% урона» (и «−2% урона» у проклятых). */
export function buffText(b: Buff): string {
  const s = BUFF_TEXT[b.key].replace('{v}', String(Math.abs(b.value)));
  return b.value < 0 ? s.replace(/^[+−]/, b.key === 'hero' || b.key === 'car' || b.key === 'hack' ? '+' : '−') : s;
}

/**
 * Проверка набора карт для команды 'eq': массив целых индексов COLLECTION, не больше 3, без
 * повторов, не больше одной легендарной. Возвращает очищенный массив или null.
 */
export function validEquip(c: unknown): number[] | null {
  if (!Array.isArray(c) || c.length > 3) return null;
  const out: number[] = [];
  let leg = 0;
  for (const v of c) {
    if (!Number.isInteger(v) || v < 0 || v >= COLLECTION.length || out.includes(v)) return null;
    if (COLLECTION[v].rarity === 'legendary') leg++;
    out.push(v);
  }
  return leg > 1 ? null : out;
}

/**
 * Бафф стороны из наборов карт её активных игроков: массив по SIM_BUFF_KEYS, каждый ключ обрезан
 * BUFF_CAPS. Только целые сложения и сравнения — детерминировано, можно звать из симуляции.
 * Минусы проклятых карт тоже считаются (и не уходят ниже −cap).
 */
export function sideBuffs(sets: readonly (readonly number[])[]): number[] {
  const sum = SIM_BUFF_KEYS.map(() => 0);
  for (const set of sets) {
    for (const i of set) {
      const c = COLLECTION[i];
      if (!c) continue;
      for (const b of c.curse ? [c.buff, c.curse] : [c.buff]) {
        const k = SIM_BUFF_KEYS.indexOf(b.key);
        if (k >= 0) sum[k] += b.value;
      }
    }
  }
  return sum.map((v, k) => {
    const cap = BUFF_CAPS[SIM_BUFF_KEYS[k]];
    return Math.max(-cap, Math.min(cap, v));
  });
}

/** Когда и сколько карточек выпадает (UI). */
export const DROPS = {
  /** Не больше роллов в день. */
  dayCap: 10,
  /** Веса редкостей для обычного ролла и для MVP. */
  weights: { common: 60, rare: 27, epic: 10, legendary: 3 },
  mvpWeights: { common: 40, rare: 35, epic: 20, legendary: 5 },
  firstWarOfDay: 1,
  winChance: 0.5, winChanceUnder: 0.7,
  perQuest: 1,
  /** Захват ГГНТУ / ЧГУ / Шайбы, засчитанный игроку: шанс, не больше cityCapDayMax в день. */
  cityCapChance: 0.1, cityCapDayMax: 3,
  seasonWin: 2, seasonOther: 1,
} as const;

/**
 * Ролл карточки (UI): редкость по весам, затем случайная карта этой редкости, открытая главой `ch`.
 * Проклятые и медаль не выпадают. `rnd` — Math.random или свой генератор.
 */
export function rollCard(rnd: () => number, ch: number, mvp = false): CollectionCard {
  const w = mvp ? DROPS.mvpWeights : DROPS.weights;
  const order: Exclude<Rarity, 'cursed'>[] = ['common', 'rare', 'epic', 'legendary'];
  const total = order.reduce((s, r) => s + w[r], 0);
  let x = rnd() * total, rar: Rarity = 'common';
  for (const r of order) { if (x < w[r]) { rar = r; break; } x -= w[r]; }
  let pool = COLLECTION.filter(c => c.rarity === rar && !c.special && c.ch <= ch);
  if (!pool.length) pool = COLLECTION.filter(c => c.rarity === 'common' && !c.special && c.ch <= ch);
  return pool[Math.floor(rnd() * pool.length) % pool.length];
}

// ---- «сход дня» (опрос в меню, раз в день) ----------------------------------------------------------------

/** Бонус дня: на что победивший вариант даёт ×1.5 опыта сегодня. */
export type DailyBonus = 'doner' | 'votes' | 'ggntu' | 'kills' | 'heroes' | 'cars' | 'caps' | 'floors';

export interface DailyPoll { id: string; q: string; opts: { t: string; bonus: DailyBonus }[]; who?: string }

export const DAILY_SKHOD: DailyPoll[] = [
  { id: 'unik', q: 'Кто сегодня идёт в уник?', who: 'админ', opts: [
    { t: 'Я', bonus: 'votes' }, { t: 'Не я', bonus: 'kills' }, { t: 'Админ сказал, что не будет', bonus: 'heroes' }] },
  { id: 'meet', q: 'Где встречаемся?', who: 'Ислам', opts: [
    { t: 'Донер Бей', bonus: 'doner' }, { t: 'Кофейня', bonus: 'votes' }, { t: '10:20 у молла', bonus: 'caps' }] },
  { id: 'gym', q: 'Что качаем сегодня?', who: 'Зураб', opts: [
    { t: 'Ножки', bonus: 'caps' }, { t: 'Грудь', bonus: 'kills' }, { t: 'Клеш рояль', bonus: 'heroes' }] },
  { id: 'shawarma', q: 'Чья шаурма лучше?', who: 'Чимаев', opts: [
    { t: 'Атаги, 200 ₽', bonus: 'kills' }, { t: 'Курчалой, 250 ₽', bonus: 'caps' }, { t: 'Донер Бей', bonus: 'doner' }] },
  { id: 'main', q: 'Что главное?', who: 'Бекхан', opts: [
    { t: 'Игра', bonus: 'kills' }, { t: 'Дисциплина', bonus: 'votes' }, { t: '115 лёжа', bonus: 'floors' }] },
  { id: 'floor4', q: 'Куда Ислам дел четвёртый этаж?', who: 'Чимаев', opts: [
    { t: 'В барсетку', bonus: 'floors' }, { t: 'В невидимость', bonus: 'heroes' }, { t: 'Отдал Шайбе', bonus: 'ggntu' }] },
  { id: 'friday', q: 'Пятница — выходной?', who: 'Ислам', opts: [
    { t: 'Да', bonus: 'kills' }, { t: 'Нет', bonus: 'votes' }, { t: 'Где наша обещанная четырёхдневка', bonus: 'caps' }] },
  { id: 'ride', q: 'На чём едем в город?', who: 'Зураб', opts: [
    { t: 'Такси по 100', bonus: 'cars' }, { t: 'Маршрутка 150', bonus: 'caps' }, { t: 'Синяя бэха (если выедет с СТО)', bonus: 'cars' }] },
  { id: 'ansar', q: 'Идём учиться в Ансар?', who: 'Чимаев', opts: [
    { t: 'Да', bonus: 'votes' }, { t: 'Нет', bonus: 'ggntu' }, { t: 'Сколько там стоит?', bonus: 'kills' }] },
  { id: 'carry', q: 'Кто сегодня тащит?', who: 'Амин', opts: [
    { t: 'Атаги', bonus: 'floors' }, { t: 'Курчалой', bonus: 'floors' }, { t: 'Голем', bonus: 'heroes' }] },
  { id: 'clash', q: 'Клеш рояль или пары?', who: 'Адам', opts: [
    { t: 'Клеш рояль', bonus: 'heroes' }, { t: 'Пары', bonus: 'votes' }, { t: 'Чикенган на паре', bonus: 'kills' }] },
  { id: 'hack', q: 'Что взломать ИПИТу?', who: 'Амин', opts: [
    { t: 'БРС', bonus: 'ggntu' }, { t: 'Пентагон', bonus: 'ggntu' }, { t: 'Запятую в чатгпт', bonus: 'votes' }] },
];

/** Опрос дня: детерминированно по номеру сезона и дню (у всех в мире один и тот же). */
export function pollFor(season: number, day: string): DailyPoll {
  return DAILY_SKHOD[hash32(`${season}|${day}`) % DAILY_SKHOD.length];
}

// ---- концовки ----------------------------------------------------------------------------------------------

export type EndingId = 'atagi' | 'kurchaloy' | 'draw';

export interface EndingPanel {
  /** Говорящий; '' — рассказчик. */
  who: string;
  /** Текст; плейсхолдеры {n} {next} {a} {k} {diff} {mvp} {wars}. */
  text: string;
  /** Ключ сцены (см. ENDING_ART). */
  art: string;
  /** 18+: показывать `clean`, если 18+ выключен. */
  spicy?: true;
  clean?: string;
  /** Только после досрочного финала ('early') или при разнице меньше 60 ('close'). */
  when?: 'early' | 'close';
}

/** Итог сезона из симуляции (-1 ничья, 0 Атаги, 1 Курчалой) → концовка. */
export function endingFor(w: -1 | 0 | 1): EndingId {
  return w === 0 ? 'atagi' : w === 1 ? 'kurchaloy' : 'draw';
}

export const ENDINGS: Record<EndingId, EndingPanel[]> = {
  atagi: [
    { who: '', text: 'Сезон {n}. Конец. Атаги — {a}, Курчалой — {k}', art: 'score_atagi' },
    { who: '', text: 'Досрочно. Курчалой даже не успел заказать маршрутку обратно', art: 'marshrutka_leaving', when: 'early' },
    { who: 'Ислам', text: 'Не успокоюсь, пока 4 этажа не найду', art: 'islam_stairs' },
    { who: '', text: 'Седьмой день. Лестница в трёхэтажке почему-то идёт выше третьего', art: 'stairs_up' },
    { who: 'Ислам', text: 'Пацаны. Тут дверь', art: 'door_floor4' },
    { who: 'Бекхан', text: 'Главное не игра, главное дисциплина', art: 'bekhan_nod' },
    { who: '', text: 'За дверью — четвёртый этаж. Бетон, окно, вид на Курчалой. Кто-то уже принёс стул', art: 'floor4_view' },
    { who: 'Ислам', text: '+10000000000000000 aura', art: 'islam_aura' },
    { who: '', text: 'Над четвёртым нашёлся пятый. Над пятым — шестой. Трёхэтажка перестала так называться', art: 'atagi_grows' },
    { who: 'Амин', text: 'Местный Бурдж-Халифа теперь в Атагах. Я просто констатирую', art: 'amin_phone' },
    { who: 'Зураб', text: 'Не ну это уже обидно. {a}:{k}', art: 'zurab_window', when: 'close' },
    { who: 'Зураб', text: 'Ему ещё далеко до нас. Было', art: 'zurab_window' },
    { who: 'Ислам', text: 'Это не жопой делается, если что', clean: 'Это дисциплиной делается, если что', spicy: true, art: 'islam_barsetka' },
    { who: '', text: 'Кто тащил сезон: {mvp}. Сезон {n} — Атагам. Ислам уже ищет седьмой этаж', art: 'stamp_atagi' },
  ],
  kurchaloy: [
    { who: '', text: 'Сезон {n}. Конец. Курчалой — {k}, Атаги — {a}', art: 'score_kurchaloy' },
    { who: '', text: 'Досрочно. Такси по 100 даже не доехало', art: 'taxi_stuck', when: 'early' },
    { who: 'Зураб', text: 'Для тебя это как небоскрёб', art: 'zurab_hq' },
    { who: '', text: 'Пятиэтажку надстроили. Потом ещё раз. Соседи перестали считать этажи и начали считать облака', art: 'kurch_grows' },
    { who: 'Чимаев', text: 'Я соло за Курчалой тащу ☝🏿', art: 'chimaev_bulls' },
    { who: 'Амин', text: 'Местный Бурдж-Халифа. Уже не местный', art: 'amin_phone' },
    { who: '', text: 'На крыше Зураб качает ножки. Видно Шали, Атаги и немного Дубай', art: 'zurab_roof' },
    { who: 'Зураб', text: 'Жим ногами 300 кг. Этажей теперь больше, чем кубков у Бекхана', art: 'zurab_flex' },
    { who: 'Ислам', text: 'Не успокоюсь, пока 4 этажа не найду', art: 'islam_stairs' },
    { who: '', text: 'Ислам всё ещё ищет. В трёхэтажке. С фонариком. В подвале тоже смотрел', art: 'islam_flashlight' },
    { who: 'Бекхан', text: 'Хоть я достойно проиграл…', art: 'bekhan_sad', when: 'close' },
    { who: 'админ', text: 'Атагам Н. Всем. За весь сезон', art: 'admin_journal' },
    { who: 'Зураб', text: 'Ходи оглядывайся нахуй', clean: 'Ходи оглядывайся', spicy: true, art: 'zurab_window' },
    { who: '', text: 'Кто тащил сезон: {mvp}. Сезон {n} — Курчалою. Бурдж-Халифа — тоже', art: 'stamp_kurchaloy' },
  ],
  draw: [
    { who: '', text: 'Сезон {n}. Конец. {a}:{k}. Ничья', art: 'score_draw' },
    { who: '', text: 'Был досрочный финал. Потом все отыгрались. Так тоже бывает', art: 'scoreboard_erased', when: 'early' },
    { who: 'Зураб', text: 'Донербей чохь цхьан кхет вай (в Донер Бее встретимся)', art: 'zurab_phone' },
    { who: '', text: 'Трёхэтажка стоит. Пятиэтажка стоит. Пацаны идут в Донер Бей', art: 'walk_to_doner' },
    { who: 'Ислам', text: 'Шаурма плюс сок, воу воу воу', art: 'doner_counter' },
    { who: 'Чимаев', text: 'Посоветуйте еду для набора массы, ребята, очень нужно!', art: 'chimaev_menu' },
    { who: 'Ислам', text: 'Что угодно из Донер Бея с фирменным соусом', art: 'islam_sauce' },
    { who: 'Амин', text: 'Я потрачу все токены, чтобы посчитать, кто кому должен', art: 'amin_laptop' },
    { who: 'Мохьмад', text: 'Я заплачу. Списанием с карты', art: 'ersno_cards' },
    { who: 'админ', text: 'Кто платит — тому не Н', art: 'admin_journal' },
    { who: 'Бекхан', text: 'Главное не игра, главное дисциплина. И лагман', art: 'bekhan_lagman' },
    { who: '', text: 'Счёт делят пополам. Шаурму — нет', art: 'doner_table' },
    { who: 'Чимаев', text: 'Бля, не могу поверить, что сяду в газель', clean: 'Не могу поверить, что сяду в газель', spicy: true, art: 'marshrutka_night' },
    { who: '', text: 'Кто тащил сезон: {mvp}. Ничья. Сезон {next} начинается после шаурмы', art: 'stamp_draw' },
  ],
};

/** Что нарисовано на каждой панели концовки (для рендера; блокнот, ручка, процедурные модели). */
export const ENDING_ART: Record<string, string> = {
  score_atagi: 'Табло сезона, синие цифры Атагов крупнее красных',
  score_kurchaloy: 'Табло сезона, красные цифры Курчалоя крупнее синих',
  score_draw: 'Табло сезона, цифры одинакового размера, между ними знак «=»',
  marshrutka_leaving: 'Газель уезжает с поля, в заднем окне стоят пацаны',
  taxi_stuck: 'Белое такси с шашечкой стоит в пробке у Аргуна',
  scoreboard_erased: 'Табло, где разница стёрта ластиком и написана заново',
  islam_stairs: 'Ислам с барсеткой у лестницы трёхэтажки, смотрит вверх',
  stairs_up: 'Лестница уходит выше третьего этажа и пропадает в облаке',
  door_floor4: 'Деревянная дверь с нарисованной от руки цифрой 4',
  bekhan_nod: 'Бекхан кивает, руки скрещены',
  floor4_view: 'Пустой бетонный этаж, окно, вдали маленькая пятиэтажка, у окна стул',
  islam_aura: 'Ислам в лучах, вокруг надпись «+aura» много раз',
  atagi_grows: 'Трёхэтажка вытягивается вверх, этажи дорисованы разными ручками',
  amin_phone: 'Амин в чёрной кожанке смотрит в телефон, на экране фото высотки',
  zurab_window: 'Зураб смотрит из окна пятиэтажки, руки на подоконнике',
  islam_barsetka: 'Ислам поправляет барсетку на фоне высотки',
  stamp_atagi: 'Синяя печать «СЕЗОН — АТАГИ» поверх листа',
  zurab_hq: 'Зураб у подъезда пятиэтажки, показывает большим пальцем вверх',
  kurch_grows: 'Пятиэтажка растёт выше полей листа, на крыше облако',
  chimaev_bulls: 'Чимаев в чёрно-красном бомбере BULLS поднимает палец вверх',
  zurab_roof: 'Зураб делает выпады на крыше, вдали силуэты Шали и Атагов',
  zurab_flex: 'Зураб на тренажёре для ног, рядом стопка блинов',
  islam_flashlight: 'Ислам с фонариком в тёмном коридоре трёхэтажки',
  bekhan_sad: 'Бекхан сидит на ступеньке, рядом тарелка лагмана',
  admin_journal: 'админ открывает журнал, на странице ряд красных «Н»',
  stamp_kurchaloy: 'Красная печать «СЕЗОН — КУРЧАЛОЙ» поверх листа',
  zurab_phone: 'Зураб пишет в беседу, на экране «в Донер Бее встретимся»',
  walk_to_doner: 'Пацаны с обеих сторон идут по улице к вывеске Донер Бея',
  doner_counter: 'Прилавок Донер Бея, вертел, шаурма и сок',
  chimaev_menu: 'Чимаев изучает меню на стене',
  islam_sauce: 'Ислам указывает на бутылку фирменного соуса',
  amin_laptop: 'Амин за ноутбуком, на экране таблица долгов',
  ersno_cards: 'Мохьмад раскрывает веер банковских карт над столом',
  bekhan_lagman: 'Бекхан с тарелкой лагмана',
  doner_table: 'Общий стол, шаурма разложена, счёт разорван пополам',
  marshrutka_night: 'Ночная газель у остановки, Чимаев садится внутрь',
  stamp_draw: 'Печать «НИЧЬЯ» синими и красными чернилами пополам',
};

export interface EndingCtx { n: number; a: number; k: number; mvp: string; wars: number; early: boolean }

/**
 * Панели концовки с подставленными числами и учётом 18+. Панели 'early' — только после
 * досрочного финала, 'close' — только если разница меньше 60.
 */
export function endingPanels(id: EndingId, ctx: EndingCtx, spicy: boolean): { who: string; text: string; art: string }[] {
  const diff = Math.abs(ctx.a - ctx.k);
  const fill = (s: string) => s
    .replace(/\{n\}/g, String(ctx.n)).replace(/\{next\}/g, String(ctx.n + 1))
    .replace(/\{a\}/g, String(ctx.a)).replace(/\{k\}/g, String(ctx.k)).replace(/\{diff\}/g, String(diff))
    .replace(/\{mvp\}/g, ctx.mvp || 'никто не тащил').replace(/\{wars\}/g, String(ctx.wars));
  const out: { who: string; text: string; art: string }[] = [];
  for (const p of ENDINGS[id]) {
    if (p.when === 'early' && !ctx.early) continue;
    if (p.when === 'close' && diff >= 60) continue;
    const text = p.spicy && !spicy ? p.clean ?? '' : p.text;
    if (!text) continue;
    out.push({ who: p.who, text: fill(text), art: p.art });
  }
  return out;
}
