// Camera + pose page in a browser (Expo web): react-native-webview has no web version, so the same
// page runs in an iframe and talks to the app with window.postMessage (see lib/poseBridge.js).
// Video stays in the iframe on this computer; only landmarks reach the app.
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { fromFrame, isPoseMessage } from '../lib/poseBridge.js';

export const PoseView = forwardRef(function PoseView({ html, onMessage, style }, ref) {
  const frame = useRef(null);
  const handler = useRef(onMessage);
  handler.current = onMessage;

  // Same call the screen makes on the WebView: postMessage(string) into the page.
  useImperativeHandle(ref, () => ({
    postMessage: (data) => frame.current?.contentWindow?.postMessage(data, '*'),
  }), []);

  useEffect(() => {
    const listen = (e) => {
      if (e.source !== frame.current?.contentWindow || !isPoseMessage(e.data)) return;
      handler.current?.(fromFrame(e.data));
    };
    window.addEventListener('message', listen);
    return () => {
      window.removeEventListener('message', listen);
      try { frame.current?.contentWindow?.postMessage(JSON.stringify({ type: 'stop' }), '*'); } catch { /* page gone */ }
    };
  }, []);

  return (
    <iframe
      ref={frame}
      title="Camera and pose tracking"
      srcDoc={html}
      allow="camera; autoplay"
      style={{ border: 0, width: '100%', height: '100%', display: 'block', background: '#000', ...(style || {}) }}
    />
  );
});
