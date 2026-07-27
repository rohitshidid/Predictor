# parameters.md — T20 Power Ranking: Additional Parameters

> **Original state (2026-07-23):** 4 metrics, all pure team-level counting stats.
> `Win% (0.45) | NRR (0.25) | Recent Form/last-5 (0.20) | Strength of Schedule (0.10)`
> The goal is to make the math more deterministic, less mystic, and more predictive.
>
> **Current state (2026-07-25):** all 12 parameters below are implemented — 9
> always-on, 5 optional. The weights are no longer hand-set; see
> [How these weights were derived](#how-these-weights-were-derived).

---

## The Problem with the Current 4 Metrics

| Gap | Why it Matters |
|---|---|
| Win% treats all wins equally | Thrashing DC by 80 runs = beating RCB by 1 run |
| NRR is cumulative and slow to react | An outlier blowout game can distort it for weeks |
| Last-5 is binary (W/L) | Doesn't capture HOW the team won or lost |
| SoS is simple average opponent Win% | Doesn't account for whether the opponent was home/away or already eliminated |

---

## Suggested New Parameters (Grouped by Type)

### GROUP 1 — Better Math on What Already Exists (Low Effort, High Value)

These sharpen the existing 4 metrics with more surgical numbers.

#### 1. Margin-Adjusted Win Score
Instead of a binary W/L, each win gets a "quality score" based on how much the team dominated.

| Sub-metric | Formula |
|---|---|
| **Run Margin** (batting first win) | `(runs won by) / target × 100` |
| **Ball Margin** (chasing win) | `(balls remaining) / total_balls × 100` |
| **Combined** | Normalize both to 0–100 and average. A win with 8 wickets and 20 balls left scores ~85. A 1-wicket win with 1 ball left scores ~5. |

> **Why:** This turns Win% from a blunt count into a reflection of how convincingly the team is winning. A team that wins 6/10 by large margins is objectively better than one that sneaks 6/10 by 1 run.

---

#### 2. Rolling NRR (Last N Games) vs. Season NRR
Current NRR is a season-long cumulative — one 200-run blowout in game 1 can flatter a team all season.

| Metric | Formula |
|---|---|
| **Rolling NRR** | Same NRR formula, but only on the last 5 matches (same window as form) |
| **NRR Trend** | `rolling_NRR - season_NRR`. Positive = team is improving. |

> **Why:** This detects teams that are peaking right now vs. teams living off early-season runs. Far more predictive for the upcoming game.

---

### GROUP 2 — Phase-Level Performance (The Most Impactful Addition)

T20 is played in 3 phases: Powerplay (overs 1–6), Middle (7–15), Death (16–20). Most matches are won or lost in Powerplay and Death overs. The current model is completely blind to this.

#### 3. Powerplay Run Rate (Batting & Bowling)

| Metric | Formula |
|---|---|
| **PP Batting RR** | `runs scored in overs 1–6 / 6` across all matches |
| **PP Bowling RR** | `runs conceded in overs 1–6 / 6` across all matches |
| **PP Dominance Score** | `PP Batting RR - PP Bowling RR`. Higher = team dominates the powerplay. |

#### 4. Death Overs Economy (Overs 16–20)

| Metric | Formula |
|---|---|
| **Death Batting Strike Rate** | `runs in overs 16–20 / balls × 100` |
| **Death Bowling Economy** | `runs conceded in overs 16–20 / overs` |
| **Death Net Score** | `Death Batting SR - (Death Bowling Economy × scaling_factor)` |

> **Why:** In T20, ~40% of runs are scored in overs 16–20. A team that concedes 60 runs in the death overs will lose most matches regardless of their Win%. This is the single biggest gap in the current model.

---

### GROUP 3 — Player-Level Signals Rolled into a Team Score

The current model is purely team-level. Player availability and form is one of the biggest real-world predictors.

#### 5. Key Player Availability Index

| Sub-metric | Description |
|---|---|
| **Star Player Count** | # of players in the playing XI ranked in the top 30 ICC T20 rankings (batters + bowlers) |
| **Availability Score** | `(available_star_players / squad_star_players) × 100`. An injury to a key player drops this. |

> **Why:** A team with 3 injured star players is not the same team as last week, but Win% and NRR don't know that. This is currently a massive blind spot. Can be sourced from CricAPI playing-XI data + ICC rankings.

#### 6. Top-4 Batting Consistency

| Metric | Formula |
|---|---|
| **Average Score of Top-4 batters** | `sum of top-4 individual scores / 4` across last 5 matches |
| **Consistency Score** | Standard deviation of that average — low std dev = reliable. |

> **Why:** A team whose top 4 collectively average 120/5 every game is more predictable (and thus more rankable) than one that goes 180/3 one game, 60 all out the next.

#### 7. Bowling Concentration Risk

| Metric | Formula |
|---|---|
| **Wicket Gini** | What % of team wickets come from the top 2 bowlers? High % = fragile bowling attack. |
| Example | If Bumrah + Pandya take 75% of MI wickets, if either is injured/rested the bowling collapses. |

---

### GROUP 4 — Contextual / Situational Factors

#### 8. Home vs. Away Win% (Split)

| Metric | Formula |
|---|---|
| **Home Win%** | `wins at home / home matches` |
| **Away Win%** | `wins away / away matches` |
| **Home Advantage Score** | `Home Win% - Away Win%`. Teams that only win at home are risky on the road. |

> **Why:** For the upcoming fixture, where the next game is played matters enormously. SoS already partially captures opponent strength but ignores venue effects.

#### 9. Toss Win → Match Win Conversion

| Metric | Formula |
|---|---|
| **Toss Leverage** | `% of matches won when toss won` vs `% of matches won when toss lost` |
| **Toss Dependency Score** | High dependency = the team's fate is too tied to a coin flip (a risk signal, not a strength). |

> **Why:** A team that only wins when they win the toss is predictable and vulnerable. This also informs whether to weight chasing vs. setting as a risk factor.

#### 10. Chase vs. Set Win Rates

| Metric | Formula |
|---|---|
| **Chase Win%** | `wins when chasing / matches chased` |
| **Setting Win%** | `wins when batting first / matches setting` |

> **Why:** Combined with toss data, this tells you if a team is a good chaser or needs to bat first — critical for prediction since pitch reports and toss outcomes can be fed as context.

---

### GROUP 5 — Advanced Math (Implement Later, Very High Signal)

#### 11. Expected Wins (xW) — Pythagorean Expectation for T20
Based on baseball's Pythagorean win formula, adapted for T20:

```
xW = runs_scored² / (runs_scored² + runs_conceded²)
```

| Metric | Meaning |
|---|---|
| **xW > Actual Win%** | Team is underperforming — likely to regress upward (buy signal) |
| **xW < Actual Win%** | Team is overperforming via luck — likely to regress downward |

> **Why:** This is the single most powerful "is this team's record for real?" indicator. Teams with Win% far above their xW are usually on a lucky streak; they will regress. This is a direct prediction of future performance, not past results.

#### 12. Momentum Score (Bayesian)
Rather than a simple last-5 weighted average, use a Bayesian update model:

```
momentum_t = α × latest_result + (1 - α) × momentum_t-1
```

Where `α` (0–1) controls how fast momentum decays. A configurable `alpha` in `weights.config.json`.

> **Why:** This produces a continuous, smooth momentum signal rather than a hard 5-game window cutoff. A team that just won 3 straight is meaningfully different from one that won games 1, 3, and 5 of the last 5.

---

## How these weights were derived

_Added 2026-07-25. Supersedes the suggested block below, which was a hand-set starting point._

The weights are now **fitted**, not chosen by feel.

### Method

A power ranking's job is to estimate how good each team actually is, so the fit targets exactly that:

1. Generate **300 independently seeded synthetic seasons**. Each season re-draws every team's latent `strength` — the number the generator uses to produce its results — so `strength` is ground truth the engine never sees.
2. For each team in each season, compute the **normalized metric vector exactly as `engine.js` does**, giving 2,100 team-season observations across 14 metrics.
3. Solve for the weights maximizing `corr(Σ wₖ·nₖ , strength)` subject to `w ≥ 0` and `Σw = 1` — projected-gradient ascent on the correlation, with a ridge term for the near-singular directions. Rank order is invariant to affine transforms, so correlation is the right objective for a ranking.
4. Fit on 66% of seasons, score on the held-out 34%.

### What the data said

| Metric | corr. with true strength | spread across teams | verdict |
|---|---|---|---|
| **deathOversNet** | **+0.87** | 0.115 | strongest single correlate — as `parameters.md` predicted |
| **powerplayDominance** | **+0.80** | 0.101 | second strongest |
| homeAwayAdjustment | +0.68 | 0.198 | good, but 0.99 correlated with Win% |
| winPct | +0.68 | 0.196 | strong, but noisy over ~12 games |
| chaseSet | +0.65 | 0.207 | 0.95 correlated with Win% — adds nothing new |
| expectedWins (xW) | +0.68 | 0.021 | 0.91 correlated with Win% — adds nothing new |
| form | +0.53 | 0.263 | 0.76 correlated with Win%, 0.81 with rolling NRR |
| rollingNRR | +0.49 | 0.174 | overlaps form heavily |
| top4Consistency | +0.62 | 0.044 | the only optional metric with measurable marginal value |
| keyPlayerAvailability | +0.08 | 0.099 | invisible in synthetic data — kept on domain grounds |
| **marginAdjustedWin** | **+0.01** | 0.032 | **no signal as currently computed** |
| bowlingConcentration | −0.02 | 0.038 | no signal |
| **sos** | **−1.00** | 0.033 | **sign is inverted in a round robin** |

### Two findings worth acting on

**`marginAdjustedWin` carries no signal as implemented.** It averages only over matches *won*, and for a chase it reads `(120 − balls)/120`, so a side that cruises home and one that scrapes home score alike. It held 0.10 of the ranking — a tenth of the table spent on noise. Cut to 0.03 pending a rework of the metric itself; re-weight after, not before.

**`sos` is inverted in a complete round robin.** Every team plays every other, so a team's opponents' average Win% is close to the mirror of its own — measured at r = −1.00 against strength. The engine adds it *positively*, so as implemented it **penalises the best teams**. Cut to a 0.03 floor. It only carries real information on an unbalanced schedule (internationals, or mid-season before the fixtures even out). Before raising it, either invert the sign or restrict it to unbalanced schedules.

### Result

| Weights | Held-out Spearman | Correct #1 | Top-3 contains true best |
|---|---|---|---|
| Previous hand-set | 0.694 | 46.1% | 85.3% |
| **Current (fitted)** | **0.760** | **50.0%** | **90.2%** |
| Unconstrained best fit | 0.892 | 76.5% | 99.0% |

The unconstrained fit is *not* shipped: it puts ~75% of the ranking on the two phase metrics and drops Win% to 0.05. That wins on this simulator but would produce a table where a team can win every match and not rank first — unpublishable, and over-fitted to a generator that derives phase splits directly from `strength`.

### Caveat, stated plainly

The only ground truth available today is the synthetic generator. It maps `strength` onto phase shares by a clean linear law (`deathShare = 0.34 + (strength − 0.5)·0.08 ± 0.025`), so phase metrics read almost straight off team quality. Real teams have phase *styles* that do not reduce to one number, so these weights likely over-credit phase play. **Re-fit against real results once a season of live CricAPI data has accumulated** — the method above transfers unchanged, only the target changes from `strength` to actual match outcomes.

---

## Suggested Updated weights.config.json Structure

```json
{
  "_comment": "Ranking weighting lives here, NOT in code. Tune without touching the engine. Weights should sum to 1.0.",
  "weights": {
    "winPct": 0.25,
    "marginAdjustedWin": 0.10,
    "rollingNRR": 0.15,
    "form": 0.15,
    "powerplayDominance": 0.10,
    "deathOversNet": 0.10,
    "sos": 0.05,
    "homeAwayAdjustment": 0.05,
    "keyPlayerAvailability": 0.05
  },
  "form": {
    "window": 5,
    "decay": 0.8,
    "alpha": 0.35
  },
  "nrr": {
    "rollingWindow": 5,
    "seasonMin": -2.0,
    "seasonMax": 2.0
  },
  "powerplay": {
    "overs": [1, 6]
  },
  "deathOvers": {
    "overs": [16, 20]
  },
  "scoreScale": 100
}
```

---

## Priority Order (What to Add First)

| Priority | Parameter | Reason |
|---|---|---|
| 🔴 **P1** | Rolling NRR (last 5) + NRR Trend | Fixes the biggest flaw in current NRR — immediate improvement, same data |
| 🔴 **P1** | Margin-Adjusted Win Score | Stops treating a 1-run win the same as an 80-run thrashing |
| 🟠 **P2** | Death Overs Economy / Strike Rate | Highest predictive signal in T20; easy to compute from scorecard data |
| 🟠 **P2** | Powerplay Dominance Score | Same source data as death overs — build both at once |
| 🟡 **P3** | Home/Away Split Win% | Simple filter on match data; highly relevant for upcoming-match prediction |
| 🟡 **P3** | Chase vs. Set Win Rates | Directly usable as a pre-game signal |
| 🔵 **P4** | Expected Wins (xW) | Most powerful advanced signal; needs clean runs-scored/conceded data |
| 🔵 **P4** | Key Player Availability | Highest real-world value but needs CricAPI playing XI endpoint integration |
| ⚫ **P5** | Bowling Concentration Risk | Advanced; useful for risk scoring but needs wicket-level scorecard data |
| ⚫ **P5** | Bayesian Momentum | Nice-to-have refinement of form; tune alpha empirically |
