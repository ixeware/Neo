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
- `tools/lineupArch.ts` (+ a hook in `tools/lineup.ts`): views `base`, `base&fam=def|wall|trap|eco|sup|super`,
  `base&side=1`, `base1&k=<key>`, `basegame`, `basewall`, `hq`.

## Measured (renderer.info, whole frames; before → now, toon)

| View | Desktop triangles | Desktop calls | Phone triangles | Phone calls |
|---|---|---|---|---|
| Атаги 38 | 386k → 430k | 316 → 287 | 235k → 247k | 139 → 124 |
| Атаги 70 | 463k → ~470k | 349 → 319 | 238k → 242k | 155 → 141 |
| Курчалой 38 | 498k → 565k | 337 → 285 | 246k → ~255k | 136 → 110 |
| Грозный 38 | 562k → 655k | 200 → 200 | — | — |
| Грозный 90 | 616k → 616k | 232 → 232 | 326k → 326k | 109 → 109 |
| whole map | 446k → 458k | 561 → 515 | 222k → 222k | 190 → 190 |

A base of 66 buildings + 45 wall cells in view (scratch `game.cjs`): desktop 433k / 428 calls, phone 256k /
154 calls, phone sideways 296k / 239 calls (a building is one draw call, a tower two: body + head).

Classic: 14 of 20 fixed views are pixel-identical to the before set; the other six differ only by the base
models themselves (the AI's прорабская: they serve both styles by design) and by a few particle pixels
(three's object UUIDs draw from the seeded `Math.random`, and baseView now creates more objects).

Known overs of the per-object caps (ART.md §6): level-3 Себозол / Сгущёнкомёт / Гантелемёт / Антидрон /
Загон / Прорабская are 610–730 triangles, the two superweapons 300–1000 (one per side); traps 90–190.


## Next (priority order)

1. Mosques, Soviet blocks and the city fill of Грозный in palette colours (`city.ts`, `grozny.ts`: the blocks
   are vertex-coloured kits — recolour through `C.panel` / `C.balcony` / `C.roof`), the landmark set, stops,
   capture-place markers (`placeMarks.ts`), village props per plot (ART.md §4).
2. Trim the level-3 towers under 600 triangles; a merged body + head for towers that have no target.
3. Bigger thumbnails need a CSS rule in `src/ui/build.css` (the merger's file): `.bi` is 46 px (36 on phones).

## Decisions

- Base models are written once against `C` / `TEAM` / `mat` and serve both styles (ART.md §8).
- The high-rise keeps `HqBuilding`'s API (floors, roof, flag, height, `setFloors`): classic is untouched, the
  toon branch returns early from the constructor and from `makeFloor()`.
- House details are vertex-colour multipliers on the instance colour: no third draw call per chunk.
- Faces that look straight down below 0.45 are dropped from base models (`Kit.dropBottoms`).

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
