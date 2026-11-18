# CONTENT-DATA — notes

Track: the chat content as game data («добавь больше контента с чата… ещё больше локальных прикольчиков и
персонажей»). Source: the curated plan `CONTENT.md` (scratchpad `v5/out/`), `chat_bank.json` behind it.
Base commit: b562931 (sim buildings + toon style + build-mode UI).

## Done

1. **Data** (new files, nothing in them is random; clean text by default, 18+ in `spicy*` fields):
   - `src/data/v5lore.ts` — `BLD_TEXT` (27 sim keys + 8 planned buildings: short name, full name, gender and
     accusative for feed grammar, blurb, joke, level names), `FEED` (311 lines in 28 groups), helpers
     `bldLore`, `bldVars`, `feedPool`, `feedLine`, `v5fill`, `v5at`, `v5text`, `FEED_GEN`, `noVowels`.
   - `src/data/v5cast.ts` — `V5_CHARS` (15 characters, 6 marked `best`), `v5Bio`, `v5CharLine`.
   - `src/data/v5world.ts` — `V5_CARDS` (22, ids 43–64), `V5_EVENTS` (18), `V5_ACH` (24, the `Achievement`
     shape), `V5_ITEMS` (16), `V5_TICKER` (127), `V5_HINTS` (19), `V5_HERO_LINES`, win / lose / floor / boss
     pools, `V5_UI`, `V5_VOTE_LINES`.

## In progress / next

2. Wiring (see below, filled in when done).
3. `tools/cleanscan.ts` covers the new files.
4. Browser check.

## Decisions

- Clean by default, `spicy*` twin next to it (`spicyName`, `spicyT`, `spicyBio`…): `tools/cleanscan.ts`
  skips `spicy*` keys, so the scan needs no special cases.
- Feed lines keep the building name in the nominative (`{b}`) or take `{b4}` (accusative) and the endings
  `{a}` / `{la}` from `bldVars`, so «Рогатку снесли», «Гантелемёт готов», «Грабли готовы» all read right.
- A line whose placeholder has no value is never picked: lines with `{p}`, `{k}`, `{v}` wait for the sim to
  tell who did it.
- `sperm`: clean «Сгущёнкомёт», 18+ «Спермострел» (the plan's twin; the sim table still says «Клеемёт», the
  text hook overrides it on screen).
- Names of chat members only as the game already has them (Ислам, Зураб, Чимаев, Амин, админ, Мохьмад).

## How to verify

- `npx tsx <scratch>/v5/CONTENT-DATA/count.mts` — counts, placeholder twins, a line for every building key.
- `npx tsx tools/cleanscan.ts`.
