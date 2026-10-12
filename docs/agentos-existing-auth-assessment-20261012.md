# Existing authentication review — AgentOS human approval

Date: 2026-10-12. Target: draft PR #24, `affareradar-italia`. Mode: READ_ONLY discovery, DRAFT documentation, no deployment.

## Verified inventory

| Existing mechanism | Evidence | Suitable for human approval? |
| --- | --- | --- |
| `PUBLISH_SECRET` in `api/auto-publish.js` | Server compares `x-affareradar-secret` with configured shared secret before governance | **No**: verifies a technical caller, not a named human, independent role or review |
| `issueApproval({authenticateReviewer})` | `lib/agentos-approval-issuer.js` takes an injected verifier callback | **No, alone**: extension point only; no independent identity/session verification implementation |
| Vercel project protection | Project metadata read 2026-10-12: `passwordProtection.enabled=false`, `ssoProtection.enabled=false` | **No**: deployment access protection is disabled and, even if enabled, cannot by itself prove offer-specific human approval |
| Candidate session/OAuth files | Targeted search and checks of usual middleware and API locations on default branch yielded no verified reusable human-auth provider | **Unverified**: absence from targeted checks is not proof that no other provider exists |

## Decision

**REUSE_NOT_VALIDATED / BLOCKED_FOR_HUMAN_AUTH**. Do not substitute shared secrets, platform access, unsigned identity headers or simulated test users for independent human reviewer authentication. No production issuer endpoint or automatic approval pathway may be activated.

## Next integration decision

Either provide a verified existing identity provider with a server-side session verifier, reviewer directory and role administration, or authorize selection of an external OIDC identity provider as a separate architecture decision. The adapter must check signature/issuer/audience/expiry or authoritative session state, strong authentication, reviewer permission, independent identity and affirmative confirmation of the approved SHA-256 digest.

Do not merge, deploy, enable `AGENTOS_GOVERNANCE_ENFORCE`, issue production approvals or publish content on the strength of this document.
