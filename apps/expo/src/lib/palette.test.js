// Jim-blue palette: contrast of text tokens on the dark app background (WCAG AA >= 4.5:1).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ACCENT, BG, SURFACES, contrast } from './palette.js';

const report = [];

describe('palette', () => {
  it('computes WCAG contrast ratios', () => {
    assert.equal(contrast('#000000', '#ffffff').toFixed(1), '21.0');
    assert.equal(contrast('#ffffff', '#ffffff'), 1);
  });
  it('uses warm coral from the supplied red mascot', () => {
    for (const hex of [ACCENT.accent, ACCENT.accentDeep, ACCENT.accentText]) {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
      assert.ok(r > g && r > b && Math.abs(g - b) < 30, `${hex} should be warm coral`);
    }
  });
  it('accent text tokens pass AA (>= 4.5:1) on the background and cards', () => {
    for (const bg of [BG, SURFACES.surface, SURFACES.cardSolid]) {
      for (const k of ['accent', 'accentText']) {
        const r = contrast(ACCENT[k], bg);
        report.push(`${k} ${ACCENT[k]} on ${bg}: ${r.toFixed(2)}:1`);
        assert.ok(r >= 4.5, `${k} on ${bg} = ${r.toFixed(2)}`);
      }
    }
  });
  it('text on the accent button fill passes AA', () => {
    const r = contrast(ACCENT.onAccent, ACCENT.accent);
    report.push(`onAccent ${ACCENT.onAccent} on accent ${ACCENT.accent}: ${r.toFixed(2)}:1`);
    assert.ok(r >= 4.5);
    if (process.env.PALETTE_REPORT) console.log(report.join('\n'));
  });
});
