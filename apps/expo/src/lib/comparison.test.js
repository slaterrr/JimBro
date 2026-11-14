import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPair, metrics, periods } from './comparison.js';
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
test('default comparison picks the two newest periods that include the exercise', () => {
 const w = (id, day, ex) => ({ id, name: id, startedAt: `2026-11-${day}T12:00:00Z`, sets: ex.map(e => ({ exercise: e, weight: 100, unit: 'lb', reps: 5 })) });
 const history = [w('a', '08', ['bench']), w('b', '10', ['bench']), w('c', '12', ['squat'])];
 const g = periods(history, 'workout');
 assert.deepEqual(defaultPair(g, 'bench'), ['a', 'b'].map(id => g.find(x => x.workouts[0].id === id).key));
 assert.deepEqual(defaultPair(g, 'deadlift'), [g[1].key, g[0].key]); // nothing logged: newest two
});
