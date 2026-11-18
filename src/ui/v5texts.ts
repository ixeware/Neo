// v5 content on screen: plugs the chat texts of src/data/v5*.ts into what the player already sees —
// building names, blurbs, jokes and the build feed (setBuildTexts), the ticker, the tips, hero lines,
// win / lose / floor / boss lines, and the «скоро в игре» teasers of «Кто есть кто».
// Call installV5Texts() once at start. The data files stay pure; the rotation counters live here.
import { TICKER, HINTS, POOLS, type Line } from '../data/lore';
import { HEROES, type HeroId } from '../data/heroes';
import { setBuildTexts, type BldFeedKind } from './buildText';
import { bldLore, bldVars, feedPool, v5at, v5fill, v5text, type FeedKey, type FeedOpt, type V5Vars } from '../data/v5lore';
import { V5_TICKER, V5_HINTS, V5_HERO_LINES, V5_WIN, V5_LOSE, V5_FLOOR_LOST, V5_BOSS, type V5Pair } from '../data/v5world';
import { V5_CHARS, V5_CHAR_ORDER, V5_SIDE_TAG, v5Bio } from '../data/v5cast';

const KIND: Record<BldFeedKind, FeedKey> = {
  built: 'built', up: 'upgraded', lost: 'towerLost', broke: 'broke', trap: 'trap', trapped: 'trapped',
  seen: 'seen', charged: 'charged', theirCharged: 'theirCharged', wave: 'wave', fire: 'fire',
};
const WALLS = new Set(['zabor', 'shlagbaum']);
const cnt = new Map<string, number>();
/** How many times this key came up before (0 the first time). */
const turn = (k: string, from = 0) => { const n = cnt.get(k) ?? from; cnt.set(k, n + 1); return n; };

/**
 * A feed line about a building: every other time one about this very building or condition (its own joke the
 * first time), otherwise a general one from a rotation that starts at a different place each visit.
 */
function buildFeed(kind: BldFeedKind, key: string, spicy: boolean, name: string, n: number, side?: number): string | null {
  const group: FeedKey = kind === 'lost' && WALLS.has(key) ? 'wallBroken' : KIND[kind];
  const lv = kind === 'up' ? n : 0;
  const vars: V5Vars = { ...bldVars(key, spicy, lv), b: name, n: n > 0 ? n : undefined };
  const opt: FeedOpt = { on: key, side: side === 0 || side === 1 ? side : undefined };
  if (kind === 'up' && n >= 3) opt.tag = 'max';
  if (kind === 'built' && turn('first') === 0) opt.tag = 'first';
  const { sp, gen } = feedPool(group, vars, opt);
  const tagged = opt.tag ? sp.filter(l => l.tag === opt.tag) : [];
  const own = tagged.length ? tagged : sp, k = turn(`${group}|${key}`);
  const l = own.length && (tagged.length > 0 || !gen.length || k % 2 === 0) ? v5at(own, k >> 1) : v5at(gen, turn(group, seed));
  return l ? v5fill(v5text(l, spicy), vars) : null;
}

let seed = 0, done = false;
const addLines = (to: Line[], more: readonly Line[]) => { const have = new Set(to.map(l => l.t)); for (const l of more) if (!have.has(l.t)) to.push(l); };
const addPair = (to: { clean: string[]; spicy: string[] }, more: V5Pair) => {
  for (const s of more.clean) if (!to.clean.includes(s)) to.clean.push(s);
  for (const s of more.spicy) if (!to.spicy.includes(s)) to.spicy.push(s);
};

/** Plug the v5 texts in. Safe to call twice. */
export function installV5Texts() {
  if (done) return;
  done = true;
  seed = Math.floor(Date.now() / 1000) % 89;
  setBuildTexts({
    text: (key, spicy) => { const b = bldLore(key, spicy); return b ? { name: b.name, card: b.card, blurb: b.blurb, full: b.full, joke: b.joke } : null; },
    feed: buildFeed,
  });
  addLines(TICKER, V5_TICKER);
  for (const h of V5_HINTS) if (!HINTS.includes(h)) HINTS.push(h);
  for (const [id, buckets] of Object.entries(V5_HERO_LINES) as [HeroId, NonNullable<(typeof V5_HERO_LINES)[HeroId]>][]) {
    const lines = HEROES[id]?.lines;
    if (!lines) continue;
    for (const [b, more] of Object.entries(buckets) as ['kill' | 'idle' | 'death' | 'steal', Line[]][]) {
      const pool = lines[b];
      if (pool) addLines(pool, more);
    }
  }
  addPair(POOLS.WIN, V5_WIN);
  addPair(POOLS.LOSE, V5_LOSE);
  POOLS.FLOOR_LOST.forEach((p, i) => addPair(p, V5_FLOOR_LOST[i]));
  POOLS.BOSS.forEach((p, i) => addPair(p, V5_BOSS[i]));
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** «Скоро в игре»: the six best new characters as cards and the rest by name, for the «Кто есть кто» page. */
export function v5SoonHtml(spicy: boolean): string {
  const best = V5_CHAR_ORDER.filter(k => V5_CHARS[k].best), rest = V5_CHAR_ORDER.filter(k => !V5_CHARS[k].best);
  const card = (k: (typeof V5_CHAR_ORDER)[number]) => {
    const c = V5_CHARS[k], tone = c.side === 'atagi' ? 0 : c.side === 'kurchaloy' ? 1 : 2;
    return `<article class="who-card paper c${tone}" style="grid-template-columns:1fr">
    <div class="who-in">
      <div class="who-h"><b class="who-n">${esc(c.name)}${c.count ? ` ×${c.count}` : ''}</b><span class="who-tag">${esc(V5_SIDE_TAG[c.side])} · скоро в игре</span></div>
      <div class="who-t">${esc(c.role)}</div>
      <p class="who-b">${esc(v5Bio(k, spicy))}</p>
      <div class="who-q">«${esc(v5text(c.quote, spicy))}»</div>
      <div class="who-m">${esc(c.ability.name)}: ${esc(c.ability.text)} Минус: ${esc(c.minus)}</div>
    </div>
  </article>`;
  };
  return `<p class="m-lead"><b>Скоро в игре.</b> Их придумал чат: типажи и приколы, ни с кого не списаны. У каждого есть минус — так в чате и просили.</p>
    <div class="who-list">${best.map(card).join('')}</div>
    <p class="m-lead">И ещё на подходе: ${rest.map(k => esc(V5_CHARS[k].name)).join(', ')}.</p>`;
}
