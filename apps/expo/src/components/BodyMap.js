// Front and back anatomy figures; each muscle group is a tappable shape coloured by
// how recently it was trained (trained / recent / rest), like the Muscles mockup.
import React from 'react';
import Svg, { Ellipse, G, Path, Rect } from 'react-native-svg';

import { T } from '../theme.js';

export const STATUS_COLOR = { trained: T.greenBright, recent: T.greenSoft, rest: T.rest };
const BASE = '#2a2a2e';
const EDGE = '#141416';

/** Mirror a path drawn for the figure's right side (screen left) across x = 100. */
const mirror = (shapes) => shapes.map((s) => ({ ...s, mirror: true }));

function Shape({ s, fill, onPress }) {
  const common = { fill, stroke: EDGE, strokeWidth: 1.2, onPress };
  const el =
    s.e ? <Ellipse cx={s.e[0]} cy={s.e[1]} rx={s.e[2]} ry={s.e[3]} rotation={s.r ?? 0} origin={`${s.e[0]}, ${s.e[1]}`} {...common} />
      : s.rect ? <Rect x={s.rect[0]} y={s.rect[1]} width={s.rect[2]} height={s.rect[3]} rx={s.rect[4] ?? 3} {...common} />
        : <Path d={s.d} {...common} />;
  return s.mirror ? <G transform="translate(200,0) scale(-1,1)">{el}</G> : el;
}

// Silhouette (head, neck, torso, arms, hands, legs, feet), shared by both views.
const SILHOUETTE = [
  { e: [100, 30, 17, 21] },
  { rect: [92, 48, 16, 14, 4] },
  { d: 'M66 66 Q100 56 134 66 L142 92 Q140 150 128 206 L72 206 Q60 150 58 92 Z' },
  { d: 'M60 74 Q44 80 40 104 L34 168 Q30 196 26 226 L36 228 Q46 196 50 170 L58 120 Z' },
  { d: 'M140 74 Q156 80 160 104 L166 168 Q170 196 174 226 L164 228 Q154 196 150 170 L142 120 Z' },
  { e: [30, 236, 7, 11] }, { e: [170, 236, 7, 11] },
  { d: 'M72 204 L98 206 L96 300 L94 380 L80 380 L74 300 Q68 250 72 204 Z' },
  { d: 'M128 204 L102 206 L104 300 L106 380 L120 380 L126 300 Q132 250 128 204 Z' },
  { e: [86, 388, 11, 6] }, { e: [114, 388, 11, 6] },
];

const FRONT = {
  traps: [{ d: 'M86 60 Q100 64 114 60 L122 70 Q100 66 78 70 Z' }],
  shoulders: [{ e: [62, 86, 13, 16], r: -15 }, ...mirror([{ e: [62, 86, 13, 16], r: -15 }])],
  chest: [{ d: 'M99 76 L72 80 Q64 96 70 112 Q86 122 99 116 Z' }, ...mirror([{ d: 'M99 76 L72 80 Q64 96 70 112 Q86 122 99 116 Z' }])],
  biceps: [{ e: [50, 124, 8, 20], r: 10 }, ...mirror([{ e: [50, 124, 8, 20], r: 10 }])],
  forearms: [{ e: [40, 182, 7, 24], r: 8 }, ...mirror([{ e: [40, 182, 7, 24], r: 8 }])],
  abs: [0, 1, 2].flatMap((row) => [
    { rect: [86, 124 + row * 24, 13, 20, 4] },
    { rect: [101, 124 + row * 24, 13, 20, 4] },
  ]),
  quads: [{ d: 'M76 212 Q90 210 97 216 L95 290 Q86 300 78 290 Q70 250 76 212 Z' }, ...mirror([{ d: 'M76 212 Q90 210 97 216 L95 290 Q86 300 78 290 Q70 250 76 212 Z' }])],
  calves: [{ e: [84, 338, 8, 28] }, ...mirror([{ e: [84, 338, 8, 28] }])],
};

const BACK = {
  traps: [{ d: 'M100 58 L74 74 Q86 92 100 130 Q114 92 126 74 Z' }],
  shoulders: [{ e: [62, 86, 13, 16], r: -15 }, ...mirror([{ e: [62, 86, 13, 16], r: -15 }])],
  lats: [{ d: 'M98 96 L76 92 Q64 120 74 168 Q88 172 98 160 Z' }, ...mirror([{ d: 'M98 96 L76 92 Q64 120 74 168 Q88 172 98 160 Z' }])],
  triceps: [{ e: [50, 124, 8, 20], r: 10 }, ...mirror([{ e: [50, 124, 8, 20], r: 10 }])],
  forearms: [{ e: [40, 182, 7, 24], r: 8 }, ...mirror([{ e: [40, 182, 7, 24], r: 8 }])],
  lower_back: [{ rect: [86, 166, 28, 30, 6] }],
  glutes: [{ e: [86, 222, 14, 17] }, ...mirror([{ e: [86, 222, 14, 17] }])],
  hamstrings: [{ d: 'M74 242 Q86 238 97 244 L95 300 Q86 306 78 298 Q70 270 74 242 Z' }, ...mirror([{ d: 'M74 242 Q86 238 97 244 L95 300 Q86 306 78 298 Q70 270 74 242 Z' }])],
  calves: [{ e: [84, 338, 9, 28] }, ...mirror([{ e: [84, 338, 9, 28] }])],
};

export function BodyFigure({ side = 'front', status, onSelect, width = 150 }) {
  const groups = side === 'front' ? FRONT : BACK;
  return (
    <Svg width={width} height={(width * 400) / 200} viewBox="0 0 200 400">
      {SILHOUETTE.map((s, i) => <Shape key={`b${i}`} s={s} fill={BASE} />)}
      {Object.entries(groups).flatMap(([group, shapes]) =>
        shapes.map((s, i) => (
          <Shape key={`${group}${i}`} s={s} fill={STATUS_COLOR[status[group] ?? 'rest']} onPress={() => onSelect(group)} />
        )),
      )}
    </Svg>
  );
}
