# SceltaSemplice CONTRACT_ONLY Profile

This profile applies the AgentOS Verified Evidence Contract and Shadow Outcome semantics to SceltaSemplice without enabling any production runtime or user-impacting action.

## Mode

`mode=contract_only`

## Allowed

- construct verified evidence envelopes;
- validate schema and evidence hash integrity;
- assign stable `decision_id`;
- link a nullable or later-known `outcome_id`;
- classify historical or synthetic comparisons as SAFETY_CATCH, FALSE_BLOCK or RISK_RELAXATION;
- compute known-outcome counts, false-block rate and promotion-readiness metrics;
- replay contract fixtures and validate cross-vertical semantics.

## Forbidden

- tariff switching;
- supplier submission;
- consent execution;
- customer notification;
- account mutation;
- production recommendation enforcement;
- automatic promotion;
- merge or deploy as a consequence of the contract-only result.

## Decision semantics

For contract validation, SceltaSemplice may map its domain decisions to the common restrictiveness ordering:

`PROPOSE < REVIEW < BLOCK`

The contract-only evaluator may keep or tighten a reference decision but must never create a more permissive production decision.

## Promotion

The profile may produce `NOT_READY`, `REVIEW` or `READY_FOR_HUMAN_REVIEW`.

`READY_FOR_HUMAN_REVIEW` is evidence status only. It is not permission to deploy, promote, switch a tariff or act on behalf of a customer.

## Current implementation status

No SceltaSemplice GitHub repository is available in the connected repository set. This file therefore defines the portable contract profile only; it does not claim that a SceltaSemplice runtime or CI implementation exists.
