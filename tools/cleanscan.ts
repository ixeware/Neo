// 18+ off: every text a clean-mode player can be shown, from the data modules, checked for tobacco, nicotine,
// swearing and the other 18+ words. Lines marked spicy are skipped (they never show with the layer off);
// strings that pass through clean18() (sim blurbs, hints) are checked after it.
// Run: npx tsx tools/cleanscan.ts   (exit 1 on a hit)
import * as heroes from '../src/data/heroes';
import * as lore from '../src/data/lore';
import * as places from '../src/data/places';
import { UNITS, CARDS, BUILDINGS, bldStats } from '../src/sim/defs';
import { readFileSync } from 'node:fs';

const BAD = /(^|[^а-яё])(кур(ени|ит|ят(?!ник)|ил|ю(?![а-яё]))|покур|закур|сигар|табак|никотин|снюс|вейп|кальян|отходняк|бля|ху[йеёя]|пизд|еба|ёба|ебл|выеб|заеб|сука|суки|сучк|жоп|член(?!ами группы)|говн|дерьм|педик|гей(?![а-яё])|девствен|нахер|похер|срать|ссать)|LOOP|[Бб]амб(?![а-яё])/i;
const hits: string[] = [];
const seen = new WeakSet<object>();
function walk(v: unknown, path: string, spicyCtx: boolean) {
  if (typeof v === 'string') {
    if (!spicyCtx && BAD.test(v)) hits.push(`${path}: ${v.slice(0, 120)}`);
    return;
  }
  if (!v || typeof v !== 'object' || typeof v === 'function') return;
  if (seen.has(v as object)) return;
  seen.add(v as object);
  if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, spicyCtx)); return; }
  const o = v as Record<string, unknown>;
  const spicy = spicyCtx || o.spicy === true;
  for (const [k, x] of Object.entries(o)) {
    // fields that only show with the 18+ layer on
    if (/^spicy/.test(k) || k === 'spicy18') continue;
    // сход cards (CARD_TEXT): title / quote are the 18+ text when a clean twin exists
    if ((k === 'title' && 'cleanTitle' in o) || (k === 'quote' && 'cleanQuote' in o && (o.quote as { spicy?: boolean })?.spicy)) continue;
    walk(x, `${path}.${k}`, spicy);
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
for (const f of ['src/sim/bld.ts']) {
  const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  for (const m of src.matchAll(/(['`])((?:(?!\1)[^\\\n]|\\.)*[А-Яа-яЁё](?:(?!\1)[^\\\n]|\\.)*)\1/g)) if (BAD.test(m[2])) hits.push(`${f}: ${m[2].slice(0, 120)}`);
}
console.log(hits.length ? hits.join('\n') : 'clean: no 18+ words in clean-mode data texts');
process.exit(hits.length ? 1 : 0);
