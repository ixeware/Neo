// Shared endless war over the artifact runtime: `db` keeps the command log, checkpoints
// and the clock; `room` carries commands fast and tells who is online. Every client runs
// the same deterministic sim, so the war is identical everywhere.
//
// Admin commands (Cmd k: 'adm') travel only on channels the platform restricts to the artifact's
// editors: the db collection 'adm' (adm/{uid} = { cmds }, rule { path: 'adm', read: 'view', write: 'admin' })
// and the room topic 'adm' (event topics are admin-only unless opened; 'adm' is never opened).
// Receivers accept k: 'adm' from those two channels only; 'cmd' and ev/{uid} keep rejecting it.
// Capability declaration for the published artifact:
//   { db: { rules: [ { path: 'w', read: 'view', write: 'interact' },
//                    { path: 'ev', read: 'view', write: 'admin' },
//                    { path: 'ev/{self}', read: 'view', write: 'interact' },
//                    { path: 'adm', read: 'view', write: 'admin' } ] },
//     room: { topics: { cmd: 'interact' } }, user: {} }
import { Session, type Backend } from './session';
import { hashState, ORD_MAX, type Cmd, type Sim, type State } from '../sim/sim';
import { validAdmCmd } from '../sim/admin';
import { roomPresence } from './presence';
import { TICK_MS } from '../sim/defs';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
interface ClockDoc { tick0: number; wall0: number; gen: number }
interface CpDoc { tick: number; wall: number; gen: number; st: string; hash: number; era: number; wins: [number, number] }

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
  /** Keeper only: write a checkpoint now. false when this client is not the keeper or has no safe snapshot. */
  forceCheckpoint(): boolean;
  /** Reload the world from the shared checkpoint and replay every known command after it. */
  forceResync(): void;
  /** Called when the store refused an admin command (it is taken back locally). */
  onRefused?: (why: string) => void;
}

const timeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))]);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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
  return new SharedWar(db, room, uid, user);
}

class SharedWar implements Shared {
  clock: ClockDoc | null = null;
  cp: CpDoc | null = null;
  gotClock = false; gotCp = false;
  ev = new Map<string, Cmd[]>();
  online = [0, 0];
  session: Session | null = null;
  keeper = false;
  private lastLease = 0; private lastCp = 0; private lastPresence = 0;
  private myCmds: Cmd[] = [];
  private writing = false; private dirty = false;
  private unsubs: (() => void)[] = [];
  private side: 0 | 1 = 0;
  private resyncing = false;
  /** Admin commands by author (adm/{uid}), validated. */
  adm = new Map<string, Cmd[]>();
  private myAdm: Cmd[] = [];
  private admOk = new Set<string>(); // ids the store accepted
  private admWriting = false; private admDirty = false;
  private editor: Promise<boolean> | null = null;
  admin: SharedAdmin;

  constructor(private db: Any, private room: Any, private uid: string | null, private user: Any = null) {
    this.admin = {
      canEdit: () => (this.editor ??= Promise.resolve().then(async () => !!this.user && (await this.user.canEdit()) === true).catch(() => false)),
      debug: () => this.debug(),
      forceCheckpoint: () => this.forceCheckpoint(),
      forceResync: () => this.resync(),
    };
    this.unsubs.push(db.doc('w/clock').onSnapshot((s: Any) => { this.gotClock = true; this.onClock(s.exists ? (s.data() as ClockDoc) : null); }, () => { this.gotClock = true; }));
    this.unsubs.push(db.doc('w/cp').onSnapshot((s: Any) => { this.gotCp = true; this.onCp(s.exists ? (s.data() as CpDoc) : null); }, () => { this.gotCp = true; }));
    this.unsubs.push(db.collection('ev').onSnapshot((q: Any) => {
      for (const ch of q.docChanges()) {
        if (ch.type === 'removed') continue;
        const d = ch.doc.data() as { cmds?: Cmd[] };
        const list = Array.isArray(d?.cmds) ? d.cmds.filter(validCmd) : [];
        this.ev.set(ch.doc.id, list);
        if (this.session && ch.doc.id !== this.uid) for (const c of list) this.session.receive(c);
      }
    }, () => { /* store unreachable: room still carries commands */ }));
    this.unsubs.push(db.collection('adm').onSnapshot((q: Any) => {
      for (const ch of q.docChanges()) {
        if (ch.type === 'removed') continue;
        const d = ch.doc.data() as { cmds?: Cmd[] };
        const list = Array.isArray(d?.cmds) ? d.cmds.filter(validAdmCmd).slice(-400) : [];
        this.adm.set(ch.doc.id, list);
        if (!this.session) continue;
        if (ch.doc.id !== this.uid) { for (const c of list) this.session.receive(c); continue; }
        // our own list from another tab or an earlier visit: keep it, so the next write does not drop it
        for (const c of list) if (!this.myAdm.some(x => x.id === c.id)) { this.myAdm.push(c); this.admOk.add(c.id); this.session.receive(c); }
      }
    }, () => { /* store unreachable */ }));
    if (room) {
      this.unsubs.push(room.on('cmd', (m: Any) => { if (!m.sameTab && validCmd(m.data)) this.session?.receive(m.data as Cmd); }));
      // editors only (the platform enforces who may emit on an admin-only topic)
      this.unsubs.push(room.on('adm', (m: Any) => { if (!m.sameTab && validAdmCmd(m.data)) this.session?.receive(m.data as Cmd); }));
      this.unsubs.push(room.onPeers((ch: Any) => {
        const n = [0, 0];
        for (const p of ch.peers) { const s = p.presence?.side; if (s === 0 || s === 1) n[s]++; }
        this.online = n;
      }));
    }
  }

  menuInfo() {
    return { available: !!this.uid, online: this.online, era: this.cp?.era ?? 1, wins: (this.cp?.wins ?? [0, 0]) as [number, number] };
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

  async join(sim: Sim, side: 0 | 1): Promise<Session | null> {
    if (!this.uid) return null;
    this.side = side;
    for (let i = 0; i < 40 && !(this.gotClock && this.gotCp); i++) await sleep(250);
    const now = Date.now();
    const backend: Backend = {
      kind: 'shared', send: c => this.send(c), checkpoint: () => { /* keeper writes */ }, close: () => this.leave(),
      presence: this.room ? roomPresence(this.room, this.uid, this.user) : undefined, // roster: src/net/presence.ts
    };
    const session = new Session(sim, backend, this.uid);
    session.lead = 6;
    let st: State, clock: ClockDoc;
    if (!this.cp) {
      if (!(await this.lease())) {
        await sleep(3000);
        if (!this.cp) return null;
        return this.join(sim, side);
      }
      sim.init((Math.random() * 2 ** 31) | 0);
      sim.st.mp = 1; sim.st.humanSide = -1;
      st = sim.snapshot();
      clock = { tick0: 0, wall0: now, gen: 1 };
      await this.writeCp(st, now, 1);
      await this.db.doc('w/clock').set(clock);
    } else {
      st = JSON.parse(this.cp.st) as State;
      const asleep = !this.clock || now - this.cp.wall > 90000;
      if (asleep && (await this.lease())) {
        clock = { tick0: this.cp.tick, wall0: now, gen: (this.clock?.gen ?? 0) + 1 };
        await this.db.doc('w/clock').set(clock);
      } else {
        if (asleep) await sleep(2500);
        clock = this.clock ?? { tick0: this.cp.tick, wall0: now, gen: 1 };
      }
    }
    this.clock = clock;
    session.reset(st, clock.tick0, clock.wall0);
    this.session = session;
    for (const [id, list] of this.ev) if (id !== this.uid) for (const c of list) if (c.t >= st.tick) session.receive(c);
    this.myCmds = (this.ev.get(this.uid) ?? []).filter(c => c.t >= st.tick);
    for (const c of this.myCmds) session.receive(c);
    // admin commands after the checkpoint (the checkpoint already folds the older ones)
    for (const [id, list] of this.adm) if (id !== this.uid) for (const c of list) if (c.t >= st.tick) session.receive(c);
    this.myAdm = (this.adm.get(this.uid) ?? []).filter(c => c.t >= st.tick);
    for (const c of this.myAdm) { this.admOk.add(c.id); session.receive(c); }
    if (this.room) this.room.presence({ side, v: 1 }).catch(() => {});
    session.submit({ k: 'join', s: side });
    return session;
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

  private async flushAdm() {
    if (this.admWriting) { this.admDirty = true; return; }
    this.admWriting = true;
    do {
      this.admDirty = false;
      const floor = (this.cp?.tick ?? 0) - 200;
      this.myAdm = this.myAdm.filter(c => c.t >= floor).slice(-300);
      const batch = [...this.myAdm];
      try {
        await this.db.doc('adm/' + this.uid).set({ cmds: batch });
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
    return {
      uid: this.uid, keeper: this.keeper, leaseAgeMs: this.lastLease ? now - this.lastLease : -1,
      cpTick: this.cp?.tick ?? -1, cpAgeMs: this.cp ? now - this.cp.wall : -1, cpWriteAgeMs: this.lastCp ? now - this.lastCp : -1,
      gen: this.clock?.gen ?? 0, online: [...this.online], admCmds: n, room: !!this.room,
    };
  }

  private forceCheckpoint(): boolean {
    const s = this.session;
    if (!this.keeper || !s || !this.clock) return false;
    const snap = s.safeSnap(60);
    if (!snap) return false;
    void this.writeCp(snap.st, this.clock.wall0 + (snap.tick - this.clock.tick0) * TICK_MS, this.clock.gen);
    return true;
  }

  private async flush() {
    if (!this.uid) return;
    if (this.writing) { this.dirty = true; return; }
    this.writing = true;
    try {
      do {
        this.dirty = false;
        const floor = (this.cp?.tick ?? 0) - 200;
        this.myCmds = this.myCmds.filter(c => c.t >= floor).slice(-300);
        await this.db.doc('ev/' + this.uid).set({ cmds: this.myCmds, side: this.side });
        await sleep(400);
      } while (this.dirty);
    } catch { /* quota or rate limit: room already delivered it to whoever is online */ }
    this.writing = false;
  }

  private async writeCp(st: State, wall: number, gen: number) {
    const body: CpDoc = { tick: st.tick, wall, gen, st: JSON.stringify(st), hash: hashState(st), era: st.era, wins: [st.sides[0].wins, st.sides[1].wins] };
    this.lastCp = Date.now();
    try { await this.db.doc('w/cp').set(body); } catch { /* try again next round */ }
  }

  tick(session: Session) {
    const now = Date.now();
    if (now - this.lastLease > (this.keeper ? 8000 : 12000)) void this.lease();
    if (this.keeper && now - this.lastCp > 15000 && this.clock) {
      const snap = session.safeSnap(60);
      if (snap) void this.writeCp(snap.st, this.clock.wall0 + (snap.tick - this.clock.tick0) * TICK_MS, this.clock.gen);
      else this.lastCp = now;
    }
    if (this.room && now - this.lastPresence > 20000) { this.lastPresence = now; this.room.presence({ side: this.side, v: 1, at: now }).catch(() => {}); }
  }

  private onClock(c: ClockDoc | null) {
    const prev = this.clock;
    this.clock = c;
    if (!c || !this.session || !prev || c.gen === prev.gen) return;
    this.resync();
  }

  private onCp(cp: CpDoc | null) {
    this.cp = cp;
    const s = this.session;
    if (!cp || !s || this.keeper || this.resyncing) return;
    const mine = s.snapAt(cp.tick);
    if (mine && hashState(mine) !== cp.hash) this.resync();
    else if (!mine && cp.tick > s.sim.st.tick + 50) this.resync();
  }

  private resync() {
    const s = this.session, cp = this.cp, clock = this.clock;
    if (!s || !cp || !clock) return;
    this.resyncing = true;
    const pending = s.allCmds().filter(c => c.t >= cp.tick);
    s.reset(JSON.parse(cp.st) as State, clock.tick0, clock.wall0);
    for (const c of pending) s.receive(c);
    for (const list of this.ev.values()) for (const c of list) if (c.t >= cp.tick) s.receive(c);
    for (const list of this.adm.values()) for (const c of list) if (c.t >= cp.tick) s.receive(c);
    this.resyncing = false;
  }

  leave() {
    if (this.room) this.room.presence({ side: null }).catch(() => {});
    this.session = null;
  }
}

/** An ordinary command from the room topic 'cmd' or ev/{uid}. Never 'adm' or 'cfg'. */
export function validCmd(c: Any): boolean {
  if (!c || typeof c !== 'object' || typeof c.t !== 'number' || typeof c.id !== 'string' || typeof c.p !== 'string') return false;
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
