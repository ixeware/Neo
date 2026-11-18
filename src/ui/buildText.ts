// Texts of the base: building names, blurbs and feed lines by building key.
// Today they come from the sim table (clean, with the 18+ twin the table offers). The content track plugs
// richer ones in with setBuildTexts() (BLD_TEXT / FEED of src/data/v5lore.ts) without touching the UI.
import { BUILDINGS } from '../sim/defs';

export interface BldText { name: string; blurb: string; /** The long name for a panel title (falls back to name). */ full?: string; /** A one-line joke under the blurb. */ joke?: string }
/** What happened to a building, for the feed. */
export type BldFeedKind = 'built' | 'up' | 'lost' | 'broke' | 'trap' | 'trapped' | 'seen' | 'charged' | 'theirCharged' | 'wave' | 'fire';
export interface BuildTexts {
  /** Name and blurb of a building by key; a missing field falls back to the sim table. */
  text?: (key: string, spicy: boolean) => Partial<BldText> | null | undefined;
  /** A feed line; null / undefined falls back to the plain default. `name` is the building's name, `n` a count or ₽. */
  feed?: (kind: BldFeedKind, key: string, spicy: boolean, name: string, n: number, side?: number) => string | null | undefined;
}
let src: BuildTexts = {};
/** Plug richer texts in (the content track: BLD_TEXT and FEED of v5lore.ts). */
export function setBuildTexts(t: BuildTexts) { src = t; }

/** Name and blurb of building type `t`: clean, or the 18+ wording when the layer is on. */
export function bldText(t: number, spicy: boolean): BldText {
  const d = BUILDINGS[t];
  if (!d) return { name: '?', blurb: '' };
  const x = src.text?.(d.key, spicy), s = spicy ? d.spicy18 : undefined;
  return { name: x?.name ?? s?.name ?? d.name, blurb: x?.blurb ?? s?.blurb ?? d.blurb, full: x?.full, joke: x?.joke };
}

/** A feed line about a building (clean defaults). */
export function bldFeed(kind: BldFeedKind, t: number, spicy: boolean, n = 0, side?: number): string {
  const d = BUILDINGS[t], name = bldText(t, spicy).name;
  const x = d ? src.feed?.(kind, d.key, spicy, name, n, side) : null;
  if (x) return x;
  switch (kind) {
    case 'built': return `Построили: ${name}`;
    case 'up': return `${name}: уровень ${n}`;
    case 'lost': return `Нам снесли: ${name}`;
    case 'broke': return n > 0 ? `Сломали им: ${name}. +${n} ₽` : `Сломали им: ${name}`;
    case 'trap': return n > 1 ? `${name}: попались ${n}` : `${name}: попался один`;
    case 'trapped': return `Наши нарвались: ${name}`;
    case 'seen': return `Нашли у них: ${name}`;
    case 'charged': return `${name} заряжен`;
    case 'theirCharged': return `У них заряжен ${name}. Ломайте`;
    case 'wave': return n > 0 ? `${name} бахнул: раскидало ${n}` : `${name} бахнул`;
    case 'fire': return `${name}: арбуз пошёл`;
  }
}
