/**
 * Spoken coaching for the squat tracker, using the browser's built-in speech
 * synthesis (Web Speech API). No network, no extra dependencies.
 *
 * What it says, and when:
 *  - setup instructions when tracking starts
 *  - "step back" if the legs are out of view for a while
 *  - "stand up tall" until the counter is armed, then "Ready"
 *  - the rep number after each counted rep (interrupts anything else)
 *  - why a rep didn't count, and measured form tips (e.g. fast descent)
 *  - "turn side-on" when the camera-view check says the user faces the camera
 *  - a short summary when the session ends
 *
 * Cues are rate-limited so it never talks over itself or nags. Only data the
 * tracker produced is spoken; nothing is invented.
 *
 * Browsers only allow speech after a user gesture, so call `attach()` (or
 * `speak()`) from a click handler such as the Start button.
 */

import type { FormFlag, RepEvent, WorkoutSession } from "../../../shared/types";
import type { TrackerState } from "./squat_tracker";

/** The parts of SquatTracker the coach needs (keeps it testable). */
export interface CoachableTracker {
  subscribe(listener: (state: TrackerState) => void): () => void;
  onRep(listener: (rep: RepEvent) => void): () => void;
  onRejected(listener: (flag: FormFlag) => void): () => void;
}

/** Minimal speech output, so tests and other engines can plug in. */
export interface Speaker {
  speak(text: string, options: { rate: number; pitch: number; lang: string; voice?: SpeechSynthesisVoice | null }): void;
  /** Stop current speech and clear the queue. */
  cancel(): void;
}

export interface VoiceCoachOptions {
  enabled?: boolean;
  rate?: number;
  pitch?: number;
  lang?: string;
  /** Speak setup instructions when tracking starts. */
  setupInstructions?: boolean;
  /** How long the legs must be out of view before "step back" (ms). */
  notVisibleDelayMs?: number;
  /** Minimum gap before the same cue repeats (ms). */
  repeatCooldownMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

const DEFAULTS = {
  enabled: true,
  rate: 1.05,
  pitch: 1,
  lang: "en-US",
  setupInstructions: true,
  notVisibleDelayMs: 2500,
  repeatCooldownMs: 8000,
} as const;

export const SETUP_INSTRUCTIONS =
  "Stand side on to the camera, about two to three metres back, with your whole body in view. " +
  "Then stand up tall to begin.";

/** Short spoken versions of form-flag codes. Codes not listed fall back to the flag's message. */
const SPOKEN: Record<string, string> = {
  SHALLOW_DEPTH: "Not counted. Go a little lower.",
  REP_TOO_FAST: "Not counted. Too quick.",
  REP_TOO_SLOW: "Not counted. That took too long.",
  TRACKING_LOST: "Not counted. I lost sight of your legs.",
  FAST_DESCENT: "Slow down on the way down.",
  CAMERA_NOT_SIDE_ON: "Turn side on to the camera.",
};

/** Flags worth saying out loud after a rep. Consistency flags stay on screen only. */
const SPOKEN_REP_FLAGS = new Set(["FAST_DESCENT"]);

export class VoiceCoach {
  private readonly o: Required<Omit<VoiceCoachOptions, "now">>;
  private readonly now: () => number;
  private enabled: boolean;
  private lastSaid = new Map<string, number>();
  private unsubs: Array<() => void> = [];
  private prev: TrackerState | null = null;
  private notVisibleSince: number | null = null;
  private voice: SpeechSynthesisVoice | null = null;

  constructor(
    private readonly tracker: CoachableTracker,
    options: VoiceCoachOptions = {},
    private readonly speaker: Speaker | null = browserSpeaker(),
  ) {
    const { now, ...rest } = options;
    this.o = { ...DEFAULTS, ...rest };
    this.now = now ?? (() => Date.now());
    this.enabled = this.o.enabled;
  }

  /** True when the browser can speak. */
  get supported(): boolean {
    return this.speaker !== null;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.speaker?.cancel();
  }

  /** Start listening to the tracker. Call from a click handler. Returns detach. */
  attach(): () => void {
    this.detach();
    this.unsubs.push(
      this.tracker.subscribe((s) => this.onState(s)),
      this.tracker.onRep((r) => this.onRep(r)),
      this.tracker.onRejected((f) => this.say(SPOKEN[f.code] ?? f.message, { key: f.code, cooldownMs: 0 })),
    );
    return () => this.detach();
  }

  detach(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.prev = null;
    this.notVisibleSince = null;
  }

  /** Speak the end-of-session summary. */
  announceSession(session: WorkoutSession): void {
    const n = session.summary?.totalReps ?? 0;
    this.say(n === 0 ? "Session ended. No reps counted." : `Nice work. ${n} ${n === 1 ? "rep" : "reps"}.`, {
      interrupt: true,
    });
  }

  /** Speak arbitrary text (respects the on/off switch). */
  speak(text: string): void {
    this.say(text, { interrupt: true });
  }

  // ---- internals -------------------------------------------------------

  private onState(s: TrackerState): void {
    const prev = this.prev;
    this.prev = s;
    const t = this.now();

    if (s.status === "tracking" && prev?.status !== "tracking") {
      this.notVisibleSince = null;
      if (prev?.status === "paused") this.say("Resuming.", { interrupt: true });
      else if (this.o.setupInstructions) {
        this.say(SETUP_INSTRUCTIONS, { key: "setup", interrupt: true });
        // The instructions already end with "stand up tall"; don't repeat it straight away.
        this.lastSaid.set("stand-up", t);
      }
    }
    if (s.status === "paused" && prev?.status === "tracking") this.say("Paused.", { interrupt: true });
    if (s.status === "error" && s.error && prev?.error?.code !== s.error.code) {
      this.say(s.error.message, { interrupt: true });
    }
    if (s.status !== "tracking") return;

    // Out of view for a while → step back.
    if (!s.landmarksVisible) {
      this.notVisibleSince ??= t;
      if (t - this.notVisibleSince >= this.o.notVisibleDelayMs) {
        this.say("Step back so I can see your hips, knees and ankles.", { key: "not-visible" });
      }
    } else {
      this.notVisibleSince = null;
    }

    // Visible but not yet armed → stand up tall; armed → ready.
    if (s.landmarksVisible && !s.armed) {
      this.say("Stand up tall to begin.", { key: "stand-up" });
    }
    if (s.armed && prev && !prev.armed) {
      this.say("Ready. Start squatting.", { key: "ready", cooldownMs: 0 });
    }

    if (s.viewWarning && !prev?.viewWarning) {
      this.say(SPOKEN[s.viewWarning.code] ?? s.viewWarning.message, { key: s.viewWarning.code });
    }
  }

  private onRep(rep: RepEvent): void {
    // The count is the most important thing: say it now, cutting off anything else.
    this.say(String(rep.repNumber), { interrupt: true, cooldownMs: 0 });
    for (const f of rep.formFlags) {
      if (SPOKEN_REP_FLAGS.has(f.code)) this.say(SPOKEN[f.code] ?? f.message, { key: f.code });
    }
  }

  private say(text: string, opts: { key?: string; interrupt?: boolean; cooldownMs?: number } = {}): void {
    if (!this.enabled || !this.speaker) return;
    const key = opts.key ?? text;
    const cooldown = opts.cooldownMs ?? this.o.repeatCooldownMs;
    const t = this.now();
    const last = this.lastSaid.get(key);
    if (last !== undefined && t - last < cooldown) return;
    this.lastSaid.set(key, t);
    if (opts.interrupt) this.speaker.cancel();
    // Voices load asynchronously in some browsers, so pick lazily.
    this.voice ??= pickVoice(this.o.lang);
    this.speaker.speak(text, { rate: this.o.rate, pitch: this.o.pitch, lang: this.o.lang, voice: this.voice });
  }
}

/** Speaker backed by window.speechSynthesis, or null if unavailable. */
export function browserSpeaker(): Speaker | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const synth = window.speechSynthesis;
  return {
    speak(text, { rate, pitch, lang, voice }) {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate;
      u.pitch = pitch;
      u.lang = lang;
      if (voice) u.voice = voice;
      synth.speak(u);
    },
    cancel() {
      synth.cancel();
    },
  };
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split("-")[0] ?? lang;
  return (
    voices.find((v) => v.lang === lang && v.localService) ??
    voices.find((v) => v.lang === lang) ??
    voices.find((v) => v.lang.startsWith(base)) ??
    null
  );
}
