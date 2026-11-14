// The pose page must also work in a browser (Expo web), where there is no React Native WebView:
// it runs in an iframe and talks to the app with window.postMessage.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { poseHtml } from './poseHtml.js';
import { fromFrame, isPoseMessage } from './poseBridge.js';

describe('pose page on web', () => {
  it('falls back to the parent window when there is no React Native bridge', () => {
    const html = poseHtml();
    assert.match(html, /window\.parent\.postMessage/);
    assert.match(html, /ReactNativeWebView/); // phones still use the native bridge
  });

  it('bridge accepts only the pose page messages, as WebView-style events', () => {
    const frame = JSON.stringify({ type: 'frame', t: 5, pose: null });
    assert.equal(isPoseMessage(frame), true);
    assert.equal(isPoseMessage(JSON.stringify({ type: 'webpackOk' })), false);
    assert.equal(isPoseMessage({ type: 'frame' }), false); // objects from other senders
    assert.equal(isPoseMessage('not json'), false);
    assert.deepEqual(fromFrame(frame), { nativeEvent: { data: frame } });
  });
});

describe('pose view wiring', () => {
  it('CoachScreen imports PoseView without an extension, so Metro picks PoseView.web.js on web', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../screens/CoachScreen.js', import.meta.url), 'utf8');
    assert.match(src, /from '\.\.\/components\/PoseView';/);
    assert.doesNotMatch(src, /react-native-webview/);
  });
});
