// Jim's spoken welcome: once per app launch, after settings load, through the persona-aware voice
// (lib/sound.js). Respects the saved mute setting. Browsers can block speech until the user
// interacts with the page, so web gets a one-tap "Enable Jim's voice" fallback. Never touches
// the microphone.
export const WELCOME_TEXT = "Hi, I'm Jim, your personal gym assistant. What are we training today?";

/** 'muted' | 'needs_gesture' | 'speak' */
export function welcomeDecision({ speak, platform, userActivated } = {}) {
  if (!speak) return 'muted';
  if (platform === 'web' && userActivated === false) return 'needs_gesture';
  return 'speak';
}

/** voice: { say(text, opts) -> boolean, stop() }. States: idle, muted, needs_gesture, spoken. */
export function createWelcome(voice, { onChange = () => {} } = {}) {
  let state = 'idle';
  const set = (s) => { if (s !== state) { state = s; onChange(s); } return state; };
  const blocked = (e) => /not-allowed|interrupted-by-policy|audio-busy/i.test(String(e?.error ?? e?.message ?? e ?? ''));
  const speak = () => {
    set('spoken');
    voice.say(WELCOME_TEXT, { force: true, interrupt: true, onError: (e) => { if (blocked(e)) set('needs_gesture'); } });
    return state;
  };
  return {
    get state() { return state; },
    /** Call when settings have loaded. Speaks at most once per launch. */
    start(settings, env = {}) {
      if (state !== 'idle') return state;
      const d = welcomeDecision({ speak: settings?.speak, ...env });
      if (d === 'speak') return speak();
      return set(d);
    },
    /** The "Enable Jim's voice" button (a user gesture). */
    enable() { return state === 'needs_gesture' || state === 'idle' ? speak() : state; },
    /** Replay button: speaks again unless muted. */
    replay(settings) {
      if (!settings?.speak) return false;
      speak();
      return true;
    },
    stop() { voice.stop(); },
  };
}
