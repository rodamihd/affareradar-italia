# AgentOS 33.10 Cross-Vertical Shadow Evidence Collector

The collector is a pure observation/reporting component.

It consumes normalized evidence records from QuotAI, AffareRadar and SceltaSemplice and produces:

- total decisions/records;
- promotion-eligible evidence count;
- contract-only evidence count;
- verified/unverified evidence count;
- known and unknown outcomes;
- divergence count;
- SAFETY_CATCH count;
- FALSE_BLOCK count;
- RISK_RELAXATION count;
- known would-block count;
- false-block rate;
- Promotion Readiness status per vertical and in aggregate.

## Promotion evidence policy

Modes counted toward promotion evidence:
- shadow
- live_real
- oos

Modes excluded from promotion evidence:
- contract_only
- backtest
- replay

SceltaSemplice CONTRACT_ONLY is therefore visible in the report but cannot make AgentOS look more promotion-ready.

## Expected normalized record

Each record should contain, when available:

- vertical
- mode
- decision_id
- outcome_id
- baseline_decision
- shadow_decision/backport_decision
- outcome
- evidence_contract
- evidence_hash_version
- evidence_hash

## Evidence integrity

A record is considered verified by the collector only when:

- evidence_contract = agentos.verified_evidence.v1
- evidence_hash_version = 2
- evidence_hash is a 64-character lowercase SHA-256 hex string

This structural check does not replace recomputation of the hash by the producing vertical.

## Safety

The collector has no I/O side effects and cannot publish, wager, switch tariffs, merge, deploy or promote.
