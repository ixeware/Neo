/// <reference types="node" />
// Joining (or rejoining) the war: the same for a WebSocket hello and an HTTP-fallback poll.
import type { Redis } from './redis.js';
import { time } from './time.js';
import { cleanName, validKey, validPid } from './proto.js';
import {
  CP_EVERY_MS, K, ensureWorld, entryCmds, idBefore, idCmp, isId, keyHash, readLog, readState, stateFrom, tryLease,
  type Clock, type Cmd, type CpBlob, type Entry, type World,
} from './world.js';

export interface HelloIn { pid: unknown; dk: unknown; name?: unknown; side?: unknown; since?: unknown; gen?: unknown }

export interface StateOut {
  type: 'state';
  /** true: reset to `cp` (or the genesis Sim.init(clock.seed) when null) and replay `cmds`; false: `cmds` is the delta since the client's `since`. */
  full: boolean;
  pid: string;
  /** Server time (ms) when this was sent: clients correct their clock offset with it. */
  now: number;
  clock: Clock; cp: CpBlob | null; cmds: Cmd[];
  /** Last log id covered: resume from here after a reconnect. */
  last: string;
  keeper: boolean; cpEvery: number;
}

export type HelloResult =
  | { ok: true; st: StateOut; w: World; event: 'none' | 'new' | 'wake'; name: string; side: -1 | 0 | 1 }
  | { ok: false; why: string };

/**
 * Check the device key, register the player and read what the client needs. `extra`: commands this
 * instance accepted but has not written to the log yet (they are added to the reply).
 */
export async function hello(r: Redis, inst: string, h: HelloIn, wantLease: boolean, extra: Cmd[] = []): Promise<HelloResult> {
  if (!validPid(h.pid)) return { ok: false, why: 'pid' };
  if (!validKey(h.dk)) return { ok: false, why: 'key' };
  const pid = h.pid;
  const { w, event } = await ensureWorld(r, inst);
  const kh = keyHash(h.dk);
  const rec = w.players[pid];
  if (rec && rec.kh && rec.kh !== kh) return { ok: false, why: 'owner' }; // someone else's id
  const name = cleanName(h.name) || rec?.name || 'Пацан';
  const side: -1 | 0 | 1 = h.side === 0 || h.side === 1 ? h.side : rec?.side === 0 || rec?.side === 1 ? (rec.side as 0 | 1) : -1;
  const now = time.now();
  await r.cmd('HSET', K.w, 'alive', now, 'p:' + pid, JSON.stringify({ name, side, last: now, kh }));
  w.alive = now;
  w.players[pid] = { name, side, last: now, kh };
  const st = await stateFor(r, w, pid, event === 'none' ? h : {}, extra);
  st.keeper = wantLease ? await tryLease(r, pid) : false;
  return { ok: true, w, event, name, side, st };
}

/** The delta since `since` when it is still valid for this generation, else the full state. */
export async function stateFor(r: Redis, w: World, pid: string, h: { since?: unknown; gen?: unknown }, extra: Cmd[] = []): Promise<StateOut> {
  const clock = w.clock!;
  const from = stateFrom(w);
  const resume = isId(h.since) && h.gen === clock.gen && idCmp(h.since, idBefore(from)) >= 0;
  let cp: CpBlob | null = null, entries: Entry[], cmds: Cmd[];
  if (resume) {
    entries = await readLog(r, h.since as string, 5000);
    cmds = entryCmds(entries);
  } else {
    ({ cp, entries } = await readState(r, from));
    if (cp && (cp.gen > clock.gen || (cp.gen === clock.gen && cp.tick < clock.tick0))) cp = null;
    if (cp && cp.gen < clock.gen && cp.tick !== clock.tick0) cp = null; // a wake re-anchors at the checkpoint tick
    cmds = entryCmds(entries, cp ? cp.tick : clock.tick0);
  }
  const minTick = cp ? cp.tick : clock.tick0;
  for (const c of extra) if (c.t >= minTick) cmds.push(c);
  const last = entries.length ? entries[entries.length - 1].id : resume ? (h.since as string) : idBefore(from);
  return { type: 'state', full: !resume, pid, now: time.now(), clock, cp, cmds, last, keeper: false, cpEvery: CP_EVERY_MS };
}
