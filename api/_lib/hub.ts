/// <reference types="node" />
// One function instance's WebSocket hub. Every socket on this instance hears every accepted command
// at once (no Redis round trip); Redis is the shared, durable copy:
//   - accepted commands are appended to vy:log in batches: every 2 s while this is the only live
//     instance, every 400 ms while another instance (or an HTTP-fallback client) is live;
//   - a heartbeat every 5 s writes `alive` and this instance's roster and reads the world (other
//     instances, clock, checkpoint meta): 2 commands; it also reads the log while another instance
//     (or an HTTP-fallback client, listed as i:http:<pid>) is live — everything that writes the log
//     lists itself there first, so a lone instance never needs to read the log;
//   - between heartbeats the log is polled only while another instance is live (700 ms while it was
//     sending commands in the last 10 s, else 3 s), so a lone instance costs 0.4 Redis commands/s
//     plus its writes, and a foreign command reaches the sockets here within ~1.1 s.
// The keeper (lease vy:keeper) uploads a checkpoint every CP_EVERY_MS; before it is stored the other
// sockets on this instance are asked for their own hash at that tick and the majority wins, so one
// lying client cannot make the others adopt its state.
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { redis as defaultRedis, type Redis } from './redis.js';
import { time } from './time.js';
import { verifyToken } from './admin.js';
import { allow } from './http.js';
import { hello, stateFor, type HelloIn } from './join.js';
import { Bucket, MAX_CP_MSG, MAX_MSG, checkAdm, checkCmd, checkCp, cleanPres, validPid } from './proto.js';
import {
  CP_EVERY_MS, INST_STALE_MS, K, appendCmds, audit, holdsLease, idCmp, idNext, nowTick, parseEntries, parseWorld, releaseLease, rosterOf,
  storeCp, tryLease, type Clock, type Cmd, type CpBlob, type CpMeta, type Entry, type RosterEntry, type World,
} from './world.js';

const FLUSH_SOLO_MS = 2000, FLUSH_MULTI_MS = 400;
const BEAT_SOLO_MS = 5000, BEAT_MULTI_MS = 5000;
const POLL_FAST_MS = 700, POLL_SLOW_MS = 3000, FOREIGN_HOT_MS = 10_000;
const STEP_MS = 100;
const VOTE_MS = 1500;
const ROSTER_MIN_MS = 500;
const HELLO_TIMEOUT_MS = 10_000;
const MAX_STRIKES = 200;
const MAX_BUFFERED = 4 << 20;
/** Sockets per client IP on one instance, and hellos per IP per minute. */
const MAX_PER_IP = 24, HELLOS_PER_MIN = 40; // friends behind one home router share an IP

interface Conn {
  ws: WebSocket; ip: string; bucket: Bucket; strikes: number;
  pid: string | null; ros: RosterEntry; ready: boolean; helloBusy: boolean; queue: string[];
  keeper: boolean; lastResync: number;
  /** When this socket became keeper or last stored a checkpoint (a silent keeper is replaced). */
  keptAt: number;
}

interface Vote { c: Conn; cp: ReturnType<typeof checkCp> & object; need: Set<Conn>; got: Map<Conn, number>; timer: ReturnType<typeof setTimeout> }

/** Browsers send Origin: only this site (or VY_ORIGINS, comma separated) may open a socket. */
export function originOk(req: IncomingMessage): boolean {
  const o = req.headers.origin;
  if (!o) return true; // not a browser; it can say anything anyway
  let host: string;
  try { host = new URL(o).host; } catch { return false; }
  if (host === req.headers.host) return true;
  const extra = (process.env.VY_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return extra.some(e => e === o || e === host);
}

export class Hub {
  readonly inst: string;
  private conns = new Set<Conn>();
  private w: World | null = null;
  private pending: Cmd[] = [];
  private inflight: Cmd[] = [];
  private recent = new Map<string, number>();
  /** Every log entry up to here has been relayed to the sockets that were registered at the time. */
  private cursor: string | null = null;
  private multi = false;
  private hotUntil = 0;
  private lastBeat = 0; private lastFlush = 0; private lastPoll = 0;
  private beatSoon = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private remote: RosterEntry[] = [];
  private rosterSent = ''; private rosterAt = 0; private rosterDirty = false;
  private vote: Vote | null = null;
  private lastCpAt = 0;
  private wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CP_MSG, perMessageDeflate: false });
  private errAt = 0;
  /** Counters for tests and logs. */
  stats = { redisCmds: 0, flushes: 0, beats: 0, polls: 0, accepted: 0, rejected: 0, msgs: 0, busyMs: 0 };

  constructor(private getRedis: () => Redis | null = defaultRedis, inst?: string) {
    this.inst = inst ?? 'n' + randomBytes(5).toString('hex');
  }

  /** Serve WebSocket upgrades of `server` (only `path` when given). */
  attach(server: Server, path: string | null = null) {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (path && new URL(req.url ?? '/', 'http://x').pathname !== path) return;
      this.upgrade(req, socket, head);
    });
  }

  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    if (!originOk(req)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    this.wss.handleUpgrade(req, socket, head, ws => this.onConnection(ws, req));
  }

  get size() { return this.conns.size; }

  /** Drop every socket (tests; a real instance just ends). */
  shutdown() { for (const c of this.conns) c.ws.terminate(); }

  // ---- connections ------------------------------------------------------------------------------
  private onConnection(ws: WebSocket, req: IncomingMessage) {
    const fwd = req.headers['x-forwarded-for'];
    const ip = (typeof req.headers['x-real-ip'] === 'string' && req.headers['x-real-ip']) || (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.socket.remoteAddress || '?';
    const c: Conn = {
      ws, ip, bucket: new Bucket(), strikes: 0, pid: null, ros: { pid: '', name: '', side: -1 }, ready: false, helloBusy: false,
      queue: [], keeper: false, lastResync: 0, keptAt: 0,
    };
    if ([...this.conns].filter(o => o.ip === ip).length >= MAX_PER_IP) { ws.close(1008, 'busy'); return; }
    this.conns.add(c);
    ws.on('message', (data: RawData, bin: boolean) => this.onMessage(c, data, bin));
    ws.on('close', () => this.onClose(c));
    ws.on('error', () => { /* close follows */ });
    setTimeout(() => { if (!c.pid && ws.readyState === WebSocket.OPEN) ws.close(1008, 'hello'); }, HELLO_TIMEOUT_MS);
    this.wake();
  }

  private send(c: Conn, m: unknown) {
    if (c.ws.readyState !== WebSocket.OPEN) return;
    if (c.ws.bufferedAmount > MAX_BUFFERED) { c.ws.close(1013, 'slow'); return; }
    c.ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  }

  /** To every socket that has its state (queued for those still saying hello). */
  private broadcast(m: unknown, except: Conn | null = null) {
    const s = JSON.stringify(m);
    for (const c of this.conns) {
      if (c === except || !c.helloBusy && !c.ready) continue;
      if (c.ready) this.send(c, s); else c.queue.push(s);
    }
  }

  private strike(c: Conn, n = 1) {
    c.strikes += n;
    if (c.strikes > MAX_STRIKES) c.ws.close(1008, 'abuse');
  }

  private onMessage(c: Conn, data: RawData, bin: boolean) {
    const t0 = performance.now();
    try { this.handle(c, data, bin); } finally { this.stats.msgs++; this.stats.busyMs += performance.now() - t0; }
  }

  private handle(c: Conn, data: RawData, bin: boolean) {
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    if (bin) { this.strike(c, 5); return; }
    let m: Record<string, unknown>;
    try { m = JSON.parse(buf.toString('utf8')); } catch { this.strike(c, 5); return; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) { this.strike(c, 5); return; }
    if (m.type !== 'cp' && buf.length > MAX_MSG) { this.strike(c, 5); this.nak(c, m, 'size'); return; }
    if (!c.bucket.take()) { this.strike(c); this.nak(c, m, 'rate'); return; }
    if (m.type === 'ping') { this.send(c, { type: 'pong', at: typeof m.at === 'number' ? m.at : 0, now: time.now() }); return; }
    if (m.type === 'hello') { void this.onHello(c, m).catch(err => this.fail(c, err)); return; }
    if (!c.ready || !c.pid) return;
    switch (m.type) {
      case 'cmd': this.onCmd(c, m.c); break;
      case 'adm': this.onAdm(c, m); break;
      case 'cp': void this.onCp(c, m).catch(err => this.fail(c, err)); break;
      case 'hv': this.onVote(c, m); break;
      case 'pres': c.ros = cleanPres(m, c.ros); this.rosterDirty = true; this.wake(); break;
      case 'resync': void this.resync(c).catch(err => this.fail(c, err)); break;
      case 'bye': c.ws.close(1000, 'bye'); break;
      default: this.strike(c);
    }
  }

  private nak(c: Conn, m: Record<string, unknown>, why: string) {
    const inner = (m.c && typeof m.c === 'object' ? (m.c as Record<string, unknown>).id : undefined);
    if (m.type === 'cmd' || m.type === 'adm') this.send(c, { type: 'nak', id: typeof inner === 'string' ? inner.slice(0, 96) : null, adm: m.type === 'adm', why });
    else if (m.type === 'cp') this.send(c, { type: 'nak', what: 'cp', why });
    this.stats.rejected++;
  }

  private fail(c: Conn, err: unknown) {
    const now = Date.now();
    if (now - this.errAt > 30_000) { this.errAt = now; console.error('[vy hub]', (err as Error)?.message ?? err); }
    if (!c.ready) { this.send(c, { type: 'err', why: 'server' }); c.ws.close(1011, 'server'); }
  }

  private async onHello(c: Conn, m: Record<string, unknown>) {
    if (c.pid || c.helloBusy) return;
    if (!allow('hello:' + c.ip, HELLOS_PER_MIN)) { this.send(c, { type: 'err', why: 'rate' }); c.ws.close(1008, 'rate'); return; }
    const r = this.getRedis();
    if (!r) { this.send(c, { type: 'err', why: 'noredis' }); c.ws.close(1011, 'noredis'); return; }
    // registered for broadcasts before the read: whatever arrives meanwhile is queued, nothing is missed
    c.helloBusy = true;
    const res = await hello(r, this.inst, m as unknown as HelloIn, true, [...this.inflight, ...this.pending]);
    this.count(6);
    if (!res.ok) { c.helloBusy = false; c.queue = []; this.send(c, { type: 'err', why: res.why }); c.ws.close(1008, res.why); return; }
    if (c.ws.readyState !== WebSocket.OPEN) { c.helloBusy = false; return; }
    const pid = res.st.pid;
    c.pid = pid;
    c.ros = cleanPres(m.pres, { pid, name: res.name, side: res.side });
    if (res.event !== 'none') this.broadcast({ type: 'clk', clock: res.st.clock }, c);
    this.adoptWorld(res.w, true);
    if (this.cursor === null || idCmp(res.st.last, this.cursor) > 0 && !this.hasReady()) this.cursor = res.st.last;
    // one keeper socket per pid on this instance (two tabs of one device share the lease)
    if (res.st.keeper && [...this.conns].some(o => o !== c && o.keeper && o.pid === pid)) res.st.keeper = false;
    c.keeper = res.st.keeper;
    if (c.keeper) c.keptAt = Date.now();
    this.send(c, res.st);
    for (const q of c.queue) this.send(c, q);
    c.queue = [];
    c.ready = true; c.helloBusy = false;
    this.rosterDirty = true; this.beatSoon = true;
    this.wake();
  }

  private hasReady() { for (const c of this.conns) if (c.ready) return true; return false; }

  private onCmd(c: Conn, raw: unknown) {
    const now = this.serverTick();
    if (now === null) { this.nak(c, { type: 'cmd', c: raw }, 'clock'); return; }
    const res = checkCmd(raw, c.pid!, now);
    if (!res.ok) { this.nak(c, { type: 'cmd', c: raw }, res.why); return; }
    if (res.c.k === 'join') { c.ros = { ...c.ros, side: res.c.s as 0 | 1 }; this.rosterDirty = true; }
    this.accept(res.c, c);
    this.send(c, { type: 'ack', id: res.c.id });
  }

  private onAdm(c: Conn, m: Record<string, unknown>) {
    if (!verifyToken(m.tok)) { this.nak(c, m, 'token'); return; }
    const now = this.serverTick();
    if (now === null) { this.nak(c, m, 'clock'); return; }
    const res = checkAdm(m.c, c.pid!, now);
    if (!res.ok) { this.nak(c, m, res.why); return; }
    this.accept(res.c, c);
    this.send(c, { type: 'ack', id: res.c.id, adm: true });
    const r = this.getRedis();
    if (r) { this.count(2); void audit(r, { at: time.now(), pid: c.pid, ip: c.ip, op: res.c.op, t: res.c.t, c: res.c }).catch(() => {}); }
  }

  /** Relay to every socket here now; the log gets it at the next flush. */
  private accept(cmd: Cmd, from: Conn | null) {
    if (this.recent.has(cmd.id)) return; // a resend after a reconnect
    this.remember(cmd.id);
    this.pending.push(cmd);
    this.stats.accepted++;
    this.broadcast({ type: 'cmds', cmds: [cmd] }, from);
    this.wake();
  }

  private remember(id: string) {
    this.recent.set(id, Date.now());
    if (this.recent.size > 6000) { let n = 0; for (const k of this.recent.keys()) { this.recent.delete(k); if (++n >= 2000) break; } }
  }

  private serverTick(): number | null { return this.w?.clock ? nowTick(this.w.clock) : null; }

  private async resync(c: Conn) {
    const now = Date.now();
    if (now - c.lastResync < 2000) return;
    c.lastResync = now;
    const r = this.getRedis();
    if (!r || !this.w?.clock) return;
    const w = parseWorld(await r.cmd('HGETALL', K.w));
    this.count(3);
    if (!w.clock) return;
    this.adoptWorld(w, false);
    const st = await stateFor(r, w, c.pid!, {}, [...this.inflight, ...this.pending]);
    st.keeper = c.keeper;
    this.send(c, st);
  }

  // ---- checkpoints and the hash vote ------------------------------------------------------------
  private async onCp(c: Conn, m: Record<string, unknown>) {
    const clock = this.w?.clock;
    if (!c.keeper) { this.nak(c, m, 'keeper'); return; }
    const cp = checkCp(m);
    if (!cp || !clock) { this.nak(c, m, 'shape'); return; }
    if (cp.gen !== clock.gen) { this.nak(c, m, 'gen'); return; }
    const now = nowTick(clock);
    if (cp.tick > now || cp.tick < now - 3000 || cp.tick < clock.tick0) { this.nak(c, m, 'tick'); return; }
    const cpm = this.w!.cpm;
    if (cpm && cpm.gen === clock.gen && cp.tick <= cpm.tick) { this.nak(c, m, 'old'); return; }
    if (this.vote) { this.nak(c, m, 'busy'); return; }
    if (Date.now() - this.lastCpAt < CP_EVERY_MS / 3) { this.nak(c, m, 'early'); return; }
    this.lastCpAt = Date.now();
    const voters = [...this.conns].filter(o => o.ready && o !== c && o.pid !== c.pid);
    if (!voters.length) { await this.commit(c, cp); return; }
    const v: Vote = { c, cp, need: new Set(voters), got: new Map(), timer: setTimeout(() => void this.decide(v), VOTE_MS) };
    this.vote = v;
    for (const o of voters) this.send(o, { type: 'cpq', tick: cp.tick });
  }

  private onVote(c: Conn, m: Record<string, unknown>) {
    const v = this.vote;
    if (!v || m.tick !== v.cp.tick || !v.need.has(c)) return;
    const h = Number.isInteger(m.hash) && (m.hash as number) >= 0 && (m.hash as number) < 2 ** 32 ? (m.hash as number) : -1;
    v.got.set(c, h);
    v.need.delete(c);
    if (!v.need.size) { clearTimeout(v.timer); void this.decide(v); }
  }

  private async decide(v: Vote) {
    if (this.vote !== v) return;
    this.vote = null;
    const counts = new Map<number, Conn[]>();
    for (const [c, h] of v.got) if (h >= 0 && this.conns.has(c)) { const l = counts.get(h) ?? []; l.push(c); counts.set(h, l); }
    const agree = 1 + (counts.get(v.cp.hash)?.length ?? 0);
    let best: [number, Conn[]] | null = null;
    for (const [h, l] of counts) if (h !== v.cp.hash && (!best || l.length > best[1].length)) best = [h, l];
    if (!best || best[1].length <= agree) {
      if (this.conns.has(v.c) && v.c.keeper) await this.commit(v.c, v.cp).catch(err => this.fail(v.c, err));
      return;
    }
    // outvoted: the keeper's state is not the one the others have
    const r = this.getRedis();
    const old = v.c;
    old.keeper = false;
    this.send(old, { type: 'nak', what: 'cp', why: 'outvoted' });
    this.send(old, { type: 'keeper', on: false });
    if (!r) return;
    await releaseLease(r, old.pid!);
    this.count(2);
    const next = best[1].find(c => c.ready);
    if (next && (await tryLease(r, next.pid!))) { next.keeper = true; next.keptAt = Date.now(); this.send(next, { type: 'keeper', on: true }); }
    void this.resync(old).catch(() => {});
  }

  private async commit(c: Conn, cp: NonNullable<ReturnType<typeof checkCp>>) {
    const r = this.getRedis(), clock = this.w?.clock;
    if (!r || !clock) return;
    if (!(await holdsLease(r, c.pid!))) { c.keeper = false; this.send(c, { type: 'keeper', on: false }); return; }
    const blob: CpBlob = { tick: cp.tick, hash: cp.hash, gen: cp.gen, era: cp.era, wins: cp.wins, at: time.now(), from: '', by: c.pid!, ...(cp.z !== undefined ? { z: cp.z } : { s: cp.s }) };
    const meta = await storeCp(r, this.inst, clock, blob);
    this.count(5);
    c.keptAt = Date.now();
    if (this.w) this.w.cpm = meta;
    this.broadcast({ type: 'cp', meta });
    this.send(c, { type: 'ack', what: 'cp', tick: meta.tick });
  }

  // ---- leaving ------------------------------------------------------------------------------------
  private onClose(c: Conn) {
    if (!this.conns.delete(c)) return;
    if (this.vote) {
      if (this.vote.c === c) { clearTimeout(this.vote.timer); this.vote = null; }
      else if (this.vote.need.delete(c) && !this.vote.need.size) { clearTimeout(this.vote.timer); void this.decide(this.vote); }
    }
    if (c.ready) { this.rosterDirty = true; this.beatSoon = true; }
    if (c.keeper && c.pid) void this.handover(c.pid);
    this.wake();
  }

  /** The keeper left: free the lease and give it to someone still here. */
  private async handover(pid: string) {
    const r = this.getRedis();
    if (!r) return;
    try {
      if ([...this.conns].some(o => o.keeper && o.pid === pid)) return;
      await releaseLease(r, pid);
      this.count(2);
      await this.pickKeeper(r);
    } catch (err) { this.logErr(err); }
  }

  private async pickKeeper(r: Redis, except: Conn | null = null) {
    const next = [...this.conns].find(o => o.ready && !o.keeper && o !== except);
    if (!next) return;
    this.count(1);
    if (await tryLease(r, next.pid!)) { next.keeper = true; next.keptAt = Date.now(); this.send(next, { type: 'keeper', on: true }); }
  }

  /** A keeper that stored nothing for two rounds (hidden tab, stuck client) gives the lease to someone else. */
  private async demoteSilent(r: Redis) {
    const now = Date.now();
    for (const c of this.conns) {
      if (!c.keeper || now - c.keptAt < 2 * CP_EVERY_MS + 15_000) continue;
      c.keeper = false;
      this.send(c, { type: 'keeper', on: false });
      await releaseLease(r, c.pid!);
      this.count(2);
      await this.pickKeeper(r, c);
    }
  }

  // ---- the loop: flush, heartbeat, poll, roster -------------------------------------------------
  private wake() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.step(); }, STEP_MS);
  }

  private async step() {
    if (this.busy) { this.wake(); return; }
    this.busy = true;
    const t0 = performance.now();
    try {
      const r = this.getRedis();
      const now = Date.now();
      if (r) {
        if (this.pending.length && (now - this.lastFlush >= (this.multi ? FLUSH_MULTI_MS : FLUSH_SOLO_MS) || !this.hasReady())) await this.flush(r);
        if (this.conns.size || this.lastBeat) {
          if (!this.conns.size || this.beatSoon || now - this.lastBeat >= (this.multi ? BEAT_MULTI_MS : BEAT_SOLO_MS)) await this.beat(r);
          else if (this.multi && this.cursor && now - this.lastPoll >= (now < this.hotUntil ? POLL_FAST_MS : POLL_SLOW_MS)) await this.poll(r);
        }
      }
      if (this.rosterDirty && now - this.rosterAt >= ROSTER_MIN_MS) this.sendRoster();
    } catch (err) {
      this.logErr(err);
    } finally {
      this.busy = false;
      this.stats.busyMs += performance.now() - t0; // wall time: an upper bound of CPU with a fast Redis
    }
    if (this.conns.size || this.pending.length || this.rosterDirty) this.wake();
  }

  private logErr(err: unknown) {
    const now = Date.now();
    if (now - this.errAt > 30_000) { this.errAt = now; console.error('[vy hub]', (err as Error)?.message ?? err); }
  }

  private count(n: number) { this.stats.redisCmds += n; }

  private async flush(r: Redis) {
    const batch = this.pending;
    this.pending = [];
    this.inflight = batch;
    try {
      await appendCmds(r, this.inst, batch);
      this.count(1);
      this.stats.flushes++;
    } catch (err) {
      this.pending = batch.concat(this.pending); // try again at the next step
      throw err;
    } finally {
      this.inflight = [];
      this.lastFlush = Date.now();
    }
  }

  private localRoster(): RosterEntry[] {
    const by = new Map<string, RosterEntry>();
    for (const c of this.conns) if (c.ready && c.pid) by.set(c.pid, c.ros);
    return [...by.values()];
  }

  private async beat(r: Redis) {
    const now = time.now();
    const gone = !this.conns.size;
    const cmds: (string | number)[][] = gone
      ? [['HSET', K.w, 'alive', now], ['HDEL', K.w, 'i:' + this.inst]]
      : [['HSET', K.w, 'alive', now, 'i:' + this.inst, JSON.stringify({ at: now, ros: this.localRoster() })], ['HGETALL', K.w]];
    const poll = !gone && !!this.cursor && this.multi;
    if (poll) cmds.push(['XRANGE', K.log, idNext(this.cursor!), '+', 'COUNT', 500]);
    const needKeeper = !gone && this.hasReady() && ![...this.conns].some(c => c.keeper);
    if (needKeeper) cmds.push(['GET', K.keeper]);
    this.beatSoon = false;
    this.lastBeat = gone ? 0 : Date.now();
    const res = await r.pipe(cmds);
    this.count(cmds.length);
    this.stats.beats++;
    if (gone) { this.multi = false; this.remote = []; return; }
    this.adoptWorld(parseWorld(res[1]), false);
    if (poll) { this.lastPoll = Date.now(); this.relay(parseEntries(res[2])); }
    if (needKeeper && res[cmds.length - 1] === null) await this.pickKeeper(r);
    await this.demoteSilent(r);
  }

  private async poll(r: Redis) {
    const raw = await r.cmd('XRANGE', K.log, idNext(this.cursor!), '+', 'COUNT', 500);
    this.count(1);
    this.stats.polls++;
    this.lastPoll = Date.now();
    this.relay(parseEntries(raw));
  }

  /** Take in a fresh read of vy:w: other instances, the clock (a wake elsewhere), the checkpoint meta. */
  private adoptWorld(w: World, fromHello: boolean) {
    const prev = this.w;
    const now = time.now();
    const was = this.multi;
    this.multi = Object.entries(w.inst).some(([id, rec]) => id !== this.inst && now - rec.at < INST_STALE_MS);
    if (this.multi && !was) { this.lastPoll = 0; this.hotUntil = Date.now() + FOREIGN_HOT_MS; } // read what the other one wrote, now
    const remote = rosterOf(w, now, [], this.inst);
    if (JSON.stringify(remote) !== JSON.stringify(this.remote)) { this.remote = remote; this.rosterDirty = true; }
    if (prev?.clock && w.clock && w.clock.gen !== prev.clock.gen && !fromHello) this.broadcast({ type: 'clk', clock: w.clock });
    if (prev?.cpm && w.cpm && (w.cpm.gen < prev.cpm.gen || (w.cpm.gen === prev.cpm.gen && w.cpm.tick < prev.cpm.tick))) w.cpm = prev.cpm;
    this.w = w;
  }

  /** Log entries from other instances (ours were relayed when accepted). */
  private relay(entries: Entry[]) {
    if (!entries.length) return;
    for (const e of entries) {
      this.cursor = e.id;
      if (e.i === this.inst) continue;
      if (e.k === 'c' && Array.isArray(e.d)) {
        const fresh = (e.d as Cmd[]).filter(c => c && typeof c.id === 'string' && !this.recent.has(c.id));
        for (const c of fresh) this.remember(c.id);
        if (fresh.length) { this.hotUntil = Date.now() + FOREIGN_HOT_MS; this.broadcast({ type: 'cmds', cmds: fresh }); }
      } else if (e.k === 'cp' && e.d && typeof e.d === 'object') {
        const meta = e.d as CpMeta;
        const cur = this.w?.cpm;
        if (!cur || meta.gen > cur.gen || (meta.gen === cur.gen && meta.tick > cur.tick)) { if (this.w) this.w.cpm = meta; }
        this.broadcast({ type: 'cp', meta });
      } else if (e.k === 'clk' && e.d && typeof e.d === 'object') {
        const clock = e.d as Clock;
        if (this.w && (!this.w.clock || clock.gen > this.w.clock.gen)) { this.w.clock = clock; this.broadcast({ type: 'clk', clock }); }
      }
    }
    this.broadcast({ type: 'mark', last: this.cursor });
  }

  private sendRoster() {
    this.rosterAt = Date.now();
    this.rosterDirty = false;
    const list = rosterOf({ clock: null, cpm: null, alive: 0, players: {}, inst: {} }, time.now(), [...this.remote, ...this.localRoster()]);
    const s = JSON.stringify(list);
    if (s === this.rosterSent) return;
    this.rosterSent = s;
    this.broadcast({ type: 'roster', list });
  }
}

let shared: Hub | null = null;
/** The hub of this function instance. */
export function hub(): Hub { return (shared ??= new Hub()); }

/** Is `pid` a plausible player id? (re-exported for the HTTP handlers) */
export { validPid };
