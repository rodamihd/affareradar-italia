# AgentOS reviewer-grant access: supervised staging acceptance plan

Date: 2026-10-12. Scope: Supabase project `agentos-auth-staging` only.

## Read-only evidence
- `pg_policies` returned no policies in schema `agentos_private`.
- `agentos_reviewer_reader`: NOLOGIN; not SUPERUSER; cannot BYPASSRLS.
- The dedicated PostgreSQL role has not been made into a login principal.
- GitHub PR #24 remains Draft; two workflows passed on previous head.

## Recommendation: keep blocked until supervised identity binding
1. Security reviewer selects a dedicated backend login principal with narrow grants, rotation and network restrictions. Do not enable service-role tokens in browser-facing code.
2. Evaluate RLS SELECT semantics for the narrow reviewer lookup separately from SQL table grants and role inheritance. Use an isolated disposable test principal and synthetic rows only.
3. Prove denial for anon/authenticated clients, attempts to read audit rows, writes, lateral access and mismatched reviewer IDs.
4. Use a privileged, server-controlled role lookup only after a human-approved database security change; record rollback commands and an evidence ledger.
5. Confirm fresh Supabase Auth MFA aal2, reviewer independence and exact digest approval in a controlled end-to-end staging exercise with publishing effects disabled.
6. Re-run CI, examine access logs and require security + owner signoff before deployment consideration.

## Current gate
BLOCKED_FOR_RLS_REVIEW. No policy, login credentials or production configuration were changed by this document. Do not treat a successful synthetic test as proof of real database access.
