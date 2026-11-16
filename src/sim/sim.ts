// Deterministic fixed-tick simulation. Only + - * / sqrt floor min max abs are used on
// numbers that feed back into state, so every browser replays the same war from the
// same command log.
import {
  UNITS, HQ, ECON, CARDS, VOTERS, Kind, Fx, BOSS_RANGE, BOSS_HP, BOSS_SPEED,
  MILITIA_EVERY, FIRST_VOTE, VOTE_EVERY, VOTE_LEN, WAR_RESET, BOSS_RESPAWN, type Side,
} from './defs';
import { buildFlow, flowDir, type Flow } from './flow';
import { navIndex, passable, type Terrain } from '../world/terrain';

export interface U {
  id: number; s: Side; t: number; x: number; z: number; hp: number; mhp: number;
  cd: number; tg: number; g: number; rt: number; slow: number; stun: number;
  own: number; mv: number; ab: number; hit: number; born: number;
}
export interface P {
  x: number; z: number; tx: number; tz: number; tg: number; hq: number; s: Side;
  dmg: number; sp: number; slow: number; at: number; k: number; from: number;
}
export interface Pt {
  key: string; name: string; x: number; z: number; r: number;
  kind: 0 | 1; side: -1 | 0 | 1; owner: -1 | 0 | 1; prog: number;
}
export interface SideState {
  money: number; floors: number; hq: number; focus: number; focusUntil: number;
  spd: number; dmgB: number; inc: number; regen: number; cars: number; n: number; black: number;
  wins: number; boss: number; bossCd: number; lastHuman: number; aiNext: number;
  turretCd: number; found4: number; kills: number; deployed: number; income: number;
}
export interface Vote {
  open: number; start: number; end: number; opts: number[]; focusPt: number;
  ballots: Record<string, number>; npc: number[]; npcAt: number[]; result: number; resultAt: number;
}
export interface Player { s: Side; cd: number; joined: number; last: number; n: number }
export interface State {
  v: 1; tick: number; era: number; seed: number; rng: number; nextId: number;
  units: U[]; proj: P[]; pts: Pt[]; sides: [SideState, SideState]; votes: [Vote, Vote];
  nextVote: number; nextMilitia: number; winner: -1 | 0 | 1; overAt: number;
  players: Record<string, Player>; diff: number; humanSide: -1 | 0 | 1; mp: number;
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
  | { e: 'deployed'; p: string; s: Side; u: number };

const BOSS = 5;

// ---- RNG (mulberry32, integer ops) -------------------------------------------
function rnd(st: State): number {
  let a = (st.rng = (st.rng + 0x6d2b79f5) | 0);
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}
function rint(st: State, n: number): number { return Math.floor(rnd(st) * n); }

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

  constructor(public terrain: Terrain) {
    this.hw = Math.ceil(terrain.W / 4); this.hh = Math.ceil(terrain.H / 4);
    this.head = new Int32Array(this.hw * this.hh);
    const pts = this.makePoints();
    this.flows = pts.map(p => buildFlow(terrain, p.x, p.z, p.kind === 0 ? 4 : Math.min(p.r, 6)));
  }

  makePoints(): Pt[] {
    const v = this.terrain.villages;
    const order = ['atagi', 'kurchaloy', 'novatagi', 'chechenaul', 'shali', 'avtury', 'tsotsi', 'argun'];
    return order.map(k => {
      const g = v.find(q => q.key === k)!;
      const hqSide = k === 'atagi' ? 0 : k === 'kurchaloy' ? 1 : -1;
      return {
        key: k, name: g.name, x: g.x, z: g.z,
        r: hqSide >= 0 ? HQ.zone : Math.max(6, Math.min(10, g.r * 0.45)),
        kind: hqSide >= 0 ? 0 : 1, side: hqSide as -1 | 0 | 1, owner: hqSide as -1 | 0 | 1, prog: hqSide === 0 ? -100 : hqSide === 1 ? 100 : 0,
      } as Pt;
    });
  }

  freshSide(s: Side, wins = 0): SideState {
    return {
      money: ECON.start, floors: HQ.floors[s], hq: HQ.floors[s] * HQ.floorHp[s], focus: -1, focusUntil: 0,
      spd: 0, dmgB: 0, inc: 0, regen: 0, cars: 0, n: 0, black: 0, wins, boss: -1, bossCd: 0,
      lastHuman: -100000, aiNext: 30 + s * 7, turretCd: 0, found4: 0, kills: 0, deployed: 0, income: 0,
    };
  }

  freshVote(): Vote {
    return { open: 0, start: 0, end: 0, opts: [], focusPt: -1, ballots: {}, npc: [], npcAt: [], result: -1, resultAt: -1 };
  }

  init(seed: number) {
    this.st = {
      v: 1, tick: 0, era: 1, seed, rng: seed | 0, nextId: 1, units: [], proj: [],
      pts: this.makePoints(), sides: [this.freshSide(0), this.freshSide(1)], votes: [this.freshVote(), this.freshVote()],
      nextVote: FIRST_VOTE, nextMilitia: 60, winner: -1, overAt: 0, players: {}, diff: 1, humanSide: -1, mp: 0,
    };
    this.reindex();
  }

  load(st: State) { this.st = st; this.reindex(); }
  snapshot(): State { return structuredClone(this.st); }
  reindex() { this.byId.clear(); for (const u of this.st.units) this.byId.set(u.id, u); }
  unit(id: number) { return this.byId.get(id); }

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
      const d = UNITS[c.u];
      st.sides[c.s].money -= d.cost[c.s];
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

  canDeploy(s: Side, u: number, x: number, z: number, pl?: Player): string {
    const st = this.st;
    if (u < 0 || u >= 5) return 'Нет такого юнита';
    if (pl && pl.cd > st.tick) return 'Не так быстро';
    if (st.sides[s].money < UNITS[u].cost[s]) return 'Голда не на балике';
    if (this.count(s) + UNITS[u].count > ECON.unitCap) return 'В селе больше нет пацанов';
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
      own, mv: 0, ab: 60, hit: 99, born: st.tick,
    };
    st.units.push(u);
    this.byId.set(u.id, u);
    this.emit({ e: 'spawn', id: u.id, s, t, x, z, own });
    return u;
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
    this.ai(0); this.ai(1);
    this.hash();
    this.units();
    this.projectiles();
    this.turrets();
    if (st.tick % 5 === 0) this.capture();
    this.cleanup();
    this.bosses();
    st.tick++;
  }

  private income(s: Side): number {
    const st = this.st, sd = st.sides[s];
    let owned = 0, shali = 0;
    for (const p of st.pts) if (p.kind === 1 && p.owner === s) { owned++; if (p.key === 'shali') shali = 1; }
    let inc = ECON.base + ECON.perVillage * owned + ECON.shaliBonus * shali + ECON.perFloor * sd.floors;
    if (sd.inc > st.tick) inc *= 1.5;
    if (sd.black > st.tick) inc = 0;
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

  private openVote(s: Side) {
    const st = this.st, sd = st.sides[s];
    const pool = CARDS.filter(c => (c.side === -1 || c.side === s)
      && !(c.fx === Fx.Floor && sd.floors >= HQ.maxFloors[s])
      && !(c.fx === Fx.Boss && sd.boss !== -1)
      && !(c.fx === Fx.Focus && !st.pts.some(p => p.kind === 1 && p.owner !== s)));
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
    const st = this.st, sd = st.sides[s], en = st.sides[(1 - s) as Side];
    switch (c.fx) {
      case Fx.Money: sd.money += c.v; break;
      case Fx.Floor:
        if (sd.floors < HQ.maxFloors[s]) {
          sd.floors++; sd.hq = Math.min(sd.hq + HQ.floorHp[s], sd.floors * HQ.floorHp[s]);
          this.emit({ e: 'floorUp', s, floors: sd.floors });
          if (s === 0 && sd.floors >= 4 && !sd.found4) { sd.found4 = 1; this.emit({ e: 'found4' }); }
        }
        break;
      case Fx.Focus: sd.focus = focusPt; sd.focusUntil = st.tick + 700; for (const u of st.units) if (u.s === s) u.rt = 0; break;
      case Fx.Speed: sd.spd = st.tick + c.v; break;
      case Fx.Damage: sd.dmgB = st.tick + c.v; break;
      case Fx.EnemyN: en.n = st.tick + c.v; break;
      case Fx.Heal: for (const u of st.units) if (u.s === s) u.hp = Math.min(u.mhp, u.hp + (u.mhp * c.v) / 100); break;
      case Fx.Blackout: en.black = st.tick + c.v; break;
      case Fx.FreeSquads:
        for (const p of st.pts) if (p.owner === s) this.spawnGroup(s, 0, p.x + (s ? -2 : 2), p.z + 1.5, -1);
        break;
      case Fx.Income: sd.inc = st.tick + c.v; break;
      case Fx.Regen: sd.regen = st.tick + c.v; break;
      case Fx.Boss: this.spawnBoss(s); break;
      case Fx.Cars: sd.cars = st.tick + c.v; break;
    }
  }

  // ---- AI commanders -------------------------------------------------------------
  aiActive(s: Side): boolean {
    const st = this.st;
    if (st.mp) return st.tick - st.sides[s].lastHuman > 900;
    if (st.humanSide !== s) return true;
    return st.tick - st.sides[s].lastHuman > 1200; // автопилот, если игрок отошёл
  }

  private ai(s: Side) {
    const st = this.st, sd = st.sides[s];
    if (st.tick < sd.aiNext || !this.aiActive(s)) return;
    sd.aiNext = st.tick + 22 + rint(st, 30);
    const mine = this.count(s);
    const weights = [30, 20, 22, 14, mine > 8 ? 10 : 0];
    let tot = 0; for (const w of weights) tot += w;
    let r = rint(st, tot), t = 0;
    while (r >= weights[t]) { r -= weights[t]; t++; }
    if (sd.money < UNITS[t].cost[s] + (mine < 6 ? 0 : 40)) return;
    // place at the own zone closest to what we want next
    const goal = this.pickGoal(s, st.pts[s].x, st.pts[s].z);
    let best = -1, bd = 0x7fffffff;
    for (let i = 0; i < st.pts.length; i++) {
      const p = st.pts[i];
      if (p.owner !== s) continue;
      if (p.kind === 1 && this.contested(i)) continue;
      const d = goal >= 0 ? this.flows[goal].dist[navIndex(this.terrain, p.x, p.z)] : 0;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) best = s;
    const p = st.pts[best];
    const rr = p.kind === 0 ? 6 : p.r * 0.6;
    for (let k = 0; k < 6; k++) {
      const x = p.x + (rnd(st) * 2 - 1) * rr, z = p.z + (rnd(st) * 2 - 1) * rr;
      if (!this.canDeploy(s, t, x, z)) {
        sd.money -= UNITS[t].cost[s]; sd.deployed++;
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

  pickGoal(s: Side, x: number, z: number): number {
    const st = this.st, sd = st.sides[s];
    if (sd.focus >= 0 && st.tick < sd.focusUntil && st.pts[sd.focus].owner !== s) return sd.focus;
    const cell = navIndex(this.terrain, x, z);
    let best = -1, bv = Infinity;
    for (let i = 0; i < st.pts.length; i++) {
      const p = st.pts[i];
      let w: number;
      if (p.kind === 0) { if (p.side === s) continue; w = 1.3; }
      else { if (p.owner === s) continue; w = p.owner === -1 ? 1.0 : 0.92; }
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
    const st = this.st, sd = st.sides[u.s];
    const d = UNITS[u.t];
    let dmg = d.dmg[u.s], range = d.range, spd = d.speed, cd = d.cd;
    if (u.t === BOSS) {
      range = BOSS_RANGE[u.s]; spd = BOSS_SPEED[u.s];
      if (u.s === 1 && u.hp < u.mhp * 0.5) cd = Math.floor(cd * 0.65); // перекачка
    }
    if (sd.dmgB > st.tick) dmg *= 1.3;
    if (sd.spd > st.tick) spd *= 1.4;
    if (sd.cars > st.tick && d.kind === Kind.Fast) { spd *= 1.5; dmg *= 1.5; }
    if (sd.n > st.tick) spd *= 0.5;
    if (u.slow > st.tick) spd *= 0.55;
    // Ислам's aura: +15% damage near him
    if (u.s === 0 && sd.boss >= 0 && u.t !== BOSS) {
      const b = this.byId.get(sd.boss);
      if (b) { const dx = b.x - u.x, dz = b.z - u.z; if (dx * dx + dz * dz < 64) dmg *= 1.15; }
    }
    return { dmg, range, spd, cd, d };
  }

  private units() {
    const st = this.st, us = st.units, T = this.terrain;
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      if (u.hp <= 0) continue;
      u.mv = 0;
      if (u.hit < 99) u.hit++;
      if (u.cd > 0) u.cd--;
      if (u.ab > 0) u.ab--;
      const sd = st.sides[u.s];
      if (sd.regen > st.tick && st.tick % 10 === 0) u.hp = Math.min(u.mhp, u.hp + u.mhp * 0.012);
      if (u.stun > st.tick) continue;
      const S = this.stats(u);
      // target acquisition
      const tgU = u.tg >= 0 ? this.byId.get(u.tg) : undefined;
      if ((u.tg >= 0 && (!tgU || tgU.hp <= 0)) || (st.tick + u.id) % 4 === 0) this.acquire(u, S.d.aggro);
      if (u.t === BOSS && u.ab === 0) this.bossAbility(u);
      if (S.d.kind === Kind.Heal && u.cd === 0) this.healAround(u, S.d.heal![u.s], S.range);
      // engage
      let tx = 0, tz = 0, engage = false, inRange = false;
      if (u.tg >= 0) {
        const t = this.byId.get(u.tg);
        if (t && t.hp > 0) {
          tx = t.x; tz = t.z; engage = true;
          const dx = t.x - u.x, dz = t.z - u.z;
          const reach = S.range + S.d.radius + UNITS[t.t].radius;
          inRange = dx * dx + dz * dz <= reach * reach;
          if (inRange && u.cd === 0) this.attack(u, t, S.dmg, S.cd);
        } else u.tg = -1;
      } else if (u.tg === -2) {
        const e = st.pts[1 - u.s];
        tx = e.x; tz = e.z; engage = true;
        const dx = e.x - u.x, dz = e.z - u.z;
        const reach = S.range + HQ.radius[1 - u.s] + S.d.radius;
        inRange = dx * dx + dz * dz <= reach * reach;
        if (inRange && u.cd === 0) this.attackHq(u, (1 - u.s) as Side, S.dmg, S.cd);
      }
      if (inRange) continue;
      // movement
      let dirx = 0, dirz = 0;
      if (engage) {
        const dx = tx - u.x, dz = tz - u.z, l = Math.sqrt(dx * dx + dz * dz);
        if (l > 0.001) { dirx = dx / l; dirz = dz / l; }
      } else {
        if (u.g < 0 || st.tick >= u.rt) { u.g = this.pickGoal(u.s, u.x, u.z); u.rt = st.tick + 25 + (u.id % 15); }
        if (u.g < 0) continue;
        const gp = st.pts[u.g];
        const dx = gp.x - u.x, dz = gp.z - u.z, d2 = dx * dx + dz * dz;
        const hold = gp.kind === 1 ? gp.r * 0.55 : 0;
        if (gp.kind === 1 && d2 < hold * hold) continue; // занимаем село
        if (d2 < 36) { const l = Math.sqrt(d2); dirx = dx / l; dirz = dz / l; }
        else if (flowDir(T, this.flows[u.g], u.x, u.z, this.tmp)) { dirx = this.tmp.x; dirz = this.tmp.z; }
        else { const l = Math.sqrt(d2); dirx = dx / l; dirz = dz / l; }
      }
      const c = T.navCost[navIndex(T, u.x, u.z)] || 30;
      const sp = (S.spd * 10) / c;
      this.moveTo(u, u.x + dirx * sp, u.z + dirz * sp);
    }
    // separation
    for (let i = 0; i < us.length; i++) {
      const a = us[i];
      if (a.hp <= 0) continue;
      const ra = UNITS[a.t].radius;
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
        const wa = a.t === BOSS ? 0.1 : b.t === BOSS ? 0.9 : 0.5;
        this.moveTo(a, a.x - nx * push * wa * 2, a.z - nz * push * wa * 2, true);
        this.moveTo(b, b.x + nx * push * (1 - wa) * 2, b.z + nz * push * (1 - wa) * 2, true);
      });
    }
  }

  private moveTo(u: U, x: number, z: number, nudge = false) {
    const T = this.terrain;
    if (passable(T, x, z)) { u.x = x; u.z = z; if (!nudge) u.mv = 1; return; }
    if (passable(T, x, u.z)) { u.x = x; if (!nudge) u.mv = 1; return; }
    if (passable(T, u.x, z)) { u.z = z; if (!nudge) u.mv = 1; }
  }

  private acquire(u: U, aggro: number) {
    const st = this.st, us = st.units;
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
    if (d.kind === Kind.Heal && st.sides[u.s] && dmg < 6) { this.hurt(t, dmg); return; }
    if (d.proj && !(u.t === BOSS && u.s === 1)) {
      const dx = t.x - u.x, dz = t.z - u.z, l = Math.sqrt(dx * dx + dz * dz);
      const at = st.tick + Math.max(1, Math.ceil(l / d.proj));
      const k = u.t === BOSS ? 2 : u.s === 0 ? 0 : 1;
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
    if (d.key === 'wrestler' || d.kind === Kind.Fast) this.knock(u, t, d.kind === Kind.Fast ? 0.9 : 0.45);
    this.emit({ e: 'hit', x: t.x, z: t.z, s: t.s, big: d.kind === Kind.Fast ? 1 : 0 });
  }

  private attackHq(u: U, s: Side, dmg: number, cd: number) {
    const st = this.st, d = UNITS[u.t], e = st.pts[s];
    u.cd = cd;
    if (d.proj && !(u.t === BOSS && u.s === 1)) {
      const dx = e.x - u.x, dz = e.z - u.z, l = Math.sqrt(dx * dx + dz * dz);
      const at = st.tick + Math.max(1, Math.ceil(l / d.proj));
      const k = u.t === BOSS ? 2 : u.s === 0 ? 0 : 1;
      st.proj.push({ x: u.x, z: u.z, tx: e.x, tz: e.z, tg: -1, hq: s, s: u.s, dmg, sp: 0, slow: 0, at, k, from: st.tick });
      this.emit({ e: 'shot', x: u.x, z: u.z, tx: e.x, tz: e.z, k, at, s: u.s });
      return;
    }
    this.hurtHq(s, dmg * (u.t === BOSS ? 1.5 : 1));
    this.emit({ e: 'hit', x: e.x + (u.x - e.x) * 0.3, z: e.z + (u.z - e.z) * 0.3, s, big: 1 });
  }

  private knock(a: U, t: U, f: number) {
    if (t.t === BOSS) return;
    const dx = t.x - a.x, dz = t.z - a.z, l = Math.sqrt(dx * dx + dz * dz);
    if (l < 0.001) return;
    this.moveTo(t, t.x + (dx / l) * f, t.z + (dz / l) * f, true);
  }

  private splash(s: Side, x: number, z: number, r: number, dmg: number, slow: number, knock: number, stun = 0) {
    const us = this.st.units;
    this.near(x, z, r, k => {
      const o = us[k];
      if (o.s === s || o.hp <= 0) return;
      const dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz;
      if (d2 > r * r) return;
      this.hurt(o, dmg);
      if (slow) o.slow = this.st.tick + slow;
      if (stun && o.t !== BOSS) o.stun = this.st.tick + stun;
      if (knock && o.t !== BOSS) {
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

  hurt(u: U, dmg: number) { u.hp -= dmg; u.hit = 0; }

  hurtHq(s: Side, dmg: number) {
    const sd = this.st.sides[s];
    const before = Math.ceil(sd.hq / HQ.floorHp[s]);
    sd.hq -= dmg;
    const after = Math.max(0, Math.ceil(sd.hq / HQ.floorHp[s]));
    if (after < before) { sd.floors = after; this.emit({ e: 'floor', s, floors: after }); }
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
        if (t && t.hp > 0) { this.hurt(t, p.dmg); if (p.slow) t.slow = st.tick + p.slow; this.emit({ e: 'hit', x: t.x, z: t.z, s: t.s, big: 0 }); }
      }
    }
    st.proj = keep;
  }

  private turrets() {
    const st = this.st;
    for (const s of [0, 1] as Side[]) {
      const sd = st.sides[s], p = st.pts[s];
      if (sd.turretCd > st.tick) continue;
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
        if (u.s === 0) a++; else k++;
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
    const st = this.st;
    let dead = false;
    for (const u of st.units) if (u.hp <= 0) { dead = true; break; }
    if (dead) {
      st.units = st.units.filter(u => {
        if (u.hp > 0) return true;
        this.byId.delete(u.id);
        const killer = st.sides[(1 - u.s) as Side];
        killer.kills++;
        killer.money += Math.floor(UNITS[u.t].cost[u.s] * ECON.bounty) + (u.t === BOSS ? 300 : 2);
        this.emit({ e: 'die', x: u.x, z: u.z, s: u.s, t: u.t });
        if (u.t === BOSS) {
          st.sides[u.s].boss = -1; st.sides[u.s].bossCd = st.tick + BOSS_RESPAWN;
          this.emit({ e: 'bossDown', s: u.s });
        }
        return false;
      });
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
    st.units = []; st.proj = [];
    st.pts = this.makePoints();
    st.sides = [this.freshSide(0, wins[0]), this.freshSide(1, wins[1])];
    st.sides[0].aiNext = st.tick + 30; st.sides[1].aiNext = st.tick + 37;
    st.votes = [this.freshVote(), this.freshVote()];
    st.nextVote = st.tick + FIRST_VOTE;
    st.nextMilitia = st.tick + 40;
    st.winner = -1; st.overAt = 0;
    for (const k of Object.keys(st.players)) st.players[k].cd = 0;
    this.reindex();
    this.emit({ e: 'newWar', era: st.era });
  }
}

const DIRS = [[1, 0], [0.5, 0.866], [-0.5, 0.866], [-1, 0], [-0.5, -0.866], [0.5, -0.866]];

export function cardTitle(c: typeof CARDS[number], village: string): string {
  return c.title.replace('{V}', village || 'Шали');
}

export function hashState(st: State): number {
  const s = JSON.stringify(st);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
