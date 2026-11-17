// Admin login and tokens. The password is never stored: env ADMIN_PASS_HASH holds
// hex(PBKDF2-SHA256(password, 'vysotka-admin-v1', 210000 iterations, 32 bytes)).
// Tokens are 'v1.<payload>.<sig>' with sig = HMAC-SHA256(ADMIN_TOKEN_SECRET), valid 12 h.
import { pbkdf2, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { Redis } from './redis.js';
import { K } from './world.js';
import { time } from './time.js';

export const ADMIN_SALT = 'vysotka-admin-v1';
export const ADMIN_ITER = 210_000;
export const ADMIN_LEN = 32;
export const TOKEN_TTL_MS = 12 * 3600_000;
export const LOGIN_FAILS = 5, LOGIN_WINDOW_MS = 10 * 60_000;

const passHash = () => (process.env.ADMIN_PASS_HASH ?? '').trim().toLowerCase();
const secret = () => process.env.ADMIN_TOKEN_SECRET ?? '';

export const adminConfigured = () => /^[a-f0-9]{64}$/.test(passHash()) && secret().length >= 16;

export function verifyPassword(pw: string): Promise<boolean> {
  return new Promise(resolve => {
    const want = Buffer.from(passHash(), 'hex');
    if (want.length !== ADMIN_LEN || typeof pw !== 'string' || !pw || pw.length > 256) { resolve(false); return; }
    pbkdf2(pw, ADMIN_SALT, ADMIN_ITER, ADMIN_LEN, 'sha256', (err, got) => {
      resolve(!err && got.length === want.length && timingSafeEqual(got, want));
    });
  });
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (body: string) => createHmac('sha256', secret()).update(body).digest();

export function signToken(now = time.now()): { token: string; exp: number } {
  const exp = now + TOKEN_TTL_MS;
  const body = 'v1.' + b64u(JSON.stringify({ sub: 'admin', iat: now, exp, n: randomBytes(6).toString('hex') }));
  return { token: body + '.' + b64u(sign(body)), exp };
}

/** The token's expiry if it is genuine and current, else 0. */
export function verifyToken(tok: unknown, now = time.now()): number {
  if (!adminConfigured() || typeof tok !== 'string' || tok.length > 512) return 0;
  const i = tok.lastIndexOf('.');
  if (i < 0 || !tok.startsWith('v1.')) return 0;
  const body = tok.slice(0, i);
  let sig: Buffer;
  try { sig = Buffer.from(tok.slice(i + 1), 'base64url'); } catch { return 0; }
  const want = sign(body);
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return 0;
  try {
    const p = JSON.parse(Buffer.from(body.slice(3), 'base64url').toString('utf8')) as { sub?: string; exp?: number };
    return p.sub === 'admin' && typeof p.exp === 'number' && p.exp > now ? p.exp : 0;
  } catch { return 0; }
}

// Failed logins per IP: Redis when present (shared by all instances), else this instance's memory.
const memFails = new Map<string, { n: number; until: number }>();

export async function loginBlocked(r: Redis | null, ip: string): Promise<boolean> {
  if (r) return Number(await r.cmd('GET', K.fail(ip))) >= LOGIN_FAILS;
  const f = memFails.get(ip);
  return !!f && f.until > time.now() && f.n >= LOGIN_FAILS;
}

export async function recordFail(r: Redis | null, ip: string) {
  if (r) {
    const n = Number(await r.cmd('INCR', K.fail(ip)));
    if (n === 1) await r.cmd('PEXPIRE', K.fail(ip), LOGIN_WINDOW_MS);
    return;
  }
  const now = time.now(), f = memFails.get(ip);
  if (!f || f.until <= now) memFails.set(ip, { n: 1, until: now + LOGIN_WINDOW_MS });
  else f.n++;
}
