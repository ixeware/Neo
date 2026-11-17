// v4 map check: the nav grid grew north (z0 < 0). Compares the grown grid and the flow fields of every
// sim point against a pre-v4 copy of src/world/terrain.ts + src/data/terrain.ts + src/sim/flow.ts
// (exported with `git show <rev>:<path>` into OLD/src/...), and times one full-map Dijkstra.
//   npx tsx tools/flowcmp.ts OLD_DIR
import { loadTerrain } from '../src/world/terrain';
import { buildFlow } from '../src/sim/flow';
import { Sim } from '../src/sim/sim';

const OLD = process.argv[2];
if (!OLD) { console.log('usage: npx tsx tools/flowcmp.ts OLD_DIR'); process.exit(2); }
const oldT = await import(OLD + '/src/world/terrain.ts');
const oldF = await import(OLD + '/src/sim/flow.ts');
const tn = await loadTerrain();
const to = await oldT.loadTerrain();
const off = (-tn.z0 / 2) * tn.nw; // pre-v4 cell c is c + off now
let navDiff = 0;
for (let c = 0; c < to.navCost.length; c++) if (to.navCost[c] !== tn.navCost[c + off]) navDiff++;
let blockedN = 0;
for (let c = 0; c < off; c++) if (!tn.navCost[c]) blockedN++;
console.log(`nav old ${to.nw}x${to.nh} (${to.navCost.length}) new ${tn.nw}x${tn.nh} (${tn.navCost.length}); old-area cells that differ: ${navDiff}; north band blocked ${(100 * blockedN / off).toFixed(1)}%`);

const sim = new Sim(tn);
sim.init(1);
const pts = sim.makePoints();
let distDiff = 0, dirDiff = 0, cells = 0;
for (const p of pts) {
  const r = p.kind === 0 ? 4 : Math.min(p.r, 6);
  const a = oldF.buildFlow(to, p.x, p.z, r), b = buildFlow(tn, p.x, p.z, r);
  let dd = 0, dr = 0;
  for (let c = 0; c < to.navCost.length; c++) {
    if (a.dist[c] !== b.dist[c + off]) dd++;
    if (a.dx[c] !== b.dx[c + off] || a.dz[c] !== b.dz[c + off]) dr++;
  }
  cells += to.navCost.length; distDiff += dd; dirDiff += dr;
  if (dd || dr) console.log(`  ${p.key}: ${dd} dist, ${dr} direction cells differ`);
}
console.log(`flow fields for ${pts.length} points: ${distDiff} dist and ${dirDiff} direction differences in ${cells} old-area cells`);

const time = (f: () => void, n: number) => { f(); const t0 = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - t0) / n; };
const N = 40;
const ms = (t: typeof tn, F: typeof buildFlow) => time(() => { for (const p of [pts[0], pts[1], pts[7]]) F(t, p.x, p.z, 4); }, N) / 3;
const mo = ms(to, oldF.buildFlow), mn = ms(tn, buildFlow);
const mo2 = ms(to, oldF.buildFlow), mn2 = ms(tn, buildFlow);
console.log(`buildFlow (one full-map Dijkstra): old ${Math.min(mo, mo2).toFixed(2)} ms, new ${Math.min(mn, mn2).toFixed(2)} ms, ratio ${(Math.min(mn, mn2) / Math.min(mo, mo2)).toFixed(2)}`);
