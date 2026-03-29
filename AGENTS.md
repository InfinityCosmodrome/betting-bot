# AGENTS

## Betting Cross-Check Policy

When generating betting suggestions from `betting-data.js`, use this cross-check order before recommending final picks:

1. `API-FOOTBALL`
   Primary source for fixtures, predictions, standings, team statistics, h2h, and odds.

2. `Sofascore`
   Use for recent form, standings, match info, team performance context, and extra sanity-checking.

3. `Soccerway`
   Use for fixtures, standings, recent results, and head-to-head verification.

4. `The Analyst`
   Use only as an additional context layer when there is relevant preview or data-led analysis for the same match, team, or competition.

5. `Sports AI`
   Use only as a lightweight consensus or extra-signal check, never as the primary basis for a pick.

6. `Statschecker`
   Use only when accessible and clearly relevant. Do not rely on it if coverage is incomplete or the site is not loading correctly.

## Pick Rules

- Prefer `Over/Under` markets first when the available data supports a totals angle.
- Use `1X`, `X2`, `1`, or `2` as fallback when totals data is weak, unclear, or unsupported.
- Do not recommend postponed fixtures.
- Prefer markets like `1X` or `X2` when data quality is weak.
- Prefer stronger markets like `1`, `2`, `Over 2.5`, or `GG` only when supported by multiple signals.
- If cross-check sources disagree materially, mention that disagreement and lower confidence.
- If only API prediction exists and the supporting sites do not add useful context, say that the pick is based on limited supporting data.

## Output Style

- Recommend up to 2 picks by default.
- Mention which sources were used for cross-checking.
- Call out when data quality is low.
