// Headless AI-vs-AI run: balance, speed, content events, state size, determinism, plus unit checks
// for every mechanic (heroes, v3: гелики, спортики, ersno steal, админ pack, снюс/LOOP cards, places).
// npx tsx tools/simtest.ts <minutes> <seed>
import { loadTerrain, lcAt, navIndex, LC } from '../src/world/terrain';
import { Sim, hashState, PT_DONER, PT_PLACE0, PT_COUNT, type Cmd, type State, type U } from '../src/sim/sim';
import {
  UNITS, CARDS, SIDE_NAME, RIDE, GOLEM, CHICKEN, CHIMAEV, BEKHAN, WOU, ADMIN, ERSNO, ADAM, MOHMAD, GELIK, SPORTIK, BOSS,
  HERO, PLACE, BUFF, Fx, SHOP, unitName, cardText, type Card, type Side,
} from '../src/sim/defs';
import { CAPTURE_PLACES } from '../src/data/places';

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
  packUlt(u: U): void; cardSteal(u: U): void; adminN(u: U): void; taunt(u: U): void; openVote(s: Side): void;
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
  for (const t of [WOU, ADMIN, ERSNO, BEKHAN, ADAM, MOHMAD, GELIK, SPORTIK]) put(0, t, at.x + 4, at.z + 1);
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
const liveOk = b.st.packs.length > 0 && b.st.units.some(u => u.fr > b.st.tick) && b.st.units.some(u => u.t === GELIK) && b.st.units.some(u => u.t === SPORTIK) && b.st.sides[0].snus > b.st.tick && b.st.sides[1].loop > b.st.tick && b.st.units.some(u => u.t === ERSNO);
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
  const shape = x.st.pts.length === PT_COUNT && x.st.sides.every(sd => sd.hero.length === UNITS.length && sd.heroCd.length === UNITS.length && sd.snus === 0 && sd.loop === 0 && sd.pack === 0)
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
  for (const sd of old.sides) { strip(sd as unknown as Record<string, unknown>, ['snus', 'loop', 'pack']); sd.hero.length = 16; sd.heroCd.length = 16; }
  for (const u of old.units) strip(u as unknown as Record<string, unknown>, ['fr']);
  migrates('d69dd41 format', old);
}
{ // before the content update: no Донер Бей, no hero fields at all
  const s = runTo(SEED, 2000);
  const old = JSON.parse(JSON.stringify(s.st)) as State;
  strip(old as unknown as Record<string, unknown>, ['aoe', 'away', 'ev', 'packs']);
  old.pts.length = 8;
  old.units = old.units.filter(u => u.t < 6);
  for (const sd of old.sides) strip(sd as unknown as Record<string, unknown>, ['hero', 'heroCd', 'hack', 'poor', 'weak', 'sauce', 'sauceM', 'dodge', 'immune', 'skip', 'aiWant', 'aiWantUntil', 'snus', 'loop', 'pack']);
  for (const u of old.units) strip(u as unknown as Record<string, unknown>, ['psn', 'tt', 'tn', 'ld', 'f', 'fr']);
  migrates('pre-content format', old);
}

console.log(fails.length ? `v3 checks FAILED: ${fails.join('; ')}` : 'v3 checks OK');
