// Shared endless war over the artifact runtime: `db` keeps the command log, the checkpoints and
// who vouches for them; `room` carries commands fast and tells who is online. Every client runs the
// same deterministic sim, so the war is identical everywhere.
//
// Nobody is trusted for more than they can prove (src/net/guard.ts):
//   - Commands. ev/{uid} = { cmds, side, hv, ck, at, era, wins } is written only by {uid} (rule
//     ev/{self}); a command counts only when it is its writer's own (p === uid, id `${uid}:…`). Room
//     messages on 'cmd' count only when the platform's sender stamp `by` equals p. Admin commands
//     (k 'adm') travel only on editor-only channels: adm/{uid} (rule adm: write admin) and the room
//     topic 'adm' (never opened), bound the same way; 'cmd' and ev/{uid} never carry them.
//   - Checkpoints. Every client attests its own world: hv = [{ t, h }], the hash of its snapshot at
//     each tick t that is a multiple of CP_STEP (15 s) once it is CP_AGE ticks old, and keeps the full
//     state of the last two in its own subtree ev/{uid}/cp/{(t / CP_STEP) % 2}. Editors also write
//     their hv into adm/{uid}: an editor's word outranks everyone's. Which hash counts at a tick is
//     decide(): editors, else a strict majority of distinct players. A running client changes its
//     world only when that verdict (editor or majority, itself included) differs from its own hash,
//     the state's hash matches, it loads and runs (checkState), and — unless an editor vouches — the
//     difference is explainable (no admin toggles or money from nowhere: explained()). A late joiner
//     takes the best-supported checkpoint it can fetch: fresh writers first, then editor > majority >
//     a lone writer, newest first; an undecided tick falls back to an older one where they agreed.
//   - The clock. Each writer states its timeline (ck = { tick0, wall0, gen }) in its own doc; a joiner
//     takes the clock of the writers behind its checkpoint. Nobody resyncs because a clock changed:
//     w/clock and w/cp (open to every Contributor) are only the bootstrap of a world written by the
//     version before attestations, and a debug note of who woke the world.
// Known limit: a client that has no world of its own yet (a late joiner, a tab back after > 30 s away
// while the others woke the world) and meets exactly one other, non-editor player has to take that
// player's word. Two honest players or one editor outvote a forger.
//
// Capability declaration for the published artifact (unchanged: ev/{self} covers ev/{uid}/cp/*):
//   { db: { rules: [ { path: 'w', read: 'view', write: 'interact' },
//                    { path: 'ev', read: 'view', write: 'admin' },
//                    { path: 'ev/{self}', read: 'view', write: 'interact' },
//                    { path: 'adm', read: 'view', write: 'admin' } ] },
//     room: { topics: { cmd: 'interact' } }, user: {} }
import { Session, type Backend } from './session';
import { hashState, ORD_MAX, okPid, type Cmd, type Sim, type State } from '../sim/sim';
import { validAdmCmd } from '../sim/admin';
import { roomPresence } from './presence';
import { bound, checkState, cleanHv, decide, explained, parseState, verdicts, MAX_STATE_CHARS, type Claim, type Verdict, type Writer } from './guard';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
interface ClockDoc { tick0: number; wall0: number; gen: number }
interface CpDoc { tick: number; wall?: number; gen: number; st: string; hash: number; era: number; wins: [number, number] }
interface Attest { t: number; h: number }
interface WriterRec extends Writer { ck: ClockDoc | null; at: number; era: number; wins: [number, number] }
interface Base { st: State; tick: number; hash: number; clock: ClockDoc | null; fresh: boolean; gen: number; why: string }

export interface Shared {
  menuInfo(): { available: boolean; online: number[]; era: number; wins: [number, number] };
  join(sim: Sim, side: 0 | 1): Promise<Session | null>;
  tick(session: Session): void;
  leave(): void;
  /** Admin panel hooks (src/ui/admin.ts). */
  admin: SharedAdmin;
}

export interface SharedDebug {
  uid: string | null; keeper: boolean; leaseAgeMs: number; cpTick: number; cpAgeMs: number; cpWriteAgeMs: number;
  gen: number; online: number[]; admCmds: number; room: boolean;
}
export interface SharedAdmin {
  /** The viewer holds the artifact's editor (admin) role: only then do 'adm' writes and emits go through. */
  canEdit(): Promise<boolean>;
  debug(): SharedDebug;
  /** Write this client's checkpoint (attestation + state) now. false when there is no safe snapshot yet. */
  forceCheckpoint(): boolean;
  /** Reload the world from the newest checkpoint that counts (see decide) and replay every known command after it. */
  forceResync(): void;
  /** Called when the store refused an admin command (it is taken back locally). */
  onRefused?: (why: string) => void;
}

/** Checkpoint ticks are multiples of this (15 s)… */
export const CP_STEP = 150;
/** …attested once they are this many ticks old here (the commands for them have arrived). */
export const CP_AGE = 60;
const HV_KEEP = 8;
const CMD_KEEP = 600, ADM_KEEP = 300;
/** No writer behind the checkpoint wrote for this long: the world sleeps; the next joiner wakes it at the checkpoint tick. */
const SLEEP_MS = 90_000;
/** A writer this recent is in the war now. */
const FRESH_MS = 60_000;
/** tick() not called for this long (hidden tab): look again whether the world went on under another clock. */
const AWAY_MS = 30_000;
const slotOf = (t: number) => String(Math.floor(t / CP_STEP) % 2);
const cpPath = (uid: string, t: number) => `ev/${uid}/cp/${slotOf(t)}`;

const timeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))]);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function cleanClock(v: Any): ClockDoc | null {
  if (!v || typeof v !== 'object') return null;
  const { tick0, wall0, gen } = v;
  if (!Number.isInteger(tick0) || tick0 < 0 || tick0 > 2 ** 31 || typeof wall0 !== 'number' || !Number.isFinite(wall0) || wall0 <= 0 || !Number.isInteger(gen) || gen < 1 || gen > 2 ** 30) return null;
  return { tick0, wall0, gen };
}
const sameClock = (a: ClockDoc | null, b: ClockDoc | null) => !!a && !!b && a.tick0 === b.tick0 && a.wall0 === b.wall0 && a.gen === b.gen;
const clockKey = (c: ClockDoc) => `${c.gen}:${c.tick0}:${c.wall0}`;
const wins2 = (v: Any): [number, number] => (Array.isArray(v) && Number.isInteger(v[0]) && Number.isInteger(v[1]) && v[0] >= 0 && v[1] >= 0 ? [v[0], v[1]] : [0, 0]);
/** How much a world hands its sides beyond the game: admin toggles first, then money (a forger gives itself more, not less). */
function privilege(st: State): number {
  const a = st.adm;
  const on = a ? [...a.frz, ...a.god].filter(x => x).length + a.ai.filter(x => x).length : 0;
  return on * 1e12 + Math.max(0, st.sides[0].money) + Math.max(0, st.sides[1].money);
}
function cleanCp(v: Any): CpDoc | null {
  if (!v || typeof v !== 'object') return null;
  if (!Number.isInteger(v.tick) || v.tick < 0 || !Number.isInteger(v.hash) || typeof v.st !== 'string' || v.st.length > MAX_STATE_CHARS) return null;
  return { tick: v.tick, wall: typeof v.wall === 'number' && Number.isFinite(v.wall) ? v.wall : undefined, gen: Number.isInteger(v.gen) ? v.gen : 1, st: v.st, hash: v.hash, era: Number.isInteger(v.era) ? v.era : 1, wins: wins2(v.wins) };
}

export async function connectShared(_fallbackPid: string): Promise<Shared | null> {
  const cl = (window as Any).claude;
  if (!cl || typeof cl.use !== 'function') return null;
  const [db, room, user] = await Promise.all([
    timeout(cl.use('db') as Promise<Any>, 11000).catch(() => null),
    timeout(cl.use('room') as Promise<Any>, 11000).catch(() => null),
    timeout(cl.use('user') as Promise<Any>, 11000).catch(() => null),
  ]);
  if (!db) return null;
  let uid: string | null = null;
  try { uid = user ? await user.id() : null; } catch { uid = null; }
  if (!okPid(uid)) uid = null; // an id the sim could not key players by: play without an identity (menu: unavailable)
  return new SharedWar(db, room, uid, user);
}

class SharedWar implements Shared {
  /** This client's timeline (null before joining). */
  clock: ClockDoc | null = null;
  /** w/clock and w/cp as stored: only the bootstrap of a world from before attestations. */
  legacyClock: ClockDoc | null = null;
  legacyCp: CpDoc | null = null;
  gotClock = false; gotCp = false; gotEv = false; gotAdm = false;
  /** Ordinary commands by author (ev/{uid}), validated and bound to the author. */
  ev = new Map<string, Cmd[]>();
  /** Who attests what: ev/{uid} (players) and adm/{uid} (editors). */
  evW = new Map<string, WriterRec>();
  admW = new Map<string, WriterRec>();
  online = [0, 0];
  session: Session | null = null;
  /** Holds the w/keeper lease: creates or wakes the world, and writes the legacy w/cp too. */
  keeper = false;
  /** This viewer is an editor: attests in adm/{uid} as well. */
  editor = false;
  /** Counters for tests and the debug page. */
  stats = { attests: 0, cpWrites: 0, heals: 0, healsRefused: 0, unbound: 0, rejoins: 0, badCp: 0 };
  /** Last refusals (newest last): why a checkpoint or a command was not taken. */
  refusals: string[] = [];
  private myHv: Attest[] = [];
  /** First tick of this client's world (its base): attestations start after it. */
  private base = 0;
  /** Newest tick where this client's hash agreed with a verdict. */
  private agreedAt = -1;
  private lastLease = 0; private lastCp = 0; private lastPresence = 0; private lastRound = 0; private lastTickCall = 0; private rounds = 0;
  private myCmds: Cmd[] = [];
  private writing = false; private dirty = false;
  private cpWriting = false; private slotRefused = false;
  private cpQueue = new Map<string, { st: State; t: number; h: number }>();
  private unsubs: (() => void)[] = [];
  private side: 0 | 1 = 0;
  private busy = false; private healTried = new Set<string>();
  /** Admin commands by author (adm/{uid}), validated and bound. */
  adm = new Map<string, Cmd[]>();
  private myAdm: Cmd[] = [];
  private admOk = new Set<string>(); // ids the store accepted
  private admWriting = false; private admDirty = false;
  private editorP: Promise<boolean> | null = null;
  admin: SharedAdmin;

  constructor(private db: Any, private room: Any, private uid: string | null, private user: Any = null) {
    this.admin = {
      canEdit: () => (this.editorP ??= Promise.resolve().then(async () => !!this.user && (await this.user.canEdit()) === true).catch(() => false)),
      debug: () => this.debug(),
      forceCheckpoint: () => this.forceCheckpoint(),
      forceResync: () => { void this.resyncNow(); },
    };
    (window as Any).__sharedWar = this; // debug handle for automated checks
    this.unsubs.push(db.doc('w/clock').onSnapshot((s: Any) => { this.gotClock = true; this.legacyClock = s.exists ? cleanClock(s.data()) : null; }, () => { this.gotClock = true; }));
    this.unsubs.push(db.doc('w/cp').onSnapshot((s: Any) => { this.gotCp = true; this.legacyCp = s.exists ? cleanCp(s.data()) : null; }, () => { this.gotCp = true; }));
    this.unsubs.push(db.collection('ev').onSnapshot((q: Any) => {
      this.gotEv = true;
      for (const ch of q.docChanges()) if (ch.type !== 'removed') this.onEvDoc(ch.doc.id, ch.doc.data());
    }, () => { this.gotEv = true; /* store unreachable: room still carries commands */ }));
    this.unsubs.push(db.collection('adm').onSnapshot((q: Any) => {
      this.gotAdm = true;
      for (const ch of q.docChanges()) if (ch.type !== 'removed') this.onAdmDoc(ch.doc.id, ch.doc.data());
    }, () => { this.gotAdm = true; /* store unreachable */ }));
    if (room) {
      // `by` is the platform's stamp of who sent it: a command speaks only for its sender
      this.unsubs.push(room.on('cmd', (m: Any) => {
        if (m.sameTab || !validCmd(m.data)) return;
        if (!bound(m.data, m.by)) { this.stats.unbound++; return; }
        this.session?.receive(m.data as Cmd);
      }));
      // editors only (the platform enforces who may emit on an admin-only topic)
      this.unsubs.push(room.on('adm', (m: Any) => {
        if (m.sameTab || !validAdmCmd(m.data)) return;
        if (!bound(m.data, m.by)) { this.stats.unbound++; return; }
        this.session?.receive(m.data as Cmd);
      }));
      this.unsubs.push(room.onPeers((ch: Any) => {
        const n = [0, 0];
        for (const p of ch.peers) { const s = p.presence?.side; if (s === 0 || s === 1) n[s]++; }
        this.online = n;
      }));
    }
  }

  /** ev/{id}: the writer's own commands (bound to it) and its attestations. */
  private onEvDoc(id: unknown, d: Any) {
    if (!okPid(id)) return;
    const raw: Any[] = Array.isArray(d?.cmds) ? d.cmds : [];
    const list = raw.filter(c => validCmd(c) && bound(c, id));
    if (list.length !== raw.length) this.stats.unbound += raw.length - list.length;
    this.ev.set(id, list);
    this.evW.set(id, this.writerOf(id, false, d));
    if (this.session && id !== this.uid) for (const c of list) this.session.receive(c);
  }

  /** adm/{id} (editors only): admin commands (bound to the editor) and the editor's attestations. */
  private onAdmDoc(id: unknown, d: Any) {
    if (!okPid(id)) return;
    const raw: Any[] = Array.isArray(d?.cmds) ? d.cmds : [];
    const list = raw.filter(c => validAdmCmd(c) && bound(c, id)).slice(-400);
    this.adm.set(id, list);
    if (d && Array.isArray(d.hv)) this.admW.set(id, this.writerOf(id, true, d)); else this.admW.delete(id);
    if (!this.session) return;
    if (id !== this.uid) { for (const c of list) this.session.receive(c); return; }
    // our own list from another tab or an earlier visit: keep it, so the next write does not drop it
    for (const c of list) if (!this.myAdm.some(x => x.id === c.id)) { this.myAdm.push(c); this.admOk.add(c.id); this.session.receive(c); }
  }

  /** Read the most recent writers' docs again (a joiner's first view may be a stale cache). */
  private async refreshWriters() {
    const recs = this.writers().sort((a, b) => b.at - a.at).slice(0, 8);
    await Promise.all(recs.map(async w => {
      try {
        const s = await timeout(this.db.doc((w.editor ? 'adm/' : 'ev/') + w.uid).get() as Promise<Any>, 4000);
        if (s && s.exists) { if (w.editor) this.onAdmDoc(w.uid, s.data()); else this.onEvDoc(w.uid, s.data()); }
      } catch { /* the listener's copy stays */ }
    }));
  }

  private writerOf(uid: string, editor: boolean, d: Any): WriterRec {
    return {
      uid, editor, hv: cleanHv(d?.hv, HV_KEEP * 2).filter(a => a.t % CP_STEP === 0), ck: cleanClock(d?.ck),
      at: typeof d?.at === 'number' && Number.isFinite(d.at) ? d.at : 0,
      era: Number.isInteger(d?.era) && d.era >= 1 ? d.era : 1, wins: wins2(d?.wins),
    };
  }

  private writers(): WriterRec[] { return [...this.evW.values(), ...this.admW.values()]; }

  private refuse(why: string) {
    this.refusals.push(why);
    if (this.refusals.length > 20) this.refusals.shift();
  }

  menuInfo() {
    // era and score from the writers behind the newest verdict (the legacy w/cp before anyone attests)
    let era = this.legacyCp?.era ?? 1, wins = this.legacyCp?.wins ?? ([0, 0] as [number, number]);
    const ws = this.writers();
    for (const { t, v } of verdicts(ws)) {
      if (!v) continue;
      const w = ws.find(x => x.hv.some(a => a.t === t && a.h === v.h));
      if (w) { era = w.era; wins = w.wins; }
      break;
    }
    return { available: !!this.uid, online: this.online, era, wins: [wins[0], wins[1]] as [number, number] };
  }

  private async lease(): Promise<boolean> {
    if (!this.uid) return false;
    try {
      const r = await this.db.doc('w/keeper').acquire({ holder: this.uid, ttlMs: 25000 });
      this.keeper = !!r?.acquired;
    } catch { this.keeper = false; }
    this.lastLease = Date.now();
    return this.keeper;
  }

  // ---- which checkpoint counts ----------------------------------------------------------------------
  /** Writers on my clock (or all) with an attestation at tick t, as claims. */
  private claimsAt(t: number, clock: ClockDoc | null): Claim[] {
    const out: Claim[] = [];
    for (const w of this.writers()) {
      if (w.uid === this.uid && !w.editor) continue; // my own doc read back: `me` stands for it
      if (clock && !sameClock(w.ck, clock)) continue;
      const a = w.hv.find(x => x.t === t);
      if (a) out.push({ uid: w.uid, h: a.h, editor: w.editor });
    }
    return out;
  }

  /** The full state behind (t, h), from a writer who vouches for it (editors first, freshest first), else the legacy w/cp. Verified. */
  private async fetchCp(t: number, h: number, uids: string[], sim: Sim): Promise<{ st: State; from: string } | null> {
    const recs = uids.map(u => this.admW.get(u) ?? this.evW.get(u)).filter((w): w is WriterRec => !!w);
    recs.sort((a, b) => Number(b.editor) - Number(a.editor) || b.at - a.at);
    const tried = new Set<string>();
    for (const w of recs.slice(0, 6)) {
      if (tried.has(w.uid)) continue;
      tried.add(w.uid);
      try {
        const s = await timeout(this.db.doc(cpPath(w.uid, t)).get() as Promise<Any>, 6000);
        const cp = s && s.exists ? cleanCp(s.data()) : null;
        if (!cp || cp.tick !== t || cp.hash !== h) continue;
        const raw = parseState(cp.st);
        const why = checkState(raw, sim.terrain, h);
        if (why) { this.stats.badCp++; this.refuse(`cp ${w.uid.slice(0, 6)}@${t}: ${why}`); continue; }
        return { st: raw as State, from: w.uid };
      } catch { /* unreachable or refused: try the next one */ }
    }
    const L = this.legacyCp;
    if (L && L.tick === t && L.hash === h) {
      const raw = parseState(L.st);
      if (!checkState(raw, sim.terrain, h)) return { st: raw as State, from: 'w/cp' };
    }
    return null;
  }

  /**
   * The world a joiner (or a tab back from away) starts from: the best-supported checkpoint it can
   * fetch. Ranked: recent (at most one step older than the newest tick fresh writers decided on) and
   * fresh first; editor > majority > a lone writer (only while at most one writer is fresh); newest
   * tick. An undecided tick (a tie) is skipped: an older tick where they agreed comes up instead.
   * When none of those can be fetched: the claims at the newest tick two fresh writers attested,
   * each verified, and the least privileged world wins (no admin toggles, least money: a forger
   * hands itself more, not less). Last, the legacy w/cp of a world from before attestations.
   */
  private async pickBase(sim: Sim): Promise<Base | null> {
    const ws = this.writers(); // my own docs too: an earlier visit of mine is a claim like any other
    const now = Date.now();
    const isFresh = (w: WriterRec) => now - w.at < FRESH_MS;
    const freshN = new Set(ws.filter(isFresh).map(w => w.uid)).size;
    const rank = { editor: 3, majority: 2, alone: 1 } as const;
    // claims grouped per clock generation, so two timelines never vote together
    const byGen = new Map<number, WriterRec[]>();
    for (const w of ws) { const g = w.ck?.gen ?? 0; let l = byGen.get(g); if (!l) byGen.set(g, (l = [])); l.push(w); }
    const cands: { t: number; v: Verdict; gen: number; sup: WriterRec[]; fresh: boolean }[] = [];
    for (const [gen, list] of byGen) {
      for (const { t, v } of verdicts(list)) {
        if (!v) continue;
        const sup = list.filter(w => w.hv.some(a => a.t === t && a.h === v.h));
        const fresh = sup.some(isFresh);
        if (v.why === 'alone' && fresh && freshN > 1) continue; // two players here: one voice alone proves nothing
        cands.push({ t, v, gen, sup, fresh });
      }
    }
    // the newest tick fresh writers decided on (editor or majority): an older verdict than one step
    // before it is a last resort (its checkpoint and the commands after it may be gone by now)
    let newest = -1;
    for (const c of cands) if (c.fresh && c.v.why !== 'alone') newest = Math.max(newest, c.t);
    const recent = (c: { t: number; fresh: boolean }) => c.fresh && c.t >= newest - CP_STEP;
    cands.sort((a, b) => Number(recent(b)) - Number(recent(a)) || Number(b.fresh) - Number(a.fresh) || rank[b.v.why] - rank[a.v.why] || b.t - a.t);
    for (const c of cands.slice(0, 6)) {
      const got = await this.fetchCp(c.t, c.v.h, c.sup.map(w => w.uid), sim);
      if (got) return this.baseOf(got.st, c.t, c.v.h, c.sup, c.gen, `${c.v.why} ${c.v.n}/${c.v.of} from ${got.from === 'w/cp' ? 'w/cp' : 'ev'}`);
    }
    // a tie at every tick still stored: the least privileged of the claims two fresh writers made
    const fw = ws.filter(isFresh);
    for (const { t, claims } of verdicts(fw)) {
      if (new Set(claims.map(c => c.uid)).size < 2) continue;
      const got: { h: number; st: State; sup: WriterRec[] }[] = [];
      for (const h of [...new Set(claims.map(c => c.h))].slice(0, 3)) {
        const sup = fw.filter(w => w.hv.some(a => a.t === t && a.h === h));
        const g = await this.fetchCp(t, h, sup.map(w => w.uid), sim);
        if (g) got.push({ h, st: g.st, sup });
      }
      if (!got.length) continue;
      got.sort((a, b) => privilege(a.st) - privilege(b.st) || a.h - b.h);
      const g = got[0];
      this.refuse(`tie at ${t}: took the least privileged of ${got.length}`);
      return this.baseOf(g.st, t, g.h, g.sup, Math.max(0, ...g.sup.map(w => w.ck?.gen ?? 0)), 'tie');
    }
    if (!ws.some(w => w.hv.length) && this.legacyCp) {
      const L = this.legacyCp, raw = parseState(L.st);
      if (!checkState(raw, sim.terrain, L.hash)) {
        const lc = this.legacyClock, awake = !!lc && L.wall !== undefined && now - L.wall < SLEEP_MS;
        return { st: raw as State, tick: L.tick, hash: L.hash, clock: awake ? lc : null, fresh: awake, gen: Math.max(L.gen, lc?.gen ?? 0), why: 'legacy w/cp' };
      }
      this.refuse('legacy w/cp refused');
    }
    return null;
  }

  /** A base from a verified checkpoint: the clock most of its writers state, unless they all sleep. */
  private baseOf(st: State, t: number, h: number, sup: WriterRec[], gen: number, why: string): Base {
    const now = Date.now();
    const cks = new Map<string, { c: ClockDoc; n: number }>();
    for (const w of sup) if (w.ck) { const k = clockKey(w.ck), e = cks.get(k); if (e) e.n++; else cks.set(k, { c: w.ck, n: 1 }); }
    const clock = [...cks.values()].sort((a, b) => b.n - a.n)[0]?.c ?? null;
    const awake = sup.some(w => now - w.at < SLEEP_MS);
    return { st, tick: t, hash: h, clock: awake ? clock : null, fresh: sup.some(w => now - w.at < FRESH_MS), gen: Math.max(gen, clock?.gen ?? 0), why };
  }

  // ---- joining ------------------------------------------------------------------------------------
  async join(sim: Sim, side: 0 | 1, attempt = 0): Promise<Session | null> {
    if (!this.uid) return null;
    this.side = side;
    for (let i = 0; i < 40 && !(this.gotClock && this.gotCp && this.gotEv && this.gotAdm); i++) await sleep(250);
    this.editor = await this.admin.canEdit();
    await this.refreshWriters();
    let base = await this.pickBase(sim);
    if (!base && this.writers().some(w => w.hv.length)) { await sleep(2000); await this.refreshWriters(); base = await this.pickBase(sim); }
    const now = Date.now();
    let st: State, clock: ClockDoc, made = false;
    const maxGen = Math.max(0, base?.gen ?? 0, ...this.writers().map(w => w.ck?.gen ?? 0));
    if (!base) {
      if (!(await this.lease())) {
        await sleep(3000);
        if (attempt >= 2) return null;
        return this.join(sim, side, attempt + 1);
      }
      sim.init((Math.random() * 2 ** 31) | 0);
      sim.st.mp = 1; sim.st.humanSide = -1;
      st = sim.snapshot();
      clock = { tick0: 0, wall0: now, gen: maxGen + 1 };
      made = true;
    } else {
      st = base.st;
      if (base.clock) clock = base.clock;
      else if (await this.lease()) { clock = { tick0: base.tick, wall0: now, gen: maxGen + 1 }; made = true; } // asleep: wake it here
      else {
        await sleep(2500); // someone else is waking it: take their clock
        if (attempt < 2) return this.join(sim, side, attempt + 1);
        clock = { tick0: base.tick, wall0: now, gen: maxGen + 1 };
        made = true;
      }
    }
    const backend: Backend = {
      kind: 'shared', send: c => this.send(c), checkpoint: () => { /* attest() writes them */ }, close: () => this.leave(),
      presence: this.room ? roomPresence(this.room, this.uid, this.user) : undefined, // roster: src/net/presence.ts
    };
    const session = new Session(sim, backend, this.uid);
    session.lead = 6;
    if (!safeReset(session, st, clock.tick0, clock.wall0)) return null;
    this.clock = clock;
    this.session = session;
    this.base = st.tick;
    this.agreedAt = st.tick;
    this.healTried.clear();
    this.replayAfter(session, st.tick);
    this.myCmds = (this.ev.get(this.uid) ?? []).filter(c => c.t >= st.tick);
    for (const c of this.myCmds) session.receive(c);
    this.myAdm = (this.adm.get(this.uid) ?? []).filter(c => c.t >= st.tick);
    for (const c of this.myAdm) { this.admOk.add(c.id); session.receive(c); }
    // what I start from is what I attest first: a second joiner sees a fresh writer on this clock
    const h0 = hashState(st);
    this.myHv = st.tick % CP_STEP === 0 ? [{ t: st.tick, h: h0 }] : [];
    if (made) {
      try { await this.db.doc('w/clock').set(clock); } catch { /* a note only */ }
      if (this.myHv.length) await this.writeCp(st, st.tick, h0);
    }
    await this.flush();
    if (this.editor) void this.flushAdm();
    if (this.room) this.room.presence({ side, v: 1 }).catch(() => {});
    // the sim still has to catch up from the checkpoint: stamp the join at the real current tick, not in
    // the past (the others would have to roll back that far, and checkpoints they attested meanwhile
    // would not have it)
    session.submit({ k: 'join', s: side }, Math.max(0, session.targetTick() - sim.st.tick) + session.lead);
    return session;
  }

  /** Commands of everyone else (ev, adm) at or after tick t into the session. */
  private replayAfter(s: Session, t: number) {
    for (const [id, list] of this.ev) if (id !== this.uid) for (const c of list) if (c.t >= t) s.receive(c);
    for (const [id, list] of this.adm) if (id !== this.uid) for (const c of list) if (c.t >= t) s.receive(c);
  }

  private send(c: Cmd) {
    if (c.k === 'adm') { this.sendAdm(c); return; }
    if (this.room) this.room.emit('cmd', c).catch(() => {});
    this.myCmds.push(c);
    void this.flush();
  }

  /**
   * Admin command: adm/{uid} first (the record late joiners and resyncs read, and the authority: a
   * refused write takes the command back here), then the room topic 'adm' for speed.
   */
  private sendAdm(c: Cmd) {
    if (!this.uid) { this.session?.drop(c.id); this.admin.onRefused?.('no_identity'); return; }
    this.myAdm.push(c);
    void this.flushAdm();
  }

  /** Oldest command tick anyone may still need from my docs: from two checkpoints back on. */
  private floor() { return (this.myHv[this.myHv.length - 1]?.t ?? this.base) - 2 * CP_STEP - 100; }

  private async flushAdm() {
    if (this.admWriting) { this.admDirty = true; return; }
    this.admWriting = true;
    do {
      this.admDirty = false;
      this.myAdm = this.myAdm.filter(c => c.t >= this.floor()).slice(-ADM_KEEP);
      const batch = [...this.myAdm];
      try {
        const body: Record<string, unknown> = { cmds: batch };
        if (this.editor && this.clock) Object.assign(body, { hv: this.myHv, ck: this.clock, at: Date.now() });
        await this.db.doc('adm/' + this.uid).set(body);
        for (const c of batch) {
          if (this.admOk.has(c.id)) continue;
          this.admOk.add(c.id);
          if (this.room) this.room.emit('adm', c).catch(() => { /* offline: the others read adm/{uid} */ });
        }
      } catch (err) {
        // refused (no editor role, rules missing) or unreachable: take back what nobody else will ever see
        const lost = batch.filter(c => !this.admOk.has(c.id));
        this.myAdm = this.myAdm.filter(c => this.admOk.has(c.id));
        for (const c of lost) this.session?.drop(c.id);
        if (lost.length) this.admin.onRefused?.(String((err as Any)?.code ?? (err as Any)?.message ?? 'refused'));
      }
      if (this.admDirty) await sleep(300);
    } while (this.admDirty);
    this.admWriting = false;
  }

  private debug(): SharedDebug {
    const now = Date.now();
    let n = 0;
    for (const l of this.adm.values()) n += l.length;
    const last = this.myHv[this.myHv.length - 1];
    return {
      uid: this.uid, keeper: this.keeper, leaseAgeMs: this.lastLease ? now - this.lastLease : -1,
      cpTick: last?.t ?? -1, cpAgeMs: this.lastCp ? now - this.lastCp : -1, cpWriteAgeMs: this.lastCp ? now - this.lastCp : -1,
      gen: this.clock?.gen ?? 0, online: [...this.online], admCmds: n, room: !!this.room,
    };
  }

  private forceCheckpoint(): boolean {
    const s = this.session;
    if (!s || !this.clock) return false;
    const t = Math.floor((s.sim.st.tick - CP_AGE) / CP_STEP) * CP_STEP;
    const snap = t >= this.base ? s.snapAt(t) : null;
    if (!snap) return false;
    const h = hashState(snap);
    const a = this.myHv.find(x => x.t === t);
    if (a) a.h = h; else { this.myHv.push({ t, h }); if (this.myHv.length > HV_KEEP) this.myHv.shift(); }
    void this.writeCp(snap, t, h);
    void this.flush();
    if (this.editor) void this.flushAdm();
    return true;
  }

  private async flush() {
    if (!this.uid) return;
    if (this.writing) { this.dirty = true; return; }
    this.writing = true;
    try {
      do {
        this.dirty = false;
        this.myCmds = this.myCmds.filter(c => c.t >= this.floor()).slice(-CMD_KEEP);
        const st = this.session?.sim.st;
        const body: Record<string, unknown> = { cmds: this.myCmds, side: this.side, hv: this.myHv, at: Date.now() };
        if (this.clock) body.ck = this.clock;
        if (st) { body.era = st.era; body.wins = [st.sides[0].wins, st.sides[1].wins]; }
        await this.db.doc('ev/' + this.uid).set(body);
        await sleep(400);
      } while (this.dirty);
    } catch { /* quota or rate limit: room already delivered it to whoever is online */ }
    this.writing = false;
  }

  /**
   * My full state at tick t, in my own subtree (and w/cp while I hold the lease, or when my subtree
   * refuses it). Writes go one at a time; a newer state for the same slot replaces a queued one.
   */
  private writeCp(st: State, t: number, h: number): Promise<void> {
    this.cpQueue.set(slotOf(t), { st, t, h });
    return this.drainCp();
  }

  private async drainCp() {
    if (this.cpWriting) return;
    this.cpWriting = true;
    try {
      for (let e = this.cpQueue.values().next(); !e.done; e = this.cpQueue.values().next()) {
        const { st, t, h } = e.value;
        this.cpQueue.delete(slotOf(t));
        const clock = this.clock, uid = this.uid;
        if (!clock || !uid) continue;
        const text = JSON.stringify(st);
        if (text.length > MAX_STATE_CHARS) continue;
        const body: CpDoc = { tick: t, wall: clock.wall0 + (t - clock.tick0) * 100, gen: clock.gen, st: text, hash: h, era: st.era, wins: [st.sides[0].wins, st.sides[1].wins] };
        this.lastCp = Date.now();
        try { await this.db.doc(cpPath(uid, t)).set(body); this.stats.cpWrites++; } catch { this.slotRefused = true; }
        if (this.keeper || this.slotRefused) { try { await this.db.doc('w/cp').set(body); } catch { /* next round */ } }
      }
    } finally {
      this.cpWriting = false;
    }
  }

  tick(session: Session) {
    const now = Date.now();
    const away = this.lastTickCall > 0 && now - this.lastTickCall > AWAY_MS;
    this.lastTickCall = now;
    if (now - this.lastLease > (this.keeper ? 8000 : 12000)) void this.lease();
    if (this.room && now - this.lastPresence > 20000) { this.lastPresence = now; this.room.presence({ side: this.side, v: 1, at: now }).catch(() => {}); }
    if (away) { void this.rejoin(); return; }
    if (now - this.lastRound > 1000 && !this.busy) { this.lastRound = now; this.round(session); }
  }

  /** Once a second: attest the newest checkpoint tick, re-check the last two (a late command may have changed them), then compare with the others. */
  private round(s: Session) {
    if (!this.clock || s !== this.session) return;
    const t = Math.floor((s.sim.st.tick - CP_AGE) / CP_STEP) * CP_STEP;
    let changed = false;
    if (++this.rounds % 3 === 0) {
      for (const a of this.myHv.slice(-2)) {
        const snap = s.snapAt(a.t);
        if (!snap || a.t <= this.base) continue;
        const h = hashState(snap);
        if (h !== a.h) { a.h = h; changed = true; void this.writeCp(snap, a.t, h); } // the stored state follows the attestation
      }
    }
    const last = this.myHv[this.myHv.length - 1];
    if (t > this.base && (!last || t > last.t)) {
      const snap = s.snapAt(t);
      if (snap) {
        const h = hashState(snap);
        this.myHv.push({ t, h });
        if (this.myHv.length > HV_KEEP) this.myHv.shift();
        this.stats.attests++;
        changed = true;
        void this.writeCp(snap, t, h);
      }
    }
    if (changed) { void this.flush(); if (this.editor) void this.flushAdm(); }
    // compare only once caught up: while replaying, the others' stored states for these ticks may be gone
    if (!s.catchingUp && s.targetTick() - s.sim.st.tick < 20) void this.heal(s);
  }

  /**
   * My world against the others', at the newest tick I attested that someone else attested too. A
   * verdict (editor, or a majority with me counted) for another hash replaces my world with theirs
   * — verified, and unless an editor vouches, only when the difference is explainable.
   */
  private async heal(s: Session) {
    if (this.busy || !this.clock) return;
    for (let i = this.myHv.length - 1; i >= 0; i--) {
      const a = this.myHv[i];
      const claims = this.claimsAt(a.t, this.clock);
      if (!claims.length) continue;
      let v = decide(claims, { uid: this.uid!, h: a.h, editor: this.editor });
      // a tie with exactly one other player: nobody can tell who is right, so both keep their own —
      // except a newcomer that has not agreed with anyone since it joined (its replay is the likelier
      // to miss a command); it takes the other's world if the difference is explainable (below)
      const young = !v && claims.length === 1 && !claims[0].editor && !this.editor && this.agreedAt <= this.base && a.t - this.base <= 4 * CP_STEP;
      if (young) v = { h: claims[0].h, why: 'majority', n: 1, of: 2 };
      if (!v) return;
      if (v.h === a.h) { this.agreedAt = Math.max(this.agreedAt, a.t); return; }
      if (v.why !== 'editor' && v.why !== 'majority') return;
      const key = a.t + ':' + v.h;
      if (this.healTried.has(key)) return;
      this.healTried.add(key);
      this.busy = true;
      try {
        const sup = claims.filter(c => c.h === v.h).map(c => c.uid);
        const got = await this.fetchCp(a.t, v.h, sup, s.sim);
        if (!got || s !== this.session) { this.stats.healsRefused++; if (!got) this.refuse(`heal ${a.t}: no checkpoint`); return; }
        if (v.why !== 'editor') {
          const mine = s.snapAt(a.t);
          const admIn = this.admBetween(this.agreedAt - 50, a.t);
          const why = mine ? explained(mine, got.st, a.t - Math.max(0, this.agreedAt), admIn) : null;
          if (why) { this.stats.healsRefused++; this.refuse(`heal ${a.t}: ${why}`); return; }
        }
        if (!this.resetTo(s, got.st, this.clock)) return;
        a.h = v.h;
        this.myHv = this.myHv.filter(x => x.t <= a.t);
        this.agreedAt = a.t;
        this.stats.heals++;
        void this.flush();
        if (this.editor) void this.flushAdm();
      } finally {
        this.busy = false;
      }
      return;
    }
  }

  /** An admin command (anyone's) with a tick in [t0, t1]. */
  private admBetween(t0: number, t1: number): boolean {
    for (const l of this.adm.values()) for (const c of l) if (c.t >= t0 && c.t <= t1) return true;
    for (const c of this.session?.allCmds() ?? []) if (c.k === 'adm' && c.t >= t0 && c.t <= t1) return true;
    return false;
  }

  /** Reset the session to st (on `clock`), keeping every command at or after it. */
  private resetTo(s: Session, st: State, clock: ClockDoc): boolean {
    const pending = s.allCmds().filter(c => c.t >= st.tick);
    if (!safeReset(s, st, clock.tick0, clock.wall0)) return false;
    for (const c of pending) s.receive(c);
    this.replayAfter(s, st.tick);
    for (const c of this.myCmds) if (c.t >= st.tick) s.receive(c);
    return true;
  }

  /** Back from away (hidden tab): if the world went on under another clock, join it as a late joiner would. */
  private async rejoin() {
    const s = this.session;
    if (this.busy || !s || !this.clock) return;
    this.busy = true;
    try {
      const base = await this.pickBase(s.sim);
      if (!base || !base.clock || !base.fresh || sameClock(base.clock, this.clock) || s !== this.session) return;
      if (!this.resetTo(s, base.st, base.clock)) return;
      this.clock = base.clock;
      this.base = base.tick; this.agreedAt = base.tick;
      this.myHv = base.tick % CP_STEP === 0 ? [{ t: base.tick, h: base.hash }] : [];
      this.healTried.clear();
      this.stats.rejoins++;
      void this.flush();
      if (this.editor) void this.flushAdm();
    } finally {
      this.busy = false;
    }
  }

  /** «Пересинхронизироваться»: reload from the newest checkpoint that counts (or my own snapshot) and replay every known command after it. */
  private async resyncNow() {
    const s = this.session;
    if (this.busy || !s || !this.clock) return;
    this.busy = true;
    try {
      for (let i = this.myHv.length - 1; i >= 0; i--) {
        const a = this.myHv[i];
        const claims = this.claimsAt(a.t, this.clock);
        const v = decide(claims, { uid: this.uid!, h: a.h, editor: this.editor });
        if (!v || (v.h !== a.h && v.why !== 'editor' && v.why !== 'majority')) continue;
        const own = v.h === a.h ? s.snapAt(a.t) : null;
        const st = own ? structuredClone(own) : (await this.fetchCp(a.t, v.h, claims.filter(c => c.h === v.h).map(c => c.uid), s.sim))?.st;
        if (!st || s !== this.session) continue;
        if (this.resetTo(s, st, this.clock)) { a.h = v.h; this.myHv = this.myHv.filter(x => x.t <= a.t); this.agreedAt = a.t; }
        return;
      }
      const snap = s.safeSnap(CP_AGE);
      if (snap) this.resetTo(s, structuredClone(snap.st), this.clock);
    } finally {
      this.busy = false;
    }
  }

  leave() {
    if (this.room) this.room.presence({ side: null }).catch(() => {});
    this.session = null;
    this.clock = null;
    this.lastTickCall = 0;
  }
}

/** Replace the session's world; a state that does not load leaves the old one in place. Never throws. */
function safeReset(s: Session, st: State, tick0: number, wall0: number): boolean {
  let prev: State | null = null;
  try { prev = s.sim.st ? s.sim.snapshot() : null; } catch { prev = null; }
  try {
    s.reset(st, tick0, wall0);
    return true;
  } catch (err) {
    console.error('[shared] reset refused', err);
    if (prev) { try { s.sim.load(prev); } catch { /* nothing better to do */ } }
    return false;
  }
}

/** An ordinary command from the room topic 'cmd' or ev/{uid}. Never 'adm' or 'cfg'. The receiver also checks bound(). */
export function validCmd(c: Any): boolean {
  if (!c || typeof c !== 'object' || typeof c.t !== 'number' || typeof c.id !== 'string' || c.id.length > 200 || !okPid(c.p)) return false;
  if (!Number.isFinite(c.t) || c.t < 0) return false;
  switch (c.k) {
    case 'join': return c.s === 0 || c.s === 1;
    case 'vote': return (c.s === 0 || c.s === 1) && Number.isInteger(c.o);
    case 'dep': return (c.s === 0 || c.s === 1) && Number.isInteger(c.u) && Number.isFinite(c.x) && Number.isFinite(c.z);
    // unit control: the shape only; the sim checks the rest (ownership, bounds, modes) and ignores what does not fit
    case 'ord': return (c.s === 0 || c.s === 1) && Array.isArray(c.ids) && c.ids.length >= 1 && c.ids.length <= ORD_MAX && c.ids.every(Number.isInteger) && typeof c.m === 'string';
    case 'ctl': return (c.s === 0 || c.s === 1) && Number.isInteger(c.u) && [c.dx, c.dz].every(v => Number.isInteger(v) && v >= -8 && v <= 8) && (c.atk === 0 || c.atk === 1);
    case 'adm': return false; // admin commands only from the editor-only channels (validAdmCmd)
    default: return false; // cfg is local-only
  }
}

/** An admin command from adm/{uid} or the room topic 'adm' (src/sim/admin.ts documents the shape). */
export { validAdmCmd };
