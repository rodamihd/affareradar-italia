# AffareRadar: isolated Upstash staging smoke (manual, no Telegram)

Status: NOT EXECUTED AGAINST UPSTASH. This guide does not authorize a paid resource or production job.

## Prerequisites / release hold

1. Create a **separate** Redis/Upstash database in the Upstash/Vercel dashboard only after the owner has verified its current plan, billing and zero-cost allowance. Never enable paid upgrades without owner approval.
2. Verify staging and production have **different Upstash resource IDs and different REST hosts**. Independent confirmation of the resource identity in the provider dashboard is required; comparing strings alone is not proof of isolation.
3. Supply dedicated staging credentials only through an approved local secret manager or temporary environment injected by the test operator. Do not paste credentials into ChatGPT, commit them, add them to public logs, or copy them from Vercel production.
4. Never connect the script to a shared preview/production Redis resource. The script will use its own UUID-prefixed Redis keys and clean only those exact keys, but isolation must come from the database itself.
5. Run the script locally with Node.js 22+ from the repository root. Do not add a cron trigger, a deployment endpoint, an automatic CI execution with real credentials, or Telegram tokens.

## Required environment variables

- `AFFARERADAR_UPSTASH_STAGING_REST_URL`: HTTPS REST origin for **new isolated staging** resource
- `AFFARERADAR_UPSTASH_STAGING_REST_TOKEN`: secret access token for staging only
- `AFFARERADAR_UPSTASH_STAGING_RESOURCE_ID`: staging Upstash provider resource ID
- `AFFARERADAR_UPSTASH_PRODUCTION_REST_URL`: production REST origin, used **only for comparison** and never contacted
- `AFFARERADAR_UPSTASH_PRODUCTION_RESOURCE_ID`: production provider resource ID, used **only for comparison** and never contacted

Run manually **only** after confirming these inputs belong to distinct databases:

```sh
node --experimental-default-type=module scripts/upstash-staging-smoke.mjs --confirm-isolated-staging
```

The program rejects missing credentials, missing explicit confirmation, wrong URL scheme and matching production/staging hosts or resource IDs *before* contacting the network. No Telegram endpoint is called.

## Expected checks

- `PING` and Upstash REST `EVAL`
- Atomic enqueue, idempotent second enqueue and TTL
- Lease claim, constrained synthetic retry, and journal clearing
- Stale-price validation in memory
- Abandoned journal -> uncertainty review (never auto-send)
- Best-effort cleanup of precisely generated UUID-namespaced keys

A failure is `FAIL` or `FAIL_CLEANUP`; in either case inspect only the generated prefix in the staging database, never run `FLUSHDB` or wildcard deletion.

This is an adapter-level smoke test, **not** a claim that the entire Telegram publishing flow or official Amazon price verification works end-to-end. PR #31 stays in draft until independent review and explicit release approval. The default GitHub workflow only runs a no-secret, fail-closed preflight and cannot contact Upstash.
