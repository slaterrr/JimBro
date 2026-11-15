// The model can request only these local UI operations. Persistence stays in AppState.
import { EXERCISES } from './exercises.js';
import { SAFETY } from './coach.js';

export const PANELS = ['camera', 'progress', 'muscles', 'plan', 'import'];
export const TOOL_NAMES = ['log_sets', 'correct_set', 'delete_set', 'get_recent_sets', 'get_goal_progress', 'get_weekly_checkin', 'get_last_set_report', 'get_workout_context', 'get_live_session', 'show_panel', 'build_program', 'get_program'];
const cameraIds = new Set(EXERCISES.filter(e => e.camera).map(e => e.id));

export function validateAction(action) {
  if (!action || action.type !== 'show_panel' || !PANELS.includes(action.panel)) return null;
  if (Object.keys(action).some(k => !['type', 'panel', 'exercise'].includes(k))) return null;
  if (action.exercise != null && (action.panel !== 'camera' || !cameraIds.has(action.exercise))) return null;
  return { type: 'show_panel', panel: action.panel, ...(action.exercise != null ? { exercise: action.exercise } : {}) };
}

export function toolReceipts(calls) {
  return Array.isArray(calls) ? calls.slice(0, 24).filter(c => c && TOOL_NAMES.includes(c.name) && ['completed', 'proposed', 'rejected'].includes(c.status)).map(({ name, status }) => ({ name, status })) : [];
}

export function chatAction(message) {
  if (SAFETY.test(message)) return null;
  const text = message.trim();
  let panel;
  if (/\b(start|open|use|track|count|record)\b.*\b(camera|workout|reps|squats|push.?ups)\b|\b(camera|workout)\s*(mode|please)?[.!]?$/i.test(text)) panel = 'camera';
  else if (/\b(show|review|open|see)\b.*\b(progress|history|records)\b/i.test(text)) panel = 'progress';
  else if (/\b(show|open|see)\b.*\b(muscles|muscle map|recovery)\b/i.test(text)) panel = 'muscles';
  else if (/\b(create|build|make|open)\b.*\bplan\b/i.test(text)) panel = 'plan';
  else if (/\bimport\b.*\b(workouts|history|csv|excel)\b/i.test(text)) panel = 'import';
  if (!panel) return null;
  const exercise = panel === 'camera' ? (/squat/i.test(text) ? 'squat' : /push.?up/i.test(text) ? 'push_up' : null) : null;
  return { type: 'show_panel', panel, ...(exercise ? { exercise } : {}) };
}
