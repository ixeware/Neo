// Знакомые с потока (18+: «грязнульки») и Вайнаг. Всё ВЫДУМАНО для лора: таких людей нет.
// Никаких настоящих имён, фамилий, фото, адресов. Все героини — совершеннолетние студентки
// (или работают в деканате). Юмор сухой, как в беседе; ничего откровенного.
//
// Механика: девушка появляется на карте, своя пехота стоит рядом пару секунд и «подцепляет» её.
// Она уходит в коллекцию игрока (только в UI, на игру не влияет) и даёт своей стороне короткий бафф.
//
// Слой 18+: строка с spicy: true показывается только с тумблером. Слова «грязнулька», «куколд»,
// «3 парня» живут только в spicy-строках и в spicyName/spicyTag/spicyText. В чистом режиме набор
// называется «Знакомые с потока».
//
// Порядок GIRLS — часть симуляции (индекс = номер девушки в состоянии игры): только дописывать в конец.

import type { Line } from './lore';

export type GirlRarity = 'обычная' | 'редкая' | 'легендарная';
/** Где обычно появляется: какие точки карты см. GIRL_SPOTS. */
export type GirlHome = 'atagi' | 'kurchaloy' | 'grozny' | 'shali' | 'any';

/**
 * What a buff does. «Own» = the side whose unit picked her up, «enemy» = the other side.
 * Fractions are 0.1 = 10%. Durations are in seconds (×TPS for ticks). All values are capped by GIRL_CAP.
 * Same key twice on one side does not stack: keep the larger value, the timer becomes max(left, new dur).
 */
export type GirlBuffKey =
  | 'speed' // own units move ×(1 + value)
  | 'damage' // own units deal ×(1 + value)
  | 'armor' // own units take ×(1 − value)
  | 'heal' // instant: own units within r of her heal value × max hp (dur 0)
  | 'income' // own income +value ₽/s
  | 'enemyIncome' // enemy income ×(1 − value)
  | 'cost' // own unit prices ×(1 − value), rounded down to whole ₽
  | 'ownTurret' // own high-rise turret damage ×(1 + value)
  | 'enemyTurret' // enemy high-rise turret damage ×(1 − value)
  | 'capture' // own units capture villages and places ×(1 + value) faster
  | 'slow' // enemies within r of her at pickup: speed ×(1 − value) for dur
  | 'abilityCd' // own hero/boss ability cooldowns tick ×(1 + value) faster
  | 'tauntImmune' // own units ignore Амин's «Рейджбайт» (U.tt) for dur; value is a flag (1)
  | 'reveal' // UI: show the enemy's purchases as they happen; value is a flag (1)
  | 'vote' // the picker's ballot on own сходы counts 1 + value while the buff runs (AI picker: side's first NPC voter)
  | 'doner' // own units within DONER.healR of Донер Бей get its heal even if it is not ours; if it is ours, heal ×(1 + value)
  | 'a1' // A1: own damage ×(1 + value) + GirlSpecial 'islam'
  | 'excuse' // Рыжулька: GirlSpecial 'excuse'
  | 'split' // Альтушка: GirlSpecial 'split'
  | 'spy'; // Оператор: GirlSpecial 'spy'

export interface GirlBuff {
  key: GirlBuffKey;
  /** Meaning per key (see GirlBuffKey). */
  value: number;
  /** Seconds. 0 = instant (heal). */
  dur: number;
  /** Radius in world units, for 'heal', 'slow' and 'split'. Measured from where she stood. */
  r?: number;
  /** How many own units get it ('split'). */
  n?: number;
  /** Clean text for the card and the toast. */
  text: string;
  /** 18+ wording of `text`, shown instead of it only with the toggle on. */
  spicyText?: string;
}

/** Extra rules of the four named girls. All numbers are seconds, fractions or world units. */
export type GirlSpecial =
  /**
   * A1. Picked by Атаги: while the buff runs, our Ислам (the side-0 boss, or a hero with key 'islam'
   * if one is ever added) within r of the unit that picked her deals ×(1 + dmg), and the first time
   * he is that close he heals heal × max hp. Picked by Курчалой: own damage only +rival instead of
   * buff.value, and the enemy Ислам, if on the field, deals ×(1 + jealous) for jealousDur («ревнует»).
   */
  | { kind: 'islam'; r: number; heal: number; dmg: number; rival: number; jealous: number; jealousDur: number }
  /**
   * Рыжулька. While the buff runs: the first `heroes` own heroes that would leave «на пары» (world
   * event 'classes') or get «спален» by Вайнаг stay / are cleared instead. A hero already away
   * «на парах» at pickup comes back now (counts against `heroes`).
   */
  | { kind: 'excuse'; heroes: number }
  /**
   * Альтушка. The n own non-vehicle units nearest to where she stood (within r; ties → lower unit id;
   * the picker counts) get +buff.value damage and +buff.value max hp (current hp scaled too).
   * Fewer than n in range → fewer get it; the share is not redistributed.
   */
  | { kind: 'split'; n: number; r: number }
  /**
   * Оператор. While the buff runs the UI shows every enemy purchase (like 'reveal') and the enemy
   * side's сход ballots. If the enemy Амин (WOU) is alive at pickup: «ник спалили» — his
   * «Рейджбайт» pulses are off for rageOff seconds.
   */
  | { kind: 'spy'; buys: true; ballots: true; rageOff: number };

/** Where she stood and what the lowpoly model should look like. Colours are hex for flat materials. */
export interface GirlColors { hair: string; top: string; bottom: string; accent: string }

export interface GirlLines {
  /** She appears on the map (toast + speech bubble). */
  spawn: Line[];
  /** Someone picked her up. */
  picked: Line[];
  /** Nobody picked her up in time: «ушла». */
  lost: Line[];
  /** Speech bubble while she waits on the map (every GIRL_SPAWN.idleEvery s). */
  idle: Line[];
  /** Her special fired: A1 — our Ислам is near; Рыжулька — the отмазка worked; Оператор — Амин's nick is out. */
  special?: Line[];
  /** A1 only: picked by Курчалой. */
  rival?: Line[];
}

export interface Girl {
  id: string;
  name: string;
  /** 18+ name (only if it differs). */
  spicyName?: string;
  /** Clean one-liner for the collection card. */
  tag: string;
  /** 18+ variant of tag. */
  spicyTag?: string;
  rarity: GirlRarity;
  home: GirlHome;
  /** Flavour for the card: where people usually see her. Always clean. */
  where: string;
  /** Short visual description for the model agent: hair, outfit colours, one accessory. */
  look: string;
  colors: GirlColors;
  /** Signature line for the card. */
  quote: Line;
  buff: GirlBuff;
  special?: GirlSpecial;
  lines: GirlLines;
}

export const GIRLS: Girl[] = [
  // ---- четыре именные -----------------------------------------------------------------------
  {
    id: 'a1',
    name: 'A1',
    tag: 'Из Атагов. Возлюбленная Ислама — ради неё он пришёл на первую пару',
    rarity: 'легендарная',
    home: 'atagi',
    where: 'Старые Атаги, остановка 55-й',
    look: 'Длинные тёмные волосы в низкий хвост, изумрудное пальто до щиколоток, белый шарф, маленькая сумочка цвета айвори, белые кроссовки',
    colors: { hair: '#2b1d16', top: '#1f6f50', bottom: '#1f6f50', accent: '#f4efe4' },
    quote: { t: 'Четвёртый этаж нашёл?' },
    buff: {
      key: 'a1', value: 0.1, dur: 90,
      text: 'Свои бьют на 10% сильнее 90 с. Наш Ислам рядом — +20% здоровья сразу и +25% урона. Курчалою она так не помогает',
    },
    special: { kind: 'islam', r: 12, heal: 0.2, dmg: 0.25, rival: 0.05, jealous: 0.15, jealousDur: 30 },
    lines: {
      spawn: [
        { t: 'Ислам, ты где?' },
        { t: 'Йоккха Атаг1а — центр мира. Я проверяла' },
        { t: 'Курчалой, ну как там, завидуете?', who: 'Ислам' },
        { t: 'Стей хард', who: 'Ислам' },
      ],
      picked: [
        { t: 'Только до маршрутки' },
        { t: 'Ладно. Но Ислам узнает' },
        { t: '+10000000000000000 aura', who: 'Ислам' },
        { t: 'Легчайшее заявление в моей жизни', who: 'Ислам' },
      ],
      special: [
        { t: 'Теперь отдыхайте, ребята', who: 'Ислам' },
        { t: 'Не успокоюсь, пока 4 этажа не найду. Теперь есть ради кого', who: 'Ислам' },
        { t: 'Справа Исламность, слева Исламчиковость', who: 'Ислам' },
        { t: 'Ислам, ты же говорил, что на первую пару нельзя' },
      ],
      rival: [
        { t: 'Я вообще-то из Атагов' },
        { t: 'Не по-братски', who: 'Ислам' },
        { t: 'Ходи оглядывайся', who: 'Зураб' },
        { t: 'Ислам ревнует. Исход очевиден', who: 'Чимаев' },
        { t: 'Пиздец, у Ислама увели', who: 'Чимаев', spicy: true },
      ],
      lost: [
        { t: 'Маршрутка пришла. Пока' },
        { t: 'Итс овер', who: 'Ислам' },
        { t: 'Переплыл океан, утонул в луже', who: 'Ислам' },
        { t: 'L gemini 💔', who: 'Ислам' },
      ],
      idle: [
        { t: 'Четвёртый этаж нашёл?' },
        { t: 'В кофейню после второй пары?' },
        { t: 'Барсетку новую купи' },
        { t: 'Нам сельским не впервой', who: 'Ислам' },
        { t: 'Ислам, бля, соберись', who: 'Зураб', spicy: true },
      ],
    },
  },
  {
    id: 'ryzhulka',
    name: 'Рыжулька',
    tag: 'Из деканата. Очень красивая. Может отмазать от пары',
    rarity: 'легендарная',
    home: 'grozny',
    where: 'ГГНТУ, деканат, окно приёма',
    look: 'Длинные медно-рыжие волнистые волосы, кремовая блузка, длинная тёмно-зелёная юбка, бежевый тренч, синяя папка с документами и круглая печать в руке',
    colors: { hair: '#b4532a', top: '#f1e6d2', bottom: '#2f4a3a', accent: '#2d4f9e' },
    quote: { t: 'Справку сделаю. Одну' },
    buff: {
      key: 'excuse', value: 1, dur: 180,
      text: '«Отмажу»: 3 минуты один наш герой не уходит на пары и комиссионку, а кто уже ушёл — сразу вернётся. Снимает «спален» Вайнага',
    },
    special: { kind: 'excuse', heroes: 1 },
    lines: {
      spawn: [
        { t: 'Кто тут без справки?' },
        { t: 'Деканатчохь (в деканате)', who: 'Зураб' },
        { t: 'Все резко захотели в деканат', who: 'админ' },
      ],
      picked: [
        { t: 'Справку сделаю. Одну' },
        { t: 'Тебя в списке отсутствующих нет. Уже нет' },
        { t: 'Н сняли. Не спрашивайте как', who: 'админ' },
      ],
      special: [
        { t: 'Он на больничном. Справка вот' },
        { t: 'Пересдачу перенесли' },
        { t: 'Не знает, что приказ сверху уже отдан', who: 'Ислам' },
        { t: 'Админ сказал, что не будет', who: 'Амин' },
      ],
      lost: [
        { t: 'Приём до 17:00' },
        { t: 'Обед. Приходите завтра' },
        { t: 'Нас отчисляют', who: 'админ' },
      ],
      idle: [
        { t: 'Ведомость кто забрал?' },
        { t: 'Пересдача в четверг. Без вариантов' },
        { t: 'Зачётки на стол' },
        { t: 'В деканат все ходят только за справкой. Ну, почти', who: 'Амин' },
        { t: 'Бля, она реально красивая', who: 'Чимаев', spicy: true },
        { t: 'Похуй на пары, я в деканат', who: 'Ислам', spicy: true },
      ],
    },
  },
  {
    id: 'altushka',
    name: 'Альтушка',
    tag: 'Со второго курса. Всегда с тремя одногруппниками — бафф делит на троих',
    spicyTag: 'Куколд со второго курса. У неё 3 парня — бафф на троих',
    rarity: 'редкая',
    home: 'grozny',
    where: 'ГГНТУ, второй курс, подоконник у лестницы',
    look: 'Чёрное каре с розовыми прядями и прямой чёлкой, чёрная оверсайз-толстовка, длинная клетчатая юбка, плотные чёрные колготки, массивные ботинки на платформе, наушники с кошачьими ушками, цепочка на поясе',
    colors: { hair: '#141414', top: '#1c1c1c', bottom: '#7a2b3a', accent: '#ff6fb1' },
    quote: { t: 'Я с друзьями' },
    buff: {
      key: 'split', value: 0.25, n: 3, r: 12, dur: 90,
      text: 'Трём ближайшим нашим (не машинам) — +25% урона и +25% здоровья на 90 с',
      spicyText: '«3 парня»: трём ближайшим нашим — +25% урона и +25% здоровья на 90 с',
    },
    special: { kind: 'split', n: 3, r: 12 },
    lines: {
      spawn: [
        { t: 'Я с друзьями' },
        { t: 'Нас четверо, если что' },
        { t: 'Оформлятор альтушек 3000', who: 'Амин' },
        { t: 'Я альтушкой поделился бы', who: 'ersno', spicy: true },
      ],
      picked: [
        { t: 'Ладно. Но мальчики со мной' },
        { t: 'Делю на троих. По-честному' },
        { t: 'Ещё трое в комплекте', who: 'Зураб' },
        { t: 'Ты четвёртый, брат', who: 'Ислам', spicy: true },
        { t: 'У неё 3 парня, а у тебя ноль', who: 'Чимаев', spicy: true },
      ],
      lost: [
        { t: 'Нас ждут' },
        { t: 'Всё, мы на пару' },
        { t: 'Ушли вчетвером', who: 'админ' },
      ],
      idle: [
        { t: 'Кто-нибудь слышал новый альбом?' },
        { t: 'Мы в кофейню. Вчетвером' },
        { t: 'Трое ходят за ней, как охрана', who: 'Амин' },
        { t: 'Куколд со второго курса снова на районе', who: 'Ислам', spicy: true },
        { t: '3 парня и ни одной Н', who: 'админ', spicy: true },
      ],
    },
  },
  {
    id: 'operator',
    name: 'Оператор',
    tag: 'Сидит сзади на паре и фоткает экран Амина, пока он играет в шахматы. Ищет его ник',
    rarity: 'редкая',
    home: 'grozny',
    where: 'ГГНТУ, последний ряд',
    look: 'Тёмные волосы в высокий пучок, круглые очки, серая толстовка с капюшоном, тёмно-синие джинсы, белые кеды, телефон в поднятой руке камерой вперёд (мигает вспышка), шнурок с пропуском',
    colors: { hair: '#2a1f1a', top: '#8a8d91', bottom: '#22314f', accent: '#e8f0ff' },
    quote: { t: 'Ник спалила' },
    buff: {
      key: 'spy', value: 1, dur: 60,
      text: '60 с видно, что покупают соседи и как голосуют на сходе. Если у соседей на поле Амин — «ник спалили»: «Рейджбайт» выключен на 20 с',
    },
    special: { kind: 'spy', buys: true, ballots: true, rageOff: 20 },
    lines: {
      spawn: [
        { t: 'Я сзади сижу. Не обращайте внимания' },
        { t: 'Камера готова' },
        { t: 'Оператор дрона. Смотреть футаж', who: 'Амин' },
        { t: 'Бросай шахматы, пока не поздно', who: 'Ислам' },
      ],
      picked: [
        { t: 'Скрин есть. Сейчас скину' },
        { t: 'Всё, что они покупают, у меня в галерее' },
        { t: 'Кто сфоткал мой экран?', who: 'Амин' },
      ],
      special: [
        { t: 'Ник спалила' },
        { t: 'Рейтинг тоже видела. Не скажу' },
        { t: 'Удали фото', who: 'Амин' },
        { t: 'Паспорт гайт оьши, Амин ву аьл? (паспорт показать, что я Амин?)', who: 'Амин' },
        { t: 'Это не мой ник. Это брат играл', who: 'Амин' },
        { t: 'Кто в 12 ебучие шахматы играет, баля', who: 'админ', spicy: true },
      ],
      lost: [
        { t: 'Пара закончилась' },
        { t: 'Батарея села' },
        { t: 'Фото удалила? — Нет', who: 'Амин и Оператор' },
      ],
      idle: [
        { t: 'Е2–Е4. Предсказуемо' },
        { t: 'Он опять в шахматы на паре' },
        { t: 'Амин по кайфу телефон не берёт', who: 'Ислам' },
        { t: 'Кто-то сзади сидит. Чувствую', who: 'Амин' },
      ],
    },
  },

  // ---- случайные ----------------------------------------------------------------------------
  {
    id: 'kofe',
    name: 'Кофейная',
    tag: 'Живёт в кофейне у ГГНТУ. Видела всех, кто ушёл со второй пары',
    rarity: 'обычная',
    home: 'any',
    where: 'Кофейня у ГГНТУ',
    look: 'Каштановые волосы до плеч, бежевый оверсайз-свитер, длинная коричневая юбка, стакан кофе с крышкой, ноутбук в наклейках под мышкой',
    colors: { hair: '#5a3a22', top: '#d9c6a5', bottom: '#6b4a2f', accent: '#ffffff' },
    quote: { t: 'Раф на кокосовом, пожалуйста' },
    buff: { key: 'income', value: 3, dur: 120, text: '+3 ₽/с на 120 с: пацаны в кофейне, а деньги идут' },
    lines: {
      spawn: [
        { t: 'Раф на кокосовом, пожалуйста' },
        { t: 'В понедельник надо в кофейню, там посмотрим', who: 'админ' },
      ],
      picked: [
        { t: 'Вторую пару прогуляли? Я никому' },
        { t: 'На первую пару не приходим, на вторую опаздываем и выходим с кабинета, дальше в кофейню', who: 'Ислам' },
      ],
      lost: [{ t: 'Закрываемся' }, { t: 'Розетку заняли. Ухожу' }],
      idle: [
        { t: 'Розетка свободна?' },
        { t: '200 часов в кофейнях — это стаж' },
        { t: 'Мы под кофеином', who: 'Амин' },
      ],
    },
  },
  {
    id: 'starosta',
    name: 'Староста с потока',
    tag: 'Староста параллельной группы. Ставит Н быстрее админа',
    rarity: 'редкая',
    home: 'shali',
    where: 'Шали, автостанция — оттуда на пары',
    look: 'Тёмный гладкий хвост, серый строгий пиджак, длинная чёрная юбка, журнал посещаемости под мышкой, красная ручка',
    colors: { hair: '#1e1712', top: '#6d6f73', bottom: '#1b1b1b', accent: '#d12d2d' },
    quote: { t: 'Перекличка' },
    buff: { key: 'slow', value: 0.3, r: 10, dur: 6, text: '«Всем Н»: враги в радиусе 10 от неё 6 с ходят на 30% медленнее' },
    lines: {
      spawn: [{ t: 'Перекличка' }, { t: 'Кто на паре?' }],
      picked: [
        { t: 'Ты есть. Пока что' },
        { t: 'Два админа: главный админ и модератор', who: 'Амин' },
      ],
      lost: [{ t: 'Журнал сдала' }, { t: 'Пара началась без вас' }],
      idle: [
        { t: 'Ты 2 раза попал в список отсутствующих' },
        { t: 'Н дилна хьун (тебе Н поставили)' },
        { t: 'Админ, у тебя конкуренция', who: 'Зураб' },
      ],
    },
  },
  {
    id: 'doner',
    name: 'Постоянница Донер Бея',
    tag: 'Знает меню Донер Бея наизусть. Всегда с фирменным соусом',
    rarity: 'обычная',
    home: 'grozny',
    where: 'Донер Бей, столик у окна',
    look: 'Волнистые чёрные волосы, бордовая куртка-бомбер, светлые джинсы, белые кеды, бумажный пакет с шаурмой и сок',
    colors: { hair: '#151010', top: '#7b1e2b', bottom: '#9db4cf', accent: '#c8a46a' },
    quote: { t: 'Мне как обычно' },
    buff: { key: 'doner', value: 1, dur: 90, text: '90 с Донер Бей лечит наших, даже если он не наш. А если наш — вдвое' },
    lines: {
      spawn: [
        { t: 'Мне как обычно' },
        { t: 'Донер Бей похорошел', who: 'Ислам' },
      ],
      picked: [
        { t: 'С фирменным соусом. Без вариантов' },
        { t: 'Что угодно из Донер Бея с фирменным соусом', who: 'Ислам' },
        { t: 'В Донер Гей быстро', who: 'Амин', spicy: true },
      ],
      lost: [{ t: 'Соус кончился' }, { t: 'Заказ готов. Пока' }],
      idle: [
        { t: 'Шаурма плюс сок' },
        { t: 'В кляре? Это не сюда, это в Фудзи' },
        { t: 'Неужели Донер Бей подвёл?', who: 'Амин' },
      ],
    },
  },
  {
    id: 'medfak',
    name: 'Медичка с ЧГУ',
    tag: 'Медфак ЧГУ. Лечит всех рядом и не задаёт вопросов',
    rarity: 'редкая',
    home: 'grozny',
    where: 'ЧГУ, медфак',
    look: 'Светлые волосы в пучок, белый халат поверх голубого свитера, стетоскоп на шее, бейдж, зелёная сумка с конспектами',
    colors: { hair: '#c9a66b', top: '#f5f7fa', bottom: '#8fb3d9', accent: '#3f8f5a' },
    quote: { t: 'Кому тут плохо?' },
    buff: { key: 'heal', value: 0.2, r: 8, dur: 0, text: 'Свои в радиусе 8 сразу лечатся на 20% здоровья' },
    lines: {
      spawn: [{ t: 'Кому тут плохо?' }, { t: 'Без паники. Я с медфака' }],
      picked: [
        { t: 'Подорожник не поможет. Я помогу' },
        { t: 'Корову подоил — полный ТО. А тут настоящий врач', who: 'Чимаев' },
      ],
      lost: [{ t: 'У меня анатомия' }, { t: 'Смена кончилась' }],
      idle: [
        { t: 'Шаурма в кляре? Сочувствую' },
        { t: 'Креатин — не еда' },
        { t: 'Шаурма в кляре из Фудзи. Я отравился', who: 'Зураб' },
      ],
    },
  },
  {
    id: 'rynok',
    name: 'Шалинская с рынка',
    tag: 'С шалинского рынка. Знает, где дешевле, и торгуется за всех',
    rarity: 'обычная',
    home: 'shali',
    where: 'Шали, рынок',
    look: 'Длинная тёмная коса, куртка цвета хаки, длинная клетчатая юбка, тёплые ботинки, большая клетчатая сумка',
    colors: { hair: '#2a1c12', top: '#6b6b3a', bottom: '#7d5a3c', accent: '#3a5ba0' },
    quote: { t: 'Это за сколько брали?' },
    buff: { key: 'cost', value: 0.1, dur: 60, text: 'Всё на 10% дешевле 60 с: она поторговалась' },
    lines: {
      spawn: [{ t: 'Шали — центр карты, если что' }, { t: 'Кто тут переплачивает?' }],
      picked: [
        { t: 'Скидку сделаю. Своим' },
        { t: 'Взнос 100? Давай 80' },
        { t: 'Взнос 100 рублей с вас', who: 'Ислам' },
      ],
      lost: [{ t: 'Рынок закрывается' }, { t: 'Автобус в Шали ушёл. Я за ним' }],
      idle: [
        { t: 'Это за сколько брали?' },
        { t: 'Шаурма за 250? В Шали дешевле' },
        { t: 'Наши деньги в безопасности?', who: 'Ислам' },
      ],
    },
  },
  {
    id: 'pyatietazhka',
    name: 'С пятиэтажки',
    tag: 'Живёт на пятом этаже курчалоевской пятиэтажки. Всё видит из окна',
    rarity: 'обычная',
    home: 'kurchaloy',
    where: 'Курчалой, пятиэтажка, пятый этаж',
    look: 'Тёмные волосы под заколкой-крабиком, горчичный вязаный кардиган, длинная серая юбка, тёплые угги, бинокль на ремешке',
    colors: { hair: '#2d2118', top: '#c99a2e', bottom: '#7a7a7a', accent: '#3b3b3b' },
    quote: { t: 'С пятого этажа всё видно' },
    buff: { key: 'ownTurret', value: 0.2, dur: 90, text: 'Турель нашей высотки бьёт на 20% сильнее 90 с: она подсказывает из окна' },
    lines: {
      spawn: [
        { t: 'С пятого этажа всё видно' },
        { t: 'Местный Бурдж-Халифа', who: 'Амин' },
      ],
      picked: [
        { t: 'Лифта нет. Я пешком спустилась' },
        { t: 'Для тебя это как небоскрёб', who: 'Зураб' },
      ],
      lost: [{ t: 'Свет яц. Пошла наверх' }, { t: 'Пять этажей обратно. Пока' }],
      idle: [
        { t: 'Четвёртый этаж ищете? У нас их пять' },
        { t: 'Ваша достопримечательность — это мой подъезд' },
        { t: 'Не успокоюсь, пока 4 этажа не найду', who: 'Ислам' },
      ],
    },
  },
  {
    id: 'taksi',
    name: 'Таксистка',
    tag: 'Возит экипажем по 100. Единственная на районе с правами',
    rarity: 'обычная',
    home: 'atagi',
    where: 'Старые Атаги, стоянка такси',
    look: 'Тёмные волосы под чёрной кепкой, коричневая кожаная куртка, тёмные джинсы, солнечные очки, ключи от жёлтой Приоры на пальце',
    colors: { hair: '#1d1510', top: '#6b3f22', bottom: '#22283a', accent: '#f2c230' },
    quote: { t: 'Такси по 100. Экипажем' },
    buff: { key: 'speed', value: 0.1, dur: 60, text: 'Свои бегают на 10% быстрее 60 с' },
    lines: {
      spawn: [{ t: 'Такси по 100. Экипажем' }, { t: 'Кто в город?' }],
      picked: [
        { t: 'В тесноте, да не в обиде' },
        { t: 'Почему у таксиста режим вальгаллы включён???', who: 'Ислам' },
      ],
      lost: [{ t: 'Вызов в Шали' }, { t: 'Полный экипаж. Уехала' }],
      idle: [
        { t: 'Права есть. У меня одной' },
        { t: 'Пристегнись. Шучу, ремня нет' },
        { t: 'Камри без прав. А у неё права есть', who: 'Чимаев' },
      ],
    },
  },
  {
    id: 'marshrutka',
    name: 'Из 55-й маршрутки',
    tag: 'Всегда на переднем сиденье 55-й. Знает, когда она реально придёт',
    rarity: 'обычная',
    home: 'atagi',
    where: 'Остановка у молла, 55-я',
    look: 'Русая коса, длинный голубой пуховик, серые угги, наушники-капельки, проездной в руке',
    colors: { hair: '#a07a4a', top: '#7fb2e5', bottom: '#4a4f5a', accent: '#f0f0f0' },
    quote: { t: 'Передайте за проезд' },
    buff: { key: 'capture', value: 0.5, dur: 90, text: 'Свои берут сёла на 50% быстрее 90 с: она знает все остановки' },
    lines: {
      spawn: [
        { t: 'Передайте за проезд' },
        { t: 'Жду в 55-й маршрутке', who: 'Ислам' },
      ],
      picked: [
        { t: 'Подвинься, тут место есть' },
        { t: 'Пока черти ездят на единичках, 55 летит как птичка ☝🏿' },
      ],
      lost: [{ t: 'Моя остановка' }, { t: 'Последняя ушла. Я за ней' }],
      idle: [
        { t: 'Стоя еду. Опять' },
        { t: 'Я не хочу на маршрутках ехать. Это сколько ауры потеряется', who: 'Чимаев' },
        { t: 'Полчаса на автостанции газель ждал. Теперь стоя еду', who: 'Зураб' },
      ],
    },
  },
  {
    id: 'tiktok',
    name: 'Тиктокерша',
    tag: 'Снимает всё на кольцевую лампу. Даже соседская турель позирует',
    rarity: 'обычная',
    home: 'any',
    where: 'Где светло',
    look: 'Длинные светлые прямые волосы, розовый пуховик, белые широкие брюки, кольцевая лампа на штативе, телефон в розовом чехле',
    colors: { hair: '#e3c88f', top: '#f29bbf', bottom: '#f5f5f5', accent: '#ffffff' },
    quote: { t: 'Ещё дубль' },
    buff: { key: 'enemyTurret', value: 0.15, dur: 90, text: 'Турель соседей бьёт на 15% слабее 90 с: позирует в кадре' },
    lines: {
      spawn: [{ t: 'Не смотрите в камеру' }, { t: 'Свет хороший, снимаем' }],
      picked: [
        { t: 'Ещё дубль' },
        { t: 'Ты кто такой, чтобы такие фотолупы делать', who: 'Ислам' },
        { t: 'Ты кто такой, сука, чтобы такие фотолупы делать', who: 'Ислам', spicy: true },
      ],
      lost: [{ t: 'Лампа села' }, { t: 'Контент есть. Пока' }],
      idle: [
        { t: 'Это для рилса' },
        { t: 'Улыбнись, ты в сторис' },
        { t: 'Правило группы: ИИ-слоп с членами группы распространять запрещено', who: 'админ' },
      ],
    },
  },
  {
    id: 'klesh',
    name: 'Клешница',
    tag: 'В клеш рояле 7000 кубков. Зураб с ней не играет',
    rarity: 'редкая',
    home: 'kurchaloy',
    where: 'Курчалой, лавочка в центральном парке',
    look: 'Тёмные кудрявые волосы, синяя толстовка с золотой короной, широкие чёрные брюки, белые кроссовки, телефон горизонтально в обеих руках',
    colors: { hair: '#1f1510', top: '#2b4fa8', bottom: '#1a1a1a', accent: '#e8b923' },
    quote: { t: 'Кто на клеш? 1 на 1' },
    buff: { key: 'damage', value: 0.1, dur: 90, text: 'Свои бьют на 10% сильнее 90 с' },
    lines: {
      spawn: [
        { t: 'Кто на клеш? 1 на 1' },
        { t: 'В интернете смелый, в клеш рояль чё сделаешь' },
      ],
      picked: [
        { t: '7000 кубков. Можете не проверять' },
        { t: 'Король клещ рояльчика… уже не я', who: 'Зураб' },
      ],
      lost: [{ t: 'Сундук открылся. Пока' }, { t: 'Ивент начался' }],
      idle: [
        { t: 'Мейн хог? Предсказуемо' },
        { t: 'Узник 6000 кубков встретил 7000', who: 'Чимаев' },
        { t: 'Бля, 0:3. Опять', who: 'Зураб', spicy: true },
      ],
    },
  },
  {
    id: 'filfak',
    name: 'Филологиня',
    tag: 'Филфак ЧГУ. Исправляет «выйграю» прямо в чате',
    rarity: 'обычная',
    home: 'any',
    where: 'ЧГУ, филфак',
    look: 'Длинные каштановые волосы с ободком, бордовый кардиган, длинная серая юбка, стопка книг, красная ручка',
    colors: { hair: '#5b3b26', top: '#7a2236', bottom: '#8a8a8a', accent: '#c92a2a' },
    quote: { t: 'Не «выйграю», а «выиграю»' },
    buff: { key: 'enemyIncome', value: 0.15, dur: 60, text: 'Соседи 60 с получают на 15% меньше: переписывают объяснительные без ошибок' },
    lines: {
      spawn: [
        { t: 'Не «выйграю», а «выиграю»' },
        { t: 'Мне даже взнос не надо делать, потому что я выйграю', who: 'Амин' },
      ],
      picked: [
        { t: 'Запятую поставила' },
        { t: 'Чатгпт, добавь запятую', who: 'Амин' },
      ],
      lost: [{ t: 'У меня семинар' }, { t: 'Пошла проверять диктант' }],
      idle: [
        { t: '«Ихний» — нет такого слова' },
        { t: '«Ложить» удалите из чата' },
        { t: 'Сначала «здравствуйте», потом «скинь домашку»' },
      ],
    },
  },
  {
    id: 'otlichnitsa',
    name: 'Отличница',
    tag: 'Сдала все комиссионки с первого раза. Даже Вайнаг к ней не придирается',
    rarity: 'редкая',
    home: 'grozny',
    where: 'ГГНТУ, первая парта',
    look: 'Аккуратная тёмная коса, светло-голубая рубашка, тёмно-синий жилет, длинная тёмно-синяя юбка, зачётка в руке',
    colors: { hair: '#24180f', top: '#cfe0f2', bottom: '#1f2c4a', accent: '#2f6b3a' },
    quote: { t: 'Билеты все выучила' },
    buff: { key: 'abilityCd', value: 0.25, dur: 60, text: 'Способности наших героев перезаряжаются на 25% быстрее 60 с' },
    lines: {
      spawn: [{ t: 'Билеты все выучила' }, { t: 'Комиссионка? Я на пересдачи не хожу' }],
      picked: [
        { t: 'Шпору дам. Одну' },
        { t: 'Баля, никто комиссионку не сдал. Кроме неё', who: 'Ислам' },
      ],
      lost: [{ t: 'Мне на олимпиаду' }, { t: 'Консультация началась' }],
      idle: [
        { t: 'Пересдача? Не знаю такого' },
        { t: 'Зачётка — не украшение' },
        { t: 'ggntu was never designed for you to win', who: 'Амин' },
      ],
    },
  },
  {
    id: 'ignor',
    name: 'Игнорщица',
    tag: 'Читает и не отвечает. Даже на рейджбайт Амина',
    rarity: 'обычная',
    home: 'kurchaloy',
    where: 'Курчалой, центральный парк',
    look: 'Чёрные гладкие волосы, большие белые наушники, чёрная водолазка, длинное серое пальто, телефон экраном вниз',
    colors: { hair: '#0f0f0f', top: '#121212', bottom: '#7c7f85', accent: '#f2f2f2' },
    quote: { t: 'Прочитано' },
    buff: { key: 'tauntImmune', value: 1, dur: 60, text: 'Наши 60 с не ведутся на «Рейджбайт» Амина' },
    lines: {
      spawn: [{ t: 'Прочитано' }, { t: 'Не пиши мне' }],
      picked: [
        { t: 'Ок' },
        { t: 'Лс игнорщик', who: 'Чимаев' },
      ],
      lost: [{ t: 'Была в сети 5 минут назад' }, { t: '…' }],
      idle: [
        { t: 'Голосовые не слушаю' },
        { t: 'Кто это вообще?' },
        { t: 'Король рейджбайта нашёл королеву игнора', who: 'Зураб' },
      ],
    },
  },
  {
    id: 'vibe',
    name: 'Вайбкодерша',
    tag: 'У неё 3 лярда токенов в месяц. У Амина два',
    rarity: 'обычная',
    home: 'any',
    where: 'Кофейня с розетками',
    look: 'Фиолетовые волосы в два пучка, чёрное худи с белым логотипом, широкие брюки карго, ноутбук в наклейках, кружка с надписью «prod»',
    colors: { hair: '#7b4bb3', top: '#151515', bottom: '#5a5f4a', accent: '#ffffff' },
    quote: { t: 'Деплой в пятницу. Не бойтесь' },
    buff: { key: 'reveal', value: 1, dur: 60, text: '60 с видно, что покупают соседи: она подключилась к их чату' },
    lines: {
      spawn: [
        { t: 'У меня 3 лярда токенов' },
        { t: 'У меня 2 лярда токенов за месяц', who: 'Амин' },
      ],
      picked: [
        { t: 'Деплой в пятницу. Не бойтесь' },
        { t: 'Мфс потратят весь лимит на 200 $ клод ради этого', who: 'Амин' },
      ],
      lost: [{ t: 'Лимит кончился' }, { t: 'Контекст переполнен. Пока' }],
      idle: [
        { t: 'Стартап b2b SaaS с AI-чатботом. Свой' },
        { t: 'Надо отменять подписку, чтоб OpenAI обанкротился', who: 'Амин' },
        { t: 'С таким количеством мониторов ты Пентагон взламывать не собираешься?', who: 'Зураб' },
      ],
    },
  },
  {
    id: 'kachalka',
    name: 'С качалки',
    tag: 'Ходит в ту же качалку, что Зураб. Жмёт больше Чимаева',
    rarity: 'обычная',
    home: 'kurchaloy',
    where: 'Курчалой, качалка у стадиона',
    look: 'Высокий тёмный хвост, спортивный костюм цвета бургунди, белые кроссовки, шейкер с протеином, перчатки для зала',
    colors: { hair: '#21160f', top: '#7d2238', bottom: '#7d2238', accent: '#e0e0e0' },
    quote: { t: 'Сегодня ножки' },
    buff: { key: 'armor', value: 0.1, dur: 90, text: 'Свои получают на 10% меньше урона 90 с' },
    lines: {
      spawn: [{ t: 'Сегодня ножки' }, { t: 'Кто занял скамью?' }],
      picked: [
        { t: 'Креатин на всех' },
        { t: 'Даже тренер офигел', who: 'Зураб' },
      ],
      lost: [{ t: 'Тренировка' }, { t: 'Подход сам себя не сделает' }],
      idle: [
        { t: 'Мой рабочий вес больше твоего' },
        { t: 'Кто-то реально ходит в зал в 2к26?', who: 'Чимаев' },
        { t: 'Посоветуйте еду для набора массы, ребята, очень нужно!', who: 'Чимаев' },
      ],
    },
  },
  {
    id: 'podruga',
    name: 'Подруга A1',
    tag: 'Ходит за A1 и всё ей рассказывает. Голосует за двоих',
    rarity: 'обычная',
    home: 'atagi',
    where: 'Старые Атаги, у школы №1',
    look: 'Тёмно-русые волосы с заколкой, светло-розовое пальто, белый шарф, телефон на длинной цепочке',
    colors: { hair: '#6a4a2e', top: '#f3c6cf', bottom: '#f3c6cf', accent: '#ffffff' },
    quote: { t: 'Я всё расскажу A1' },
    buff: { key: 'vote', value: 1, dur: 120, text: '120 с голос того, кто её подцепил, на сходе считается за два' },
    lines: {
      spawn: [{ t: 'A1 не видели?' }, { t: 'Сход когда? Я голосую' }],
      picked: [
        { t: 'Я всё расскажу A1' },
        { t: 'Ислам, у нас утечка', who: 'Чимаев' },
      ],
      lost: [{ t: 'Пошла к A1' }, { t: 'Мне написали. Бегу' }],
      idle: [
        { t: 'Ислам опять на первую пару не пришёл?' },
        { t: 'Я никому. Только A1' },
        { t: 'Голос Амина всё решит', who: 'Зураб' },
      ],
    },
  },
];

export const GIRL_BY_ID: Record<string, Girl> = Object.fromEntries(GIRLS.map(g => [g.id, g]));

/** Upper bound for any one buff key (same units as GirlBuff.value). The sim clamps to these. */
export const GIRL_CAP: Partial<Record<GirlBuffKey, number>> = {
  speed: 0.15, damage: 0.15, armor: 0.15, heal: 0.25, income: 4, enemyIncome: 0.2, cost: 0.15,
  ownTurret: 0.25, enemyTurret: 0.2, capture: 0.5, slow: 0.35, abilityCd: 0.3, vote: 1, doner: 1,
  a1: 0.1, split: 0.25,
};

/**
 * Point keys (State.pts[i].key) where a girl of each home may appear. Keys that are not on the map
 * (the v4 Грозный spots 'ggntu' and 'chgu' before Грозный exists) are skipped. 'atagi' and
 * 'kurchaloy' list villages near that side, never the HQ points themselves.
 */
export const GIRL_SPOTS: Record<GirlHome, string[]> = {
  atagi: ['chechenaul', 'novatagi'],
  kurchaloy: ['tsotsi', 'avtury'],
  shali: ['shali'],
  grozny: ['doner', 'argun', 'ggntu', 'chgu'],
  any: ['chechenaul', 'novatagi', 'shali', 'avtury', 'tsotsi', 'argun', 'doner', 'ggntu', 'chgu'],
};

/**
 * Spawn and pickup rules. Seconds and world units; the sim converts to ticks (×TPS). Everything that
 * picks something uses the sim's own rng, so the run stays deterministic.
 */
export const GIRL_SPAWN = {
  /** First girl of a war at this second (world events start at 90 s, so she comes first). */
  first: 75,
  /** Next spawn after every[0] + floor(rng × (every[1] − every[0] + 1)) seconds. */
  every: [75, 120] as [number, number],
  /** At most this many on the map; a spawn that would exceed it is skipped (the timer still rolls). */
  max: 2,
  /** Seconds on the map before «ушла» (lines.lost). */
  stay: 60,
  /** Draw weight per rarity (weighted draw over GIRLS, see the next fields for exclusions). */
  weight: { 'обычная': 6, 'редкая': 3, 'легендарная': 2 } as Record<GirlRarity, number>,
  /** A girl may not be drawn again until this many other spawns happened (and never while on the map). */
  noRepeat: 3,
  /** At most this many legendary spawns per war (State.era); after that they get weight 0. */
  legendaryPerWar: 1,
  /** Spot: one of GIRL_SPOTS[home] by rng, offset this far in an rng direction, then the nearest
   *  passable cell (search outward in 0.5 steps up to 6). Skip a spot with a girl within `gap`. */
  offset: 3,
  gap: 10,
  /** Never closer than this to either HQ point (the HQ zone is 15). */
  hqMin: 18,
  /** Pickup: an own eligible unit within pickR of her fills the side's progress. */
  pickR: 2,
  /** Seconds of standing for an ordinary unit. Progress: +1 per tick per side, goal pickTime × TPS. */
  pickTime: 3,
  /** Heroes and bosses fill +heroRate per tick instead of +1 (1.5 s). Several units do not add up. */
  heroRate: 2,
  /** Both sides in range: both progresses freeze. Nobody of a side in range: its progress −decay per tick. */
  decay: 1,
  /** Unit keys that never pick her up: Баран / Камри, Голем, такси / маршрутка, Курица, Гелик. */
  noPick: ['fast', 'golem', 'ride', 'chicken', 'gelik'],
  /** An enemy Вайнаг within this of her freezes your progress: «спалит». */
  vainagR: 6,
  // Picker = the eligible unit of the winning side nearest to her (ties → lower unit id); she leaves
  // the map at once and the buff starts. Girls are not units: no hp, nobody targets them, they block
  // nothing and never move. A new war (State.era) clears girls on the map and running girl buffs.
  /** Speech bubble every this many seconds while she waits (lines.idle; the UI picks the line). */
  idleEvery: 15,
  /**
   * Collection credit: 'side' = every human player on the picking side gets her in their collection
   * (UI-side storage, per player, kept between wars and sessions). The collection is cosmetic only:
   * it never changes the sim, so shared games stay fair.
   */
  credit: 'side' as 'side' | 'picker',
};

/**
 * Suggested sim event for the renderer and the UI (add to FxEv). g = index into GIRLS.
 * spawn: she appeared at x,z next to pts[pt]; picked: side s got her, id = picker unit;
 * gone: «ушла»; special: her special fired (A1 near Ислам / rival, отмазка, ник спалили);
 * end: side s's buff from her ran out.
 */
export type GirlEv =
  | { e: 'girl'; k: 'spawn'; g: number; x: number; z: number; pt: number }
  | { e: 'girl'; k: 'picked'; g: number; s: 0 | 1; id: number; x: number; z: number }
  | { e: 'girl'; k: 'gone'; g: number; x: number; z: number }
  | { e: 'girl'; k: 'special'; g: number; s: 0 | 1; key: 'islam' | 'rival' | 'excuse' | 'spy' }
  | { e: 'girl'; k: 'end'; g: number; s: 0 | 1 };

/** Placeholders: {G} girl name, {U} unit name, {P} place name, {S} side name, {N}/{T} counts. */
export const COLLECTION_TEXT = {
  title: 'Знакомые с потока',
  titleSpicy: 'Грязнульки',
  button: 'Коллекция',
  subtitle: 'Кого встретили на карте. Видно только тебе',
  subtitleSpicy: 'Подцеплено за все войны. Видно только тебе',
  count: '{N} из {T}',
  empty: 'Пока никого. Готовим удочки',
  emptyHint: 'Подведи своего (не машину) к девушке на карте и постой рядом 3 секунды. Герои — быстрее',
  locked: '???',
  lockedHint: 'Ещё не встречали',
  rarity: { 'обычная': 'обычная', 'редкая': 'редкая', 'легендарная': 'легендарная' } as Record<GirlRarity, string>,
  /** Notebook inks: pencil, blue pen, red pen. */
  rarityInk: { 'обычная': '#6b6b6b', 'редкая': '#2b59c3', 'легендарная': '#c0392b' } as Record<GirlRarity, string>,
  where: 'Где встретить: {P}',
  buff: 'Бафф: ',
  /** Toasts. */
  spawn: '{G} на карте: {P}',
  spawnSpicy: 'Грязнулька на карте: {G}, {P}',
  picked: ['{U} подцепил: {G}', '{G} подцепила {U}'],
  pickedEnemy: 'Соседи подцепили: {G}',
  gone: '{G} ушла',
  goneSpicy: '{G} ушла. Удочки сматываем',
  buffEnd: '{G}: бафф кончился',
  newOne: 'Новая в коллекции!',
  dupe: 'Уже в коллекции. Бафф всё равно ваш',
  progress: 'Знакомимся… {N}%',
  progressSpicy: 'Подцепляем… {N}%',
  contested: 'Соседи тоже тут. Ждём',
  vainag: 'Вайнаг рядом — спалит',
  complete: 'Весь поток собран',
  completeSpicy: 'Все грязнульки собраны. Иди учись',
  help: [
    'Каждые 1–2 минуты у сёл, Донер Бея или Аргуна появляется девушка. Через минуту уходит',
    'Подведи своего (не машину) и постой рядом 3 секунды. Герои и босс — за полторы',
    'Если рядом обе стороны — никто не подцепит. Вражеский Вайнаг рядом тоже мешает',
    'Каждая даёт своей стороне короткий бафф. В коллекции остаётся навсегда, на игру не влияет',
  ],
};

// ---- Вайнаг ---------------------------------------------------------------------------------

export interface VainagLore {
  name: string;
  title: string;
  bio: string;
  look: string;
  colors: GirlColors;
  quote: Line;
  ability: {
    key: 'spalil';
    name: string;
    text: string;
    /** Enemies within r of him become «спалены». */
    r: number;
    /** «Спален»: takes ×(1 + dmgTaken) damage for dur seconds. */
    dmgTaken: number;
    dur: number;
    /** Seconds between casts; casts when ≥ min enemies are within r. */
    cd: number;
    min: number;
  };
  passive: {
    name: string;
    text: string;
    /** Enemies that can see him pick him first (Амин's «Рейджбайт» still wins). */
    focus: true;
    /** Own units within ownR of him deal ×(1 − ownDmg): стоять рядом с ним стыдно. */
    ownR: number;
    ownDmg: number;
  };
  lines: { spawn: Line[]; ability: Line[]; death: Line[]; kill: Line[]; idle: Line[]; girl: Line[] };
}

/** Выдуманный персонаж. Шутка только в том, что он всех сдаёт на комиссионках. Наёмник: его ненавидят обе стороны. */
export const VAINAG: VainagLore = {
  name: 'Вайнаг',
  title: 'палит всех на комиссионках',
  bio: 'Худой, весь в чёрном, с длинной бородой. На каждой комиссионке садится в первый ряд и сдаёт всех: у кого шпора, кто списал, кто вообще не тот, за кого себя выдаёт. Его ненавидят обе стороны, и он об этом знает.',
  look: 'Худой и сутулый, длинная тёмная борода, короткая стрижка; всё чёрное: рубашка, брюки, куртка, ботинки; чёрная сумка через плечо, в руке чёрный блокнот и ручка',
  colors: { hair: '#1a1a1a', top: '#111111', bottom: '#141414', accent: '#2a2a2a' },
  quote: { t: 'Я не стучу. Я информирую' },
  ability: {
    key: 'spalil',
    name: 'Спалил всех',
    text: 'Враги в радиусе 7 «спалены»: 8 с получают на 25% больше урона',
    r: 7, dmgTaken: 0.25, dur: 8, cd: 30, min: 2,
  },
  passive: {
    name: 'Его все ненавидят',
    text: 'Враги бьют сначала его. Свои рядом с ним бьют на 10% слабее',
    focus: true, ownR: 5, ownDmg: 0.1,
  },
  lines: {
    spawn: [
      { t: 'Я просто спросить' },
      { t: 'Можно я сяду в первый ряд?' },
      { t: 'Преподаватель вышел. Я всё запишу' },
      { t: 'Опять он', who: 'Чимаев' },
      { t: 'Вайнаг на районе. Шпоры в носки', who: 'админ' },
      { t: 'Бля, только не он', who: 'Ислам', spicy: true },
    ],
    ability: [
      { t: 'А у него шпора' },
      { t: 'Он списывает. И он. И вон тот' },
      { t: 'Это не Амин. Пусть паспорт покажет' },
      { t: 'Я не стучу. Я информирую' },
      { t: 'Записал. Отнесу в деканат' },
      { t: 'Математика комиссионка — самое страшное, что можно представить', who: 'Амин' },
      { t: 'Комиссионкш тахан ца мег (сегодня комиссионки нельзя)', who: 'Амин' },
      { t: 'Палит всех, сука', who: 'Зураб', spicy: true },
    ],
    death: [
      { t: 'Я всё равно всё записал' },
      { t: 'Деканат узнает' },
      { t: 'Вы меня не так поняли' },
      { t: 'Первый раз все рады', who: 'Ислам' },
      { t: 'Ни одна сторона не плачет', who: 'Чимаев' },
      { t: 'Наконец-то', who: 'админ' },
      { t: 'Нахуй его', who: 'Зураб', spicy: true },
    ],
    kill: [
      { t: 'Отчислен' },
      { t: 'Минус один на пересдаче' },
      { t: 'Я предупреждал. Письменно' },
      { t: 'Комиссия вас ждёт' },
      { t: 'Баля, никто комиссионку не сдал', who: 'Ислам' },
      { t: 'Он ещё и попадает', who: 'Амин' },
    ],
    idle: [
      { t: 'Кто сегодня без зачётки?' },
      { t: 'Я всё вижу. С первого ряда' },
      { t: 'Вайнаг комиссионку сдал?', who: 'Ислам' },
      { t: 'Вайнаг с утра пристёгнутый', who: 'Ислам' },
      { t: 'Цун оц сумки чохь х1уммаъ юй техь? (у него в этой сумке вообще что-то есть?)', who: 'Ислам' },
      { t: 'Приложение: насколько близко Вайнаг, в метрах. Стартап b2b SaaS', who: 'Амин' },
      { t: 'Физра, математика, малые предприятия, макро. 4 комиссионки', who: 'Зураб' },
      { t: 'Баля, са ёбанный 4 комиссионк ма йу (у меня ёбаных 4 комиссионки)', who: 'Зураб', spicy: true },
    ],
    // он рядом с девушкой и мешает её подцепить (GIRL_SPAWN.vainagR)
    girl: [
      { t: 'Я всё видел' },
      { t: 'Её отчислили бы, если что' },
      { t: 'Отойди от неё. Деканат узнает' },
      { t: 'Уйди отсюда', who: 'Зураб' },
      { t: 'Съебись, а', who: 'Ислам', spicy: true },
    ],
  },
};

// ---- helpers for the UI (never used by the sim) --------------------------------------------

export const girlName = (g: Girl, spicy: boolean): string => (spicy && g.spicyName) || g.name;
export const girlTag = (g: Girl, spicy: boolean): string => (spicy && g.spicyTag) || g.tag;
export const girlBuffText = (g: Girl, spicy: boolean): string => (spicy && g.buff.spicyText) || g.buff.text;
export const collectionTitle = (spicy: boolean): string => spicy ? COLLECTION_TEXT.titleSpicy : COLLECTION_TEXT.title;

/** Lines of one bucket for the current 18+ setting (empty if the bucket does not exist). */
export function girlLines(g: Girl, bucket: keyof GirlLines, spicy: boolean): Line[] {
  const all = g.lines[bucket] ?? [];
  return spicy ? all : all.filter(l => !l.spicy);
}
