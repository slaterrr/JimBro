// Jim-blue palette: contrast of text tokens on the dark app background (WCAG AA >= 4.5:1).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ACCENT, BG, SURFACES, CHAT, TEXT, contrast } from './palette.js';

const report = [];

describe('palette', () => {
  it('computes WCAG contrast ratios', () => {
    assert.equal(contrast('#000000', '#ffffff').toFixed(1), '21.0');
    assert.equal(contrast('#ffffff', '#ffffff'), 1);
  });
  it('uses the mascot body blue and coordinated blue shades', () => {
    assert.equal(ACCENT.accent, '#98ccea');
    for (const hex of [ACCENT.accent, ACCENT.accentDeep, ACCENT.accentText]) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      assert.ok(b > g && g > r, `${hex} should be blue`);
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

// Review workspace must use the shared palette instead of stale green hardcoded colors.
it('review workspace text and blue actions remain readable on every surface', () => {
  for (const bg of [BG, SURFACES.surface, SURFACES.cardSolid, CHAT.background, CHAT.sidebar, CHAT.raised, CHAT.selected, CHAT.tinted, CHAT.composer]) {
    for (const text of [TEXT.text, TEXT.textDim, TEXT.textMute, ACCENT.accent, ACCENT.accentText]) {
      assert.ok(contrast(text, bg) >= 4.5, `${text} on ${bg} must pass AA`);
    }
  }
});
