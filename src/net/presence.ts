// Who is online and doing what («кто есть кто»), behind one small interface so every transport
// can feed the roster panel and the «<ник> ведёт» tags the same way:
//   local    LocalPresence below: just this browser (name from prefs, else «Ты»);
//   artifact the shared war of the claude.ai artifact (src/net/shared.ts): room presence + onPeers;
//   vercel   the self-hosted online war: its Backend sets `presence` (src/net/session.ts Backend.presence)
//            to a PresenceSource with these same shapes — nothing else in the game changes.
// main.ts takes session.backend.presence when there is one, else a LocalPresence.
// Presence is display data only: names are untrusted strings (shown with textContent), and who
// drives which unit is decided by the sim (U.o), never by presence.

export interface RosterEntry {
  /** Player id: the Session pid (the key of State.players), so sim player numbers map to entries. */
  pid: string;
  /** Display name (a nickname the player typed, or a platform name); '' when unknown. */
  name: string;
  /** The side they play, -1 = watching / in the menu. */
  side: 0 | 1 | -1;
  /** Unit id they drive (possessed), if any. */
  ctl?: number;
  /** How many units they have selected. */
  sel?: number;
  /** This browser. */
  me?: boolean;
}

export interface PresenceSource {
  /** Calls back with the whole roster now (soon) and on every change; returns the unsubscribe. */
  onRoster(cb: (list: RosterEntry[]) => void): () => void;
  /** Merges into this player's own entry (name, side, ctl, sel); `ctl: undefined` clears it. */
  setPresence(p: Partial<RosterEntry>): void;
}

/** The longest nickname anyone sees; control and invisible characters are dropped. */
export const NICK_MAX = 20;
export function cleanNick(v: unknown): string {
  if (typeof v !== 'string') return '';
  // control, bidi and invisible characters out (by code point, so no exotic literal in the source)
  const bad = (c: number) => c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0xad || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2060 && c <= 0x206f) || c === 0xfeff;
  const s = Array.from(v).filter(ch => !bad(ch.codePointAt(0)!)).join('').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, NICK_MAX).join('');
}

/** A roster entry from untrusted data (room presence, a server message): null when it is not one. */
export function rosterEntry(pid: unknown, o: Record<string, unknown> | null | undefined, me = false): RosterEntry | null {
  if (typeof pid !== 'string' || !pid || pid.length > 200 || !o || typeof o !== 'object') return null;
  const side = o.side === 0 || o.side === 1 ? o.side : -1;
  const e: RosterEntry = { pid, name: cleanNick(o.name ?? o.nick), side };
  if (Number.isInteger(o.ctl) && (o.ctl as number) > 0) e.ctl = o.ctl as number;
  if (Number.isInteger(o.sel) && (o.sel as number) > 0) e.sel = Math.min(9999, o.sel as number);
  if (me) e.me = true;
  return e;
}

/** Just this browser. */
export class LocalPresence implements PresenceSource {
  private me: RosterEntry;
  private cbs = new Set<(list: RosterEntry[]) => void>();
  private queued = false;
  constructor(pid: string, name: string, side: 0 | 1 | -1 = -1) { this.me = { pid, name: cleanNick(name), side, me: true }; }
  onRoster(cb: (list: RosterEntry[]) => void) {
    this.cbs.add(cb);
    queueMicrotask(() => { if (this.cbs.has(cb)) cb([{ ...this.me }]); });
    return () => { this.cbs.delete(cb); };
  }
  setPresence(p: Partial<RosterEntry>) {
    const m = this.me;
    if ('name' in p) m.name = cleanNick(p.name);
    if (p.side === 0 || p.side === 1 || p.side === -1) m.side = p.side;
    if ('ctl' in p) { if (p.ctl) m.ctl = p.ctl; else delete m.ctl; }
    if ('sel' in p) { if (p.sel) m.sel = p.sel; else delete m.sel; }
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; for (const cb of this.cbs) cb([{ ...this.me }]); });
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
/**
 * The artifact runtime's room (claude.use('room')): this player's fields (name, sel, ctl, pid) are
 * merged into the tab's room presence; the roster is everyone the room lists (people, not agents),
 * one entry per player id (`by`, else the pid they put in presence), names from what they typed,
 * else from `user.profiles()` when the artifact grants names.
 */
export function roomPresence(room: Any, pid: string, user: Any = null): PresenceSource {
  const cbs = new Set<(list: RosterEntry[]) => void>();
  const names = new Map<string, string>(), asked = new Set<string>();
  let last: RosterEntry[] = [];
  const build = (peers: readonly Any[]): RosterEntry[] => {
    const out = new Map<string, RosterEntry>();
    for (const p of peers ?? []) {
      if (!p || (p.kind && p.kind !== 'viewer')) continue;
      const pr = (p.presence && typeof p.presence === 'object' ? p.presence : {}) as Record<string, unknown>;
      const id = typeof p.by === 'string' && p.by ? p.by : typeof pr.pid === 'string' && pr.pid ? pr.pid : 'peer:' + String(p.peer);
      const e = rosterEntry(id, pr, !!p.isMe);
      if (!e) continue;
      if (!e.name) e.name = names.get(id) ?? '';
      const old = out.get(id);
      if (!old || p.sameTab || (e.ctl && !old.ctl)) out.set(id, e);
    }
    return [...out.values()];
  };
  const emit = () => { for (const cb of cbs) cb(last.map(e => ({ ...e }))); };
  const resolve = () => {
    if (!user || typeof user.profiles !== 'function') return;
    const ids = last.filter(e => !e.name && !e.pid.startsWith('peer:') && !asked.has(e.pid)).map(e => e.pid);
    if (!ids.length) return;
    ids.forEach(i => asked.add(i));
    Promise.resolve(user.profiles(ids)).then((ps: Any) => {
      let any = false;
      for (const i of ids) { const n = cleanNick(ps?.[i]?.name); if (n) { names.set(i, n); any = true; } }
      if (any) { last = last.map(e => (!e.name && names.has(e.pid) ? { ...e, name: names.get(e.pid)! } : e)); emit(); }
    }).catch(() => { /* no names granted */ });
  };
  try {
    room.onPeers((ch: Any) => { last = build(ch?.peers ?? []); emit(); resolve(); }, () => { /* room gone: keep the last roster */ });
  } catch { /* no room */ }
  return {
    onRoster(cb) {
      cbs.add(cb);
      queueMicrotask(() => { if (cbs.has(cb)) cb(last.map(e => ({ ...e }))); });
      return () => { cbs.delete(cb); };
    },
    setPresence(p) {
      const patch: Record<string, unknown> = { pid };
      if ('name' in p) patch.name = cleanNick(p.name) || null;
      if ('ctl' in p) patch.ctl = p.ctl && Number.isInteger(p.ctl) ? p.ctl : null;
      if ('sel' in p) patch.sel = p.sel && Number.isInteger(p.sel) ? p.sel : null;
      if (p.side === 0 || p.side === 1) patch.side = p.side;
      Promise.resolve().then(() => room.presence(patch)).catch(() => { /* offline or over budget: the next change re-sends */ });
    },
  };
}
