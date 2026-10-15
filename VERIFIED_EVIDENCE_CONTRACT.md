# AgentOS Verified Evidence Contract v1

This contract defines the portable evidence envelope shared by AgentOS verticals.

## Purpose

The envelope makes evidence independently auditable without forcing every vertical to use the same decision payload.

The vertical-specific payload remains under `evidence`; the envelope fields below are common.

## Required envelope

- `evidence_contract`: `agentos.verified_evidence.v1`
- `evidence_hash_version`: `2`
- `evidence_hash_algorithm`: `sha256`
- `evidence_canonicalization`: `agentos-json-c14n-v1`
- `evidence_hash`: SHA-256 of the canonicalized evidence payload
- `vertical`: producer vertical, for example `affareradar`, `quotai`, `sceltasemplice`
- `decision_id`: stable identifier for the decision/evaluation
- `outcome_id`: nullable until a known outcome is linked
- `source`: producer identity
- `mode`: one of `shadow`, `contract_only`, `live_real`, `oos`, `backtest`, `replay`

## Canonicalization rules

`agentos-json-c14n-v1`:

1. object keys are sorted recursively;
2. array order is preserved;
3. valid scalar values are null, boolean, string and finite number;
4. Unicode strings are preserved as JSON strings;
5. undefined, functions, symbols, BigInt, NaN and infinities are rejected;
6. circular references are rejected;
7. non-plain objects are rejected and must be normalized by the caller;
8. no unsupported value may be silently omitted or converted.

## Compatibility

This contract is observation-only. Adopting it does not change a production decision, publish action, switch action, wager action or autonomy level.

Existing evidence produced before Evidence Hash V2 should be treated as legacy/unverified for hash-integrity comparisons.

## Vertical profiles

- AffareRadar: `mode=shadow`
- QuotAI Verified Shadow Validation: `mode=shadow`
- SceltaSemplice CONTRACT_ONLY: `mode=contract_only`

The same contract may later be used for live or replay evidence, but promotion is governed separately.
