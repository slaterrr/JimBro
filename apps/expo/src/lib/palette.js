// Pure colour values (no React Native) so contrast can be unit-tested; theme.js builds T from these.

export const BG = '#060a09';

export const SURFACES = {
  surface: '#0e1514',
  card: 'rgba(20, 31, 29, 0.92)',
  cardSolid: '#141e1c',
  border: '#22312e',
  borderStrong: '#30443f',
};

export const ACCENT = {
  accent: '#3ec9a7', // seafoam: icons, active states, button fill, chart line
  accentDeep: '#1f8f78', // gradient ends, strokes
  accentSoft: 'rgba(62, 201, 167, 0.18)', // selected pill / bubble fill
  accentText: '#a7f3df', // light seafoam text on dark
  accentLight: '#c9f8ec', // highlight dots
  onAccent: '#04201a', // text drawn on an accent fill
};

const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colours (1..21). */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
