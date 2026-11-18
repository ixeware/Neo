// Admin commands (Cmd k: 'adm'): the op list and one pure validator shared by the sim (Sim.apply),
// the network layer (src/net/shared.ts, src/net/adminChannel.ts) and any server that relays them.
// Everything that arrives is untrusted: unknown ops, wrong types, out-of-range sides, unit types,
// card ids, point indices and event keys make the whole command invalid (null); counts, money,
// floors, radii and coordinates are clamped. This file imports only ./defs, so a server (e.g. a
// Vercel function) can import normAdm / validAdmCmd to check a command before it relays it.
//
// ---- wire format ------------------------------------------------------------------------------
// A full command, as it travels between clients:
//   { t, id, p, k: 'adm', op, ...fields }
//   t   integer tick ≥ 0 at which every client applies it (Session.submit stamps tick + lead)
//   id  string, 1..96 chars, unique (Session.submit: `${pid}:${Date.now() base36}:${seq base36}`)
//   p   string, 0..96 chars: the author's player id (not trusted for anything)
//   k   'adm'
// The body a panel hands to an AdminChannel is the same without t / id / p (AdmBody below).
// Fields an op does not list are ignored. s is always a number, never a string.
//
//   op          fields (required unless marked ?)            bounds / effect
//   money       s 0|1, v number                               v truncated, clamped −1 000 000..1 000 000; bank = clamp(money + v, 0, 10 000 000)
//   moneySet    s 0|1, v number                               v truncated, clamped 0..10 000 000
//   spawn       s 0|1, u int, n? number, x? z? number         u 0..17 except 5 (the boss); n truncated, clamped 1..50 (default 1);
//                                                             x and z together (finite, rounded to 0.01) or the side's high-rise;
//                                                             the sim keeps the 150-unit cap and one hero per side
//   boss        s 0|1                                         calls the side's boss (none while one is out)
//   kill        s -1|0|1, x? z? number, r? number              -1 = both sides; with x, z: only within r (rounded to 0.1, clamped 1..60, default 8)
//   heal        s 0|1
//   freeze      s 0|1, v 0|1                                  stored in State.adm.frz
//   god         s 0|1, v 0|1                                  stored in State.adm.god
//   floors      s 0|1, v number                               truncated, clamped 0..99, then to the side's max floors (6 / 8)
//   repair      s 0|1
//   found4      —                                             Атаги find the 4th floor now
//   heroCd      s? -1|0|1 (default -1)                        hero cooldowns to 0
//   heroBack    —                                             heroes come back from «пары»
//   owner       n int 2..64, s -1|0|1                         point index (an existing village / place / Донер Бей; 0, 1 are the high-rises)
//   vote        s 0|1                                         opens a сход now
//   card        s 0|1, n int 0..33                            applies card n for side s now
//   event       key 'jam'|'blackout'|'classes'|'sale'|'cancel'|'friday'|'flood'
//   endEvents   —
//   win         s 0|1                                         the winner: the loser's high-rise falls (normal victory → newWar flow)
//   newWar      —
//   score       —                                             wins 0:0
//   reset       v number                                      new seed (truncated to int32): war №1, score 0:0, admin toggles cleared
//   diff        v int 0..2                                    AI difficulty
//   ai          s 0|1, v int 0..2                             0 auto, 1 always AI, 2 never AI (State.adm.ai)
//   bgive       s 0|1, u int, v? int 1..3, x? z? number       a finished building of type u (index in BUILDINGS), level v (default 1): free,
//                                                             ignores zone / caps / tier; x and z together (its nav cell) or the first free
//                                                             spot of the side's zone
//   bkill       s -1|0|1, x? z? number, r? number              removes buildings (no bounty); with x, z: only within r (as kill)
//   bheal       s 0|1                                         every building of the side: full hp, construction finished
//   say         txt string                                    control/format characters → space, whitespace collapsed, trimmed,
//                                                             1..140 code points (empty after cleaning → invalid); FxEv 'adminSay'
//
// A relay should accept a command only when validAdmCmd(cmd) is true, and may forward it as is
// (every client normalises it again with normAdm in Sim.apply).
import { UNITS, CARDS, EVENTS, BOSS, BUILDINGS } from './defs';

export const ADM_OPS = [
  'money', 'moneySet', // s, v: add v / set to v
  'spawn', 'boss', 'kill', 'heal', 'freeze', 'god', // units
  'floors', 'repair', 'found4', // high-rises
  'heroCd', 'heroBack', // heroes
  'owner', // points
  'vote', 'card', // сход
  'event', 'endEvents', // world events
  'win', 'newWar', 'score', 'reset', // war
  'diff', 'ai', // AI
  'bgive', 'bkill', 'bheal', // base buildings (src/sim/bld.ts)
  'say', // announcement (FxEv 'adminSay')
] as const;
export type AdmOp = typeof ADM_OPS[number];

/** A validated admin command body. Fields not used by an op are absent. */
export interface Adm {
  op: AdmOp;
  /** Side: 0 / 1; -1 = both (kill, heroCd) or «ничьё» (owner). */
  s: -1 | 0 | 1;
  /** Amount (money), floors, on/off (freeze, god), mode (ai: 0 auto, 1 always AI, 2 never), difficulty, seed (reset), building level (bgive). */
  v: number;
  /** Count (spawn), card id (card), point index (owner). */
  n: number;
  /** Unit type (spawn), building type (bgive). */
  u: number;
  /** Optional map point (spawn, kill in a radius): NaN when absent. */
  x: number; z: number; r: number;
  key: string;
  txt: string;
}

/** What a panel hands to an AdminChannel: a command without t / id / p. */
export type AdmBody = { k: 'adm'; op: AdmOp; s?: number; v?: number; n?: number; u?: number; x?: number; z?: number; r?: number; key?: string; txt?: string };

export const ADM_MAX = { money: 1_000_000, bank: 10_000_000, spawn: 50, radius: 60, say: 140 };

const OPS = new Set<string>(ADM_OPS);
const EVENT_KEYS = new Set(EVENTS.map(e => e.key));
/** Amounts and counts: any finite number, truncated. */
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
/** Ids, indices and modes: integers only (2.5 is not a card). */
const idx = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const side01 = (v: unknown): 0 | 1 | null => (v === 0 || v === 1 ? v : null);
const side3 = (v: unknown): -1 | 0 | 1 | null => (v === -1 || v === 0 || v === 1 ? v : null);
// control, format and bidi characters never reach the screen
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;

/** Announcement text as it may be shown: plain, one line, at most 140 characters (by code point). */
export function cleanSay(t: unknown): string {
  if (typeof t !== 'string') return '';
  const s = t.slice(0, 2000).replace(CTRL, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, ADM_MAX.say).join('').trim();
}

/** Validates an admin command body (with or without t/id/p). Returns null when it must be ignored. */
export function normAdm(c: unknown): Adm | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  if (o.k !== undefined && o.k !== 'adm') return null;
  if (typeof o.op !== 'string' || !OPS.has(o.op)) return null;
  const op = o.op as AdmOp;
  const a: Adm = { op, s: 0, v: 0, n: 0, u: 0, x: NaN, z: NaN, r: NaN, key: '', txt: '' };
  const pt = () => {
    const x = typeof o.x === 'number' && Number.isFinite(o.x) ? o.x : NaN;
    const z = typeof o.z === 'number' && Number.isFinite(o.z) ? o.z : NaN;
    if (!Number.isNaN(x) && !Number.isNaN(z)) { a.x = Math.round(x * 100) / 100; a.z = Math.round(z * 100) / 100; }
  };
  switch (op) {
    case 'money': case 'moneySet': {
      const s = side01(o.s), v = int(o.v);
      if (s === null || v === null) return null;
      a.s = s; a.v = op === 'money' ? clamp(v, -ADM_MAX.money, ADM_MAX.money) : clamp(v, 0, ADM_MAX.bank);
      return a;
    }
    case 'spawn': {
      const s = side01(o.s), u = idx(o.u), n = int(o.n);
      if (s === null || u === null || u < 0 || u >= UNITS.length || u === BOSS) return null;
      a.s = s; a.u = u; a.n = clamp(n ?? 1, 1, ADM_MAX.spawn);
      pt();
      return a;
    }
    case 'bgive': {
      const s = side01(o.s), u = idx(o.u), v = idx(o.v ?? 1);
      if (s === null || u === null || u < 0 || u >= BUILDINGS.length || v === null || v < 1 || v > 3) return null;
      a.s = s; a.u = u; a.v = v;
      pt();
      return a;
    }
    case 'kill': case 'bkill': {
      const s = side3(o.s);
      if (s === null) return null;
      a.s = s; pt();
      if (!Number.isNaN(a.x)) { const r = typeof o.r === 'number' && Number.isFinite(o.r) ? o.r : 8; a.r = clamp(Math.round(r * 10) / 10, 1, ADM_MAX.radius); }
      return a;
    }
    case 'boss': case 'heal': case 'repair': case 'vote': case 'win': case 'bheal': {
      const s = side01(o.s);
      if (s === null) return null;
      a.s = s;
      return a;
    }
    case 'freeze': case 'god': {
      const s = side01(o.s), v = idx(o.v);
      if (s === null || (v !== 0 && v !== 1)) return null;
      a.s = s; a.v = v;
      return a;
    }
    case 'ai': {
      const s = side01(o.s), v = idx(o.v);
      if (s === null || v === null || v < 0 || v > 2) return null;
      a.s = s; a.v = v;
      return a;
    }
    case 'floors': {
      const s = side01(o.s), v = int(o.v);
      if (s === null || v === null) return null;
      a.s = s; a.v = clamp(v, 0, 99); // the sim clamps to HQ.maxFloors[s]
      return a;
    }
    case 'heroCd': {
      const s = side3(o.s ?? -1);
      if (s === null) return null;
      a.s = s;
      return a;
    }
    case 'owner': {
      const n = idx(o.n), s = side3(o.s);
      if (n === null || n < 2 || n > 64 || s === null) return null; // pts 0..1 are the high-rises; the sim checks the upper bound
      a.n = n; a.s = s;
      return a;
    }
    case 'card': {
      const s = side01(o.s), n = idx(o.n);
      if (s === null || n === null || n < 0 || n >= CARDS.length) return null;
      a.s = s; a.n = n;
      return a;
    }
    case 'event': {
      if (typeof o.key !== 'string' || !EVENT_KEYS.has(o.key)) return null;
      a.key = o.key;
      return a;
    }
    case 'diff': {
      const v = idx(o.v);
      if (v === null || v < 0 || v > 2) return null;
      a.v = v;
      return a;
    }
    case 'reset': {
      const v = int(o.v);
      if (v === null) return null;
      a.v = v | 0;
      return a;
    }
    case 'say': {
      const t = cleanSay(o.txt);
      if (!t) return null;
      a.txt = t;
      return a;
    }
    case 'found4': case 'heroBack': case 'endEvents': case 'newWar': case 'score':
      return a;
  }
  return null;
}

/**
 * A full admin command off the wire (adm/{uid}, room topic 'adm', a server relay): the common
 * fields (integer t ≥ 0, id 1..96 chars, p ≤ 96 chars, k 'adm'), then the op's own shape.
 */
export function validAdmCmd(c: unknown): boolean {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (o.k !== 'adm') return false;
  if (typeof o.t !== 'number' || !Number.isInteger(o.t) || o.t < 0) return false;
  if (typeof o.id !== 'string' || o.id.length < 1 || o.id.length > 96 || typeof o.p !== 'string' || o.p.length > 96) return false;
  return normAdm(o) !== null;
}
