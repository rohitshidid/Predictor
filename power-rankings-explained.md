# How the T20 Power Rankings Are Calculated

*A power ranking answers a different question from the league table. The table asks **"who has earned the most points?"** The power ranking asks **"who is playing the best cricket right now?"** — so a team can sit fourth in the table and still top this list.*

**The founding rule: the maths decides the order, the AI does not.** Every position is computed by fixed formulas from match data. The language model is only allowed to write the sentence explaining a team's position — it never sees, chooses, or influences the rank. That means every ranking is reproducible and every place is answerable with a number.

---

## Part 1 — In plain English

Think of it as a **school report card**. Instead of one exam, each team is graded on nine subjects. Every subject is marked out of 100, some subjects count more than others, and the marks are added into one final score. Sort by that score, and you have the rankings.

Here is what we grade, and why each one matters:

| # | What we measure | What it tells you | Counts for |
|---|---|---|---|
| 1 | **Win %** | How often they win. The foundation. | **25%** |
| 2 | **Rolling Net Run Rate** | Whether they out-score opponents — over the **last 5 games only**, so an early-season thrashing doesn't flatter them all year. | **15%** |
| 3 | **Momentum (form)** | Are they hot right now? The most recent match matters most. | **15%** |
| 4 | **Win quality** | *How* they win. Crushing a side by 60 runs counts more than sneaking home off the last ball. | **10%** |
| 5 | **Powerplay** | Command of the first 6 overs — runs they score there minus runs they concede. | **10%** |
| 6 | **Death overs** | Overs 16–20, where T20 matches are won and lost: their hitting versus their bowling. | **10%** |
| 7 | **Strength of schedule** | Beating strong teams counts for more than beating weak ones. | **5%** |
| 8 | **Home / away** | Teams that only win at home are flattered; travelling well counts. | **5%** |
| 9 | **Key players** | A side missing its stars is not the same side, even if last week's results say otherwise. | **5%** |

**Why "momentum" isn't just the last five results.** Recent games are weighted far more heavily than old ones, and the weighting fades smoothly rather than cutting off. In practice the last match alone carries about 35% of this grade, and the last five matches together carry roughly 88%.

**Why "win quality" exists.** Two teams can both be 6–4. If one wins by big margins and the other survives thrillers, they are not equally good — and this is where that shows up.

**The score, and the arrows.** Adding the nine graded subjects gives a score out of 100 — in practice teams land between about **25 and 70**. Nobody scores 100, because that would mean leading every category at once. The **▲/▼ arrows** show movement against the previously published ranking: ▲2 means the team climbed two places.

**Nothing here is a matter of opinion.** Most published power rankings are a writer's judgement call. This one is arithmetic: run the same matches through it twice and you get the same table, every time.

---

## Part 2 — The technical method

**Pipeline.** `data → collect() → nine metrics → normalise to [0,1] → weighted sum × 100 → sort`. All weights and bounds live in `weights.config.json`, never in code. Implementation: `src/engine.js`.

**Notation.** For team *t*: `W/P` = wins/played; `RF, OF` = runs scored and overs faced; `RA, OA` = runs and overs conceded. Every metric is derived from raw per-innings data — nothing is hand-entered.

### The nine components

**1. Win percentage** — `winPct = W / P`

**2. Rolling NRR** *(last 5 matches, window in config)*
```
rNRR = (Σ RF / Σ OF) − (Σ RA / Σ OA)
```
Also reported: `NRR trend = rolling − season`, positive meaning a team is improving.

**3. Momentum** — exponentially weighted, Bayesian-style update, seeded at 0.5:
```
mₜ = α·(win ? 1 : 0) + (1 − α)·mₜ₋₁ ,  α = 0.35
```
Match weights decay 0.350, 0.228, 0.148, 0.096, 0.063… — a **half-life of ≈1.6 matches**.

**4. Win quality** *(mean over wins only, each clamped to 0–100)*
```
batting first : (own − opp) / own × 100
chasing       : (120 − balls used) / 120 × 100
```

**5. Powerplay dominance** *(overs 1–6; 6 overs per innings per match)*
```
PP = (ppRunsFor / 6P) − (ppRunsAgainst / 6P)          [runs per over]
```

**6. Death-overs net** *(overs 16–20)*
```
net = deathBatSR − deathBowlEcon × 16.67
```
The factor `100/6 = 16.67` converts bowling economy (runs/over) onto the batting strike-rate scale (runs/100 balls), so the two sides are dimensionally comparable.

**7. Strength of schedule** — mean current win% of every opponent faced (repeat fixtures counted each time).

**8. Home/away** — `0.6·awayWin% + 0.4·homeWin%`, deliberately over-weighting away form.

**9. Key-player availability** — `starsAvailable / squadStars`, taken **as of the most recent match**.

### Normalisation and the final score

Each raw metric is mapped onto [0,1] by `norm(x) = clamp((x − min)/(max − min))`. Ratios (1, 3, 7, 8, 9) are already 0–1; the rest use configured bounds: **rNRR ±2.00**, **powerplay ±3.00 rpo**, **death net ±60**, win quality ÷100. Then:

```
score = 100 × Σ ( wₖ · nₖ )
```
with weights `0.25, 0.15, 0.15, 0.10, 0.10, 0.10, 0.05, 0.05, 0.05` (summing to exactly 1.00). **Ties** break on win% then rolling NRR. **Delta** = previous rank − current rank.

### Optional metrics (off by default)

Five further measures can be switched on per session: **Expected wins** (Pythagorean, `RF²/(RF²+RA²)`), **toss independence** (win% when *losing* the toss), **chase/set versatility**, **top-4 consistency** (mean and stability of top-order runs), and **bowling spread** (inverse share of wickets taken by the top two bowlers). Enabling them pushes total weight above 1.0, so scores scale upward while the ordering stays valid.

### Known limitations — stated deliberately

- **NRR convention.** Official ICC rules charge a side bowled out with its **full quota** of overs; this engine divides by overs actually faced, which slightly flatters teams dismissed early. A documented deviation, not an oversight.
- **Win quality is asymmetric.** The batting-first and chasing scales are not calibrated to each other, so chasing wins tend to score a little lower.
- **Pythagorean exponent = 2** — Bill James's original form, not a value fitted to T20. Because cricket sides post similar totals, expected wins occupies a narrow band (≈0.45–0.58) and separates teams weakly.
- **T20-shaped.** 120 balls and a 6-over powerplay are assumed; rain-shortened games and other formats are not modelled.
- **Key players** are currently a supplied number, not a live ICC top-30 feed.

---

*Rankings are computed by `src/engine.js`; weights are tunable in `weights.config.json` without code changes. Every generated blurb is fact-checked against these numbers before publication and logged with its sources for editorial review.*
