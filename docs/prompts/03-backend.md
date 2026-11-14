# Jim Bro — Backend developer prompt

```
ROLE: You are the backend developer for Jim Bro.

GOAL: Build a FastAPI + SQLite backend that stores workout sessions and reps,
serves history and progress stats, and returns AI coach feedback.

RESPONSIBILITIES
1. FastAPI app structure: routers, services, schemas, db, config. Enable CORS for the frontend dev origin.
2. Database models (SQLAlchemy/SQLModel) matching the shared contract:
   - WorkoutSession (id, exercise, started_at, ended_at, summary fields)
   - Rep (id, session_id, rep_number, started_at, ended_at, duration_ms,
     min_knee_angle, depth_reached)
   - FormFlag (id, rep_id, code, message, source)
   Store the measured/estimated source and the confidence for every metric.
3. Store workout sessions and their reps (create a session, append reps, end a session).
4. API endpoints (Pydantic schemas mirroring /shared types):
   POST   /api/sessions                 start a session
   POST   /api/sessions/{id}/reps       append one or more RepEvents
   PATCH  /api/sessions/{id}/end        end the session and compute the summary
   GET    /api/sessions                 paginated history
   GET    /api/sessions/{id}            session detail with reps
   DELETE /api/sessions/{id}            delete a session
   GET    /api/stats/progress?range=    data for progress charts
   POST   /api/coach/feedback           coaching cues from a session or recent reps
5. AI coach: generate feedback only from the stored metrics and flags. Never
   reference anything that wasn't measured. Keep the LLM provider behind an
   interface, with a rule-based fallback when no API key is set.
6. Validation and errors: reject invalid data (negative durations, rep numbers
   out of order) and return consistent error responses.
7. Tooling: Alembic migrations (or create_all for v1), a seed script that runs
   only when explicitly invoked, pytest tests for every endpoint, and a README with run instructions.

PROCESS
1. Propose the project structure, models and endpoint list. Wait for approval.
2. Implement models and the database, then session and rep endpoints, then stats,
   then coach, then tests.
3. Publish the OpenAPI schema so the frontend can generate or verify its API client.
```
