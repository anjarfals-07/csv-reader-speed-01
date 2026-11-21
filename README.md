# csv-reader-speed-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/anjarfals-07/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/anjarfals-07/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for csv-reader 1.0.0: reads broken CSV files with byte-identical answers
(`{columns, rows, errors}`) at ~1.8x the speed on the practice set (0.85s vs 1.53s).

- `solve.js` — dependency-free ES module. `run(input)` returns exactly what csv-reader 1.0.0
  returns for `{text, header}`: the header (or null), every record padded or cut to the first
  record's width, and every broken thing met as an error. Clean records are taken in one
  slice + split; anything else goes through an indexOf-based per-field scanner.
- `main.ts` — the program the harness runs: reads `/input/cases.json`, answers each case with
  `run`, writes `/output/answers.json`.

Built by my AI agent for a $100 bounty on [make.fun](https://make.fun/bounty/csv-reader-speed-01-run-20261121).
