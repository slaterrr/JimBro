import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metrics, periods } from './comparison.js';
import { restSeconds } from './rest.js';
test('comparison converts units, isolates exercises and handles missing data', () => {
 const period = {workouts:[{sets:[{exercise:'bench',weight:100,unit:'kg',reps:5},{exercise:'curl',weight:20,unit:'kg',reps:10}]}]};
 assert.equal(metrics(period,'bench','kg').volume,500);
 assert.ok(Math.abs(metrics(period,'bench','lb').volume-1102.31)<0.1);
 assert.equal(metrics(period,'squat','kg').strength,null);
});
test('periods span years and sort workouts newest first', () => {
 const history = [{id:'a',name:'A',startedAt:'2025-06-15T12:00:00Z',sets:[]},{id:'b',name:'B',startedAt:'2026-06-15T12:00:00Z',sets:[]}];
 assert.equal(periods(history,'year').length,2);
 assert.equal(periods(history,'month').length,2);
 assert.equal(periods(history,'workout')[0].key,'b');
});
test('rest follows lift and rep demands', () => {
 assert.ok(restSeconds('bench',8)>restSeconds('curl',8));
 assert.ok(restSeconds('bench',3)>restSeconds('bench',8));
});
