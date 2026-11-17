/// <reference types="node" />
// POST /api/poll: the HTTP fallback for browsers whose WebSocket fails. Stateless: every poll says who
// it is (pid + device key), carries the client's queued messages (cmd, adm, cp, pres, bye) and gets
// back the same server messages a socket would (state / cmds / cp / clk / ack / nak / keeper /
// roster). Commands are written to the log at once and the poller is listed as instance
// i:http:<pid>, so WebSocket instances switch to fast log polling while it is around. ~4 Redis
// commands per poll; the client polls every 1–1.5 s.
import { allow, clientIp, readJson, send, type Req, type Res } from './_lib/http.js';
import { redis } from './_lib/redis.js';
import { verifyToken } from './_lib/admin.js';
import { stateFor } from './_lib/join.js';
import { MAX_CP_MSG, checkAdm, checkCmd, checkCp, cleanName, cleanPres, validKey, validPid } from './_lib/proto.js';
import {
  K, appendCmds, audit, ensureWorld, holdsLease, keyHash, nowTick, parseEntries, idNext, isId, releaseLease, rosterOf,
  storeCp, tryLease, type Cmd, type CpBlob, type RosterEntry,
} from './_lib/world.js';
import { time } from './_lib/time.js';

type Msg = Record<string, unknown>;

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') { send(res, 405, { ok: false }); return; }
  const r = redis();
  if (!r) { send(res, 503, { ok: false, why: 'noredis' }); return; }
  if (!allow('poll:' + clientIp(req), 600)) { send(res, 429, { ok: false, why: 'rate' }); return; }
  const body = await readJson(req, MAX_CP_MSG + 16_384);
  if (!body) { send(res, 400, { ok: false, why: 'shape' }); return; }
  const { pid, dk } = body;
  if (!validPid(pid) || !validKey(dk)) { send(res, 400, { ok: false, why: 'pid' }); return; }
  try {
    const out: Msg[] = [];
    const inst = 'http:' + pid;
    const { w, event } = await ensureWorld(r, inst);
    const clock = w.clock!;
    const kh = keyHash(dk), rec = w.players[pid];
    if (rec && rec.kh && rec.kh !== kh) { send(res, 403, { ok: false, why: 'owner' }); return; }
    const now = time.now(), tick = nowTick(clock, now);
    const name = cleanName(body.name) || rec?.name || 'Пацан';
    let ros: RosterEntry = cleanPres(body.pres, { pid, name, side: body.side === 0 || body.side === 1 ? body.side : -1 });
    const accepted: Cmd[] = [];
    let bye = false;
    const msgs = Array.isArray(body.out) ? (body.out as unknown[]).slice(0, 60) : [];
    for (const raw of msgs) {
      if (!raw || typeof raw !== 'object') continue;
      const m = raw as Msg;
      if (m.type === 'cmd') {
        const ck = checkCmd(m.c, pid, tick);
        if (!ck.ok) { out.push({ type: 'nak', id: idOfMsg(m), why: ck.why }); continue; }
        if (ck.c.k === 'join') ros = { ...ros, side: ck.c.s as 0 | 1 };
        accepted.push(ck.c);
        out.push({ type: 'ack', id: ck.c.id });
      } else if (m.type === 'adm') {
        if (!verifyToken(m.tok)) { out.push({ type: 'nak', id: idOfMsg(m), adm: true, why: 'token' }); continue; }
        const ck = checkAdm(m.c, pid, tick);
        if (!ck.ok) { out.push({ type: 'nak', id: idOfMsg(m), adm: true, why: ck.why }); continue; }
        accepted.push(ck.c);
        out.push({ type: 'ack', id: ck.c.id, adm: true });
        await audit(r, { at: now, pid, op: ck.c.op, t: ck.c.t, c: ck.c, via: 'http' }).catch(() => {});
      } else if (m.type === 'cp') {
        const cp = checkCp(m);
        const cpm = w.cpm;
        if (!cp || cp.gen !== clock.gen || cp.tick > tick || cp.tick < clock.tick0 || (cpm && cpm.gen === clock.gen && cp.tick <= cpm.tick)) { out.push({ type: 'nak', what: 'cp', why: 'shape' }); continue; }
        if (!(await holdsLease(r, pid))) { out.push({ type: 'keeper', on: false }); continue; }
        const blob: CpBlob = { tick: cp.tick, hash: cp.hash, gen: cp.gen, era: cp.era, wins: cp.wins, at: now, from: '', by: pid, ...(cp.z !== undefined ? { z: cp.z } : { s: cp.s }) };
        w.cpm = await storeCp(r, inst, clock, blob);
        out.push({ type: 'ack', what: 'cp', tick: cp.tick });
      } else if (m.type === 'pres') {
        ros = cleanPres(m, ros);
      } else if (m.type === 'bye') {
        bye = true;
      }
    }
    if (accepted.length) await appendCmds(r, inst, accepted);
    const rosField = 'i:' + inst;
    if (bye) await r.pipe([['HDEL', K.w, rosField], ['HSET', K.w, 'alive', now]]);
    else await r.cmd('HSET', K.w, 'alive', now, 'p:' + pid, JSON.stringify({ name: ros.name, side: ros.side, last: now, kh }), rosField, JSON.stringify({ at: now, ros: [ros] }));
    if (bye) { await releaseLease(r, pid); send(res, 200, { ok: true, msgs: out }); return; }

    // what the client has not seen yet
    const since = event === 'none' && isId(body.since) && body.gen === clock.gen ? (body.since as string) : null;
    if (since && !body.full) {
      const entries = parseEntries(await r.cmd('XRANGE', K.log, idNext(since), '+', 'COUNT', 2000));
      const cmds: Cmd[] = [];
      for (const e of entries) {
        if (e.k === 'c' && Array.isArray(e.d)) cmds.push(...(e.d as Cmd[]));
        else if (e.k === 'cp') out.push({ type: 'cp', meta: e.d });
        else if (e.k === 'clk') out.push({ type: 'clk', clock: e.d });
      }
      out.unshift({ type: 'cmds', cmds, last: entries.length ? entries[entries.length - 1].id : since });
    } else {
      const st = await stateFor(r, w, pid, {});
      st.keeper = await tryLease(r, pid);
      out.unshift(st as unknown as Msg);
    }
    if (body.full || !since) { /* keeper already in the state */ } else if (body.keeper !== true && (await r.cmd('GET', K.keeper)) === null && (await tryLease(r, pid))) out.push({ type: 'keeper', on: true });
    out.push({ type: 'roster', list: rosterOf(w, now, [ros]) });
    out.push({ type: 'pong', at: typeof body.at === 'number' ? body.at : 0, now: time.now() });
    send(res, 200, { ok: true, msgs: out });
  } catch (err) {
    console.error('[vy poll]', (err as Error)?.message ?? err);
    send(res, 502, { ok: false, why: 'server' });
  }
}

function idOfMsg(m: Msg): string | null {
  const c = m.c as Msg | undefined;
  return c && typeof c.id === 'string' ? c.id.slice(0, 96) : null;
}
