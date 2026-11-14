// Shared look from the first Expo prototype (green-on-dark, chips, cards, Jim plate).
import React from 'react';
import { StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

export const C = {
  bg: '#101310', card: '#1b231b', border: '#344432', green: '#c9ed96',
  text: '#f2f4ed', muted: '#a5b29f', warn: '#f0c674', bad: '#ff8a80',
};

export function Button({ children, onPress, secondary = false, disabled = false }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[s.button, secondary && s.secondary, disabled && s.disabled]}
    >
      <Text style={[s.buttonText, secondary && s.secondaryText]}>{children}</Text>
    </TouchableOpacity>
  );
}

export function Chip({ label, selected, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[s.chip, selected && s.chipSelected]}>
      <Text style={[s.chipText, selected && s.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

export const Card = ({ children, style }) => <View style={[s.card, style]}>{children}</View>;
export const Label = ({ children }) => <Text style={s.label}>{children}</Text>;
export const Kicker = ({ children }) => <Text style={s.kicker}>{children}</Text>;
export const Title = ({ children }) => (
  <Text style={s.title}>
    {children}
    <Text style={s.dot}>.</Text>
  </Text>
);

export function Metric({ title, value }) {
  return (
    <View style={s.metric}>
      <Text style={s.metricLabel}>{title}</Text>
      <Text style={s.metricValue}>{value}</Text>
    </View>
  );
}

/** options: array of strings or [value, label] pairs. */
export function Choice({ title, options, value, onChange }) {
  return (
    <View style={s.field}>
      {title ? <Label>{title}</Label> : null}
      <View style={s.chips}>
        {options.map((o) => {
          const [v, label] = Array.isArray(o) ? o : [o, o];
          return <Chip key={String(v)} label={label} selected={value === v} onPress={() => onChange(v)} />;
        })}
      </View>
    </View>
  );
}

export function JimPortrait({ size = 250 }) {
  return (
    <View accessibilityLabel="Jim, a smiling green weight plate" style={{ alignItems: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 250 250">
        <Circle cx="125" cy="125" r="112" fill="#263927" stroke="#526d49" strokeWidth="2" />
        <Line x1="21" y1="125" x2="229" y2="125" stroke="#78926b" strokeWidth="13" strokeLinecap="round" />
        <Rect x="20" y="91" width="18" height="68" rx="5" fill="#92b178" />
        <Rect x="212" y="91" width="18" height="68" rx="5" fill="#92b178" />
        <Circle cx="125" cy="125" r="84" fill="#c9ed96" stroke="#e4ffc0" strokeWidth="5" />
        <Circle cx="125" cy="125" r="71" fill="none" stroke="#96be6e" strokeWidth="2" />
        <Circle cx="98" cy="113" r="7" fill="#1d301a" />
        <Circle cx="152" cy="113" r="7" fill="#1d301a" />
        <Path d="M95 144 Q125 174 155 144" fill="none" stroke="#1d301a" strokeWidth="7" strokeLinecap="round" />
      </Svg>
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg, paddingTop: StatusBar.currentHeight || 45 },
  header: { height: 52, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: C.border },
  brand: { color: C.text, fontSize: 25, fontWeight: '900' },
  dot: { color: C.green },
  pill: { fontSize: 10, fontWeight: '800', letterSpacing: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 50, borderWidth: 1, overflow: 'hidden' },
  content: { padding: 18, paddingBottom: 35 },
  kicker: { color: C.green, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 8 },
  heroTitle: { color: C.text, fontSize: 42, fontWeight: '900', lineHeight: 48, marginTop: 14 },
  green: { color: C.green },
  title: { color: C.text, fontSize: 37, fontWeight: '900', marginBottom: 12 },
  body: { color: C.muted, fontSize: 14, lineHeight: 21, marginBottom: 8 },
  button: { backgroundColor: C.green, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 12 },
  buttonText: { color: '#1b2b17', fontSize: 14, fontWeight: '900' },
  secondary: { backgroundColor: '#273527', borderWidth: 1, borderColor: '#496043' },
  secondaryText: { color: C.green },
  disabled: { opacity: 0.45 },
  card: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 17, padding: 20, marginTop: 16 },
  cardTitle: { color: C.text, fontSize: 22, fontWeight: '800', marginBottom: 10 },
  metrics: { flexDirection: 'row', gap: 8, marginTop: 20 },
  metric: { flex: 1, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  metricLabel: { color: C.muted, fontSize: 9, fontWeight: '800' },
  metricValue: { color: C.text, fontSize: 23, fontWeight: '900', marginTop: 6 },
  field: { marginTop: 12 },
  label: { color: C.muted, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderColor: '#475a43', borderWidth: 1, borderRadius: 50, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#263126' },
  chipSelected: { backgroundColor: C.green, borderColor: C.green },
  chipText: { color: '#c5d2c0', fontSize: 12, fontWeight: '800' },
  chipTextSelected: { color: '#182714' },
  input: { backgroundColor: '#111811', color: C.text, borderWidth: 1, borderColor: '#40513d', borderRadius: 9, padding: 12, marginBottom: 8 },
  inputRow: { flexDirection: 'row', gap: 10 },
  inputHalf: { flex: 1 },
  rowText: { color: C.text, fontSize: 14, fontWeight: '700', marginTop: 8 },
  set: { borderTopWidth: 1, borderColor: C.border, paddingTop: 11, marginTop: 11 },
  fine: { color: '#8d9e87', fontSize: 11, lineHeight: 17, marginTop: 12 },
  message: { backgroundColor: '#293929', color: C.text, borderLeftWidth: 3, borderColor: C.green, padding: 15, borderRadius: 8, marginVertical: 8 },
  mine: { backgroundColor: '#1f2b1f', borderColor: C.muted },
  bigStat: { color: C.green, fontSize: 35, fontWeight: '900', marginTop: 12 },
  liveCount: { color: C.green, fontSize: 64, fontWeight: '900', textAlign: 'center' },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: C.border, backgroundColor: '#172017', paddingBottom: 8, paddingTop: 7 },
  tab: { flex: 1, alignItems: 'center' },
  tabIcon: { color: '#82917e', fontSize: 22 },
  tabLabel: { color: '#82917e', fontSize: 10, fontWeight: '700', marginTop: 2 },
  selectedTab: { color: C.green },
  error: { color: C.bad, marginTop: 8 },
});
