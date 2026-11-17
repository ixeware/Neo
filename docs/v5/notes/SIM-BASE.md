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

## In progress
- Balance of the AI builder (48-seed sweeps: scratch scripts `exp48.sh`, `agg.mjs`; `TUNE` in
  `tools/symtest.ts` now takes `BASE`, `AI_BW` and building keys).

## Next
- Final numbers into `docs/v5/BASE.md`, final checks, final commit.

## Decisions (and why)
- Model B: per-Sim overlay from `st.bld`, enemies only; flow fields and `Terrain` untouched.
- One nav cell per building; `tg ≤ −10` = building id `−tg − 10`.
- A building under upgrade keeps working at its old level (`up > tick` → level `lv − 1`); a new one is level 0.
- Repair price = `floor(0.5 × paid) − refund(b)`: exactly what the repair adds to the refund; an upgrade
  keeps the hp share. So bank + refunds never grows (property-tested).
- Walls stop a unit at once (no sliding along them) unless a player ordered it to move / drives it.
- `bldPick` rejects by the box around a side's buildings, so admin-given buildings anywhere are targets too.
- Auto-targets: unit → nearer of (visible non-wall building, the high-rise). Seen traps are targets.
- Splash of unit shots does not touch buildings; `aoe` pulses do.

## How to verify
`npx tsc --noEmit; npx tsc --noEmit -p api; npx tsx tools/simtest.ts 3 7; npx tsx tools/cleanscan.ts;
node tools/gen-admcheck.mjs --check; npx vite build; npx tsx tools/symtest.ts asym 45 16;
npx tsx tools/vbtest.ts 5871 20`
