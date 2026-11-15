import React from 'react';
import { Text, View } from 'react-native';

import { useApp } from '../AppState.js';
import { PERSONAS, PERSONA_IDS, personaFor } from '../lib/personas.js';
import { T, type } from '../theme.js';
import { Card } from './kit.js';

/** Pick who Jim is: each persona shows its role, purpose and a sample line. */
export function PersonaPicker() {
  const { settings, update } = useApp();
  const current = personaFor(settings.persona).id;
  return (
    <View style={{ gap: 8 }} accessibilityRole="radiogroup">
      {PERSONA_IDS.map((id) => {
        const p = PERSONAS[id];
        const on = id === current;
        return (
          <Card
            key={id}
            onPress={() => update({ persona: id })}
            style={on ? { borderColor: T.accent, backgroundColor: T.accentSoft } : { borderColor: T.border }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                <Text style={type.title}>{p.name}{on ? '  ✓' : ''}</Text>
                <Text style={[type.small, { color: T.accentText }]}>{p.role}</Text>
              </View>
            </View>
            <Text style={[type.body, { marginTop: 4 }]}>{p.purpose}</Text>
            {on ? <Text style={[type.small, { marginTop: 4, fontStyle: 'italic' }]}>“{p.sample}”</Text> : null}
          </Card>
        );
      })}
    </View>
  );
}
