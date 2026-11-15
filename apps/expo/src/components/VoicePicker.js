import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { useApp } from '../AppState.js';
import { defaultVoice, resolveVoice, voiceLabel } from '../lib/voices.js';
import { T, type } from '../theme.js';
import { Dropdown } from './kit.js';

const SAMPLE = "Hi, I'm Jim, your personal gym assistant. What are we training today?";

/** Choose Jim's voice from the device's voices. Daniel (British) is the default when available. */
export function VoicePicker() {
  const { settings, update, say, voices } = useApp();
  if (!voices.length) return <Text style={type.small}>Loading your device's voices…</Text>;
  const fallback = defaultVoice(voices);
  const current = resolveVoice(settings.voiceId, voices) ?? '__device';
  const options = [
    ...(fallback ? [] : [['__device', 'Device default']]),
    ...voices.map((v) => [v.id, `${voiceLabel(v)}${v.id === fallback ? ' · Jim default' : ''}`]),
  ];
  return (
    <View>
      <Dropdown testID="voice-picker" label="Jim's voice" value={current} options={options} onChange={(id) => update({ voiceId: id === '__device' ? null : id })} />
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Preview Jim's voice" onPress={() => say(SAMPLE, { force: true, voiceId: current === '__device' ? undefined : current })} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={[type.small, { color: T.accentText, fontWeight: '700' }]}>▶ Preview voice</Text>
      </TouchableOpacity>
      <Text style={type.small}>Voices come from your phone or browser. Your persona still sets speed and pitch.</Text>
    </View>
  );
}
