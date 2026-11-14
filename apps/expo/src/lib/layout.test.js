// Screen-size rules: one phone-width column on any screen, compact headers on narrow phones,
// and a camera stage that always leaves room for the controls and the tab bar.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FRAME_MAX, isCompact, stageHeight, topInset } from './layout.js';

describe('layout', () => {
  it('compact only on narrow phones', () => {
    assert.equal(isCompact(320), true);
    assert.equal(isCompact(359), true);
    assert.equal(isCompact(375), false);
    assert.equal(isCompact(1440), false); // desktop uses the phone-width column, not compact
  });

  it('frame is capped at a phone-to-small-tablet width', () => {
    assert.ok(FRAME_MAX >= 480 && FRAME_MAX <= 640);
  });

  it('camera stage fits the screen height, between a usable minimum and the design height', () => {
    assert.equal(stageHeight(1000), 520); // tall: design height
    assert.equal(stageHeight(568), 280); // iPhone SE: minimum, controls still visible
    const h = stageHeight(812);
    assert.ok(h >= 280 && h <= 520 && h <= 812 - 300, `812 -> ${h}`); // leaves ≥300 px for header, controls, tabs
    assert.equal(stageHeight(0), 280);
  });

  it('top inset: status bar on phones, small on web', () => {
    assert.equal(topInset('web'), 12);
    assert.equal(topInset('ios'), 50);
    assert.equal(topInset('android', 24), 24);
  });
});

describe('segmentFits', () => {
  it('six Progress tabs do not fit a 320 px phone but fit the 560 px column; three short ones fit anywhere', async () => {
    const { segmentFits } = await import('./layout.js');
    const six = ['Overview', 'Strength', 'Volume', 'PRs', 'History', 'Goals'];
    assert.equal(segmentFits(six, 288), false);
    assert.equal(segmentFits(six, 528), true);
    assert.equal(segmentFits(['Workout', 'Month', 'Year'], 240), true);
    assert.equal(segmentFits(six, 0), true); // not measured yet: keep the normal layout
  });
});

describe('stageOverlays (Coach camera stage: nothing hidden behind the Jim cue card)', () => {
  const noOverlap = (o, H) => {
    assert.ok(o.topBottom <= o.cueTop, `top boxes ${o.topBottom} overlap cue ${o.cueTop} @${H}`);
    if (o.caughtTop != null) assert.ok(o.caughtTop + 40 <= o.cueTop, `caught overlaps cue @${H}`);
    if (o.suggestInStage) assert.ok(o.suggestTop + 90 <= o.cueTop, `suggestion overlaps cue @${H}`);
  };

  it('small phone (280 px stage): four rep details would cover the cue, so they are trimmed', async () => {
    const { stageOverlays } = await import('./layout.js');
    const o = stageOverlays(280, { repLines: 4 });
    assert.ok(o.repLines < 4 && o.repLines >= 1, `lines ${o.repLines}`);
    noOverlap(o, 280);
  });

  it('small phone: the switch suggestion moves below the stage instead of hiding the cue', async () => {
    const { stageOverlays } = await import('./layout.js');
    const o = stageOverlays(280, { repLines: 4, suggestion: true, caught: true });
    assert.equal(o.suggestInStage, false);
    assert.ok(o.caughtTop != null); // the caught badge always stays in the stage
    noOverlap(o, 280);
  });

  it('tall phone (520 px stage): everything fits in the stage', async () => {
    const { stageOverlays } = await import('./layout.js');
    const o = stageOverlays(520, { repLines: 4, suggestion: true, caught: true });
    assert.equal(o.repLines, 4);
    assert.equal(o.suggestInStage, true);
    noOverlap(o, 520);
  });

  it('no overlap at any stage height with any combination', async () => {
    const { stageOverlays } = await import('./layout.js');
    for (let H = 200; H <= 520; H += 10) for (const caught of [false, true]) for (const suggestion of [false, true]) {
      noOverlap(stageOverlays(H, { repLines: 4, caught, suggestion }), H);
    }
  });
});

describe('stageHeight with a mission running', () => {
  it('shrinks the stage so the mission panel starts on screen on small phones', async () => {
    const { stageHeight } = await import('./layout.js');
    assert.ok(stageHeight(568, { mission: true }) < stageHeight(568), 'SE');
    assert.ok(stageHeight(667, { mission: true }) < stageHeight(667), '375x667');
    assert.ok(stageHeight(568, { mission: true }) >= 220, 'still shows the body');
    assert.equal(stageHeight(1200, { mission: true }), 520);
  });
});
