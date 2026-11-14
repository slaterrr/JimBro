// Spoken post-set report: a few short sentences built only from numbers in setReport().
// No effort, fatigue or form judgments are invented.
const NOUN = { curl: 'curls', squat: 'squats' };
const ISSUE_WORDS = { arm_swing: 'arm swing', framing: 'out of frame', implausible_motion: 'tracking jumped', tracking: 'lost tracking' };
const MIN_TEMPO_PCT = 10;

/** One to three short sentences (< 25 words) for Jim to say after a camera set. */
export function spokenReport(report, tone = 'calm') {
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
    parts.push(tone === 'hype' ? 'Every rep counted. Nice work.' : 'Every rep counted.');
  }
  return parts.join(' ');
}
