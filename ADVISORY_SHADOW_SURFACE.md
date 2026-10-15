# Advisory Shadow Surface

This module prepares the SHADOW -> ADVISORY transition without enabling enforcement.

It exposes:
- baseline decision;
- advisory shadow decision;
- reasons;
- verified evidence metadata;
- optional statistical status;
- optional composite review status;
- optional observed outcome.

It never:
- changes the production decision;
- publishes to Telegram;
- mutates production Redis state;
- places or changes wagers;
- switches tariffs;
- promotes automatically.

All outputs explicitly carry:
- enforcement=false;
- production_mutation=false;
- publish_effect=false;
- wager_effect=false;
- tariff_effect=false;
- automatic_promotion=false.

Real advisory observations can be accumulated only after this code is deliberately integrated into a runtime. Synthetic/replay observations must remain excluded from real-evidence counts.
