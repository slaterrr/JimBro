# Chat request and response shapes

These show the **shapes** the code accepts and returns. They are not recorded from a live Claude
call; none has been made from this environment yet.

## Request: app → `POST /chat`
```http
POST /chat
Content-Type: application/json
X-Jim-Key: <shared secret, if JIM_PROXY_KEY is set>
```

```json
{
  "messages": [
    { "role": "user", "content": "How is my squat going?" }
  ],
  "persona": "coach",
  "context": {
    "unit": "lb",
    "recentSets": [
      { "id": "s1", "exercise": "squat", "reps": 5, "weight": 225, "unit": "lb", "rpe": 8, "source": "camera", "pr": false, "date": "2026-11-10" }
    ],
    "prs": [{ "exercise": "squat", "unit": "lb", "heaviest": { "reps": 5, "weight": 225 } }],
    "goals": [],
    "weeklyCheckIn": { "wins": ["2 workouts"], "misses": [], "suggestion": "Keep going." },
    "lastSetReport": null,
    "workout": { "today": "Today is Plan day 2: deadlift 3 sets of 5.", "setsLeft": "There's no planned workout running." }
  }
}
```

## Response: plain answer
```json
{ "reply": "Your squat is at 225 for 5 at RPE 8, so there's room to add a little next time.", "proposals": [] }
```

## Response: write request becomes a proposal (the user confirms in the app)
```json
{
  "reply": "Confirm and I'll log three sets of ten curls at 25.",
  "proposals": [
    {
      "type": "log",
      "set": { "exercise": "curl", "reps": 10, "weight": 25, "unit": "lb" },
      "sets": [
        { "exercise": "curl", "reps": 10, "weight": 25, "unit": "lb" },
        { "exercise": "curl", "reps": 10, "weight": 25, "unit": "lb" },
        { "exercise": "curl", "reps": 10, "weight": 25, "unit": "lb" }
      ],
      "summary": "Log 3 sets of 10 × bicep curl at 25 lb?"
    }
  ]
}
```

## Response: safety, refusal and errors
```json
{ "reply": "Stop the set now. Pain, dizziness or numbness is a signal to rest…", "proposals": [], "safety": true }
```

```json
{ "reply": "I can't help with that one. Ask me about your training, your sets or your plan.", "proposals": [], "refused": true }
```

```json
{ "error": "missing or wrong X-Jim-Key" }
```

The last one is returned with HTTP 401.
