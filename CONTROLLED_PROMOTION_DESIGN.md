# Step 13 — Controlled Promotion Design

This step designs the path only. It does not activate it.

## State machine

CONTRACT_ONLY
- SceltaSemplice only.
- Cannot progress to advisory or enforcement.

SHADOW
- observation only;
- no production decision changes.

ADVISORY
- may surface the shadow recommendation and its reasons to a human/operator;
- cannot change the production decision;
- cannot send, publish, wager, switch, mutate, or suppress automatically.

GATED_ENFORCEMENT
- future Step 14 state only;
- must be reached from ADVISORY, never directly from SHADOW;
- must use an explicit allowlist;
- canary scope must be <= 5%;
- immediate rollback design must exist;
- at least 100 advisory known outcomes are required;
- statistical support must remain FALSE_BLOCK_BOUND_SUPPORTED;
- cross-vertical consistency must remain CONSISTENT;
- no incidents or regressions.

## Manual control

Every forward transition requires:
- composite Step 12 review = READY_FOR_HUMAN_REVIEW;
- explicit human approval;
- named approver;
- change ticket.

No automatic transition exists.

## Rollback

Any of the following designs an immediate rollback to SHADOW:
- RISK_RELAXATION;
- statistical support lost;
- cross-vertical inconsistency;
- CI not green;
- evidence no longer verified;
- incident;
- regression.

Step 13 never executes rollback automatically. It only declares that rollback would be required.

## Vertical effects

### AffareRadar advisory
Allowed:
- surface shadow decision;
- surface reasons;
- surface evidence status.

Future gated effects, not active:
- route a candidate to review;
- hold a candidate before publish.

Forbidden in Step 13:
- Telegram send;
- Redis production mutation;
- automatic publish override;
- automatic promotion.

### QuotAI advisory
Allowed:
- surface shadow decision;
- surface edge evidence;
- surface risk reason.

Future gated effects, not active:
- downgrade candidate to WATCH;
- require human confirmation.

Forbidden:
- wager placement;
- stake changes;
- account actions;
- automatic promotion.

### SceltaSemplice
Remains CONTRACT_ONLY.

## Current status

The design can exist even when real data is not yet sufficient. That does not make any vertical eligible for activation.

All Step 13 outputs have:
- execution_permitted=false;
- activation_requested=false;
- effects.active=[];
- automatic_promotion=false.
