import test from 'node:test';
import assert from 'node:assert/strict';
import { itemStatus, desiredPublishStatus, effectiveWindow, isEndingSoon, campaignIndex } from '../src/schedule-core.js';

const H = 3600_000, D = 24 * H, T = Date.UTC(2026, 9, 1, 12);
const camp = (o = {}) => ({ id: 'c1', kind: 'campaign', state: 'approved', start: T - D, end: T + D, ...o });
const item = (o = {}) => ({ id: 'b1', kind: 'banner', state: 'approved', start: null, end: null, ...o });

test('长期显示的已批准内容 = 上线中', () => {
  assert.equal(itemStatus(item(), new Map(), T), 'live');
  assert.equal(desiredPublishStatus(item(), new Map(), T), 'ACTIVE');
});

test('没批准的一律不上线(草稿 / 待审核 / 退回)', () => {
  for (const state of ['draft', 'pending', 'rejected']) {
    assert.equal(desiredPublishStatus(item({ state }), new Map(), T), 'DRAFT', state);
  }
});

test('开始前 = 已排期,到点 = 上线,结束那一刻 = 下线', () => {
  const it = item({ start: T, end: T + H });
  assert.equal(itemStatus(it, new Map(), T - 1), 'scheduled');
  assert.equal(itemStatus(it, new Map(), T), 'live');
  assert.equal(itemStatus(it, new Map(), T + H - 1), 'live');
  assert.equal(itemStatus(it, new Map(), T + H), 'ended');
});

test('暂停 = 立即下线', () => {
  assert.equal(desiredPublishStatus(item({ paused: true }), new Map(), T), 'DRAFT');
});

test('没设时间且挂了活动 → 跟随活动的时间', () => {
  const c = camp({ start: T + H, end: T + 2 * H });
  const idx = campaignIndex([c]);
  const it = item({ campaign: 'c1' });
  assert.deepEqual(effectiveWindow(it, idx).start, T + H);
  assert.equal(itemStatus(it, idx, T), 'scheduled');
  assert.equal(itemStatus(it, idx, T + H), 'live');
  assert.equal(itemStatus(it, idx, T + 2 * H), 'ended');
});

test('自己设了时间就不跟活动(活动只是分组)', () => {
  const idx = campaignIndex([camp()]);
  const it = item({ campaign: 'c1', start: T + 5 * D, end: null });
  assert.equal(itemStatus(it, idx, T), 'scheduled');
});

test('所属活动还没批准 / 被暂停 → 跟随它的内容也不上线', () => {
  assert.equal(itemStatus(item({ campaign: 'c1' }), campaignIndex([camp({ state: 'draft' })]), T), 'waiting');
  assert.equal(itemStatus(item({ campaign: 'c1' }), campaignIndex([camp({ paused: true })]), T), 'paused');
  assert.equal(desiredPublishStatus(item({ campaign: 'c1' }), campaignIndex([camp({ state: 'pending' })]), T), 'DRAFT');
});

test('顶栏默认样式永远 ACTIVE', () => {
  assert.equal(desiredPublishStatus({ kind: 'tbstyle', isDefault: true, state: 'approved' }, new Map(), T), 'ACTIVE');
});

test('下架前 3 天提醒', () => {
  assert.equal(isEndingSoon(item({ end: T + 2 * D }), new Map(), T), true);
  assert.equal(isEndingSoon(item({ end: T + 4 * D }), new Map(), T), false);
  assert.equal(isEndingSoon(item({ end: null }), new Map(), T), false);
});
