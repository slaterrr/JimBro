import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handlePlan } from './plan.js';
import { buildPlan } from '../../apps/expo/src/lib/plans.js';

const request = { goal: 'hypertrophy', days_per_week: 3, minutes_per_session: 45, equipment: ['barbell','dumbbells'] };
const client = (input) => {
  const calls = [];
  return { calls, messages: { create: async (r) => {
    calls.push(r);
    return { stop_reason: 'tool_use', content: [{type:'tool_use',name:'prioritize_plan',id:'1',input}] };
  }}};
};

describe('opt-in AI plan personalization', () => {
  it('retains deterministic equipment, sets, reps, rest, and duration while reordering exercises', async () => {
    const c = client({ priorities: ['curl','squat'], explanation: 'Prioritize curls and squats.' });
    const r = await handlePlan({ request, recentSets: [{ exercise: 'curl', reps: 8, weight: 20, unit: 'lb', rpe: 8 }] }, c);
    const base = buildPlan(request);
    assert.equal(c.calls.length, 1);
    assert.equal(r.ok, true);
    assert.equal(r.plan.days.length, 3);
    for (let n = 0; n < 3; n++) {
      assert.deepEqual([...r.plan.days[n].items].sort((a,b)=>a.exercise.localeCompare(b.exercise)), [...base.days[n].items].sort((a,b)=>a.exercise.localeCompare(b.exercise)));
      assert.equal(r.plan.days[n].estimated_minutes, base.days[n].estimated_minutes);
    }
  });
  it('rejects bad requests without calling Claude', async () => {
    const c = client({ priorities: [], explanation: '' });
    await assert.rejects(handlePlan({ request: { ...request, days_per_week: 99 } }, c), /days_per_week/);
    assert.equal(c.calls.length, 0);
  });
  it('discards unknown or irrelevant exercise priorities', async () => {
    const c = client({ priorities: ['unknown','curl','curl'], explanation: 'Keep progressing.' });
    const r = await handlePlan({ request }, c);
    assert.equal(r.ok, true);
    assert.ok(r.plan.days.every(d => d.items.every(i => i.exercise !== 'unknown')));
  });
  it('falls back to local plan when Claude does not call the tool', async () => {
    const c = { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{type:'text',text:'No proposal'}] }) } };
    const r = await handlePlan({ request }, c);
    assert.equal(r.ok, false);
    assert.deepEqual(r.plan, buildPlan(request));
  });
});
