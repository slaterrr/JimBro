import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
test('the composer separates call mode from keyboard dictation', () => {
  const home = src('screens/HomeScreen.js');
  const composer = home.split('<View style={[st.composerArea')[1];
  assert.match(composer, /label="Dictate \(use the keyboard microphone\)" onPress=\{openDictation\}/);
  assert.match(composer, /<CallButton active=\{talk\} onPress=\{toggleTalk\}/);
  assert.doesNotMatch(home.split('const toggleTalk = ')[1].split('const newChat = ')[0], /\.focus\(/);
  assert.doesNotMatch(home, /onDone:.*\.focus\(/);
});

