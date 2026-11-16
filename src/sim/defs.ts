// Balance + names. Index 0 = Старые Атаги, 1 = Курчалой.
export const TPS = 10;
export const TICK_MS = 100;
export type Side = 0 | 1;
export const SIDE_NAME = ['Атаги', 'Курчалой'] as const;
export const SIDE_FULL = ['Старые Атаги', 'Курчалой'] as const;

export const enum Kind { Melee = 0, Ranged = 1, Fast = 2, Heal = 3, Boss = 4 }

export interface UnitDef {
  key: string;
  name: [string, string];
  blurb: [string, string];
  cost: [number, number];
  count: number;
  kind: Kind;
  hp: number;
  dmg: [number, number];
  cd: number; // ticks between attacks
  range: number;
  speed: number; // units per tick on open ground
  aggro: number;
  radius: number;
  splash?: [number, number];
  proj?: number; // projectile speed, units/tick
  shot?: number; // projectile look for the renderer ('shot' fx k); default 0/1 by side
  heal?: [number, number];
  /** Which side may field it: [Атаги, Курчалой]. */
  avail: [boolean, boolean];
  /** Unique per side (max one alive at a time), respawn cooldown after death. */
  hero?: true;
  /** Never deployable: comes from an ability or a card. */
  summon?: true;
  respawn?: number; // hero cooldown after death, ticks
  sspeed?: [number, number]; // per-side speed override
  knock?: number; // knockback on melee hits
  noFight?: true; // never attacks
  bldg?: number; // damage multiplier against high-rises; also «only buildings» targeting
  capW?: number; // weight when capturing villages (default 1)
  flee?: number; // runs away from enemies closer than this
  abCd?: number; // ability cooldown, ticks
  abR?: number; // ability radius
  aura?: number; // aura radius
  carry?: [number, number]; // passengers (single Пацаны) per side
  life?: number; // ticks before a ride unloads on its own
  deathR?: number; deathDmg?: number; // burst on death
  /** Max alive per side (Гелик). */
  max?: number;
  /** «КРА номера»: immune to stun, slow, taunt, fear and the jam/flood slowdowns. */
  kra?: true;
  /** Every melee hit moves this many ₽ from the enemy bank to ours: [vs units, vs the high-rise] (ersno). */
  steal?: [number, number];
}

const BOTH: [boolean, boolean] = [true, true];

export const UNITS: UnitDef[] = [
  {
    key: 'squad', name: ['Пацаны ×3', 'Пацаны ×3'],
    blurb: ['«Мы тебя по одиночке толпой забьём»', '«Чу вала!» — и сразу в бой'],
    cost: [100, 100], count: 3, kind: Kind.Melee, avail: BOTH,
    hp: 95, dmg: [10, 10], cd: 8, range: 1.2, speed: 0.30, aggro: 7, radius: 0.45,
  },
  {
    key: 'wrestler', name: ['Борец', 'Борец 115 кг'],
    blurb: ['Держит линию, пока сельские подтягиваются', '«От 110 до 115 кг борцов те1ина ас»'],
    cost: [150, 150], count: 1, kind: Kind.Melee, avail: BOTH,
    hp: 400, dmg: [23, 23], cd: 12, range: 1.4, speed: 0.24, aggro: 7, radius: 0.7, knock: 0.45,
  },
  {
    key: 'ranged', name: ['Снайпер', 'Метатель гантелей'],
    blurb: ['«По методу Ислама — снайпнуть»', 'Гантель прилетает всем вокруг'],
    cost: [120, 120], count: 1, kind: Kind.Ranged, avail: BOTH,
    hp: 70, dmg: [32, 11], cd: 18, range: 12, speed: 0.27, aggro: 13, radius: 0.45,
    splash: [0, 1.4], proj: 2.4,
  },
  {
    key: 'fast', name: ['Баран', 'Камри без прав'],
    blurb: ['В Атагах баран считается за Приору', 'Семейная. Прав нет. Тормозов тоже'],
    cost: [180, 180], count: 1, kind: Kind.Fast, avail: BOTH,
    hp: 210, dmg: [30, 30], cd: 14, range: 1.7, speed: 0.62, aggro: 8, radius: 0.85, knock: 0.9,
  },
  {
    key: 'healer', name: ['Бежни лор', 'Шаурмист'],
    blurb: ['Ветеринар. Корову подоил — полный ТО', 'Шаурма 250 ₽ лечит всё. Почти'],
    cost: [200, 250], count: 1, kind: Kind.Heal, avail: BOTH,
    hp: 85, dmg: [5, 5], cd: 10, range: 5.5, speed: 0.27, aggro: 7, radius: 0.45,
    heal: [13, 14],
  },
  {
    key: 'boss', name: ['Ислам #1 ranked chad', 'Качок Зураб'],
    blurb: ['Высокий. Барсетка. Перхоть замедляет врагов', 'Финальный босс Курчалоя. «Баля ма зверь йу со»'],
    cost: [0, 0], count: 1, kind: Kind.Boss, avail: BOTH,
    hp: 4200, dmg: [34, 72], cd: 16, range: 9, speed: 0.22, aggro: 12, radius: 1.3,
    splash: [2.6, 3.0], proj: 1.6,
  },
  // ---- герои и наёмники (6..12): один на сторону, после смерти — откат ----------------------
  {
    key: 'chimaev', name: ['Чимаев', 'Чимаев'],
    blurb: ['Играет только за Курчалой', 'Рыжеватый, в бомбере BULLS. Хог райдер мейн: бежит только к высотке, бьёт её втрое. «Землетряс» достаёт и до неё'],
    cost: [420, 420], count: 1, kind: Kind.Melee, avail: [false, true], hero: true, respawn: 900,
    hp: 800, dmg: [30, 30], cd: 12, range: 1.4, speed: 0.5, aggro: 8, radius: 0.5,
    bldg: 3, abCd: 140, abR: 5,
  },
  {
    key: 'wou', name: ['Амин', 'Амин'],
    blurb: ['Высокий, в чёрной кожанке. Король рейджбайта: все бьют его. «2 лярда токенов» +2 ₽/с, «Взломать Пентагон»', 'Высокий, в чёрной кожанке. Король рейджбайта: все бьют его. «2 лярда токенов» +2 ₽/с, «Взломать Пентагон»'],
    cost: [360, 360], count: 1, kind: Kind.Ranged, avail: BOTH, hero: true, respawn: 750,
    hp: 700, dmg: [9, 9], cd: 12, range: 6, speed: 0.26, aggro: 9, radius: 0.55, proj: 2.2, shot: 6,
    abCd: 300, abR: 7, aura: 7,
  },
  {
    key: 'admin', name: ['админ', 'админ'],
    blurb: ['Староста с журналом. «Н» — враги стоят, наши не опаздывают. «Курение убивает»: пачка пугает и травит', 'Староста с журналом. «Н» — враги стоят, наши не опаздывают. «Курение убивает»: пачка пугает и травит'],
    cost: [360, 360], count: 1, kind: Kind.Ranged, avail: BOTH, hero: true, respawn: 750,
    hp: 380, dmg: [14, 14], cd: 14, range: 7, speed: 0.27, aggro: 10, radius: 0.45, proj: 2.4, shot: 7,
    abCd: 120, abR: 6, aura: 6,
  },
  {
    key: 'ersno', name: ['ersno', 'ersno'],
    blurb: ['Оверсайз, в руках банковские карты. Каждый удар — «перевод по номеру карты» с соседского счёта. «Списание с карты»', 'Оверсайз, в руках банковские карты. Каждый удар — «перевод по номеру карты» с соседского счёта. «Списание с карты»'],
    cost: [300, 300], count: 1, kind: Kind.Melee, avail: BOTH, hero: true, respawn: 750,
    hp: 420, dmg: [20, 20], cd: 10, range: 1.3, speed: 0.31, aggro: 8, radius: 0.5,
    steal: [4, 8], abCd: 120, abR: 10,
  },
  {
    key: 'bekhan', name: ['Бекхан', 'Бекхан'],
    blurb: ['«Главное не игра, главное дисциплина». 115 лёжа. Рядом с ним наши держат удар', 'Сельский. Играет только за Атаги'],
    cost: [150, 150], count: 1, kind: Kind.Melee, avail: [true, false], hero: true, respawn: 600,
    hp: 450, dmg: [12, 12], cd: 12, range: 1.3, speed: 0.26, aggro: 7, radius: 0.5, aura: 5,
  },
  {
    key: 'adam', name: ['Адам', 'Адам'],
    blurb: ['Как начнётся драка — бежит быстрее Усейна Болта. Берёт сёла за четверых', 'Как начнётся драка — бежит быстрее Усейна Болта. Берёт сёла за четверых'],
    cost: [160, 160], count: 1, kind: Kind.Melee, avail: BOTH, hero: true, respawn: 600,
    hp: 160, dmg: [0, 0], cd: 10, range: 1, speed: 1.0, aggro: 5, radius: 0.4,
    noFight: true, flee: 5, capW: 4,
  },
  {
    key: 'mohmad', name: ['Мохьмад', 'Мохьмад'],
    blurb: ['«Мы тебя по одиночке толпой забьём». «У меня Голем был всю игру»', '«Мы тебя по одиночке толпой забьём». «У меня Голем был всю игру»'],
    cost: [380, 380], count: 1, kind: Kind.Melee, avail: BOTH, hero: true, respawn: 800,
    hp: 420, dmg: [18, 18], cd: 10, range: 1.3, speed: 0.27, aggro: 8, radius: 0.5, abCd: 400,
  },
  // ---- призывы и транспорт ------------------------------------------------------------------
  {
    key: 'golem', name: ['Голем', 'Голем'],
    blurb: ['Каменный и медленный. Разваливается с грохотом', 'Каменный и медленный. Разваливается с грохотом'],
    cost: [0, 0], count: 1, kind: Kind.Melee, avail: BOTH, summon: true,
    hp: 1300, dmg: [40, 40], cd: 18, range: 1.6, speed: 0.15, aggro: 7, radius: 1.0, knock: 0.5,
    deathR: 3, deathDmg: 80,
  },
  {
    key: 'ride', name: ['Такси по 100', 'Маршрутка 150 ₽'],
    blurb: ['Белая «шашечка» везёт троих пацанов прямо в драку', 'Газель везёт пятерых. Стоят всю дорогу'],
    cost: [220, 300], count: 1, kind: Kind.Fast, avail: BOTH,
    hp: 300, dmg: [0, 0], cd: 10, range: 1, speed: 0.7, sspeed: [0.7, 0.55], aggro: 6, radius: 0.9,
    noFight: true, carry: [3, 5], life: 150, capW: 0,
  },
  {
    key: 'chicken', name: ['Курица', 'Курица'],
    blurb: ['Из чикенгана. Клюёт и взрывается', 'Из чикенгана. Клюёт и взрывается'],
    cost: [0, 0], count: 1, kind: Kind.Melee, avail: BOTH, summon: true,
    hp: 30, dmg: [4, 4], cd: 6, range: 0.9, speed: 0.55, aggro: 7, radius: 0.3,
    deathR: 1.6, deathDmg: 18,
  },
  // ---- для масштаба: гелики и спортики с района (16..17) ----------------------------------
  {
    key: 'gelik', name: ['Гелик', 'Гелик'],
    blurb: ['Чёрный гелик, номера КРА 95. Таранит и не тормозит: ни Н, ни пробки, ни потоп. Не больше двух', 'Чёрный гелик, номера КРА 95. Таранит и не тормозит: ни Н, ни пробки, ни потоп. Не больше двух'],
    cost: [300, 300], count: 1, kind: Kind.Fast, avail: BOTH, max: 2, kra: true,
    hp: 900, dmg: [34, 34], cd: 13, range: 1.5, speed: 0.6, aggro: 8, radius: 1.0, knock: 0.5,
  },
  {
    key: 'sportik', name: ['Спортики ×4', 'Спортики ×4'],
    blurb: ['Треники, кроссы, турник у школы. Вчетвером и быстро', 'Треники, кроссы, турник у школы. Вчетвером и быстро'],
    cost: [120, 120], count: 4, kind: Kind.Melee, avail: BOTH,
    hp: 80, dmg: [8, 8], cd: 7, range: 1.1, speed: 0.33, aggro: 7, radius: 0.42,
  },
];
export const BOSS = 5, CHIMAEV = 6, WOU = 7, ADMIN = 8, ERSNO = 9, BEKHAN = 10, ADAM = 11, MOHMAD = 12, GOLEM = 13, RIDE = 14, CHICKEN = 15;
export const GELIK = 16, SPORTIK = 17;
/** Амин: the display name since v3; the internal id stays WOU = 7 (key 'wou'). */
export const AMIN = WOU;
export const HEROES = [6, 7, 8, 9, 10, 11, 12];
/** Buy panel order: base deck, спортики, ride, гелик, then heroes. Filter per side with canBuy(). */
export const SHOP = [0, 1, 2, 3, 4, 17, 14, 16, 6, 10, 7, 8, 9, 11, 12];
export function canBuy(s: Side, t: number): boolean {
  const d = UNITS[t];
  return !!d && t !== BOSS && !d.summon && d.avail[s];
}
/** Name for messages: «Чимаев уже на поле», «Амин уже на поле» (drops the «×4» of squads). */
export function unitName(s: Side, t: number): string { return UNITS[t].name[s].replace(/ 5\.5$/, '').replace(/ ×\d+$/, ''); }

export const HERO = {
  wouIncome: 2, // ₽/с while WOU is alive («2 лярда токенов»)
  tauntEvery: 30, tauntFor: 35,
  hackFor: 80, // «Взломать Пентагон»: enemy turret off + enemy income 0
  quakePulses: 3, quakeEvery: 8, quakeDmg: 40,
  nStun: 30, adminSpeed: 1.15,
  bekhanArmor: 0.85, lagmanAt: 0.3, lagmanHeal: 0.5,
  bolt: 1.25, // Адам убегает быстрее
  rideUnloadR: 6, rideLeave: 25,
  classesFor: 200, // «Завтра учимся»: heroes are away this long
  // ersno «Списание с карты»: near the enemy high-rise or ≥ cardMin enemies within abR
  cardPct: 0.1, cardMax: 150, cardMin: 3,
  // админ «Курение убивает»: a pack lands on ≥ packMin enemies within packTrig of him
  packCd: 350, packFirst: 150, packTrig: 9, packMin: 4, packR: 7, packFor: 60, fearFor: 40, packPsn: 60,
};

/** Capture places: pts[9..12], kind 3, from CAPTURE_PLACES in src/data/places.ts. */
export const PLACE = {
  r: 5,
  sportikiEvery: 400, sportikiAt: 200, // a free squad whenever tick % every === at
  gelikDisc: 0.7, // Гелик price ×0.7 for the owner of the car wash
  gymHp: 1.2, // wrestlers and спортики spawn with +20% hp
  market: 3, // ₽/s
  regen: 2, // uncontested owner's progress per capture step
  // pickGoal distance weights (villages 0.92..1.0, enemy high-rise 1.3). aiEnemy 1.6 → 1.35 with the
  // real 2GIS places (10–21 from the HQs instead of 16–18): enemy captures 34+58 → 115+68 in 32 games
  aiOwn: 1.1, aiEnemy: 1.35,
};

/** Card consumables (снюс / Бамб LOOP and their clean twins). */
export const BUFF = {
  snusAtk: 13, // attack cooldown × 10/13 (+30% attack speed)
  snusSpd: 1.15, offFor: 100, offSpd: 0.8, // then «отходняк»: −20% speed for 10 s
  loopDmg: 1.2, loopHp: 0.05, // stun-immune, +20% damage; «сушняк»: −5% of max hp once
};

/** AI shopping weights per side by unit type (heroes and rides only while allowed; healer only with > 8 units). */
export const AI_W: [number[], number[]] = [
  [30, 20, 22, 14, 10, 0, 0, 3, 3, 3, 5, 3, 3, 0, 6, 0, 4, 10],
  [30, 20, 22, 14, 10, 0, 6, 3, 3, 3, 0, 3, 3, 0, 10, 0, 4, 10],
];

export const DONER = { r: 6, income: 5, healR: 10, heal: 0.015 /* of max hp per second */, aiWeight: 1.9 };

// Zurab fights in melee; Islam throws dandruff from afar.
export const BOSS_RANGE: [number, number] = [9, 2.4];
export const BOSS_HP: [number, number] = [4800, 5200];
export const BOSS_SPEED: [number, number] = [0.25, 0.2];
export const DECK = [0, 1, 2, 3, 4];

export const HQ = {
  floors: [3, 5] as [number, number],
  floorHp: [2000, 1200] as [number, number],
  maxFloors: [6, 8] as [number, number],
  radius: [3.2, 4.2] as [number, number],
  zone: 15,
  turretRange: 10,
  turretDmg: 22,
  turretCd: 8,
  floorCost: 400,
};

export const ECON = {
  start: 350,
  base: 7, // per second
  perVillage: 3,
  perFloor: 1,
  shaliBonus: 3,
  bounty: 0.12,
  unitCap: 150,
  deployCd: 6, // per player, ticks
};

export const MILITIA_EVERY = 260;
export const FIRST_VOTE = 350;
export const VOTE_EVERY = 900;
export const VOTE_LEN = 220;
export const WAR_RESET = 400;
export const BOSS_RESPAWN = 1200;

// ---- Сход: vote cards -------------------------------------------------------
export const enum Fx {
  Money, Floor, Focus, Speed, Damage, EnemyN, Heal, Blackout, FreeSquads, Income, Regen, Boss, Cars,
  FocusDoner, Fudzi, Sauce, Cleanse, Creatine, Chickens, SkipVote, Excuses, Shampoo, Ult, Poverty, Ersno, Changans,
  Snus, Loop, Geliks, Sportiki,
}
export interface Card {
  id: number; side: -1 | 0 | 1;
  /** Always clean: what the UI shows with the 18+ layer off, and what FxEv 'voteResult'.title carries. */
  title: string; quote: string;
  fx: Fx; v: number;
  /** Draw weight on the сход (default 2). */
  w?: number;
  /** 18+ wording, shown instead of title/quote only with the 18+ layer on. The sim never reads it. */
  spicy18?: { title: string; quote?: string };
}
export const CARDS: Card[] = [
  { id: 0, side: -1, title: 'Взнос по 100 рублей', quote: 'Ислам: «Взнос 100 рублей ю шун»', fx: Fx.Money, v: 300 },
  { id: 1, side: 0, title: 'Найти 4-й этаж', quote: '«Не успокоюсь, пока 4 этажа не найду»', fx: Fx.Floor, v: 1 },
  { id: 2, side: 1, title: 'Надстроить бурдж-халифу', quote: '«Местный Бурдж-Халифа»', fx: Fx.Floor, v: 1 },
  { id: 3, side: -1, title: 'Все на {V}!', quote: '«10:20 у молла, ребята, газ»', fx: Fx.Focus, v: 0 },
  { id: 4, side: -1, title: 'Полный газ', quote: 'Чимаев: «полный газ»', fx: Fx.Speed, v: 220 },
  { id: 5, side: -1, title: 'Стей хард', quote: '«Стей хард ву»', fx: Fx.Damage, v: 220 },
  { id: 6, side: -1, title: 'Админ издал указ: всем Н', quote: 'Враги отмечены как отсутствующие — еле ходят', fx: Fx.EnemyN, v: 120 },
  { id: 7, side: 0, title: 'Шаурма за 200', quote: '«За 200 — лучшая шаурма в Атагах»', fx: Fx.Heal, v: 60 },
  { id: 8, side: 1, title: 'Теория вкусной шаурмы', quote: '«250 бе ца докх цунах»', fx: Fx.Heal, v: 60 },
  { id: 9, side: -1, title: 'Свет яц у соседей', quote: '«свет яц / связь яц / генератор яйш»', fx: Fx.Blackout, v: 250 },
  { id: 10, side: -1, title: 'Чу вала!', quote: 'Пацаны выходят из каждого своего села', fx: Fx.FreeSquads, v: 1 },
  { id: 11, side: -1, title: 'Мы в плюсе', quote: 'Ислам: «мы в плюсе»', fx: Fx.Income, v: 450 },
  { id: 12, side: 0, title: 'Нам сельским не впервой', quote: 'Раны затягиваются сами', fx: Fx.Regen, v: 300 },
  { id: 13, side: 1, title: 'Ай лев, тигр мой', quote: 'Зураб: «Ай лев / Тигр мой»', fx: Fx.Regen, v: 300 },
  { id: 14, side: 0, title: 'Позвать Ислама', quote: '«Я копил ульту. Теперь отдыхайте, ребята»', fx: Fx.Boss, v: 1 },
  { id: 15, side: 1, title: 'Позвать качка', quote: '«Мы своего друга качка позовём»', fx: Fx.Boss, v: 1 },
  { id: 16, side: -1, title: 'Сход-развал', quote: '«Машина начинает быть машиной, когда сход-развал кривой»', fx: Fx.Cars, v: 300 },
  // v: duration in ticks unless noted
  { id: 17, side: -1, title: 'В Донер Бей быстро!', quote: 'Все идут брать Донер Бей: там платят и лечат', fx: Fx.FocusDoner, v: 700 },
  { id: 18, side: 1, title: 'Шаурма в кляре из Фудзи', quote: 'Все здоровы. А потом: «Я отравился»', fx: Fx.Fudzi, v: 100 },
  { id: 19, side: -1, title: 'Что угодно из Донер Бея с фирменным соусом', quote: '+25% урона, а если Донер Бей наш — +40%', fx: Fx.Sauce, v: 250 },
  { id: 20, side: -1, title: 'Н ма дилита!', quote: '«Н ма дилитлаш по-брадски». Все Н сняты, полминуты не липнут', fx: Fx.Cleanse, v: 300 },
  { id: 21, side: 1, title: 'Креатин', quote: 'Банка на всех: +25% здоровья каждому', fx: Fx.Creatine, v: 25 },
  { id: 22, side: 0, title: 'Каждый должен скачать чикенган', quote: 'Из трёхэтажки выбегают восемь куриц', fx: Fx.Chickens, v: 8 },
  { id: 23, side: -1, title: 'Где наша обещанная четырёхдневка', quote: 'Следующий сход у соседей отменяется', fx: Fx.SkipVote, v: 1 },
  { id: 24, side: -1, title: 'Отмазки пошли', quote: 'Соседи бьют на 20% слабее', fx: Fx.Excuses, v: 250 },
  { id: 25, side: 0, title: 'Шампунь +40 к удаче', quote: '«Шампунь +40 к удаче»: наши уворачиваются от 40% ударов', fx: Fx.Shampoo, v: 200 },
  { id: 26, side: -1, title: 'Копил ульту', quote: '«Я копил ульту». Все способности героев и босса готовы', fx: Fx.Ult, v: 1 },
  { id: 27, side: -1, title: 'Аура нищеты', quote: '«Слабая аура». Доход соседей вдвое меньше', fx: Fx.Poverty, v: 300 },
  { id: 28, side: -1, title: 'Скинь номер карты', quote: 'ersno выходит в оверсайзе. В руках — чужие банковские карты', fx: Fx.Ersno, v: 1 },
  { id: 29, side: 1, title: 'По чанганам!', quote: 'Две Камри без прав выезжают бесплатно', fx: Fx.Changans, v: 2 },
  // ---- v3: для масштаба (v: duration in ticks, or how many) -------------------------------
  { id: 30, side: -1, title: 'Энергетик в ларьке', quote: 'Наши бьют на 30% чаще и бегут на 15% быстрее. Через 25 секунд — отходняк', fx: Fx.Snus, v: 250,
    spicy18: { title: 'Закинуть снюс', quote: '«Закинул под губу — и погнали». Через 25 секунд — отходняк' } },
  { id: 31, side: -1, title: 'Двойной эспрессо', quote: 'Наших не остановить: Н не липнет, урон +20%. Потом сушняк: −5% здоровья', fx: Fx.Loop, v: 200,
    spicy18: { title: 'Бамб LOOP', quote: '«Бамб LOOP под губу». Н не липнет, урон +20%. Сушняк: −5% здоровья' } },
  { id: 32, side: -1, title: 'Гелики с КРА номерами', quote: 'Два чёрных гелика выезжают со стоянки. Тормозить их некому', fx: Fx.Geliks, v: 2, w: 1 },
  { id: 33, side: -1, title: 'Спортики с района', quote: 'Треники, кроссы, турник у школы. Две четвёрки уже бегут', fx: Fx.Sportiki, v: 2 },
];

/** Card text for the current 18+ setting; `village` fills «{V}» (Шали when empty). UI helper, never used by the sim. */
export function cardText(c: Card, spicy: boolean, village = ''): { title: string; quote: string } {
  const sp = spicy ? c.spicy18 : undefined;
  return { title: (sp ? sp.title : c.title).replace('{V}', village || 'Шали'), quote: sp && sp.quote ? sp.quote : c.quote };
}

export const VOTERS: [string[], string[]] = [
  ['Таксисты', 'Старейшины', 'Студенты ГГНТУ'],
  ['Качалка', 'Маршрутка 150 ₽', 'Шаурмичная'],
];

// ---- World events (every ~150 s, first at ~90 s) ------------------------------
export const EVENT_FIRST = 900;
export const EVENT_EVERY = 1500;
export interface WorldEvent { key: string; title: string; quote: string; dur: number }
export const EVENTS: WorldEvent[] = [
  { key: 'jam', title: 'Пробки в Аргуне', quote: '«Со пробкш йукъахь виснер»', dur: 300 },
  { key: 'blackout', title: 'Свет яц по всей республике', quote: '«Свет яц. Связь яц. Генератор яйш»', dur: 150 },
  { key: 'classes', title: 'Внимание! Завтра учимся', quote: 'Герои ушли на пары. Вернутся к своей высотке через 20 секунд', dur: 200 },
  { key: 'sale', title: 'В Донер Бее скидка?', quote: 'Донер Бей платит и лечит вдвое', dur: 400 },
  { key: 'cancel', title: 'Отмену отменили', quote: 'Сход собирается прямо сейчас', dur: 30 },
  { key: 'friday', title: 'Пятница: штурм такси', quote: '«Такси по 100» — сегодня за полцены', dur: 300 },
  { key: 'flood', title: 'Аргун разлился', quote: 'Кто в воде — еле идёт', dur: 400 },
];
export const JAM_R = 18;
