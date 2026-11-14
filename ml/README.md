# Jim Bro ML

Offline training for the CV module's learned checks. Models are exported as
small JSON files into `frontend/src/cv/ml/models/` and run in the browser with
no ML runtime. The feature code (`frontend/src/cv/ml/rep_features.ts`) and the
signal filter are imported straight from the app, so training and the app
compute features identically.

## Reviewer-labelled characteristics (your own data)

Export a dataset from the validation lab (`/cv-lab.html` → "Export dataset"),
then:

```bash
npm --prefix frontend run train:traits -- path/to/jimbro-reps.jsonl
```

Each (exercise, label) is trained only if two or more reviewers agreed
(κ ≥ 0.6), with 10+ people and 30+ reps per class; otherwise it's refused
with the reason. Results go to `ml/data/trait-models/` (gitignored). Nothing
is shipped automatically. See `docs/cv/reliability-report.md` for the release
bar.

## UI-PRMD squat movement-quality model

Results and caveats: [uiprmd/REPORT.md](uiprmd/REPORT.md). In short: AUC 0.88
on held-out subjects, but ordinary parallel gym squats score as "incorrect"
because the dataset's correct squats are deep overhead squats. So the app
records the score and gives no feedback from it yet.

### Reproduce

Data (public domain, PDDL 1.0) from <https://zenodo.org/records/23104965>.
Only the two segmented packages are needed (≈ 420 MB). `ml/data/` is gitignored.

```bash
mkdir -p ml/data/uiprmd/raw
```

```bash
curl -L -o "ml/data/uiprmd/raw/Segmented Movements.zip" "https://zenodo.org/records/23104965/files/Segmented%20Movements.zip?download=1"
```

```bash
curl -L -o "ml/data/uiprmd/raw/Incorrect Segmented Movements.zip" "https://zenodo.org/records/23104965/files/Incorrect%20Segmented%20Movements.zip?download=1"
```

Check the MD5s against Zenodo (`7626dfdd…` and `edce6554…`), then extract only
the deep-squat Vicon positions:

```bash
cd ml/data/uiprmd && unzip -q "raw/Segmented Movements.zip" "*/Vicon/Positions/m01_*" -d extracted && unzip -q "raw/Incorrect Segmented Movements.zip" "*/Vicon/Positions/m01_*" -d extracted
```

Train (seeded, so results are reproducible); this rewrites the model JSON and
`uiprmd/REPORT.md`:

```bash
npm --prefix frontend run train:uiprmd
```

Typecheck the training code:

```bash
cd frontend && npx tsc --noEmit -p ../ml/tsconfig.json
```

### Data notes

- Vicon positions are absolute, in mm, 100 Hz, 39 Plug-in Gait markers (x
  forward, y left, z up). Marker order was identified from the geometry of the
  data (the paper's tables sit behind a CAPTCHA): shoulders 9/16, front hip
  bones 23/24, back hip bones 25/26, knees 28/34, ankles 30/36.
- The hip joint is approximated as the midpoint of the front and back hip-bone
  markers, lowered by half the pelvis depth.
- Kinect files store joints relative to their parent, so they aren't used.
- Lunges aren't trained: UI-PRMD's inline lunge (FMS style, dowel behind the
  back) is a different movement from a gym lunge, and the app reads whichever
  knee the camera sees best, which may be the front or back leg.
