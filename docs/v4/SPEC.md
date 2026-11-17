<!--
OVERRIDES (newer than this spec — they win where the spec disagrees):
- Unit types are 19..23 (Амина took 18): ipit 19, operator 20, snitch 21, drone 22, bmw 23 (see V4_UNIT_T in src/data/v4lore.ts).
- «Грязнульки» and «Вайнаг» are the user's own FICTIONAL characters for the lore. src/data/girls.ts is the authority for them
  (GIRLS, GIRL_SPAWN, GIRL_CAP, COLLECTION_TEXT, VAINAG) and src/render/girls.ts for their models; the "no girls / no вайнаг"
  bullets of the content policy below are superseded. Keep everything else in the policy (no real people outside the chat,
  no addresses, nothing blown up, hobby drones only, no slurs, crude lines only spicy:true with clean twins).
- Оператор is Амина's best friend and even bigger than her (src/data/girls.ts 'operator', model in src/render/girls.ts).
  As a unit (type 20) she is Атаги-only like Амина, drawn with that big-girl model; she is not a map collectible spawn.
- «Стукач с комиссионки» (type 21) is Вайнаг (VAINAG in girls.ts: thin, all in black, long beard, black notebook), a mercenary
  both sides may buy and both hate; his ability/passive numbers come from VAINAG.
-->
# ВЫСОТКА v4 — season, Грозный, new units, progression, endings

Design spec for the sim and UI agents. Data lives in two new files:

- `src/data/season.ts`: chapters, season constants, balance numbers for the v4 mechanics, city points, ИПИТ hacks, ranks, XP, daily quests, the collection, drops, «сход дня», endings.
- `src/data/v4lore.ts`: lines for the new units, places, events, сход cards and achievements; roster cards; feed lines (online, MVP, rank-up, quests, streaks, season).

Both files are data only. They have no runtime imports from `src/sim`, so the sim can import them the same way it already imports `CAPTURE_PLACES`. Every number in this spec is also in `season.ts` (`SEASON`, `V4`, `IPIT_HACKS`, `CITY_POINTS`, `BUFF_CAPS`, …), so the sim imports the numbers and does not copy them.

**Chapter numbering.** Tables in this spec name chapters by **number** 1..7, as the players see them. Every `ch` field in the data files is the chapter **index** 0..6 (number − 1), the same as `st.season.ch`.

### Data map (what to import from where)

| Need | Export |
|---|---|
| Chapters, unlock gating | `CHAPTERS`, `CHAPTER_ART`, `isUnlocked`, `unlockChapter`, `chapterTicks` (season.ts) |
| Season numbers, result | `SEASON`, `seasonResult` (season.ts) |
| v4 balance numbers | `V4` (types 18..22, AI weights, city, stops, ЧГУ, Шайба, Ансар, unit abilities, «Дроп», events, cards) (season.ts) |
| City layout | `CITY_POINTS`, `CITY_IDX`, `CITY_DECOR` (season.ts) |
| ИПИТ hacks | `IPIT_HACKS` (command index = array index), `IPIT_DENY` (season.ts); lines in `IPIT_LINES` (v4lore.ts) |
| Сход cards 34..42 | `V4_CARD_DEFS` (sim-ready fields, `fx` as a string to map onto new `Fx` members), `V4_CARD_TEXT` (UI) (v4lore.ts) |
| World events | numbers in `V4.events` (season.ts); titles, quotes, reactions, `ch` in `V4_EVENTS`, `KOM_RESULT` (v4lore.ts) |
| Units 18..22 text | `V4_UNIT_LINES`, `v4UnitLine(t, bucket, spicy)`, `V4_UNIT_TEXT`, `V4_ROSTER_ORDER` (v4lore.ts) |
| «Дроп» | `DROP_TEXT`, `DROP_LINES` (v4lore.ts) |
| City text | `CITY_TEXT`, `cityLine`, `SHAIBA_VIEW_LINES`, `ANSAR_LINES` (v4lore.ts) |
| Progression | `RANKS`, `rankFor`, `XP`, `DAILY_QUESTS`, `pickQuests`, `dayKey`, `hash32` (season.ts) |
| Collection | `COLLECTION`, `RARITY`, `CARD_ICONS`, `BUFF_KEYS` (`SIM_BUFF_KEYS`, `UI_BUFF_KEYS`), `BUFF_CAPS`, `BUFF_TEXT`, `buffText`, `collectionText`, `cardIndex`, `validEquip`, `sideBuffs`, `AI_DECKS`, `DROPS`, `rollCard` (season.ts) |
| «Сход дня» | `DAILY_SKHOD`, `pollFor` (season.ts); `POLL_LINES`, `BONUS_TEXT` (v4lore.ts) |
| Endings | `ENDINGS`, `ENDING_ART`, `endingFor`, `endingPanels` (season.ts) |
| Feed and menu | `ONLINE_LINES`, `onlineLine`, `OFFLINE_LINES`, `MVP_LINES`, `QUEST_LINES`, `STREAK_LINES`, `CARD_DROP_LINES`, `SEASON_FEED`, `AWAY_LINES`, `RIVAL_LINES`, `FINALE_SHOUTS`, `V4_TICKER`, `V4_HINTS`, `V4_UI` (v4lore.ts) |
| Achievements | `V4_ACHIEVEMENTS` (same shape as `ACHIEVEMENTS`, with tracker hints in comments) (v4lore.ts) |

## Content policy (applies to every string and model)

These rules held while writing the data, and they apply to any text an agent adds later.

- **No real women or girls** as characters, collectibles or jokes. The user's «грязнульки» collection is replaced by **collectible cards of chat legends and items**. The ЧГУ joke is one gender-neutral line about height: «Средний рост — 180».
- **No real people outside the chat.** The «Стукач с комиссионки» is a generic, fictional archetype and is not based on anyone. There is no «вайнаг».
- **No residential addresses.** No one «lives on floor N» of anything. ЖК «Шайба» is only a famous tall building to capture. The Pringles joke belongs to a collectible card and has no location. The only street address in the game is still the Донер Бей one.
- **Nothing gets blown up.** Ансар is «закрыть» / «снять вывеску», never «взорвать».
- **Drones are hobby quadcopters («квадрик»):** a camera, shawarma delivery and lecture notes. There are no strikes and no war footage, and the word «беспилотник» is not used.
- No СВО, no politicians or officials, and no «им. …» in university names (just «ГГНТУ», «ЧГУ»).
- **«Дроп»** is a damage-redirect ability («всё на мою карту»). There are no money-mule or fraud details.
- **No slurs.** «Донер Гей» is not used in v4 at all.
- **Nicotine** (снюс, LOOP) appears only in 18+ cards, and every one has a clean twin.
- **Crude jokes about chat members** are only `spicy: true`, are non-graphic, and always have a clean alternative.

---

## 1. Season: a week of active world time

### 1.1 Clock

The season runs on the sim's own tick (`st.tick`, 10 per second). That tick is **active world time**: the shared world sleeps when nobody plays, because `w/clock` restarts from the checkpoint tick after 90 s without a keeper. A season therefore lasts a fixed amount of *played* time, not wall time.

| | Season 1 | Season ≥ 2 («same content, faster») |
|---|---|---|
| Chapters 1–6 | 75 min each (`SEASON.chTicks = 45 000`) | 45 min each (`chTicksFast = 27 000`) |
| Chapter 7, the finale | 75 min (`finaleTicks = 45 000`) | 60 min (`finaleTicksFast = 36 000`) |
| Total active time | 8 h 45 min (~52 wars of ~10 min) | 5 h 30 min |

A friend group keeps the shared world awake for about 60–90 min per evening, so season 1 lasts **6–8 days**. The admin can change the chapter length with `seasonLen` (§1.7) if the week runs long or short.

### 1.2 Sim state (new `State.season`, created by `migrate()` if missing)

```ts
interface SeasonState {
  n: number;              // season number, 1..
  ch: number;             // chapter index 0..6
  at: number;             // tick the current chapter started
  len: number;            // ticks this chapter lasts (chapterTicks(n, ch))
  pts: [number, number];  // season score Атаги / Курчалой
  hold: number[];         // [ggntu, chgu, shaiba] (SEASON.hold order): ticks held towards the next point
  wars: [number, number]; // wars won this season
  mvp: Record<string, number>; // player id → war MVPs this season
  early: 0 | 1;           // the finale was reached early («досрочный финал»)
  ended: -2 | -1 | 0 | 1; // -2 running; -1 draw; 0/1 winner — set at the end, kept through the pause
  endAt: number;          // tick the season ended (pause runs until endAt + SEASON.endPause)
}
```

Old saves get `{ n: 1, ch: 0, at: st.tick, len: chapterTicks(1, 0), pts: [0, 0], hold: [0, 0, 0], wars: [0, 0], mvp: {}, early: 0, ended: -2, endAt: 0 }`. `newWar()` must **not** reset `st.season`.

### 1.3 Chapters (`CHAPTERS` in season.ts)

Each chapter unlocks content cumulatively. `isUnlocked(key, st.season.ch)` and `unlockChapter(key)` are exported helpers.

| # | id | Title | Unlocks | Feel |
|---|---|---|---|---|
| 1 | vysotka | «Высотка» | base game | the war as it is today |
| 2 | gorod | «Город» | map north: Грозный; **ГГНТУ** (ИПИТ hacks, ИПИТовцы); **Донер Бей** at its real spot; city **остановки** (deploy stops) | second front in the city |
| 3 | ansar | «Ансар» | **Ансар** trap; ИПИТ hack «записать соседей в Ансар»; admin **«Дроп»** | money starts leaving |
| 4 | chgu | «ЧГУ» | **ЧГУ** («высокие»); **Квадрик**; **Оператор** | spies and drones |
| 5 | shaiba | «Шайба» | **ЖК «Шайба»** (hold points, «вид с высоты»); **Синяя бэха** | the tallest building of the season |
| 6 | komissionka | «Комиссионка» | season event «Комиссионка»; **Стукач с комиссионки**; «Сессия» gets harsher | heroes retake exams |
| 7 | final | «Финал» | bosses +25% hp, +15% damage, back after 90 s; every event in the pool; «Финал сезона» banner | last push |

New world events, сход cards and units check `isUnlocked` (their `ch` field) before entering a pool or the shop. Locked city points exist in `pts` from the start, because the flow fields need a fixed layout, but they are **dormant**:

- `capture()` skips them;
- `pickGoal` and the AI ignore them;
- the renderer draws them greyed out with a sticker «Откроется в главе N».

**Chapter step** (checked once per second, in the economy tick): if `ended === -2 && tick >= at + len && ch < 6`, then `ch++`, `at = tick`, `len = chapterTicks(n, ch)`, and emit `{ e: 'chapter', n, ch }`.

The UI shows the chapter card:

- `CHAPTERS[ch].title`, `subtitle` and `art`;
- the intro lines are posted to the feed one every 1.5 s;
- the sticker under the score shows `goal` and the countdown «до главы N+1: 41 мин игры», computed from `at + len − tick`.

### 1.4 Season score

Integer points per side. The UI reads them straight from `st.season.pts`, and the feed reacts to the events listed below.

| Source | Points | Hook |
|---|---|---|
| War won | 10, or **15 for the underdog** (behind by ≥ 50 when the war ends) | `cleanup()` where `winner` is set |
| Enemy floor destroyed | 1 | where `FxEv 'floor'` is emitted (to the other side) |
| Enemy boss killed | 3 | `bossDown` |
| City hold | 1 point per 180 s held of ГГНТУ, per 180 s of ЧГУ, per 120 s of Шайба (`SEASON.hold`) | economy tick: `hold[i] += 10` while owned; reset when the owner changes |
| Ансар closed (side that landed the last hit) | 2 | §2.4 |
| Event goal (Посвящение, Вид с Шайбы) | 2 | §4 |

At ~7.5 wars per chapter, the expected total is about **140 points per chapter in chapter 1, rising to ~240** once all city points are open. That makes about **1400 per season**, with wars around 50% of it, the city about 25%, and floors, bosses and events the rest.

**Underdog aura** (keeps a lopsided friend group playing):

- A side behind by ≥ 25 gets +1 ₽/s for every 25 points behind, up to +4 ₽/s (`SEASON.underdog`). This is added in `income()`.
- Its war wins count 15 instead of 10 once it is behind by ≥ 50.

**In-war comeback:** a side that lost the previous war starts the next one with +150 ₽, or +300 ₽ after two losses in a row (`SEASON.comeback`). The sim tracks this as `sd.lost` (a streak counter, kept by `newWar`).

### 1.5 End of season

- **Decisive lead («Досрочный финал»).** From chapter 4 on (index ≥ `decisiveFrom = 3`), whenever a war ends with |a − k| ≥ **150**, the season jumps straight to chapter 7: `ch = 6`, `early = 1`, and FxEv `chapter` fires as usual. All content up to the finale unlocks at once. Inside the finale, a lead of ≥ **250** at a war end ends the season immediately.
- **Normal end.** When the finale's time runs out (`tick >= at + len` in chapter 7), the season ends at the next war end, or after at most 10 more minutes (`SEASON.overtime = 6000`), so that a war is not cut in half when that can be avoided.
- **Result:**
  - |a − k| < **15** (`drawMargin`): a draw (`ended = -1`);
  - otherwise the side with more points wins (`ended = 0 | 1`).
- **On the end:**
  - emit `{ e: 'seasonEnd', n, w: ended, a, k, mvp }`, where `mvp` is the player id with the most war MVPs this season (ties go to more season XP on the board, then to the id);
  - freeze the field: `step()` only ticks while `ended !== -2`;
  - after `SEASON.endPause = 1200` ticks (2 min, enough for the 8–14 panel ending), call `newSeason()`: `n + 1`, `ch = 0`, `pts = [0, 0]`, fresh timers, then `newWar()`. The all-time `sides[].wins` stay.
- **UI on `seasonEnd`:**
  1. full-screen notebook comic from `ENDINGS[atagi|kurchaloy|draw]` (§8), with placeholders filled in;
  2. then the **«Зал славы»** page;
  3. the keeper writes `hall/<n>`: `{ n, w, a, k, mvp, wars, early, wall }`.

  Late joiners can replay any ending from Зал славы in the menu.

### 1.6 Sim gating summary

| Content | Gate |
|---|---|
| City points 13..18 dormant | `!isUnlocked('grozny', ch)` |
| ИПИТовцы in the shop | unlocked `ipitovets`, the side owns ГГНТУ |
| Hack 'ansar' | unlocked `ansar` and Ансар open |
| admin «Дроп» | unlocked `drop` |
| Квадрик, Оператор | unlocked `drone`, `operator` |
| Синяя бэха | unlocked `bmw` |
| Стукач in the shop | unlocked `snitch` |
| Events / cards | their `ch` |
| Boss finale numbers | `ch === 6` |

### 1.7 Admin overrides (admin panel `adm` ops, same validation path as the existing ones)

| op | Fields | Effect |
|---|---|---|
| `chapter` | `v` 0..6 | jump to that chapter now (emit `chapter`) |
| `seasonEnd` | `s` -1, 0, 1 or 2 | end now with that result (2 = by score) |
| `seasonPts` | `s`, `v` (−500..500) | add points to a side |
| `seasonNew` | — | start the next season now (skips the pause) |
| `seasonLen` | `v` minutes 5..240 | length of chapters 1–6 from now on (stored as `st.season.chLen`; `chapterTicks` uses it when set) |

---

## 2. Грозный on the map

The map is extended north to z ≈ −35 by another agent, using the same formula. The world coordinates below are already in that frame. **b** is the building (real 2GIS position, which the renderer uses). **x, z** is the capture centre, nudged from the building so the circles in the dense centre do not overlap. The map agent may move a centre by up to 1.5 units to a passable cell whose 3×3 block is passable, keeping every pair of circles at least 0.2 apart.

| idx | key | Kind | Chapter | Building b | Capture x,z | r | Perk |
|---|---|---|---|---|---|---|---|
| 8 | doner | 2 (existing) | 2 moves | 21.2,−26.4 (real, ул. Мира 83/1) | 21.2,−26.4 | **3.0** (from 6) | as now: +5 ₽/s, heal |
| 13 | ggntu | **4 «город»** | 2 | 25.4,−22.8 | 27.6,−22.4 | 2.8 | **ИПИТ**: hacks (§2.2), hold points |
| 14 | chgu | 4 | 4 | 31.3,−13.0 and 32.3,−11.4 | 31.8,−12.2 | 3.2 | **Высокие**: units deployed in its circle +15% hp, +10% range, drawn 15% taller |
| 15 | shaiba | 4 | 5 | 22.5,−22.8 | 22.2,−20.2 | 2.8 | hold points ×1.5; **Вид с высоты** (§2.3) |
| 16 | ansar | **5 «ловушка»** | 3 | 31.6,3.6 | 31.6,3.6 | 3.0 | never captured: the sign has HP (§2.4) |
| 17 | stopA | **6 «остановка»** side 0 | 2 | — | 10.0,−18.0 | 4.0 | Атаги deploy zone in the city |
| 18 | stopK | 6, side 1 | 2 | — | 40.0,−24.0 | 4.0 | Курчалой deploy zone in the city |

Decor only (no sim point): the second ЧГУ building at 48.8,−16.6 («другой корпус») and the Ансар branch at 11.6,−23.5 (a sign «Ансар. Филиал»).

**Why the stops.** Атаги's high-rise is ~220 units from the city centre and Курчалой's ~340. Without a foothold in the city, Атаги would own Грозный every season. Each side therefore gets a fixed, non-capturable stop:

- **«Остановка 55-й у молла»** for Атаги;
- **«Автостанция: маршрутка 150»** for Курчалой.

Both stops are placed so their summed distance to the five city targets is about equal (A 96, K 95). Deploying at a stop costs **×1.2** (`V4.stop.markup`, «дорога в город»).

`inZone()` treats them like own villages. City points (kind 4) become deploy zones for their owner like villages do. The trap (kind 5) never does.

**Migration for Донер Бей:** pts[8] gets the real x, z and r = 3 in `migrate()`, keeping owner and progress, and `findDoner()` is retired. Until the map is extended, the sim keeps the old spot.

### 2.1 Capture rules for kind 4

These are the same as villages:

- weights per `CAPW`, regen when uncontested;
- **no militia** spawns there;
- AI goal weights `V4.city.aiW = 1.15` once unlocked (1.3 for Шайба in chapter 5 and later), and 1.5 for Ансар's sign while the AI's side is enrolled (§2.4).

The season hold accumulator resets on every owner change.

### 2.2 ГГНТУ: «ИПИТ» hacks (new command)

`{ t, id, p, k: 'hack', s, h }`, where `h` is an index into `IPIT_HACKS`. It is valid when:

- player `p` is on side `s`;
- side `s` owns pts[13];
- the hack's chapter is unlocked;
- `sd.hk[h] <= tick` (cooldown per side per hack);
- `money >= price`, where `price = floor(base × (1 − cardBuff.hack))`, or the hack is free after card «Взломай БРС».

On success:

- `money -= price`, `sd.hk[h] = tick + cd`;
- emit `{ e: 'ipit', s, h, v: enemy, until }`;
- a denial goes through `deny` with a reason string from `IPIT_DENY`.

| h | id | Title | Price ₽ | Cooldown | Effect (enemy = v) | Chapter |
|---|---|---|---|---|---|---|
| 0 | turret | «Отключить турель» | 220 | 90 s | enemy turret off 20 s (`sd.hack`-like field `tOff`) | 2 |
| 1 | brs | «Взлом БРС» | 300 | 120 s | enemy income 0 for 15 s | 2 |
| 2 | leak | «Слить следующую покупку» | 100 | 60 s | **intel** 60 s for side s (UI: enemy bank, buys, сход ballots, AI's saved-for unit) | 2 |
| 3 | vote | «Вброс на сходе» | 200 | 150 s | only while the enemy сход is open: +3 NPC ballots on the enemy option with the fewest votes (ties → lowest index) | 2 |
| 4 | ansar | «Записать соседей в Ансар» | 350 | 180 s | enemy enrolled in Ансар (§2.4); only while Ансар is open | 3 |
| 5 | drones | «Перехватить квадрики» | 180 | 90 s | every enemy Квадрик lands (battery ends now) | 4 |

**AI:**

- owning ГГНТУ with `money ≥ price + 300`, it tries `ansar` (if not enrolled itself), then `turret` when it has ≥ 6 units within 20 of the enemy high-rise, then `brs`, at most once per 30 s;
- it never uses `leak` (UI-only value);
- it uses `vote` 50% of the time when the enemy сход is open.

**Intel** is a field in sim state (`sd.intel = until tick`), so every client agrees, but only the UI reads it. The UI of side s shows:

- the enemy bank in the top bar (ghost digits);
- a feed line for each enemy `deployed` («Соседи купили: Гелик»);
- the enemy's open сход options with the current ballots;
- the AI's `aiWant` unit as «копят на …».

There is no fog of war, so intel is information, not vision.

### 2.3 Шайба: «Вид с высоты»

- Hold points every 120 s (vs 180 s elsewhere).
- Every 90 s (`V4.shaiba.every = 900`) the owner gets **+80 ₽** and **intel for 20 s**. FxEv `view` `{ s }`.
- While held, the owner's ranged units within 30 of Шайба get **+10% range**.
- **18+ easter egg (UI only):** with 18+ on, Шайба's map note is `CITY_TEXT.shaiba.spicyNote`: «…На смотровой в шкафу — пачка Pringles. Чья — не говорят». It names no owner, no flat and no floor. The Амин joke lives only on the collectible card, which has no location.

### 2.4 Ансар: neutral trap

**Sign.** `ansarHp` starts at `V4.ansar.signHp = 1500`. Ансар is open while `ansarHp > 0`. Units of an **enrolled** side treat the sign as an enemy building within their aggro (no knockback, the `bldg` multiplier applies). Units of a side that is not enrolled ignore it, so nobody wastes a push on it by accident.

**Enrolment.** `sd.ansar = until tick`. While enrolled, the side **«тупеет»**:

- **−20% damage** (`V4.ansar.dmg = 0.8`) and **−15% speed** (`spd = 0.85`);
- every 5 s, each unit has a 15% rng chance to «walk the wrong way» for 2 s: it moves towards its own high-rise and does not attack;
- **−2 ₽/s «подписка списывается»**, taken from the bank (never below 0) and shown as FxEv `debit` `{ s, n }` once per 10 s with the sum.

Enrolment sources:

1. ИПИТ hack `ansar` (enemy);
2. the сход trap card «Пробный урок бесплатно» (own side);
3. world event «Набор в Ансар» (the richer side).

The cards and events are in §4. A side that is already enrolled is not enrolled again; the timer is not extended. Enrolment lasts **until Ансар is closed**, capped at 180 s (`V4.ansar.maxFor = 1800`, «курс закончился, hello world так и не написан»).

**Closing.** When the sign reaches 0:

- `ansarClosed = tick + 3000`: Ансар is closed for **5 min**;
- **every** enrolment ends at once;
- the side that dealt the last hit gets **+2 season points** and +100 ₽;
- emit `{ e: 'ansar', k: 'closed', s }`.

**Reopening.** On reopen («новый поток»): `ansarHp = 1500`, emit `{ e: 'ansar', k: 'open' }`.

**AI.** An enrolled side's AI raises the sign's goal weight to 1.5 and sends ≥ 4 units.

### 2.5 ЧГУ: «Высокие»

Units deployed inside ЧГУ's circle by its owner get flag `UF.TALL` (new bit 16):

- **+15% max hp** at spawn;
- **+10% range**, applied in `stats()`.

The renderer scales such units ×1.15 in y. Card «Средний рост 180» applies the same flag to every own spawn anywhere for 30 s.

---

## 3. New units (types 18..22) and the admin's «Дроп»

Field names follow `UnitDef`. `max` is the cap on living units per side. New flags:

| Flag | Meaning |
|---|---|
| `fly` | ignores terrain and water and moves in a straight line (no flow field); only ranged units and turrets can hit it; it never blocks or gets knocked back |
| `stealth: R` | enemies cannot acquire it farther than R; turrets ignore it |
| `needs: 'ggntu'` | deploy only while the side owns ГГНТУ |

| t | key | Name | ₽ | n | kind | hp | dmg | cd | range | speed | aggro | radius | Extra | ch |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 18 | ipit | «ИПИТовцы ×2» | 160 | 2 | Ranged | 85 | 8 | 10 | 8 | 0.27 | 10 | 0.45 | proj 2.6, shot 8 (green `{ }`), abCd 150, abR 9, max 6, needs ggntu | 2 |
| 19 | operator | «Оператор» | 180 | 1 | Melee | 140 | 0 | 10 | 1 | 0.34 | 9 | 0.40 | noFight, stealth 2, capW 0, max 1, abCd 600, abR 6 | 4 |
| 20 | snitch | «Стукач с комиссионки» | 200 | 1 | Melee | 300 | 10 | 12 | 1.3 | 0.28 | 8 | 0.50 | abCd 120, abR 7, aura 4, max 1 | 6 |
| 21 | drone | «Квадрик» | 130 | 1 | Fast | 60 | 0 | 10 | 1 | 0.55 | 10 | 0.35 | fly, noFight, capW 0, life 900, abCd 100, abR 4, max 3 | 4 |
| 22 | bmw | «Синяя бэха» | 260 | 1 | Fast | 420 | 26 | 12 | 1.5 | 0.66 | 8 | 0.90 | knock 0.6, max 1, abCd 200 | 5 |

Add 18..22 to `SHOP` after `16` (Гелик): `[…, 14, 16, 22, 21, 18, 19, 20, 6, 10, 7, 8, 9, 11, 12]`.

AI weights (both sides): ipit 4 (only while it owns ГГНТУ), operator 2, snitch 3, drone 4, bmw 4.

### 3.1 ИПИТовцы — «Взломать что угодно» (auto, every 15 s)

It hacks the first valid target, in this priority order:

1. **The enemy turret** if the enemy high-rise is within 10: off for 8 s.
2. **An enemy Гелик** within abR: «сняли КРА номера», so it loses `kra` immunity for 10 s (`u.kraOff = until`).
3. **An enemy hero** within abR: its ability cooldown +10 s (`u.ab += 100`).
4. **An enemy Квадрик** within abR: lands now.

The hack emits `{ e: 'ability', key: 'ipit', … }` with `r` = the target id in a new field `tg`.

### 3.2 Оператор — spy («Фото экрана»)

- **Stealth.** Enemies (and turrets) cannot target it farther than 2 units away. Revealed (targetable at normal range) while within 8 of an enemy **Квадрик**, or for 8 s after an enemy **Стукач** marks it.
- **Movement.** It walks towards the enemy unit cluster nearest its goal and keeps 5 units from the nearest enemy (as `flee` does, but it stops instead of running home).
- **Passive.** While it is alive, its side has **intel** (as the ИПИТ `leak` hack).
- **«Ник спалили».** When an enemy **Амин** (WOU) is within 6:
  - Амин loses «Рейджбайт» for 20 s (no taunt pulses, `u.nick = until`);
  - the Оператор's ability goes on cooldown for 60 s;
  - FxEv `{ e: 'ability', key: 'nick', s, id, x, z, r }`.
- **Looks.** Hood up, phone camera raised. It is always anonymous and gender-neutral.

### 3.3 Стукач с комиссионки — «Сдал всех»

- **«Сдал всех»** (every 12 s when ≥ 3 enemies are within 7): every enemy within 7 is **marked** for 8 s (`u.mark = until`) and takes **+25% damage** from everything. This also reveals a stealthed Оператор. FxEv `{ e: 'ability', key: 'snitch', n }`.
- **«Все его ненавидят».**
  - Enemies that have him within their aggro pick him over any other target, except a taunting Амин.
  - Allies within 4 of him deal **−10% damage** («рядом со стукачом неуютно»).
- **Season event «Комиссионка»** gives each side one free Стукач (§4).

### 3.4 Квадрик — hobby drone

- **Flight.** It flies straight to its goal over everything (river, forest, buildings). Melee units cannot hit it.
- **Battery.** 90 s (`life 900`, plus the card buff `drone`), then it lands and disappears («батарейка села»), emitting `gone`.
- **Ability every 10 s:**
  - with ≥ 2 own units within 6 below 70% hp → **«Доставка шаурмы»**: heal up to 6 allies within 4 by +40 hp each;
  - otherwise, with ≥ 3 enemies within 5 → **«Раздача конспектов»**: enemies within 3.5 stop for 2 s («читают конспект»; a stun, so «Н ма дилита» and LOOP block it, and Гелики ignore it).
  - FxEv `ability` with key `shawarma` or `notes`.
- **«Камера».** It reveals a stealthed enemy Оператор within 8.
- **Not allowed:** strikes, payloads, war or military imagery.

### 3.5 Синяя бэха (BMW «380i») — «разогнать и скидывать передачи»

The car is blue, and the 380i is the chat's own joke.

- **Ability (every 20 s, when a goal or target is ≥ 12 away):**
  - first **3 s of accel** at ×0.5 speed («сначала разогнать»);
  - then **5 s of burst** at ×1.6 speed with ×2 ram damage («скидывать передачи»).
  - FxEv `ability` key `gears`.
- **«На СТО».**
  - **Trigger:** every 60 s of its life there is a 20% rng chance it leaves for the СТО. It disappears (like `Away`) for 30 s, then returns at its own high-rise with full hp. FxEv `{ e: 'sto', s, id, back }`.
  - The world event «Все на СТО» sends it there at once.
- **Cap:** at most 1 per side. The card «Скинуть передачи» never breaks the cap: it spawns a free бэха only when none is alive (one away at the СТО counts as alive).

### 3.6 админ — «Дроп» (new ability, chapter 3)

- **Trigger:** ≥ 3 allies within 8 below 50% hp, or an allied hero within 8 below 30%. First use 20 s after he spawns, then a 40 s cooldown (`V4.drop`).
- **Effect for 5 s (`dur 50`):**
  - all damage that would hit his allies within 8 goes to **him** at **50%** (`take 0.5`);
  - stun, slow and fear still hit the ally.
  - If he dies, «Дроп» ends at once.
- **Events:**
  - on cast, `{ e: 'drop', s, id, x, z, r, until }`;
  - when it ends, `{ e: 'dropEnd', s, id, n }`, where `n` is the damage taken (for the achievement «Всё на мою карту»).
- **Visual:** a bank card above his head, with lines from his allies flying into it.
- **Interactions:**
  - Амин's taunt still pulls enemies onto Амин; «Дроп» only moves the damage, not the targeting.
  - It stacks with Бекхан's armour: Бекхан's 0.85 applies first, on the original target.

### 3.7 Finale bosses (chapter 7)

`BOSS_HP × 1.25`, boss damage × 1.15, boss respawn 90 s (was 120 s), and the boss shout pool gets `FINALE_SHOUTS`. Applied at spawn when `st.season.ch === 6`.

---

## 4. New world events and сход cards

### 4.1 Events

These join the 150 s rotation once their chapter is unlocked. The text is in `V4_EVENTS`, the numbers in `V4.events`.

| key | Title | ch | dur | Effect |
|---|---|---|---|---|
| activ | «Посвящение в активисты ГГНТУ» | 2 | 60 s | ГГНТУ capture ×2; when the event ends, its owner gets **+2 season points** and +150 ₽ |
| ansarSet | «Набор в Ансар» | 3 | 45 s | if Ансар is open: the side with more ₽ in the bank (tie → more villages; tie → nobody) is enrolled; if closed: «набор отменили», nothing happens |
| sess | «Сессия» | 4 | 40 s | heroes −30% damage («учат билеты»), other units +10% («у пацанов автомат»); in chapter 6 and later, heroes −40% |
| sto | «Все на СТО» | 5 | 30 s | Fast units without `kra` (Баран, Камри, rides, бэха) −40% speed; every living Синяя бэха goes to the СТО at once |
| view | «Вид с Шайбы» | 5 | 30 s | Шайба's owner gets intel and +15% range near Шайба; still holding it at the end → **+2 season points** |
| kom | «Комиссионка» (season event) | 6 | 25 s | heroes leave «на комиссионку» (as `classes`); each side gets a **free Стукач** at its high-rise (cap respected); on return each hero rolls rng: «сдал» (healed to full, +10% max hp) or «не сдал» (−10% damage for 60 s) |
| final | «Финал сезона» | 7 | once | not in the pool: fired once when chapter 7 starts; just the banner and the feed |

`classes` and `kom` never run back to back.

### 4.2 Сход cards 34..42

These enter the pool once their chapter is unlocked. The sim-ready fields are in `V4_CARD_DEFS` (each `fx` names a new `Fx` member) and the UI text in `V4_CARD_TEXT` (v4lore.ts). The trap card 36 has an `after` list for the moment the enrolment kicks in.

| id | side | Title (clean / 18+) | Fx | v | Effect | ch |
|---|---|---|---|---|---|---|
| 34 | −1 | «Посвящение в активисты» | Activ | 300 | own units +10% damage 30 s; +1 free pair of ИПИТовцы if own ГГНТУ, else +100 ₽ | 2 |
| 35 | −1 | «Взломай БРС» | Brs | 150 | own ГГНТУ: the next ИПИТ hack is free (`sd.freeHack = 1`); otherwise enemy income ×0.5 for 15 s | 2 |
| 36 | −1 | «Пробный урок бесплатно» (trap) | Trial | 900 | +150 ₽ now and +10% speed 20 s, **then own side enrolled in Ансар** for up to 90 s (if open). The quote does not warn | 3 |
| 37 | −1 | «Всё на мою карту» | DropNow | 1 | own living admin: «Дроп» ready now, radius ×1.5 for this cast; no admin: +120 ₽ | 3 |
| 38 | −1 | «Квадрики на район» | Drones | 2 | 2 free Квадрики at the high-rise (cap 3) | 4 |
| 39 | −1 | «Средний рост 180» | Tall | 300 | every own spawn for 30 s is «высокий» | 4 |
| 40 | −1 | «Скинуть передачи» | Gears | 200 | own Fast units +40% speed 20 s; a free Синяя бэха if none is alive | 5 |
| 41 | −1 | «Пересдача» | Retake | 1 | own hero respawn cooldowns cleared; living heroes heal 50% | 6 |
| 42 | −1 | «Сдать соседей» | Snitch | 100 | enemies within 15 of our high-rise marked 10 s (+25% damage taken); a free Стукач if none is alive | 6 |

Draw weights: 2, except 36 at 3 (a trap works best when it shows up) and 38 at 1.

---

## 5. Player progression (UI side, per player, never in the sim)

Stored in `localStorage['vysotka.prog.v1']`. In shared war, a subset is also written to db `pp/<uid>` for the board (§5.6). Schema:

```ts
interface Prog {
  v: 1; name: string;           // shown on the board; pick from the chat roster or type ≤ 16 chars
  xp: number; sxp: number; sn: number; // all-time XP, season XP, season number sxp belongs to
  cards: Record<string, number>;       // collection id → copies
  eq: string[];                         // equipped collection ids (≤ unlocked slots)
  day: string; quests: { id: string; n: number; got: number; done: 0 | 1 }[]; reroll: 0 | 1;
  rolls: number;                        // card rolls today (cap DROPS.dayCap)
  streak: { last: string; n: number };
  stats: { wars: number; wins: number; mvp: number; kills: number; caps: number; floors: number };
  rivals: Record<string, [number, number]>; // other player's name → [my wins, my losses] when both played opposite sides
  ach?: string[];                        // mirrors vysotka.ach.v1 for the board count
}
```

### 5.1 Per-player war stats (needed in the sim for MVP; deterministic)

`Player` gains `w: { k, d, f, c, sp }`, reset by `newWar`:

| Field | Meaning | Where counted |
|---|---|---|
| k | kills | `cleanup`: credited to the dead unit's last hitter, `U.lh` (the attacker's `own`, set in `hurt`) |
| d | damage dealt ÷ 10 | `hurt` |
| f | floors destroyed | `attackHq` when a floor drops |
| c | captures | `capture()`: when a point flips to s, the player whose units (by `own`) had the most capture weight inside |
| sp | ₽ spent | `apply` on `dep`/`hack` |

- **Player mapping:** `own` is the player's `n`; keep a `byN` map in the sim, rebuilt on `reindex()`.
- **MVP at victory:** argmax over all players active this war (deployed ≥ 1) of `2k + floor(d/50) + 15f + 8c + floor(sp/100)`. Ties go to the lower `n`.
- **The victory event** gains `mvp: string` (player id) and `top: [string, string]` (best player per side, '' if none). The sim also increments `season.mvp[mvp]`.
- **Feed:** «Кто тащил: {name} — {k} убийств, {f} этажа» from `MVP_LINES`, then one reaction line.

### 5.2 XP

`XP` in season.ts.

| Action | XP | Cap |
|---|---|---|
| war won / lost (only if you deployed ≥ 3 times that war) | 50 / 20 | — |
| war MVP / best on the losing side | +40 / +20 | — |
| kill by your units | +1 | 80 per war |
| capture credited to you | +5 | — |
| floor destroyed by you | +10 | — |
| сход vote | +3 | — |
| ИПИТ hack ordered | +5 | — |
| Ансар closed by your side while you were in the war | +15 | — |
| daily quest | its `xp` | — |
| first war of the day | +25 | — |
| season end: winner / draw / loser | +300 / +150 / +100 | — |

Multipliers, applied after the caps:

- **streak**: +10% per consecutive day, up to +50%;
- **«сход дня» bonus**: ×1.5 on its key;
- **card buff `xp`**: personal, up to +50%.

### 5.3 Ranks (`RANKS`)

| # | Rank | XP | Slots | Stamp in the feed |
|---|---|---|---|---|
| 0 | Первокурсник | 0 | 1 | — |
| 1 | Активист | 250 | 2 | значок |
| 2 | Староста | 800 | 2 | журнал |
| 3 | Отличник | 1 800 | 3 | зачётка |
| 4 | Автомат | 3 200 | 3 | печать «автомат» |
| 5 | Ранкед чад | 5 000 | 3 | барсетка |
| 6 | Легенда района | 7 500 | 3 | золотая ручка |

A player who plays ~1 h a day reaches Отличник around day 3 and Легенда района around day 7. Ranks are cosmetic: a title next to the name in the feed and on the board, and a pen colour. The only gameplay effect is the number of card slots.

### 5.4 Daily quests (`DAILY_QUESTS`)

- **The day.** It starts at **04:00 local time** («после клеш рояля»). The day key is `YYYY-MM-DD` of `now − 4 h`.
- **Picking.** Each player gets 3 quests, picked by `pickQuests(uid, day, ch, side, salt)` (`salt` 1 after the reroll): a deterministic hash, at most one `hard`, only templates whose `ch ≤` the current chapter and whose `side` matches. Shared war uses the shared world's chapter; solo uses its own world.
- **Reroll.** One free reroll a day («отмазка»).
- **Tracking.** The UI tracks progress from FxEv and state, the same way `achievements.ts` does.
- **Rewards.** Completing a quest gives its XP and **1 card roll**.

### 5.5 Collection («Коллекция», `COLLECTION`)

- **Cards.** 40 cards of chat legends and items: 12 common, 13 rare, 8 epic, 4 legendary, 2 cursed, plus the season medal. Each has a rarity, an icon key, a clean title (three also have an 18+ title: «Снюс», «Бамб LOOP», «Пачка Pringles «с губками»», each with a clean twin and the same buff), a description and one buff `{ key, value }`. Cursed cards also have a `curse` (a negative buff).
- **Rarities** (base roll weights): Обычная 60, Редкая 27, Эпическая 10, Легендарная 3. There are also **Проклятые** cards (cursed): they never roll and come only from their trigger (`special`). «Сертификат Ансара» (+25% XP, −2% damage) is granted when your side gets enrolled in Ансар; «Шаурма в кляре из Фудзи» (+3% hp, −5% healing) when your сход picks card 18. The season medal (`special: 'season'`) comes only from a season end.
- **Duplicates.** A duplicate is turned into XP («перевод по номеру карты»): 10 / 25 / 60 / 150; a cursed duplicate gives 5.
- **Drops** (`DROPS`), daily cap 10 rolls:

  | Trigger | Roll |
  |---|---|
  | first war of the day | 1 |
  | war win | 1 at 50% (70% for the season underdog) |
  | MVP | 1 with weights 40/35/20/5 |
  | each daily quest | 1 |
  | capture of ГГНТУ, ЧГУ or Шайба credited to you | 1 at 10% |
  | season end | 2 for the winner side, 1 for the others, plus the season medal card (`medal`) |

  A card only drops when `ch ≥` its `ch`.
- **Equip.** Up to the unlocked slots (1/2/3), at most **one legendary**. Spicy cards can be equipped with 18+ off; they show the clean twin title, and the buff is the same.
- **Shared war: buffs are deterministic.** The UI sends a validated command `{ k: 'eq', s, c: number[] }`:
  - `c` holds **indices** into `COLLECTION`;
  - length ≤ 3, distinct, ≤ 1 legendary, no ids out of range;
  - it is sent on join and on every change.

  The sim stores `players[p].eq`. Every 100 ticks it recomputes `sd.cb = sideBuffs(eqs of the side's active players)` (indexed by `SIM_BUFF_KEYS`; active = `tick − pl.last ≤ SEASON.activeWindow = 9000`, 15 min). `sideBuffs` sums the cards, curses included, and caps every key by `BUFF_CAPS`; UI-only keys (`xp`, `find`) are skipped. Effects: §5.5.1. `validCmd` must accept `eq` and run `validEquip`.
- **Solo.** The AI side gets `AI_DECKS[diff]` (easy none, normal 2 commons, hard 3 rares) through the same path, so solo and shared behave alike.

#### 5.5.1 Buff keys (`SIM_BUFF_KEYS` + `UI_BUFF_KEYS`, side caps in `BUFF_CAPS`)

| key | Meaning | Side cap | Applied in |
|---|---|---|---|
| hp | +% max hp at spawn | 8 | `spawn` |
| dmg | +% damage | 6 | `stats` |
| spd | +% speed | 6 | `stats` |
| inc | +₽/s | 4 | `income` |
| start | +₽ at war start | 300 | `newWar` / `freshSide` |
| hero | −% hero respawn | 20 | `cleanup` heroCd |
| car | −% price of Fast units and rides | 15 | `cost` |
| heal | +% healing (healers, Донер Бей, Квадрик, лагман) | 20 | heal sites |
| cap | +% capture weight | 15 | `capture` |
| luck | +% dodge chance (uses the sim rng) | 6 | `attack` |
| hack | −% ИПИТ hack price | 25 | `hack` |
| drone | +s Квадрик battery | 30 | `spawn` drone |
| stun | +% duration of own stuns, «Н» and fear | 20 | `adminN`, `pack`, notes |
| xp | +% personal XP (UI only) | 50 per player | UI |
| find | +% chance on % drops (UI only) | 20 per player | UI |

### 5.6 «Доска почёта» (leaderboard) and «Зал славы»

- **Player doc.** `pp/<uid>`: `{ v: 1, name, side, xp, sxp, sn, rank, wins, mvp, kills, uniq (unique cards), streak, ach (count), seen (wall ms) }`.
  - Written on war end, on rank-up, and every 5 min while playing.
  - The UI clamps every number when reading (friends' trust model; there is no server check).
- **Board** (menu tab «Доска почёта»): top 20, with tabs «Сезон» (sxp), «Всё время» (xp), «Кто тащил» (mvp), «Коллекция» (uniq).
  - The own row is always pinned.
  - Each row: rank stamp, name, side pen colour, value, and «в сети» if seen in room presence.
- **Зал славы** (menu tab, or after an ending): the list of `hall/<n>`, each with the season number, the winner's emblem, the score, the season MVP, «досрочно» if early, and a button «Смотреть концовку» (replays the panels).

### 5.7 «Сход дня» (daily poll; UI and db only)

- **Poll.** One poll per day per world, from `DAILY_SKHOD`, picked by hash(season n, day).
- **Votes.** Stored in db `poll/<day>` as `{ [uid]: optionIndex }`. Voting gives +20 XP.
- **Result.** The winning option is shown in the feed and the menu next time («Сход дня решил: …»). Its `bonus` key gives everyone **×1.5 XP** on that action for that day: `doner` captures, `votes`, `ggntu` holds, `kills`, `heroes`, `cars`, `caps`, `floors`.
- **Solo.** The poll still shows (single voter), so nobody misses the joke.

---

## 6. Retention: reasons to come back tomorrow

1. **Chapters with a countdown in active minutes.**
   - The menu shows the next chapter as a teaser card (`CHAPTERS[ch+1].teaser`) with «откроется через 41 мин игры» and the line «мир спит, пока никто не играет».
   - The feed posts the chapter intro when the chapter starts.
2. **Daily quests ×3, one free reroll, and a streak.**
   - The streak is «Каждый день на паре»: +10% XP per day, up to +50%.
   - A missed day shows a stamp «Н за пропуск» and resets the streak (`STREAK_LINES`).
3. **The collection, with 3 equip slots, rarities and dupes into XP.** The menu shows a binder: missing cards as pencil outlines with «?».
4. **MVP «Кто тащил»** after every war in the feed, plus «лучший у проигравших» so the losing side has a hero too.
5. **Rivalry stats.**
   - **When it counts:** the war ends and both players were active on opposite sides.
   - **What is stored:** each player stores `rivals[name] = [w, l]`.
   - **Where it shows:** the board shows «Ты против Зураба: 7–4»; the feed says «Счёт с Зурабом: 7–4» at war end when he is in the war.
6. **Comebacks.**
   - In-war: +150 ₽ / +300 ₽ start money after losses.
   - Season-wide: the underdog aura and 15-point wins. Being 60 points behind on day 5 is still worth logging in.
7. **Friend online in the feed.**
   - When room presence adds a peer whose `pp` name is known: a line from `ONLINE_LINES[name]` (generic otherwise).
   - When a peer leaves: «{name} вышел. Н.»
   - Throttled to one line per person per 10 min.
8. **«Пока тебя не было».**
   - **Source:** the keeper appends to db `w/log` (last 50): `{ wall, k: 'war' | 'chapter' | 'season', … }` on victory, chapter and season end.
   - **On menu open** after more than 6 h away, it shows the wars since then (won/lost per side, MVPs, chapter changes), in `AWAY_LINES` voice.
9. **«Сход дня»** (§5.7), so there is something to vote on even without time for a war.
10. **The season ending and Зал славы.** The winning side gets a comic, and season 2 starts with all content unlocked faster.
11. **New achievements** (`V4_ACHIEVEMENTS`, 16), same tracker as `achievements.ts`.

---

## 7. New FxEv summary (sim → UI)

```ts
| { e: 'chapter'; n: number; ch: number }
| { e: 'seasonEnd'; n: number; w: -1 | 0 | 1; a: number; k: number; mvp: string }
| { e: 'ipit'; s: Side; h: number; v: Side; until: number }
| { e: 'view'; s: Side }                       // Шайба «вид с высоты» pulse
| { e: 'ansar'; k: 'enroll' | 'closed' | 'open' | 'over'; s: Side | -1; until?: number }
| { e: 'debit'; s: Side; n: number }           // Ансар «подписка»: ₽ taken in the last 10 s
| { e: 'drop'; s: Side; id: number; x: number; z: number; r: number; until: number }
| { e: 'dropEnd'; s: Side; id: number; n: number }
| { e: 'sto'; s: Side; id: number; back: number }
| { e: 'mark'; s: Side; id: number; x: number; z: number; r: number; n: number } // Стукач «Сдал всех»
| { e: 'kom'; s: Side; t: number; pass: 0 | 1 } // a hero back from «Комиссионка»: сдал / не сдал (KOM_RESULT)
| victory gains: mvp: string; top: [string, string]
| ability keys: ipit | nick | snitch | shawarma | notes | gears | drop
```

Commands: `hack` (§2.2), `eq` (§5.5), and the admin ops (§1.7).

## 8. Endings (`ENDINGS` in season.ts)

- **Format.** Three scripts (`atagi`, `kurchaloy`, `draw`), 12–14 panels each: `{ who, text, art, spicy?, clean? }`.
  - `who: ''` is the narrator.
  - A `spicy` panel shows `clean` when 18+ is off.
- **Placeholders:** `{n}` season, `{a}` / `{k}` scores, `{diff}` the margin, `{mvp}` the season MVP name (or «никто не тащил» when empty), `{wars}` wars played.
- **Variants.** Panels with `when: 'early'` show only after a «досрочный финал»; `when: 'close'` only if the margin is < 60.
- **Art.** `ENDING_ART` maps every `art` key to a one-line scene description for the renderer: notebook-sketch panels drawn with the existing procedural models and an orthographic camera.
- **Tone.** Dry and short, in the chat's voice; real chat lines where they fit.

## 9. Acceptance checklist for the integrators

- **Determinism:** the season, hacks, Ансар, «Дроп», СТО, `eq` buffs and MVP all use only the sim rng and integer-safe maths.
- **Hash parity:** `hashState` stays equal across clients after a save/restore in each chapter.
- **Old saves migrate:**
  - season state;
  - pts 13..18;
  - Донер Бей moves;
  - `sd.hk`, `sd.cb`, `sd.ansar`, `sd.intel`, `sd.lost`;
  - `U.mark`, `U.kraOff`, `U.nick`, `U.lh`.
- **Balance check:** `tools/symtest.ts` over 32 seeds with the season forced to chapter 7. The Атаги win share stays at 45–55%, and the first war's median stays 8–12 min.
- **Pace check:** a 9 h headless run reaches the season end once, with total points around 1000–1600.
- **18+ off:** no spicy line, card title or ending panel shows.
- **Ending playback** works offline (solo world) and in the shared war.
