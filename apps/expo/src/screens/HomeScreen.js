import React from 'react';
import { Alert, Share, Text, View } from 'react-native';

import { useApp } from '../AppState.js';
import { exerciseName } from '../lib/exercises.js';
import { streak, weeklyProgress } from '../lib/progress.js';
import { Button, C, Card, Choice, Kicker, Metric, s } from '../ui.js';

const TONES = [['direct', 'Direct'], ['friendly', 'Friendly'], ['silly', 'Silly'], ['hard', 'Hard']];

export function HomeScreen({ go }) {
  const { settings, update, history, active, allSets, exportJSON, eraseAll } = useApp();
  const week = weeklyProgress(history, settings.weeklyGoal);
  const weeks = streak(history);
  const volume = allSets.reduce((t, x) => t + x.weight * x.reps, 0);
  const recentPRs = allSets.filter((x) => x.pr).slice(-3).reverse();

  const confirmErase = () =>
    Alert.alert('Erase all workouts?', 'This deletes every workout and plan on this phone. Export first if you want a copy.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Erase', style: 'destructive', onPress: eraseAll },
    ]);

  return (
    <>
      <Kicker>YOUR TRAINING PARTNER</Kicker>
      <Text style={s.heroTitle}>
        Show up.{'\n'}
        <Text style={s.green}>Get stronger.</Text>
      </Text>
      <Text style={s.body}>Jim tracks the work and helps you make the next set count. Everything stays on this phone.</Text>
      <Button onPress={() => go('Workout')}>{active ? 'Continue workout  ↗' : 'Start a workout  ↗'}</Button>
      <View style={s.metrics}>
        <Metric title="THIS WEEK" value={`${week.done}/${week.goal}`} />
        <Metric title="STREAK" value={`${weeks} wk`} />
        <Metric title="VOLUME" value={Math.round(volume)} />
      </View>

      <Card>
        <Kicker>WEEKLY GOAL</Kicker>
        <Text style={s.cardTitle}>
          {week.done >= week.goal ? 'Goal hit. 💪' : `${week.goal - week.done} workout${week.goal - week.done === 1 ? '' : 's'} to go`}
        </Text>
        <Choice title="Workouts per week" options={[1, 2, 3, 4, 5, 6].map((n) => [n, String(n)])} value={settings.weeklyGoal} onChange={(weeklyGoal) => update({ weeklyGoal })} />
        <Text style={s.fine}>Your streak counts consecutive weeks with at least one workout.</Text>
      </Card>

      {recentPRs.length ? (
        <Card>
          <Kicker>RECENT RECORDS</Kicker>
          {recentPRs.map((x) => (
            <Text key={x.id} style={s.rowText}>🏆 {exerciseName(x.exercise)} · {x.weight} {x.unit} × {x.reps}</Text>
          ))}
        </Card>
      ) : null}

      <Card>
        <Kicker>COACH JIM</Kicker>
        <Text style={s.cardTitle}>In your corner.</Text>
        <Choice title="Coaching tone" options={TONES} value={settings.tone} onChange={(tone) => update({ tone })} />
        <Choice title="Units" options={[['lb', 'lb'], ['kg', 'kg']]} value={settings.unit} onChange={(unit) => update({ unit })} />
        <Choice title="Rest timer" options={[[60, '1:00'], [90, '1:30'], [120, '2:00'], [180, '3:00']]} value={settings.restSeconds} onChange={(restSeconds) => update({ restSeconds })} />
      </Card>

      <Card>
        <Kicker>YOUR DATA</Kicker>
        <Text style={s.body}>{history.length} workouts saved on this phone. Nothing is uploaded.</Text>
        <Button secondary onPress={() => Share.share({ message: exportJSON(), title: 'JimBro workouts' })}>Export workouts</Button>
        <Button secondary onPress={confirmErase}>Erase all workouts</Button>
        <Text style={[s.fine, { color: C.muted }]}>Not a medical device. TUT is estimated movement timing, not muscle tension.</Text>
      </Card>
    </>
  );
}
