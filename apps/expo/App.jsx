import React, { useCallback, useState } from 'react';
import { ScrollView, StatusBar, Text, TouchableOpacity, View } from 'react-native';

import { AppProvider, useApp } from './src/AppState.js';
import { CameraCounter } from './src/screens/CameraCounter.js';
import { HomeScreen } from './src/screens/HomeScreen.js';
import { JimScreen } from './src/screens/JimScreen.js';
import { PlanScreen } from './src/screens/PlanScreen.js';
import { ProgressScreen } from './src/screens/ProgressScreen.js';
import { WorkoutScreen } from './src/screens/WorkoutScreen.js';
import { C, s } from './src/ui.js';

const TABS = [['Home', '⌂'], ['Workout', '◉'], ['Jim', '●'], ['Plan', '▦'], ['Progress', '↗']];

function Shell() {
  const { ready, active, notice } = useApp();
  const [tab, setTab] = useState('Home');
  const [prefill, setPrefill] = useState(null);
  const clearPrefill = useCallback(() => setPrefill(null), []);
  const applySuggestion = (sug) => { setPrefill(sug); setTab('Workout'); };
  const [camera, setCamera] = useState(null); // movement being counted, or null
  const [cameraReps, setCameraReps] = useState(null);
  const clearCameraReps = useCallback(() => setCameraReps(null), []);

  return (
    <View style={s.screen}>
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <Text style={s.brand}>JimBro<Text style={s.dot}>.</Text></Text>
        <Text style={[s.pill, { color: active ? C.green : C.muted, borderColor: active ? C.green : C.muted }]}>
          {active ? `WORKOUT · ${active.sets.length} SETS` : 'ON THIS PHONE'}
        </Text>
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {!ready ? <Text style={s.body}>Loading…</Text> : null}
        {notice ? <Text style={s.error}>{notice}</Text> : null}
        {ready && camera ? (
          <CameraCounter
            movement={camera}
            onCancel={() => setCamera(null)}
            onDone={(result) => { setCameraReps(result); setCamera(null); setTab('Workout'); }}
          />
        ) : null}
        {ready && !camera && tab === 'Home' ? <HomeScreen go={setTab} /> : null}
        {ready && !camera && tab === 'Workout' ? <WorkoutScreen prefill={prefill} clearPrefill={clearPrefill} cameraReps={cameraReps} clearCameraReps={clearCameraReps} openCamera={setCamera} /> : null}
        {ready && !camera && tab === 'Jim' ? <JimScreen applySuggestion={applySuggestion} /> : null}
        {ready && !camera && tab === 'Plan' ? <PlanScreen go={setTab} /> : null}
        {ready && !camera && tab === 'Progress' ? <ProgressScreen go={setTab} /> : null}
      </ScrollView>
      <View style={s.tabs}>
        {TABS.map(([label, icon]) => (
          <TouchableOpacity key={label} accessibilityRole="tab" accessibilityState={{ selected: tab === label }} onPress={() => { setCamera(null); setTab(label); }} style={s.tab}>
            <Text style={[s.tabIcon, tab === label && s.selectedTab]}>{icon}</Text>
            <Text style={[s.tabLabel, tab === label && s.selectedTab]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
