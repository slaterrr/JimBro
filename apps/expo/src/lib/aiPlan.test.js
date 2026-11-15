import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { requestAIPlan, validateAIPlan } from './aiPlan.js';
import { buildPlan } from './plans.js';

const request = { goal: 'hypertrophy', days_per_week: 3, minutes_per_session: 45, equipment: ['barbell', 'dumbbells'] };
const baseline = buildPlan(request);

describe('AI plan request', () => {
  it('does not call the network without an explicitly invoked request or configured proxy', async () => {
    let calls=0;
    const r=await requestAIPlan({ request, url: null, fetchImpl: async()=>{calls++;} });
    assert.equal(calls,0);
    assert.equal(r.source,'local');
    assert.deepEqual(r.plan,baseline);
  });
  it('sends only minimal set fields and accepts a validated plan', async () => {
    let sent;
    const fetchImpl=async (_url, opts) => {sent=JSON.parse(opts.body);return {ok:true,json:async()=>({ok:true,plan:baseline,explanation:'Tailored to your logged sets.'})};};
    const r=await requestAIPlan({ request, url:'https://proxy',key:'test',history:[{name:'Private workout name',sets:[{id:'private-id',exercise:'curl',reps:10,weight:20,unit:'lb',rpe:8}]}],fetchImpl });
    assert.equal(r.source,'ai');
    assert.equal(sent.recentSets[0].exercise,'curl');
    assert.ok(!JSON.stringify(sent).includes('Private workout name'));
    assert.ok(!JSON.stringify(sent).includes('private-id'));
  });
  it('rejects hallucinated exercises and preserves local fallback', async () => {
    const changed=structuredClone(baseline);
    changed.days[0].items[0].exercise='imaginary_lift';
    assert.equal(validateAIPlan(changed,request),false);
    const r=await requestAIPlan({ request,url:'https://proxy',fetchImpl:async()=>({ok:true,json:async()=>({ok:true,plan:changed})}) });
    assert.equal(r.source,'local');
    assert.deepEqual(r.plan,baseline);
  });
});
