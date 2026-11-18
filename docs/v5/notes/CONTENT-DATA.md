# CONTENT-DATA — notes

Track: the chat content as game data and on screen («добавь больше контента с чата… ещё больше локальных
прикольчиков и персонажей»). Source: the curated plan `CONTENT.md` (scratchpad `v5/out/`), `chat_bank.json`
behind it. Base commit: b562931 (sim buildings + toon style + build-mode UI).

## Done

1. **Data** — new files, nothing random inside (index in, text out); clean text by default, 18+ in `spicy*`
   fields or `spicy: true` lines:
   - `src/data/v5lore.ts` — `BLD_TEXT` (27 sim keys + 8 planned buildings: short name, full name, gender and
     accusative for feed grammar, blurb, joke, level names, `plan` for the eight), `FEED` (311 lines in 28
     groups), helpers `bldLore`, `bldVars`, `feedPool`, `feedLine`, `v5fill`, `v5at`, `v5text`, `FEED_GEN`,
     `noVowels`, `BLD_UI`.
   - `src/data/v5cast.ts` — `V5_CHARS` (15 characters, 6 marked `best`), `V5_LOOK` (two lines for the modeller,
     kept apart so it stays out of the bundle), `V5_CHAR_ORDER`, `v5Bio`, `v5CharLine`.
   - `src/data/v5world.ts` — `V5_CARDS` (22, ids 43–64) + `v5Card`, `V5_VOTE_LINES`, `V5_EVENTS` (18) +
     `v5Event`, `V5_ACH` (24, the `Achievement` shape, conditions in comments), `V5_ITEMS` (16) + `v5ItemName`,
     `V5_TICKER` (127), `V5_HINTS` (19), `V5_HERO_LINES`, `V5_WIN` / `V5_LOSE` / `V5_FLOOR_LOST` / `V5_BOSS`,
     `V5_UI`.
2. **On screen now** — `src/ui/v5texts.ts`, `installV5Texts()` called once from `src/main.ts`:
   - building names, blurbs, jokes and the build feed through `setBuildTexts` (palette cards, the tooltip,
     the placement note, the building panel with the full name and the joke, «Прораб» lines for built /
     upgraded / lost / broke / trap / trapped / seen / charged / wave / fire; fences now speak too: one line
     when a wall line is finished, one when it is breached);
   - `V5_TICKER` → `TICKER`, `V5_HINTS` → `HINTS` (menu tip and the rotating HUD tip), `V5_HERO_LINES` → the
     heroes' kill / idle / death / steal pools, win / lose / floor-lost / boss-shout pools (`POOLS` in lore.ts);
   - «Кто есть кто»: a «Скоро в игре» block — six best characters as cards, the other nine by name.
3. `tools/cleanscan.ts` covers the v5 files, the wired pools, the texts the build mode shows in clean mode
   (2484 strings), a stricter pattern for v5 (prefixed swearing, insults) and a «twin equals its clean line» check.
4. Browser check (Playwright, toon and classic, desktop 1280×720 and phone 390×844, 18+ and clean): names,
   blurbs and jokes show, feed lines appear when building / upgrading / losing a tower / a trap fires /
   breaking theirs, tips rotate, teasers render, clean mode shows no 18+ word, 0 console errors.

## Shared files touched (small hooks)

| File | Change |
|---|---|
| `src/main.ts` | import + `installV5Texts()` (2 lines) |
| `src/ui/menu.ts` | import + `${v5SoonHtml(s.spicy)}` at the end of the «Кто есть кто» page |
| `src/data/lore.ts` | boss-shout pools hoisted into `BOSS`; `export const POOLS = { WIN, LOSE, FLOOR_LOST, BOSS }` |
| `src/ui/buildText.ts` | `BldText` gets optional `full`, `card`, `joke`; the feed hook and `bldFeed` get an optional `side` |
| `src/ui/build.ts` | card shows `tx.card ?? tx.name`, tooltip and panel show the full name and the joke, `bldFeed(..., side)`, two `else` lines so wall lines reach the feed |
| `src/ui/build.css` | `.bs-j` (the joke line in the building panel) |
| `tools/cleanscan.ts` | v5 coverage |

## Decisions

- Clean by default, `spicy*` twin next to it (`spicyName`, `spicyT`, `spicyBio`…): `tools/cleanscan.ts`
  skips `spicy*` keys, so the scan needs no special cases.
- Feed lines keep the building name in the nominative (`{b}`) or take `{b4}` (accusative) and the endings
  `{a}` / `{la}` from `bldVars`, so «Рогатку снесли», «Гантелемёт готов», «Грабли упали» all read right.
- A line whose placeholder has no value is never picked: lines with `{p}`, `{k}`, `{v}`, `{h}`, `{i}` wait
  for whoever knows who did it (the build feed today has no player or victim name).
- The build feed says a building's own line every other time (its own joke the first time), general lines in
  between from a rotation that starts at a different place each visit (counters live in `v5texts.ts`).
- `sperm`: clean «Сгущёнкомёт», 18+ «Спермострел» (the plan's twin). The sim table still says «Клеемёт»; the
  text hook overrides it everywhere the UI shows a name.
- Short names on the cards, the long ones with the joke in the panel («Тесла» / «Тесла из воображения»,
  «Лежачий» / «Лежачий полицейский»); long one-word names carry soft hyphens for a phone card.
- Names of chat members only as the game already has them (Ислам, Зураб, Чимаев, Амин, админ, Мохьмад,
  Бекхан, Адам). New characters are invented types. Chechen words only where the plan is sure of the meaning.
- Left as data (no mechanics yet): kill / streak / steal / boss / pickup / promoted / idle feed groups,
  characters, cards 43–64, events, achievements, items, `V5_UI`, the eight planned buildings.

## For the mechanics track

- New units / heroes / bosses: `V5_CHARS[key]` (name, side, kind, price, count, gimmick, ability, minus, bio,
  quote, `lines.spawn | ability | death | idle`), `v5CharLine(key, bucket, i, spicy)`, looks in `V5_LOOK`.
  Unit keys: rieltor, santeh, anon95, stroy, hobby, pelmen (the six best), kouch, shut, advokat, drysh, reper,
  afk, kurs3, ipitboss, storozh.
- Feed: `feedLine(group, i, spicy, vars, { on, side, tag })` — groups and their tags are commented in `FEED`
  (`kill` {k} {v}; `streak2…12` {k}; `streakEnd`; `heroDown` {v}, tag `boss`; `killTower` {b} {v}; `steal`
  {n}, tags `safe`, `ks`; `boss` {h}, tags out / low / hp1 / shield / down / prank / thanks / envy; `pickup`
  {k} {i}, `on` = item key, tag `empty`; `promoted` {k}; `idle` {k}, tags quiet / rich / nobld). Pass a
  counter or the tick as `i`.
- Cards: `v5Card(id, spicy)` → title, effect, minus, win line; ids 43–64 continue the v4 ids 34–42.
  Events: `v5Event(key)`; achievements: append `V5_ACH` to `ACHIEVEMENTS` (same shape; ids do not collide);
  items: `V5_ITEMS`, `v5ItemName`.
- More planned buildings: `BLD_TEXT[key].plan` (steklo, kvartira, montazhka, homyak, menedzh, zakrep, brevno,
  punkt) — texts are ready, add the key to the sim table and they show up.

## How to verify

- `npx tsx <scratch>/v5/CONTENT-DATA/count.mts` — counts, placeholder twins, a line for every building key.
- `npx tsx tools/cleanscan.ts`.
- `npx vite --port 5279 --strictPort --host 127.0.0.1`, then
  `node <scratch>/v5/CONTENT-DATA/check.cjs <spicy|clean> <toon|classic> <desktop|phone>`; screenshots land
  next to the script.

## Not done

- No mechanics: nothing of the new characters, cards, events, achievements or items plays yet.
- Generic kill / hero-down lines of `FEED` are not shown: unit names in the feed need grammar (plural
  squads, «Амина») that the caller has to supply.
- The building panel on a phone hides the blurb (BUILD-UI's layout), so the joke shows on desktop only;
  level names (`levels`) are used in upgrade feed lines but not in the panel.
- `src/data/v4lore.ts` is still unwired and outside cleanscan (not this track's file).
- Bundle: 2 090 560 bytes (base 2 008 551, +82 KB, +23 KB gzip).
