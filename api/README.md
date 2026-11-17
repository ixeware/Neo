# Vercel backend for the shared war

The game is a static Vite build (`dist/`) plus a few Node functions in `api/`. Every client runs the
same deterministic sim; the server never simulates. It **orders, stamps and stores commands**, keeps
the **world clock**, the **latest checkpoint** and the **keeper lease**, checks **admin logins**, and
relays the **roster** (who is online). Storage is Upstash Redis over its REST API (plain `fetch`, no
SDK). Without Redis the site still works: the menu says the shared war is unavailable and everyone
plays alone against the AI (progress in the browser, as before).

Client side: `src/net/vercel.ts` (`connectVercel`, `VercelWar`, `vercelAdminChannel`). `src/main.ts`
uses the artifact runtime (`src/net/shared.ts`) when it is present, else this backend when
`/api/health` answers.

## Settings to make in Vercel

| What | Value |
| --- | --- |
| Storage | Marketplace → Upstash Redis → connect to the project. It sets `KV_REST_API_URL` + `KV_REST_API_TOKEN` (the code also accepts `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`). |
| `ADMIN_PASS_HASH` | hex PBKDF2-SHA256(password, salt `vysotka-admin-v1`, 210 000 iterations, 32 bytes). For the current password it is `313e8dce89c55905201163fdcadb5eeebe0e2b27bc5b2a0f8b4ef31a7e1e7355`. To make a new one without the password landing in shell history: `node -e "process.stdin.once('data',d=>console.log(require('crypto').pbkdf2Sync(String(d).trim(),'vysotka-admin-v1',210000,32,'sha256').toString('hex')))"`, type the password, Enter. |
| `ADMIN_TOKEN_SECRET` | ≥ 16 random characters, e.g. `openssl rand -hex 32`. Changing it logs every admin out. |
| `VY_ORIGINS` (optional) | Extra origins allowed to open the WebSocket, comma separated (the site's own host is always allowed). |
| Node.js | 22.x (`engines` in package.json). |
| Functions | Fluid compute on (default for new projects). `api/ws.ts` lives until the function's max duration (Hobby: up to 300 s); clients reconnect at once and resume from their last log id. Raising the max duration in Project → Settings → Functions only reduces reconnects. |

Without `ADMIN_PASS_HASH`/`ADMIN_TOKEN_SECRET` the login answers 503 and admin commands are refused.
Env changes need a redeploy.

## Endpoints

| Path | |
| --- | --- |
| `GET /api/health` | `{ ok, redis, version: 'vy-api-2', admin, ws }`. Redis is PINGed at most every 15 s per instance. |
| `GET /api/players` | `{ roster: [{ pid, name, side, ctl?, sel? }], online: [atagi, kurchaloy], recent: [{ name, side, last }], era, wins }`. One Redis command. |
| `POST /api/admin/login` | `{ password }` → `200 { token, exp }` (12 h), `401`, `429` (5 failures per IP per 10 min), `503` (not configured). |
| `GET /api/ws` | WebSocket, the live channel (below). |
| `POST /api/poll` | HTTP fallback when WebSockets fail: `{ pid, dk, name, side, pres, since, gen, full, out: [client messages] }` → `{ msgs: [server messages] }`. ~4 Redis commands per poll, every 1–1.5 s. |

## WebSocket protocol (JSON text frames)

Client → server (`hello` first; ≤ 4 KB each except `cp`; 20 messages/s, bursts of 40):

| type | fields | |
| --- | --- | --- |
| `hello` | `pid, dk, name, side, pres, since?, gen?` | `dk` (device key, random hex, localStorage) proves the pid: the first hello binds `sha256(dk)` to it. With a valid `since` (last log id) and the same `gen` the reply is only the delta. |
| `ping` | `at` | → `pong { at, now }` (clock offset). |
| `cmd` | `c` | an ordinary command: `join {s}`, `dep {s,u,x,z}`, `vote {s,o}`, `ord {s,ids,m,x?,z?,tg?,fi?,fn?}`, `ctl {s,u,dx,dz,atk,fx?,fz?,rel?}` (plus `t, id, p`). Never `cfg`, never `adm`. |
| `adm` | `c, tok` | an admin command with the login token. |
| `cp` | `tick, hash, gen, era, wins, z` or `s` | keeper only: checkpoint (`z` = base64 gzip of the state JSON, `s` = raw JSON; ≤ 256 KB). |
| `hv` | `tick, hash` | my hash at `tick` (answer to `cpq`; −1 = no snapshot). |
| `pres` | `name?, side?, ctl?, sel?` | roster presence (`ctl` = unit id in first person, `sel` = selected units; `null` clears). |
| `resync` | | send me the full state. |
| `bye` | | leaving. |

Server → client: `state { full, pid, now, clock, cp, cmds, last, keeper, cpEvery }`, `cmds { cmds }`,
`mark { last }` (resume point), `ack { id }`, `nak { id, adm?, why }` (`id`, `pid`, `kind`, `shape`,
`tick`, `token`, `size`, `rate`, `clock`; `nak { what: 'cp', why }` for checkpoints), `cp { meta }`,
`cpq { tick }`, `keeper { on }`, `clk { clock }` (timeline re-anchored: resync), `roster { list }`,
`pong`, `err { why }` (then close: `noredis`, `owner`, `pid`, `key`, `server`).

**What the server enforces.** The command's `p` is always the sender's pid and its `id` must start with
`<pid>:` (nobody can speak for, or pre-empt the ids of, someone else). Every field is checked (sides 0/1,
integer ids and bounds, finite coordinates, `ord` modes of `src/sim/sim.ts` OrdMode, ≤ 64 ids). A command
with a field its kind does not have is **refused, not stripped**: the sender has already applied its own
copy, so what the others get must be the very same command. Ticks must be within `[now − 300, now + 60]`
(the rollback window); others are rejected. On any refusal the client takes the command back and resyncs. Admin commands need a valid token and must pass the
sim's own `validAdmCmd` (bundled into `_lib/admcheck.js` by `tools/gen-admcheck.mjs`; run
`npm run gen:api` after changing `src/sim/admin.ts` or `src/sim/defs.ts`) plus op ≤ 24 chars,
numbers finite within ±1e9, strings ≤ 600 chars, JSON ≤ 2 KB; every accepted one is written to
`vy:audit`. New command kinds must be added to `_lib/proto.ts` `checkCmd`, or the server refuses them.

**Checkpoints and the hash vote.** The keeper (lease `vy:keeper`, 60 s, renewed by every stored
checkpoint) uploads a snapshot at least 10 s old every 15 s. Before storing it the instance asks the
other sockets it holds for their hash at that tick (`cpq` → `hv`, 1.5 s). If more of them disagree with
the keeper than agree (the keeper counts as one vote), the checkpoint is refused, the lease goes to a
client of the majority, and the old keeper reloads. With only two players the keeper wins a tie.
Clients compare every stored checkpoint with their own snapshot and resync on a mismatch.
A keeper that stores nothing for ~45 s (hidden tab) loses the lease.

**Sleeping world.** When nobody has been connected for 90 s, the next joiner re-anchors the clock at
the latest checkpoint's tick (`gen` + 1, no catch-up of the sleep). As in `src/net/shared.ts`, commands
after the checkpoint are kept and replay at their own ticks on the new timeline. The keeper uploads a
last checkpoint when it leaves.

## Instances and fanout

Each function instance runs one hub (`_lib/hub.ts`). Commands accepted by an instance go to all of its
sockets at once and to the Redis log in batches: every 2 s while it is the only live instance, every
400 ms while another instance (or an HTTP-fallback client) is live. Every 5 s an instance writes
`alive` and its roster and reads `vy:w` (one pipeline, 2 commands). It reads the log only while another
instance is live: every 700 ms while that one sent commands in the last 10 s, else every 3 s. Every
writer of the log lists itself in `vy:w` first, so a lone instance never misses anything. A new
instance is noticed within ~5 s; until then its commands reach the others late and roll back (well
inside the 30 s window). The roster goes to the sockets at most twice a second; another instance's
players appear within one heartbeat (≤ 5 s).

## Redis keys

| Key | Type | |
| --- | --- | --- |
| `vy:w` | hash | `clock` (tick0, wall0, gen, seed, from, hold), `cpm` (checkpoint meta), `alive`, `p:<pid>` {name, side, last, kh}, `i:<instance>` {at, ros} |
| `vy:cp` | string | latest checkpoint (meta + `z`/`s`) |
| `vy:log` | stream | `{ i, k: 'c'|'cp'|'clk', d }`; the entry id is the global sequence; trimmed to ~30 s before the checkpoint's range |
| `vy:keeper` | string, PX 60 s | keeper pid |
| `vy:wake` | string, PX 15 s | guard while one instance creates or re-anchors the world |
| `vy:audit` | list (500) | admin logins and commands |
| `vy:fail:<ip>` | counter, PX 10 min | failed admin logins |

## Cost (Hobby + Upstash free plan), ~6 friends, ~2 h a day

Measured with `tools/vbcost.ts` against the devserver with production timings: 6 clients (3 per side),
~25 commands a minute in total plus presence changes, a checkpoint every 15 s. "Month" = 30 evenings × 2 h.

| | one function instance (the usual case) | two instances (sockets split) |
| --- | --- | --- |
| Redis commands / min | 65 (XADD 25, HSET 16, HGETALL 12, checkpoint 12) | TWO_PER_MIN |
| per evening (2 h) | 7.8k | TWO_EVENING |
| per month | **233k** | **TWO_MONTH** |
| Redis traffic / month | 0.17 GB | TWO_GB |
| hub CPU (wall-time upper bound) | ONE_CPU | TWO_CPU |

* **Upstash free plan** (500k commands a month as of 2025, 256 MB): one instance uses under half of it.
  Two instances for every evening of a month would go over it; pay-as-you-go is $0.20 per 100k commands,
  so the worst case is TWO_DOLLARS a month. Nobody connected → 0 commands (no timers run without sockets).
  The menu costs 1 command per page load (`/api/players`) plus at most one PING per 15 s per instance
  (`/api/health`). A client on the HTTP fallback (WebSocket blocked) costs ~4 commands per poll, one poll a
  second (~240 a minute) — only for that browser, only while WebSockets fail. The checkpoint blob was
  7 KB (gzip + base64) 3 minutes into a war; it grows with the number of units and is capped at 256 KB.
* **Vercel Hobby** (included per month as of 2025: 1M function invocations, 4 h Active CPU, 360 GB-h
  provisioned memory, 100 GB fast data transfer; check Settings → Usage):
  * invocations: a socket is one invocation and reconnects at most every 300 s → 6 × 24 per evening
    ≈ 4.3k a month, plus `/api/health` and `/api/players` per page load: well under 1 %.
  * Active CPU: only while code runs (WebSocket waits are free): ONE_CPU_MONTH a month measured (upper bound).
  * provisioned memory is the tightest: Hobby functions have 2 GB, billed for as long as an instance holds
    sockets. One instance 2 h a day ≈ 4 GB-h a day ≈ **120 GB-h a month (⅓ of the 360)**; two instances
    ≈ 240 GB-h. With one instance the free memory lasts ~6 h of play a day.
  * data transfer: the page is one 1.65 MB file (710 KB gzip) per load; the socket traffic is a few KB a minute.

## Local testing

```
npm run build && npx tsx tools/devserver.mjs --test --instances 2      # http://127.0.0.1:5243
npx tsx tools/vbtest.ts 5243 20       # multi-client test (two instances, ≥ 20 checkpoints, attacks, wake)
npx tsx tools/vbcost.ts 5243 150 1    # Redis commands per minute with production settings (1 or 2 instances)
node tools/gen-admcheck.mjs --check   # the bundled admin validator matches src/sim/admin.ts
# the real page in Chromium (Playwright on NODE_PATH): menu, nickname, two browsers, admin panel login
npx tsx tools/devserver.mjs --test --instances 2 --cp-every 3000 &  node tools/vbbrowser.cjs 1 5243
npx tsx tools/devserver.mjs --no-redis &  node tools/vbbrowser.cjs 2 5243   # menu: shared war unavailable
```

The devserver serves `dist/` and mounts the same handlers with an in-memory Redis (`tools/memredis.ts`,
same reply shapes as the REST API) unless the Upstash env is set. `--test` adds `POST /__test/time`
(shift server time, e.g. to fake a long sleep), `POST /__test/redis` (Redis down / latency),
`GET /__test/stats`, and test admin env defaults. Never deploy it: Vercel runs only `api/`.
