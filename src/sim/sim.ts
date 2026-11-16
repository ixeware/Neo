// Deterministic fixed-tick simulation. Only + - * / sqrt floor min max abs are used on
// numbers that feed back into state, so every browser replays the same war from the
// same command log.
import {
  UNITS, HQ, ECON, CARDS, VOTERS, Kind, Fx, BOSS_RANGE, BOSS_HP, BOSS_SPEED,
  MILITIA_EVERY, FIRST_VOTE, VOTE_EVERY, VOTE_LEN, WAR_RESET, BOSS_RESPAWN, type Side,
  BOSS, CHIMAEV, WOU, ADMIN, ERSNO, BEKHAN, ADAM, MOHMAD, GOLEM, RIDE, CHICKEN, HEROES,
  HERO, DONER, EVENTS, EVENT_FIRST, EVENT_EVERY, JAM_R, AI_W, unitName,
} from './defs';
import { buildFlow, flowDir, type Flow } from './flow';
import { navIndex, passable, lcAt, LC, type Terrain } from '../world/terrain';

export interface U {
  id: number; s: Side; t: number; x: number; z: number; hp: number; mhp: number;
  cd: number; tg: number; g: number; rt: number; slow: number; stun: number;
  own: number; mv: number; ab: number; hit: number; born: number;
  psn: number; // poisoned until tick («я отравился»)
  tt: number; tn: number; // taunted until tick, by unit id (WOU «Рейджбайт»)
  ld: number; // link: Мохьмад ↔ его Голем
  f: number; // UF flags
}
/** Unit flags (U.f). */
export const UF = { LAGMAN: 1, GONE: 2, UNLOADED: 4, FLEE: 8 } as const;
export interface P {
  x: number; z: number; tx: number; tz: number; tg: number; hq: number; s: Side;
  dmg: number; sp: number; slow: number; at: number; k: number; from: number;
}
/** kind: 0 high-rise (HQ), 1 village, 2 special point (Донер Бей). */
export interface Pt {
  key: string; name: string; x: number; z: number; r: number;
  kind: 0 | 1 | 2; side: -1 | 0 | 1; owner: -1 | 0 | 1; prog: number;
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
}
export interface Vote {
  open: number; start: number; end: number; opts: number[]; focusPt: number;
  ballots: Record<string, number>; npc: number[]; npcAt: number[]; result: number; resultAt: number;
}
export interface Player { s: Side; cd: number; joined: number; last: number; n: number }
/** Delayed / pulsing area damage: Землетряс pulses, Голем and Курица death bursts. */
export interface Aoe { s: Side; x: number; z: number; r: number; dmg: number; hq: number; at: number; n: number; every: number; k: string }
/** Hero away «на парах» (world event 'classes'); returns at its own HQ. */
export interface Away { s: Side; t: number; hp: number; mhp: number; back: number; ld: number; f: number }
/** World events: `next` tick and the active ones as «until» ticks. */
export interface Ev { next: number; last: string; jam: number; black: number; sale: number; friday: number; flood: number }
export interface State {
  v: 1; tick: number; era: number; seed: number; rng: number; nextId: number;
  units: U[]; proj: P[]; pts: Pt[]; sides: [SideState, SideState]; votes: [Vote, Vote];
  nextVote: number; nextMilitia: number; winner: -1 | 0 | 1; overAt: number;
  players: Record<string, Player>; diff: number; humanSide: -1 | 0 | 1; mp: number;
  aoe: Aoe[]; away: Away[]; ev: Ev;
}

export type Cmd =
  | { t: number; id: string; p: string; k: 'join'; s: Side }
  | { t: number; id: string; p: string; k: 'dep'; s: Side; u: number; x: number; z: number }
  | { t: number; id: string; p: string; k: 'vote'; s: Side; o: number }
  | { t: number; id: string; p: string; k: 'cfg'; d: number; hs: -1 | 0 | 1; mp: number };

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
  | { e: 'dodge'; x: number; z: number; s: Side };

export const PT_ARGUN = 7;
export const PT_DONER = 8;

// ---- RNG (mulberry32, integer ops) -------------------------------------------
function rnd(st: State): number {
  let a = (st.rng = (st.rng + 0x6d2b79f5) | 0);
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}
function rint(st: State, n: number): number { return Math.floor(rnd(st) * n); }

const NT = UNITS.length;
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
  private tmp = { x: 0, z: 0 };
  private donerSpot: { x: number; z: number };

  constructor(public terrain: Terrain) {
    this.hw = Math.ceil(terrain.W / 4); this.hh = Math.ceil(terrain.H / 4);
    this.head = new Int32Array(this.hw * this.hh).fill(-1);
    this.donerSpot = this.findDoner();
    const pts = this.makePoints();
    this.flows = pts.map(p => buildFlow(terrain, p.x, p.z, p.kind === 0 ? 4 : Math.min(p.r, 6)));
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
    return pts;
  }

  freshSide(s: Side, wins = 0): SideState {
    return {
      money: ECON.start, floors: HQ.floors[s], hq: HQ.floors[s] * HQ.floorHp[s], focus: -1, focusUntil: 0,
      spd: 0, dmgB: 0, inc: 0, regen: 0, cars: 0, n: 0, black: 0, wins, boss: -1, bossCd: 0,
      lastHuman: -100000, aiNext: 30 + s * 7, turretCd: 0, found4: 0, kills: 0, deployed: 0, income: 0,
      hero: filled(-1), heroCd: filled(0),
      hack: 0, poor: 0, weak: 0, sauce: 0, sauceM: 1, dodge: 0, immune: 0, skip: 0, aiWant: -1, aiWantUntil: 0,
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
      aoe: [], away: [], ev: this.freshEv(0),
    };
    this.reindex();
  }

  load(st: State) { this.st = st; this.migrate(); this.reindex(); }
  snapshot(): State { return structuredClone(this.st); }
  reindex() { this.byId.clear(); for (const u of this.st.units) this.byId.set(u.id, u); this.head.fill(-1); }
  unit(id: number) { return this.byId.get(id); }

  /** Saves from before the content update: fill in what is missing (same on every client). */
  private migrate() {
    const st = this.st as State & Record<string, unknown>;
    if (!st.aoe) st.aoe = [];
    if (!st.away) st.away = [];
    if (!st.ev) st.ev = this.freshEv(st.tick);
    if (st.pts.length < 9) st.pts.push(this.makePoints()[PT_DONER]);
    for (const s of [0, 1] as Side[]) {
      const sd = st.sides[s] as unknown as Record<string, unknown>, fr = this.freshSide(s) as unknown as Record<string, unknown>;
      for (const k of Object.keys(fr)) if (sd[k] === undefined) sd[k] = fr[k];
    }
    for (const u of st.units) if (u.psn === undefined) { u.psn = 0; u.tt = 0; u.tn = -1; u.ld = -1; u.f = 0; }
  }

  private emit(e: FxEv) { if (!this.quiet) this.fx.push(e); }

  // ---- commands --------------------------------------------------------------
  apply(c: Cmd) {
    const st = this.st;
    if (c.k === 'cfg') { st.diff = c.d; st.humanSide = c.hs; st.mp = c.mp; return; }
    if (c.k === 'join') {
      const pl = st.players[c.p];
      if (pl) pl.s = c.s; else st.players[c.p] = { s: c.s, cd: 0, joined: st.tick, last: st.tick, n: Object.keys(st.players).length };
      st.sides[c.s].lastHuman = st.tick;
      return;
    }
    const pl = st.players[c.p];
    if (!pl || pl.s !== c.s) return;
    pl.last = st.tick;
    st.sides[c.s].lastHuman = st.tick;
    if (st.winner !== -1) return;
    if (c.k === 'vote') {
      const v = st.votes[c.s];
      if (v.open && c.o >= 0 && c.o < v.opts.length) v.ballots[c.p] = c.o;
      return;
    }
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

  inZone(s: Side, x: number, z: number): boolean {
    for (const p of this.st.pts) {
      if (p.owner !== s) continue;
      const r = p.kind === 0 ? HQ.zone : p.r;
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz <= r * r) return true;
    }
    return false;
  }

  /** Current price (world event «Пятница: штурм такси» halves the Атаги taxi). */
  cost(s: Side, t: number): number {
    const c = UNITS[t].cost[s];
    return t === RIDE && s === 0 && this.st.ev.friday > this.st.tick ? Math.floor(c / 2) : c;
  }

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
    if (sd.money < this.cost(s, u)) return 'Голда не на балике';
    if (this.count(s) + d.count + (d.carry ? d.carry[s] : 0) > ECON.unitCap) return 'В селе больше нет пацанов';
    if (!this.inZone(s, x, z)) return 'Ставь возле своего села';
    if (!passable(this.terrain, x, z)) return 'Туда не пройти';
    return '';
  }

  count(s: Side) { let n = 0; for (const u of this.st.units) if (u.s === s) n++; return n; }

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
    const hp = t === BOSS ? BOSS_HP[s] : d.hp;
    const u: U = {
      id: st.nextId++, s, t, x, z, hp, mhp: hp, cd: 0, tg: -1, g: -1, rt: 0, slow: 0, stun: 0,
      own, mv: 0, ab: t === MOHMAD ? 1 : 60, hit: 99, born: st.tick, psn: 0, tt: 0, tn: -1, ld: -1, f: 0,
    };
    st.units.push(u);
    this.byId.set(u.id, u);
    if (d.hero) st.sides[s].hero[t] = u.id;
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
    this.ai(0); this.ai(1);
    this.hash();
    if (st.tick % 10 === 0) this.donerHeal();
    this.units();
    this.aoes();
    this.projectiles();
    this.turrets();
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
    if (sd.hero[WOU] >= 0) inc += HERO.wouIncome;
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
        if (p.owner !== s) continue;
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

  // ---- Сход ----------------------------------------------------------------------
  private votes() {
    const st = this.st;
    if (st.tick === st.nextVote) {
      for (const s of [0, 1] as Side[]) this.openVote(s);
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
      && !(c.fx === Fx.SkipVote && en.skip));
    const opts: number[] = [];
    while (opts.length < 3 && pool.length) {
      const i = rint(st, pool.length);
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

  private applyCard(s: Side, c: typeof CARDS[number], focusPt: number) {
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
        for (const p of st.pts) if (p.owner === s) this.spawnGroup(s, 0, p.x + (s ? -2 : 2), p.z + 1.5, -1);
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
        break;
      case Fx.Poverty: en.poor = now + c.v; break;
      case Fx.Ersno:
        if (sd.hero[ERSNO] === -1) { sd.heroCd[ERSNO] = 0; const p = this.hqSpot(s, 0); this.spawn(s, ERSNO, p.x, p.z, -1); }
        break;
      case Fx.Changans:
        for (let i = 0; i < c.v; i++) { const p = this.hqSpot(s, i * 2); this.spawn(s, 3, p.x, p.z, -1); }
        break;
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
    if (st.mp) return st.tick - st.sides[s].lastHuman > 900;
    if (st.humanSide !== s) return true;
    return st.tick - st.sides[s].lastHuman > 1200; // автопилот, если игрок отошёл
  }

  /** Hero/ride may be bought by side s right now (ignores money and place). */
  private heroOk(s: Side, t: number): boolean {
    const d = UNITS[t], sd = this.st.sides[s];
    if (!d.avail[s] || d.summon || t === BOSS) return false;
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
    const mine = this.count(s);
    let t = -1;
    if (sd.aiWant >= 0 && st.tick < sd.aiWantUntil && mine >= 6 && this.heroOk(s, sd.aiWant)) t = sd.aiWant;
    else {
      sd.aiWant = -1;
      const weights: number[] = [];
      let tot = 0;
      const W = AI_W[s];
      for (let k = 0; k < NT; k++) {
        const w = k === 4 ? (mine > 8 ? W[k] : 0) : k > 4 && (!W[k] || !this.heroOk(s, k) || (k === CHIMAEV && !this.pushing(s))) ? 0 : W[k];
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

  /** mode 0: anything; 1: villages and Донер Бей only (Адам); 2: the enemy high-rise only (Чимаев). */
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
      if (p.kind === 0) { if (p.side === s || mode === 1) continue; w = 1.3; }
      else { if (p.owner === s) continue; w = p.kind === 2 ? DONER.aiWeight : p.owner === -1 ? 1.0 : 0.92; }
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
    const j = Math.max(0, Math.min(this.hh - 1, Math.floor(z / 4)));
    return j * this.hw + i;
  }
  /** Calls fn(index) for units in cells overlapping the radius (caller filters). */
  private near(x: number, z: number, r: number, fn: (i: number) => void) {
    const i0 = Math.max(0, Math.floor((x - r) / 4)), i1 = Math.min(this.hw - 1, Math.floor((x + r) / 4));
    const j0 = Math.max(0, Math.floor((z - r) / 4)), j1 = Math.min(this.hh - 1, Math.floor((z + r) / 4));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      for (let k = this.head[j * this.hw + i]; k !== -1; k = this.nxt[k]) fn(k);
    }
  }

  // ---- units -----------------------------------------------------------------------
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
    if (sd.spd > now) spd *= 1.4;
    if (sd.cars > now && d.kind === Kind.Fast) { spd *= 1.5; dmg *= 1.5; }
    if (sd.immune <= now) {
      if (sd.n > now) spd *= 0.5;
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
    if (ev.jam > now) { const p = st.pts[PT_ARGUN], dx = p.x - u.x, dz = p.z - u.z; if (dx * dx + dz * dz < JAM_R * JAM_R) spd *= 0.3; }
    if (ev.flood > now && lcAt(this.terrain, u.x, u.z) === LC.WATER) spd *= 0.5;
    return { dmg, range, spd, cd, d };
  }

  private units() {
    const st = this.st, us = st.units, now = st.tick;
    const sec = now % 10 === 0;
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
      if (u.t === RIDE) { this.rideStep(u); continue; }
      if (u.t === ADAM) { this.adamStep(u); continue; }
      const S = this.stats(u), d = S.d;
      // target acquisition
      if (d.bldg) { // хог райдер: только здания
        const e = st.pts[1 - u.s], dx = e.x - u.x, dz = e.z - u.z, r = d.aggro + HQ.radius[1 - u.s] + 3;
        u.tg = dx * dx + dz * dz <= r * r ? -2 : -1;
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
      }
      if (u.t === WOU && (now + u.id) % HERO.tauntEvery === 0) this.taunt(u);
      if (d.kind === Kind.Heal && u.cd === 0) this.healAround(u, d.heal![u.s], S.range);
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
      }
      if (inRange) continue;
      if (engage) {
        const dx = tx - u.x, dz = tz - u.z, l = Math.sqrt(dx * dx + dz * dz);
        if (l > 0.001) this.stepDir(u, dx / l, dz / l, S.spd);
      } else this.goalMove(u, S.spd, d.bldg ? 2 : 0);
    }
    // separation
    for (let i = 0; i < us.length; i++) {
      const a = us[i];
      if (a.hp <= 0) continue;
      const ra = UNITS[a.t].radius, ma = MASS[a.t];
      this.near(a.x, a.z, 3, k => {
        if (k <= i) return;
        const b = us[k];
        if (b.hp <= 0) return;
        const rb = UNITS[b.t].radius;
        const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz, m = (ra + rb) * 0.85;
        if (d2 >= m * m) return;
        let l = Math.sqrt(d2), nx: number, nz: number;
        if (l < 0.0001) { nx = ((a.id * 7) % 3) - 1 || 1; nz = ((b.id * 5) % 3) - 1; l = 0; const q = Math.sqrt(nx * nx + nz * nz); nx /= q; nz /= q; }
        else { nx = dx / l; nz = dz / l; }
        const push = (m - l) * 0.35;
        const mb = MASS[b.t], wa = ma === mb ? 0.5 : mb / (ma + mb);
        this.moveTo(a, a.x - nx * push * wa * 2, a.z - nz * push * wa * 2, true);
        this.moveTo(b, b.x + nx * push * (1 - wa) * 2, b.z + nz * push * (1 - wa) * 2, true);
      });
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
    this.near(u.x, u.z, Math.sqrt(bd), k => {
      const o = us[k];
      if (o.s === u.s || o.hp <= 0) return;
      const dx = o.x - u.x, dz = o.z - u.z, d2 = dx * dx + dz * dz;
      if (d2 < bd || (d2 === bd && best >= 0 && o.id < us[best].id)) { bd = d2; best = k; }
    });
    if (best >= 0) { u.tg = us[best].id; return; }
    const e = st.pts[1 - u.s];
    const dx = e.x - u.x, dz = e.z - u.z, r = aggro + HQ.radius[1 - u.s] + 3;
    u.tg = dx * dx + dz * dz <= r * r ? -2 : -1;
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
    this.hurt(t, dmg);
    if (d.knock) this.knock(u, t, d.knock);
    this.emit({ e: 'hit', x: t.x, z: t.z, s: t.s, big: d.kind === Kind.Fast || MASS[u.t] > 1 ? 1 : 0 });
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
    this.emit({ e: 'hit', x: e.x + (u.x - e.x) * 0.3, z: e.z + (u.z - e.z) * 0.3, s, big: 1 });
  }

  private knock(a: U, t: U, f: number) {
    if (MASS[t.t] > 1) return;
    const dx = t.x - a.x, dz = t.z - a.z, l = Math.sqrt(dx * dx + dz * dz);
    if (l < 0.001) return;
    this.moveTo(t, t.x + (dx / l) * f, t.z + (dz / l) * f, true);
  }

  private immune(s: Side) { return this.st.sides[s].immune > this.st.tick; }

  private splash(s: Side, x: number, z: number, r: number, dmg: number, slow: number, knock: number, stun = 0) {
    const us = this.st.units;
    this.near(x, z, r, k => {
      const o = us[k];
      if (o.s === s || o.hp <= 0) return;
      const dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz;
      if (d2 > r * r) return;
      this.hurt(o, dmg);
      const imm = this.immune(o.s);
      if (slow && !imm) o.slow = this.st.tick + slow;
      if (stun && o.t !== BOSS && !imm) o.stun = this.st.tick + stun;
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

  /** WOU «Рейджбайт»: nearby enemies (not bosses, not Чимаев) must hit him. */
  private taunt(u: U) {
    const st = this.st, us = st.units, R = UNITS[u.t].aura!, until = st.tick + HERO.tauntFor;
    let n = 0;
    this.near(u.x, u.z, R, k => {
      const o = us[k];
      if (o.s === u.s || o.hp <= 0 || o.t === BOSS) return;
      const od = UNITS[o.t];
      if (od.noFight || od.bldg || od.kind === Kind.Heal) return;
      const dx = o.x - u.x, dz = o.z - u.z;
      if (dx * dx + dz * dz > R * R) return;
      o.tg = u.id; o.tt = until; o.tn = u.id; n++;
    });
    if (n) this.emit({ e: 'taunt', s: u.s, id: u.id, x: u.x, z: u.z, r: R, n });
  }

  /** админ «Н»: everybody around is marked absent and stands still. */
  private adminN(u: U) {
    const st = this.st, us = st.units, d = UNITS[u.t], R = d.abR!;
    const v = (1 - u.s) as Side;
    if (this.immune(v) || this.enemiesIn(u, R, true) < 2) { u.ab = 10; return; }
    const until = st.tick + HERO.nStun;
    let n = 0;
    this.near(u.x, u.z, R, k => {
      const o = us[k];
      if (o.s === u.s || o.hp <= 0 || o.t === BOSS) return;
      const dx = o.x - u.x, dz = o.z - u.z;
      if (dx * dx + dz * dz > R * R) return;
      o.stun = Math.max(o.stun, until); n++;
    });
    u.ab = d.abCd!;
    this.emit({ e: 'ability', s: u.s, t: u.t, id: u.id, x: u.x, z: u.z, key: 'n', r: R });
    this.emit({ e: 'stunN', s: u.s, id: u.id, x: u.x, z: u.z, r: R, n });
  }

  /** Мохьмад: «у меня Голем был всю игру». */
  private summonGolem(u: U) {
    const g = u.ld >= 0 ? this.byId.get(u.ld) : undefined;
    if (g && g.hp > 0) { u.ab = 20; return; }
    const dir = u.s === 0 ? 1 : -1;
    let x = u.x + dir * 1.6, z = u.z + 0.8;
    if (!passable(this.terrain, x, z)) { x = u.x; z = u.z; }
    const go = this.spawn(u.s, GOLEM, x, z, u.own);
    go.ld = u.id; go.g = u.g; go.rt = this.st.tick + 25;
    u.ld = go.id;
    u.ab = UNITS[u.t].abCd!;
    this.emit({ e: 'ability', s: u.s, t: u.t, id: u.id, x, z, key: 'golem', r: 0 });
    this.emit({ e: 'summon', s: u.s, t: GOLEM, x, z, n: 1 });
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
    this.goalMove(u, S.spd, 1);
  }

  hurt(u: U, dmg: number) {
    const st = this.st, sd = st.sides[u.s];
    if (sd.dodge > st.tick && rnd(st) < 0.4) { this.emit({ e: 'dodge', x: u.x, z: u.z, s: u.s }); return; }
    if (sd.hero[BEKHAN] >= 0) { // «Главное не игра, главное дисциплина»
      const b = this.byId.get(sd.hero[BEKHAN]);
      if (b) { const R = UNITS[BEKHAN].aura!, dx = b.x - u.x, dz = b.z - u.z; if (dx * dx + dz * dz < R * R) dmg *= HERO.bekhanArmor; }
    }
    u.hp -= dmg; u.hit = 0;
  }

  hurtHq(s: Side, dmg: number) {
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
      if (p.hq >= 0) { this.hurtHq(p.hq as Side, p.dmg); this.emit({ e: 'hit', x: p.tx, z: p.tz, s: p.hq as Side, big: 0 }); continue; }
      if (p.sp > 0) {
        this.splash(p.s, p.tx, p.tz, p.sp, p.dmg, p.slow, 0.3);
        this.emit({ e: 'hit', x: p.tx, z: p.tz, s: (1 - p.s) as Side, big: p.k === 2 ? 2 : 1 });
      } else {
        const t = this.byId.get(p.tg);
        if (t && t.hp > 0) { this.hurt(t, p.dmg); if (p.slow && !this.immune(t.s)) t.slow = st.tick + p.slow; this.emit({ e: 'hit', x: t.x, z: t.z, s: t.s, big: 0 }); }
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
    let dead = false;
    for (const u of st.units) if (u.hp <= 0) { dead = true; break; }
    if (dead) {
      const spill: U[] = [];
      st.units = st.units.filter(u => {
        if (u.hp > 0) return true;
        this.byId.delete(u.id);
        if (u.f & UF.GONE) { this.emit({ e: 'gone', id: u.id, s: u.s, t: u.t, x: u.x, z: u.z }); return false; }
        const d = UNITS[u.t], sd = st.sides[u.s];
        const killer = st.sides[(1 - u.s) as Side];
        killer.kills++;
        killer.money += Math.floor(d.cost[u.s] * ECON.bounty) + (u.t === BOSS ? 300 : 2);
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
          if (m && m.ld === u.id) { m.ld = -1; m.ab = Math.max(m.ab, UNITS[MOHMAD].abCd!); }
        }
        if (d.deathR) st.aoe.push({ s: u.s, x: u.x, z: u.z, r: d.deathR, dmg: d.deathDmg!, hq: 0, at: now + 1, n: 1, every: 0, k: d.key });
        if (u.t === RIDE && !(u.f & UF.UNLOADED)) spill.push(u);
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
    st.era++;
    st.units = []; st.proj = []; st.aoe = []; st.away = [];
    st.pts = this.makePoints();
    st.sides = [this.freshSide(0, wins[0]), this.freshSide(1, wins[1])];
    st.sides[0].aiNext = st.tick + 30; st.sides[1].aiNext = st.tick + 37;
    st.votes = [this.freshVote(), this.freshVote()];
    st.nextVote = st.tick + FIRST_VOTE;
    st.nextMilitia = st.tick + 40;
    st.ev = this.freshEv(st.tick);
    st.winner = -1; st.overAt = 0;
    for (const k of Object.keys(st.players)) st.players[k].cd = 0;
    this.reindex();
    this.emit({ e: 'newWar', era: st.era });
  }
}

const DIRS = [[1, 0], [0.5, 0.866], [-0.5, 0.866], [-1, 0], [-0.5, -0.866], [0.5, -0.866]];
// Heavy units push others around and are not knocked back.
const MASS = UNITS.map((d, t) => (t === BOSS ? 9 : t === GOLEM || t === ERSNO ? 4 : 1));
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
