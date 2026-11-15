// Review theme: graphite, Jim's body blue, cream neutrals and muted success colors.
import { StyleSheet } from 'react-native';

import { ACCENT, BG, SURFACES, CHAT, TEXT } from './lib/palette.js';

export const T = {
  bg: BG,
  chat: CHAT,
  ...TEXT,
  highlight: '#e9dfa8',
  ...SURFACES,
  ...ACCENT,
  // Legacy names kept for other branches: they now resolve to Jim blue.
  purple: ACCENT.accent,
  purpleDeep: ACCENT.accentDeep,
  purpleSoft: ACCENT.accentSoft,
  violetText: ACCENT.accentText,
  green: '#9dceb3',
  greenBright: '#b7dfc4',
  greenSoft: '#d4e6d8',
  red: '#ef4444',
  amber: '#f5c451',
  rest: '#556674',
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
