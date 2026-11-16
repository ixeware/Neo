// Landmarks of Старые Атаги, Новые Атаги, Курчалой and Шали in world coordinates, plus four
// capture places (two per side) on the village edges facing the enemy.
//
// World: 1 unit = 100 m, x east, z south, crop lon 45.665–46.155, lat 43.055–43.300 (398×272).
//   x = (lon − 45.665) / 0.49 × 398,  z = (43.300 − lat) / 0.245 × 272
// This differs from tools/bake_terrain.py (metres per degree at the crop's mid latitude) by at
// most 0.15 units anywhere on the map. With it the bake's village seeds land within 3 units of
// the built-up centroids in TERRAIN_META.villages (all but Аргун, whose cluster merges with its
// neighbours), so the land cover, the sim's points and these places share one frame.
//
// real: true only for a spot taken from OpenStreetMap (osm = "node/123" etc.). Spots with
// real: false are what this kind of village has (a central mosque, schools, a stadium, a market,
// a bus stop), placed on the baked built-up layer by hand. They are not surveyed positions.
// Places named after political figures get neutral names; police and military sites are left
// out on purpose.
//
// Each place sits on a passable nav cell whose 3×3 block is passable, off the water and the
// bridges. Places are at least 1.2 units apart, more than 5.5 units from both HQs, and at least
// r + 1 from every capture place. CAPTURE_PLACES are not repeated in PLACES.
import { TERRAIN_META as M } from './terrain';

export type PlaceKind = 'mosque' | 'school' | 'stadium' | 'market' | 'shop' | 'cafe' | 'gym' | 'park' | 'busstop' | 'carwash' | 'fuel' | 'parking' | 'clinic' | 'other';

export interface Place {
  id: string;
  name: string;
  village: 'atagi' | 'novatagi' | 'kurchaloy' | 'shali' | 'other';
  kind: PlaceKind;
  x: number; z: number;
  /** true = position from OpenStreetMap; false = typical spot placed on the built-up layer. */
  real: boolean;
  /** OSM element, e.g. "way/123456", when real. */
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
  r: number;
  perk: 'sportiki' | 'gelik' | 'gym' | 'market';
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
  gym: 'Качалка', park: 'Парк', busstop: 'Остановка', carwash: 'Мойка', fuel: 'Заправка', parking: 'Стоянка',
  clinic: 'Больница', other: 'Место',
};

export const PERK_LABEL: Record<CapturePlace['perk'], string> = {
  sportiki: 'Спортики', gelik: 'Гелики КРА 95', gym: 'Качалка', market: 'Рынок',
};

export const PLACES: Place[] = [
  // ---- Старые Атаги (левый берег Аргуна, HQ 62.1, 195.3) ----------------------------------
  { id: 'atagi_mosque', name: 'Центральная мечеть', village: 'atagi', kind: 'mosque', x: 60.5, z: 188.5, real: false,
    note: 'Пятничный сбор всего села. Опоздавших видно издалека' },
  { id: 'atagi_school', name: 'Школа №1', village: 'atagi', kind: 'school', x: 63, z: 202.5, real: false,
    note: 'Тут учились все. Доучились не все' },
  { id: 'atagi_shops', name: 'Магазины на трассе', village: 'atagi', kind: 'shop', x: 58.5, z: 186, real: false,
    note: 'Энергетик, семечки, сим-карта — в одном окне',
    spicyNote: 'Снюс под прилавком. Бамб LOOP — только своим' },
  { id: 'atagi_shawarma', name: 'Шаурма у моста', village: 'atagi', kind: 'cafe', x: 69, z: 190.5, real: false,
    note: 'Шаурма 250 ₽. Чай бесплатно, если знаешь хозяина' },
  { id: 'atagi_stop', name: 'Остановка «На Грозный»', village: 'atagi', kind: 'busstop', x: 60, z: 179, real: false,
    note: 'Маршрутка 150 приходит, когда захочет' },
  { id: 'atagi_fuel', name: 'Заправка на въезде', village: 'atagi', kind: 'fuel', x: 60, z: 171, real: false,
    note: 'Гелики заправляются, сельские смотрят' },
  { id: 'atagi_clinic', name: 'Амбулатория', village: 'atagi', kind: 'clinic', x: 58, z: 208, real: false,
    note: 'Диагноз один на всех: «пройдёт само»' },
  { id: 'atagi_gym', name: 'Качалка «Подвал»', village: 'atagi', kind: 'gym', x: 64, z: 210, real: false,
    note: 'Повесили зеркало. Все думают, что это окно',
    spicyNote: 'Жим лёжа, снюс сидя' },
  { id: 'atagi_dk', name: 'Дом культуры', village: 'atagi', kind: 'other', x: 56.5, z: 199, real: false,
    note: 'Свадьбы по выходным. Танцуют все, кроме жениха' },

  // ---- Новые Атаги (правый берег, через мост) --------------------------------------------
  { id: 'novatagi_mosque', name: 'Мечеть Новых Атагов', village: 'novatagi', kind: 'mosque', x: 90, z: 183, real: false,
    note: 'Жима Атаг1а: своя пятница, свой сбор' },
  { id: 'novatagi_school', name: 'Школа Новых Атагов', village: 'novatagi', kind: 'school', x: 87, z: 191, real: false,
    note: 'Домашку списывают у старших Атагов. Через мост' },
  { id: 'novatagi_field', name: 'Поле за школой', village: 'novatagi', kind: 'stadium', x: 95, z: 194, real: false,
    note: 'Ворота из двух рюкзаков. Счёт никто не помнит' },
  { id: 'novatagi_carwash', name: 'Мойка на въезде', village: 'novatagi', kind: 'carwash', x: 97, z: 176, real: false,
    note: 'Мойка плюс чай. Мойка — по желанию' },

  // ---- Курчалой (HQ 339.4, 102.9; речка Гумс делит село) --------------------------------
  { id: 'kurch_mosque', name: 'Центральная мечеть Курчалоя', village: 'kurchaloy', kind: 'mosque', x: 343.5, z: 109, real: false,
    note: 'Минарет видно даже с пятиэтажки' },
  { id: 'kurch_school', name: 'Школа №1', village: 'kurchaloy', kind: 'school', x: 333.5, z: 97, real: false,
    note: 'Пятиэтажку видно из окна. Гордятся с первого класса' },
  { id: 'kurch_cafe', name: 'Кофейня на центральной', village: 'kurchaloy', kind: 'cafe', x: 336, z: 108.5, real: false,
    note: 'Двойной эспрессо. Двести часов тут уже отсидели',
    spicyNote: 'Двойной эспрессо и снюс под губой. Сессия — в другой раз' },
  { id: 'kurch_bus', name: 'Автостанция', village: 'kurchaloy', kind: 'busstop', x: 338.5, z: 92.5, real: false,
    note: 'Маршрутка 150 до Грозного. Отправление — когда наберётся' },
  { id: 'kurch_park', name: 'Парк у Гумса', village: 'kurchaloy', kind: 'park', x: 350, z: 99, real: false,
    note: 'Скамейки, речка и разговоры про Атаги' },
  { id: 'kurch_hospital', name: 'Районная больница', village: 'kurchaloy', kind: 'clinic', x: 350.5, z: 112, real: false,
    note: 'Очередь длиннее, чем болезнь' },
  { id: 'kurch_parking', name: 'Стоянка геликов', village: 'kurchaloy', kind: 'parking', x: 344, z: 116, real: false,
    note: 'Чёрные гелики, номера КРА 95. Блестят даже ночью' },
  { id: 'kurch_stadium', name: 'Стадион Курчалоя', village: 'kurchaloy', kind: 'stadium', x: 324, z: 103.5, real: false,
    note: 'Спортики бегают кругами. Кругов меньше, чем разговоров',
    spicyNote: 'Спортики: тренировка в 19:00, бамб LOOP — в 18:55' },
  { id: 'kurch_fuel', name: 'Заправка на выезде', village: 'kurchaloy', kind: 'fuel', x: 328.5, z: 108, real: false,
    note: 'Камри без прав заправляется тут. Права — дома' },
  { id: 'kurch_shop', name: 'Магазин «24 часа»', village: 'kurchaloy', kind: 'shop', x: 371, z: 104, real: false,
    note: 'Работает с девяти до девяти',
    spicyNote: 'Энергетик на витрине, снюс — у кассы, LOOP — по знакомству' },

  // ---- Шали (центр карты) ----------------------------------------------------------------
  { id: 'shali_mosque', name: 'Большая мечеть Шали', village: 'shali', kind: 'mosque', x: 198, z: 167, real: false,
    note: 'Видно и из Атагов, и из Курчалоя. Спорить не о чем' },
  { id: 'shali_market', name: 'Шалинский рынок', village: 'shali', kind: 'market', x: 192.5, z: 156, real: false,
    note: 'Тут купишь всё. Даже то, что потерял вчера' },
  { id: 'shali_bus', name: 'Автовокзал Шали', village: 'shali', kind: 'busstop', x: 204, z: 172, real: false,
    note: 'Отсюда уезжают все. Возвращаются на свадьбы' },
];

/**
 * Exactly four: two per side, each 9–22 units from its own HQ on the edge that faces the enemy
 * (Атаги look east/north-east across the Аргун, Курчалой looks west/south-west).
 */
export const CAPTURE_PLACES: CapturePlace[] = [
  { key: 'atagi_stadium', name: 'Стадион Атагов', side: 0, x: 66.5, z: 178, r: 3.5, perk: 'sportiki',
    note: 'Спортики в трениках. Каждый вечер. Мяч один на всех',
    spicyNote: 'Спортики: под губой снюс, в ногах сила, мяч опять потеряли' },
  { key: 'atagi_wash', name: 'Мойка у Аргуна', side: 0, x: 74.5, z: 183.5, r: 3.5, perk: 'gelik',
    note: 'Чёрный гелик, номера КРА 95. Моют прямо в Аргуне' },
  { key: 'kurch_gym', name: 'Качалка у трассы', side: 1, x: 321.5, z: 98, r: 3.5, perk: 'gym',
    note: 'Зураб тут прописан. Креатин по абонементу',
    spicyNote: 'Без бамб LOOP под губой на жим не пускают' },
  { key: 'kurch_market', name: 'Курчалоевский рынок', side: 1, x: 332, z: 117.5, r: 3.5, perk: 'market',
    note: 'Тут знают, кто сколько должен. С точностью до рубля',
    spicyNote: 'Спросишь энергетик — дадут бамб LOOP. Спросишь снюс — дадут два' },
];
