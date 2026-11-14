/** Browser speech adapters. Both degrade gracefully when the API is missing. */

export type Listen = (onTranscript: (text: string) => void) => () => void;

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => RecognitionLike;

export function browserListen(): Listen | null {
  const w = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  return (onTranscript) => {
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript;
      if (text) onTranscript(text);
    };
    rec.start();
    return () => rec.stop();
  };
}

export function browserSpeak(text: string): void {
  if (!("speechSynthesis" in globalThis)) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}
