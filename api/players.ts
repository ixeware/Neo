/// <reference types="node" />
// GET /api/players → { roster, online, recent, era, wins }: who is connected right now (one line per
// player: pid, name, side, ctl? = unit id in first person, sel? = selected units), seen in the last
// 7 days (names only), and the war's score from the latest checkpoint. One Redis command.
import { send, type Req, type Res } from './_lib/http.js';
import { redis } from './_lib/redis.js';
import { readWorld, recentPlayers, rosterOf } from './_lib/world.js';

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'GET') { send(res, 405, { ok: false }); return; }
  const r = redis();
  if (!r) { send(res, 503, { ok: false, why: 'noredis', roster: [], online: [0, 0], recent: [] }); return; }
  try {
    const w = await readWorld(r);
    const roster = rosterOf(w);
    const online = [0, 0];
    for (const p of roster) if (p.side === 0 || p.side === 1) online[p.side]++;
    send(res, 200, { ok: true, roster, online, recent: recentPlayers(w), era: w.cpm?.era ?? 1, wins: w.cpm?.wins ?? [0, 0] });
  } catch {
    send(res, 502, { ok: false, why: 'redis', roster: [], online: [0, 0], recent: [] });
  }
}
