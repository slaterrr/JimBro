# Engineering and PR policy

## TDD (red -> green -> refactor)
- Add a failing test that describes public behavior, commit it with `test:` prefix.
- Confirm it fails for the intended reason, not due to missing dependencies.
- Implement the minimal production change, commit `feat:` or `fix:`.
- Refactor using `refactor:` after all tests are green. Keep PRs focused.
- Every bug regression gets a test first. Model outputs are never their own oracle: assert structured data invariants.
- Prefer pure functions for angles, phase transitions, deduplication and progress math. Keep IO/LLM behind adapters.

## Prevent unintended changes
- No direct pushes to protected `main`; never force-push main.
- Require PR + 1 independent approval, stale review dismissal, resolved conversations and passing `backend-quality` status.
- Disable bypass and branch deletion where supported. Restrict the trusted automation token's permissions.
- Any model, threshold, database migration, or public event schema change needs a migration note and regression fixtures.
- Never accept generated tests that only repeat implementation logic.
- Never commit secrets or raw participant videos. Use privacy-safe fixtures.

## GitHub automation
- `CI` runs static checks, strict typing and >=90% coverage on PRs and main.
- `Auto-open draft PR` creates a draft on feature-branch pushes when repo owner enables Actions permission to create PRs.
- `Mutation audit` mutates deterministic Python logic on targeted PRs and runs a conservative report checker. The mutation gate should not be required for all unrelated PRs because path filters skip runs; configure it as a required check only when it runs on every PR.
- Owner: Repo Settings -> Branches (or Rulesets) -> protect `main`; require pull requests, 1 approval, stale approval dismissal and the exact check `backend-quality` after first CI run; require up-to-date branches and conversation resolution.
- Owner: Settings -> Actions -> General -> Workflow permissions -> allow Actions to create/approve PRs (if available) for draft-PR automation; never grant approval/merge rights to the bot.

## Review checklist
- Correct PR title and linked sprint issue?
- Tests cover normal + edge + failure cases?
- Lint, formatting, types and test gate green?
- Mutation survivors investigated where core logic changed?
- Performance and cross-device behavior measured?
- No unrelated files, secret tokens, API keys, or sensitive footage?
- API endpoints and payloads documented and backward compatible?
- Safe manual fallback when AI/camera/cloud is unavailable?

## Sprint branch convention
`feat/sN-short-name`, `fix/sN-short-name`, `chore/sN-short-name`. Draft PR while incomplete; only request review when CI passes. Squash-merge after approval. Avoid multiple agents editing the same file concurrently.

## Local quality commands
```bash
python -m pip install -e ".[dev]"
ruff check backend
ruff format --check backend
mypy backend/jimbro
pytest --cov=backend/jimbro --cov-report=term-missing --cov-fail-under=90
mutmut run
python scripts/check_mutants.py
```
