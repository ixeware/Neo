/// <reference types="node" />
// POST /api/admin/login { password } → 200 { token, exp } | 401 | 429 | 503.
// The password is checked with PBKDF2-SHA256 against env ADMIN_PASS_HASH (salt 'vysotka-admin-v1',
// 210 000 iterations, 32 bytes, hex); the token is HMAC-SHA256-signed with env ADMIN_TOKEN_SECRET and
// lasts 12 h. 5 failed logins per IP in 10 min → 429 until the window ends.
import { clientIp, readJson, send, type Req, type Res } from '../_lib/http.js';
import { redis } from '../_lib/redis.js';
import { adminConfigured, loginBlocked, recordFail, signToken, verifyPassword } from '../_lib/admin.js';
import { audit } from '../_lib/world.js';

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') { send(res, 405, { ok: false }); return; }
  if (!adminConfigured()) { send(res, 503, { ok: false, why: 'unconfigured' }); return; }
  const r = redis();
  const ip = clientIp(req);
  try {
    if (await loginBlocked(r, ip)) { send(res, 429, { ok: false, why: 'blocked' }); return; }
    const body = await readJson(req, 2048);
    const pw = body && typeof body.password === 'string' ? body.password : '';
    if (!(await verifyPassword(pw))) {
      await recordFail(r, ip);
      send(res, 401, { ok: false, why: 'password' });
      return;
    }
    const { token, exp } = signToken();
    if (r) await audit(r, { at: Date.now(), ev: 'login', ip }).catch(() => {});
    send(res, 200, { ok: true, token, exp });
  } catch {
    send(res, 502, { ok: false, why: 'server' });
  }
}
