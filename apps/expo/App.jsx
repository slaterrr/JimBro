import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { Alert, Platform, StatusBar, Text, View } from 'react-native';

import { AppProvider, useApp } from './src/AppState.js';
import { Login } from './src/components/Login.js';
import { Onboarding } from './src/components/Onboarding.js';
import { ActivitySheet, LogSetSheet } from './src/components/Sheets.js';
import { TabBar } from './src/components/TabBar.js';
import { CoachScreen } from './src/screens/CoachScreen.js';
import { HomeScreen } from './src/screens/HomeScreen.js';
import { MusclesScreen } from './src/screens/MusclesScreen.js';
import { ProgressScreen } from './src/screens/ProgressScreen.js';
import { createAuth, dataKeyFor } from './src/lib/auth.js';
import { FRAME_MAX, topInset } from './src/lib/layout.js';
import { T } from './src/theme.js';

function Shell() {
  const { ready, notice, settings, active } = useApp();
  const [progressGroup, setProgressGroup] = useState(null);
  // Web preview only (expo export -p web): ?tab=Muscles opens a tab, for design screenshots.
  const [tab, setTab] = useState(() => {
    const q = Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null;
    return ['Home', 'Muscles', 'Coach', 'Progress'].includes(q) ? q : 'Home';
  });
  const [log, setLog] = useState(null); // { initial, camera } while the sheet is open
  const [activity, setActivity] = useState(false);
  const [setup, setSetup] = useState(false); // re-opened from the bell
  // Web preview only: ?setup=skip hides the first-run setup so Home can be screenshotted.
  const skipSetup = Platform.OS === 'web' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('setup') === 'skip';
  const firstRun = ready && !settings.onboarded && !skipSetup;
  const openLog = (initial = null, camera = null) => {
    if (!active) {
      Alert.alert('Start a workout first', 'Use Start a Workout on Home before recording sets.');
      return;
    }
    setLog({ initial, camera, workoutId: active.id });
  };

  return (
    // One phone-width column on every screen: full width on phones, centered on tablets and desktop web.
    <View style={{ flex: 1, backgroundColor: T.bg, alignItems: 'center' }}>
    <View style={{ flex: 1, width: '100%', maxWidth: FRAME_MAX, paddingTop: topInset(Platform.OS, StatusBar.currentHeight) }}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      {notice ? <Text style={{ color: T.red, paddingHorizontal: 20 }}>{notice}</Text> : null}
      <View style={{ flex: 1 }}>
        {!ready ? null : tab === 'Home' ? (
          <HomeScreen openLog={openLog} openActivity={() => setActivity(true)} go={setTab} />
        ) : tab === 'Muscles' ? (
          <MusclesScreen openHistory={() => { setProgressGroup(null); setTab('Progress'); }} openProgress={(group) => { setProgressGroup(group); setTab('Progress'); }} />
        ) : tab === 'Coach' ? (
          <CoachScreen openLog={openLog} />
        ) : (
          <ProgressScreen go={setTab} muscleGroup={progressGroup} onClearMuscle={() => setProgressGroup(null)} />
        )}
      </View>
      <TabBar tab={tab} onChange={setTab} />
      <LogSetSheet visible={Boolean(log && active?.id === log.workoutId)} initial={log?.initial} camera={log?.camera} onClose={() => setLog(null)} />
      <ActivitySheet visible={activity} onClose={() => setActivity(false)} openSetup={() => { setActivity(false); setSetup(true); }} />
      <Onboarding visible={firstRun || setup} onClose={() => setSetup(false)} />
    </View>
    </View>
  );
}

const auth = createAuth({
  storage: AsyncStorage,
  sha256: (s) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s),
  salt: () => Crypto.randomUUID(),
});

const Frame = ({ children }) => (
  <View style={{ flex: 1, backgroundColor: T.bg, alignItems: 'center' }}>
    <View style={{ flex: 1, width: '100%', maxWidth: FRAME_MAX, paddingTop: topInset(Platform.OS, StatusBar.currentHeight) }}>{children}</View>
  </View>
);

export default function App() {
  const [user, setUser] = useState(undefined); // undefined while checking the saved session
  useEffect(() => { auth.currentUser().then(setUser, () => setUser(null)); }, []);
  if (user === undefined) return <Frame />;
  if (!user) return <Frame><StatusBar barStyle="light-content" backgroundColor={T.bg} /><Login auth={auth} onSignedIn={setUser} /></Frame>;
  // key: switching accounts remounts the app with that account's own data.
  return (
    <AppProvider key={user} storageKey={dataKeyFor(user)} account={user} onSignOut={() => auth.signOut().then(() => setUser(null))}>
      <Shell />
    </AppProvider>
  );
}
