// JimBro design tokens (dark glass with a seafoam accent, neon green for gains).
import { StyleSheet } from 'react-native';

import { ACCENT, BG, SURFACES } from './lib/palette.js';

export const T = {
  bg: BG,
  ...SURFACES,
  ...ACCENT,
  // Legacy names kept for other branches: they now resolve to seafoam, not purple.
  purple: ACCENT.accent,
  purpleDeep: ACCENT.accentDeep,
  purpleSoft: ACCENT.accentSoft,
  violetText: ACCENT.accentText,
  green: '#4ade80',
  greenBright: '#39ff5a',
  greenSoft: '#a3f0a8',
  red: '#ef4444',
  amber: '#f5c451',
  text: '#ffffff',
  textDim: '#b3c2be',
  textMute: '#7a8a86',
  rest: '#56605e',
};

export const R = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 };

export const type = StyleSheet.create({
  h1: { color: T.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  h2: { color: T.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
  title: { color: T.text, fontSize: 17, fontWeight: '700' },
  body: { color: T.textDim, fontSize: 15, lineHeight: 22 },
  small: { color: T.textMute, fontSize: 12, lineHeight: 17 },
  label: { color: T.textDim, fontSize: 13, fontWeight: '600' },
  bigGreen: { color: T.green, fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  statGreen: { color: T.green, fontSize: 22, fontWeight: '800' },
});
