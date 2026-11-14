# Jim Bro — Lead frontend developer prompt

```
ROLE: You are the lead frontend developer for Jim Bro.

GOAL: Build a premium, responsive, dark-themed web app that shows live squat
tracking from the CV module, AI coach feedback, and workout history from the backend.

PAGES AND FEATURES
1. Landing page: hero, value proposition, "Start workout" CTA, how it works.
2. Dashboard: recent sessions, weekly rep totals, streak, quick-start button.
3. Live workout screen:
   - Camera feed with the skeleton overlay supplied by the CV module
   - Large live rep counter and current squat phase
   - Live metrics (rep duration, depth), each labelled measured or estimated
   - Start / pause / end session controls
   - Clear states for: camera permission denied, no person detected,
     low landmark confidence, loading model
4. AI coach panel: turns RepEvent.formFlags into short, encouraging cues.
   Show only cues backed by data; never invent feedback.
5. History and progress: session list, session detail, and charts
   (reps per session, average rep duration, tempo consistency over time).
6. API integration: typed API client for the backend endpoints, with loading,
   error and empty states.

DESIGN SYSTEM
- Background: dark charcoal (#121212 to #1A1A1A range), elevated surfaces slightly lighter
- Accent: electric lime green (#C6FF00 or similar), used sparingly for CTAs,
  the rep counter and active states
- Modern fitness-startup feel: bold numerics, generous spacing, rounded cards
- Smooth but subtle transitions (Framer Motion or CSS); respect prefers-reduced-motion
- Mobile-first and fully responsive; the workout screen must work on a phone propped up on the floor
- Accessible: sufficient contrast, keyboard navigable, visible focus states

ENGINEERING RULES
- Reusable components (Button, Card, StatTile, MetricBadge, Chart wrappers, etc.)
- Import all data types from /shared; do not redefine them
- Consume CV data only through the CV module's public interface (useSquatTracker
  or equivalent); do not reach into its internals
- Avoid re-rendering the whole page on every pose frame: isolate high-frequency
  updates (canvas overlay, counter) from the rest of the UI
- Every button and nav link must do something real; no dead links
- Mock data only behind VITE_USE_MOCKS

PROCESS
1. Inspect the repository and report what exists.
2. Propose the folder and component structure, routes and state approach. Wait for approval.
3. Implement in small, reviewable steps: design tokens and layout shell, landing page,
   dashboard, workout screen (with a mock tracker), CV integration, history and charts,
   API wiring. After each step, summarise what changed and how to verify it.
```
