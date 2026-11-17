// Base buildings (src/sim/bld.ts, docs/v5/BASE.md): build rules, every type in a sandbox, walls and
// «мешает — ломаем», traps, economy, upgrades / sales / repairs with a no-money-from-nothing property
// test, destruction, the AI builder, old saves, snapshots, a Session with late build commands, forged
// states, admin ops. Called from tools/simtest.ts (npx tsx tools/simtest.ts 3 7).
import { lcAt, navIndex, cellX, cellZ, LC, BRIDGES, type Terrain } from '../src/world/terrain';
import { Sim, hashState, OM, type Cmd, type State, type U, type B } from '../src/sim/sim';
import { UNITS, HQ, CHIMAEV, ERSNO, RIDE, GELIK, CHICKEN, BUILDINGS, BKEY, BASE, BF, AI_BW, bldStats, type Side } from '../src/sim/defs';
import { snapCell, wallLine, refund, repairCost, bldVisible } from '../src/sim/bld';
import { normAdm } from '../src/sim/admin';
import { Session, type Backend } from '../src/net/session';
import { validCmd } from '../src/net/shared';
import { checkState, stateShape, explained, moneyBound, MAX_BLD } from '../src/net/guard';
import { checkCmd } from '../api/_lib/proto';

export interface BaseCtx {
  terrain: Terrain;
  check: (label: string, ok: boolean, detail?: string) => void;
  /** A world with no AI, no militia, no сход, no world events and no income (both sides «в темноте»: sd.black). */
  sandbox: (seed?: number) => Sim;
  runTo: (seed: number, n: number, at?: Record<number, (s: Sim) => void>) => Sim;
  cfg: Cmd[];
  seed: number;
}

const K = BKEY, D = BUILDINGS;
let seq = 0;
const C = (s: Sim, p: string, b: Record<string, unknown>) => ({ t: s.st.tick, id: `${p}:b${String(seq++).padStart(6, '0')}`, p, ...b }) as unknown as Cmd;
const stepC = (s: Sim, ...c: Cmd[]) => { s.fx.length = 0; s.step(c.length ? c : undefined); return s.fx.slice(); };
const runN = (s: Sim, n: number) => { for (let i = 0; i < n; i++) s.step(undefined); s.fx.length = 0; };
const why = (fx: ReturnType<typeof stepC>) => { const e = fx.find(f => f.e === 'deny'); return e && e.e === 'deny' ? e.why : ''; };
const dist = (u: { x: number; z: number }, x: number, z: number) => Math.hypot(u.x - x, u.z - z);
const freeze = (s: Sim, side: Side, on = 1) => { s.st.adm ??= { frz: [0, 0], god: [0, 0], ai: [0, 0] }; s.st.adm.frz[side] = on; };
interface Priv { income(s: Side): number; ai(s: Side): void; hash(): void; newWar(): void; cardSteal(u: U): void; stats(u: U): { spd: number } }
const P = (s: Sim) => s as unknown as Priv;
const SHOT = (key: string) => BASE.shotK + K[key];

/** Checks of the base buildings; `ctx` comes from tools/simtest.ts. */
export function baseChecks(ctx: BaseCtx): void {
  const { terrain: T, check, sandbox } = ctx;
  /** sandbox() with players pa, pb (Атаги) and pk (Курчалой), rich banks; power: lights on (income flows then). */
  const box = (seed = 5, power = false): Sim => {
    const s = sandbox(seed);
    stepC(s, C(s, 'pa', { k: 'join', s: 0 }), C(s, 'pb', { k: 'join', s: 0 }), C(s, 'pk', { k: 'join', s: 1 }));
    for (const sd of s.st.sides) { sd.money = 100000; if (power) sd.black = 0; }
    return s;
  };
  /** A 'bld' command from player p (its build cooldown cleared first, unless keepCd). */
  const bld = (s: Sim, p: string, side: Side, body: Record<string, unknown>, keepCd = false) => {
    if (!keepCd && s.st.players[p]) s.st.players[p].bc = 0;
    return stepC(s, C(s, p, { k: 'bld', s: side, ...body }));
  };
  /** Admin: a finished building of `key` in the cell under (x, z). */
  const give = (s: Sim, side: Side, key: string, x: number, z: number, lv = 1): B => {
    s.apply({ t: s.st.tick, id: `adm:g${seq++}`, p: 'admin', k: 'adm', op: 'bgive', s: side, u: K[key], x, z, v: lv } as Cmd);
    return s.bldAt(x, z)!;
  };
  /** The first n cells around the high-rise of `side` where `key` may be built now, at least `gap` apart. */
  const spots = (s: Sim, side: Side, key: string, n: number, gap = 4) => {
    const p = s.st.pts[side], cand: { c: number; x: number; z: number }[] = [], out: { c: number; x: number; z: number }[] = [];
    for (let dz = -24; dz <= 24; dz += 2) for (let dx = -24; dx <= 24; dx += 2) cand.push(snapCell(T, p.x + dx, p.z + dz));
    cand.sort((a, b) => dist(a, p.x, p.z) - dist(b, p.x, p.z) || a.c - b.c);
    for (const q of cand) {
      if (out.length >= n) break;
      if (s.canBuild(side, K[key], q.x, q.z) !== null || out.some(o => Math.abs(o.x - q.x) < gap && Math.abs(o.z - q.z) < gap)) continue;
      out.push(q);
    }
    return out;
  };
  const dummy = (s: Sim, side: Side, t: number, x: number, z: number): U => { const u = s.spawn(side, t, x, z, -1); u.hp = u.mhp = 1e6; return u; };
  const shots = (fx: ReturnType<typeof stepC>, key: string) => fx.filter(e => e.e === 'shot' && e.k === SHOT(key)).length;
  const bev = (fx: ReturnType<typeof stepC>, k: string) => fx.filter(e => e.e === 'bld' && e.k === k);

  console.log('--- base building checks ---');

  // ---- the table ------------------------------------------------------------------------------
  {
    const keys = ['rogatka', 'sebozol', 'sperm', 'tesla', 'gantel', 'antidron', 'kamera', 'kuryatnik', 'bukva_n', 'zabor', 'shlagbaum', 'grabli', 'yama', 'lezhak',
      'nychka', 'sobaka', 'larek', 'shaurma', 'seyf', 'zagon', 'prorab', 'kachalka', 'garazh', 'vyshka', 'generator', 'sabvufer', 'arbuzomet'];
    check(`BUILDINGS: ${D.length} types, the contract keys in order, BKEY maps them`, D.length === keys.length && keys.every((k, i) => D[i].key === k && K[k] === i));
    check('every type: 3 costs / hp / build times, tier 0..3, a clean name and blurb, stat lines for every level',
      D.every((d, t) => d.cost.length === 3 && d.hp.length === 3 && d.bt.length === 3 && d.cost.every(c => c > 0 && Number.isInteger(c)) && d.hp.every((h, i) => h > 0 && (i === 0 || h > d.hp[i - 1]))
        && d.tier >= 0 && d.tier <= 3 && d.name.length > 2 && d.blurb.length > 8 && [1, 2, 3].every(lv => bldStats(t, lv).length >= 1 && bldStats(t, lv).every(r => r[0] && r[1])) && AI_BW[d.key] !== undefined));
    check('tier 0 holds the starter set (Рогатка, Забор, Грабли, Ларёк, Прорабская); only the Забор is a line with the wall cap',
      ['rogatka', 'zabor', 'grabli', 'larek', 'prorab'].every(k => D[K[k]].tier === 0) && D.filter(d => d.line).map(d => d.key).join() === 'zabor' && D.filter(d => d.cap === 0).map(d => d.key).join() === 'zabor');
    // all caps full, top level: income from buildings stays far below what guard.explained() tolerates
    const inc = D.reduce((n, d) => n + (d.inc ? d.inc[2] * d.cap : 0), 0);
    check('income with every economy building at its cap and level 3 is far below guard.moneyBound', inc > 5 && inc * 10 < (moneyBound(600) - moneyBound(0)) / 60, `${inc} ₽/s vs ${(moneyBound(600) - moneyBound(0)) / 60} ₽/s`);
  }

  // ---- build rules: snap, zone, every deny string, costs, caps ------------------------------------------
  {
    const s = box(), a = s.st.pts[0], k = s.st.pts[1], sd = s.st.sides[0];
    const [p1, p2, p3] = spots(s, 0, 'rogatka', 3);
    const m0 = sd.money;
    const fx = bld(s, 'pa', 0, { op: 'put', b: K.rogatka, x: p1.x + 0.7, z: p1.z - 0.9 });
    const b = s.bldAt(p1.x, p1.z);
    check('put: snapped to the centre of its nav cell (odd integers), paid at once, under construction, owned by the player',
      !!b && b.x === p1.x && b.z === p1.z && b.x % 2 === 1 && Math.abs(b.z % 2) === 1 && sd.money === m0 - D[K.rogatka].cost[0] && b.paid === D[K.rogatka].cost[0] && b.up === s.st.tick - 1 + D[K.rogatka].bt[0]
      && b.own === s.st.players.pa.n && b.lv === 1 && b.hp === D[K.rogatka].hp[0] && bev(fx, 'put').length === 1 && s.building(b.id) === b, JSON.stringify(b));
    check('put: the player waits max(5, ceil(price / 12)) ticks', s.st.players.pa.bc === s.st.tick - 1 + Math.max(BASE.cd, Math.ceil(D[K.rogatka].cost[0] / BASE.spend)));
    const d1 = why(bld(s, 'pa', 0, { op: 'put', b: K.rogatka, x: p2.x, z: p2.z }, true));
    const d2 = why(bld(s, 'pa', 0, { op: 'put', b: K.rogatka, x: p1.x - 0.5, z: p1.z + 0.5 }));
    const g = snapCell(T, p1.x + (p1.x < a.x ? -2 : 2), p1.z + (Math.abs(p1.x - a.x) < 3 ? (p1.z < a.z ? -2 : 2) : 0)); // the neighbour cell away from the high-rise
    const d3 = s.canBuild(0, K.rogatka, g.x, g.z), wallNext = s.canBuild(0, K.zabor, g.x, g.z), trapNext = s.canBuild(0, K.grabli, g.x, g.z);
    check('deny: «Не так быстро» (cooldown), «Место занято» (same cell), «Оставь проход» (next to a solid building; a wall or a trap may touch)',
      d1 === 'Не так быстро' && d2 === 'Место занято' && d3 === 'Оставь проход' && wallNext === null && trapNext === null, `${d1} / ${d2} / ${d3} / ${wallNext} / ${trapNext}`);
    // zone and ground
    let water = { x: 0, z: 0 }, wf = false;
    for (let dz = -14; dz <= 14 && !wf; dz += 2) for (let dx = -14; dx <= 14; dx += 2) {
      const q = snapCell(T, a.x + dx, a.z + dz);
      if (dist(q, a.x, a.z) < 14 && dist(q, a.x, a.z) > 6 && lcAt(T, q.x, q.z) === LC.WATER && !BRIDGES.some(br => Math.hypot(q.x - (br.x0 + br.x1) / 2, q.z - (br.z0 + br.z1) / 2) < 14)) { water = q; wf = true; break; }
    }
    const br = BRIDGES[0], onBridge = snapCell(T, br.x0 + (br.x1 - br.x0) * 0.25, br.z0 + (br.z1 - br.z0) * 0.25);
    const place = s.st.pts.slice(2).find(q => dist(q, a.x, a.z) < 14 && dist(q, a.x, a.z) > 7);
    const reasons = {
      type: s.canBuild(0, 999, p2.x, p2.z), type2: s.canBuild(0, -1, p2.x, p2.z), type3: s.canBuild(0, 1.5, p2.x, p2.z),
      far: s.canBuild(0, K.rogatka, a.x + 40, a.z), enemyBase: s.canBuild(0, K.rogatka, k.x - 8, k.z),
      hq: s.canBuild(0, K.rogatka, a.x, a.z), off: s.canBuild(0, K.rogatka, -5, a.z), nan: s.canBuild(0, K.rogatka, NaN, a.z),
      water: wf ? s.canBuild(0, K.rogatka, water.x, water.z) : 'no water cell found', bridge: s.canBuild(0, K.rogatka, onBridge.x, onBridge.z),
      place: place ? s.canBuild(0, K.rogatka, place.x, place.z) : 'no place in the zone',
      tier1: s.canBuild(0, K.sebozol, p2.x, p2.z), tier2: s.canBuild(0, K.tesla, p2.x, p2.z),
    };
    check('deny: bad type, outside the zone, the enemy base, on the high-rise, off the map, water, a bridge, a capture point, no Прорабская',
      reasons.type === 'Нет такой постройки' && reasons.type2 === 'Нет такой постройки' && reasons.type3 === 'Нет такой постройки' && reasons.far === 'Строй у своей высотки' && reasons.enemyBase === 'Строй у своей высотки'
      && reasons.hq === 'Слишком близко к высотке' && reasons.off === 'Тут не построишь' && reasons.nan === 'Тут не построишь' && reasons.water === 'В воде не строим' && reasons.bridge === 'На мосту нельзя'
      && reasons.place === 'Тут точка сбора' && reasons.tier1 === 'Сначала поставь Прорабскую' && reasons.tier2 === 'Сначала поставь Прорабскую', JSON.stringify(reasons));
    const foe = s.spawn(1, 1, p3.x + 0.3, p3.z - 0.3, -1);
    const d4 = s.canBuild(0, K.rogatka, p3.x, p3.z), trapUnder = s.canBuild(0, K.grabli, p3.x, p3.z);
    foe.hp = 0; s.step(undefined);
    sd.money = D[K.rogatka].cost[0] - 1;
    const d5 = s.canBuild(0, K.rogatka, p3.x, p3.z);
    sd.money = 100000;
    s.st.winner = 1;
    const d6 = s.canBuild(0, K.rogatka, p3.x, p3.z);
    s.st.winner = -1;
    check('deny: «Тут стоят чужие» (a trap may go under them), «Голда не на балике», «Жди следующую войну»', d4 === 'Тут стоят чужие' && trapUnder === null && d5 === 'Голда не на балике' && d6 === 'Жди следующую войну', `${d4} / ${d5} / ${d6}`);
    // per-type cap, total cap, wall cap at base level 0
    const z0 = s.buildZone(0), caps0 = s.bldCaps(0);
    check('zone at base level 0: radius 15 around the high-rise, keep-out HQ.radius + 1.6; caps 10 buildings / 16 walls',
      z0.x === a.x && z0.z === a.z && z0.r === BASE.zone && z0.keep === HQ.radius[0] + BASE.keep && z0.rMax === BASE.zone + 3 * BASE.zoneStep && caps0.max === 10 && caps0.wallMax === 16 && caps0.n === 1 && caps0.walls === 0 && s.baseLevel(0) === 0);
    for (const q of spots(s, 0, 'rogatka', 3)) bld(s, 'pa', 0, { op: 'put', b: K.rogatka, x: q.x, z: q.z });
    const q5 = spots(s, 0, 'larek', 1)[0];
    const capType = s.canBuild(0, K.rogatka, q5.x, q5.z);
    for (const q of spots(s, 0, 'larek', 3)) bld(s, 'pb', 0, { op: 'put', b: K.larek, x: q.x, z: q.z });
    for (const q of spots(s, 0, 'grabli', 3, 2)) bld(s, 'pa', 0, { op: 'put', b: K.grabli, x: q.x, z: q.z });
    const q11 = spots(s, 0, 'zabor', 1)[0];
    const capAll = s.canBuild(0, K.grabli, q11.x, q11.z), capProrab = s.canBuild(0, K.prorab, q11.x, q11.z);
    check('caps: the 5th Рогатка «Больше таких нельзя»; the 11th building at base level 0 «База застроена: подними Прорабскую» (walls do not count)',
      s.bldCount(0, K.rogatka) === 4 && capType === 'Больше таких нельзя' && s.bldCaps(0).n === 10 && capAll === 'База застроена: подними Прорабскую' && capProrab === 'База застроена: подними Прорабскую' && s.canBuild(0, K.zabor, q11.x, q11.z) === null, `${capType} / ${capAll}`);
    // a wall line: one command, a capped list of cells, 4-connected
    // a diagonal of 8 free cells somewhere in the zone
    const w0 = spots(s, 0, 'zabor', 80, 2).filter(q => wallLine(T, q.x, q.z, q.x - 8, q.z + 6).every(c => s.canBuild(0, K.zabor, cellX(T, c), cellZ(T, c)) === null));
    const line = wallLine(T, w0[0].x, w0[0].z, w0[0].x - 8, w0[0].z + 6);
    const conn = line.every((c, i) => i === 0 || Math.abs(cellX(T, c) - cellX(T, line[i - 1])) + Math.abs(cellZ(T, c) - cellZ(T, line[i - 1])) === 2);
    check('wallLine: a 4-connected chain of nav cells from the first point to the second, capped (default 16)', line.length === 8 && conn && line[0] === w0[0].c && line[7] === navIndex(T, w0[0].x - 8, w0[0].z + 6)
      && wallLine(T, a.x - 40, a.z, a.x + 40, a.z).length === BASE.line && wallLine(T, a.x, a.z, a.x, a.z).length === 1 && wallLine(T, a.x, a.z, a.x + 50, a.z + 50, 5).length === 5, line.join(' '));
    const m1 = sd.money;
    const fxw = bld(s, 'pa', 0, { op: 'put', b: K.zabor, cells: line });
    const built = line.filter(c => s.bldAt(cellX(T, c), cellZ(T, c))?.t === K.zabor).length;
    check('a wall line is one command: every free cell gets a segment, each paid for; the cooldown follows the total',
      built === line.length && bev(fxw, 'put').length === built && sd.money === m1 - built * D[K.zabor].cost[0] && s.st.players.pa.bc === s.st.tick - 1 + Math.max(BASE.cd, Math.ceil((built * D[K.zabor].cost[0]) / BASE.spend)), `${built}/${line.length}`);
    const h0 = hashState(s.st);
    s.st.players.pa.bc = 0;
    const tooLong = bld(s, 'pa', 0, { op: 'put', b: K.zabor, cells: wallLine(T, a.x - 14, a.z + 8, a.x + 20, a.z + 8, 17) });
    const notLine = bld(s, 'pa', 0, { op: 'put', b: K.larek, cells: [line[0] + 3] });
    check('a line of 17 cells, or `cells` for a building that is no wall: nothing is built', s.bldCount(0, K.zabor) === built && s.bldCount(0, K.larek) === 3 && !why(tooLong) && !why(notLine) && hashState(s.st) !== h0 /* only the tick moved */);
    for (let i = 0; i < 3 && s.bldCount(0, K.zabor) < 16; i++) { const more = spots(s, 0, 'zabor', 16 - s.bldCount(0, K.zabor), 2); bld(s, 'pa', 0, { op: 'put', b: K.zabor, cells: more.map(q => q.c) }); }
    const q17 = spots(s, 0, 'grabli', 1, 2);
    const wallCap = s.canBuild(0, K.zabor, q11.x + 2, q11.z);
    check('the 17th wall segment at base level 0: «Забора хватит: подними Прорабскую»', s.bldCount(0, K.zabor) === 16 && s.bldCaps(0).walls === 16 && wallCap === 'Забора хватит: подними Прорабскую' && q17.length === 0, `${s.bldCount(0, K.zabor)} ${wallCap}`);
  }

  // ---- Прорабская: base level, tiers, caps, zone, max level -------------------------------------------------
  {
    const s = box(), a = s.st.pts[0], sd = s.st.sides[0];
    const [pp, pr] = spots(s, 0, 'prorab', 2);
    bld(s, 'pa', 0, { op: 'put', b: K.prorab, x: pp.x, z: pp.z });
    const pb = s.bldAt(pp.x, pp.z)!;
    const before = [s.baseLevel(0), s.canBuild(0, K.sebozol, pr.x, pr.z)];
    let doneAt = -1;
    for (let i = 0; i < D[K.prorab].bt[0] + 3 && doneAt < 0; i++) { const fx = stepC(s); if (bev(fx, 'done').length) doneAt = s.st.tick - 1; }
    check('Прорабская: base level 0 while it is being built, 1 exactly bt ticks after placing («done»); tier 1 opens',
      before[0] === 0 && before[1] === 'Сначала поставь Прорабскую' && doneAt === pb.at + D[K.prorab].bt[0] && pb.up === 0 && s.baseLevel(0) === 1 && s.canBuild(0, K.sebozol, pr.x, pr.z) === null
      && s.canBuild(0, K.tesla, pr.x, pr.z) === 'Нужна Прорабская 2-го уровня' && s.canBuild(0, K.bukva_n, pr.x, pr.z) === 'Нужна Прорабская 3-го уровня');
    const edge = snapCell(T, a.x - 16, a.z + 2);
    const c1 = s.bldCaps(0), z1 = s.buildZone(0);
    check('base level 1: caps 16 / 24, zone radius 17 (a cell 16 away is in)', c1.max === 16 && c1.wallMax === 24 && z1.r === 17 && s.canBuild(0, K.rogatka, edge.x, edge.z) === null && dist(edge, a.x, a.z) > 15, `${dist(edge, a.x, a.z).toFixed(1)}`);
    bld(s, 'pa', 0, { op: 'put', b: K.rogatka, x: pr.x, z: pr.z });
    const rg = s.bldAt(pr.x, pr.z)!;
    const u0 = s.canUp(0, rg.id);
    runN(s, D[K.rogatka].bt[0] + 1);
    const u1 = s.canUp(0, rg.id);
    const m0 = sd.money;
    const fxu = bld(s, 'pa', 0, { op: 'up', n: pb.id });
    const lvDuring = s.baseLevel(0);
    check('upgrade: «Ещё строится» until built; a Рогатка cannot pass level 1 at base level 1; the Прорабская upgrades itself and keeps working at its old level meanwhile',
      u0 === 'Ещё строится' && u1 === 'Нужна Прорабская 2-го уровня' && bev(fxu, 'up').length === 1 && pb.lv === 2 && sd.money === m0 - D[K.prorab].cost[1] && pb.paid === D[K.prorab].cost[0] + D[K.prorab].cost[1]
      && pb.mhp === D[K.prorab].hp[1] && pb.hp === pb.mhp && pb.up === s.st.tick - 1 + D[K.prorab].bt[1] && lvDuring === 1, `${u0} / ${u1} / base ${lvDuring}`);
    runN(s, D[K.prorab].bt[1] + 1);
    check('…and base level 2 when the upgrade is done: tier 2, caps 23 / 32, zone 19, buildings up to level 2', s.baseLevel(0) === 2 && s.bldCaps(0).max === 23 && s.buildZone(0).r === 19
      && s.canBuild(0, K.gantel, edge.x, edge.z) === null && s.canUp(0, rg.id) === null && s.canBuild(0, K.bukva_n, edge.x, edge.z) === 'Нужна Прорабская 3-го уровня');
    bld(s, 'pa', 0, { op: 'up', n: rg.id });
    const up3 = s.canUp(0, rg.id);
    runN(s, D[K.rogatka].bt[1] + 1);
    const up3b = s.canUp(0, rg.id);
    bld(s, 'pa', 0, { op: 'up', n: pb.id }); runN(s, D[K.prorab].bt[2] + 1);
    bld(s, 'pa', 0, { op: 'up', n: rg.id }); runN(s, D[K.rogatka].bt[2] + 1);
    check('level 3 everywhere with the Прорабская at 3; then «Выше некуда»', up3 === 'Ещё строится' && up3b === 'Нужна Прорабская 3-го уровня' && s.baseLevel(0) === 3 && rg.lv === 3 && rg.mhp === D[K.rogatka].hp[2]
      && s.canUp(0, rg.id) === 'Выше некуда' && s.canUp(0, pb.id) === 'Выше некуда' && s.bldCaps(0).max === 30 && s.bldCaps(0).wallMax === 40 && s.buildZone(0).r === 21 && s.canUp(1, rg.id) === 'Это чужое' && s.canUp(0, 987654) === 'Нет такой постройки');
    // the Прорабская falls: nothing is removed, the limits drop
    pb.hp = 0; s.step(undefined);
    check('the Прорабская is destroyed: base level 0 again, buildings stay, tier 1 is closed', s.baseLevel(0) === 0 && s.building(rg.id) === rg && rg.lv === 3 && s.canBuild(0, K.sebozol, edge.x, edge.z) === 'Сначала поставь Прорабскую' && s.buildZone(0).r === 15);
  }

  // ---- invalid commands change nothing; validCmd and the server's checkCmd shapes -----------------------------
  {
    const a = box(9), b = box(9), at = a.st.pts[0];
    const sp = spots(a, 0, 'rogatka', 1)[0];
    const junk: Record<string, unknown>[] = [
      { op: 'put' }, { op: 'put', b: K.rogatka }, { op: 'put', b: 999, x: sp.x, z: sp.z }, { op: 'put', b: K.rogatka, x: NaN, z: sp.z }, { op: 'put', b: K.rogatka, x: 'a', z: sp.z },
      { op: 'put', b: K.zabor, cells: [] }, { op: 'put', b: K.zabor, cells: [-1] }, { op: 'put', b: K.zabor, cells: [1.5] }, { op: 'put', b: K.zabor, cells: 'x' }, { op: 'put', b: K.zabor, cells: [1e9] },
      { op: 'up', n: 12345 }, { op: 'up' }, { op: 'sell', n: -5 }, { op: 'sell', n: 1.5 }, { op: 'rep', n: 77 }, { op: 'rep', n: 0 }, { op: 'fire', n: 1, x: at.x, z: at.z }, { op: 'fire' },
      { op: 'nuke', n: 1 }, { op: 7 }, {},
    ];
    for (const j of junk) { a.step([C(a, 'pa', { k: 'bld', s: 0, ...j })]); b.step([C(b, 'pa', { k: 'vote', s: 0, o: 0 })]); }
    a.step([C(a, 'pk', { k: 'bld', s: 0, op: 'put', b: K.rogatka, x: sp.x, z: sp.z }), C(a, 'ghost', { k: 'bld', s: 0, op: 'put', b: K.rogatka, x: sp.x, z: sp.z })]); b.step(undefined);
    check(`${junk.length + 2} malformed / foreign / unknown 'bld' commands: nothing built, the same world as one that never saw them`, a.st.bld.length === 0 && hashState(a.st) === hashState(b.st));
    const base = { t: 5, id: 'uA:k1:0', p: 'uA', k: 'bld', s: 0 };
    check('validCmd: bld shapes pass; a bad side, op, type, id, coordinates or cell list do not',
      [{ op: 'put', b: 3, x: 1.5, z: 2 }, { op: 'put', b: 9, cells: [1, 2, 3] }, { op: 'up', n: 5 }, { op: 'sell', n: 5 }, { op: 'rep', n: 0 }, { op: 'fire', n: 5, x: 1, z: 2 }].every(c => validCmd({ ...base, ...c }))
      && ![{ op: 'put', b: 3, x: 1.5, z: 2, s: 2 }, { op: 5 }, { op: 'put', b: 1.5, x: 1, z: 1 }, { op: 'up', n: 'x' }, { op: 'put', b: 1, x: Infinity, z: 1 }, { op: 'put', b: 9, cells: [] }, { op: 'put', b: 9, cells: Array(17).fill(1) }, { op: 'put', b: 9, cells: [1.5] }, { op: 'put', b: 9, cells: 'a' }]
        .some(c => validCmd({ ...base, ...c })));
    const sv = (c: Record<string, unknown>) => checkCmd({ t: 100, id: 'pid1:x', k: 'bld', s: 0, ...c }, 'pid1', 100);
    const okPut = sv({ op: 'put', b: 3, x: 1.5, z: 2 }), okLine = sv({ op: 'put', b: 9, cells: [5, 6, 7] }), okFire = sv({ op: 'fire', n: 12, x: 3, z: 4 });
    const keys = (r: ReturnType<typeof sv>) => (r.ok ? Object.keys(r.c).sort().join() : r.why);
    check('server checkCmd: bld is rebuilt from its known fields (put, line, fire); unknown fields, ops, 17 cells, half a coordinate are refused',
      keys(okPut) === 'b,id,k,op,p,s,t,x,z' && keys(okLine) === 'b,cells,id,k,op,p,s,t' && keys(okFire) === 'id,k,n,op,p,s,t,x,z' && okLine.ok && Array.isArray(okLine.c.cells) && (okLine.c.cells as number[]).join() === '5,6,7'
      && [{ op: 'put', b: 3, x: 1, z: 2, extra: 1 }, { op: 'nuke' }, { op: 'put', b: 9, cells: Array(17).fill(1) }, { op: 'put', b: 3, x: 1 }, { op: 'put', b: 300, x: 1, z: 1 }, { op: 'up', n: -1 }, { op: 'put', b: 9, cells: [-1] }, { op: 'put', b: 3, x: 1e6, z: 1 }, {}]
        .every(c => { const r = sv(c); return !r.ok && r.why === 'shape'; }), `${keys(okPut)} | ${keys(okLine)} | ${keys(okFire)}`);
    const ordTb = checkCmd({ t: 100, id: 'pid1:o', k: 'ord', s: 0, ids: [1], m: 'attack', tb: 44 }, 'pid1', 100);
    check('server checkCmd: ord keeps tb (attack a building)', ordTb.ok && ordTb.c.tb === 44 && !checkCmd({ t: 100, id: 'pid1:o', k: 'ord', s: 0, ids: [1], m: 'attack', tb: -3 }, 'pid1', 100).ok);
  }

  // ---- Рогатка: range, damage, cooldown; construction; freeze; god mode ----------------------------------------
  {
    const s = box(), c = s.st.pts[4];
    const b = give(s, 0, 'rogatka', c.x, c.z), d = D[K.rogatka];
    freeze(s, 1);
    const far = dummy(s, 1, 1, b.x + d.range![0] + 1, b.z);
    let n = 0;
    for (let i = 0; i < 30; i++) n += shots(stepC(s), 'rogatka');
    const idle = n === 0 && b.tg === -1;
    far.hp = 0;
    const e = dummy(s, 1, 1, b.x + d.range![0] - 0.5, b.z);
    let first = -1; n = 0;
    for (let i = 0; i < 70; i++) { const k = shots(stepC(s), 'rogatka'); if (k && first < 0) first = i; n += k; }
    b.hp = 0; runN(s, 12);
    check('Рогатка: nothing out of range; in range a shot every 7 ticks, 9 damage each, it aims at its target', idle && n === 10 && e.mhp - e.hp === n * d.dmg![0] && first >= 0 && first <= 3, `${n} shots, −${e.mhp - e.hp}`);
    // under construction: inactive; then active
    const s2 = box(), sp = spots(s2, 0, 'rogatka', 1)[0];
    freeze(s2, 1);
    bld(s2, 'pa', 0, { op: 'put', b: K.rogatka, x: sp.x, z: sp.z });
    const t2 = s2.bldAt(sp.x, sp.z)!;
    const e2 = dummy(s2, 1, 1, t2.x - 5, t2.z);
    let early = 0;
    for (let i = 0; i < d.bt[0] - 2; i++) early += shots(stepC(s2), 'rogatka');
    let late = 0;
    for (let i = 0; i < 20; i++) late += shots(stepC(s2), 'rogatka');
    check('a building under construction does nothing; it starts when it is done', early === 0 && late >= 2 && s2.bldOn(t2), `${early} then ${late}`);
    freeze(s2, 0); e2.hp = 0; s2.step(undefined);
    const e3 = dummy(s2, 1, 1, t2.x - 5, t2.z);
    freeze(s2, 1, 0); freeze(s2, 0, 1);
    let frozen = 0;
    for (let i = 0; i < 20; i++) frozen += shots(stepC(s2), 'rogatka');
    check('admin freeze: the frozen side\'s towers do not fire', frozen === 0 && !s2.bldOn(t2) && e3.hp > 0);
    freeze(s2, 0, 0);
    s2.st.adm!.god[0] = 1;
    const hp0 = t2.hp;
    const hitter = s2.spawn(1, 1, t2.x - 1.6, t2.z, -1);
    runN(s2, 30);
    const godOk = t2.hp === hp0 && hitter.tg === -10 - t2.id;
    s2.st.adm!.god[0] = 0;
    runN(s2, 30);
    check('admin god mode: the side\'s buildings take no damage (units still try); without it they do', godOk && t2.hp < hp0, `${hp0} → ${t2.hp}`);
  }

  // ---- Пушка Себозола, Клеемёт, Гантелемёт, Камера, Антидрон ---------------------------------------------------
  {
    const s = box(), c = s.st.pts[4], d = D[K.sebozol];
    freeze(s, 1);
    const b = give(s, 0, 'sebozol', c.x, c.z);
    const e1 = dummy(s, 1, 0, b.x + 6, b.z), e2 = dummy(s, 1, 0, b.x + 6, b.z + 1.5), e3 = dummy(s, 1, 0, b.x + 6, b.z + 5);
    let n = 0;
    for (let i = 0; i < 12; i++) n += shots(stepC(s), 'sebozol');
    check('Пушка Себозола: the bottle splashes (2.2): both in the foam are hurt and slowed for 3 s, the one outside is not',
      n === 1 && e1.mhp - e1.hp === d.dmg![0] && e2.mhp - e2.hp === d.dmg![0] && e3.hp === e3.mhp && e1.slow > s.st.tick && e1.slow <= s.st.tick + d.eff![0] && e2.slow > s.st.tick && e3.slow === 0, `${n} shot, −${e1.mhp - e1.hp} −${e2.mhp - e2.hp} −${e3.mhp - e3.hp}`);
  }
  {
    const s = box(), c = s.st.pts[4], d = D[K.sperm];
    freeze(s, 1);
    const b = give(s, 0, 'sperm', c.x, c.z);
    const e = dummy(s, 1, 0, b.x + 5, b.z), g = dummy(s, 1, GELIK, b.x + 5.5, b.z + 3);
    runN(s, 5);
    const slow5 = e.slow - s.st.tick;
    runN(s, 40);
    const slow45 = e.slow - s.st.tick, dmg = e.mhp - e.hp;
    check('Клеемёт: a hit every 2 ticks, 3 damage each; the glue stacks (longer the longer it sprays, up to 6 s); КРА номера do not stick',
      dmg >= 21 * d.dmg![0] && dmg <= 24 * d.dmg![0] && slow5 > 6 && slow5 < 25 && slow45 > 50 && slow45 <= d.eff![0] * 10 && g.slow === 0, `−${dmg}, slow ${slow5} → ${slow45}`);
    check('…its 18+ name is a separate field; the clean name has no such word', D[K.sperm].spicy18?.name === 'Спермострел' && !/сперм/i.test(D[K.sperm].name + D[K.sperm].blurb));
  }
  {
    const s = box(), c = s.st.pts[4], d = D[K.gantel];
    freeze(s, 1);
    const b = give(s, 0, 'gantel', c.x, c.z);
    const close = dummy(s, 1, 0, b.x + d.min! - 1.5, b.z);
    let n = 0;
    for (let i = 0; i < 30; i++) n += shots(stepC(s), 'gantel');
    const none = n === 0 && close.hp === close.mhp;
    const far = dummy(s, 1, 0, b.x + 12, b.z), near2 = dummy(s, 1, 0, b.x + 12, b.z + 2);
    n = 0;
    let landed = -1;
    for (let i = 0; i < 40 && landed < 0; i++) { n += shots(stepC(s), 'gantel'); if (far.hp < far.mhp) landed = i; }
    check('Гантелемёт: not closer than 5; at 12 a slow dumbbell lands on the spot (flight ≥ 13 ticks) and hits everyone within 2.6',
      none && n === 1 && landed >= 12 && far.mhp - far.hp === d.dmg![0] && near2.mhp - near2.hp === d.dmg![0] && close.hp === close.mhp, `landed after ${landed}, −${far.mhp - far.hp}`);
    const p = s.st.proj.length;
    check('…its shot is aimed at the ground (no homing)', p === 0 || s.st.proj.every(q => q.tg === -1));
  }
  {
    const s = box(5, true), c = s.st.pts[4], d = D[K.kamera];
    freeze(s, 1);
    const cam = give(s, 0, 'kamera', c.x, c.z);
    const tower = give(s, 0, 'rogatka', c.x + 4, c.z);
    const e = dummy(s, 1, 0, c.x + 6, c.z + 1);
    const m1 = s.marked(e), out = dummy(s, 1, 0, c.x + 40, c.z);
    runN(s, 6);
    const hit1 = e.mhp - e.hp;
    s.st.ev.black = s.st.tick + 50;
    const m2 = s.marked(e);
    s.st.ev.black = 0; s.st.sides[0].hack = s.st.tick + 50;
    const m3 = s.marked(e);
    s.st.sides[0].hack = 0;
    cam.up = s.st.tick + 50; cam.lv = 1;
    const m4 = s.marked(e);
    cam.up = 0;
    check('Камера: an enemy it sees takes ×1.15 from everything (a Рогатка hit is 10.35); not out of its reach, not during a blackout or a hack, not while it is being built',
      m1 === d.eff![0] && s.marked(out) === 1 && Math.abs(hit1 - D[K.rogatka].dmg![0] * d.eff![0]) < 1e-9 && m2 === 1 && m3 === 1 && m4 === 1 && tower.tg === e.id && !D[K.kamera].dmg, `×${m1}, hit ${hit1}`);
    const cam3 = give(s, 0, 'kamera', c.x + 12, c.z, 3);
    const e3 = dummy(s, 1, 0, cam3.x + 11, cam3.z);
    check('Камера level 3: reach 12, ×1.25', s.marked(e3) === d.eff![2]);
  }
  {
    const s = box(5, true), c = s.st.pts[4], d = D[K.antidron];
    freeze(s, 1);
    const b = give(s, 0, 'antidron', c.x, c.z), rg = give(s, 0, 'rogatka', c.x + 4, c.z);
    const walker = dummy(s, 1, 0, c.x + 2, c.z + 5);
    UNITS[CHICKEN].fly = true; // no flying unit in the game yet: borrow the chicken for this check
    const bird = dummy(s, 1, CHICKEN, c.x + 3, c.z - 5);
    let anti = 0, ground = 0;
    for (let i = 0; i < 20; i++) { const fx = stepC(s); anti += shots(fx, 'antidron'); ground += shots(fx, 'rogatka'); }
    b.hp = 0; rg.hp = 0; runN(s, 8);
    const ok = anti >= 2 && ground >= 2 && bird.mhp - bird.hp === anti * d.dmg![0] && walker.mhp - walker.hp === ground * D[K.rogatka].dmg![0];
    delete UNITS[CHICKEN].fly;
    check('Антидрон: shoots only flying units; ground towers never shoot them', ok, `антидрон ${anti} → −${bird.mhp - bird.hp}, рогатка ${ground} → −${walker.mhp - walker.hp}`);
  }

  // ---- Тесла: hidden, needs a generator, chain lightning, blackout, hack ---------------------------------------------
  {
    const s = box(5, true), c = s.st.pts[4], d = D[K.tesla];
    freeze(s, 1);
    const b = give(s, 0, 'tesla', c.x, c.z);
    const e1 = dummy(s, 1, 0, b.x + 4, b.z), e2 = dummy(s, 1, 0, b.x + 6, b.z), e3 = dummy(s, 1, 0, b.x + 8, b.z), e4 = dummy(s, 1, 0, b.x + 10, b.z);
    runN(s, 20);
    const noGen = e1.hp === e1.mhp && !(b.f & BF.SEEN) && !s.bldOn(b) && !bldVisible(b, 1) && bldVisible(b, 0);
    const gen = give(s, 0, 'generator', b.x - 6, b.z);
    const fx = stepC(s);
    let zap = fx.find(e => e.e === 'zap');
    for (let i = 0; i < 6 && !zap; i++) zap = stepC(s).find(e => e.e === 'zap');
    const d1 = e1.mhp - e1.hp, d2 = e2.mhp - e2.hp, d3 = e3.mhp - e3.hp;
    check('Тесла: silent and hidden without a generator; with one it reveals itself and the lightning chains over three (38 → ×0.7 → ×0.5), not a fourth',
      noGen && !!zap && zap.e === 'zap' && zap.pts.length === 8 && (b.f & BF.SEEN) !== 0 && bldVisible(b, 1) && Math.abs(d1 - d.dmg![0]) < 1e-9 && Math.abs(d2 - d.dmg![0] * 0.7) < 1e-9 && Math.abs(d3 - d.dmg![0] * 0.5) < 1e-9
      && e4.hp === e4.mhp && s.bldOn(b), `−${d1} −${d2} −${d3.toFixed(2)} −${e4.mhp - e4.hp}`);
    const h1 = e1.hp;
    s.st.ev.black = s.st.tick + 60;
    runN(s, 40);
    const darkOk = e1.hp === h1 && !s.bldOn(b) && !s.bldOn(gen);
    s.st.ev.black = 0; runN(s, 20);
    const back = e1.hp < h1;
    const h2 = e1.hp;
    s.st.sides[0].hack = s.st.tick + 60; runN(s, 40);
    const hackOk = e1.hp === h2;
    s.st.sides[0].hack = 0;
    gen.hp = 0; runN(s, 3);
    const h3 = e1.hp; runN(s, 40);
    check('…off during «Свет яц», off while hacked, off once its generator is destroyed; on again in between', darkOk && back && hackOk && e1.hp === h3 && !s.bldOn(b));
    // hidden: enemy units ignore it until it has shown itself
    const s2 = box(5, true), c2 = s2.st.pts[4];
    const t2 = give(s2, 0, 'tesla', c2.x, c2.z);
    const w = s2.spawn(1, 1, t2.x + 3, t2.z, -1);
    stepC(s2, C(s2, 'pk', { k: 'ord', s: 1, ids: [w.id], m: 'hold' }));
    runN(s2, 12);
    const blind = w.tg === -1 && t2.hp === t2.mhp;
    const denied = stepC(s2, C(s2, 'pk', { k: 'ord', s: 1, ids: [w.id], m: 'attack', tb: t2.id }));
    const stillHold = w.o?.m === OM.HOLD && denied.length >= 0;
    t2.f |= BF.SEEN;
    runN(s2, 12);
    check('a hidden building is no target (auto or by order) until the enemy has seen it; then it is', blind && stillHold && w.tg === -10 - t2.id && t2.hp < t2.mhp, `tg ${w.tg}`);
  }

  // ---- Курятник, Вышка «Н» ---------------------------------------------------------------------------------------
  {
    const s = box(5, true), c = s.st.pts[4], d = D[K.kuryatnik];
    freeze(s, 1); freeze(s, 0, 0);
    const b = give(s, 0, 'kuryatnik', c.x, c.z);
    runN(s, 30);
    const quiet = s.countType(0, CHICKEN) === 0;
    dummy(s, 1, 1, b.x + 12, b.z);
    let hatch = 0, at1 = -1, at2 = -1;
    for (let i = 0; i < d.rate![0] + 30; i++) { const k = bev(stepC(s), 'hatch').length; if (k) { hatch += k; if (at1 < 0) at1 = i; else if (at2 < 0) at2 = i; } }
    const hens = s.st.units.filter(u => u.t === CHICKEN && u.s === 0);
    check('Курятник: quiet with nobody around; an enemy within 14 → 2 attack chickens, again every 8 s; they are ordinary units',
      quiet && hatch === 2 && at2 - at1 === d.rate![0] && hens.length + 0 >= 2 && hens.every(u => u.own === -1), `${hatch} hatches, ${hens.length} alive`);
    s.st.units = s.st.units.filter(u => u.t !== CHICKEN); s.reindex();
    for (let i = s.count(0); i < 149; i++) s.spawn(0, 0, c.x - 30, c.z, -1);
    b.cd = 0; runN(s, 30);
    check('…and never past the unit cap', s.count(0) <= 150 && s.countType(0, CHICKEN) === 0, String(s.count(0)));
  }
  {
    const s = box(5, true), c = s.st.pts[4], d = D[K.bukva_n];
    freeze(s, 1);
    const b = give(s, 0, 'bukva_n', c.x, c.z);
    const e = [dummy(s, 1, 0, b.x + 3, b.z), dummy(s, 1, 0, b.x - 3, b.z)];
    runN(s, 25);
    const two = e.every(u => u.stun === 0);
    e.push(dummy(s, 1, 0, b.x, b.z + 4));
    const g = dummy(s, 1, GELIK, b.x, b.z - 4), out = dummy(s, 1, 0, b.x + 9, b.z);
    let fx = stepC(s), tries = 0;
    while (!bev(fx, 'stun').length && tries++ < 15) fx = stepC(s);
    const now = s.st.tick - 1;
    check('Вышка «Н»: two enemies are not worth a pulse; three within 6 are stunned 1.8 s (КРА номера and whoever is outside are not); then it rests 22 s',
      two && bev(fx, 'stun').length === 1 && e.every(u => u.stun === now + d.eff![0]) && g.stun === 0 && out.stun === 0 && b.cd === now + d.rate![0], `stun until +${e[0].stun - now}`);
  }

  // ---- walls: blocking, «мешает — ломаем», own units pass; Шлагбаум ---------------------------------------------------
  {
    const s = box(), a = s.st.pts[0];
    const X = snapCell(T, a.x - 20, a.z + 30).x, Z = snapCell(T, a.x - 20, a.z + 30).z;
    const wall: B[] = [];
    for (let j = -3; j <= 3; j++) wall.push(give(s, 0, 'zabor', X, Z + j * 2));
    const friend = s.spawn(0, 1, X - 6, Z + 1, -1);
    stepC(s, C(s, 'pa', { k: 'ord', s: 0, ids: [friend.id], m: 'move', x: X + 10, z: Z + 1 }));
    runN(s, 90);
    const friendX = friend.x;
    friend.hp = 0; s.step(undefined);
    const foe = s.spawn(1, 1, X - 6, Z + 0.2, -1);
    stepC(s, C(s, 'pk', { k: 'ord', s: 1, ids: [foe.id], m: 'attackMove', x: X + 10, z: Z }));
    let tgWall = -1, maxX = -1e9;
    for (let i = 0; i < 70; i++) { s.step(undefined); maxX = Math.max(maxX, foe.x); if (foe.tg <= -10 && tgWall < 0) tgWall = -foe.tg - 10; }
    const hitW = wall.find(w => w.id === tgWall);
    check('a wall: the enemy does not get through and attacks the segment that stopped it; our own unit walks through it',
      maxX < X - 1 && !!hitW && hitW.hp < hitW.mhp && friendX > X + 3 && s.bi.sol[0] === 7, `enemy max x ${(maxX - X).toFixed(2)} from the wall, friend ${(friendX - X).toFixed(1)}, wall ${hitW?.hp}`);
    let broke = -1;
    const mb = s.st.sides[1].money;
    for (let i = 0; i < 260 && broke < 0; i++) { const fx = stepC(s); if (bev(fx, 'die').length) broke = i; }
    const m1 = s.st.sides[1].money;
    runN(s, 80);
    check('…it breaks the segment (bounty to the breaker\'s side) and walks on through the gap', broke > 0 && s.building(tgWall) === undefined && foe.x > X + 3 && s.bi.sol[0] === 6 && m1 === mb + 2, `broke after ${broke + 70} ticks, x ${(foe.x - X).toFixed(1)}`);
    // pushed and knocked units never end up beyond a wall; a unit inside a cell that gets a wall may walk out
    const s2 = box(), a2 = s2.st.pts[0];
    const q = snapCell(T, a2.x - 20, a2.z + 30);
    const inside = s2.spawn(1, 1, q.x + 0.3, q.z + 0.2, -1);
    const w2 = give(s2, 0, 'zabor', q.x, q.z);
    stepC(s2, C(s2, 'pk', { k: 'ord', s: 1, ids: [inside.id], m: 'move', x: q.x + 12, z: q.z }));
    runN(s2, 40);
    check('a unit standing in a cell when a wall appears there walks out of it', !!w2 && dist(inside, q.x, q.z) > 5, dist(inside, q.x, q.z).toFixed(1));
  }
  {
    const s = box(5), a = s.st.pts[0];
    const q = snapCell(T, a.x - 20, a.z + 30);
    const bar = give(s, 0, 'shlagbaum', q.x, q.z);
    const walker = s.spawn(1, 1, q.x - 5, q.z + 0.1, -1), car = s.spawn(1, 3, q.x - 5, q.z - 0.1, -1);
    stepC(s, C(s, 'pk', { k: 'ord', s: 1, ids: [walker.id], m: 'move', x: q.x + 10, z: q.z + 0.1 }), C(s, 'pk', { k: 'ord', s: 1, ids: [car.id], m: 'attackMove', x: q.x + 10, z: q.z - 0.1 }));
    let carMax = -1e9;
    for (let i = 0; i < 50; i++) { s.step(undefined); carMax = Math.max(carMax, car.x); }
    check('Шлагбаум: a walker passes, a car does not and rams the bar', walker.x > q.x + 3 && carMax < q.x - 0.9 && car.tg === -10 - bar.id && bar.hp < bar.mhp, `walker ${(walker.x - q.x).toFixed(1)}, car ${(carMax - q.x).toFixed(2)}`);
    // a ride stopped by a wall unloads
    const s2 = box(5), a2 = s2.st.pts[0];
    const q2 = snapCell(T, a2.x - 20, a2.z + 30);
    for (let j = -4; j <= 4; j++) give(s2, 0, 'zabor', q2.x, q2.z + j * 2);
    freeze(s2, 0);
    const ride = s2.spawn(1, RIDE, q2.x - 4, q2.z, -1);
    ride.g = 0; ride.rt = 1e9; // heads for the Атаги high-rise, east of the wall
    let unloaded = -1;
    for (let i = 0; i < 60 && unloaded < 0; i++) { const fx = stepC(s2); if (fx.some(e => e.e === 'unload')) unloaded = i; }
    check('a ride stopped by a wall unloads right there', unloaded >= 0 && unloaded < 40 && ride.x < q2.x - 0.9, `after ${unloaded} ticks at ${(ride.x - q2.x).toFixed(1)}`);
  }

  // ---- auto targets: units first, then the nearer of a building and the high-rise; Чимаев prefers buildings --------------
  {
    const s = box(), a = s.st.pts[0];
    freeze(s, 0);
    const q = snapCell(T, a.x - 12, a.z + 4);
    const larek = give(s, 0, 'larek', q.x, q.z);
    const w = s.spawn(1, 1, q.x - 4, q.z + 0.3, -1);
    runN(s, 8);
    const onB = w.tg === -10 - larek.id;
    const guard = dummy(s, 0, 1, q.x - 4, q.z + 3);
    runN(s, 8);
    const onU = w.tg === guard.id;
    guard.hp = 0; runN(s, 10);
    check('auto target: a visible enemy building in aggro when no enemy unit is; an enemy unit first; back to the building after', onB && onU && w.tg === -10 - larek.id, `${w.tg}`);
    const m1 = s.st.sides[1].money, lost0 = s.st.sides[0].blost;
    larek.paid = 150;
    let died = false;
    for (let i = 0; i < 400 && !died; i++) died = bev(stepC(s), 'die').length > 0;
    const paidOut = s.st.sides[1].money - m1;
    runN(s, 6);
    check('a destroyed building: gone from the state, bounty floor(paid × 0.12) + 2 to the other side, the owner\'s loss is recorded', died && s.building(larek.id) === undefined && !s.st.bld.includes(larek)
      && paidOut === Math.floor(150 * BASE.bounty) + 2 && s.st.sides[0].blost === lost0 + 150 && (w.tg === -1 || w.tg === -2), `${paidOut} ₽, tg ${w.tg}`);
    // next to the high-rise the high-rise wins; walls are never auto-targeted
    const s2 = box(), a2 = s2.st.pts[0];
    freeze(s2, 0);
    const far = snapCell(T, a2.x - 12, a2.z);
    give(s2, 0, 'larek', far.x, far.z);
    const wl = snapCell(T, a2.x - 6, a2.z + 2);
    give(s2, 0, 'zabor', wl.x, wl.z);
    const w2 = s2.spawn(1, 1, a2.x - HQ.radius[0] - 1.5, a2.z - 0.5, -1);
    runN(s2, 8);
    check('…a unit standing at the high-rise takes the high-rise, not a building further away or a wall next to it', w2.tg === -2, String(w2.tg));
  }
  {
    const s = box(), a = s.st.pts[0];
    freeze(s, 0);
    const q = snapCell(T, a.x - 12, a.z + 6);
    const larek = give(s, 0, 'larek', q.x, q.z);
    larek.hp = larek.mhp = 1e6;
    const ch = s.spawn(1, CHIMAEV, q.x - 6, q.z - 4, -1), vic = dummy(s, 0, 1, q.x - 7, q.z - 4);
    ch.ab = 1e6;
    runN(s, 60);
    const dmg = 1e6 - larek.hp, per = UNITS[CHIMAEV].dmg[1] * Math.min(UNITS[CHIMAEV].bldg!, BASE.bldgVs);
    check('Чимаев prefers a building to the high-rise, never the unit next to him, and hits it ×bldg', ch.tg === -10 - larek.id && vic.hp === vic.mhp && dmg > 0 && Math.abs(dmg / per - Math.round(dmg / per)) < 1e-9, `−${dmg} = ${dmg / per} hits of ${per}`);
    // «Землетряс» shakes buildings too
    const hp0 = larek.hp;
    s.st.aoe.push({ s: 1, x: q.x + 1, z: q.z, r: 5, dmg: 40, hq: 3, at: s.st.tick, n: 1, every: 0, k: 'quake' });
    ch.hp = 0; s.step(undefined);
    check('an area pulse (State.aoe) hurts the enemy buildings in it: quake × min(3, BASE.bldgVs)', hp0 - larek.hp === 40 * Math.min(3, BASE.bldgVs), String(hp0 - larek.hp));
    // an attack order on a building (tb): units walk there and break it; Чимаев may take it too
    const s3 = box(), a3 = s3.st.pts[0];
    freeze(s3, 0);
    const q3 = snapCell(T, a3.x - 12, a3.z + 6);
    const t3 = give(s3, 0, 'larek', q3.x, q3.z);
    const u1 = s3.spawn(1, 1, q3.x - 40, q3.z + 10, -1), u2 = s3.spawn(1, CHIMAEV, q3.x - 40, q3.z + 12, -1);
    stepC(s3, C(s3, 'pk', { k: 'ord', s: 1, ids: [u1.id, u2.id], m: 'attack', tb: t3.id }));
    const ordOk = u1.o?.m === OM.ATTACK && u1.o.tg === -10 - t3.id && u1.o.c === navIndex(T, t3.x, t3.z) && u2.o?.m === OM.ATTACK;
    let gone = -1;
    for (let i = 0; i < 600 && gone < 0; i++) { s3.step(undefined); if (!s3.building(t3.id)) gone = i; }
    s3.step(undefined);
    check('ord attack with tb: the units cross 40 units to the building, break it, then hold', ordOk && gone > 0 && u1.o?.m === OM.HOLD && u2.o?.m === OM.HOLD, `gone after ${gone}`);
    const junkTb = stepC(s3, C(s3, 'pk', { k: 'ord', s: 1, ids: [u1.id], m: 'attack', tb: 424242 }), C(s3, 'pa', { k: 'ord', s: 0, ids: [u1.id], m: 'attack', tb: t3.id }));
    check('…an order on a building that is not there changes nothing', u1.o?.m === OM.HOLD && junkTb.every(e => e.e !== 'possess'));
  }

  // ---- traps -------------------------------------------------------------------------------------------------------
  {
    const s = box(), c = s.st.pts[4], d = D[K.grabli];
    const b = give(s, 0, 'grabli', c.x, c.z);
    const hidden = !bldVisible(b, 1) && bldVisible(b, 0) && D[K.grabli].hid === true && D[K.grabli].solid === 0;
    const e = dummy(s, 1, 0, b.x - 5, b.z + 0.2), e2 = dummy(s, 1, 0, b.x - 7, b.z + 0.2);
    stepC(s, C(s, 'pk', { k: 'ord', s: 1, ids: [e.id, e2.id], m: 'move', x: b.x + 8, z: b.z + 0.2 }));
    let sprung = -1, n = 0;
    for (let i = 0; i < 60; i++) { const fx = stepC(s); const k = bev(fx, 'trap').length; if (k && sprung < 0) sprung = s.st.tick - 1; n += k; }
    check('Грабли: hidden and walkable; the first enemy to step on them takes 10 and stands for 2.5 s; the trap is seen from then on and re-arms in 15 s (the second walker passes)',
      hidden && n === 1 && sprung > 0 && e.mhp - e.hp === d.dmg![0] && e2.hp === e2.mhp && (b.f & BF.SEEN) !== 0 && bldVisible(b, 1) && b.cd === sprung + d.rate![0] && e2.x > b.x + 2, `sprung ${n}×, −${e.mhp - e.hp}`);
    freeze(s, 1); // a trap the enemy has seen is a target like any building: keep them off it for this check
    b.hp = b.mhp;
    const e3 = dummy(s, 1, 0, b.x + 0.3, b.z);
    let again = -1;
    for (let i = 0; i < d.rate![0] + 5 && again < 0; i++) if (bev(stepC(s), 'trap').length) again = s.st.tick - 1;
    check('…and springs again once re-armed', again === sprung + d.rate![0] && e3.stun === again + d.eff![0], `${again - sprung} ticks later`);
  }
  {
    const s = box(), c = s.st.pts[4], d = D[K.yama];
    freeze(s, 1);
    const b = give(s, 0, 'yama', c.x, c.z);
    const far = [dummy(s, 1, 0, b.x + 2, b.z), dummy(s, 1, 0, b.x - 2, b.z)];
    runN(s, 5);
    const waits = far.every(u => u.hp === u.mhp);
    const on = dummy(s, 1, 0, b.x + 0.5, b.z + 0.5), g = dummy(s, 1, GELIK, b.x, b.z - 1.5);
    const fx = stepC(s), fx2 = bev(fx, 'trap').length ? fx : stepC(s);
    const now = s.st.tick - 1;
    check('Яма: springs when someone is within 1.4, then everyone within 2.2 falls in: 40 damage and 1.5 s (КРА: damage only)',
      waits && bev(fx2, 'trap').length === 1 && [on, ...far].every(u => u.mhp - u.hp === d.dmg![0] && u.stun === now + d.eff![0]) && g.mhp - g.hp === d.dmg![0] && g.stun === 0, `${[on, ...far, g].map(u => u.mhp - u.hp).join(' ')}`);
  }
  {
    const s = box(), c = s.st.pts[4], d = D[K.lezhak];
    freeze(s, 1);
    const b = give(s, 0, 'lezhak', c.x, c.z);
    const walker = dummy(s, 1, 0, b.x + 0.4, b.z);
    runN(s, 6);
    const ignores = walker.hp === walker.mhp && !(b.f & BF.SEEN);
    const car = dummy(s, 1, 3, b.x - 0.5, b.z), gel = dummy(s, 1, GELIK, b.x + 30, b.z);
    const fx = stepC(s), fx2 = bev(fx, 'trap').length ? fx : stepC(s);
    const now = s.st.tick - 1;
    car.x = b.x + 20; gel.x = b.x + 0.5; gel.z = b.z;
    runN(s, d.rate![0] + 3);
    check('Лежачий полицейский: walkers do not matter; a car takes 80 and stops for 2 s; a Гелик (КРА) takes the damage and drives on',
      ignores && bev(fx2, 'trap').length === 1 && car.mhp - car.hp === d.dmg![0] && car.stun === now + d.eff![0] && walker.hp === walker.mhp && gel.mhp - gel.hp === d.dmg![0] && gel.stun === 0, `car −${car.mhp - car.hp}, гелик −${gel.mhp - gel.hp}`);
  }
  {
    const s = box(), c = s.st.pts[4], d = D[K.nychka];
    freeze(s, 1);
    const b = give(s, 0, 'nychka', c.x, c.z);
    const e1 = dummy(s, 1, 0, b.x + 1, b.z);
    runN(s, 6);
    const one = e1.psn === 0;
    const e2 = dummy(s, 1, 0, b.x - 1.5, b.z), e3 = dummy(s, 1, 0, b.x + 3, b.z), out = dummy(s, 1, 0, b.x + 6, b.z);
    const fx = stepC(s), fx2 = bev(fx, 'trap').length ? fx : stepC(s);
    const now = s.st.tick - 1;
    check('Нычка: one passer-by is not enough; two within 2.5 open it: everyone within 3.5 is poisoned for 8 s',
      one && bev(fx2, 'trap').length === 1 && [e1, e2, e3].every(u => u.psn === now + d.eff![0] && u.mhp - u.hp === d.dmg![0]) && out.psn === 0, `${[e1, e2, e3, out].map(u => u.psn ? u.psn - now : 0).join(' ')}`);
  }
  {
    const s = box(), c = s.st.pts[4], d = D[K.sobaka];
    freeze(s, 1);
    const b = give(s, 0, 'sobaka', c.x, c.z);
    const e = dummy(s, 1, 0, b.x + 5, b.z);
    runN(s, 10);
    const calm = e.hp === e.mhp && !bldVisible(b, 1);
    e.x = b.x + 2;
    runN(s, 31);
    const bites = (e.mhp - e.hp) / d.dmg![0];
    check('Злая собака: silent in the kennel; whoever comes within 3 is bitten every 0.6 s and the dog is seen', calm && bites >= 5 && bites <= 6 && Number.isInteger(bites) && bldVisible(b, 1) && b.tg === e.id, `${bites} bites`);
  }

  // ---- economy ---------------------------------------------------------------------------------------------------------
  {
    const s = box(5, true), sd = s.st.sides[0];
    const i0 = P(s).income(0);
    const [l1, l2, sh, zg, sf] = spots(s, 0, 'larek', 5);
    const a = give(s, 0, 'larek', l1.x, l1.z), b3 = give(s, 0, 'larek', l2.x, l2.z, 3);
    const i1 = P(s).income(0);
    const kitchen = give(s, 0, 'shaurma', sh.x, sh.z);
    const i2 = P(s).income(0);
    a.up = s.st.tick + 100; a.lv = 1;
    const i3 = P(s).income(0);
    a.up = 0;
    sd.inc = s.st.tick + 100;
    const boosted = P(s).income(0);
    sd.inc = 0; s.st.ev.black = s.st.tick + 100;
    const darkInc = P(s).income(0);
    s.st.ev.black = 0;
    check('Ларёк +1.5 ₽/s (level 3: +4), Шаурмечная +0.5; nothing while being built; «Мы в плюсе» multiplies it, a blackout zeroes it like any income',
      i1 - i0 === D[K.larek].inc![0] + D[K.larek].inc![2] && i2 - i1 === D[K.shaurma].inc![0] && i2 - i3 === D[K.larek].inc![0] && Math.abs(boosted - i2 * 1.5) < 1e-9 && darkInc === 0, `${i0} → ${i1} → ${i2}; building ${i3}`);
    // the kitchen heals own units nearby
    const hurt1 = s.spawn(0, 1, kitchen.x + 3, kitchen.z, -1), far = s.spawn(0, 1, kitchen.x + 30, kitchen.z + 30, -1), foe = s.spawn(1, 1, kitchen.x + 60, kitchen.z + 60, -1);
    freeze(s, 0); freeze(s, 1); freeze(s, 0, 0);
    hurt1.hp = 100; far.hp = 100; foe.hp = 100;
    stepC(s, C(s, 'pa', { k: 'ord', s: 0, ids: [hurt1.id, far.id], m: 'hold' }));
    runN(s, 50);
    const healed = hurt1.hp - 100;
    check('Шаурмечная: own units within 6 heal 1 % of max hp a second; others do not', healed >= 4 * hurt1.mhp * D[K.shaurma].eff![0] - 1e-9 && healed <= 6 * hurt1.mhp * D[K.shaurma].eff![0] + 1e-9 && far.hp === 100, `+${healed.toFixed(1)}`);
    // the herd grows while nobody touches it
    const z = give(s, 0, 'zagon', zg.x, zg.z), dz = D[K.zagon];
    const j0 = P(s).income(0) - i2;
    s.st.tick += BASE.zagonEvery * 2 + 5;
    const j2 = P(s).income(0) - i2;
    s.st.tick += BASE.zagonEvery * 40;
    const jmax = P(s).income(0) - i2;
    z.hp -= 1; z.hit = s.st.tick; z.v = s.st.tick; // what hurtBld does
    const jhit = P(s).income(0) - i2;
    check('Бараний загон: 0.5 ₽/s, +0.5 for every 30 s untouched, up to 3; a hit starts it over', j0 === BASE.zagonBase && j2 === BASE.zagonBase + 2 * BASE.zagonStep && jmax === dz.inc![0] && jhit === BASE.zagonBase, `${j0} ${j2} ${jmax} ${jhit}`);
    // Сейф against Мохьмад
    const safe = give(s, 1, 'seyf', s.st.pts[1].x - 9, s.st.pts[1].z);
    const thief = s.spawn(0, ERSNO, safe.x - 3, safe.z, -1);
    thief.ab = 1e6;
    s.st.sides[1].money = D[K.seyf].eff![0] + 5.5; sd.money = 0;
    s.st.sides[1].black = 1e9; // no income for the victim while we count
    freeze(s, 1); freeze(s, 0, 0);
    let stolen = 0;
    for (let i = 0; i < 80; i++) for (const f of stepC(s)) if (f.e === 'steal') stolen += f.n;
    s.st.sides[1].money = 1000;
    for (let i = 0; i < 3; i++) dummy(s, 1, 0, thief.x - 1, thief.z + i * 0.5);
    P(s).hash(); thief.ab = 0; s.fx.length = 0;
    const b0 = s.st.sides[1].money;
    P(s).cardSteal(thief);
    const took = b0 - s.st.sides[1].money;
    s.st.sides[1].money = D[K.seyf].eff![0] + 12; thief.ab = 0;
    const b1 = s.st.sides[1].money;
    P(s).cardSteal(thief);
    check('Сейф: Мохьмад takes only what lies above the safe (150 ₽): 5 of 155.5 by hand; «Списание» 10 % of the bank but never into the safe',
      stolen === 5 && took === 100 && b1 - s.st.sides[1].money === 12, `hits ${stolen}, card ${took}, card near the safe ${b1 - s.st.sides[1].money}`);
    void b3; void sf;
  }

  // ---- Качалка, Гараж, Вышка связи, Генератор ------------------------------------------------------------------------------
  {
    const s = box(5, true), a = s.st.pts[0];
    const [p1, p2] = spots(s, 0, 'larek', 2);
    const w0 = s.spawn(0, 1, a.x - 8, a.z, -1).mhp, c0 = s.cost(0, RIDE), g0 = s.cost(0, GELIK), sq0 = s.cost(0, 0);
    const car0 = s.spawn(0, 3, a.x - 8, a.z + 2, -1), v0 = P(s).stats(car0).spd, walk0 = P(s).stats(s.st.units[0]).spd;
    const gym = give(s, 0, 'kachalka', p1.x, p1.z, 2), gar = give(s, 0, 'garazh', p2.x, p2.z);
    const w1 = s.spawn(0, 1, a.x - 8, a.z, -1).mhp, hen = s.spawn(0, CHICKEN, a.x - 8, a.z, -1).mhp, foe = s.spawn(1, 0, a.x - 8, a.z, -1).mhp;
    check('Качалка (level 2): own units appear with +12 % hp; summons and the enemy do not', w1 === Math.floor(w0 * D[K.kachalka].eff![1]) && hen === UNITS[CHICKEN].hp && foe === UNITS[0].hp, `${w0} → ${w1}`);
    const v1 = P(s).stats(car0).spd;
    check('Гараж: own vehicles cost ×0.85 and drive ×1.1; walkers and their prices are untouched',
      s.cost(0, RIDE) === Math.floor(c0 * D[K.garazh].eff![0]) && s.cost(0, GELIK) < g0 && s.cost(0, 0) === sq0 && s.cost(1, RIDE) === UNITS[RIDE].cost[1]
      && Math.abs(v1 - v0 * D[K.garazh].eff2![0]) < 1e-12 && P(s).stats(s.st.units[0]).spd === walk0, `ride ${c0} → ${s.cost(0, RIDE)}, speed ${v0} → ${v1}`);
    gym.hp = 0; gar.hp = 0; s.step(undefined);
    check('…and both stop when the building is gone', s.spawn(0, 1, a.x - 8, a.z, -1).mhp === w0 && s.cost(0, RIDE) === c0);
  }
  {
    const s = box(5, true), c = s.st.pts[4], d = D[K.rogatka];
    freeze(s, 1);
    const b = give(s, 0, 'rogatka', c.x, c.z);
    const e = dummy(s, 1, 1, b.x, b.z + d.range![0] + 0.6);
    let n = 0;
    for (let i = 0; i < 20; i++) n += shots(stepC(s), 'rogatka');
    const outOfReach = n === 0;
    const vy = give(s, 0, 'vyshka', b.x - 4, b.z);
    n = 0;
    for (let i = 0; i < 20; i++) n += shots(stepC(s), 'rogatka');
    const reached = n >= 2;
    const gen = give(s, 0, 'generator', b.x + 4, b.z);
    b.cd = 0; s.step(undefined);
    const t0 = s.st.tick;
    n = 0;
    for (let i = 0; i < 60; i++) n += shots(stepC(s), 'rogatka');
    const fast = n;
    s.st.ev.black = s.st.tick + 100;
    n = 0;
    for (let i = 0; i < 30; i++) n += shots(stepC(s), 'rogatka');
    check('Вышка связи: the Рогатка reaches +10 % further; Генератор: it fires every 6 ticks instead of 7; in a blackout both boosts are gone (the Рогатка itself needs no power)',
      outOfReach && reached && fast === 10 && n === 0 && s.bldOn(b) && !s.bldOn(vy) && !s.bldOn(gen) && e.hp < e.mhp, `${fast} shots in 60 ticks from ${t0}; in the dark ${n}`);
  }

  // ---- sell, repair, who may sell; the money never grows -------------------------------------------------------------
  {
    const s = box(), sd = s.st.sides[0];
    const [p1, p2] = spots(s, 0, 'larek', 2);
    bld(s, 'pa', 0, { op: 'put', b: K.larek, x: p1.x, z: p1.z });
    const b = s.bldAt(p1.x, p1.z)!;
    const foreign = why(bld(s, 'pb', 0, { op: 'sell', n: b.id })), enemy = why(bld(s, 'pk', 1, { op: 'sell', n: b.id }));
    check('sell: not someone else\'s while the owner is around («Хозяин на связи: не твоё»); never the enemy\'s («Это чужое»)', foreign === 'Хозяин на связи: не твоё' && enemy === 'Это чужое' && s.building(b.id) === b);
    b.hp = b.mhp * 0.5;
    const full = why(bld(s, 'pa', 0, { op: 'rep', n: 987 })), r0 = refund(b), rc = repairCost(b);
    b.hit = s.st.tick;
    const locked = s.canRep(0, b.id);
    b.hit = s.st.tick - BASE.repLock;
    const m0 = sd.money;
    const fxr = bld(s, 'pb', 0, { op: 'rep', n: b.id });
    check('repair: «Сначала отбейся» for 5 s after a hit; then anyone of the side pays exactly what the repair adds to the refund, and the building is whole',
      full === 'Нет такой постройки' && locked === 'Сначала отбейся' && r0 === Math.floor(0.5 * 150 * 0.5) && rc === Math.floor(0.5 * 150) - r0 && bev(fxr, 'rep').length === 1 && b.hp === b.mhp && sd.money === m0 - rc && refund(b) === 75
      && s.canRep(0, b.id) === 'И так целое', `refund ${r0}, repair ${rc}`);
    b.hp = b.mhp * 0.4;
    const m1 = sd.money, want = refund(b);
    const fxs = bld(s, 'pa', 0, { op: 'sell', n: b.id });
    check('sell: the owner gets floor(0.5 × paid × hp / mhp) and the building is gone; then he waits 15 ticks', bev(fxs, 'sell').length === 1 && want === 30 && sd.money === m1 + 30 && !s.building(b.id) && s.st.bld.length === 0 && s.st.players.pa.bc === s.st.tick - 1 + BASE.sellCd);
    // the owner goes silent: anyone of the side may sell; AI-built and admin-built ones too
    bld(s, 'pa', 0, { op: 'put', b: K.larek, x: p2.x, z: p2.z });
    const b2 = s.bldAt(p2.x, p2.z)!;
    for (let i = 0; i < 8; i++) { s.st.tick += 100; stepC(s, C(s, 'pb', { k: 'vote', s: 0, o: 0 })); }
    const stillNo = s.canSell(0, b2.id, s.st.players.pb);
    s.st.tick += 100;
    const nowYes = s.canSell(0, b2.id, s.st.players.pb);
    const aiB = give(s, 0, 'rogatka', p1.x, p1.z); aiB.own = -2;
    check('…someone else\'s once its owner has been silent for 90 s; the AI\'s and nobody\'s at once', stillNo === 'Хозяин на связи: не твоё' && nowYes === null && s.canSell(0, aiB.id, s.st.players.pb) === null);
    // the loser's discount
    sd.bdisc = s.st.tick + 50;
    const disc = s.bcost(0, K.prorab, 1), [p3] = spots(s, 0, 'prorab', 1);
    bld(s, 'pa', 0, { op: 'put', b: K.prorab, x: p3.x, z: p3.z });
    const pb = s.bldAt(p3.x, p3.z)!;
    sd.bdisc = 0;
    check('discount (SideState.bdisc): ×0.75, and the refund follows what was really paid', disc === 150 && pb.paid === 150 && refund(pb) === 75 && s.bcost(0, K.prorab, 1) === 200);
  }
  {
    // property: over random build / upgrade / repair / sell commands and random damage, bank + what a sale of
    // everything would give never grows — so no sequence makes money, and the bank never passes its start
    const s = box(11), sd = s.st.sides[0];
    sd.money = 30000;
    let r = 12345;
    const rnd = () => { r = (r + 0x6d2b79f5) | 0; let q = Math.imul(r ^ (r >>> 15), r | 1); q ^= q + Math.imul(q ^ (q >>> 7), q | 61); return ((q ^ (q >>> 14)) >>> 0) / 4294967296; };
    const ri = (n: number) => Math.floor(rnd() * n);
    const phi = () => sd.money + s.st.bld.reduce((n, b) => n + (b.s === 0 ? refund(b) : 0), 0);
    const a = s.st.pts[0];
    const ops = [0, 0, 0, 0, 0];
    let worst = 0, last = phi(), maxBank = sd.money, okInt = true;
    const m00 = sd.money;
    for (let i = 0; i < 2500; i++) {
      const mine = s.st.bld.filter(b => b.s === 0), p = ri(2) ? 'pa' : 'pb', k = ri(10);
      let body: Record<string, unknown>;
      if (k < 4 || !mine.length) body = { op: 'put', b: ri(3) ? ri(D.length) : [K.prorab, K.rogatka, K.larek, K.grabli][ri(4)], x: a.x + (rnd() - 0.5) * 44, z: a.z + (rnd() - 0.5) * 44 };
      else if (k < 5) body = { op: 'put', b: K.zabor, cells: wallLine(T, a.x + (rnd() - 0.5) * 30, a.z + (rnd() - 0.5) * 30, a.x + (rnd() - 0.5) * 30, a.z + (rnd() - 0.5) * 30, 1 + ri(16)) };
      else if (k < 7) body = { op: 'up', n: mine[ri(mine.length)].id };
      else if (k < 8) body = { op: 'rep', n: ri(4) ? mine[ri(mine.length)].id : 0 };
      else body = { op: 'sell', n: mine[ri(mine.length)].id };
      if (ri(3) === 0 && mine.length) { const b = mine[ri(mine.length)]; b.hp = Math.max(1, b.hp - rnd() * b.mhp * 0.7); b.hit = s.st.tick - (ri(2) ? 0 : 100); }
      if (ri(40) === 0) sd.bdisc = sd.bdisc > s.st.tick ? 0 : s.st.tick + 200; // the discount comes and goes
      if (ri(6) === 0) for (const b of mine) if (b.up > s.st.tick) b.up = s.st.tick; // time passes
      last = phi();
      const fx = bld(s, p, 0, body);
      const now = phi();
      worst = Math.max(worst, now - last);
      maxBank = Math.max(maxBank, sd.money);
      if (!Number.isFinite(sd.money) || sd.money < 0) okInt = false;
      for (const e of fx) if (e.e === 'bld') { const ix = ['put', 'up', 'rep', 'sell'].indexOf(e.k); if (ix >= 0) ops[ix]++; }
      if (fx.some(e => e.e === 'deny')) ops[4]++;
    }
    check(`no money from nothing: over 2500 random commands (${ops[0]} built, ${ops[1]} upgrades, ${ops[2]} repairs, ${ops[3]} sales, ${ops[4]} refused) bank + refunds never grew, the bank never passed its start or went below 0`,
      worst <= 1e-9 && maxBank === m00 && okInt && ops[0] > 100 && ops[1] > 20 && ops[2] > 20 && ops[3] > 50, `worst step ${worst}, bank ${m00} → ${sd.money.toFixed(0)}, ${s.st.bld.length} buildings left`);
    check('…and the rules held all the way: caps, one building per cell, snapped spots', s.bldCaps(0).n <= 30 && s.bldCaps(0).walls <= 40 && new Set(s.st.bld.map(b => navIndex(T, b.x, b.z))).size === s.st.bld.length
      && s.st.bld.every(b => b.x === cellX(T, navIndex(T, b.x, b.z)) && b.z === cellZ(T, navIndex(T, b.x, b.z))) && s.st.bld.every(b => D[b.t].cap === 0 || s.bldCount(0, b.t) <= D[b.t].cap));
  }

  // ---- superweapons ----------------------------------------------------------------------------------------------------
  {
    const s = box(5, true), c = s.st.pts[4], d = D[K.sabvufer];
    freeze(s, 1);
    const b = give(s, 0, 'sabvufer', c.x, c.z);
    const es = [0, 1, 2, 3, 4].map(i => dummy(s, 1, 0, b.x + 4 + i, b.z + (i % 2)));
    runN(s, 100);
    const waits = es.every(u => u.hp === u.mhp);
    b.v = s.st.tick - BASE.subCharge + 3;
    let charged = -1, wave = -1;
    const x0 = es.map(u => u.x);
    for (let i = 0; i < 20; i++) { const fx = stepC(s); if (bev(fx, 'charge').length) charged = i; if (bev(fx, 'wave').length && wave < 0) wave = i; }
    check('Сабвуфер: charges 60 s in plain sight (B.v is the start), then the wave: 30 damage, a stun and a long knock-back for everyone within 12; then it charges again',
      waits && charged === 3 && wave >= charged && wave <= charged + 5 && es.every(u => u.mhp - u.hp === d.dmg![0]) && es.every((u, i) => u.x > x0[i] + 3) && b.v > s.st.tick - 20 && !D[K.sabvufer].hid, `charged +${charged}, wave +${wave}, pushed ${es.map((u, i) => (u.x - x0[i]).toFixed(1)).join(' ')}`);
  }
  {
    const s = box(5, true), k = s.st.pts[1], d = D[K.arbuzomet];
    const [p1] = spots(s, 0, 'larek', 1);
    const b = give(s, 0, 'arbuzomet', p1.x, p1.z);
    const early = why(bld(s, 'pa', 0, { op: 'fire', n: b.id, x: k.x, z: k.z }));
    const wrong = s.canFire(0, give(s, 0, 'larek', spots(s, 0, 'larek', 1)[0].x, spots(s, 0, 'larek', 1)[0].z).id, k.x, k.z);
    b.v = s.st.tick - BASE.arbCharge;
    const tgt = snapCell(T, k.x - 14, k.z + 2);
    const victim = give(s, 1, 'larek', tgt.x, tgt.z);
    freeze(s, 1);
    const es = [dummy(s, 1, 0, tgt.x + 2, tgt.z), dummy(s, 1, 0, tgt.x - 3, tgt.z + 1)], far = dummy(s, 1, 0, tgt.x + 9, tgt.z);
    const hq0 = s.st.sides[1].hq;
    const fx = bld(s, 'pa', 0, { op: 'fire', n: b.id, x: tgt.x, z: tgt.z });
    const queued = s.st.aoe.length === 1 && s.st.aoe[0].k === 'arbuz' && s.st.aoe[0].at === s.st.tick - 1 + BASE.arbDelay && bev(fx, 'fire').length === 1;
    runN(s, BASE.arbDelay - 2);
    const notYet = es[0].hp === es[0].mhp;
    runN(s, 4);
    check('Арбузомёт: «Ещё заряжается» for 90 s; then the strike lands on the chosen spot 3 s later: 220 to units within 5, half to buildings; the high-rise out of reach is untouched; the charge starts over',
      early === 'Ещё заряжается' && wrong === 'Это не стреляет' && queued && notYet && es.every(u => u.mhp - u.hp === d.dmg![0]) && far.hp === far.mhp && victim.mhp - victim.hp === d.dmg![0] * BASE.arbHq
      && s.st.sides[1].hq === hq0 && s.canFire(0, b.id, k.x, k.z) === 'Ещё заряжается', `units −${es.map(u => u.mhp - u.hp).join(' −')}, building −${victim.mhp - victim.hp}`);
    b.v = s.st.tick - BASE.arbCharge;
    bld(s, 'pa', 0, { op: 'fire', n: b.id, x: k.x, z: k.z });
    runN(s, BASE.arbDelay + 2);
    check('…on the high-rise itself it does half damage to it', hq0 - s.st.sides[1].hq === d.dmg![0] * BASE.arbHq, String(hq0 - s.st.sides[1].hq));
  }

  // ---- the next war: survivors stay and are repaired, the loser is insured; admin reset wipes; admin ops ----------------
  {
    const s = box(5), a = s.st.pts[0];
    const [p1, p2, p3] = spots(s, 0, 'larek', 3);
    const keep = give(s, 0, 'larek', p1.x, p1.z), trap = give(s, 0, 'grabli', p2.x, p2.z), dead = give(s, 0, 'rogatka', p3.x, p3.z);
    const kq = spots(s, 1, 'larek', 1)[0], theirs = give(s, 1, 'larek', kq.x, kq.z);
    keep.hp = 40; keep.hit = s.st.tick; trap.f |= BF.SEEN; trap.cd = s.st.tick + 500; dead.paid = 480; dead.hp = 0;
    s.step(undefined);
    s.st.sides[0].hq = 0; // Атаги lose
    s.step(undefined);
    const over = s.st.winner === 1;
    const cmdDuring = why(bld(s, 'pa', 0, { op: 'put', b: K.rogatka, x: p3.x, z: p3.z }));
    for (let i = 0; i < 405 && s.st.winner !== -1; i++) s.step(undefined);
    const sd0 = s.st.sides[0], sd1 = s.st.sides[1];
    const money0 = sd0.money, money1 = sd1.money;
    s.st.nextMilitia = s.st.nextVote = s.st.ev.next = 1e9; // the new war woke the world up: silence it again
    for (const sd of s.st.sides) { sd.aiNext = 1e9; sd.black = 1e9; }
    check('war over: build commands do nothing; next war: survivors stay, whole and hidden again, destroyed ones are gone',
      over && cmdDuring === '' && s.st.era === 2 && s.st.bld.length === 3 && keep.hp === keep.mhp && keep.hit === 0 && !(trap.f & BF.SEEN) && trap.cd === 0 && !s.building(dead.id) && s.building(theirs.id) === theirs, `era ${s.st.era}, ${s.st.bld.length} buildings`);
    check('…the loser gets its insurance (half of what the destroyed buildings cost, ≤ 500 ₽) and a 25 % discount for 90 s; the winner gets neither',
      money0 === 350 + Math.min(BASE.insMax, Math.floor(480 * BASE.insPct)) && sd0.bdisc === s.st.tick - 1 + BASE.discFor && money1 === 350 && sd1.bdisc === 0 && sd0.blost === 0
      && s.bcost(0, K.prorab) === 150 && s.bcost(1, K.prorab) === 200, `Атаги ${money0} ₽, discount until +${sd0.bdisc - s.st.tick}`);
    const adm = (body: Record<string, unknown>) => stepC(s, { t: s.st.tick, id: `adm:t${seq++}`, p: 'admin', k: 'adm', ...body } as unknown as Cmd);
    // admin ops
    const g1 = adm({ op: 'bgive', s: 1, u: K.tesla, v: 3 });
    const gift = s.st.bld[s.st.bld.length - 1];
    const g2 = adm({ op: 'bgive', s: 0, u: K.sabvufer, x: a.x - 30, z: a.z - 30 });
    const outside = s.bldAt(a.x - 30, a.z - 30);
    check('admin bgive: a finished building of any tier, free, at the given cell (even outside the zone) or the first free spot of the side\'s zone',
      !!gift && gift.t === K.tesla && gift.s === 1 && gift.lv === 3 && gift.up === 0 && gift.paid === 0 && gift.own === -1 && gift.mhp === D[K.tesla].hp[2] && dist(gift, s.st.pts[1].x, s.st.pts[1].z) <= 21
      && !!outside && outside.t === K.sabvufer && g1.some(e => e.e === 'adm' && e.op === 'bgive' && e.n === 1) && g2.length > 0);
    keep.hp = 10; outside!.hp = 5;
    const half = give(s, 0, 'zabor', a.x - 28, a.z - 30); half.up = s.st.tick + 500;
    adm({ op: 'bheal', s: 0 });
    s.step(undefined);
    check('admin bheal: every building of the side whole, construction finished', keep.hp === keep.mhp && outside!.hp === outside!.mhp && half.up === 0 && gift.hp === gift.mhp);
    const m1 = s.st.sides[1].money, n0 = s.st.bld.length;
    adm({ op: 'bkill', s: 0, x: a.x - 30, z: a.z - 30, r: 4 });
    const afterR = s.st.bld.length;
    adm({ op: 'bkill', s: 1 });
    check('admin bkill: by radius, by side; no bounty for anyone', afterR === n0 - 2 && !s.st.bld.some(b => b.s === 1) && s.st.sides[1].money === m1 && s.st.sides[0].blost === 0 && s.building(keep.id) === keep, `${n0} → ${afterR} → ${s.st.bld.length}`);
    check('normAdm: bgive needs a side, a known building type and a level 1..3; bkill / bheal like kill / heal',
      normAdm({ op: 'bgive', s: 0, u: 0 })?.v === 1 && normAdm({ op: 'bgive', s: 1, u: D.length - 1, v: 3, x: 5, z: 6 })?.x === 5 && normAdm({ op: 'bkill', s: -1 }) !== null && normAdm({ op: 'bheal', s: 1 }) !== null
      && [{ op: 'bgive', s: 0 }, { op: 'bgive', s: 0, u: D.length }, { op: 'bgive', s: 0, u: -1 }, { op: 'bgive', s: 2, u: 0 }, { op: 'bgive', s: 0, u: 0, v: 4 }, { op: 'bgive', s: 0, u: 1.5 }, { op: 'bkill' }, { op: 'bkill', s: 5 }, { op: 'bheal', s: -1 }, { op: 'bheal' }]
        .every(b => normAdm(b) === null));
    adm({ op: 'reset', v: 77 });
    check('admin reset: a new world has no bases', s.st.bld.length === 0 && s.st.era === 1 && s.bi.sol[0] === 0 && s.bi.by.size === 0);
  }

  // ---- the AI builds; a sandbox stays empty; the reserve; an idle human side --------------------------------------------
  {
    const s = sandbox();
    runN(s, 900);
    check('sandbox(): the silenced AI builds nothing', s.st.bld.length === 0);
    const ai = ctx.runTo(ctx.seed, 3600);
    const by = [0, 1].map(sd => ai.st.bld.filter(b => b.s === sd));
    check('AI vs AI, 6 minutes: both sides have a Прорабская and more, all placed by the AI (own −2) inside their zones',
      by.every((l, sd) => l.some(b => b.t === K.prorab) && l.length >= 2 && l.every(b => b.own === -2 && dist(b, ai.st.pts[sd].x, ai.st.pts[sd].z) <= 21.01))
      && ai.st.units.length > 20, `${by[0].length} / ${by[1].length} buildings, ${ai.count(0)} / ${ai.count(1)} units`);
    // the reserve: with less than price + reserve it buys units only
    const t = sandbox(9), sd = t.st.sides[0];
    sd.aiNext = 0; sd.aiB = 0; sd.money = D[K.prorab].cost[0] + BASE.aiReserve - 1;
    P(t).ai(0);
    const none = t.st.bld.length === 0;
    sd.aiNext = 0; sd.aiB = 0; sd.money = D[K.prorab].cost[0] + BASE.aiReserve + 450;
    const u0 = t.st.units.length;
    P(t).ai(0);
    check('the AI builds only with bank ≥ price + reserve, and still buys a unit in the same decision', none && t.st.bld.length === 1 && t.st.bld[0].t === K.prorab && t.st.bld[0].own === -2 && t.st.units.length > u0 && sd.aiB > t.st.tick + BASE.aiEvery - 1, `${t.st.bld.length} building, ${t.st.units.length - u0} new units, bank ${sd.money}`);
    // an idle human side: the AI takes over its base too; an active one is left alone
    const h = new Sim(T); h.init(4); h.quiet = true;
    h.step([{ t: 0, id: 'c', p: 'x', k: 'cfg', d: 1, hs: 0, mp: 0 }, { t: 0, id: 'pa:j', p: 'pa', k: 'join', s: 0 }]);
    for (let i = 0; i < 1800; i++) h.step(i % 100 === 0 ? [{ t: h.st.tick, id: `pa:v${i}`, p: 'pa', k: 'vote', s: 0, o: 0 }] : undefined);
    const active = h.st.bld.filter(b => b.s === 0).length, theirs = h.st.bld.filter(b => b.s === 1).length;
    for (let i = 0; i < 2400; i++) h.step(undefined);
    check('local game: nothing is built for a human who is playing; after 2 minutes of silence the AI takes over the base as it does the deploys', active === 0 && theirs > 0 && h.st.bld.some(b => b.s === 0 && b.own === -2), `${active} → ${h.st.bld.filter(b => b.s === 0).length}`);
  }

  // ---- saves: old ones load, current ones are untouched, snapshots and rollbacks keep the overlay ---------------------------
  {
    const s = ctx.runTo(ctx.seed, 3000);
    const cur = JSON.stringify(s.st), h0 = hashState(s.st);
    const again = new Sim(T); again.load(JSON.parse(cur) as State);
    check('a current state with buildings is untouched by load() (same hash), and the index is rebuilt', hashState(again.st) === h0 && again.st.bld.length === s.st.bld.length && again.st.bld.length > 4 && again.bi.by.size === s.st.bld.length
      && again.bi.sol[0] === s.bi.sol[0] && again.bi.sol[1] === s.bi.sol[1] && s.st.bld.every(b => again.building(b.id)?.x === b.x));
    const old = JSON.parse(cur) as State & Record<string, unknown>;
    delete old.bld;
    for (const sd of old.sides) { const o = sd as unknown as Record<string, unknown>; delete o.bdisc; delete o.blost; delete o.aiB; }
    for (const p of old.proj) delete p.b;
    const x = new Sim(T), y = new Sim(T);
    x.load(structuredClone(old)); y.load(JSON.parse(JSON.stringify(old)) as State); x.quiet = y.quiet = true;
    const shape = Array.isArray(x.st.bld) && x.st.bld.length === 0 && x.st.sides.every(sd => sd.bdisc === 0 && sd.blost === 0 && sd.aiB === 0) && Object.keys(x.st).indexOf('bld') > Object.keys(x.st).indexOf('packs');
    for (let i = 0; i < 1500; i++) { x.step(undefined); y.step(undefined); }
    check('a save from before the bases (no bld, no bdisc / blost / aiB): loads, gets the fields, plays on (the AI builds) and replays identically through two load paths',
      shape && hashState(x.st) === hashState(y.st) && x.st.bld.length > 0 && !JSON.stringify(x.st).includes('null'), `${x.st.bld.length} buildings 150 s later`);
    // twins: JSON and structuredClone restores of a war with bases, towers firing, buildings dying
    const j = new Sim(T); j.load(JSON.parse(cur) as State); j.quiet = true;
    const c = new Sim(T); c.load(s.snapshot()); c.quiet = true;
    let ok = true, died = 0, shot = 0;
    s.quiet = false;
    for (let i = 0; i < 1800 && ok; i++) {
      s.step(undefined); j.step(undefined); c.step(undefined);
      for (const e of s.fx) { if (e.e === 'bld' && e.k === 'die') died++; if (e.e === 'shot' && e.k >= BASE.shotK) shot++; }
      s.fx.length = 0;
      if (i % 50 === 49) {
        ok = hashState(s.st) === hashState(j.st) && hashState(s.st) === hashState(c.st);
        if (i % 300 === 299) { j.load(JSON.parse(JSON.stringify(j.st)) as State); c.load(structuredClone(c.st)); }
      }
    }
    check(`twins restored through JSON and structuredClone every 30 s stay identical for 3 minutes of war (${shot} tower shots, ${died} buildings destroyed)`, ok && shot > 20, `${s.st.bld.length} buildings at the end`);
  }
  {
    // a live AI war with three players sending random build commands; a Session gets half of them late (rollbacks)
    const sort = (l: Cmd[]) => l.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const A = ctx.runTo(ctx.seed, 1500);
    const json0 = JSON.stringify(A.st);
    let r = 99;
    const rnd = () => { r = (r + 0x6d2b79f5) | 0; let q = Math.imul(r ^ (r >>> 15), r | 1); q ^= q + Math.imul(q ^ (q >>> 7), q | 61); return ((q ^ (q >>> 14)) >>> 0) / 4294967296; };
    const ri = (n: number) => Math.floor(rnd() * n);
    const players: [string, Side][] = [['pa', 0], ['pk', 1], ['pb', 0]];
    const at = new Map<number, Cmd[]>(), hashes: number[] = [];
    let n = 0, sent = 0;
    const TICKS = 2000;
    A.quiet = false;
    const evs: Record<string, number> = {};
    for (let i = 0; i < TICKS; i++) {
      const st = A.st, list: Cmd[] = [];
      const add = (p: string, b: Record<string, unknown>) => list.push({ ...b, t: st.tick, id: `${p}:${String(n++).padStart(6, '0')}`, p } as unknown as Cmd);
      if (i === 0) for (const [p, sd] of players) add(p, { k: 'join', s: sd });
      for (const [p, sd] of players) {
        if (rnd() > 0.1) continue;
        const hq = st.pts[sd], mine = st.bld.filter(b => b.s === sd), foe = st.bld.filter(b => b.s !== sd), k = ri(12);
        if (k < 5) add(p, { k: 'bld', s: sd, op: 'put', b: ri(D.length), x: Math.round((hq.x + (rnd() - 0.5) * 36) * 100) / 100, z: Math.round((hq.z + (rnd() - 0.5) * 36) * 100) / 100 });
        else if (k < 6) add(p, { k: 'bld', s: sd, op: 'put', b: K.zabor, cells: wallLine(T, hq.x + (rnd() - 0.5) * 28, hq.z + (rnd() - 0.5) * 28, hq.x + (rnd() - 0.5) * 28, hq.z + (rnd() - 0.5) * 28, 2 + ri(10)) });
        else if (k < 8 && mine.length) { const pr = mine.find(b => b.t === K.prorab); add(p, { k: 'bld', s: sd, op: 'up', n: (pr && ri(2) ? pr : mine[ri(mine.length)]).id }); }
        else if (k < 9 && mine.length) add(p, { k: 'bld', s: sd, op: 'rep', n: ri(3) ? mine[ri(mine.length)].id : 0 });
        else if (k < 10 && mine.length) add(p, { k: 'bld', s: sd, op: 'sell', n: mine[ri(mine.length)].id });
        else if (k < 11 && foe.length) { const own = st.units.filter(u => u.s === sd && u.hp > 0).slice(0, 6).map(u => u.id); if (own.length) add(p, { k: 'ord', s: sd, ids: own, m: 'attack', tb: foe[ri(foe.length)].id }); }
        else add(p, { k: 'bld', s: 1 - sd, op: 'sell', n: mine[0]?.id ?? 5 }); // junk: the wrong side
        sent++;
      }
      if (list.length) at.set(st.tick, sort(list));
      A.step(list.length ? list : undefined);
      for (const e of A.fx) if (e.e === 'bld') evs[e.k] = (evs[e.k] || 0) + 1;
      A.fx.length = 0;
      if (i % 100 === 99) hashes.push(hashState(A.st));
    }
    const Bs = new Sim(T); Bs.load(JSON.parse(json0) as State); Bs.quiet = true;
    let okB = true;
    for (let i = 0; i < TICKS; i++) {
      Bs.step(at.get(Bs.st.tick)?.map(c => JSON.parse(JSON.stringify(c)) as Cmd));
      if (i % 100 === 99) { if (hashState(Bs.st) !== hashes[(i - 99) / 100]) okB = false; if (i % 300 === 299) Bs.load(JSON.parse(JSON.stringify(Bs.st)) as State); }
    }
    check(`random build streams on a live war (${sent} commands: ${JSON.stringify(evs)}): a replay through JSON restores is the same world`, okB && (evs.put ?? 0) > 30 && (evs.sell ?? 0) > 3 && (evs.up ?? 0) >= 1);
    const Dm = new Sim(T); Dm.load(JSON.parse(json0) as State); Dm.quiet = true;
    const backend: Backend = { kind: 'local', send() { /* nobody else */ }, checkpoint() { /* not stored */ } };
    const sess = new Session(Dm, backend, 'x');
    const all = [...at.values()].flat();
    let late: { c: Cmd; due: number }[] = [];
    all.forEach((c, i) => { if (i % 2 === 0) sess.receive(c); else late.push({ c, due: c.t + 1 + (i % 25) }); });
    let rolled = 0;
    sess.onRollback = () => { rolled++; };
    const t0 = performance.now();
    while (Dm.st.tick < A.st.tick) {
      (sess as unknown as { stepOnce(): void }).stepOnce();
      const now = late.filter(l => l.due <= Dm.st.tick);
      for (const l of now) sess.receive(l.c);
      if (now.length) late = late.filter(l => l.due > Dm.st.tick);
    }
    for (const l of late) sess.receive(l.c);
    check(`…and a Session that gets half of them 1..25 ticks late (${rolled} rollbacks): the same world, the same buildings`, hashState(Dm.st) === hashState(A.st) && Dm.st.bld.length === A.st.bld.length && rolled > 20 && Dm.bi.by.size === Dm.st.bld.length,
      `${(performance.now() - t0).toFixed(0)} ms, ${A.st.bld.length} buildings`);
    check('…no NaN / null in the state', !JSON.stringify(A.st).includes('null'));
  }

  // ---- forged states (guard.ts) -----------------------------------------------------------------------------------------
  {
    const real = ctx.runTo(11, 3000).snapshot();
    const Tst = (st: unknown) => checkState(st, T);
    const mod = (f: (st: State) => void) => { const c = structuredClone(real); f(c); return c; };
    const b0 = real.bld[0];
    const forged = [
      mod(st => { (st.bld[0] as unknown as Record<string, unknown>).t = 999; }),
      mod(st => { st.bld[1].id = st.bld[0].id; }),
      mod(st => { st.bld[0].id = st.units[0].id; }),
      mod(st => { st.bld[0].hp = NaN; }),
      mod(st => { st.bld[0].mhp = 0; }),
      mod(st => { st.bld[0].lv = 7; }),
      mod(st => { (st.bld[0] as unknown as Record<string, unknown>).s = 2; }),
      mod(st => { st.bld[0].paid = -500; }),
      mod(st => { (st.bld[0] as unknown as Record<string, unknown>).x = 'a'; }),
      mod(st => { delete (st.bld[0] as unknown as Record<string, unknown>).up; }),
      mod(st => { for (let i = 0; i < 100000; i++) st.bld.push({ ...b0, id: 5_000_000 + i }); }),
      mod(st => { (st as unknown as Record<string, unknown>).bld = { length: 3 }; }),
      mod(st => { (st.bld as unknown[])[0] = null; }),
    ];
    let threw = false, res: (string | null)[] = [];
    try { res = forged.map(Tst); } catch { threw = true; }
    check('checkState: a real war with bases passes', real.bld.length > 3 && Tst(real) === null && stateShape(real) === null);
    check(`checkState: forged buildings (type 999, duplicate ids, a unit's id, NaN hp, mhp 0, level 7, side 2, negative paid, a string, a missing field, 100 000 entries, not an array, null) are all refused, none throws`,
      !threw && res.length === forged.length && res.every(r => typeof r === 'string'), res.join(', '));
    check('…a save without bld still has a valid shape (migrate adds it)', stateShape(mod(st => { delete (st as unknown as Record<string, unknown>).bld; })) === null && MAX_BLD >= 2 * (30 + 40));
    // oddly placed but well-formed buildings (two in one cell, off the grid, far outside any zone) load and run
    const odd = mod(st => { st.bld.push({ ...b0, id: 6_000_001 }, { ...b0, id: 6_000_002, x: 200.37, z: 100.11 }, { ...b0, id: 6_000_003, x: -50, z: 9999 }); });
    check('…well-formed but impossible buildings (two in a cell, off the grid, off the map) run without breaking anything', Tst(odd) === null);
    // economy buildings stay inside what explained() tolerates
    const rich = structuredClone(real);
    rich.sides[0].money += 26 * 60; // a minute of every economy building at its cap
    check('explained(): a minute of full building income is an ordinary difference', explained(real, rich, 600, false) === null);
  }
}

/** Both bases full for the worst-case state size: 30 buildings and 40 wall segments a side, levels 3, everything busy. */
export function fillBases(s: Sim): number {
  const T = s.terrain;
  let n = 0;
  for (const side of [0, 1] as Side[]) {
    const p = s.st.pts[side], cells: { c: number; x: number; z: number }[] = [];
    for (let dz = -20; dz <= 20; dz += 2) for (let dx = -20; dx <= 20; dx += 2) {
      const q = snapCell(T, p.x + dx, p.z + dz), d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > 6 && d < 21 && !s.bldAt(q.x, q.z)) cells.push(q);
    }
    const types: number[] = [];
    BUILDINGS.forEach((d, t) => { for (let i = 0; i < d.cap && types.length < 30; i++) types.push(t); });
    for (let i = 0; i < 40; i++) types.push(BKEY.zabor);
    types.forEach((t, i) => {
      const q = cells[i];
      if (!q) return;
      s.apply({ t: s.st.tick, id: `adm:f${side}${i}`, p: 'admin', k: 'adm', op: 'bgive', s: side, u: t, x: q.x, z: q.z, v: 3 } as Cmd);
      const b = s.bldAt(q.x, q.z);
      if (b) { b.paid = 1234; b.own = 17; b.cd = s.st.tick + 123; b.tg = 1234567; b.hit = s.st.tick; b.hp = b.mhp - 123.456; b.at = s.st.tick - 4321; n++; }
    });
  }
  return n;
}
