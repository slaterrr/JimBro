import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVoice, migrateVoiceSettings, VOICE_SETTINGS_VERSION } from './voice.js';

const fakeEngine = () => {
  const calls = [];
  return { calls, speak: (text, opts) => calls.push(['speak', text, opts]), stop: () => calls.push(['stop']) };
};

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
