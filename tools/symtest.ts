import { loadTerrain } from '../src/world/terrain';
import { Sim, type Cmd } from '../src/sim/sim';
import * as D from '../src/sim/defs';
const mode = process.argv[2];
if (mode === 'sym') {
  for (const u of D.UNITS) { u.dmg = [u.dmg[1], u.dmg[1]]; if (u.splash) u.splash = [u.splash[1], u.splash[1]]; if (u.heal) u.heal = [u.heal[1], u.heal[1]]; u.cost = [u.cost[1], u.cost[1]]; }
  D.BOSS_HP[0] = D.BOSS_HP[1]; D.BOSS_RANGE[0] = D.BOSS_RANGE[1];
}
const terrain = await loadTerrain();
const wins = [0, 0]; let caps = [0, 0];
for (let seed = 1; seed <= 8; seed++) {
  const sim = new Sim(terrain); sim.init(seed); sim.quiet = false;
  const cmds: Cmd[] = [{ t: 0, id: 'c', p: 'x', k: 'cfg', d: 1, hs: -1, mp: 0 }];
  let first = -1;
  for (let i = 0; i < 600 * 40; i++) {
    sim.step(i === 0 ? cmds : undefined);
    for (const e of sim.fx) if (e.e === 'victory' && first < 0) first = sim.st.tick;
    sim.fx.length = 0;
    if (i % 600 === 0) for (const p of sim.st.pts) if (p.kind === 1 && p.owner >= 0) caps[p.owner]++;
  }
  wins[0] += sim.st.sides[0].wins; wins[1] += sim.st.sides[1].wins;
  process.stdout.write(`seed ${seed}: ${sim.st.sides[0].wins}-${sim.st.sides[1].wins} first@${(first/600).toFixed(1)}m  `);
}
console.log('\nTOTAL Атаги', wins[0], 'Курчалой', wins[1], 'village-minutes', caps);
