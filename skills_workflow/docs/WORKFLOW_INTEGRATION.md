# Skills Integration Program 1.0 — workflow routing (SHADOW / SUPERVISED)

> **Status: proposal for review**, not a deployed runtime integration. Generated on 2026-10-10 from the user's confirmed set of 22 available ChatGPT Skills. Main branch, Render and Vercel production are unchanged.

## What is and is not integrated

- **Yes:** a versioned, validated catalog of **all 22 Skills**, routed by *task/stage* to AgentOS, AssuranceOS, QuotAI, AffareRadar and a PAUSED SceltaSemplice reference flow. `skills_workflow/scripts/skills_workflow_gate.py` produces repeatable, read-only routing suggestions. A new GitHub PR-only preflight is defined, which checks completeness, authorization boundaries and hard stops.
- **No:** ChatGPT Skills are instructions discovered by ChatGPT, **not importable Python modules**. This patch does not execute a Skill in a GitHub Action, process private data, change a production runtime, promise availability of a connector, or certify laws, ISO, bets or prices. The reviewer must invoke each applicable installed Skill in an authorized ChatGPT task.
- **No claim** of branch-protection coverage or CI success until those exact checks are observed in GitHub Actions. The proposed CI only runs for PRs affecting these integration files; it cannot halt unrelated production workflows without separate approved branch protection.

## Invocation and stage-to-skill routing

Run `python skills_workflow/scripts/skills_workflow_gate.py skills_workflow/skills-workflow-manifest.json --project quotai --stage market-preflight` (replace project and stage as documented in the JSON). It prints a candidate ordered set and mandatory evidence. Every result has `automatic_execution=false` and `requires_human_review=true`. No network connections.

| Domain | Workflow stages | Critical control |
| --- | --- | --- |
| AgentOS 33.10 | discovery -> connector design -> incident -> change review -> Mission Control UI | no automatic promotion, no Main/Clean sync |
| AssuranceOS | engagement intake -> data inspection -> reconciliations -> ISA evidence -> connector review -> professional sign-off | ISA Italia applicability; ISA 500 sufficiency/appropriateness; SA Italia 250B; professional sign-off; privacy by engagement |
| QuotAI | provider ingest -> market/freshness preflight -> model validation -> decision review -> release review | prematch <=120s; live <=15s; DQS/QES-LCB/UDS missing -> WATCH/REFERENCE; no BET until *all* external gates independently proven; no betting execution |
| AffareRadar | discovery -> prepublish -> web UI -> SEO/schema -> event analytics | current Italy-only price/coupon evidence; no unverified publication; privacy/affiliate disclosure |
| SceltaSemplice | tariff design -> PWA readiness (reference only) | paused; no automatic tariff switch; no live offer publication |

**Role boundaries:** security model only when explicitly requested; code-review on concrete known SHAs; professional audit conclusions require independent reviewer; no automatic commits, merge, deployment, publication, transfer, bets, or use of production credentials. Recorded CI status is *not* evidence of release eligibility.

## Acceptance and non-goals

1. `python -m unittest discover -s skills_workflow/tests -v` passes with synthetic data and no env vars. Validate all 22 Skills mapped, no automatic execution, blocked on absent mandatory controls.
2. GitHub PR has fresh diff review, tests, human sign-off and designated project owner.
3. For **QuotAI**, no change to existing collector or SHADOW OIDC scans. Pending P0 freshness PR and ODSS readiness issues remain independent blockers.
4. For **AssuranceOS**, this proposal does not close the professional shadow pilot or enable final opinion/signature; the draft platform PR remains separately gated.
5. For **AffareRadar**, this proposal does not alter cron publishing, affiliate calls or Vercel routes.
6. For **AgentOS**, do not modify Main 33.10, restore backups, or auto-promote Clean patches.

See `skills_workflow/skills-workflow-manifest.json` for the definitive stage-to-Skill mappings.
