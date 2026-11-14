import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { R, T } from '../theme.js';
import { Icon } from './kit.js';

export const TABS = [
  { id: 'Home', icon: 'home-outline', active: 'home' },
  { id: 'Muscles', icon: 'arm-flex-outline', active: 'arm-flex' },
  { id: 'Coach', icon: 'camera-outline', active: 'video' },
  { id: 'Progress', icon: 'chart-bar', active: 'chart-bar' },
];

export function TabBar({ tab, onChange }) {
  return (
    <View style={st.bar}>
      {TABS.map((t) => {
        const on = t.id === tab;
        return (
          <TouchableOpacity
            key={t.id}
            accessibilityRole="tab"
            accessibilityLabel={t.id}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(t.id)}
            style={[st.item, on && st.itemOn]}
          >
            <Icon name={on ? t.active : t.icon} size={24} color={on ? T.accent : T.textDim} />
            <Text style={[st.label, on && { color: T.accentText }]}>{t.id}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: 1, borderColor: T.border, backgroundColor: T.surface, paddingTop: 8, paddingBottom: 18, paddingHorizontal: 8 },
  item: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: R.md },
  itemOn: { backgroundColor: T.accentSoft },
  label: { color: T.textDim, fontSize: 11, fontWeight: '600', marginTop: 3 },
});
