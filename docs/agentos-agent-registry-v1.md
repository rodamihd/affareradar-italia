# AgentOS 33.10 — Agent Registry v1.0 (SHADOW)

Status: DRAFT / SOURCE_PARTIAL / NOT_RUNTIME_VERIFIED
Snapshot: 2026-10-12
Scope: `rodamihd/affareradar-italia` main; limited cross-repo inspection of `rodamihd/QuotAI`, `rodamihd/arbitrageos`, `rodamihd/GitHub`.
No production changes, automated activation, or agent promotion are authorized.

## Counting rules

An **agent** is a separately addressable execution identity with defined goal, trigger, autonomous/approved action boundary, and evidence of a runnable implementation or runtime registration. A **sub-agent** must additionally identify its parent agent/orchestrator. Distinct task types, functions, scheduled jobs, gateway capabilities, skills and product names are **not** counted as agents without this evidence.

Evidence state is one of: PLANNED, SOURCE_VERIFIED, TESTED_LOCALLY, DEPLOYED, RUNTIME_VERIFIED, NOT_VERIFIABLE. Operational mode (SHADOW, SUPERVISED, AUTONOMOUS) is a separate property; never infer deployment from source presence.

## Verified inventory, bounded scope

| Item | Kind | Source evidence | Agent counted? | Verification |
| --- | --- | --- | --- | --- |
| AgentOS AffareRadar task registry | Task catalog (11 types) | `lib/agentos-control-plane.js` / `TASK_TYPES` | No | SOURCE_VERIFIED |
| AgentOS external domain gateway | Control-plane capabilities (7 operations) | `lib/agentos-external-runtime.js` | No | SOURCE_VERIFIED |
| AgentOS 33.10 policy/profile | Configuration and gate logic | `lib/agentos-33_10-profile.js` | No | SOURCE_VERIFIED |
| AgentOS task graph | Workflow logic | `lib/agentos-dag.js` | No | SOURCE_VERIFIED |
| Offer verification orchestrator | Orchestrator helper | `lib/verification-orchestrator.js` | No, missing distinct identity and parent registration | SOURCE_VERIFIED |
| QuotAI watcher bridge | Integration scripts | `rodamihd/QuotAI` `scripts/agentos_bridge_probe.py`, `watcher/agentos_remote.py` | Unclassified pending runtime review | SOURCE_PARTIAL |
| AssuranceOS | Project / external integration | Not in inspected repository set | Unknown | NOT_VERIFIABLE |
| SceltaSemplice | Project / external integration | Not in inspected repository set | Unknown | NOT_VERIFIABLE |

**Confirmed separately registered sub-agents in inspected sources: 0.**
**Actual total across AgentOS and connected projects: UNKNOWN.** Zero identified is not proof of zero existing.

## Proposed registry record (schema design; no runtime activation)

```json
{
  "agent_id": "unique-stable-id",
  "parent_agent_id": null,
  "project": "affareradar",
  "display_name": "human-readable-name",
  "kind": "agent|subagent|module|task|skill|workflow",
  "implementation_ref": "repo/path#symbol@commit",
  "registration_ref": null,
  "execution_ref": null,
  "verification_state": "NOT_VERIFIABLE",
  "operational_mode": "SHADOW",
  "permissions": [],
  "human_approval_required": true,
  "owner": null,
  "last_verified_at": null
}
```

## Acceptance gates before publishing any numeric total

1. Discover the authoritative AgentOS control-plane repository / runtime and immutable commit.
2. Traverse all registered agent and sub-agent definitions and parent-child links; deduplicate by stable ID.
3. Separate implemented, source-verified, runtime-registered, active, suspended, shadow, and planned.
4. Cross-check against live registry/API and process/service inventory, only with approved read-only access.
5. Produce counts with environment, timestamp, evidence links, exclusions and reviewer sign-off.
6. Keep all mutation, merge and deployment disabled during SHADOW review.

## Verification ledger

| Claim | Observed evidence | Verdict | Missing evidence |
| --- | --- | --- | --- |
| Eleven AffareRadar task types are defined | `TASK_TYPES` literals in `lib/agentos-control-plane.js` | SOURCE_VERIFIED | None for static catalog |
| Seven AgentOS external capabilities are defined | `AGENTOS_EXTERNAL_CAPABILITIES` literals in `lib/agentos-external-runtime.js` | SOURCE_VERIFIED | Runtime use |
| Sub-agent count for all of AgentOS is known | No authoritative central agent registry in reviewed source scope | NOT_VERIFIABLE | Main AgentOS repo, runtime inventories |
| All items are operational | No deployment/runtime checks performed | NOT_VERIFIABLE | Approved runtime verification |

No tests or production runtime checks have been executed for this documentation-only draft.
