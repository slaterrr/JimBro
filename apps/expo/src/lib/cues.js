// What Jim says during a live camera set. Pace comes from measured phase timing;
// form tips are fixed per movement (the camera can't judge form, so we don't pretend to).
// With a `persona`, wording follows that persona; facts and tracking messages stay identical.
import { byPersona, pick } from './voice.js';

export const FORM = {
  curl: 'Keep your elbows pinned to your sides.',
  squat: 'Hips back, chest up, knees over toes.',
  shoulder_press: 'Brace your core and lock out overhead.',
};
const LOST = "I can't see you — step back so your whole body part is in frame.";
const LOW = 'Turn side-on and get more light on you.';
const more = (n) => `${n} more rep${n === 1 ? '' : 's'}`;

// Per persona: done, ready, fast (concentric too quick), drop (eccentric too quick), pace(left?) variants.
const CUES = {
  coach: {
    done: () => "That's the set! Rack it, rest, and we'll set the next target.",
    ready: (f) => `Ready when you are. ${f}`,
    fast: (f) => `Control the lift — no bouncing. ${f}`,
    drop: (f) => `Lower slower — about two seconds down. ${f}`,
    pace: [(l, f) => `Good pace${l ? ` — ${more(l)}` : ''}. ${f}`, (l, f) => `Nice rep${l ? `, ${more(l)}` : ''}. ${f}`],
  },
  hype: {
    done: () => "That's the set! You crushed it!",
    ready: () => "Let's go! Show me what you've got!",
    fast: () => 'Whoa, control it! No bouncing, own every rep!',
    drop: () => 'Slow it down on the way down! About two seconds!',
    pace: [(l) => (l ? `Yes! ${more(l)}! Keep going!` : 'Yes! Keep going!'), (l) => (l ? `Beautiful! ${more(l)}!` : 'Beautiful!')],
  },
  drill: {
    done: () => 'Target hit. Set complete. Rack it.',
    ready: () => 'On my count. Hit the target.',
    fast: () => 'Too fast. Control the lift. No bouncing.',
    drop: () => 'Lower slower. Two seconds down.',
    pace: [(l) => (l ? `${more(l)} to target. Keep moving.` : 'Keep moving.'), (l) => (l ? `${more(l)}. Finish the plan.` : 'Finish the plan.')],
  },
  zen: {
    done: () => "That's the set. Set it down gently and rest.",
    ready: () => 'Breathe in. Begin when you feel ready.',
    fast: () => 'Ease off the speed. Lift with control, no bouncing.',
    drop: () => 'Let it lower slowly, about two seconds down.',
    pace: [(l) => (l ? `Lovely tempo. ${more(l)}, breathe.` : 'Lovely tempo. Breathe.'), (l) => (l ? `Smooth and steady, ${more(l)}.` : 'Smooth and steady.')],
  },
  analyst: {
    done: () => 'Target reached. Set complete, rest now.',
    ready: () => 'Tracking. Rep timing starts on your first lift.',
    fast: () => 'Lift phase too short. Control the lift, no bouncing.',
    drop: () => 'Lowering phase too short. Aim for two seconds down.',
    pace: [(l) => (l ? `Tempo on target. ${more(l)}.` : 'Tempo on target.'), (l) => (l ? `Timing consistent. ${more(l)} left.` : 'Timing consistent.')],
  },
};

export function liveCue({ movement, count, target, lastRep, tracking, persona }) {
  if (tracking === 'lost') return LOST;
  if (tracking === 'low') return LOW;
  const form = FORM[movement] ?? '';
  const c = persona ? byPersona(CUES, persona) : CUES.coach;
  const left = target ? target - count : null;
  if (target && count >= target) return persona ? c.done() : "That's the set! Rack it and rest.";
  if (!lastRep) return c.ready(form).trim();
  if (lastRep.concentric_ms < 500) return c.fast(form).trim();
  if (lastRep.eccentric_ms < 800) return c.drop(form).trim();
  return (persona ? pick(c.pace, count) : c.pace[0])(left, form).trim();
}
