// 联合推广的「卡口过滤」(2026-10-27 用户):兼容产品按牌子条件拉进来时,会把只做 MFT / RF / L … 的镜头也带进来,
// 这些装不上 Sony E 的 Smart Fusion。同步兼容产品 Collection 时逐个看产品的选项和标题,只有不兼容卡口的产品不放进去 ——
// 产品页卡片、弹窗、活动页跟着不显示;KitBundle 的加购优惠按这个 Collection 触发,也就不打折了。
// 有兼容款式的多卡口产品照样放进去(不兼容的款式由 KitBundle 的「Exclude → Variants with these option values」只让兼容款式打折)。
//
// 判断(产品级):
//   ① 任何一个选项值写了兼容 / 能转接的卡口(E、FE、PL、LPL、EF、Leica M、PV)→ 留着
//   ② 有一个选项的所有值都是不兼容卡口(比如卡口选项只有 RF / L / M43)→ 不放(每个款式都装不上)
//   ③ 否则看标题:写了兼容卡口 → 留着;标题或选项写了不兼容卡口 → 不放;都没写 → 留着(列出来给人看)
// 匹配:不分大小写、去掉 Mount、按整词比(「L」认 L-Mount / Leica L,不会认成 PL;「EF-M」不会当成 EF);
//   MFT 也认 M43 / M4/3 / Micro 4/3 / Micro Four Thirds;单个字母(E / L / X / Z / M)只在上下文明显是卡口时才算
//   (写了 Mount、前面是相机牌子(Sony E / Nikon Z / Fuji X)、旁边有别的卡口名、整个选项值就是这一个字母(只看选项,不看标题)、
//   或者选项名就叫 Mount),免得「1.33 x」被当成富士 X。

export const DEFAULT_BAD_MOUNTS = ['RF', 'L', 'X', 'Z', 'MFT', 'EF-M', 'DL'];
export const GOOD_MOUNTS = ['E', 'FE', 'PL', 'LPL', 'EF', 'M', 'PV'];
const BRANDS = new Set(['SONY', 'CANON', 'NIKON', 'FUJI', 'FUJIFILM', 'LEICA', 'PANASONIC', 'LUMIX', 'OLYMPUS', 'ARRI', 'HASSELBLAD', 'SIGMA', 'DJI', 'BMPCC', 'BLACKMAGIC']);

const SEP = /[\s/,&+()|[\]]+/;
export function mountTokens(text) {
  const s = String(text ?? '').toUpperCase()
    .replace(/MICRO\s*FOUR\s*THIRDS|MICRO\s*4\s*\/\s*3|\bM\s*4\s*\/\s*3\b|\bM43\b/g, ' MFT ')
    .replace(/[-\s]*MOUNTS?\b/g, ' MOUNT ');
  return s.split(SEP).filter(Boolean);
}
const norm = (k) => mountTokens(k).filter((t) => t !== 'MOUNT').join(' ');

// 一段文字(一个选项值 / 标题)里提到的卡口:{ good: bool, bad: bool };mountCtx = 确定是在说卡口(选项名叫 Mount / 选项值只有一个词)
export function mountsIn(text, bad = DEFAULT_BAD_MOUNTS, mountCtx = false) {
  const toks = mountTokens(text);
  const badSet = new Set(bad.map(norm).filter(Boolean));
  const goodSet = new Set(GOOD_MOUNTS.filter((g) => !badSet.has(g)));
  const words = toks.filter((t) => t !== 'MOUNT');
  const multi = (t) => t.length > 1 && (badSet.has(t) || goodSet.has(t));
  const ctx = mountCtx || toks.includes('MOUNT') || words.some(multi) || words.some((t) => BRANDS.has(t));
  const hit = (set) => words.some((t) => set.has(t) && (t.length > 1 || ctx));
  return { good: hit(goodSet), bad: hit(badSet) };
}

// p = { title, options: [{ name, values: [...] }] } → 'ok' | 'out' | 'unknown'
export function mountVerdict(p, bad = DEFAULT_BAD_MOUNTS) {
  const opts = (p?.options || []).map((o) => {
    const mc = /mount|卡口|接口/i.test(String(o?.name || ''));
    return (o?.values || []).filter((v) => v && v !== 'Default Title').map((v) => mountsIn(v, bad, mc || mountTokens(v).filter((t) => t !== 'MOUNT').length === 1));
  });
  const vals = opts.flat();
  if (vals.some((m) => m.good)) return 'ok';
  if (opts.some((ms) => ms.length && ms.every((m) => m.bad))) return 'out';
  const t = mountsIn(p?.title, bad);
  if (t.good) return 'ok';
  if (t.bad || vals.some((m) => m.bad)) return 'out';
  return 'unknown';
}

// 推广块上的设置:联合推广默认开着(mountFilter 没存 = 开),名单没存 = 默认名单
export const mountFilterOf = (it) => (it?.joint && it.mountFilter !== false
  ? (Array.isArray(it.badMounts) && it.badMounts.length ? it.badMounts.map((s) => String(s).trim()).filter(Boolean) : DEFAULT_BAD_MOUNTS)
  : null);
