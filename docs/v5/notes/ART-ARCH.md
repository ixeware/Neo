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
- `tools/lineupArch.ts` (+ a hook in `tools/lineup.ts`): views `base`, `base&fam=def|wall|trap|eco|sup|super`,
  `base&side=1`, `base1&k=<key>`, `basegame`, `basewall`.

## Next (priority order)

1. Check the base in the real game (toon + classic, desktop + `?lq`): construction, upgrade, damage, hidden
   (faint) states; trim level-3 towers above 600 triangles; thumbnails on the build palette cards.
2. The two high-rises in the new style.
3. Houses and yards, mosques, Soviet blocks, Грозный landmarks, capture-place markers.

## How to verify

- `npx vite --port 5276 --strictPort --host 127.0.0.1`, then
  `http://127.0.0.1:5276/tools/lineup.html?view=base&gfx=toon` (or `gfx=classic`).
- Scratch: `shot.cjs <out.png> "<lineup query>" [w h] [--nolabels] [--info]`, `base1.cjs` (sheets of
  close-ups), `cap.cjs <out> desktop|phone "<query>"` (the foundation's fixed-clock capture with
  `renderer.info`); `before/` holds the before pictures and numbers of both styles and tiers.
