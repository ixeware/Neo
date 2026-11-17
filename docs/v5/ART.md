# ВЫСОТКА v5 — art guide and contract for the new graphics style

Status: **v1 (written before the foundation code was finished)**. Sections marked ◇ hold provisional
numbers; the foundation track replaces them with measured ones in its last commit. Everything else is the
contract: three art tracks build on it at the same time and must not step on each other.

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
3. **A dark outline** around every object and along every hard crease, one colour (`ink`), about 1.3 px at
   1080p, fading with distance so far villages do not turn into soot.
4. **Chunky shapes.** Few big forms, exaggerated roofs and heads, nothing thin. If a part is smaller than
   0.10 world units it must be merged into a bigger form or dropped.
5. **Alive.** Something moves in every screen: smoke, flags, laundry, birds, chickens, clouds' shadows,
   water glints (§4).

### Light, sky, water, haze

| Thing | Value |
|---|---|
| Sun | warm `#fff1cf`, from the south-west, about 49° up; direct light is a 3-step ramp (shade below N·L 0.10, half up to 0.52, lit above; 0.03 soft edge) |
| Ambient | hemisphere: sky `#cfe0ff`, ground bounce `#c9b28e`; this is what tints the shade |
| Shadows | desktop: soft PCF sun shadows at 85% strength, so the ground under a shadow keeps its hue; phone tier: none from the renderer — models bring a fake ground shadow (§5) |
| Cloud shadows | large soft blobs drifting north-east over the land (shader, no geometry), 12% darker |
| Tone mapping | none (a soft shoulder above 0.75 only): what you author is what you see. sRGB output |
| Sky | zenith `#2f9be0` → horizon `#9ad8f5`, flat white cartoon clouds with one `#d6e6f5` shade tone (first-person view and the horizon only; the RTS camera looks down) |
| Haze | distance fog to `#bfe3f2`, starts later than classic so the play field stays crisp |
| Water | Аргун: flat `#35b8ea` with lighter moving glints and a white foam line along the banks; no specular highlight |
| Outline | `ink` `#2a2233` (dark aubergine, never pure black) |

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
| `crop` 1–7 | `#f2cf5a` wheat, `#f5e08c` straw, `#e8b24a` ochre, `#b9824f` ploughed, `#b9d94e` sunflower, `#cbd066` olive, `#8fd45c` young | field patches: clear rectangles of different colour, like a quilt |
| `yard` 1–3 | `#f0dca6` `#ead29a` `#f5e4b6` | built-up ground, village yards, plazas (the beige of the reference plaza) |
| `earth` | `#d9b98a` `#cfae7c` | bare ground, tracks, construction sites |
| `rock` | `#a39aa0` | steep faces, cliffs, boulders |
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
- **Outline rule.** The outline is drawn by the renderer (post-process on depth) for everything that writes
  depth, except materials marked `ground()` (terrain, roads, water, decals). You do not model outlines.
  Two consequences: (a) two surfaces that should read as separate objects need a real depth step or a
  crease of 25° or more between them; (b) avoid forests of thin parallel parts closer than 4 px apart at
  play zoom (railings, picket fences as separate boxes): make them one slab with the gaps painted as
  `ink`-coloured quads. On the weak tier the outline pass may be off: a model must still read by colour,
  so give neighbouring parts different palette colours.

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

**Ground shadow on the phone tier:** every base building, landmark and the high-rises bring a fake shadow:
a dark `ink` quad at 25% opacity, the footprint sheared 0.35 of the height towards north-east, material
`ground(mat.unlit(...))`. It is skipped when real shadows are on (`STYLE.shadows`).

## 6. Budgets and the rules for instancing, merging and LOD ◇

Measured at the base commit (classic), 10 fixed camera views, 96 units on the field:

| Tier | Draw calls | Triangles |
|---|---|---|
| Desktop (1440×900, shadows on) | 198–558 (median 300) | 357k–613k |
| Phone tier / `?lq` (390×844, no shadows) | 88–186 (median 130) | 220k–324k |

**Hard limits for toon at the end of v5** (any overview: camera distance 70–300 over Атаги, Курчалой,
Грозный, Шали, the river):

| | Phone tier / `?lq` | Desktop |
|---|---|---|
| Triangles | **≤ 480k** | **≤ 1.2M** |
| Draw calls | **≤ 1.3 × classic** in the same view (≤ 240 in the worst view) | ≤ 1.5 × classic (≤ 830) |

What each track may **add** on top of classic in the worst overview (the foundation itself adds 1–2 draw
calls and no triangles):

| Track | Phone triangles | Phone draw calls | Desktop triangles | Desktop draw calls | Bundle bytes (minified JS in `dist/index.html`) |
|---|---|---|---|---|---|
| Ground and nature | +55k | +16 | +200k | +60 | 110 KB |
| Architecture and base buildings | +70k | +20 | +250k | +90 | 170 KB |
| Characters and vehicles | +30k | +12 | +100k | +50 | 150 KB |
| Reserve (merger) | +5k | +6 | +30k | +30 | — |

`dist/index.html` is 1.90 MB at the base commit and must end v5 **under 3.2 MB** for all tracks together
(art, sim, UI, texts). Geometry is code: write builders with loops and shared helpers, not vertex lists.
No image files, no fonts, no external models.

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

## 8. The style module: API ◇

`src/render/style.ts` is the only thing a builder needs to import. It resolves the style once at start
(URL `?gfx=classic|toon` wins, then the saved preference, default `toon`). Switching in the menu saves the
preference and reloads the page; the solo war is checkpointed first and resumes with «Продолжить».

```ts
import { TOON, C, mat, ground, native, restyle, STYLE } from '../style';   // from src/render/toon/**

TOON                      // true in the new style; guard every toon-only hook with it
STYLE.tier                // 'desktop' | 'phone' (phone = lowPower / ?lq)
STYLE.shadows             // real sun shadows are on (desktop tier)
STYLE.outline             // 'full' | 'lite' | 'off' (weak devices fall back at run time)

C.grass[0], C.roof[2], C.team0, C.ink …      // THREE.Color per palette role (§2), in the current style

mat.solid()               // shared vertex-coloured flat-shaded Lambert: use for every merged model
mat.solid({ instanced: true })   // the same for InstancedMesh with instance colours
mat.tint(C.roof[0])       // one flat colour, no vertex colours
mat.unlit(C.gold, { transparent: true, opacity: 0.6 })   // MeshBasic: rings, icons, fake shadows
mat.glow(C.glassLit, 1.6) // emissive accent (lit windows, screens)

native(material)          // «these colours are already toon palette»: skip the legacy colour remap
ground(material)          // lies on the ground: no outline (terrain, roads, water, decals, fake shadows)
restyle(color)            // old classic colour → nearest look in the current style (identity in classic)
```

How the global look works (so you know what you get for free):
- In toon every `MeshLambertMaterial` / `MeshPhongMaterial` in the game gets the stepped ramp, the tinted
  shade, cloud shadows and the toon output curve through a patch of three's shader chunks. Nothing to do
  per material.
- Old models keep their old vertex colours; the shader **remaps** them (more saturation, lifted values) so
  they sit in the new palette. A model rebuilt with palette colours must opt out with `native()` (the
  factory materials are native already), otherwise it is saturated twice.
- Outlines come from the post-process pass over the depth buffer. A material marked `ground()` writes
  «no outline here».
- `MeshBasicMaterial` is untouched by the ramp and the remap: canvas signs keep their exact colours.

Example — a toon variant hooked into an existing builder with one line:

```ts
// src/render/world.ts (owner: architecture)
import { TOON } from './style';
import { toonHouseKits } from './toon/arch/houses';
…
const { variants } = TOON ? toonHouseKits() : houseGeometries();
```

```ts
// src/render/toon/arch/houses.ts (new file)
import { Builder } from '../../models';
import { C, mat } from '../../style';
export function toonWell(): THREE.Mesh {
  const b = new Builder();
  b.box(C.concrete, [0, 0.15, 0], [0.5, 0.3, 0.5]);
  b.box(C.roof[1], [0, 0.62, 0], [0.62, 0.06, 0.62]);
  return new THREE.Mesh(b.build(), mat.solid());
}
```

## 9. File ownership

One file, one owner. If you need a change in a file you do not own, add an exported hook in **your** new
file and ask the merger for the one-line call — do not edit it.

**Nobody but the merger** (foundation files): `src/render/style.ts`, `src/render/toon/shading.ts`,
`src/render/toon/post.ts`, `src/render/toon/sky.ts`, `src/render/toon/water.ts`, `src/render/toon/land.ts`,
`src/render/toon/hud.css`, `src/render/scene.ts`, `src/render/fpcam.ts`, `src/render/selection.ts`,
`src/render/packFx.ts`, `src/render/coinFx.ts`, `src/main.ts`, `index.html`, `src/ui/*`, `tools/lineup.*`,
`docs/v5/ART.md`.

| Track | May edit (existing) | Creates (new) |
|---|---|---|
| **Ground and nature** | `src/render/lowpoly.ts`, `terrainMesh.ts`, `trees.ts`, `roads.ts` | `src/render/toon/ground/**` (palette tuning via `toon/ground/land2.ts`, field details, river banks, rocks, plants, animals, birds, road furniture) |
| **Architecture and base buildings** | `src/render/world.ts`, `city.ts`, `grozny.ts`, `decor.ts`, `landmarks.ts`, `placeMarks.ts` | `src/render/toon/arch/**` (house kits, fences, village props, mosques, high-rises, city blocks, landmarks), `src/render/toon/base/**` (player-built buildings: geometry per kind and level, construction and damage states, a `BaseView` class the integrator wires to the sim) |
| **Characters and vehicles** | `src/render/models.ts`, `heroes.ts`, `girls.ts`, `props.ts`, `units.ts`, `fx.ts`, `abilityFx.ts`, `src/ui/portraits.ts` | `src/render/toon/chars/**` (unit, hero, boss and vehicle rebuilds, projectiles, civilian cars and people for the richness recipe) |

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

**Ground and nature**
1. Land palette tuned on real views; field patches with borders and furrows; rock faces.
2. River: banks, gravel, boulders, reeds, bridges' surroundings; water glint tuning with the foundation hook.
3. Trees: round and cone kits (near and far), fruit trees in villages, bushes, poplar rows on main roads.
4. Roads: markings, kerbs, signs, puddles; road colours from the palette.
5. Life: sheep, chickens in villages (with architecture: you own the animals), birds, hay bales, scarecrows.
6. Foothills: meadow tiers, boulders, the fir belt.
Screenshots (desktop and `?lq`, toon, and one classic to show it is unchanged): Атаги overview (dist 70), a
field close-up (dist 25), the river at a bridge (dist 30), the foothills south of Шали (dist 90), a road
crossing (dist 20), the whole map.

**Architecture and base buildings**
1. Village house kits (3 sizes × 3 roofs, fence + gate), instanced, with a far kit; village props.
2. Base buildings: the five families × three levels, construction and damage states, `BaseView`.
3. The two high-rises (floors must still collapse one by one), mosques (Шали, brick, Ottoman).
4. Грозный: panel blocks near kit, courtyards, street furniture; landmark set (ГГНТУ, ЧГУ, Шайба, Ансар).
5. 2GIS landmarks and food places (Донер Бей, Фудзи, gym, taxi stand, stadium, market…).
6. Fake ground shadows for the phone tier on everything above 1 unit.
Screenshots: a village street (dist 14 and 38), Атаги and Курчалой overviews, both high-rises close, Шали
mosque, Грозный centre (dist 38 and 90), a sheet of all base buildings (families × levels × both teams,
plus construction and damage), `tools/lineup.html?view=bld` in both styles.

**Characters and vehicles**
1. Crowd units 0–4 and 17 for both sides, then bosses (Ислам, Зураб).
2. Heroes 6–11 and 18, summons (Голем, chickens), then rides and Гелик, Камри, the ram.
3. Projectiles and ability props (Себозол, гантели, the pack) in palette colours.
4. Portrait framing check (`src/ui/portraits.ts`): faces must read on the deck cards.
5. Civilian extras for the richness recipe: parked and moving cars, 3 pedestrians, a shepherd.
Screenshots: `tools/lineup.html?view=all`, `view=heroes`, `view=game` in both styles, a close fight (dist
16), first person behind one unit, the deck with portraits on a phone.

Each track also reports `renderer.info` (draw calls, triangles) for its views on both tiers against the
budget in §6, and the size of `dist/index.html`.
