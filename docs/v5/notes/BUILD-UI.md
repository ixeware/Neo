# BUILD-UI — notes for whoever continues

Track: the build mode and the base on screen, on top of SIM-BASE (docs/v5/BASE.md) and the style foundation
(docs/v5/ART.md). Branch = release candidate: base `4b8c2dc` + `worktree-wf_d175f302-e4c-1` (sim buildings) +
`worktree-wf_d175f302-e4c-2` (graphics style), both merged without conflicts.

## Done

- **src/render/baseView.ts** — draws `sim.st.bld` every frame:
  - a placeholder model per building key (27), written against `C` / `TEAM` / `mat` of the style module, so it
    reads in toon and in classic; `setBaseModelFactory(fn)` plugs the real art in (a child named `head` turns
    to the target, otherwise the whole model does; `null` falls back to the placeholder);
  - construction (the body rises inside a scaffold, a gold progress bar), upgrade (scaffold + bar, the old
    level keeps standing), damage (lean under 2/3, smoke under 1/3), hp bars (damaged or selected only);
  - walls instanced (post in the team colour + arms towards neighbouring wall cells: 2 draw calls for every
    wall of both sides), one merged sheet of fake shadows for the phone tier of the new style;
  - hidden things: faint for their owner, not drawn (not pickable, not on the minimap) for the enemy until
    `BF.SEEN`;
  - rings: build zone + keep-out, the ghost's range and the mortar's minimum, the selected building's range;
  - the ghost (green / red per cell), `pick(x, y, touch)` for taps;
  - effects: tower shots (`shot` with k ≥ `BASE.shotK`; the old Shots looks are reused: bottle with foam for
    Себозол, dumbbell for Гантелемёт…), the Тесла chain (`zap`), `bhit`, traps, hatch, stun, the Сабвуфер
    wave, the Арбузомёт's flying melon and landing.
- **src/ui/build.ts + build.css** — build mode. Everything stands in the deck's place (`Hud.deckAlt`), so the
  bank, the minimap, the command bar, the chat and the сход sheet restack on the measured size:
  - «Стройка» button at the end of the bank slip (key B); palette by family (Защита / Стены / Ловушки /
    Хозяйство / Особое) with price, count / cap, locked cards greyed with the short reason, the base summary
    line and «Починить всё»;
  - placing: desktop — the ghost follows the mouse, click builds, Shift keeps it in hand, right click / Esc
    cancels; phone — the ghost starts at the screen centre, a tap moves it, a drag from it drags it, ✓ / ✗ in
    a short bar (one finger away from the ghost still pans; no rubber band while placing); walls — desktop:
    press, drag, release; phone: drag from the fence, then ✓; one `bld put` with `cells`;
  - a tap on a building: panel with name, level, hp, state, what it does, stats (with the next level's
    values), «Улучшить», «Починить», «Продать» (second tap confirms), «Огонь!» for the Арбузомёт (then a tap
    on the map); an enemy building: name, level, hp. With units selected a tap / right click on an enemy
    building is an attack order (`ord.tb`);
  - keys: B, digits pick in the palette, R = the last building again, Esc one step back;
  - sounds from the existing synth, feed lines by «Прораб», tips with ₽.
- **src/ui/buildText.ts** — names, blurbs and feed lines by key; `setBuildTexts({ text, feed })` is the one
  place where the content track plugs `BLD_TEXT` / `FEED` of `v5lore.ts` in.
- Minimap: building dots; the bitmap is 456 × 353 and every CSS size keeps the map's 1.292 (was 1.46).
- Донер Бей: one name everywhere (`DONER.clean`), 18+ or not.

## Hooks in shared files

| File | What |
|---|---|
| src/main.ts | imports; `base` + `build` after `roster`; `pickCard` closes build mode; `beginSession` resets it and sets `minimap.side`; tap / order / box / grab / hover / keyBusy / keydown go through `build` first; `handleFx` gives every event to `build.fx` first; the frame loop calls `build.update`; a сход never flies the camera away while build mode is on; `donerName`; `__game.build`, `__game.base` |
| src/ui/hud.ts | `bankEl` public, `deckAlt`, `deckEl`, `layout()` measures `deckAlt` when set; minimap bitmap 456 × 353 |
| src/ui/style.css | minimap CSS sizes (5 lines) and the default `--mini-h` |
| src/ui/control.ts | `issue(…, tb?)`: attack order on a building |
| src/render/scene.ts | `InputHooks.grab` (pointer down on the map may be taken: build mode drags its ghost) |
| src/ui/minimap.ts | `side`, building dots |
| src/ui/labels.ts, src/render/decor.ts, src/ui/admin.ts | Донер Бей's one name |
| tools/cleanscan.ts | scans src/ui/build.ts and buildText.ts too |

## Decisions

- One slot for everything (the deck's place) instead of floating panels: nothing can overlap by construction.
- The palette shows one family at a time (digits 1–9 pick inside it); a phone held sideways gets a
  «next family» button instead of five chips (no room).
- A phone held sideways hides «Стройка» while units are selected: the command bar needs the whole row
  between the bank and the minimap (otherwise it wraps into two rows and reaches the сход sheet).
- Units come first under the finger; a building is picked only where no own unit (and, with a selection, no
  enemy unit) is.
- Draw calls: one mesh per non-wall building (they turn, rise and lean one by one); walls, bars, shadows,
  rings and bolts are shared. Worst case one full base in view ≈ 30 + 8.

## How to verify

- `npx vite --port 5273 --strictPort --host 127.0.0.1`, then
  `node <scratch>/v5/BUILD-UI/e2e.cjs <desktop|p390|p360|land> <toon|classic>` — the whole flow with real
  input (palette, valid / invalid spot, wall line, select, upgrade, sell, overlaps with the command bar and a
  real сход, 44 px targets, clean texts, console errors, keys, minimap aspect).
- `node <scratch>/v5/BUILD-UI/fx.cjs <toon|classic>` — a base under attack: events, hidden rule, screenshots.

## Next / not done

- Real models (ART-ARCH) through `setBaseModelFactory`; card thumbnails (today a family icon).
- `BLD_TEXT` / `FEED` from the content track through `setBuildTexts`.
- Arbuzomet aim on a phone has no ring preview before the tap.
