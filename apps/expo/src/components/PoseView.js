// Camera + pose page on phones: the React Native WebView. (Web uses PoseView.web.js.)
import React, { forwardRef } from 'react';
import { WebView } from 'react-native-webview';

export const PoseView = forwardRef(function PoseView({ html, onMessage, style }, ref) {
  return (
    <WebView
      ref={ref}
      source={{ html, baseUrl: 'https://localhost/' }}
      originWhitelist={['*']}
      onMessage={onMessage}
      javaScriptEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      mediaCapturePermissionGrantType="grant"
      style={style}
    />
  );
});
