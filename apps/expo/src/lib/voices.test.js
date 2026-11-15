// Voice picker: device text-to-speech voices, normalized, English first, enhanced first.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultVoice, resolveVoice, voiceChoices, voiceLabel } from './voices.js';

const raw = [
  { identifier: 'com.apple.voice.compact.en-US.Samantha', name: 'Samantha', language: 'en-US', quality: 'Default' },
  { identifier: 'com.apple.voice.enhanced.en-GB.Daniel', name: 'Daniel', language: 'en-GB', quality: 'Enhanced' },
  { identifier: 'com.apple.voice.compact.fr-FR.Thomas', name: 'Thomas', language: 'fr-FR', quality: 'Default' },
  { identifier: 'Google US English', name: 'Google US English', language: 'en-US', quality: 'Default' },
  { identifier: 'com.apple.voice.compact.en-US.Samantha', name: 'Samantha', language: 'en-US', quality: 'Default' }, // duplicate
  { name: 'broken' },
  null,
];

test('lists English voices once each, enhanced first, then by name', () => {
  const list = voiceChoices(raw);
  assert.deepEqual(list.map((v) => v.name), ['Daniel', 'Google US English', 'Samantha']);
  assert.equal(list[0].enhanced, true);
  assert.match(voiceLabel(list[0]), /Daniel · en-GB · Enhanced/);
});

test('other languages are used when there is no English voice; bad input gives an empty list', () => {
  assert.deepEqual(voiceChoices([raw[2]]).map((v) => v.name), ['Thomas']);
  assert.deepEqual(voiceChoices(undefined), []);
  assert.equal(voiceChoices(raw, { language: 'fr' })[0].name, 'Thomas');
});

test("Jim's default voice is Daniel (British), then any British English voice, then the device default", () => {
  const list = voiceChoices(raw);
  assert.equal(defaultVoice(list), 'com.apple.voice.enhanced.en-GB.Daniel');
  const noDaniel = voiceChoices([...raw.slice(0, 1), { identifier: 'en-gb-x-rjs-local', name: 'English (UK) 3', language: 'en-GB' }]);
  assert.equal(defaultVoice(noDaniel), 'en-gb-x-rjs-local');
  assert.equal(defaultVoice(voiceChoices([raw[0]])), undefined);
});

test('a saved voice is used only while the device still has it; otherwise the default', () => {
  const list = voiceChoices(raw);
  assert.equal(resolveVoice('Google US English', list), 'Google US English');
  assert.equal(resolveVoice('gone-voice', list), 'com.apple.voice.enhanced.en-GB.Daniel');
  assert.equal(resolveVoice(null, list), 'com.apple.voice.enhanced.en-GB.Daniel');
  assert.equal(resolveVoice('Google US English', null), undefined); // list not loaded yet: device default
});
