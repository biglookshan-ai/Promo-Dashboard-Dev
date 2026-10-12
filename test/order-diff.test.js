// 合集顺序对比 / 最短前缀
import test from 'node:test';
import assert from 'node:assert/strict';
import { expandOrder, minimalPrefix, diffOrder, diffSummary } from '../src/order-diff.js';

const N = (n) => Array.from({ length: n }, (_, i) => String(i + 1));
const move = (arr, from, to) => { const a = [...arr]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; };

test('第 50 个拖到第 20 位:只要存前 20 个', () => {
  const B = N(100); const D = move(B, 49, 19);
  const P = minimalPrefix(B, D);
  assert.equal(P.length, 20);
  assert.equal(P[19], '50');
  assert.deepEqual(expandOrder(B, P), D);
});

test('第 200 个拖到第 1:只要存 1 个', () => {
  const B = N(300); const D = move(B, 199, 0);
  assert.deepEqual(minimalPrefix(B, D), ['200']);
});

test('没动过:前缀是空的', () => {
  assert.deepEqual(minimalPrefix(N(10), N(10)), []);
});

test('拿掉的产品不占位置,也不进前缀', () => {
  const B = N(6); const D = ['1', '2', '4', '5', '6']; // 拿掉 3
  assert.deepEqual(minimalPrefix(B, D), []);
  assert.deepEqual(expandOrder(B, [], { hidden: ['3'] }), D);
});

test('新加的(原来不在合集里)一定在前缀里', () => {
  const B = N(5); const D = ['1', '2', '99', '3', '4', '5'];
  const P = minimalPrefix(B, D);
  assert.deepEqual(P, ['1', '2', '99']);
  assert.deepEqual(expandOrder(B, P), D);
});

test('随便打乱几次,前缀展开回去都一模一样', () => {
  let seed = 7; const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  for (let t = 0; t < 200; t++) {
    const B = N(30); let D = [...B];
    for (let k = 0; k < 4; k++) D = move(D, rnd(D.length), rnd(D.length));
    const hidden = rnd(3) ? [] : [D.splice(rnd(D.length), 1)[0]];
    if (!rnd(4)) D.splice(rnd(D.length), 0, `x${t}`);
    const P = minimalPrefix(B, D);
    assert.deepEqual(expandOrder(B, P, { hidden }), D);
  }
});

test('对比:被挤下去的不算换位置,只有真的拖过的算', () => {
  const B = N(100); const D = move(B, 49, 19);
  const d = diffOrder(B, D);
  assert.deepEqual([...d.moved], ['50']);
  assert.equal(d.added.size, 0);
  assert.deepEqual(d.removed, []);
});

test('对比:新加、拿掉、换位置一起', () => {
  const B = ['1', '2', '3', '4', '5'];
  const D = ['9', '4', '1', '2', '5']; // 新加 9,4 拖到前面,3 拿掉
  const d = diffOrder(B, D);
  assert.deepEqual([...d.added], ['9']);
  assert.deepEqual([...d.moved], ['4']);
  assert.deepEqual(d.removed, ['3']);
  assert.equal(diffSummary(d), '新加 1 · 换位置 1 · 拿掉 1');
});

test('只显示前面的:展开只要前缀', () => {
  assert.deepEqual(expandOrder(N(10), ['7', '3'], { onlyListed: true }), ['7', '3']);
});
