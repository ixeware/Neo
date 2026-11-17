// v4 Грозный layout check: the city landmarks (src/render/city.ts CITY_SITES), the sim's city points
// (src/data/season.ts CITY_POINTS / CITY_DECOR) and the block fill. Prints the table the sim uses and
// fails (exit 1) when a rule is broken:
//   - every building stands where CITY_POINTS / CITY_DECOR say (bx, bz) and on dry, roadless ground;
//   - no two landmark footprints overlap;
//   - every capture centre is within 1.5 of the spec's (see SPEC), on a passable nav cell whose 3×3 block
//     is passable, off the water, outside every landmark footprint; circles keep ≥ 0.2 apart;
//   - the blocks stay off the ribbons, the water and the landmarks.
//   npx tsx tools/citycheck.ts [--json]
import { loadTerrain, passable, lcAt, navIndex, LC, NAV } from '../src/world/terrain';
import { roadClearance, RC, ALL_MASK } from '../src/render/roads';
import { CITY_SITES, siteRect, rectsOverlap, inRect, cityPlan, cityPlanStats, CITY, type Rect } from '../src/render/city';
import { CITY_POINTS, CITY_DECOR } from '../src/data/season';
import { Sim, type Cmd } from '../src/sim/sim';

const t = await loadTerrain();

// --solve: propose the site positions (nearest to the 2GIS point, off the big roads and the water, no
// overlaps, the front towards the game camera's south), the stop shelters (at the edge of their deploy circle, by a
// street, open to it) and the capture centres (nearest to the spec's, valid by the rules below).
if (process.argv.includes('--solve')) {
  const BIG = (1 << RC.MAIN) | (1 << RC.RAIL);
  const placed: Rect[] = [];
  const want: Record<string, { x: number; z: number; max: number; s: number[] }> = {
    ggntu: { x: 25.4, z: -22.8, max: 3.0, s: [0.3, 0.27, 0.24, 0.21, 0.19] }, shaiba: { x: 22.5, z: -22.8, max: 3.5, s: [0.27, 0.24, 0.22, 0.2] },
    chgu: { x: 31.3, z: -13.0, max: 2.0, s: [0.36, 0.32, 0.28] }, chgu2: { x: 48.8, z: -16.6, max: 2.0, s: [0.3, 0.27] },
    ansar: { x: 31.6, z: 3.6, max: 2.0, s: [0.55, 0.5, 0.45] }, doner: { x: 21.2, z: -26.4, max: 2.0, s: [0.72, 0.65, 0.58, 0.52] },
    ansar2: { x: 11.6, z: -23.5, max: 1.5, s: [1] },
  };
  const samples = (r: Rect, f: (x: number, z: number) => void) => {
    const c = Math.cos(r.ry), n = Math.sin(r.ry);
    for (let a = -1; a <= 1.001; a += 0.25) for (let b = -1; b <= 1.001; b += 0.25) { const lx = a * r.hx, lz = b * r.hz; f(r.x + lx * c + lz * n, r.z - lx * n + lz * c); }
  };
  const okRect = (r: Rect, mask = BIG) => {
    let wet = 0, main = 0, blocked = 0;
    samples(r, (x, z) => { if (lcAt(t, x, z) === LC.WATER) wet++; if (roadClearance(x, z, mask) < 0.04) main++; if (!passable(t, x, z)) blocked++; });
    return wet <= 3 && main === 0 && !blocked && !placed.some(p => rectsOverlap(r, p, 0.3));
  };
  const out: Record<string, { x: number; z: number; ry: number; s: number }> = {};
  for (const s of CITY_SITES) {
    const w = want[s.key];
    if (!w) continue;
    let best: { x: number; z: number; ry: number; s: number; score: number } | null = null;
    for (const sc of w.s) {
      for (let R = 0; R <= w.max + 1e-6; R += 0.25) {
        const nA = R === 0 ? 1 : Math.round(R * 10);
        for (let k = 0; k < nA; k++) {
          const a = (k / nA) * Math.PI * 2, x = w.x + Math.sin(a) * R, z = w.z + Math.cos(a) * R;
          for (let q = 0; q < 24; q++) {
            const ry = -Math.PI + (q / 24) * Math.PI * 2;
            if (!okRect(siteRect({ ...s, x, z, ry, s: sc }))) continue;
            // the front (local +z) towards the game camera, which looks north from the south (yaw 0)
            const score = R + (1 - Math.cos(ry)) * 0.9 + ((w.s[0] - sc) / w.s[0]) * 4;
            if (!best || score < best.score) best = { x, z, ry, s: sc, score };
          }
        }
      }
    }
    if (!best) { console.log(`  ${s.key}: no spot`); continue; }
    placed.push(siteRect({ ...s, ...best }));
    out[s.key] = best;
    console.log(`  ${s.key}: x ${best.x.toFixed(2)}, z ${best.z.toFixed(2)}, ry ${best.ry.toFixed(2)}, s ${best.s}  (moved ${Math.hypot(best.x - w.x, best.z - w.z).toFixed(2)})`);
  }
  // capture centres, in CITY_POINTS order
  const SPEC0: Record<string, [number, number]> = { doner: [21.2, -26.4], ggntu: [27.6, -22.4], chgu: [31.8, -12.2], shaiba: [22.2, -20.2], ansar: [31.6, 3.6], stopA: [10.0, -18.0], stopK: [40.0, -24.0] };
  const nav3 = (x: number, z: number) => { const c = navIndex(t, x, z), i = c % t.nw, j = (c - i) / t.nw; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= t.nw || jj >= t.nh || !t.navCost[jj * t.nw + ii]) return false; } return true; };
  const circ: { key: string; x: number; z: number; r: number }[] = [];
  for (const p of CITY_POINTS) {
    const [sx, sz] = SPEC0[p.key];
    let got: { x: number; z: number } | null = null;
    for (let R = 0; R <= 1.5 + 1e-6 && !got; R += 0.1) {
      const nA = R === 0 ? 1 : 32;
      for (let k = 0; k < nA && !got; k++) {
        const a = (k / nA) * Math.PI * 2, x = Math.round((sx + Math.sin(a) * R) * 10) / 10, z = Math.round((sz + Math.cos(a) * R) * 10) / 10;
        if (Math.hypot(x - sx, z - sz) > 1.5) continue;
        if (!passable(t, x, z) || !nav3(x, z)) continue;
        let wet = false;
        for (const [ox, oz] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) if (lcAt(t, x + ox, z + oz) === LC.WATER) wet = true;
        if (wet) continue;
        if (placed.some(r => inRect(r, x, z, 0.5))) continue;
        if (circ.some(c => Math.hypot(c.x - x, c.z - z) - c.r - p.r < 0.25)) continue;
        if (CITY_POINTS.some(q => q.key !== p.key && !circ.find(c => c.key === q.key) && Math.hypot(q.x - x, q.z - z) - q.r - p.r < 0.25)) continue;
        got = { x, z };
      }
    }
    if (!got) { console.log(`  centre ${p.key}: none`); continue; }
    circ.push({ key: p.key, ...got, r: p.r });
    console.log(`  centre ${p.key}: ${got.x}, ${got.z}  (moved ${Math.hypot(got.x - sx, got.z - sz).toFixed(2)})`);
  }
  // stop shelters: at the edge of their circle (r − 0.6 .. r + 0.3), next to a street, open towards it
  const STREETS = (1 << RC.MAIN) | (1 << RC.ROAD) | (1 << RC.STREET);
  const probe = { seg: -1 };
  for (const s of CITY_SITES.filter(q => q.model === 'busstop')) {
    const c = circ.find(q => q.key === s.key);
    if (!c) continue;
    let best: { x: number; z: number; ry: number; score: number } | null = null;
    for (let d = c.r - 0.6; d <= c.r + 0.31; d += 0.15) for (let k = 0; k < 72; k++) {
      const a = (k / 72) * Math.PI * 2, x = c.x + Math.sin(a) * d, z = c.z + Math.cos(a) * d;
      const cl = roadClearance(x, z, STREETS, 9, probe);
      if (cl < 0.5 || cl > 0.9 || probe.seg < 0) continue;
      // open side (+z) towards the street: the nearest point of that segment
      const n = (await import('../src/render/roads')).roadNet();
      const sg = probe.seg, ex = n.sx1[sg] - n.sx0[sg], ez = n.sz1[sg] - n.sz0[sg], el = ex * ex + ez * ez;
      const f = el > 0 ? Math.max(0, Math.min(1, ((x - n.sx0[sg]) * ex + (z - n.sz0[sg]) * ez) / el)) : 0;
      const ry = Math.atan2(n.sx0[sg] + ex * f - x, n.sz0[sg] + ez * f - z);
      const r = siteRect({ ...s, x, z, ry });
      if (!okRect(r, STREETS)) continue;
      if (circ.some(q => q.key !== s.key && Math.hypot(q.x - x, q.z - z) < q.r + 0.5)) continue;
      const score = Math.abs(d - c.r) + (cl - 0.5);
      if (!best || score < best.score) best = { x, z, ry, score };
    }
    if (!best) { console.log(`  ${s.key} shelter: none`); continue; }
    placed.push(siteRect({ ...s, ...best }));
    console.log(`  ${s.key} shelter: x ${best.x.toFixed(2)}, z ${best.z.toFixed(2)}, ry ${best.ry.toFixed(2)}`);
  }
  process.exit(0);
}
const fails: string[] = [];
const bad = (s: string) => { fails.push(s); console.log('  FAIL ' + s); };
const r1 = (v: number) => Math.round(v * 10) / 10;

/** The capture centres as the spec proposed them (docs/v4/SPEC.md §2); the map may move each ≤ 1.5. */
const SPEC: Record<string, [number, number]> = {
  doner: [21.2, -26.4], ggntu: [27.6, -22.4], chgu: [31.8, -12.2], shaiba: [22.2, -20.2], ansar: [31.6, 3.6], stopA: [10.0, -18.0], stopK: [40.0, -24.0],
};

const rects = new Map<string, Rect>();
for (const s of CITY_SITES) rects.set(s.key, siteRect(s));
const MAINS = (1 << RC.MAIN) | (1 << RC.RAIL); // the other classes are cut under the landmarks (cityKeepOut)
console.log('landmarks (model origin, facing, scale, footprint):');
for (const s of CITY_SITES) {
  const r = rects.get(s.key)!;
  let wet = 0, onMain = 0;
  const c = Math.cos(r.ry), n = Math.sin(r.ry);
  for (let a = -1; a <= 1.001; a += 0.25) for (let b = -1; b <= 1.001; b += 0.25) {
    const lx = a * r.hx, lz = b * r.hz, x = r.x + lx * c + lz * n, z = r.z - lx * n + lz * c;
    if (lcAt(t, x, z) === LC.WATER) wet++;
    if (roadClearance(x, z, MAINS) < 0.02) onMain++;
  }
  console.log(`  ${s.key.padEnd(7)} ${s.model.padEnd(8)} at ${r1(s.x)}, ${r1(s.z)}  ry ${s.ry.toFixed(2)}  ×${s.s}  ${r1(r.hx * 2)} × ${r1(r.hz * 2)}  water ${wet}/81  main road ${onMain}/81`);
  if (wet > 6) bad(`${s.key}: ${wet} of 81 footprint samples on water`);
  if (onMain > 4 && s.model !== 'busstop' && s.model !== 'sign') bad(`${s.key}: ${onMain} of 81 footprint samples on a main road`);
  const p = CITY_POINTS.find(q => q.key === s.key), d = CITY_DECOR.find(q => q.key === s.key);
  const want = p ? [p.bx, p.bz] : d ? [d.bx, d.bz] : null;
  if (!want) bad(`${s.key}: not in CITY_POINTS / CITY_DECOR`);
  else if (Math.hypot(want[0] - s.x, want[1] - s.z) > 0.05) bad(`${s.key}: drawn at ${s.x}, ${s.z} but the data says ${want[0]}, ${want[1]}`);
}
for (let i = 0; i < CITY_SITES.length; i++) for (let j = i + 1; j < CITY_SITES.length; j++) {
  const a = CITY_SITES[i], b = CITY_SITES[j];
  if (rectsOverlap(rects.get(a.key)!, rects.get(b.key)!, 0.2)) bad(`${a.key} and ${b.key} footprints overlap (gap < 0.2)`);
}

console.log('capture / deploy centres (idx key: centre, r; moved from the spec; nav 3×3):');
const nr = (x: number, z: number) => { const c = navIndex(t, x, z), i = c % t.nw, j = (c - i) / t.nw; let ok = true; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= t.nw || jj >= t.nh || !t.navCost[jj * t.nw + ii]) ok = false; } return ok; };
for (const p of CITY_POINTS) {
  const sp = SPEC[p.key], moved = sp ? Math.hypot(p.x - sp[0], p.z - sp[1]) : 0;
  const pass = passable(t, p.x, p.z) && nr(p.x, p.z), wet = lcAt(t, p.x, p.z) === LC.WATER;
  const inside = CITY_SITES.filter(s => inRect(rects.get(s.key)!, p.x, p.z, 0.3)).map(s => s.key);
  console.log(`  ${String(p.idx).padStart(2)} ${p.key.padEnd(7)} ${r1(p.x)}, ${r1(p.z)}  r ${p.r}  moved ${moved.toFixed(2)}  nav ${pass ? 'ok' : 'BLOCKED'}  ${wet ? 'WATER' : 'dry'}${inside.length ? '  inside ' + inside.join(',') : ''}  cost ${t.navCost[navIndex(t, p.x, p.z)]}`);
  if (moved > 1.5 + 1e-6) bad(`${p.key}: capture centre moved ${moved.toFixed(2)} (> 1.5) from the spec`);
  if (!pass) bad(`${p.key}: centre's 3×3 nav block is not passable`);
  if (wet) bad(`${p.key}: centre on water`);
  if (inside.length) bad(`${p.key}: centre inside ${inside.join(', ')}`);
}
for (let i = 0; i < CITY_POINTS.length; i++) for (let j = i + 1; j < CITY_POINTS.length; j++) {
  const a = CITY_POINTS[i], b = CITY_POINTS[j], gap = Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
  if (gap < 0.2) bad(`circles ${a.key} / ${b.key} gap ${gap.toFixed(2)} < 0.2`);
}

const plan = cityPlan(t);
let onRoad = 0, wet = 0, onSite = 0;
const kinds = [0, 0, 0, 0];
for (const b of plan.blocks) {
  kinds[b.kind]++;
  if (roadClearance(b.x, b.z, ALL_MASK) < 0) onRoad++;
  if (lcAt(t, b.x, b.z) === LC.WATER) wet++;
  if (CITY_SITES.some(s => inRect(rects.get(s.key)!, b.x, b.z))) onSite++;
}
console.log('  block sites refused / taken:', JSON.stringify(cityPlanStats));
console.log(`city fill: ${plan.blocks.length} blocks (5/9/12/16 эт.: ${kinds.join(' / ')}) in the ellipse ${CITY.x}, ${CITY.z} ± ${CITY.rx} × ${CITY.rz}; centre on a ribbon ${onRoad}, on water ${wet}, on a landmark ${onSite}`);
if (onRoad || wet || onSite) bad('city blocks on a ribbon, the water or a landmark');
console.log(`nav: ${t.nw}×${t.nh} cells of ${NAV}, north edge z0 ${t.z0}`);

// the sim in the city band: an order there arrives, a unit there finds its way south, fights see each other
{
  const sim = new Sim(t); sim.init(5); sim.quiet = true;
  sim.step([{ t: 0, id: 'c0', p: 'x', k: 'cfg', d: 1, hs: -1, mp: 0 } as Cmd]);
  const st = sim.st;
  st.nextMilitia = st.nextVote = st.ev.next = 1e9;
  for (const sd of st.sides) { sd.aiNext = 1e9; sd.black = 1e9; }
  let n = 0;
  const C = (b: Record<string, unknown>) => ({ t: st.tick, id: `pa:${String(n++).padStart(6, '0')}`, p: 'pa', ...b }) as unknown as Cmd;
  sim.step([C({ k: 'join', s: 0 })]);
  const stopA = CITY_POINTS.find(p => p.key === 'stopA')!, gg = CITY_POINTS.find(p => p.key === 'ggntu')!;
  const u = sim.spawn(0, 3, stopA.x, stopA.z, -1); // Баран: fast
  sim.step([C({ k: 'ord', s: 0, ids: [u.id], m: 'move', x: gg.x, z: gg.z })]);
  for (let i = 0; i < 900 && Math.hypot(u.x - gg.x, u.z - gg.z) > 1.5; i++) sim.step(undefined);
  const arrived = Math.hypot(u.x - gg.x, u.z - gg.z) <= 1.5;
  console.log(`  sim: a move order from stopA to ГГНТУ ${arrived ? 'arrives' : 'does NOT arrive'} (${u.x.toFixed(1)}, ${u.z.toFixed(1)}) at tick ${st.tick}`);
  if (!arrived) bad('an order inside the city band does not arrive');
  // auto mode: a unit standing in the city walks south towards its goal (the flow fields cover the band)
  sim.step([C({ k: 'ord', s: 0, ids: [u.id], m: 'auto' })]);
  const z0 = u.z;
  for (let i = 0; i < 600; i++) sim.step(undefined);
  console.log(`  sim: on auto it walks from z ${z0.toFixed(1)} to ${u.z.toFixed(1)}`);
  if (!(u.z > z0 + 10)) bad('a unit in the city band does not find its way south');
  // a pre-v4 save: a move order's nav cell counted from z = 0 (18 rows short); load() re-anchors it, and
  // leaves a current order alone
  const v = sim.spawn(0, 0, 120, 150, -1);
  sim.step([C({ k: 'ord', s: 0, ids: [v.id], m: 'move', x: 130, z: 160 })]);
  const cNow = v.o!.c, old = JSON.parse(JSON.stringify(st));
  const ov = old.units.find((q: { id: number }) => q.id === v.id);
  ov.o.c = cNow - (-t.z0 / NAV) * t.nw;
  const cOld = ov.o.c;
  const re = new Sim(t); re.load(old);
  const rv = re.st.units.find(q => q.id === v.id)!;
  const cur = new Sim(t); cur.load(JSON.parse(JSON.stringify(st)));
  const cv = cur.st.units.find(q => q.id === v.id)!;
  console.log(`  sim: a pre-v4 order cell ${cOld} loads as ${rv.o?.c} (now ${cNow}); a current one stays ${cv.o?.c}`);
  if (rv.o?.c !== cNow || cv.o?.c !== cNow) bad('old order cells are not re-anchored on load (or current ones move)');
  // two enemies in the band see each other (the spatial hash covers z < 0)
  const a = sim.spawn(0, 0, 30, -30, -1), e = sim.spawn(1, 0, 31, -30, -1);
  const hp0 = a.hp + e.hp;
  for (let i = 0; i < 60; i++) sim.step(undefined);
  console.log(`  sim: two enemies at z −30 trade hits: hp ${hp0} → ${a.hp + e.hp}`);
  if (!(a.hp + e.hp < hp0)) bad('units in the city band do not fight');
}
if (process.argv.includes('--json')) console.log(JSON.stringify({ sites: CITY_SITES.map(s => ({ ...s, rect: rects.get(s.key) })), points: CITY_POINTS, blocks: plan.blocks.map(b => [r1(b.x), r1(b.z), +b.ry.toFixed(2), b.kind, b.s]) }));
console.log(fails.length ? `${fails.length} problem(s)` : 'city layout OK');
if (fails.length) process.exitCode = 1;
