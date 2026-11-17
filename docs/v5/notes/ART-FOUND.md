# ART-FOUND — working notes (foundation of the new graphics style)

Track: art direction + technical foundation of the `toon` style, with a `classic` switch.
Branch base: `4b8c2dc`. Scratch (scripts, screenshots, measurements): `…/scratchpad/v5/ART-FOUND/`
(not in the repo). The contract for the art tracks is `docs/v5/ART.md`.

## Done
- **Style switch.** `src/render/style.ts`: `GFX` / `TOON` resolved once (URL `?gfx=classic|toon`, then
  `localStorage['vysotka.prefs'].gfx`, default `toon`), palette `C` / `HEX` / `TEAM` with named roles for
  both styles (`toon/palette.ts`), material factory `mat`, flags `native()` / `ground()`, `restyle()` /
  `restyleGeometry()`, `SUN_DIR`, `groundShadow()`, `styleRenderer()` / `styleLights()` / `styleStage()`.
- **Global toon look** without touching the model builders (`toon/shading.ts`): three's shader chunks are
  patched once in toon — stepped ramp, cloud shadows, legacy colour remap, outline mask in alpha, toon tone
  curve (CustomToneMapping). Shared uniforms reach every material through `ShaderLib.*.uniforms` (typed
  arrays are passed by reference).
- **Outlines** (`toon/post.ts`): one off-screen target (RGBA8 + depth texture, 4× MSAA on desktop) and one
  full-screen triangle: Laplacian of raw depth = silhouettes + creases; alpha = «no ink» mask; sky gradient
  and cartoon clouds for far pixels. Modes `full` / `lite` / `off`, frame-time governor, `?ol=` pin.
  `toon/hull.ts`: inverted hull for single objects (portraits) and the `?ol=hull` comparison mode.
- **Land, water, light, haze**: toon land palette + nearly flat faces (`toon/land.ts`, hooks in
  `lowpoly.ts`), toon water with glints and a foam line (`toon/water.ts`, hook in `terrainMesh.ts`), warm
  sun + cool sky ambient tuned so a lit face shows the authored colour, later haze (`toon/stage.ts`).
- **Setting**: menu box «Графика: Новая / Старая» (`src/ui/menu.ts`), `prefs.gfx` in `src/main.ts`, reload
  with the war checkpointed and entered again right after (sessionStorage `vysotka.resume`; shared wars
  rejoin the same side). Tested by `switch.cjs`: toon → classic → toon, the tick keeps counting.
- **HUD skin**: `src/render/toon/hud.css`, scoped to `html.gfx-toon` (variables, corners, shadows; no layout
  properties).
- **Other renderers**: `src/ui/portraits.ts` (style + ink hull), `tools/lineup.ts` (`?gfx=`, outline pass).
- **Docs**: `docs/v5/ART.md` v2 with measured budgets, the outline decision and the classic proof.

## Decisions
- Restyle through `ShaderChunk`, not per material: about 48 lit material sites in 17 files stay untouched.
- Outline by depth post-process: +1 draw call, +1 triangle; an inverted hull on everything costs about
  +70% draw calls and triangles and misses creases (numbers in ART.md §10).
- The off-screen target is flagged like an XR target so three compiles the same programs as for the
  canvas (tone curve + sRGB in the material); its internal format is pinned to `RGBA8` so the MSAA
  renderbuffer and the resolve texture match.
- Mask convention: opaque = alpha 0 (ink allowed), `ground()` = 1, written only while the main stage
  draws (`TOON_U.a[3]`), so alpha canvases (portraits) are not affected and transparent effects hide ink.
- No tone mapping in toon; lights sum to 1.0 on a lit top face.
- Sun shadows stay desktop-only, as in classic.

## Not done / for later
- Model work is for the three art tracks (ART.md §9). Houses, trees and units still use old geometry and
  old colours through the remap.
- Sky clouds are only visible in first person; the RTS camera never sees the sky.
- The governor's 40 ms threshold is a guess to be tuned on real phones.
- `STYLE.tier` is fixed at load (resizing a desktop window under 600 px does not change it).

## How to verify
- `npx vite --port 5272 --strictPort --host 127.0.0.1`, open `/?gfx=toon`, `/?gfx=classic`, add `&lq`
  for the phone tier, `&ol=full|lite|off|hull` for the outline mode; `tools/lineup.html?view=all&gfx=toon`.
- Classic unchanged: `node cap.cjs classic desktop "gfx=classic"`, the same for `phone`,
  `node lineup.cjs classic "gfx=classic"`, then `node cmp.cjs base classic` → every image IDENTICAL
  (`base/` was captured on `4b8c2dc` with the same scripts).
- Switch and resume: `node switch.cjs desktop shots`.
- Numbers: `node cap.cjs <out> desktop|phone "gfx=toon&ol=full"` prints draw calls and triangles per view;
  `node timing.cjs desktop|phone` compares the outline modes inside one page.
