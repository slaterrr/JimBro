import React, { useRef, useState } from 'react';
import { Keyboard, Text, View } from 'react-native';

import { useApp } from '../AppState.js';
import { answerCoachSet, coachLoadLabel, coachPauseCommand, parseCoachReport } from '../lib/coachSetChat.js';
import { exerciseName } from '../lib/exercises.js';
import { T, type } from '../theme.js';
import { Card, Field, IconButton } from './kit.js';

export function CoachSetChat({ target, phase, slotKey, measured, paused, setPaused, sendSet, voiceOn, onFocusChange }) {
  const { active, history, plan, settings, coachVoice: voice } = useApp();
  const [draft, setDraft] = useState('');
  const [turn, setTurn] = useState(null);
  const followUp = useRef(null);
  const followUpReport = followUp.current?.key === slotKey ? followUp.current.report : null;
  const readyToLog = ['set', 'check'].includes(phase) && target && active && !paused;

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    Keyboard.dismiss();
    const reply = (message) => {
      setTurn({ text, reply: message });
      if (voiceOn) voice.say(message, { force: true });
    };
    const command = coachPauseCommand(text);
    if (command) {
      followUp.current = null;
      setPaused(command.paused);
      if (command.paused) voice.stop();
      reply(command.reply);
      return;
    }
    const report = parseCoachReport(text, { reps: measured, awaitingWeight: Boolean(followUpReport) });
    if (!report) {
      reply(answerCoachSet(text, { target, phase, active, history, plan, settings, profile: settings.profile ?? {} }));
      return;
    }
    if (!readyToLog) {
      reply(paused ? 'Resume coaching before logging a set.' : phase === 'rest'
        ? 'You’re resting. Log the next set when you’ve finished it.'
        : 'Start your set before reporting your reps.');
      return;
    }
    const resolved = report.reps == null ? { ...followUpReport, ...report } : report;
    if (resolved.unit && resolved.unit !== target.unit) {
      followUp.current = { key: slotKey, report: { ...resolved, weight: undefined, unit: undefined } };
      reply('Please give the weight in ' + target.unit + ' for this set.');
      return;
    }
    const weight = resolved.weight ?? target.weight;
    if (weight == null) {
      followUp.current = { key: slotKey, report: resolved };
      reply('What weight did you use? Reply with a weight and unit, or “bodyweight.”');
      return;
    }
    followUp.current = null;
    const id = sendSet({ ...resolved, weight });
    if (!id) {
      reply('This set is no longer available to save.');
      return;
    }
    setTurn({ text, savedId: id });
  };

  const saved = turn?.savedId ? active?.sets.find((set) => set.id === turn.savedId) : null;
  const receipt = saved && ('Logged ' + exerciseName(saved.exercise) + ' · ' + saved.reps + ' reps · '
    + (saved.weight === 0 ? 'bodyweight' : saved.weight + ' ' + saved.unit)
    + (saved.effortNote ? ' · ' + saved.effortNote : ''));

  return (
    <Card style={{ marginTop: 10, padding: 12, gap: 8 }}>
      <Text style={type.label}>{paused ? 'Jim · paused' : 'Chat with Jim'}</Text>
      {readyToLog ? <Text style={type.small}>Set {target.setNo} · {target.reps} target reps · {coachLoadLabel(target)}</Text> : null}
      {turn ? (
        <View accessible accessibilityLiveRegion="polite">
          <Text style={type.small}>You · {turn.text}</Text>
          <Text style={type.body}>{turn.reply ?? receipt ?? 'The set was not saved. Check the current set before trying again.'}</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Field
          accessibilityLabel="Message workout coach"
          value={draft}
          onChangeText={setDraft}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          placeholder={followUpReport ? 'Weight used, e.g. 45 lb' : readyToLog ? '8, little grind' : 'Ask Jim what’s next'}
          returnKeyType="send"
          onSubmitEditing={send}
          style={{ minHeight: 46 }}
        />
        <IconButton icon="arrow-up" label="Send workout message" size={46} color={T.text} onPress={send} />
      </View>
    </Card>
  );
}
