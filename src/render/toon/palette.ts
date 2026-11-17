// Named colour roles of both graphics styles (docs/v5/ART.md §2). Pure data: sRGB hex strings.
// `toon` is the new look; `classic` holds the values the old builders use for the same role, so a
// builder written against roles serves both styles.

/** One hex or a few variants of it. */
type Hex = string | readonly string[];

export const TOON_HEX = {
  // ---- outline, sky, light -------------------------------------------------------------------------
  ink: '#2a2233',
  skyZenith: '#2f9be0', skyHorizon: '#9ad8f5', haze: '#bfe3f2', cloud: '#ffffff', cloudShade: '#d6e6f5',
  sun: '#fff1cf', ambientSky: '#cfe0ff', ambientGround: '#c9b28e',
  // ---- land ----------------------------------------------------------------------------------------
  grass: ['#6cc84a', '#5fbd42', '#7bd257'], meadow: '#9ad05a',
  forest: ['#3f9a3c', '#4aa644', '#368c36'], forestHigh: ['#2f7f4a', '#38885a', '#2a7444'],
  crop: ['#f2cf5a', '#f5e08c', '#e8b24a', '#b9824f', '#b9d94e', '#cbd066', '#8fd45c'], cropBase: '#e9d67a',
  yard: ['#f0dca6', '#ead29a', '#f5e4b6'], earth: ['#d9b98a', '#cfae7c'], rock: '#a39aa0',
  water: ['#35b8ea', '#49c4f2', '#2aa9e0'], foam: '#ffffff', wet: ['#5fc0a0', '#52b594'],
  asphalt: '#6d6878', street: '#8b8594', track: '#e4c98f', roadLine: '#fff6d8', skirt: '#5a3f33',
  leaf: ['#3fae46', '#55c24f', '#2f9a3e', '#6fd060', '#47b84a', '#8bd85c'], fir: ['#1f8a5a', '#27996a', '#1a7a50', '#2fa878'], trunk: '#8a5a3a',
  // ---- architecture --------------------------------------------------------------------------------
  wall: ['#fff1d6', '#f3d9a4', '#c8553a', '#e3b45c', '#ffffff', '#f2b8a0'],
  roof: ['#e2452f', '#2fa35a', '#2f73d9', '#9b5a36', '#4a4f5e', '#2aa6a0', '#f08a2c'],
  fence: ['#3d7fd0', '#3fa66a', '#8f5a3a'], trim: '#fffaf0', glass: '#3a5a8a', glassLit: '#ffd86b', door: '#7a4a2c',
  panel: ['#e6e0d2', '#d6cfc0'], balcony: '#9fb7c9',
  marble: '#ffffff', dome: '#bfe6f2', mosqueGreen: '#1f9e6e',
  concrete: '#c9c4bc', metal: '#aab4c4', metalDark: '#56607a', wood: '#b9824f', woodDark: '#7a4a2c',
  // ---- teams, people, effects ----------------------------------------------------------------------
  team0: '#2f6bff', team0Dark: '#1b3fae', team0Light: '#9cc0ff',
  team1: '#ff4a2e', team1Dark: '#b3261a', team1Light: '#ffb3a1',
  neutral: '#f4ecd8',
  skin: '#e0a070', skinShade: '#c98458', hair: '#2a1f1a', cloth: '#2f3140', white: '#fffaf0',
  gold: '#ffc93c', heal: '#6fe06a', danger: '#ff3b2f', magic: '#b06cff',
} satisfies Record<string, Hex>;

export type Role = keyof typeof TOON_HEX;

/** The old look under the same role names (values copied from the builders of the base commit). */
export const CLASSIC_HEX: { [K in Role]: (typeof TOON_HEX)[K] extends string ? string : readonly string[] } = {
  ink: '#1b1a17',
  skyZenith: '#d9c9a8', skyHorizon: '#d9c9a8', haze: '#d9c9a8', cloud: '#f4ecd9', cloudShade: '#d9cdb4',
  sun: '#ffe2b0', ambientSky: '#fff4e0', ambientGround: '#6d6a4c',
  grass: ['#a5b666', '#9aae5d', '#afbe6e'], meadow: '#b9b974',
  forest: ['#4e8141', '#5b8d48', '#447439'], forestHigh: ['#3d6a43', '#47744a', '#355e3c'],
  crop: ['#dfc06e', '#e6d293', '#d4a962', '#c09667', '#a9b862', '#c7c375', '#b6c77f'], cropBase: '#d6c27c',
  yard: ['#dbc9a9', '#d2be9c', '#e2d3b7'], earth: ['#cbbfa3', '#bfb195'], rock: '#998b78',
  water: ['#3ea5bf', '#53b7cc', '#46adc5'], foam: '#e8f4f2', wet: ['#68a593', '#5d9b8a'],
  asphalt: '#6f6c66', street: '#8d8a83', track: '#bfb195', roadLine: '#f4f1ea', skirt: '#3b3128',
  leaf: ['#4b803b', '#5a8f45', '#3f7135', '#689a4b', '#52783a', '#7fa24f'], fir: ['#2f5b3c', '#386645', '#2a5136', '#41704a'], trunk: '#6a4630',
  wall: ['#efe6d6', '#e5d3b3', '#c99c78', '#d9c3a0', '#f2ede2', '#e8dcc0'],
  roof: ['#a8452f', '#4f7a4a', '#3e5f8a', '#7a4a2c', '#6b6f75', '#557e7a', '#8b3a2f'],
  fence: ['#3e5f8a', '#4f7a4a', '#7a4a2c'], trim: '#f4f1ea', glass: '#3d4a55', glassLit: '#ffd27a', door: '#5a4632',
  panel: ['#dbd5c7', '#d4cdbd'], balcony: '#a9a293',
  marble: '#f4f1ea', dome: '#cfe2ec', mosqueGreen: '#2f7f63',
  concrete: '#a7a39a', metal: '#b9bec4', metalDark: '#5d6066', wood: '#9a7a52', woodDark: '#5a4632',
  team0: '#2a52d1', team0Dark: '#18307e', team0Light: '#8fa8e8',
  team1: '#d8361f', team1Dark: '#8a1d10', team1Light: '#e89a8c',
  neutral: '#efe6d2',
  skin: '#c98d66', skinShade: '#b57a55', hair: '#1c1612', cloth: '#23252b', white: '#f2efe6',
  gold: '#d9b24a', heal: '#8fe08a', danger: '#ff3b2f', magic: '#9a6cd8',
};
