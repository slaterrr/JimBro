import React, { useState } from 'react';
import { Platform, StatusBar, Text, View } from 'react-native';

import { AppProvider, useApp } from './src/AppState.js';
import { ActivitySheet, LogSetSheet } from './src/components/Sheets.js';
import { TabBar } from './src/components/TabBar.js';
import { CoachScreen } from './src/screens/CoachScreen.js';
import { HomeScreen } from './src/screens/HomeScreen.js';
import { MusclesScreen } from './src/screens/MusclesScreen.js';
import { ProgressScreen } from './src/screens/ProgressScreen.js';
import { T } from './src/theme.js';

function Shell() {
  const { ready, notice } = useApp();
  // Web preview only (expo export -p web): ?tab=Muscles opens a tab, for design screenshots.
  const [tab, setTab] = useState(() => {
    const q = Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null;
    return ['Home', 'Muscles', 'Coach', 'Progress'].includes(q) ? q : 'Home';
  });
  const [log, setLog] = useState(null); // { initial, camera } while the sheet is open
  const [activity, setActivity] = useState(false);
  const openLog = (initial = null, camera = null) => setLog({ initial, camera });

  return (
    <View style={{ flex: 1, backgroundColor: T.bg, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 50 }}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      {notice ? <Text style={{ color: T.red, paddingHorizontal: 20 }}>{notice}</Text> : null}
      <View style={{ flex: 1 }}>
        {!ready ? null : tab === 'Home' ? (
          <HomeScreen go={setTab} openLog={openLog} openActivity={() => setActivity(true)} />
        ) : tab === 'Muscles' ? (
          <MusclesScreen openLog={openLog} openHistory={() => setTab('Progress')} />
        ) : tab === 'Coach' ? (
          <CoachScreen openLog={openLog} />
        ) : (
          <ProgressScreen go={setTab} />
        )}
      </View>
      <TabBar tab={tab} onChange={setTab} />
      <LogSetSheet visible={Boolean(log)} initial={log?.initial} camera={log?.camera} onClose={() => setLog(null)} />
      <ActivitySheet visible={activity} onClose={() => setActivity(false)} />
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
