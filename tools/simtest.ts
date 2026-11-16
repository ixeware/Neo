// Headless AI-vs-AI run: balance, speed and determinism check.
import { loadTerrain } from '../src/world/terrain';
import { Sim, hashState, type Cmd } from '../src/sim/sim';
import { UNITS, SIDE_NAME } from '../src/sim/defs';

const MIN = Number(process.argv[2] || 30);
const t0 = performance.now();
const terrain = await loadTerrain();
const t1 = performance.now();
let blocked = 0; for (const c of terrain.navCost) if (!c) blocked++;
console.log(`terrain ${terrain.W}x${terrain.H} nav ${terrain.nw}x${terrain.nh} blocked ${(100*blocked/terrain.navCost.length).toFixed(1)}% load ${(t1-t0).toFixed(0)}ms`);
function run(seed: number, ticks: number, log: boolean) {
  const sim = new Sim(terrain);
  sim.init(seed);
  sim.quiet = !log;
  const cmds: Cmd[] = [{ t: 0, id: 'c0', p: 'x', k: 'cfg', d: 1, hs: -1, mp: 0 }];
  const t2 = performance.now();
  let maxU = 0, wars = 0;
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? cmds : undefined);
    maxU = Math.max(maxU, sim.st.units.length);
    if (log) for (const e of sim.fx) {
      const m = Math.floor(sim.st.tick / 600), s = Math.floor((sim.st.tick % 600) / 10);
      const ts = `${m}:${String(s).padStart(2, '0')}`;
      if (e.e === 'capture') console.log(ts, 'capture', sim.st.pts[e.p].name, e.s >= 0 ? SIDE_NAME[e.s] : 'нейтрал');
      if (e.e === 'floor') console.log(ts, 'floor', SIDE_NAME[e.s], e.floors);
      if (e.e === 'boss') console.log(ts, 'BOSS', SIDE_NAME[e.s]);
      if (e.e === 'voteResult') console.log(ts, 'vote', SIDE_NAME[e.s], e.title);
      if (e.e === 'victory') { console.log(ts, 'VICTORY', SIDE_NAME[e.s]); wars++; }
    }
    sim.fx.length = 0;
  }
  const ms = performance.now() - t2;
  return { sim, ms, maxU, wars };
}
const ticks = MIN * 600;
const a = run(Number(process.argv[3] || 42), ticks, true);
console.log(`ran ${MIN} min in ${a.ms.toFixed(0)}ms (${(ticks / a.ms * 1000).toFixed(0)} ticks/s) maxUnits ${a.maxU}`);
const st = a.sim.st;
console.log('wins', st.sides[0].wins, st.sides[1].wins, 'era', st.era, 'money', st.sides.map(s=>Math.round(s.money)), 'floors', st.sides.map(s=>s.floors), 'units', [0,1].map(s=>a.sim.count(s as 0|1)));
const counts = [0,1].map(s => UNITS.map((_, t) => st.units.filter(u => u.s === s && u.t === t).length));
console.log('composition', JSON.stringify(counts));
// determinism: same seed twice, plus snapshot/restore mid-way
const b = run(42, 3000, false), c = run(42, 3000, false);
const snap = b.sim.snapshot();
const d = new Sim(terrain); d.load(structuredClone(snap)); d.quiet = true;
for (let i = 0; i < 1000; i++) { d.step(undefined); b.sim.step(undefined); }
console.log('determinism', hashState(b.sim.st) === hashState(d.st) && hashState(run(42,4000,false).sim.st) === hashState((()=>{const x=c.sim; for(let i=0;i<1000;i++) x.step(undefined); return x.st;})()) ? 'OK' : 'MISMATCH');
