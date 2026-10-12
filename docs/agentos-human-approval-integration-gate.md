# AgentOS 33.10 — trusted human approval integration gate

Status: DESIGN_ONLY / BLOCKED_FOR_RELEASE. This is not a deployment configuration.

## Mandatory trust boundary

The current `issueApproval` function accepts an injected `authenticateReviewer` callback. It is **not** an identity provider. Production callers must never derive `verified`, `canApprove`, `authenticationStrength`, `explicitApproval` or `approvedDigest` from HTTP request bodies, unsigned headers, client-side state, or agent-generated text.

An integration must verify a server-side authenticated reviewer identity; an active user session or signed issuer token with issuer, audience, expiration and signature validation; explicit RBAC permission for `PUBLISH_OFFER` within `affareradar`; an independent reviewer distinct from the publishing principal; and a deliberate confirmation of the exact canonical `publicationDigest` after reviewing the offer content. The resulting approval must be short-lived, scoped and recorded with a minimum necessary audit trail. Tokens and secrets must never be logged.

## Minimum secure flow

1. Authenticated human reviews the exact offer representation and its computed digest.
2. Trusted server authorization checks the reviewer's identity, session assurance, role, and explicit confirmation.
3. Trusted server calls `issueApproval` with the verified review context. Never expose the function through an unauthenticated or shared-secret-only approval endpoint.
4. Redis `SET ... NX EX` records the approval with scope and digest; authorization cannot be reused across offers.
5. Authenticated publisher submits the exact request payload and one-time approval ID.
6. Redis `EVAL` validates and consumes the exact approval atomically. Invalid, expired, mismatched and replayed approvals fail closed.
7. Only after successful verification can publication proceed, subject to existing compliance, pricing, freshness, and publication gates.

## Release blockers and acceptance evidence

- [ ] Identify and approve the real identity provider and canonical human reviewer directory; test role removal and session expiry.
- [ ] Audit issuance call sites and ensure no client-provided field is trusted as reviewer attestation.
- [ ] Confirm digest is calculated over the same immutable, approved publication representation consumed by the publisher (including any server-side transformations).
- [ ] Confirm Redis production compatibility for `EVAL`; test concurrent, expired, mismatched and replayed approvals in isolated staging.
- [ ] Verify transient failures and request retries cannot consume authorization then silently publish a different offer.
- [ ] Verify staging HTTP positive and negative paths with outbound Telegram and merchant activity disabled.
- [ ] Capture audit correlation IDs, human reviewer signoff, regression results, and documented rollback.
- [ ] Obtain explicit human release authorization; no automatic merge, deploy, or environment-variable activation.

Default `AGENTOS_GOVERNANCE_ENFORCE` remains disabled until all release gates pass. Do not claim legal compliance or production readiness from green CI alone.
