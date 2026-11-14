import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Icon, Sheet } from './kit.js';
import { T, type } from '../theme.js';

export function DateDropdown({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.key === value);
  return <View style={{ marginTop: 12 }}>
    <Text style={[type.label, { marginBottom: 6 }]}>{label}</Text>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label ?? 'Select date'}`} accessibilityState={{ expanded: open }}
      onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderWidth: 1, borderColor: T.borderStrong, borderRadius: 12 }}>
      <Text numberOfLines={1} style={[type.body, { flex: 1 }]}>{selected?.label ?? 'Select date'}</Text>
      <Icon name="chevron-down" />
    </TouchableOpacity>
    <Sheet visible={open} onClose={() => setOpen(false)} title={`${label} date`}>
      {options.map(o => <TouchableOpacity key={o.key} accessibilityRole="button" accessibilityState={{ selected: o.key === value }}
        onPress={() => { onChange(o.key); setOpen(false); }} style={{ paddingVertical: 16, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: T.border }}>
        <Text style={[type.body, { flex: 1 }]}>{o.label}</Text>
        {o.key === value ? <Icon name="check" color={T.accent} /> : null}
      </TouchableOpacity>)}
    </Sheet>
  </View>;
}
