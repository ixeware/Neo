# ART-GROUND — working notes (the map itself in the toon style)

Track: terrain treatment, vegetation, props, roads, river, animated life for `gfx=toon`. Classic is never
touched: every hook is behind `TOON`. Scratch (scripts, screenshots): `…/scratchpad/v5/ART-GROUND/`.

## How it is wired (no edits in other tracks' files)
- `terrainMesh.ts terrainMesh()` → `groundLand()` (toon/ground/index.ts): the land material with the ground
  paint; the land mesh's `onBeforeRender` is the frame tick `groundTick(camera)`.
- `roads.ts buildRoads()` → `groundRoads(parent)`: remembers the world group.
- `trees.ts treeSpots()` → `groundBuild(skip)`: world.ts `buildTrees` calls it after the villages exist; in
  toon it returns no spots (the old trees are not built) and the ground track paints, plants and furnishes.
- The village houses are read back from world.ts's instanced meshes (`name === 'houses'`): yards and
  gardens follow whatever kit the architecture track draws, as long as the meshes keep that name.

## Done
- **Ground paint** (`toon/ground/mask.ts`, `landMat.ts`, `paint.ts`): four signed distance fields in one
  RGBA texture (2048 wide on desktop, 1024 on the phone tier) drawn by the land shader — no triangles, no
  draw calls. R: yards along village streets and under every house, plazas (high-rises with eight spokes
  and a ring road at the first build zone radius, mosques, capture places, every 2GIS landmark, village
  flags, Грозный's blocks, sites and squares), footpaths from plazas to the nearest street, with a rim line.
  G: gravel along the Аргун. B: garden lawns, A: vegetable plots behind the houses.
- **Fields**: furrow rows per parcel (direction of the parcel's strip, period by crop) and a dirt strip along
  every parcel border, from per-face data the TIN builder adds in toon (`tin.fld`, `tin.edge`).
- **Villages**: built-up faces are a lawn in the shader (two tones); the beige is painted where streets and
  houses are. `tin.rgb` keeps the beige, so the minimap still shows the villages.

## Next
- scatter (trees, bushes, props) merged per chunk, roads/river, life — see the task list in ART.md §9.

## How to verify
- `npx vite --port 5275 --strictPort --host 127.0.0.1`, `/?gfx=toon`, `/?gfx=toon&lq`, `/?gfx=classic`.
- `node cap.cjs <out> desktop|phone "gfx=toon" [--nounits] [--v=name:x:z:dist:yaw]` (scratch folder) dumps
  canvases and `renderer.info`; `node cmp.cjs before/classic <dir>` proves classic is unchanged.
