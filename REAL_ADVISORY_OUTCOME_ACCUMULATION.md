# Real Advisory Outcome Accumulation

This collector counts only advisory observations explicitly marked source=real.

Synthetic, replay, backtest and contract-only records are rejected from real evidence counts.

A real advisory decision may exist before its outcome. It is counted as pending until a matching real outcome with the same decision_id appears.

The collector does not create traffic, does not deploy code, and does not mutate production decisions. It only defines how future runtime observations will be accumulated after an authorized advisory integration.
