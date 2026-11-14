// UI session state only. The existing Jim engine owns reasoning/tools; AppState owns writes.
// Kept outside persisted workout data so future database exports never include chat by accident.
export function createConversation() {
  let snapshot = { messages: [], busy: false, source: 'offline', reason: null, error: null };
  let generation = 0;
  const listeners = new Set();
  const patch = values => { snapshot = { ...snapshot, ...values }; listeners.forEach(fn => fn()); };
  const update = fn => patch({ messages: typeof fn === 'function' ? fn(snapshot.messages) : fn });
  return {
    getSnapshot: () => snapshot,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    update,
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
        const output = result.messages ?? [
          ...(result.reply ? [{ me: false, text: result.reply, safety: result.safety, suggestion: result.suggestion }] : []),
          ...(result.proposals ?? []).map(intent => ({ kind: 'confirm', intent })),
        ];
        patch({ messages: [...snapshot.messages, ...output], source: result.source === 'safety' ? snapshot.source : result.source,
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
