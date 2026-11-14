# Equipment detection: evaluation and plan

Goal: track the actual load (barbell, dumbbells, plates) rather than assuming wrist or hip motion
matches it. Facts below were checked against primary sources on 2026-11-14. Licences must be
re-checked before shipping.

## Candidates
| Option | Gym classes | Licence | Runs on a phone / in the browser? | Verdict |
|---|---|---|---|---|
| MediaPipe Object Detector (EfficientDet-Lite0/2, SSD MobileNetV2) | **None.** COCO's 80 classes have no dumbbell, barbell, kettlebell or plate (closest: "sports ball", "bench") | Not stated on the docs page; MediaPipe is generally Apache-2.0 (verify) | Yes, real time; same runtime as our pose model | Not usable as-is; a good base for **fine-tuning** (Model Maker) |
| Open Images V7 data | **"Dumbbell" only.** No barbell, kettlebell or weight plate. Related: "Training bench", "Horizontal bar" | Annotations CC BY 4.0; images listed as CC BY 2.0, **each image's licence must be verified** | n/a (data) | Useful dumbbell training data, after a per-image licence check |
| OWL-ViT base/32 (open-vocabulary: prompt "barbell", "weight plate") | Any text prompt | Apache-2.0 (model card calls it a research output) | Browser build exists (transformers.js / ONNX, Xenova/owlvit-base-patch32); about 0.2B parameters, **too heavy for live phone use** | **Best near-term research tool:** offline labelling assistant and post-set analysis on a laptop. Needs a speed benchmark |
| OWLv2 base/16 | Any text prompt | Apache-2.0 | No browser build found; about 0.2B parameters | Same role as OWL-ViT; more accurate per the authors, heavier |
| YOLO-World | Any text prompt | **GPL-3.0** (commercial licence on request) | Not checked | **Avoid in the shipped app** unless licensed |
| Grounding DINO (T/B) | Any text prompt | Apache-2.0 | Size and latency undocumented; CPU mode exists; no browser build | Server-side or offline only |

**Conclusion:** no off-the-shelf model detects barbells and plates live on a phone. The realistic path:
1. **Now (built):** a detector interface, tracker and bar-path maths (`lib/equipment.js`), tested
   with synthetic detections, so any detector can plug in later.
2. **Next:** label a few hundred consented gym frames (dumbbell, barbell, plate). OWL-ViT can
   pre-label offline, with humans correcting the labels. Fine-tune EfficientDet-Lite0 with MediaPipe
   Model Maker so it runs in the same runtime as the pose model.
3. **Then:** calibrated bar speed from plate size (below), validated against a linear position
   transducer before any m/s number reaches users.

## Calibration (implemented, unvalidated)
A standard Olympic plate is 450 mm across. When a plate faces the camera (its box is roughly square,
aspect 0.85–1.15), metres per image unit = 0.45 / box height, so bar displacement and speed can be
expressed in metres. Assumptions, all listed in the output:
- the plate is a standard 450 mm plate; the user must confirm this, since small plates differ;
- it faces the camera;
- the camera is level;
- lens distortion is ignored.

The code returns `calibrated: true, validated: false`. The app must not show m/s until validation
against a reference device exists.

## Benchmark (pending a download)
Measuring OWL-ViT's per-frame time in Node or the browser means downloading its weights (about
600 MB in F32; a quantized ONNX build is smaller) and a licensed test image. That download needs
your OK; nothing has been downloaded.
