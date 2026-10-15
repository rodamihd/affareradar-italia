# Step 8 — Evidence Ingestion + Validation Dashboard

This step adds an observation-only ingestion and dashboard layer.

## Ingestion

Records are accepted only when they include:
- vertical
- valid mode
- decision_id
- baseline decision
- shadow/backport decision
- agentos.verified_evidence.v1
- evidence hash version 2
- 64-character lowercase SHA-256 evidence hash

Exact duplicates are ignored. Conflicting duplicates are rejected.

## Dashboard

The dashboard reports, per vertical and in aggregate:
- accepted/rejected/duplicate records
- promotion-eligible vs contract-only records
- known outcomes and target progress
- known would-block outcomes and target progress
- safety catches
- false blocks
- false-block rate vs limit
- risk relaxations
- divergences
- verified/unverified evidence counts
- promotion-readiness status and blockers

## Safety

This implementation is a pure function layer. It has no Redis, Telegram, bookmaker, supplier, customer-account, deployment or promotion side effects.

It does not claim that enough real outcomes exist. It only reports records actually supplied to it.
