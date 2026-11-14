// Spoken post-set report: a few short sentences built only from numbers in setReport().
// No effort, fatigue or form judgments are invented. A persona only frames the same facts.
import { FORM } from './cues.js';
import { byPersona, pick } from './voice.js';

const NOUN = { curl: 'curls', squat: 'squats' };
const ISSUE_WORDS = { arm_swing: 'arm swing', framing: 'out of frame', implausible_motion: 'tracking jumped', tracking: 'lost tracking' };
const MIN_TEMPO_PCT = 10;
const MAX_WORDS = 24;

// Persona framing: a short lead-in, plus a closing line when it fits; hit = target met (or no target).
const FRAME = {
  coach: { lead: ['Good set.', 'Nice work.'], close: (r, hit) => [FORM[r.movement] ?? 'Good set, same form next time.', hit ? 'Same form next set.' : 'Build on it next set.'] },
  hype: { lead: ["Let's go!", 'Boom!'], close: (r, hit) => [hit && r.target ? 'Target smashed!' : 'Keep it rolling!'] },
  drill: { lead: ['Count:', 'Status:'], close: (r, hit) => [r.target ? (hit ? 'Target met.' : 'Short of target. Finish the plan.') : 'Logged. Next set.'] },
  zen: { lead: ['Easy now.', 'Gently done.'], close: () => ['Breathe and rest as long as you need.', 'Rest well before the next set.'] },
  analyst: { lead: ['Result:', 'Data:'], close: () => ['Logged for your trend.'] },
};

const wordCount = (s) => s.trim().split(/\s+/).length;

/** One to three short sentences for Jim to say after a camera set. */
export function spokenReport(report, persona) {
  if (!report) return '';
  const noun = NOUN[report.movement] ?? 'reps';
  const parts = [report.target ? `${report.counted} of ${report.target} ${noun}.` : `${report.counted} ${noun}.`];

  const issues = Object.entries(report.issues ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const missed = issues.reduce((a, [, n]) => a + n, 0);
  if (missed) {
    parts.push(`${missed} ${missed === 1 ? "wasn't" : "weren't"} counted: ${issues.slice(0, 2).map(([k]) => ISSUE_WORDS[k] ?? 'lost tracking').join(' and ')}.`);
  }

  const pct = report.tempo?.changePct;
  if (pct >= MIN_TEMPO_PCT) {
    parts.push(`Your last reps were ${pct}% slower — keep this weight.`);
  } else if (pct <= -MIN_TEMPO_PCT) {
    parts.push(`Your last reps were ${-pct}% faster.`);
  } else if (!missed) {
    parts.push(persona === 'hype' ? 'Every rep counted!' : 'Every rep counted.');
  }
  if (!persona || persona === 'calm') return parts.join(' ');

  // Persona framing never adds numbers, and is dropped rather than going over the word budget.
  const f = byPersona(FRAME, persona);
  const seed = report.counted ?? 0;
  const hit = !report.target || report.counted >= report.target;
  const lead = pick(f.lead, seed);
  const close = pick(f.close(report, hit), seed);
  let out = [lead, ...parts].filter(Boolean).join(' ');
  if (wordCount(`${out} ${close}`) <= MAX_WORDS) out = `${out} ${close}`;
  return out;
}
