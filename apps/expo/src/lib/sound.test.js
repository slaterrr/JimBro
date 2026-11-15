import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVoice, migrateVoiceSettings, VOICE_SETTINGS_VERSION } from './sound.js';

const fakeEngine = () => {
  const calls = [];
  return { calls, speak: (text, opts) => calls.push(['speak', text, opts]), stop: () => calls.push(['stop']) };
};

test('disabled app voice blocks saved preferences and forced replies', async () => {
  const engine = fakeEngine();
  engine.setAudioMode = () => engine.calls.push(['audio']);
  const voice = createVoice(engine, () => ({ speak: true }), { enabled: false });
  assert.equal(voice.say('hello'), false);
  assert.equal(voice.say('forced', { force: true }), false);
  assert.equal(voice.cue('rep', { force: true }), false);
  await voice.enableAudio();
  voice.stop();
  assert.deepEqual(engine.calls, []);
});

test('CV coaching voice can speak form cues while general app voice stays disabled', () => {
  const engine = fakeEngine();
  const settings = () => ({ speak: false });
  const chat = createVoice(engine, settings, { enabled: false });
  const coach = createVoice(engine, settings);
  assert.equal(chat.say('chat reply', { force: true }), false);
  assert.equal(coach.cue('Keep your elbows still.', { force: true }), true);
  assert.equal(engine.calls.filter(([kind]) => kind === 'speak').length, 1);
  assert.equal(engine.calls.find(([kind]) => kind === 'speak')[1], 'Keep your elbows still.');
});

test('Jim speaks by default for new users', () => {
  assert.equal(migrateVoiceSettings(undefined).speak, true);
});

test('old saves that stored the old default (speak:false, no version) are switched on once', () => {
  const s = migrateVoiceSettings({ speak: false, unit: 'kg' });
  assert.equal(s.speak, true);
  assert.equal(s.unit, 'kg');
  assert.equal(s.voiceVersion, VOICE_SETTINGS_VERSION);
});

test('a user who turned voice off after the migration stays off', () => {
  assert.equal(migrateVoiceSettings({ speak: false, voiceVersion: VOICE_SETTINGS_VERSION }).speak, false);
});

test('say() speaks with the persona voice when voice is on, and is silent when off', () => {
  const engine = fakeEngine();
  const on = createVoice(engine, () => ({ speak: true, persona: 'hype' }));
  on.say('hi');
  assert.equal(engine.calls.length, 1);
  assert.equal(engine.calls[0][1], 'hi');
  assert.equal(engine.calls[0][2].pitch, 1.2);
  const engine2 = fakeEngine();
  createVoice(engine2, () => ({ speak: false, persona: 'coach' })).say('hi');
  assert.equal(engine2.calls.length, 0);
});

test('cue() interrupts the previous line so live rep counts are never queued behind old speech', () => {
  const engine = fakeEngine();
  createVoice(engine, () => ({ speak: true, persona: 'coach' })).cue('3');
  assert.deepEqual(engine.calls.map((c) => c[0]), ['stop', 'speak']);
});

test('force plays even when voice is off (persona samples, Talk mode); empty text never speaks', () => {
  const engine = fakeEngine();
  const v = createVoice(engine, () => ({ speak: false, persona: 'coach' }));
  v.say('', { force: true });
  v.say('sample', { force: true });
  assert.deepEqual(engine.calls.map((c) => c[0]), ['stop', 'speak']);
});

test('enableAudio configures playback in iOS silent mode exactly once and never throws', async () => {
  const modes = [];
  const engine = { ...fakeEngine(), setAudioMode: async (m) => modes.push(m) };
  const v = createVoice(engine, () => ({ speak: true }));
  await v.enableAudio();
  await v.enableAudio();
  assert.equal(modes.length, 1);
  assert.equal(modes[0].playsInSilentMode, true);
  const broken = createVoice({ ...fakeEngine(), setAudioMode: async () => { throw new Error('no audio module'); } }, () => ({}));
  await broken.enableAudio();
});

test('Daniel by default, the chosen voice when the device has it, persona speed and pitch kept', () => {
  const engine = fakeEngine();
  let settings = { speak: true, persona: 'coach', voiceId: null };
  const v = createVoice(engine, () => settings);
  v.say('before voices load');
  assert.equal(engine.calls.at(-1)[2].voice, undefined); // device default until the list loads
  v.setAvailableVoices([{ identifier: 'daniel-id', name: 'Daniel', language: 'en-GB' }, { identifier: 'samantha-id', name: 'Samantha', language: 'en-US' }]);
  v.say('hi');
  assert.equal(engine.calls.at(-1)[2].voice, 'daniel-id');
  assert.equal(engine.calls.at(-1)[2].pitch, 1.0);
  settings = { ...settings, voiceId: 'samantha-id' };
  v.say('hi');
  assert.equal(engine.calls.at(-1)[2].voice, 'samantha-id');
  settings = { ...settings, voiceId: 'removed-id' };
  v.say('hi');
  assert.equal(engine.calls.at(-1)[2].voice, 'daniel-id');
  v.say('preview', { force: true, voiceId: 'samantha-id' });
  assert.equal(engine.calls.at(-1)[2].voice, 'samantha-id');
});
