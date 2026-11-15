// On-device accounts: email + password, no email confirmation, no server.
// Passwords are never stored: only a salted SHA-256 per account. Each account gets its own
// workout data (dataKeyFor), so a new sign-up starts fresh with the first-run setup.
const ACCOUNTS = 'jimbro.accounts.v1';
const SESSION = 'jimbro.session.v1';
export const LEGACY_WORKOUT_KEY = 'jimbro.data.v2';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normalizeEmail = (e) => String(e ?? '').trim().toLowerCase();
export const dataKeyFor = (email) => `${LEGACY_WORKOUT_KEY}:${normalizeEmail(email)}`;

/** Carry pre-login workouts forward only when a single local account can own them. */
export async function loadWorkoutData(storage, storageKey) {
  const saved = await storage.getItem(storageKey);
  if (saved !== null || !storageKey.startsWith(LEGACY_WORKOUT_KEY + ':')) return saved;

  const legacy = await storage.getItem(LEGACY_WORKOUT_KEY);
  if (legacy === null) return null;

  const emails = Object.keys(JSON.parse((await storage.getItem(ACCOUNTS)) ?? '{}'));
  if (emails.length !== 1 || dataKeyFor(emails[0]) !== storageKey) return null;

  // Read and validate before promoting the old snapshot. Keep the source for recovery.
  const snapshot = JSON.parse(legacy);
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Invalid pre-login workout data.');
  }
  await storage.setItem(storageKey, legacy);
  return legacy;
}

/** null when fine, else a message to show under the form. */
export function validateCredentials(email, password) {
  if (!EMAIL.test(normalizeEmail(email))) return 'Enter a valid email, like you@example.com.';
  if (String(password ?? '').length < 6) return 'Password needs at least 6 characters.';
  return null;
}

/** storage: AsyncStorage-like; sha256: async string -> hex; salt: () -> random string. */
export function createAuth({ storage, sha256, salt }) {
  const read = async () => JSON.parse((await storage.getItem(ACCOUNTS)) ?? '{}');
  const hash = (s, password) => sha256(`${s}:${password}`);
  const start = async (email) => { await storage.setItem(SESSION, email); return { ok: true, email }; };
  return {
    async currentUser() { return (await storage.getItem(SESSION)) || null; },
    async signUp(rawEmail, password) {
      const bad = validateCredentials(rawEmail, password);
      if (bad) return { error: bad };
      const email = normalizeEmail(rawEmail);
      const accounts = await read();
      if (accounts[email]) return { error: 'An account with this email already exists. Sign in instead.' };
      const s = salt();
      accounts[email] = { salt: s, hash: await hash(s, password), createdAt: new Date().toISOString() };
      await storage.setItem(ACCOUNTS, JSON.stringify(accounts));
      return start(email);
    },
    async signIn(rawEmail, password) {
      const email = normalizeEmail(rawEmail);
      const acct = (await read())[email];
      if (!acct) return { error: 'No account with that email on this phone. Sign up instead.' };
      if ((await hash(acct.salt, password)) !== acct.hash) return { error: 'Wrong password. Try again.' };
      return start(email);
    },
    async signOut() { await storage.removeItem(SESSION); },
  };
}
