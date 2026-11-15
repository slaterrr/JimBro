// Saving a plan keeps the previous one, newest last, capped.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withSavedPlan } from './planVersions.js';

test('saving keeps earlier plans as versions', () => {
  let d = { plan: null, planVersions: [] };
  d = withSavedPlan(d, { name: 'A' }, '2026-11-14T10:00:00.000Z');
  assert.equal(d.plan.name, 'A');
  assert.deepEqual(d.planVersions, []);
  d = withSavedPlan(d, { name: 'B' }, '2026-11-14T11:00:00.000Z');
  assert.equal(d.plan.name, 'B');
  assert.equal(d.plan.savedAt, '2026-11-14T11:00:00.000Z');
  assert.deepEqual(d.planVersions.map(p => [p.name, p.replacedAt]), [['A', '2026-11-14T11:00:00.000Z']]);
  for (let i = 0; i < 15; i += 1) d = withSavedPlan(d, { name: `P${i}` }, 'now');
  assert.equal(d.planVersions.length, 10);
  assert.equal(d.planVersions.at(-1).name, 'P13');
});
test('old saves without versions still work', () => {
  assert.equal(withSavedPlan({ plan: { name: 'old' } }, { name: 'new' }, 'now').planVersions[0].name, 'old');
});
