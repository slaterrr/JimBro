import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { Alert, Platform, StatusBar, Text, View } from 'react-native';

import { AppProvider, useApp } from './src/AppState.js';
import { Login } from './src/components/Login.js';
import { Onboarding } from './src/components/Onboarding.js';
import { ActivitySheet, LogSetSheet } from './src/components/Sheets.js';
import { HomeScreen } from './src/screens/HomeScreen.js';
import { createAuth, dataKeyFor } from './src/lib/auth.js';
import { FRAME_MAX, topInset } from './src/lib/layout.js';
import { T } from './src/theme.js';

function Shell() {
  const { ready, notice, settings, active } = useApp();
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
    // Review workspace: responsive chat shell; account/data isolation stays unchanged.
    <View style={{ flex: 1, backgroundColor: T.bg, alignItems: 'center' }}>
    <View style={{ flex: 1, width: '100%', paddingTop: topInset(Platform.OS, StatusBar.currentHeight) }}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      {notice ? <Text style={{ color: T.red, paddingHorizontal: 20 }}>{notice}</Text> : null}
      <View style={{ flex: 1 }}>
        {ready ? <HomeScreen openLog={openLog} openActivity={() => setActivity(true)} /> : null}
      </View>
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
