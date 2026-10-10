# Mobile navigation acceptance checklist — AffareRadar preview

Scope: `index.html` on the draft Skills PR branch. This checklist is non-destructive and does not trigger publishing, Telegram messaging or affiliate clicks.

## Behaviors to verify

1. Desktop (width > 900 px): visible `.navlinks`; mobile `details.mobile-menu` hidden.
2. Mobile (390x844; 768x1024): menu button is visible; mobile menu initially closed; no horizontal scroll.
3. Pointer click or Enter/Space on native `summary`: exposes internal anchors `#come-funziona`, `#categorie` and the Telegram destination. Desktop links remain unchanged.
4. Selecting internal anchors closes the menu and reaches the section; Telegram target must not be activated in automated acceptance tests.
5. Escape closes the menu and returns focus to the summary; focus-visible outlines remain visible.
6. `prefers-reduced-motion: reduce` disables smooth scrolling.
7. Affiliate notice remains present; do not infer product cards, prices or coupons from category cards.

## Review and release conditions

Browser test only on a verified preview deployment corresponding to the PR head commit. Record commit SHA, viewport, screenshots and assertions. A passing static/CI test is not a replacement for a rendered mobile test. Keep pull request in Draft until human review. Never test actions that publish, send Telegram messages or follow affiliate links.
