// Screen-size rules shared by the shell and screens (pure, so they are unit-tested).

/** The app is one phone-width column; wider screens (tablet, desktop web) center it. */
export const FRAME_MAX = 560;

/** Narrow phones (iPhone SE / mini width) get compact headers. */
export const isCompact = (width) => width < 360;

const STAGE_MIN = 280; // still big enough to see the whole body
const STAGE_MAX = 520; // the design height
const STAGE_RESERVE = 340; // header + controls + tab bar + status bar
const STAGE_MIN_MISSION = 240; // a running mission panel sits under the stage; shrink so it starts on screen
const MISSION_RESERVE = 120; // mission title + its primary button

/** Camera stage height that leaves the controls (or the mission panel) and tab bar on screen. */
export const stageHeight = (windowHeight, { mission = false } = {}) => {
  const min = mission ? STAGE_MIN_MISSION : STAGE_MIN;
  const reserve = STAGE_RESERVE + (mission ? MISSION_RESERVE : 0);
  return Math.round(Math.min(STAGE_MAX, Math.max(min, (windowHeight || 0) - reserve)));
};

// Overlay sizes on the camera stage (px, measured from the web render at 14–16 px text).
const EDGE = 12;
const GAP = 8;
const EXERCISE_H = 84; // name + set + camera-status line
const REPS_BASE_H = 82; // "Reps" + count
const REPS_LINE_H = 18; // each extra line (push-up type, last rep, speed, effort)
const CUE_H = 118; // Jim cue card, up to three lines of guidance on a 320 px phone
const CAUGHT_H = 40;
const SUGGEST_H = 90;

/**
 * Where the Coach stage overlays go so none hides another or the Jim cue at the bottom.
 * Trims the reps box's extra lines and moves the switch suggestion below the stage when short.
 */
export const stageOverlays = (H, { repLines = 0, caught = false, suggestion = false } = {}) => {
  const cueTop = H - EDGE - CUE_H;
  const caughtRoom = caught ? CAUGHT_H + GAP : 0;
  const avail = cueTop - GAP - EDGE - REPS_BASE_H - caughtRoom;
  const lines = Math.max(0, Math.min(repLines, Math.floor(avail / REPS_LINE_H)));
  const topBottom = EDGE + Math.max(EXERCISE_H, REPS_BASE_H + REPS_LINE_H * lines);
  let caughtTop = null;
  if (caught) caughtTop = topBottom + GAP + CAUGHT_H <= cueTop ? topBottom + GAP : EDGE; // tiny stage: brief badge over the top boxes
  const suggestTop = (caught && caughtTop > EDGE ? caughtTop + CAUGHT_H : topBottom) + GAP;
  const suggestInStage = !!suggestion && suggestTop + SUGGEST_H + GAP <= cueTop;
  return { cueTop, topBottom, repLines: lines, caughtTop, suggestTop, suggestInStage };
};

/** Space above the app: status bar on phones, a small margin on web. */
export const topInset = (os, androidStatusBar = 24) => (os === 'web' ? 12 : os === 'android' ? androidStatusBar : 50);

const CHAR_PX = 8; // 14 px semibold label, average glyph width
const ITEM_PAD = 20; // horizontal padding per segment
/** Whether segmented tabs fit `width` with full labels; unmeasured (0) counts as fitting. */
export const segmentFits = (labels, width) =>
  !width || labels.reduce((sum, l) => sum + String(l).length * CHAR_PX + ITEM_PAD, 8) <= width;
