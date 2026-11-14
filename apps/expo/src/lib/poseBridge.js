// Web bridge for the pose page: messages arrive by window.postMessage instead of the React Native
// WebView bridge. Only JSON strings with the pose page's message types are passed on.
const TYPES = new Set(['ready', 'frame', 'error']);

export function isPoseMessage(data) {
  if (typeof data !== 'string') return false;
  try {
    return TYPES.has(JSON.parse(data)?.type);
  } catch {
    return false;
  }
}

/** Same shape as a WebView onMessage event, so screens handle both alike. */
export const fromFrame = (data) => ({ nativeEvent: { data } });
