// Land-cover palette of the toon style for the TIN map (lowpoly.ts): bright grass tiers, a quilt of
// field patches, sand-coloured village ground, clean water. Same shape as lowpoly.ts PAL (sRGB 0..1).
import { TOON_HEX } from './palette';

type RGB = [number, number, number];
const hx = (s: string): RGB => [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];

/** Replaces the classic land palette (Object.assign over lowpoly.ts PAL). */
export function toonLand() {
  const T = TOON_HEX;
  return {
    grass: T.grass.map(hx),
    tree: T.forest.map(hx),
    treeHigh: T.forestHigh.map(hx),
    // wheat, straw, ochre, ploughed, sunflower, olive, young green
    crop: T.crop.map(hx),
    cropW: [3, 1.5, 1.2, 1, 1.6, 1.6, 2.4],
    cropBase: hx(T.cropBase),
    built: T.yard.map(hx),
    bare: T.earth.map(hx),
    water: [hx(T.water[0]), hx(T.water[0]), hx(T.water[0])], // one flat tone: the glints (water.ts) do the rest
    wet: T.wet.map(hx),
    rock: hx(T.rock),
    meadow: hx(T.meadow),
  };
}

/** Per-face brightness jitter of the land colours: classic is grainy (0.075), toon is nearly flat. */
export const TOON_JITTER = 0.022;
