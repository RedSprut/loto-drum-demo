# Drum game-rule audit — canonical 9 games

The 3D drum's playable games are the **exact same 9 games the main app offers**
(`results.json` game IDs / `index.html` `LOTTERY_CONFIG`). The drum derives its
profiles from `demo-drum/src/registry.js`, and `scripts/audit-drum-games.mjs`
fails the build if the drum's game IDs or core rules diverge from the main app.

Rules below were verified against official operators (checked **2026-08-01**).
"Physical balls" = balls actually loaded into the drum; separate-pool games load
the main pool first, then reload the bonus pool for the bonus draw.

| Game ID | Display | Main pool | Bonus pool | Strategy | Physical balls (main→bonus) | Drawn (main+bonus) | Source (verified 2026-08-01) |
|---|---|---|---|---|---|---|---|
| lotto | Norsk Lotto | 1–34, pick 7 | 1–34, draw 1 (tilleggstall) | same pool | 34 | 7+1 = 8 | https://www.norsk-tipping.no/lotteri/lotto |
| vikinglotto | Vikinglotto | 1–48, pick 6 | 1–5, draw 1 (Viking) | separate | 48 → 5 | 6+1 = 7 | https://en.wikipedia.org/wiki/Vikinglotto |
| eurojackpot | Eurojackpot | 1–50, pick 5 | 1–12, draw 2 (Euro) | separate | 50 → 12 | 5+2 = 7 | https://www.eurojackpot.org/en/rules-eurojackpot/ |
| powerball | Powerball (US) | 1–69, pick 5 | 1–26, draw 1 | separate | 69 → 26 | 5+1 = 6 | https://www.powerball.com/ |
| megaMillions | Mega Millions | 1–70, pick 5 | 1–24, draw 1 | separate | 70 → 24 | 5+1 = 6 | https://louisianalottery.com/2025-mega-millions/ (Apr 2025: Mega Ball 1–24) |
| euroMillions | EuroMillions | 1–50, pick 5 | 1–12, draw 2 (Stars) | separate | 50 → 12 | 5+2 = 7 | https://www.euro-millions.com/rules |
| superEnalotto | SuperEnalotto | 1–90, pick 6 | 1–90, draw 1 (Jolly) | same pool | 90 | 6+1 = 7 | https://www.superenalotto.com/en/how-to-play |
| lottoMax | Lotto Max | 1–52, pick 7 | 1–52, draw 1 (Bonus) | same pool | 52 | 7+1 = 8 | https://ca.lottonumbers.com/lotto-max , https://www.alc.ca/content/alc/en/our-games/lotto/lotto-max.html (pool raised to 52, Apr 2026) |
| powerballAustralia | Powerball Australia | 1–35, pick 7 | 1–20, draw 1 (Powerball) | separate | 35 → 20 | 7+1 = 8 | https://www.thelott.com/powerball/how-to-play |

**Hidden / inactive** (present in `INACTIVE_PROFILES`, NOT in the public selector,
because it is not in the main app's current 9-game set):

| Game ID | Display | Reason |
|---|---|---|
| italianLotto | Lotto Italia (5/90) | Not in the main app's 9 games — kept as inactive code only. |

Strategy = "same pool": the additional ball is the next ball out of the SAME drum
(no second physical set); one physical ball object travels inside-drum → in-transit
→ in-rack. "separate": the main balls are cleared and the bonus pool is loaded for
its own draw.
