# SIM-BASE — working notes (player-placed base buildings in the sim)

Branch: this worktree's branch, based on `4b8c2dc`. Contract for other tracks: `docs/v5/BASE.md`.

## Done
- Read the sim map (`map_sim.md`), the sim, guard, proto, tests.
- Baseline before any change (`npx tsx tools/symtest.ts asym 45 16`): Атаги 53 %, first-war median
  6.8 min (4.7–14.3), all wars median 7.7, 18 723 ticks/s, state peak 61.2 KB, 0 exceptions.
  `npx tsx tools/simtest.ts 3 7`: 0 FAIL, 23 350 ticks/s quiet.
- Design written: `docs/v5/BASE.md`.

## In progress
- Core: `src/sim/bdefs.ts`, `src/sim/bld.ts`, hooks in `src/sim/sim.ts`.

## Next (in this order)
1. Core + rogatka, zabor, larek, prorab; command `bld`; canBuild; overlay; unit targeting; cleanup; newWar.
2. sebozol, sperm, tesla, gantel, kamera.
3. Traps.
4. Economy and support.
5. antidron, kuryatnik, bukva_n.
6. Superweapons.
7. Protocol (proto.ts, validCmd, guard), admin ops + `npm run gen:api`.
8. AI builder.
9. Tests (`tools/basetest.ts` called from simtest), vbtest, cleanscan, symtest balance.

## Decisions
- Model B from the map: per-Sim overlay, enemies only, «мешает — ломаем». Flow fields untouched.
- One nav cell per building; `tg ≤ −10` for building targets.
- New code lives in new files; shared files get hooks only.

## How to verify
`npx tsc --noEmit; npx tsc --noEmit -p api; npx tsx tools/simtest.ts 3 7; npx tsx tools/cleanscan.ts;
node tools/gen-admcheck.mjs --check; npx vite build; npx tsx tools/symtest.ts asym 45 16;
npx tsx tools/vbtest.ts 5871 20`
