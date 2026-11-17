# SIM-BASE — working notes (player-placed base buildings in the sim)

Branch: this worktree's branch, based on `4b8c2dc`. Contract for other tracks: `docs/v5/BASE.md`.

## Done
- Design: `docs/v5/BASE.md`.
- `src/sim/bdefs.ts` — `BUILDINGS` (27 types), `BKEY`, `BASE`, `BF`, `AI_BW`, `bldStats`; re-exported by `defs.ts`.
- `src/sim/bld.ts` — everything: index (`Sim.bi`), `canBuild` / `canBuildType` / `canUp` / `canSell` /
  `canRep` / `canFire`, the `bld` command, towers, traps, economy, support, superweapons, unit-vs-building
  combat, the move overlay (`bldMove`), AI builder, admin ops, war end / new war.
- Hooks in `src/sim/sim.ts` (search for `bld`): state fields, `Cmd` / `FxEv` unions, `apply`, `admin`,
  `order` (`tb`), `chaseCell`, `ordTarget`, `ordAct`, `possStep`, `cost`, `spawn`, `income`, `stats`, `step`,
  `cleanup`, `ai`, `units` (target + engage), `moveTo`, `acquire`, `steal`, `hurt`, `aoes`, `projectiles`,
  `newWar`, public query methods.
- Protocol: `api/_lib/proto.ts` (`FIELDS.bld`, `case 'bld'`, `ord.tb`), `validCmd` (`src/net/shared.ts`),
  `stateShape` (`src/net/guard.ts`), admin ops `bgive` / `bkill` / `bheal` (`src/sim/admin.ts`),
  `api/_lib/admcheck.js` regenerated.
- Tests: `tools/basetest.ts` (≈ 100 checks, called from `tools/simtest.ts`), bases in the determinism
  snapshots (`forceBase`) and in the worst-case size (`fillBases`: 106 KB with both bases full), `vbtest`
  relays `bld` and `ord.tb` field for field, `cleanscan` reads building texts and the deny strings.

## Baseline (before any change, `npx tsx tools/symtest.ts asym 45 16`)
Атаги 53 %, first-war median 6.8 min (4.7–14.3), all wars median 7.7, 18 723 ticks/s, state peak 61.2 KB.

## Balance after (same sweep, final numbers)
Атаги 49 %, first-war median 10.3 min (3.5–16.3), all wars median 9.1, 14 011 ticks/s, state peak 67.2 KB,
0 exceptions. Over 48 seeds (seeds 1–48 in three runs of 16): before 55.3 % / first wars 29–19 / median 8.2;
after 58.0 % / 34–14 / 9.8 (max 21.3, 9 of 48 over 14 min; 7 of 48 before). One 16-seed sweep is ± 6 points.

What the sweeps showed (48 seeds each, `e48_summary.log` in the scratch folder):
- AI that never builds: 54.6 % — the old Атаги edge is not from bases.
- `bldgVs` 2 / 1.5 (Чимаев weaker against buildings): 57.5 / 59.5 % — kept at 3.
- Чимаев's seek radius (`bldgSeek` 4 → 0 → −4): no effect.
- `splashVs` 1 → 2 → 3: 59.9 → 59.2 → 58.0 % over 48 seeds, 57 → 50 → 49 % on seeds 1–16. Kept 3: it makes
  the two ranged units equal against a tower (33 vs 32 a shot), which they were not (11 vs 32).
- Bounty 0, reserve 200, cadence 250 / 150: all inside the noise.

## In progress
Nothing.

## Next (for whoever balances after this track)
- First wars go to Атаги about 70 % of the time over 48 seeds (60 % before bases). Not found why; the
  river covers one side of Атаги's base, and Курчалой places more buildings and loses twice as many.
  Levers that exist: `AI_BW`, `BASE.aiEvery / aiJit / aiReserve`, tower numbers, `BASE.splashVs`, `BASE.bldgVs`.

## Decisions (and why)
- Model B: per-Sim overlay from `st.bld`, enemies only; flow fields and `Terrain` untouched.
- One nav cell per building; `tg ≤ −10` = building id `−tg − 10`.
- A building under upgrade keeps working at its old level (`up > tick` → level `lv − 1`); a new one is level 0.
- Repair price = `floor(0.5 × paid) − refund(b)`: exactly what the repair adds to the refund; an upgrade
  keeps the hp share. So bank + refunds never grows (property-tested).
- Walls stop a unit at once (no sliding along them) unless a player ordered it to move / drives it.
- `bldPick` rejects by the box around a side's buildings, so admin-given buildings anywhere are targets too.
- Auto-targets: unit → nearer of (visible non-wall building, the high-rise). Seen traps are targets.
- Splash of unit shots does not touch buildings; `aoe` pulses do. A splash shooter's direct hit on a building is ×`BASE.splashVs`.
- Towers sleep while no enemy unit is within `BASE.reach` of the box around the side's buildings; `Sim.moveTo`
  asks buildings only within `BASE.near` of the enemy's box (both are pure speed-ups: 13–14 k ticks/s).

## Checked in the real page
`npx vite --port 5271`, `?lq`, a local game as Атаги: `session.submit({ k: 'bld', s: 0, op: 'put', b: 0, x, z })`
builds a Рогатка owned by the player, the AI then builds for the idle human side and for the enemy, 3600
ticks at ×8 with no page errors. Buildings are not drawn yet (the renderer is another track): the old
renderer ignores `st.bld`, draws shots of unknown looks as look 0 and skips `bld` / `bhit` / `zap` events.

## How to verify
`npx tsc --noEmit; npx tsc --noEmit -p api; npx tsx tools/simtest.ts 3 7; npx tsx tools/cleanscan.ts;
node tools/gen-admcheck.mjs --check; npx vite build; npx tsx tools/symtest.ts asym 45 16;
npx tsx tools/vbtest.ts 5871 20`
