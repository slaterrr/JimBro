import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useApp } from '../AppState.js';
import { exerciseName } from '../lib/exercises.js';
import { fitnessGoalLabel } from '../lib/fitnessGoal.js';
import { MUSCLE_GROUPS } from '../lib/muscles.js';
import { ONBOARDING_QUESTIONS, onboardingResult } from '../lib/onboarding.js';
import { personaFor } from '../lib/personas.js';
import { R, T, type } from '../theme.js';
import { Card, Chips, PrimaryButton, Sheet, st } from './kit.js';

/** First-run "Beginner / Comeback" setup: 3 taps, skippable, re-openable from the bell. */
export function Onboarding({ visible, onClose }) {
  const { update, savePlan, addGoal, goals, settings } = useApp();
  const [answers, setAnswers] = useState({});
  const [step, setStep] = useState(0);
  const [result, setResult] = useState(null);
  // "What do you want to look like?" draft, prefilled from saved settings when re-opened.
  const [lookText, setLookText] = useState(settings.physiqueGoal ?? '');
  const [lookMuscles, setLookMuscles] = useState(settings.focusMuscles ?? []);
  const toggleMuscle = (id) => setLookMuscles((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  const reset = () => { setAnswers({}); setStep(0); setResult(null); setLookText(settings.physiqueGoal ?? ''); setLookMuscles(settings.focusMuscles ?? []); };
  const close = () => { update({ onboarded: true }); reset(); onClose(); };

  const answer = (id, value) => {
    const next = { ...answers, [id]: value };
    setAnswers(next);
    if (step < ONBOARDING_QUESTIONS.length - 1) return setStep(step + 1);
    const r = onboardingResult(next);
    // Apply once: persona, plan and goal. Pain never gets a plan (see lib/onboarding.js).
    update({ onboarded: true, ...(r.persona ? { persona: r.persona } : {}), ...(r.settings ?? {}) });
    if (r.plan) savePlan(r.plan);
    if (r.goal && !goals.some((g) => g.type === 'consistency')) addGoal(r.goal);
    setResult(r);
  };

  const q = ONBOARDING_QUESTIONS[step];
  return (
    <Sheet visible={visible} onClose={close} title={result ? 'All set' : 'Quick setup'}>
      {!result ? (
        <View>
          <Text style={type.body}>
            A few quick questions so Jim can start at the right pace and pick your rest times. Everything stays on this phone.
          </Text>
          <Text style={[type.small, { marginTop: 14 }]}>Question {step + 1} of {ONBOARDING_QUESTIONS.length}{q.optional ? ' · optional' : ''}</Text>
          <Text style={[type.title, { marginTop: 4, marginBottom: 12 }]}>{q.title}</Text>
          {q.id === 'look' ? (
            <View style={{ gap: 10 }}>
              <TextInput
                value={lookText}
                onChangeText={setLookText}
                placeholder="In your words, e.g. stronger legs, more defined arms"
                placeholderTextColor={T.textMute}
                maxLength={200}
                multiline
                accessibilityLabel="What do you want to look like"
                style={st.input}
              />
              <Text style={type.small}>Muscles to focus on (tap any):</Text>
              <Chips multi options={MUSCLE_GROUPS.map((m) => [m.id, m.name])} value={lookMuscles} onChange={toggleMuscle} />
              <PrimaryButton onPress={() => answer('look', { text: lookText, muscles: lookMuscles })}>
                {lookText.trim() || lookMuscles.length ? 'Next' : 'Skip this question'}
              </PrimaryButton>
            </View>
          ) : null}
          <View style={{ gap: 10 }}>
            {q.options.map(([id, label]) => (
              <TouchableOpacity
                key={id}
                accessibilityRole="button"
                onPress={() => answer(q.id, id)}
                style={{ borderWidth: 1, borderColor: answers[q.id] === id ? T.accent : T.borderStrong, backgroundColor: answers[q.id] === id ? T.accentSoft : T.card, borderRadius: R.md, paddingVertical: 14, paddingHorizontal: 16 }}
              >
                <Text style={{ color: T.text, fontSize: 16, fontWeight: '600' }}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {step > 0 ? <PrimaryButton secondary onPress={() => setStep(step - 1)}>Back</PrimaryButton> : null}
          <PrimaryButton secondary onPress={close}>Skip for now</PrimaryButton>
        </View>
      ) : (
        <View>
          {result.safety ? (
            <Card style={{ borderColor: T.amber }}>
              <Text style={type.title}>Let's put your body first</Text>
              <Text style={[type.body, { marginTop: 6 }]}>{result.safety}</Text>
            </Card>
          ) : null}
          <Text style={[type.body, { marginTop: 12 }]}>{result.message}</Text>
          {result.settings ? (
            <Text style={[type.small, { marginTop: 8 }]}>
              Goal: {fitnessGoalLabel(result.settings.fitnessGoal)}. Rest times between sets are picked for this goal.
              {result.settings.physiqueGoal ? ` Aiming for: "${result.settings.physiqueGoal}".` : ''}
            </Text>
          ) : null}
          {result.persona ? (
            <Text style={[type.small, { marginTop: 8 }]}>Coach style: {personaFor(result.persona).name} (calm, unhurried). Change it any time from the bell.</Text>
          ) : null}
          {result.plan?.days.map((d) => (
            <Text key={d.day} style={[type.small, { marginTop: 6 }]}>
              Day {d.day}: {d.items.map((i) => `${exerciseName(i.exercise)} ${i.sets}×${i.reps_low}–${i.reps_high}`).join(' · ')}
            </Text>
          ))}
          <PrimaryButton onPress={close}>Let's go</PrimaryButton>
          <Text style={[type.small, { marginTop: 12 }]}>JimBro is a training tool, not medical advice.</Text>
        </View>
      )}
    </Sheet>
  );
}
