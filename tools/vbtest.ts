// Multi-client test of the Vercel backend: real Sims and Sessions in this process, talking to
// tools/devserver.mjs (same api/ handlers, in-memory Redis, two hubs = two function instances) through
// the real client transport src/net/vercel.ts. Checks: join/deploy/vote/admin propagate; hashes agree at
// every checkpoint (≥ 20); a late joiner catches up; reconnects; forged pid / cfg / adm / tokens are
// refused and nobody applies them; the HTTP fallback; a lying keeper is outvoted; the sleeping world
// resumes from the checkpoint tick; Redis command counts per minute (cost model).
//   npx tsx tools/vbtest.ts [port=5243] [checkpoints=20]
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { loadTerrain } from '../src/world/terrain';
import { Sim, hashState, type Cmd } from '../src/sim/sim';
import { UNITS } from '../src/sim/defs';
import type { Session } from '../src/net/session';
import { connectVercel, vercelAdminChannel, type VercelWar, type RosterEntry } from '../src/net/vercel';
// @ts-expect-error plain JS module
import { startDevServer } from './devserver.mjs';

const PORT = Number(process.argv[2] || 5243);
const WANT_CPS = Number(process.argv[3] || 20);
const CP_EVERY = 1500;
const PASS_FILE = '/tmp/claude-0/-home-user-Neo/2cf9b09d-ec36-5575-aa5a-ad87bc5d21e8/scratchpad/admin/.pass';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const fails: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  if (!ok) { fails.push(label); process.exitCode = 1; }
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
}

const terrain = await loadTerrain();

let pidSeq = 0;
interface Client { name: string; war: VercelWar; sim: Sim; session: Session; timer: ReturnType<typeof setInterval>; roster: RosterEntry[] }

async function client(name: string, base: string, side: 0 | 1, opts: { http?: boolean } = {}): Promise<Client> {
  const pid = 'p' + (++pidSeq) + Math.random().toString(36).slice(2, 8);
  const war = await connectVercel(pid, base);
  if (!war) throw new Error('no backend');
  war.nick = name;
  war.forceHttp = !!opts.http;
  const sim = new Sim(terrain);
  sim.init(1);
  sim.quiet = true;
  const session = await war.join(sim, side);
  if (!session) throw new Error(name + ' could not join: ' + war.joinError);
  const c: Client = { name, war, sim, session, roster: [], timer: setInterval(() => { session.advance(30); war.tick(session); sim.quiet = true; }, 20) };
  war.onRoster(l => { c.roster = l; });
  return c;
}

function stop(c: Client) { clearInterval(c.timer); c.war.leave(); }

/** Ticks (multiples of 10) both sessions still hold a snapshot for, and whether the states agree there. */
function compare(a: Client, b: Client): { n: number; bad: number[] } {
  const lo = Math.max(a.sim.st.tick, b.sim.st.tick) - 380, hi = Math.min(a.sim.st.tick, b.sim.st.tick);
  let n = 0; const bad: number[] = [];
  for (let t = Math.ceil(lo / 10) * 10; t <= hi; t += 10) {
    const x = a.session.snapAt(t), y = b.session.snapAt(t);
    if (!x || !y) continue;
    n++;
    if (hashState(x) !== hashState(y)) bad.push(t);
  }
  return { n, bad };
}

/** A unit this side may deploy now, and where. */
function findDeploy(c: Client, side: 0 | 1): { u: number; x: number; z: number } | null {
  const sim = c.sim, pl = sim.st.players[c.war.pid];
  const hq = sim.st.pts[side];
  for (let u = 0; u < UNITS.length; u++) {
    for (let r = 4; r < 30; r += 3) for (let a = 0; a < 8; a++) {
      const x = Math.round((hq.x + Math.cos(a) * r) * 100) / 100, z = Math.round((hq.z + Math.sin(a) * r) * 100) / 100;
      if (!sim.canDeploy(side, u, x, z, pl)) return { u, x, z };
    }
  }
  return null;
}

async function waitFor(label: string, fn: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(100); }
  console.log(`  (timed out waiting for ${label})`);
  return false;
}

/** A raw WebSocket client (no transport logic) that says hello and records what it gets. */
async function raw(url: string, pid: string, dk: string) {
  const ws = new WebSocket(url.replace(/^http/, 'ws') + '/api/ws');
  const got: Record<string, unknown>[] = [];
  await new Promise<void>((ok, fail) => { ws.onopen = () => ok(); ws.onerror = () => fail(new Error('ws')); });
  ws.onmessage = e => { try { got.push(JSON.parse(String(e.data))); } catch { /* binary */ } };
  ws.send(JSON.stringify({ type: 'hello', pid, dk, name: 'Злодей', side: 0 }));
  await waitFor('raw state', () => got.some(m => m.type === 'state'), 8000);
  const st = got.find(m => m.type === 'state') as { clock: { tick0: number; wall0: number; gen: number }; now: number; keeper: boolean } | undefined;
  const off = st ? st.now - Date.now() : 0;
  return {
    ws, got, st,
    tick: () => st ? st.clock.tick0 + Math.floor((Date.now() + off - st.clock.wall0) / 100) : 0,
    send: (m: unknown) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    naks: (why: string) => got.filter(m => m.type === 'nak' && m.why === why).length,
  };
}

const hexKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

// =====================================================================================================
console.log(`\n== phase A: two instances, checkpoint every ${CP_EVERY} ms ==`);
let dev = await startDevServer({ port: PORT, instances: 2, test: true, cpEvery: CP_EVERY, quiet: true });
const base = dev.url;
const A = await client('Аслан', base, 0);
const B = await client('Бекхан', base, 1);
check('first joiner is the keeper', A.war.keeper && !B.war.keeper, `A ${A.war.keeper} B ${B.war.keeper}`);
check('both on different instances', dev.hubs[0].size === 1 && dev.hubs[1].size === 1, dev.hubs.map((h: { size: number }) => h.size).join('/'));
await waitFor('joins', () => !!A.sim.st.players[B.war.pid] && !!B.sim.st.players[A.war.pid], 12_000);
check('join propagates both ways (across instances)', !!A.sim.st.players[B.war.pid] && !!B.sim.st.players[A.war.pid]);

// deploys
const dA = findDeploy(A, 0), dB = findDeploy(B, 1);
check('found deploy spots', !!dA && !!dB);
if (dA) A.session.submit({ k: 'dep', s: 0, ...dA });
if (dB) B.session.submit({ k: 'dep', s: 1, ...dB });
await waitFor('deploys', () => A.sim.st.sides[1].deployed >= 1 && B.sim.st.sides[0].deployed >= 1, 8000);
check('deploys propagate', A.sim.st.sides[0].deployed >= 1 && A.sim.st.sides[1].deployed >= 1 && B.sim.st.sides[0].deployed >= 1 && B.sim.st.sides[1].deployed >= 1,
  `A ${A.sim.st.sides[0].deployed}/${A.sim.st.sides[1].deployed} B ${B.sim.st.sides[0].deployed}/${B.sim.st.sides[1].deployed}`);

// admin: refused without a login, accepted with one
const pass = readFileSync(PASS_FILE, 'utf8').trim();
const chA = vercelAdminChannel(A.war);
let refused = '';
chA.onRefused = why => { refused = why; };
check('admin check says login needed', (await chA.check()) !== null);
chA.send({ op: 'god', s: 1, v: 1 });
check('admin command without login is refused locally', refused !== '' && !A.session.allCmds().some(c => c.k === 'adm'), refused);
check('wrong password refused', (await chA.login!('definitely-wrong')) === 'Неверный пароль');
check('right password accepted', (await chA.login!(pass)) === null);
check('admin check passes after login', (await chA.check()) === null);
chA.send({ op: 'vote', s: 0 });
chA.send({ op: 'god', s: 1, v: 1 });
await waitFor('adm', () => [A, B].every(c => c.sim.st.adm?.god?.[1] === 1 && c.sim.st.votes[0].open === 1), 8000);
check('admin commands reach everyone', [A, B].every(c => c.sim.st.adm?.god?.[1] === 1), [A, B].map(c => c.sim.st.adm?.god?.[1]).join('/'));
check('admin vote opened a сход everywhere', [A, B].every(c => !!c.sim.st.votes[0].open));
// votes
A.session.submit({ k: 'vote', s: 0, o: 1 });
await waitFor('ballot', () => B.sim.st.votes[0].ballots[A.war.pid] === 1, 6000);
check('vote propagates', B.sim.st.votes[0].ballots[A.war.pid] === 1);

// roster + presence
A.war.setPresence({ sel: 12, ctl: 7 });
await waitFor('roster', () => B.roster.some(e => e.pid === A.war.pid && e.sel === 12 && e.ctl === 7) && B.roster.length === 2, 12_000);
check('roster: both players, presence crosses instances', B.roster.length === 2 && B.roster.some(e => e.name === 'Аслан' && e.sel === 12 && e.ctl === 7), JSON.stringify(B.roster));
const players = await (await fetch(base + '/api/players')).json();
check('GET /api/players lists the roster', players.roster?.length === 2 && players.online?.[0] === 1 && players.online?.[1] === 1, JSON.stringify(players.online));

// late joiner (instance 0 again), forged traffic, reconnect, HTTP fallback — while checkpoints accumulate
await sleep(6000);
const C = await client('Цока', base, 0);
await waitFor('C catches up', () => Math.abs(C.sim.st.tick - A.sim.st.tick) < 5, 15_000);
check('late joiner catches up from cp + log', Math.abs(C.sim.st.tick - A.sim.st.tick) < 5, `A ${A.sim.st.tick} C ${C.sim.st.tick} cp ${C.war.admin.debug().cpTick}`);

// forged traffic from a raw socket
const D = await raw(base, 'pdevil' + Math.random().toString(36).slice(2, 6), hexKey());
const now = D.tick();
const fakeDep = (extra: Record<string, unknown>) => ({ type: 'cmd', c: { t: now + 8, id: 'pdevil:forge:' + Math.random(), k: 'dep', s: 0, u: 0, x: 1, z: 1, ...extra } });
D.send(fakeDep({ id: A.war.pid + ':forge:1' })); // someone else's id space
D.send({ type: 'cmd', c: { t: now + 8, id: 'x:forge:cfg', k: 'cfg', d: 2, hs: 0, mp: 0 } });
const myId = (s: string) => (D.st as unknown as { pid: string }).pid + ':forge:' + s;
D.send(fakeDep({ id: myId('pid'), p: A.war.pid })); // someone else's pid
D.send({ type: 'cmd', c: { t: now + 8, id: myId('cfg'), k: 'cfg', d: 2, hs: 0, mp: 0 } });
D.send({ type: 'cmd', c: { t: now + 8, id: myId('adm'), k: 'adm', op: 'money', s: 0, v: 999999 } });
D.send({ type: 'adm', tok: 'v1.forged.sig', c: { t: now + 30, id: myId('adm2'), k: 'adm', op: 'money', s: 0, v: 999999 } });
// a real token with its expiry pushed forward (signature no longer matches)
const loginR = await (await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pass }) })).json();
const [v1, body, sig] = String(loginR.token).split('.');
const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
const tampered = `${v1}.${Buffer.from(JSON.stringify({ ...claims, exp: claims.exp + 86400e3 })).toString('base64url')}.${sig}`;
D.send({ type: 'adm', tok: tampered, c: { t: now + 30, id: myId('adm3'), k: 'adm', op: 'money', s: 0, v: 999999 } });
// an expired token signed with the right secret (as if replayed after 12 h)
const secret = process.env.ADMIN_TOKEN_SECRET!;
const oldBody = 'v1.' + Buffer.from(JSON.stringify({ sub: 'admin', iat: 1, exp: Date.now() - 1000, n: 'aa' })).toString('base64url');
const expired = oldBody + '.' + createHmac('sha256', secret).update(oldBody).digest('base64url');
D.send({ type: 'adm', tok: expired, c: { t: now + 30, id: myId('adm4'), k: 'adm', op: 'money', s: 0, v: 999999 } });
// a valid token but a malformed admin body (unknown op, NaN-ish, prototype keys)
D.send({ type: 'adm', tok: loginR.token, c: { t: now + 30, id: myId('adm5'), k: 'adm', op: 'nuke', s: 0 } });
D.send(`{"type":"adm","tok":"${loginR.token}","c":{"t":${now + 30},"id":"${myId('adm6')}","k":"adm","op":"money","s":0,"v":1e999}}`);
D.send(`{"type":"cmd","c":{"t":${now + 8},"id":"${myId('proto')}","k":"dep","s":0,"u":0,"x":1,"z":1,"__proto__":{"polluted":1}}}`);
D.send({ type: 'cmd', c: { t: now + 8, id: myId('big'), k: 'dep', s: 0, u: 0, x: 1, z: 1, pad: 'x'.repeat(5000) } });
D.send({ type: 'cmd', c: { t: now + 900, id: myId('future'), k: 'dep', s: 0, u: 0, x: 1, z: 1 } });
D.send({ type: 'cp', tick: now - 100, hash: 1, gen: 1, era: 1, wins: [0, 0], s: '{"tick":' + (now - 100) + '}' });
D.send('not json at all');
for (let i = 0; i < 80; i++) D.send({ type: 'cmd', c: {} });
await sleep(2500);
const naks = (why: string) => D.naks(why);
check('forged id space refused', naks('id') >= 1);
check('forged pid refused', naks('pid') >= 1);
check('cfg and adm-as-cmd refused', naks('kind') >= 2, String(naks('kind')));
check('forged / tampered / expired tokens refused', naks('token') >= 3, String(naks('token')));
check('valid token, malformed admin body refused', D.got.filter(m => m.type === 'nak' && m.adm && m.why === 'shape').length >= 2);
check('oversized message refused', naks('size') >= 1);
check('far-future tick refused', naks('tick') >= 1);
check('checkpoint from a non-keeper refused', D.got.some(m => m.type === 'nak' && m.what === 'cp' && m.why === 'keeper'));
check('flood rate-limited', naks('rate') >= 10, String(naks('rate')));
check('prototype keys do not pollute', ({} as Record<string, unknown>).polluted === undefined);
await sleep(1500);
const leaked = [A, B, C].flatMap(c => c.session.allCmds().filter(x => x.id.includes('forge') && x.k !== 'dep'));
const leakedDep = [A, B, C].flatMap(c => c.session.allCmds().filter(x => x.id.includes('forge') && x.p === A.war.pid));
check('nobody got a forged cfg / adm / pid', leaked.length === 0 && leakedDep.length === 0, JSON.stringify(leaked.slice(0, 2)));
check('forged money never applied', [A, B, C].every(c => c.sim.st.sides[0].money < 900000));
const protoCmd = A.session.allCmds().find(x => x.id === myId('proto')) as Record<string, unknown> | undefined;
check('accepted command is rebuilt from known fields', !protoCmd || Object.keys(protoCmd).sort().join() === 'id,k,p,s,t,u,x,z', protoCmd ? Object.keys(protoCmd).join() : 'not relayed');
D.ws.close();

// reconnect: drop B's socket under it
const reB = B.war.stats.reconnects;
(B.war as unknown as { link: { ws: WebSocket } }).link.ws.close();
await waitFor('B reconnects', () => B.war.stats.reconnects > reB && B.war.stats.states >= 2, 10_000);
check('reconnect resumes (state after reconnect)', B.war.stats.reconnects > reB, `states ${B.war.stats.states}`);
const dB2 = findDeploy(B, 1);
await sleep(500);
const depBefore = A.sim.st.sides[1].deployed;
if (dB2) B.session.submit({ k: 'dep', s: 1, ...dB2 });
await waitFor('deploy after reconnect', () => A.sim.st.sides[1].deployed > depBefore, 8000);
check('commands flow after reconnect', A.sim.st.sides[1].deployed > depBefore);

// HTTP fallback client
const F = await client('Фаиз', base, 1, { http: true });
console.log(`  info F joined at tick ${F.sim.st.tick} (A ${A.sim.st.tick})`);
check('HTTP fallback joins', !!F.session && (F.war as unknown as { link: { kind: string } }).link.kind === 'http');
await waitFor('F caught up and joined', () => !!F.sim.st.players[A.war.pid] && !!F.sim.st.players[F.war.pid] && !F.session.catchingUp, 12_000);
const dF = findDeploy(F, 1);
const depA = A.sim.st.sides[1].deployed;
if (dF) F.session.submit({ k: 'dep', s: 1, ...dF });
await waitFor('F deploy reaches A', () => A.sim.st.sides[1].deployed > depA, 10_000);
check('HTTP fallback commands reach WebSocket clients', A.sim.st.sides[1].deployed > depA);

// checkpoints: every non-keeper compares its own hash with each checkpoint
const t0 = Date.now();
await waitFor(`${WANT_CPS} checkpoints`, () => B.war.stats.cpOk >= WANT_CPS && C.war.stats.cpOk >= WANT_CPS / 2, (WANT_CPS + 10) * CP_EVERY);
const keeperName = [A, B, C, F].find(c => c.war.keeper)?.name;
check(`≥ ${WANT_CPS} checkpoints with identical hashes`, B.war.stats.cpOk >= WANT_CPS && [A, B, C, F].every(c => c.war.stats.cpBad === 0),
  [A, B, C, F].map(c => `${c.name}: ok ${c.war.stats.cpOk} bad ${c.war.stats.cpBad}${c.war.badAt.length ? ' [' + c.war.badAt.join(' ') + ']' : ''} resync ${c.war.stats.resyncs} naks ${c.war.stats.naks}`).join(', ') + ` keeper ${keeperName} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
for (const [x, y] of [[A, B], [A, C], [B, C], [A, F]] as const) {
  const r = compare(x, y);
  check(`${x.name} = ${y.name} at every common snapshot`, r.n > 5 && r.bad.length === 0, `${r.n} ticks, bad ${r.bad.slice(0, 5).join(',')}`);
}

// cost: Redis commands over 30 s of steady play with 4 clients
const s0 = await (await fetch(base + '/__test/stats')).json();
const tc = Date.now();
for (let i = 0; i < 15; i++) {
  for (const c of [A, B]) { const d = findDeploy(c, c === A ? 0 : 1); if (d) c.session.submit({ k: 'dep', s: c === A ? 0 : 1, ...d }); }
  await sleep(2000);
}
const s1 = await (await fetch(base + '/__test/stats')).json();
const perMin = (s1.redis.count - s0.redis.count) / ((Date.now() - tc) / 60000);
const by: Record<string, number> = {};
for (const k of Object.keys(s1.redis.byCmd)) by[k] = s1.redis.byCmd[k] - (s0.redis.byCmd[k] ?? 0);
console.log(`  info Redis commands/min (2 instances, 3 WS + 1 HTTP client, cp every ${CP_EVERY} ms, a deploy/s): ${perMin.toFixed(0)} ${JSON.stringify(by)}`);

for (const c of [A, B, C, F]) stop(c);
await sleep(800);
await dev.close();

// =====================================================================================================
console.log('\n== phase B: one instance — lying keeper, sleeping world ==');
dev = await startDevServer({ port: PORT, instances: 1, test: true, cpEvery: CP_EVERY, quiet: true });
const L = await raw(dev.url, 'pliar' + Math.random().toString(36).slice(2, 6), hexKey());
check('the liar holds the lease', !!L.st?.keeper);
const A2 = await client('Ася', dev.url, 0);
const B2 = await client('Бета', dev.url, 1);
await sleep(9000);
const T = Math.floor((L.tick() - 80) / 10) * 10;
L.send({ type: 'cp', tick: T, hash: 123456, gen: L.st!.clock.gen, era: 1, wins: [0, 0], s: JSON.stringify({ v: 1, tick: T, units: [] }) });
await waitFor('outvoted', () => L.got.some(m => m.type === 'nak' && m.why === 'outvoted'), 5000);
check('lying keeper outvoted', L.got.some(m => m.type === 'nak' && m.why === 'outvoted'));
check('a truthful client became keeper', A2.war.keeper || B2.war.keeper);
check('nobody adopted the lie', A2.war.stats.resyncs === 0 && B2.war.stats.resyncs === 0, `resyncs ${A2.war.stats.resyncs}/${B2.war.stats.resyncs}`);
await waitFor('honest cp', () => A2.war.stats.cpOk + B2.war.stats.cpOk >= 2, 8000);
check('the new keeper\'s checkpoints are accepted and match', A2.war.stats.cpOk + B2.war.stats.cpOk >= 2 && A2.war.stats.cpBad + B2.war.stats.cpBad === 0);
L.ws.close();

// sleeping world: everyone leaves; the keeper leaves a final checkpoint; 100 s pass with nobody there
const dA2 = findDeploy(A2, 0);
if (dA2) A2.session.submit({ k: 'dep', s: 0, ...dA2 });
await sleep(1500);
const keeperC = A2.war.keeper ? A2 : B2;
const lastTick = keeperC.sim.st.tick;
const genBefore = keeperC.war.admin.debug().gen;
stop(A2); stop(B2);
await sleep(1500);
const cpAfterLeave = await (await fetch(dev.url + '/api/players')).json();
dev.time.off += 100_000;
const E = await client('Эли', dev.url, 0);
const dbg = E.war.admin.debug();
check('wake: new clock generation', dbg.gen === genBefore + 1, `gen ${genBefore} → ${dbg.gen}`);
check('wake: continues from the checkpoint tick, no catch-up of the sleep', E.sim.st.tick <= lastTick + 30 && E.sim.st.tick >= dbg.cpTick, `left at ${lastTick}, cp ${dbg.cpTick}, now ${E.sim.st.tick}`);
await sleep(3000);
check('wake: the world keeps running', E.sim.st.tick > dbg.cpTick && E.sim.st.tick < dbg.cpTick + 60, `tick ${E.sim.st.tick}`);
await waitFor('E passes the old tail', () => E.sim.st.tick > lastTick + 5, 15_000);
check('wake: the tail after the checkpoint replays (deploy kept)', E.sim.st.sides[0].deployed >= 1, `deployed ${E.sim.st.sides[0].deployed} at tick ${E.sim.st.tick}, era ${cpAfterLeave.era}`);
stop(E);
await sleep(500);
await dev.close();

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nall backend checks passed');
process.exit(fails.length ? 1 : 0);
