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
- **First person**: sky gradient and cartoon clouds behind the land; what `fpcam.ts` dithers away next to
  the camera writes «no ink» into the mask (`NEAR_FADE` branch in `toon/shading.ts`), so the dither does
  not turn into dark speckle.
- **Docs**: `docs/v5/ART.md` final: the look, palette, shapes, richness recipe, base buildings, budgets,
  characters, the style API, file ownership and task lists for ART-GROUND / ART-ARCH / ART-CHARS (§9), the
  measured outline decision (§10) and the classic proof (§11).

## State: finished
Nothing is in progress. Final run (dev server, the code of the final commit):
- Classic vs base commit `4b8c2dc`: 30 canvas dumps (10 desktop views, 10 phone views, 10 lineup views)
  pixel-identical, 28 portraits byte-identical.
- Switch test on both tiers: toon → «Старая» → «Новая», the war resumes after each reload (tick keeps
  counting, units alive), `?gfx=` overrides the saved choice.
- Draw calls / triangles per view (96 units on the field; atagi, atagi38, fight, kurchaloy, kurchaloy38,
  grozny, grozny38, shali, river, whole):
  - desktop classic: 347/460k, 314/383k, 223/357k, 371/571k, 332/495k, 230/613k, 198/559k, 244/486k,
    281/506k, 557/444k; desktop toon (`ol=full`): the same **+1 call, +1 triangle**;
  - phone tier classic: 152/236k, 135/234k, 91/230k, 157/263k, 132/245k, 105/324k, 88/285k, 99/237k,
    90/230k, 186/221k; phone toon (`ol=lite`): the same **+1 call, +1 triangle**.
- Outline pass frame time inside one page (software GL, ratios only): desktop lite 1.057×, full 1.077× of
  `off`; phone tier lite 1.084×, full 1.095×.
- `dist/index.html`: 1.90 MB at the base, 1,918,511 bytes (1.92 MB) with the foundation.

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
- In first person a dithered (near-faded) object in front of another *object* still shows a little ink
  through the dither holes (in front of the ground it is clean).
- `tools/lineup.html` keeps its old khaki floor in toon (a tool page; classic lineup must not change).
- The minimap uses the toon land palette through `paintTin`, but its pen colours are the old ones.
- The governor's 40 ms threshold is a guess to be tuned on real phones.
- `STYLE.tier` is fixed at load (resizing a desktop window under 600 px does not change it).

## How to verify
- `npx vite --port 5272 --strictPort --host 127.0.0.1`, open `/?gfx=toon`, `/?gfx=classic`, add `&lq`
  for the phone tier, `&ol=full|lite|off|hull` for the outline mode; `tools/lineup.html?view=all&gfx=toon`.
- Classic unchanged: `node cap.cjs classic desktop "gfx=classic"`, the same for `phone`,
  `node lineup.cjs classic "gfx=classic"`, then `node cmp.cjs base classic` → every image IDENTICAL
  (`base/` was captured on `4b8c2dc` with the same scripts).
- Switch and resume: `node switch.cjs desktop shots` (and `phone`).
- Everything at once: `bash final.sh` (toon captures on both tiers, toon lineup, the classic proof with
  portraits, HUD and menu screenshots).
- Numbers: `node cap.cjs <out> desktop|phone "gfx=toon&ol=full"` prints draw calls and triangles per view;
  `node timing.cjs desktop|phone` compares the outline modes inside one page.
