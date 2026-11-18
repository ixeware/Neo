// Colours the ground track adds to the toon palette (docs/v5/ART.md §9: a track keeps new roles in its own
// folder; the merger may move them into toon/palette.ts). sRGB hex.
export const GC = {
  /** Village ground under and between the yards (two tones in big patches). */
  lawn: ['#84d45c', '#77cc52'],
  /** Garden lawn behind a house; vegetable plot soil and its green rows. */
  garden: '#62c04a', soil: '#b98a5e', plotGreen: '#58b848',
  /** Plazas, paths, house yards; the rim line just inside their edge and its half width (world units). */
  pave: '#f5e4b6', rim: '#dcc089', rimW: 0.045,
  /** The two paving tones of a high-rise plaza. */
  plaza: ['#fbeecb', '#efd9a2'],
  /** River gravel and bare earth patches. */
  gravel: '#ecdcae',
  /** Dirt strip between two fields and its half width. */
  border: '#c79a62', borderW: 0.07,
  kerb: '#fffaf0',
  flower: ['#ff5a4f', '#ffd23c', '#ff8fc7', '#ffffff', '#9a6cff'],
  fruit: ['#ff3b2f', '#ffc93c', '#ff8a2c'],
  hay: '#f2cf5a', hayDark: '#d9ae3c',
  reed: '#7fbf5a', reedHead: '#8a5a3a',
  boulder: ['#b9b1b6', '#a39aa0', '#c9c2c4'],
  sheep: '#fffaf0', sheepHead: '#3a2f33',
  chicken: ['#fffaf0', '#c9743a', '#3a2f33'],
  cloth: ['#ffffff', '#ff5a4f', '#3d7fd0', '#ffd23c', '#6fd060'],
  awning: ['#e2452f', '#2f73d9', '#2fa35a', '#f08a2c'],
  car: ['#fffaf0', '#2f3140', '#e2452f', '#2f73d9', '#aab4c4', '#f4d75e'],
} as const;
