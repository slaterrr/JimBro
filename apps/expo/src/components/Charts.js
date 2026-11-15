// Line chart (Total Strength) and bar chart (weekly volume), styled like the mockup:
// seafoam 2px line with dot markers over a gradient area, recessive axis labels.
import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Line, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { T } from '../theme.js';

function scale(values, ticks = 6) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.max(10, hi * 0.1);
  const step = Math.max(1, Math.ceil(span / (ticks - 1) / 5) * 5);
  const min = Math.floor((lo - step * 0.5) / step) * step;
  // Rounding the lower bound down must not place the highest point above the chart.
  const max = Math.max(min + step * (ticks - 1), Math.ceil((hi + step * 0.5) / step) * step);
  return { min, max, step };
}

export function LineChart({ points, height = 150, width = 300 }) {
  if (!points.length || points.every((p) => !p.value)) {
    return <Text style={{ color: T.textMute, paddingVertical: 30, textAlign: 'center' }}>Log a few sets to see your trend.</Text>;
  }
  const L = 34;
  const B = 22;
  const { min, max, step } = scale(points.map((p) => p.value));
  const x = (i) => L + 8 + (i * (width - L - 40)) / Math.max(1, points.length - 1);
  const y = (v) => 12 + ((max - v) / (max - min)) * (height - B - 18);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${height - B} L${x(0)},${height - B} Z`;
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step);
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <LinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={T.accent} stopOpacity="0.45" />
          <Stop offset="1" stopColor={T.accent} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      {ticks.map((t) => (
        <SvgText key={t} x={L - 6} y={y(t) + 4} fontSize="10" fontFamily="System, Arial" fill={T.textDim} textAnchor="end">{t}</SvgText>
      ))}
      <Line x1={L} x2={L} y1={4} y2={height - B} stroke={T.border} strokeWidth="1" />
      <Path d={area} fill="url(#area)" />
      <Path d={line} stroke={T.accent} strokeWidth="2.5" fill="none" strokeLinejoin="round" />
      {points.map((p, i) => (
        <Circle key={i} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 5 : 4} fill={i === points.length - 1 ? T.accentLight : T.accentText} stroke={T.accentDeep} strokeWidth="1.5" />
      ))}
      {points.map((p, i) => (
        <SvgText key={`l${i}`} x={x(i)} y={height - 5} fontSize="11" fontFamily="System, Arial" fill={T.textDim} textAnchor="middle">{p.label}</SvgText>
      ))}
    </Svg>
  );
}

export function BarChart({ points, height = 150, width = 300, unit }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const B = 22;
  const bw = (width - 20) / points.length;
  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <LinearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={T.accent} />
            <Stop offset="1" stopColor={T.accentDeep} />
          </LinearGradient>
        </Defs>
        {points.map((p, i) => {
          const h = ((height - B - 18) * p.value) / max;
          const bx = 10 + i * bw + bw * 0.2;
          return (
            <React.Fragment key={i}>
              <Rect x={bx} y={height - B - h} width={bw * 0.6} height={Math.max(h, 2)} rx={4} fill="url(#bar)" />
              <SvgText x={bx + bw * 0.3} y={height - B - h - 5} fontSize="10" fontFamily="System, Arial" fill={T.textDim} textAnchor="middle">
                {p.value ? Math.round(p.value).toLocaleString() : ''}
              </SvgText>
              <SvgText x={bx + bw * 0.3} y={height - 5} fontSize="11" fontFamily="System, Arial" fill={T.textDim} textAnchor="middle">{p.label}</SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
      {unit ? <Text style={{ color: T.textMute, fontSize: 11, textAlign: 'right' }}>{unit} × reps per week</Text> : null}
    </View>
  );
}
