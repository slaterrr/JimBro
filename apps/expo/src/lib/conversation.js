// UI session state only. The existing Jim engine owns reasoning/tools; AppState owns writes.
// Kept outside persisted workout data so future database exports never include chat by accident.
import { toolReceipts, validateAction } from './chatActions.js';

export function createConversation({ now = Date.now } = {}) {
  let snapshot = { messages: [], busy: false, source: 'offline', reason: null, error: null };
  let generation = 0;
  const listeners = new Set();
  const patch = values => { snapshot = { ...snapshot, ...values }; listeners.forEach(fn => fn()); };
  let sequence = 0;
  const update = fn => {
    const next = (typeof fn === 'function' ? fn(snapshot.messages) : fn).map(m => {
      if (!['confirm', 'camera-confirm'].includes(m.kind) || m.confirmationId) return m;
      return { ...m, confirmationId: `confirmation-${++sequence}`, expiresAt: now() + 5 * 60_000 };
    });
    const pending = next.findLast(m => ['confirm', 'camera-confirm'].includes(m.kind));
    patch({ messages: next.map(m => ['confirm', 'camera-confirm'].includes(m.kind) && m !== pending
      ? { kind: 'notice', text: 'That proposal was replaced by your newer request.' } : m) });
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    update,
    claimConfirmation(index, validate = () => true) {
      const message = snapshot.messages[index];
      if (!message || !['confirm', 'camera-confirm'].includes(message.kind)) return null;
      const intent = message.intent ?? message;
      const valid = message.expiresAt > now() && validate(intent);
      update(cur => cur.map((m, i) => i === index ? { kind: 'notice', text: valid ? 'Applying your confirmed change…' : 'This proposal expired or changed. Please ask Jim again.' } : m));
      return valid ? intent : null;
    },
    clear: () => { generation++; patch({ messages: [], busy: false, source: 'offline', reason: null, error: null }); },
    cancel: () => { generation++; patch({ busy: false }); },
    async send(raw, respond) {
      const text = raw.trim();
      if (!text || snapshot.busy) return null;
      const prior = snapshot.messages;
      const turn = ++generation;
      patch({ busy: true, error: null, messages: [...prior, { me: true, text }] });
      try {
        const result = await respond(prior);
        if (turn !== generation) return null;
        const calls = toolReceipts(result.toolCalls);
        const actions = (result.actions ?? []).map(validateAction).filter(Boolean).slice(0, 1);
        const output = result.messages ?? [
          ...(calls.length ? [{ kind: 'tools', calls }] : []),
          ...(result.reply ? [{ me: false, text: result.reply, safety: result.safety, suggestion: result.suggestion }] : []),
          ...(result.proposals ?? []).map(intent => ({ kind: 'confirm', intent })),
          ...actions.map(a => ({ kind: 'panel', panel: a.panel, exercise: a.exercise })),
        ];
        update([...snapshot.messages, ...output]);
        patch({ source: result.source === 'safety' ? snapshot.source : result.source,
          reason: result.reason ?? null });
        return result;
      } catch {
        if (turn === generation) patch({ error: 'Jim could not reply. Your message is still here; try again.' });
        return null;
      } finally {
        if (turn === generation) patch({ busy: false });
      }
    },
  };
}
