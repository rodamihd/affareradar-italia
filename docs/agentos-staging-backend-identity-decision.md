# Decision record: AgentOS staging backend identity and RLS

Date: 2026-10-12. Applies only to Supabase project `agentos-auth-staging`. No deploy or production modification.

## Verified baseline
- PostgreSQL role `agentos_reviewer_reader` has NOLOGIN, no SUPERUSER and no BYPASSRLS.
- It has SQL SELECT on `agentos_private.reviewer_grants`, no UPDATE, but there are **no** policies on that RLS-protected table: row access is not operational.
- The application has an injected private-grant SQL lookup and a synthetic readiness checker, neither proving a real database session.
- PR #24 checks were 2/2 successful at `c43cb0383ad3bb71e640ef2d5375f794de0ee2ca`.

## Architecture decision: prefer a dedicated narrow backend principal
The preferred *candidate* is a dedicated staging-only LOGIN role with short-lived/rotated credentials held only in a server secret store; it may be granted membership in the existing NOLOGIN reader role after independent review of membership inheritance. Apply a SELECT-only RLS policy to the reader **only when** it is proven the reader is not inherited by public or unrelated principals. No blanket service_role access to the table or browser access.

Alternatives:
- Supabase service_role key: rejected for routine grant lookups because it carries broad privileged capability.
- PostgreSQL SECURITY DEFINER routine: deferred because privilege escalation and function EXECUTE grants require a separate security review.
- Broad policy for `authenticated` or `anon`: rejected.

## Staging acceptance checklist
1. Independently inspect PG role membership, schema exposure, RLS status, current SQL grants, table ownership and inherited privileges.
2. Review the exact login role, SCRAM/TLS connection, network egress policy, secure secret storage and rotation procedure. Do not commit credentials.
3. Obtain explicit security approval for creation of LOGIN principal and narrowly scoped SELECT policy; keep rollback instructions.
4. Test a real backend connection as that principal: `current_user`, RLS-protected synthetic read, non-matching reviewer, denied audit access, denied writes.
5. Test failed/revoked credentials; prove anon/authenticated cannot access `agentos_private`.
6. Separately test live Supabase Auth session with TOTP MFA `aal2`, active session and independent reviewer role before approval issuance.
7. Run full GitHub CI, suppress publication side effects, obtain human signoff. Main and production unchanged.

## Gate
**REVIEW_REQUIRED — NOT_READY_FOR_BACKEND_CONNECTION.** This is a proposed plan, not a statement that the access policy, backend credential, MFA or staging end-to-end test exists.
