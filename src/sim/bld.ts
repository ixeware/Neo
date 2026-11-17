// Player-placed base buildings (docs/v5/BASE.md): placement rules, the 'bld' command, towers, walls,
// traps, economy, support, superweapons, how units fight buildings, the AI builder, admin ops.
// Everything here is part of the deterministic sim: the same rules as src/sim/sim.ts (only + − × ÷ sqrt
// floor ceil min max on numbers that feed state, randomness only inside a step, queries never write).
// Buildings never touch the nav grid or the flow fields: Sim.bi is an index derived from State.bld
// (rebuilt by bldReindex on every load and on every structural change) and only moveTo consults it.
import { BUILDINGS, BASE, BF, BKEY, AI_BW } from './bdefs';
import { UNITS, HQ, ECON, Kind, CHICKEN, RIDE, BOSS, ERSNO, type Side } from './defs';
import { navIndex, passable, lcAt, LC, cellX, cellZ, BRIDGES, type Terrain } from '../world/terrain';
import type { Flow } from './flow';
import type { Adm } from './admin';
import { UF, OM, rint, type Sim, type State, type U, type P, type Aoe, type Player, type FxEv, type Cmd } from './sim';

/** A building (State.bld). Field meanings: docs/v5/BASE.md §2. */
export interface B {
  id: number; s: Side; t: number; x: number; z: number; hp: number; mhp: number; lv: number;
  cd: number; tg: number; own: number; at: number; up: number; paid: number; f: number; v: number; hit: number;
}

/** Derived from State.bld, never part of the state: rebuilt by bldReindex(). */
export interface BIdx {
  /** id → building */
  by: Map<number, B>;
  /** nav cell → building (any kind) */
  at: Map<number, B>;
  /** nav cell → index + 1 in State.bld of the solid building there (0 = none): what moveTo reads */
  cell: Int16Array;
  /** solid buildings per side */
  sol: [number, number];
  /** per side, in State.bld order */
  side: [B[], B[]];
  /** per side: the box around its buildings [x0, z0, x1, z1] (a quick «is any building near» test) */
  box: [number[], number[]];
  /** per side, per type */
  ty: [B[][], B[][]];
  /** AI: the zone cells of each side ranked towards the enemy (from the terrain and the goal fields only) */
  spots: [number[] | null, number[] | null];
}

/** The Sim internals this module drives (private in the class; same object). */
interface Host {
  st: State; terrain: Terrain; flows: Flow[]; bi: BIdx; byId: Map<number, U>;
  emit(e: FxEv): void;
  near(x: number, z: number, r: number, fn: (i: number) => void): void;
  hurt(u: U, dmg: number): boolean;
  splash(s: Side, x: number, z: number, r: number, dmg: number, slow: number, knock: number, stun?: number): void;
  spawn(s: Side, t: number, x: number, z: number, own: number): U;
  count(s: Side): number;
  noStun(o: U): boolean; noSlow(o: U): boolean;
  steal(u: U, want: number, k: 'hit' | 'card'): number;
}
const H = (s: Sim) => s as unknown as Host;

const NB = BUILDINGS.length;
const K = BKEY;
const T_ROG = K.rogatka, T_SEB = K.sebozol, T_SPERM = K.sperm, T_TESLA = K.tesla, T_GANTEL = K.gantel, T_ANTI = K.antidron, T_CAM = K.kamera,
  T_HEN = K.kuryatnik, T_N = K.bukva_n, T_ZABOR = K.zabor, T_GRABLI = K.grabli, T_YAMA = K.yama, T_LEZHAK = K.lezhak, T_NYCHKA = K.nychka,
  T_SOBAKA = K.sobaka, T_LAREK = K.larek, T_SHAURMA = K.shaurma, T_SEYF = K.seyf, T_ZAGON = K.zagon, T_PRORAB = K.prorab,
  T_VYSHKA = K.vyshka, T_GEN = K.generator, T_SUB = K.sabvufer, T_ARB = K.arbuzomet;

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const RING = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];

// ---- index ------------------------------------------------------------------------------------
export function newBIdx(t: Terrain): BIdx {
  const lists = () => { const a: B[][] = []; for (let i = 0; i < NB; i++) a.push([]); return a; };
  return { by: new Map(), at: new Map(), cell: new Int16Array(t.nw * t.nh), sol: [0, 0], side: [[], []], box: [[0, 0, 0, 0], [0, 0, 0, 0]], ty: [lists(), lists()], spots: [null, null] };
}

/** Rebuilds Sim.bi from State.bld (every load, every placement and removal). Cheap: a few dozen buildings. */
export function bldReindex(sim: Sim): void {
  const h = H(sim), bi = h.bi, T = h.terrain, bld = h.st.bld;
  bi.by.clear(); bi.at.clear(); bi.cell.fill(0); bi.sol[0] = bi.sol[1] = 0;
  for (const s of [0, 1] as const) { bi.side[s].length = 0; for (const l of bi.ty[s]) l.length = 0; bi.box[s] = [Infinity, Infinity, -Infinity, -Infinity]; }
  for (let i = 0; i < bld.length; i++) {
    const b = bld[i], d = BUILDINGS[b.t];
    if (!d || (b.s !== 0 && b.s !== 1)) continue; // a forged entry: guard.stateShape refuses such a state before it gets here
    const c = navIndex(T, b.x, b.z);
    bi.by.set(b.id, b); bi.at.set(c, b);
    bi.side[b.s].push(b); bi.ty[b.s][b.t].push(b);
    const bx = bi.box[b.s];
    if (b.x < bx[0]) bx[0] = b.x; if (b.z < bx[1]) bx[1] = b.z; if (b.x > bx[2]) bx[2] = b.x; if (b.z > bx[3]) bx[3] = b.z;
    if (d.solid) { bi.cell[c] = i + 1; bi.sol[b.s]++; }
  }
}

// ---- geometry helpers ---------------------------------------------------------------------------
/** The nav cell under (x, z) and its centre: where a building placed at (x, z) really stands. */
export function snapCell(t: Terrain, x: number, z: number): { c: number; x: number; z: number } {
  const c = navIndex(t, x, z);
  return { c, x: cellX(t, c), z: cellZ(t, c) };
}

/**
 * Nav cells of a straight wall from (x0, z0) to (x1, z1), at most `max`: a 4-connected chain (no diagonal
 * leaks), in order from the first point. For the UI's wall drag: send the result as `cells` of one 'put'.
 */
export function wallLine(t: Terrain, x0: number, z0: number, x1: number, z1: number, max: number = BASE.line): number[] {
  const a = navIndex(t, x0, z0), b = navIndex(t, x1, z1);
  let i = a % t.nw, j = Math.floor(a / t.nw);
  const i1 = b % t.nw, j1 = Math.floor(b / t.nw);
  const di = Math.abs(i1 - i), dj = Math.abs(j1 - j), si = i1 > i ? 1 : -1, sj = j1 > j ? 1 : -1;
  const out: number[] = [j * t.nw + i];
  let err = di - dj;
  while ((i !== i1 || j !== j1) && out.length < max) {
    // one axis at a time: the axis that keeps the chain closest to the line
    if (j === j1 || (i !== i1 && err >= 0)) { i += si; err -= 2 * dj; } else { j += sj; err += 2 * di; }
    out.push(j * t.nw + i);
  }
  return out;
}

/** Level a building works at right now: a new one is 0 until finished, an upgrade counts once it is done. */
const elv = (b: B, now: number) => (b.up > now ? b.lv - 1 : b.lv);
const alive = (b: B, now: number) => b.hp > 0 && elv(b, now) >= 1;

/** Blackout («Свет яц» event, or the card on this side) or a hack: powered buildings are off. */
function dark(st: State, s: Side): boolean {
  const now = st.tick, sd = st.sides[s];
  return st.ev.black > now || sd.black > now || sd.hack > now;
}

/** Base level of side s: the level of its finished «Прорабская» (0 without one). */
export function baseLevel(sim: Sim, s: Side): number {
  const h = H(sim), now = h.st.tick;
  let lv = 0;
  for (const b of h.bi.ty[s][T_PRORAB]) if (b.hp > 0) lv = Math.max(lv, elv(b, now));
  return Math.max(0, Math.min(3, lv));
}

/** The build zone of side s: a disc of radius r around (x, z) minus the inner keep-out; rMax = r at base level 3. */
export function buildZone(sim: Sim, s: Side): { x: number; z: number; r: number; keep: number; rMax: number } {
  const p = H(sim).st.pts[s];
  return { x: p.x, z: p.z, r: BASE.zone + BASE.zoneStep * baseLevel(sim, s), keep: HQ.radius[s] + BASE.keep, rMax: BASE.zone + BASE.zoneStep * 3 };
}

/** Current price of level lv (1..3) of type t for side s (the loser's discount included). */
export function bcost(sim: Sim, s: Side, t: number, lv: number): number {
  const st = H(sim).st, c = BUILDINGS[t].cost[lv - 1];
  return st.sides[s].bdisc > st.tick ? Math.floor(c * BASE.disc) : c;
}

/** ₽ a sale gives back now: at most half of what was paid, less when damaged. */
export function refund(b: B): number { return Math.floor((BASE.refund * b.paid * Math.max(0, Math.min(b.hp, b.mhp))) / b.mhp); }
/** ₽ a full repair costs now: exactly what it adds to the refund, so no loop makes money. */
export function repairCost(b: B): number { return Math.floor(BASE.refund * b.paid) - refund(b); }

/** Buildings of side s: non-wall count and cap, wall segments and cap. */
export function bldCaps(sim: Sim, s: Side): { n: number; max: number; walls: number; wallMax: number } {
  const bi = H(sim).bi, bl = baseLevel(sim, s), walls = bi.ty[s][T_ZABOR].length;
  return { n: bi.side[s].length - walls, max: BASE.caps[bl], walls, wallMax: BASE.walls[bl] };
}

/** The best finished building of type t of side s: its eff number for its level, or 0 without one. */
export function bldEff(sim: Sim, s: Side, t: number, second = false): number {
  const h = H(sim), l = h.bi.ty[s][t];
  if (!l.length) return 0;
  const now = h.st.tick, d = BUILDINGS[t];
  let lv = 0;
  for (const b of l) if (b.hp > 0) lv = Math.max(lv, elv(b, now));
  return lv < 1 ? 0 : (second ? d.eff2! : d.eff!)[lv - 1];
}

/** «Сейф»: ₽ of side s that no theft can take. */
export function bldSafe(sim: Sim, s: Side): number {
  const h = H(sim), l = h.bi.ty[s][T_SEYF];
  if (!l.length) return 0;
  const now = h.st.tick;
  let n = 0;
  for (const b of l) { const lv = b.hp > 0 ? elv(b, now) : 0; if (lv >= 1) n += BUILDINGS[T_SEYF].eff![lv - 1]; }
  return n;
}

/** ₽ per second the buildings of side s bring (before the side-wide income multipliers). */
export function bldIncome(sim: Sim, s: Side): number {
  const h = H(sim), ty = h.bi.ty[s], now = h.st.tick;
  let inc = 0;
  for (const t of [T_LAREK, T_SHAURMA]) for (const b of ty[t]) { const lv = b.hp > 0 ? elv(b, now) : 0; if (lv >= 1) inc += BUILDINGS[t].inc![lv - 1]; }
  for (const b of ty[T_ZAGON]) {
    const lv = b.hp > 0 ? elv(b, now) : 0;
    if (lv >= 1) inc += Math.min(BUILDINGS[T_ZAGON].inc![lv - 1], BASE.zagonBase + BASE.zagonStep * Math.floor(Math.max(0, now - b.v) / BASE.zagonEvery));
  }
  return inc;
}

/** «Камера»: damage multiplier on unit u from the enemy's cameras that see it (1 = not marked). */
export function bldMark(sim: Sim, u: U): number {
  const h = H(sim), l = h.bi.ty[1 - u.s][T_CAM];
  if (!l.length) return 1;
  const st = h.st, now = st.tick, d = BUILDINGS[T_CAM];
  let m = 1;
  for (const b of l) {
    const lv = b.hp > 0 ? elv(b, now) : 0;
    if (lv < 1) continue;
    const r = d.range![lv - 1], dx = u.x - b.x, dz = u.z - b.z;
    if (dx * dx + dz * dz <= r * r && d.eff![lv - 1] > m && !dark(st, b.s)) m = d.eff![lv - 1];
  }
  return m;
}

/** A building works right now (finished, alive, powered when it needs power, its generator alive for the Тесла). */
export function bldOn(sim: Sim, b: B): boolean {
  const h = H(sim), st = h.st, d = BUILDINGS[b.t];
  if (!d || !alive(b, st.tick)) return false;
  if ((d.pw || b.t === T_GEN) && dark(st, b.s)) return false;
  if (st.adm && st.adm.frz[b.s] && d.fam !== 'eco' && d.fam !== 'sup' && d.fam !== 'wall') return false;
  return b.t !== T_TESLA || hasGen(h, b);
}

/** Side `viewer` may see building b (its own, a visible type, or a hidden one already seen). */
export function bldVisible(b: B, viewer: number): boolean { return b.s === viewer || !BUILDINGS[b.t].hid || (b.f & BF.SEEN) !== 0; }

/** The building in the nav cell under (x, z), or undefined. */
export function bldAt(sim: Sim, x: number, z: number): B | undefined { const h = H(sim); return h.bi.at.get(navIndex(h.terrain, x, z)); }

// ---- placement rules ----------------------------------------------------------------------------------
/** Squared distance from (x, z) to the segment a–b. */
function segD2(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2)) : 0;
  const dx = x - (ax + vx * t), dz = z - (az + vz * t);
  return dx * dx + dz * dz;
}

/** The ground of nav cell c can carry a building. */
function groundWhy(T: Terrain, c: number): string | null {
  const x = cellX(T, c), z = cellZ(T, c);
  if (!passable(T, x, z)) return 'Тут не построишь';
  if (lcAt(T, x, z) === LC.WATER || lcAt(T, x - 0.5, z - 0.5) === LC.WATER || lcAt(T, x + 0.5, z + 0.5) === LC.WATER
    || lcAt(T, x - 0.5, z + 0.5) === LC.WATER || lcAt(T, x + 0.5, z - 0.5) === LC.WATER) return 'В воде не строим';
  for (const b of BRIDGES) if (segD2(x, z, b.x0, b.z0, b.x1, b.z1) < 4) return 'На мосту нельзя';
  return null;
}

/**
 * May side s build type t at all right now, wherever it puts it (the build menu: grey cards and why)? Pure.
 * The checks of canBuild that do not depend on the spot: type, war over, the player's cooldown, tier, caps, money.
 */
export function canBuildType(sim: Sim, s: Side, t: number, pl?: Player): string | null {
  const h = H(sim), st = h.st, bi = h.bi;
  if (!isInt(t, 0, NB - 1) || (s !== 0 && s !== 1)) return 'Нет такой постройки';
  if (st.winner !== -1) return 'Жди следующую войну';
  if (pl && pl.bc !== undefined && pl.bc > st.tick) return 'Не так быстро';
  const d = BUILDINGS[t], bl = baseLevel(sim, s);
  if (d.tier > bl) return bl === 0 ? 'Сначала поставь Прорабскую' : `Нужна Прорабская ${d.tier}-го уровня`;
  const walls = bi.ty[s][T_ZABOR].length;
  if (d.cap === 0) { if (walls >= BASE.walls[bl]) return 'Забора хватит: подними Прорабскую'; }
  else {
    if (bi.ty[s][t].length >= d.cap) return 'Больше таких нельзя';
    if (bi.side[s].length - walls >= BASE.caps[bl]) return 'База застроена: подними Прорабскую';
  }
  if (st.sides[s].money < bcost(sim, s, t, 1)) return 'Голда не на балике';
  return null;
}

/**
 * May side s build type t at (x, z) right now? null = yes, else a clean Russian reason. A pure query: the
 * command, the AI and the placement ghost call it (every frame), so it never writes and never draws a
 * random number. pl: the placing player (its build cooldown).
 */
export function canBuild(sim: Sim, s: Side, t: number, x: number, z: number, pl?: Player): string | null {
  const h = H(sim), st = h.st, T = h.terrain, bi = h.bi;
  const tw = canBuildType(sim, s, t, pl);
  if (tw) return tw;
  const d = BUILDINGS[t], bl = baseLevel(sim, s);
  if (!isNum(x) || !isNum(z) || x < 1 || z < T.z0 + 1 || x > T.W - 1 || z > T.H - 1) return 'Тут не построишь';
  const c = navIndex(T, x, z), cx = cellX(T, c), cz = cellZ(T, c);
  const p = st.pts[s], dx = cx - p.x, dz = cz - p.z, d2 = dx * dx + dz * dz, zr = BASE.zone + BASE.zoneStep * bl, keep = HQ.radius[s] + BASE.keep;
  if (d2 > zr * zr) return 'Строй у своей высотки';
  if (d2 < keep * keep) return 'Слишком близко к высотке';
  const g = groundWhy(T, c);
  if (g) return g;
  for (let i = 2; i < st.pts.length; i++) { const q = st.pts[i], qx = cx - q.x, qz = cz - q.z; if (qx * qx + qz * qz < BASE.ptKeep * BASE.ptKeep) return 'Тут точка сбора'; }
  if (bi.at.has(c)) return 'Место занято';
  if (d.solid === 1 && !d.wall) { // a one-cell gap between solid non-wall buildings: units slip between them
    const ci = c % T.nw, cj = Math.floor(c / T.nw);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      if ((!i && !j) || ci + i < 0 || ci + i >= T.nw || cj + j < 0 || cj + j >= T.nh) continue;
      const o = bi.at.get((cj + j) * T.nw + ci + i);
      if (o) { const od = BUILDINGS[o.t]; if (od.solid === 1 && !od.wall) return 'Оставь проход'; }
    }
  }
  if (d.solid) for (const u of st.units) if (u.s !== s && u.hp > 0 && navIndex(T, u.x, u.z) === c) return 'Тут стоят чужие';
  return null;
}

/** The player with number n (Player.n), or undefined. */
function playerByN(st: State, n: number): Player | undefined {
  for (const k of Object.keys(st.players)) if (st.players[k].n === n) return st.players[k];
  return undefined;
}

const busy = (st: State, pl?: Player) => !!pl && pl.bc !== undefined && pl.bc > st.tick;

/** May side s upgrade building id now? null = yes. Anyone of the side may upgrade any of its buildings. */
export function canUp(sim: Sim, s: Side, id: number, pl?: Player): string | null {
  const h = H(sim), st = h.st, b = h.bi.by.get(id);
  if (!b || b.hp <= 0) return 'Нет такой постройки';
  if (st.winner !== -1) return 'Жди следующую войну';
  if (b.s !== s) return 'Это чужое';
  if (busy(st, pl)) return 'Не так быстро';
  if (b.up > st.tick) return 'Ещё строится';
  if (b.lv >= 3) return 'Выше некуда';
  if (b.t !== T_PRORAB && b.lv + 1 > BASE.maxLv[baseLevel(sim, s)]) return `Нужна Прорабская ${b.lv + 1}-го уровня`;
  if (st.sides[s].money < bcost(sim, s, b.t, b.lv + 1)) return 'Голда не на балике';
  return null;
}

/** May this player sell building id? Own buildings; anyone's of the side when the owner is the AI, nobody, or silent for BASE.ownerIdle. */
export function canSell(sim: Sim, s: Side, id: number, pl?: Player): string | null {
  const h = H(sim), st = h.st, b = h.bi.by.get(id);
  if (!b || b.hp <= 0) return 'Нет такой постройки';
  if (st.winner !== -1) return 'Жди следующую войну';
  if (b.s !== s) return 'Это чужое';
  if (busy(st, pl)) return 'Не так быстро';
  if (pl && b.own >= 0 && b.own !== pl.n) {
    const o = playerByN(st, b.own);
    if (o && o.s === s && st.tick - o.last <= BASE.ownerIdle) return 'Хозяин на связи: не твоё';
  }
  return null;
}

/** May side s repair building id now? null = yes. */
export function canRep(sim: Sim, s: Side, id: number, pl?: Player): string | null {
  const h = H(sim), st = h.st, b = h.bi.by.get(id);
  if (!b || b.hp <= 0) return 'Нет такой постройки';
  if (st.winner !== -1) return 'Жди следующую войну';
  if (b.s !== s) return 'Это чужое';
  if (busy(st, pl)) return 'Не так быстро';
  if (b.hp >= b.mhp) return 'И так целое';
  if (b.hit > 0 && st.tick - b.hit < BASE.repLock) return 'Сначала отбейся';
  if (st.sides[s].money < repairCost(b)) return 'Голда не на балике';
  return null;
}

/** May side s fire superweapon id at (x, z) now? null = yes. */
export function canFire(sim: Sim, s: Side, id: number, x: number, z: number, pl?: Player): string | null {
  const h = H(sim), st = h.st, T = h.terrain, b = h.bi.by.get(id);
  if (!b || b.hp <= 0) return 'Нет такой постройки';
  if (st.winner !== -1) return 'Жди следующую войну';
  if (b.s !== s) return 'Это чужое';
  if (b.t !== T_ARB) return 'Это не стреляет';
  if (busy(st, pl)) return 'Не так быстро';
  if (!alive(b, st.tick) || st.tick - b.v < BASE.arbCharge) return 'Ещё заряжается';
  if (!isNum(x) || !isNum(z) || x < 0 || z < T.z0 || x > T.W || z > T.H) return 'Тут не построишь';
  return null;
}

// ---- adding, hurting, removing -----------------------------------------------------------------------
function ev(h: Host, k: string, b: B, n = 0) { h.emit({ e: 'bld', k, id: b.id, s: b.s, t: b.t, x: b.x, z: b.z, lv: b.lv, n }); }

function add(sim: Sim, s: Side, t: number, c: number, own: number, paid: number, lv: number, done: boolean): B {
  const h = H(sim), st = h.st, T = h.terrain, d = BUILDINGS[t], now = st.tick;
  const b: B = {
    id: st.nextId++, s, t, x: cellX(T, c), z: cellZ(T, c), hp: d.hp[lv - 1], mhp: d.hp[lv - 1], lv,
    cd: 0, tg: -1, own, at: now, up: done ? 0 : now + d.bt[0], paid, f: 0, v: now, hit: 0,
  };
  st.bld.push(b);
  bldReindex(sim);
  ev(h, 'put', b, paid);
  return b;
}

/** Damage to a building (admin god mode protects the side's buildings like its units). */
export function hurtBld(sim: Sim, b: B, dmg: number): void {
  const st = H(sim).st;
  if (st.adm && st.adm.god[b.s]) return;
  b.hp -= dmg; b.hit = st.tick;
  if (b.t === T_ZAGON) b.v = st.tick; // «Бараний загон»: the herd starts over
}

/** End of the tick: destroyed buildings go, the destroyer gets the bounty, the owner's side remembers what it lost. */
export function bldCleanup(sim: Sim): void {
  const h = H(sim), st = h.st;
  let dead = false;
  for (const b of st.bld) if (b.hp <= 0) { dead = true; break; }
  if (!dead) return;
  st.bld = st.bld.filter(b => {
    if (b.hp > 0) return true;
    let n = 0;
    if (!(b.f & BF.ADM)) {
      n = Math.floor(b.paid * BASE.bounty) + 2;
      st.sides[(1 - b.s) as Side].money += n;
      st.sides[b.s].blost += b.paid;
    }
    ev(h, 'die', b, n);
    return false;
  });
  bldReindex(sim);
}

// ---- the 'bld' command ------------------------------------------------------------------------------
/** Applies a 'bld' command of player pl (Sim.apply has checked the player and the side). Invalid ones change nothing. */
export function bldApply(sim: Sim, c: Extract<Cmd, { k: 'bld' }>, pl: Player): void {
  const h = H(sim), st = h.st, T = h.terrain, s = c.s, sd = st.sides[s], now = st.tick;
  const deny = (why: string) => h.emit({ e: 'deny', p: c.p, why });
  const spent = (n: number) => { pl.bc = now + Math.max(BASE.cd, Math.ceil(n / BASE.spend)); };
  switch (c.op) {
    case 'put': {
      const t = c.b;
      if (!isInt(t, 0, NB - 1)) return;
      const d = BUILDINGS[t];
      let cells: number[];
      if (c.cells !== undefined) { // a wall line: one command, a capped list of nav cells
        if (!d.line || !Array.isArray(c.cells) || c.cells.length < 1 || c.cells.length > BASE.line || !c.cells.every(v => isInt(v, 0, T.nw * T.nh - 1))) return;
        cells = c.cells;
      } else {
        if (!isNum(c.x) || !isNum(c.z)) return;
        const why = canBuild(sim, s, t, c.x, c.z, pl); // before navIndex clamps a spot off the map into it
        if (why) { deny(why); return; }
        cells = [navIndex(T, c.x, c.z)];
      }
      let total = 0, built = 0, first: string | null = null;
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const why = canBuild(sim, s, t, cellX(T, cell), cellZ(T, cell), built === 0 ? pl : undefined);
        if (why) { first ??= why; continue; }
        const price = bcost(sim, s, t, 1);
        sd.money -= price; total += price; built++;
        add(sim, s, t, cell, pl.n, price, 1, false);
      }
      if (!built) { if (first) deny(first); return; }
      spent(total);
      return;
    }
    case 'up': {
      if (!Number.isInteger(c.n)) return;
      const why = canUp(sim, s, c.n as number, pl);
      if (why) { deny(why); return; }
      spent(upgrade(sim, h.bi.by.get(c.n as number)!));
      return;
    }
    case 'sell': {
      if (!Number.isInteger(c.n)) return;
      const why = canSell(sim, s, c.n as number, pl);
      if (why) { deny(why); return; }
      const b = h.bi.by.get(c.n as number)!, n = refund(b);
      sd.money += n;
      st.bld = st.bld.filter(o => o !== b);
      bldReindex(sim);
      pl.bc = now + BASE.sellCd;
      ev(h, 'sell', b, n);
      return;
    }
    case 'rep': {
      if (!Number.isInteger(c.n)) return;
      let total = 0, done = 0, first: string | null = null;
      const list = c.n === 0 ? h.bi.side[s].slice() : [h.bi.by.get(c.n as number)];
      for (const b of list) {
        const why = b ? canRep(sim, s, b.id, done === 0 ? pl : undefined) : 'Нет такой постройки';
        if (why || !b) { first ??= why; continue; }
        const price = repairCost(b);
        sd.money -= price; total += price; done++;
        b.hp = b.mhp;
        ev(h, 'rep', b, price);
      }
      if (!done) { if (first) deny(c.n === 0 && first === 'Сначала отбейся' ? first : c.n === 0 ? 'И так целое' : first); return; }
      spent(total);
      return;
    }
    case 'fire': {
      if (!Number.isInteger(c.n) || !isNum(c.x) || !isNum(c.z)) return;
      const why = canFire(sim, s, c.n as number, c.x, c.z, pl);
      if (why) { deny(why); return; }
      fire(h, h.bi.by.get(c.n as number)!, c.x, c.z);
      pl.bc = now + BASE.cd;
      return;
    }
  }
}

/** Starts the upgrade of b to its next level (the caller checked canUp). Returns the price paid. */
function upgrade(sim: Sim, b: B): number {
  const h = H(sim), st = h.st, d = BUILDINGS[b.t], price = bcost(sim, b.s, b.t, b.lv + 1);
  st.sides[b.s].money -= price; b.paid += price;
  const m = d.hp[b.lv]; // the next level's hp; the hp share is kept, so an upgrade is never a cheap repair
  b.hp = (b.hp * m) / b.mhp; b.mhp = m;
  b.lv++; b.up = st.tick + d.bt[b.lv - 1];
  ev(h, 'up', b, price);
  return price;
}

/** «Арбузомёт»: the strike lands at (x, z) after BASE.arbDelay ticks (State.aoe, key 'arbuz'); the charge starts over. */
function fire(h: Host, b: B, x: number, z: number) {
  const st = h.st, d = BUILDINGS[T_ARB], T = h.terrain;
  x = Math.max(0, Math.min(T.W, x)); z = Math.max(T.z0, Math.min(T.H, z));
  st.aoe.push({ s: b.s, x, z, r: d.sp!, dmg: d.dmg![b.lv - 1], hq: BASE.arbHq, at: st.tick + BASE.arbDelay, n: 1, every: 0, k: 'arbuz' });
  b.v = st.tick;
  h.emit({ e: 'shot', x: b.x, z: b.z, tx: x, tz: z, k: BASE.shotK + T_ARB, at: st.tick + BASE.arbDelay, s: b.s });
  ev(h, 'fire', b, 0);
}

// ---- units against buildings -------------------------------------------------------------------------------
/** An enemy building side s may target by order: alive and visible to it. */
export function ordBld(sim: Sim, id: unknown, s: Side): B | undefined {
  if (!Number.isInteger(id)) return undefined;
  const b = H(sim).bi.by.get(id as number);
  return b && b.hp > 0 && b.s !== s && bldVisible(b, s) ? b : undefined;
}

/**
 * Target choice once no enemy unit is in aggro: `hq` is what the old rule picked (−2 the high-rise in reach,
 * −1 nothing). Returns a building target (−10 − id) when a visible enemy building is in aggro and nearer than
 * the high-rise; the building a unit is already hitting is kept while it stays in reach («мешает — ломаем»
 * targets a wall this way). Reads only.
 */
export function bldPick(sim: Sim, u: U, aggro: number, range: number, hq: number): number {
  const h = H(sim), es = (1 - u.s) as Side, list = h.bi.side[es];
  if (!list.length) return hq;
  const bx = h.bi.box[es], m = aggro + 2;
  if (u.x < bx[0] - m || u.x > bx[2] + m || u.z < bx[1] - m || u.z > bx[3] + m) return hq; // nowhere near any of them
  const e = h.st.pts[es], ex = e.x - u.x, ez = e.z - u.z;
  const d = UNITS[u.t];
  if (u.tg <= -10) {
    const b = h.bi.by.get(-u.tg - 10);
    if (b && b.hp > 0 && b.s === es) {
      const dx = b.x - u.x, dz = b.z - u.z, r = range + d.radius + BUILDINGS[b.t].r + BASE.stick;
      if (dx * dx + dz * dz <= r * r) return u.tg;
    }
  }
  let best: B | null = null, bd = (aggro + 1) * (aggro + 1);
  for (const b of list) {
    if (b.hp <= 0) continue;
    const bdf = BUILDINGS[b.t];
    if (bdf.wall || (bdf.hid && !(b.f & BF.SEEN))) continue;
    const dx = b.x - u.x, dz = b.z - u.z, d2 = dx * dx + dz * dz;
    if (d2 < bd || (d2 === bd && best !== null && b.id < best.id)) { bd = d2; best = b; }
  }
  if (!best) return hq;
  if (hq === -2 && Math.sqrt(ex * ex + ez * ez) - HQ.radius[es] <= Math.sqrt(bd) - BUILDINGS[best.t].r) return hq;
  return -10 - best.id;
}

/** The nearest visible enemy building within r0 (+ its radius) in front of a possessed unit (60° of fx, fz), or null. */
export function bldFront(sim: Sim, u: U, r0: number, fx: number, fz: number, fl: number): B | null {
  const h = H(sim), list = h.bi.side[1 - u.s];
  let best: B | null = null, bd = Infinity;
  for (const b of list) {
    if (b.hp <= 0 || !bldVisible(b, u.s)) continue;
    const ex = b.x - u.x, ez = b.z - u.z, e2 = ex * ex + ez * ez, r = r0 + BUILDINGS[b.t].r;
    if (e2 > r * r || e2 >= bd) continue;
    if (fl > 0 && ex * fx + ez * fz < 0.5 * Math.sqrt(e2) * fl) continue;
    bd = e2; best = b;
  }
  return best;
}

/** Unit u hits building b (the twin of Sim.attackHq): ×bldg for «buildings only» units, ranged units send a projectile. */
export function attackBld(sim: Sim, u: U, b: B, dmg: number, cd: number): void {
  const h = H(sim), st = h.st, d = UNITS[u.t];
  u.cd = cd;
  if (d.noFight) return;
  if (d.bldg) dmg *= Math.min(d.bldg, BASE.bldgVs);
  if (d.proj && !(u.t === BOSS && u.s === 1)) {
    const dx = b.x - u.x, dz = b.z - u.z, l = Math.sqrt(dx * dx + dz * dz);
    const at = st.tick + Math.max(1, Math.ceil(l / d.proj));
    const k = u.t === BOSS ? 2 : d.shot !== undefined ? d.shot : u.s === 0 ? 0 : 1;
    st.proj.push({ x: u.x, z: u.z, tx: b.x, tz: b.z, tg: -1, hq: -1, s: u.s, dmg, sp: 0, slow: 0, at, k, from: st.tick, b: b.id });
    h.emit({ e: 'shot', x: u.x, z: u.z, tx: b.x, tz: b.z, k, at, s: u.s });
    return;
  }
  hurtBld(sim, b, dmg * (u.t === BOSS ? 1.5 : 1));
  if (d.steal) h.steal(u, d.steal[0], 'hit');
  h.emit({ e: 'bhit', id: b.id, x: b.x, z: b.z, s: b.s });
}

/** A projectile aimed at a building (P.b) lands. */
export function bldProj(sim: Sim, p: P): void {
  const h = H(sim), b = h.bi.by.get(p.b!);
  if (!b || b.hp <= 0) return;
  hurtBld(sim, b, p.dmg);
  h.emit({ e: 'bhit', id: b.id, x: b.x, z: b.z, s: b.s });
}

/** One pulse of area damage (State.aoe) also hits the enemy buildings in its radius: × a.hq when set (quake ×3, Арбузомёт ×0.5), else ×1. */
export function bldAoe(sim: Sim, a: Aoe): void {
  const h = H(sim), list = h.bi.side[1 - a.s];
  if (!list.length) return;
  const m = a.hq > 0 ? Math.min(a.hq, BASE.bldgVs) : 1;
  for (const b of list) {
    if (b.hp <= 0) continue;
    const dx = b.x - a.x, dz = b.z - a.z, r = a.r + BUILDINGS[b.t].r;
    if (dx * dx + dz * dz <= r * r) hurtBld(sim, b, a.dmg * m);
  }
}

/** The enemy building that refuses unit u the step to (px, pz), or null. A unit may always move inside and out of its own cell. */
function blocker(h: Host, u: U, cur: number, px: number, pz: number): B | null {
  const c = navIndex(h.terrain, px, pz);
  if (c === cur) return null;
  const v = h.bi.cell[c];
  if (!v) return null;
  const b = h.st.bld[v - 1];
  if (!b || b.s === u.s || b.hp <= 0) return null;
  if (BUILDINGS[b.t].solid === 2 && UNITS[u.t].kind !== Kind.Fast) return null; // «Шлагбаум»: vehicles only
  return b;
}

/**
 * Sim.moveTo while the enemy has solid buildings: the same full step / x only / z only slide over the
 * terrain, and enemy buildings refuse steps too. A unit stopped by a building goes for it («мешает —
 * ломаем»); a wall stops a unit at once instead of letting it crawl along (unless a player told it
 * where to walk). A ride unloads instead.
 */
export function bldMove(sim: Sim, u: U, x: number, z: number, nudge: boolean): void {
  const h = H(sim), T = h.terrain;
  const ghost = !!UNITS[u.t].fly; // flying units cross everything
  const cur = navIndex(T, u.x, u.z);
  let hit: B | null = null;
  if (passable(T, x, z)) {
    const b = ghost ? null : blocker(h, u, cur, x, z);
    if (!b) { u.x = x; u.z = z; if (!nudge) u.mv = 1; return; }
    hit = b;
    if (BUILDINGS[b.t].wall && !nudge && !(u.o && (u.o.m === OM.MOVE || u.o.m === OM.POSSESS))) { stopped(h, u, b); return; }
  }
  if (passable(T, x, u.z)) {
    const b = blocker(h, u, cur, x, u.z);
    if (!b) { u.x = x; if (!nudge) u.mv = 1; return; }
    hit ??= b;
  }
  if (passable(T, u.x, z)) {
    const b = blocker(h, u, cur, u.x, z);
    if (!b) { u.z = z; if (!nudge) u.mv = 1; return; }
    hit ??= b;
  }
  if (hit && !nudge) stopped(h, u, hit);
}

function stopped(h: Host, u: U, b: B) {
  const now = h.st.tick, d = UNITS[u.t];
  if (u.t === RIDE) { if (!(u.f & UF.UNLOADED)) u.born = Math.min(u.born, now - d.life!); return; } // unloads on its next step
  if (d.noFight || u.fr > now || u.tt > now) return;
  if (u.o && (u.o.m === OM.MOVE || u.o.m === OM.POSSESS)) return;
  u.tg = -10 - b.id;
}

// ---- towers, traps, hatcheries, heals, superweapons: once a tick, after the units moved -----------------
function hasGen(h: Host, b: B): boolean {
  const now = h.st.tick, R = BASE.genR;
  for (const g of h.bi.ty[b.s][T_GEN]) {
    if (!alive(g, now)) continue;
    const dx = g.x - b.x, dz = g.z - b.z;
    if (dx * dx + dz * dz <= R * R) return true;
  }
  return false;
}

/** Cooldown multiplier from the side's generators in reach (1 = none; they are off in the dark). */
function genMul(h: Host, b: B, isDark: boolean): number {
  if (isDark) return 1;
  const now = h.st.tick, R = BASE.genR, e = BUILDINGS[T_GEN].eff!;
  let m = 1;
  for (const g of h.bi.ty[b.s][T_GEN]) {
    const lv = g.hp > 0 ? elv(g, now) : 0;
    if (lv < 1) continue;
    const dx = g.x - b.x, dz = g.z - b.z;
    if (dx * dx + dz * dz <= R * R && e[lv - 1] < m) m = e[lv - 1];
  }
  return m;
}

/** Range multiplier from the side's «Вышка связи» in reach. */
function vyMul(h: Host, b: B, isDark: boolean): number {
  if (isDark) return 1;
  const now = h.st.tick, R = BASE.vyR, e = BUILDINGS[T_VYSHKA].eff!;
  let m = 1;
  for (const g of h.bi.ty[b.s][T_VYSHKA]) {
    const lv = g.hp > 0 ? elv(g, now) : 0;
    if (lv < 1) continue;
    const dx = g.x - b.x, dz = g.z - b.z;
    if (dx * dx + dz * dz <= R * R && e[lv - 1] > m) m = e[lv - 1];
  }
  return m;
}

/** The nearest living enemy unit of building b within [min, r] (ties: lower id). air: flying units only, else ground only. veh: vehicles only. */
function nearest(h: Host, b: B, r: number, min: number, air: boolean, veh = false): U | null {
  const us = h.st.units;
  let best = -1, bd = r * r;
  const m2 = min * min;
  h.near(b.x, b.z, r, k => {
    const o = us[k];
    if (o.s === b.s || o.hp <= 0) return;
    const od = UNITS[o.t];
    if (!!od.fly !== air || (veh && od.kind !== Kind.Fast)) return;
    const dx = o.x - b.x, dz = o.z - b.z, d2 = dx * dx + dz * dz;
    if (d2 > bd || d2 < m2) return;
    if (d2 < bd || best < 0 || o.id < us[best].id) { bd = d2; best = k; }
  });
  return best < 0 ? null : us[best];
}

/** Living enemy ground units of building b within r. */
function enemies(h: Host, b: B, r: number): U[] {
  const us = h.st.units, out: U[] = [];
  h.near(b.x, b.z, r, k => {
    const o = us[k];
    if (o.s === b.s || o.hp <= 0 || UNITS[o.t].fly) return;
    const dx = o.x - b.x, dz = o.z - b.z;
    if (dx * dx + dz * dz <= r * r) out.push(o);
  });
  return out;
}

function seen(h: Host, b: B) { if (!(b.f & BF.SEEN)) { b.f |= BF.SEEN; ev(h, 'seen', b); } }

/** Towers, traps, hatcheries, the healing kitchen and superweapons act. Runs after the units moved (uses this tick's spatial hash). */
export function bldStep(sim: Sim): void {
  const h = H(sim), st = h.st, bld = st.bld;
  if (!bld.length) return;
  const now = st.tick, frz = st.adm ? st.adm.frz : null;
  const dk = [dark(st, 0), dark(st, 1)];
  for (let i = 0; i < bld.length; i++) {
    const b = bld[i];
    if (b.hp <= 0) continue;
    if (b.up && b.up <= now) { // construction or an upgrade is done
      b.up = 0;
      if (b.lv === 1) b.v = now; // a new «Бараний загон» / superweapon starts counting; an upgrade keeps what it had
      ev(h, 'done', b);
    }
    const lv = b.up > now ? b.lv - 1 : b.lv;
    if (lv < 1) continue;
    const d = BUILDINGS[b.t];
    if (d.fam === 'wall' || (frz && frz[b.s])) continue;
    const L = lv - 1, isDark = dk[b.s];
    if (b.t === T_SUB || b.t === T_ARB) { superStep(sim, h, b, L, isDark); continue; }
    if (b.cd > now || !d.rate) continue;
    if (d.pw && isDark) { b.tg = -1; continue; }
    switch (b.t) {
      case T_ROG: case T_SEB: case T_ANTI: case T_GANTEL: {
        const o = nearest(h, b, d.range![L] * vyMul(h, b, isDark), d.min ?? 0, b.t === T_ANTI);
        if (!o) { b.tg = -1; b.cd = now + 3; break; }
        const dx = o.x - b.x, dz = o.z - b.z, at = now + Math.max(1, Math.ceil(Math.sqrt(dx * dx + dz * dz) / d.proj!)), k = BASE.shotK + b.t;
        // the mortar aims at the spot (tg −1), the others follow their target
        st.proj.push({ x: b.x, z: b.z, tx: o.x, tz: o.z, tg: b.t === T_GANTEL ? -1 : o.id, hq: -1, s: b.s, dmg: d.dmg![L], sp: d.sp ?? 0, slow: b.t === T_SEB ? d.eff![L] : 0, at, k, from: now });
        h.emit({ e: 'shot', x: b.x, z: b.z, tx: o.x, tz: o.z, k, at, s: b.s });
        b.tg = o.id; b.cd = now + Math.max(1, Math.round(d.rate[L] * genMul(h, b, isDark)));
        break;
      }
      case T_SPERM: { // a sticky stream: every hit lands at once and glues a little longer
        const o = nearest(h, b, d.range![L] * vyMul(h, b, isDark), 0, false);
        if (!o) { b.tg = -1; b.cd = now + 3; break; }
        h.hurt(o, d.dmg![L]);
        if (!h.noSlow(o)) o.slow = Math.min(now + d.eff![L] * 10, Math.max(o.slow, now + 6) + d.eff![L]);
        h.emit({ e: 'shot', x: b.x, z: b.z, tx: o.x, tz: o.z, k: BASE.shotK + b.t, at: now + 1, s: b.s });
        b.tg = o.id; b.cd = now + Math.max(1, Math.round(d.rate[L] * genMul(h, b, isDark)));
        break;
      }
      case T_TESLA: {
        if (!hasGen(h, b)) { b.tg = -1; b.cd = now + 5; break; }
        const o = nearest(h, b, d.range![L] * vyMul(h, b, isDark), 0, false);
        if (!o) { b.tg = -1; b.cd = now + 2; break; }
        seen(h, b);
        const pts = [b.x, b.z], done: number[] = [], hop = d.sp!, us = st.units;
        let cur = us.indexOf(o), dmg = d.dmg![L];
        for (let n = 0; n < 3 && cur >= 0; n++) {
          const from = us[cur];
          done.push(cur); pts.push(from.x, from.z);
          h.hurt(from, dmg);
          dmg *= n === 0 ? 0.7 : 5 / 7; // 1 → 0.7 → 0.5 of the first hit
          let nx = -1, nd = hop * hop;
          h.near(from.x, from.z, hop, k => {
            const q = us[k];
            if (q.s === b.s || q.hp <= 0 || UNITS[q.t].fly || done.includes(k)) return;
            const dx = q.x - from.x, dz = q.z - from.z, d2 = dx * dx + dz * dz;
            if (d2 > nd) return;
            if (d2 < nd || nx < 0 || q.id < us[nx].id) { nd = d2; nx = k; }
          });
          cur = nx;
        }
        h.emit({ e: 'zap', s: b.s, id: b.id, pts });
        b.tg = o.id; b.cd = now + Math.max(1, Math.round(d.rate[L] * genMul(h, b, isDark)));
        break;
      }
      case T_HEN: {
        if (!nearest(h, b, d.range![L], 0, false)) { b.cd = now + 10; break; }
        const n = d.eff![L];
        if (h.count(b.s) + n > ECON.unitCap) { b.cd = now + 20; break; }
        for (let k = 0; k < n; k++) {
          const D = RING[(k * 3 + (b.id % 8)) % 8];
          let x = b.x + D[0] * 1.8, z = b.z + D[1] * 1.8;
          if (!passable(h.terrain, x, z)) { x = b.x; z = b.z; }
          h.spawn(b.s, CHICKEN, x, z, -1);
        }
        h.emit({ e: 'summon', s: b.s, t: CHICKEN, x: b.x, z: b.z, n });
        ev(h, 'hatch', b, n);
        b.cd = now + d.rate[L];
        break;
      }
      case T_N: {
        const list = enemies(h, b, d.range![L]);
        if (list.length < BASE.nMin) { b.cd = now + 10; break; }
        let n = 0;
        for (const o of list) if (!h.noStun(o)) { o.stun = Math.max(o.stun, now + d.eff![L]); n++; }
        ev(h, 'stun', b, n);
        b.cd = now + d.rate[L];
        break;
      }
      case T_SHAURMA: { // own units nearby heal once a second
        const us = st.units, R = d.range![L], pc = d.eff![L];
        h.near(b.x, b.z, R, k => {
          const o = us[k];
          if (o.s !== b.s || o.hp <= 0 || o.hp >= o.mhp) return;
          const dx = o.x - b.x, dz = o.z - b.z;
          if (dx * dx + dz * dz <= R * R) o.hp = Math.min(o.mhp, o.hp + o.mhp * pc);
        });
        b.cd = now + d.rate[L];
        break;
      }
      case T_SOBAKA: {
        const o = nearest(h, b, d.range![L], 0, false);
        if (!o) { b.tg = -1; b.cd = now + 2; break; }
        seen(h, b);
        h.hurt(o, d.dmg![L]);
        h.emit({ e: 'hit', x: o.x, z: o.z, s: o.s, big: 0 });
        b.tg = o.id; b.cd = now + d.rate[L];
        break;
      }
      case T_GRABLI: case T_LEZHAK: { // one victim: the first to step on it (a vehicle for the speed bump)
        const o = nearest(h, b, d.range![L], 0, false, b.t === T_LEZHAK);
        if (!o) break;
        seen(h, b);
        h.hurt(o, d.dmg![L]);
        if (!h.noStun(o)) o.stun = Math.max(o.stun, now + d.eff![L]);
        h.emit({ e: 'hit', x: o.x, z: o.z, s: o.s, big: 1 });
        ev(h, 'trap', b, 1);
        b.cd = now + d.rate[L];
        break;
      }
      case T_YAMA: {
        if (!nearest(h, b, d.range![L], 0, false)) break;
        seen(h, b);
        const n = enemies(h, b, d.sp!).length;
        h.splash(b.s, b.x, b.z, d.sp!, d.dmg![L], 0, 0, d.eff![L]);
        ev(h, 'trap', b, n);
        b.cd = now + d.rate[L];
        break;
      }
      case T_NYCHKA: {
        if (enemies(h, b, d.range![L]).length < BASE.nychkaMin) break;
        seen(h, b);
        const list = enemies(h, b, d.sp!);
        for (const o of list) {
          h.hurt(o, d.dmg![L]);
          if (!UNITS[o.t].kra) o.psn = Math.max(o.psn, now + d.eff![L]);
        }
        ev(h, 'trap', b, list.length);
        b.cd = now + d.rate[L];
        break;
      }
    }
  }
}

/** «Сабвуфер» fires its wave on its own once charged; «Арбузомёт» only tells when it is ready (the 'fire' op, or the AI, fires it). */
function superStep(sim: Sim, h: Host, b: B, L: number, isDark: boolean) {
  const now = h.st.tick;
  if (b.t === T_ARB) { if (now - b.v === BASE.arbCharge) ev(h, 'charge', b); return; }
  if (now - b.v === BASE.subCharge) ev(h, 'charge', b);
  if (now - b.v < BASE.subCharge || isDark || now % 5 !== b.id % 5) return;
  const d = BUILDINGS[T_SUB], R = d.range![L], list = enemies(h, b, R);
  if (list.length < BASE.subMin) return;
  h.splash(b.s, b.x, b.z, R, d.dmg![L], 0, BASE.subKnock, BASE.subStun);
  b.v = now;
  ev(h, 'wave', b, list.length);
}

// ---- wars --------------------------------------------------------------------------------------------
/** Before Sim.newWar() replaces the sides: [the loser or −1, its «страховка» in ₽]. */
export function bldWarEnd(sim: Sim): [number, number] {
  const st = H(sim).st;
  if (st.winner === -1) return [-1, 0];
  const l = 1 - st.winner;
  return [l, Math.min(BASE.insMax, Math.floor(BASE.insPct * st.sides[l].blost))];
}

/** After Sim.newWar() made the fresh sides: surviving buildings stay, repaired and hidden again; the loser gets its insurance and a discount. */
export function bldNewWar(sim: Sim, end: [number, number]): void {
  const st = H(sim).st, now = st.tick;
  for (const b of st.bld) { b.hp = b.mhp; b.cd = 0; b.tg = -1; b.f &= ~BF.SEEN; b.hit = 0; b.v = now; }
  if (end[0] >= 0) { const sd = st.sides[end[0]]; sd.money += end[1]; sd.bdisc = now + BASE.discFor; }
  bldReindex(sim);
}

// ---- admin ---------------------------------------------------------------------------------------------
/** Admin ops bgive / bkill / bheal (src/sim/admin.ts). Returns the number for FxEv 'adm'. */
export function bldAdmin(sim: Sim, a: Adm): number {
  const h = H(sim), st = h.st, T = h.terrain;
  switch (a.op) {
    case 'bgive': {
      const s = a.s as Side;
      let c = -1;
      if (!Number.isNaN(a.x)) {
        if (a.x < 1 || a.z < T.z0 + 1 || a.x > T.W - 1 || a.z > T.H - 1) return 0;
        c = navIndex(T, a.x, a.z);
      } else for (const q of spots(sim, s)) if (!h.bi.at.has(q) && !groundWhy(T, q)) { c = q; break; }
      if (c < 0 || h.bi.at.has(c) || !passable(T, cellX(T, c), cellZ(T, c)) || st.bld.length >= 400) return 0;
      add(sim, s, a.u, c, -1, 0, a.v, true);
      return 1;
    }
    case 'bkill': {
      const r2 = Number.isNaN(a.r) ? -1 : a.r * a.r;
      let n = 0;
      for (const b of st.bld) {
        if (b.hp <= 0 || (a.s !== -1 && b.s !== a.s)) continue;
        if (r2 >= 0) { const dx = b.x - a.x, dz = b.z - a.z; if (dx * dx + dz * dz > r2) continue; }
        b.hp = 0; b.f |= BF.ADM; n++;
      }
      return n;
    }
    case 'bheal': {
      let n = 0;
      for (const b of st.bld) if (b.s === a.s && b.hp > 0) { b.hp = b.mhp; if (b.up > st.tick) b.up = st.tick; n++; }
      return n;
    }
  }
  return 0;
}

// ---- AI builder ------------------------------------------------------------------------------------------
/** Zone cells of side s (the widest zone), nearest to the enemy high-rise first by the goal field: built once per Sim from the terrain. */
function spots(sim: Sim, s: Side): number[] {
  const h = H(sim), bi = h.bi;
  const have = bi.spots[s];
  if (have) return have;
  const T = h.terrain, p = h.st.pts[s], R = BASE.zone + BASE.zoneStep * 3, f = h.flows[1 - s].dist;
  const out: number[] = [];
  const c0 = navIndex(T, p.x, p.z), i0 = c0 % T.nw, j0 = Math.floor(c0 / T.nw), n = Math.ceil(R / 2) + 1;
  for (let j = Math.max(0, j0 - n); j <= Math.min(T.nh - 1, j0 + n); j++) for (let i = Math.max(0, i0 - n); i <= Math.min(T.nw - 1, i0 + n); i++) {
    const c = j * T.nw + i, dx = cellX(T, c) - p.x, dz = cellZ(T, c) - p.z;
    if (dx * dx + dz * dz <= R * R && !groundWhy(T, c)) out.push(c);
  }
  out.sort((a, b) => f[a] - f[b] || a - b);
  bi.spots[s] = out;
  return out;
}

/** A spot for type t: towers and traps towards the enemy, walls in an arc in front, the rest behind the high-rise. Draws from rnd for variety. */
function aiSpot(sim: Sim, s: Side, t: number, skip: number): number {
  const h = H(sim), T = h.terrain, p = h.st.pts[s], d = BUILDINGS[t], list = spots(sim, s);
  const zr = BASE.zone + BASE.zoneStep * baseLevel(sim, s), keep = HQ.radius[s] + BASE.keep;
  // the generator and the relay stand among the towers they serve; the rest of the tech and the economy hide behind the high-rise
  const back = d.fam === 'eco' || d.fam === 'super' || (d.fam === 'sup' && t !== T_GEN && t !== T_VYSHKA);
  const lo = d.fam === 'trap' ? 10 : d.fam === 'wall' ? 11 : back ? keep + 0.5 : 6.5;
  const hi = d.fam === 'trap' ? zr : d.fam === 'wall' ? 13.5 : back ? 12 : 11.5;
  for (let k = 0; k < list.length; k++) {
    const c = list[back ? list.length - 1 - k : k], x = cellX(T, c), z = cellZ(T, c), dx = x - p.x, dz = z - p.z, d2 = dx * dx + dz * dz;
    if (d2 < lo * lo || d2 > hi * hi) continue;
    if (canBuild(sim, s, t, x, z) !== null) continue;
    if (t === T_TESLA && !H(sim).bi.ty[s][T_GEN].some(g => (g.x - x) * (g.x - x) + (g.z - z) * (g.z - z) <= BASE.genR * BASE.genR)) continue; // within its generator's reach
    if (skip-- > 0) continue;
    return c;
  }
  return -1;
}

/**
 * The AI's base (called from Sim.ai behind the same aiNext gate as unit buying, so an idle human side gets
 * it too): at most one action every BASE.aiEvery.. ticks, only with bank ≥ price + BASE.aiReserve, never
 * saving up — units come first. Repairs, then Прорабская → Ларёк → two Рогатки, then by weight (AI_BW),
 * upgrades among the picks. Never sells.
 */
export function bldAi(sim: Sim, s: Side): void {
  const h = H(sim), st = h.st, sd = st.sides[s], now = st.tick, bi = h.bi;
  if (now < sd.aiB) return;
  sd.aiB = now + BASE.aiEvery + rint(st, BASE.aiJit);
  // the reserve: a unit's price stays in the bank, and so does what the AI is saving for a hero or a ride (Sim.ai: aiWant)
  const bank = sd.money - BASE.aiReserve - (sd.aiWant >= 0 && now < sd.aiWantUntil ? sim.cost(s, sd.aiWant) : 0);
  if (bank <= 0) return;
  const mine = bi.side[s], ty = bi.ty[s], T = h.terrain;
  // a charged «Арбузомёт»: at the enemy closest to our high-rise, else at theirs
  for (const b of ty[T_ARB]) {
    if (!alive(b, now) || now - b.v < BASE.arbCharge) continue;
    const p = st.pts[s], e = st.pts[1 - s];
    let tx = e.x, tz = e.z, bd = 60 * 60;
    for (const u of st.units) {
      if (u.s === s || u.hp <= 0) continue;
      const dx = u.x - p.x, dz = u.z - p.z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; tx = u.x; tz = u.z; }
    }
    fire(h, b, tx, tz);
    return;
  }
  // repairs first: the worst-hit building that is no longer under fire
  for (const b of mine) {
    if (b.hp <= 0 || b.hp >= b.mhp * 0.5 || canRep(sim, s, b.id) !== null) continue;
    const price = repairCost(b);
    if (price > bank) continue;
    sd.money -= price; b.hp = b.mhp;
    ev(h, 'rep', b, price);
    return;
  }
  const bl = baseLevel(sim, s), caps = bldCaps(sim, s);
  let t = -1;
  if (!ty[T_PRORAB].length) t = T_PRORAB;
  else if (!ty[T_LAREK].length) t = T_LAREK;
  else if (ty[T_ROG].length < 2) t = T_ROG;
  let up: B | null = null;
  if (t < 0) {
    const w: number[] = [];
    let tot = 0;
    const en = st.sides[1 - s];
    for (let k = 0; k < NB; k++) {
      const d = BUILDINGS[k];
      let v = AI_BW[d.key] ?? 0;
      if (d.tier > bl || (d.cap ? ty[k].length >= d.cap || caps.n >= caps.max : ty[k].length >= Math.min(12, caps.wallMax))) v = 0;
      else if (k === T_TESLA && !ty[T_GEN].length) v = 0;
      else if (k === T_SEYF && en.hero[ERSNO] >= 0) v *= 5;
      else if (k === T_ANTI) v = st.units.some(u => u.s !== s && u.hp > 0 && UNITS[u.t].fly) ? 6 : 0;
      w.push(v); tot += v;
    }
    // upgrades: a pick of their own (the Прорабская weighs more: it opens everything else)
    const ups = mine.filter(b => canUp(sim, s, b.id) === null);
    const wu = ups.length ? 10 : 0;
    tot += wu;
    if (tot <= 0) return;
    let r = rint(st, tot);
    if (r < wu) {
      const pr = ups.find(b => b.t === T_PRORAB);
      up = pr && rint(st, 2) === 0 ? pr : ups[rint(st, ups.length)];
    } else {
      r -= wu; t = 0;
      while (r >= w[t]) { r -= w[t]; t++; }
    }
  }
  if (up) {
    if (bcost(sim, s, up.t, up.lv + 1) <= bank) upgrade(sim, up);
    return;
  }
  const price = bcost(sim, s, t, 1);
  if (price > bank) return;
  const c = aiSpot(sim, s, t, rint(st, BUILDINGS[t].fam === 'wall' ? 8 : 4));
  if (c < 0) return;
  sd.money -= price;
  add(sim, s, t, c, -2, price, 1, false);
  if (!BUILDINGS[t].line) return;
  // a wall: a short straight piece across the line from the high-rise through the first segment
  const p = st.pts[s], along = Math.abs(cellX(T, c) - p.x) > Math.abs(cellZ(T, c) - p.z) ? T.nw : 1;
  let left = Math.min(3, Math.floor((bank - price) / price));
  for (const k of [1, -1, 2, -2]) {
    if (left <= 0) break;
    const q = c + k * along;
    if (q < 0 || q >= T.nw * T.nh || canBuild(sim, s, t, cellX(T, q), cellZ(T, q)) !== null) continue;
    const pr = bcost(sim, s, t, 1);
    sd.money -= pr; left--;
    add(sim, s, t, q, -2, pr, 1, false);
  }
}

