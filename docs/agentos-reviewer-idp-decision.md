# AgentOS reviewer identity: provider selection (draft)
Date: 2026-10-12; isolated branch only; no provider connection or production activation.

## Decision
Prefer **Supabase Auth as a candidate**, not as an already connected service. The existing AffareRadar shared publishing secret is only machine authentication. The existing GitHub/Vercel connections are developer management access, not a verified individual human-review session for the offer.

Supabase documents auth user verification, independently verified JWTs with asymmetric JWKS or validation against its Auth service for other key configurations, and MFA assurance level `aal2`. Supabase Auth can be used without moving the existing application database. Official references:
- https://supabase.com/docs/guides/auth
- https://supabase.com/docs/guides/auth/jwts
- https://supabase.com/docs/guides/auth/auth-mfa

Alternatives: Clerk provides session identity, roles and re-verification but production MFA may entail a paid plan; Auth0 provides roles and enterprise scenarios but involves more configuration. No vendor price or entitlement is asserted here.

## Required implementation contract (not yet wired)
- Reject any request without a freshly verified server-side Supabase Auth identity: identify `sub`/user ID from validated token and exact configured issuer/audience.
- Require MFA assurance `aal2`, with a recent trusted authentication timestamp if supported; `aal2` alone does not demonstrate that MFA was performed recently.
- Use **server-controlled** reviewer role records (or a verified role assignment service) to authorize `PUBLISH_OFFER`. Do not accept `canApprove`, roles or permissions from request JSON, mutable user metadata, or unvalidated JWTs.
- Require an authenticated, explicit user action for the exact SHA-256 digest displayed for human review. Check CSRF protection for browser sessions.
- Disallow self-approval and impersonation. Bind the approval to reviewer ID, principal, operation, scope and the immutable publication request digest; ensure issuance idempotency, short expiry, single use and audit correlation.
- Do not issue an approval after only token validation: verified role and human intent are separately necessary.
- Keep the issuing endpoint unavailable until a dedicated isolated project, session verifier, role store and strong MFA are configured and tested.
- In staging disable all Telegram / merchant publication side effects, use synthetic offers, run both approval/rejection paths and Redis concurrency tests; document rollback before human release decision.

## Current blockers
No confirmed Supabase project, domain, MFA policy, trusted reviewer directory or server role store was found through the repository and project-level checks. No real login was performed, no secrets fetched or set, and no provider configuration changed.

Status: PROVIDER_CANDIDATE_SELECTED / INTEGRATION_BLOCKED. Await verified, separately authorized identity configuration. This proposal may be superseded if a previously unseen in-house compliant IdP is identified.
