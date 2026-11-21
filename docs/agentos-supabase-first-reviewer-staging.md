# AgentOS Auth staging — first reviewer enrollment and MFA gate

Project: `agentos-auth-staging` (`hzuuagxwjwxtwdfakeaf`) — **STAGING ONLY**.
Status: enrollment workflow prepared, **not yet configured or verified with a real login**.

## Human-only onboarding
1. In the Supabase project's **Authentication** settings, inspect Sign-in Providers and MFA settings. Permit a suitable email-based sign-in method; enforce TOTP MFA on the **application's reviewer authorization path**, not merely by relying on a dashboard toggle.
2. Create or invite the first test reviewer through an approved Auth workflow. Use a real address controlled by the human reviewer; do **not** put passwords, magic links, tokens, TOTP seed, recovery codes or screenshots of secrets in GitHub issues or ChatGPT.
3. Sign in as the reviewer; enroll a TOTP authenticator using the Supabase Auth MFA enrollment/challenge/verify APIs. Confirm via trusted server checks that a **fresh active session** has `aal2` and belongs to the expected user.
4. Verify MFA failure paths: absent factor, `aal1`, expired/revoked session, re-used challenge and wrong factor code must prevent issuance.
5. A separate administrator may provision `agentos_private.reviewer_grants` **only after** human identity and independence checks. Default `can_approve_publish=false, active=false`; no grants authorized by this document.
6. For every approval request, independently verify active Auth session (`session_id` where possible), `aal2`, the reviewer grant in a privileged server-only query, separate reviewer and publishing principal, and user confirmation of the exact immutable publication digest.
7. Preserve an audit trail, short TTL, Redis atomic one-use consumption, no production publishing side effects. Run end-to-end negative tests before permitting any publishing.

## Safety architecture
- Supabase service role/secret never enters browser, git, logs or user-supplied request objects.
- Keep private role tables in `agentos_private`; RLS enabled and no `anon`/`authenticated` grant. Privileged access only from controlled backend with minimally scoped credentials.
- JWT `user_metadata` is never a reviewer permission source. Reject stale `app_metadata` and unaudited self-grants; query the server-side grant table at approval time.
- Provider config, MFA enrollment and user creation are intentionally not simulated or claimed completed.
- Application-specific enforced `aal2` is essential because Supabase MFA enrollment alone does not guarantee reviewer-level enforcement.

## Release gates
BLOCKED: real reviewer sign-in, actual `aal2` session verification, grant and independent reviewer integration, HTTP staging rejection tests, CI and manual human signoff.
No change to AgentOS Main 33.10 or production AffareRadar.
