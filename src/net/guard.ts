// What the shared wars accept from other clients, as pure functions (tools/simtest.ts checks them).
// Everything that arrives over the network is untrusted:
//   - a command must be its sender's own (bound): p is the identity the platform vouches for
//     (the doc id of ev/{uid} / adm/{uid}, a room message's `by`) and the id lives in that id space;
//   - a player id is never a prototype key (okPid, src/sim/sim.ts);
//   - a world state (a checkpoint) must have the shape of a State, load, migrate and run in a
//     throwaway Sim before anyone resets to it (checkState), and when it replaces a world this client
//     computed itself, the difference must be explainable without admin commands (explained);
//   - which checkpoint counts is decided by who vouches for it (decide / verdicts): an editor's
//     attestation (adm/{uid}, a path only editors can write), else a strict majority of distinct
//     players; one lone voice is enough only for a client that has no world of its own yet.
import { Sim, hashState, okPid, type State } from '../sim/sim';
import { UNITS } from '../sim/defs';
import type { Terrain } from '../world/terrain';

export { okPid };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** The command is `sender`'s own: p is the vouched-for sender and the id is in its id space (`${p}:…`). */
export function bound(c: unknown, sender: unknown): boolean {
  if (!c || typeof c !== 'object' || !okPid(sender)) return false;
  const o = c as { p?: unknown; id?: unknown };
  return o.p === sender && typeof o.id === 'string' && o.id.length <= 200 && o.id.startsWith(sender + ':');
}

// ---- world state --------------------------------------------------------------------------------------
const fin = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown, lo: number, hi: number): boolean => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const sideOrNone = (v: unknown) => v === -1 || v === 0 || v === 1;
/** Optional numeric fields: absent (migrate fills it) or a finite number. */
const optFin = (o: Record<string, unknown>, keys: readonly string[]) => keys.every(k => o[k] === undefined || fin(o[k]));
const finArr = (v: unknown, max: number) => Array.isArray(v) && v.length <= max && v.every(fin);
const objArr = (v: unknown, max: number, each: (o: Record<string, unknown>) => boolean) =>
  v === undefined || (Array.isArray(v) && v.length <= max && v.every(x => obj(x) && each(x)));

const U_REQ = ['x', 'z', 'hp', 'mhp'] as const;
const U_OPT = ['cd', 'tg', 'g', 'rt', 'slow', 'stun', 'own', 'mv', 'ab', 'hit', 'born', 'psn', 'tt', 'tn', 'ld', 'f', 'fr'] as const;
const SIDE_NUM = [
  'money', 'floors', 'hq', 'focus', 'focusUntil', 'spd', 'dmgB', 'inc', 'regen', 'cars', 'n', 'black', 'wins', 'boss', 'bossCd',
  'lastHuman', 'aiNext', 'turretCd', 'found4', 'kills', 'deployed', 'income', 'hack', 'poor', 'weak', 'sauce', 'sauceM', 'dodge',
  'immune', 'skip', 'aiWant', 'aiWantUntil', 'snus', 'loop', 'pack', 'golem',
] as const;
/** JSON text of a checkpoint state above this is refused (the db keeps documents ≤ 256 KiB). */
export const MAX_STATE_CHARS = 250_000;

/** The shape of a State (fields other tracks add later are let through; the trial run judges them). Reason or null. */
export function stateShape(raw: unknown): string | null {
  if (!obj(raw)) return 'not an object';
  const st = raw;
  if (st.v !== 1) return 'version';
  if (!int(st.tick, 0, 2 ** 31) || !int(st.era, 1, 1e9) || !fin(st.seed) || !int(st.rng, -(2 ** 31), 2 ** 32) || !int(st.nextId, 1, 2 ** 31)) return 'header';
  if (!sideOrNone(st.winner) || !sideOrNone(st.humanSide) || !int(st.diff, 0, 2) || !fin(st.mp) || !fin(st.nextVote) || !fin(st.nextMilitia) || !fin(st.overAt)) return 'header';
  const ids = new Set<number>();
  if (!Array.isArray(st.units) || st.units.length > 4000) return 'units';
  for (const u of st.units) {
    if (!obj(u) || !int(u.id, 1, 2 ** 31) || (u.s !== 0 && u.s !== 1) || !int(u.t, 0, UNITS.length - 1) || ids.has(u.id as number)) return 'unit';
    if (!U_REQ.every(k => fin(u[k])) || !optFin(u, U_OPT) || (u.o !== undefined && !obj(u.o))) return 'unit';
    ids.add(u.id as number);
  }
  if (!objArr(st.proj, 20_000, p => ['x', 'z', 'tx', 'tz', 'dmg', 'sp', 'at'].every(k => fin(p[k])) && (p.s === 0 || p.s === 1))) return 'proj';
  if (!Array.isArray(st.pts) || st.pts.length < 9 || st.pts.length > 64) return 'pts';
  for (const p of st.pts) if (!obj(p) || !fin(p.x) || !fin(p.z) || !fin(p.r) || !fin(p.prog) || !sideOrNone(p.owner) || !sideOrNone(p.side) || !int(p.kind, 0, 9)) return 'pt';
  if (!Array.isArray(st.sides) || st.sides.length !== 2) return 'sides';
  for (const sd of st.sides) {
    if (!obj(sd) || !fin(sd.money) || !fin(sd.floors) || !fin(sd.hq) || !optFin(sd, SIDE_NUM)) return 'side';
    if (!finArr(sd.hero, 256) || !finArr(sd.heroCd, 256)) return 'side';
  }
  if (!Array.isArray(st.votes) || st.votes.length !== 2) return 'votes';
  for (const v of st.votes) {
    if (!obj(v) || !fin(v.open) || !fin(v.start) || !fin(v.end) || !finArr(v.opts, 64) || !finArr(v.npc, 64) || !finArr(v.npcAt, 64) || !obj(v.ballots)) return 'vote';
    for (const k of Object.keys(v.ballots)) if (!okPid(k) || !fin(v.ballots[k])) return 'ballot';
  }
  if (!obj(st.players) || Object.getPrototypeOf(st.players) !== Object.prototype) return 'players';
  const keys = Object.keys(st.players);
  if (keys.length > 4096) return 'players';
  for (const k of keys) {
    const p = st.players[k];
    if (!okPid(k) || !obj(p) || (p.s !== 0 && p.s !== 1) || !int(p.n, 0, 1e6) || !fin(p.cd) || !fin(p.joined) || !fin(p.last)) return 'player';
  }
  if (!objArr(st.aoe, 4000, a => ['x', 'z', 'r', 'dmg', 'at', 'n', 'every'].every(k => fin(a[k])))) return 'aoe';
  if (!objArr(st.away, 400, a => int(a.t, 0, UNITS.length - 1) && ['hp', 'mhp', 'back'].every(k => fin(a[k])))) return 'away';
  if (!objArr(st.packs, 400, a => ['x', 'z', 'r', 'at', 'until'].every(k => fin(a[k])))) return 'packs';
  if (st.ev !== undefined && !obj(st.ev)) return 'ev';
  if (st.adm !== undefined && !obj(st.adm)) return 'adm';
  return null;
}

/**
 * A checkpoint state another client handed us, before anything resets to it: the shape, the size,
 * then a throwaway Sim must load (migrate) it and run 20 ticks without throwing or producing a
 * non-finite number (the test the admin panel's «Загрузить сохранение» uses). `hash`: when given,
 * hashState(raw) must equal it. Returns null when it is fine, else a short reason. Never throws.
 */
export function checkState(raw: unknown, terrain: Terrain, hash?: number): string | null {
  try {
    const why = stateShape(raw);
    if (why) return why;
    const text = JSON.stringify(raw);
    if (text.length > MAX_STATE_CHARS) return 'size';
    if (text.includes('null')) return 'null'; // NaN / Infinity came through as null
    if (hash !== undefined && hashState(raw as State) !== hash) return 'hash';
    const t = new Sim(terrain);
    t.quiet = true;
    t.load(JSON.parse(text) as State);
    for (let i = 0; i < 20; i++) t.step(undefined);
    t.fx.length = 0;
    const after = JSON.stringify(t.st);
    if (!Number.isFinite(hashState(t.st)) || after.includes('null')) return 'run';
    return null;
  } catch {
    return 'throws';
  }
}

/** JSON.parse that never throws (null on garbage). */
export function parseState(text: unknown): unknown {
  if (typeof text !== 'string' || text.length > MAX_STATE_CHARS) return null;
  try { return JSON.parse(text); } catch { return null; }
}

const admNorm = (a: unknown) => {
  const o = obj(a) ? a : {};
  const pair = (v: unknown) => (Array.isArray(v) ? [Number(v[0]) || 0, Number(v[1]) || 0] : [0, 0]);
  return JSON.stringify([pair(o.frz), pair(o.god), pair(o.ai)]);
};
/** Money a side may gain over `dt` ticks without an admin command (income, bounties, cards, steal): very generous. */
export const moneyBound = (dt: number) => 2000 + 30 * Math.max(0, dt);

/**
 * Could `cand` be the same war as `ref` (this client's own world) with commands this client missed?
 * Both at the same tick (or cand later). `dt`: ticks since the two last agreed (bounds the drift);
 * `adm`: an admin command was issued since then (anything goes). Null = plausible, else the reason:
 * admin toggles that changed with no admin command, a side's money jumping, floors appearing, the
 * score or the war number going back.
 */
export function explained(ref: State, cand: State, dt: number, adm: boolean): string | null {
  if (adm) return null;
  if (cand.tick < ref.tick) return 'tick';
  if (cand.era < ref.era) return 'era';
  for (const s of [0, 1] as const) if (cand.sides[s].wins < ref.sides[s].wins || cand.sides[s].wins > ref.sides[s].wins + (cand.era - ref.era) + 1) return 'wins';
  if (admNorm(cand.adm) !== admNorm(ref.adm)) return 'adm';
  if (cand.era !== ref.era) return null; // a new war: fresh sides on both
  for (const s of [0, 1] as const) {
    const a = ref.sides[s], b = cand.sides[s];
    if (b.money - a.money > moneyBound(dt + cand.tick - ref.tick)) return 'money';
    if (b.floors > a.floors + 1 + Math.floor((dt + cand.tick - ref.tick) / 300)) return 'floors';
  }
  return null;
}

// ---- who vouches for a checkpoint ----------------------------------------------------------------------
/** One writer's statement: "my world had hash h at tick t". editor: it came from adm/{uid} (editors only). */
export interface Claim { uid: string; h: number; editor?: boolean }
export interface Verdict {
  h: number;
  /** editor: an editor vouches (editors outrank everyone); majority: more than half of the distinct writers; alone: the only writer. */
  why: 'editor' | 'majority' | 'alone';
  /** writers for h, writers at this tick */
  n: number; of: number;
}

/**
 * Which hash at one tick counts. `me`: this client's own hash there (it votes too). Each uid counts
 * once (an editor claim wins over the same uid's ordinary one). Editors first: the hash most editors
 * agree on (a tie among editors falls back to everyone); else a strict majority of every writer;
 * a single writer is 'alone'. A tie (1:1, 2:2, …) is no verdict at all.
 */
export function decide(claims: readonly Claim[], me?: Claim): Verdict | null {
  const by = new Map<string, Claim>();
  for (const c of claims) {
    if (!c || !okPid(c.uid) || !Number.isInteger(c.h)) continue;
    const cur = by.get(c.uid);
    if (!cur || (c.editor && !cur.editor)) by.set(c.uid, c);
  }
  if (me && okPid(me.uid) && Number.isInteger(me.h)) by.set(me.uid, { ...me, editor: me.editor || by.get(me.uid)?.editor });
  const all = [...by.values()];
  if (!all.length) return null;
  const top = (list: Claim[]) => {
    const n = new Map<number, number>();
    for (const c of list) n.set(c.h, (n.get(c.h) ?? 0) + 1);
    let best: [number, number] | null = null, tie = false;
    for (const [h, k] of n) { if (!best || k > best[1]) { best = [h, k]; tie = false; } else if (k === best[1]) tie = true; }
    return { best: best!, tie };
  };
  const eds = all.filter(c => c.editor);
  if (eds.length) {
    const e = top(eds);
    if (!e.tie) return { h: e.best[0], why: 'editor', n: all.filter(c => c.h === e.best[0]).length, of: all.length };
  }
  const t = top(all);
  if (all.length === 1) return { h: t.best[0], why: 'alone', n: 1, of: 1 };
  if (t.best[1] * 2 > all.length) return { h: t.best[0], why: 'majority', n: t.best[1], of: all.length };
  return null;
}

/** One writer's attestations (ticks → hashes), as kept in ev/{uid} or adm/{uid}. */
export interface Writer { uid: string; editor: boolean; hv: readonly { t: number; h: number }[] }

/**
 * Every tick some writer attested, newest first, with its verdict (null when undecided). A late
 * joiner takes the newest decided tick it can fetch a checkpoint for; an undecided newest tick makes
 * it fall back to an older one where they still agreed (and replay the commands after it).
 */
export function verdicts(writers: readonly Writer[]): { t: number; v: Verdict | null; claims: Claim[] }[] {
  const at = new Map<number, Claim[]>();
  for (const w of writers) for (const a of w.hv) {
    if (!a || !Number.isInteger(a.t) || !Number.isInteger(a.h)) continue;
    let l = at.get(a.t);
    if (!l) at.set(a.t, (l = []));
    l.push({ uid: w.uid, h: a.h, editor: w.editor });
  }
  return [...at.keys()].sort((a, b) => b - a).map(t => ({ t, v: decide(at.get(t)!), claims: at.get(t)! }));
}

/** Attestations from a db document: [{ t, h }] with integer ticks and 32-bit hashes, newest last, at most `max`. */
export function cleanHv(v: Any, max = 16): { t: number; h: number }[] {
  if (!Array.isArray(v)) return [];
  const out: { t: number; h: number }[] = [];
  for (const a of v.slice(-max)) if (obj(a) && int(a.t, 0, 2 ** 31) && int(a.h, 0, 2 ** 32 - 1)) out.push({ t: a.t as number, h: a.h as number });
  return out;
}
