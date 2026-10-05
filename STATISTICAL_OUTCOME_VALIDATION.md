# Step 10 — Statistical Outcome Validation

This layer turns raw outcomes into validated quality labels only when the evidence is strong enough.

## AffareRadar single-outcome rule

A click, conversion or revenue event alone never becomes GOOD.

A statistical GOOD/BAD label requires either:

1. trusted explicit ground truth (human_verified, audited, ground_truth, manual_review), or
2. agreement across at least two signal families with medium/high evidence.

Signal families:
- behavior: Deal Performance Score;
- calibration: Continuous Edge Validation;
- validity: false deal, retraction, invalidation, price/coupon persistence.

Critical validity failures may directly validate BAD because they represent direct falsification of the offer.

## Confidence interval rule

The Promotion Readiness Gate currently uses:
- at least 50 known outcomes;
- at least 20 known would-block outcomes;
- observed false-block rate <= 5%.

Step 10 adds an important distinction:

**observed rate <= 5% is not the same as statistically demonstrating that the true rate is <= 5%.**

The statistical layer therefore calculates a Wilson 95% interval. For statistical support of the 5% bound, its upper bound must also be <= 5%.

Example: 1 false block out of 20 = 5% observed, but the 95% upper bound is much higher than 5%, so the result is STATISTICALLY_INCONCLUSIVE.

This layer is advisory only and can never auto-promote.
