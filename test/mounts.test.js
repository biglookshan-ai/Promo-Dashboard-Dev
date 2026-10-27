// 联合推广的卡口过滤(src/mounts.js):例子都是店里兼容产品 Collection 里的真产品(2026-10-27 线上 460 个:342 留、38 不放、80 没写卡口)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountVerdict, mountsIn, mountFilterOf, DEFAULT_BAD_MOUNTS } from '../src/mounts.js';
import { calloutScope, calloutIds } from '../src/counts.js';
import { validate } from '../src/schedule-actions.js';

const P = (title, ...opts) => ({ title, options: opts.map((o) => (Array.isArray(o) ? { name: 'Choose', values: o } : o)) });

test('有兼容 / 能转接的卡口 → 留着', () => {
  for (const p of [
    P('DZOFILM 100mm T2.1 VESPID Prime Full Frame Cinema Lens PL&EF interchangeable Mount', ['Default Title']),
    P('Thypoch Simera-C 21mm T1.5 FF Prime Cine Lens (Leica M Mount)', ['Default Title']),
    P('Thypoch Simera-C 16mm T1.9 FF Prime Cine Lens (M Mount)', ['Default Title']),
    P('NiSi ATHENA 14mm T2.4 with Drop-In Filter PRIME Full Frame Cinema Lens RF/E/L Mount', ['CANON RF Mount', 'SONY E Mount', 'LEICA L Mount']),
    P('Mitakon Speedmaster 35mm T1.0 S35 Cine Lens', ['Sony E', 'Nikon Z', 'Fuji X', 'Canon RF']), // 选项只写「Sony E」也认
    P('Blazar Beetle 32mm T3.2 1.33X Full Frame Anamorphic Lens', ['E', 'RF', 'L', 'Z']),
    P('BLAZAR MANTIS 25mm T2.4 1.33X Full Frame Anamorphic Lens', ['PL', 'PL+E']),
    P('SIRUI 40mm T1.8 1.33x S35 AF Anamorphic Lens', ['Blue', 'Neutral'], ['E', 'X', 'Z', 'MFT']),
    P('DZOFILM Gnosis 24mm T2.8 Macro Prime Lens LPL+PL+EF Mount', ['Imperial', 'Metric']),
    P('Sirui Lens', { name: 'Choose Mount', values: ['FE'] }),
  ]) assert.equal(mountVerdict(p), 'ok', p.title);
});

test('只有不兼容卡口 → 不放(选项全是不兼容的 / 选项没写、标题只写了不兼容的)', () => {
  for (const p of [
    P('BLAZAR (Great Joy) 35mm T2.9 1.8x Anamorphic Lens EF/PL/E/L/RF/MFT Mount', ['RF']), // 标题写了一堆,真卖的只有 RF
    P('BLAZAR (Great Joy) 50mm T2.9 1.8x Anamorphic Lens EF/PL/E/L/RF/MFT Mount', ['MFT', 'RF'], ['Blue', 'Amber']),
    P('7Artisans 50mm T1.05 APS-C MF Cine Lens RF/L/M43 Mount', ['RF mount', 'L mount', 'M43 mount']),
    P('Mitakon 17mm T1.0 Speedmaster Cinema Lens MFT Mount', ['17mm', 'M43 SET 17mm+25mm+35mm']),
    P('MEIKE Manual Focus Cinema Prime Lens Fuji X Mount', ['25mm T2.2 (532245)', '35mm T2.2 (533496)']),
    P('Laowa 9mm f/2.8 Zero-D Lens for Micro 4/3 Mount', ['Default Title']),
    P('Mitakon ZY-Optics 42.5mm f/1.2 Lens in Micro Four Thirds (MFT) mount', ['Default Title']),
    P('Laowa 7.5mm f/2 MFT Lens for Micro 4/3 (Black)', ['Stand Version', 'Lightweight Version']),
    P('MEIKE 10mm T2.2 Mini Prime Series Cine Lens RF Mount', ['Default Title']),
  ]) assert.equal(mountVerdict(p), 'out', p.title);
});

test('没写卡口 → unknown(照算);「1.33x」「2X」「X-Tract」不会当成富士 X', () => {
  for (const p of [
    P('Laowa Proteus 2X 35mm T2 S35 Anamorphic Lens', ['Imperial / Amber']),
    P('Viltrox EPIC 28mm T2 1.33x Full-Frame Anamorphic Lens', ['Default Title']),
    P('Viltrox EPIC 135mm T2.4 1.33 X Anamorphic Lens', ['EPIC (Blue Flare)']),
    P('CHIOPT SLASHER 50mm T2.0 Macro Prime Lens', ['Default Title']),
  ]) assert.equal(mountVerdict(p), 'unknown', p.title);
  assert.equal(mountVerdict(P('DZOFILM X-Tract 18-28mm T8 FF Probe Zoom Lens (ARRI PL Mount)', ['3-Lens Kit'])), 'ok');
  assert.deepEqual(mountsIn('EF-M Mount'), { good: false, bad: true }); // EF-M 不当成 EF
  assert.deepEqual(mountsIn('PL+EF'), { good: true, bad: false }); // L 不会认成 PL
});

test('自己改名单:去掉 L 以后 L 卡口的产品算没写卡口;加 G 以后只有 G 的不放', () => {
  const l = P('7Artisans 25mm T1.05 APS-C MF Cine Lens L/M43 Mount', ['L mount', 'M43 mount']);
  assert.equal(mountVerdict(l), 'out');
  assert.equal(mountVerdict(l, ['MFT']), 'out'); // M43 还在名单里(MFT 也认 M43)
  assert.equal(mountVerdict(P('X', ['L mount']), ['MFT']), 'unknown');
  assert.equal(mountVerdict(P('Lens', ['FUJIFILM G Mount'])), 'unknown');
  assert.equal(mountVerdict(P('Lens', ['FUJIFILM G Mount']), [...DEFAULT_BAD_MOUNTS, 'G']), 'out');
});

test('开关:联合推广默认开;关掉 / 不是联合推广 = 不过滤;名单空 = 默认', () => {
  assert.deepEqual(mountFilterOf({ joint: true }), DEFAULT_BAD_MOUNTS);
  assert.deepEqual(mountFilterOf({ joint: true, badMounts: [' RF ', '', 'MFT'] }), ['RF', 'MFT']);
  assert.equal(mountFilterOf({ joint: true, mountFilter: false }), null);
  assert.equal(mountFilterOf({ joint: false }), null);
  const j = { kind: 'callout', name: 'x', title: 't', joint: true, lensCollection: { id: 1 }, promoCollection: { id: 2 }, promos: [{ id: 9 }], promoTitle: 'p', rules: [{ f: 'vendor', v: ['A'] }] };
  assert.equal(validate({ ...j, badMounts: ['RF', 'MFT'] }), '');
  assert.match(validate({ ...j, badMounts: 'RF' }), /不兼容卡口/);
});

test('算命中 / 同步:只有不兼容卡口的不算、列出来;一定显示的不管卡口;没开就照旧', async () => {
  const prods = [
    { id: 1, title: 'A Vespid PL&EF Mount', options: [] },
    { id: 2, title: 'B MFT Cine Lens', options: [] },
    { id: 3, title: 'C Lens', options: [{ name: 'Choose Mount', optionValues: [{ name: 'RF' }, { name: 'L' }] }] },
    { id: 4, title: 'D Sword Macro', options: [] },
    { id: 5, title: 'E Lens', options: [{ name: 'Choose', optionValues: [{ name: 'Sony E' }, { name: 'Fuji X' }] }] },
  ];
  const seen = [];
  const gql = async (ctx, q, v) => {
    if (q.includes('after: $after') && q.includes('query: $q')) {
      seen.push(q);
      return { products: { nodes: prods.map((p) => ({ id: `gid://shopify/Product/${p.id}`, title: p.title, handle: `p${p.id}`, status: 'ACTIVE', options: q.includes('optionValues') ? p.options : undefined })), pageInfo: { hasNextPage: false, endCursor: null } } };
    }
    if (q.includes('nodes(ids')) return { nodes: v.ids.map((id) => ({ id, title: id, handle: 'h', status: 'ACTIVE' })) };
    if (q.includes('productsCount')) return { total: { count: prods.length }, products: { nodes: [] } };
    throw new Error('unexpected ' + q);
  };
  const rules = [{ f: 'vendor', v: ['X'] }];
  const sc = await calloutScope({}, { rules, joint: true, products: [{ id: 'gid://shopify/Product/2' }] }, gql);
  assert.equal(sc.total, 4); // 1 4 5 + 2(一定显示)
  assert.deepEqual(sc.mount.out.map((p) => p.title), ['C Lens']); // 2 一定显示,不列
  assert.equal(sc.mount.unknownN, 1);
  assert.ok(seen.every((q) => q.includes('optionValues') && q.includes('first: 50')));
  const ids = await calloutIds({}, { rules, joint: true }, gql);
  assert.deepEqual(ids.ids.map(Number).sort(), [1, 4, 5]);
  assert.equal(ids.mountOut, 2);
  const off = await calloutIds({}, { rules, joint: true, mountFilter: false }, gql);
  assert.equal(off.ids.length, 5); assert.equal(off.mountOut, undefined);
  const plain = await calloutIds({}, { rules }, gql); // 普通推广块不过滤
  assert.equal(plain.ids.length, 5);
});
