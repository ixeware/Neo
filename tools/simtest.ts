// Headless AI-vs-AI run: balance, speed, content events, state size and determinism check.
// npx tsx tools/simtest.ts <minutes> <seed>
import { loadTerrain } from '../src/world/terrain';
import { Sim, hashState, PT_DONER, type Cmd, type State } from '../src/sim/sim';
import { UNITS, CARDS, SIDE_NAME, RIDE, GOLEM, CHICKEN, CHIMAEV, BEKHAN, WOU, ADMIN, ERSNO, ADAM, MOHMAD, type Side } from '../src/sim/defs';

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

function run(seed: number, ticks: number, log: boolean, sizeEvery = 0) {
  const sim = new Sim(terrain);
  sim.init(seed);
  sim.quiet = !log;
  let maxU = 0, wars = 0, maxBytes = 0, maxBytesAt = 0, nulls = 0; const donerTicks = [0, 0];
  const counts: Record<string, number> = {};
  const heroIn = [0, 0];
  const t2 = performance.now();
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? cfg : undefined);
    const st = sim.st;
    maxU = Math.max(maxU, st.units.length);
    if (st.pts[PT_DONER].owner >= 0) donerTicks[st.pts[PT_DONER].owner]++;
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
        case 'spawn': if (UNITS[e.t].hero || e.t === RIDE) { if (UNITS[e.t].hero) heroIn[e.s]++; console.log(T, '  +', SIDE_NAME[e.s], name(e.s, e.t)); } break;
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
      }
    }
    sim.fx.length = 0;
  }
  const ms = performance.now() - t2;
  return { sim, ms, maxU, wars, counts, maxBytes, maxBytesAt, donerTicks, heroIn, nulls };
}

const ticks = MIN * 600;
const a = run(SEED, ticks, true, 50);
const st = a.sim.st;
console.log('--- summary ---');
console.log('wins', st.sides[0].wins, st.sides[1].wins, 'era', st.era, 'money', st.sides.map(s => Math.round(s.money)), 'floors', st.sides.map(s => s.floors), 'units', [0, 1].map(s => a.sim.count(s as Side)), 'maxUnits', a.maxU);
console.log('composition', JSON.stringify([0, 1].map(s => UNITS.map((_, t) => st.units.filter(u => u.s === s && u.t === t).length))));
console.log('heroes deployed', a.heroIn, 'Донер Бей owned (min)', a.donerTicks.map(n => (n / 600).toFixed(1)));
console.log('events', JSON.stringify(a.counts));
console.log(`state JSON peak ${(a.maxBytes / 1024).toFixed(1)} KB at ${ts(a.maxBytesAt)} (limit for shared checkpoints 256 KB); samples with NaN/null: ${a.nulls}`);
if (a.nulls) process.exitCode = 1;
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
  checks.push(['WOU на парах', s.canDeploy(0, WOU, at.x + 3, at.z)]);
  s.st.ev.friday = s.st.tick + 100;
  checks.push(['такси в пятницу', String(s.cost(0, RIDE)) + ' / маршрутка ' + s.cost(1, RIDE)]);
  console.log('deploy rules:', checks.map(([k, v]) => `${k}: «${v}»`).join('; '));
  const bad = !checks[0][1] || !checks[1][1] || !checks[2][1] || !checks[3][1] || checks[5][1] || !checks[6][1].includes('уже на поле') || checks[7][1] !== 'Ещё не вернулся' || !checks[9][1].includes('На парах');
  if (bad) { console.log('DEPLOY RULES FAILED'); process.exitCode = 1; }
}

// ---- determinism: same seed twice, plus JSON snapshot/restore mid-run with all content alive ----
function forceContent(sim: Sim) {
  const at = sim.st.pts[0], ku = sim.st.pts[1];
  sim.st.sides[0].money += 5000; sim.st.sides[1].money += 5000;
  const put = (s: Side, t: number, x: number, z: number) => { if (!UNITS[t].hero || sim.st.sides[s].hero[t] === -1) sim.spawnGroup(s, t, x, z, -2); };
  for (const t of [WOU, ADMIN, ERSNO, BEKHAN, ADAM, MOHMAD]) put(0, t, at.x + 4, at.z + 1);
  for (const t of [CHIMAEV, WOU, ADMIN, ERSNO, ADAM, MOHMAD]) put(1, t, ku.x - 4, ku.z + 1);
  sim.startEvent('jam');
}
function forceLate(sim: Sim) { // rides and chickens are short-lived: add them right before the snapshot
  const at = sim.st.pts[0], ku = sim.st.pts[1], sh = sim.st.pts[4];
  sim.spawnGroup(0, RIDE, at.x + 4, at.z, -2); sim.spawnGroup(1, RIDE, ku.x - 4, ku.z, -2);
  for (let i = 0; i < 4; i++) { sim.spawn(0, CHICKEN, sh.x + i * 0.5, sh.z, -1); sim.spawn(1, CHICKEN, sh.x + i * 0.5, sh.z + 3, -1); }
}
function runTo(seed: number, n: number, at: Record<number, (s: Sim) => void> = {}) {
  const s = new Sim(terrain); s.init(seed); s.quiet = true;
  for (let i = 0; i < n; i++) { at[i]?.(s); s.step(i === 0 ? cfg : undefined); }
  return s;
}
const live = (s: Sim) => JSON.stringify({ heroes: s.st.units.filter(u => UNITS[u.t].hero).length, away: s.st.away.length, rides: s.st.units.filter(u => u.t === RIDE).length, golems: s.st.units.filter(u => u.t === GOLEM).length, chickens: s.st.units.filter(u => u.t === CHICKEN).length, aoe: s.st.aoe.length, poisoned: s.st.units.filter(u => u.psn > s.st.tick).length, ev: s.st.ev });
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
// heroes forced in at 5:00, rides + chickens + Фудзи poison at 5:05, snapshot at 5:06 while all of it is alive
const b = runTo(SEED, 3060, {
  3000: forceContent,
  3050: s => { forceLate(s); (s as unknown as { applyCard(s: Side, c: unknown, f: number): void }).applyCard(1, CARDS[18], -1); },
});
console.log('content at 5:06', live(b));
let ok = twin(b, 600, 'A (heroes, summons, rides, jam, poison)');
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
    for (let n = s.count(sd); n < 150; n++) s.spawn(sd, 2, p.x + (sd ? 8 : -8) + (n % 10) * 0.4, p.z - 4 + Math.floor(n / 10) * 0.4, -1);
  }
  let peak = 0, at = 0;
  for (let i = 0; i < 60; i++) { s.step(undefined); const b = JSON.stringify(s.st).length; if (b > peak) { peak = b; at = s.st.proj.length; } }
  const kb = peak / 1024;
  console.log(`worst case (both sides at the 150 cap, all heroes): ${kb.toFixed(1)} KB with ${at} projectiles in flight`);
  if (kb > 180) { console.log('STATE TOO BIG'); process.exitCode = 1; }
}

// ---- a save from before the content update (no Донер Бей, no hero fields) still loads and replays identically ----
{
  const s = runTo(SEED, 2000);
  const old = JSON.parse(JSON.stringify(s.st)) as Record<string, unknown> & State;
  const o = old as unknown as Record<string, unknown>;
  delete o.aoe; delete o.away; delete o.ev; old.pts.length = 8;
  for (const sd of old.sides) for (const k of ['hero', 'heroCd', 'hack', 'poor', 'weak', 'sauce', 'sauceM', 'dodge', 'immune', 'skip', 'aiWant', 'aiWantUntil']) delete (sd as unknown as Record<string, unknown>)[k];
  for (const u of old.units) for (const k of ['psn', 'tt', 'tn', 'ld', 'f']) delete (u as unknown as Record<string, unknown>)[k];
  const x = new Sim(terrain), y = new Sim(terrain);
  x.load(structuredClone(old)); y.load(JSON.parse(JSON.stringify(old)) as State); x.quiet = y.quiet = true;
  for (let i = 0; i < 1200; i++) { x.step(undefined); y.step(undefined); }
  const okm = hashState(x.st) === hashState(y.st) && x.st.pts.length === 9 && x.st.sides[0].hero.length === UNITS.length;
  console.log('old save migration', okm ? 'OK' : 'FAILED');
  if (!okm) process.exitCode = 1;
}
