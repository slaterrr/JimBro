import React, { useCallback, useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { useApp } from '../AppState.js';
import { Button, C, Card, Choice, Kicker, Title, s } from '../ui.js';

export function BoardScreen() {
  const { api, online } = useApp();
  const [metric, setMetric] = useState('reps');
  const [board, setBoard] = useState(null);
  const [me, setMe] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (!online) return;
    api.leaderboard(metric).then(setBoard).catch((e) => setError(e.message));
  }, [api, metric, online]);
  useEffect(load, [load]);
  useEffect(() => {
    if (online) api.me().then((m) => { setMe(m); setName(m.display_name ?? ''); }).catch(() => {});
  }, [api, online]);

  const toggleOptIn = async () => {
    try {
      setMe(await api.saveMe(name.trim(), !me?.leaderboard_opt_in));
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (!online) {
    return (
      <>
        <Kicker>BETTER TOGETHER</Kicker>
        <Title>Leaderboard</Title>
        <Card><Text style={s.body}>Connect to your Pi (Home tab) to see this week's rankings.</Text></Card>
      </>
    );
  }

  return (
    <>
      <Kicker>BETTER TOGETHER</Kicker>
      <Title>Leaderboard</Title>
      <Card>
        <Text style={s.cardTitle}>This week{board ? ` · ${board.week}` : ''}</Text>
        <Choice options={[['reps', 'Total reps'], ['sessions', 'Sessions']]} value={metric} onChange={setMetric} />
        {board?.entries.length ? (
          board.entries.map((e) => (
            <View key={e.display_name} style={s.set}>
              <Text style={s.rowText}>
                {String(e.rank).padStart(2, '0')}   {e.display_name}   ·   {e.value}
                {e.demo ? <Text style={{ color: C.muted }}>  (sample)</Text> : null}
              </Text>
            </View>
          ))
        ) : (
          <Text style={[s.body, { marginTop: 10 }]}>Nobody has opted in this week yet.</Text>
        )}
        <Button secondary onPress={() => api.seedDemo().then(load).catch((e) => setError(e.message))}>Add demo athletes</Button>
      </Card>
      <Card>
        <Text style={s.cardTitle}>{me?.leaderboard_opt_in ? "You're on the board" : 'Join the board'}</Text>
        <Text style={s.label}>Display name</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} maxLength={40} placeholderTextColor={C.muted} />
        <Button disabled={!name.trim()} onPress={toggleOptIn}>{me?.leaderboard_opt_in ? 'Leave leaderboard' : 'Join leaderboard'}</Button>
        <Text style={s.fine}>Opt-in only. Ranked by reps or sessions, so kg and lb never mix. Sample athletes are labeled.</Text>
        {error ? <Text style={s.error}>{error}</Text> : null}
      </Card>
    </>
  );
}
