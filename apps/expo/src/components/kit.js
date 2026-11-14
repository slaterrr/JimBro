// Shared building blocks for the JimBro UI.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { R, T, type } from '../theme.js';
import { FRAME_MAX } from '../lib/layout.js';

export const Icon = ({ name, size = 22, color = T.text, style }) => (
  <MaterialCommunityIcons name={name} size={size} color={color} style={style} />
);

/** Jim's voice indicator: five rounded bars in the current accent. */
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
// More than 4 options don't fit a small phone, so the control scrolls sideways instead of squeezing.
export function Segmented({ options, value, onChange }) {
  const scroll = options.length > 4;
  const ref = React.useRef(null);
  const xs = React.useRef({});
  React.useEffect(() => { // keep the selected tab in view
    const x = xs.current[value];
    if (scroll && x !== undefined) ref.current?.scrollTo?.({ x: Math.max(0, x - 24), animated: true });
  }, [value, scroll]);
  const items = options.map(([v, label]) => {
    const on = v === value;
    return (
      <TouchableOpacity key={v} testID={`seg-${v}`} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}
        onPress={() => onChange(v)} onLayout={(e) => { xs.current[v] = e.nativeEvent.layout.x; }} style={[st.segmentItem, scroll && st.segmentScrollItem, on && st.segmentOn]}>
        <Text numberOfLines={scroll ? undefined : 1} style={[st.segmentText, on && { color: T.onAccent }]}>{label}</Text>
      </TouchableOpacity>
    );
  });
  return scroll ? (
    <View style={[st.segment, { paddingHorizontal: 0, paddingVertical: 0 }]}>
      <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 4, padding: 4 }}>{items}</ScrollView>
    </View>
  ) : (
    <View style={st.segment}>{items}</View>
  );
}

/** Dropdown: shows the current choice; tapping opens a scrollable list. options: [[value, label]]. */
export function Dropdown({ label, value, options, onChange, testID }) {
  const [open, setOpen] = React.useState(false);
  const current = options.find(([v]) => v === value)?.[1] ?? 'Choose';
  return (
    <View style={{ marginTop: 10 }}>
      {label ? <Text style={st.dropLabel}>{label}</Text> : null}
      <TouchableOpacity testID={testID} accessibilityRole="button" accessibilityLabel={`${label ?? 'Choose'}: ${current}`} onPress={() => setOpen(true)} style={st.drop}>
        <Text numberOfLines={1} style={st.dropText}>{current}</Text>
        <Icon name="chevron-down" color={T.textDim} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={st.dropBackdrop} onPress={() => setOpen(false)} accessibilityLabel="Close list">
          <View style={st.dropMenu}>
            {label ? <Text style={[st.dropLabel, { padding: 14, paddingBottom: 6 }]}>{label}</Text> : null}
            <ScrollView>
              {options.map(([v, l]) => {
                const on = v === value;
                return (
                  <TouchableOpacity key={String(v)} accessibilityRole="button" accessibilityLabel={l} accessibilityState={{ selected: on }}
                    onPress={() => { onChange(v); setOpen(false); }} style={[st.dropItem, on && { backgroundColor: T.accentSoft }]}>
                    <Text numberOfLines={1} style={[st.dropText, on && { color: T.accentText }]}>{l}</Text>
                    {on ? <Icon name="check" size={20} color={T.accent} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
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
            <TouchableOpacity accessibilityLabel="Close" onPress={onClose} style={{ padding: 10 }}>
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
  segmentScrollItem: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', paddingHorizontal: 16 },
  drop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: R.md, borderWidth: 1, borderColor: T.borderStrong, backgroundColor: T.surface },
  dropText: { color: T.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  dropLabel: { color: T.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 },
  dropBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  dropMenu: { maxHeight: '60%', backgroundColor: T.cardSolid, borderRadius: R.lg, borderWidth: 1, borderColor: T.border, overflow: 'hidden' },
  dropItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: T.border },
  segmentOn: { backgroundColor: T.accent, shadowColor: T.accent, shadowOpacity: 0.6, shadowRadius: 10, elevation: 4 },
  segmentText: { color: T.textDim, fontSize: 14, fontWeight: '600' },
  button: { backgroundColor: T.accent, borderRadius: R.md, paddingVertical: 15, alignItems: 'center', marginTop: 12 },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: T.borderStrong },
  buttonText: { color: T.onAccent, fontSize: 15, fontWeight: '700' },
  input: { backgroundColor: T.surface, color: T.text, borderWidth: 1, borderColor: T.border, borderRadius: R.sm, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { width: '100%', maxWidth: FRAME_MAX, alignSelf: 'center', maxHeight: '88%', backgroundColor: T.cardSolid, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, borderWidth: 1, borderColor: T.border, paddingHorizontal: 20 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: T.borderStrong, marginTop: 10 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
});
