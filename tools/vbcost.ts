// Measured cost model of the Vercel backend with production settings (checkpoint every 15 s): six
// clients (3 per side) on one or two function instances, about one command a second in total (deploys,
// presence changes), for `secs` seconds after a warm-up. Prints Redis commands per minute by type and
// the extrapolation for ~6 friends playing 2 h a day.
//   npx tsx tools/vbcost.ts [port=5243] [secs=150] [instances=1]
import { loadTerrain } from '../src/world/terrain';
import { Sim } from '../src/sim/sim';
import { UNITS } from '../src/sim/defs';
import { connectVercel } from '../src/net/vercel';
// @ts-expect-error plain JS module
import { startDevServer } from './devserver.mjs';

const PORT = Number(process.argv[2] || 5243), SECS = Number(process.argv[3] || 150), INST = Number(process.argv[4] || 1);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const terrain = await loadTerrain();
const dev = await startDevServer({ port: PORT, instances: INST, test: true, quiet: true });

const clients = [];
for (let i = 0; i < 6; i++) {
  const side = (i % 2) as 0 | 1;
  const war = (await connectVercel('pcost' + i + Math.random().toString(36).slice(2, 6), dev.url))!;
  war.nick = 'Игрок ' + (i + 1);
  const sim = new Sim(terrain); sim.init(1); sim.quiet = true;
  const session = (await war.join(sim, side))!;
  const timer = setInterval(() => { session.advance(30); war.tick(session); sim.quiet = true; }, 20);
  clients.push({ war, sim, session, side, timer });
}
await sleep(20_000);
const stats = async () => (await (await fetch(dev.url + '/__test/stats')).json()) as { redis: { count: number; byCmd: Record<string, number>; bytes: number }; hubs: Record<string, number>[] };
const s0 = await stats();
const t0 = Date.now();
let sent = 0;
while (Date.now() - t0 < SECS * 1000) {
  const c = clients[Math.floor(Math.random() * clients.length)];
  if (Math.random() < 0.6) {
    const pl = c.sim.st.players[c.war.pid], hq = c.sim.st.pts[c.side];
    for (let u = 0; u < UNITS.length; u++) {
      const x = Math.round((hq.x + 6 + Math.random() * 10) * 100) / 100, z = Math.round((hq.z + Math.random() * 10 - 5) * 100) / 100;
      if (!c.sim.canDeploy(c.side, u, x, z, pl)) { c.session.submit({ k: 'dep', s: c.side, u, x, z }); sent++; break; }
    }
  } else c.war.setPresence({ sel: 1 + Math.floor(Math.random() * 20) });
  await sleep(1000);
}
const s1 = await stats();
const min = (Date.now() - t0) / 60000;
const per = (s1.redis.count - s0.redis.count) / min;
const by: Record<string, string> = {};
for (const k of Object.keys(s1.redis.byCmd)) { const d = s1.redis.byCmd[k] - (s0.redis.byCmd[k] ?? 0); if (d) by[k] = (d / min).toFixed(1); }
console.log(`instances ${INST}, 6 clients, ${(sent / min).toFixed(0)} commands/min sent, checkpoint every 15 s`);
console.log(`Redis commands/min: ${per.toFixed(1)}  ${JSON.stringify(by)}`);
console.log(`→ per 2 h session ${(per * 120).toFixed(0)}, per month (30 × 2 h) ${(per * 120 * 30 / 1000).toFixed(0)}k`);
const bpm = (s1.redis.bytes - s0.redis.bytes) / min;
const cp = (dev.mem?.dump().str.get('vy:cp') ?? '') as string;
console.log(`Redis traffic ${(bpm / 1024).toFixed(0)} KB/min → per month (30 × 2 h) ${(bpm * 120 * 30 / 2 ** 30).toFixed(2)} GB; checkpoint blob ${(cp.length / 1024).toFixed(1)} KB, world tick ${clients[0].sim.st.tick}, units ${clients[0].sim.st.units.length}`);
console.log('hubs', JSON.stringify(s1.hubs.map(h => ({ size: h.size, flushes: h.flushes, beats: h.beats, polls: h.polls }))));
console.log('checkpoints ok', clients.map(c => `${c.war.stats.cpOk}/${c.war.stats.cpBad}`).join(' '));
for (const c of clients) { clearInterval(c.timer); c.war.leave(); }
await sleep(800);
await dev.close();
process.exit(0);
