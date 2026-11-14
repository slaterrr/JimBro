# JimBro

JimBro is a hackathon prototype for a phone-based exercise tracker with an AI coach named **Jim**. The end goal is measured reps, approximate movement-phase timing, workout history, and optional personalized coaching. See [feature status](docs/FEATURES.md); most features are still **planned**.

## What exists in this foundation PR
- A small FastAPI health endpoint (`GET /health`).
- A pure joint-angle function with parameterized unit tests and malformed landmark handling.
- A documented [sprint backlog](docs/SPRINTS.md) and [engineering/PR policy](docs/ENGINEERING.md).
- CI and optional mutation audit; no camera tracking or exercise recognition has been implemented yet.

## Setup
```bash
python -m venv .venv
source .venv/bin/activate  # On Windows use .venv\\Scripts\\activate
python -m pip install -e ".[dev]"
uvicorn jimbro.api:app --reload
```

Run `pytest`, `ruff check backend`, `ruff format --check backend` and `mypy backend/jimbro` before proposing a PR.

## Architecture decision
For the hackathon, phone-side pose estimation is preferred; the Raspberry Pi 4 runs API, persistence and a potential physical feedback station. This is a proposed architecture, not a performance guarantee.

## Track plan
Healthcare is the proposed sole HackPrinceton main track; other optional/sponsor tracks require their own verified criteria. See the sprints for the technical validation plan.

## Safety and privacy
Camera analysis is not a clinical assessment. Video-derived TUT describes movement-phase timing and does not directly measure force or muscle tension. Do not persist raw video by default; reject low-confidence measurements.
