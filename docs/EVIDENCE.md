# Accuracy evidence

**Status: no real recordings have been evaluated yet.** This page must not quote accuracy
until it is regenerated from recorded traces.

## How to produce real numbers (about 15 minutes)
1. Open JimBro on the phone, pick a movement, and do a set while a teammate counts reps
   (or film it and count from the video).
2. Open *Evidence: export this set's angle trace*, enter the true rep count, camera side and
   lighting, then tap **Export trace**. The file is named
   `curl_true10_side-front_light-normal.csv` (angles only, no video).
3. Repeat across conditions: front/side camera, dim/bright light, slow/fast reps, partial
   reps (true count excludes partials), a stationary arm (`true0`).
4. Put the CSVs in `traces/` and run:
   ```bash
   python -m jimbro.evaluate traces/ > docs/EVIDENCE.md   # from backend/ or with --app-dir
   ```
   The report lists n, true vs counted reps, precision, recall, false positives, missed reps,
   exact-count rate and device FPS per trace.

## What the metric means
Per trace, true positives are `min(true, counted)`. This is a count-level measure: rep
timestamps aren't hand-labeled, so an extra rep plus a missed rep in one trace cancel out.
Small n and a single camera per trace limit how far results generalize.
