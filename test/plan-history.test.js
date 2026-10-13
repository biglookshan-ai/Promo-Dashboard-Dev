// 改价计划的历史版本:每次动作记一版、删掉的保留
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction } from '../src/price/price-actions.js';
import { recordPlanChanges } from '../src/price/plan-history.js';
import { changedKeys } from '../src/item-history.js';

const H = 3600_000;
const boss = { id: '1', name: '审核人', role: 'approver' };
const item = (variantId, price) => ({ variantId, productId: `P-${variantId}`, title: variantId, price, refPrice: '100.00', refCompareAt: null });
const values = (extra = {}) => ({ id: 'p1', name: 'Early BF 全场', kind: 'window', layer: 'sitewide',
  slots: [{ id: 's1', start: 10 * H, end: 20 * H, items: [item('v1', '85.00')] }], ...extra });

test('计划:保存 → 改价格 → 暂停 → 删除,每一步一版,看得出改了什么', () => {
  const h = {};
  let doc = { plans: [], vault: {}, log: [], settings: {} };
  const step = (action, now) => { const r = applyAction(doc, action, boss, now); recordPlanChanges(h, doc.plans, r.doc.plans, [action.id, r.id], { action: action.type, by: boss.name }, now); doc = r.doc; };
  step({ type: 'save', mode: 'draft', isNew: true, id: 'p1', values: values() }, 1);
  step({ type: 'save', mode: 'draft', id: 'p1', values: values({ name: 'Early BF 全场 v2', slots: [{ id: 's1', start: 10 * H, end: 20 * H, items: [item('v1', '80.00')] }] }) }, 2);
  step({ type: 'delete', id: 'p1' }, 3);
  const vs = h.p1.versions;
  assert.equal(vs.length, 3);
  assert.deepEqual(changedKeys(vs[0].values, vs[1].values).sort(), ['name', 'slots']);
  assert.equal(vs[1].values.slots[0].items[0].price, '80.00');
  assert.equal(vs[2].deleted, true);
});
