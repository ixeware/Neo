/// <reference types="node" />
// What the server accepts from a client. The server stamps the player id itself, so a client can only
// ever speak for the pid it proved with its device key at hello. Every accepted command is rebuilt
// from whitelisted fields (no prototype keys, no extra payload).
import { WIN_AHEAD, WIN_BACK, type Cmd, type RosterEntry } from './world.js';
import { validAdmCmd } from './admcheck.js';

/** Max size of one client message, except a keeper's checkpoint. */
export const MAX_MSG = 4096;
/** Max size of a checkpoint's state payload (gzip+base64 or raw JSON). */
export const MAX_CP = 256 * 1024;
/** Max size of a whole checkpoint message (payload + meta). */
export const MAX_CP_MSG = MAX_CP + 2048;
/** Max size of an admin command (as JSON). */
export const MAX_ADM = 2048;
/** Per-connection rate limit: RATE messages/s sustained, BURST at once. */
export const RATE = 20, BURST = 40;

/** Keys that reach an object's prototype ('__proto__', 'constructor', 'toString', …): never a player id. */
const PROTO_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype).concat('__proto__', 'prototype'));
/** A player id: 3..32 of [A-Za-z0-9_-], never a prototype key (ids key objects on the server and in every client's sim). */
export const validPid = (p: unknown): p is string => typeof p === 'string' && /^[A-Za-z0-9_-]{3,32}$/.test(p) && !PROTO_KEYS.has(p);
export const validKey = (k: unknown): k is string => typeof k === 'string' && /^[a-f0-9]{32,64}$/.test(k);

// eslint-disable-next-line no-control-regex
const NAME_BAD = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb<>&"'`\\]/g;
/** Nickname: plain text, no control, bidi or markup characters, at most 24 code points. */
export function cleanName(s: unknown): string {
  if (typeof s !== 'string') return '';
  const t = s.slice(0, 200).normalize('NFC').replace(NAME_BAD, '').replace(/\s+/g, ' ').trim();
  return Array.from(t).slice(0, 24).join('').trim();
}

const side = (v: unknown): v is 0 | 1 => v === 0 || v === 1;
const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const coord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10000;
const UNIT_ID = 2 ** 31 - 1;
/** src/sim/sim.ts ORD_MAX and OrdMode. */
export const ORD_MAX = 64;
const ORD_MODES = new Set(['auto', 'move', 'attack', 'attackMove', 'hold', 'possessed']);

/**
 * Fields each kind may carry besides t / id / p / k (src/sim/sim.ts Cmd). A command with any other
 * field is refused, not stripped: the sender applies its own copy at once, so the copy everyone else
 * gets must be the very same object or the worlds drift apart. A new field in the sim needs a line here.
 */
const FIELDS: Record<string, readonly string[]> = {
  join: ['s'],
  dep: ['s', 'u', 'x', 'z'],
  vote: ['s', 'o'],
  ord: ['s', 'ids', 'm', 'x', 'z', 'tg', 'fi', 'fn'],
  ctl: ['s', 'u', 'dx', 'dz', 'atk', 'fx', 'fz', 'rel'],
  adm: ['op', 's', 'v', 'n', 'u', 'x', 'z', 'r', 'key', 'txt'],
};
const BASE = new Set(['t', 'id', 'p', 'k']);

export type Checked = { ok: true; c: Cmd } | { ok: false; why: string };

function common(c: Record<string, unknown>, pid: string): string | null {
  if (typeof c.id !== 'string' || c.id.length > 96 || !c.id.startsWith(pid + ':')) return 'id';
  if (c.p !== undefined && c.p !== pid) return 'pid';
  if (!Number.isInteger(c.t) || (c.t as number) < 0) return 'shape';
  const allow = FIELDS[c.k as string];
  if (allow) for (const f of Object.keys(c)) if (!BASE.has(f) && !allow.includes(f)) return 'shape';
  return null;
}

const inWindow = (t: number, now: number) => t >= now - WIN_BACK && t <= now + WIN_AHEAD;

/**
 * Validate one ordinary command from `pid` against the server tick. Kinds: join, dep, vote, and the
 * unit-control commands ord / ctl (src/sim/sim.ts: orders for a side's units, first-person driving;
 * the sim checks ownership, sides and modes again). 'adm' goes through checkAdm with a token; 'cfg'
 * never comes from the network. Commands outside [now − WIN_BACK, now + WIN_AHEAD] are rejected (the
 * client takes them back and resyncs). The accepted command is rebuilt from its own fields only.
 */
export function checkCmd(raw: unknown, pid: string, now: number): Checked {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, why: 'shape' };
  const c = raw as Record<string, unknown>;
  if (typeof c.k !== 'string' || !FIELDS[c.k] || c.k === 'adm') return { ok: false, why: 'kind' }; // 'cfg', 'adm' (needs a token), unknown
  const bad = common(c, pid);
  if (bad) return { ok: false, why: bad };
  const t = c.t as number, id = c.id as string;
  let out: Cmd;
  switch (c.k) {
    case 'join':
      if (!side(c.s)) return { ok: false, why: 'shape' };
      out = { t, id, p: pid, k: 'join', s: c.s };
      break;
    case 'dep':
      if (!side(c.s) || !int(c.u, 0, 255) || !coord(c.x) || !coord(c.z)) return { ok: false, why: 'shape' };
      out = { t, id, p: pid, k: 'dep', s: c.s, u: c.u, x: c.x, z: c.z };
      break;
    case 'vote':
      if (!side(c.s) || !int(c.o, 0, 31)) return { ok: false, why: 'shape' };
      out = { t, id, p: pid, k: 'vote', s: c.s, o: c.o };
      break;
    case 'ord': {
      // { s, ids: 1..ORD_MAX unit ids, m: OrdMode, x?, z? (move), tg? (attack), fi?, fn? (formation slots) }
      const ids = c.ids;
      if (!side(c.s) || !Array.isArray(ids) || ids.length < 1 || ids.length > ORD_MAX || !ids.every(v => int(v, 0, UNIT_ID))) return { ok: false, why: 'shape' };
      if (typeof c.m !== 'string' || !ORD_MODES.has(c.m)) return { ok: false, why: 'shape' };
      if ((c.x !== undefined && !coord(c.x)) || (c.z !== undefined && !coord(c.z)) || (c.tg !== undefined && !int(c.tg, 0, UNIT_ID))) return { ok: false, why: 'shape' };
      if ((c.fi !== undefined && !int(c.fi, 0, 1023)) || (c.fn !== undefined && !int(c.fn, 1, 1024))) return { ok: false, why: 'shape' };
      out = { t, id, p: pid, k: 'ord', s: c.s, ids: [...(ids as number[])], m: c.m };
      for (const f of ['x', 'z', 'tg', 'fi', 'fn'] as const) if (c[f] !== undefined) out[f] = c[f];
      break;
    }
    case 'ctl': {
      // { s, u: unit id, dx, dz: −8..8 (stick), atk: 0|1, fx?, fz?: −8..8 (facing, both or neither), rel?: 1 }
      if (!side(c.s) || !int(c.u, 0, UNIT_ID) || !int(c.dx, -8, 8) || !int(c.dz, -8, 8) || !(c.atk === 0 || c.atk === 1) || !(c.rel === undefined || c.rel === 1)) return { ok: false, why: 'shape' };
      if ((c.fx === undefined) !== (c.fz === undefined) || (c.fx !== undefined && (!int(c.fx, -8, 8) || !int(c.fz, -8, 8)))) return { ok: false, why: 'shape' };
      out = { t, id, p: pid, k: 'ctl', s: c.s, u: c.u, dx: c.dx, dz: c.dz, atk: c.atk };
      if (c.fx !== undefined) { out.fx = c.fx; out.fz = c.fz; }
      if (c.rel === 1) out.rel = 1;
      break;
    }
    default:
      return { ok: false, why: 'kind' };
  }
  if (!inWindow(t, now)) return { ok: false, why: 'tick' };
  return { ok: true, c: out };
}

const ADM_FIELDS_N = ['s', 'v', 'n', 'u', 'x', 'z', 'r'] as const;
/**
 * An admin command (the caller has verified the token). Shape only, as src/sim/admin.ts defines it:
 * k 'adm', op a known op (≤ 24 chars), numeric fields finite and within ±1e9, key/txt strings,
 * total JSON ≤ 2 KB, then the sim's own validAdmCmd. Rebuilt from those fields only.
 */
export function checkAdm(raw: unknown, pid: string, now: number): Checked {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, why: 'shape' };
  const c = raw as Record<string, unknown>;
  const bad = common(c, pid);
  if (bad) return { ok: false, why: bad };
  if (c.k !== 'adm' || typeof c.op !== 'string' || c.op.length > 24) return { ok: false, why: 'shape' };
  const out: Cmd = { t: c.t as number, id: c.id as string, p: pid, k: 'adm', op: c.op };
  for (const f of ADM_FIELDS_N) {
    const v = c[f];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e9) return { ok: false, why: 'shape' };
    out[f] = v;
  }
  for (const f of ['key', 'txt'] as const) {
    const v = c[f];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.length > 600) return { ok: false, why: 'shape' };
    out[f] = v;
  }
  if (JSON.stringify(out).length > MAX_ADM) return { ok: false, why: 'size' };
  if (!validAdmCmd(out)) return { ok: false, why: 'shape' };
  if (!inWindow(out.t, now)) return { ok: false, why: 'tick' };
  return { ok: true, c: out };
}

/** Token bucket per connection. */
export class Bucket {
  private tokens = BURST;
  private at = Date.now();
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(BURST, this.tokens + ((now - this.at) / 1000) * RATE);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export interface CpIn { tick: number; hash: number; gen: number; era: number; wins: [number, number]; z?: string; s?: string }

/** Shape of a keeper's checkpoint upload (the server cannot verify the state itself: clients vote on the hash). */
export function checkCp(raw: unknown): CpIn | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (!int(m.tick, 0, 2 ** 40) || !int(m.hash, 0, 2 ** 32 - 1) || !int(m.gen, 1, 2 ** 31) || !int(m.era, 0, 1e9)) return null;
  const w = m.wins;
  if (!Array.isArray(w) || w.length !== 2 || !int(w[0], 0, 1e9) || !int(w[1], 0, 1e9)) return null;
  const z = typeof m.z === 'string' ? m.z : undefined, s = typeof m.s === 'string' ? m.s : undefined;
  if ((z === undefined) === (s === undefined)) return null;
  const body = (z ?? s)!;
  if (body.length > MAX_CP || body.length < 2) return null;
  if (z !== undefined && !/^[A-Za-z0-9+/]+={0,2}$/.test(z)) return null;
  if (s !== undefined) { try { const j = JSON.parse(s); if (!j || typeof j !== 'object' || j.tick !== m.tick) return null; } catch { return null; } }
  return { tick: m.tick as number, hash: m.hash as number, gen: m.gen as number, era: m.era as number, wins: [w[0] as number, w[1] as number], z, s };
}

/** A presence patch from a client: name, side, unit in first person (null clears), selection size. */
export function cleanPres(raw: unknown, cur: RosterEntry): RosterEntry {
  const out: RosterEntry = { ...cur };
  if (!raw || typeof raw !== 'object') return out;
  const m = raw as Record<string, unknown>;
  if (m.name !== undefined) { const n = cleanName(m.name); if (n) out.name = n; }
  if (m.side === -1 || m.side === 0 || m.side === 1) out.side = m.side;
  if (m.ctl === null || m.ctl === -1 || m.ctl === 0) delete out.ctl; // unit ids start at 1
  else if (int(m.ctl, 1, UNIT_ID)) out.ctl = m.ctl;
  if (m.sel === null || m.sel === 0) delete out.sel;
  else if (int(m.sel, 1, 9999)) out.sel = m.sel;
  return out;
}
