# Step 9 — Real Outcome Accumulation

Status: infrastructure ready; real shadow outcome accumulation starts only when runtime shadow records can be joined to production decisions and outcomes.

## AffareRadar

Available real sources already present in production code:
- decision ledger / recent decisions;
- outcome registry / recent outcomes;
- clicks, conversions, revenue, publishes and related metrics.

Current limitation:
- the Verified Shadow adapter is still observation-only on the draft branch and is not connected to the production decision stream;
- therefore no real shadow decision can yet be truthfully joined to those production outcomes.

The read-only joiner added in this step is ready for that connection.

## QuotAI

The draft shadow branch now has a read-only real outcome joiner capable of carrying:
- CLV;
- Captured EV;
- settlement;
- P/L;
- final odds;
- explicit quality outcome.

Current limitation:
- no runtime outcome feed or persistent decision/outcome ledger is observable in the repository/runtime surface inspected.

## Outcome quality rule

Raw economic/result metrics do not automatically become GOOD or BAD labels.

Examples:
- a winning bet is not automatically a correct model decision;
- a conversion is not automatically proof that blocking an offer would have been a false block.

SAFETY_CATCH and FALSE_BLOCK require an explicit validated quality outcome or a later statistical rule approved in Step 10.

## Initial measured state

Until real shadow records are connected:
- known real shadow outcomes: 0 observable;
- known real would-block outcomes: 0 observable;
- SAFETY_CATCH: 0 observable;
- FALSE_BLOCK: 0 observable;
- RISK_RELAXATION: 0 observable;
- promotion readiness: NOT READY / insufficient evidence.

No production change is made by this step.
