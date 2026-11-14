import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { useApp } from '../AppState.js';
import { exerciseName } from '../lib/exercises.js';
import { fallbackReply } from '../lib/offline.js';
import { parseSetUtterance } from '../lib/parse.js';
import { Button, C, Card, Chip, Choice, JimPortrait, Kicker, Title, s } from '../ui.js';

const TONES = [['direct', 'Direct'], ['friendly', 'Friendly'], ['silly', 'Silly'], ['hard', 'Hard']];
const SOURCE = { ai: 'Jim (AI)', fallback: 'Jim', offline: 'Jim (offline)', safety: 'Safety' };

export function JimScreen({ applySuggestion }) {
  const { api, settings, update, say, logSet } = useApp();
  const [text, setText] = useState('');
  const [messages, setMessages] = useState([]);
  const [suggestion, setSuggestion] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const ask = async (message) => {
    setMessages((m) => [...m, { me: true, text: message }]);
    setBusy(true);
    let r;
    try {
      r = await api.coach(message, settings.tone);
    } catch {
      r = fallbackReply(message, settings.tone);
    }
    setBusy(false);
    setMessages((m) => [...m, { me: false, text: r.text, source: r.source }]);
    setSuggestion(r.suggestion);
    say(r.text);
  };

  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    const parsed = parseSetUtterance(t);
    if (parsed) setDraft({ unit: settings.unit, ...parsed });
    else ask(t);
  };

  const confirm = async () => {
    await logSet({ ...draft, rpe: draft.rpe ?? null, source: 'voice', reps_detail: [], confidence: null, model_version: null });
    say(`Logged ${draft.reps} ${exerciseName(draft.exercise)}.`);
    setDraft(null);
  };

  return (
    <>
      <Kicker>YOUR AI TRAINING PARTNER</Kicker>
      <Title>Meet Jim</Title>
      <View style={{ alignItems: 'center', paddingVertical: 8 }}>
        <JimPortrait size={190} />
        <Text style={{ color: C.green, fontSize: 23, fontWeight: '900', letterSpacing: 5, marginTop: 6 }}>JIM</Text>
      </View>
      <Card>
        <Choice title="Coaching tone" options={TONES} value={settings.tone} onChange={(tone) => update({ tone })} />
        <View style={{ marginTop: 10 }}>
          <Chip label={settings.speak ? 'Voice replies on' : 'Voice replies off'} selected={settings.speak} onPress={() => update({ speak: !settings.speak })} />
        </View>
        {messages.map((m, i) => (
          <View key={i} style={[s.message, m.me && s.mine]}>
            {!m.me ? <Text style={s.label}>{SOURCE[m.source] ?? 'Jim'}</Text> : null}
            <Text style={{ color: C.text }}>{m.text}</Text>
          </View>
        ))}
        {busy ? <Text style={s.fine}>Jim is thinking…</Text> : null}
        <TextInput
          style={[s.input, { marginTop: 12 }]}
          value={text}
          onChangeText={setText}
          onSubmitEditing={send}
          placeholder='Ask Jim, or say "10 curls at 20 pounds"'
          placeholderTextColor={C.muted}
          returnKeyType="send"
        />
        <Button onPress={send}>Send</Button>
        <Text style={s.fine}>Tip: tap the microphone on your keyboard to talk to Jim. Sets you say are confirmed before saving.</Text>
      </Card>

      {draft ? (
        <Card>
          <Text style={s.cardTitle}>Log this set?</Text>
          <Text style={s.rowText}>
            {draft.reps} × {exerciseName(draft.exercise)} at {draft.weight} {draft.unit}{draft.rpe ? ` · RPE ${draft.rpe}` : ''}
          </Text>
          <Choice title="Unit" options={[['lb', 'lb'], ['kg', 'kg']]} value={draft.unit} onChange={(u) => setDraft({ ...draft, unit: u })} />
          <Button onPress={confirm}>Confirm</Button>
          <Button secondary onPress={() => setDraft(null)}>Discard</Button>
        </Card>
      ) : null}

      {suggestion ? (
        <Card>
          <Kicker>NEXT SET</Kicker>
          <Text style={s.cardTitle}>
            {exerciseName(suggestion.exercise)}: {suggestion.weight} {suggestion.unit} × {suggestion.reps}
          </Text>
          <Text style={s.body}>{suggestion.rationale}</Text>
          <Button onPress={() => applySuggestion(suggestion)}>Use this suggestion  ↗</Button>
        </Card>
      ) : null}
    </>
  );
}
