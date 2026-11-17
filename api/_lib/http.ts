// Plain Node req/res helpers, so the same handlers run on Vercel and in tools/devserver.mjs.
import type { IncomingMessage, ServerResponse } from 'node:http';

export type Req = IncomingMessage & { body?: unknown };
export type Res = ServerResponse;

export function send(res: Res, status: number, obj: unknown, cache = 'no-store') {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(body);
}

/** JSON body, at most `max` bytes. Works whether or not the platform already parsed req.body. */
export async function readJson(req: Req, max = 8192): Promise<Record<string, unknown> | null> {
  let pre: unknown;
  try { pre = req.body; } catch { return null; } // Vercel's lazy body parser throws on invalid JSON
  if (pre !== undefined && pre !== null) {
    if (typeof pre === 'object' && !Buffer.isBuffer(pre)) return pre as Record<string, unknown>;
    const s = Buffer.isBuffer(pre) ? pre.toString('utf8') : String(pre);
    if (s.length > max) return null;
    try { const j = JSON.parse(s); return j && typeof j === 'object' ? j : null; } catch { return null; }
  }
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const ch of req) {
    const b = Buffer.isBuffer(ch) ? ch : Buffer.from(ch);
    n += b.length;
    if (n > max) return null;
    chunks.push(b);
  }
  try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); return j && typeof j === 'object' ? j : null; } catch { return null; }
}

/** Client IP as Vercel reports it (it overwrites these headers at the edge). */
export function clientIp(req: IncomingMessage): string {
  const h = req.headers;
  const xr = h['x-real-ip'];
  if (typeof xr === 'string' && xr) return xr.trim();
  const xf = h['x-forwarded-for'];
  const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

export function query(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? '/', 'http://x').searchParams;
}

// Per-key (client IP) token buckets in this instance's memory: a cheap first line against floods that
// would otherwise create player records and spend Redis commands (Vercel Firewall rules can add more).
const buckets = new Map<string, { n: number; at: number }>();
/** At most `perMin` events per minute (bursts up to `perMin`) for `key`. */
export function allow(key: string, perMin: number): boolean {
  const now = Date.now();
  if (buckets.size > 20_000) for (const [k, b] of buckets) if (now - b.at > 120_000) buckets.delete(k);
  const b = buckets.get(key) ?? { n: perMin, at: now };
  b.n = Math.min(perMin, b.n + ((now - b.at) / 60_000) * perMin);
  b.at = now;
  buckets.set(key, b);
  if (b.n < 1) return false;
  b.n -= 1;
  return true;
}
