// What Jim says during a live camera set. Pace comes from measured phase timing;
// form tips are fixed per movement (the camera can't judge form, so we don't pretend to).
const FORM = {
  curl: 'Keep your elbows pinned to your sides.',
  squat: 'Hips back, chest up, knees over toes.',
  shoulder_press: 'Brace your core and lock out overhead.',
};

export function liveCue({ movement, count, target, lastRep, tracking }) {
  if (tracking === 'lost') return "I can't see you — step back so your whole body part is in frame.";
  if (tracking === 'low') return 'Turn side-on and get more light on you.';
  const form = FORM[movement] ?? '';
  if (target && count >= target) return "That's the set! Rack it and rest.";
  if (!lastRep) return `Ready when you are. ${form}`;
  if (lastRep.concentric_ms < 500) return `Control the lift — no bouncing. ${form}`;
  if (lastRep.eccentric_ms < 800) return `Lower slower — about two seconds down. ${form}`;
  const left = target ? target - count : null;
  return left ? `Good pace — ${left} more rep${left === 1 ? '' : 's'}. ${form}` : `Good pace. ${form}`;
}
