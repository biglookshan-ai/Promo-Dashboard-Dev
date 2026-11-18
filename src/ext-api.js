// Shopify 后台扩展用的接口(2026-11-18):Collection 页面上的「CGP 排序」卡片(extensions/collection-sort-status)。
// · 卡片在 Shopify 自己的页面里跑(extensions.shopifycdn.com),请求自带 Shopify 的身份凭证(Authorization: Bearer,和 app 页面同一种,
//   证明是本店后台里的人)—— 卡片里没有飞书登录,所以这里**只读、不看飞书成员权限**,也不记操作记录。
// · 跨域:要放行(带 Authorization 头会先发 OPTIONS 预检)。
// · 卡片显示什么由 src/col-status.js 决定(文字在服务器拼好),改说法不用重新部署扩展。
import express from 'express';
import { verifySessionToken, getAccessToken } from './auth-embedded.js';
import { load } from './schedule-store.js';
import { graphql } from './shopify.js';
import { readColSort } from './col-sort-shop.js';
import { colCard } from './col-status.js';

export function extRouter({ gql = graphql, loadState = load } = {}) {
  const r = express.Router();
  r.use((req, res, next) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '600',
      'Cache-Control': 'no-store',
    });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  // 一个 Collection 现在的排序状态 → 卡片内容
  r.get('/collection-status', async (req, res) => {
    let ctx;
    try {
      const h = req.headers.authorization || '';
      const st = h.startsWith('Bearer ') ? h.slice(7) : '';
      if (!st) return res.status(401).json({ error: '缺少 Shopify 身份凭证' });
      const { shop } = verifySessionToken(st);
      ctx = { shop, token: process.env.SHOPIFY_ADMIN_TOKEN || await getAccessToken(shop, st) };
    } catch (e) {
      return res.status(401).json({ error: String(e.message || e) });
    }
    try {
      const id = String(req.query.id || '').split('/').pop();
      if (!/^\d+$/.test(id)) return res.status(400).json({ error: '缺少 Collection' });
      const col = await readColSort(ctx, id, gql);
      if (!col) return res.status(404).json({ error: '找不到这个 Collection' });
      res.json(colCard(loadState(ctx.shop), col, Date.now()));
    } catch (e) {
      console.error('[ext] collection-status', e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });
  return r;
}
