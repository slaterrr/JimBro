// Shared building blocks for the JimBro UI.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { R, T, type } from '../theme.js';

export const Icon = ({ name, size = 22, color = T.text, style }) => (
  <MaterialCommunityIcons name={name} size={size} color={color} style={style} />
);

/** Jim's mark: five rounded voice bars in seafoam. */
export function JimBars({ height = 22, color = T.accent }) {
  const bars = [0.45, 0.75, 1, 0.75, 0.45];
  const w = height * 0.16;
  const gap = height * 0.12;
  return (
    <Svg width={bars.length * w + (bars.length - 1) * gap} height={height}>
      {bars.map((h, i) => (
        <Rect key={i} x={i * (w + gap)} y={(height * (1 - h)) / 2} width={w} height={height * h} rx={w / 2} fill={color} />
      ))}
    </Svg>
  );
}

export function Card({ children, style, onPress }) {
  const body = <View style={[st.card, style]}>{children}</View>;
  return onPress ? <TouchableOpacity activeOpacity={0.85} onPress={onPress}>{body}</TouchableOpacity> : body;
}

export function Pill({ children, active = false, onPress, style }) {
  return (
    <TouchableOpacity onPress={onPress} style={[st.pill, active && st.pillActive, style]}>
      <Text style={[st.pillText, active && st.pillTextActive]}>{children}</Text>
    </TouchableOpacity>
  );
}

/** Segmented control like the Progression tabs (Overview / Strength / Volume / PRs). */
export function Segmented({ options, value, onChange, singleLine = false }) {
  return (
    <View style={st.segment}>
      {options.map(([v, label]) => {
        const on = v === value;
        return (
          <TouchableOpacity key={v} onPress={() => onChange(v)} style={[st.segmentItem, on && st.segmentOn]}>
            <Text numberOfLines={singleLine ? 1 : undefined} adjustsFontSizeToFit={singleLine} minimumFontScale={0.8} style={[st.segmentText, singleLine && { fontSize: 13 }, on && { color: T.onAccent }]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function IconButton({ icon, onPress, size = 56, color = T.text, ring = T.borderStrong, fill = 'rgba(255,255,255,0.04)', label, children }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: ring, backgroundColor: fill, alignItems: 'center', justifyContent: 'center' }}
    >
      {children ?? <Icon name={icon} size={size * 0.42} color={color} />}
    </TouchableOpacity>
  );
}

export function PrimaryButton({ children, onPress, disabled, secondary = false, style }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[st.button, secondary && st.buttonSecondary, disabled && { opacity: 0.4 }, style]}
    >
      <Text style={[st.buttonText, secondary && { color: T.accentText }]}>{children}</Text>
    </TouchableOpacity>
  );
}

export function Field({ label, ...props }) {
  return (
    <View style={{ flex: 1 }}>
      {label ? <Text style={[type.label, { marginBottom: 6 }]}>{label}</Text> : null}
      <TextInput placeholderTextColor={T.textMute} {...props} style={[st.input, props.style]} />
    </View>
  );
}

export function Chips({ options, value, onChange, multi = false }) {
  return (
    <View style={st.chips}>
      {options.map(([v, label]) => {
        const on = multi ? value.includes(v) : value === v;
        return <Pill key={String(v)} active={on} onPress={() => onChange(v)}>{label}</Pill>;
      })}
    </View>
  );
}

/** Bottom sheet used for logging, settings, muscle details and plans. */
export function Sheet({ visible, onClose, title, children }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={st.backdrop} onPress={onClose} />
        <View style={st.sheet}>
          <View style={st.grabber} />
          <View style={st.sheetHeader}>
            <Text style={type.h2}>{title}</Text>
            <TouchableOpacity accessibilityLabel="Hide keyboard" onPress={Keyboard.dismiss} style={{ padding: 8 }}><Icon name="keyboard-close" color={T.textDim} /></TouchableOpacity>
            <TouchableOpacity accessibilityLabel="Close" onPress={onClose}>
              <Icon name="close" color={T.textDim} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flexShrink: 1 }} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const st = StyleSheet.create({
  card: { backgroundColor: T.card, borderColor: T.border, borderWidth: 1, borderRadius: R.lg, padding: 16 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: R.pill, borderWidth: 1, borderColor: T.border, backgroundColor: 'rgba(255,255,255,0.03)' },
  pillActive: { backgroundColor: T.accentSoft, borderColor: T.accent },
  pillText: { color: T.textDim, fontSize: 13, fontWeight: '600' },
  pillTextActive: { color: T.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segment: { flexDirection: 'row', backgroundColor: T.surface, borderRadius: R.pill, borderWidth: 1, borderColor: T.border, padding: 4 },
  segmentItem: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: R.pill, overflow: 'hidden' },
  segmentOn: { backgroundColor: T.accent, shadowColor: T.accent, shadowOpacity: 0.6, shadowRadius: 10, elevation: 4 },
  segmentText: { color: T.textDim, fontSize: 14, fontWeight: '600' },
  button: { backgroundColor: T.accent, borderRadius: R.md, paddingVertical: 15, alignItems: 'center', marginTop: 12 },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: T.borderStrong },
  buttonText: { color: T.onAccent, fontSize: 15, fontWeight: '700' },
  input: { backgroundColor: T.surface, color: T.text, borderWidth: 1, borderColor: T.border, borderRadius: R.sm, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { maxHeight: '88%', backgroundColor: T.cardSolid, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, borderWidth: 1, borderColor: T.border, paddingHorizontal: 20 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: T.borderStrong, marginTop: 10 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
});
