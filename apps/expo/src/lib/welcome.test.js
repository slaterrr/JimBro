// Spoken welcome: once per launch, after settings load, respecting mute, with a gesture fallback.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createWelcome, WELCOME_TEXT, welcomeDecision } from './welcome.js';

const fakeVoice = () => {
  const said = [];
  let stops = 0;
  let fail = null;
  return {
    said, get stops() { return stops; }, failNext(code) { fail = code; },
    say(text, opts = {}) { said.push({ text, opts }); if (fail) { const c = fail; fail = null; opts.onError?.({ error: c }); } return true; },
    stop() { stops += 1; },
  };
};

describe('welcomeDecision', () => {
  it('muted, needs a gesture on web without activation, otherwise speaks', () => {
    assert.equal(welcomeDecision({ speak: false, platform: 'ios' }), 'muted');
    assert.equal(welcomeDecision({ speak: true, platform: 'web', userActivated: false }), 'needs_gesture');
    assert.equal(welcomeDecision({ speak: true, platform: 'web', userActivated: true }), 'speak');
    assert.equal(welcomeDecision({ speak: true, platform: 'android' }), 'speak');
  });
});

describe('createWelcome', () => {
  it('has the exact greeting', () => {
    assert.equal(WELCOME_TEXT, "Hi, I'm Jim, your personal gym assistant. What are we training today?");
  });

  it('speaks once per launch, even if started again', () => {
    const v = fakeVoice();
    const w = createWelcome(v);
    assert.equal(w.start({ speak: true }, { platform: 'ios' }), 'spoken');
    assert.equal(w.start({ speak: true }, { platform: 'ios' }), 'spoken');
    assert.equal(v.said.length, 1);
    assert.equal(v.said[0].text, WELCOME_TEXT);
    assert.equal(v.said[0].opts.interrupt, true);
  });

  it('respects mute: no speech, replay stays silent', () => {
    const v = fakeVoice();
    const w = createWelcome(v);
    assert.equal(w.start({ speak: false }, { platform: 'ios' }), 'muted');
    assert.equal(w.replay({ speak: false }), false);
    assert.equal(v.said.length, 0);
  });

  it('web without a gesture waits for "Enable Jim\'s voice", then speaks once', () => {
    const v = fakeVoice();
    const w = createWelcome(v);
    assert.equal(w.start({ speak: true }, { platform: 'web', userActivated: false }), 'needs_gesture');
    assert.equal(v.said.length, 0);
    assert.equal(w.enable(), 'spoken');
    assert.equal(w.enable(), 'spoken');
    assert.equal(v.said.length, 1);
  });

  it('a blocked speech engine falls back to the gesture button', () => {
    const v = fakeVoice();
    v.failNext('not-allowed');
    const seen = [];
    const w = createWelcome(v, { onChange: (s) => seen.push(s) });
    w.start({ speak: true }, { platform: 'web', userActivated: true });
    assert.equal(w.state, 'needs_gesture');
    assert.deepEqual(seen.at(-1), 'needs_gesture');
    assert.equal(w.enable(), 'spoken');
    assert.equal(v.said.length, 2);
  });

  it('replay speaks again and interrupts; stop stops', () => {
    const v = fakeVoice();
    const w = createWelcome(v);
    w.start({ speak: true }, { platform: 'ios' });
    assert.equal(w.replay({ speak: true }), true);
    assert.equal(v.said.length, 2);
    w.stop();
    assert.equal(v.stops, 1);
  });
});
