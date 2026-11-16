// Shared endless war over the artifact runtime: `db` keeps the command log, checkpoints
// and the clock; `room` carries commands fast and tells who is online. Every client runs
// the same deterministic sim, so the war is identical everywhere.
import { Session, type Backend } from './session';
import { hashState, type Cmd, type Sim, type State } from '../sim/sim';
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
  return new SharedWar(db, room, uid);
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

  constructor(private db: Any, private room: Any, private uid: string | null) {
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
    if (room) {
      this.unsubs.push(room.on('cmd', (m: Any) => { if (!m.sameTab && validCmd(m.data)) this.session?.receive(m.data as Cmd); }));
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
    const backend: Backend = { kind: 'shared', send: c => this.send(c), checkpoint: () => { /* keeper writes */ }, close: () => this.leave() };
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
    if (this.room) this.room.presence({ side, v: 1 }).catch(() => {});
    session.submit({ k: 'join', s: side });
    return session;
  }

  private send(c: Cmd) {
    if (this.room) this.room.emit('cmd', c).catch(() => {});
    this.myCmds.push(c);
    void this.flush();
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
    this.resyncing = false;
  }

  leave() {
    if (this.room) this.room.presence({ side: null }).catch(() => {});
    this.session = null;
  }
}

function validCmd(c: Any): boolean {
  if (!c || typeof c !== 'object' || typeof c.t !== 'number' || typeof c.id !== 'string' || typeof c.p !== 'string') return false;
  if (!Number.isFinite(c.t) || c.t < 0) return false;
  switch (c.k) {
    case 'join': return c.s === 0 || c.s === 1;
    case 'vote': return (c.s === 0 || c.s === 1) && Number.isInteger(c.o);
    case 'dep': return (c.s === 0 || c.s === 1) && Number.isInteger(c.u) && Number.isFinite(c.x) && Number.isFinite(c.z);
    default: return false; // cfg is local-only
  }
}
