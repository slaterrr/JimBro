// JimBro design tokens (dark violet glass, neon green for gains), from the UI mockup.
import { StyleSheet } from 'react-native';

export const T = {
  bg: '#070c0b',
  surface: '#101a17',
  card: 'rgba(22, 38, 32, 0.92)',
  cardSolid: '#15231e',
  border: '#23382f',
  borderStrong: '#305044',
  purple: '#80d8be',
  purpleDeep: '#369f87',
  purpleSoft: 'rgba(128, 216, 190, 0.18)',
  violetText: '#b6efdf',
  green: '#4ade80',
  greenBright: '#39ff5a',
  greenSoft: '#a3f0a8',
  red: '#ef4444',
  amber: '#f5c451',
  text: '#ffffff',
  textDim: '#b8b3c4',
  textMute: '#7d7789',
  rest: '#5a5763',
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
