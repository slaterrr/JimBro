# JimBro implementation sprints (HackPrinceton)

Target: a working two-minute judge demo. The official onsite packet states an **8:00 AM Sunday Nov 15** hard submission cutoff; the schedule conflicts at 8:45. Plan for 8:00 AM. One main track (Healthcare), optional + sponsor tracks only when entry conditions are genuinely met.

**Operating rule:** one issue -> one small feature branch -> failing acceptance test -> minimal implementation -> green tests -> draft PR -> review -> squash merge. Never push unfinished feature work to main. The repo owner must protect main in Settings; workflow files alone cannot enforce PR-only merges.

## S0 Foundation — 45–60 min
PR: `chore/sprint-0-tdd-pr-foundation`
- Create Python package, API health endpoint and pure joint-angle function with unit tests.
- Add Ruff formatting/lint, mypy, pytest + coverage, mutation audit, PR template, draft-PR workflow, issue backlog.
- Test first: 90-degree / 0-degree / 180-degree / translated angles; non-finite and overlapping landmark rejection.
- Done: `ruff check backend`, `ruff format --check backend`, `mypy backend/jimbro`, `pytest --cov=backend/jimbro --cov-fail-under=90` pass.

## S1 Phone camera and pose overlay — 2h
PR: `feat/s1-camera-pose`
- Create React + TypeScript + Vite PWA in `apps/mobile`; secure phone camera access.
- MediaPipe pose landmarks processed on phone, never streaming raw video to Pi by default.
- TDD: mock landmark frames; lost permission, occlusion, poor confidence, device switch; UI behavior with camera API mock.
- Done: live skeleton on an actual phone, tracking indicator and reliable stop/restart.

## S2 Curl analysis — 2.5h
PR: `feat/s2-curl-reps`
- Pure joint-angle/temporal smoothing; explicit phases with hysteresis, minimum duration and cooldown.
- Count complete curls and calculate per-rep concentric, eccentric and paused durations, estimated TUT.
- TDD fixtures: 0 reps stationary, 5 full, 3 partial, occlusion mid-rep, noisy transitions, slow rep.
- Done: video ground-truth comparison published with counts, errors, device FPS and camera angle.

## S3 Pi workout logging — 2.5h
PR: `feat/s3-workout-persistence`
- FastAPI endpoints: POST /v1/sessions, POST /v1/sets/{id}/complete, GET /v1/sessions/{id}/summary.
- SQLite tables for athlete, session, set and per-rep summaries. Idempotency key per set.
- Manual entry for the six initial exercises. Keep weights, units and RPE explicit.
- TDD: schema validation, cross-user isolation (when auth exists), retries, duplicate submissions, SQL rollback, restart/reload.
- Done: 2 sessions persist on Pi and show correct progress after restart.

## S4 Coach and planning — 3h
PR: `feat/s4-jim-coach`
- Structured JSON facts -> cloud AI response with Direct, Friendly, Silly, Hard tone.
- Push-to-talk transcription with confirmation before writes; browser speech output fallback.
- Goal/time/frequency/equipment plan, bounded recommendation, user approves adaptations.
- TDD: model stub with deterministic responses, safe constraints, timeout fallback, tone snapshot checks.
- Done: judge completes a set, talks/types to Jim, and views a history-grounded next-step suggestion.

## S5 Progress + physical station — 2h
PR: `feat/s5-progress-station`
- Comparable exercise trends and percentage change; weekly opt-in leaderboard with demo data labeled.
- Pi display subscribes to completed-rep events. Optional GPIO button if time remains.
- TDD: denominator/units, ties, rankings, reconnect, out-of-order events, disconnections.
- Done: workout displayed on phone and Pi at the same time; leaderboard reproducible.

## S6 Quality, sponsor validation, and pitch — 2h
PR: `chore/s6-demo-hardening`
- Run device test matrix: lighting, body framing, varied movement speed; publish counts, not inflated accuracy.
- Write README architecture / threat model / limitations / install steps; record a 2-minute backup demo.
- Optional if core complete: verify Peri stakeholder evidence, Deep Agents implementation, Photon eligibility, ChatOverflow entry.
- Done: submit before 8 AM ET; README explains what is real vs planned and links reproducible tests.

## TDD definition of done for EVERY feature PR
1. Link the issue and show a meaningful failing test (red).
2. Implement the smallest change to pass (green) and refactor without breaking behavior.
3. Cover valid, boundary, invalid and interruption paths, including timestamps for camera logic.
4. Ruff check, Ruff format, mypy, pytest + >=90% backend coverage all green.
5. For deterministic motion code: run mutation audit; investigate survivors before review.
6. Human review or owner approval, no auto merge. Preserve API compatibility, commit atomic changes.
