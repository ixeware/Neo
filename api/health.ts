/// <reference types="node" />
// GET /api/health → { ok, redis, version, admin, ws }. The client calls it once at boot to decide
// whether the shared war runs on this server (src/net/vercel.ts). The Redis check is cached per
// instance for 15 s so page loads cost at most one PING each.
import { send, type Req, type Res } from './_lib/http.js';
import { redis } from './_lib/redis.js';
import { adminConfigured } from './_lib/admin.js';
import { API_VERSION } from './_lib/world.js';

let cache: { at: number; ok: boolean } | null = null;

async function redisOk(): Promise<boolean> {
  const r = redis();
  if (!r) return false;
  const now = Date.now();
  if (cache && now - cache.at < 15_000) return cache.ok;
  let ok = false;
  try { ok = (await r.cmd('PING')) === 'PONG'; } catch { ok = false; }
  cache = { at: now, ok };
  return ok;
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, { ok: false }); return; }
  send(res, 200, { ok: true, redis: await redisOk(), version: API_VERSION, admin: adminConfigured(), ws: true });
}
