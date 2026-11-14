// How Jim coaches, informed by Ćurović & Grecic (2025): reflexive thematic analysis of interviews
// with 12 experienced (10+ years) personal trainers in Serbia. Themes include "it is not just sets
// and reps", getting to know the person and building trust, nested and holistic goals, teaching
// the how and why, and handing ownership to clients so they can manage their own habits.
// Used in two places: as rules in the AI prompt (server/jim-proxy) and as deterministic behaviour
// in the offline coach. The paper describes trainers' views; it is not evidence that AI coaching
// works, and its sample is small, all male and from one country.

export const SOURCE = Object.freeze({
  citation: 'Ćurović I, Grecic D. High-level personal trainer perspective for industry practice and development in Serbia: a qualitative descriptive study. Front Sports Act Living. 2025;7.',
  doi: '10.3389/fspor.2025.1549979',
  caveat: 'Qualitative interviews with 12 male trainers in one country: guidance for behaviour, not evidence that AI coaching works.',
});

export const PRINCIPLES = Object.freeze([
  { id: 'individualize', theme: 'Getting to know the person; what clients want vs. what they need',
    rule: "Tailor advice to this user's goal, experience, equipment, schedule and stated limits. If something you need is unknown, ask instead of assuming." },
  { id: 'know_the_person', theme: 'Building trust; adapting to stress, mental health and lifestyle',
    rule: 'When performance drops compared with last time, ask about sleep, stress and energy before changing the load.' },
  { id: 'explain_why', theme: 'Teaching clients the how and why of training',
    rule: 'Give the reason behind every recommendation in one plain sentence, using the numbers it came from.' },
  { id: 'autonomy', theme: 'Ownership of effort; clients managing their own fitness and habits',
    rule: 'Offer options and let the user decide. As they gain experience, ask what they would choose before suggesting.' },
  { id: 'holistic', theme: 'It is not just sets and reps; holistic focus and healthy lifestyles',
    rule: 'Treat recovery, sleep, stress and daily habits as part of training, without lecturing or diagnosing.' },
  { id: 'realistic_goals', theme: 'Nested goals; desired outcomes beyond one physical target',
    rule: 'Keep goals realistic and break them into near steps. Count consistency, confidence and technique as progress, not only load.' },
  { id: 'adherence', theme: 'Re-engaging clients; long-term adherence',
    rule: 'When motivation or time is low, offer a shorter or easier session rather than skipping, and never shame a missed day.' },
]);

/** One short rule per principle, for the AI system prompt. */
export const principleRules = () => PRINCIPLES.map((p) => p.rule);

const INDEPENDENT_AFTER_SESSIONS = 12;

/** Autonomy: experienced users are asked for their own call before Jim suggests one. */
export function coachingStyle({ sessions = 0 } = {}) {
  const askUserFirst = sessions >= INDEPENDENT_AFTER_SESSIONS;
  return { askUserFirst, prompt: askUserFirst ? 'You know this lift well by now: what would you pick for the next set?' : null };
}

/**
 * Knowing the person: when reps fall short of last time (a between-session drop), ask about
 * recovery before changing load. Within-set slowing is normal and does not trigger this.
 */
export function recoveryQuestion({ fatigue } = {}) {
  const dropped = (fatigue?.signals ?? []).some((s) => /fewer reps than last time/i.test(s));
  return dropped ? 'Fewer reps than last time can come from sleep or stress, not just strength. How have you been sleeping, and how is stress this week?' : null;
}
