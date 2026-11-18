// 18+ off: every text a clean-mode player can be shown, from the data modules, checked for tobacco, nicotine,
// swearing and the other 18+ words. Lines marked spicy are skipped (they never show with the layer off);
// strings that pass through clean18() (sim blurbs, hints) are checked after it.
// Run: npx tsx tools/cleanscan.ts   (exit 1 on a hit)
import * as heroes from '../src/data/heroes';
import * as lore from '../src/data/lore';
import * as places from '../src/data/places';
import { UNITS, CARDS, BUILDINGS, bldStats } from '../src/sim/defs';
import { readFileSync } from 'node:fs';
import * as v5lore from '../src/data/v5lore';
import * as v5cast from '../src/data/v5cast';
import * as v5world from '../src/data/v5world';
import { installV5Texts } from '../src/ui/v5texts';
import { bldText, bldFeed, type BldFeedKind } from '../src/ui/buildText';

// the v5 chat content appends to TICKER, HINTS, the hero pools and the win / lose / boss pools: scan them as shown
installV5Texts();

const BAD = /(^|[^а-яё])(кур(ени|ит|ят(?!ник)|ил|ю(?![а-яё]))|покур|закур|сигар|табак|никотин|снюс|вейп|кальян|отходняк|бля|ху[йеёя]|пизд|еба|ёба|ебл|выеб|заеб|сука|суки|сучк|жоп|член(?!ами группы)|говн|дерьм|педик|гей(?![а-яё])|девствен|нахер|похер|срать|ссать)|LOOP|[Бб]амб(?![а-яё])/i;
// v5 texts are checked harder: swearing behind a prefix («нихуя», «разъебал»), insults, and the words whose
// clean twins the content plan fixed
const BAD5 = /(^|[^а-яё])((на|по|ни|за|до|от|вы|у|о|разъ|объ|съ)?(ху[йеёяи]|[её]б[аеиуёл]|пизд)|хул[еи](?![а-яё])|мраз|долбо[её]б|моч[аеуи](?![а-яё])|навоз)/i;
const hits: string[] = [];
const seen = new WeakSet<object>();
function walk(v: unknown, path: string, spicyCtx: boolean, strict = false) {
  if (typeof v === 'string') {
    if (!spicyCtx && (BAD.test(v) || (strict && BAD5.test(v)))) hits.push(`${path}: ${v.slice(0, 120)}`);
    return;
  }
  if (!v || typeof v !== 'object' || typeof v === 'function') return;
  if (seen.has(v as object)) return;
  seen.add(v as object);
  if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, spicyCtx, strict)); return; }
  const o = v as Record<string, unknown>;
  const spicy = spicyCtx || o.spicy === true;
  for (const [k, x] of Object.entries(o)) {
    // fields that only show with the 18+ layer on
    if (/^spicy/.test(k) || k === 'spicy18') continue;
    // сход cards (CARD_TEXT): title / quote are the 18+ text when a clean twin exists
    if ((k === 'title' && 'cleanTitle' in o) || (k === 'quote' && 'cleanQuote' in o && (o.quote as { spicy?: boolean })?.spicy)) continue;
    walk(x, `${path}.${k}`, spicy, strict);
  }
}
for (const [name, v] of Object.entries(heroes)) walk(v, `heroes.${name}`, false);
for (const [name, v] of Object.entries(lore)) if (name !== 'HINTS') walk(v, `lore.${name}`, false);
for (const [name, v] of Object.entries(places)) walk(v, `places.${name}`, false);
// texts that the UI passes through clean18()
lore.HINTS.forEach((h, i) => { const t = lore.clean18(h, false); if (BAD.test(t)) hits.push(`lore.HINTS[${i}] (after clean18): ${t}`); });
UNITS.forEach((u, i) => u?.blurb?.forEach((b, s) => { const t = lore.clean18(b, false); if (BAD.test(t)) hits.push(`UNITS[${i}].blurb[${s}] (after clean18): ${t}`); }));
UNITS.forEach((u, i) => u?.name?.forEach((b, s) => { if (BAD.test(b)) hits.push(`UNITS[${i}].name[${s}]: ${b}`); }));
// сход cards: clean titles (the 18+ ones live in spicy18 / CARD_TEXT spicy fields)
CARDS.forEach((c, i) => { const L = heroes.cardLore(i, false); const t = L ? `${L.title} ${L.desc} ${L.quote && !L.quote.spicy ? L.quote.t : ''}` : `${c.title ?? ''} ${c.quote ?? ''}`; if (BAD.test(t)) hits.push(`CARDS[${i}] clean: ${t.slice(0, 120)}`); });
// base buildings: names, blurbs and stat labels (the 18+ names live in spicy18), and every Russian string of the sim's
// building module (deny reasons shown to clean-mode players too)
BUILDINGS.forEach((d, i) => {
  for (const t of [d.name, d.blurb, ...[1, 2, 3].flatMap(lv => bldStats(i, lv).flat())]) if (BAD.test(t)) hits.push(`BUILDINGS[${i}] ${d.key}: ${t.slice(0, 120)}`);
});
for (const f of ['src/sim/bld.ts', 'src/ui/build.ts', 'src/ui/buildText.ts', 'src/ui/v5texts.ts']) { // + the build mode's own lines
  const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  for (const m of src.matchAll(/(['`])((?:(?!\1)[^\\\n]|\\.)*[А-Яа-яЁё](?:(?!\1)[^\\\n]|\\.)*)\1/g)) if (BAD.test(m[2]) || BAD5.test(m[2])) hits.push(`${f}: ${m[2].slice(0, 120)}`);
}
// v5 chat content (src/data/v5*.ts): clean by default, the 18+ twins live in spicy* fields and spicy: true lines
for (const [mod, exp] of [['v5lore', v5lore], ['v5cast', v5cast], ['v5world', v5world]] as const) {
  for (const [name, v] of Object.entries(exp)) walk(v, `${mod}.${name}`, false, true);
}
// … and what the build mode really shows with the layer off: names, blurbs, jokes, and feed lines of every kind
const KINDS: BldFeedKind[] = ['built', 'up', 'lost', 'broke', 'trap', 'trapped', 'seen', 'charged', 'theirCharged', 'wave', 'fire'];
let shown = 0;
BUILDINGS.forEach((d, i) => {
  const t = bldText(i, false), lines = [t.name, t.blurb, t.full ?? '', t.joke ?? ''];
  for (const k of KINDS) for (let n = 0; n < 8; n++) lines.push(bldFeed(k, i, false, n % 4, n % 2));
  for (const x of lines) { shown++; if (BAD.test(x) || BAD5.test(x) || /[{}]|undefined/.test(x)) hits.push(`build texts ${d.key} (clean): ${x.slice(0, 120)}`); }
});
// a twin that says the same as the clean line is a mistake; so is an 18+ twin with nothing 18+ in it
const twins = (v: unknown, path: string) => {
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) { v.forEach((x, i) => twins(x, `${path}[${i}]`)); return; }
  const o = v as Record<string, unknown>;
  for (const [k, x] of Object.entries(o)) {
    const m = /^spicy([A-Z]\w*)$/.exec(k);
    if (m && typeof x === 'string') { const c = o[m[1][0].toLowerCase() + m[1].slice(1)]; if (c === x) hits.push(`${path}.${k}: same as its clean twin`); }
    else twins(x, `${path}.${k}`);
  }
};
for (const [mod, exp] of [['v5lore', v5lore], ['v5cast', v5cast], ['v5world', v5world]] as const) for (const [name, v] of Object.entries(exp)) twins(v, `${mod}.${name}`);
console.log(hits.length ? hits.join('\n') : `clean: no 18+ words in clean-mode data texts (v5: ${v5lore.feedCount()} feed lines, ${shown} build texts as shown)`);
process.exit(hits.length ? 1 : 0);
