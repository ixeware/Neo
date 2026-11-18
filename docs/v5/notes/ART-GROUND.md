# ART-GROUND — working notes (the map itself in the toon style)

Track: terrain treatment, vegetation, props, roads, river, animated life for `gfx=toon`. Classic is never
touched: every hook is behind `TOON`. Scratch (scripts, screenshots): `…/scratchpad/v5/ART-GROUND/`.

## How it is wired (no edits in other tracks' files)
- `terrainMesh.ts terrainMesh()` → `groundLand()` (toon/ground/index.ts): the land material with the ground
  paint; the land mesh's `onBeforeRender` is the frame tick `groundTick(camera)` (LOD of the scatter, the
  clock and visibility of the life meshes).
- `roads.ts buildRoads()` → `groundRoads(parent)`: remembers the world group; in toon the main / street /
  track ribbons get `toonRoadMaterial()` (toon/ground/roadMat.ts) and keep their dash phase on both tiers.
- `trees.ts treeSpots()` → `groundBuild(skip)`: world.ts `buildTrees` calls it after the villages exist; in
  toon it returns no spots (the old trees are not built) and the ground track paints, plants and furnishes.
- The village houses are read back from world.ts's instanced meshes (`name === 'houses'`): yards, gardens,
  garden trees, smoke, laundry and hens follow whatever kit the architecture track draws, as long as the
  meshes keep that name and the instance matrix keeps position / rotation.y / scale (w, h, d).

## Files (all in `src/render/toon/ground/`)
| File | What |
|---|---|
| `index.ts` | the three hooks, the build order, the frame tick |
| `mask.ts`, `paint.ts`, `landMat.ts` | the ground paint: four signed distance fields in one RGBA texture + the land shader |
| `roadMat.ts` | road surfaces in the shader (kerbs, dashed centre line, track ruts) |
| `kits.ts` | low-poly kits (trees, bushes, field and river things, props, bridge parts), `KitBuilder` |
| `scatter.ts` | placement rules + one merged mesh per 56-unit chunk + LOD + far stand-ins / shadow casters |
| `life.ts` | everything that moves: one vertex-animated mesh per chunk + the bird flocks |
| `colors.ts` | palette roles this track adds (`GC`), to be moved into `toon/palette.ts` by the merger |

## Done
- **Ground paint** (no triangles, no draw calls; 2048-wide mask on desktop, 1024 on the phone tier):
  yards along village streets and under every house, plazas with a rim line (mosques, capture places, every
  2GIS landmark, village flags, Грозный's blocks, sites and squares), footpaths from plazas to the nearest
  street, gravel along the Аргун, garden lawns with flowers and vegetable plots with rows behind the houses,
  tufts and meadow flowers on the village lawn.
- **The high-rises** (the first screen): an analytic plaza in the shader — a sunburst of two paving tones in
  rings, a white kerb and a dark rim — eight spokes and a ring road on the edge of the first build zone.
- **Fields**: furrow rows per parcel (direction of the strip, period by crop), a dirt strip along every
  parcel border (per-face data the TIN builder adds in toon: `tin.fld`, `tin.edge`), shelter belts (poplars,
  round trees, fruit trees or hedges) along about a third of the borders, round bales on the straw fields,
  scarecrows.
- **Villages**: built-up faces are a lawn (two tones); a fruit or round tree behind one house in three,
  bushes, flower beds, wood piles, haystacks, benches; lamps, signs, parked cars (a toy car kit, now and then
  the Гелик and the BMW from the existing unit models) and bus shelters along the roads; plaza furniture by
  kind (market stalls and crates, benches, lamps, flower beds, wells, trees).
- **Trees**: round (two kits), fir (stacked cones), poplar, fruit tree; forests by land cover (fir above
  380–560 m), lone trees and bushes on the meadows, willows and bushes along the river, poplar rows on the
  main roads, rocks on steep faces, reeds and boulders on the banks.
- **Roads**: asphalt with a white kerb strip and a dashed centre line, village streets with a light kerb,
  field tracks with a grass strip; all in the shader on the existing ribbons, both tiers.
- **Bridges over the Аргун**: piers, railings in a roof colour, lamps and abutment posts on top of world.ts's
  plain deck (part of the scatter mesh).
- **Life** (`life.ts`): chimney smoke (1 house in 8), laundry lines (1 in 8), hens in the yards, flocks of
  sheep on the meadows, ducks at the bridges and along the banks, bunting around markets / village flags /
  capture places / squares / stadiums, three flocks of birds over Атаги, Курчалой and Шали. One draw call per
  visible chunk, animated in the vertex shader, hidden beyond camera distance 120 (phone 85).
- **LOD / budget**: inside a chunk things are ordered trees → mid-size → small props and shuffled, so a
  prefix of the index buffer is a level of detail; beyond distance 165 (phone 105) trees are drawn as 4–8
  triangle stand-ins that thin out. On desktop the same stand-in mesh is the trees' shadow caster near by
  (`onBeforeShadow` / `onBeforeRender` switch its draw range), so tree shadows cost 8 triangles per tree.

## Decisions
- **Nothing solid inside a build zone** (from the keep-out core to the level-3 radius + a cell): only paint,
  smoke on the houses that stand there, and the furniture along the high-rise's long sides in the core.
- No normals in the kits: the toon materials are flat-shaded from screen derivatives.
- Placement is hashed from positions and indices only (`hash2`), never `Math.random`.
- Old trees are replaced in toon, so the forest views cost about what they did.

## Next (not done)
- shallows / sandbars in the water shader (the foundation's `toon/water.ts`), puddles and speed bumps,
  moving civilian cars (characters track owns the car models), a shepherd with the flocks.
- hide the far stand-ins under real fog on the whole-map view if the merger needs triangles back.

## How to verify
- `npx vite --port 5275 --strictPort --host 127.0.0.1`, `/?gfx=toon`, `/?gfx=toon&lq`, `/?gfx=classic`.
- `node cap.cjs <out> desktop|phone "gfx=toon" [--nounits] [--views=a,b] [--v=name:x:z:dist:yaw] [--vp=WxH]`
  (scratch folder) dumps canvases and `renderer.info`; `node cmp.cjs before/classic <dir>` proves classic is
  unchanged. Console lines `scatter:` / `life:` / `ground:` give the counts.

## Budget (renderer.info, whole frames with the shadow pass, 99 units on the field)
Before = the foundation's toon on `335e139` (`before_toon_*.log`), after = this branch (`m2d.log`, `m3p.log`).
Allowed for this track: desktop +200k triangles / +60 draw calls, phone tier +55k / +16.

| View (camera distance) | Desktop triangles | Desktop calls | Phone triangles | Phone calls |
|---|---|---|---|---|
| Атаги (70) | 463k → 603k (+140k) | 349 → 367 | 238k → 272k (+34k) | 155 → 163 |
| Атаги (38) | 386k → 553k (+167k) | 316 → 338 | 235k → 276k (+40k) | 139 → 148 |
| close fight (16) | 360k → 535k (+176k) | 225 → 249 | 232k → 280k (+49k) | 95 → 106 |
| Курчалой (90) | 575k → 647k (+72k) | 376 → 389 | 265k → 279k (+15k) | 161 → 165 |
| Грозный (90) | 616k → 712k (+97k) | 232 → 241 | 326k → 339k (+13k) | 109 → 112 |
| Шали (60) | 489k → 658k (+169k) | 246 → 264 | 238k → 261k (+22k) | 103 → 109 |
| the river (60) | 509k → 678k (+169k) | 283 → 299 | 232k → 274k (+43k) | 94 → 101 |
| whole map (300) | 446k → 470k (+24k) | 561 → 557 | 222k → 223k (+1k) | 190 → 189 |
| foothills (90) | 612k → 622k (+10k) | 270 → 271 | 243k → 258k (+15k) | 99 → 102 |

Totals on the map: desktop 23.7k things (16.9k trees) = 714k triangles near, 123k as far stand-ins; phone
tier 14.1k things = 388k near, 73k far. Only the chunks around the camera are drawn, cut by the LOD.

Classic: `node cmp.cjs before/classic after/classic_all` — the 15 phone views and the desktop views are
pixel-identical to the base commit when captured in the same order (the capture is order-dependent: the fake
clock runs on between views).

Final state (production bundle served with `vite preview`, `final/`): Атаги 605k / 367 calls, Атаги-38 555k,
close fight 534k, Шали 657k, the river 686k (+178k, the worst), field close-up 512k, bridge 552k on desktop;
phone tier Атаги 272k / 163, Атаги-38 275k / 148, field 260k / 99, bridge 274k / 106.
`dist/index.html` is 2,147,641 bytes (2.09 MB before this track: about +55 KB of the 110 KB allowed).

## Screenshots worth looking at (`…/scratchpad/v5/ART-GROUND/`)
`s7/desktop_first.png` (the first screen: Атаги and its base zone), `m2/desktop_atagi.png`,
`s4/desktop_field.png`, `s4/desktop_bridge.png`, `m2/desktop_shali.png`, `m2/desktop_kurchaloy.png`,
`m2/desktop_grozny.png`, `s3/desktop_foothills.png`, `s3/desktop_whole.png`, `s6/desktop_base.png`,
phone: `m3/phone_atagi.png`, `m2/phone_atagi38.png`, `final/phone_field.png`, `final_land/phone_atagi38.png`
(750 × 342); before: `before/toon/*.png`; classic: `after/classic_full/`, `after/classicp/`.

