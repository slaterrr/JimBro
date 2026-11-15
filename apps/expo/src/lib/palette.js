// Pure colour values (no React Native) so contrast can be unit-tested; theme.js builds T from these.

export const BG = '#070c12';

export const SURFACES = {
  surface: '#101922',
  card: 'rgba(21, 34, 46, 0.92)',
  cardSolid: '#15222e',
  border: '#263b4b',
  borderStrong: '#395568',
};

export const ACCENT = {
  accent: '#98ccea', // sampled from JimBro_v2.png's blue body
  accentDeep: '#4b91ba', // gradient ends, strokes
  accentSoft: 'rgba(152, 204, 234, 0.18)', // selected pill / bubble fill
  accentText: '#c5e5f7', // light blue text on dark
  accentLight: '#e3f4ff', // highlight dots
  onAccent: '#0a2233', // text drawn on an accent fill
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
