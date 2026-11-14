// Screen-size rules shared by the shell and screens (pure, so they are unit-tested).

/** The app is one phone-width column; wider screens (tablet, desktop web) center it. */
export const FRAME_MAX = 560;

/** Narrow phones (iPhone SE / mini width) get compact headers. */
export const isCompact = (width) => width < 360;

const STAGE_MIN = 280; // still big enough to see the whole body
const STAGE_MAX = 520; // the design height
const STAGE_RESERVE = 340; // header + controls + tab bar + status bar

/** Camera stage height that leaves the controls and tab bar on screen. */
export const stageHeight = (windowHeight) =>
  Math.round(Math.min(STAGE_MAX, Math.max(STAGE_MIN, (windowHeight || 0) - STAGE_RESERVE)));

/** Space above the app: status bar on phones, a small margin on web. */
export const topInset = (os, androidStatusBar = 24) => (os === 'web' ? 12 : os === 'android' ? androidStatusBar : 50);

const CHAR_PX = 8; // 14 px semibold label, average glyph width
const ITEM_PAD = 20; // horizontal padding per segment
/** Whether segmented tabs fit `width` with full labels; unmeasured (0) counts as fitting. */
export const segmentFits = (labels, width) =>
  !width || labels.reduce((sum, l) => sum + String(l).length * CHAR_PX + ITEM_PAD, 8) <= width;
