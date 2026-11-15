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
export function createVoice(engine, getSettings, { enabled = true, prepareBeforeSpeak = false, onPlaybackError } = {}) {
  let audioReady = null;
  let generation = 0;
  let voices = null; // device voices once loaded (lib/voices.js); null = use the device default
  const opts = (persona, extra) => ({ ...speechOptions(persona), ...extra });

  const say = (text, { force = false, persona, interrupt = force, onDone, onError, onStopped, voiceId } = {}) => {
    const s = getSettings() ?? {};
    if (!enabled || !text || !(force || s.speak)) return false;
    const voice = resolveVoice(voiceId ?? s.voiceId, voices);
    const failed = (error) => { onPlaybackError?.(error); onError?.(error); };
    const options = opts(persona ?? s.persona, { ...(voice ? { voice } : {}), ...(prepareBeforeSpeak ? { useApplicationAudioSession: true } : {}), ...(onDone ? { onDone } : {}), ...((onError || onPlaybackError) ? { onError: failed } : {}), ...(onStopped ? { onStopped } : {}) });
    if (prepareBeforeSpeak) {
      const ticket = ++generation;
      enableAudio().then(async () => {
        if (ticket !== generation) return;
        if (interrupt) await engine.stop();
        if (ticket !== generation) return;
        engine.speak(String(text), options);
      }).catch(failed);
    } else {
      if (interrupt) engine.stop();
      engine.speak(String(text), options);
    }
    return true;
  };

  const enableAudio = ({ refresh = false } = {}) => {
    if (!enabled) return Promise.resolve();
    if (refresh) audioReady = null;
    audioReady ??= Promise.resolve()
      .then(() => engine.setAudioMode?.({ playsInSilentMode: true, shouldPlayInBackground: false }))
      .catch((error) => { audioReady = null; if (prepareBeforeSpeak) throw error; });
    return audioReady;
  };

  return {
    say,
    /** Live cues (rep counts, "Not counted"): always replace whatever is playing. */
    cue: (text, o = {}) => say(text, { ...o, interrupt: true }),
    stop: () => { generation++; if (enabled) return engine.stop(); },
    /** Device voices (expo-speech Voice objects); returns the normalized list for the picker. */
    setAvailableVoices: (raw) => { voices = voiceChoices(raw); return voices; },
    /** Let speech play with the iPhone ringer switch on silent. Safe to call repeatedly. */
    enableAudio,
  };
}
