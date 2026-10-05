# Step 12 — Promotion Readiness Review

Step 12 is the composite review gate above the earlier numeric Promotion Readiness Gate.

For a promotion-eligible vertical to become **READY_FOR_HUMAN_REVIEW**, all of these must pass simultaneously:

1. numeric Promotion Readiness = READY_FOR_HUMAN_REVIEW;
2. statistical validation = FALSE_BLOCK_BOUND_SUPPORTED;
3. Cross-Vertical Consistency = CONSISTENT;
4. CI = GREEN;
5. verified evidence = true;
6. RISK_RELAXATION count = 0;
7. automatic promotion remains disabled;
8. human review remains required.

If the numeric gate is ready but the statistical layer is still STATISTICALLY_INCONCLUSIVE, the composite result is only REVIEW.

A hard failure such as CI_NOT_GREEN, EVIDENCE_NOT_VERIFIED, RISK_RELAXATION_PRESENT, CROSS_VERTICAL_INCONSISTENT, or FALSE_BLOCK_RATE_TOO_HIGH produces NOT_READY.

## SceltaSemplice

SceltaSemplice remains mode=contract_only and therefore returns:

CONTRACT_ONLY_EVIDENCE

It can exercise contracts and semantics but is never a promotion candidate.

## Important

READY_FOR_HUMAN_REVIEW is still not permission to merge, deploy, enforce, publish, place a wager, switch a tariff, or promote automatically.
