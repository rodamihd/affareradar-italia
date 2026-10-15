# Step 11 — Cross-Vertical Consistency Check

AgentOS uses domain-specific decision vocabularies but one governance meaning.

| Vertical | Permissive | Review | Restrictive | Mode |
|---|---|---|---|---|
| AffareRadar | PUBLISH | REVIEW | BLOCK | shadow |
| QuotAI | PLAY | WATCH | REJECT | shadow |
| SceltaSemplice | PROPOSE | REVIEW | BLOCK | contract_only |

Common semantic invariants:
- shadow may keep or tighten, never relax;
- restrictive divergence + BAD outcome = SAFETY_CATCH;
- restrictive divergence + GOOD outcome = FALSE_BLOCK;
- any relaxation = RISK_RELAXATION;
- Verified Evidence Contract v1 / Hash V2;
- same Promotion Readiness thresholds;
- automatic promotion always false;
- human review always required;
- contract_only evidence is never promotion-eligible.

## Statistical consistency rule

Step 10 introduced a second gate.

A vertical may not be treated as consistently READY when:
- Promotion Readiness says READY_FOR_HUMAN_REVIEW, but
- statistical validation says INSUFFICIENT_SAMPLE, STATISTICALLY_INCONCLUSIVE, or FALSE_BLOCK_RATE_TOO_HIGH.

This is reported as READINESS_STATISTICAL_CONTRADICTION.

The consistency checker is advisory and cannot deploy, merge, enforce or promote.
