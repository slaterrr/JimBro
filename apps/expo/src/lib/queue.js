import { ApiError } from './api.js';

// Offline-first set log. Workouts started offline get a local session id; the server
// session is created on first sync and remembered. Set ids are idempotency keys, so a
// resend after a lost response cannot double-log.
const KEY = 'jimbro.queue.v1';

export class SetQueue {
  constructor(api, storage, onRejected = () => {}) {
    this.api = api;
    this.storage = storage;
    this.onRejected = onRejected;
  }

  async load() {
    try {
      const v = JSON.parse((await this.storage.getItem(KEY)) ?? '{}');
      return { items: Array.isArray(v.items) ? v.items : [], sessions: v.sessions ?? {} };
    } catch {
      return { items: [], sessions: {} };
    }
  }

  async save(state) {
    await this.storage.setItem(KEY, JSON.stringify(state));
  }

  async pending() {
    return (await this.load()).items;
  }

  /** Server session id for a local one, if it has been created already. */
  async sessionFor(localSession) {
    return (await this.load()).sessions[localSession] ?? null;
  }

  async submit(id, localSession, body) {
    const state = await this.load();
    if (!state.items.some((i) => i.id === id)) state.items.push({ id, localSession, body });
    await this.save(state);
    return this.flush();
  }

  async serverSession(state, localSession) {
    if (!state.sessions[localSession]) {
      state.sessions[localSession] = (await this.api.createSession()).id;
      await this.save(state);
    }
    return state.sessions[localSession];
  }

  /** Send everything we can; returns how many sets the Pi accepted. */
  async flush() {
    const state = await this.load();
    let sent = 0;
    for (const item of [...state.items]) {
      try {
        const session_id = await this.serverSession(state, item.localSession);
        await this.api.completeSet(item.id, { ...item.body, session_id });
        sent += 1;
      } catch (e) {
        const permanent = e instanceof ApiError && e.status >= 400 && e.status < 500;
        if (!permanent) break; // offline or server busy: keep order, try later
        this.onRejected(item.id, e);
      }
      state.items = state.items.filter((i) => i.id !== item.id);
      await this.save(state);
    }
    return sent;
  }
}
