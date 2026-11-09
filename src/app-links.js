// app 里各处的网址(和 public/nav.js 一致,2026-11-09):飞书通知的按钮直接打开对应的那一页 / 那一条,不用进来再点
//   appUrl = Shopify 后台里这个 app 的地址(admin.shopify.com/store/<店>/apps/<app>),后面接 app 里的网址
export const PAGE_OF_KIND = { banner: 'banners', topbar: 'topbar', tbstyle: 'topbar', pmodule: 'pmodules', pin: 'pins', salelink: 'salelinks', callout: 'callouts', campaign: 'campaigns' };
export const appLink = (appUrl, path = '/') => (appUrl ? `${String(appUrl).replace(/\/$/, '')}${!path || path === '/' ? '' : path}` : appUrl || '');
// 一条内容:打开它的编辑;活动:打开活动页
export const itemPath = (it) => (!it ? '/' : it.kind === 'campaign' ? `/campaigns/${encodeURIComponent(it.id)}` : PAGE_OF_KIND[it.kind] ? `/${PAGE_OF_KIND[it.kind]}/${encodeURIComponent(it.id)}` : '/');
export const planPath = (id) => (id && id !== '-' ? `/price/${encodeURIComponent(id)}` : '/price');
// 一组东西:只有一个就打开它,多个就打开列表页
export const oneOr = (paths, many) => { const u = [...new Set(paths.filter(Boolean))]; return u.length === 1 ? u[0] : many; };
