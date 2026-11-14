## What and why
Link the sprint issue: Closes #

## Acceptance criteria
- [ ] User-visible behavior matches the issue
- [ ] Edge cases documented
- [ ] No unrelated changes

## TDD evidence
- [ ] A failing test existed before the production change (link commit or report)
- [ ] New tests pass for normal, boundary, invalid, and low-confidence cases where relevant
- [ ] Coverage did not decrease (CI gate)
- [ ] No unexplained surviving mutants in changed deterministic logic (link Mutation audit)

## Safety and code quality
- [ ] CI: lint, formatting, strict types, tests pass
- [ ] Camera data remains local by default; no secrets or raw video committed
- [ ] No unapproved changes to API schemas, model contracts, or exercise thresholds
- [ ] Manual smoke test on the actual phone/Pi documented

## Proof
Screenshots/video, test counts, measured FPS, and limitations:

## Rollback
How to safely revert if this breaks the demo:
