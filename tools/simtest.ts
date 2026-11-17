// Headless AI-vs-AI run: balance, speed, content events, state size, determinism, plus unit checks
// for every mechanic (heroes, v3: гелики, спортики, Мохьмад's (ersno) steal and Голем, админ pack,
// снюс/LOOP cards, places, Амина's slam and taunt aura), for the admin commands (every op, malformed
// bodies, channels, snapshots and rollback), and for unit control (orders, possession, validation,
// flow-field cache, snapshots and rollback).
// npx tsx tools/simtest.ts <minutes> <seed>
import { loadTerrain, lcAt, navIndex, passable, LC } from '../src/world/terrain';
import { Sim, hashState, PT_DONER, PT_PLACE0, PT_COUNT, OM, ORD_MAX, ORD_FLOWS, POSS_IDLE, ORD_IDLE, canControl, type Cmd, type State, type U } from '../src/sim/sim';
import {
  UNITS, CARDS, SIDE_NAME, RIDE, GOLEM, CHICKEN, CHIMAEV, BEKHAN, WOU, ADMIN, ERSNO, ADAM, MOHMAD, GELIK, SPORTIK, BOSS,
  HERO, PLACE, BUFF, Fx, SHOP, AMINA, AI_W, canBuy, unitName, cardText, type Card, type Side,
} from '../src/sim/defs';
import { ROSTER_ORDER, HERO_UNIT, heroForUnit, HEROES as HERO_LORE } from '../src/data/heroes';
import { CAPTURE_PLACES } from '../src/data/places';
import { HEROES as HEROES_T, HQ, ECON } from '../src/sim/defs';
import { normAdm, cleanSay } from '../src/sim/admin';
import { Session, type Backend } from '../src/net/session';
import { validCmd, validAdmCmd } from '../src/net/shared';
import { admBody, localChannel } from '../src/net/adminChannel';

const MIN = Number(process.argv[2] || 30);
const SEED = Number(process.argv[3] || 42);
const t0 = performance.now();
const terrain = await loadTerrain();
const t1 = performance.now();
let blocked = 0; for (const c of terrain.navCost) if (!c) blocked++;
console.log(`terrain ${terrain.W}x${terrain.H} nav ${terrain.nw}x${terrain.nh} blocked ${(100 * blocked / terrain.navCost.length).toFixed(1)}% load ${(t1 - t0).toFixed(0)}ms`);
const cfg: Cmd[] = [{ t: 0, id: 'c0', p: 'x', k: 'cfg', d: 1, hs: -1, mp: 0 }];
const name = (s: number, t: number) => UNITS[t].name[s];
const ts = (tick: number) => { const m = Math.floor(tick / 600), s = Math.floor((tick % 600) / 10); return `${m}:${String(s).padStart(2, '0')}`; };

/** Collected unit checks: each prints one line; any failure sets the exit code. */
const fails: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  if (!ok) { fails.push(label); process.exitCode = 1; }
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
}

function run(seed: number, ticks: number, log: boolean, sizeEvery = 0) {
  const sim = new Sim(terrain);
  sim.init(seed);
  sim.quiet = !log;
  let maxU = 0, wars = 0, maxBytes = 0, maxBytesAt = 0, nulls = 0; const donerTicks = [0, 0];
  const counts: Record<string, number> = {};
  const heroIn = [0, 0];
  const stolen = [0, 0], minMoney = [Infinity, Infinity], placeHeld = [0, 0, 0, 0];
  const t2 = performance.now();
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? cfg : undefined);
    const st = sim.st;
    maxU = Math.max(maxU, st.units.length);
    if (st.pts[PT_DONER].owner >= 0) donerTicks[st.pts[PT_DONER].owner]++;
    for (let k = 0; k < 4; k++) { const p = st.pts[PT_PLACE0 + k]; if (p.owner >= 0 && p.owner !== p.side) placeHeld[k]++; }
    minMoney[0] = Math.min(minMoney[0], st.sides[0].money); minMoney[1] = Math.min(minMoney[1], st.sides[1].money);
    if (sizeEvery && i % sizeEvery === 0) {
      const j = JSON.stringify(st), b = j.length;
      if (b > maxBytes) { maxBytes = b; maxBytesAt = st.tick; }
      if (j.includes('null')) nulls++; // NaN/Infinity would come back as null and break replays
    }
    if (log) for (const e of sim.fx) {
      counts[e.e] = (counts[e.e] || 0) + 1;
      const T = ts(st.tick);
      switch (e.e) {
        case 'capture': console.log(T, 'capture', st.pts[e.p].name, e.s >= 0 ? SIDE_NAME[e.s] : 'нейтрал'); break;
        case 'floor': console.log(T, 'floor', SIDE_NAME[e.s], e.floors); break;
        case 'boss': console.log(T, 'BOSS', SIDE_NAME[e.s]); break;
        case 'voteResult': console.log(T, 'vote', SIDE_NAME[e.s], e.title); break;
        case 'victory': console.log(T, 'VICTORY', SIDE_NAME[e.s]); wars++; break;
        case 'spawn': if (UNITS[e.t].hero || e.t === RIDE || e.t === GELIK) { if (UNITS[e.t].hero) heroIn[e.s]++; console.log(T, '  +', SIDE_NAME[e.s], name(e.s, e.t)); } break;
        case 'event': console.log(T, 'EVENT', e.key, `«${e.title}»`, e.quote, `until ${ts(e.until)}`); break;
        case 'ability': counts['ab:' + e.key] = (counts['ab:' + e.key] || 0) + 1; if (e.key !== 'bolt') console.log(T, '  ability', SIDE_NAME[e.s], name(e.s, e.t), e.key); break;
        case 'unload': console.log(T, '  unload', SIDE_NAME[e.s], e.n, 'пацанов'); break;
        case 'summon': console.log(T, '  summon', SIDE_NAME[e.s], name(e.s, e.t), '×' + e.n); break;
        case 'heroDown': console.log(T, '  heroDown', SIDE_NAME[e.s], name(e.s, e.t)); break;
        case 'heroBack': console.log(T, '  heroBack', SIDE_NAME[e.s], name(e.s, e.t), e.id > 0 ? 'с пар' : 'можно снова'); break;
        case 'poison': console.log(T, '  poison', SIDE_NAME[e.s], e.n); break;
        case 'hack': console.log(T, '  hack', SIDE_NAME[e.s], '→', SIDE_NAME[e.v], 'until', ts(e.until)); break;
        case 'stunN': console.log(T, '  Н', SIDE_NAME[e.s], 'stunned', e.n); break;
        case 'voteSkip': console.log(T, 'voteSkip', SIDE_NAME[e.s]); break;
        case 'steal': stolen[e.s] += e.n; if (e.k === 'card') console.log(T, '  списание', SIDE_NAME[e.s], '←', SIDE_NAME[e.v], e.n, '₽'); break;
        case 'pack': console.log(T, '  пачка', SIDE_NAME[e.s], 'scared', e.n, 'until', ts(e.until)); break;
        case 'comedown': console.log(T, '  отходняк', SIDE_NAME[e.s]); break;
      }
    }
    sim.fx.length = 0;
  }
  const ms = performance.now() - t2;
  return { sim, ms, maxU, wars, counts, maxBytes, maxBytesAt, donerTicks, heroIn, nulls, stolen, minMoney, placeHeld };
}

const ticks = MIN * 600;
const a = run(SEED, ticks, true, 50);
const st = a.sim.st;
console.log('--- summary ---');
console.log('wins', st.sides[0].wins, st.sides[1].wins, 'era', st.era, 'money', st.sides.map(s => Math.round(s.money)), 'floors', st.sides.map(s => s.floors), 'units', [0, 1].map(s => a.sim.count(s as Side)), 'maxUnits', a.maxU);
console.log('composition', JSON.stringify([0, 1].map(s => UNITS.map((_, t) => st.units.filter(u => u.s === s && u.t === t).length))));
console.log('heroes deployed', a.heroIn, 'Донер Бей owned (min)', a.donerTicks.map(n => (n / 600).toFixed(1)), 'places held by the enemy (min)', a.placeHeld.map(n => (n / 600).toFixed(1)));
console.log('₽ stolen by ersno', a.stolen, 'lowest bank', a.minMoney.map(m => m.toFixed(1)));
console.log('events', JSON.stringify(a.counts));
console.log(`state JSON peak ${(a.maxBytes / 1024).toFixed(1)} KB at ${ts(a.maxBytesAt)} (limit for shared checkpoints 256 KB); samples with NaN/null: ${a.nulls}`);
if (a.nulls) process.exitCode = 1;
if (a.minMoney[0] < 0 || a.minMoney[1] < 0) { console.log('NEGATIVE BANK'); process.exitCode = 1; }
const q = run(SEED, ticks, false);
console.log(`throughput (quiet) ${MIN} min in ${q.ms.toFixed(0)}ms = ${(ticks / q.ms * 1000).toFixed(0)} ticks/s; logged run ${(ticks / a.ms * 1000).toFixed(0)} ticks/s`);

// ---- deploy rules ----------------------------------------------------------------------
{
  const s = new Sim(terrain); s.init(7); s.quiet = true;
  for (let i = 0; i < 5; i++) s.step(i === 0 ? cfg : undefined);
  s.st.sides[0].money = s.st.sides[1].money = 5000;
  const at = s.st.pts[0], ku = s.st.pts[1];
  const checks: [string, string][] = [];
  checks.push(['чимаев за Атаги', s.canDeploy(0, CHIMAEV, at.x + 3, at.z)]);
  checks.push(['бекхан за Курчалой', s.canDeploy(1, BEKHAN, ku.x - 3, ku.z)]);
  checks.push(['голем', s.canDeploy(0, GOLEM, at.x + 3, at.z)]);
  checks.push(['курица', s.canDeploy(0, CHICKEN, at.x + 3, at.z)]);
  checks.push(['босс', s.canDeploy(0, 5, at.x + 3, at.z)]);
  const ok = s.canDeploy(1, CHIMAEV, ku.x - 3, ku.z);
  checks.push(['чимаев за Курчалой (ok)', ok]);
  s.spawnGroup(1, CHIMAEV, ku.x - 3, ku.z, -2);
  checks.push(['второй чимаев', s.canDeploy(1, CHIMAEV, ku.x - 3, ku.z)]);
  const id = s.st.sides[1].hero[CHIMAEV];
  s.unit(id)!.hp = 0; s.step(undefined);
  checks.push(['чимаев после смерти', s.canDeploy(1, CHIMAEV, ku.x - 3, ku.z)]);
  checks.push(['heroWait', String(s.heroWait(1, CHIMAEV))]);
  s.spawnGroup(0, WOU, at.x + 3, at.z, -2);
  s.startEvent('classes');
  checks.push(['Амин на парах', s.canDeploy(0, WOU, at.x + 3, at.z)]);
  s.st.ev.friday = s.st.tick + 100;
  checks.push(['такси в пятницу', String(s.cost(0, RIDE)) + ' / маршрутка ' + s.cost(1, RIDE)]);
  s.spawnGroup(1, WOU, ku.x - 3, ku.z, -2);
  checks.push(['второй Амин', s.canDeploy(1, WOU, ku.x - 3, ku.z)]);
  console.log('deploy rules:', checks.map(([k, v]) => `${k}: «${v}»`).join('; '));
  const bad = !checks[0][1] || !checks[1][1] || !checks[2][1] || !checks[3][1] || checks[5][1] || checks[6][1] !== 'Чимаев уже на поле' || checks[7][1] !== 'Ещё не вернулся' || !checks[9][1].includes('На парах') || checks[11][1] !== 'Амин уже на поле';
  if (bad) { console.log('DEPLOY RULES FAILED'); process.exitCode = 1; }
}

// ---- v3 unit checks -------------------------------------------------------------------
/** Private Sim internals the checks drive directly. */
interface Priv {
  applyCard(s: Side, c: Card, f: number): void;
  packUlt(u: U): void; cardSteal(u: U): void; adminN(u: U): void; taunt(u: U, emit?: boolean): void; openVote(s: Side): void;
  slam(u: U): void; knock(a: U, t: U, f: number): void; heroOk(s: Side, t: number): boolean;
  stats(u: U): { dmg: number; range: number; spd: number; cd: number };
  income(s: Side): number; hash(): void;
  splash(s: Side, x: number, z: number, r: number, dmg: number, slow: number, knock: number, stun?: number): void;
}
const P = (s: Sim) => s as unknown as Priv;
/** A world with no AI, no militia, no сход, no world events and no income: only what a check does moves. */
function sandbox(seed = 5): Sim {
  const s = new Sim(terrain); s.init(seed); s.quiet = false;
  s.step(cfg);
  const st = s.st;
  st.nextMilitia = st.nextVote = st.ev.next = 1e9;
  for (const sd of st.sides) { sd.aiNext = 1e9; sd.black = 1e9; }
  s.fx.length = 0;
  return s;
}
const stat = (s: Sim, u: U) => { const r = P(s).stats(u); return { dmg: r.dmg, spd: r.spd, cd: r.cd }; };
const near2 = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

console.log('--- v3 checks ---');
// names and shop
check('names: Чимаев without 5.5, WOU shown as Амин', unitName(1, CHIMAEV) === 'Чимаев' && unitName(0, WOU) === 'Амин' && UNITS[WOU].name.every(n => n === 'Амин') && !UNITS.some(u => u.name.some(n => /WOU|5\.5/.test(n))));
check('shop has спортики before the ride and the гелик after it', SHOP.indexOf(SPORTIK) < SHOP.indexOf(RIDE) && SHOP.indexOf(GELIK) === SHOP.indexOf(RIDE) + 1);
check('clean/18+ card text', cardText(CARDS[30], false).title === 'Энергетик в ларьке' && cardText(CARDS[30], true).title === 'Закинуть снюс' && cardText(CARDS[31], false).title === 'Двойной эспрессо' && cardText(CARDS[31], true).title === 'Бамб LOOP' && cardText(CARDS[3], false, 'Цоци-Юрт').title === 'Все на Цоци-Юрт!');
check('no 18+ words in clean card text', !CARDS.some(c => /снюс|LOOP|бамб/i.test(c.title + c.quote)));
check('card ids are their indices', CARDS.every((c, i) => c.id === i) && CARDS.length === 34);

// places
{
  const s = sandbox();
  const pts = s.st.pts;
  check('13 points; places at 9..12 in CAPTURE_PLACES order, kind 3, owned by their home side', pts.length === PT_COUNT && CAPTURE_PLACES.every((c, i) => { const p = pts[PT_PLACE0 + i]; return p.key === c.key && p.kind === 3 && p.perk === c.perk && p.side === c.side && p.owner === c.side && p.r === PLACE.r && p.prog === (c.side ? 100 : -100); }));
  const reach = (f: number, h: number) => { let m = 0x3fffffff; for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) m = Math.min(m, s.flows[f].dist[navIndex(terrain, pts[h].x + i * 2, pts[h].z + j * 2)]); return m; };
  check('flow fields reach every place from both high-rises', pts.slice(PT_PLACE0).every((_, k) => [0, 1].every(h => reach(PT_PLACE0 + k, h) < 0x3fffffff)));
  check('гелик −30% with the car wash', s.cost(0, GELIK) === 210 && s.cost(1, GELIK) === 300);
  const w1 = s.spawn(1, 1, pts[4].x, pts[4].z, -1), w0 = s.spawn(0, 1, pts[4].x, pts[4].z, -1), sp1 = s.spawn(1, SPORTIK, pts[4].x, pts[4].z, -1);
  check('качалка: Курчалой wrestlers and спортики +20% hp', w1.mhp === 480 && w0.mhp === 400 && sp1.mhp === 96, `${w1.mhp}/${w0.mhp}/${sp1.mhp}`);
  for (const sd of s.st.sides) sd.black = 0;
  const i0 = [P(s).income(0), P(s).income(1)];
  pts[12].owner = 0; pts[12].prog = -100; pts[10].owner = 1; pts[10].prog = 100;
  const i1 = [P(s).income(0), P(s).income(1)];
  check('рынок +3 ₽/s follows the owner', i1[0] - i0[0] === PLACE.market && i0[1] - i1[1] === PLACE.market, `${i0} → ${i1}`);
  check('captured car wash: the discount moves to Курчалой', s.cost(1, GELIK) === 210 && s.cost(0, GELIK) === 300);
  for (const sd of s.st.sides) sd.black = 1e9;
  // спортики every 40 s at the stadium, for whoever owns it
  const before = s.countType(0, SPORTIK);
  s.st.tick = PLACE.sportikiEvery * 3 + PLACE.sportikiAt; s.fx.length = 0;
  s.step(undefined);
  const sum = s.fx.find(e => e.e === 'summon' && e.t === SPORTIK);
  check('стадион: a free squad of спортики every 40 s', s.countType(0, SPORTIK) - before === 4 && !!sum && near2(s.st.units[s.st.units.length - 1], pts[9]) < 3);
  // the enemy can take a place: 6 Курчалой пацаны stand on the Атаги stadium
  const stad = pts[9];
  const crew: U[] = [];
  for (let i = 0; i < 6; i++) { const u = s.spawn(1, 0, stad.x + (i % 3) * 0.5 - 0.5, stad.z + Math.floor(i / 3) * 0.5, -1); u.hp = u.mhp = 1e6; crew.push(u); }
  for (const u of s.st.units) if (u.s === 0 && near2(u, stad) < 8) u.hp = 0; // the free спортики leave the fight
  let neutralAt = -1, takenAt = -1; const t0c = s.st.tick;
  for (let i = 0; i < 400 && takenAt < 0; i++) {
    for (const u of crew) { u.x = stad.x + ((u.id % 3) - 1) * 0.6; u.z = stad.z + ((u.id >> 2) % 2) * 0.6; u.tg = -1; }
    s.step(undefined);
    if (neutralAt < 0 && stad.owner === -1) neutralAt = s.st.tick - t0c;
    if (stad.owner === 1) takenAt = s.st.tick - t0c;
  }
  check('enemy capture of a home place takes ~20 s with 5+ uncontested (not trivial)', neutralAt >= 95 && takenAt >= 190, `neutral after ${neutralAt} ticks, taken after ${takenAt}`);
  for (const u of crew) u.hp = 0;
  s.step(undefined);
  stad.prog = 60;
  for (let i = 0; i < 50; i++) s.step(undefined);
  check('uncontested owner slowly firms up its place', stad.owner === 1 && stad.prog === 60 + 10 * PLACE.regen, `60 → ${stad.prog}`);
  s.st.tick = PLACE.sportikiEvery * 9 + PLACE.sportikiAt - 1;
  const k1 = s.countType(1, SPORTIK);
  s.step(undefined); s.step(undefined);
  check('captured stadium now gives Курчалой the спортики', s.countType(1, SPORTIK) - k1 === 4);
}

// гелик: cap, KRA immunities
{
  const s = sandbox();
  const at = s.st.pts[0], c = s.st.pts[4];
  s.st.sides[0].money = 5000;
  s.spawnGroup(0, GELIK, at.x + 3, at.z, -2); s.spawnGroup(0, GELIK, at.x + 3, at.z + 1, -2);
  check('max 2 гелика per side', s.canDeploy(0, GELIK, at.x + 3, at.z) === 'Два гелика уже на районе' && s.canDeploy(1, GELIK, s.st.pts[1].x - 3, s.st.pts[1].z) !== 'Два гелика уже на районе');
  const g = s.spawn(1, GELIK, c.x + 2, c.z, -1), p = s.spawn(1, 0, c.x + 2, c.z + 1, -1);
  const adm = s.spawn(0, ADMIN, c.x, c.z, -1), amin = s.spawn(0, WOU, c.x, c.z - 1, -1);
  P(s).hash(); adm.ab = 0; P(s).adminN(adm);
  check('«Н» stuns пацаны but not the гелик', p.stun > s.st.tick && g.stun <= s.st.tick);
  p.stun = 0; P(s).hash(); P(s).splash(0, c.x + 2, c.z, 3, 0, 40, 0, 20);
  check('slows and stuns from splashes skip the гелик', g.slow <= s.st.tick && g.stun <= s.st.tick && p.slow > s.st.tick && p.stun > s.st.tick);
  P(s).taunt(amin);
  check('Амин «Рейджбайт» does not taunt the гелик', g.tt === 0 && p.tt > s.st.tick);
  const argun = s.st.pts[7];
  const g2 = s.spawn(1, GELIK, argun.x, argun.z, -1), p2 = s.spawn(1, 0, argun.x, argun.z, -1);
  const gs = stat(s, g2).spd, ps = stat(s, p2).spd;
  s.startEvent('jam'); s.st.sides[1].n = s.st.tick + 100; p2.slow = g2.slow = s.st.tick + 100;
  check('пробки, «Н» указ and slows: гелик keeps its speed', stat(s, g2).spd === gs && stat(s, p2).spd < ps * 0.1, `${stat(s, g2).spd} vs ${stat(s, p2).spd}`);
  let wx = -1, wz = -1;
  for (let z = 1; z < terrain.H - 1 && wx < 0; z += 1) for (let x = 1; x < terrain.W - 1; x += 1) if (lcAt(terrain, x, z) === LC.WATER) { wx = x; wz = z; break; }
  const g3 = s.spawn(1, GELIK, wx, wz, -1), p3 = s.spawn(1, 0, wx, wz, -1);
  s.st.ev.jam = 0; s.st.sides[1].n = 0; p3.slow = 0;
  const gs3 = stat(s, g3).spd, ps3 = stat(s, p3).spd;
  s.startEvent('flood');
  check('Аргун разлился: гелик drives through the water at full speed', wx >= 0 && stat(s, g3).spd === gs3 && stat(s, p3).spd === ps3 * 0.5);
  check('гелик is heavy: the AI may not buy a third', !(s as unknown as { heroOk(s: Side, t: number): boolean }).heroOk(0, GELIK));
}

// ersno: steal on hits, «Списание с карты»
{
  const s = sandbox();
  const c = s.st.pts[4];
  const e = s.spawn(0, ERSNO, c.x, c.z, -1), bag = s.spawn(1, 1, c.x + 1.2, c.z, -1);
  e.hp = e.mhp = 1e6; bag.hp = bag.mhp = 1e6; e.ab = 1e6;
  s.st.sides[1].money = 7.5; s.st.sides[0].money = 0;
  let low = Infinity, events = 0, sum = 0;
  for (let i = 0; i < 80; i++) {
    s.step(undefined);
    low = Math.min(low, s.st.sides[1].money);
    for (const f of s.fx) if (f.e === 'steal') { events++; sum += f.n; }
    s.fx.length = 0;
  }
  check('melee steal takes only what the enemy has: 4 + 3, then nothing', sum === 7 && events === 2 && s.st.sides[1].money === 0.5 && s.st.sides[0].money === 7 && low >= 0, `stole ${sum} in ${events}, banks ${s.st.sides.map(x => x.money)}`);
  s.st.sides[1].money = 1000;
  const fresh = s.spawn(1, 0, c.x - 2, c.z, -1); fresh.hp = fresh.mhp = 1e6;
  for (let i = 0; i < 3; i++) { const o = s.spawn(1, 0, c.x - 1, c.z + i * 0.5, -1); o.hp = o.mhp = 1e6; }
  P(s).hash(); e.ab = 0; s.fx.length = 0;
  P(s).cardSteal(e);
  const ev = s.fx.find(f => f.e === 'steal');
  check('«Списание с карты»: 10% of the enemy bank', s.st.sides[1].money === 900 && s.st.sides[0].money === 107 && e.ab === UNITS[ERSNO].abCd && !!ev && ev.e === 'steal' && ev.k === 'card' && ev.n === 100);
  s.st.sides[1].money = 5000; e.ab = 0; P(s).cardSteal(e);
  check('«Списание с карты» is capped at 150 ₽', s.st.sides[1].money === 4850);
  s.st.sides[1].money = 0.4; e.ab = 0; P(s).cardSteal(e);
  check('empty enemy bank: nothing taken, retries in a second', s.st.sides[1].money === 0.4 && e.ab === 10);
  const lone = s.spawn(0, ERSNO, c.x + 30, c.z + 30, -1); s.st.sides[1].money = 1000; P(s).hash(); lone.ab = 0; P(s).cardSteal(lone);
  check('no crowd and no high-rise nearby: no «Списание»', s.st.sides[1].money === 1000 && lone.ab === 10);
  check('ersno is no tank: ~420 hp, no knockback, light', UNITS[ERSNO].hp === 420 && !UNITS[ERSNO].knock);
  // the AI buys him when the enemy is rich: count AI picks with the enemy bank full vs empty
  const pick = (rich: number) => {
    const t = sandbox(9); let n = 0;
    for (let i = 0; i < 300; i++) {
      const sd = t.st.sides[0];
      sd.aiNext = 0; sd.money = 2000; sd.aiWant = -1; t.st.sides[1].money = rich; sd.hero[ERSNO] = -1; sd.heroCd[ERSNO] = 0;
      for (let k = 0; k < 6; k++) if (t.count(0) < 8) t.spawn(0, 0, t.st.pts[0].x + 2, t.st.pts[0].z, -1);
      const before = t.st.units.length;
      (t as unknown as { ai(s: Side): void }).ai(0);
      for (let k = before; k < t.st.units.length; k++) if (t.st.units[k].t === ERSNO) { n++; t.st.units[k].hp = 0; t.st.sides[0].hero[ERSNO] = -1; }
      for (const u of t.st.units) if (u.s === 0 && u.t !== 0) u.hp = 0;
      t.st.units = t.st.units.filter(u => u.hp > 0); t.reindex();
    }
    return n;
  };
  const poor = pick(0), rich = pick(2000);
  check('AI buys ersno when the enemy is rich', rich > 3 * Math.max(1, poor), `rich ${rich} / poor ${poor} of 300`);
}

// ---- Мохьмад = ersno (type 9) brings the Голем; the old summoner (12) is retired --------------
{
  const s = sandbox();
  const c = s.st.pts[4], sd = s.st.sides[0];
  const e = s.spawn(0, ERSNO, c.x, c.z, -1);
  e.hp = e.mhp = 1e6;
  s.step(undefined);
  const g = s.st.units.find(u => u.t === GOLEM && u.s === 0);
  const sum = s.fx.find(f => f.e === 'summon' && f.t === GOLEM);
  check('Мохьмад (9) brings a Голем as soon as he is out, linked both ways', !!g && g.ld === e.id && e.ld === g.id && !!sum && sd.golem === s.st.tick - 1 + HERO.golemCd, `golem ${g?.id}, cd ${sd.golem}`);
  check('…and his «Списание с карты» keeps its own cooldown', e.ab > 0 && e.ab <= 60);
  for (let i = 0; i < 60; i++) s.step(undefined);
  check('one Голем at a time', s.countType(0, GOLEM) === 1);
  g!.hp = 0; s.step(undefined);
  const downAt = s.st.tick - 1;
  check('Голем down: the next one in golemCd', s.countType(0, GOLEM) === 0 && e.ld === -1 && sd.golem === downAt + HERO.golemCd, `cd ${sd.golem - downAt}`);
  let back = -1;
  for (let i = 0; i < HERO.golemCd + 20 && back < 0; i++) { s.step(undefined); if (s.countType(0, GOLEM) === 1) back = s.st.tick - 1 - downAt; }
  check('…and he brings a new one right on time', back === HERO.golemCd, `after ${back} ticks`);
  P(s).applyCard(0, CARDS[26], -1);
  check('«Копил ульту» readies the Голем timer too', sd.golem === 0);
  // the old Мохьмад (12) from a save: still fights and summons with his own U.ab
  const old = s.spawn(1, MOHMAD, c.x + 30, c.z + 30, -1); old.hp = old.mhp = 1e6;
  const sd1 = s.st.sides[1], k0 = sd1.golem;
  s.step(undefined); s.step(undefined);
  const og = s.st.units.find(u => u.t === GOLEM && u.s === 1);
  check('old unit 12 still summons on U.ab', !!og && og.ld === old.id && old.ld === og.id && old.ab > UNITS[MOHMAD].abCd! - 5 && sd1.golem === k0);
  og!.hp = 0; s.step(undefined);
  check('…and waits abCd after his Голем falls (SideState.golem untouched)', old.ld === -1 && old.ab >= UNITS[MOHMAD].abCd! - 1 && sd1.golem === k0);
  // unit 12 is out of the shop, the AI, the roster; 9 is shown as Мохьмад everywhere
  const at = s.st.pts[0];
  s.st.sides[0].money = 9999;
  check('unit 12 cannot be bought: not in SHOP, canBuy false, deploy refused, no AI weight', !SHOP.includes(MOHMAD) && !canBuy(0, MOHMAD) && !canBuy(1, MOHMAD)
    && s.canDeploy(0, MOHMAD, at.x + 3, at.z) !== '' && AI_W[0][MOHMAD] === 0 && AI_W[1][MOHMAD] === 0 && !P(s).heroOk(0, MOHMAD) && !P(s).heroOk(1, MOHMAD));
  check('one Мохьмад: type 9 named Мохьмад, roster without a second card, old 12 shown as him', UNITS[ERSNO].name.every(n => n === 'Мохьмад') && unitName(0, ERSNO) === 'Мохьмад'
    && unitName(1, MOHMAD) === 'Мохьмад' && HERO_LORE.ersno.name === 'Мохьмад' && !(ROSTER_ORDER as string[]).includes('mohmad') && heroForUnit(12, 0) === 'ersno' && heroForUnit(9, 1) === 'ersno'
    && !UNITS.some(u => u.name.some(n => /ersno/.test(n))) && CARDS[28].quote.includes('Мохьмад'));
}

// ---- Амина (type 18): Атаги tank, «Плюхнулась», taunt aura --------------------------------
{
  const s = sandbox();
  const c = s.st.pts[4];
  check('Амина: Атаги only, in the shop after the other heroes, 2400–2800 hp, heavy, slow', canBuy(0, AMINA) && !canBuy(1, AMINA) && SHOP[SHOP.length - 1] === AMINA
    && SHOP.indexOf(AMINA) > Math.max(...[CHIMAEV, BEKHAN, WOU, ADMIN, ERSNO, ADAM].map(t => SHOP.indexOf(t))) && UNITS[AMINA].hero === true && UNITS[AMINA].hp >= 2400 && UNITS[AMINA].hp <= 2800
    && UNITS[AMINA].mass! > 1 && UNITS[AMINA].speed < UNITS[0].speed && ROSTER_ORDER.includes('amina') && HERO_UNIT.amina === AMINA && heroForUnit(AMINA, 0) === 'amina');
  const a = s.spawn(0, AMINA, c.x, c.z, -1);
  check('Амина spawns with full hp and a hero slot', a.hp === UNITS[AMINA].hp && a.mhp === a.hp && s.st.sides[0].hero[AMINA] === a.id);
  const w = s.spawn(1, 1, c.x + 1.5, c.z, -1);
  const ax = a.x, az = a.z;
  P(s).knock(w, a, 0.45); P(s).hash(); P(s).splash(1, c.x + 1, c.z, 3, 0, 0, 2.2, 0);
  check('never knocked back (melee knock, splash knock)', a.x === ax && a.z === az);
  w.hp = 0; s.step(undefined);
  P(s).hash(); a.ab = 0; P(s).slam(a);
  check('no crowd: no slam, retries in a second', a.ab === 10);
  // «Плюхнулась»: three enemies in reach
  const crowd: U[] = [];
  for (let i = 0; i < 3; i++) { const u = s.spawn(1, 0, c.x + 1.6, c.z - 0.8 + i * 0.8, -1); u.hp = u.mhp = 1e6; crowd.push(u); }
  const far = s.spawn(1, 0, c.x + 9, c.z, -1); far.hp = far.mhp = 1e6;
  const d0 = crowd.map(u => near2(u, a));
  P(s).hash(); a.ab = 0; s.fx.length = 0; P(s).slam(a);
  const ev = s.fx.find(f => f.e === 'ability' && f.key === 'slam');
  check('«Плюхнулась»: damage, stun, knockback to everyone in reach, cooldown, FxEv', crowd.every((u, i) => u.mhp - u.hp === HERO.slamDmg && u.stun === s.st.tick + HERO.slamStun && near2(u, a) > d0[i] + 0.5)
    && far.hp === far.mhp && far.stun === 0 && a.ab === UNITS[AMINA].abCd && !!ev && ev.e === 'ability' && ev.r === UNITS[AMINA].abR, crowd.map((u, i) => (near2(u, a) - d0[i]).toFixed(2)).join(' '));
  // taunt aura: enemies within 6 hit only her, so the пацан behind her is left alone
  for (const u of crowd) { u.stun = 0; u.x = a.x + 3; u.z = a.z; }
  const mate = s.spawn(0, 0, a.x + 1.8, a.z + 1.6, -1); mate.hp = mate.mhp = 1e6; // closer to them than she is
  for (const u of crowd) u.tg = mate.id;
  const gel = s.spawn(1, GELIK, a.x + 2, a.z + 2, -1), boss = s.spawn(1, BOSS, a.x - 2, a.z + 3, -1);
  far.x = a.x + 9; far.z = a.z;
  P(s).hash(); s.fx.length = 0; P(s).taunt(a, false);
  check('taunt aura: enemies within 6 switch to her; not the гелик, the boss, or anyone farther', crowd.every(u => u.tg === a.id && u.tn === a.id && u.tt === s.st.tick + HERO.tauntFor)
    && gel.tt === 0 && boss.tt === 0 && far.tt === 0 && !s.fx.some(f => f.e === 'taunt'));
  gel.hp = 0; boss.hp = 0; s.step(undefined);
  let pulsed = 0;
  for (let i = 0; i < HERO.tauntEvery; i++) { for (const u of crowd) u.tt = 0; s.step(undefined); if (crowd.every(u => u.tt > s.st.tick && u.tn === a.id)) pulsed++; }
  check('the aura pulses by itself every tauntEvery ticks', pulsed >= 1);
  P(s).hash(); P(s).taunt(a, false); // the loop above may have wiped the last pulse
  let hitMate = false;
  const mateHp = mate.hp;
  for (let i = 0; i < 60; i++) { s.step(undefined); if (mate.hp < mateHp) hitMate = true; }
  check('…and the пацан next to her is not hit, she takes it all', !hitMate && a.hp < a.mhp, `Амина ${Math.round(a.hp)}/${a.mhp}`);
}

// Амина fighting a crowd, snapshot through JSON and structuredClone mid-fight: slams and taunts replay the same
{
  const s = sandbox(11);
  const c = s.st.pts[4];
  const am = s.spawn(0, AMINA, c.x, c.z, -1);
  for (let i = 0; i < 4; i++) s.spawn(0, 0, c.x - 1.5, c.z - 1 + i * 0.6, -1);
  for (let i = 0; i < 10; i++) s.spawn(1, i % 3 ? 0 : 1, c.x + 4 + (i % 2), c.z - 2 + i * 0.45, -1);
  for (let i = 0; i < 70; i++) s.step(undefined);
  s.fx.length = 0;
  const taunted = s.st.units.filter(u => u.s === 1 && u.tn === am.id && u.tt > s.st.tick).length; // in the snapshot
  const okT = twin(s, 400, 'Амина vs crowd');
  const slams = s.fx.filter(f => f.e === 'ability' && f.key === 'slam').length;
  check('Амина: slams and taunts identical after JSON / structuredClone restore', okT && slams >= 1 && taunted >= 1, `${slams} slams, ${taunted} taunted in the window`);
}

// the AI buys Амина for Атаги (never for Курчалой)
{
  const pickA = (side: Side) => {
    const t = sandbox(13); let n = 0;
    for (let i = 0; i < 300; i++) {
      const sd = t.st.sides[side];
      sd.aiNext = 0; sd.money = 3000; sd.aiWant = -1; sd.hero[AMINA] = -1; sd.heroCd[AMINA] = 0;
      for (let k = 0; k < 6; k++) if (t.count(side) < 8) t.spawn(side, 0, t.st.pts[side].x + (side ? -2 : 2), t.st.pts[side].z, -1);
      const before = t.st.units.length;
      (t as unknown as { ai(s: Side): void }).ai(side);
      for (let k = before; k < t.st.units.length; k++) if (t.st.units[k].t === AMINA) n++;
      for (const u of t.st.units) if (u.s === side && u.t !== 0) u.hp = 0;
      t.st.units = t.st.units.filter(u => u.hp > 0); t.reindex();
      sd.hero[AMINA] = -1;
    }
    return n;
  };
  const a0 = pickA(0), a1 = pickA(1);
  check('AI buys Амина for Атаги only', a0 > 0 && a1 === 0, `Атаги ${a0} / Курчалой ${a1} of 300`);
}

// админ «Курение убивает»
{
  const s = sandbox();
  const c = s.st.pts[4], now0 = s.st.tick;
  const adm = s.spawn(0, ADMIN, c.x, c.z, -1); adm.hp = adm.mhp = 1e6;
  check('pack is not ready right after the admin spawns', s.st.sides[0].pack === now0 + HERO.packFirst);
  const crowd: U[] = [];
  for (let i = 0; i < 5; i++) { const u = s.spawn(1, 0, c.x + 4 + (i % 2) * 0.6, c.z - 1 + i * 0.5, -1); u.hp = u.mhp = 1e6; crowd.push(u); }
  const g = s.spawn(1, GELIK, c.x + 4, c.z + 2, -1), boss = s.spawn(1, BOSS, c.x + 5, c.z + 1, -1);
  P(s).hash(); s.st.sides[0].pack = 0; s.fx.length = 0;
  const few = s.spawn(1, 0, c.x - 20, c.z, -1);
  P(s).packUlt(adm);
  const pk = s.st.packs[0], ev = s.fx.find(f => f.e === 'pack');
  check('pack lands at the centroid of the crowd', s.st.packs.length === 1 && Math.abs(pk.x - (c.x + 4.4)) < 1.2 && Math.abs(pk.z - c.z) < 1.5 && pk.until === s.st.tick + HERO.packFor && pk.r === HERO.packR, `at ${pk?.x.toFixed(1)},${pk?.z.toFixed(1)}`);
  check('FxEv pack with the scared count', !!ev && ev.e === 'pack' && ev.n === 5 && s.st.sides[0].pack === s.st.tick + HERO.packCd);
  check('crowd scared and poisoned; гелик untouched; boss poisoned but not scared', crowd.every(u => u.fr === s.st.tick + HERO.fearFor && u.psn > s.st.tick) && g.fr === 0 && g.psn === 0 && boss.fr === 0 && boss.psn > s.st.tick && few.fr === 0);
  const d0 = crowd.reduce((m, u) => m + near2(u, pk), 0);
  let attacked = false;
  for (let i = 0; i < 30; i++) { s.step(undefined); if (crowd.some(u => u.cd > 0 || u.tg >= 0)) attacked = true; }
  const d1 = crowd.reduce((m, u) => m + near2(u, pk), 0);
  check('scared units run from the pack and never attack', d1 > d0 + 5 && !attacked, `sum of distances ${d0.toFixed(1)} → ${d1.toFixed(1)}`);
  for (let i = 0; i < 70; i++) s.step(undefined);
  check('pack gone after 6 s, fear over 4 s after the last whiff', s.st.packs.length === 0 && crowd.every(u => u.fr <= s.st.tick));
  // «Н ма дилита» on the enemy: poisoned, not scared
  s.st.sides[0].pack = 0; s.st.sides[1].immune = s.st.tick + 100;
  for (const u of crowd) { u.x = c.x + 4; u.z = c.z; }
  P(s).hash(); P(s).packUlt(adm);
  check('«Н ма дилита» blocks the fear', s.st.packs.length === 1 && crowd.every(u => u.fr <= s.st.tick));
  const cd0 = s.st.sides[0].pack;
  P(s).applyCard(0, CARDS[26], -1);
  check('«Копил ульту» readies the pack too', s.st.sides[0].pack === 0 && cd0 > s.st.tick);
}

// сход cards 30..33
{
  const s = sandbox();
  const c = s.st.pts[4];
  const u = s.spawn(0, 0, c.x, c.z, -1);
  const base = stat(s, u);
  P(s).applyCard(0, CARDS[30], -1);
  const on = stat(s, u), until = s.st.sides[0].snus;
  check('снюс/энергетик: +30% attack speed, +15% speed for 25 s', until === s.st.tick + 250 && on.cd === 6 && Math.abs(on.spd - base.spd * BUFF.snusSpd) < 1e-12);
  s.st.tick = until; s.fx.length = 0; s.step(undefined);
  const off = stat(s, u), cd = s.fx.find(f => f.e === 'comedown');
  check('then «отходняк»: −20% speed for 10 s (FxEv comedown)', !!cd && cd.e === 'comedown' && cd.until === until + BUFF.offFor && off.cd === base.cd && Math.abs(off.spd - base.spd * BUFF.offSpd) < 1e-12);
  s.st.tick = until + BUFF.offFor;
  check('…and back to normal', stat(s, u).spd === base.spd && stat(s, u).cd === base.cd);
  const hp0 = u.hp;
  const adm = s.spawn(1, ADMIN, c.x + 1, c.z, -1), p2 = s.spawn(0, 0, c.x + 1.5, c.z + 0.5, -1);
  P(s).applyCard(0, CARDS[31], -1);
  check('Бамб LOOP/эспрессо: «сушняк» −5% of max hp once, +20% damage', Math.abs(u.hp - (hp0 - u.mhp * BUFF.loopHp)) < 1e-9 && Math.abs(stat(s, u).dmg - base.dmg * BUFF.loopDmg) < 1e-12);
  P(s).hash(); adm.ab = 0; P(s).adminN(adm); P(s).splash(1, c.x, c.z, 4, 0, 0, 0, 30);
  check('Бамб LOOP: stuns do not stick', u.stun <= s.st.tick && p2.stun <= s.st.tick && adm.ab === 10);
  s.st.tick = s.st.sides[0].loop;
  P(s).hash(); P(s).splash(1, c.x, c.z, 4, 0, 0, 0, 30);
  check('Бамб LOOP wears off after 20 s', u.stun > s.st.tick && stat(s, u).dmg === base.dmg);
  const g0 = s.countType(0, GELIK);
  P(s).applyCard(0, CARDS[32], -1);
  P(s).applyCard(0, CARDS[32], -1);
  check('Гелики с КРА номерами: 2 free, never past the cap', g0 === 0 && s.countType(0, GELIK) === 2);
  let drawn = 0;
  for (let i = 0; i < 200; i++) { P(s).openVote(0); if (s.st.votes[0].opts.includes(32)) drawn++; }
  for (const x of s.st.units) if (x.t === GELIK) x.hp = 0;
  s.step(undefined);
  let drawn2 = 0;
  for (let i = 0; i < 200; i++) { P(s).openVote(0); if (s.st.votes[0].opts.includes(32)) drawn2++; }
  check('гелик card is out of the pool at the cap, back in below it', drawn === 0 && drawn2 > 0, `${drawn} / ${drawn2} of 200`);
  const sp0 = s.countType(1, SPORTIK);
  P(s).applyCard(1, CARDS[33], -1);
  check('Спортики с района: two squads of four', s.countType(1, SPORTIK) - sp0 === 8);
  const pool: Record<number, number> = {};
  for (let i = 0; i < 400; i++) { P(s).openVote(1); for (const o of s.st.votes[1].opts) pool[o] = (pool[o] || 0) + 1; }
  check('new cards are in the сход pool', [30, 31, 32, 33].every(id => (pool[id] || 0) > 0) && CARDS.filter(c2 => c2.fx >= Fx.Snus).length === 4, JSON.stringify([30, 31, 32, 33].map(id => pool[id] || 0)));
}

// ---- determinism: same seed twice, plus JSON snapshot/restore mid-run with all content alive ----
function forceContent(sim: Sim) {
  const at = sim.st.pts[0], ku = sim.st.pts[1];
  sim.st.sides[0].money += 5000; sim.st.sides[1].money += 5000;
  const put = (s: Side, t: number, x: number, z: number) => { if (!UNITS[t].hero || sim.st.sides[s].hero[t] === -1) sim.spawnGroup(s, t, x, z, -2); };
  for (const t of [WOU, ADMIN, ERSNO, BEKHAN, ADAM, MOHMAD, GELIK, SPORTIK, AMINA]) put(0, t, at.x + 4, at.z + 1);
  for (const t of [CHIMAEV, WOU, ADMIN, ERSNO, ADAM, MOHMAD, GELIK, SPORTIK]) put(1, t, ku.x - 4, ku.z + 1);
  sim.startEvent('jam');
}
/** Short-lived things right before a snapshot: rides, chickens, Фудзи poison, снюс + LOOP, a pack with scared units, a lost place. */
function forceLate(sim: Sim) {
  const at = sim.st.pts[0], ku = sim.st.pts[1], sh = sim.st.pts[4];
  sim.spawnGroup(0, RIDE, at.x + 4, at.z, -2); sim.spawnGroup(1, RIDE, ku.x - 4, ku.z, -2);
  for (let i = 0; i < 4; i++) { sim.spawn(0, CHICKEN, sh.x + i * 0.5, sh.z, -1); sim.spawn(1, CHICKEN, sh.x + i * 0.5, sh.z + 3, -1); }
  P(sim).applyCard(1, CARDS[18], -1);
  P(sim).applyCard(0, CARDS[30], -1); P(sim).applyCard(1, CARDS[31], -1);
  const adm = sim.spawn(0, ADMIN, sh.x - 6, sh.z, -1);
  for (let i = 0; i < 5; i++) sim.spawn(1, SPORTIK, sh.x - 3, sh.z + i * 0.5, -1);
  P(sim).hash(); sim.st.sides[0].pack = 0; P(sim).packUlt(adm);
  const m = sim.st.pts[12]; m.owner = 0; m.prog = -100;
}
function runTo(seed: number, n: number, at: Record<number, (s: Sim) => void> = {}) {
  const s = new Sim(terrain); s.init(seed); s.quiet = true;
  for (let i = 0; i < n; i++) { at[i]?.(s); s.step(i === 0 ? cfg : undefined); }
  return s;
}
const live = (s: Sim) => {
  const now = s.st.tick, n = (f: (u: U) => boolean) => s.st.units.filter(f).length;
  return JSON.stringify({
    heroes: n(u => !!UNITS[u.t].hero), away: s.st.away.length, rides: n(u => u.t === RIDE), golems: n(u => u.t === GOLEM), chickens: n(u => u.t === CHICKEN),
    geliks: n(u => u.t === GELIK), sportiki: n(u => u.t === SPORTIK), packs: s.st.packs.length, scared: n(u => u.fr > now), poisoned: n(u => u.psn > now),
    snus: s.st.sides.map(x => x.snus > now ? 1 : x.snus + BUFF.offFor > now && x.snus ? -1 : 0), loop: s.st.sides.map(x => (x.loop > now ? 1 : 0)), aoe: s.st.aoe.length,
    places: s.st.pts.slice(PT_PLACE0).map(p => p.owner), ev: s.st.ev,
  });
};
/** Restores `b` through JSON and structuredClone and runs all three side by side. */
function twin(b: Sim, ticks: number, label: string): boolean {
  const json = JSON.stringify(b.st);
  const d = new Sim(terrain); d.load(JSON.parse(json) as State); d.quiet = true;
  const c = new Sim(terrain); c.load(b.snapshot()); c.quiet = true;
  let ok = hashState(b.st) === hashState(d.st);
  for (let i = 0; i < ticks && ok; i++) {
    b.step(undefined); d.step(undefined); c.step(undefined);
    if (i % 50 === 49 && (hashState(b.st) !== hashState(d.st) || hashState(b.st) !== hashState(c.st))) { ok = false; console.log(label, 'diverged at', ts(b.st.tick)); }
  }
  console.log(`snapshot ${label}: ${(json.length / 1024).toFixed(1)} KB`, ok ? 'ok' : 'DIVERGED');
  return ok;
}
const same = hashState(runTo(SEED, 6000).st) === hashState(runTo(SEED, 6000).st);
// heroes, гелики, спортики forced in at 5:00; rides, chickens, poison, снюс, LOOP, a pack and a lost place at 5:05; snapshot at 5:06
const b = runTo(SEED, 3060, { 3000: forceContent, 3050: forceLate });
console.log('content at 5:06', live(b));
const liveOk = b.st.packs.length > 0 && b.st.units.some(u => u.fr > b.st.tick) && b.st.units.some(u => u.t === GELIK) && b.st.units.some(u => u.t === SPORTIK) && b.st.sides[0].snus > b.st.tick && b.st.sides[1].loop > b.st.tick && b.st.units.some(u => u.t === ERSNO)
  && b.st.units.some(u => u.t === AMINA);
if (!liveOk) { console.log('v3 content not alive at the snapshot'); process.exitCode = 1; }
let ok = twin(b, 600, 'A (heroes, summons, rides, jam, poison, гелики, спортики, пачка, снюс, LOOP)');
// «Завтра учимся» right now: heroes are away «на парах» in the snapshot and come back after it
b.startEvent('classes');
console.log('content after classes', live(b));
ok = twin(b, 900, 'B (heroes away on classes)') && ok;
console.log('after return', live(b));
console.log('determinism', same && ok ? 'OK' : 'MISMATCH');
if (!(same && ok)) process.exitCode = 1;

// ---- worst case for shared checkpoints: both sides at the unit cap, every hero out, shots in the air ----
{
  const s = runTo(SEED, 3000, { 2999: forceContent });
  const p = s.st.pts[4];
  for (const sd of [0, 1] as Side[]) {
    for (let n = s.count(sd); n < 150; n++) s.spawn(sd, n % 3 ? 2 : SPORTIK, p.x + (sd ? 8 : -8) + (n % 10) * 0.4, p.z - 4 + Math.floor(n / 10) * 0.4, -1);
  }
  let peak = 0, at = 0;
  for (let i = 0; i < 60; i++) { s.step(undefined); const b = JSON.stringify(s.st).length; if (b > peak) { peak = b; at = s.st.proj.length; } }
  const kb = peak / 1024;
  console.log(`worst case (both sides at the 150 cap, all heroes, гелики): ${kb.toFixed(1)} KB with ${at} projectiles in flight`);
  if (kb > 200) { console.log('STATE TOO BIG'); process.exitCode = 1; }
}

// ---- old saves still load and replay identically ----
function migrates(label: string, old: State, n = 1200): boolean {
  const x = new Sim(terrain), y = new Sim(terrain);
  x.load(structuredClone(old)); y.load(JSON.parse(JSON.stringify(old)) as State); x.quiet = y.quiet = true;
  const shape = x.st.pts.length === PT_COUNT && x.st.sides.every(sd => sd.hero.length === UNITS.length && sd.heroCd.length === UNITS.length && sd.snus === 0 && sd.loop === 0 && (sd.pack === 0 || sd.hero[8] >= 0) && sd.golem === 0)
    && Array.isArray(x.st.packs) && x.st.units.every(u => u.fr === 0) && x.st.pts.slice(PT_PLACE0).every(p => p.owner === p.side);
  for (let i = 0; i < n; i++) { x.step(undefined); y.step(undefined); }
  const okm = shape && hashState(x.st) === hashState(y.st) && !JSON.stringify(x.st).includes('null');
  console.log(`old save migration (${label})`, okm ? 'OK' : 'FAILED');
  if (!okm) process.exitCode = 1;
  return okm;
}
const strip = (o: Record<string, unknown>, keys: string[]) => { for (const k of keys) delete o[k]; };
{ // d69dd41 format: no packs, no snus/loop/pack, no U.fr, hero arrays for 16 types, 9 points, no unit types 16..17
  const s = runTo(SEED, 2000);
  const old = JSON.parse(JSON.stringify(s.st)) as State;
  strip(old as unknown as Record<string, unknown>, ['packs']);
  old.pts.length = 9;
  old.units = old.units.filter(u => u.t < GELIK);
  for (const sd of old.sides) { strip(sd as unknown as Record<string, unknown>, ['snus', 'loop', 'pack', 'golem']); sd.hero.length = 16; sd.heroCd.length = 16; }
  for (const u of old.units) strip(u as unknown as Record<string, unknown>, ['fr']);
  migrates('d69dd41 format', old);
}
{ // before the content update: no Донер Бей, no hero fields at all
  const s = runTo(SEED, 2000);
  const old = JSON.parse(JSON.stringify(s.st)) as State;
  strip(old as unknown as Record<string, unknown>, ['aoe', 'away', 'ev', 'packs']);
  old.pts.length = 8;
  old.units = old.units.filter(u => u.t < 6);
  for (const sd of old.sides) strip(sd as unknown as Record<string, unknown>, ['hero', 'heroCd', 'hack', 'poor', 'weak', 'sauce', 'sauceM', 'dodge', 'immune', 'skip', 'aiWant', 'aiWantUntil', 'snus', 'loop', 'pack', 'golem']);
  for (const u of old.units) strip(u as unknown as Record<string, unknown>, ['psn', 'tt', 'tn', 'ld', 'f', 'fr']);
  migrates('pre-content format', old);
}
{ // bfa230a: v3 save with the capture places still at the old hand-placed spots, the market held by Атаги
  const s = runTo(SEED, 2000);
  const old = JSON.parse(JSON.stringify(s.st)) as State;
  const OLD = [[66.5, 178], [74.5, 183.5], [321.5, 98], [332, 117.5]];
  old.pts.slice(PT_PLACE0).forEach((p, k) => { p.x = OLD[k][0]; p.z = OLD[k][1]; p.name = 'old'; });
  const mk = old.pts[PT_PLACE0 + 3]; mk.owner = 0; mk.prog = -40;
  const x = new Sim(terrain), y = new Sim(terrain);
  x.load(structuredClone(old)); y.load(JSON.parse(JSON.stringify(old)) as State); x.quiet = y.quiet = true;
  const fresh = x.makePoints(), m = x.st.pts[PT_PLACE0 + 3];
  const moved = x.st.pts.every((p, i) => p.x === fresh[i].x && p.z === fresh[i].z && p.name === fresh[i].name && p.key === fresh[i].key) && m.owner === 0 && m.prog === -40;
  for (let i = 0; i < 1200; i++) { x.step(undefined); y.step(undefined); }
  check('bfa230a save: places move to the 2GIS spots, owner and progress kept, replays identically', moved && hashState(x.st) === hashState(y.st));
}

{ // 8974f64 (before the merge): ersno without a Голем, the old Мохьмад (12) with his, hero arrays for 18 types, no SideState.golem
  const s = runTo(SEED, 2000, { 1990: sim => {
    const at = sim.st.pts[0], ku = sim.st.pts[1];
    for (const u of sim.st.units) if (u.t === ERSNO || u.t === MOHMAD || u.t === AMINA) u.hp = 0;
    sim.spawn(0, ERSNO, at.x + 4, at.z + 1, -1); sim.spawn(1, MOHMAD, ku.x - 4, ku.z + 1, -1);
  } });
  const old = JSON.parse(JSON.stringify(s.st)) as State;
  const e9 = old.units.find(u => u.t === ERSNO)!;
  old.units = old.units.filter(u => !(u.t === GOLEM && u.ld === e9.id) && u.t !== AMINA); // ersno never had a Голем
  e9.ld = -1;
  for (const sd of old.sides) { strip(sd as unknown as Record<string, unknown>, ['golem']); sd.hero.length = 18; sd.heroCd.length = 18; }
  const m12 = old.units.find(u => u.t === MOHMAD)!, g12 = old.units.find(u => u.t === GOLEM && u.ld === m12.id);
  const x = new Sim(terrain), y = new Sim(terrain);
  x.load(structuredClone(old)); y.load(JSON.parse(JSON.stringify(old)) as State); x.quiet = y.quiet = true;
  const shapeOk = x.st.sides.every(sd => sd.golem === 0 && sd.hero.length === UNITS.length && sd.heroCd.length === UNITS.length && sd.hero[AMINA] === -1);
  x.step(undefined); y.step(undefined);
  const xe = x.unit(e9.id), xm = x.unit(m12.id);
  const linked = !!xe && xe.ld >= 0 && x.unit(xe.ld)?.t === GOLEM && !!xm && !!g12 && xm.ld === g12.id;
  for (let i = 0; i < 1200; i++) { x.step(undefined); y.step(undefined); }
  check('8974f64 save: SideState.golem added, ersno (now Мохьмад) brings a Голем, the old 12 keeps his, replays identically',
    shapeOk && linked && hashState(x.st) === hashState(y.st) && !JSON.stringify(x.st).includes('null'));
}

console.log(fails.length ? `v3 checks FAILED: ${fails.join('; ')}` : 'v3 checks OK');

// ---- admin commands (Cmd k: 'adm', src/sim/admin.ts) ------------------------------------------
console.log('--- admin checks ---');
const admFails0 = fails.length;
let admSeq = 0;
/** An admin command for tick t (default: the sim's next step). */
const adm = (s: Sim | number, body: Record<string, unknown>): Cmd =>
  ({ t: typeof s === 'number' ? s : s.st.tick, id: `adm:${String(++admSeq).padStart(5, '0')}`, p: 'admin', k: 'adm', ...body }) as unknown as Cmd;
/** Apply through step() exactly like a session does. */
const doAdm = (s: Sim, body: Record<string, unknown>) => { s.fx.length = 0; s.step([adm(s, body)]); return s.fx.slice(); };
{
  const s = sandbox(11), st = s.st, a = st.pts[0], k = st.pts[1];
  const m0 = st.sides[0].money;
  doAdm(s, { op: 'money', s: 0, v: 1000 });
  check('adm money: +1000 ₽', st.sides[0].money === m0 + 1000, `${m0} → ${st.sides[0].money}`);
  const m1 = st.sides[1].money;
  doAdm(s, { op: 'money', s: 1, v: 1e12 });
  check('adm money: amount clamped (±1 000 000 per command)', st.sides[1].money === m1 + 1_000_000);
  doAdm(s, { op: 'moneySet', s: 1, v: 0 });
  check('adm moneySet: 0', st.sides[1].money === 0);
  doAdm(s, { op: 'money', s: 1, v: -500 });
  check('adm money: never below 0', st.sides[1].money === 0);

  const n0 = s.count(0);
  doAdm(s, { op: 'spawn', s: 0, u: 1, n: 10 });
  check('adm spawn: 10 борцов at the high-rise', s.count(0) - n0 === 10 && s.st.units.filter(u => u.s === 0 && u.t === 1).every(u => near2(u, a) < 12));
  doAdm(s, { op: 'spawn', s: 1, u: 0, n: 999, x: k.x - 6, z: k.z });
  check('adm spawn: count clamped to 50', s.count(1) === 50);
  doAdm(s, { op: 'spawn', s: 1, u: 2, n: 3, x: -500, z: 1e9 });
  check('adm spawn: off-map point clamped onto the map', s.count(1) === 53 && s.st.units.every(u => u.x >= 0 && u.z >= 0 && u.x <= terrain.W && u.z <= terrain.H));
  doAdm(s, { op: 'spawn', s: 0, u: WOU, n: 5 });
  doAdm(s, { op: 'spawn', s: 0, u: WOU, n: 5 });
  check('adm spawn: a hero is one per side', s.countType(0, WOU) === 1 && st.sides[0].hero[WOU] >= 0);
  doAdm(s, { op: 'spawn', s: 0, u: BOSS, n: 1 });
  check('adm spawn: the boss type is refused (only «boss»)', s.countType(0, BOSS) === 0);
  doAdm(s, { op: 'boss', s: 1 });
  check('adm boss: Зураб comes out through spawnBoss', st.sides[1].boss >= 0 && s.unit(st.sides[1].boss)?.t === BOSS);
  for (let n = s.count(1); n < ECON.unitCap; n++) s.spawn(1, 0, k.x - 5, k.z + 3, -1);
  doAdm(s, { op: 'spawn', s: 1, u: 0, n: 20 });
  check('adm spawn: the 150 cap holds', s.count(1) === ECON.unitCap);

  // freeze: frozen units neither walk nor hit
  doAdm(s, { op: 'freeze', s: 0, v: 1 });
  const e1 = s.spawn(1, 1, a.x + 2, a.z + 2, -1); e1.hp = e1.mhp = 1e6;
  st.sides[0].turretCd = 1e9; // the high-rise turret is not a unit: keep it out of this check
  const pos0 = st.units.filter(u => u.s === 0).map(u => [u.x, u.z]);
  let moved = 0;
  for (let i = 0; i < 40; i++) { s.step(undefined); moved += st.units.filter(u => u.s === 0 && u.mv).length; }
  check('adm freeze: frozen side does not move or attack', moved === 0 && e1.hp === 1e6 && st.adm?.frz[0] === 1, `moved ${moved}, enemy hp ${e1.hp}, ${pos0.length} units`);
  st.sides[0].turretCd = 0;
  doAdm(s, { op: 'freeze', s: 0, v: 0 });
  // god: Курчалой takes no damage, units or high-rise
  doAdm(s, { op: 'god', s: 1, v: 1 });
  e1.hp = e1.mhp; // it took a hit in the step that unfroze Атаги
  const hq1 = st.sides[1].hq;
  s.hurtHq(1, 5000);
  const kHp = st.units.filter(u => u.s === 1).map(u => u.hp);
  for (let i = 0; i < 60; i++) s.step(undefined);
  const hurt1 = st.units.filter(u => u.s === 1 && u.hp < u.mhp).length;
  check('adm god: no damage to units or the high-rise', st.sides[1].hq === hq1 && st.units.filter(u => u.s === 1).length === kHp.length && hurt1 === 0, `hq ${hq1} → ${st.sides[1].hq}, ${kHp.length} → ${st.units.filter(u => u.s === 1).length} units, ${hurt1} hurt`);
  doAdm(s, { op: 'god', s: 1, v: 0 });

  // kill: whole side and a radius; no bounty, no kills counted
  const money1 = st.sides[1].money, kills1 = st.sides[1].kills;
  doAdm(s, { op: 'kill', s: 0 });
  s.step(undefined);
  check('adm kill: a whole side, no bounty for the other', s.count(0) === 0 && st.sides[1].money === money1 && st.sides[1].kills === kills1 && st.sides[0].hero[WOU] === -1);
  const c1 = s.count(1), mid = st.units.find(u => u.s === 1)!;
  doAdm(s, { op: 'kill', s: -1, x: mid.x, z: mid.z, r: 3 });
  s.step(undefined);
  check('adm kill: in a radius only', s.count(1) < c1 && s.count(1) > 0, `${c1} → ${s.count(1)}`);
  doAdm(s, { op: 'kill', s: 1 });
  s.step(undefined);

  // heal
  const w = s.spawn(0, 1, a.x + 3, a.z, -1); w.hp = 10; w.psn = st.tick + 100;
  doAdm(s, { op: 'heal', s: 0 });
  check('adm heal: full hp, poison gone', w.hp === w.mhp && w.psn === 0);

  // floors, repair, 4-й этаж
  const fx1 = doAdm(s, { op: 'floors', s: 0, v: 5 });
  check('adm floors: Атаги 5 floors, 4-й этаж found', st.sides[0].floors === 5 && st.sides[0].hq === 5 * HQ.floorHp[0] && st.sides[0].found4 === 1 && fx1.some(e => e.e === 'floorUp') && fx1.some(e => e.e === 'found4'));
  doAdm(s, { op: 'floors', s: 1, v: 99 });
  check('adm floors: clamped to the max', st.sides[1].floors === HQ.maxFloors[1]);
  st.sides[1].hq -= 700;
  doAdm(s, { op: 'repair', s: 1 });
  check('adm repair: full hp of the floors it has', st.sides[1].hq === st.sides[1].floors * HQ.floorHp[1]);
  doAdm(s, { op: 'floors', s: 0, v: 2 });
  st.sides[0].found4 = 0;
  doAdm(s, { op: 'found4' });
  check('adm found4: Атаги get 4 floors and found4', st.sides[0].floors === 4 && st.sides[0].found4 === 1);

  // heroes: cooldowns, back from «пары»
  st.sides[0].heroCd[CHIMAEV] = st.tick + 500; st.sides[1].heroCd[ADMIN] = st.tick + 500;
  doAdm(s, { op: 'heroCd', s: -1 });
  check('adm heroCd: every hero cooldown reset', HEROES_T.every(t => st.sides[0].heroCd[t] === 0 && st.sides[1].heroCd[t] === 0));
  doAdm(s, { op: 'spawn', s: 1, u: MOHMAD, n: 1 });
  s.startEvent('classes');
  check('classes: Мохьмад away', st.away.length === 1 && st.sides[1].hero[MOHMAD] === -2);
  doAdm(s, { op: 'heroBack' });
  check('adm heroBack: back from «пары» now', st.away.length === 0 && st.sides[1].hero[MOHMAD] >= 0);

  // points
  doAdm(s, { op: 'owner', n: 4, s: 1 });
  check('adm owner: Шали → Курчалой', st.pts[4].owner === 1 && st.pts[4].prog === 100);
  doAdm(s, { op: 'owner', n: PT_DONER, s: -1 });
  check('adm owner: Донер Бей → ничьё', st.pts[PT_DONER].owner === -1 && st.pts[PT_DONER].prog === 0);
  doAdm(s, { op: 'owner', n: 0, s: 1 });
  doAdm(s, { op: 'owner', n: 99, s: 1 });
  check('adm owner: high-rises and missing points are refused', st.pts[0].owner === 0);

  // сход and cards
  doAdm(s, { op: 'vote', s: 1 });
  check('adm vote: a сход opens now', st.votes[1].open === 1 && st.votes[1].opts.length === 3);
  const mm = st.sides[0].money;
  doAdm(s, { op: 'card', s: 0, n: 0 });
  check('adm card: «Взнос по 100 рублей» +300 ₽', st.sides[0].money === mm + 300);
  for (let id = 0; id < CARDS.length; id++) doAdm(s, { op: 'card', s: (id % 2) as Side, n: id });
  check('adm card: every card applies without throwing', true);

  // events
  doAdm(s, { op: 'event', key: 'jam' });
  check('adm event: Пробки в Аргуне now', st.ev.jam > st.tick && st.ev.last === 'jam');
  doAdm(s, { op: 'event', key: 'flood' });
  doAdm(s, { op: 'endEvents' });
  check('adm endEvents: nothing active', st.ev.jam === 0 && st.ev.flood === 0 && st.ev.black === 0);

  // AI and difficulty
  doAdm(s, { op: 'diff', v: 2 });
  doAdm(s, { op: 'ai', s: 0, v: 2 }); doAdm(s, { op: 'ai', s: 1, v: 1 });
  st.humanSide = 1;
  check('adm ai/diff: off for Атаги, on for Курчалой despite a human', st.diff === 2 && !s.aiActive(0) && s.aiActive(1));
  doAdm(s, { op: 'ai', s: 0, v: 0 }); doAdm(s, { op: 'ai', s: 1, v: 0 }); st.humanSide = -1;

  // announcement: plain text, no control characters, ≤ 140
  const say = doAdm(s, { op: 'say', txt: '  Сход\u0000 в 10:20\u202e у молла <b>x</b> ' + 'а'.repeat(300) });
  const sayEv = say.find(e => e.e === 'adminSay') as { txt: string } | undefined;
  check('adm say: FxEv adminSay, cleaned and cut to 140', !!sayEv && Array.from(sayEv.txt).length === 140 && !/[\u0000\u202e]/.test(sayEv.txt) && sayEv.txt.startsWith('Сход в 10:20 у молла <b>x</b>'));
  check('adm say: nothing in the state', !JSON.stringify(st).includes('молла'));

  // war: winner through the normal flow, new war, score, full reset
  const wins0 = st.sides[0].wins;
  const wf = doAdm(s, { op: 'win', s: 0 });
  check('adm win: Атаги win through cleanup (victory fx, wins+1, no boss)', st.winner === 0 && st.sides[0].wins === wins0 + 1 && wf.some(e => e.e === 'victory') && !wf.some(e => e.e === 'boss'));
  const before0 = s.count(0);
  doAdm(s, { op: 'spawn', s: 0, u: 0, n: 5 });
  check('adm spawn waits while the war is over', s.count(0) === before0);
  const era0 = st.era;
  const nw = doAdm(s, { op: 'newWar' });
  check('adm newWar: next era now, score kept', s.st.era === era0 + 1 && s.st.winner === -1 && s.st.sides[0].wins === wins0 + 1 && nw.some(e => e.e === 'newWar'));
  doAdm(s, { op: 'score' });
  check('adm score: 0:0', s.st.sides[0].wins === 0 && s.st.sides[1].wins === 0);
  doAdm(s, { op: 'god', s: 0, v: 1 });
  const tickR = s.st.tick, idR = s.st.nextId;
  doAdm(s, { op: 'reset', v: 123456789 });
  check('adm reset: new seed, war №1, toggles gone, tick and ids go on', s.st.seed === 123456789 && s.st.era === 1 && s.st.adm === undefined && s.st.tick === tickR + 1 && s.st.nextId >= idR && s.st.units.length === 0);
}

// malformed admin commands are ignored without throwing, and leave the world exactly as it was
{
  const bad: unknown[] = [
    null, 0, 'x', [], {}, { k: 'adm' }, { k: 'adm', op: 'nope' }, { k: 'adm', op: '__proto__' }, { k: 'adm', op: 'constructor' },
    { k: 'adm', op: 'money', s: 2, v: 1 }, { k: 'adm', op: 'money', s: '0', v: 1 }, { k: 'adm', op: 'money', s: 0, v: 'x' }, { k: 'adm', op: 'money', s: 0, v: NaN },
    { k: 'adm', op: 'money', s: 0, v: Infinity }, { k: 'adm', op: 'moneySet', s: 0 },
    { k: 'adm', op: 'spawn', s: 0, u: 5 }, { k: 'adm', op: 'spawn', s: 0, u: UNITS.length }, { k: 'adm', op: 'spawn', s: 0, u: -1 }, { k: 'adm', op: 'spawn', s: 0, u: 1.5e300 },
    { k: 'adm', op: 'spawn', s: 0 }, { k: 'adm', op: 'spawn', s: -1, u: 0 }, { k: 'adm', op: 'boss', s: 7 }, { k: 'adm', op: 'kill', s: 3 },
    { k: 'adm', op: 'freeze', s: 0, v: 2 }, { k: 'adm', op: 'god', s: 0, v: true }, { k: 'adm', op: 'ai', s: 0, v: 3 }, { k: 'adm', op: 'diff', v: -1 },
    { k: 'adm', op: 'floors', s: 0, v: 'many' }, { k: 'adm', op: 'owner', n: 0, s: 1 }, { k: 'adm', op: 'owner', n: 1e9, s: 1 }, { k: 'adm', op: 'owner', n: 3, s: 5 },
    { k: 'adm', op: 'card', s: 0, n: 34 }, { k: 'adm', op: 'card', s: 0, n: -1 }, { k: 'adm', op: 'card', s: 0, n: 2.5 },
    { k: 'adm', op: 'event', key: 'nope' }, { k: 'adm', op: 'event', key: 'toString' }, { k: 'adm', op: 'event' },
    { k: 'adm', op: 'say', txt: '' }, { k: 'adm', op: 'say', txt: '\u0000\u0001  ' }, { k: 'adm', op: 'say', txt: 42 }, { k: 'adm', op: 'say' },
    { k: 'adm', op: 'reset', v: 'seed' }, { k: 'adm', op: 'win', s: -1 }, { k: 'adm', op: 'vote' }, { k: 'adm', op: 'heroCd', s: 9 },
  ];
  const mk = (i: number, b: unknown) => (b && typeof b === 'object' && !Array.isArray(b) ? { ...(b as object), t: 0, id: 'bad' + i, p: 'x', k: 'adm' } : { t: 0, id: 'bad' + i, p: 'x', k: 'adm', op: b });
  let threw = '';
  const x = runTo(SEED, 1500), y = runTo(SEED, 1500);
  try {
    for (let i = 0; i < 300; i++) {
      const cmds = i % 6 === 0 ? bad.map((b, j) => ({ ...mk(j, b), t: x.st.tick }) as unknown as Cmd) : undefined;
      x.step(cmds); y.step(undefined);
    }
  } catch (err) { threw = String(err); }
  check('malformed adm commands: ignored, no throw, world identical', !threw && hashState(x.st) === hashState(y.st) && x.st.adm === undefined, threw);
  check('normAdm refuses every malformed body', bad.every(b => normAdm(b) === null && (b === null || typeof b !== 'object' || Array.isArray(b) || normAdm({ ...(b as object), k: 'adm' }) === null)));
  check('cleanSay: plain text only', cleanSay('a\u2028b\u200bc\ufeff') === 'a b c' && cleanSay('x'.repeat(500)).length === 140 && cleanSay(5) === '');
}

// channels: 'adm' never on the ordinary command path, ordinary commands never on the admin path
{
  const good = adm(100, { op: 'money', s: 0, v: 1000 });
  const dep = { t: 100, id: 'u:1', p: 'u', k: 'dep', s: 0, u: 1, x: 10, z: 10 };
  check('validCmd rejects adm (room topic cmd, ev/{uid})', !validCmd(good) && !validCmd({ ...good, op: 'say', txt: 'hi' }) && validCmd(dep) && !validCmd({ t: 1, id: 'c', p: 'x', k: 'cfg', d: 2, hs: 0, mp: 0 }));
  check('validAdmCmd: only well-formed adm', validAdmCmd(good) && !validAdmCmd(dep) && !validAdmCmd({ ...good, t: -1 }) && !validAdmCmd({ ...good, t: 100.5 }) && !validAdmCmd({ ...good, id: '' }) && !validAdmCmd({ ...good, id: 'x'.repeat(200) }) && !validAdmCmd({ ...good, s: 3 }) && !validAdmCmd({ ...good, op: 'cfg' }));
  // AdminChannel bodies: only the AdmBody fields leave the panel, invalid ones never do
  const ab = admBody({ op: 'spawn', s: 1, u: 2, n: 5, x: 10, z: 20, junk: 1, __proto__: { evil: 1 }, t: 5, id: 'x', p: 'y', k: 'cfg' });
  check('admBody: AdmBody fields only, k adm', JSON.stringify(ab) === JSON.stringify({ k: 'adm', op: 'spawn', s: 1, n: 5, u: 2, x: 10, z: 20 }) && admBody({ op: 'nope' }) === null && admBody({ op: 'money', s: 2, v: 1 }) === null && admBody(null) === null, JSON.stringify(ab));
  // an ordinary command reusing an admin id (a forged 'dep' on 'cmd' or in ev/{uid}) cannot shadow it
  {
    const sim = runTo(SEED, 400), backend: Backend = { kind: 'local', send() { /* none */ }, checkpoint() { /* none */ } };
    const sess = new Session(sim, backend, 'x');
    const t = sim.st.tick + 3, m0 = sim.st.sides[0].money;
    sess.receive({ t, id: 'same', p: 'evil', k: 'dep', s: 0, u: 0, x: 1, z: 1 } as Cmd);
    sess.receive({ t, id: 'same', p: 'admin', k: 'adm', op: 'money', s: 0, v: 5000 } as unknown as Cmd);
    for (let i = 0; i < 5; i++) (sess as unknown as { stepOnce(): void }).stepOnce();
    check('Session: adm ids have their own space', sim.st.sides[0].money >= m0 + 5000 && sess.drop('same') && sess.allCmds().some(c => c.k === 'dep' && c.id === 'same'));
    // localChannel: refuses without a local session, submits a cleaned body with one
    const none = localChannel(() => null), ch = localChannel(() => sess);
    const v1 = await none.check(), v2 = await ch.check();
    const n0 = sess.allCmds().length;
    ch.send({ k: 'adm', op: 'say', txt: 'hi', extra: [1, 2] }); ch.send({ k: 'adm', op: 'money', s: 9, v: 1 });
    const last = sess.allCmds().filter(c => c.k === 'adm').at(-1) as unknown as Record<string, unknown>;
    check('localChannel: check() and send()', typeof v1 === 'string' && v1.length > 0 && v2 === null && sess.allCmds().length === n0 + 1 && last.op === 'say' && last.txt === 'hi' && !('extra' in last));
  }
}

// determinism: every admin op through apply(), snapshots through JSON and structuredClone, a session with rollback
{
  const script: [number, Record<string, unknown>][] = [
    [3005, { op: 'money', s: 0, v: 5000 }], [3006, { op: 'moneySet', s: 1, v: 9000 }],
    [3010, { op: 'spawn', s: 0, u: 1, n: 12 }], [3011, { op: 'spawn', s: 1, u: SPORTIK, n: 20, x: 200, z: 140 }], [3012, { op: 'spawn', s: 1, u: GELIK, n: 3 }],
    [3013, { op: 'spawn', s: 0, u: MOHMAD, n: 1 }], [3014, { op: 'spawn', s: 0, u: RIDE, n: 2 }], [3015, { op: 'boss', s: 0 }],
    [3020, { op: 'freeze', s: 1, v: 1 }], [3021, { op: 'god', s: 0, v: 1 }], [3022, { op: 'ai', s: 1, v: 2 }], [3023, { op: 'diff', v: 0 }],
    [3030, { op: 'floors', s: 1, v: 7 }], [3031, { op: 'found4' }], [3032, { op: 'repair', s: 0 }], [3033, { op: 'heroCd', s: -1 }],
    [3040, { op: 'owner', n: 4, s: 0 }], [3041, { op: 'owner', n: PT_PLACE0 + 2, s: 0 }], [3042, { op: 'vote', s: 0 }], [3043, { op: 'card', s: 1, n: 22 }],
    [3044, { op: 'card', s: 0, n: 3 }], [3045, { op: 'card', s: 1, n: 18 }], [3046, { op: 'event', key: 'classes' }], [3050, { op: 'heroBack' }],
    [3051, { op: 'event', key: 'flood' }], [3060, { op: 'say', txt: 'Чу вала' }], [3070, { op: 'kill', s: -1, x: 200, z: 140, r: 12 }],
    [3080, { op: 'heal', s: 1 }], [3090, { op: 'freeze', s: 1, v: 0 }], [3100, { op: 'endEvents' }], [3110, { op: 'win', s: 1 }],
    [3200, { op: 'newWar' }], [3210, { op: 'score' }], [3220, { op: 'spawn', s: 1, u: CHIMAEV, n: 1 }], [3300, { op: 'reset', v: 987654 }],
    [3310, { op: 'god', s: 1, v: 1 }], [3320, { op: 'spawn', s: 0, u: 0, n: 30 }],
  ];
  const at = new Map<number, Cmd[]>();
  script.forEach(([t, b], i) => at.set(t, [...(at.get(t) ?? []), { t, id: `adm:${String(i).padStart(3, '0')}`, p: 'admin', k: 'adm', ...b } as unknown as Cmd]));
  // straight run
  const A = runTo(SEED, 3000);
  const B = new Sim(terrain); B.load(JSON.parse(JSON.stringify(A.st)) as State); B.quiet = true;
  const C = new Sim(terrain); C.load(A.snapshot()); C.quiet = true;
  let okD = true;
  for (let t = 3000; t < 3500; t++) {
    const cm = at.get(A.st.tick);
    A.step(cm); B.step(cm); C.step(cm);
    if (t % 25 === 24) {
      const hA = hashState(A.st);
      if (hA !== hashState(B.st) || hA !== hashState(C.st)) { okD = false; console.log('adm diverged at', A.st.tick); break; }
      // every 100 ticks B restarts from its own JSON, C from its own structuredClone
      if (t % 100 === 99) { const j = JSON.stringify(B.st); B.load(JSON.parse(j) as State); C.load(structuredClone(C.st)); }
    }
  }
  check('adm determinism: every op, JSON and structuredClone restores, 500 ticks', okD && A.st.era === 1 && A.st.seed === 987654 && A.st.adm?.god[1] === 1);
  okD = twin(A, 300, 'admin toggles live (god, after reset)') && okD;

  // the same commands through a Session: half arrive late and force a rollback; one is taken back
  const sim = runTo(SEED, 3000);
  const backend: Backend = { kind: 'local', send() { /* nobody else */ }, checkpoint() { /* not stored */ } };
  const sess = new Session(sim, backend, 'admin');
  const stepS = (n: number) => { for (let i = 0; i < n; i++) (sess as unknown as { stepOnce(): void }).stepOnce(); };
  const all = [...at.values()].flat();
  for (const c of all) if (Number(c.id.slice(4)) % 2 === 0) sess.receive(c); // on time
  let late = all.filter(c => Number(c.id.slice(4)) % 2 === 1);
  const stray = { t: 3025, id: 'adm:zzz', p: 'admin', k: 'adm', op: 'money', s: 1, v: 777 } as unknown as Cmd;
  while (sim.st.tick < 3500) {
    stepS(7);
    const now = late.filter(c => c.t <= sim.st.tick - 3 && c.t > sim.st.tick - 300);
    for (const c of now) sess.receive(c); // late: rollback and replay
    late = late.filter(c => !now.includes(c));
    if (sim.st.tick > 3030 && sim.st.tick < 3040) { sess.receive(stray); stepS(5); sess.drop(stray.id); } // refused by the store: taken back
  }
  const ref = runTo(SEED, 3000);
  while (ref.st.tick < sim.st.tick) ref.step(at.get(ref.st.tick));
  check('adm through a Session: late commands roll back and replay to the same world, a dropped one leaves no trace', late.length === 0 && hashState(sim.st) === hashState(ref.st), `tick ${sim.st.tick}`);
}

// saves: no admin activity → no adm key (old hashes stay); a malformed adm is repaired the same way everywhere
{
  const s = runTo(SEED, 1200);
  check('no admin activity: state has no adm key', !('adm' in s.st));
  const old = JSON.parse(JSON.stringify(s.st)) as State & { adm?: unknown };
  old.adm = { frz: [1, 'x'], god: 'no', ai: [7, 2, 3] };
  const x = new Sim(terrain), y = new Sim(terrain);
  x.load(structuredClone(old) as State); y.load(JSON.parse(JSON.stringify(old)) as State); x.quiet = y.quiet = true;
  const shape = JSON.stringify(x.st.adm) === JSON.stringify({ frz: [1, 0], god: [0, 0], ai: [0, 2] });
  for (let i = 0; i < 600; i++) { x.step(undefined); y.step(undefined); }
  check('malformed adm in a save is repaired and replays identically', shape && hashState(x.st) === hashState(y.st), JSON.stringify(x.st.adm));
  const z = JSON.parse(JSON.stringify(s.st)) as State & { adm?: unknown };
  z.adm = 'junk';
  const w = new Sim(terrain); w.load(z as State);
  check('junk adm in a save is dropped', w.st.adm === undefined);
}
const admFails = fails.slice(admFails0);
console.log(admFails.length ? `admin checks FAILED: ${admFails.join('; ')}` : 'admin checks OK');

// ---- unit control: orders, possession, validation, flow cache, snapshots, rollback -----------------------
console.log('--- unit control checks ---');
const ctlFails0 = fails.length;
let ctlN = 0;
/** A command from player p at the current tick. */
const C = (s: Sim, p: string, b: Record<string, unknown>) => ({ t: s.st.tick, id: `${p}:${String(ctlN++).padStart(6, '0')}`, p, ...b }) as unknown as Cmd;
const stepC = (s: Sim, ...c: Cmd[]) => { s.fx.length = 0; s.step(c.length ? c : undefined); return s.fx.slice(); };
const runN = (s: Sim, n: number) => { for (let i = 0; i < n; i++) s.step(undefined); s.fx.length = 0; };
/** sandbox() with three players: pa and pb play Атаги, pk Курчалой. */
function ctlBox(seed = 5): Sim {
  const s = sandbox(seed);
  stepC(s, C(s, 'pa', { k: 'join', s: 0 }), C(s, 'pb', { k: 'join', s: 0 }), C(s, 'pk', { k: 'join', s: 1 }));
  return s;
}
const freeze = (s: Sim, side: Side, on = 1) => { s.st.adm ??= { frz: [0, 0], god: [0, 0], ai: [0, 0] }; s.st.adm.frz[side] = on; };
const dist = (u: { x: number; z: number }, x: number, z: number) => Math.hypot(u.x - x, u.z - z);
{
  check('canControl: not the boss, rides, Голем or Курица; heroes and the rest yes', !canControl(BOSS) && !canControl(RIDE) && !canControl(GOLEM) && !canControl(CHICKEN) && canControl(0) && canControl(1) && canControl(CHIMAEV) && canControl(GELIK) && canControl(SPORTIK) && canControl(ADAM));
  // move: a group walks across the field in formation, arrives and holds
  const s = ctlBox(), a = s.st.pts[0];
  const ws: U[] = [];
  for (let i = 0; i < 12; i++) ws.push(s.spawn(0, 1, a.x + 3 + (i % 4), a.z + 2 + Math.floor(i / 4), -1));
  const tx = a.x + 40, tz = a.z + 6;
  stepC(s, C(s, 'pa', { k: 'ord', s: 0, ids: ws.map(u => u.id), m: 'move', x: tx, z: tz }));
  const dests = new Set(ws.map(u => `${u.o?.x},${u.o?.z}`));
  check('move: every unit gets an order with its own formation slot', ws.every(u => u.o?.m === OM.MOVE && u.o.c >= 0 && dist(u.o, tx, tz) < 4) && dests.size === 12);
  runN(s, 450);
  check('move: the group arrives (all within 4 of the spot) and holds', ws.every(u => u.o?.m === OM.HOLD && dist(u, tx, tz) < 4), ws.map(u => dist(u, tx, tz).toFixed(1)).join(' '));
  const p0 = ws.map(u => ({ x: u.x, z: u.z }));
  runN(s, 100);
  check('hold: they stay put', ws.every((u, i) => dist(u, p0[i].x, p0[i].z) < 1.2));
  // the selection split over two commands keeps one formation
  const ids20: number[] = [];
  for (let i = 0; i < 20; i++) ids20.push(s.spawn(0, 0, a.x + 2 + (i % 5) * 0.8, a.z + 4 + Math.floor(i / 5) * 0.8, -1).id);
  stepC(s, C(s, 'pa', { k: 'ord', s: 0, ids: ids20.slice(0, 12), m: 'move', x: tx, z: tz - 15, fi: 0, fn: 20 }), C(s, 'pa', { k: 'ord', s: 0, ids: ids20.slice(12), m: 'move', x: tx, z: tz - 15, fi: 12, fn: 20 }));
  check('move in chunks (fi / fn): 20 distinct slots', new Set(ids20.map(id => { const o = s.unit(id)!.o!; return `${o.x},${o.z}`; })).size === 20);
  // auto: back to goal picking
  stepC(s, C(s, 'pb', { k: 'ord', s: 0, ids: ws.slice(0, 4).map(u => u.id), m: 'auto' }));
  const q0 = ws.slice(0, 4).map(u => ({ x: u.x, z: u.z }));
  runN(s, 80);
  check('auto (from another player of the side): no order, goals picked, walking again', ws.slice(0, 4).every((u, i) => u.o === undefined && u.g >= 0 && dist(u, q0[i].x, q0[i].z) > 3) && ws[4].o?.m === OM.HOLD);
}
{
  // attack: chase a target across the field (flow field when far), kill it, then hold
  const s = ctlBox(), a = s.st.pts[0];
  const w1 = s.spawn(0, 1, a.x + 4, a.z + 3, -1), w2 = s.spawn(0, 1, a.x + 4, a.z + 4, -1);
  const e = s.spawn(1, 0, a.x + 34, a.z + 4, -1);
  freeze(s, 1);
  stepC(s, C(s, 'pa', { k: 'ord', s: 0, ids: [w1.id, w2.id], m: 'attack', tg: e.id }));
  check('attack: the order is on both', w1.o?.m === OM.ATTACK && w1.o.tg === e.id && w2.o?.tg === e.id);
  let tk = 0;
  while (e.hp > 0 && tk < 500) { s.step(undefined); tk++; }
  s.step(undefined); s.step(undefined);
  check('attack: the target dies, then they hold where they stand', e.hp <= 0 && w1.o?.m === OM.HOLD && w2.o?.m === OM.HOLD, `${tk} ticks`);
  // hold: an enemy out of reach is left alone, one in reach is hit; the holder does not move
  const h = s.spawn(0, 1, a.x + 10, a.z + 12, -1);
  stepC(s, C(s, 'pa', { k: 'ord', s: 0, ids: [h.id], m: 'hold' }));
  const far = s.spawn(1, 0, h.x + 5, h.z, -1);
  runN(s, 60);
  check('hold: enemy 5 away untouched, holder still', far.hp === far.mhp && dist(h, h.o!.x, h.o!.z) < 0.6);
  const close = s.spawn(1, 0, h.x - 1.8, h.z, -1);
  runN(s, 60);
  check('hold: enemy in reach gets hit, holder still', close.hp < close.mhp && dist(h, h.o!.x, h.o!.z) < 1.2);
  freeze(s, 1, 0);
}
{
  // attackMove: fights what it meets on the way, then goes on and arrives
  const s = ctlBox(), a = s.st.pts[0];
  const ws = [0, 1, 2].map(i => s.spawn(0, 1, a.x + 4, a.z + 2 + i, -1));
  const tx = a.x + 40, tz = a.z + 6;
  const e = s.spawn(1, 0, a.x + 18, a.z + 6, -1);
  freeze(s, 1);
  stepC(s, C(s, 'pa', { k: 'ord', s: 0, ids: ws.map(u => u.id), m: 'attackMove', x: tx, z: tz }));
  let met = -1;
  for (let i = 0; i < 600; i++) { s.step(undefined); if (met < 0 && e.hp <= 0) met = i; }
  check('attackMove: kills the enemy on the way, then arrives and holds', met > 0 && ws.every(u => u.o?.m === OM.HOLD && dist(u, tx, tz) < 4), `killed at ${met}`);
  // plain move walks past enemies
  const s2 = ctlBox(), b = s2.st.pts[0];
  const m = s2.spawn(0, 1, b.x + 4, b.z + 6, -1), e2 = s2.spawn(1, 0, b.x + 18, b.z + 6, -1);
  freeze(s2, 1);
  stepC(s2, C(s2, 'pa', { k: 'ord', s: 0, ids: [m.id], m: 'move', x: b.x + 40, z: b.z + 6 }));
  runN(s2, 400);
  check('move: does not stop to fight', e2.hp === e2.mhp && m.o?.m === OM.HOLD && dist(m, b.x + 40, b.z + 6) < 2);
}
{
  // possession
  const s = ctlBox(), a = s.st.pts[0], n = (p: string) => s.st.players[p].n;
  const w = [0, 1, 2, 3, 4, 5].map(i => s.spawn(0, 1, a.x + 6 + i * 3, a.z + 8, -1));
  let fx = stepC(s, C(s, 'pa', { k: 'ord', s: 0, ids: [w[0].id], m: 'possessed' }));
  check('possess: order on the unit with the player number, fx possess on', w[0].o?.m === OM.POSSESS && w[0].o.p === n('pa') && fx.some(e => e.e === 'possess' && e.id === w[0].id && e.on === 1));
  const x0 = w[0].x, z0 = w[0].z, spd = (P(s).stats(w[0]).spd * 10) / (terrain.navCost[navIndex(terrain, x0, z0)] || 30);
  stepC(s, C(s, 'pa', { k: 'ctl', s: 0, u: w[0].id, dx: 8, dz: 0, atk: 0 }));
  runN(s, 9);
  check('ctl: the stick moves it east at its own speed', w[0].x - x0 > spd * 10 * 0.6 && w[0].x - x0 < spd * 10 * 1.6 && Math.abs(w[0].z - z0) < 1, `${(w[0].x - x0).toFixed(2)} vs ${(spd * 10).toFixed(2)}`);
  fx = stepC(s, C(s, 'pa', { k: 'ctl', s: 0, u: w[1].id, dx: 0, dz: 0, atk: 0 }));
  check('one possessed unit per player: taking another lets the first hold', w[1].o?.m === OM.POSSESS && w[0].o?.m === OM.HOLD && fx.some(e => e.e === 'possess' && e.id === w[0].id && e.on === 0));
  const before = JSON.stringify(w[1].o);
  stepC(s, C(s, 'pb', { k: 'ctl', s: 0, u: w[1].id, dx: -8, dz: 0, atk: 1 }), C(s, 'pb', { k: 'ord', s: 0, ids: [w[1].id, w[2].id], m: 'move', x: a.x + 30, z: a.z + 20 }));
  check('another player cannot drive or order a unit someone possesses (the rest of the order applies)', JSON.stringify(w[1].o) === before && w[2].o?.m === OM.MOVE);
  stepC(s, C(s, 'pk', { k: 'ctl', s: 1, u: w[3].id, dx: 1, dz: 0, atk: 0 }), C(s, 'pk', { k: 'ctl', s: 0, u: w[3].id, dx: 1, dz: 0, atk: 0 }), C(s, 'pk', { k: 'ord', s: 0, ids: [w[3].id], m: 'hold' }));
  check('the other side cannot touch our units', w[3].o === undefined);
  // attack in front only (a unit of its own, away from the others)
  freeze(s, 1);
  const me = s.spawn(0, 1, a.x + 14, a.z + 22, -1), ahead = s.spawn(1, 0, me.x + 1.6, me.z, -1), behind = s.spawn(1, 0, me.x - 1.6, me.z + 0.2, -1);
  stepC(s, C(s, 'pa', { k: 'ctl', s: 0, u: me.id, dx: 0, dz: 0, atk: 1, fx: 8, fz: 0 }));
  runN(s, 30);
  check('atk: hits the enemy in front, not the one behind', ahead.hp < ahead.mhp && behind.hp === behind.mhp, `${ahead.hp}/${behind.hp}`);
  stepC(s, C(s, 'pa', { k: 'ctl', s: 0, u: me.id, dx: 0, dz: 0, atk: 1, fx: -8, fz: 0 }));
  runN(s, 30);
  check('atk: turning round hits the other one', behind.hp < behind.mhp);
  freeze(s, 1, 0);
  fx = stepC(s, C(s, 'pa', { k: 'ctl', s: 0, u: me.id, dx: 0, dz: 0, atk: 0, rel: 1 }));
  check('rel: lets go, the unit holds where it stands', me.o?.m === OM.HOLD && dist(me, me.o.x, me.o.z) < 0.01 && fx.some(e => e.e === 'possess' && e.on === 0));
  // nobody drives for 30 s → auto
  stepC(s, C(s, 'pa', { k: 'ctl', s: 0, u: w[4].id, dx: 0, dz: 0, atk: 0 }));
  runN(s, POSS_IDLE - 20);
  const still = w[4].o?.m === OM.POSSESS;
  runN(s, 40);
  check('possessed unit with no ctl for 30 s goes back to auto', still && w[4].o === undefined);
  // keep-alive keeps it
  stepC(s, C(s, 'pa', { k: 'ctl', s: 0, u: w[4].id, dx: 0, dz: 0, atk: 0 }));
  for (let i = 0; i < 4; i++) { runN(s, 100); stepC(s, C(s, 'pa', { k: 'ctl', s: 0, u: w[4].id, dx: 0, dz: 0, atk: 0 })); }
  check('a ctl every 10 s keeps it', w[4].o?.m === OM.POSSESS);
  // changing sides lets go
  stepC(s, C(s, 'pa', { k: 'join', s: 1 }));
  check('join the other side: the possessed unit goes back to auto', w[4].o === undefined);
  // the stick never takes a unit into blocked ground
  const T = terrain;
  let spot: { x: number; z: number } | null = null;
  for (let j = 10; j < T.nh - 10 && !spot; j++) for (let i = 10; i < T.nw - 10 && !spot; i++) {
    const c = j * T.nw + i;
    if (T.navCost[c] && !T.navCost[c + 1] && T.navCost[c - 1] && T.navCost[c - T.nw] && T.navCost[c + T.nw]) spot = { x: (i + 0.5) * 2, z: (j + 0.5) * 2 };
  }
  const s2 = ctlBox();
  const g = s2.spawn(0, 3, spot!.x, spot!.z, -1); // Баран, fast
  stepC(s2, C(s2, 'pa', { k: 'ctl', s: 0, u: g.id, dx: 8, dz: 1, atk: 0 }));
  let okP = true;
  for (let i = 0; i < 60; i++) { s2.step(undefined); if (!passable(T, g.x, g.z)) okP = false; }
  check('ctl: blocked ground stays blocked', okP && g.hp > 0);
  // heroes keep casting while driven (Чимаев «Землетряс»)
  const s3 = ctlBox(), k = s3.st.pts[1];
  const ch = s3.spawn(1, CHIMAEV, k.x - 30, k.z, -1);
  for (let i = 0; i < 4; i++) s3.spawn(0, 0, ch.x + 1 + i * 0.4, ch.z + 0.5, -1);
  freeze(s3, 0);
  s3.st.units.forEach(u => { if (u.id === ch.id) u.ab = 3; });
  stepC(s3, C(s3, 'pk', { k: 'ctl', s: 1, u: ch.id, dx: 0, dz: 0, atk: 1, fx: 8, fz: 0 }));
  let quake = false;
  for (let i = 0; i < 40; i++) { s3.step(undefined); if (s3.fx.some(e => e.e === 'ability' && e.key === 'quake')) quake = true; s3.fx.length = 0; }
  check('possessed hero still casts (Чимаев «Землетряс»)', quake && ch.o?.m === OM.POSSESS);
}
{
  // invalid commands: ignored, no throw, the world exactly as without them
  const mk = (s: Sim) => {
    const a = s.st.pts[0];
    const boss = s.spawn(0, BOSS, a.x + 3, a.z + 3, -1), ride = s.spawn(0, RIDE, a.x + 4, a.z + 3, -1), gol = s.spawn(0, GOLEM, a.x + 5, a.z + 3, -1), chk = s.spawn(0, CHICKEN, a.x + 6, a.z + 3, -1);
    const w = s.spawn(0, 1, a.x + 7, a.z + 3, -1), e = s.spawn(1, 1, a.x + 30, a.z + 3, -1);
    return { boss, ride, gol, chk, w, e };
  };
  const x = ctlBox(9), y = ctlBox(9), ux = mk(x); mk(y);
  const W = ux.w.id, E = ux.e.id;
  const many = Array.from({ length: ORD_MAX + 1 }, () => W);
  const bad: Record<string, unknown>[] = [
    { k: 'ord', s: 0, ids: W, m: 'hold' }, { k: 'ord', s: 0, ids: [], m: 'hold' }, { k: 'ord', s: 0, ids: many, m: 'hold' }, { k: 'ord', s: 0, m: 'hold' },
    { k: 'ord', s: 0, ids: ['1', NaN, 1.5, null, -1, 1e15], m: 'hold' }, { k: 'ord', s: 0, ids: [W], m: '__proto__' }, { k: 'ord', s: 0, ids: [W], m: 'constructor' },
    { k: 'ord', s: 0, ids: [W], m: 'nope' }, { k: 'ord', s: 0, ids: [W] }, { k: 'ord', s: 0, ids: [W], m: 'move' }, { k: 'ord', s: 0, ids: [W], m: 'move', x: NaN, z: 5 },
    { k: 'ord', s: 0, ids: [W], m: 'move', x: Infinity, z: 5 }, { k: 'ord', s: 0, ids: [W], m: 'move', x: -3, z: 5 }, { k: 'ord', s: 0, ids: [W], m: 'move', x: 1e6, z: 5 },
    { k: 'ord', s: 0, ids: [W], m: 'attackMove', x: '50', z: 50 }, { k: 'ord', s: 0, ids: [W], m: 'attack' }, { k: 'ord', s: 0, ids: [W], m: 'attack', tg: W },
    { k: 'ord', s: 0, ids: [W], m: 'attack', tg: 999999 }, { k: 'ord', s: 0, ids: [W], m: 'attack', tg: String(E) }, { k: 'ord', s: 2, ids: [W], m: 'hold' },
    { k: 'ord', s: '0', ids: [W], m: 'hold' }, { k: 'ord', s: 1, ids: [W], m: 'hold' }, { k: 'ord', s: 0, ids: [E], m: 'hold' },
    { k: 'ord', s: 0, ids: [ux.boss.id, ux.ride.id, ux.gol.id, ux.chk.id], m: 'hold' }, { k: 'ord', s: 0, ids: [ux.boss.id], m: 'possessed' },
    { k: 'ctl', s: 0, u: W, dx: 9, dz: 0, atk: 0 }, { k: 'ctl', s: 0, u: W, dx: -9, dz: 0, atk: 0 }, { k: 'ctl', s: 0, u: W, dx: 1.5, dz: 0, atk: 0 },
    { k: 'ctl', s: 0, u: W, dx: '3', dz: 0, atk: 0 }, { k: 'ctl', s: 0, u: W, dx: 1, dz: null, atk: 0 }, { k: 'ctl', s: 0, u: W, dx: 1, dz: 0, atk: 2 },
    { k: 'ctl', s: 0, u: W, dx: 1, dz: 0, atk: 0, rel: 2 }, { k: 'ctl', s: 0, u: W, dx: 1, dz: 0, atk: 0, rel: true }, { k: 'ctl', s: 0, u: W, dx: 1, dz: 0, atk: 0, fx: 3 },
    { k: 'ctl', s: 0, u: W, dx: 1, dz: 0, atk: 0, fx: 9, fz: 0 }, { k: 'ctl', s: 0, u: 'x', dx: 1, dz: 0, atk: 0 }, { k: 'ctl', s: 0, u: E, dx: 1, dz: 0, atk: 0 },
    { k: 'ctl', s: 0, u: ux.boss.id, dx: 1, dz: 0, atk: 0 }, { k: 'ctl', s: 0, u: ux.ride.id, dx: 1, dz: 0, atk: 0 }, { k: 'ctl', s: 0, dx: 1, dz: 0, atk: 0 },
    { k: 'ctl', s: 1, u: W, dx: 1, dz: 0, atk: 0 },
  ];
  let threw = '';
  try {
    for (let i = 0; i < 200; i++) {
      const cm = i % 5 === 0 ? [...bad.map(b => C(x, 'pa', b)), C(x, 'nobody', { k: 'ord', s: 0, ids: [W], m: 'hold' }), C(x, 'pk', { k: 'ord', s: 0, ids: [W], m: 'hold' })] : undefined;
      x.step(cm); y.step(undefined);
    }
  } catch (err) { threw = String(err); }
  // the ignored commands still count as the player being here (lastHuman), like any command: compare without it
  const strip2 = (st: State) => { const j = JSON.parse(JSON.stringify(st)) as State; for (const sd of j.sides) sd.lastHuman = 0; for (const p of Object.values(j.players)) p.last = 0; return hashState(j); };
  check('invalid ord / ctl: ignored, no throw, world identical', !threw && strip2(x.st) === strip2(y.st) && !x.st.units.some(u => u.o), threw);
  check('validCmd: ord / ctl shapes', validCmd({ t: 5, id: 'a', p: 'q', k: 'ord', s: 0, ids: [1, 2], m: 'move', x: 1, z: 2 }) && validCmd({ t: 5, id: 'a', p: 'q', k: 'ctl', s: 1, u: 3, dx: 1, dz: -1, atk: 0 })
    && !validCmd({ t: 5, id: 'a', p: 'q', k: 'ord', s: 0, ids: 'x', m: 'move' }) && !validCmd({ t: 5, id: 'a', p: 'q', k: 'ord', s: 0, ids: many, m: 'hold' }) && !validCmd({ t: 5, id: 'a', p: 'q', k: 'ord', s: 3, ids: [1], m: 'hold' })
    && !validCmd({ t: 5, id: 'a', p: 'q', k: 'ctl', s: 0, u: 1.5, dx: 0, dz: 0, atk: 0 }) && !validCmd({ t: 5, id: 'a', p: 'q', k: 'ctl', s: 0, u: 1, dx: 20, dz: 0, atk: 0 }));
  // a save carrying a junk order drops it the same way everywhere
  const z = JSON.parse(JSON.stringify(x.st)) as State;
  (z.units[0] as unknown as Record<string, unknown>).o = { m: 9 };
  (z.units[1] as unknown as Record<string, unknown>).o = 'x';
  (z.units[2] as unknown as Record<string, unknown>).o = { m: OM.MOVE, x: 1, z: 1, c: 1e9, tg: -1, k: 0 };
  (z.units[3] as unknown as Record<string, unknown>).o = { m: OM.POSSESS, x: 0, z: 0, c: -1, tg: -1, k: 0, p: 0, dx: 99, dz: 0, fx: 0, fz: 0, a: 0, at: 0 };
  const zz = new Sim(terrain); zz.load(z);
  check('junk orders in a save are dropped', !zz.st.units.some(u => u.o));
  // a side nobody plays for 3 min goes back to auto
  const s = ctlBox(), w = s.spawn(0, 1, s.st.pts[0].x + 4, s.st.pts[0].z + 3, -1);
  stepC(s, C(s, 'pa', { k: 'ord', s: 0, ids: [w.id], m: 'hold' }));
  runN(s, ORD_IDLE - 20);
  const held = w.o?.m === OM.HOLD;
  runN(s, 40);
  check('orders of a side with no human for 3 min go back to auto', held && w.o === undefined);
}
{
  // a flood of destinations: 40 lone units sent to 40 different far spots — at most ORD_FLOWS flow
  // fields per tick (picked from the state, the same on every client), each built once; all still walk
  const s = ctlBox(), a = s.st.pts[0];
  freeze(s, 1);
  const us: U[] = [];
  for (let i = 0; i < 40; i++) us.push(s.spawn(0, 1, a.x + 3 + (i % 8), a.z + 2 + Math.floor(i / 8), -1));
  const p0 = us.map(u => ({ x: u.x, z: u.z }));
  const b0 = s.flowBuilds;
  stepC(s, ...us.map((u, i) => C(s, 'pa', { k: 'ord', s: 0, ids: [u.id], m: 'move', x: a.x + 30 + (i % 8) * 6, z: a.z + 20 + Math.floor(i / 8) * 6 })));
  const cells = new Set(us.map(u => u.o?.c)).size, b1 = s.flowBuilds;
  runN(s, 30);
  const b2 = s.flowBuilds, walked = us.filter((u, i) => dist(u, p0[i].x, p0[i].z) > 2).length;
  check(`a flood of ${cells} destinations: ≤ ${ORD_FLOWS} flow fields, built once, everyone walks`, cells > ORD_FLOWS && b1 - b0 <= ORD_FLOWS && b2 === b1 && walked === 40, `built ${b1 - b0} then ${b2 - b1}, walked ${walked}`);
}
{
  // random order / control streams for both sides on a live AI war: JSON and structuredClone
  // restores, the flow-field cache evicting all the time, and a Session with late commands
  // (rollback) — all the same world
  const sort = (l: Cmd[]) => l.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  function stream(sim: Sim, ticks: number, seed: number) {
    let r = seed | 0;
    const rnd = () => { r = (r + 0x6d2b79f5) | 0; let q = Math.imul(r ^ (r >>> 15), r | 1); q ^= q + Math.imul(q ^ (q >>> 7), q | 61); return ((q ^ (q >>> 14)) >>> 0) / 4294967296; };
    const ri = (n: number) => Math.floor(rnd() * n);
    const players: [string, Side][] = [['pa', 0], ['pk', 1], ['pb', 0]];
    const at = new Map<number, Cmd[]>(), hashes: number[] = [];
    let n = 0, ords = 0, ctls = 0;
    for (let i = 0; i < ticks; i++) {
      const st = sim.st, list: Cmd[] = [];
      const add = (p: string, b: Record<string, unknown>) => list.push({ ...b, t: st.tick, id: `${p}:${String(n++).padStart(6, '0')}`, p } as unknown as Cmd);
      if (i === 0) for (const [p, s] of players) add(p, { k: 'join', s });
      for (const [p, s] of players) {
        if (p === 'pk' && i > 600 && i < 600 + ORD_IDLE + 150) continue; // Курчалой goes quiet: its orders expire
        if (rnd() > 0.12) continue;
        const own = st.units.filter(u => u.s === s && u.hp > 0 && canControl(u.t)), foe = st.units.filter(u => u.s !== s && u.hp > 0);
        if (!own.length) continue;
        const pick = () => { const k = 1 + ri(Math.min(ORD_MAX, own.length)), out: number[] = []; for (let j = 0; j < k; j++) out.push(own[ri(own.length)].id); return out; };
        const cx = own[0].x + (rnd() - 0.5) * 120, cz = own[0].z + (rnd() - 0.5) * 120;
        const pn = st.players[p]?.n ?? -1, mine = own.find(u => u.o?.m === OM.POSSESS && u.o.p === pn);
        const a = ri(12);
        if (a < 3) { add(p, { k: 'ord', s, ids: pick(), m: a === 0 ? 'attackMove' : 'move', x: Math.round(cx * 100) / 100, z: Math.round(cz * 100) / 100, ...(rnd() < 0.3 ? { fi: ri(30), fn: 64 } : {}) }); ords++; }
        else if (a === 3 && foe.length) { add(p, { k: 'ord', s, ids: pick(), m: 'attack', tg: foe[ri(foe.length)].id }); ords++; }
        else if (a === 4) { add(p, { k: 'ord', s, ids: pick(), m: 'hold' }); ords++; }
        else if (a === 5) { add(p, { k: 'ord', s, ids: pick(), m: 'auto' }); ords++; }
        else if (a === 6) { add(p, { k: 'ord', s, ids: [own[ri(own.length)].id], m: 'possessed' }); ords++; }
        else if (a < 11) {
          const u = mine ?? own[ri(own.length)];
          add(p, { k: 'ctl', s, u: u.id, dx: ri(17) - 8, dz: ri(17) - 8, atk: ri(2), ...(rnd() < 0.4 ? { fx: ri(17) - 8, fz: ri(17) - 8 } : {}), ...(rnd() < 0.05 ? { rel: 1 } : {}) }); ctls++;
        } else add(p, { k: 'ord', s: 1 - s, ids: [own[0].id, 1e9], m: 'hold', x: NaN }); // junk
      }
      if (list.length) at.set(st.tick, sort(list));
      sim.step(list.length ? list : undefined);
      if (i % 100 === 99) hashes.push(hashState(sim.st));
    }
    return { at, hashes, ords, ctls };
  }
  const A = runTo(SEED, 3000);
  const json0 = JSON.stringify(A.st);
  const tA = performance.now();
  const ref = stream(A, 3000, 77);
  const msA = performance.now() - tA;
  const withOrd = A.st.units.filter(u => u.o).length;
  const net = new Map([...ref.at].map(([t, l]) => [t, JSON.parse(JSON.stringify(l)) as Cmd[]]));
  // B: JSON restore at the start and every 300 ticks, commands through JSON
  const B = new Sim(terrain); B.load(JSON.parse(json0) as State); B.quiet = true;
  // C: structuredClone restores, a flow cache of one field (evicts on every new destination)
  const Cs = new Sim(terrain); Cs.load(structuredClone(JSON.parse(json0)) as State); Cs.quiet = true; Cs.flowCap = 1;
  let okB = true, okC = true;
  const tC = performance.now();
  for (let i = 0; i < 3000; i++) {
    if (i === 250) Cs.flowCap = ORD_FLOWS; // a 1-field cache for the first 250 ticks (evicts all the time), then cold caches now and then
    if (i === 1500 || i === 2500) (Cs as unknown as { oflows: Map<number, unknown> }).oflows.clear();
    B.step(net.get(B.st.tick)); Cs.step(structuredClone(ref.at.get(Cs.st.tick)));
    if (i % 100 === 99) {
      if (hashState(B.st) !== ref.hashes[(i - 99) / 100]) okB = false;
      if (hashState(Cs.st) !== ref.hashes[(i - 99) / 100]) okC = false;
      if (i % 300 === 299) { B.load(JSON.parse(JSON.stringify(B.st)) as State); Cs.load(structuredClone(Cs.st)); }
    }
  }
  check(`random ord / ctl streams (${ref.ords} ord, ${ref.ctls} ctl, ${withOrd} units under orders at the end): JSON restores, commands through JSON`, okB);
  check('… structuredClone restores, a 1-field then cleared flow cache (eviction changes nothing)', okC, `${A.flowBuilds} builds with the cache of ${A.flowCap}, ${Cs.flowBuilds} with 1 / cleared; B+C ${(performance.now() - tC).toFixed(0)} ms`);
  // D: a Session — every other command arrives 1..25 ticks late and forces a rollback
  const D = new Sim(terrain); D.load(JSON.parse(json0) as State); D.quiet = true;
  const backend: Backend = { kind: 'local', send() { /* nobody else */ }, checkpoint() { /* not stored */ } };
  const sess = new Session(D, backend, 'x');
  const all = [...ref.at.values()].flat();
  let late: { c: Cmd; due: number }[] = [];
  all.forEach((c, i) => { if (i % 2 === 0) sess.receive(c); else late.push({ c, due: c.t + 1 + (i % 25) }); });
  const t0D = performance.now();
  let rolled = 0;
  sess.onRollback = () => { rolled++; };
  while (D.st.tick < A.st.tick) {
    (sess as unknown as { stepOnce(): void }).stepOnce();
    const now = late.filter(l => l.due <= D.st.tick);
    for (const l of now) sess.receive(l.c);
    if (now.length) late = late.filter(l => l.due > D.st.tick);
  }
  const tail = late.length;
  for (const l of late) sess.receive(l.c); // the last ones arrive after the reference run ended: one more rollback
  check(`… a Session with half the commands late (${rolled} rollbacks, ${tail} at the very end): same world`, hashState(D.st) === hashState(A.st) && D.st.tick === A.st.tick, `${(performance.now() - t0D).toFixed(0)} ms`);
  check('… no NaN / null in the state', !JSON.stringify(A.st).includes('null'));
  console.log(`  stream run ${msA.toFixed(0)} ms for 3000 ticks (orders + flow fields included)`);
}
const ctlFails = fails.slice(ctlFails0);
console.log(ctlFails.length ? `unit control checks FAILED: ${ctlFails.join('; ')}` : 'unit control checks OK');
