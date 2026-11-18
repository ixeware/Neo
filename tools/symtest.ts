// Balance sweep: 8 seeds of AI vs AI. `asym` = the real game, `sym` = both sides with Курчалой's numbers.
// npx tsx tools/symtest.ts asym [minutes=45] [seeds=8]
import { loadTerrain } from '../src/world/terrain';
import { Sim, PT_DONER, PT_PLACE0, type Cmd } from '../src/sim/sim';
import * as D from '../src/sim/defs';
const mode = process.argv[2];
const MIN = Number(process.argv[3] || 45);
const SEEDS = Number(process.argv[4] || 8);
const FROM = Number(process.argv[5] || 1);
if (mode === 'sym') {
  for (const u of D.UNITS) {
    u.dmg = [u.dmg[1], u.dmg[1]]; if (u.splash) u.splash = [u.splash[1], u.splash[1]]; if (u.heal) u.heal = [u.heal[1], u.heal[1]];
    u.cost = [u.cost[1], u.cost[1]]; if (u.sspeed) u.sspeed = [u.sspeed[1], u.sspeed[1]]; if (u.carry) u.carry = [u.carry[1], u.carry[1]];
    u.avail = [true, true];
  }
  D.BOSS_HP[0] = D.BOSS_HP[1]; D.BOSS_RANGE[0] = D.BOSS_RANGE[1];
  const w = D.AI_W[1].map((v, i) => Math.max(v, D.AI_W[0][i]));
  D.AI_W[0] = w; D.AI_W[1] = [...w];
}
// Quick tuning without editing defs: TUNE='[["chimaev","hp",600],["bekhan","cost",[140,140]]]'
for (const [k, f, v] of JSON.parse(process.env.TUNE || '[]') as [string, string, unknown][]) {
  const u = (k === 'DONER' ? D.DONER : k === 'HERO' ? D.HERO : k === 'ECON' ? D.ECON : k === 'AI_W' ? D.AI_W : k === 'BASE' ? D.BASE : k === 'AI_BW' ? D.AI_BW : D.UNITS.find(q => q.key === k) ?? D.BUILDINGS.find(q => q.key === k)) as unknown as Record<string, unknown>;
  if (u) u[f] = v; else console.log('TUNE: no unit', k);
}
const terrain = await loadTerrain();
const wins = [0, 0]; const caps = [0, 0]; const firsts: number[] = []; const firstWin = [0, 0]; const byWar: number[][] = [[0, 0], [0, 0], [0, 0]]; const warLen: number[] = [];
const heroes = [0, 0], rides = [0, 0], donerMin = [0, 0];
// v3: гелики / спортики bought, ₽ stolen by Мохьмад (ersno), packs, minutes the enemy held a side's places, enemy captures of them
const geliks = [0, 0], sportiki = [0, 0], stolen = [0, 0], packs = [0, 0], placeLost = [0, 0], placeTaken = [0, 0];
let maxBytes = 0, errors = 0;
const ev: Record<string, number> = {};
const t0 = performance.now();
for (let seed = FROM; seed < FROM + SEEDS; seed++) {
  const sim = new Sim(terrain); sim.init(seed); sim.quiet = false;
  const cmds: Cmd[] = [{ t: 0, id: 'c', p: 'x', k: 'cfg', d: 1, hs: -1, mp: 0 }];
  let first = -1, nWar = 0, warStart = 0;
  try {
    for (let i = 0; i < 600 * MIN; i++) {
      sim.step(i === 0 ? cmds : undefined);
      for (const e of sim.fx) {
        if (e.e === 'victory') { if (first < 0) { first = sim.st.tick; firstWin[e.s]++; } byWar[Math.min(2, nWar++)][e.s]++; warLen.push((sim.st.tick - warStart) / 600); }
        if (e.e === 'newWar') warStart = sim.st.tick;
        if (e.e === 'event') ev[e.key] = (ev[e.key] || 0) + 1;
        if (e.e === 'ability') ev['ab:' + e.key] = (ev['ab:' + e.key] || 0) + 1;
        if (e.e === 'spawn' && e.own === -2) { if (D.UNITS[e.t].hero) heroes[e.s]++; if (e.t === D.RIDE) rides[e.s]++; }
        if (e.e === 'unload' || e.e === 'poison' || e.e === 'voteSkip' || e.e === 'summon' || e.e === 'hack' || e.e === 'stunN' || e.e === 'comedown') ev[e.e] = (ev[e.e] || 0) + 1;
        if (e.e === 'spawn' && e.own === -2) { if (e.t === D.GELIK) geliks[e.s]++; if (e.t === D.SPORTIK) sportiki[e.s]++; }
        if (e.e === 'steal') stolen[e.s] += e.n;
        if (e.e === 'pack') packs[e.s]++;
        if (e.e === 'capture' && e.p >= PT_PLACE0 && e.s >= 0 && e.s !== sim.st.pts[e.p].side) placeTaken[sim.st.pts[e.p].side]++;
      }
      sim.fx.length = 0;
      if (i % 600 === 0) {
        for (let k = PT_PLACE0; k < sim.st.pts.length; k++) { const p = sim.st.pts[k]; if (p.owner >= 0 && p.owner !== p.side) placeLost[p.side]++; }
        for (const p of sim.st.pts) if (p.kind === 1 && p.owner >= 0) caps[p.owner]++;
        if (sim.st.pts[PT_DONER].owner >= 0) donerMin[sim.st.pts[PT_DONER].owner]++;
      }
      if (i % 300 === 0) maxBytes = Math.max(maxBytes, JSON.stringify(sim.st).length);
    }
  } catch (err) { errors++; console.log(`\nseed ${seed} EXCEPTION at tick ${sim.st.tick}:`, err); }
  wins[0] += sim.st.sides[0].wins; wins[1] += sim.st.sides[1].wins;
  if (first > 0) firsts.push(first / 600);
  process.stdout.write(`seed ${seed}: ${sim.st.sides[0].wins}-${sim.st.sides[1].wins} first@${(first / 600).toFixed(1)}m  `);
}
const ms = performance.now() - t0;
console.log(`\nTOTAL Атаги ${wins[0]} Курчалой ${wins[1]} (Атаги ${(100 * wins[0] / Math.max(1, wins[0] + wins[1])).toFixed(0)}%), first wars won ${firstWin[0]}-${firstWin[1]}, village-minutes`, caps, 'Донер Бей minutes', donerMin);
firsts.sort((a, b) => a - b);
console.log('wins by war #1 / #2 / #3+:', byWar.map(w => w.join('-')).join(' / '), ' all war lengths median', [...warLen].sort((a, b) => a - b)[warLen.length >> 1]?.toFixed(1));
console.log('first war length (min): median', firsts[firsts.length >> 1]?.toFixed(1), 'range', firsts[0]?.toFixed(1), '–', firsts[firsts.length - 1]?.toFixed(1));
console.log('AI bought heroes', heroes, 'rides', rides, 'events', JSON.stringify(ev));
console.log('гелики', geliks, 'спортики', sportiki, '₽ stolen by Мохьмад (ersno)', stolen, 'packs', packs, 'places held by the enemy (min) [Атаги, Курчалой]', placeLost, 'enemy captures', placeTaken);
console.log(`state JSON peak ${(maxBytes / 1024).toFixed(1)} KB; exceptions ${errors}; ${(SEEDS * MIN * 600 / ms * 1000).toFixed(0)} ticks/s overall`);
if (errors) process.exitCode = 1;
