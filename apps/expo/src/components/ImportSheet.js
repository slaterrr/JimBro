// "Create a New Plan" extras: import past workouts from a CSV / Excel sheet, and build a plan
// from a reference physique photo. Both follow the confirm-card pattern: nothing is written
// to history or the saved plan until the user taps Confirm.
// Photo privacy: upload only after the consent box is ticked; the base64 lives in component
// state for one request and is cleared after; the picker's cached copy is deleted.
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { useApp } from '../AppState.js';
import { exerciseName } from '../lib/exercises.js';
import { parseWorkoutFile, toExport } from '../lib/importWorkouts.js';
import { askPhysique } from '../lib/jimAI.js';
import { describeItem } from '../lib/planFromGoal.js';
import { T, type } from '../theme.js';
import { Card, Icon, PrimaryButton } from './kit.js';

const SHEET_TYPES = ['text/csv', 'text/comma-separated-values', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/plain'];
const MAX_SKIPPED_SHOWN = 8;

async function readAsset(asset) {
  if (asset.file?.arrayBuffer) return new Uint8Array(await asset.file.arrayBuffer()); // web
  return new File(asset.uri).bytes();
}
function forget(uri) {
  try { new File(uri).delete(); } catch { /* already gone or not deletable */ }
}

export function ImportSheet({ proxyUrl, onDone }) {
  const { settings, history, active, importData, savePlan } = useApp();
  const [preview, setPreview] = useState(null); // { name, result }
  const [error, setError] = useState(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [planOut, setPlanOut] = useState(null); // askPhysique result
  const [done, setDone] = useState(null);

  const pickSheet = async () => {
    setError(null); setDone(null);
    const r = await DocumentPicker.getDocumentAsync({ type: SHEET_TYPES, copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets?.[0]) return;
    const asset = r.assets[0];
    try {
      const bytes = await readAsset(asset);
      setPreview({ name: asset.name, result: parseWorkoutFile({ name: asset.name, bytes }, { unit: settings.unit }) });
    } catch (e) {
      setError(e.message);
    } finally {
      forget(asset.uri);
    }
  };

  const confirmImport = () => {
    try {
      const added = importData(toExport(preview.result.workouts));
      setDone(`Imported ${added} workout${added === 1 ? '' : 's'}.`);
      onDone?.(`Imported ${preview.result.setCount} sets from ${preview.name}.`);
    } catch (e) {
      setError(e.message);
    }
    setPreview(null);
  };

  const planFrom = async (withPhoto) => {
    setError(null); setDone(null); setPlanOut(null);
    let image = null;
    if (withPhoto) {
      if (!consent) return setError('Tick the consent box first. No photo is sent without it.');
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return setError('Photo access was not allowed.');
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.6, exif: false, allowsEditing: false });
      if (r.canceled || !r.assets?.[0]?.base64) return undefined;
      const a = r.assets[0];
      image = { base64: a.base64, mediaType: a.mimeType ?? 'image/jpeg' };
      forget(a.uri);
    }
    setBusy(true);
    const out = await askPhysique({ image, consent: withPhoto && consent, state: { settings, history, active }, url: proxyUrl });
    image = null; // drop the only in-memory copy of the photo
    setBusy(false);
    setPlanOut(out);
  };

  const confirmPlan = () => {
    savePlan({ ...planOut.proposal.plan, request: { source: planOut.proposal.plan.source } });
    setDone('Plan saved. Tap Start a Workout to begin day 1.');
    onDone?.(planOut.proposal.summary.replace(/^Save/, 'Saved').replace(/\?$/, '.'));
    setPlanOut(null);
  };

  return (
    <Card style={{ marginTop: 10, gap: 10 }}>
      <Text style={type.title}>Bring your own data</Text>
      <PrimaryButton secondary onPress={pickSheet}>Import workouts (CSV or Excel)</PrimaryButton>
      <Text style={type.small}>Columns like date, exercise, sets, reps, weight, unit. Rows Jim can't match are listed, not guessed.</Text>

      {preview ? (
        <View style={{ gap: 6 }}>
          <Text style={type.title}>Import this?</Text>
          <Text style={type.body}>{preview.result.summary}</Text>
          {preview.result.workouts.slice(-5).map((w) => (
            <Text key={w.id} style={type.small}>{w.startedAt.slice(0, 10)} · {[...new Set(w.sets.map((s) => exerciseName(s.exercise)))].join(', ')} · {w.sets.length} sets</Text>
          ))}
          {preview.result.skipped.length ? <Text style={[type.small, { color: T.amber }]}>Skipped:</Text> : null}
          {preview.result.skipped.slice(0, MAX_SKIPPED_SHOWN).map((s) => (
            <Text key={s.line} style={[type.small, { color: T.amber }]}>Row {s.line}: {s.reason}</Text>
          ))}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <PrimaryButton style={{ flex: 1 }} disabled={!preview.result.setCount} onPress={confirmImport}>Confirm</PrimaryButton>
            <PrimaryButton secondary style={{ flex: 1 }} onPress={() => setPreview(null)}>Cancel</PrimaryButton>
          </View>
        </View>
      ) : null}

      <Text style={[type.title, { marginTop: 6 }]}>Plan toward a physique</Text>
      <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent((c) => !c)} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <Icon name={consent ? 'checkbox-marked' : 'checkbox-blank-outline'} color={consent ? T.accent : T.textDim} />
        <Text style={[type.small, { flex: 1 }]}>
          I agree to send one photo to Jim's AI for this request only. It is not saved on the phone or the server and is never shown to anyone. Jim only names muscle groups to train; he won't comment on weight or looks.
        </Text>
      </TouchableOpacity>
      <PrimaryButton disabled={busy || !consent} onPress={() => planFrom(true)}>{busy ? 'Jim is looking…' : 'Pick a reference photo'}</PrimaryButton>
      <PrimaryButton secondary disabled={busy} onPress={() => planFrom(false)}>Plan from my goal (no photo)</PrimaryButton>

      {planOut ? (
        <View style={{ gap: 6 }}>
          <Text style={type.body}>{planOut.message}</Text>
          {planOut.emphasis.map((e) => <Text key={e.muscle} style={type.small}>• {e.muscle}: {e.reason}</Text>)}
          <Text style={type.title}>{planOut.proposal.summary}</Text>
          {planOut.proposal.plan.days.map((d) => (
            <Text key={d.day} style={type.small}>Day {d.day} (~{d.estimated_minutes} min): {d.items.map(describeItem).join(' · ')}</Text>
          ))}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <PrimaryButton style={{ flex: 1 }} onPress={confirmPlan}>Confirm</PrimaryButton>
            <PrimaryButton secondary style={{ flex: 1 }} onPress={() => setPlanOut(null)}>Cancel</PrimaryButton>
          </View>
        </View>
      ) : null}

      {error ? <Text style={[type.small, { color: T.amber }]}>{error}</Text> : null}
      {done ? <Text style={[type.small, { color: T.accentText }]}>{done}</Text> : null}
    </Card>
  );
}
