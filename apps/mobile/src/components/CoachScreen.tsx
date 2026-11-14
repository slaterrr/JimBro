import { useRef, useState } from "react";
import { newId, post, type ExerciseId, type SetPayload, type Unit } from "../api/client";
import { type ParsedSet, parseSetUtterance } from "../voice/parse";
import { browserListen, browserSpeak, type Listen } from "../voice/speech";

export type Tone = "direct" | "friendly" | "silly" | "hard";

interface Suggestion { exercise: ExerciseId; weight: number; unit: Unit; reps: number; rationale: string }
interface Reply { text: string; tone: Tone; source: "ai" | "fallback" | "safety"; suggestion: Suggestion | null }
interface Message { who: "me" | "jim"; text: string; source?: Reply["source"] }

interface Props {
  onLogSet: (id: string, body: SetPayload) => Promise<void>;
  onUseSuggestion?: (s: Suggestion) => void;
  speak?: (text: string) => void;
  listen?: Listen | null;
}

const TONES: Tone[] = ["direct", "friendly", "silly", "hard"];
const SOURCE_LABEL = { ai: "Jim (AI)", fallback: "Jim (offline coach)", safety: "Safety" } as const;

export function CoachScreen({ onLogSet, onUseSuggestion, speak = browserSpeak, listen = browserListen() }: Props) {
  const [tone, setTone] = useState<Tone>(() => (localStorage.getItem("jimbro.tone") as Tone) || "friendly");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [draft, setDraft] = useState<ParsedSet | null>(null);
  const [draftUnit, setDraftUnit] = useState<Unit>("kg");
  const [busy, setBusy] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  const ask = async (message: string) => {
    if (!message.trim()) return;
    setMessages((m) => [...m, { who: "me", text: message }]);
    setText("");
    setBusy(true);
    try {
      const r = await post<Reply>("/v1/coach", { message, tone });
      setMessages((m) => [...m, { who: "jim", text: r.text, source: r.source }]);
      setSuggestion(r.suggestion);
      speak(r.text);
    } catch {
      setMessages((m) => [...m, { who: "jim", text: "I can't reach the Pi right now. Your sets are still saved on the phone.", source: "fallback" }]);
    } finally {
      setBusy(false);
    }
  };

  const onTranscript = (t: string) => {
    const parsed = parseSetUtterance(t);
    if (parsed) {
      setDraft(parsed);
      setDraftUnit(parsed.unit ?? "kg");
    } else {
      void ask(t);
    }
  };

  const startTalking = () => {
    if (!listen) return;
    stopRef.current = listen(onTranscript);
  };
  const stopTalking = () => {
    stopRef.current?.();
    stopRef.current = null;
  };

  const confirmDraft = async () => {
    if (!draft) return;
    await onLogSet(newId(), {
      session_id: "",
      exercise: draft.exercise,
      reps: draft.reps,
      weight: draft.weight,
      unit: draftUnit,
      rpe: draft.rpe ?? null,
      source: "voice",
      reps_detail: [],
      confidence: null,
      model_version: null,
    });
    setDraft(null);
  };

  return (
    <section>
      <div className="row">
        <label style={{ flex: 1 }}>
          Tone
          <select value={tone} onChange={(e) => { setTone(e.target.value as Tone); localStorage.setItem("jimbro.tone", e.target.value); }}>
            {TONES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
          </select>
        </label>
      </div>

      <div aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.who === "me" ? "me" : ""}`}>
            {m.who === "jim" && <div className="muted small">{SOURCE_LABEL[m.source ?? "fallback"]}</div>}
            {m.text}
          </div>
        ))}
      </div>

      {suggestion && (
        <div className="card">
          <strong>Suggested next set</strong>
          <div>{suggestion.exercise.replace("_", " ")}: {suggestion.weight} {suggestion.unit} × {suggestion.reps}</div>
          <div className="muted small">{suggestion.rationale}</div>
          {onUseSuggestion && <button onClick={() => onUseSuggestion(suggestion)}>Use this suggestion</button>}
        </div>
      )}

      {draft && (
        <div className="card" role="dialog" aria-label="Confirm voice set">
          <p>Log {draft.reps} × {draft.exercise.replace("_", " ")} at {draft.weight} {draftUnit}{draft.rpe ? ` (RPE ${draft.rpe})` : ""}?</p>
          {!draft.unit && (
            <label>Unit (not heard)
              <select value={draftUnit} onChange={(e) => setDraftUnit(e.target.value as Unit)}>
                <option value="kg">kg</option><option value="lb">lb</option>
              </select>
            </label>
          )}
          <div className="row">
            <button className="primary" onClick={() => void confirmDraft()}>Confirm</button>
            <button onClick={() => setDraft(null)}>Discard</button>
          </div>
        </div>
      )}

      <form className="row" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
        <label style={{ flex: 1 }}>
          <span className="sr-only">Message</span>
          <input aria-label="Message" placeholder="Ask Jim…" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <button className="primary" type="submit" disabled={busy}>Send</button>
        {listen && (
          <button type="button" onPointerDown={startTalking} onPointerUp={stopTalking} onPointerLeave={stopTalking}>
            🎙 Hold to talk
          </button>
        )}
      </form>
      <p className="muted small">Say a set like "10 curls at 20 pounds RPE 7" – you'll confirm before it's saved.</p>
    </section>
  );
}
