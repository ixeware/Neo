# ART-FOUND — working notes (foundation of the new graphics style)

Track: art direction + technical foundation of the `toon` style, with a `classic` switch.
Branch base: `4b8c2dc`. Scratch (scripts, screenshots): `…/scratchpad/v5/ART-FOUND/` (not in the repo).

## Done
- Studied the renderer, measured the classic baseline (see below), captured base screenshots with a
  deterministic harness (fake clock + seeded `Math.random`, fonts blocked): two runs of the base commit are
  pixel-identical, so classic can be proven unchanged later.
- `docs/v5/ART.md` v1: look, palette, shapes, richness recipe, base buildings, characters, budgets (◇
  provisional), style API (◇), file ownership and task lists for the three art tracks.

## In progress
- `src/render/style.ts` + `src/render/toon/*` (shader-chunk toon ramp + remap, depth-outline post pass, sky,
  water, land palette), prefs `gfx`, menu setting, HUD skin.

## Next
- Measure toon on both tiers, compare outline options (inverted hull vs post vs baked trims), write the
  numbers into ART.md §6, pixel-compare classic against the base captures, final checks.

## Decisions so far
- Global restyle through three's `ShaderChunk` (patched once, only when `gfx=toon`), so every Lambert/Phong
  material in the game changes look without touching the model builders. Classic never runs the patch.
- Outlines: post-process on the depth buffer (Laplacian of raw depth = silhouettes and creases, zero on
  planes), alpha channel of the colour target as a «no outline» mask for terrain/roads/water. To be
  confirmed by measurement against an inverted hull.
- Colour output is encoded in the material shaders (toon curve + sRGB) so the off-screen target can stay
  RGBA8 and the post pass is one cheap full-screen triangle.

## Baseline (classic, base commit, 96 units, fixed views)
Desktop 1440×900 (shadows on): draw calls 198–558, triangles 357k–613k.
Phone tier `?lq` 390×844: draw calls 88–186, triangles 220k–324k.
Per view: `…/ART-FOUND/base/desktop_info.json`, `phone_info.json`.

## How to verify
- `npx vite --port 5272 --strictPort --host 127.0.0.1`
- `node …/ART-FOUND/cap.cjs <outDir> desktop|phone "gfx=classic"` then `node …/ART-FOUND/cmp.cjs base <outDir> desktop_`
  (IDENTICAL for every view = classic unchanged). `lineup.cjs` does the same for `tools/lineup.html` views.
