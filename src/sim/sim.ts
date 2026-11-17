// Deterministic fixed-tick simulation. Only + - * / sqrt floor min max abs are used on
// numbers that feed back into state, so every browser replays the same war from the
// same command log.
import {
  UNITS, HQ, ECON, CARDS, VOTERS, Kind, Fx, BOSS_RANGE, BOSS_HP, BOSS_SPEED,
  MILITIA_EVERY, FIRST_VOTE, VOTE_EVERY, VOTE_LEN, WAR_RESET, BOSS_RESPAWN, type Side,
  BOSS, CHIMAEV, WOU, ADMIN, ERSNO, BEKHAN, ADAM, MOHMAD, GOLEM, RIDE, CHICKEN, HEROES,
  HERO, DONER, EVENTS, EVENT_FIRST, EVENT_EVERY, JAM_R, AI_W, unitName,
  GELIK, SPORTIK, AMINA, PLACE, BUFF, type Card,
} from './defs';
import { buildFlow, flowDir, type Flow } from './flow';
import { normAdm, ADM_MAX, type Adm } from './admin';
import { navIndex, passable, lcAt, LC, NAV, cellX, cellZ, type Terrain } from '../world/terrain';
import { CAPTURE_PLACES } from '../data/places';
import { BUILDINGS, BKEY, BASE } from './bdefs';
import {
  newBIdx, bldReindex, bldApply, bldStep, bldCleanup, bldIncome, bldPick, bldFront, bldMove, attackBld, bldProj, bldAoe, bldAi, bldAdmin,
  bldWarEnd, bldNewWar, bldEff, bldSafe, bldMark, ordBld, canBuild, canBuildType, canUp, canSell, canRep, canFire, bcost, buildZone, baseLevel, bldCaps,
  bldOn, bldAt, type B, type BIdx,
} from './bld';
export type { B } from './bld';

export interface U {
  id: number; s: Side; t: number; x: number; z: number; hp: number; mhp: number;
  cd: number; tg: number; g: number; rt: number; slow: number; stun: number;
  own: number; mv: number; ab: number; hit: number; born: number;
  psn: number; // poisoned until tick («я отравился», «Курение убивает»)
  tt: number; tn: number; // taunted until tick, by unit id (Амин «Рейджбайт»)
  ld: number; // link: Мохьмад ↔ его Голем
  f: number; // UF flags
  fr: number; // scared until tick (админ «Курение убивает»): runs from the pack, never attacks
  /** Player order (absent = auto: the unit picks its own goals). Only units canControl() may carry one. */
  o?: Ord;
}
/**
 * A player order on a unit (U.o). m: OM.*. Every field is a plain number (JSON-safe); the
 * possession fields exist only while m is OM.POSSESS.
 */
export interface Ord {
  m: number;
  /**
   * move / attackMove: this unit's own destination (its slot of the group's formation); hold: the spot it
   * guards; attack: where the target stood when the chase cell `c` was picked.
   */
  x: number; z: number;
  /**
   * move / attackMove: nav cell of the group's destination (the flow field it follows); attack: nav cell
   * of the chase flow (the target's spot x, z; re-picked once the target has moved away from it, see
   * CHASE_*); -1 otherwise / not picked yet.
   */
  c: number;
  /** attack: the target unit id; -1 otherwise. */
  tg: number;
  /** move / attackMove: ticks spent close to the destination or stuck; arrives after ORD_STUCK. */
  k: number;
  /** possessed: player number (Player.n) of whoever drives the unit. */
  p?: number;
  /** possessed: stick (ints −8..8), facing (ints −8..8, 0 0 = none yet), attack button 0|1, tick of the last 'ctl'. */
  dx?: number; dz?: number; fx?: number; fz?: number; a?: number; at?: number;
}
/** Order modes (Ord.m). Auto is no order at all. */
export const OM = { MOVE: 1, ATTACK: 2, AMOVE: 3, HOLD: 4, POSSESS: 5 } as const;
/** 'ord' modes as sent in commands. */
export type OrdMode = 'auto' | 'move' | 'attack' | 'attackMove' | 'hold' | 'possessed';
/** At most this many unit ids per 'ord' command (the UI splits a bigger selection, see Cmd 'ord' fi / fn). */
export const ORD_MAX = 64;
/** A possessed unit goes back to auto after this many ticks without a 'ctl' from its player (30 s). */
export const POSS_IDLE = 300;
/**
 * Shared war (st.mp): orders of a side are dropped (back to auto) when no human of that side has sent
 * anything for this long (3 min). A local game keeps them: the player there is the only one who orders.
 */
export const ORD_IDLE = 1800;
const ORD_STUCK = 40;
/** Formation spacing of a group move. */
const ORD_SP = 1.2;
/**
 * At most this many distinct flow fields steer player orders in one tick (the first ones met in unit
 * order; an order beyond them walks straight that tick), so a flood of destinations costs at most this
 * many builds per tick instead of one per unit.
 */
export const ORD_FLOWS = 24;
/**
 * Default size of the per-client flow-field cache (Sim.flowCap), well above ORD_FLOWS: a steady set of
 * more than ORD_FLOWS destinations (they take turns for the per-tick slots) is still built once instead
 * of evicting itself every tick. ~160 KB a field. The cache is not state: any size gives the same world.
 */
export const FLOW_CACHE = 80;
/** Attack orders: closer than this to the target, walk straight at it (no flow field). */
const CHASE_NEAR = 10;
/** …closer than this with a clear straight line to the target (sampled every unit), straight too. */
const CHASE_LINE = 25;
/** The chase cell (Ord.c) follows the target only once it has moved more than max(this, distance / 4) away from it. */
const CHASE_MOVE = 8;
/**
 * At most this many chase cells are (re)picked per tick, in unit order: 40 fresh attack orders cost a
 * few new fields a tick for a second instead of 24 at once (the rest walk straight, or on their old cell).
 */
const CHASE_PICKS = 4;
/** Unit flags (U.f). */
export const UF = { LAGMAN: 1, GONE: 2, UNLOADED: 4, FLEE: 8, ADM: 16 } as const; // ADM: removed by the admin (no bounty, no burst, no spill)
export interface P {
  x: number; z: number; tx: number; tz: number; tg: number; hq: number; s: Side;
  dmg: number; sp: number; slow: number; at: number; k: number; from: number;
  /** Aimed at this building id (absent for every other shot). */
  b?: number;
}
/**
 * kind: 0 high-rise (HQ), 1 village, 2 special point (Донер Бей), 3 «место» (capture place of a
 * side's village, pts[9..12]: `side` is the home side, `perk` what it gives its current owner).
 */
export interface Pt {
  key: string; name: string; x: number; z: number; r: number;
  kind: 0 | 1 | 2 | 3; side: -1 | 0 | 1; owner: -1 | 0 | 1; prog: number;
  perk?: 'sportiki' | 'gelik' | 'gym' | 'market';
}
export interface SideState {
  money: number; floors: number; hq: number; focus: number; focusUntil: number;
  spd: number; dmgB: number; inc: number; regen: number; cars: number; n: number; black: number;
  wins: number; boss: number; bossCd: number; lastHuman: number; aiNext: number;
  turretCd: number; found4: number; kills: number; deployed: number; income: number;
  /** By unit type: id of the living hero, -1 none, -2 away «на парах». */
  hero: number[];
  /** By unit type: tick when the hero may be bought again (0 = ready). */
  heroCd: number[];
  hack: number; // «Взломать Пентагон» on this side: turret off + income 0 until tick
  poor: number; // «Аура нищеты»: income ×0.5 until tick
  weak: number; // «Отмазки пошли»: this side deals −20% until tick
  sauce: number; sauceM: number; // фирменный соус: damage × sauceM until tick
  dodge: number; // «Шампунь +40 к удаче» until tick
  immune: number; // «Н ма дилита!»: immune to stun/slow/Н until tick
  skip: number; // 1 = next сход of this side is cancelled («четырёхдневка»)
  aiWant: number; aiWantUntil: number; // AI saving up for a hero/ride
  /** «Закинуть снюс» / «Энергетик»: buff until tick, then «отходняк» until snus + BUFF.offFor (0 = never). */
  snus: number;
  /** «Бамб LOOP» / «Двойной эспрессо»: stun-immune and +20% damage until tick. */
  loop: number;
  /** админ «Курение убивает» is ready at this tick (0 = ready). */
  pack: number;
  /** Мохьмад (type 9) may bring a new Голем at this tick (0 = ready); the old summoner 12 keeps using U.ab. */
  golem: number;
  /** Base buildings: discount until tick (the loser of the last war), ₽ paid for buildings lost this war, the AI's next build tick. */
  bdisc: number; blost: number; aiB: number;
}
export interface Vote {
  open: number; start: number; end: number; opts: number[]; focusPt: number;
  ballots: Record<string, number>; npc: number[]; npcAt: number[]; result: number; resultAt: number;
}
export interface Player { s: Side; cd: number; joined: number; last: number; n: number; /** build cooldown until tick (set by the first 'bld' command) */ bc?: number }
/** Delayed / pulsing area damage: Землетряс pulses, Голем and Курица death bursts. */
export interface Aoe { s: Side; x: number; z: number; r: number; dmg: number; hq: number; at: number; n: number; every: number; k: string }
/** Hero away «на парах» (world event 'classes'); returns at its own HQ. */
export interface Away { s: Side; t: number; hp: number; mhp: number; back: number; ld: number; f: number }
/** World events: `next` tick and the active ones as «until» ticks. */
export interface Ev { next: number; last: string; jam: number; black: number; sale: number; friday: number; flood: number }
/** админ «Курение убивает»: a cigarette pack lying at x,z from tick `at` until `until`; s = admin's side, id = admin. */
export interface Pack { s: Side; id: number; x: number; z: number; r: number; at: number; until: number }
/**
 * Admin toggles per side. Created by the first admin command that sets one (saves without admin
 * activity keep their old shape and hash). frz: units neither move nor attack; god: units and the
 * high-rise take no damage; ai: 0 auto, 1 always AI, 2 never AI.
 */
export interface AdmState { frz: [number, number]; god: [number, number]; ai: [number, number] }
export interface State {
  v: 1; tick: number; era: number; seed: number; rng: number; nextId: number;
  units: U[]; proj: P[]; pts: Pt[]; sides: [SideState, SideState]; votes: [Vote, Vote];
  nextVote: number; nextMilitia: number; winner: -1 | 0 | 1; overAt: number;
  players: Record<string, Player>; diff: number; humanSide: -1 | 0 | 1; mp: number;
  aoe: Aoe[]; away: Away[]; ev: Ev;
  packs: Pack[];
  /** Player-placed base buildings, in placement order (src/sim/bld.ts, docs/v5/BASE.md). */
  bld: B[];
  adm?: AdmState;
}

export type Cmd =
  | { t: number; id: string; p: string; k: 'join'; s: Side }
  | { t: number; id: string; p: string; k: 'dep'; s: Side; u: number; x: number; z: number }
  | { t: number; id: string; p: string; k: 'vote'; s: Side; o: number }
  | { t: number; id: string; p: string; k: 'cfg'; d: number; hs: -1 | 0 | 1; mp: number }
  /**
   * Order for own units (any player of side s may order the side's units). ids: ≤ ORD_MAX unit ids;
   * ids that are not alive, not of side s, not canControl() or possessed by another player are skipped.
   * m 'move' / 'attackMove': x, z the destination (snapped to the nearest passable spot); the units
   * take formation slots fi.. (default 0) of a formation of fn units (default ids.length) in ids order,
   * so a selection split over several commands keeps one formation. m 'attack': tg an enemy unit id.
   * m 'hold': stand and hit what comes in reach. m 'auto': back to picking goals. m 'possessed': the
   * first valid id becomes this player's possessed unit (driven by 'ctl'). Invalid commands do nothing.
   */
  | { t: number; id: string; p: string; k: 'ord'; s: Side; ids: number[]; m: OrdMode; x?: number; z?: number; tg?: number; fi?: number; fn?: number; /** m 'attack': an enemy building id instead of tg */ tb?: number }
  /**
   * Base buildings (docs/v5/BASE.md §9). op 'put': build type b at x, z (snapped to the nav cell), or a wall
   * line at `cells` (≤ BASE.line nav cells); 'up' / 'sell' / 'rep': building id n (rep with n 0: every damaged
   * one); 'fire': superweapon n at x, z. Refused commands emit 'deny' and change nothing.
   */
  | { t: number; id: string; p: string; k: 'bld'; s: Side; op: 'put' | 'up' | 'sell' | 'rep' | 'fire'; b?: number; x?: number; z?: number; n?: number; cells?: number[] }
  /**
   * Drive this player's possessed unit u (taking it first if it is free): dx, dz the stick (ints −8..8,
   * normalised; 0 0 stands), atk 0|1 the attack button, fx, fz the facing for «attack in front» (ints
   * −8..8, optional: defaults to the stick). rel: 1 lets go (the unit holds where it stands).
   * The unit id is `u` because `id` is the command id.
   */
  | { t: number; id: string; p: string; k: 'ctl'; s: Side; u: number; dx: number; dz: number; atk: number; fx?: number; fz?: number; rel?: 1 }
  /** Admin command (src/sim/admin.ts normAdm documents the fields per op). Shared war: only from the 'adm' channels. */
  | { t: number; id: string; p: string; k: 'adm'; op: string; s?: number; v?: number; n?: number; u?: number; x?: number; z?: number; r?: number; key?: string; txt?: string };

export type FxEv =
  | { e: 'spawn'; id: number; s: Side; t: number; x: number; z: number; own: number }
  | { e: 'hit'; x: number; z: number; s: Side; big: number }
  | { e: 'die'; x: number; z: number; s: Side; t: number }
  | { e: 'shot'; x: number; z: number; tx: number; tz: number; k: number; at: number; s: Side }
  | { e: 'floor'; s: Side; floors: number }
  | { e: 'floorUp'; s: Side; floors: number }
  | { e: 'capture'; p: number; s: number }
  | { e: 'vote'; s: Side }
  | { e: 'voteResult'; s: Side; card: number; title: string }
  | { e: 'boss'; s: Side }
  | { e: 'bossDown'; s: Side }
  | { e: 'ult'; s: Side; x: number; z: number; r: number }
  | { e: 'found4' }
  | { e: 'victory'; s: Side }
  | { e: 'newWar'; era: number }
  | { e: 'deny'; p: string; why: string }
  | { e: 'deployed'; p: string; s: Side; u: number }
  // ---- content update -------------------------------------------------------------
  /** A hero/summoner ability fired. key: quake | hack | n | lagman | golem | bolt. s = caster side. */
  | { e: 'ability'; s: Side; t: number; id: number; x: number; z: number; key: string; r: number }
  /** World event started. until = tick it ends (for 'cancel': tick the сход opens). */
  | { e: 'event'; key: string; title: string; quote: string; until: number }
  /** A ride (t=14) dropped n Пацаны at x,z. id = the ride. */
  | { e: 'unload'; s: Side; id: number; x: number; z: number; n: number }
  /** Summons appeared (t=13 Голем, t=15 Курица ×n) around x,z. */
  | { e: 'summon'; s: Side; t: number; x: number; z: number; n: number }
  | { e: 'heroDown'; s: Side; t: number }
  /** id = -1: the hero may be bought again; id > 0: came back from «пары» as unit id. */
  | { e: 'heroBack'; s: Side; t: number; id: number }
  /** «Шаурма в кляре из Фудзи»: n units of side s got poisoned (U.psn > tick). */
  | { e: 'poison'; s: Side; n: number }
  /** WOU «Рейджбайт» pulse: n enemies around x,z now target unit id. s = WOU's side. */
  | { e: 'taunt'; s: Side; id: number; x: number; z: number; r: number; n: number }
  /** «Взломать Пентагон»: s = hacker side, v = victim side (turret off, income 0 until). */
  | { e: 'hack'; s: Side; v: Side; id: number; x: number; z: number; until: number }
  /** админ «Н»: n enemies stunned in r around x,z. s = admin's side. */
  | { e: 'stunN'; s: Side; id: number; x: number; z: number; r: number; n: number }
  /** One pulse of area damage. key: quake | golem | chicken. s = side that deals it. */
  | { e: 'pulse'; s: Side; x: number; z: number; r: number; key: string }
  /** Unit left the field without dying (ride drove off, hero went «на пары»). */
  | { e: 'gone'; id: number; s: Side; t: number; x: number; z: number }
  /** Side s skipped its сход («Где наша обещанная четырёхдневка»). */
  | { e: 'voteSkip'; s: Side }
  /** A hit on side s was dodged («Шампунь +40 к удаче»). */
  | { e: 'dodge'; x: number; z: number; s: Side }
  // ---- v3 ------------------------------------------------------------------------------
  /** ersno moved n ₽ from side v's bank to side s. k: 'hit' (every melee hit) | 'card' («Списание с карты»). */
  | { e: 'steal'; s: Side; v: Side; id: number; x: number; z: number; n: number; k: 'hit' | 'card' }
  /** админ «Курение убивает»: a pack lies at x,z until tick; n enemies got scared on landing. s = admin's side. */
  | { e: 'pack'; s: Side; id: number; x: number; z: number; r: number; until: number; n: number }
  /** «Закинуть снюс» wore off for side s: «отходняк» (−20% speed) until tick. */
  | { e: 'comedown'; s: Side; until: number }
  // ---- admin ---------------------------------------------------------------------------
  /** Announcement from the admin: plain text, ≤ 140 characters, for everyone. */
  | { e: 'adminSay'; txt: string }
  /** An admin command took effect. s: side (-1 both / none), n: amount, count or index, v: value. */
  | { e: 'adm'; op: string; s: number; n: number; v: number }
  // ---- unit control ---------------------------------------------------------------------
  /** Player number n (Player.n) took (on 1) or let go of (on 0) unit id of type t, side s. */
  | { e: 'possess'; s: Side; id: number; t: number; n: number; on: 0 | 1 }
  // ---- base buildings (docs/v5/BASE.md §10) ----------------------------------------------
  /** k: put | done | up | sell | rep | die | seen | trap | hatch | charge | fire | stun | wave. id, s, t, lv: the building; n: ₽ or a count. */
  | { e: 'bld'; k: string; id: number; s: Side; t: number; x: number; z: number; lv: number; n: number }
  /** Building id of side s was hit. */
  | { e: 'bhit'; id: number; x: number; z: number; s: Side }
  /** «Тесла» id of side s: lightning through the points pts = [x, z, x, z, …] (the tower first). */
  | { e: 'zap'; s: Side; id: number; pts: number[] };

/** Unit types players may order and possess: not the boss, the rides or summons (Голем follows Мохьмад, Курицы are a swarm). */
export function canControl(t: number): boolean { return t !== BOSS && t !== RIDE && !UNITS[t]?.summon; }
/** Keys that read or write an object's prototype instead of an own property: never a player id. */
const PROTO_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype).concat('__proto__', 'prototype'));
/**
 * A player id as a command may carry it (Cmd.p, a key of State.players and Vote.ballots): 1..200
 * characters of the db path alphabet (letters, digits, _ - . ~ : @ +), never '.' / '..' and never a
 * prototype key ('__proto__', 'constructor', 'toString', …). Anything else is ignored by Sim.apply.
 */
export function okPid(p: unknown): p is string {
  return typeof p === 'string' && /^[A-Za-z0-9_.~:@+-]{1,200}$/.test(p) && p !== '.' && p !== '..' && !PROTO_KEYS.has(p);
}
/** An own property (Object.hasOwn without needing a 2022 browser). */
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A loaded order is well-formed (see Ord); anything else is dropped by Sim.load. */
function okOrd(u: U, cells: number): boolean {
  const o = u.o as unknown as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || Array.isArray(o) || !isInt(o.m, 1, 5) || !canControl(u.t)) return false;
  if (!isNum(o.x) || !isNum(o.z) || !isInt(o.c, -1, cells - 1) || !Number.isInteger(o.tg) || !isInt(o.k, 0, 1e6)) return false;
  if (o.m !== OM.POSSESS) return true;
  return Number.isInteger(o.p) && isInt(o.dx, -8, 8) && isInt(o.dz, -8, 8) && isInt(o.fx, -8, 8) && isInt(o.fz, -8, 8) && isInt(o.a, 0, 1) && Number.isInteger(o.at);
}

export const PT_ARGUN = 7;
export const PT_DONER = 8;
/** Capture places («место», kind 3): pts[9..12] in CAPTURE_PLACES order. */
export const PT_PLACE0 = 9;
export const PT_PLACES = [9, 10, 11, 12];
export const PT_COUNT = 13;

// ---- RNG (mulberry32, integer ops) -------------------------------------------
export function rnd(st: State): number {
  let a = (st.rng = (st.rng + 0x6d2b79f5) | 0);
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}
export function rint(st: State, n: number): number { return Math.floor(rnd(st) * n); }

const NT = UNITS.length;
/** Flow fields per terrain (read-only once built; the point layout never changes). */
const FLOWS = new WeakMap<Terrain, Flow[]>();
const filled = (v: number) => { const a: number[] = []; for (let i = 0; i < NT; i++) a.push(v); return a; };

export class Sim {
  st!: State;
  fx: FxEv[] = [];
  quiet = false;
  flows: Flow[] = [];
  private byId = new Map<number, U>();
  private head: Int32Array;
  private nxt = new Int32Array(4096);
  private hw: number; private hh: number;
  /** Hash rows north of z = 0 (the map's z0 / 4): row = floor(z / 4) + hz, so the old rows keep their maths. */
  private hz: number;
  private tmp = { x: 0, z: 0 };
  private sc = { dmg: 0, range: 0, spd: 0, cd: 0, d: UNITS[0] };
  private donerSpot: { x: number; z: number };
  /** Flow fields to the cells player orders go to: an LRU of at most flowCap, not part of the state (rebuilt identically anywhere). */
  private oflows = new Map<number, Flow>();
  flowCap = FLOW_CACHE;
  /** The flow fields orders may use this tick (prepFlows): chosen from the state alone, so the cache never changes what a unit does. */
  private tickFlow = new Map<number, Flow>();
  /** Flow fields built so far (cache misses), for tests and the perf overlay; not state. */
  flowBuilds = 0;
  /** Chase cells (re)picked so far this tick (prepFlows), at most CHASE_PICKS. */
  private picks = 0;
  /** Index of State.bld (ids, cells, per side and type): derived, rebuilt by reindex() — never state. */
  bi: BIdx;

  constructor(public terrain: Terrain) {
    this.hz = -terrain.z0 / 4;
    this.hw = Math.ceil(terrain.W / 4); this.hh = Math.ceil(terrain.H / 4) + this.hz;
    this.head = new Int32Array(this.hw * this.hh).fill(-1);
    this.donerSpot = this.findDoner();
    this.bi = newBIdx(terrain);
    // flow fields depend only on the terrain and the fixed point layout: build once per terrain, share read-only
    let flows = FLOWS.get(terrain);
    if (!flows) {
      flows = this.makePoints().map(p => buildFlow(terrain, p.x, p.z, p.kind === 0 ? 4 : Math.min(p.r, 6)));
      FLOWS.set(terrain, flows);
    }
    this.flows = flows;
  }

  /** Донер Бей: the passable built-up nav cell closest to (30, 12), Grozny's eastern edge. */
  private findDoner(): { x: number; z: number } {
    const T = this.terrain, X = 30, Z = 12;
    let best = { x: X, z: Z }, bd = Infinity;
    for (let j = -8; j <= 8; j++) for (let i = -8; i <= 8; i++) {
      const x = X + i * 0.5, z = Z + j * 0.5;
      if (!passable(T, x, z) || lcAt(T, x, z) !== LC.BUILT) continue;
      let ok = true;
      for (const [ox, oz] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) if (!passable(T, x + ox, z + oz)) ok = false;
      if (!ok) continue;
      const d = i * i + j * j;
      if (d < bd) { bd = d; best = { x, z }; }
    }
    return best;
  }

  makePoints(): Pt[] {
    const v = this.terrain.villages;
    const order = ['atagi', 'kurchaloy', 'novatagi', 'chechenaul', 'shali', 'avtury', 'tsotsi', 'argun'];
    const pts = order.map(k => {
      const g = v.find(q => q.key === k)!;
      const hqSide = k === 'atagi' ? 0 : k === 'kurchaloy' ? 1 : -1;
      return {
        key: k, name: g.name, x: g.x, z: g.z,
        r: hqSide >= 0 ? HQ.zone : Math.max(6, Math.min(10, g.r * 0.45)),
        kind: hqSide >= 0 ? 0 : 1, side: hqSide as -1 | 0 | 1, owner: hqSide as -1 | 0 | 1, prog: hqSide === 0 ? -100 : hqSide === 1 ? 100 : 0,
      } as Pt;
    });
    const d = this.donerSpot;
    pts.push({ key: 'doner', name: 'Донер Бей', x: d.x, z: d.z, r: DONER.r, kind: 2, side: -1, owner: -1, prog: 0 });
    // places: start owned by their home side, after Донер Бей so older indices stay put
    for (const c of CAPTURE_PLACES) {
      pts.push({ key: c.key, name: c.name, x: c.x, z: c.z, r: PLACE.r, kind: 3, side: c.side, owner: c.side, prog: c.side === 0 ? -100 : 100, perk: c.perk });
    }
    return pts;
  }

  freshSide(s: Side, wins = 0): SideState {
    return {
      money: ECON.start, floors: HQ.floors[s], hq: HQ.floors[s] * HQ.floorHp[s], focus: -1, focusUntil: 0,
      spd: 0, dmgB: 0, inc: 0, regen: 0, cars: 0, n: 0, black: 0, wins, boss: -1, bossCd: 0,
      lastHuman: -100000, aiNext: 30 + s * 7, turretCd: 0, found4: 0, kills: 0, deployed: 0, income: 0,
      hero: filled(-1), heroCd: filled(0),
      hack: 0, poor: 0, weak: 0, sauce: 0, sauceM: 1, dodge: 0, immune: 0, skip: 0, aiWant: -1, aiWantUntil: 0,
      snus: 0, loop: 0, pack: 0, golem: 0, bdisc: 0, blost: 0, aiB: 0,
    };
  }

  freshVote(): Vote {
    return { open: 0, start: 0, end: 0, opts: [], focusPt: -1, ballots: {}, npc: [], npcAt: [], result: -1, resultAt: -1 };
  }

  freshEv(tick: number): Ev {
    return { next: tick + EVENT_FIRST, last: '', jam: 0, black: 0, sale: 0, friday: 0, flood: 0 };
  }

  init(seed: number) {
    this.st = {
      v: 1, tick: 0, era: 1, seed, rng: seed | 0, nextId: 1, units: [], proj: [],
      pts: this.makePoints(), sides: [this.freshSide(0), this.freshSide(1)], votes: [this.freshVote(), this.freshVote()],
      nextVote: FIRST_VOTE, nextMilitia: 60, winner: -1, overAt: 0, players: {}, diff: 1, humanSide: -1, mp: 0,
      aoe: [], away: [], ev: this.freshEv(0), packs: [], bld: [],
    };
    this.reindex();
  }

  load(st: State) { this.st = st; this.migrate(); this.reindex(); }
  snapshot(): State { return structuredClone(this.st); }
  reindex() { this.byId.clear(); for (const u of this.st.units) this.byId.set(u.id, u); this.head.fill(-1); bldReindex(this); }
  unit(id: number) { return this.byId.get(id); }

  /**
   * Saves from before the content updates: fill in what is missing (same on every client).
   * v2 (d69dd41 and earlier) lacks packs, SideState snus/loop/pack, U.fr, unit types 16..17 in
   * hero/heroCd and the capture places pts[9..12] (they come back owned by their home side).
   * v3 saves from bfa230a have the places at the old hand-placed spots: they move to the
   * current CAPTURE_PLACES (owner and progress kept).
   */
  private migrate() {
    const st = this.st as State & Record<string, unknown>;
    if (!st.aoe) st.aoe = [];
    if (!st.away) st.away = [];
    if (!st.ev) st.ev = this.freshEv(st.tick);
    if (!st.packs) st.packs = [];
    if (!st.bld) st.bld = []; // saves from before the bases
    const full = this.makePoints();
    while (st.pts.length < full.length) st.pts.push(full[st.pts.length]);
    // capture places moved to real 2GIS spots: older saves get the new layout (the flow fields
    // follow makePoints), keeping who owns them and the capture progress
    for (const i of PT_PLACES) { const p = st.pts[i], f = full[i]; p.key = f.key; p.name = f.name; p.x = f.x; p.z = f.z; p.r = f.r; p.perk = f.perk; }
    for (const s of [0, 1] as Side[]) {
      const sd = st.sides[s] as unknown as Record<string, unknown>, fr = this.freshSide(s) as unknown as Record<string, unknown>;
      for (const k of Object.keys(fr)) if (sd[k] === undefined) sd[k] = fr[k];
      const h = st.sides[s].hero, hc = st.sides[s].heroCd;
      while (h.length < NT) h.push(-1);
      while (hc.length < NT) hc.push(0);
    }
    // pre-v3 (before bfa230a): units have no U.fr. Once filled in below, nothing here runs again for
    // this world, so the one-shot rescales cannot touch a v3+ state (a «Креатин»'d ersno has 525 hp)
    const oldSave = st.units.some(u => u.fr === undefined);
    const tank = (hp: number, mhp: number) => Math.max(1, Math.floor((hp * UNITS[ERSNO].hp) / mhp)); // pre-v3 tank ersno → the 420 hp thief
    for (const u of st.units) {
      if (u.psn === undefined) { u.psn = 0; u.tt = 0; u.tn = -1; u.ld = -1; u.f = 0; }
      if (oldSave && u.t === ERSNO && u.mhp > UNITS[ERSNO].hp) { u.hp = tank(u.hp, u.mhp); u.mhp = UNITS[ERSNO].hp; }
      if (u.fr === undefined) u.fr = 0;
      if (u.o !== undefined && !okOrd(u, this.terrain.nw * this.terrain.nh)) delete u.o; // a malformed order is dropped the same way everywhere
      else if (u.o && (u.o.m === OM.MOVE || u.o.m === OM.AMOVE) && u.o.c >= 0) {
        // v4 map: nav cells now count from the north edge z0 (−36), so a move order saved before the map
        // grew holds a cell −z0/NAV rows short (its centre ~36 north of the order's own spot). Re-anchor
        // it; a current order sits next to its cell, so this never touches one (idempotent).
        const T = this.terrain, c2 = u.o.c + (-T.z0 / NAV) * T.nw;
        if (c2 > u.o.c && c2 < T.nw * T.nh && Math.abs(cellZ(T, c2) - u.o.z) + 4 < Math.abs(cellZ(T, u.o.c) - u.o.z)) u.o.c = c2;
      }
    }
    if (oldSave) {
      for (const w of st.away) if (w.t === ERSNO && w.mhp > UNITS[ERSNO].hp) { w.hp = tank(w.hp, w.mhp); w.mhp = UNITS[ERSNO].hp; } // «на парах»
      for (const s of [0, 1] as Side[]) {
        const sd = st.sides[s];
        if (sd.hero[ADMIN] >= 0 && sd.pack === 0) sd.pack = st.tick + HERO.packFirst;
      }
    }
    // admin toggles: absent in saves without admin activity; anything malformed is repaired the same way everywhere
    if (st.adm !== undefined) {
      const a = st.adm as unknown as Record<string, unknown> | null;
      if (!a || typeof a !== 'object') delete st.adm;
      else {
        const pair = (v: unknown, max: number): [number, number] => {
          const q = Array.isArray(v) ? v : [];
          const f = (x: unknown) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= max ? (x as number) : 0);
          return [f(q[0]), f(q[1])];
        };
        st.adm = { frz: pair(a.frz, 1), god: pair(a.god, 1), ai: pair(a.ai, 2) };
      }
    }
  }

  private emit(e: FxEv) { if (!this.quiet) this.fx.push(e); }

  // ---- commands --------------------------------------------------------------
  apply(c: Cmd) {
    const st = this.st;
    if (c.k === 'adm') { const a = normAdm(c); if (a) this.admin(a); return; } // bypasses the player/side check only
    if (c.k === 'cfg') { st.diff = c.d; st.humanSide = c.hs; st.mp = c.mp; return; }
    // player ids index State.players and Vote.ballots: own keys only, never a prototype key
    if (!okPid(c.p)) return;
    if (c.k === 'join') {
      if (c.s !== 0 && c.s !== 1) return;
      const pl = own(st.players, c.p) ? st.players[c.p] : undefined;
      if (pl && pl.s !== c.s) this.release(pl.n, false); // changed sides: let go of the old side's unit
      if (pl) pl.s = c.s; else st.players[c.p] = { s: c.s, cd: 0, joined: st.tick, last: st.tick, n: Object.keys(st.players).length };
      st.sides[c.s].lastHuman = st.tick;
      return;
    }
    const pl = own(st.players, c.p) ? st.players[c.p] : undefined;
    if (!pl || pl.s !== c.s) return;
    pl.last = st.tick;
    st.sides[c.s].lastHuman = st.tick;
    if (st.winner !== -1) return;
    if (c.k === 'vote') {
      const v = st.votes[c.s];
      if (v.open && Number.isInteger(c.o) && c.o >= 0 && c.o < v.opts.length) v.ballots[c.p] = c.o;
      return;
    }
    if (c.k === 'ord') { this.order(c, pl); return; }
    if (c.k === 'ctl') { this.control(c, pl); return; }
    if (c.k === 'bld') { bldApply(this, c, pl); return; }
    if (c.k === 'dep') {
      const why = this.canDeploy(c.s, c.u, c.x, c.z, pl);
      if (why) { this.emit({ e: 'deny', p: c.p, why }); return; }
      st.sides[c.s].money -= this.cost(c.s, c.u);
      st.sides[c.s].deployed++;
      pl.cd = st.tick + ECON.deployCd;
      this.spawnGroup(c.s, c.u, c.x, c.z, pl.n);
      this.emit({ e: 'deployed', p: c.p, s: c.s, u: c.u });
    }
  }

  // ---- admin -------------------------------------------------------------------------
  /** Admin toggles, created on first use (see AdmState). */
  private admState(): AdmState {
    return (this.st.adm ??= { frz: [0, 0], god: [0, 0], ai: [0, 0] });
  }

  /** A passable spot near (x, z) on the map, or null: rings of 8 directions, deterministic. */
  private admSpot(x: number, z: number): { x: number; z: number } | null {
    const T = this.terrain;
    x = Math.max(1, Math.min(T.W - 1, x)); z = Math.max(T.z0 + 1, Math.min(T.H - 1, z));
    if (passable(T, x, z)) return { x, z };
    for (let r = 1; r <= 8; r++) {
      for (let k = 0; k < 8; k++) {
        const D = RING8[k], px = x + D[0] * r, pz = z + D[1] * r;
        if (px > 0 && pz > T.z0 && px < T.W && pz < T.H && passable(T, px, pz)) return { x: px, z: pz };
      }
    }
    return null;
  }

  /**
   * Applies a validated admin command (normAdm). It skips the player/side check of ordinary
   * commands and nothing else: caps, hero uniqueness, bounds and the war-over phase still hold.
   */
  private admin(a: Adm) {
    const st = this.st, now = st.tick;
    const fx = (n: number, v = 0) => this.emit({ e: 'adm', op: a.op, s: a.s, n, v });
    switch (a.op) {
      case 'money': case 'moneySet': {
        const sd = st.sides[a.s as Side];
        sd.money = Math.max(0, Math.min(ADM_MAX.bank, a.op === 'money' ? sd.money + a.v : a.v));
        fx(Math.round(sd.money), a.v);
        return;
      }
      case 'diff': st.diff = a.v; fx(0, a.v); return;
      case 'ai': this.admState().ai[a.s as Side] = a.v; fx(0, a.v); return;
      case 'freeze': this.admState().frz[a.s as Side] = a.v; fx(0, a.v); return;
      case 'god': this.admState().god[a.s as Side] = a.v; fx(0, a.v); return;
      case 'say': this.emit({ e: 'adminSay', txt: a.txt }); return;
      case 'score': st.sides[0].wins = 0; st.sides[1].wins = 0; fx(0); return;
      case 'newWar': this.newWar(); fx(st.era); return;
      case 'reset': {
        st.seed = a.v; st.rng = a.v | 0; st.era = 0;
        delete st.adm;
        st.bld = []; // a new world: no bases
        this.newWar(); // era → 1, fresh sides, points, timers; tick, ids and players carry on
        st.sides[0].wins = 0; st.sides[1].wins = 0;
        fx(st.era, a.v);
        return;
      }
      case 'heroCd': {
        let n = 0;
        for (const s of [0, 1] as Side[]) {
          if (a.s !== -1 && a.s !== s) continue;
          const sd = st.sides[s];
          for (const t of HEROES) if (sd.heroCd[t] > 0) { sd.heroCd[t] = 0; n++; this.emit({ e: 'heroBack', s, t, id: -1 }); }
          for (const u of st.units) if (u.s === s && u.hp > 0 && (u.t === BOSS || UNITS[u.t].hero)) { u.ab = 0; u.f &= ~UF.LAGMAN; }
          sd.pack = 0; sd.golem = 0;
        }
        fx(n);
        return;
      }
    }
    if (st.winner !== -1) return; // the rest acts on the field: nothing to do until the next war
    switch (a.op) {
      case 'spawn': {
        const s = a.s as Side, sd = st.sides[s], d = UNITS[a.u];
        let n = a.n;
        if (d.hero) {
          if (sd.hero[a.u] !== -1) return; // on the field or «на парах»: one per side
          n = 1; sd.heroCd[a.u] = 0;
        }
        n = Math.min(n, Math.floor((ECON.unitCap - this.count(s)) / (1 + (d.carry ? d.carry[s] : 0))));
        if (n <= 0) { fx(0, a.u); return; }
        const c = !Number.isNaN(a.x) ? this.admSpot(a.x, a.z) : this.hqSpot(s, 0);
        if (!c) return;
        for (let i = 0; i < n; i++) {
          let x = c.x, z = c.z;
          if (i > 0) {
            const ring = Math.floor((i - 1) / 8), D = RING8[(i - 1) % 8], R = 0.9 + ring * 0.9;
            const px = c.x + D[0] * R, pz = c.z + D[1] * R;
            if (passable(this.terrain, px, pz)) { x = px; z = pz; }
          }
          this.spawn(s, a.u, x, z, -1);
        }
        fx(n, a.u);
        return;
      }
      case 'boss': {
        const sd = st.sides[a.s as Side];
        if (sd.boss !== -1) return;
        sd.bossCd = 0;
        this.spawnBoss(a.s as Side);
        fx(1);
        return;
      }
      case 'kill': {
        const r2 = Number.isNaN(a.r) ? -1 : a.r * a.r;
        let n = 0;
        for (const u of st.units) {
          if (u.hp <= 0 || (a.s !== -1 && u.s !== a.s)) continue;
          if (r2 >= 0) { const dx = u.x - a.x, dz = u.z - a.z; if (dx * dx + dz * dz > r2) continue; }
          u.hp = 0; u.f |= UF.ADM; n++;
        }
        fx(n);
        return;
      }
      case 'heal': {
        let n = 0;
        for (const u of st.units) if (u.s === a.s && u.hp > 0) { u.hp = u.mhp; u.psn = 0; n++; }
        fx(n);
        return;
      }
      case 'floors': case 'repair': case 'found4': {
        const s = (a.op === 'found4' ? 0 : a.s) as Side, sd = st.sides[s], max = HQ.maxFloors[s];
        const before = sd.floors;
        const v = a.op === 'floors' ? Math.min(max, a.v) : a.op === 'found4' ? Math.min(max, Math.max(4, before)) : before;
        sd.floors = v; sd.hq = v * HQ.floorHp[s];
        if (v < before) this.emit({ e: 'floor', s, floors: v });
        else if (v > before) this.emit({ e: 'floorUp', s, floors: v });
        if (s === 0 && v >= 4 && !sd.found4) { sd.found4 = 1; this.emit({ e: 'found4' }); }
        if (v === 0) sd.bossCd = Math.max(sd.bossCd, now + 1); // the war ends this tick (cleanup), no boss for a gone high-rise
        fx(v, before);
        return;
      }
      case 'heroBack': {
        for (const w of st.away) w.back = now; // heroTimers() brings them back later in this step
        fx(st.away.length);
        return;
      }
      case 'owner': {
        const p = st.pts[a.n];
        if (!p || p.kind === 0) return;
        const prev = p.owner;
        p.owner = a.s; p.prog = a.s === 0 ? -100 : a.s === 1 ? 100 : 0;
        if (prev !== p.owner) {
          this.emit({ e: 'capture', p: a.n, s: p.owner });
          if (p.owner >= 0) for (const u of st.units) if (u.g === a.n) u.rt = 0;
        }
        fx(a.n);
        return;
      }
      case 'vote': {
        if (st.votes[a.s as Side].open) return;
        st.sides[a.s as Side].skip = 0;
        this.openVote(a.s as Side);
        fx(0);
        return;
      }
      case 'card': {
        const s = a.s as Side, c = CARDS[a.n];
        let fp = -1;
        if (c.fx === Fx.Focus) {
          const cand: number[] = [];
          st.pts.forEach((p, i) => { if (p.kind === 1 && p.owner !== s) cand.push(i); });
          if (cand.length) fp = cand[rint(st, cand.length)];
        }
        this.applyCard(s, c, fp);
        fx(c.id, fp);
        return;
      }
      case 'event': this.startEvent(a.key); fx(0); return;
      case 'bgive': case 'bkill': case 'bheal': fx(bldAdmin(this, a), a.u); return;
      case 'endEvents': {
        const ev = st.ev;
        ev.jam = ev.black = ev.sale = ev.friday = ev.flood = 0;
        for (const w of st.away) w.back = now;
        fx(0);
        return;
      }
      case 'win': {
        const l = (1 - a.s) as Side, ls = st.sides[l];
        ls.hq = 0;
        ls.bossCd = Math.max(ls.bossCd, now + 1);
        if (ls.floors > 0) { ls.floors = 0; this.emit({ e: 'floor', s: l, floors: 0 }); }
        fx(0); // cleanup() at the end of this step declares the winner: the normal victory → newWar flow
        return;
      }
    }
  }

  // ---- player orders (Cmd 'ord' / 'ctl') ----------------------------------------------------
  /** Unit id → the unit, when player pn of side s may order it now (alive, own, controllable, not driven by someone else). */
  private orderable(id: unknown, s: Side, pn: number): U | null {
    if (!Number.isInteger(id) || !Number.isInteger(pn)) return null; // pn: a malformed Player.n never drives a unit
    const u = this.byId.get(id as number);
    if (!u || u.hp <= 0 || u.s !== s || !canControl(u.t)) return null;
    if (u.o && u.o.m === OM.POSSESS && u.o.p !== pn) return null;
    return u;
  }

  private order(c: Extract<Cmd, { k: 'ord' }>, pl: Player) {
    const T = this.terrain;
    const ids = c.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > ORD_MAX) return;
    const list: U[] = [], slot: number[] = [], seen = new Set<number>();
    for (let i = 0; i < ids.length; i++) {
      const u = this.orderable(ids[i], c.s, pl.n);
      if (!u || seen.has(u.id)) continue;
      seen.add(u.id); list.push(u); slot.push(i);
    }
    if (!list.length) return;
    const mine = (u: U) => u.o !== undefined && u.o.m === OM.POSSESS; // orderable() already checked whose
    const set = (u: U, o: Ord) => { if (mine(u)) this.emit({ e: 'possess', s: u.s, id: u.id, t: u.t, n: pl.n, on: 0 }); u.o = o; };
    switch (c.m) {
      case 'auto':
        for (const u of list) { if (mine(u)) this.emit({ e: 'possess', s: u.s, id: u.id, t: u.t, n: pl.n, on: 0 }); delete u.o; u.rt = 0; }
        return;
      case 'hold':
        for (const u of list) set(u, { m: OM.HOLD, x: u.x, z: u.z, c: -1, tg: -1, k: 0 });
        return;
      case 'attack': {
        if (c.tb !== undefined) { // an enemy building: the units walk to it along a flow field to its cell and break it
          const b = ordBld(this, c.tb, c.s);
          if (!b) return;
          for (const u of list) { set(u, { m: OM.ATTACK, x: b.x, z: b.z, c: navIndex(T, b.x, b.z), tg: -10 - b.id, k: 0 }); u.tg = -10 - b.id; }
          return;
        }
        const t = Number.isInteger(c.tg) ? this.byId.get(c.tg as number) : undefined;
        if (!t || t.hp <= 0 || t.s === c.s) return;
        for (const u of list) {
          if (UNITS[u.t].bldg) { set(u, this.hqRun(u)); continue; } // «only buildings» (Чимаев): to the enemy high-rise instead
          set(u, { m: OM.ATTACK, x: t.x, z: t.z, c: -1, tg: t.id, k: 0 }); u.tg = t.id;
        }
        return;
      }
      case 'move': case 'attackMove': {
        if (!isNum(c.x) || !isNum(c.z) || c.x < 0 || c.z < T.z0 || c.x > T.W || c.z > T.H) return;
        const spot = this.admSpot(c.x, c.z);
        if (!spot) return;
        const cell = navIndex(T, spot.x, spot.z), m = c.m === 'move' ? OM.MOVE : OM.AMOVE;
        const fn = isInt(c.fn, 1, 1024) ? c.fn : ids.length, fi = isInt(c.fi, 0, 1023) ? c.fi : 0;
        const cols = Math.ceil(Math.sqrt(Math.max(fn, fi + ids.length))), rows = Math.ceil(Math.max(fn, fi + ids.length) / cols);
        for (let k = 0; k < list.length; k++) {
          const n = fi + slot[k], col = n % cols, row = Math.floor(n / cols);
          let x = spot.x + (col - (cols - 1) / 2) * ORD_SP, z = spot.z + (row - (rows - 1) / 2) * ORD_SP;
          if (!passable(T, x, z)) { x = spot.x; z = spot.z; }
          set(list[k], { m, x, z, c: cell, tg: -1, k: 0 });
          if (m === OM.MOVE) list[k].tg = -1;
        }
        return;
      }
      case 'possessed': this.possess(list[0], pl.n); return;
    }
  }

  private control(c: Extract<Cmd, { k: 'ctl' }>, pl: Player) {
    if (!isInt(c.dx, -8, 8) || !isInt(c.dz, -8, 8) || !isInt(c.atk, 0, 1)) return;
    if (c.rel !== undefined && c.rel !== 1) return;
    if ((c.fx !== undefined && !isInt(c.fx, -8, 8)) || (c.fz !== undefined && !isInt(c.fz, -8, 8)) || ((c.fx === undefined) !== (c.fz === undefined))) return;
    const u = this.orderable(c.u, c.s, pl.n);
    if (!u) return;
    const o0 = u.o;
    if (c.rel === 1) { // «Выйти»: the unit stays where it is
      if (o0 && o0.m === OM.POSSESS) { u.o = { m: OM.HOLD, x: u.x, z: u.z, c: -1, tg: -1, k: 0 }; this.emit({ e: 'possess', s: u.s, id: u.id, t: u.t, n: pl.n, on: 0 }); }
      return;
    }
    const o = o0 && o0.m === OM.POSSESS ? o0 : this.possess(u, pl.n);
    o.dx = c.dx; o.dz = c.dz; o.a = c.atk; o.at = this.st.tick;
    if (c.fx !== undefined && (c.fx || c.fz)) { o.fx = c.fx; o.fz = c.fz!; }
    else if (c.fx === undefined && (c.dx || c.dz)) { o.fx = c.dx; o.fz = c.dz; }
  }

  /** An attack-move to the enemy high-rise: what an attack order on a unit means for a «buildings only» unit (UnitDef.bldg). */
  private hqRun(u: U): Ord {
    const e = this.st.pts[1 - u.s], spot = this.admSpot(e.x, e.z) ?? { x: e.x, z: e.z };
    return { m: OM.AMOVE, x: spot.x, z: spot.z, c: navIndex(this.terrain, spot.x, spot.z), tg: -1, k: 0 };
  }

  /** Player pn drives u from now on; the unit that player drove before stays where it is. */
  private possess(u: U, pn: number): Ord {
    if (!Number.isInteger(pn)) return { m: OM.HOLD, x: u.x, z: u.z, c: -1, tg: -1, k: 0 }; // a throwaway, never stored (orderable() refuses such pn first)
    this.release(pn, true, u.id);
    if (u.o && u.o.m === OM.POSSESS) return u.o;
    const o: Ord = { m: OM.POSSESS, x: 0, z: 0, c: -1, tg: -1, k: 0, p: pn, dx: 0, dz: 0, fx: 0, fz: 0, a: 0, at: this.st.tick };
    u.o = o; u.tg = -1;
    this.emit({ e: 'possess', s: u.s, id: u.id, t: u.t, n: pn, on: 1 });
    return o;
  }

  /** Lets go of player pn's possessed unit(s) (except `keep`): hold where they stand, or auto. */
  private release(pn: number, hold: boolean, keep = -1) {
    for (const u of this.st.units) {
      const o = u.o;
      if (!o || o.m !== OM.POSSESS || o.p !== pn || u.id === keep || u.hp <= 0) continue;
      if (hold) u.o = { m: OM.HOLD, x: u.x, z: u.z, c: -1, tg: -1, k: 0 }; else { delete u.o; u.rt = 0; }
      this.emit({ e: 'possess', s: u.s, id: u.id, t: u.t, n: pn, on: 0 });
    }
  }

  /** Stale orders (every second): possessed units nobody drives go back to auto, and so (shared war) does a side nobody plays. */
  private ordIdle() {
    const st = this.st, now = st.tick;
    for (const u of st.units) {
      const o = u.o;
      if (!o || u.hp <= 0) continue;
      if (o.m === OM.POSSESS && now - o.at! > POSS_IDLE) { delete u.o; u.rt = 0; this.emit({ e: 'possess', s: u.s, id: u.id, t: u.t, n: o.p!, on: 0 }); continue; }
      if (st.mp && now - st.sides[u.s].lastHuman > ORD_IDLE) { delete u.o; u.rt = 0; } // shared war only: a local player's orders stay
    }
  }

  /** Flow field to nav cell `cell` (cached; any client rebuilds the identical field after an eviction). */
  private oflow(cell: number): Flow {
    const m = this.oflows;
    let f = m.get(cell);
    if (f) { m.delete(cell); m.set(cell, f); return f; }
    const T = this.terrain;
    f = buildFlow(T, cellX(T, cell), cellZ(T, cell), 0.5);
    this.flowBuilds++;
    m.set(cell, f);
    while (m.size > Math.max(1, this.flowCap)) m.delete(m.keys().next().value as number);
    return f;
  }

  /** Every point of the straight line from (x0, z0) to (x1, z1), one unit apart, is passable. */
  private clearLine(x0: number, z0: number, x1: number, z1: number): boolean {
    const T = this.terrain, dx = x1 - x0, dz = z1 - z0, n = Math.ceil(Math.sqrt(dx * dx + dz * dz));
    for (let i = 1; i < n; i++) if (!passable(T, x0 + (dx * i) / n, z0 + (dz * i) / n)) return false;
    return true;
  }

  /**
   * The chase flow of attack order o (before the units move): -1 = walk straight at the target (close,
   * or a clear line), else the nav cell Ord.c of the target's spot. That cell is kept while the target
   * stays within max(CHASE_MOVE, distance / 4) of it, so a moving target costs a new field only now and
   * then, not one per step. Writes o.c / o.x / o.z (state, from the state alone).
   */
  private chaseCell(u: U, o: Ord): number {
    if (o.tg <= -10) { // a building never moves: its cell was set with the order
      const dx = o.x - u.x, dz = o.z - u.z;
      return dx * dx + dz * dz < CHASE_NEAR * CHASE_NEAR ? -1 : o.c;
    }
    const t = this.byId.get(o.tg);
    if (!t || t.hp <= 0) return -1;
    const dx = t.x - u.x, dz = t.z - u.z, d2 = dx * dx + dz * dz;
    if (d2 < CHASE_NEAR * CHASE_NEAR) return -1;
    if (d2 < CHASE_LINE * CHASE_LINE && this.clearLine(u.x, u.z, t.x, t.z)) return -1;
    const mx = t.x - o.x, mz = t.z - o.z;
    if ((o.c < 0 || mx * mx + mz * mz > Math.max(CHASE_MOVE * CHASE_MOVE, d2 / 16)) && this.picks < CHASE_PICKS) {
      this.picks++;
      o.c = navIndex(this.terrain, t.x, t.z); o.x = t.x; o.z = t.z;
    }
    return o.c;
  }

  /** Before the units move: the flow fields orders use this tick, at most ORD_FLOWS, picked from the state in unit order. */
  private prepFlows() {
    const tf = this.tickFlow;
    tf.clear();
    this.picks = 0;
    for (const u of this.st.units) {
      const o = u.o;
      if (!o || u.hp <= 0) continue;
      let k = -1;
      if ((o.m === OM.MOVE || o.m === OM.AMOVE) && o.c >= 0) k = o.c;
      else if (o.m === OM.ATTACK && !this.taunter(u)) k = this.chaseCell(u, o); // taunted: chases the taunter instead
      if (k < 0 || tf.has(k) || tf.size >= ORD_FLOWS) continue;
      tf.set(k, this.oflow(k));
    }
  }

  private holdHere(u: U) { u.o = { m: OM.HOLD, x: u.x, z: u.z, c: -1, tg: -1, k: 0 }; }

  /** The living enemy that taunts u right now (Амин «Рейджбайт», Амина's aura: U.tt / U.tn), or null. Reads only. */
  private taunter(u: U): U | null {
    if (!(u.tt > this.st.tick)) return null;
    const w = this.byId.get(u.tn);
    return w && w.hp > 0 && w.s !== u.s ? w : null;
  }

  /** Target choice of an ordered unit (instead of the auto rules). */
  private ordTarget(u: U, o: Ord, S: { range: number; d: typeof UNITS[number] }) {
    const now = this.st.tick, d = S.d;
    if (o.m !== OM.POSSESS && u.tt > now) { // a taunt beats any order (the player who drives a unit is free)
      const w = this.taunter(u);
      if (w) { u.tg = w.id; return; }
      u.tt = 0; // the taunter is gone (as in acquire())
    }
    if (d.bldg && o.m === OM.ATTACK && o.tg > -10) { u.o = o = this.hqRun(u); } // «buildings only» never chases a unit (orders from older saves)
    switch (o.m) {
      case OM.MOVE: case OM.POSSESS: u.tg = -1; return;
      case OM.ATTACK: {
        if (o.tg <= -10) { if (ordBld(this, -o.tg - 10, u.s)) u.tg = o.tg; else { this.holdHere(u); u.tg = -1; } return; }
        const t = this.byId.get(o.tg);
        if (t && t.hp > 0 && t.s !== u.s) u.tg = t.id;
        else { this.holdHere(u); u.tg = -1; } // the target is gone: stand here
        return;
      }
    }
    // attackMove: what the auto rules would pick on the way; hold: only what is in reach
    const r = o.m === OM.AMOVE ? d.aggro : S.range + d.radius + 1.3;
    if (d.bldg) {
      const e = this.st.pts[1 - u.s], dx = e.x - u.x, dz = e.z - u.z, rr = r + HQ.radius[1 - u.s] + (o.m === OM.AMOVE ? 3 : 0);
      u.tg = bldPick(this, u, r, S.range, dx * dx + dz * dz <= rr * rr ? -2 : -1);
      return;
    }
    const tgU = u.tg >= 0 ? this.byId.get(u.tg) : undefined;
    if ((u.tg >= 0 && (!tgU || tgU.hp <= 0)) || (now + u.id) % 4 === 0) this.acquire(u, r);
  }

  /** Movement and attacks of an ordered unit. */
  private ordAct(u: U, o: Ord, S: { dmg: number; range: number; spd: number; cd: number; d: typeof UNITS[number] }) {
    if (o.m === OM.POSSESS) { this.possStep(u, o, S); return; }
    const st = this.st, d = S.d;
    // in reach of the target: hit it
    let tx = 0, tz = 0, has = false;
    if (u.tg >= 0) {
      const t = this.byId.get(u.tg);
      if (t && t.hp > 0) {
        tx = t.x; tz = t.z; has = true;
        const dx = t.x - u.x, dz = t.z - u.z, reach = S.range + d.radius + UNITS[t.t].radius;
        if (dx * dx + dz * dz <= reach * reach) { if (u.cd === 0) this.attack(u, t, S.dmg, S.cd); return; }
        if (t.id === u.tn && u.tt > st.tick) { // taunted (ordTarget): go for the taunter whatever the order, then carry on with it
          const l = Math.sqrt(dx * dx + dz * dz);
          if (l > 0.001) this.stepDir(u, dx / l, dz / l, S.spd);
          return;
        }
      } else u.tg = -1;
    } else if (u.tg === -2) {
      const e = st.pts[1 - u.s];
      tx = e.x; tz = e.z; has = true;
      const dx = e.x - u.x, dz = e.z - u.z, reach = S.range + HQ.radius[1 - u.s] + d.radius;
      if (dx * dx + dz * dz <= reach * reach) { if (u.cd === 0) this.attackHq(u, (1 - u.s) as Side, S.dmg, S.cd); return; }
    } else if (u.tg <= -10) {
      const b = this.bi.by.get(-u.tg - 10);
      if (b && b.hp > 0) {
        tx = b.x; tz = b.z; has = true;
        const dx = b.x - u.x, dz = b.z - u.z, reach = S.range + d.radius + BUILDINGS[b.t].r;
        if (dx * dx + dz * dz <= reach * reach) { if (u.cd === 0) attackBld(this, u, b, S.dmg, S.cd); return; }
      } else u.tg = -1;
    }
    switch (o.m) {
      case OM.HOLD: { // never chase: drift back to the guarded spot when pushed off it
        const dx = o.x - u.x, dz = o.z - u.z, d2 = dx * dx + dz * dz;
        if (d2 > 1) { const l = Math.sqrt(d2); this.stepDir(u, dx / l, dz / l, S.spd); }
        return;
      }
      case OM.ATTACK: {
        if (!has) return;
        const dx = tx - u.x, dz = tz - u.z, d2 = dx * dx + dz * dz;
        if (d2 < CHASE_NEAR * CHASE_NEAR) { const l = Math.sqrt(d2); if (l > 0.001) this.stepDir(u, dx / l, dz / l, S.spd); return; }
        // far: the chase flow (Ord.c, picked by prepFlows) when it is one of this tick's fields, else straight
        const f = o.c >= 0 ? this.tickFlow.get(o.c) : undefined;
        if (f && flowDir(this.terrain, f, u.x, u.z, this.tmp)) this.stepDir(u, this.tmp.x, this.tmp.z, S.spd);
        else { const l = Math.sqrt(d2); this.stepDir(u, dx / l, dz / l, S.spd); }
        return;
      }
      case OM.AMOVE:
        if (has) { // engaged on the way: chase like the auto rules, then go on
          const dx = tx - u.x, dz = tz - u.z, l = Math.sqrt(dx * dx + dz * dz);
          if (l > 0.001) this.stepDir(u, dx / l, dz / l, S.spd);
          return;
        }
        this.ordMove(u, o, S.spd);
        return;
      case OM.MOVE: this.ordMove(u, o, S.spd); return;
    }
  }

  /** Walk to the order's destination along its flow field; there (or crowded, or stuck) → hold. */
  private ordMove(u: U, o: Ord, spd: number) {
    const dx = o.x - u.x, dz = o.z - u.z, d2 = dx * dx + dz * dz;
    if (d2 < 0.36 || o.k > ORD_STUCK) { this.holdHere(u); return; }
    let dirx: number, dirz: number;
    if (d2 < 36) { const l = Math.sqrt(d2); dirx = dx / l; dirz = dz / l; }
    else if (o.c >= 0 && this.tickFlow.has(o.c) && flowDir(this.terrain, this.tickFlow.get(o.c)!, u.x, u.z, this.tmp)) { dirx = this.tmp.x; dirz = this.tmp.z; }
    else { const l = Math.sqrt(d2); dirx = dx / l; dirz = dz / l; }
    const x0 = u.x, z0 = u.z;
    this.stepDir(u, dirx, dirz, spd);
    const mx = u.x - x0, mz = u.z - z0;
    if (d2 < 16 || mx * mx + mz * mz < 1e-4) o.k++; else if (o.k) o.k = 0;
  }

  /** A possessed unit: the player's stick moves it at its own speed; the attack button hits the nearest enemy in front. */
  private possStep(u: U, o: Ord, S: { dmg: number; range: number; spd: number; cd: number; d: typeof UNITS[number] }) {
    const dx = o.dx!, dz = o.dz!;
    if (dx || dz) { const l = Math.sqrt(dx * dx + dz * dz); this.stepDir(u, dx / l, dz / l, S.spd); }
    u.tg = -1;
    if (!o.a || u.cd > 0) return;
    const st = this.st, us = st.units, d = S.d, fx = o.fx!, fz = o.fz!, fl = Math.sqrt(fx * fx + fz * fz);
    const r0 = S.range + d.radius + 0.5;
    let best = -1, bd = Infinity;
    if (!d.bldg) this.near(u.x, u.z, r0 + 1.4, k => { // «buildings only» (Чимаев) hits nothing but the high-rise
      const e = us[k];
      if (e.s === u.s || e.hp <= 0) return;
      const ex = e.x - u.x, ez = e.z - u.z, e2 = ex * ex + ez * ez, r = r0 + UNITS[e.t].radius;
      if (e2 > r * r || e2 >= bd) return;
      if (fl > 0 && ex * fx + ez * fz < 0.5 * Math.sqrt(e2) * fl) return; // within 60° of the facing
      bd = e2; best = k;
    });
    if (best >= 0) { const t = us[best]; u.tg = t.id; this.attack(u, t, S.dmg, S.cd); return; }
    const pb = this.bi.side[1 - u.s].length ? bldFront(this, u, r0, fx, fz, fl) : null;
    if (pb) { u.tg = -10 - pb.id; attackBld(this, u, pb, S.dmg, S.cd); return; }
    const v = (1 - u.s) as Side, e = st.pts[v], ex = e.x - u.x, ez = e.z - u.z, e2 = ex * ex + ez * ez, r = r0 + HQ.radius[v];
    if (e2 <= r * r && (fl === 0 || ex * fx + ez * fz >= 0.5 * Math.sqrt(e2) * fl)) { u.tg = -2; this.attackHq(u, v, S.dmg, S.cd); }
  }

  inZone(s: Side, x: number, z: number): boolean {
    for (const p of this.st.pts) {
      if (p.owner !== s) continue;
      if (p.kind === 3 && p.side !== s) continue; // a captured enemy place is no bridgehead next to their high-rise
      const r = p.kind === 0 ? HQ.zone : p.r;
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz <= r * r) return true;
    }
    return false;
  }

  /** Current price (world event «Пятница: штурм такси» halves the Атаги taxi; the car wash place makes the Гелик −30%). */
  cost(s: Side, t: number): number {
    let c = UNITS[t].cost[s];
    if (UNITS[t].kind === Kind.Fast) { const g = bldEff(this, s, BKEY.garazh); if (g) c = Math.floor(c * g); } // «Гараж»
    if (t === GELIK && this.ownsPerk(s, 'gelik')) return Math.floor(c * PLACE.gelikDisc);
    return t === RIDE && s === 0 && this.st.ev.friday > this.st.tick ? Math.floor(c / 2) : c;
  }

  /** Side s owns a capture place with this perk right now. */
  ownsPerk(s: Side, perk: Pt['perk']): boolean {
    const pts = this.st.pts;
    for (let i = PT_PLACE0; i < pts.length; i++) if (pts[i].perk === perk && pts[i].owner === s) return true;
    return false;
  }

  /** Living units of type t on side s. */
  countType(s: Side, t: number): number { let n = 0; for (const u of this.st.units) if (u.s === s && u.t === t && u.hp > 0) n++; return n; }

  /** For the buy panel: -1 hero on the field, -2 away «на парах», else seconds until it may be bought (0 = ready). */
  heroWait(s: Side, t: number): number {
    const sd = this.st.sides[s];
    if (!UNITS[t].hero) return 0;
    if (sd.hero[t] >= 0) return -1;
    if (sd.hero[t] === -2) return -2;
    return Math.max(0, Math.floor((sd.heroCd[t] - this.st.tick + 9) / 10));
  }

  canDeploy(s: Side, u: number, x: number, z: number, pl?: Player): string {
    const st = this.st, sd = st.sides[s];
    if (!Number.isInteger(u) || u < 0 || u >= NT) return 'Нет такого юнита';
    const d = UNITS[u];
    if (u === BOSS) return 'Босс приходит сам';
    if (d.summon) return u === GOLEM ? 'Голем приходит только с Мохьмадом' : 'Только через чикенган';
    if (!d.avail[s]) return 'Это не наш пацан';
    if (pl && pl.cd > st.tick) return 'Не так быстро';
    if (d.hero) {
      if (sd.hero[u] >= 0) return `${unitName(s, u)} уже на поле`;
      if (sd.hero[u] === -2) return 'На парах. Завтра учимся';
      if (sd.heroCd[u] > st.tick) return 'Ещё не вернулся';
    }
    if (d.max && this.countType(s, u) >= d.max) return u === GELIK ? 'Два гелика уже на районе' : 'Больше нельзя';
    if (sd.money < this.cost(s, u)) return 'Голда не на балике';
    if (this.count(s) + d.count + (d.carry ? d.carry[s] : 0) > ECON.unitCap) return 'В селе больше нет пацанов';
    if (!this.inZone(s, x, z)) return 'Ставь возле своего села';
    if (!passable(this.terrain, x, z)) return 'Туда не пройти';
    return '';
  }

  count(s: Side) { let n = 0; for (const u of this.st.units) if (u.s === s) n++; return n; }

  // ---- base buildings: queries for the UI, the AI and tests (src/sim/bld.ts; all pure) -----------------
  /** null when side s may build type t at (x, z) now, else a clean Russian reason. Never writes: call it every frame for the ghost. */
  canBuild(s: Side, t: number, x: number, z: number, pl?: Player): string | null { return canBuild(this, s, t, x, z, pl); }
  /** The same without a spot: may side s build type t at all now (tier, caps, money, cooldown)? For the build menu. */
  canBuildType(s: Side, t: number, pl?: Player): string | null { return canBuildType(this, s, t, pl); }
  canUp(s: Side, id: number, pl?: Player): string | null { return canUp(this, s, id, pl); }
  canSell(s: Side, id: number, pl?: Player): string | null { return canSell(this, s, id, pl); }
  canRep(s: Side, id: number, pl?: Player): string | null { return canRep(this, s, id, pl); }
  canFire(s: Side, id: number, x: number, z: number, pl?: Player): string | null { return canFire(this, s, id, x, z, pl); }
  /** Current price of level lv (1..3) of building type t. */
  bcost(s: Side, t: number, lv = 1): number { return bcost(this, s, t, lv); }
  buildZone(s: Side) { return buildZone(this, s); }
  baseLevel(s: Side): number { return baseLevel(this, s); }
  bldCaps(s: Side) { return bldCaps(this, s); }
  bldCount(s: Side, t: number): number { return this.bi.ty[s][t]?.length ?? 0; }
  building(id: number): B | undefined { return this.bi.by.get(id); }
  bldAt(x: number, z: number): B | undefined { return bldAt(this, x, z); }
  /** The building works right now (finished, powered, not frozen). */
  bldOn(b: B): boolean { return bldOn(this, b); }
  /** «Камера»: damage multiplier on u right now (> 1 = marked). */
  marked(u: U): number { return bldMark(this, u); }

  spawnGroup(s: Side, t: number, x: number, z: number, own: number) {
    const d = UNITS[t];
    for (let i = 0; i < d.count; i++) {
      const ox = d.count > 1 ? (i - 1) * 0.9 : 0, oz = d.count > 1 ? (i % 2) * 0.7 : 0;
      const px = passable(this.terrain, x + ox, z + oz) ? x + ox : x;
      const pz = passable(this.terrain, x + ox, z + oz) ? z + oz : z;
      this.spawn(s, t, px, pz, own);
    }
  }

  spawn(s: Side, t: number, x: number, z: number, own: number): U {
    const st = this.st;
    const d = UNITS[t];
    let hp = t === BOSS ? BOSS_HP[s] : d.hp;
    if ((t === 1 || t === SPORTIK) && this.ownsPerk(s, 'gym')) hp = Math.floor(hp * PLACE.gymHp); // качалка
    if (t !== BOSS && !d.summon) { const k = bldEff(this, s, BKEY.kachalka); if (k) hp = Math.floor(hp * k); } // «Качалка» on the base
    const u: U = {
      id: st.nextId++, s, t, x, z, hp, mhp: hp, cd: 0, tg: -1, g: -1, rt: 0, slow: 0, stun: 0,
      own, mv: 0, ab: t === MOHMAD ? 1 : 60, hit: 99, born: st.tick, psn: 0, tt: 0, tn: -1, ld: -1, f: 0, fr: 0,
    };
    st.units.push(u);
    this.byId.set(u.id, u);
    if (d.hero) st.sides[s].hero[t] = u.id;
    if (t === ADMIN) st.sides[s].pack = Math.max(st.sides[s].pack, st.tick + HERO.packFirst);
    this.emit({ e: 'spawn', id: u.id, s, t, x, z, own });
    return u;
  }

  /** A spot next to the own high-rise, k-th of a ring (for free units from cards and returns). */
  private hqSpot(s: Side, k: number): { x: number; z: number } {
    const p = this.st.pts[s], dir = s === 0 ? 1 : -1;
    const R = 4 + Math.floor(k / 6) * 1.2;
    const D = DIRS[(k + (s === 0 ? 0 : 3)) % 6];
    let x = p.x + D[0] * R, z = p.z + D[1] * R;
    if (passable(this.terrain, x, z)) return { x, z };
    x = p.x + dir * 4; z = p.z + 1;
    if (passable(this.terrain, x, z)) return { x, z };
    return { x: p.x, z: p.z + 4 };
  }

  // ---- main step ---------------------------------------------------------------
  step(cmds: Cmd[] | undefined) {
    const st = this.st;
    if (cmds) for (const c of cmds) this.apply(c);
    if (st.winner !== -1) {
      if (st.tick - st.overAt >= WAR_RESET) this.newWar();
      st.tick++;
      return;
    }
    if (st.tick % 10 === 0) this.economy();
    if (st.tick >= st.nextMilitia) { this.militia(); st.nextMilitia = st.tick + MILITIA_EVERY; }
    this.votes();
    this.worldEvents();
    this.heroTimers();
    if (st.tick % PLACE.sportikiEvery === PLACE.sportikiAt) this.placeSquads();
    this.ai(0); this.ai(1);
    this.hash();
    if (st.tick % 10 === 5) this.ordIdle();
    if (st.tick % 10 === 0) this.donerHeal();
    this.units();
    this.aoes();
    this.packs();
    this.projectiles();
    this.turrets();
    bldStep(this);
    if (st.tick % 5 === 0) this.capture();
    this.cleanup();
    this.bosses();
    st.tick++;
  }

  private income(s: Side): number {
    const st = this.st, sd = st.sides[s], now = st.tick;
    let owned = 0, shali = 0;
    for (const p of st.pts) if (p.kind === 1 && p.owner === s) { owned++; if (p.key === 'shali') shali = 1; }
    let inc = ECON.base + ECON.perVillage * owned + ECON.shaliBonus * shali + ECON.perFloor * sd.floors;
    if (st.pts[PT_DONER].owner === s) inc += DONER.income * (st.ev.sale > now ? 2 : 1);
    if (this.ownsPerk(s, 'market')) inc += PLACE.market;
    if (sd.hero[WOU] >= 0) inc += HERO.wouIncome;
    if (this.bi.side[s].length) inc += bldIncome(this, s);
    if (sd.inc > now) inc *= 1.5;
    if (sd.poor > now) inc *= 0.5;
    if (sd.black > now || sd.hack > now || st.ev.black > now) inc = 0;
    const aiSide = st.mp ? 0 : (st.humanSide !== -1 && st.humanSide !== s ? 1 : 0);
    if (aiSide) inc *= [0.7, 1.0, 1.3][st.diff] ?? 1;
    return inc;
  }

  private economy() {
    for (const s of [0, 1] as Side[]) {
      const inc = this.income(s);
      this.st.sides[s].income = inc;
      this.st.sides[s].money += inc;
    }
  }

  /** Донер Бей: the owner's units nearby heal every second. Runs after hash(). */
  private donerHeal() {
    const st = this.st, p = st.pts[PT_DONER], us = st.units;
    if (p.owner < 0) return;
    const h = DONER.heal * (st.ev.sale > st.tick ? 2 : 1), R = DONER.healR;
    this.near(p.x, p.z, R, k => {
      const o = us[k];
      if (o.s !== p.owner || o.hp <= 0) return;
      const dx = o.x - p.x, dz = o.z - p.z;
      if (dx * dx + dz * dz <= R * R) o.hp = Math.min(o.mhp, o.hp + o.mhp * h);
    });
  }

  private militia() {
    const st = this.st;
    for (const s of [0, 1] as Side[]) {
      if (this.count(s) > ECON.unitCap - 6) continue;
      for (const p of st.pts) {
        if (p.owner !== s || p.kind === 3) continue; // places bring спортики instead (placeSquads)
        const n = p.kind === 0 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const a = rnd(st) * 6.283185307179586;
          // cheap deterministic direction without trig: use rotation table
          const ix = Math.floor(a) % 6;
          const x = p.x + DIRS[ix][0] * 2.5 + (rnd(st) - 0.5), z = p.z + DIRS[ix][1] * 2.5 + (rnd(st) - 0.5);
          if (passable(this.terrain, x, z)) this.spawn(s, 0, x, z, -1);
        }
      }
    }
  }

  /** Place perk 'sportiki': its owner gets a free squad of спортики there every PLACE.sportikiEvery ticks. */
  private placeSquads() {
    const st = this.st, pts = st.pts, n = UNITS[SPORTIK].count;
    for (let i = PT_PLACE0; i < pts.length; i++) {
      const p = pts[i];
      if (p.perk !== 'sportiki' || p.owner < 0) continue;
      const s = p.owner as Side;
      if (this.count(s) + n > ECON.unitCap) continue;
      this.spawnGroup(s, SPORTIK, p.x, p.z, -1);
      this.emit({ e: 'summon', s, t: SPORTIK, x: p.x, z: p.z, n });
    }
  }

  // ---- Сход ----------------------------------------------------------------------
  private votes() {
    const st = this.st;
    if (st.tick === st.nextVote) {
      for (const s of [0, 1] as Side[]) if (!st.votes[s].open) this.openVote(s); // an admin may have opened one already
    }
    for (const s of [0, 1] as Side[]) {
      const v = st.votes[s];
      if (!v.open) continue;
      if (st.tick >= v.end) this.closeVote(s);
    }
    if (st.tick > st.nextVote + VOTE_LEN) st.nextVote += VOTE_EVERY;
  }

  private hasAbility(s: Side): boolean {
    for (const u of this.st.units) if (u.s === s && u.hp > 0 && (u.t === BOSS || UNITS[u.t].abCd || u.t === BEKHAN)) return true;
    return false;
  }

  private openVote(s: Side) {
    const st = this.st, sd = st.sides[s], en = st.sides[(1 - s) as Side];
    if (sd.skip) { // «Где наша обещанная четырёхдневка»: this сход is off; result -2 marks it for the HUD until `end`
      sd.skip = 0;
      st.votes[s] = { ...this.freshVote(), start: st.tick, end: st.tick + VOTE_LEN, result: -2, resultAt: st.tick };
      this.emit({ e: 'voteSkip', s });
      return;
    }
    const doner = st.pts[PT_DONER].owner;
    const pool = CARDS.filter(c => (c.side === -1 || c.side === s)
      && !(c.fx === Fx.Floor && sd.floors >= HQ.maxFloors[s])
      && !(c.fx === Fx.Boss && sd.boss !== -1)
      && !(c.fx === Fx.Focus && !st.pts.some(p => p.kind === 1 && p.owner !== s))
      && !(c.fx === Fx.FocusDoner && doner === s)
      && !(c.fx === Fx.Ersno && sd.hero[ERSNO] !== -1)
      && !(c.fx === Fx.Ult && !this.hasAbility(s))
      && !(c.fx === Fx.SkipVote && en.skip)
      && !(c.fx === Fx.Geliks && this.countType(s, GELIK) >= UNITS[GELIK].max!));
    const opts: number[] = [];
    while (opts.length < 3 && pool.length) { // weighted draw without replacement (Card.w, default 2)
      let tot = 0;
      for (const c of pool) tot += c.w ?? 2;
      let r = rint(st, tot), i = 0;
      while (r >= (pool[i].w ?? 2)) { r -= pool[i].w ?? 2; i++; }
      opts.push(pool[i].id); pool.splice(i, 1);
    }
    let focusPt = -1;
    if (opts.some(o => CARDS[o].fx === Fx.Focus)) {
      const cand = st.pts.map((p, i) => i).filter(i => st.pts[i].kind === 1 && st.pts[i].owner !== s);
      focusPt = cand[rint(st, cand.length)];
    }
    const npc: number[] = [], npcAt: number[] = [];
    for (let i = 0; i < VOTERS[s].length; i++) {
      npc.push(rint(st, opts.length));
      npcAt.push(st.tick + 25 + rint(st, VOTE_LEN - 60));
    }
    st.votes[s] = { open: 1, start: st.tick, end: st.tick + VOTE_LEN, opts, focusPt, ballots: {}, npc, npcAt, result: -1, resultAt: -1 };
    this.emit({ e: 'vote', s });
  }

  tally(s: Side): number[] {
    const st = this.st, v = st.votes[s];
    const t = v.opts.map(() => 0);
    for (let i = 0; i < v.npc.length; i++) if (v.npcAt[i] <= st.tick) t[v.npc[i]] += 1;
    for (const k of Object.keys(v.ballots).sort()) t[v.ballots[k]] += 2;
    return t;
  }

  private closeVote(s: Side) {
    const st = this.st, v = st.votes[s];
    const t = this.tally(s);
    let best = 0;
    for (let i = 1; i < t.length; i++) if (t[i] > t[best]) best = i;
    const ties = t.map((n, i) => (n === t[best] ? i : -1)).filter(i => i >= 0);
    if (ties.length > 1) best = ties[rint(st, ties.length)];
    v.open = 0; v.result = best; v.resultAt = st.tick;
    const card = CARDS[v.opts[best]];
    this.applyCard(s, card, v.focusPt);
    this.emit({ e: 'voteResult', s, card: card.id, title: cardTitle(card, v.focusPt >= 0 ? st.pts[v.focusPt].name : '') });
  }

  private applyCard(s: Side, c: Card, focusPt: number) {
    const st = this.st, sd = st.sides[s], en = st.sides[(1 - s) as Side], now = st.tick;
    switch (c.fx) {
      case Fx.Money: sd.money += c.v; break;
      case Fx.Floor:
        if (sd.floors < HQ.maxFloors[s]) {
          sd.floors++; sd.hq = Math.min(sd.hq + HQ.floorHp[s], sd.floors * HQ.floorHp[s]);
          this.emit({ e: 'floorUp', s, floors: sd.floors });
          if (s === 0 && sd.floors >= 4 && !sd.found4) { sd.found4 = 1; this.emit({ e: 'found4' }); }
        }
        break;
      case Fx.Focus: sd.focus = focusPt; sd.focusUntil = now + 700; for (const u of st.units) if (u.s === s) u.rt = 0; break;
      case Fx.Speed: sd.spd = now + c.v; break;
      case Fx.Damage: sd.dmgB = now + c.v; break;
      case Fx.EnemyN: en.n = now + c.v; break;
      case Fx.Heal: for (const u of st.units) if (u.s === s) u.hp = Math.min(u.mhp, u.hp + (u.mhp * c.v) / 100); break;
      case Fx.Blackout: en.black = now + c.v; break;
      case Fx.FreeSquads:
        for (const p of st.pts) { // places too
          if (p.owner !== s) continue;
          if (this.count(s) + UNITS[0].count > ECON.unitCap) break;
          this.spawnGroup(s, 0, p.x + (s ? -2 : 2), p.z + 1.5, -1);
        }
        break;
      case Fx.Income: sd.inc = now + c.v; break;
      case Fx.Regen: sd.regen = now + c.v; break;
      case Fx.Boss: this.spawnBoss(s); break;
      case Fx.Cars: sd.cars = now + c.v; break;
      case Fx.FocusDoner: sd.focus = PT_DONER; sd.focusUntil = now + c.v; for (const u of st.units) if (u.s === s) u.rt = 0; break;
      case Fx.Fudzi: {
        let n = 0;
        for (const u of st.units) {
          if (u.s !== s || u.hp <= 0) continue;
          u.hp = u.mhp;
          if (rnd(st) < 0.3) { u.psn = now + c.v; n++; }
        }
        this.emit({ e: 'poison', s, n });
        break;
      }
      case Fx.Sauce: sd.sauce = now + c.v; sd.sauceM = st.pts[PT_DONER].owner === s ? 1.4 : 1.25; break;
      case Fx.Cleanse:
        sd.immune = now + c.v; sd.n = 0;
        for (const u of st.units) if (u.s === s) { u.stun = 0; u.slow = 0; }
        break;
      case Fx.Creatine:
        for (const u of st.units) if (u.s === s && u.hp > 0) { const add = (u.mhp * c.v) / 100; u.mhp += add; u.hp += add; }
        break;
      case Fx.Chickens: {
        for (let i = 0; i < c.v; i++) { const p = this.hqSpot(s, i); this.spawn(s, CHICKEN, p.x, p.z, -1); }
        const p = st.pts[s];
        this.emit({ e: 'summon', s, t: CHICKEN, x: p.x, z: p.z, n: c.v });
        break;
      }
      case Fx.SkipVote: en.skip = 1; break;
      case Fx.Excuses: en.weak = now + c.v; break;
      case Fx.Shampoo: sd.dodge = now + c.v; break;
      case Fx.Ult:
        for (const u of st.units) if (u.s === s && (u.t === BOSS || UNITS[u.t].hero)) { u.ab = 0; u.f &= ~UF.LAGMAN; }
        sd.pack = 0; sd.golem = 0;
        break;
      case Fx.Poverty: en.poor = now + c.v; break;
      case Fx.Ersno:
        if (sd.hero[ERSNO] === -1) { sd.heroCd[ERSNO] = 0; const p = this.hqSpot(s, 0); this.spawn(s, ERSNO, p.x, p.z, -1); }
        break;
      case Fx.Changans:
        for (let i = 0; i < c.v; i++) { const p = this.hqSpot(s, i * 2); this.spawn(s, 3, p.x, p.z, -1); }
        break;
      case Fx.Snus: sd.snus = now + c.v; break;
      case Fx.Loop:
        sd.loop = now + c.v;
        for (const u of st.units) if (u.s === s && u.hp > 0) { u.stun = 0; u.hp = Math.max(1, u.hp - u.mhp * BUFF.loopHp); } // «сушняк»
        break;
      case Fx.Geliks: {
        const n = Math.max(0, Math.min(c.v, UNITS[GELIK].max! - this.countType(s, GELIK), ECON.unitCap - this.count(s)));
        for (let i = 0; i < n; i++) { const p = this.hqSpot(s, i * 2 + 1); this.spawn(s, GELIK, p.x, p.z, -1); }
        if (n > 0) { const p = st.pts[s]; this.emit({ e: 'summon', s, t: GELIK, x: p.x, z: p.z, n }); }
        break;
      }
      case Fx.Sportiki: {
        const k = UNITS[SPORTIK].count;
        let n = 0;
        for (let i = 0; i < c.v; i++) {
          if (this.count(s) + k > ECON.unitCap) break;
          const p = this.hqSpot(s, i * 3); this.spawnGroup(s, SPORTIK, p.x, p.z, -1); n += k;
        }
        if (n > 0) { const p = st.pts[s]; this.emit({ e: 'summon', s, t: SPORTIK, x: p.x, z: p.z, n }); }
        break;
      }
    }
  }

  // ---- World events ------------------------------------------------------------------
  private worldEvents() {
    const st = this.st, ev = st.ev, now = st.tick;
    if (now < ev.next) return;
    ev.next = now + EVENT_EVERY;
    let heroes = false;
    for (const u of st.units) if (u.hp > 0 && UNITS[u.t].hero) { heroes = true; break; }
    const cand: number[] = [];
    for (let i = 0; i < EVENTS.length; i++) {
      const k = EVENTS[i].key;
      if (k === ev.last) continue;
      if (k === 'cancel' && (st.votes[0].open || st.votes[1].open || st.nextVote - now < 150)) continue;
      if (k === 'classes' && !heroes) continue;
      cand.push(i);
    }
    this.startEvent(EVENTS[cand[rint(st, cand.length)]].key);
  }

  /** Starts world event `key` now (public for tests and admin tools). */
  startEvent(key: string) {
    const st = this.st, ev = st.ev, now = st.tick;
    const E = EVENTS.find(e => e.key === key);
    if (!E) return;
    ev.last = E.key;
    let until = now + E.dur;
    switch (E.key) {
      case 'jam': ev.jam = until; break;
      case 'blackout': ev.black = until; break;
      case 'classes':
        for (const u of st.units) {
          if (u.hp <= 0 || !UNITS[u.t].hero) continue;
          st.away.push({ s: u.s, t: u.t, hp: u.hp, mhp: u.mhp, back: until, ld: u.ld, f: u.f });
          st.sides[u.s].hero[u.t] = -2;
          u.hp = 0; u.f |= UF.GONE;
        }
        break;
      case 'sale': ev.sale = until; break;
      case 'cancel':
        if (!st.votes[0].open && !st.votes[1].open && st.nextVote > now + E.dur) st.nextVote = now + E.dur;
        until = st.nextVote;
        break;
      case 'friday': ev.friday = until; break;
      case 'flood': ev.flood = until; break;
    }
    this.emit({ e: 'event', key: E.key, title: E.title, quote: E.quote, until });
  }

  /** Heroes coming back from «пары» and respawn cooldowns running out. */
  private heroTimers() {
    const st = this.st, now = st.tick;
    for (const s of [0, 1] as Side[]) if (st.sides[s].snus === now && now > 0) this.emit({ e: 'comedown', s, until: now + BUFF.offFor });
    if (st.away.length) {
      const keep: Away[] = [];
      for (const a of st.away) {
        if (now < a.back) { keep.push(a); continue; }
        const p = this.hqSpot(a.s, a.t);
        const u = this.spawn(a.s, a.t, p.x, p.z, -1);
        u.hp = a.hp; u.mhp = a.mhp; u.f = a.f & UF.LAGMAN; u.ld = a.ld;
        if (u.ld >= 0) { const g = this.byId.get(u.ld); if (g && g.hp > 0 && g.t === GOLEM) g.ld = u.id; else u.ld = -1; }
        this.emit({ e: 'heroBack', s: a.s, t: a.t, id: u.id });
      }
      st.away = keep;
    }
    if (now % 10 !== 0) return;
    for (const s of [0, 1] as Side[]) {
      const sd = st.sides[s];
      for (const t of HEROES) if (sd.heroCd[t] > 0 && now >= sd.heroCd[t]) { sd.heroCd[t] = 0; this.emit({ e: 'heroBack', s, t, id: -1 }); }
    }
  }

  // ---- AI commanders -------------------------------------------------------------
  aiActive(s: Side): boolean {
    const st = this.st;
    const m = st.adm ? st.adm.ai[s] : 0; // admin: 1 always AI, 2 never
    if (m === 1) return true;
    if (m === 2) return false;
    if (st.mp) return st.tick - st.sides[s].lastHuman > 900;
    if (st.humanSide !== s) return true;
    return st.tick - st.sides[s].lastHuman > 1200; // автопилот, если игрок отошёл
  }

  /** Hero/ride may be bought by side s right now (ignores money and place). */
  private heroOk(s: Side, t: number): boolean {
    const d = UNITS[t], sd = this.st.sides[s];
    if (!d.avail[s] || d.summon || t === BOSS) return false;
    if (d.max && this.countType(s, t) >= d.max) return false;
    return !d.hero || (sd.hero[t] === -1 && sd.heroCd[t] <= this.st.tick);
  }

  /** Own army near the enemy high-rise: the AI sends Чимаев only with a push, like a hog with support. */
  private pushing(s: Side): boolean {
    const e = this.st.pts[1 - s], R = HQ.zone + 20;
    let n = 0;
    for (const u of this.st.units) {
      if (u.s !== s || u.hp <= 0) continue;
      const dx = u.x - e.x, dz = u.z - e.z;
      if (dx * dx + dz * dz < R * R && ++n >= 3) return true;
    }
    return false;
  }

  private ai(s: Side) {
    const st = this.st, sd = st.sides[s];
    if (st.tick < sd.aiNext || !this.aiActive(s)) return;
    sd.aiNext = st.tick + 22 + rint(st, 30);
    bldAi(this, s); // the base: at most one action now and then, with a reserve, so units still come first
    const mine = this.count(s);
    let t = -1;
    if (sd.aiWant >= 0 && st.tick < sd.aiWantUntil && mine >= 6 && this.heroOk(s, sd.aiWant)
      && !(sd.aiWant === ERSNO && st.sides[(1 - s) as Side].money < 250)) t = sd.aiWant;
    else {
      sd.aiWant = -1;
      const weights: number[] = [];
      let tot = 0;
      const W = AI_W[s], rich = st.sides[1 - s].money;
      for (let k = 0; k < NT; k++) {
        let w = k === 4 ? (mine > 8 ? W[k] : 0) : k > 4 && (!W[k] || !this.heroOk(s, k) || (k === CHIMAEV && !this.pushing(s))) ? 0 : W[k];
        if (k === ERSNO && w) w = rich >= 450 ? w * 4 : rich >= 250 ? w : 0; // карты соседей — только у богатых
        else if (k === GELIK && w && this.ownsPerk(s, 'gelik')) w *= 2; // мойка своя — гелик со скидкой
        weights.push(w); tot += w;
      }
      let r = rint(st, tot);
      t = 0;
      while (r >= weights[t]) { r -= weights[t]; t++; }
      if (t > 4 && sd.money < this.cost(s, t) && mine >= 6) { sd.aiWant = t; sd.aiWantUntil = st.tick + 450; return; }
    }
    if (sd.money < this.cost(s, t) + (mine < 6 ? 0 : 40)) return;
    // place at the own zone closest to what we want next
    const goal = this.pickGoal(s, st.pts[s].x, st.pts[s].z, t === CHIMAEV ? 2 : 0);
    let best = -1, bd = 0x7fffffff;
    for (let i = 0; i < st.pts.length; i++) {
      const p = st.pts[i];
      if (p.owner !== s) continue;
      if (p.kind !== 0 && this.contested(i)) continue;
      const d = goal >= 0 ? this.flows[goal].dist[navIndex(this.terrain, p.x, p.z)] : 0;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) best = s;
    const p = st.pts[best];
    const rr = p.kind === 0 ? 6 : p.r * 0.6;
    for (let k = 0; k < 6; k++) {
      const x = p.x + (rnd(st) * 2 - 1) * rr, z = p.z + (rnd(st) * 2 - 1) * rr;
      if (!this.canDeploy(s, t, x, z)) {
        sd.money -= this.cost(s, t); sd.deployed++;
        sd.aiWant = -1;
        this.spawnGroup(s, t, x, z, -2);
        return;
      }
    }
  }

  private contested(i: number): boolean {
    const p = this.st.pts[i];
    for (const u of this.st.units) {
      if (u.s === p.owner) continue;
      const dx = u.x - p.x, dz = u.z - p.z;
      if (dx * dx + dz * dz < p.r * p.r) return true;
    }
    return false;
  }

  /**
   * mode 0: anything; 1: villages, places and Донер Бей only (Адам); 2: the enemy high-rise only (Чимаев);
   * 3: like 0 but drawn to the enemy's money — its high-rise and whatever it owns (ersno).
   */
  pickGoal(s: Side, x: number, z: number, mode = 0, avoid = -1): number {
    const st = this.st, sd = st.sides[s];
    if (mode === 2) return 1 - s;
    if (sd.focus >= 0 && st.tick < sd.focusUntil && st.pts[sd.focus].owner !== s) return sd.focus;
    const cell = navIndex(this.terrain, x, z);
    let best = -1, bv = Infinity;
    for (let i = 0; i < st.pts.length; i++) {
      const p = st.pts[i];
      let w: number;
      if (i === avoid) continue;
      if (p.kind === 0) { if (p.side === s || mode === 1) continue; w = mode === 3 ? 1.0 : 1.3; }
      else {
        if (p.owner === s) continue;
        // places: medium priority to win back our own, low priority for the enemy's
        w = p.kind === 3 ? (p.side === s ? PLACE.aiOwn : PLACE.aiEnemy) : p.kind === 2 ? DONER.aiWeight : p.owner === -1 ? 1.0 : 0.92;
        if (mode === 3) w *= p.owner === 1 - s ? 0.75 : 1.4;
      }
      const d = this.flows[i].dist[cell];
      if (d >= 0x3fffffff) continue;
      const v = d * w;
      if (v < bv) { bv = v; best = i; }
    }
    return best;
  }

  // ---- spatial hash ---------------------------------------------------------------
  private hash() {
    const us = this.st.units;
    if (this.nxt.length < us.length) this.nxt = new Int32Array(us.length * 2);
    this.head.fill(-1);
    for (let i = 0; i < us.length; i++) {
      const c = this.cellOf(us[i].x, us[i].z);
      this.nxt[i] = this.head[c]; this.head[c] = i;
    }
  }
  private cellOf(x: number, z: number) {
    const i = Math.max(0, Math.min(this.hw - 1, Math.floor(x / 4)));
    const j = Math.max(0, Math.min(this.hh - 1, Math.floor(z / 4) + this.hz));
    return j * this.hw + i;
  }
  /** Calls fn(index) for units in cells overlapping the radius (caller filters). */
  private near(x: number, z: number, r: number, fn: (i: number) => void) {
    const i0 = Math.max(0, Math.floor((x - r) / 4)), i1 = Math.min(this.hw - 1, Math.floor((x + r) / 4));
    const j0 = Math.max(0, Math.floor((z - r) / 4) + this.hz), j1 = Math.min(this.hh - 1, Math.floor((z + r) / 4) + this.hz);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      for (let k = this.head[j * this.hw + i]; k !== -1; k = this.nxt[k]) fn(k);
    }
  }

  // ---- units -----------------------------------------------------------------------
  /** Current combat stats of u. Returns a shared scratch object: valid until the next stats() call. */
  private stats(u: U) {
    const st = this.st, sd = st.sides[u.s], now = st.tick;
    const d = UNITS[u.t];
    let dmg = d.dmg[u.s], range = d.range, spd = d.sspeed ? d.sspeed[u.s] : d.speed, cd = d.cd;
    if (u.t === BOSS) {
      range = BOSS_RANGE[u.s]; spd = BOSS_SPEED[u.s];
      if (u.s === 1 && u.hp < u.mhp * 0.5) cd = Math.floor(cd * 0.65); // перекачка
    }
    if (sd.dmgB > now) dmg *= 1.3;
    if (sd.sauce > now) dmg *= sd.sauceM;
    if (sd.weak > now) dmg *= 0.8;
    if (sd.loop > now) dmg *= BUFF.loopDmg;
    if (sd.spd > now) spd *= 1.4;
    if (sd.snus > now) { spd *= BUFF.snusSpd; cd = Math.max(1, Math.floor((cd * 10) / BUFF.snusAtk + 0.5)); }
    else if (sd.snus > 0 && now < sd.snus + BUFF.offFor) spd *= BUFF.offSpd; // отходняк
    if (sd.cars > now && d.kind === Kind.Fast) { spd *= 1.5; dmg *= 1.5; }
    if (d.kind === Kind.Fast && this.bi.side[u.s].length) { const g = bldEff(this, u.s, BKEY.garazh, true); if (g) spd *= g; } // «Гараж»
    if (sd.immune <= now && !d.kra) {
      if (sd.n > now && sd.loop <= now) spd *= 0.5; // «Н не липнет» under LOOP
      if (u.slow > now) spd *= 0.55;
    }
    // Ислам's aura: +15% damage near him
    if (u.s === 0 && sd.boss >= 0 && u.t !== BOSS) {
      const b = this.byId.get(sd.boss);
      if (b) { const dx = b.x - u.x, dz = b.z - u.z; if (dx * dx + dz * dz < 64) dmg *= 1.15; }
    }
    // админ: «не опаздываем»
    if (sd.hero[ADMIN] >= 0) {
      const a = this.byId.get(sd.hero[ADMIN]);
      if (a) { const R = UNITS[ADMIN].aura!, dx = a.x - u.x, dz = a.z - u.z; if (dx * dx + dz * dz < R * R) spd *= HERO.adminSpeed; }
    }
    const ev = st.ev;
    if (!d.kra) { // КРА номера: пробки и потоп не про них
      if (ev.jam > now) { const p = st.pts[PT_ARGUN], dx = p.x - u.x, dz = p.z - u.z; if (dx * dx + dz * dz < JAM_R * JAM_R) spd *= 0.3; }
      if (ev.flood > now && lcAt(this.terrain, u.x, u.z) === LC.WATER) spd *= 0.5;
    }
    const S = this.sc;
    S.dmg = dmg; S.range = range; S.spd = spd; S.cd = cd; S.d = d;
    return S;
  }

  private units() {
    const st = this.st, us = st.units, now = st.tick;
    const sec = now % 10 === 0;
    const frz = st.adm ? st.adm.frz : null; // admin «заморозить»: neither move nor attack
    this.prepFlows();
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      if (u.hp <= 0) continue;
      u.mv = 0;
      if (u.hit < 99) u.hit++;
      if (u.cd > 0) u.cd--;
      if (u.ab > 0) u.ab--;
      const sd = st.sides[u.s];
      if (sec) {
        if (sd.regen > now) u.hp = Math.min(u.mhp, u.hp + u.mhp * 0.012);
        if (u.psn > now) u.hp = Math.max(1, u.hp - u.mhp * 0.02);
      }
      if (u.t === BEKHAN && !(u.f & UF.LAGMAN) && u.hp < u.mhp * HERO.lagmanAt) { // «ест лагман»
        u.f |= UF.LAGMAN;
        u.hp = Math.min(u.mhp, u.hp + u.mhp * HERO.lagmanHeal);
        this.emit({ e: 'ability', s: u.s, t: u.t, id: u.id, x: u.x, z: u.z, key: 'lagman', r: 0 });
      }
      if (u.stun > now) continue;
      if (frz && frz[u.s]) continue;
      if (u.fr > now) { this.fearStep(u); continue; } // «Курение убивает»: бежим от пачки
      if (u.t === RIDE) { this.rideStep(u); continue; }
      if (u.t === ADAM) { this.adamStep(u); continue; }
      const S = this.stats(u), d = S.d;
      // target acquisition (a player order has its own rules)
      if (u.o) this.ordTarget(u, u.o, S);
      else if (d.bldg) { // хог райдер: только здания
        const e = st.pts[1 - u.s], dx = e.x - u.x, dz = e.z - u.z, r = d.aggro + HQ.radius[1 - u.s] + 3;
        u.tg = bldPick(this, u, d.aggro + BASE.bldgSeek, S.range, dx * dx + dz * dz <= r * r ? -2 : -1); // buildings first, then the high-rise
      } else {
        const tgU = u.tg >= 0 ? this.byId.get(u.tg) : undefined;
        if ((u.tg >= 0 && (!tgU || tgU.hp <= 0)) || (now + u.id) % 4 === 0) this.acquire(u, d.aggro);
      }
      if (u.ab === 0) {
        if (u.t === BOSS) this.bossAbility(u);
        else if (u.t === CHIMAEV) this.quake(u);
        else if (u.t === WOU) this.hack(u);
        else if (u.t === ADMIN) this.adminN(u);
        else if (u.t === MOHMAD) this.summonGolem(u);
        else if (u.t === ERSNO) this.cardSteal(u);
        else if (u.t === AMINA) this.slam(u);
      }
      if (u.t === ERSNO && now >= sd.golem) this.summonGolem(u); // Мохьмад = ersno: his Голем runs on its own timer
      if (u.t === ADMIN && now >= sd.pack) this.packUlt(u);
      if ((u.t === WOU || u.t === AMINA) && (now + u.id) % HERO.tauntEvery === 0) this.taunt(u, u.t === WOU);
      if (d.kind === Kind.Heal && u.cd === 0) this.healAround(u, d.heal![u.s], S.range);
      if (u.o) { this.ordAct(u, u.o, S); continue; }
      // engage
      let tx = 0, tz = 0, engage = false, inRange = false;
      if (u.tg >= 0) {
        const t = this.byId.get(u.tg);
        if (t && t.hp > 0) {
          tx = t.x; tz = t.z; engage = true;
          const dx = t.x - u.x, dz = t.z - u.z;
          const reach = S.range + d.radius + UNITS[t.t].radius;
          inRange = dx * dx + dz * dz <= reach * reach;
          if (inRange && u.cd === 0) this.attack(u, t, S.dmg, S.cd);
        } else u.tg = -1;
      } else if (u.tg === -2) {
        const e = st.pts[1 - u.s];
        tx = e.x; tz = e.z; engage = true;
        const dx = e.x - u.x, dz = e.z - u.z;
        const reach = S.range + HQ.radius[1 - u.s] + d.radius;
        inRange = dx * dx + dz * dz <= reach * reach;
        if (inRange && u.cd === 0) this.attackHq(u, (1 - u.s) as Side, S.dmg, S.cd);
      } else if (u.tg <= -10) {
        const b = this.bi.by.get(-u.tg - 10);
        if (b && b.hp > 0) {
          tx = b.x; tz = b.z; engage = true;
          const dx = b.x - u.x, dz = b.z - u.z, reach = S.range + d.radius + BUILDINGS[b.t].r;
          inRange = dx * dx + dz * dz <= reach * reach;
          if (inRange && u.cd === 0) attackBld(this, u, b, S.dmg, S.cd);
        } else u.tg = -1;
      }
      if (inRange) continue;
      if (engage) {
        const dx = tx - u.x, dz = tz - u.z, l = Math.sqrt(dx * dx + dz * dz);
        if (l > 0.001) this.stepDir(u, dx / l, dz / l, S.spd);
      } else this.goalMove(u, S.spd, d.bldg ? 2 : d.steal ? 3 : 0);
    }
    // separation (the near() walk inlined: same cells, same order, no closure per unit)
    const hw = this.hw, hh = this.hh, hz = this.hz, head = this.head, nxt = this.nxt;
    for (let i = 0; i < us.length; i++) {
      const a = us[i];
      if (a.hp <= 0) continue;
      const ra = UNITS[a.t].radius, ma = MASS[a.t];
      const i0 = Math.max(0, Math.floor((a.x - 3) / 4)), i1 = Math.min(hw - 1, Math.floor((a.x + 3) / 4));
      const j0 = Math.max(0, Math.floor((a.z - 3) / 4) + hz), j1 = Math.min(hh - 1, Math.floor((a.z + 3) / 4) + hz);
      for (let cj = j0; cj <= j1; cj++) for (let ci = i0; ci <= i1; ci++) {
        for (let k = head[cj * hw + ci]; k !== -1; k = nxt[k]) {
          if (k <= i) continue;
          const b = us[k];
          if (b.hp <= 0) continue;
          const rb = UNITS[b.t].radius;
          const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz, m = (ra + rb) * 0.85;
          if (d2 >= m * m) continue;
          let l = Math.sqrt(d2), nx: number, nz: number;
          if (l < 0.0001) { nx = ((a.id * 7) % 3) - 1 || 1; nz = ((b.id * 5) % 3) - 1; l = 0; const q = Math.sqrt(nx * nx + nz * nz); nx /= q; nz /= q; }
          else { nx = dx / l; nz = dz / l; }
          const push = (m - l) * 0.35;
          const mb = MASS[b.t], wa = ma === mb ? 0.5 : mb / (ma + mb);
          this.moveTo(a, a.x - nx * push * wa * 2, a.z - nz * push * wa * 2, true);
          this.moveTo(b, b.x + nx * push * (1 - wa) * 2, b.z + nz * push * (1 - wa) * 2, true);
        }
      }
    }
  }

  /** One movement step along a unit direction, scaled by the ground under the unit. */
  private stepDir(u: U, dirx: number, dirz: number, spd: number) {
    const T = this.terrain;
    const c = T.navCost[navIndex(T, u.x, u.z)] || 30;
    const sp = (spd * 10) / c;
    this.moveTo(u, u.x + dirx * sp, u.z + dirz * sp);
  }

  /** Walk toward the current goal point (re-picked every few seconds). */
  private goalMove(u: U, spd: number, mode: number) {
    const st = this.st;
    if (u.g < 0 || st.tick >= u.rt) { u.g = this.pickGoal(u.s, u.x, u.z, mode); u.rt = st.tick + 25 + (u.id % 15); }
    if (u.g < 0) return;
    const gp = st.pts[u.g];
    const dx = gp.x - u.x, dz = gp.z - u.z, d2 = dx * dx + dz * dz;
    const hold = gp.kind !== 0 ? gp.r * 0.55 : 0;
    if (gp.kind !== 0 && d2 < hold * hold) return; // занимаем село
    let dirx = 0, dirz = 0;
    if (d2 < 36) { const l = Math.sqrt(d2); if (l < 0.001) return; dirx = dx / l; dirz = dz / l; }
    else if (flowDir(this.terrain, this.flows[u.g], u.x, u.z, this.tmp)) { dirx = this.tmp.x; dirz = this.tmp.z; }
    else { const l = Math.sqrt(d2); dirx = dx / l; dirz = dz / l; }
    this.stepDir(u, dirx, dirz, spd);
  }

  private moveTo(u: U, x: number, z: number, nudge = false) {
    if (this.bi.sol[1 - u.s]) { // the enemy has walls or buildings: ask them, but only near its base
      const q = this.bi.box[1 - u.s], m = BASE.near;
      if (x > q[0] - m && x < q[2] + m && z > q[1] - m && z < q[3] + m) { bldMove(this, u, x, z, nudge); return; }
    }
    const T = this.terrain;
    if (passable(T, x, z)) { u.x = x; u.z = z; if (!nudge) u.mv = 1; return; }
    if (passable(T, x, u.z)) { u.x = x; if (!nudge) u.mv = 1; return; }
    if (passable(T, u.x, z)) { u.z = z; if (!nudge) u.mv = 1; }
  }

  private acquire(u: U, aggro: number) {
    const st = this.st, us = st.units;
    if (u.tt > st.tick) { // «Рейджбайт»: бьём только WOU
      const w = this.byId.get(u.tn);
      if (w && w.hp > 0) { u.tg = w.id; return; }
      u.tt = 0;
    }
    let best = -1, bd = aggro * aggro;
    if (u.t === BOSS) bd = 14 * 14;
    { // near() inlined
      const r = Math.sqrt(bd), hw = this.hw, head = this.head, nxt = this.nxt, ux = u.x, uz = u.z, us_ = u.s;
      const i0 = Math.max(0, Math.floor((ux - r) / 4)), i1 = Math.min(hw - 1, Math.floor((ux + r) / 4));
      const j0 = Math.max(0, Math.floor((uz - r) / 4) + this.hz), j1 = Math.min(this.hh - 1, Math.floor((uz + r) / 4) + this.hz);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        for (let k = head[j * hw + i]; k !== -1; k = nxt[k]) {
          const o = us[k];
          if (o.s === us_ || o.hp <= 0) continue;
          const dx = o.x - ux, dz = o.z - uz, d2 = dx * dx + dz * dz;
          if (d2 < bd || (d2 === bd && best >= 0 && o.id < us[best].id)) { bd = d2; best = k; }
        }
      }
    }
    if (best >= 0) { u.tg = us[best].id; return; }
    const e = st.pts[1 - u.s];
    const dx = e.x - u.x, dz = e.z - u.z, r = aggro + HQ.radius[1 - u.s] + 3;
    u.tg = bldPick(this, u, aggro, this.sc.range, dx * dx + dz * dz <= r * r ? -2 : -1);
  }

  private healAround(u: U, amount: number, range: number) {
    const us = this.st.units;
    let best = -1, br = 0.97;
    this.near(u.x, u.z, range + 1, k => {
      const o = us[k];
      if (o.s !== u.s || o.hp <= 0 || o.id === u.id) return;
      const dx = o.x - u.x, dz = o.z - u.z;
      if (dx * dx + dz * dz > (range + 1) * (range + 1)) return;
      const r = o.hp / o.mhp;
      if (r < br) { br = r; best = k; }
    });
    if (best >= 0) {
      const o = us[best];
      o.hp = Math.min(o.mhp, o.hp + amount * (o.t === BOSS ? 2 : 1));
      u.cd = UNITS[u.t].cd;
      this.emit({ e: 'shot', x: u.x, z: u.z, tx: o.x, tz: o.z, k: u.s === 0 ? 5 : 4, at: this.st.tick + 4, s: u.s });
    }
  }

  private attack(u: U, t: U, dmg: number, cd: number) {
    const st = this.st, d = UNITS[u.t];
    u.cd = cd;
    if (d.noFight) return;
    if (d.kind === Kind.Heal && st.sides[u.s] && dmg < 6) { this.hurt(t, dmg); return; }
    if (d.proj && !(u.t === BOSS && u.s === 1)) {
      const dx = t.x - u.x, dz = t.z - u.z, l = Math.sqrt(dx * dx + dz * dz);
      const at = st.tick + Math.max(1, Math.ceil(l / d.proj));
      const k = u.t === BOSS ? 2 : d.shot !== undefined ? d.shot : u.s === 0 ? 0 : 1;
      const sp = d.splash ? d.splash[u.s] : 0;
      st.proj.push({ x: u.x, z: u.z, tx: t.x, tz: t.z, tg: t.id, hq: -1, s: u.s, dmg, sp, slow: u.t === BOSS ? 30 : 0, at, k, from: st.tick });
      this.emit({ e: 'shot', x: u.x, z: u.z, tx: t.x, tz: t.z, k, at, s: u.s });
      return;
    }
    if (u.t === BOSS) { // Зураб: удар по площади
      this.splash(u.s, t.x, t.z, d.splash![1], dmg, 0, 1.1);
      this.emit({ e: 'hit', x: t.x, z: t.z, s: t.s, big: 2 });
      return;
    }
    const landed = this.hurt(t, dmg);
    if (d.knock) this.knock(u, t, d.knock);
    if (d.steal && landed) this.steal(u, d.steal[0], 'hit');
    this.emit({ e: 'hit', x: t.x, z: t.z, s: t.s, big: d.kind === Kind.Fast || MASS[u.t] > 1 ? 1 : 0 });
  }

  /** ersno «Перевод по номеру карты»: moves up to `want` ₽ from the enemy bank (never below 0). Returns ₽ moved. */
  private steal(u: U, want: number, k: 'hit' | 'card'): number {
    const v = (1 - u.s) as Side, en = this.st.sides[v];
    const n = Math.floor(Math.min(want, en.money - bldSafe(this, v))); // «Сейф» hides part of the bank
    if (n <= 0) return 0;
    en.money -= n; this.st.sides[u.s].money += n;
    this.emit({ e: 'steal', s: u.s, v, id: u.id, x: u.x, z: u.z, n, k });
    return n;
  }

  private attackHq(u: U, s: Side, dmg: number, cd: number) {
    const st = this.st, d = UNITS[u.t], e = st.pts[s];
    u.cd = cd;
    if (d.noFight) return;
    if (d.bldg) dmg *= d.bldg;
    if (d.proj && !(u.t === BOSS && u.s === 1)) {
      const dx = e.x - u.x, dz = e.z - u.z, l = Math.sqrt(dx * dx + dz * dz);
      const at = st.tick + Math.max(1, Math.ceil(l / d.proj));
      const k = u.t === BOSS ? 2 : d.shot !== undefined ? d.shot : u.s === 0 ? 0 : 1;
      st.proj.push({ x: u.x, z: u.z, tx: e.x, tz: e.z, tg: -1, hq: s, s: u.s, dmg, sp: 0, slow: 0, at, k, from: st.tick });
      this.emit({ e: 'shot', x: u.x, z: u.z, tx: e.x, tz: e.z, k, at, s: u.s });
      return;
    }
    this.hurtHq(s, dmg * (u.t === BOSS ? 1.5 : 1));
    if (d.steal) this.steal(u, d.steal[1], 'hit');
    this.emit({ e: 'hit', x: e.x + (u.x - e.x) * 0.3, z: e.z + (u.z - e.z) * 0.3, s, big: 1 });
  }

  private knock(a: U, t: U, f: number) {
    if (MASS[t.t] > 1) return;
    const dx = t.x - a.x, dz = t.z - a.z, l = Math.sqrt(dx * dx + dz * dz);
    if (l < 0.001) return;
    this.moveTo(t, t.x + (dx / l) * f, t.z + (dz / l) * f, true);
  }

  private immune(s: Side) { return this.st.sides[s].immune > this.st.tick; }
  /** Slows do not stick: «Н ма дилита» on the side, or КРА номера. */
  private noSlow(o: U) { return this.immune(o.s) || !!UNITS[o.t].kra; }
  /** Stuns do not stick: bosses, КРА номера, «Н ма дилита», «Бамб LOOP». */
  private noStun(o: U) { return o.t === BOSS || this.noSlow(o) || this.st.sides[o.s].loop > this.st.tick; }

  private splash(s: Side, x: number, z: number, r: number, dmg: number, slow: number, knock: number, stun = 0) {
    const us = this.st.units;
    this.near(x, z, r, k => {
      const o = us[k];
      if (o.s === s || o.hp <= 0) return;
      const dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz;
      if (d2 > r * r) return;
      this.hurt(o, dmg);
      if (slow && !this.noSlow(o)) o.slow = this.st.tick + slow;
      if (stun && !this.noStun(o)) o.stun = this.st.tick + stun;
      if (knock && MASS[o.t] === 1) {
        const l = Math.sqrt(d2);
        if (l > 0.001) this.moveTo(o, o.x + (dx / l) * knock, o.z + (dz / l) * knock, true);
      }
    });
  }

  private bossAbility(u: U) {
    const st = this.st, us = st.units;
    let n = 0;
    const R = u.s === 1 ? 5 : 7;
    this.near(u.x, u.z, R, k => { const o = us[k]; if (o.s !== u.s && o.hp > 0) { const dx = o.x - u.x, dz = o.z - u.z; if (dx * dx + dz * dz < R * R) n++; } });
    if (n < 3) { u.ab = 10; return; }
    if (u.s === 1) { // «Ас та1 во и» — раздавлю
      this.splash(1, u.x, u.z, R, 105, 0, 2.2, 15);
      u.ab = 90;
    } else { // «Копил ульту — теперь отдыхайте, ребята»
      this.splash(0, u.x, u.z, R, 60, 40, 0.6, 20);
      u.ab = 120;
    }
    this.emit({ e: 'ult', s: u.s, x: u.x, z: u.z, r: R });
  }

  // ---- hero abilities --------------------------------------------------------------
  private enemiesIn(u: U, R: number, noBoss: boolean): number {
    const us = this.st.units;
    let n = 0;
    this.near(u.x, u.z, R, k => {
      const o = us[k];
      if (o.s === u.s || o.hp <= 0 || (noBoss && o.t === BOSS)) return;
      const dx = o.x - u.x, dz = o.z - u.z;
      if (dx * dx + dz * dz <= R * R) n++;
    });
    return n;
  }

  /** Чимаев «Землетряс»: pulses around him; the high-rise takes ×bldg. */
  private quake(u: U) {
    const st = this.st, d = UNITS[u.t], R = d.abR!;
    const e = st.pts[1 - u.s], dx = e.x - u.x, dz = e.z - u.z, hr = R + HQ.radius[1 - u.s];
    const nearHq = dx * dx + dz * dz <= hr * hr;
    if (!nearHq && this.enemiesIn(u, R, false) < 2) { u.ab = 10; return; }
    st.aoe.push({ s: u.s, x: u.x, z: u.z, r: R, dmg: HERO.quakeDmg, hq: d.bldg!, at: st.tick, n: HERO.quakePulses, every: HERO.quakeEvery, k: 'quake' });
    u.ab = d.abCd!;
    this.emit({ e: 'ability', s: u.s, t: u.t, id: u.id, x: u.x, z: u.z, key: 'quake', r: R });
  }

  /** WOU «Взломать Пентагон»: only while he is in a fight. */
  private hack(u: U) {
    const st = this.st;
    if (u.tg === -1) { u.ab = 10; return; }
    const v = (1 - u.s) as Side, until = st.tick + HERO.hackFor;
    st.sides[v].hack = until;
    u.ab = UNITS[u.t].abCd!;
    this.emit({ e: 'ability', s: u.s, t: u.t, id: u.id, x: u.x, z: u.z, key: 'hack', r: 0 });
    this.emit({ e: 'hack', s: u.s, v, id: u.id, x: u.x, z: u.z, until });
  }

  /** WOU «Рейджбайт» / Амина's aura: nearby enemies (not bosses, not Чимаев) must hit them. Амина's pulses emit nothing. */
  private taunt(u: U, emit = true) {
    const st = this.st, us = st.units, R = UNITS[u.t].aura!, until = st.tick + HERO.tauntFor;
    let n = 0;
    this.near(u.x, u.z, R, k => {
      const o = us[k];
      if (o.s === u.s || o.hp <= 0 || o.t === BOSS) return;
      const od = UNITS[o.t];
      if (od.noFight || od.bldg || od.kind === Kind.Heal || od.kra) return;
      const dx = o.x - u.x, dz = o.z - u.z;
      if (dx * dx + dz * dz > R * R) return;
      o.tg = u.id; o.tt = until; o.tn = u.id; n++;
    });
    if (n && emit) this.emit({ e: 'taunt', s: u.s, id: u.id, x: u.x, z: u.z, r: R, n });
  }

  /** админ «Н»: everybody around is marked absent and stands still. */
  private adminN(u: U) {
    const st = this.st, us = st.units, d = UNITS[u.t], R = d.abR!;
    const v = (1 - u.s) as Side;
    if (this.immune(v) || st.sides[v].loop > st.tick || this.enemiesIn(u, R, true) < 2) { u.ab = 10; return; }
    const until = st.tick + HERO.nStun;
    let n = 0;
    this.near(u.x, u.z, R, k => {
      const o = us[k];
      if (o.s === u.s || o.hp <= 0 || this.noStun(o)) return;
      const dx = o.x - u.x, dz = o.z - u.z;
      if (dx * dx + dz * dz > R * R) return;
      o.stun = Math.max(o.stun, until); n++;
    });
    u.ab = d.abCd!;
    this.emit({ e: 'ability', s: u.s, t: u.t, id: u.id, x: u.x, z: u.z, key: 'n', r: R });
    this.emit({ e: 'stunN', s: u.s, id: u.id, x: u.x, z: u.z, r: R, n });
  }

  /** Мохьмад: «у меня Голем был всю игру». Type 9 waits on SideState.golem, the old summoner 12 on U.ab. */
  private summonGolem(u: U) {
    const g = u.ld >= 0 ? this.byId.get(u.ld) : undefined;
    const sd = this.st.sides[u.s], own = u.t === ERSNO;
    if (g && g.hp > 0) { if (own) sd.golem = this.st.tick + 20; else u.ab = 20; return; }
    const dir = u.s === 0 ? 1 : -1;
    let x = u.x + dir * 1.6, z = u.z + 0.8;
    if (!passable(this.terrain, x, z)) { x = u.x; z = u.z; }
    const go = this.spawn(u.s, GOLEM, x, z, u.own);
    go.ld = u.id; go.g = u.g; go.rt = this.st.tick + 25;
    u.ld = go.id;
    if (own) sd.golem = this.st.tick + HERO.golemCd; else u.ab = UNITS[u.t].abCd!;
    this.emit({ e: 'ability', s: u.s, t: u.t, id: u.id, x, z, key: 'golem', r: 0 });
    this.emit({ e: 'summon', s: u.s, t: GOLEM, x, z, n: 1 });
  }

  /** ersno «Списание с карты»: by the enemy high-rise or in a crowd, takes 10% of the enemy bank (≤ 150 ₽). */
  private cardSteal(u: U) {
    const st = this.st, d = UNITS[u.t], R = d.abR!;
    const v = (1 - u.s) as Side, e = st.pts[v], dx = e.x - u.x, dz = e.z - u.z, hr = R + HQ.radius[v];
    const nearHq = dx * dx + dz * dz <= hr * hr;
    if (!nearHq && this.enemiesIn(u, R, false) < HERO.cardMin) { u.ab = 10; return; }
    const n = this.steal(u, Math.min(st.sides[v].money * HERO.cardPct, HERO.cardMax), 'card');
    if (n <= 0) { u.ab = 10; return; } // пустой счёт: попробуем позже
    u.ab = d.abCd!;
    this.emit({ e: 'ability', s: u.s, t: u.t, id: u.id, x: u.x, z: u.z, key: 'card', r: R });
  }

  /** Амина «Плюхнулась»: ≥ slamMin enemies around her get hit, knocked back and stunned for a second. */
  private slam(u: U) {
    const d = UNITS[u.t], R = d.abR!;
    if (this.enemiesIn(u, R, false) < HERO.slamMin) { u.ab = 10; return; }
    this.splash(u.s, u.x, u.z, R, HERO.slamDmg, 0, HERO.slamKnock, HERO.slamStun);
    u.ab = d.abCd!;
    this.emit({ e: 'ability', s: u.s, t: u.t, id: u.id, x: u.x, z: u.z, key: 'slam', r: R });
  }

  /** админ «Курение убивает»: a pack lands in the middle of ≥ packMin enemies around him. */
  private packUlt(u: U) {
    const st = this.st, us = st.units, sd = st.sides[u.s], now = st.tick, R = HERO.packTrig;
    let n = 0, sx = 0, sz = 0;
    this.near(u.x, u.z, R, k => {
      const o = us[k];
      if (o.s === u.s || o.hp <= 0 || UNITS[o.t].kra || UNITS[o.t].noFight) return;
      const dx = o.x - u.x, dz = o.z - u.z;
      if (dx * dx + dz * dz > R * R) return;
      n++; sx += o.x; sz += o.z;
    });
    if (n < HERO.packMin) { sd.pack = now + 10; return; }
    const p: Pack = { s: u.s, id: u.id, x: sx / n, z: sz / n, r: HERO.packR, at: now, until: now + HERO.packFor };
    st.packs.push(p);
    const scared = this.scare(p);
    sd.pack = now + HERO.packCd;
    this.emit({ e: 'ability', s: u.s, t: u.t, id: u.id, x: p.x, z: p.z, key: 'pack', r: p.r });
    this.emit({ e: 'pack', s: u.s, id: u.id, x: p.x, z: p.z, r: p.r, until: p.until, n: scared });
  }

  /** Enemies of the pack in its radius: poisoned (not cars); scared too, unless boss, car, Адам/ride or «Н ма дилита». */
  private scare(p: Pack): number {
    const st = this.st, us = st.units, now = st.tick, R = p.r, imm = this.immune((1 - p.s) as Side);
    let n = 0;
    this.near(p.x, p.z, R, k => {
      const o = us[k];
      if (o.s === p.s || o.hp <= 0) return;
      const dx = o.x - p.x, dz = o.z - p.z;
      if (dx * dx + dz * dz > R * R) return;
      const d = UNITS[o.t];
      if (d.kra) return;
      o.psn = Math.max(o.psn, now + HERO.packPsn);
      if (o.t === BOSS || d.noFight || imm) return;
      if (o.fr <= now) n++;
      o.fr = Math.max(o.fr, now + HERO.fearFor);
      o.tg = -1;
    });
    return n;
  }

  /** Packs on the ground: scare whoever is inside once a second; gone after `until`. */
  private packs() {
    const st = this.st, now = st.tick;
    if (!st.packs.length) return;
    const keep: Pack[] = [];
    for (const p of st.packs) {
      if (now >= p.until) continue;
      if (now > p.at && (now - p.at) % 10 === 0) this.scare(p);
      keep.push(p);
    }
    st.packs = keep;
  }

  /** Scared: run away from the nearest enemy pack, or home if it is gone; no attacks. */
  private fearStep(u: U) {
    const st = this.st, S = this.stats(u);
    let best = -1, bd = Infinity;
    for (let i = 0; i < st.packs.length; i++) {
      const p = st.packs[i];
      if (p.s === u.s) continue;
      const dx = u.x - p.x, dz = u.z - p.z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = i; }
    }
    u.tg = -1;
    if (best >= 0) {
      const p = st.packs[best], R = p.r + 4;
      if (bd < R * R) {
        let dx = u.x - p.x, dz = u.z - p.z, l = Math.sqrt(bd);
        if (l < 0.01) { dx = u.s === 0 ? -1 : 1; dz = 0; l = 1; } // прямо на пачке: домой
        this.stepDir(u, dx / l, dz / l, S.spd);
        return;
      }
    }
    if (flowDir(this.terrain, this.flows[u.s], u.x, u.z, this.tmp)) this.stepDir(u, this.tmp.x, this.tmp.z, S.spd);
  }

  /** Такси / маршрутка: drives to its village, drops the пацаны, drives off. */
  private rideStep(u: U) {
    const st = this.st, us = st.units, d = UNITS[u.t], now = st.tick;
    const S = this.stats(u);
    if (u.f & UF.UNLOADED) {
      if (u.ab === 0) { u.hp = 0; u.f |= UF.GONE; return; }
      if (flowDir(this.terrain, this.flows[u.s], u.x, u.z, this.tmp)) this.stepDir(u, this.tmp.x, this.tmp.z, S.spd);
      return;
    }
    let unload = now - u.born >= d.life!;
    if (!unload) {
      const R = HERO.rideUnloadR;
      this.near(u.x, u.z, R, k => {
        if (unload) return;
        const o = us[k];
        if (o.s === u.s || o.hp <= 0) return;
        const dx = o.x - u.x, dz = o.z - u.z;
        if (dx * dx + dz * dz <= R * R) unload = true;
      });
      const e = st.pts[1 - u.s], dx = e.x - u.x, dz = e.z - u.z, hr = R + HQ.radius[1 - u.s];
      if (dx * dx + dz * dz <= hr * hr) unload = true;
      if (u.g >= 0) {
        const gp = st.pts[u.g];
        if (gp.kind !== 0) { const gx = gp.x - u.x, gz = gp.z - u.z, h = gp.r * 0.55; if (gx * gx + gz * gz < h * h) unload = true; }
      }
    }
    if (unload) { this.unload(u); return; }
    this.goalMove(u, S.spd, 0);
  }

  private unload(u: U) {
    const st = this.st, n = UNITS[u.t].carry![u.s];
    for (let i = 0; i < n; i++) {
      const D = DIRS[i % 6], R = 0.9 + Math.floor(i / 6) * 0.8;
      let x = u.x + D[0] * R, z = u.z + D[1] * R;
      if (!passable(this.terrain, x, z)) { x = u.x; z = u.z; }
      const p = this.spawn(u.s, 0, x, z, u.own);
      p.g = u.g; p.rt = st.tick + 25;
    }
    u.f |= UF.UNLOADED; u.ab = HERO.rideLeave; u.tg = -1;
    this.emit({ e: 'unload', s: u.s, id: u.id, x: u.x, z: u.z, n });
  }

  /** Адам: never fights; bolts away from any fight, otherwise takes villages. */
  private adamStep(u: U) {
    const st = this.st, us = st.units, d = UNITS[u.t];
    const S = this.stats(u), R = d.flee! + (u.f & UF.FLEE ? 3 : 0); // keeps running a bit further once scared
    if (u.o && u.o.m === OM.POSSESS) { u.f &= ~UF.FLEE; this.possStep(u, u.o, S); return; } // the player drives: no bolting
    let fx = 0, fz = 0, n = 0;
    this.near(u.x, u.z, R, k => {
      const o = us[k];
      if (o.s === u.s || o.hp <= 0 || UNITS[o.t].noFight) return;
      const dx = u.x - o.x, dz = u.z - o.z, d2 = dx * dx + dz * dz;
      if (d2 > R * R) return;
      const l = Math.sqrt(d2) || 0.01;
      fx += dx / l; fz += dz / l; n++;
    });
    const e = st.pts[1 - u.s], ex = u.x - e.x, ez = u.z - e.z, er = HQ.turretRange + 1;
    if (ex * ex + ez * ez < er * er) { const l = Math.sqrt(ex * ex + ez * ez) || 0.01; fx += ex / l; fz += ez / l; n++; }
    if (n) {
      if (!(u.f & UF.FLEE)) {
        u.f |= UF.FLEE;
        const g = this.pickGoal(u.s, u.x, u.z, 1, u.g); // драка там — бежим брать другое село
        if (g >= 0) { u.g = g; u.rt = st.tick + 80; }
        if (u.ab === 0) { u.ab = 50; this.emit({ e: 'ability', s: u.s, t: u.t, id: u.id, x: u.x, z: u.z, key: 'bolt', r: R }); }
      }
      if (flowDir(this.terrain, this.flows[u.s], u.x, u.z, this.tmp)) { fx += this.tmp.x * 0.5; fz += this.tmp.z * 0.5; }
      const l = Math.sqrt(fx * fx + fz * fz);
      if (l > 0.001) this.stepDir(u, fx / l, fz / l, S.spd * HERO.bolt);
      return;
    }
    u.f &= ~UF.FLEE;
    if (u.o) { if (u.o.m === OM.MOVE || u.o.m === OM.AMOVE) this.ordMove(u, u.o, S.spd); else if (u.o.m === OM.ATTACK) this.holdHere(u); return; } // never fights: attack orders just stand
    this.goalMove(u, S.spd, 1);
  }

  /** Returns false when the hit was dodged. */
  hurt(u: U, dmg: number): boolean {
    const st = this.st, sd = st.sides[u.s];
    if (st.adm && st.adm.god[u.s]) return false; // admin «бессмертие»
    if (sd.dodge > st.tick && rnd(st) < 0.4) { this.emit({ e: 'dodge', x: u.x, z: u.z, s: u.s }); return false; }
    dmg *= bldMark(this, u); // «Камера»: marked units take more
    if (sd.hero[BEKHAN] >= 0) { // «Главное не игра, главное дисциплина»
      const b = this.byId.get(sd.hero[BEKHAN]);
      if (b) { const R = UNITS[BEKHAN].aura!, dx = b.x - u.x, dz = b.z - u.z; if (dx * dx + dz * dz < R * R) dmg *= HERO.bekhanArmor; }
    }
    u.hp -= dmg; u.hit = 0;
    return true;
  }

  hurtHq(s: Side, dmg: number) {
    if (this.st.adm && this.st.adm.god[s]) return;
    const sd = this.st.sides[s];
    const before = Math.ceil(sd.hq / HQ.floorHp[s]);
    sd.hq -= dmg;
    const after = Math.max(0, Math.ceil(sd.hq / HQ.floorHp[s]));
    if (after < before) { sd.floors = after; this.emit({ e: 'floor', s, floors: after }); }
  }

  private aoes() {
    const st = this.st;
    if (!st.aoe.length) return;
    const keep: Aoe[] = [];
    for (const a of st.aoe) {
      if (st.tick < a.at) { keep.push(a); continue; }
      this.splash(a.s, a.x, a.z, a.r, a.dmg, 0, a.k === 'quake' ? 0.5 : 0.8);
      if (a.hq > 0) {
        const v = (1 - a.s) as Side, e = st.pts[v], dx = e.x - a.x, dz = e.z - a.z, hr = a.r + HQ.radius[v];
        if (dx * dx + dz * dz <= hr * hr) this.hurtHq(v, a.dmg * a.hq);
      }
      bldAoe(this, a);
      this.emit({ e: 'pulse', s: a.s, x: a.x, z: a.z, r: a.r, key: a.k });
      a.n--;
      if (a.n > 0) { a.at = st.tick + a.every; keep.push(a); }
    }
    st.aoe = keep;
  }

  private projectiles() {
    const st = this.st;
    const keep: P[] = [];
    for (const p of st.proj) {
      if (p.tg >= 0) { const t = this.byId.get(p.tg); if (t && t.hp > 0) { p.tx = t.x; p.tz = t.z; } }
      if (st.tick < p.at) { keep.push(p); continue; }
      if (p.b !== undefined) { bldProj(this, p); continue; }
      if (p.hq >= 0) { this.hurtHq(p.hq as Side, p.dmg); this.emit({ e: 'hit', x: p.tx, z: p.tz, s: p.hq as Side, big: 0 }); continue; }
      if (p.sp > 0) {
        this.splash(p.s, p.tx, p.tz, p.sp, p.dmg, p.slow, 0.3);
        this.emit({ e: 'hit', x: p.tx, z: p.tz, s: (1 - p.s) as Side, big: p.k === 2 ? 2 : 1 });
      } else {
        const t = this.byId.get(p.tg);
        if (t && t.hp > 0) { this.hurt(t, p.dmg); if (p.slow && !this.noSlow(t)) t.slow = st.tick + p.slow; this.emit({ e: 'hit', x: t.x, z: t.z, s: t.s, big: 0 }); }
      }
    }
    st.proj = keep;
  }

  private turrets() {
    const st = this.st;
    for (const s of [0, 1] as Side[]) {
      const sd = st.sides[s], p = st.pts[s];
      if (sd.turretCd > st.tick || sd.hack > st.tick) continue;
      let best = -1, bd = HQ.turretRange * HQ.turretRange;
      this.near(p.x, p.z, HQ.turretRange, k => {
        const o = st.units[k];
        if (o.s === s || o.hp <= 0) return;
        const dx = o.x - p.x, dz = o.z - p.z, d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; best = k; }
      });
      if (best < 0) continue;
      const o = st.units[best];
      sd.turretCd = st.tick + HQ.turretCd;
      const at = st.tick + 3;
      st.proj.push({ x: p.x, z: p.z, tx: o.x, tz: o.z, tg: o.id, hq: -1, s, dmg: HQ.turretDmg + sd.floors * 3, sp: 0, slow: 0, at, k: 3, from: st.tick });
      this.emit({ e: 'shot', x: p.x, z: p.z, tx: o.x, tz: o.z, k: 3, at, s });
    }
  }

  private capture() {
    const st = this.st;
    for (let i = 0; i < st.pts.length; i++) {
      const p = st.pts[i];
      if (p.kind === 0) continue;
      let a = 0, k = 0;
      this.near(p.x, p.z, p.r, j => {
        const u = st.units[j];
        if (u.hp <= 0) return;
        const dx = u.x - p.x, dz = u.z - p.z;
        if (dx * dx + dz * dz > p.r * p.r) return;
        const w = CAPW[u.t];
        if (u.s === 0) a += w; else k += w;
      });
      const prev = p.owner;
      if (a > 0 && k === 0) p.prog = Math.max(-100, p.prog - Math.min(a, 5));
      else if (k > 0 && a === 0) p.prog = Math.min(100, p.prog + Math.min(k, 5));
      else if (a === 0 && k === 0 && p.owner === -1) p.prog = p.prog > 0 ? Math.max(0, p.prog - 1) : Math.min(0, p.prog + 1);
      else if (a === 0 && k === 0 && p.kind === 3) p.prog = p.owner === 0 ? Math.max(-100, p.prog - PLACE.regen) : Math.min(100, p.prog + PLACE.regen); // свои отбивают место
      if (p.prog <= -100) p.owner = 0;
      else if (p.prog >= 100) p.owner = 1;
      else if ((p.owner === 0 && p.prog > 0) || (p.owner === 1 && p.prog < 0)) p.owner = -1;
      if (p.owner !== prev) {
        this.emit({ e: 'capture', p: i, s: p.owner });
        if (p.owner >= 0) for (const u of st.units) if (u.g === i) u.rt = 0;
      }
    }
  }

  private cleanup() {
    const st = this.st, now = st.tick;
    if (st.bld.length) bldCleanup(this);
    let dead = false;
    for (const u of st.units) if (u.hp <= 0) { dead = true; break; }
    if (dead) {
      const spill: U[] = [];
      st.units = st.units.filter(u => {
        if (u.hp > 0) return true;
        this.byId.delete(u.id);
        if (u.f & UF.GONE) { this.emit({ e: 'gone', id: u.id, s: u.s, t: u.t, x: u.x, z: u.z }); return false; }
        const d = UNITS[u.t], sd = st.sides[u.s], adm = u.f & UF.ADM;
        const killer = st.sides[(1 - u.s) as Side];
        if (!adm) {
          killer.kills++;
          killer.money += Math.floor(d.cost[u.s] * ECON.bounty) + (u.t === BOSS ? 300 : 2);
        }
        this.emit({ e: 'die', x: u.x, z: u.z, s: u.s, t: u.t });
        if (u.t === BOSS) {
          sd.boss = -1; sd.bossCd = now + BOSS_RESPAWN;
          this.emit({ e: 'bossDown', s: u.s });
        }
        if (d.hero && sd.hero[u.t] === u.id) {
          sd.hero[u.t] = -1; sd.heroCd[u.t] = now + d.respawn!;
          this.emit({ e: 'heroDown', s: u.s, t: u.t });
        }
        if (u.t === GOLEM && u.ld >= 0) {
          const m = this.byId.get(u.ld);
          if (m && m.ld === u.id) {
            m.ld = -1;
            if (m.t === ERSNO) st.sides[m.s].golem = Math.max(st.sides[m.s].golem, now + HERO.golemCd);
            else m.ab = Math.max(m.ab, UNITS[MOHMAD].abCd!);
          }
        }
        if (d.deathR && !adm) st.aoe.push({ s: u.s, x: u.x, z: u.z, r: d.deathR, dmg: d.deathDmg!, hq: 0, at: now + 1, n: 1, every: 0, k: d.key });
        if (u.t === RIDE && !(u.f & UF.UNLOADED) && !adm) spill.push(u);
        return false;
      });
      for (const r of spill) this.unload(r); // пацаны выпрыгивают из подбитой машины
    }
    for (const s of [0, 1] as Side[]) {
      if (st.sides[s].hq <= 0 && st.winner === -1) {
        st.winner = (1 - s) as Side; st.overAt = st.tick;
        st.sides[st.winner].wins++;
        this.emit({ e: 'victory', s: st.winner });
      }
    }
  }

  private spawnBoss(s: Side) {
    const st = this.st, sd = st.sides[s];
    if (sd.boss !== -1) return;
    const p = st.pts[s];
    const dir = s === 0 ? 1 : -1;
    let x = p.x + dir * 4, z = p.z + 1;
    if (!passable(this.terrain, x, z)) { x = p.x; z = p.z + 4; }
    const u = this.spawn(s, BOSS, x, z, -1);
    sd.boss = u.id;
    this.emit({ e: 'boss', s });
  }

  private bosses() {
    const st = this.st;
    for (const s of [0, 1] as Side[]) {
      const sd = st.sides[s];
      if (sd.boss === -1 && st.tick >= sd.bossCd && sd.hq <= HQ.floorHp[s]) this.spawnBoss(s);
    }
  }

  private newWar() {
    const st = this.st;
    const wins: [number, number] = [st.sides[0].wins, st.sides[1].wins];
    const base = bldWarEnd(this); // before the sides are replaced: the loser and its insurance
    st.era++;
    st.units = []; st.proj = []; st.aoe = []; st.away = []; st.packs = [];
    st.pts = this.makePoints();
    st.sides = [this.freshSide(0, wins[0]), this.freshSide(1, wins[1])];
    st.sides[0].aiNext = st.tick + 30; st.sides[1].aiNext = st.tick + 37;
    st.votes = [this.freshVote(), this.freshVote()];
    st.nextVote = st.tick + FIRST_VOTE;
    st.nextMilitia = st.tick + 40;
    st.ev = this.freshEv(st.tick);
    st.winner = -1; st.overAt = 0;
    for (const k of Object.keys(st.players)) st.players[k].cd = 0;
    bldNewWar(this, base); // surviving buildings stay, repaired
    this.reindex();
    this.emit({ e: 'newWar', era: st.era });
  }
}

const DIRS = [[1, 0], [0.5, 0.866], [-0.5, 0.866], [-1, 0], [-0.5, -0.866], [0.5, -0.866]];
const RING8 = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];
// Heavy units push others around and are not knocked back (UnitDef.mass: Голем, Гелик, Амина; bosses 9).
const MASS = UNITS.map((d, t) => (t === BOSS ? 9 : d.mass ?? 1));
const CAPW = UNITS.map(d => (d.capW !== undefined ? d.capW : 1));

export function cardTitle(c: typeof CARDS[number], village: string): string {
  return c.title.replace('{V}', village || 'Шали');
}

export function hashState(st: State): number {
  const s = JSON.stringify(st);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
