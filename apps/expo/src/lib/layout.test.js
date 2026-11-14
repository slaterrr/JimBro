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
