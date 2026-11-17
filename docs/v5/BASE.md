# ВЫСОТКА v5 — базы: постройки, которые ставят игроки (контракт симуляции)

Track SIM-BASE. This file is the contract between the sim and the UI / art / content tracks.
**Keys, field names, flags, command and event shapes are stable. Numbers are balance and may move**
(read them from `BUILDINGS`, never hard-code them in a panel).

Code: `src/sim/bdefs.ts` (table and constants, re-exported by `src/sim/defs.ts`), `src/sim/bld.ts`
(all logic), hooks in `src/sim/sim.ts`. Tests: `tools/basetest.ts` (run by `tools/simtest.ts`).

---

## 1. The idea in one paragraph

Each side builds a base around its high-rise for ₽ from the same bank that buys units: defence towers,
walls, hidden traps, economy and support buildings, later superweapons. The «Прорабская» is the base
level (1..3): it unlocks tiers, raises the caps, widens the build zone and allows upgrades. Buildings
never change path-finding: they block **enemy** units only, and a unit whose step is refused by a
building attacks it («мешает — ломаем»). Mechanics are genre conventions (tower defence / base
builders); names, looks and jokes are our own.

## 2. State: `State.bld: B[]`

Plain JSON objects, in placement order (the order is behaviour). `migrate()` adds `bld: []` to old saves.

| Field | Meaning |
|---|---|
| `id` | unique id from `st.nextId` (shared counter with units, never reused) |
| `s` | side 0 Атаги / 1 Курчалой |
| `t` | type = index into `BUILDINGS` (append-only) |
| `x`, `z` | centre of its nav cell (2 × 2 world units): odd integers, snapped by the sim |
| `hp`, `mhp` | health; `mhp` follows the level |
| `lv` | level 1..3 |
| `cd` | tick when it may act next (tower shot, trap re-arm, hatch, pulse). `cd > tick` on a trap = sprung, re-arming |
| `tg` | unit id it aims at, or −1 (for turret rotation) |
| `own` | who placed it: `Player.n`; −2 the AI; −1 nobody (admin) |
| `at` | tick it was placed |
| `up` | under construction / being upgraded until this tick (inactive while `up > tick`; 0 after the first tick it is ready) |
| `paid` | ₽ actually paid for it so far (build + upgrades, discounts included) — the base of refunds, repair price, bounty |
| `f` | flags `BF`: `SEEN` 1 (the enemy has seen this hidden thing: draw it for both sides), `ADM` 2 (removed by the admin: no bounty) |
| `v` | type-specific number: superweapon charge start tick; else 0 |
| `hit` | tick of the last damage it took (flash; repair lock; «Бараний загон» growth) |

Everything a renderer needs is in `st.bld` (events are skipped in quiet replays): construction = `up > tick`,
progress = `(tick − at) / (up − at)` for a new one, level = `lv`, aiming = `tg`, cooling = `cd`, hidden = §8.

Other state: `SideState.bdisc` (building discount until tick), `SideState.blost` (₽ paid for buildings
this side lost in this war), `SideState.aiB` (AI's next build tick); `Player.bc?` (build cooldown until
tick, created by the player's first build command); `P.b?` (projectile aimed at building id).

Unit targets: `U.tg ≤ −10` means building id `−tg − 10` (`−1` none, `−2` the enemy high-rise as before).
An order may carry the same value in `Ord.tg` (attack order on a building).

## 3. Grid, zone, placement

- One building = one **nav cell** (2 × 2 units). The sim snaps any `x, z` to the cell centre.
- **Build zone** `buildZone(side)` → `{ x, z, r, keep, rMax }`: a disc around the own high-rise,
  `r = 15 + 2 × base level` (15 / 17 / 19 / 21), minus the inner keep-out `keep = HQ.radius + 1.6`
  (spawn ring). Growth: only through the «Прорабская» level. (Outposts in villages are deliberately
  not in v5: a village changes hands, a base should not.)
- Ground: the cell is passable, not water, not on a bridge, not within 3 of a capture point's centre.
- One building per cell. Solid non-wall buildings keep a **one-cell gap** from each other (8
  neighbours), so units always slip between them; walls may touch anything; traps and the hidden
  «Тесла» are not solid and need no gap.
- No enemy unit may stand in the cell at the moment of placing.
- A unit that is already inside a blocked cell (spawned there, pushed) may always walk out.

`canBuild(side, type, x, z, player?)` is a pure query (no writes, no randomness): `null` when the
spot is fine, else a clean Russian reason. The command, the AI and the placement ghost all use it.
Reasons, in check order:

| Reason | When |
|---|---|
| `Нет такой постройки` | bad type |
| `Жди следующую войну` | the war is over |
| `Не так быстро` | the player's build cooldown (`Player.bc`) |
| `Сначала поставь Прорабскую` / `Нужна Прорабская N-го уровня` | tier above the base level |
| `Больше таких нельзя` | per-type cap |
| `База застроена: подними Прорабскую` | total cap (non-wall) |
| `Забора хватит: подними Прорабскую` | wall cap |
| `Голда не на балике` | bank below the price |
| `Тут не построишь` | off the map / impassable cell |
| `Строй у своей высотки` | outside the zone |
| `Слишком близко к высотке` | inside the keep-out |
| `В воде не строим` | water |
| `На мосту нельзя` | bridge |
| `Тут точка сбора` | capture point centre |
| `Место занято` | another building in the cell |
| `Оставь проход` | gap rule |
| `Тут стоят чужие` | enemy unit in the cell |

Other queries: `canUp(side, id, player?)` (`Нет такой постройки`, `Это чужое`, `Ещё строится`,
`Выше некуда`, `Нужна Прорабская N-го уровня`, `Голда не на балике`, `Не так быстро`),
`canSell(side, id, player?)` (`Хозяин на связи: не твоё`), `canRep(side, id, player?)`
(`И так целое`, `Сначала отбейся`, `Голда не на балике`), `canFire(side, id, x, z, player?)`
(`Ещё заряжается`, `Это не стреляет`).

## 4. Base level, tiers, caps

Base level `bl` = level of the side's finished «Прорабская» (0 without one). If it is destroyed the
level drops: nothing is removed, but nothing above the new limits can be built or upgraded.

| | bl 0 | bl 1 | bl 2 | bl 3 |
|---|---|---|---|---|
| Tier unlocked | 0 | 0–1 | 0–2 | 0–3 |
| Buildings (non-wall) | 10 | 16 | 23 | 30 |
| Wall segments | 16 | 24 | 32 | 40 |
| Zone radius | 15 | 17 | 19 | 21 |
| Max building level | 1 | 1 | 2 | 3 |

Each type also has its own cap (`BUILDINGS[t].cap`). Worst case 70 buildings a side ≈ 18 KB of state.

## 5. Money rules

- **Price** `bcost(side, type, level)` = `cost[level − 1]`, ×0.75 while `SideState.bdisc > tick`.
  Level 1 is the build price, the next entries are the upgrade prices. Paid at once; the building is
  inactive until `up` (build time `bt[level − 1]` ticks). An upgrade also switches it off until done.
- **Sell**: refund `floor(0.5 × paid × hp / mhp)` — never more than half of what was paid, less when
  damaged. Only your own buildings; anyone's of your side when the owner is the AI / nobody, or has
  sent no command for 90 s (`BASE.ownerIdle`).
- **Repair**: price `ceil(0.5 × paid × (mhp − hp) / mhp)`, instant, refused within 5 s of a hit.
  It costs at least what it adds to the refund, so sell → build → repair loops only lose money.
  Anyone of the side may repair and upgrade any building of the side.
- No sequence of place / upgrade / repair / sell increases a side's bank (property-tested).
- **Bounty**: the side that destroys a building gets `floor(paid × 0.12) + 2` ₽ (like units).
- **Rate limit** per player (`Player.bc`): after an action that cost C ₽ the player waits
  `max(5, ceil(C / 12))` ticks (≤ 120 ₽/s through buildings); after a sale 15 ticks. A wall line is one
  action. With the caps this bounds what a griefer can do to the shared bank; it cannot be emptied
  «за секунду».
- Income from buildings is part of `income()`: «Ларёк» ≤ 4, «Бараний загон» ≤ 6, «Шаурмечная» ≤ 1.2 ₽/s
  each; all caps full ≈ 26 ₽/s, far below `guard.moneyBound` (300 ₽/s). Blackout, hack and «Аура
  нищеты» act on it like on any income.
- «Сейф»: each finished safe hides `[150, 250, 400]` ₽ of the bank from Мохьмад (both his hits and
  «Списание с карты» take only from what is above the safes).

## 6. Buildings (`BUILDINGS`, keys are the contract)

Columns: tier · cap · cost L1/L2/L3 · hp L1/L2/L3. All numbers per level are `[L1, L2, L3]`.
Texts in the table are provisional clean names; the content track supplies final names / blurbs by key
(18+ variants as `spicy18`, like сход cards).

### Defence (`fam: 'def'`)

| key | name | tier | cap | cost | hp | what it does |
|---|---|---|---|---|---|---|
| `rogatka` | Рогатка | 0 | 4 | 80/100/140 | 260/360/480 | single target, range 8.5, 9/13/18 dmg every 0.7 s |
| `sebozol` | Пушка Себозола | 1 | 2 | 180/160/220 | 380/500/650 | lobs a shampoo bottle: range 9.5, 16/22/30 splash 2.2, foam slows 3 s, every 2.2 s |
| `sperm` | Клеемёт (18+: Спермострел) | 1 | 2 | 160/150/200 | 320/420/540 | sticky stream: range 7, 3/4/6 dmg 5×/s, every hit glues longer (slow stacks up to 6 s) |
| `tesla` | Тесла | 2 | 2 | 260/220/300 | 420/540/700 | **hidden** until it fires; chain lightning 38/52/70 → ×0.7 → ×0.5 over 3 targets, range 6.5, every 1.6 s. Needs a live «Генератор» within 9; dark in a blackout or hack |
| `gantel` | Гантелемёт | 2 | 2 | 240/200/280 | 360/480/620 | mortar: range 16, **minimum 5**, slow lobbed dumbbell at a spot, 45/62/85 splash 2.6, every 4.5 s |
| `antidron` | Антидрон | 2 | 2 | 150/130/180 | 280/360/460 | hits only flying units (`UnitDef.fly`), range 12, 30/42/58 every 0.8 s. Powered |
| `kamera` | Камера | 1 | 2 | 120/100/140 | 200/260/340 | no damage: enemies within 9/10.5/12 are **marked** and take ×1.15/1.2/1.25 damage from everything. Powered |
| `kuryatnik` | Курятник | 2 | 1 | 220/180/240 | 340/440/560 | while an enemy is within 14: 2/2/3 attack chickens every 8 s (they count as units) |
| `bukva_n` | Вышка «Н» | 3 | 1 | 280/240/320 | 320/420/540 | rare pulse: ≥ 3 enemies within 6 → stunned 1.8/2.2/2.6 s, every 22/19/16 s. Powered |

### Walls (`fam: 'wall'`)

| key | name | tier | cap | cost | hp | what it does |
|---|---|---|---|---|---|---|
| `zabor` | Забор | 0 | wall cap | 15/20/30 | 220/420/700 | профнастил → кирпич → бетон. Blocks every enemy ground unit. Placed as a line: one command, ≤ 16 cells |
| `shlagbaum` | Шлагбаум | 1 | 3 | 60/60/90 | 500/750/1000 | blocks enemy **vehicles** only (`Kind.Fast`: Баран/Камри, такси/маршрутка, Гелик); a blocked ride unloads |

### Traps (`fam: 'trap'`, hidden from the enemy until sprung; not solid; re-arm on their own)

| key | name | tier | cap | cost | hp | what it does |
|---|---|---|---|---|---|---|
| `grabli` | Грабли | 0 | 4 | 30/30/40 | 80/110/150 | first enemy within 1.2: 10/20/30 dmg, stun 2.5/3.5/4.5 s; re-arms in 15 s |
| `yama` | Яма | 1 | 2 | 90/80/110 | 120/160/210 | enemy within 1.4 → everyone within 2.2: 40/60/85 dmg, stun 1.5/2/2.5 s; 30 s |
| `lezhak` | Лежачий полицейский | 1 | 3 | 60/60/80 | 150/200/260 | enemy vehicle within 1.4: 80/120/170 dmg and a stop for 2/2.8/3.6 s; 12 s |
| `nychka` | Нычка | 2 | 2 | 80/70/100 | 100/130/170 | ≥ 2 enemies within 2.5 → cloud 3.5: poison for 8/11/14 s; 40 s |
| `sobaka` | Злая собака | 1 | 2 | 100/90/120 | 300/400/520 | hidden in the kennel until someone is within 3; then bites 14/20/28 every 0.6 s |

### Economy (`fam: 'eco'`)

| key | name | tier | cap | cost | hp | what it does |
|---|---|---|---|---|---|---|
| `larek` | Ларёк | 0 | 3 | 150/150/220 | 300/400/520 | +1.5/2.5/4 ₽/s |
| `shaurma` | Шаурмечная | 1 | 2 | 200/170/230 | 320/420/540 | heals own units within 6 by 1/1.4/1.8 % max hp per second; +0.5/0.8/1.2 ₽/s |
| `seyf` | Сейф | 1 | 1 | 120/110/150 | 600/800/1000 | hides 150/250/400 ₽ from theft |
| `zagon` | Бараний загон | 2 | 2 | 180/160/220 | 280/370/480 | +0.5 ₽/s, +0.5 more for every 30 s nobody hits it, up to 3/4.5/6 ₽/s; any hit resets it |

### Support and tech (`fam: 'sup'`)

| key | name | tier | cap | cost | hp | what it does |
|---|---|---|---|---|---|---|
| `prorab` | Прорабская | 0 | 1 | 200/400/700 | 600/900/1300 | the base level (§4) |
| `kachalka` | Качалка | 2 | 1 | 220/200/280 | 450/600/780 | own units that appear while it stands get +8/12/16 % hp (not bosses, not summons) |
| `garazh` | Гараж | 2 | 1 | 200/180/250 | 400/520/680 | own vehicles cost ×0.85/0.8/0.75 and drive ×1.1/1.15/1.2 |
| `vyshka` | Вышка связи | 2 | 1 | 200/180/250 | 300/400/520 | towers within 8 get +10/15/20 % range. Powered |
| `generator` | Генератор | 1 | 2 | 180/160/220 | 350/460/600 | towers within 9 fire ×0.85/0.8/0.75 faster; «Тесла» needs one. Off in a blackout («генератор яйш») |

### Superweapons (`fam: 'super'`, second priority — see `docs/v5/notes/SIM-BASE.md` for what shipped)

| key | name | tier | cap | cost | hp | what it does |
|---|---|---|---|---|---|---|
| `sabvufer` | Сабвуфер | 3 | 1 | 500/400/600 | 500/650/850 | charges 60 s in plain sight (`v` = charge start), then with ≥ 4 enemies within 12: a wave — knock-back, stun 1.5 s, 30/45/60 dmg. Powered |
| `arbuzomet` | Арбузомёт | 3 | 1 | 600/450/650 | 450/600/780 | charges 90 s, then a strike on a chosen spot (command `fire`): lands in 3 s, radius 5, 220/300/400 to units, ×0.5 to buildings and the high-rise |

«Powered» = off while a blackout («Свет яц» event, or the card on this side) or a hack («Взломать
Пентагон») is on. `bldOn(b)` tells a renderer whether a building works right now.

## 7. How the rest of the game treats buildings

| Thing | Rule |
|---|---|
| Path-finding | unchanged; flow fields never see buildings |
| Blocking | walls block all enemy ground units, «Шлагбаум» vehicles, other solid buildings block enemies too (the gap lets them slide by). Own units walk through everything of their own |
| «Мешает — ломаем» | a unit stopped by an enemy building targets it; a ride unloads instead |
| Auto targets | enemy unit in aggro → else the nearer of (visible enemy building in aggro, the high-rise) → else nothing. Walls are attacked only when they block. A unit keeps the building it is hitting while it stands next to it |
| Чимаев (`bldg`) | prefers buildings: goes for the nearest visible building or the high-rise, ×3 to both; «Землетряс» hits buildings in its radius ×3 too |
| Orders | `ord` with `m: 'attack'` and `tb: buildingId` attacks a building; possessed units hit buildings in front with the attack button |
| Splash | unit-vs-unit splash never touches buildings. A shot aimed at a building hurts that building. Area pulses (`aoe`: quake, Голем and Курица bursts, Арбузомёт) hurt buildings in the radius |
| Heals, «Шаурма», «Regen», «Креатин», Донер Бей | units only. Buildings are repaired by command, and for free between wars |
| Taunts, fear, stun, slow, poison | buildings are immune; a taunted unit leaves a building for the taunter |
| Мохьмад | steals per hit on buildings as on units; safes limit every theft |
| God mode (admin) | buildings of that side take no damage |
| Freeze (admin) | that side's towers, traps, hatcheries and superweapons stand still; economy goes on |
| Hack, blackout | powered buildings off; income 0 as before |
| Unit cap | buildings do not count; hatched chickens do |
| HQ turret | unchanged |
| War over | nothing acts until the next war (as for units) |
| Next war | surviving buildings stay, fully repaired, hidden ones hidden again, charges reset; destroyed ones are gone. The loser gets «страховку»: `min(500, 50 % of what its destroyed buildings cost)` ₽ and a 25 % building discount for 90 s (`bdisc`). Admin `reset` wipes all bases |

## 8. Hidden things

The state is shared, so «hidden» is a rule for the enemy's renderer, minimap and panels:
`BUILDINGS[t].hid` and not `b.f & BF.SEEN` → **do not draw it for the other side**. `SEEN` is set when
a trap springs, the dog or the Тесла first acts; it is cleared between wars. Units ignore unseen
buildings (no auto target, no order target). Helper: `bldVisible(b, viewerSide)`.

## 9. Command (one kind)

```ts
{ t, id, p, k: 'bld', s, op: 'put' | 'up' | 'sell' | 'rep' | 'fire', b?, x?, z?, n?, cells? }
```

| op | fields | effect |
|---|---|---|
| `put` | `b` type, `x`, `z` | build one (snapped). For a wall line: `cells` = 1..16 nav cell indices (from `wallLine`) instead of `x, z`; cells are built in order while rules and money allow |
| `up` | `n` building id | upgrade one level |
| `sell` | `n` | sell |
| `rep` | `n` (0 = every damaged building of the side, in placement order, while the bank lasts) | repair |
| `fire` | `n`, `x`, `z` | fire a charged «Арбузомёт» at the spot |

Checked in four places: `Sim.apply` (the only one that knows the world), `api/_lib/proto.ts`
(`FIELDS.bld`, `checkCmd`), `validCmd` in `src/net/shared.ts`. A refused command emits FxEv `deny`
for its player and changes nothing. Server limits: `b` 0..255, `n` 0..2³¹−1, `cells` ≤ 16 ints 0..10⁶.

Admin (existing `adm` fields): `bgive` (`s`, `u` type, `x`, `z`, `v`? level 1..3: free, finished at
once, ignores zone / caps / tier), `bkill` (`s` −1|0|1, optional `x, z, r`: removed, no bounty),
`bheal` (`s`: full hp, construction finished).

## 10. Events (decoration only)

```ts
{ e: 'bld', k, id, s, t, x, z, lv, n }
```
`k`: `put` (n = price), `done` (construction or upgrade finished), `up` (upgrade started, n = price),
`sell` (n = refund), `rep` (n = price), `die` (n = bounty), `seen` (a hidden one revealed), `trap`
(sprung, n = victims), `hatch` (n = chickens), `charge` (superweapon charged), `fire`, `stun`
(Вышка «Н», n = victims), `wave`.

Shots reuse `shot { x, z, tx, tz, k, at, s }` with `k = 20 + building type` (projectile looks 20..46),
hits on buildings `bhit { id, x, z, s }`, the Тесла chain `zap { s, id, pts: [x, z, x, z, …] }`.
`deny { p, why }` carries the reasons of §3.

## 11. AI

Inside `ai(side)` behind the same `aiNext` gate as unit buying (so it also runs for an idle human
side, and tests that silence the AI silence the builder). At most one build action every 15–25 s
(`SideState.aiB`), only with `bank ≥ price + 150` (the reserve keeps unit buying alive) — it never
saves up for a building. Plan: Прорабская → Ларёк → Рогатки → by weight (`AI_BW`), upgrades when the
caps are full, repairs of badly damaged buildings. Spots come from a per-terrain list of zone cells
ranked by the goal field to the enemy high-rise: towers and traps on the enemy's side, economy
behind the high-rise, short wall lines in front. It never sells.

## 12. What the UI gets from the sim

`BUILDINGS` (`key, fam, name, blurb, tier, cap, cost[3], hp[3], bt[3], range?, minRange?, stats[3]`
short lines for an info panel, `hid?, solid, pw?`), `BKEY` (key → index), `BASE` (constants), `BF`;
on `Sim`: `canBuild`, `canUp`, `canSell`, `canRep`, `canFire`, `bcost`, `buildZone`, `baseLevel`,
`bldCaps(side)` → `{ n, max, walls, wallMax }`, `bldCount(side, type)`, `building(id)`, `bldAt(x, z)`,
`refund(b)`, `repairCost(b)`, `bldOn(b)`, `bldVisible(b, side)`, `marked(unit)`;
functions `snapCell(terrain, x, z)` → `{ c, x, z }` and `wallLine(terrain, x0, z0, x1, z1, max = 16)`
→ nav cell indices of a straight wall between two points.
