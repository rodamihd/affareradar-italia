# Step 14 — Canary / Limited Enforcement

Step 14 introduces a canary controller, but activation remains governed by real evidence.

## Activation requirements

The canary can become CANARY_ELIGIBLE only when all are true:
- current stage is ADVISORY;
- Step 12 composite review is READY_FOR_HUMAN_REVIEW;
- Step 13 design is DESIGN_ELIGIBLE for GATED_ENFORCEMENT;
- evidence source is explicitly real;
- at least 100 real advisory outcomes exist;
- statistical status is FALSE_BLOCK_BOUND_SUPPORTED;
- cross-vertical consistency is CONSISTENT;
- CI is GREEN;
- evidence is verified;
- risk relaxations = 0;
- no incidents;
- no regressions;
- explicit human approval and change ticket exist;
- canary traffic is >0 and <=5%;
- scope allowlist exists;
- rollback plan exists.

Synthetic, replay, backtest and contract-only evidence cannot activate the canary.

## Limited effects

AffareRadar:
- only PUBLISH -> REVIEW within canary;
- never auto-BLOCK;
- no Telegram send behavior is added here;
- no Redis production mutation is added here.

QuotAI:
- only PLAY -> WATCH within canary;
- never places wagers;
- never changes stake;
- never touches bookmaker accounts.

SceltaSemplice:
- never eligible.

## Deterministic sample

The canary sample is selected deterministically from decision_id using SHA-256 and the configured percentage. This prevents random drift between repeated evaluations.

## Rollback

Loss of statistical support, inconsistency, incident, regression, CI failure, evidence failure or risk relaxation makes rollback to SHADOW required.

Rollback remains human-controlled in this step.

## Current real status

Until 100 real advisory outcomes and statistical support exist, the correct activation state is CANARY_BLOCKED.

No production integration or deployment is performed merely by adding this controller.
