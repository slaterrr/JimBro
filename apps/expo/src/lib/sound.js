// The one place that makes Jim speak (sound engine; wording lives in voice.js). Screens call say()/cue(); nothing else touches the
// speech engine, so sound rules (on/off, persona voice, interruptions, iOS silent mode) are
// defined and tested once.
import { speechOptions } from './personas.js';
import { resolveVoice, voiceChoices } from './voices.js';

// v1: voice became on by default. Saves without this version stored the old default (off).
export const VOICE_SETTINGS_VERSION = 1;

export function migrateVoiceSettings(settings) {
  const s = { ...(settings ?? {}) };
  if (s.voiceVersion !== VOICE_SETTINGS_VERSION) {
    s.speak = true;
    s.voiceVersion = VOICE_SETTINGS_VERSION;
  }
  return s;
}

/**
 * engine: { speak(text, opts), stop(), setAudioMode?(mode) } (expo-speech + expo-audio in the app).
 * getSettings: () => current { speak, persona }.
 */
export function createVoice(engine, getSettings) {
  let audioReady = null;
  let voices = null; // device voices once loaded (lib/voices.js); null = use the device default
  const opts = (persona, extra) => ({ ...speechOptions(persona), ...extra });

  const say = (text, { force = false, persona, interrupt = force, onDone, onError, voiceId } = {}) => {
    const s = getSettings() ?? {};
    if (!text || !(force || s.speak)) return false;
    if (interrupt) engine.stop();
    const voice = resolveVoice(voiceId ?? s.voiceId, voices);
    engine.speak(String(text), opts(persona ?? s.persona, { ...(voice ? { voice } : {}), ...(onDone ? { onDone } : {}), ...(onError ? { onError } : {}) }));
    return true;
  };

  return {
    say,
    /** Live cues (rep counts, "Not counted"): always replace whatever is playing. */
    cue: (text, o = {}) => say(text, { ...o, interrupt: true }),
    stop: () => engine.stop(),
    /** Device voices (expo-speech Voice objects); returns the normalized list for the picker. */
    setAvailableVoices: (raw) => { voices = voiceChoices(raw); return voices; },
    /** Let speech play with the iPhone ringer switch on silent. Safe to call repeatedly. */
    enableAudio: () => {
      audioReady ??= Promise.resolve()
        .then(() => engine.setAudioMode?.({ playsInSilentMode: true, shouldPlayInBackground: false }))
        .catch(() => {});
      return audioReady;
    },
  };
}
