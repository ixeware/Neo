# ВЫСОТКА v5 — базы: постройки, которые ставят игроки (контракт симуляции)

Track SIM-BASE. This file is the contract between the sim and the UI / art / content tracks.
**Keys, field names, flags, command and event shapes are stable. Numbers are balance and may move**
(read them from `BUILDINGS` / `BASE`, never hard-code them in a panel).

Code: `src/sim/bdefs.ts` (table and constants, re-exported by `src/sim/defs.ts`), `src/sim/bld.ts`
(all logic), hooks in `src/sim/sim.ts`. Tests: `tools/basetest.ts` (run by `tools/simtest.ts`).

---

## 1. The idea in one paragraph

Each side builds a base around its high-rise for ₽ from the same bank that buys units: defence towers,
walls, hidden traps, economy and support buildings, two superweapons. The «Прорабская» is the base
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
| `lv` | level 1..3 (the level being built counts: see `up`) |
| `cd` | tick when it may act next (tower shot, hatch, pulse, heal). On a trap: `cd > tick` = sprung, re-arming |
| `tg` | unit id it aims at, or −1 (for turret rotation) |
| `own` | who placed it: `Player.n`; −2 the AI; −1 nobody (admin) |
| `at` | tick it was placed |
| `up` | under construction / being upgraded until this tick; 0 when it is not. **A new building (`lv` 1, `up > tick`) does nothing yet; a building under upgrade keeps working at level `lv − 1` until `up`** |
| `paid` | ₽ actually paid for it so far (build + upgrades, discounts included) — the base of refunds, repair price, bounty |
| `f` | flags `BF`: `SEEN` 1 (the enemy has seen this hidden thing: draw it for both sides), `ADM` 2 (removed by the admin: no bounty) |
| `v` | a tick: when the superweapon's charge / the «Бараний загон» herd started (set when placed, when first finished, after a shot / a hit, and at every new war) |
| `hit` | tick of the last damage it took, 0 = never in this war (flash; repair lock) |

Everything a renderer needs is in `st.bld` (events are skipped in quiet replays): construction = `up > tick`
(progress `(tick − at) / (up − at)` for a new one), level = `lv`, aiming = `tg`, cooling = `cd`, charge =
`(tick − v) / BASE.subCharge`, hidden = §8, works right now = `sim.bldOn(b)`.

Other state: `SideState.bdisc` (building discount until tick), `SideState.blost` (₽ paid for buildings
this side lost in this war), `SideState.aiB` (AI's next build tick); `Player.bc?` (build cooldown until
tick, created by the player's first build command); `P.b?` (projectile aimed at building id).

Unit targets: `U.tg ≤ −10` means building id `−tg − 10` (`−1` none, `−2` the enemy high-rise as before).
An attack order on a building keeps the same value in `Ord.tg`.

## 3. Grid, zone, placement

- One building = one **nav cell** (2 × 2 units). The sim snaps any `x, z` to the cell centre
  (`snapCell(terrain, x, z)` gives the UI the same spot).
- **Build zone** `sim.buildZone(side)` → `{ x, z, r, keep, rMax }`: a disc around the own high-rise,
  `r = 15 + 2 × base level` (15 / 17 / 19 / 21), minus the inner keep-out `keep = HQ.radius + 1.6`
  (the spawn ring). Growth: only through the «Прорабская» level. (Outposts in villages are deliberately
  not in v5: a village changes hands, a base should not.)
- Ground: the cell is passable, not water, not on a bridge, not within 3 of a capture point's centre.
  Real estate at base level 0: 123 cells for Атаги (the river eats the east), 142 for Курчалой.
- One building per cell. Solid non-wall buildings keep a **one-cell gap** from each other (8
  neighbours), so units always slip between them; walls may touch anything; traps and the hidden
  «Тесла» are not solid and need no gap.
- No enemy unit may stand in the cell of a solid building at the moment of placing.
- A unit that is already inside a blocked cell (spawned there, pushed) may always walk out.

`sim.canBuild(side, type, x, z, player?)` is a pure query (no writes, no randomness): `null` when the
spot is fine, else a clean Russian reason. The command, the AI and the placement ghost all use it.
`sim.canBuildType(side, type, player?)` is its first half (everything that does not depend on the spot):
use it to grey out cards in the build menu. Reasons, in check order:

| Reason | When | In `canBuildType` |
|---|---|---|
| `Нет такой постройки` | bad type | ✓ |
| `Жди следующую войну` | the war is over | ✓ |
| `Не так быстро` | the player's build cooldown (`Player.bc`) | ✓ |
| `Сначала поставь Прорабскую` / `Нужна Прорабская N-го уровня` | tier above the base level | ✓ |
| `Забора хватит: подними Прорабскую` | wall cap | ✓ |
| `Больше таких нельзя` | per-type cap | ✓ |
| `База застроена: подними Прорабскую` | total cap (non-wall) | ✓ |
| `Голда не на балике` | bank below the price | ✓ |
| `Тут не построишь` | off the map / impassable cell | |
| `Строй у своей высотки` | outside the zone | |
| `Слишком близко к высотке` | inside the keep-out | |
| `В воде не строим` | water | |
| `На мосту нельзя` | bridge | |
| `Тут точка сбора` | capture point centre | |
| `Место занято` | another building in the cell | |
| `Оставь проход` | gap rule | |
| `Тут стоят чужие` | enemy unit in the cell | |

Other queries (all pure, `null` = allowed):
`canUp(side, id, player?)` — `Нет такой постройки`, `Жди следующую войну`, `Это чужое`, `Не так быстро`,
`Ещё строится`, `Выше некуда`, `Нужна Прорабская N-го уровня`, `Голда не на балике`;
`canSell(side, id, player?)` — the first four, then `Хозяин на связи: не твоё`;
`canRep(side, id, player?)` — the first four, then `И так целое`, `Сначала отбейся`, `Голда не на балике`;
`canFire(side, id, x, z, player?)` — the first three, `Это не стреляет`, `Не так быстро`, `Ещё заряжается`,
`Тут не построишь` (a spot off the map).

## 4. Base level, tiers, caps

Base level `bl` = level of the side's finished «Прорабская» (0 without one; while it is being upgraded
the old level holds). If it is destroyed the level drops: nothing is removed, but nothing above the new
limits can be built or upgraded.

| | bl 0 | bl 1 | bl 2 | bl 3 |
|---|---|---|---|---|
| Tier unlocked | 0 | 0–1 | 0–2 | 0–3 |
| Buildings (non-wall) `BASE.caps` | 10 | 16 | 23 | 30 |
| Wall segments `BASE.walls` | 16 | 24 | 32 | 40 |
| Zone radius | 15 | 17 | 19 | 21 |
| Max building level `BASE.maxLv` | 1 | 1 | 2 | 3 |

Each type also has its own cap (`BUILDINGS[t].cap`; 0 = the wall cap). `sim.bldCaps(side)` →
`{ n, max, walls, wallMax }`. Worst case 70 buildings a side: the 300-unit worst-case state with both
bases full is 106 KB (limit 200 KB).

## 5. Money rules

- **Price** `sim.bcost(side, type, level)` = `cost[level − 1]`, ×0.75 while `SideState.bdisc > tick`.
  Level 1 is the build price, the next entries are the upgrade prices. Paid at once; a new building
  starts working after `bt[0]` ticks, an upgrade takes effect after `bt[level − 1]` ticks (meanwhile the
  old level works). An upgrade keeps the building's hp share (it is not a repair).
- **Sell**: refund `refund(b)` = `floor(0.5 × paid × hp / mhp)` — never more than half of what was paid,
  less when damaged. Only your own buildings; anyone's of your side when the owner is the AI / nobody,
  or has sent no command for 90 s (`BASE.ownerIdle`).
- **Repair**: price `repairCost(b)` = `floor(0.5 × paid) − refund(b)` — exactly what the repair adds to the
  refund. Instant, refused within 5 s of a hit (`BASE.repLock`). Anyone of the side may repair and
  upgrade any building of the side. `rep` with `n: 0` repairs every damaged building the bank can pay for.
- **No sequence of place / upgrade / repair / sell makes money**: bank + Σ refunds never grows
  (property-tested over 2500 random commands with random damage and discounts).
- **Bounty**: the side that destroys a building gets `floor(paid × 0.12) + 2` ₽ (like units).
- **Rate limit** per player (`Player.bc`): after an action that cost C ₽ the player waits
  `max(5, ceil(C / 12))` ticks (≤ 120 ₽/s through buildings); after a sale 15 ticks. A wall line is one
  action. With the caps this bounds what a griefer can do to the shared bank: it cannot be emptied
  «за секунду», and nothing he builds is lost to the side (it can be sold back for half once he is quiet).
- Income from buildings is part of `income()`: «Ларёк» ≤ 4, «Бараний загон» ≤ 6, «Шаурмечная» ≤ 1.2 ₽/s
  each; all caps full, level 3: 26.4 ₽/s, far below `guard.moneyBound` (300 ₽/s). Blackout, hack, «Аура
  нищеты», «Мы в плюсе» and the AI difficulty multiplier act on it like on any income.
- «Сейф»: a finished safe hides `[150, 250, 400]` ₽ of the bank from Мохьмад (both his hits and
  «Списание с карты» take only from what is above the safe).

## 6. Buildings (`BUILDINGS`, keys are the contract)

Columns: tier · cap · cost L1/L2/L3 · hp L1/L2/L3. All numbers per level are `[L1, L2, L3]`.
Names and blurbs in the table are provisional and clean; the content track supplies the final ones by
key (18+ variants as `spicy18: { name, blurb? }`, like сход cards — the sim never reads them).
`bldStats(type, level)` returns `[label, value][]` for an info panel.

### Defence (`fam: 'def'`)

| key | name | tier | cap | cost | hp | what it does |
|---|---|---|---|---|---|---|
| `rogatka` | Рогатка | 0 | 4 | 80/100/140 | 260/360/480 | single target, range 8.5, 9/13/18 dmg every 0.7 s |
| `sebozol` | Пушка Себозола | 1 | 2 | 180/160/220 | 380/500/650 | lobs a shampoo bottle: range 9.5, 16/22/30 splash 2.2, foam slows 3 s, every 2.2 s |
| `sperm` | Клеемёт (18+: Спермострел) | 1 | 2 | 160/150/200 | 320/420/540 | sticky stream: range 7, 3/4/6 dmg 5×/s, every hit glues longer (slow stacks up to 6 s) |
| `tesla` | Тесла | 2 | 2 | 260/220/300 | 420/540/700 | **hidden** until it fires; chain lightning 38/52/70 → ×0.7 → ×0.5 over 3 targets (hop 3.5), range 6.5, every 1.6 s. Needs a live «Генератор» within 9; dark in a blackout or hack |
| `gantel` | Гантелемёт | 2 | 2 | 240/200/280 | 360/480/620 | mortar: range 16, **minimum 5**, slow lobbed dumbbell at a spot (no homing), 45/62/85 splash 2.6, every 4.5 s |
| `antidron` | Антидрон | 2 | 2 | 150/130/180 | 280/360/460 | hits only flying units (`UnitDef.fly` — none in the game yet), range 12, 30/42/58 every 0.8 s. Powered |
| `kamera` | Камера | 1 | 2 | 120/100/140 | 200/260/340 | no damage: enemies within 9/10.5/12 are **marked** and take ×1.15/1.2/1.25 damage from everything (`sim.marked(u)`). Powered |
| `kuryatnik` | Курятник | 2 | 1 | 220/180/240 | 340/440/560 | while an enemy is within 14: 2/2/3 attack chickens every 8 s (ordinary units: they count against the unit cap) |
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
| `lezhak` | Лежачий полицейский | 1 | 3 | 60/60/80 | 150/200/260 | enemy vehicle within 1.4: 80/120/170 dmg and a stop for 2/2.8/3.6 s (КРА: damage only); 12 s |
| `nychka` | Нычка | 2 | 2 | 80/70/100 | 100/130/170 | ≥ 2 enemies within 2.5 → cloud 3.5: 10/15/20 dmg and poison for 8/11/14 s; 40 s |
| `sobaka` | Злая собака | 1 | 2 | 100/90/120 | 300/400/520 | hidden in the kennel until someone is within 3; then bites 14/20/28 every 0.6 s |

### Economy (`fam: 'eco'`)

| key | name | tier | cap | cost | hp | what it does |
|---|---|---|---|---|---|---|
| `larek` | Ларёк | 0 | 3 | 150/150/220 | 300/400/520 | +1.5/2.5/4 ₽/s |
| `shaurma` | Шаурмечная | 1 | 2 | 200/170/230 | 320/420/540 | heals own units within 6 by 1/1.4/1.8 % max hp per second; +0.5/0.8/1.2 ₽/s |
| `seyf` | Сейф | 1 | 1 | 120/110/150 | 600/800/1000 | hides 150/250/400 ₽ from theft |
| `zagon` | Бараний загон | 2 | 2 | 180/160/220 | 280/370/480 | +0.5 ₽/s, +0.5 more for every 30 s nobody hits it, up to 3/4.5/6 ₽/s; any hit starts it over |

### Support and tech (`fam: 'sup'`)

| key | name | tier | cap | cost | hp | what it does |
|---|---|---|---|---|---|---|
| `prorab` | Прорабская | 0 | 1 | 200/400/700 | 600/900/1300 | the base level (§4) |
| `kachalka` | Качалка | 2 | 1 | 220/200/280 | 450/600/780 | own units that appear while it stands get +8/12/16 % hp (not bosses, not summons) |
| `garazh` | Гараж | 2 | 1 | 200/180/250 | 400/520/680 | own vehicles cost ×0.85/0.8/0.75 and drive ×1.1/1.15/1.2 |
| `vyshka` | Вышка связи | 2 | 1 | 200/180/250 | 300/400/520 | towers within 8 get +10/15/20 % range. Powered |
| `generator` | Генератор | 1 | 2 | 180/160/220 | 350/460/600 | towers within 9 fire ×0.85/0.8/0.75 faster; «Тесла» needs one. Off in a blackout («генератор яйш») |

### Superweapons (`fam: 'super'`)

| key | name | tier | cap | cost | hp | what it does |
|---|---|---|---|---|---|---|
| `sabvufer` | Сабвуфер | 3 | 1 | 500/400/600 | 500/650/850 | charges 60 s in plain sight (`v` = charge start), then with ≥ 4 enemies within 12 fires by itself: a wave — knock-back 5, stun 1.5 s, 30/45/60 dmg. Powered |
| `arbuzomet` | Арбузомёт | 3 | 1 | 600/450/650 | 450/600/780 | charges 90 s, then a strike on a chosen spot anywhere (command `fire`): lands in 3 s (`aoe` key `arbuz`), radius 5, 220/300/400 to units, ×0.5 to buildings and to the high-rise |

«Powered» (`pw`) = off while a blackout («Свет яц» event, or the card on this side) or a hack («Взломать
Пентагон») is on. `sim.bldOn(b)` tells a renderer whether a building works right now (built, powered,
not frozen, the Тесла's generator alive).

## 7. How the rest of the game treats buildings

| Thing | Rule |
|---|---|
| Path-finding | unchanged; flow fields and the nav grid never see buildings |
| Blocking | walls block all enemy ground units, «Шлагбаум» enemy vehicles, other solid buildings block enemies too (the gap lets them slide by). Own units walk through everything of their own. Flying units cross everything |
| «Мешает — ломаем» | a unit stopped by an enemy wall targets it at once; stopped by another building, when it cannot slide past. A ride unloads instead. A unit a player ordered to *move*, or drives, never attacks on its own: it slides along |
| Auto targets | enemy unit in aggro → else the nearer of (visible enemy non-wall building in aggro, the high-rise) → else nothing. Walls only when they block. A unit keeps the building it is hitting while it stands next to it |
| Чимаев (`bldg`) | never units: the nearest visible building within aggro + 4, or the high-rise, whichever is nearer. ×`min(bldg, BASE.bldgVs)` against buildings, ×`bldg` (3) against the high-rise as before; «Землетряс» shakes buildings in its radius by the same factor |
| Orders | `ord` with `m: 'attack'` and `tb: buildingId` (a visible enemy building): the units walk there along a flow field and break it, then hold. Attack-move and hold pick buildings like auto. Possessed units hit the building in front with the attack button |
| Splash | unit-vs-unit splash never touches buildings. A shot aimed at a building hurts that building only. Area pulses (`State.aoe`: quake, Голем and Курица bursts, Арбузомёт) hurt enemy buildings in the radius |
| Heals, «Шаурма», «Regen», «Креатин», Донер Бей | units only. Buildings are repaired by command, and for free between wars |
| Taunts, fear, stun, slow, poison | buildings are immune; a taunted unit leaves a building for the taunter |
| Мохьмад | steals 4 ₽ per hit on a building as on a unit; the safe limits every theft |
| God mode (admin) | buildings of that side take no damage |
| Freeze (admin) | that side's towers, traps, hatcheries, kitchens and superweapons stand still; income goes on |
| Hack, blackout | powered buildings and generators off; income 0 as before |
| Unit cap | buildings do not count; hatched chickens do |
| HQ turret | unchanged |
| War over | nothing acts and build commands do nothing until the next war (as for units) |
| Next war | surviving buildings stay, fully repaired, hidden ones hidden again, charges and herds start over; destroyed ones are gone. The loser gets «страховку»: `min(500, 50 % of what its buildings destroyed in that war cost)` ₽ and a 25 % building discount for 90 s (`bdisc`). Admin `reset` wipes all bases; admin `newWar` keeps them |

## 8. Hidden things

The state is shared, so «hidden» is a rule for the enemy's renderer, minimap and panels:
`BUILDINGS[t].hid` and not `b.f & BF.SEEN` → **do not draw it for the other side**
(`bldVisible(b, viewerSide)` from `src/sim/bld.ts`). `SEEN` is set when a trap springs, the dog or the
Тесла first acts; it is cleared between wars. Units ignore unseen buildings (no auto target, no order
target, no blocking — hidden things are never solid). A seen trap is a target like any building.

## 9. Command (one kind)

```ts
{ t, id, p, k: 'bld', s, op: 'put' | 'up' | 'sell' | 'rep' | 'fire', b?, x?, z?, n?, cells? }
```

| op | fields | effect |
|---|---|---|
| `put` | `b` type, `x`, `z` | build one (snapped). For a wall line: `cells` = 1..16 nav cell indices (from `wallLine`) instead of `x, z`; cells are built in order while rules and money allow (no deny if at least one was built) |
| `up` | `n` building id | upgrade one level |
| `sell` | `n` | sell |
| `rep` | `n` (0 = every damaged building of the side, in placement order, while the bank lasts) | repair |
| `fire` | `n`, `x`, `z` | fire a charged «Арбузомёт» at the spot |

Checked in three places: `Sim.apply` → `bldApply` (the only one that knows the world),
`api/_lib/proto.ts` (`FIELDS.bld`, `checkCmd`: `b` 0..255, `n` 0..2³¹−1, `x`/`z` both or neither,
`cells` ≤ 16 ints 0..10⁶), `validCmd` in `src/net/shared.ts`. A refused command emits FxEv `deny` for
its player and changes nothing; a malformed one does nothing at all. `ord` got the optional `tb`.

Admin (existing `adm` fields): `bgive` (`s`, `u` type, `v`? level 1..3, `x, z`?: free, finished at
once, ignores zone / caps / tier; without a spot: the first free cell of the side's zone), `bkill`
(`s` −1|0|1, optional `x, z, r`: removed, no bounty), `bheal` (`s`: full hp, construction finished).

## 10. Events (decoration only)

```ts
{ e: 'bld', k, id, s, t, x, z, lv, n }
```
`k`: `put` (n = price), `done` (construction or upgrade finished), `up` (upgrade started, n = price),
`sell` (n = refund), `rep` (n = price), `die` (n = bounty), `seen` (a hidden one revealed), `trap`
(sprung, n = victims), `hatch` (n = chickens), `charge` (superweapon charged), `fire` (Арбузомёт),
`stun` (Вышка «Н», n = victims), `wave` (Сабвуфер, n = victims).

Shots reuse `shot { x, z, tx, tz, k, at, s }` with `k = BASE.shotK (20) + building type` (the old
renderer draws unknown looks as look 0), hits on buildings are `bhit { id, x, z, s }`, the Тесла chain
is `zap { s, id, pts: [x, z, x, z, …] }` (the tower first). `deny { p, why }` carries the reasons of §3.
The Арбузомёт's landing is an ordinary `pulse` with key `arbuz`; chickens come with `summon`.

## 11. AI

Inside `Sim.ai(side)` behind the same `aiNext` gate as unit buying (so it also runs for an idle human
side, and tests that silence the AI silence the builder). At most one build action every
`BASE.aiEvery .. + aiJit` ticks (`SideState.aiB`), only with `bank ≥ price + BASE.aiReserve + what it
is saving for a hero` — it never saves up for a building, so units come first. Order: fire a charged
Арбузомёт → repair a building below half hp → Прорабская → Ларёк → two Рогатки → a weighted pick
(`AI_BW` by key, or an upgrade). Spots come from a per-terrain list of zone cells ranked by the goal
field to the enemy high-rise: towers 6.5–11.5 from the high-rise on the enemy's side (the generator
and the relay among them, a Тесла within its generator's reach), traps 10+ out, walls as short
straight pieces 11–13.5 out, economy and tech behind the high-rise. It never sells.

## 12. What the UI gets from the sim

- `src/sim/defs.ts` re-exports `BUILDINGS` (`key, fam, name, blurb, spicy18?, tier, cap, cost[3], hp[3],
  bt[3], r, solid, wall?, line?, hid?, pw?, range?, min?, dmg?, rate?, sp?, proj?, eff?, eff2?, inc?`),
  `BKEY` (key → type), `BASE` (constants), `BF` (flags), `AI_BW`, `bldStats(type, level)`.
- On `Sim` (all pure): `canBuild`, `canBuildType`, `canUp`, `canSell`, `canRep`, `canFire`, `bcost`,
  `buildZone`, `baseLevel`, `bldCaps`, `bldCount(side, type)`, `building(id)`, `bldAt(x, z)`, `bldOn(b)`,
  `marked(unit)`; the list itself is `sim.st.bld`.
- From `src/sim/bld.ts`: `snapCell(terrain, x, z)` → `{ c, x, z }`, `wallLine(terrain, x0, z0, x1, z1,
  max = 16)` → nav cell indices of a straight 4-connected wall between two points (send them as `cells`),
  `refund(b)`, `repairCost(b)`, `bldVisible(b, side)`; type `B`.
- A build menu in one loop: `BUILDINGS.map((d, t) => ({ d, t, why: sim.canBuildType(side, t, me), price:
  sim.bcost(side, t), have: sim.bldCount(side, t) }))`; the ghost: `sim.canBuild(side, t, x, z, me)` every
  frame; a selected building: `canUp / canSell / canRep`, `bcost(side, b.t, b.lv + 1)`, `refund(b)`,
  `repairCost(b)`, `bldStats(b.t, b.lv)`.
