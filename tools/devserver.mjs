// Local stand-in for the Vercel deployment: serves dist/ (vite build) like the CDN (/admin → index.html)
// and mounts the very same api/ handlers and WebSocket hub, with an in-memory Redis shim unless the
// Upstash env is set. Several hubs simulate several function instances (sockets are dealt round-robin),
// so cross-instance fanout is exercised too.
//   npx tsx tools/devserver.mjs [--port 5243] [--instances 2] [--no-redis] [--test] [--cp-every 15000]
//                               [--latency 0] [--dist dist]
// --test adds POST /__test/time {off} (shift server + Redis time, e.g. to fake a long sleep),
// GET /__test/stats, POST /__test/redis {down} and admin env defaults (ADMIN_PASS_HASH of the test
// password, a random ADMIN_TOKEN_SECRET). Never deploy this file: Vercel only runs api/.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
/** hex(PBKDF2-SHA256(test password, 'vysotka-admin-v1', 210000, 32)): the hash the production env uses too. */
const TEST_PASS_HASH = '313e8dce89c55905201163fdcadb5eeebe0e2b27bc5b2a0f8b4ef31a7e1e7355';

/**
 * Start a server. opts: { port, instances, redis: true|false, test, cpEvery, latency, dist, quiet }.
 * Returns { server, url, hubs, mem, time, close() }.
 */
export async function startDevServer(opts = {}) {
  const o = { port: 5243, instances: 1, redis: true, test: false, cpEvery: 0, latency: 0, dist: 'dist', quiet: false, ...opts };
  // env first: api/_lib reads it at import
  if (o.cpEvery) process.env.VY_CP_EVERY_MS = String(o.cpEvery);
  if (o.test) {
    process.env.ADMIN_PASS_HASH ??= TEST_PASS_HASH;
    process.env.ADMIN_TOKEN_SECRET ??= randomBytes(24).toString('hex');
  }
  const useMem = o.redis && !(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);
  if (!o.redis) { delete process.env.KV_REST_API_URL; delete process.env.UPSTASH_REDIS_REST_URL; }
  const imp = p => import(pathToFileURL(join(ROOT, p)).href);
  const [{ setRedis, redis }, { time }, { Hub }, { MemRedis }] = await Promise.all([
    imp('api/_lib/redis.ts'), imp('api/_lib/time.ts'), imp('api/_lib/hub.ts'), imp('tools/memredis.ts'),
  ]);
  const mem = useMem ? new MemRedis() : null;
  if (mem) { mem.latency = o.latency; setRedis(mem); }
  else if (!o.redis) setRedis(null);
  const routes = {
    '/api/health': (await imp('api/health.ts')).default,
    '/api/players': (await imp('api/players.ts')).default,
    '/api/poll': (await imp('api/poll.ts')).default,
    '/api/admin/login': (await imp('api/admin/login.ts')).default,
  };
  const hubs = Array.from({ length: Math.max(1, o.instances) }, (_, i) => new Hub(redis, `dev${i}-` + randomBytes(3).toString('hex')));
  let deal = 0;
  const dist = resolve(ROOT, o.dist);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      const fn = routes[url.pathname];
      if (fn) { await fn(req, res); return; }
      if (url.pathname === '/api/ws') { res.statusCode = 426; res.end('WebSocket only'); return; }
      if (o.test && url.pathname.startsWith('/__test/')) { await testRoute(url, req, res); return; }
      if (url.pathname.startsWith('/api/')) { res.statusCode = 404; res.end('{"ok":false}'); return; }
      await serveStatic(url.pathname, res);
    } catch (err) {
      if (!o.quiet) console.error('[devserver]', err);
      if (!res.headersSent) { res.statusCode = 500; res.end('error'); }
    }
  });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/api/ws') { socket.destroy(); return; }
    const pick = url.searchParams.get('inst');
    const hub = pick !== null && hubs[Number(pick)] ? hubs[Number(pick)] : hubs[deal++ % hubs.length];
    hub.upgrade(req, socket, head);
  });

  async function serveStatic(path, res) {
    let p = decodeURIComponent(path);
    if (p === '/' || p === '/admin' || p.startsWith('/admin/')) p = '/index.html';
    const file = normalize(join(dist, p));
    if (!file.startsWith(dist)) { res.statusCode = 403; res.end(); return; }
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error('dir');
      res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.end(await readFile(file));
    } catch { res.statusCode = 404; res.end('not found'); }
  }

  async function testRoute(url, req, res) {
    const body = req.method === 'POST' ? await new Promise(r => { let s = ''; req.on('data', d => { s += d; }); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); }) : {};
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/__test/time') { if (typeof body.off === 'number') time.off = body.off; res.end(JSON.stringify({ off: time.off, now: time.now() })); return; }
    if (url.pathname === '/__test/redis') { if (mem && typeof body.down === 'boolean') mem.down = body.down; if (mem && typeof body.latency === 'number') mem.latency = body.latency; res.end(JSON.stringify({ down: mem?.down ?? null })); return; }
    if (url.pathname === '/__test/stats') { res.end(JSON.stringify({ redis: mem ? { count: mem.count, byCmd: mem.byCmd, bytes: mem.bytes } : null, hubs: hubs.map(h => ({ inst: h.inst, size: h.size, ...h.stats })) })); return; }
    res.statusCode = 404; res.end('{}');
  }

  await new Promise((ok, fail) => { server.once('error', fail); server.listen(o.port, '127.0.0.1', ok); });
  const url = `http://127.0.0.1:${server.address().port}`;
  if (!o.quiet) console.log(`[devserver] ${url}  instances=${hubs.length}  redis=${mem ? 'memory' : o.redis ? 'upstash' : 'none'}${o.test ? '  test hooks on' : ''}`);
  return {
    server, url, hubs, mem, time,
    close: () => new Promise(r => { for (const h of hubs) h.shutdown(); server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  const val = (name, def) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def; };
  await startDevServer({
    port: Number(val('--port', 5243)), instances: Number(val('--instances', 1)), redis: !argv.includes('--no-redis'),
    test: argv.includes('--test'), cpEvery: Number(val('--cp-every', 0)), latency: Number(val('--latency', 0)), dist: val('--dist', 'dist'),
  });
}
