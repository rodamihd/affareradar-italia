# AgentOS Shadow Outcome Registry v1

Observation-only registry used to evaluate Verified Shadow Validation evidence across verticals.

It performs no Redis writes, publishing, betting, switching, deployment or production mutation.

## Outcome labels

- GOOD: the observed outcome supports the baseline action as safe/valid.
- BAD: the observed outcome shows the baseline action was unsafe/invalid or materially undesirable.
- NEUTRAL: known outcome without a directional safety judgement.
- UNKNOWN: outcome not yet known.

## Event definitions

- SAFETY_CATCH: baseline would allow, shadow would BLOCK, and the known outcome is BAD.
- FALSE_BLOCK: baseline would allow, shadow would BLOCK, and the known outcome is GOOD.
- RISK_RELAXATION: shadow is less restrictive than baseline. This is a promotion blocker regardless of outcome.
- Divergence: any difference between baseline and shadow decisions.

REVIEW divergences are counted as divergences but are not called FALSE_BLOCK or SAFETY_CATCH because REVIEW is not equivalent to an enforced block.

## False-block rate

false_block_rate = FALSE_BLOCK / known shadow would-block outcomes

If there are no known would-block outcomes, the rate is null rather than zero.

## Initial promotion blockers

- any RISK_RELAXATION;
- any FALSE_BLOCK pending review;
- zero known outcomes.

Numerical minimum evidence thresholds are intentionally left to the Promotion Readiness Gate step.
