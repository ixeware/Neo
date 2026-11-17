// Timeline: wall clock → sim ticks, command log, rollback on late commands, checkpoints.
import { Sim, type Cmd, type State } from '../sim/sim';
import { TICK_MS } from '../sim/defs';
import type { PresenceSource } from './presence';

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CmdBody = DistOmit<Cmd, 't' | 'id' | 'p'>;

export interface Backend {
  kind: 'local' | 'shared';
  /** Send a command to every other client (the local client already applied it). */
  send(c: Cmd): void;
  /** Persist a checkpoint (local: localStorage; shared: keeper writes it). */
  checkpoint(st: State, wall: number): void;
  close?(): void;
  /** Who is online on this transport (roster, «<ник> ведёт» tags); none = just this browser (src/net/presence.ts). */
  presence?: PresenceSource;
}

const SNAP_EVERY = 10;
const SNAP_KEEP = 40;

export class Session {
  cmds = new Map<number, Cmd[]>();
  private seen = new Set<string>();
  private snaps: { tick: number; st: State }[] = [];
  tick0 = 0; wall0 = Date.now();
  /** Game speed (local only: admin «Скорость»). tick0 may be fractional after a change of rate. */
  rate = 1;
  lead = 1;
  paused = false;
  private pauseAt = 0;
  lastCheckpoint = 0;
  catchingUp = false;
  onStep?: () => void;
  onRollback?: () => void;
  /** A command arrived for tick t, older than every snapshot kept: this world misses it (a shared war resyncs). */
  onStale?: (t: number) => void;
  private seq = 0;

  constructor(public sim: Sim, public backend: Backend, public pid: string) {}

  setClock(tick0: number, wall0: number) { this.tick0 = tick0; this.wall0 = wall0; this.rate = 1; }

  targetTick(now = Date.now()) {
    if (this.paused) now = this.pauseAt;
    return Math.floor(this.tick0 + ((now - this.wall0) * this.rate) / TICK_MS);
  }

  /** Fraction of the current tick elapsed — for render interpolation. */
  alpha(now = Date.now()) {
    if (this.paused) return 1;
    const f = this.tick0 + ((now - this.wall0) * this.rate) / TICK_MS;
    return Math.max(0, Math.min(1, f - Math.floor(f)));
  }

  /** Change the game speed from now on (×0.25..×8); the clock is re-anchored so no tick is skipped or repeated. */
  setRate(r: number) {
    if (!(r >= 0.25 && r <= 8) || r === this.rate) return;
    const now = this.paused ? this.pauseAt : Date.now();
    this.tick0 += ((now - this.wall0) * this.rate) / TICK_MS;
    this.wall0 = now;
    this.rate = r;
  }

  pause(on: boolean) {
    if (on === this.paused) return;
    if (on) { this.paused = true; this.pauseAt = Date.now(); }
    else { this.paused = false; this.wall0 += Date.now() - this.pauseAt; }
  }

  /** Stamp, apply here and send. `lead`: ticks ahead (default this.lead; admin commands in a shared war use more). */
  submit(c: CmdBody, lead = this.lead): Cmd {
    const cmd = { ...c, t: this.sim.st.tick + Math.max(1, Math.floor(lead)), id: `${this.pid}:${Date.now().toString(36)}:${(this.seq++).toString(36)}`, p: this.pid } as Cmd;
    this.insert(cmd);
    this.backend.send(cmd);
    return cmd;
  }

  /**
   * Take back an admin command that never reached the others (the store or server refused it):
   * removes it from the log and replays from before it if it was already applied. The id stays seen.
   */
  drop(id: string): boolean {
    for (const [t, l] of this.cmds) {
      const i = l.findIndex(c => c.id === id && c.k === 'adm');
      if (i < 0) continue;
      l.splice(i, 1);
      if (t < this.sim.st.tick) this.rollback(t);
      return true;
    }
    return false;
  }

  /** Admin commands keep their own id space: an ordinary command reusing an admin id cannot shadow it. */
  private key(c: Cmd) { return c.k === 'adm' ? 'adm\u0000' + c.id : c.id; }

  /** A command from elsewhere (or replayed from storage). */
  receive(c: Cmd) {
    if (this.seen.has(this.key(c))) return;
    const late = c.t < this.sim.st.tick;
    this.insert(c);
    if (late) this.rollback(c.t);
  }

  private insert(c: Cmd) {
    this.seen.add(this.key(c));
    let l = this.cmds.get(c.t);
    if (!l) this.cmds.set(c.t, (l = []));
    l.push(c);
    l.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  }

  private rollback(t: number) {
    let k = this.snaps.length - 1;
    while (k >= 0 && this.snaps[k].tick > t) k--;
    if (k < 0) { this.onStale?.(t); return; } // too old; the next checkpoint resync will fix it
    const target = this.sim.st.tick;
    this.sim.load(structuredClone(this.snaps[k].st));
    this.snaps.length = k + 1;
    this.sim.quiet = true;
    while (this.sim.st.tick < target) this.stepOnce();
    this.sim.quiet = false;
    this.onRollback?.();
  }

  private stepOnce() {
    const st = this.sim.st;
    if (st.tick % SNAP_EVERY === 0) {
      this.snaps.push({ tick: st.tick, st: this.sim.snapshot() });
      if (this.snaps.length > SNAP_KEEP) this.snaps.shift();
    }
    this.sim.step(this.cmds.get(st.tick));
    if (st.tick % 600 === 0) for (const k of this.cmds.keys()) if (k < st.tick - SNAP_EVERY * SNAP_KEEP - 50) this.cmds.delete(k);
  }

  /** Advance toward wall-clock time within a frame budget. Returns steps taken. */
  advance(budgetMs = 10): number {
    const target = this.targetTick();
    let n = 0;
    const t0 = performance.now();
    const behind = target - this.sim.st.tick;
    this.catchingUp = behind > 30;
    if (behind > 30) this.sim.quiet = true;
    while (this.sim.st.tick < target) {
      this.stepOnce();
      n++;
      if (this.sim.st.tick < target - 2) this.sim.quiet = target - this.sim.st.tick > 30;
      else this.sim.quiet = false;
      this.onStep?.();
      if ((n & 15) === 0 && performance.now() - t0 > budgetMs) break;
    }
    this.sim.quiet = false;
    return n;
  }

  /** Replace the whole world (new game or resync from a shared checkpoint). */
  reset(st: State, tick0: number, wall0: number) {
    this.sim.load(st);
    this.snaps = [];
    for (const k of this.cmds.keys()) if (k < st.tick) this.cmds.delete(k);
    this.setClock(tick0, wall0);
  }

  /** Newest kept snapshot at least `minAge` ticks old (safe to publish as a checkpoint). */
  safeSnap(minAge: number): { tick: number; st: State } | null {
    for (let k = this.snaps.length - 1; k >= 0; k--) if (this.snaps[k].tick <= this.sim.st.tick - minAge) return this.snaps[k];
    return null;
  }
  snapAt(tick: number): State | null {
    for (const s of this.snaps) if (s.tick === tick) return s.st;
    return null;
  }
  allCmds(): Cmd[] { const out: Cmd[] = []; for (const l of this.cmds.values()) out.push(...l); return out; }

  pendingCmds(): Cmd[] {
    const out: Cmd[] = [];
    for (const [t, l] of this.cmds) if (t >= this.sim.st.tick) out.push(...l);
    return out;
  }
}

// ---- local backend: the world lives in this browser and sleeps while the tab is closed
const KEY = 'vysotka.save.v1';

export function loadLocal(): { st: State; savedAt: number; pid: string; side: 0 | 1 } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j || j.st?.v !== 1) return null;
    return j;
  } catch { return null; }
}

export function clearLocal() { try { localStorage.removeItem(KEY); } catch { /* storage blocked */ } }

export class LocalBackend implements Backend {
  kind = 'local' as const;
  constructor(public pid: string, public side: 0 | 1) {}
  send() { /* single browser: nothing to broadcast */ }
  checkpoint(st: State, wall: number) {
    try { localStorage.setItem(KEY, JSON.stringify({ st, savedAt: wall, pid: this.pid, side: this.side })); } catch { /* full or blocked */ }
  }
}
