// Shared endless war on the game's own Vercel backend (api/, see api/README.md): the same surface as
// the artifact's SharedWar (src/net/shared.ts: menuInfo / join / tick / leave / admin) over a
// WebSocket to /api/ws (HTTP polling of /api/poll when WebSockets fail). The server orders and stores
// commands, keeps the clock and the latest checkpoint, and stamps every command with the sender's pid;
// every client runs the same deterministic sim. Also the online roster («кто есть кто»: onRoster /
// setPresence, the PresenceSource shape of src/net/presence.ts) and the 'vercel' admin channel.
import { Session, type Backend } from './session';
import { hashState, okPid, type Cmd, type Sim, type State } from '../sim/sim';
import { validAdmCmd } from '../sim/admin';
import { admBody, type AdminChannel } from './adminChannel';
import { validCmd, type Shared, type SharedAdmin, type SharedDebug } from './shared';
import { checkState, explained } from './guard';

/**
 * One line of the roster (the shape of src/net/presence.ts RosterEntry, where the unit-control work
 * defines PresenceSource): ctl = unit id driven in first person, sel = units selected, me = this browser.
 */
export interface RosterEntry { pid: string; name: string; side: 0 | 1 | -1; ctl?: number; sel?: number; me?: boolean }
/** src/net/presence.ts PresenceSource: what the roster panel and the «<ник> ведёт» tags read. */
export interface RosterSource {
  onRoster(cb: (list: RosterEntry[]) => void): () => void;
  setPresence(p: Partial<RosterEntry>): void;
}

interface Clock { tick0: number; wall0: number; gen: number; seed: number; from: string; hold?: number }
interface CpMeta { tick: number; hash: number; gen: number; era: number; wins: [number, number]; at: number; from: string; by: string }
interface CpBlob extends CpMeta { z?: string; s?: string }
interface StateMsg { type: 'state'; full: boolean; pid: string; now: number; clock: Clock; cp: CpBlob | null; cmds: Cmd[]; last: string; keeper: boolean; cpEvery: number }
interface Health { ok: boolean; redis: boolean; version: string; admin: boolean }
/* eslint-disable @typescript-eslint/no-explicit-any */
type Msg = Record<string, any>;

const NICK_KEY = 'vysotka.nick.v1';
const DEV_KEY = 'vysotka.device.v1';
const TOK_KEY = 'vysotka.admtok.v1';
const LEAD = 6;
const ADM_LEAD = 30; // 3 s: admin commands reach everyone before their tick (adminChannel.ts)
const PING_MS = 20_000;
const PRES_MIN_MS = 500;
const MAX_CP_BYTES = 256 * 1024;
/** A checkpoint state unpacks to at most this many characters of JSON. */
const MAX_TEXT = 1024 * 1024;
/**
 * Age (ticks) of the snapshot the keeper uploads: commands for earlier ticks have reached it by then
 * (lead 0.6 s + relay ≤ 0.7 s between instances, up to ~7 s while a new instance is being noticed).
 */
const CP_AGE = 100;

const store = (s: 'local' | 'session') => {
  const get = (): Storage | null => { try { return s === 'local' ? localStorage : sessionStorage; } catch { return null; } };
  return {
    get(k: string): string | null { try { return get()?.getItem(k) ?? null; } catch { return null; } },
    set(k: string, v: string) { try { get()?.setItem(k, v); } catch { /* blocked or full */ } },
    del(k: string) { try { get()?.removeItem(k); } catch { /* blocked */ } },
  };
};
const ls = store('local'), ss = store('session');

const hex = (n: number) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); };
const timeoutSignal = (ms: number) => (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function' ? (AbortSignal as any).timeout(ms) as AbortSignal : undefined);

/** Nickname as the server will keep it: one line of plain text, at most 24 characters. */
export function cleanNick(s: unknown): string {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const t = s.slice(0, 200).replace(/[\x00-\x1f\x7f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(t).slice(0, 24).join('').trim();
}

/** The backend is there: /api/health answers as this game's API. null on claude.ai, vite dev, file://. */
export async function connectVercel(pid: string, base = ''): Promise<VercelWar | null> {
  if (typeof fetch !== 'function' || !/^[A-Za-z0-9_-]{3,32}$/.test(pid) || !okPid(pid)) return null;
  let info: Health;
  try {
    const r = await fetch(base + '/api/health', { cache: 'no-store', signal: timeoutSignal(6000) });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    info = await r.json();
  } catch { return null; }
  if (!info || info.ok !== true || typeof info.version !== 'string' || !info.version.startsWith('vy-api')) return null;
  // the device key proves this pid to the server (first come: the server binds the pid to its hash)
  let dev: { pid?: string; dk?: string } = {};
  try { dev = JSON.parse(ls.get(DEV_KEY) ?? '{}') ?? {}; } catch { dev = {}; }
  if (dev.pid !== pid || typeof dev.dk !== 'string' || !/^[a-f0-9]{32,64}$/.test(dev.dk)) { dev = { pid, dk: hex(16) }; ls.set(DEV_KEY, JSON.stringify(dev)); }
  const war = new VercelWar(base, { ok: true, redis: info.redis === true, version: info.version, admin: info.admin === true }, pid, dev.dk!, cleanNick(ls.get(NICK_KEY)) || null);
  // the menu renders once this resolves: let it show who is online (bounded wait)
  if (war.info.redis) await Promise.race([war.fetchPlayers(), new Promise(r => setTimeout(r, 2500))]);
  return war;
}

// ---- links: WebSocket, else HTTP polling ------------------------------------------------------------
interface Link { readonly kind: 'ws' | 'http'; send(m: Msg): void; close(): void; up(): boolean }

class WsLink implements Link {
  readonly kind = 'ws' as const;
  private ws: WebSocket | null = null;
  private delay = 300;
  private closed = false;
  private openedAt = 0;
  fails = 0; everOpen = false;
  constructor(private url: string, private h: { open(): void; msg(m: Msg): void; down(): void; giveUp(): void }) { this.connect(); }
  private connect() {
    if (this.closed) return;
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { this.retry(); return; }
    this.ws = ws;
    ws.onopen = () => { this.openedAt = Date.now(); this.everOpen = true; this.fails = 0; this.h.open(); };
    ws.onmessage = e => { let m: Msg; try { m = JSON.parse(String(e.data)); } catch { return; } if (m && typeof m === 'object') this.h.msg(m); };
    ws.onclose = () => { if (this.ws !== ws) return; this.ws = null; if (!this.closed) { this.h.down(); this.retry(); } };
    ws.onerror = () => { /* close follows */ };
  }
  private retry() {
    this.fails++;
    if (!this.everOpen && this.fails >= 3) { this.closed = true; this.h.giveUp(); return; }
    // a connection that lived a while ended at the function's max duration: come back at once
    if (this.openedAt && Date.now() - this.openedAt > 20_000) this.delay = 300;
    this.openedAt = 0;
    const d = this.delay * (0.75 + Math.random() * 0.5);
    this.delay = Math.min(this.delay * 2, 30_000);
    setTimeout(() => this.connect(), d);
  }
  up() { return !!this.ws && this.ws.readyState === 1; }
  send(m: Msg) { if (this.up()) this.ws!.send(JSON.stringify(m)); }
  close() { this.closed = true; const ws = this.ws; this.ws = null; if (ws && ws.readyState <= 1) { try { ws.close(1000, 'bye'); } catch { /* gone */ } } }
}

class HttpLink implements Link {
  readonly kind = 'http' as const;
  private out: Msg[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private closed = false;
  private ok = false;
  private backoff = 0;
  full = true;
  constructor(private base: string, private who: () => Msg, private h: { open(): void; msg(m: Msg): void; down(): void }) { this.schedule(0); this.h.open(); }
  up() { return this.ok; }
  send(m: Msg) {
    if (m.type === 'hello' || m.type === 'ping' || m.type === 'hv') return; // every poll says hello; no hash votes over HTTP
    if (m.type === 'resync') { this.full = true; this.schedule(50); return; }
    this.out.push(m);
    if (this.out.length > 200) this.out.splice(0, this.out.length - 200);
    this.schedule(120);
  }
  private schedule(ms: number) {
    if (this.closed) return;
    if (this.timer) { clearTimeout(this.timer); }
    this.timer = setTimeout(() => { this.timer = null; void this.poll(); }, ms);
  }
  private async poll() {
    if (this.busy || this.closed) { if (!this.closed) this.schedule(200); return; }
    this.busy = true;
    const out = this.out; this.out = [];
    const full = this.full;
    try {
      const r = await fetch(this.base + '/api/poll', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: timeoutSignal(10_000),
        body: JSON.stringify({ ...this.who(), full, at: Date.now(), out }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !Array.isArray(j.msgs)) throw new Error(j?.why ?? 'http ' + r.status);
      this.ok = true; this.backoff = 0;
      if (full) this.full = false;
      for (const m of j.msgs) if (m && typeof m === 'object') this.h.msg(m);
    } catch (err) {
      if ((err as Error)?.message === 'owner') { this.h.msg({ type: 'err', why: 'owner' }); }
      this.out = out.filter(m => m.type !== 'bye').concat(this.out);
      if (this.ok) this.h.down();
      this.ok = false;
      this.backoff = Math.min((this.backoff || 1000) * 2, 15_000);
    } finally {
      this.busy = false;
    }
    this.schedule(this.backoff || (this.out.length ? 300 : 1000));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    const bye = { ...this.who(), out: [...this.out, { type: 'bye' }] };
    void fetch(this.base + '/api/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bye), keepalive: true }).catch(() => {});
  }
}

// ---- the war -----------------------------------------------------------------------------------------
export class VercelWar implements Shared {
  readonly kind = 'vercel' as const;
  admin: SharedAdmin;
  session: Session | null = null;
  keeper = false;
  online = [0, 0];
  roster: RosterEntry[] = [];
  /** Counters for tests and the admin panel. */
  stats = { cpOk: 0, cpBad: 0, resyncs: 0, naks: 0, states: 0, reconnects: 0, cpSent: 0, votes: 0, cpRefused: 0 };
  /** Why the last server checkpoints were refused (newest last). */
  refusals: string[] = [];
  /** Checkpoint ticks this client refused: a mismatch there does not ask for them again. */
  private refusedCp = new Set<number>();
  /** Checkpoints whose hash differed from mine: 'cpTick@myTick' (last 20). */
  badAt: string[] = [];
  /** Called when the server refused an admin command (it is taken back locally). */
  onAdmRefused?: (why: string) => void;
  /** Force HTTP polling (tests; also what a browser without WebSocket gets). */
  forceHttp = false;

  private pending: Session | null = null;
  private sim: Sim | null = null;
  private link: Link | null = null;
  private clock: Clock | null = null;
  private cpm: CpMeta | null = null;
  private last: string | null = null;
  private offset = 0; private bestRtt = Infinity; private bestAt = 0;
  private outbox = new Map<string, Msg>();
  private forgot = new Set<string>();
  private side: 0 | 1 = 0;
  private cpEvery = 15_000; private lastCp = 0; private cpBusy = false;
  private waiting: ((ok: boolean) => void) | null = null;
  private chain: Promise<void> = Promise.resolve();
  private resyncAt = 0;
  private subs = new Set<(list: RosterEntry[]) => void>();
  private pres: Partial<RosterEntry> = {}; private presDirty = false; private presAt = 0; private presTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private menu = { era: 1, wins: [0, 0] as [number, number], who: '', at: 0 };
  private tok: { token: string; exp: number } | null = null;
  private admCount = 0;
  private failWhy = '';

  constructor(readonly base: string, readonly info: Health, readonly pid: string, private dk: string, public nick: string | null) {
    try { const t = JSON.parse(ss.get(TOK_KEY) ?? 'null'); if (t && typeof t.token === 'string' && typeof t.exp === 'number') this.tok = t; } catch { /* none */ }
    this.admin = {
      canEdit: async () => this.tokenValid(),
      debug: () => this.debug(),
      forceCheckpoint: () => this.forceCheckpoint(),
      forceResync: () => this.requestResync(),
    };
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('pagehide', () => this.leave());
  }

  // ---- menu ----------------------------------------------------------------------------------------
  menuInfo() {
    if (this.info.redis && !this.link && Date.now() - this.menu.at > 15_000) void this.fetchPlayers();
    const note = this.info.redis ? undefined
      : 'Общая война сейчас недоступна: к серверу не подключена база (Upstash Redis). Играешь один против ИИ, прогресс хранится в этом браузере.';
    return {
      available: this.info.redis, online: [...this.online], era: this.cpm?.era ?? this.menu.era,
      wins: (this.cpm?.wins ?? this.menu.wins) as [number, number], note, who: this.menu.who,
    };
  }

  /** GET /api/players: who is online (menu, and the roster before joining). */
  async fetchPlayers() {
    this.menu.at = Date.now();
    try {
      const r = await fetch(this.base + '/api/players', { cache: 'no-store', signal: timeoutSignal(6000) });
      const j = await r.json();
      if (!j || j.ok !== true) return;
      if (Number.isInteger(j.era)) this.menu.era = j.era;
      if (Array.isArray(j.wins)) this.menu.wins = [Number(j.wins[0]) || 0, Number(j.wins[1]) || 0];
      if (!this.link && Array.isArray(j.roster)) this.setRoster(j.roster);
    } catch { /* offline */ }
  }

  // ---- roster («кто есть кто») ------------------------------------------------------------------------
  /**
   * Every connected player (server roster, ≤ 2 changes a second); called soon with the current list
   * and on every change. Returns the unsubscribe. Before joining it is GET /api/players.
   */
  onRoster(cb: (list: RosterEntry[]) => void): () => void {
    this.subs.add(cb);
    queueMicrotask(() => { if (this.subs.has(cb)) cb(this.roster.map(e => ({ ...e }))); });
    if (this.info.redis && !this.link && Date.now() - this.menu.at > 5000) void this.fetchPlayers();
    return () => { this.subs.delete(cb); };
  }

  /** What I do (name, side, unit in first person, selection size); sent at most twice a second. */
  setPresence(p: Partial<RosterEntry>) {
    if (p.name !== undefined) { const n = cleanNick(p.name); if (n) { this.pres.name = n; this.nick = n; ls.set(NICK_KEY, n); } }
    if (p.side === -1 || p.side === 0 || p.side === 1) this.pres.side = p.side;
    if ('ctl' in p) this.pres.ctl = Number.isInteger(p.ctl) && (p.ctl as number) > 0 ? p.ctl : undefined; // unit ids start at 1: 0 clears
    if ('sel' in p) this.pres.sel = Number.isInteger(p.sel) && (p.sel as number) > 0 ? Math.min(9999, p.sel as number) : undefined;
    this.presDirty = true;
    this.flushPres();
  }

  private flushPres() {
    if (!this.presDirty || !this.link || this.presTimer) return;
    const wait = PRES_MIN_MS - (Date.now() - this.presAt);
    if (wait > 0) { this.presTimer = setTimeout(() => { this.presTimer = null; this.flushPres(); }, wait); return; }
    this.presDirty = false; this.presAt = Date.now();
    this.link.send({ type: 'pres', ...this.presWire() });
  }

  private presWire(): Msg {
    const p = this.pres;
    return { name: p.name ?? this.nick ?? undefined, side: p.side ?? this.side, ctl: p.ctl ?? null, sel: p.sel ?? null };
  }

  private setRoster(list: unknown[]) {
    const out: RosterEntry[] = [];
    for (const e of list.slice(0, 64)) {
      const o = e as Msg;
      if (!o || typeof o.pid !== 'string' || typeof o.name !== 'string') continue;
      const r: RosterEntry = { pid: o.pid, name: cleanNick(o.name) || 'Пацан', side: o.side === 0 || o.side === 1 ? o.side : -1 };
      if (Number.isInteger(o.ctl) && o.ctl > 0) r.ctl = o.ctl;
      if (Number.isInteger(o.sel) && o.sel > 0) r.sel = Math.min(9999, o.sel);
      if (o.pid === this.pid) r.me = true;
      out.push(r);
    }
    this.roster = out;
    const n = [0, 0];
    for (const p of out) if (p.side === 0 || p.side === 1) n[p.side]++;
    this.online = n;
    this.menu.who = out.map(p => p.name).join(', ');
    for (const cb of this.subs) { try { cb(out.map(e => ({ ...e }))); } catch (err) { console.error(err); } }
  }

  // ---- joining ------------------------------------------------------------------------------------
  async join(sim: Sim, side: 0 | 1): Promise<Session | null> {
    if (!this.info.redis) return null;
    this.leave();
    this.side = side;
    this.pres.side = side;
    if (!this.nick) { this.nick = (await askNick()) || 'Пацан'; ls.set(NICK_KEY, this.nick); }
    // presence: the roster for src/net/presence.ts (Backend.presence, from the unit-control work)
    const presence: RosterSource = { onRoster: cb => this.onRoster(cb), setPresence: p => this.setPresence(p) };
    const backend: Backend & { presence: RosterSource } = {
      kind: 'shared', send: c => this.sendCmd(c), checkpoint: () => { /* the keeper uploads */ }, close: () => this.leave(), presence,
    };
    const session = new Session(sim, backend, this.pid);
    session.lead = LEAD;
    this.sim = sim; this.pending = session;
    this.last = null; this.clock = null; this.cpm = null; this.keeper = false; this.failWhy = '';
    this.outbox.clear(); this.forgot.clear();
    const ok = await new Promise<boolean>(res => {
      this.waiting = res;
      this.openLink();
      setTimeout(() => res(false), 25_000);
    });
    this.waiting = null;
    if (!ok || this.pending !== session) { if (this.pending === session) { this.pending = null; this.closeLink(); } return null; }
    this.pending = null;
    this.session = session;
    // the sim still has to catch up from the checkpoint: stamp the join at the real current tick, not
    // in the past (a command far in the past may miss checkpoints the keeper already took)
    session.submit({ k: 'join', s: side }, Math.max(0, session.targetTick() - sim.st.tick) + LEAD);
    this.presDirty = true; this.flushPres();
    return session;
  }

  /** Why the last join failed (Russian), or ''. */
  get joinError() { return this.failWhy; }

  private openLink() {
    const h = { open: () => this.onOpen(), msg: (m: Msg) => this.enqueue(m), down: () => { this.stats.reconnects++; } };
    const http = () => { this.link = new HttpLink(this.base, () => this.who(), h); };
    if (this.forceHttp || typeof WebSocket === 'undefined') { http(); }
    else {
      const loc = typeof location !== 'undefined' && /^https?:/.test(location.protocol) ? location : null;
      const origin = this.base || (loc ? loc.origin : 'http://localhost');
      const url = origin.replace(/^http/, 'ws') + '/api/ws';
      this.link = new WsLink(url, { ...h, giveUp: () => { if (this.link?.kind === 'ws') http(); } });
    }
    this.pingTimer ??= setInterval(() => { if (this.link?.up()) this.link.send({ type: 'ping', at: Date.now() }); }, PING_MS);
  }

  private closeLink() {
    this.link?.close();
    this.link = null;
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  /** Who I am and where I am: the hello (WebSocket) and every HTTP poll. */
  private who(): Msg {
    return {
      pid: this.pid, dk: this.dk, name: this.pres.name ?? this.nick ?? undefined, side: this.side, pres: this.presWire(),
      since: this.last, gen: this.clock?.gen ?? null, keeper: this.keeper,
    };
  }

  private onOpen() {
    this.link?.send({ type: 'ping', at: Date.now() });
    this.link?.send({ type: 'hello', ...this.who() });
  }

  // ---- messages from the server -------------------------------------------------------------------------
  /** Messages are handled strictly in order (a full state decodes asynchronously). */
  private enqueue(m: Msg) {
    this.chain = this.chain.then(() => this.handle(m)).catch(err => console.error('[vercel]', err));
  }

  private async handle(m: Msg) {
    const s = this.session ?? this.pending;
    switch (m.type) {
      case 'pong': this.onPong(m); break;
      case 'state': if (s) await this.onState(s, m as StateMsg); break;
      case 'cmds':
        if (s && Array.isArray(m.cmds)) for (const c of m.cmds) this.take(s, c);
        if (typeof m.last === 'string') this.mark(m.last);
        break;
      case 'mark': if (typeof m.last === 'string') this.mark(m.last); break;
      case 'ack':
        if (m.what === 'cp') break;
        if (typeof m.id === 'string') this.outbox.delete(m.id);
        break;
      case 'nak': this.onNak(m); break;
      case 'cp': if (m.meta) this.onCp(m.meta as CpMeta); break;
      case 'cpq': this.onQuestion(m); break;
      case 'clk': if (m.clock && this.clock && m.clock.gen !== this.clock.gen) this.requestResync(); break;
      case 'keeper':
        this.keeper = m.on === true;
        if (this.keeper) this.lastCp = Date.now() - this.cpEvery + 3000;
        break;
      case 'roster': if (Array.isArray(m.list)) this.setRoster(m.list); break;
      case 'err':
        this.failWhy = m.why === 'owner' ? 'Этот игрок уже занят на другом устройстве' : m.why === 'noredis' ? 'На сервере нет базы' : 'Сервер не пустил';
        if (this.waiting && (m.why === 'owner' || m.why === 'noredis' || m.why === 'pid' || m.why === 'key')) { this.waiting(false); this.closeLink(); }
        break;
    }
  }

  private mark(id: string) {
    if (!this.last || idCmp(id, this.last) > 0) this.last = id;
  }

  private onPong(m: Msg) {
    const now = Date.now();
    if (typeof m.now !== 'number' || typeof m.at !== 'number' || m.at <= 0 || m.at > now) return;
    const rtt = now - m.at;
    // keep the best (lowest round trip) sample; let it age so a changed clock is noticed
    if (rtt > this.bestRtt * 1.5 + 20 && now - this.bestAt < 120_000) return;
    this.bestRtt = rtt; this.bestAt = now;
    const off = m.now + rtt / 2 - now;
    const moved = Math.abs(off - this.offset);
    this.offset = off;
    const s = this.session;
    if (s && this.clock && moved > 150) s.setClock(this.clock.tick0, this.clock.wall0 - this.offset);
  }

  private async onState(s: Session, st: StateMsg) {
    this.stats.states++;
    if (!st.clock || typeof st.clock.gen !== 'number') return;
    if (this.bestRtt === Infinity && typeof st.now === 'number') this.offset = st.now - Date.now();
    this.clock = st.clock;
    this.keeper = st.keeper === true;
    if (Number.isFinite(st.cpEvery) && st.cpEvery >= 500) this.cpEvery = st.cpEvery;
    if (this.keeper) this.lastCp = Date.now() - this.cpEvery + 3000;
    if (st.full) {
      // refused: a running world stays as it is; a joiner has nothing to start from yet (the next checkpoint may do)
      if (!(await this.reset(s, st))) { if (!(st.cp && this.refusedCp.has(st.cp.tick))) this.requestResync(); return; }
    } else for (const c of st.cmds ?? []) this.take(s, c);
    if (typeof st.last === 'string') this.last = st.last;
    if (st.cp) this.cpm = { ...st.cp, z: undefined, s: undefined } as CpMeta;
    // what the server never acknowledged goes again (it drops duplicates; so does the session)
    for (const m of this.outbox.values()) this.link?.send(m);
    this.presDirty = true; this.flushPres();
    if (this.waiting) this.waiting(true);
  }

  /** Reset to the checkpoint (or the genesis of the clock's seed) and replay the commands after it. */
  private async reset(s: Session, st: StateMsg): Promise<boolean> {
    let state: State;
    if (st.cp) {
      const refuse = (why: string) => { // and never asked for again: the server would hand the same one back
        this.refusedCp.add(st.cp!.tick);
        this.stats.cpRefused++;
        this.refusals.push(`${st.cp!.tick}: ${why}`);
        if (this.refusals.length > 20) this.refusals.shift();
        return false;
      };
      try { state = await decodeState(st.cp); } catch { return refuse('decode'); }
      // shape, size, hash, and it must load and run in a throwaway Sim before this one takes it
      const why = state.tick !== st.cp.tick ? 'tick' : checkState(state, (this.sim ?? s.sim).terrain, st.cp.hash);
      if (why) return refuse(why);
      // it contradicts a world this client computed itself: only if the difference is explainable
      // (no admin toggles, money or floors from nowhere); else keep mine and do not ask again
      const mine = s.snapAt(st.cp.tick);
      if (mine && hashState(mine) !== st.cp.hash) {
        const t = st.cp.tick;
        const adm = s.allCmds().some(c => c.k === 'adm' && c.t >= t - 600 && c.t <= t);
        const odd = explained(mine, state, 400, adm);
        if (odd) return refuse(odd);
      }
    } else {
      const sim = this.sim ?? s.sim;
      sim.init(st.clock.seed);
      sim.st.mp = 1; sim.st.humanSide = -1;
      state = sim.snapshot();
    }
    for (const [t, l] of s.cmds) {
      const keep = l.filter(c => !this.forgot.has(c.id));
      if (keep.length !== l.length) { if (keep.length) s.cmds.set(t, keep); else s.cmds.delete(t); }
    }
    const incoming = (st.cmds ?? []).filter(okCmd);
    unsee(s, incoming);
    if (!safeReset(s, state, st.clock.tick0, st.clock.wall0 - this.offset)) return false;
    for (const c of incoming) this.take(s, c);
    return true;
  }

  private take(s: Session, c: unknown) {
    if (!okCmd(c) || this.forgot.has(c.id)) return;
    if (c.k === 'adm') this.admCount++;
    s.receive(c);
  }

  private onNak(m: Msg) {
    this.stats.naks++;
    if (m.what === 'cp') { if (m.why === 'keeper' || m.why === 'outvoted') this.keeper = false; return; }
    const id = typeof m.id === 'string' ? m.id : null;
    if (!id) return;
    this.outbox.delete(id);
    if (m.adm) {
      this.session?.drop(id);
      const why = m.why === 'token' ? 'Вход на сервер истёк или не принят: войди снова' : m.why === 'tick' ? 'Команда опоздала: сервер её не принял' : `Сервер не принял команду (${String(m.why).slice(0, 20)})`;
      if (m.why === 'token') this.logout();
      this.onAdmRefused?.(why);
      return;
    }
    // an ordinary command nobody else will see: take it back here and reload the world from the server
    this.forgot.add(id);
    this.requestResync();
  }

  private onCp(meta: CpMeta) {
    if (!meta || !Number.isInteger(meta.tick) || !this.clock || meta.gen !== this.clock.gen) return;
    if (!this.cpm || meta.tick > this.cpm.tick || meta.gen !== this.cpm.gen) this.cpm = meta;
    const s = this.session;
    if (!s || this.keeper) return;
    const mine = s.snapAt(meta.tick);
    if (mine) {
      if (hashState(mine) === meta.hash) this.stats.cpOk++;
      else { this.stats.cpBad++; this.badAt.push(`${meta.tick}@${s.sim.st.tick}`); if (this.badAt.length > 20) this.badAt.shift(); if (!this.refusedCp.has(meta.tick)) this.requestResync(); }
    } else if (meta.tick > s.sim.st.tick + 50) this.requestResync();
  }

  /** The server asks for my hash at a checkpoint tick before it stores the keeper's checkpoint. */
  private onQuestion(m: Msg) {
    const s = this.session;
    if (!s || !Number.isInteger(m.tick)) return;
    const mine = s.snapAt(m.tick);
    this.stats.votes++;
    this.link?.send({ type: 'hv', tick: m.tick, hash: mine ? hashState(mine) : -1 });
  }

  private requestResync() {
    const now = Date.now();
    if (now - this.resyncAt < 2000 || !this.link) return;
    this.resyncAt = now;
    this.stats.resyncs++;
    this.link.send({ type: 'resync' });
  }

  // ---- sending ---------------------------------------------------------------------------------------
  private sendCmd(c: Cmd) {
    if (c.k === 'cfg') return; // never leaves this browser
    let m: Msg;
    if (c.k === 'adm') {
      if (!this.tokenValid()) { queueMicrotask(() => { this.session?.drop(c.id); this.onAdmRefused?.('Нет входа на сервер: введи пароль админа'); }); return; }
      m = { type: 'adm', c, tok: this.tok!.token };
    } else m = { type: 'cmd', c };
    this.outbox.set(c.id, m);
    if (this.outbox.size > 500) this.outbox.delete(this.outbox.keys().next().value!);
    this.link?.send(m);
  }

  /** Called every frame by main.ts while this war is played: the keeper's checkpoint and presence. */
  tick(session: Session) {
    const now = Date.now();
    if (this.keeper && !this.cpBusy && this.clock && this.link?.up() && now - this.lastCp > this.cpEvery) {
      this.lastCp = now;
      const snap = session.safeSnap(CP_AGE);
      if (snap) void this.uploadCp(snap);
      else this.lastCp = now - this.cpEvery + 2000;
    }
    if (this.presDirty) this.flushPres();
  }

  private async uploadCp(snap: { tick: number; st: State }, link: Link | null = this.link) {
    if (this.cpBusy || !this.clock || !link) return;
    this.cpBusy = true;
    try {
      const st = snap.st, body = JSON.stringify(st);
      const z = await gzipB64(body);
      const payload = z !== null && z.length < body.length ? { z } : { s: body };
      if ((payload.z ?? payload.s)!.length > MAX_CP_BYTES) return;
      link.send({ type: 'cp', tick: snap.tick, hash: hashState(st), gen: this.clock.gen, era: st.era, wins: [st.sides[0].wins, st.sides[1].wins], ...payload });
      this.stats.cpSent++;
    } finally {
      this.cpBusy = false;
    }
  }

  private forceCheckpoint(): boolean {
    const s = this.session;
    if (!this.keeper || !s) return false;
    const snap = s.safeSnap(CP_AGE);
    if (!snap) return false;
    this.lastCp = Date.now();
    void this.uploadCp(snap);
    return true;
  }

  leave() {
    const s = this.session ?? this.pending;
    this.session = null; this.pending = null;
    if (this.waiting) this.waiting(false);
    const link = this.link;
    if (!link) return;
    this.link = null;
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    const wasKeeper = this.keeper;
    this.keeper = false;
    const done = () => { link.send({ type: 'bye' }); link.close(); };
    // the keeper leaves a fresh checkpoint behind, so a sleeping world loses as little as possible
    const snap = wasKeeper && s ? s.safeSnap(CP_AGE) : null;
    if (snap && this.clock && link.up()) void this.uploadCp(snap, link).finally(() => setTimeout(done, 300));
    else done();
    this.setRoster([]);
  }

  // ---- admin -------------------------------------------------------------------------------------
  tokenValid(): boolean { return !!this.tok && this.tok.exp > Date.now() + 5000; }

  /** POST /api/admin/login: null = logged in, else a Russian reason. */
  async login(password: string): Promise<string | null> {
    if (!this.info.admin) return 'Вход админа на сервере не настроен';
    try {
      const r = await fetch(this.base + '/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: timeoutSignal(15_000),
        body: JSON.stringify({ password }),
      });
      const j = await r.json().catch(() => null);
      if (r.status === 200 && j && typeof j.token === 'string' && typeof j.exp === 'number') {
        this.tok = { token: j.token, exp: j.exp - Math.max(0, this.offset) };
        ss.set(TOK_KEY, JSON.stringify(this.tok));
        return null;
      }
      if (r.status === 401) return 'Неверный пароль';
      if (r.status === 429) return 'Пять ошибок: сервер закрыл вход на 10 минут';
      if (r.status === 503) return 'Вход админа на сервере не настроен';
      return 'Сервер не ответил';
    } catch { return 'Сервер не ответил'; }
  }

  logout() { this.tok = null; ss.del(TOK_KEY); }

  private debug(): SharedDebug {
    const now = Date.now();
    return {
      uid: this.pid, keeper: this.keeper, leaseAgeMs: -1,
      cpTick: this.cpm?.tick ?? -1, cpAgeMs: this.cpm ? Math.max(0, now - (this.cpm.at - this.offset)) : -1,
      cpWriteAgeMs: this.lastCp ? now - this.lastCp : -1, gen: this.clock?.gen ?? 0, online: [...this.online],
      admCmds: this.admCount, room: this.link?.kind === 'ws',
    };
  }
}

/** The admin channel of the online war: server login, every command carries the login token. */
export function vercelAdminChannel(t: VercelWar): AdminChannel {
  const ch: AdminChannel = {
    kind: 'vercel',
    async check() {
      if (!t.info.redis) return 'Онлайн-война недоступна: на сервере нет базы';
      if (!t.info.admin) return 'Вход админа на сервере не настроен';
      if (!t.session) return 'Сначала войди в онлайн-войну';
      return t.tokenValid() ? null : 'Войди на сервер: пароль админа';
    },
    login: pw => t.login(pw),
    logout: () => t.logout(),
    send(cmd) {
      const s = t.session, b = admBody(cmd);
      if (!s || !b) return;
      if (!t.tokenValid()) { ch.onRefused?.('Нет входа на сервер: введи пароль админа'); return; }
      s.submit(b, Math.max(s.lead, ADM_LEAD)); // → VercelWar.sendCmd: { type: 'adm', c, tok }; refused → Session.drop + onRefused
    },
  };
  t.onAdmRefused = why => ch.onRefused?.(why);
  return ch;
}

// ---- helpers -------------------------------------------------------------------------------------
/** A command the server relayed: an integer tick, a player id that is never a prototype key, and the shape of its kind. */
function okCmd(c: unknown): c is Cmd {
  if (!c || typeof c !== 'object') return false;
  const o = c as Msg;
  if (!Number.isInteger(o.t) || o.t < 0 || typeof o.id !== 'string' || !okPid(o.p) || typeof o.k !== 'string' || o.k === 'cfg') return false;
  return o.k === 'adm' ? validAdmCmd(o) : validCmd(o);
}

/** Replace the session's world; a state that does not load leaves the old one in place. Never throws. */
function safeReset(s: Session, st: State, tick0: number, wall0: number): boolean {
  let prev: State | null = null;
  try { prev = s.sim.st ? s.sim.snapshot() : null; } catch { prev = null; }
  try {
    s.reset(st, tick0, wall0);
    return true;
  } catch (err) {
    console.error('[vercel] reset refused', err);
    if (prev) { try { s.sim.load(prev); } catch { /* nothing better to do */ } }
    return false;
  }
}

function idCmp(a: string, b: string): number {
  const [am, as] = a.split('-').map(Number), [bm, bs] = b.split('-').map(Number);
  return am !== bm ? am - bm : as - bs;
}

/**
 * Session remembers every command id it ever saw and prunes old commands from its log; a full reset to
 * an older checkpoint must be able to take such commands again.
 */
function unsee(s: Session, cmds: Cmd[]) {
  const seen = (s as unknown as { seen?: unknown }).seen;
  if (!(seen instanceof Set)) return;
  const have = new Set<string>();
  for (const l of s.cmds.values()) for (const c of l) have.add(c.id);
  const nul = String.fromCharCode(0);
  for (const c of cmds) if (!have.has(c.id)) { seen.delete(c.id); seen.delete('adm' + nul + c.id); }
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function gzipB64(text: string): Promise<string | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return b64(new Uint8Array(await new Response(stream).arrayBuffer()));
  } catch { return null; }
}

async function decodeState(cp: CpBlob): Promise<State> {
  let text: string;
  if (typeof cp.s === 'string') text = cp.s;
  else {
    const bin = atob(cp.z ?? '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // read at most MAX_TEXT characters of output: a small gzip can unpack to gigabytes
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const dec = new TextDecoder();
    text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      if (text.length > MAX_TEXT) { void reader.cancel().catch(() => {}); throw new Error('checkpoint too big'); }
    }
    text += dec.decode();
  }
  if (text.length > MAX_TEXT) throw new Error('checkpoint too big');
  const st = JSON.parse(text) as State;
  if (!st || typeof st !== 'object' || st.v !== 1 || !Array.isArray(st.units)) throw new Error('bad checkpoint');
  return st;
}

/** First join on this device: ask for a nickname (plain text, ≤ 24 characters). */
function askNick(): Promise<string> {
  if (typeof document === 'undefined' || !document.body) return Promise.resolve('');
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.id = 'vy-nick-wrap';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(20,22,34,.45);padding:16px';
    const card = document.createElement('form');
    card.style.cssText = 'background:#fbf8f0;color:#1d1d25;border-radius:12px;padding:18px 18px 16px;width:100%;max-width:340px;box-shadow:0 10px 30px rgba(0,0,0,.25);font:15px/1.4 "Golos Text",system-ui,sans-serif';
    const h = document.createElement('h4');
    h.textContent = 'Как тебя звать?';
    h.style.cssText = 'margin:0 0 6px;font:600 18px/1.2 Unbounded,"Golos Text",system-ui,sans-serif';
    const p = document.createElement('p');
    p.textContent = 'Ник увидят все в онлайн-войне. До 24 символов.';
    p.style.cssText = 'margin:0 0 12px;opacity:.75';
    const inp = document.createElement('input');
    inp.id = 'vy-nick'; inp.maxLength = 24; inp.placeholder = 'Ник';
    inp.style.cssText = 'width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:10px 12px;border:2px solid #1d1d25;border-radius:8px;background:#fff;color:inherit';
    const ok = document.createElement('button');
    ok.id = 'vy-nick-ok'; ok.type = 'submit'; ok.textContent = 'В бой';
    ok.style.cssText = 'margin-top:12px;width:100%;min-height:44px;font:600 16px "Golos Text",system-ui,sans-serif;border:0;border-radius:8px;background:#1d1d25;color:#fbf8f0;cursor:pointer';
    card.append(h, p, inp, ok);
    wrap.append(card);
    document.body.append(wrap);
    setTimeout(() => inp.focus(), 30);
    card.addEventListener('submit', e => { e.preventDefault(); const n = cleanNick(inp.value); wrap.remove(); resolve(n); });
    inp.addEventListener('keydown', e => { if (e.key === 'Escape') { wrap.remove(); resolve(''); } });
  });
}
