# ART-ARCH — notes for whoever continues

Track: architecture of the new graphics style (docs/v5/ART.md §5, §9): the player-built base buildings first,
then the two high-rises, then houses / mosques / city. Branch `worktree-wf_d79cc3e7-667-1`, on top of the
merged release `335e139`. Port 5276. Scratch scripts and screenshots:
`/tmp/claude-0/-home-user-Neo/2cf9b09d-ec36-5575-aa5a-ad87bc5d21e8/scratchpad/v5/ART-ARCH/`.

## Done

- `src/render/toon/kit.ts` — the modelling kit (`Kit`): boxes, cylinders, tapered and chamfered boxes, hip /
  gable roofs, beams between two points, quads, a transform stack; builds one flat-shaded vertex-coloured
  geometry (draw with `mat.solid()`).
- `src/render/toon/base/models.ts` — all 27 building keys of docs/v5/BASE.md × 3 levels × 2 sides:
  `baseModel(key, level, side)` (a group: body mesh + a child named `head` that turns to the target),
  `BASE_MODELS`, `BASE_KEYS`, `baseModelInfo()` (height, triangles), `baseGhostGeometry()` (placement ghost),
  `wallKit(level)` (instanced post + panel: профнастил / кирпич / бетон). Written against `C` / `TEAM` / `mat`,
  so the same models serve classic.
- `src/render/baseView.ts` — the factory is `baseModel` by default; walls are three instanced pairs (one per
  level) drawn with `mat.solid()`, the post takes the team colour as instance colour; the ghost uses
  `baseGhostGeometry()` (vertex colours on).
- `src/render/toon/base/thumbs.ts` — `baseThumb(key, side)` / `baseThumbHtml()`: every model rendered once per
  side into a 112 px PNG on the first open of the palette (a throw-away renderer, as portraits.ts), both
  styles; hook: one import and one call in `src/ui/build.ts` (the card's family icon is the fallback).
- `src/render/toon/arch/highrise.ts` + hooks in `world.ts` (`HqBuilding`, behind `TOON`): modelled floors
  (`hqFloorGeo`: brick with yellow-brick corners, balconies, stairwell glazing, air conditioners, drain pipes
  for Атаги; panels, four entrances, loggia columns in four colours and a mural on the end walls for
  Курчалой; one merged geometry per floor, so floors still drop one by one), `hqRoofGeo` (parapet with a team
  band, lift boxes, water tank, antenna, dishes, vents, the turret), `hqGroundGeo` (apron, steps, team
  canopies, benches, lamps, flower beds, a notice board), the sign on a frame, a bigger flag, the fake shadow
  for the phone tier. Fewer draw calls than before (a floor was a six-material box).
- `src/render/toon/arch/houses.ts` + hooks in `world.ts` (`buildVillages`, `chunked`, `updateWorldLod`):
  `toonHouseKits()` — the three village kits repainted (palette walls and roofs as instance colours, the
  vertex colours multiply them: door, windows, brick chimney, fence and gate in the roof's sheet metal,
  porch, side wing), a lighter set for the phone tier, and a `far` twin of each with the old triangle count.
  A chunk shows the detailed kit within `HOUSE_NEAR()` (66 desktop / 56 phone) of the camera; in the shadow
  pass only the walls and the roof are drawn (`onBeforeShadow` narrows the draw range).
- `toonHouseMaterial()` (houses.ts): vertex colour × instance colour, except vertex colours stored +2, which
  are shown as they are (a three-line vertex hook through `onBeforeCompile` on a native Lambert) — glass,
  doors, brick chimneys and the white gate posts keep their palette colour on every wall.
- Грозный's city fill (`grozny.ts` `CITY_WALL` / `CITY_ACCENT` / `CITY_WIN`, a dark roof inside the parapet;
  `city.ts` draws it with `mat.solid()` in toon) and the three mosques (`world.ts` `MC`) are painted from the
  palette behind `TOON`; capture places get a flagpole with a stone foot and a gold ball
  (`toon/arch/markers.ts`, hook in `placeMarks.ts`).
- `tools/lineupArch.ts` (+ a hook in `tools/lineup.ts`): views `base`, `base&fam=def|wall|trap|eco|sup|super`,
  `base&side=1`, `base1&k=<key>`, `basegame`, `basewall`, `hq`, `kits`.

## Measured (renderer.info, whole frames with the shadow pass; toon, before → now)

The foundation's fixed-clock capture (`cap.cjs`, 99 units on the field), the same ten views:

| View (camera distance) | Desktop triangles | Desktop calls | Phone triangles | Phone calls |
|---|---|---|---|---|
| Атаги (70) | 463k → 479k | 349 → 319 | 238k → 242k | 155 → 141 |
| Атаги (38) | 386k → 425k | 316 → 286 | 235k → 245k | 139 → 124 |
| close fight (16) | 360k → 401k | 225 → 212 | 232k → 240k | 95 → 95 |
| Курчалой (90) | 575k → 569k | 376 → 324 | 265k → 273k | 161 → 134 |
| Курчалой (38) | 498k → 559k | 337 → 285 | 246k → 258k | 136 → 110 |
| Грозный (90) | 616k → 601k | 232 → 232 | 326k → 329k | 109 → 109 |
| Грозный (38) | 562k → 652k | 200 → 200 | 286k → 305k | 92 → 92 |
| Шали (60) | 489k → 532k | 246 → 246 | 238k → 242k | 103 → 103 |
| river (60) | 509k → 495k | 283 → 283 | 232k → 232k | 94 → 93 |
| whole map (300) | 446k → 458k | 561 → 515 | 222k → 222k | 190 → 189 |

Worst added: desktop +90k triangles (budget +250k), phone +19k (budget +70k); draw calls went down
everywhere (the high-rise floors were six-material boxes). Hard limits (1.2M / 480k): worst now 652k / 329k.

A base of 66 buildings + 45 wall cells in view (scratch `game.cjs`, the same armies): desktop 471k / 399
calls, phone 256k / 154 calls, phone sideways 296k / 239 calls (a building is one draw call, a tower two:
body + head).

`dist/index.html`: 2,092.07 kB at `335e139` → 2,138.63 kB (+46.6 kB for the whole track; gzip 909.95 kB).

Classic (the same capture with `gfx=classic`, against the before set of `335e139`): all 10 lineup views are
pixel-identical; of the 20 game views 14 are identical, three differ by the base model of the AI's прорабская
(base models serve both styles by design) and three by a few dozen pixels of random effects around a unit
(three's object UUIDs draw from the seeded `Math.random`, and baseView now creates more objects at start —
no geometry, colour or material of the classic style changed).

Per-object caps (ART.md §6): every tower, economy and support model is at or under 600 triangles per level
(226–600) except the level-3 Прорабская (732, one per side); the two superweapons are 294–922 (one per
side, 3×3 cells); traps are 92–192 (cap 150: Яма and the level-3 Грабли / Лежачий are over by up to 42).
House kits: 34 / 60 / 60 near, 14 / 20 / 20 far (the old counts), phone 28 / 26 / 26.

## Next (priority order)

1. Still in the old models (they only get the toon shading and its colour remap): Грозный's landmark set
   (ГГНТУ, ЧГУ, ЖК «Шайба», Ансар — `grozny.ts` `groznyLandmark`), the Донер Бей pavilion and the food places
   (`heroes.ts` / `props.ts`: replace them through hooks in `decor.ts`), bus stops, the 2GIS landmarks, the
   village markers. Then village props per plot (sheds, water tanks, haystacks, benches: ART.md §4), side and
   back fences of the yards (only the street fence and gate exist), courtyards of the city blocks.
2. A merged body + head for towers that have no target (a tower is two draw calls now).
3. Bigger thumbnails need a CSS rule in `src/ui/build.css` (the merger's file): `.bi` is 46 px (36 on phones).

## Decisions

- Base models are written once against `C` / `TEAM` / `mat` and serve both styles (ART.md §8).
- The high-rise keeps `HqBuilding`'s API (floors, roof, flag, height, `setFloors`): classic is untouched, the
  toon branch returns early from the constructor and from `makeFloor()`.
- House details are vertex-colour multipliers on the instance colour: no third draw call per chunk.
- Faces that look straight down below 0.45 are dropped from base models (`Kit.dropBottoms`).
- The high-rise has no damage picture between floors (the old one had none either): a floor drops when its hp
  is gone. A cracked / smoking state would need the floor hp passed to `HqBuilding` (main.ts, the merger's).
- Hooks in files of other owners: `src/ui/build.ts` (one import, one call: the card's picture),
  `tools/lineup.ts` (one import, one `else` branch, the nav entries), `src/render/baseView.ts` (the factory
  default, the wall kit, the ghost geometry).

## How to verify

- `npx vite --port 5276 --strictPort --host 127.0.0.1`, then
  `http://127.0.0.1:5276/tools/lineup.html?view=base&gfx=toon` (or `gfx=classic`), `view=hq`, `view=basewall`.
- Scratch scripts (not in the repo): `shot.cjs <out.png> "<lineup query>" [w h] [--nolabels] [--info]`,
  `base1.cjs` (sheets of close-ups), `cap.cjs <out> desktop|phone "<query>" [--views=a,b]` (the foundation's
  fixed-clock capture with `renderer.info`; `before/` holds the before set of both styles and tiers, `cmp.cjs`
  compares folders, `bbox.cjs` shows where two pictures differ), `game.cjs <out> desktop|phone|land "<query>"
  --views=base38,base24,base70,basefoe` (the same with a base of every building key placed by `adm bgive`,
  damaged / under construction / being upgraded), `pal.cjs <out.png> desktop|phone|land <gfx> <chip> [side]`
  (the build palette open in the real game).
