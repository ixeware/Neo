// Upstash Redis over its REST API (plain fetch, no SDK). Every command and every command in a
// pipeline counts against the Upstash quota, so callers batch what they can and never poll blindly.
// Env (either pair; the Vercel Marketplace integration sets the KV_* names):
//   KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.

export type Arg = string | number;

export interface Redis {
  /** One command, e.g. cmd('GET', 'k'). Resolves to the REST `result` (strings, numbers, arrays, null). */
  cmd(...args: Arg[]): Promise<unknown>;
  /** Several commands in one round trip (each still counts as one command). */
  pipe(cmds: Arg[][]): Promise<unknown[]>;
}

class RestRedis implements Redis {
  constructor(private url: string, private token: string) {}

  private async post(path: string, body: unknown): Promise<unknown> {
    const r = await fetch(this.url + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });
    const j = (await r.json().catch(() => null)) as unknown;
    if (!r.ok) throw new Error(`redis http ${r.status}: ${(j as { error?: string } | null)?.error ?? ''}`);
    return j;
  }

  async cmd(...args: Arg[]): Promise<unknown> {
    const j = (await this.post('', args.map(String))) as { result?: unknown; error?: string };
    if (j.error) throw new Error('redis: ' + j.error);
    return j.result ?? null;
  }

  async pipe(cmds: Arg[][]): Promise<unknown[]> {
    if (!cmds.length) return [];
    const j = await this.post('/pipeline', cmds.map(c => c.map(String)));
    if (!Array.isArray(j)) throw new Error('redis: bad pipeline reply');
    return j.map((x: { result?: unknown; error?: string }) => {
      if (x?.error) throw new Error('redis: ' + x.error);
      return x?.result ?? null;
    });
  }
}

let current: Redis | null | undefined;

export function redis(): Redis | null {
  if (current !== undefined) return current;
  const env = process.env;
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  current = url && token ? new RestRedis(url.replace(/\/+$/, ''), token) : null;
  return current;
}

/** Tests and tools/devserver.mjs swap in an in-memory store with the same interface. */
export function setRedis(r: Redis | null) { current = r; }
