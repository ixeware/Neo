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
  heal?: [number, number];
}

export const UNITS: UnitDef[] = [
  {
    key: 'squad', name: ['Пацаны ×3', 'Пацаны ×3'],
    blurb: ['«Мы тебя по одиночке толпой забьём»', '«Чу вала!» — и сразу в бой'],
    cost: [100, 100], count: 3, kind: Kind.Melee,
    hp: 95, dmg: [10, 10], cd: 8, range: 1.2, speed: 0.30, aggro: 7, radius: 0.45,
  },
  {
    key: 'wrestler', name: ['Борец', 'Борец 115 кг'],
    blurb: ['Держит линию, пока сельские подтягиваются', '«От 110 до 115 кг борцов те1ина ас»'],
    cost: [150, 150], count: 1, kind: Kind.Melee,
    hp: 400, dmg: [23, 23], cd: 12, range: 1.4, speed: 0.24, aggro: 7, radius: 0.7,
  },
  {
    key: 'ranged', name: ['Снайпер', 'Метатель гантелей'],
    blurb: ['«По методу Ислама — снайпнуть»', 'Гантель прилетает всем вокруг'],
    cost: [120, 120], count: 1, kind: Kind.Ranged,
    hp: 70, dmg: [32, 11], cd: 18, range: 12, speed: 0.27, aggro: 13, radius: 0.45,
    splash: [0, 1.4], proj: 2.4,
  },
  {
    key: 'fast', name: ['Баран', 'Камри без прав'],
    blurb: ['В Атагах баран считается за Приору', 'Семейная. Прав нет. Тормозов тоже'],
    cost: [180, 180], count: 1, kind: Kind.Fast,
    hp: 210, dmg: [30, 30], cd: 14, range: 1.7, speed: 0.62, aggro: 8, radius: 0.85,
  },
  {
    key: 'healer', name: ['Бежни лор', 'Шаурмист'],
    blurb: ['Ветеринар. Корову подоил — полный ТО', 'Шаурма 250 ₽ лечит всё. Почти'],
    cost: [200, 250], count: 1, kind: Kind.Heal,
    hp: 85, dmg: [5, 5], cd: 10, range: 5.5, speed: 0.27, aggro: 7, radius: 0.45,
    heal: [13, 14],
  },
  {
    key: 'boss', name: ['Ислам #1 ranked chad', 'Качок Зураб'],
    blurb: ['Высокий. Барсетка. Перхоть замедляет врагов', 'Финальный босс Курчалоя. «Баля ма зверь йу со»'],
    cost: [0, 0], count: 1, kind: Kind.Boss,
    hp: 4200, dmg: [34, 72], cd: 16, range: 9, speed: 0.22, aggro: 12, radius: 1.3,
    splash: [2.6, 3.0], proj: 1.6,
  },
];
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
}
export interface Card { id: number; side: -1 | 0 | 1; title: string; quote: string; fx: Fx; v: number }
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
];

export const VOTERS: [string[], string[]] = [
  ['Таксисты', 'Старейшины', 'Студенты ГГНТУ'],
  ['Качалка', 'Маршрутка 150 ₽', 'Шаурмичная'],
];
