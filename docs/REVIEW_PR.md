# Review prototype: chat workspace with the blue Jim mascot

JimBro's camera, plans, progress and imports previously required leaving the
conversation. This review branch embeds those tools in one responsive chat workspace
and aligns the interface with the supplied blue mascot, graphite, cream and subtle
pale-yellow accents. The Muse layout is explicitly labeled as an interpretation.

This builds on the existing vision/coach engines and current main's login,
workout-only logging, muscle-specific progress, comparison results, optional AI
plan personalization and proxy hardening. It preserves account-scoped records and
server-only provider credentials. No changes are deployed to the shared preview.

Tool reads/actions are allowlisted and validated; writes require a one-use expiring
confirmation. Cards are bound to their workout so an old proposal cannot save into
a new session. Camera reps/timing stay distinct from user-reported weight/effort.

## Review

- Run `npm ci && npm run preview:review` in `apps/expo` and open the printed web URL.
- Use the walkthrough and evidence in `docs/REVIEW_PROTOTYPE.md`.
- Desktop/mobile screenshots: `docs/design/review-blue-desktop.png` and
  `docs/design/review-blue-phone.png`.
- Review before merging. No main push, PR merge, deployment or shared Expo update
  is part of this change.

## Validation

711 engine/helper/API tests and 39 Playwright browser scenarios pass (23 chat/tool + 16 user journeys). Android and iOS exports build. The actual local web preview also passes signup, chat, keyboard submission and reload checks. Playwright's full-stack AI tests use
the production HTTP boundary with a mocked SDK. Recorded squat landmarks exercise
the browser tracking bridge. Neither constitutes live-Claude or physical-phone
validation; those remain pending an API credential and device checks.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
