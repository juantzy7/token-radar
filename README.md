# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/juantzy7/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/juantzy7/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar over the bounty's sealed DefiLlama snapshot (758 protocols, as of 14 Nov 2026). It screens for the 198 protocols that record no token yet and are not a wrapped, staked, bridged or versioned product of one that trades, covers all 40 watchlist protocols, and ranks the board by implied launch value. The value model is derived entirely from the snapshot's own figures: each category's multiple is the median market-cap-to-TVL of its token-bearing peers in the same snapshot, with extreme ratios pulled back to the 95th percentile and thin categories shrunk toward the global median, then tilted by seven-day TVL growth and by how long the protocol has run with no token. Every row carries a six-step farm plan written for its category, with working-capital bands, costs and time. The dashboard is a static page (board, per-protocol detail, filters) that renders fully offline.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=nbsxfq53&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
