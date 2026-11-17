/// <reference types="node" />
// The shared war in Redis. The server never runs the sim: it orders and stores commands, keeps the
// clock and the latest checkpoint, and decides who the keeper is. Keys (all under `vy:`):
//   vy:w        hash   clock (JSON Clock), cpm (JSON CpMeta), alive (ms, any client connected),
//                      p:<pid> (JSON PlayerRec, every player ever seen),
//                      i:<instance> (JSON InstRec: a function instance holding sockets, its roster;
//                      the HTTP fallback writes i:http:<pid>)
//   vy:cp       string latest checkpoint (JSON CpBlob: meta + gzip/base64 or raw state)
//   vy:log      stream entries {i: instance, k: 'c'|'cp'|'clk', d: JSON}; the entry id is the global
//                      sequence ('<ms>-<n>'); trimmed to ~30 s before the latest checkpoint's range
//   vy:keeper   string pid of the checkpoint keeper, PX lease
//   vy:wake     string NX guard while one instance creates / re-anchors the world
//   vy:audit    list   admin actions (newest first, 500 kept)
//   vy:fail:<ip> counter of failed admin logins, PX 10 min
import { createHash, randomInt } from 'node:crypto';
import type { Redis } from './redis.js';
import { time, sleep } from './time.js';

export const K = {
  w: 'vy:w', cp: 'vy:cp', log: 'vy:log', keeper: 'vy:keeper', wake: 'vy:wake', audit: 'vy:audit',
  fail: (ip: string) => 'vy:fail:' + ip,
};

const envNum = (name: string, def: number) => { const v = Number(process.env[name]); return Number.isFinite(v) && v > 0 ? v : def; };

export const TICK_MS = 100;
/** Nobody connected for this long: the world sleeps; the next joiner continues from the checkpoint. */
export const SLEEP_MS = 90_000;
export const LEASE_MS = 60_000;
/** How often the keeper uploads a checkpoint (tests shorten it with VY_CP_EVERY_MS). */
export const CP_EVERY_MS = envNum('VY_CP_EVERY_MS', 15_000);
/** Commands are accepted with t in [now - WIN_BACK, now + WIN_AHEAD] ticks; others are rejected. */
export const WIN_BACK = 300, WIN_AHEAD = 60;
/** An instance record older than this is gone (instances refresh theirs every 5–10 s). */
export const INST_STALE_MS = 25_000;
export const API_VERSION = 'vy-api-2';

/**
 * tick0/wall0: the world is at tick0 at server time wall0, 10 ticks a second. gen: bumped at every
 * re-anchor (wake). seed: genesis seed (Sim.init) when there is no checkpoint. from: first log id of
 * this generation. hold: commands up to this tick were carried over at the wake in the entry `from`.
 */
export interface Clock { tick0: number; wall0: number; gen: number; seed: number; from: string; hold?: number }
export interface CpMeta { tick: number; hash: number; gen: number; era: number; wins: [number, number]; at: number; from: string; by: string }
/** z: base64 of gzip(JSON state); s: raw JSON state. Exactly one is set. */
export interface CpBlob extends CpMeta { z?: string; s?: string }
export interface PlayerRec { name: string; side: number; last: number; kh: string }
/** One roster line: who is connected, for which side, and what they do (unit in first person, selection size). */
export interface RosterEntry { pid: string; name: string; side: -1 | 0 | 1; ctl?: number; sel?: number }
export interface InstRec { at: number; ros: RosterEntry[] }
export interface World { clock: Clock | null; cpm: CpMeta | null; alive: number; players: Record<string, PlayerRec>; inst: Record<string, InstRec> }
export interface Entry { id: string; i: string; k: string; d: unknown }
// Commands are opaque to the server beyond the fields it validates.
export type Cmd = { t: number; id: string; p: string; k: string; [f: string]: unknown };

export const nowTick = (c: Clock, now = time.now()) => c.tick0 + Math.floor((now - c.wall0) / TICK_MS);
export const wallAt = (c: Clock, tick: number) => c.wall0 + (tick - c.tick0) * TICK_MS;
export const idOf = (ms: number) => `${Math.max(0, Math.floor(ms))}-0`;

function idParts(id: string): [number, number] {
  const [a, b] = id.split('-');
  return [Number(a) || 0, Number(b) || 0];
}
export function idCmp(a: string, b: string): number {
  const [am, as] = idParts(a), [bm, bs] = idParts(b);
  return am !== bm ? am - bm : as - bs;
}
/** Smallest id after `id` (XRANGE start, so no exclusive-range syntax is needed). */
export function idNext(id: string): string { const [m, s] = idParts(id); return `${m}-${s + 1}`; }
/** The id just before `id`, so that reading after it includes `id` itself. */
export function idBefore(id: string): string {
  const [ms, seq] = idParts(id);
  return seq > 0 ? `${ms}-${seq - 1}` : `${Math.max(0, ms - 1)}-999999999`;
}
export const idMax = (a: string, b: string) => (idCmp(a, b) >= 0 ? a : b);
export const idMin = (a: string, b: string) => (idCmp(a, b) <= 0 ? a : b);
export const isId = (s: unknown): s is string => typeof s === 'string' && /^\d{1,16}-\d{1,9}$/.test(s);

export const keyHash = (dk: string) => createHash('sha256').update('vysotka-device:' + dk).digest('hex').slice(0, 32);

export function parseJson<T>(s: unknown): T | null {
  if (typeof s !== 'string') return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

export function parseWorld(flat: unknown): World {
  const w: World = { clock: null, cpm: null, alive: 0, players: {}, inst: {} };
  if (!Array.isArray(flat)) return w;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const f = String(flat[i]), v = flat[i + 1];
    if (f === 'clock') w.clock = parseJson<Clock>(v);
    else if (f === 'cpm') w.cpm = parseJson<CpMeta>(v);
    else if (f === 'alive') w.alive = Number(v) || 0;
    else if (f.startsWith('p:')) { const p = parseJson<PlayerRec>(v); if (p) w.players[f.slice(2)] = p; }
    else if (f.startsWith('i:')) { const r = parseJson<InstRec>(v); if (r && Array.isArray(r.ros)) w.inst[f.slice(2)] = r; }
  }
  return w;
}

export async function readWorld(r: Redis): Promise<World> { return parseWorld(await r.cmd('HGETALL', K.w)); }

export function parseEntries(raw: unknown): Entry[] {
  const out: Entry[] = [];
  if (!Array.isArray(raw)) return out;
  for (const e of raw) {
    if (!Array.isArray(e) || typeof e[0] !== 'string' || !Array.isArray(e[1])) continue;
    const f: Record<string, string> = {};
    for (let i = 0; i + 1 < e[1].length; i += 2) f[String(e[1][i])] = String(e[1][i + 1]);
    out.push({ id: e[0], i: f.i ?? '', k: f.k ?? '', d: parseJson(f.d) });
  }
  return out;
}

/** Commands carried by log entries, optionally only those at or after `minTick`. */
export function entryCmds(entries: Entry[], minTick = -Infinity): Cmd[] {
  const out: Cmd[] = [];
  for (const e of entries) if (e.k === 'c' && Array.isArray(e.d)) for (const c of e.d as Cmd[]) if (c && typeof c === 'object' && c.t >= minTick) out.push(c);
  return out;
}

/**
 * Read the world, creating it on first use and re-anchoring the clock when it slept: nobody was
 * connected for SLEEP_MS, so the war continues from the checkpoint tick (no catch-up of the sleep).
 * As in src/net/shared.ts the commands after the checkpoint are kept and replay at their own ticks
 * on the new timeline: they are carried into one fresh log entry and the old log is dropped.
 */
export async function ensureWorld(r: Redis, inst: string): Promise<{ w: World; event: 'none' | 'new' | 'wake' }> {
  let w = await readWorld(r);
  for (let attempt = 0; attempt < 4; attempt++) {
    const now = time.now();
    const asleep = !!w.clock && now - w.alive > SLEEP_MS;
    if (w.clock && !asleep) return { w, event: 'none' };
    if ((await r.cmd('SET', K.wake, inst, 'NX', 'PX', 15000)) === 'OK') {
      try {
        const cur = await readWorld(r); // someone may have finished just before we took the guard
        if (cur.clock && time.now() - cur.alive <= SLEEP_MS) return { w: cur, event: 'none' };
        if (!cur.clock) {
          await r.pipe([['DEL', K.cp, K.log, K.keeper], ['HDEL', K.w, 'cpm']]);
          const clock: Clock = { tick0: 0, wall0: time.now(), gen: 1, seed: randomInt(2 ** 31 - 1), from: '0-0' };
          await r.cmd('HSET', K.w, 'clock', JSON.stringify(clock), 'alive', clock.wall0);
          return { w: { ...cur, clock, cpm: null, alive: clock.wall0 }, event: 'new' };
        }
        const old = cur.clock, cpm = cur.cpm && cur.cpm.gen <= old.gen ? cur.cpm : null;
        const tick0 = cpm ? cpm.tick : 0;
        const tail = entryCmds(await readRange(r, stateFromParts(old, cpm), 5000), tick0);
        const wall0 = time.now();
        const draft: Clock = { tick0, wall0, gen: old.gen + 1, seed: old.seed, from: '0-0' };
        const from = String(await r.cmd('XADD', K.log, '*', 'i', inst, 'k', 'c', 'd', JSON.stringify(tail)));
        const clock: Clock = { ...draft, from, hold: tail.reduce((m, c) => Math.max(m, c.t), tick0) };
        await r.pipe([
          ['XTRIM', K.log, 'MINID', from],
          ['HSET', K.w, 'clock', JSON.stringify(clock), 'alive', wall0],
          ['DEL', K.keeper],
          // tells instances that poll the log that the timeline moved (none should be connected)
          ['XADD', K.log, '*', 'i', inst, 'k', 'clk', 'd', JSON.stringify(clock)],
        ]);
        return { w: { ...cur, clock, cpm, alive: wall0 }, event: 'wake' };
      } finally {
        await r.cmd('DEL', K.wake).catch(() => {});
      }
    }
    await sleep(250 + attempt * 250); // another instance is creating / waking it
    w = await readWorld(r);
  }
  if (!w.clock) throw new Error('world unavailable');
  return { w, event: 'none' };
}

function stateFromParts(clock: Clock, cpm: CpMeta | null): string {
  return cpm && cpm.gen === clock.gen ? idMax(cpm.from, clock.from) : clock.from;
}

/** First log id a joiner needs: every command at or after the checkpoint tick lives at or after it. */
export const stateFrom = (w: World) => stateFromParts(w.clock!, w.cpm);

/** Latest checkpoint plus the log since `from` (commands at or after the checkpoint tick). */
export async function readState(r: Redis, from: string): Promise<{ cp: CpBlob | null; entries: Entry[] }> {
  const [blob, raw] = await r.pipe([['GET', K.cp], ['XRANGE', K.log, from, '+', 'COUNT', 5000]]);
  return { cp: parseJson<CpBlob>(blob), entries: parseEntries(raw) };
}

/** Log entries from `from` (inclusive). */
export async function readRange(r: Redis, from: string, count = 500): Promise<Entry[]> {
  return parseEntries(await r.cmd('XRANGE', K.log, from, '+', 'COUNT', count));
}

/** Log entries after `after` (exclusive), or from the start. */
export async function readLog(r: Redis, after: string | null, count = 500): Promise<Entry[]> {
  return parseEntries(await r.cmd('XRANGE', K.log, after ? idNext(after) : '-', '+', 'COUNT', count));
}

export async function appendCmds(r: Redis, inst: string, cmds: Cmd[]): Promise<string> {
  return String(await r.cmd('XADD', K.log, '*', 'i', inst, 'k', 'c', 'd', JSON.stringify(cmds)));
}

/**
 * Store a checkpoint: the blob, its meta in vy:w (menu + wake), a notice in the log (other
 * instances relay it to their sockets), the trim of commands from more than ~30 s before the new
 * checkpoint's range, and the keeper's lease renewal.
 */
export async function storeCp(r: Redis, inst: string, clock: Clock, blob: CpBlob): Promise<CpMeta> {
  // a command with tick t was accepted while the server tick was >= t - WIN_AHEAD, so its entry was
  // written after wallAt(t - WIN_AHEAD); 100 more ticks cover clock drift between us and Redis
  let from = idMax(idOf(wallAt(clock, blob.tick - WIN_AHEAD - 100)), clock.from);
  if (clock.hold !== undefined && blob.tick <= clock.hold) from = clock.from; // the wake carried older commands
  blob.from = from;
  const meta: CpMeta = { tick: blob.tick, hash: blob.hash, gen: blob.gen, era: blob.era, wins: blob.wins, at: blob.at, from, by: blob.by };
  const trim = idMin(idOf(idParts(from)[0] - 30_000), from);
  await r.pipe([
    ['SET', K.cp, JSON.stringify(blob)],
    ['HSET', K.w, 'cpm', JSON.stringify(meta)],
    ['XADD', K.log, 'MINID', trim, '*', 'i', inst, 'k', 'cp', 'd', JSON.stringify(meta)],
    ['PEXPIRE', K.keeper, LEASE_MS],
  ]);
  return meta;
}

/** Take the keeper lease (or confirm we already hold it). */
export async function tryLease(r: Redis, pid: string): Promise<boolean> {
  if ((await r.cmd('SET', K.keeper, pid, 'NX', 'PX', LEASE_MS)) === 'OK') return true;
  return (await r.cmd('GET', K.keeper)) === pid;
}

/** Still the keeper (re-acquired if the lease lapsed)? false: someone else is the keeper now. */
export async function holdsLease(r: Redis, pid: string): Promise<boolean> {
  const cur = await r.cmd('GET', K.keeper);
  if (cur === null) return (await r.cmd('SET', K.keeper, pid, 'NX', 'PX', LEASE_MS)) === 'OK';
  return cur === pid;
}

export async function releaseLease(r: Redis, pid: string) {
  if ((await r.cmd('GET', K.keeper)) === pid) await r.cmd('DEL', K.keeper);
}

export async function audit(r: Redis, entry: Record<string, unknown>) {
  await r.pipe([['LPUSH', K.audit, JSON.stringify(entry)], ['LTRIM', K.audit, 0, 499]]);
}

/** Everyone connected anywhere (fresh instance records), one line per pid, newest record wins. */
export function rosterOf(w: World, now = time.now(), extra: RosterEntry[] = [], skip = ''): RosterEntry[] {
  const by = new Map<string, { e: RosterEntry; at: number }>();
  for (const [id, rec] of Object.entries(w.inst)) {
    if (id === skip || now - rec.at > INST_STALE_MS) continue;
    for (const e of rec.ros) {
      if (!e || typeof e.pid !== 'string') continue;
      const cur = by.get(e.pid);
      if (!cur || cur.at < rec.at) by.set(e.pid, { e, at: rec.at });
    }
  }
  for (const e of extra) by.set(e.pid, { e, at: Infinity });
  return [...by.values()].map(v => v.e).sort((a, b) => a.side - b.side || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, 64);
}

/** Players seen recently (names only: pid and key hash stay on the server). */
export function recentPlayers(w: World, now = time.now()) {
  return Object.values(w.players)
    .filter(p => now - p.last < 7 * 86400_000)
    .sort((a, b) => b.last - a.last)
    .slice(0, 30)
    .map(p => ({ name: p.name, side: p.side, last: p.last }));
}
