import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

const KEY = 'jimbro-expo-v1';
const C = { bg: '#101310', card: '#1b231b', border: '#344432', green: '#c9ed96', text: '#f2f4ed', muted: '#a5b29f' };
const EXERCISES = ['Bicep curl', 'Back squat', 'Bench press', 'Deadlift', 'Shoulder press', 'Pull-up', 'Other'];
const TONES = ['Direct', 'Friendly', 'Silly', 'Hard'];
const COACH = {
  Direct: 'Set logged. Stay focused and make the next one count.',
  Friendly: 'Nice work! Take a breath and get ready for the next set.',
  Silly: 'That set just got a one-way ticket to Gainsville.',
  Hard: 'Set complete. Recover, reset, and attack the next one.'
};
const initial = { sessions: [], active: null, tone: 'Direct', plan: null };
const id = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const date = (value) => new Date(value).toLocaleDateString();
const volume = (sets) => sets.reduce((total, set) => total + set.weight * set.reps, 0);

function Button({ children, onPress, secondary = false, small = false }) {
  return <TouchableOpacity onPress={onPress} style={[s.button, secondary && s.secondary, small && s.smallButton]}><Text style={[s.buttonText, secondary && s.secondaryText]}>{children}</Text></TouchableOpacity>;
}
function Chip({ label, selected, onPress }) {
  return <TouchableOpacity onPress={onPress} style={[s.chip, selected && s.chipSelected]}><Text style={[s.chipText, selected && s.chipTextSelected]}>{label}</Text></TouchableOpacity>;
}
function Card({ children, style }) { return <View style={[s.card, style]}>{children}</View>; }
function Label({ children }) { return <Text style={s.label}>{children}</Text>; }
function Metric({ title, value }) { return <View style={s.metric}><Text style={s.metricLabel}>{title}</Text><Text style={s.metricValue}>{value}</Text></View>; }
function Choice({ title, options, value, onChange }) { return <View style={s.field}><Label>{title}</Label><View style={s.chips}>{options.map((option) => <Chip key={option} label={option} selected={value === option} onPress={() => onChange(option)} />)}</View></View>; }
function JimPortrait() {
  return <View style={portrait.frame} accessibilityLabel="Jim placeholder character, a smiling green weight plate">
    <Svg width={250} height={250} viewBox="0 0 250 250" accessibilityRole="image">
      <Circle cx="125" cy="125" r="112" fill="#263927" stroke="#526d49" strokeWidth="2" />
      <Line x1="21" y1="125" x2="229" y2="125" stroke="#78926b" strokeWidth="13" strokeLinecap="round" />
      <Rect x="20" y="91" width="18" height="68" rx="5" fill="#92b178" />
      <Rect x="212" y="91" width="18" height="68" rx="5" fill="#92b178" />
      <Circle cx="125" cy="125" r="84" fill="#c9ed96" stroke="#e4ffc0" strokeWidth="5" />
      <Circle cx="125" cy="125" r="71" fill="none" stroke="#96be6e" strokeWidth="2" />
      <Circle cx="98" cy="113" r="7" fill="#1d301a" />
      <Circle cx="152" cy="113" r="7" fill="#1d301a" />
      <Path d="M95 144 Q125 174 155 144" fill="none" stroke="#1d301a" strokeWidth="7" strokeLinecap="round" />
    </Svg>
  </View>;
}

export default function App() {
  const [data, setData] = useState(initial);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('Home');
  const [name, setName] = useState('Strength session');
  const [exercise, setExercise] = useState(EXERCISES[0]);
  const [weight, setWeight] = useState('0');
  const [reps, setReps] = useState('8');
  const [rpe, setRpe] = useState('');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('Ready when you are. Let’s get to work.');
  const [speak, setSpeak] = useState(false);
  const [goal, setGoal] = useState('Build strength');
  const [days, setDays] = useState('3');
  const [minutes, setMinutes] = useState('45');
  const [equipment, setEquipment] = useState('Full gym');
  const [compareExercise, setCompareExercise] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => { AsyncStorage.getItem(KEY).then((saved) => { if (saved) setData({ ...initial, ...JSON.parse(saved) }); }).catch(() => Alert.alert('Storage unavailable', 'Workout data could not be loaded.')).finally(() => setReady(true)); }, []);
  useEffect(() => { if (ready) AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => Alert.alert('Storage unavailable', 'Workout data could not be saved.')); }, [data, ready]);
  const update = (patch) => setData((current) => ({ ...current, ...patch }));
  const sessions = useMemo(() => [...data.sessions, ...(data.active ? [data.active] : [])], [data]);
  const sets = sessions.flatMap((session) => session.sets);
  const exerciseNames = [...new Set(data.sessions.flatMap((session) => session.sets.map((set) => set.exercise)))];
  const selectedExercise = exerciseNames.includes(compareExercise) ? compareExercise : exerciseNames[0];
  const comparisons = data.sessions.map((session) => ({ date: session.startedAt, sets: session.sets.filter((set) => set.exercise === selectedExercise) })).filter((item) => item.sets.length).sort((a, b) => new Date(a.date) - new Date(b.date));
  const first = comparisons[0], latest = comparisons[comparisons.length - 1];
  const change = first && latest && first !== latest && volume(first.sets) ? (volume(latest.sets) - volume(first.sets)) / volume(first.sets) * 100 : null;
  const say = (text) => { setMessage(text); if (speak) Speech.speak(text); };
  const start = () => { update({ active: { id: id(), name: name.trim() || 'Strength session', startedAt: new Date().toISOString(), sets: [] } }); say('Session started. Choose an exercise and log your first set.'); };
  const logSet = () => {
    const w = Number(weight), r = Number(reps);
    if (weight.trim() === '' || reps.trim() === '' || !Number.isFinite(w) || w < 0 || !Number.isInteger(r) || r < 1) { Alert.alert('Check your set', 'Enter a weight of zero or more and at least one rep.'); return; }
    const set = { id: id(), exercise, weight: w, reps: r, rpe: rpe ? Number(rpe) : null, notes: notes.trim(), loggedAt: new Date().toISOString() };
    update({ active: { ...data.active, sets: [...data.active.sets, set] } }); setNotes(''); say(COACH[data.tone]);
  };
  const finish = () => { update({ sessions: [...data.sessions, { ...data.active, finishedAt: new Date().toISOString() }], active: null }); say('Workout complete. You put in the work.'); };
  const openCamera = async () => { if (!permission?.granted) { const response = await requestPermission(); if (!response.granted) return; } setCameraOpen(true); };
  const plannedDays = Number(data.plan?.days || days);
  const plannedEquipment = data.plan?.equipment || equipment;
  const split = plannedDays <= 3 ? ['Full body A', 'Full body B', 'Full body C'] : plannedDays === 4 ? ['Upper A', 'Lower A', 'Upper B', 'Lower B'] : ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Full body'];
  const movement = plannedEquipment === 'Bodyweight' ? 'Squat · push-up · row · core' : plannedEquipment === 'Dumbbells' ? 'Goblet squat · DB press · DB row · hinge' : 'Squat · press · hinge · pull';

  return <View style={s.screen}><StatusBar barStyle="light-content" /><View style={s.header}><Text style={s.brand}>JimBro<Text style={s.dot}>.</Text></Text><Text style={s.headerRight}>TRAIN WITH INTENT</Text></View><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    {tab === 'Home' && <><Text style={s.kicker}>YOUR TRAINING PARTNER</Text><Text style={s.heroTitle}>Show up.{ '\n'}<Text style={s.green}>Get stronger.</Text></Text><Text style={s.body}>Jim is here to track the work and help you make the next set count.</Text><Button onPress={() => setTab('Workout')}>Start a workout  ↗</Button><View style={s.metrics}><Metric title="WORKOUTS" value={sessions.length} /><Metric title="SETS" value={sets.length} /><Metric title="VOLUME" value={`${Math.round(volume(sets))} lb`} /></View><Card><Text style={s.kicker}>COACH JIM</Text><Text style={s.cardTitle}>In your corner.</Text><Text style={s.body}>Choose how Jim talks to you while you train.</Text><Choice title="Coaching tone" options={TONES} value={data.tone} onChange={(tone) => update({ tone })} /></Card><Card><Text style={s.kicker}>RECENT ACTIVITY</Text><Text style={s.cardTitle}>Your sessions</Text>{sessions.length ? sessions.slice().reverse().slice(0, 3).map((session) => <Text key={session.id} style={s.rowText}>{session.name} · {session.sets.length} sets · {date(session.startedAt)}</Text>) : <Text style={s.body}>No workouts yet. Your first one starts here.</Text>}</Card></>}
    {tab === 'Workout' && <><Text style={s.kicker}>PUT IN THE WORK</Text><Text style={s.title}>Live workout<Text style={s.dot}>.</Text></Text>{!data.active ? <Card><Text style={s.cardTitle}>Start a session</Text><Label>Workout name</Label><TextInput style={s.input} value={name} onChangeText={setName} placeholderTextColor={C.muted} /><Button onPress={start}>Start session  ↗</Button></Card> : <Card><Text style={s.cardTitle}>{data.active.name}</Text><Text style={s.body}>{data.active.sets.length} sets logged</Text><Choice title="Exercise" options={EXERCISES} value={exercise} onChange={setExercise} /><View style={s.inputRow}><View style={s.inputHalf}><Label>Weight (lb)</Label><TextInput style={s.input} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" /></View><View style={s.inputHalf}><Label>Reps</Label><TextInput style={s.input} value={reps} onChangeText={setReps} keyboardType="number-pad" /></View></View><Choice title="Effort (RPE, optional)" options={['', '5', '6', '7', '8', '9', '10']} value={rpe} onChange={setRpe} /><Label>Set notes</Label><TextInput style={s.input} value={notes} onChangeText={setNotes} placeholder="How did it feel?" placeholderTextColor={C.muted} /><Button onPress={logSet}>Log set  ✓</Button><Button onPress={finish} secondary>Finish workout</Button>{data.active.sets.slice().reverse().map((set) => <View key={set.id} style={s.set}><Text style={s.rowText}>{set.exercise} · {set.reps} reps × {set.weight} lb{set.rpe ? ` · RPE ${set.rpe}` : ''}</Text>{set.notes ? <Text style={s.body}>Note: {set.notes}</Text> : null}</View>)}</Card>}
      <Card><Text style={s.kicker}>LIVE VISION</Text><Text style={s.cardTitle}>Form camera</Text>{cameraOpen ? <CameraView style={s.camera} facing="front" /> : <View style={s.cameraPlaceholder}><Text style={s.cameraText}>Camera is off</Text></View>}<Button onPress={() => cameraOpen ? setCameraOpen(false) : openCamera()} secondary>{cameraOpen ? 'Turn off camera' : 'Enable camera preview'}</Button><Text style={s.fine}>Preview only. Rep counts, form scores, and time under tension need the pose analysis backend.</Text></Card><Card><Text style={s.kicker}>COACH JIM</Text><Text style={s.cardTitle}>In your corner</Text><Choice title="Tone" options={TONES} value={data.tone} onChange={(tone) => update({ tone })} /><Text style={s.message}>{message}</Text><Chip label={speak ? 'Voice replies on' : 'Voice replies off'} selected={speak} onPress={() => setSpeak(!speak)} /><Text style={s.fine}>Jim’s replies are preset in this prototype. Speech input needs backend integration.</Text></Card></>}
    {tab === 'Jim' && <><Text style={s.kicker}>YOUR AI TRAINING PARTNER</Text><Text style={s.title}>Meet Jim<Text style={s.dot}>.</Text></Text><View style={portrait.center}><JimPortrait /><Text style={portrait.name}>JIM</Text><Text style={portrait.caption}>Your coach is in your corner.</Text></View><Card><Text style={s.cardTitle}>How should Jim coach you?</Text><Choice title="Coaching tone" options={TONES} value={data.tone} onChange={(tone) => update({ tone })} /><Text style={s.message}>{message}</Text><Chip label={speak ? 'Voice replies on' : 'Voice replies off'} selected={speak} onPress={() => setSpeak(!speak)} /><Text style={s.fine}>Jim is a placeholder character for now. His replies are preset until the AI coaching backend is connected.</Text></Card></>}
    {tab === 'Plan' && <><Text style={s.kicker}>A PLAN THAT FITS</Text><Text style={s.title}>My plan<Text style={s.dot}>.</Text></Text><Card><Choice title="Goal" options={['Build strength', 'Build muscle', 'General fitness']} value={goal} onChange={setGoal} /><Choice title="Days per week" options={['2', '3', '4', '5', '6']} value={days} onChange={setDays} /><Choice title="Minutes per session" options={['30', '45', '60', '75']} value={minutes} onChange={setMinutes} /><Choice title="Equipment" options={['Full gym', 'Dumbbells', 'Bodyweight']} value={equipment} onChange={setEquipment} /><Button onPress={() => update({ plan: { goal, days, minutes, equipment } })}>Create plan  ↗</Button></Card><Card><Text style={s.cardTitle}>Your training days</Text>{data.plan ? split.slice(0, Number(data.plan.days)).map((day, index) => <View key={index} style={s.set}><Text style={s.rowText}>Day {index + 1} · {day}</Text><Text style={s.body}>{movement} · about {data.plan.minutes} min</Text></View>) : <Text style={s.body}>Choose your preferences to create a starter plan.</Text>}<Text style={s.fine}>This is a template. Personalized recommendations need workout history and the backend.</Text></Card></>}
    {tab === 'Progress' && <><Text style={s.kicker}>THE WORK ADDS UP</Text><Text style={s.title}>Progress<Text style={s.dot}>.</Text></Text><View style={s.metrics}><Metric title="WORKOUTS" value={sessions.length} /><Metric title="SETS" value={sets.length} /><Metric title="VOLUME" value={`${Math.round(volume(sets))} lb`} /></View><Card><Text style={s.cardTitle}>Compare workouts</Text>{exerciseNames.length ? <><Choice title="Exercise" options={exerciseNames} value={selectedExercise} onChange={setCompareExercise} />{comparisons.length >= 2 ? <><Text style={s.bigStat}>{change === null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}</Text><Text style={s.body}>Exercise volume: {volume(first.sets)} lb → {volume(latest.sets)} lb</Text><Text style={s.body}>Heaviest set: {Math.max(...first.sets.map((set) => set.weight))} lb → {Math.max(...latest.sets.map((set) => set.weight))} lb</Text><Text style={s.fine}>{date(first.date)} vs {date(latest.date)}</Text></> : <Text style={s.body}>Finish two workouts with this exercise to compare them.</Text>}</> : <Text style={s.body}>Log an exercise to start tracking progress.</Text>}</Card><Card><Text style={s.cardTitle}>Workout history</Text>{data.sessions.length ? data.sessions.slice().reverse().map((session) => <View key={session.id} style={s.history}><Text style={s.rowText}>{session.name} · {date(session.startedAt)}</Text>{session.sets.map((set) => <View key={set.id} style={s.set}><Text style={s.body}>{set.exercise} · {set.reps} reps × {set.weight} lb</Text>{set.notes ? <Text style={s.fine}>Note: {set.notes}</Text> : null}</View>)}</View>) : <Text style={s.body}>Your finished workouts will appear here.</Text>}</Card></>}
    {tab === 'Board' && <><Text style={s.kicker}>BETTER TOGETHER</Text><Text style={s.title}>Leaderboard<Text style={s.dot}>.</Text></Text><Card><Text style={s.cardTitle}>Your crew is coming soon.</Text><Text style={s.body}>Shared rankings need accounts and a connected backend. Your workouts stay private on this phone for now.</Text><Text style={s.rowText}>01   You   ·   {sessions.length} workouts</Text></Card></>}
  </ScrollView><View style={s.tabs}>{[['Home','⌂'],['Workout','◉'],['Jim','●'],['Plan','▦'],['Progress','↗'],['Board','♛']].map(([label, icon]) => <TouchableOpacity key={label} onPress={() => { setCameraOpen(false); setTab(label); }} style={s.tab}><Text style={[s.tabIcon, tab === label && s.selectedTab]}>{icon}</Text><Text style={[s.tabLabel, tab === label && s.selectedTab]}>{label}</Text></TouchableOpacity>)}</View></View>;
}

const portrait = StyleSheet.create({ frame:{width:270,height:270,alignItems:'center',justifyContent:'center'},center:{alignItems:'center',justifyContent:'center',paddingVertical:22},name:{color:C.green,fontSize:23,fontWeight:'900',letterSpacing:5,marginTop:8},caption:{color:C.muted,fontSize:14,marginTop:5} });

const s = StyleSheet.create({ screen:{flex:1,backgroundColor:C.bg,paddingTop:StatusBar.currentHeight||45},header:{height:52,paddingHorizontal:20,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderColor:C.border},brand:{color:C.text,fontSize:25,fontWeight:'900'},dot:{color:C.green},headerRight:{color:C.muted,fontSize:9,letterSpacing:2,fontWeight:'800'},content:{padding:18,paddingBottom:35},kicker:{color:C.green,fontSize:10,fontWeight:'800',letterSpacing:2,marginBottom:8},heroTitle:{color:C.text,fontSize:42,fontWeight:'900',lineHeight:48,marginTop:14},green:{color:C.green},title:{color:C.text,fontSize:37,fontWeight:'900',marginBottom:20},body:{color:C.muted,fontSize:14,lineHeight:21,marginBottom:12},button:{backgroundColor:C.green,borderRadius:10,padding:14,alignItems:'center',marginTop:12},buttonText:{color:'#1b2b17',fontSize:14,fontWeight:'900'},secondary:{backgroundColor:'#273527',borderWidth:1,borderColor:'#496043'},secondaryText:{color:C.green},smallButton:{padding:8},card:{backgroundColor:C.card,borderColor:C.border,borderWidth:1,borderRadius:17,padding:20,marginTop:16},cardTitle:{color:C.text,fontSize:22,fontWeight:'800',marginBottom:10},metrics:{flexDirection:'row',gap:8,marginTop:20},metric:{flex:1,backgroundColor:C.card,borderRadius:12,borderWidth:1,borderColor:C.border,padding:12},metricLabel:{color:C.muted,fontSize:9,fontWeight:'800'},metricValue:{color:C.text,fontSize:23,fontWeight:'900',marginTop:6},field:{marginTop:12},label:{color:C.muted,fontSize:12,fontWeight:'700',marginBottom:8},chips:{flexDirection:'row',flexWrap:'wrap',gap:7},chip:{borderColor:'#475a43',borderWidth:1,borderRadius:50,paddingHorizontal:12,paddingVertical:8,backgroundColor:'#263126'},chipSelected:{backgroundColor:C.green,borderColor:C.green},chipText:{color:'#c5d2c0',fontSize:12,fontWeight:'800'},chipTextSelected:{color:'#182714'},input:{backgroundColor:'#111811',color:C.text,borderWidth:1,borderColor:'#40513d',borderRadius:9,padding:12,marginBottom:8},inputRow:{flexDirection:'row',gap:10},inputHalf:{flex:1},rowText:{color:C.text,fontSize:14,fontWeight:'700',marginTop:8},set:{borderTopWidth:1,borderColor:C.border,paddingTop:11,marginTop:11},history:{borderTopWidth:1,borderColor:C.border,paddingTop:10,marginTop:10},camera:{height:250,borderRadius:12,overflow:'hidden'},cameraPlaceholder:{height:190,borderRadius:12,backgroundColor:'#111811',alignItems:'center',justifyContent:'center'},cameraText:{color:C.muted},fine:{color:'#8d9e87',fontSize:11,lineHeight:17,marginTop:12},message:{backgroundColor:'#293929',color:C.text,borderLeftWidth:3,borderColor:C.green,padding:15,borderRadius:8,marginVertical:12},bigStat:{color:C.green,fontSize:35,fontWeight:'900',marginTop:12},tabs:{flexDirection:'row',borderTopWidth:1,borderColor:C.border,backgroundColor:'#172017',paddingBottom:8,paddingTop:7},tab:{flex:1,alignItems:'center'},tabIcon:{color:'#82917e',fontSize:22},tabLabel:{color:'#82917e',fontSize:10,fontWeight:'700',marginTop:2},selectedTab:{color:C.green} });

