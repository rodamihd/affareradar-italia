# AgentOS 33.10 Promotion Readiness Metrics

This gate evaluates whether shadow evidence is sufficient to reconsider promotion.

It never promotes automatically. The strongest positive state is `READY_FOR_HUMAN_REVIEW`.

## Default thresholds

- CI must be green.
- Evidence integrity must be verified.
- Known outcomes: at least 50.
- Known would-block outcomes: at least 20.
- False-block rate: at most 5%.
- Risk relaxations: 0 tolerated.

## States

- `NOT_READY`: one or more hard blockers exist.
- `REVIEW`: no hard blocker, but evidence volume is still insufficient.
- `READY_FOR_HUMAN_REVIEW`: all default thresholds are met.

## Hard blockers

- CI regression.
- Evidence integrity failure.
- Any risk relaxation.
- False-block rate above threshold.

## Important

`SAFETY_CATCH` events are evidence that the stricter shadow path may add safety value; they are not themselves promotion blockers. They still require outcome validation and do not offset false blocks or risk relaxations.

The gate is observation-only and cannot merge, deploy, promote, publish or change production behavior.
