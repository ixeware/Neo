# ВЫСОТКА v5 — art guide and contract for the new graphics style

Status: **final for the foundation track** — the style system is in the code (`src/render/style.ts`,
`src/render/toon/*`), the numbers below are measured (§6, §10) and classic is proven unchanged (§11). This
is the contract: three art tracks (ART-GROUND, ART-ARCH, ART-CHARS) build on it at the same time and must
not step on each other; their files and task lists are in §9.

The user picks the look in the menu: «Графика: Новая / Старая». `toon` is the new default, `classic` is
the game exactly as it was before v5. **Classic must never change**: every hook you add is behind
`TOON` (see §8), and anything you build for both styles (base buildings) uses the material factory, which
returns the old kind of material in classic.

---

## 1. The look on one page

Reference (style direction only, never its buildings or layout): a bright low-poly toy town — saturated
flat colours, dark outlines, chunky houses with coloured roofs, picket fences, a beige plaza, round and
cone trees, soft shadows, a clear sky. Ours is **that, more detailed, and about this place**: Chechen
villages of hip-roof brick houses behind profiled-metal fences and gates, mosques, the two high-rises,
Soviet five-storey blocks, central Грозный, the Аргун, fields, foothills, roads with гелики.

Five things make the style. Break one and the scene stops reading as «новая графика»:

1. **Flat, saturated colour.** One clean colour per surface, taken from the palette (§2). No gradients, no
   noise textures, no grey-brown mud. A lit surface shows the palette colour as authored.
2. **Three tones, not a gradient.** Light is a stepped ramp: lit / half / shade. Shade is never black: it
   is the same colour at about 60% and pushed to blue-violet (the sky fills it).
3. **A dark outline** around every object and along every hard crease, one colour (`ink`), about 1.3 px on
   a 900 px tall screen (it scales with the resolution), full strength at play zoom and lighter with
   distance so far villages do not turn into soot.
4. **Chunky shapes.** Few big forms, exaggerated roofs and heads, nothing thin. If a part is smaller than
   0.10 world units it must be merged into a bigger form or dropped.
5. **Alive.** Something moves in every screen: smoke, flags, laundry, birds, chickens, clouds' shadows,
   water glints (§4).

### Light, sky, water, haze

| Thing | Value |
|---|---|
| Sun | warm `#fff4d5`, from the west-south-west, about 49° up (`SUN_DIR`); direct light is a 3-step ramp: shade below N·L 0.10, half up to 0.52, lit above, 0.03 soft edge |
| Ambient | hemisphere: sky `#e8f0ff`, ground `#dad9e2`. Sun 0.42 + sky 0.60–0.74 add up to 1.0 on a lit top face, so **a lit face shows the palette colour exactly**; half tone is about 82%, shade about 62% and cool |
| Shadows | desktop: PCF sun shadows at 90% strength (the shadowed ground keeps its hue); phone tier: none from the renderer — big models bring a fake ground shadow (`groundShadow()`, §5) |
| Cloud shadows | soft blobs about 50 units wide drifting over the land (in the shader, no geometry): the sun term drops by 30%, the surface gets about 12% darker |
| Tone mapping | none (a soft shoulder above 0.78 only): what you author is what you see. sRGB output |
| Sky | zenith `#2f9be0` → horizon `#9ad8f5`, flat white cartoon clouds with one `#d6e6f5` shade tone (first-person view and the horizon only; the RTS camera looks down) |
| Backdrop | the map floats in the sky: the same blue gradient above and below the horizon (the old beige table is gone) |
| Haze | distance fog to `#bfe3f2`, starts at 2.1 × the camera distance (at least 170 units), so the play field stays crisp |
| Water | Аргун: flat `#35b8ea`, lighter glints drifting over it, a white foam line pulsing along the banks; no specular highlight, no outline |
| Outline | `ink` `#2a2233` (dark aubergine, never pure black); full strength up to 44 units from the camera, then × (44 / distance)^1.15, never under 12% |

## 2. Palette (toon)

Every colour in a new model comes from here (`C.<role>` in code). Classic keeps its own values under the
same role names, so one builder can serve both styles. Hex values are sRGB.

**Land** (owner: ground track)

| Role | Hex | Use |
|---|---|---|
| `grass` 1–3 | `#6cc84a` `#5fbd42` `#7bd257` | open ground, the dominant colour of the map |
| `meadow` | `#9ad05a` | high pastures in the foothills |
| `forest` 1–3 | `#3f9a3c` `#4aa644` `#368c36` | ground under trees |
| `forestHigh` | `#2f7f4a` `#38885a` | fir belt |
| `crop` 1–7 | `#f4d75e` wheat, `#f7e59a` straw, `#eec25a` ochre, `#cfa06c` ploughed, `#a8dc5a` sunflower green, `#c6d868` olive, `#8fd45c` young | field patches: clear shapes of different colour, like a quilt |
| `yard` 1–3 | `#f0dca6` `#ead29a` `#f5e4b6` | built-up ground, village yards, plazas (the beige of the reference plaza) |
| `earth` | `#d9b98a` `#cfae7c` | bare ground, tracks, construction sites |
| `rock` | `#a39aa0` | steep faces, cliffs, boulders |
| `leaf` 1–6 / `fir` 1–4 / `trunk` | `#3fae46` `#55c24f` `#2f9a3e` `#6fd060` `#47b84a` `#8bd85c` / `#1f8a5a` `#27996a` `#1a7a50` `#2fa878` / `#8a5a3a` | tree crowns (broadleaf, fir) and trunks |
| `water` 1–3 | `#35b8ea` `#49c4f2` `#2aa9e0` | Аргун and ponds; `foam` `#ffffff` |
| `wet` | `#5fc0a0` | reeds, flood plain |
| `asphalt` / `street` / `track` | `#6d6878` / `#8b8594` / `#e4c98f` | roads; `roadLine` `#fff6d8` |
| `skirt` | `#5a3f33` | the diorama edge |

**Architecture** (owner: architecture track)

| Role | Hex | Use |
|---|---|---|
| `wall` 1–6 | `#fff1d6` cream, `#f3d9a4` sand, `#c8553a` red brick, `#e3b45c` yellow brick, `#ffffff` whitewash, `#f2b8a0` pink plaster | house walls |
| `roof` 1–7 | `#e2452f` `#2fa35a` `#2f73d9` `#9b5a36` `#4a4f5e` `#2aa6a0` `#f08a2c` | profiled-metal hip roofs: the colour accents of a village |
| `fence` 1–3 | `#3d7fd0` `#3fa66a` `#8f5a3a` | profiled-metal fences and gates (gate = roof colour or one of these) |
| `trim` | `#fffaf0` | window frames, cornices, plinth lines |
| `glass` / `glassLit` | `#3a5a8a` / `#ffd86b` | windows; one window in five is lit |
| `door` | `#7a4a2c` | wooden doors, shutters |
| `panel` 1–2 | `#e6e0d2` `#d6cfc0` | Soviet panel blocks; `balcony` `#9fb7c9` |
| `marble` / `dome` / `gold` / `mosqueGreen` | `#ffffff` / `#bfe6f2` / `#ffc93c` / `#1f9e6e` | mosques |
| `concrete` / `metal` / `metalDark` | `#c9c4bc` / `#aab4c4` / `#56607a` | bridges, towers, machines |
| `wood` / `woodDark` | `#b9824f` / `#7a4a2c` | scaffolding, crates, palisades |

**Teams, people, effects** (owner: characters track; base buildings use the team roles too)

| Role | Hex | Use |
|---|---|---|
| `team0` / `team0Dark` / `team0Light` | `#2f6bff` / `#1b3fae` / `#9cc0ff` | Старые Атаги |
| `team1` / `team1Dark` / `team1Light` | `#ff4a2e` / `#b3261a` / `#ffb3a1` | Курчалой |
| `neutral` | `#f4ecd8` | unowned flags, rings |
| `skin` / `skinShade` | `#e0a070` / `#c98458` | faces, hands |
| `hair` / `cloth` / `white` | `#2a1f1a` / `#2f3140` / `#fffaf0` | hair and beards, dark trousers, sneakers and shirts |
| `gold` / `heal` / `danger` / `magic` | `#ffc93c` / `#6fe06a` / `#ff3b2f` / `#b06cff` | coins and finials, healing, damage and alarms, stuns and «Н» |
| `ink` | `#2a2233` | outlines, pupils, baked trims |

Rules: at most **five palette colours plus the team colour** on one model. Black and pure grey do not
exist: darkest is `ink`, greys lean violet (`metalDark`) or warm (`concrete`). White is reserved for small
accents (trim, foam, sneakers, marble).

## 3. Shape language and proportions

- **Scale reminder.** One world unit is 100 m. A village house is only 0.27–0.44 units wide and is 10–15 px
  on screen at play zoom (camera distance 38); units are drawn 1.7× and bigger. One pixel is about 0.03
  units at play zoom. So: houses read by **roof colour and silhouette**, not by windows; landmarks, the
  high-rises and base buildings (2–6 units) carry the detail.
- **Chunky.** Wall height : roof height about 1 : 0.8 for houses (roofs are tall and overhang by 12%).
  Chimneys, minarets, antennas, poles are at least 0.06 units thick. Fences are 0.05 thick and 0.5 of the
  wall height.
- **Bevel the big forms, never the small ones.** A chamfer of 6–10% on the main box of a landmark or a base
  building gives the «toy» feel and a clean outline; small parts stay sharp boxes.
- **Round things are low-count but regular:** trees are icospheres (detail 0 or 1) or 6-sided cones,
  domes 8–12 sides, wheels 8 sides. Flat shading everywhere (`flatShading: true`).
- **Windows and doors are few and big:** one door, 2–3 windows per visible wall on a landmark; they are
  flat quads 0.004 above the wall (no insets).
- **Ground contact.** Every building stands on a `yard` or `concrete` pad or a darker plinth strip, so the
  outline closes at the ground and the model never floats on a slope (walls reach 0.25 below ground).
- **Outline rule.** The outline is drawn by the renderer (one post-process pass over the depth buffer, §10)
  for everything opaque that writes depth, except materials marked `ground()` (terrain, roads, water,
  decals). You do not model outlines. Consequences: (a) the pass inks depth steps and creases — two parts
  that should read as separate need a real step (0.02 units or more) or an angle of about 25° or more
  between their faces; coplanar parts of different colour get **no** line, so a window on a wall is a
  colour patch (good), and a door that must pop needs a 0.02 frame; (b) avoid forests of thin parallel
  parts closer than 4 px at play zoom (railings, pickets as separate boxes): make them one slab with the
  gaps painted as `ink`-coloured quads; (c) transparent things never get a line and hide the lines behind
  them in proportion to their opacity, so smoke and rings stay clean; (d) on a slow device the pass turns
  itself off (`STYLE.outline === 'off'`): a model must still read by colour alone, so neighbouring parts
  get different palette colours and buildings a darker plinth strip.

## 4. Richness recipe: what makes a place look alive

Counts are per visible block at play zoom on the desktop tier; the phone tier uses about half (drop the
smallest props first, never the animated ones). Everything is instanced or merged (§6).

**Village block (about 12 houses along a street)** — owner: architecture (houses, fences), ground (plants)
- houses in 3 sizes and 3 roof shapes (hip, hip with a porch, two-storey), walls from `wall`, roofs from
  `roof`, never two equal neighbours;
- a continuous fence line along the street with a gate per plot (gate colour = roof colour), brick posts;
- per plot one or two of: a shed, a parked car (plain, not a unit), a vine arbour, a water tank on legs, a
  satellite dish, a haystack, firewood, a bench at the gate;
- 4–6 trees (fruit trees: round, lighter green, some with `danger`-red or `gold` dots), 6–10 bushes;
- street furniture: 3 poles with wires as one merged ribbon, 1 bus stop or kiosk per 3 blocks;
- **animated:** chimney smoke on 1 house in 6, laundry line on 1 in 8 (cloth quads waving), 3–5 chickens
  wandering, a flag or two on gates, a cat on a fence (static) once per village.

**City block (Грозный)** — owner: architecture
- 2–4 panel blocks with coloured balcony columns, a roof parapet, lift boxes, antennas; ground floors with
  shop fronts in `roof` colours; one mural or coloured end wall per block;
- courtyard: playground (slide, swing), 2 benches, 4–8 parked cars, 6–10 trees in rows, kiosks;
- street: lamp posts every 2 units, bus stop, zebra crossings, traffic lights at crossings, billboards;
- **animated:** cars moving on main streets (few, instanced, on fixed loops), traffic-light blink, pigeons
  taking off, steam from one roof vent per block, lit windows flickering at random.

**Road** — owner: ground
- main roads: asphalt with a centre line and edge lines, a kerb strip in `trim`, road signs every 15–20
  units, guard rails on bridges and embankments, a few poplars in a row;
- village streets: `street` colour, no markings, puddles (flat `water` quads), a speed bump or two;
- tracks: `track` colour with a darker centre strip of grass;
- **animated:** nothing on tracks; on main roads the occasional civilian car, dust behind units.

**Field** — owner: ground
- patches with a clear border (a darker `earth` strip or a hedge line), each patch one crop colour;
- per patch one of: furrow lines (stripes of the same hue, 8% darker), hay bales (round, 6–12), a row of
  sunflowers, a scarecrow, a tractor (static), a stack of crates, irrigation ditch (thin `water` line);
- lone trees and bushes on the borders, a shepherd with 8–15 sheep on meadows (sheep are instanced
  blobs);
- **animated:** sheep graze (slow shuffle), a few birds circling, wheat sway is not needed.

**River bank** — owner: ground
- foam line where water meets land, a pale gravel strip (`earth`) 0.5–1 unit wide, boulders (5–9 per 10
  units of bank), reeds in clumps (`wet`), driftwood, a fishing spot (a stool and a rod) now and then;
- shallows a lighter `water` tone, sandbars in the wide parts;
- bridges with railings, lamp posts and abutments in `concrete`;
- **animated:** water glints drifting downstream, foam line pulsing, ducks (3–5, instanced) near bridges,
  a kingfisher-blue bird crossing once in a while.

**Sky and air everywhere** — owner: foundation: cloud shadows drifting over the land; ground track: 2–3
flocks of birds for the whole map (instanced V-shapes following slow circles), never more.

## 5. Player-built base buildings

Buildings the players place (towers, walls, traps, economy, support) must read at a glance from the RTS
camera, in both teams' colours, at three levels, while under construction and when damaged.

**Footprints** are 1×1, 2×2 or 3×3 cells of 1.2 world units; walls are 1 cell segments. Heights: walls
0.9, traps under 0.3, economy 1.2–1.8, support 1.5–2.2, towers 2.2–3.6 (a tower is always the tallest thing
around except the high-rise).

**Silhouette families** — a player must tell the family from the outline alone:

| Family | Silhouette | Signature part |
|---|---|---|
| Towers (shoot) | tall, narrow, wider at the top (a head on a neck) | the weapon on top is big and comic: a nozzle, a barrel, a bottle, a coil, a megaphone; it turns to the target |
| Walls / gates | low, long, flat-topped, with merlons or sheet-metal waves | corner posts taller than the wall; gate has an arch and team-colour doors |
| Traps | flat on the ground, round or square plate | a bright `danger` or `gold` detail on a `metalDark` plate; half hidden by grass tufts for the enemy |
| Economy | wide and squat, pitched or awning roof, crates and sacks around | a spinning or bobbing prop: a spit, a coin, a fan, a conveyor |
| Support (heal, buff, spawn) | medium, with a dome, a tent or a big sign | a floating icon above it (cross, note, dumbbell, «Н») on a small billboard |

**Levels:** level 1 is `wood` and sheet metal, level 2 brick and `concrete`, level 3 `marble` / `metal`
with `gold` trim. Each level adds a ring of mass (a wider base, a second tier, a crown) — the silhouette
grows by about 15% per level, never just a recolour. Level is also shown by 1–3 `gold` studs on the
front.

**Team colour placement:** the roof or awning, a flag on the highest point, and a 0.12-wide band around the
base. Never the whole building: walls stay palette-neutral so both teams' bases look like one world.
Use `C.team0` / `C.team1` (or the instance colour) — do not bake a side into the geometry if the mesh is
instanced: put the team parts in a second geometry that takes the instance colour (as the house roofs do).

**Construction state:** the level-1 footprint as a `yard` pad, `wood` scaffolding poles at the corners,
the building's lower 40% visible, a crane arm or a ladder, 3 planks; a striped `gold`/`ink` tape band.
Progress = the body rises (scale Y from 0.4 to 1) and the scaffolding drops away at 100%.

**Damage states:** at 66% hp a few `ink` cracks (quads) and a tilted part; at 33% a missing chunk (hide
one sub-mesh: build the top corner as its own triangle range), smoke puffs from the particle system and a
flickering small flame; at 0 the building collapses into a pile of 5–7 boxes in its wall colours that
fade after 6 s.

**Readability at zoom:** from the default zoom (camera distance 70) the family and the team must still
read; from the whole-map view only the team-colour roof and the ring matter. No part thinner than 0.08.

**Ground shadow on the phone tier:** every base building, landmark and the high-rises bring a fake shadow
from `groundShadow(w, d, h, ry)` (style.ts): a flat `ink` sheet at 20% opacity in the shape the box would
cast, pointing north-east like the real sun shadows. It returns `null` when real shadows are on
(`STYLE.shadows`) and in classic, so the call needs no branch. Not for village houses (too many): they get
a darker `yard` patch baked under them instead.

## 6. Budgets and the rules for instancing, merging and LOD

Measured with `renderer.info` over whole frames (shadow pass included) at 10 fixed camera views with 96
units on the field, on the base commit (classic) and on the foundation (toon):

| Tier | Classic draw calls | Classic triangles | Toon foundation |
|---|---|---|---|
| Desktop (1440×900, sun shadows on) | 198–558 (median 300) | 357k–613k | the same scene **+1 draw call, +1 triangle** (the outline composite) |
| Phone tier / `?lq` (390×844, no shadows) | 88–186 (median 130) | 220k–324k | the same scene **+1 draw call, +1 triangle** |

The foundation costs no geometry: outlines, sky, cloud shadows and water are shader work. So the whole
triangle and draw-call headroom belongs to the three tracks.

**Hard limits for toon at the end of v5** (any overview: camera distance 70–300 over Атаги, Курчалой,
Грозный, Шали, the river; and the close fight):

| | Phone tier / `?lq` | Desktop |
|---|---|---|
| Triangles | **≤ 480k** | **≤ 1.2M** |
| Draw calls | **≤ 1.3 × classic** in the same view (classic worst view is 186, so never above 240) | ≤ 1.5 × classic in the same view (never above 830) |

What each track may **add** on top of the foundation in the worst overview (classic worst: Грозный, 324k
triangles on the phone tier and 613k on desktop):

| Track | Phone triangles | Phone draw calls | Desktop triangles | Desktop draw calls | Bundle bytes (minified JS in `dist/index.html`) |
|---|---|---|---|---|---|
| Ground and nature | +55k | +16 | +200k | +60 | 110 KB |
| Architecture and base buildings | +70k | +20 | +250k | +90 | 170 KB |
| Characters and vehicles | +30k | +12 | +100k | +50 | 150 KB |
| Reserve (merger) | +1k | +5 | +37k | +30 | — |

A track that replaces old geometry (new house kits instead of the old ones, new trees) counts the
**difference**. Replacing is the cheap way to get richer: the old village houses alone are 190k–275k
triangles on desktop.

`dist/index.html` is 1.90 MB at the base commit and 1.92 MB with the foundation (+19 KB); it must end v5
**under 3.2 MB** for all tracks together (art, sim, UI, texts). Geometry is code: write builders with
loops and shared helpers, not vertex lists. No image files, no fonts, no external models.

Fill rate is the other budget on phones: the outline pass reads the frame once (6 texture reads per
pixel in `lite`), and a slow device drops it by itself. Do not add full-screen passes, and keep
transparent surfaces small (see «Transparency» below).

Rules:
- **Instance** anything that repeats more than 8 times (props, plants, animals, cars, base walls):
  `THREE.InstancedMesh`, chunked by position (50–60 units) so frustum culling works, shuffled inside a
  chunk so a prefix is an even sample (see `chunked()` and `updateWorldLod()` in `src/render/world.ts`).
- **Merge** everything that is unique and static into one vertex-coloured geometry per landmark / per
  chunk (`Builder` in `src/render/models.ts`): one landmark = one draw call. Canvas-texture signs are the
  one allowed extra call per landmark.
- **One material per family.** Get it from the factory (§8): the same `mat.solid()` instance is shared by
  every vertex-coloured mesh, so the renderer batches state.
- **Per-object triangle caps:** village house kit ≤ 60 (phone ≤ 30), prop ≤ 40, tree ≤ 80 (phone ≤ 40),
  animal ≤ 60, civilian car ≤ 160, landmark ≤ 2.5k, base building ≤ 600 per level (walls ≤ 120 per
  segment, traps ≤ 150), unit ≤ 450 (crowd units ≤ 300), hero ≤ 1.4k, boss ≤ 2.5k, vehicle ≤ 900.
- **LOD:** draw-count LOD by distance for instanced props (prefix of the shuffled chunk), a far kit for
  houses and trees beyond camera distance 160 (the phone tier always uses the far kit for trees), and a
  hard cut-off: props smaller than 3 px are not drawn (cut at camera distance 120 for village props, 200
  for field props). Animated things stop animating beyond distance 110.
- **Shadows:** only desktop has sun shadows. Props under 0.25 units tall do not cast (`castShadow =
  false`): they cost a second draw call in the shadow pass for nothing.
- **Transparency:** avoid. Use alpha only for water glints, smoke, fake shadows and UI rings; never for
  foliage or fences (use geometry).
- **Animation** is done in the vertex shader or by rewriting a small instance matrix buffer; never by one
  `Mesh` per moving thing.

## 7. Characters in this style

- **Proportions:** 2.6 heads tall for crowd units, 3 for heroes, 3.4 for bosses. Head = 38% of the body
  width or more; hands and feet one size too big; no neck. Keep the existing unit heights and footprints
  (the sim, the health bars and first person depend on them).
- **Face:** two `ink` eyes (tall rectangles, 1/6 of the head width apart from the centre), eyebrows only
  when they carry the joke, a beard as one flat-coloured block, no mouth unless the character shouts. A
  face must read at 20 px.
- **What to exaggerate:** the one thing the chat knows the person for — the барсетка, the shampoo
  bottle, shoulders of a wrestler, the bomber, the three monitors, the tracksuit stripes. Make it 1.5× and
  give it the brightest palette colour on the model.
- **Team read:** the torso (shirt, tracksuit, jacket) is the team colour for crowd units; heroes keep their
  own outfit and wear the team colour as a clear accent (cap, scarf, armband, sneakers) of at least 12% of
  the visible surface.
- **Outline:** from the renderer, like everything else. Keep limbs apart from the body by a visible gap or
  a colour change so the ink does not swallow them; no parts thinner than 0.05 model units.
- **Tones:** one colour per part; a second, darker palette colour for the underside is allowed (soles,
  under the cap). No painted shading: the ramp does it.
- **Vehicles:** a toy-car look: big wheels (25% of the height), short overhangs, windows one flat `glass`
  colour with a white corner glint quad, headlights `gold`-tinted white, number plate as a white quad
  (real text only where it already exists). Гелик stays boxy and black-violet (`cloth`), КРА plate.
- **Animation hints:** squash on landing, a head bob when walking, weapons bigger than hands. Idle crowd
  units breathe (scale Y ±2%).

## 8. The style module: API

`src/render/style.ts` is the one import a builder needs. The style is resolved once at start: URL
`?gfx=classic|toon` wins, then the saved preference (`localStorage['vysotka.prefs'].gfx`), default
`toon`. The menu setting «Графика: Новая / Старая» saves the choice and reloads the page; a running war
is checkpointed first and entered again right after the reload (solo: the local save; shared war: it
rejoins the same side).

```ts
import { TOON, STYLE, C, HEX, TEAM, mat, native, ground, restyle, restyleGeometry, SUN_DIR, groundShadow } from '../style'; // from src/render/toon/**

TOON                      // true in the new style; guard every toon-only hook with it
STYLE.tier                // 'desktop' | 'phone' (phone = lowPower: phones, small screens, ?lq)
STYLE.shadows             // real sun shadows are drawn (desktop tier)
STYLE.outline             // 'full' | 'lite' | 'off' right now (a slow device steps down while playing)

C.grass[0], C.roof[2], C.team0, C.ink …   // THREE.Color per palette role (§2) in the current style
HEX.roof[2]                                // the same as a hex string (canvas textures)
TEAM[side].main / .dark / .light           // team colours by side (0 Атаги, 1 Курчалой)

mat.solid()               // shared, vertex-coloured, flat-shaded Lambert: every merged model (Builder)
mat.plain()               // shared, white, no vertex colours: InstancedMesh with instance colours
mat.plain(C.roof[0])      // one flat colour
mat.glow(C.glassLit, 1.6) // lit colour that also glows (lit windows, screens, lamps)
mat.unlit(C.gold, { opacity: 0.6, ground: true })   // MeshBasic, not shared: rings, icons, decals
// lit factory materials take { side, ground }: mat.solid({ ground: true }) for flat things on the land

native(material)          // «these colours are already toon palette»: skip the legacy colour remap
ground(material)          // lies on the ground: no outline on it (terrain, roads, water, decals)
restyle(color)            // an old classic colour → the current style (identity in classic)
restyleGeometry(geo)      // the same for a whole `color` attribute, in place (toon only)
SUN_DIR                   // unit vector towards the sun, for baked details
groundShadow(w, d, h, ry) // fake shadow sheet for the phone tier, or null (see §5)
```

For the places the outline pass does not reach (2D renders with a transparent background: portraits,
thumbnails) there is a sticker outline — the picture's own silhouette in ink behind it:

```ts
import { inkSticker } from '../render/toon/hull';
const url = (TOON ? inkSticker(canvas, 2.5) : canvas).toDataURL('image/png');   // as src/ui/portraits.ts does
```

A renderer of your own (a tool page) joins the style with `styleRenderer(renderer)` and
`styleLights(hemi, sun)`, or the whole thing at once: `styleStage(renderer, scene, hemi, sun, lowPower,
msaa, { clouds: false, pin: true })` returns a `ToonStage` (or `null` in classic) whose
`render(scene, camera)` draws the frame with outlines — see `tools/lineup.ts`.

URL switches for testing: `?gfx=classic|toon`, `?lq` (phone tier), `?ol=full|lite|off` (pin the outline
mode; without it a device slower than 25 fps steps down by itself), `?ol=hull` (comparison mode, §10).

**What you get for free** (so you know what not to do by hand):
- In toon every `MeshLambertMaterial` / `MeshPhongMaterial` in the game — old or new, instanced or not —
  gets the stepped ramp, the cool shade, cloud shadows and the toon output curve, through a one-time patch
  of three's shader chunks (`toon/shading.ts`). Nothing to do per material.
- Old models keep their old vertex colours; the shader **remaps** them: saturated colours get purer and
  brighter, greys, whites and darks stay. A model rebuilt with palette colours must use a factory material
  (they are native) or `native()`, otherwise it is saturated twice.
- Outlines come from the depth buffer. `ground()` is the only flag there is.
- `MeshBasicMaterial` is neither ramped nor remapped: canvas signs, rings and bars keep their exact
  colours (they still get outlines if they are opaque and write depth).
- Never set `renderer.toneMapping`, fog or the scene background yourself, and never write your own
  `ShaderMaterial` for lit surfaces: it would miss the ramp. If a surface needs custom shader code, start
  from a factory material and use `onBeforeCompile` (see `toon/water.ts`); the uniform `toonA.x` is the
  time in seconds.

Example — a toon variant hooked into an existing builder with one line:

```ts
// src/render/world.ts (owner: architecture)
import { TOON } from './style';
import { toonHouseKits } from './toon/arch/houses';
…
const { variants } = TOON ? toonHouseKits() : houseGeometries();
```

```ts
// src/render/toon/arch/props.ts (new file)
import * as THREE from 'three';
import { Builder } from '../../models';
import { C, mat } from '../../style';
export function toonWell(): THREE.Mesh {
  const b = new Builder();
  b.box(C.concrete, [0, 0.15, 0], [0.5, 0.3, 0.5]);
  b.box(C.roof[1], [0, 0.62, 0], [0.62, 0.06, 0.62]);
  return new THREE.Mesh(b.build(), mat.solid());
}
```

A model that must exist in both styles (base buildings) is written once against `C` and `mat`: in classic
`C` holds the old muted colours of the same roles and the materials are the plain Lambert the old
builders use.

## 9. File ownership

One file, one owner. If you need a change in a file you do not own, add an exported hook in **your** new
file and ask the merger for the one-line call — do not edit it.

**Nobody but the merger** (foundation files): `src/render/style.ts`, `src/render/toon/palette.ts`,
`shading.ts`, `post.ts` (outlines and the sky), `stage.ts`, `hull.ts`, `water.ts`, `land.ts`, `hud.css`,
`src/render/scene.ts`, `fpcam.ts`, `selection.ts`, `packFx.ts`, `coinFx.ts`, `src/main.ts`, `index.html`,
`src/ui/*` (except `portraits.ts`), `tools/lineup.*`, `docs/v5/ART.md`. A track that needs a new palette
role keeps it in its own folder (`toon/<track>/colors.ts`) and lists it in its report; the merger moves
it into `palette.ts`.

The foundation already left one-line hooks in files the tracks own: `lowpoly.ts` (land palette and face
jitter), `terrainMesh.ts` (`ground(native(…))`, the toon water), `roads.ts` (`ground(…)`),
`src/ui/portraits.ts` (style + ink hull). Keep them when you edit around them.

| Track | May edit (existing) | Creates (new) |
|---|---|---|
| **Ground and nature** (ART-GROUND) | `src/render/lowpoly.ts`, `terrainMesh.ts`, `trees.ts`, `roads.ts`; and by agreement the foundation's `toon/land.ts` and `toon/water.ts` (land palette values, water look) | `src/render/toon/ground/**` (field details, river banks, rocks, plants, animals, birds, road furniture) |
| **Architecture and base buildings** (ART-ARCH) | `src/render/world.ts`, `city.ts`, `grozny.ts`, `decor.ts`, `landmarks.ts`, `placeMarks.ts` | `src/render/toon/arch/**` (house kits, fences, village props, mosques, high-rises, city blocks, landmarks), `src/render/toon/base/**` (player-built buildings: geometry per kind and level, construction and damage states, a `BaseView` class the integrator wires to the sim) |
| **Characters and vehicles** (ART-CHARS) | `src/render/models.ts`, `heroes.ts`, `girls.ts`, `props.ts`, `units.ts`, `fx.ts`, `abilityFx.ts`, `src/ui/portraits.ts` | `src/render/toon/chars/**` (unit, hero, boss and vehicle rebuilds, projectiles, civilian cars and people for the richness recipe) |

Cross-file facts to respect:
- `models.ts` also holds the house kit and façade textures, `props.ts` the 2GIS landmark models,
  `heroes.ts` the Донер Бей / Фудзи / gym / taxi buildings, `grozny.ts` the v4 unit models. The
  architecture track **replaces** those buildings from its own files through hooks in `world.ts` /
  `decor.ts` / `city.ts` (which it owns) instead of editing `models.ts`, `props.ts` or `heroes.ts`; the
  characters track leaves the v4 unit models in `grozny.ts` alone and rebuilds them in `toon/chars/`.
- Nothing in `src/sim/**` is touched by any art track. Art never reads `Math.random()` for placement:
  use `hash2()` from `lowpoly.ts` so every client sees the same world.
- Every hook is `if (TOON) …` (or `TOON ? a : b`); with `?gfx=classic` the canvas must stay pixel-identical
  to the base commit (the merger checks with a fixed clock and seed).

### Task lists (priority order) and deliverables

**Ground and nature (ART-GROUND)**
1. Land palette tuned on real views; field patches with borders and furrows; rock faces.
2. River: banks, gravel, boulders, reeds, bridges' surroundings; water glint tuning with the foundation hook.
3. Trees: round and cone kits (near and far), fruit trees in villages, bushes, poplar rows on main roads.
4. Roads: markings, kerbs, signs, puddles; road colours from the palette.
5. Life: sheep, chickens in villages (with architecture: you own the animals), birds, hay bales, scarecrows.
6. Foothills: meadow tiers, boulders, the fir belt.
Screenshots (desktop and `?lq`, toon, and one classic to show it is unchanged): Атаги overview (dist 70), a
field close-up (dist 25), the river at a bridge (dist 30), the foothills south of Шали (dist 90), a road
crossing (dist 20), the whole map.

**Architecture and base buildings (ART-ARCH)**
1. Village house kits (3 sizes × 3 roofs, fence + gate), instanced, with a far kit; village props.
2. Base buildings: the five families × three levels, construction and damage states, `BaseView`.
3. The two high-rises (floors must still collapse one by one), mosques (Шали, brick, Ottoman).
4. Грозный: panel blocks near kit, courtyards, street furniture; landmark set (ГГНТУ, ЧГУ, Шайба, Ансар).
5. 2GIS landmarks and food places (Донер Бей, Фудзи, gym, taxi stand, stadium, market…).
6. Fake ground shadows for the phone tier on everything above 1 unit.
Screenshots: a village street (dist 14 and 38), Атаги and Курчалой overviews, both high-rises close, Шали
mosque, Грозный centre (dist 38 and 90), a sheet of all base buildings (families × levels × both teams,
plus construction and damage), `tools/lineup.html?view=bld` in both styles.

**Characters and vehicles (ART-CHARS)**
1. Crowd units 0–4 and 17 for both sides, then bosses (Ислам, Зураб).
2. Heroes 6–11 and 18, summons (Голем, chickens), then rides and Гелик, Камри, the ram.
3. Projectiles and ability props (Себозол, гантели, the pack) in palette colours.
4. Portrait framing check (`src/ui/portraits.ts`): faces must read on the deck cards.
5. Civilian extras for the richness recipe: parked and moving cars, 3 pedestrians, a shepherd.
Screenshots: `tools/lineup.html?view=all`, `view=heroes`, `view=game` in both styles, a close fight (dist
16), first person behind one unit, the deck with portraits on a phone.

Each track also reports `renderer.info` (draw calls, triangles) for its views on both tiers against the
budget in §6, and the size of `dist/index.html`.

## 10. How the look was decided (measured)

**Shading.** Tuned Lambert against a stepped ramp, both on the old flat-shaded, vertex-coloured, merged
and instanced geometry (nothing in the scene needs smooth normals). The ramp wins for free: every face
has one normal, so a ramp costs two `smoothstep`s per pixel and turns the noisy facets of the plain into
flat fields while the foothills fall into clean bands. It is applied by patching three's Lambert / Phong
light chunks once, so merged meshes, `InstancedMesh` with instance colours, textured façades and the
terrain all change together and no builder was touched. Colour: ACES tone mapping was what made the old
palette muddy; the toon output is a straight sRGB curve with a soft shoulder.

**Outlines.** Three options were compared on the same build, the same views and the same 96 units
(`…/ART-FOUND/meas/`; draw calls and triangles are exact, whole frames with the shadow pass):

**Desktop 1440×900, shadows on** — views: Атаги overview / close fight / Грозный overview / whole map

| Option | Draw calls | Triangles |
|---|---|---|
| Classic (no outlines) | 347 / 223 / 230 / 558 | 460k / 357k / 613k / 444k |
| Toon shading only, `?ol=off` | 347 / 223 / 230 / 558 | 460k / 357k / 613k / 444k |
| Depth pass, `lite` (6 fetches) | 348 / 224 / 231 / 559 | 460k / 357k / 613k / 444k |
| Depth pass, `full` (10 fetches) | 348 / 224 / 231 / 559 | 460k / 357k / 613k / 444k |
| Inverted hull on every lit mesh, `?ol=hull` | 483 / 306 / 320 / 996 | 612k / 454k / 819k / 757k |

**Phone tier 390×844, `?lq`** — views: Атаги overview / close fight / Грозный overview / whole map

| Option | Draw calls | Triangles |
|---|---|---|
| Classic (no outlines) | 152 / 91 / 105 / 186 | 236k / 230k / 324k / 221k |
| Toon shading only, `?ol=off` | 152 / 91 / 105 / 186 | 236k / 230k / 324k / 221k |
| Depth pass, `lite` (6 fetches) | 153 / 92 / 106 / 187 | 236k / 230k / 324k / 221k |
| Depth pass, `full` (10 fetches) | 153 / 92 / 106 / 187 | 236k / 230k / 324k / 221k |
| Inverted hull on every lit mesh, `?ol=hull` | 254 / 162 / 183 / 349 | 314k / 303k / 491k / 316k |


Frame time: the cost of the pass itself, measured inside one page by switching the mode every few
frames so machine load cancels out (best of 3 rounds, three views summed; software GL, where a frame
takes 0.2–0.7 s, so only the ratios mean anything — a real GPU pays far less for a full-screen pass than
for the scene, and the governor covers the devices where that is not true):

| Tier | `off` | `lite` | `full` |
|---|---|---|---|
| Desktop 1440×900 | 1.000 | 1.057 | 1.077 |
| Phone tier 390×844 | 1.000 | 1.084 | 1.095 |

- **Inverted hull** (a back-face copy of every lit mesh pushed out by 1.3 px along smoothed normals, the
  instanced ones sharing their instance matrices): on the phone tier draw calls go up by 67–88% and
  triangles by 31–51% (desktop +37–78% and +27–70%; less in relative terms only because the shadow pass
  is not hulled). That is far over the 1.3× draw-call budget, and the Грозный overview alone reaches 491k
  triangles before any new art. And it still inks only silhouettes: no line where a roof meets its wall,
  none between touching units of one mesh, and open kits (house walls without caps, roofs without a
  bottom) get half a line — compare `meas/desktop_hull/desktop_fight.png` with
  `meas/desktop_full/desktop_fight.png`. It also needs a welded-normal copy of every geometry
  (flat-shaded models tear at each edge otherwise). Rejected; the code stays as `?ol=hull` so the
  comparison can be repeated.
- **Post-process on depth** (chosen): one extra draw call and one triangle whatever is on screen. The
  Laplacian of the raw depth buffer is zero on any flat face and non-zero at silhouettes and creases, so
  depth alone gives both — no normal or id pass, so the scene is still drawn once. The alpha channel of
  the colour target carries the «no ink» mask (terrain, roads, water), and transparent effects blend it
  up, which hides the lines behind smoke and sprites. It looks like the reference: one even dark line.
  The colour target is plain RGBA8 holding display-ready colour (the materials write the toon curve and
  sRGB themselves), so the composite is a copy plus the line; desktop renders it with 4× MSAA.
- **Dark trims baked into geometry**: free at run time, but it only exists on models rebuilt for it, it
  cannot outline a silhouette against the ground, and thin trim quads shimmer at distance. Not a global
  answer; it is the right **supplement** for the weak tier, which is why §3 asks for plinth strips and
  colour contrast between neighbouring parts.

**Tiers.** Desktop: `full` (10 texture reads per pixel, line on both sides of an edge). Phone tier:
`lite` (6 reads, mask from the centre pixel: a slightly thinner line). Weak devices: a governor watches
the frame time and steps `full → lite → off` when the average stays above 40 ms; `off` draws straight to
the canvas with no extra pass, so the cost over classic is the ramp alone.

**Sun shadows** stay desktop-only as in classic (they double the draw calls: 152 → 347 in the Атаги
overview). The phone tier gets the cool shade of the ramp, cloud shadows and fake ground shadows.

## 11. Classic stays classic: how it is checked

`…/scratchpad/v5/ART-FOUND/` holds the harness (not in the repo; the scripts are short):

- `cap.cjs <out> desktop|phone "<query>"` drives the game with a fake clock (frames advance only when the
  script steps them), a seeded `Math.random` and fonts blocked, spawns the same two armies, pauses the
  sim and dumps the canvas at 10 fixed cameras, with `renderer.info` per frame. Two runs of the base
  commit are pixel-identical, so any difference is a real one.
- `lineup.cjs <out> "<query>"` dumps `tools/lineup.html` views (all, heroes, bld, decor, v4units, v4bld,
  city, lm, game, skyline).
- `cmp.cjs <a> <b>` compares two folders pixel by pixel.

- `portraits.cjs <url> <out.json>` collects the 28 portrait images (`src/ui/portraits.ts`) the menu and the
  deck show, as data URLs.
- `switch.cjs desktop|phone <out>` clicks through «Графика: Новая → Старая → Новая» inside a running war
  and checks that the style, the saved preference and the war (the tick keeps counting, units alive)
  survive each reload, and that `?gfx=` overrides the saved choice.

Result on the final code of this branch: every desktop view (10), every phone view (10) and every lineup
view (10) rendered with `?gfx=classic` is **identical** to the base commit (`4b8c2dc`) — 0 pixels differ
in 30 images — and the 28 portraits are byte-identical. Re-run it after merging the art tracks: a hook
that is not behind `TOON` shows up here at once.
