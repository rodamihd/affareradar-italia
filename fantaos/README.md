# FantaOS

FantaOS is the multi-tenant fantasy-football decision platform.

## Foundation v1

This first production foundation establishes:

- isolated FantaOS application boundary inside the repository;
- tenant-aware request context;
- tenant authorization guard;
- production environment validation;
- PostgreSQL base schema;
- health endpoint for Vercel;
- explicit separation from AffareRadar runtime.

## Runtime

FantaOS is designed to run as a separate Vercel project with `fantaos/` as the project root directory.

## Required environment variables

- `FANTAOS_ENV`
- `DATABASE_URL`
- `AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Do not store third-party platform passwords. Any future Fantacalcio integration must use an approved OAuth/token-based mechanism or an authorized import flow.

## Multi-tenant rule

Private entities are always scoped by `tenant_id`. Requests that operate on league data must also carry and validate `user_id` and `league_id`.

## Next foundation steps

1. connect managed PostgreSQL;
2. apply the schema;
3. wire authentication;
4. add row-level security / tenant policies;
5. create the League Core APIs.
