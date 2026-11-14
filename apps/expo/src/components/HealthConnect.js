import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import React, { useState } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';

import { useApp } from '../AppState.js';
import { ACTIVITY_LABELS, activityLevel } from '../lib/activityLevel.js';
import { bytesToAscii, createHealthXmlParser, nativeHealth, parseHealthCsv } from '../lib/healthData.js';
import { T, type } from '../theme.js';
import { Card, PrimaryButton, Sheet } from './kit.js';

const CHUNK = 1 << 20; // 1 MB at a time: export.xml can be several GB.

async function readPickedFile(asset, onProgress) {
  const name = (asset.name ?? '').toLowerCase();
  if (name.endsWith('.zip')) throw new Error('Unzip export.zip in the Files app first, then pick the export.xml inside it.');
  const file = new File(asset.uri);
  if (name.endsWith('.csv')) return parseHealthCsv(await file.text());
  const parser = createHealthXmlParser();
  const handle = file.open();
  try {
    const size = handle.size ?? asset.size ?? 0;
    let read = 0;
    for (;;) {
      const bytes = await handle.readBytes(CHUNK);
      if (!bytes.length) break;
      parser.push(bytesToAscii(bytes));
      read += bytes.length;
      if (size) onProgress(Math.min(1, read / size));
    }
  } finally {
    handle.close();
  }
  return parser.result();
}

/** Consent -> source -> estimate -> save/clear. Read-only; nothing leaves the phone. */
export function HealthConnect({ visible, onClose }) {
  const { settings, update } = useApp();
  const [step, setStep] = useState('consent');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const native = nativeHealth();

  const close = () => { setStep('consent'); setBusy(null); setError(null); setResult(null); onClose(); };
  const finish = (data) => { setResult(activityLevel(data)); setStep('result'); };

  const run = async (fn) => {
    setError(null);
    try { await fn(); } catch (e) { setError(e?.message ?? String(e)); } finally { setBusy(null); }
  };
  const fromNative = () => run(async () => { setBusy('Reading health history…'); finish(await native.read(90)); });
  const fromFile = () => run(async () => {
    const pick = await DocumentPicker.getDocumentAsync({ type: ['text/xml', 'application/xml', 'text/csv', 'text/comma-separated-values', 'application/zip', '*/*'], copyToCacheDirectory: true });
    if (pick.canceled || !pick.assets?.length) return;
    setBusy('Reading file…');
    finish(await readPickedFile(pick.assets[0], (p) => setBusy(`Reading file… ${Math.round(p * 100)}%`)));
  });

  const healthName = Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect';
  return (
    <Sheet visible={visible} onClose={close} title="Estimate my activity level">
      {step === 'consent' ? (
        <View>
          <Text style={type.title}>What JimBro reads</Text>
          <Text style={[type.body, { marginTop: 6 }]}>
            Only the last 90 days of daily steps, active energy, exercise minutes and workouts. Read-only: JimBro never writes to your health data.
          </Text>
          <Text style={[type.body, { marginTop: 8 }]}>
            Everything is worked out on this phone. Nothing is uploaded, and the raw history is not saved; only the level you choose to keep is.
          </Text>
          <Text style={[type.small, { marginTop: 8 }]}>It is a rough guess to tune suggestions, not a health assessment.</Text>
          <PrimaryButton onPress={() => setStep('source')}>I agree, continue</PrimaryButton>
          <PrimaryButton secondary onPress={close}>Not now</PrimaryButton>
        </View>
      ) : null}

      {step === 'source' ? (
        <View>
          {busy ? (
            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              <ActivityIndicator color={T.accent} />
              <Text style={[type.body, { marginTop: 10 }]}>{busy}</Text>
            </View>
          ) : (
            <>
              <PrimaryButton disabled={!native.available} onPress={fromNative}>Read from {healthName}</PrimaryButton>
              {!native.available ? <Text style={[type.small, { marginTop: 6 }]}>{native.reason}</Text> : null}
              <PrimaryButton secondary onPress={fromFile}>Import a health export file</PrimaryButton>
              <Text style={[type.small, { marginTop: 6 }]}>
                iPhone: Health app → your picture → Export All Health Data, unzip it in Files, then pick export.xml.
                Or a CSV with columns date, steps, active_kcal, exercise_min.
              </Text>
            </>
          )}
          {error ? <Text style={[type.body, { marginTop: 10, color: T.text }]}>{error}</Text> : null}
        </View>
      ) : null}

      {step === 'result' && result ? (
        <View>
          <Card>
            <Text style={type.title}>{result.level ? ACTIVITY_LABELS[result.level] : 'No estimate yet'}</Text>
            {result.level ? <Text style={type.small}>Confidence: {result.confidence} · {result.daysOfData} days of data</Text> : null}
            <Text style={[type.body, { marginTop: 8 }]}>{result.message}</Text>
            {result.evidence.map((e) => <Text key={e} style={[type.body, { marginTop: 6 }]}>• {e}</Text>)}
          </Card>
          {result.level ? (
            <PrimaryButton onPress={() => { update({ activityLevel: result.level }); close(); }}>Use this for my suggestions</PrimaryButton>
          ) : null}
          <PrimaryButton secondary onPress={() => setStep('source')}>Try another source</PrimaryButton>
        </View>
      ) : null}

      {settings.activityLevel ? (
        <View style={{ marginTop: 16 }}>
          <Text style={type.small}>Saved: {ACTIVITY_LABELS[settings.activityLevel] ?? settings.activityLevel}</Text>
          <PrimaryButton secondary onPress={() => update({ activityLevel: null })}>Clear saved activity level</PrimaryButton>
        </View>
      ) : null}
    </Sheet>
  );
}
