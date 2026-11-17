// In-memory stand-in for Upstash Redis with the same interface as api/_lib/redis.ts (cmd / pipe) and
// the same reply shapes as the REST API, for tools/devserver.mjs and the tests. Only the commands the
// backend uses: GET SET(NX/XX/PX) DEL INCR PEXPIRE HGET HGETALL HSET HSETNX HDEL XADD(MINID) XTRIM(MINID)
// XRANGE(COUNT) LPUSH LTRIM LRANGE PING. Time comes from api/_lib/time.ts (tests shift it).
import type { Arg, Redis } from '../api/_lib/redis.js';
import { time, sleep } from '../api/_lib/time.js';

type Stream = { id: string; f: string[] }[];

const idParts = (id: string): [number, number] => { const [a, b] = id.split('-'); return [Number(a) || 0, b === undefined ? 0 : Number(b) || 0]; };
const idCmp = (a: string, b: string) => { const [am, as] = idParts(a), [bm, bs] = idParts(b); return am !== bm ? am - bm : as - bs; };

export class MemRedis implements Redis {
  private str = new Map<string, string>();
  private hash = new Map<string, Map<string, string>>();
  private streams = new Map<string, Stream>();
  private lists = new Map<string, string[]>();
  private exp = new Map<string, number>();
  private last = '0-0';
  /** Commands executed (each pipelined command counts, as Upstash bills them). */
  count = 0;
  byCmd: Record<string, number> = {};
  /** Simulated round trip per request (ms). */
  latency = 0;
  /** When true every request fails (Redis down). */
  down = false;

  async cmd(...args: Arg[]): Promise<unknown> {
    if (this.latency) await sleep(this.latency);
    if (this.down) throw new Error('redis http 503: down');
    return this.exec(args.map(String));
  }

  async pipe(cmds: Arg[][]): Promise<unknown[]> {
    if (this.latency) await sleep(this.latency);
    if (this.down) throw new Error('redis http 503: down');
    return cmds.map(c => this.exec(c.map(String)));
  }

  private alive(k: string) {
    const e = this.exp.get(k);
    if (e !== undefined && e <= time.now()) { this.del(k); }
  }

  private del(k: string): number {
    const had = this.str.delete(k) || this.hash.delete(k) || this.streams.delete(k) || this.lists.delete(k);
    this.exp.delete(k);
    return had ? 1 : 0;
  }

  private exists(k: string) { return this.str.has(k) || this.hash.has(k) || this.streams.has(k) || this.lists.has(k); }

  private nextId(): string {
    const ms = Math.max(Math.floor(time.now()), idParts(this.last)[0]);
    const [lm, ls] = idParts(this.last);
    this.last = ms === lm ? `${ms}-${ls + 1}` : `${ms}-0`;
    return this.last;
  }

  exec(a: string[]): unknown {
    const op = a[0].toUpperCase();
    this.count++;
    this.byCmd[op] = (this.byCmd[op] ?? 0) + 1;
    const k = a[1];
    if (k !== undefined) this.alive(k);
    switch (op) {
      case 'PING': return 'PONG';
      case 'GET': return this.str.get(k) ?? null;
      case 'SET': {
        let nx = false, xx = false, px = 0;
        for (let i = 3; i < a.length; i++) {
          const o = a[i].toUpperCase();
          if (o === 'NX') nx = true; else if (o === 'XX') xx = true; else if (o === 'PX') px = Number(a[++i]);
        }
        const has = this.exists(k);
        if ((nx && has) || (xx && !has)) return null;
        this.del(k);
        this.str.set(k, a[2]);
        if (px > 0) this.exp.set(k, time.now() + px);
        return 'OK';
      }
      case 'DEL': { let n = 0; for (const key of a.slice(1)) { this.alive(key); n += this.del(key); } return n; }
      case 'INCR': { const v = Number(this.str.get(k) ?? 0) + 1; this.str.set(k, String(v)); return v; }
      case 'PEXPIRE': { if (!this.exists(k)) return 0; this.exp.set(k, time.now() + Number(a[2])); return 1; }
      case 'HGET': return this.hash.get(k)?.get(a[2]) ?? null;
      case 'HGETALL': { const h = this.hash.get(k); const out: string[] = []; if (h) for (const [f, v] of h) out.push(f, v); return out; }
      case 'HSET': {
        let h = this.hash.get(k);
        if (!h) this.hash.set(k, (h = new Map()));
        let n = 0;
        for (let i = 2; i + 1 < a.length; i += 2) { if (!h.has(a[i])) n++; h.set(a[i], a[i + 1]); }
        return n;
      }
      case 'HSETNX': {
        let h = this.hash.get(k);
        if (!h) this.hash.set(k, (h = new Map()));
        if (h.has(a[2])) return 0;
        h.set(a[2], a[3]);
        return 1;
      }
      case 'HDEL': { const h = this.hash.get(k); let n = 0; if (h) for (const f of a.slice(2)) if (h.delete(f)) n++; return n; }
      case 'XADD': {
        let i = 2, minid: string | null = null;
        if (a[i].toUpperCase() === 'MINID') { minid = a[i + 1]; i += 2; }
        let id = a[i++];
        if (id === '*') id = this.nextId();
        else { if (idCmp(id, this.last) <= 0) throw new Error('ERR The ID specified in XADD is equal or smaller than the target stream top item'); this.last = id; }
        let s = this.streams.get(k);
        if (!s) this.streams.set(k, (s = []));
        s.push({ id, f: a.slice(i) });
        if (minid) this.trim(s, minid);
        return id;
      }
      case 'XTRIM': {
        const s = this.streams.get(k);
        if (!s || a[2].toUpperCase() !== 'MINID') return 0;
        return this.trim(s, a[3]);
      }
      case 'XRANGE': {
        const s = this.streams.get(k) ?? [];
        const lo = a[2], hi = a[3];
        let count = Infinity;
        if (a[4]?.toUpperCase() === 'COUNT') count = Number(a[5]);
        const out: [string, string[]][] = [];
        for (const e of s) {
          if (lo !== '-' && idCmp(e.id, lo) < 0) continue;
          if (hi !== '+' && idCmp(e.id, hi) > 0) break;
          out.push([e.id, [...e.f]]);
          if (out.length >= count) break;
        }
        return out;
      }
      case 'LPUSH': { let l = this.lists.get(k); if (!l) this.lists.set(k, (l = [])); for (const v of a.slice(2)) l.unshift(v); return l.length; }
      case 'LTRIM': {
        const l = this.lists.get(k);
        if (l) { const lo = Number(a[2]), hi = Number(a[3]); this.lists.set(k, l.slice(lo, hi < 0 ? l.length + hi + 1 : hi + 1)); }
        return 'OK';
      }
      case 'LRANGE': {
        const l = this.lists.get(k) ?? [];
        const lo = Number(a[2]), hi = Number(a[3]);
        return l.slice(lo, hi < 0 ? l.length + hi + 1 : hi + 1);
      }
      default: throw new Error('ERR unknown command ' + op);
    }
  }

  private trim(s: Stream, minid: string): number {
    let n = 0;
    while (s.length && idCmp(s[0].id, minid) < 0) { s.shift(); n++; }
    return n;
  }

  /** Test helper: raw access. */
  dump() { return { str: this.str, hash: this.hash, streams: this.streams, lists: this.lists }; }
}
