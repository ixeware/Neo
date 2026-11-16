// Real places of Старые Атаги, Новые Атаги, Курчалой and Шали (plus a few in Автуры, Цоцин-Юрт and
// Чечен-Аул) in world coordinates, and the four capture places (two per side).
//
// World: 1 unit = 100 m, x east, z south, crop lon 45.665–46.155, lat 43.055–43.300 (398×272).
//   x = (lon − 45.665) / 0.49 × 398,  z = (43.300 − lat) / 0.245 × 272
// This differs from tools/bake_terrain.py (metres per degree at the crop's mid latitude) by at
// most 0.15 units anywhere on the map, so the land cover, the sim's points and these places share
// one frame.
//
// Source: the 2GIS catalog (API 3.0, issue 2026-11-16), searched around every village centre in
// TERRAIN_META.villages for mosques, schools, sport, markets and shops, cafés and fast food, car
// washes and service, fuel, bus stations, parks and hospitals. src: '2gis' + real: true = the
// position of that 2GIS item (gis = its id), rounded to 0.1 unit. src: 'manual' + real: false = not
// in 2GIS, placed by hand (only Фудзи: the friends' shawarma place is not listed there).
//
// Names are short and neutral: no "named after" suffix, no personal names (most schools and
// mosques here are named after people), no brands, no street addresses. Police, military and
// government buildings and anything named after a politician are left out (so is the Курчалой
// sports complex named after a member of the head's family). Items in the same building are
// merged into one place (the 2GIS duplicates of one mosque, the car wash and its СТО).
//
// Each place sits on a passable nav cell whose 3×3 block is passable, off the water and at least
// 1.5 from the bridges. Places are at least 1.2 units apart, more than 5.5 from both HQs and at
// least r + 1 from every capture place; CAPTURE_PLACES are not repeated in PLACES. Moved from the
// 2GIS point (all ≤ 0.6 unit): Школа №1 Атагов and Центральный парк Курчалоя (out of the 5.5 around
// the HQ), Северная мечеть Курчалоя (same), Стадион Чечен-Аула (off a river cell).
import { TERRAIN_META as M } from './terrain';

export type PlaceKind = 'mosque' | 'school' | 'stadium' | 'market' | 'shop' | 'cafe' | 'gym' | 'park' | 'busstop' | 'carwash' | 'fuel' | 'parking' | 'clinic' | 'other';

export interface Place {
  id: string;
  name: string;
  village: 'atagi' | 'novatagi' | 'kurchaloy' | 'shali' | 'other';
  kind: PlaceKind;
  x: number; z: number;
  /** true = position of a real 2GIS (or OpenStreetMap) item; false = placed by hand. */
  real: boolean;
  /** Where the place comes from: the 2GIS catalog or placed by hand. */
  src?: '2gis' | 'manual';
  /** 2GIS item id, when src is '2gis'. */
  gis?: string;
  /** OSM element, e.g. "way/123456", when taken from OpenStreetMap. */
  osm?: string;
  /** Dry one-liner for tooltips and the map; always clean. */
  note?: string;
  /** 18+ variant of the note (snus / Bamb LOOP / swearing); show only with the 18+ layer on. */
  spicyNote?: string;
}

export interface CapturePlace {
  key: string;
  name: string;
  side: 0 | 1;
  x: number; z: number;
  /** Capture radius; the sim uses PLACE.r (src/sim/defs.ts), kept equal here. */
  r: number;
  perk: 'sportiki' | 'gelik' | 'gym' | 'market';
  /** Same meaning as on Place. */
  src?: '2gis' | 'manual';
  gis?: string;
  /** Same meaning as on Place: clean one-liner, and an optional 18+ variant. */
  note?: string;
  spicyNote?: string;
}

/** lon/lat → world units (the formula above). */
export function lonLatToWorld(lon: number, lat: number): { x: number; z: number } {
  return {
    x: ((lon - M.lon0) / (M.lon1 - M.lon0)) * M.gw,
    z: ((M.lat1 - lat) / (M.lat1 - M.lat0)) * M.gh,
  };
}

export const PLACE_KIND_LABEL: Record<PlaceKind, string> = {
  mosque: 'Мечеть', school: 'Школа', stadium: 'Стадион', market: 'Рынок', shop: 'Магазин', cafe: 'Кафе',
  gym: 'Спортзал', park: 'Парк', busstop: 'Остановка', carwash: 'Мойка', fuel: 'Заправка', parking: 'Стоянка',
  clinic: 'Больница', other: 'Место',
};

export const PERK_LABEL: Record<CapturePlace['perk'], string> = {
  sportiki: 'Спортики', gelik: 'Гелики КРА 95', gym: 'Качалка', market: 'Рынок',
};

/**
 * The real Донер Бей (2GIS: Грозный, ул. Мира, 83/1, 43.32382 N 45.691068 E) is 2.6 km north of
 * the map's top edge. The sim keeps its point pts[8] on Grozny's eastern edge inside the map; use
 * this for a label or an arrow pointing off the map. The only street address shown in the game.
 */
export const DONER_REAL = { name: 'Донер Бей', address: 'Грозный, ул. Мира, 83/1', x: 21.2, z: -26.4 } as const;

export const PLACES: Place[] = [
  // ---- Старые Атаги (левый берег Аргуна, HQ 62.1, 195.3) ----------------------------------
  { id: 'atagi_mosque', name: 'Центральная мечеть', village: 'atagi', kind: 'mosque', x: 63.3, z: 203.4, real: true, src: '2gis', gis: '70000001081256095',
    note: 'Пятничный сбор всего села. Спортшкола — через забор' },
  { id: 'atagi_school1', name: 'Школа №1', village: 'atagi', kind: 'school', x: 66.1, z: 191.3, real: true, src: '2gis', gis: '70000001051881038',
    note: 'Тут учились все. Доучились не все' },
  { id: 'atagi_school2', name: 'Школа №2', village: 'atagi', kind: 'school', x: 60.4, z: 211.6, real: true, src: '2gis', gis: '70000001075839280',
    note: 'Южный край села. После уроков — сразу на поле' },
  { id: 'atagi_school4', name: 'Школа №4', village: 'atagi', kind: 'school', x: 46.4, z: 163.6, real: true, src: '2gis', gis: '70000001091454525',
    note: 'Самая северная школа. До центра — как до Грозного' },
  { id: 'atagi_mosque_road', name: 'Мечеть у трассы', village: 'atagi', kind: 'mosque', x: 59.5, z: 187, real: true, src: '2gis', gis: '70000001097380036',
    note: 'Дальнобойщики тоже успевают на намаз' },
  { id: 'atagi_mosque_sw', name: 'Мечеть на окраине', village: 'atagi', kind: 'mosque', x: 52.5, z: 210, real: true, src: '2gis', gis: '70000001088134455',
    note: 'Дальше только поля и коровы' },
  { id: 'atagi_fuel', name: 'Заправка у трассы', village: 'atagi', kind: 'fuel', x: 59.2, z: 188.2, real: true, src: '2gis', gis: '70000001115633619',
    note: 'Гелики заправляются, сельские смотрят' },
  { id: 'atagi_restaurant', name: 'Ресторан у трассы', village: 'atagi', kind: 'cafe', x: 58.3, z: 183, real: true, src: '2gis', gis: '70000001053402962',
    note: 'Свадьбы по выходным. Танцуют все, кроме жениха' },
  { id: 'atagi_pizza', name: 'Пиццерия', village: 'atagi', kind: 'cafe', x: 62.3, z: 207.3, real: true, src: '2gis', gis: '70000001082792604',
    note: 'Пицца есть. Шаурму всё равно берут чаще' },
  { id: 'atagi_takeaway', name: 'Еда на вынос', village: 'atagi', kind: 'cafe', x: 70.9, z: 178, real: true, src: '2gis', gis: '70000001080138961',
    note: 'Берёшь на вынос, съедаешь до машины',
    spicyNote: 'Берёшь на вынос, съедаешь до машины. Снюс — на десерт' },

  // ---- Новые Атаги (правый берег, через мост; точка села 89.7, 186.7) ----------------------
  { id: 'novatagi_mosque', name: 'Центральная мечеть Новых Атагов', village: 'novatagi', kind: 'mosque', x: 89, z: 181.8, real: true, src: '2gis', gis: '70000001046115608',
    note: 'Жима Атаг1а: своя пятница, свой сбор' },
  { id: 'novatagi_judo', name: 'Спортшкола дзюдо', village: 'novatagi', kind: 'gym', x: 89.7, z: 186.6, real: true, src: '2gis', gis: '70000001053481976',
    note: 'Республиканская. Отсюда выходят чемпионы и очень вежливые люди' },
  { id: 'novatagi_school', name: 'Школа №1 Новых Атагов', village: 'novatagi', kind: 'school', x: 86.9, z: 183.9, real: true, src: '2gis', gis: '70000001096960343',
    note: 'Домашку списывают у старших Атагов. Через мост' },
  { id: 'novatagi_wash', name: 'Автомойка самообслуживания', village: 'novatagi', kind: 'carwash', x: 92.7, z: 183.7, real: true, src: '2gis', gis: '70000001080878920',
    note: 'Моешь сам. Хозяин смотрит и даёт советы' },
  { id: 'novatagi_tc', name: 'Торговый центр «Атаги»', village: 'novatagi', kind: 'market', x: 95.4, z: 182.7, real: true, src: '2gis', gis: '70030076405330385',
    note: 'Называется «Атаги», стоит в Новых. Спорят до сих пор' },
  { id: 'novatagi_field', name: 'Футбольное поле Новых Атагов', village: 'novatagi', kind: 'stadium', x: 94, z: 186.8, real: true, src: '2gis', gis: '70030076405330106',
    note: 'Ворота из двух рюкзаков. Счёт никто не помнит' },

  // ---- Курчалой (HQ 339.4, 102.9; речка Гумс делит город) --------------------------------
  { id: 'kurch_mosque', name: 'Большая мечеть Курчалоя', village: 'kurchaloy', kind: 'mosque', x: 346.9, z: 106.7, real: true, src: '2gis', gis: '70000001037780586',
    note: 'Минарет видно даже с пятиэтажки' },
  { id: 'kurch_park', name: 'Центральный парк', village: 'kurchaloy', kind: 'park', x: 344.3, z: 105.5, real: true, src: '2gis', gis: '70030076167566657',
    note: 'Скамейки, речка и разговоры про Атаги' },
  { id: 'kurch_mosque_n', name: 'Северная мечеть', village: 'kurchaloy', kind: 'mosque', x: 339.5, z: 97.2, real: true, src: '2gis', gis: '70000001055984752',
    note: 'Ближе всех к центру. Опоздать всё равно умудряются' },
  { id: 'kurch_mosque_s', name: 'Южная мечеть', village: 'kurchaloy', kind: 'mosque', x: 340.2, z: 118, real: true, src: '2gis', gis: '70000001055999636',
    note: 'Отсюда первыми видят, кто едет из Шали' },
  { id: 'kurch_burger', name: 'Бургерная', village: 'kurchaloy', kind: 'cafe', x: 348.1, z: 105.8, real: true, src: '2gis', gis: '70000001103058270',
    note: 'Бургер, картошка, кола. Тренер не узнает' },
  { id: 'kurch_fastfood', name: 'Шаурма на углу', village: 'kurchaloy', kind: 'cafe', x: 351.8, z: 106.2, real: true, src: '2gis', gis: '70000001079017475',
    note: 'Шаурма 250 ₽. В Атагах за 200, но там же Атаги' },
  { id: 'kurch_fuji', name: 'Фудзи', village: 'kurchaloy', kind: 'cafe', x: 345.5, z: 101.5, real: false, src: 'manual',
    note: 'Шаурма в кляре. Кто ел — тот помнит' },
  { id: 'kurch_school1', name: 'Школа №1', village: 'kurchaloy', kind: 'school', x: 353.1, z: 109.7, real: true, src: '2gis', gis: '70000001037715998',
    note: 'Пятиэтажку видно из окна. Гордятся с первого класса' },
  { id: 'kurch_school3', name: 'Школа №3', village: 'kurchaloy', kind: 'school', x: 339.2, z: 119.1, real: true, src: '2gis', gis: '70000001041876355',
    note: 'Южный край. После звонка — сразу на мойку' },
  { id: 'kurch_school4', name: 'Школа №4', village: 'kurchaloy', kind: 'school', x: 356.2, z: 87.3, real: true, src: '2gis', gis: '70000001047732859',
    note: 'Самый край города. До центра — на маршрутке' },
  { id: 'kurch_fuel', name: 'Заправка на въезде', village: 'kurchaloy', kind: 'fuel', x: 321.5, z: 97.9, real: true, src: '2gis', gis: '70000001104555400',
    note: 'Камри без прав заправляется тут. Права — дома' },
  { id: 'kurch_wash', name: 'Автомойка самообслуживания', village: 'kurchaloy', kind: 'carwash', x: 334.7, z: 119.4, real: true, src: '2gis', gis: '70000001105128559',
    note: 'Чёрные гелики, номера КРА 95. Водителей никто не видел' },
  { id: 'kurch_field', name: 'Футбольное поле', village: 'kurchaloy', kind: 'stadium', x: 353.5, z: 120.6, real: true, src: '2gis', gis: '70030076182926457',
    note: 'Играют до темноты. Потом по фарам',
    spicyNote: 'Играют до темноты. Потом по фарам и на бамб LOOP' },

  // ---- Шали (центр карты; точка села 195.2, 159.2) ---------------------------------------
  { id: 'shali_mosque', name: 'Мечеть «Гордость мусульман»', village: 'shali', kind: 'mosque', x: 194.4, z: 158.8, real: true, src: '2gis', gis: '70000001038704142',
    note: 'Видно и из Атагов, и из Курчалоя. Спорить не о чем' },
  { id: 'shali_tc', name: 'Торговый центр', village: 'shali', kind: 'shop', x: 196.2, z: 158.8, real: true, src: '2gis', gis: '70030076166810994',
    note: 'Три торговых центра на одном углу. Всё равно идут на рынок' },
  { id: 'shali_market', name: 'Рынок «Беркат»', village: 'shali', kind: 'market', x: 198.4, z: 144.7, real: true, src: '2gis', gis: '70000001038547218',
    note: 'Тут купишь всё. Даже то, что потерял вчера',
    spicyNote: 'Тут купишь всё. Снюс — из-под прилавка, LOOP — по знакомству' },
  { id: 'shali_park', name: 'Центральный парк Шали', village: 'shali', kind: 'park', x: 198.1, z: 160.3, real: true, src: '2gis', gis: '70000001115649924',
    note: 'Гуляют все. Особенно те, у кого сейчас пары' },
  { id: 'shali_hospital', name: 'Районная больница', village: 'shali', kind: 'clinic', x: 198.1, z: 155.6, real: true, src: '2gis', gis: '70000001077205727',
    note: 'Очередь длиннее, чем болезнь' },
  { id: 'shali_sport', name: 'Спорткомплекс', village: 'shali', kind: 'gym', x: 193.1, z: 156.6, real: true, src: '2gis', gis: '70000001038221349',
    note: 'Ковёр, ринг и тренер, который всё видел' },
  { id: 'shali_stadium', name: 'Школьный стадион', village: 'shali', kind: 'stadium', x: 186.6, z: 168.6, real: true, src: '2gis', gis: '70030076465216914',
    note: 'Физра на улице. Даже в ноябре' },
  { id: 'shali_shawarma', name: 'Шаурма', village: 'shali', kind: 'cafe', x: 194.3, z: 163.4, real: true, src: '2gis', gis: '70000001055159976',
    note: 'Цена ровно посередине между Атагами и Курчалоем' },

  // ---- Автуры, Цоцин-Юрт, Чечен-Аул (нейтральные сёла) ----------------------------------
  { id: 'avtury_mosque', name: 'Мечеть Автуров', village: 'other', kind: 'mosque', x: 274.1, z: 151.4, real: true, src: '2gis', gis: '70000001053481032',
    note: 'Нейтральная территория. Тут не спорят' },
  { id: 'avtury_stadium', name: 'Школьный стадион Автуров', village: 'other', kind: 'stadium', x: 272.2, z: 170.1, real: true, src: '2gis', gis: '70030076411499793',
    note: 'Тренируются тихо. Кто кого — узнают на турнире' },
  { id: 'tsotsi_school', name: 'Школа Цоцин-Юрта', village: 'other', kind: 'school', x: 271.2, z: 68, real: true, src: '2gis', gis: '70000001080488729',
    note: 'Цоцин-Юрт держится в стороне. Пока' },
  { id: 'chaul_stadium', name: 'Стадион Чечен-Аула', village: 'other', kind: 'stadium', x: 109.8, z: 100.9, real: true, src: '2gis', gis: '70030076435475281',
    note: 'У самого Аргуна. Мяч в реке — игра окончена' },
  { id: 'chaul_mosque', name: 'Мечеть Чечен-Аула', village: 'other', kind: 'mosque', x: 101.5, z: 114.2, real: true, src: '2gis', gis: '70000001036232734',
    note: 'Пятница у моста: Атаги с одной стороны, все остальные — с другой' },
];

/**
 * Exactly four, two per side, all real 2GIS places (sim pts[9..12] in this order). Атаги:
 * the football field on the northern edge (20.7 from the HQ) and the car wash with the СТО on
 * the main street towards the bridge (12.7). Курчалой: the stadium in the north-east (12.3; the
 * only sport hall in range is named after the head's family, the sports school is inside the
 * HQ's 5.5) and the supermarket at the western entrance, facing Атаги (10.4; the market proper
 * sits 4 units from the stadium, inside its ring).
 */
export const CAPTURE_PLACES: CapturePlace[] = [
  { key: 'atagi_stadium', name: 'Футбольное поле', side: 0, x: 56.8, z: 175.3, r: 5, perk: 'sportiki', src: '2gis', gis: '70030077005771001',
    note: 'Спортики в трениках. Каждый вечер. Мяч один на всех',
    spicyNote: 'Спортики: под губой снюс, в ногах сила, мяч опять потеряли' },
  { key: 'atagi_wash', name: 'Автомойка и СТО', side: 0, x: 65.2, z: 183, r: 5, perk: 'gelik', src: '2gis', gis: '70000001080311475',
    note: 'Чёрный гелик, номера КРА 95. Помыли, подкрутили — и к шаурме через дорогу' },
  { key: 'kurch_gym', name: 'Стадион', side: 1, x: 346.1, z: 92.6, r: 5, perk: 'gym', src: '2gis', gis: '70030076184167346',
    note: 'Зураб тут прописан. Турник у трибуны, рынок за забором',
    spicyNote: 'Без бамб LOOP под губой на турник не пускают' },
  { key: 'kurch_market', name: 'Супермаркет у трассы', side: 1, x: 329.6, z: 99.4, r: 5, perk: 'market', src: '2gis', gis: '70000001115142815',
    note: 'Тут знают, кто сколько должен. С точностью до рубля',
    spicyNote: 'Спросишь энергетик — дадут бамб LOOP. Спросишь снюс — дадут два' },
];
