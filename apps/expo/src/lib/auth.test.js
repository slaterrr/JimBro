import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { createAuth, dataKeyFor, loadWorkoutData, validateCredentials } from './auth.js';

// In-memory AsyncStorage stand-in and a real SHA-256, like expo-crypto gives the app.
const memory = () => { const m = new Map(); return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); }, removeItem: async (k) => { m.delete(k); }, dump: () => m }; };
const sha256 = async (s) => createHash('sha256').update(s).digest('hex');
let n = 0;
const make = (store = memory()) => ({ store, auth: createAuth({ storage: store, sha256, salt: () => `salt${++n}` }) });

describe('validateCredentials', () => {
  it('needs a real-looking email and a password of at least 6 characters', () => {
    assert.equal(validateCredentials('a@b.co', 'secret1'), null);
    assert.match(validateCredentials('nope', 'secret1'), /email/i);
    assert.match(validateCredentials('a@b.co', '123'), /6 characters/);
  });
});

describe('sign up, sign in, sign out', () => {
  it('sign up creates the account and signs in immediately (no email confirmation)', async () => {
    const { auth } = make();
    const r = await auth.signUp(' Alex@Example.com ', 'secret1');
    assert.deepEqual(r, { ok: true, email: 'alex@example.com' });
    assert.equal(await auth.currentUser(), 'alex@example.com');
  });
  it('never stores the password itself', async () => {
    const { auth, store } = make();
    await auth.signUp('a@b.co', 'secret1');
    assert.doesNotMatch([...store.dump().values()].join(' '), /secret1/);
  });
  it('the same email cannot sign up twice', async () => {
    const { auth } = make();
    await auth.signUp('a@b.co', 'secret1');
    assert.match((await auth.signUp('A@B.co', 'other12')).error, /already/i);
  });
  it('sign in checks the password; unknown emails get a clear message', async () => {
    const { auth } = make();
    await auth.signUp('a@b.co', 'secret1');
    await auth.signOut();
    assert.equal(await auth.currentUser(), null);
    assert.match((await auth.signIn('a@b.co', 'wrong12')).error, /password/i);
    assert.match((await auth.signIn('x@y.co', 'secret1')).error, /no account/i);
    assert.deepEqual(await auth.signIn('A@b.co', 'secret1'), { ok: true, email: 'a@b.co' });
  });
  it('invalid input is rejected before touching storage', async () => {
    const { auth } = make();
    assert.match((await auth.signUp('bad', 'secret1')).error, /email/i);
  });
});

describe('dataKeyFor', () => {
  it('gives each account its own workout data', () => {
    assert.equal(dataKeyFor('a@b.co'), 'jimbro.data.v2:a@b.co');
    assert.notEqual(dataKeyFor('a@b.co'), dataKeyFor('c@d.co'));
  });
});

describe('loadWorkoutData', () => {
  const legacy = JSON.stringify({ history: [{ id: 'old-workout' }], active: { id: 'ongoing' } });

  it('recovers pre-login history and an active workout for the sole local account', async () => {
    const { auth, store } = make();
    await store.setItem('jimbro.data.v2', legacy);
    await auth.signUp('a@b.co', 'secret1');
    assert.equal(await loadWorkoutData(store, dataKeyFor('a@b.co')), legacy);
    assert.equal(await store.getItem(dataKeyFor('a@b.co')), legacy);
    assert.equal(await store.getItem('jimbro.data.v2'), legacy);
  });

  it('preserves an existing account save and isolates legacy data on shared devices', async () => {
    const { auth, store } = make();
    await store.setItem('jimbro.data.v2', legacy);
    await auth.signUp('a@b.co', 'secret1');
    await store.setItem(dataKeyFor('a@b.co'), '{"history":[{"id":"new"}]}');
    await auth.signUp('c@d.co', 'secret2');
    assert.equal(await loadWorkoutData(store, dataKeyFor('a@b.co')), '{"history":[{"id":"new"}]}');
    assert.equal(await loadWorkoutData(store, dataKeyFor('c@d.co')), null);
  });
});
