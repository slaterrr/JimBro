// Jim's text-to-speech voice. Voices come from the phone or browser (expo-speech
// getAvailableVoicesAsync); this module only normalizes and chooses. Jim's default is Daniel
// (British English), then any British English voice, then the device default. A saved choice
// is used only while the device still has it: on web, an unknown id would otherwise make
// expo-speech fall back to the first voice in the list.
export function voiceChoices(raw, { language = 'en' } = {}) {
  const seen = new Set();
  const all = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    if (!v || typeof v.identifier !== 'string' || !v.identifier || seen.has(v.identifier)) continue;
    seen.add(v.identifier);
    all.push({ id: v.identifier, name: String(v.name || v.identifier), language: String(v.language || ''), enhanced: v.quality === 'Enhanced' });
  }
  const lang = language.toLowerCase();
  const matching = all.filter((v) => v.language.toLowerCase().replace('_', '-').startsWith(lang));
  const list = matching.length ? matching : all;
  return list.sort((a, b) => Number(b.enhanced) - Number(a.enhanced) || a.name.localeCompare(b.name));
}

export const voiceLabel = (v) => `${v.name} · ${v.language}${v.enhanced ? ' · Enhanced' : ''}`;

const isBritish = (v) => /^en[-_]gb/i.test(v.language);

/** Jim's default voice id for this device, or undefined for the device default. */
export function defaultVoice(list) {
  if (!list?.length) return undefined;
  const daniel = list.filter((v) => isBritish(v) && /^daniel\b/i.test(v.name));
  return (daniel[0] ?? list.find(isBritish))?.id;
}

/** The voice id to speak with: the saved one if the device has it, else Jim's default. */
export function resolveVoice(voiceId, list) {
  if (!list) return undefined; // voices not loaded yet
  if (voiceId && list.some((v) => v.id === voiceId)) return voiceId;
  return defaultVoice(list);
}
