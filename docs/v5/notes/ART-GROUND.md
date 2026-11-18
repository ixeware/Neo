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

## Budget (renderer.info, whole frames, 99 units on the field; before = foundation toon)
See the table in the final report of the track (kept in the commit message of the last commit).
