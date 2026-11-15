import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
test('the read-only muscle sheet hides the keyboard action and fits its chat panel', () => {
  const muscles = src('screens/MusclesScreen.js');
  const home = src('screens/HomeScreen.js');
  assert.match(muscles, /<Sheet [^>]*hideKeyboardControl/);
  assert.match(src('components/kit.js'), /!hideKeyboardControl\s*\?\s*<TouchableOpacity accessibilityLabel="Hide keyboard"/);
  assert.match(home, /: m\.panel === 'muscles' \? <MusclesScreen embedded/);
});

