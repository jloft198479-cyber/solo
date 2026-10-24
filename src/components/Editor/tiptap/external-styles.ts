/**
 * 出站内联样式 —— 让内容离开 solo 之后仍然「看得出层级」。
 *
 * ## 为什么必须内联
 * 微信公众号后台是台样式粉碎机：`<style>`、`class`、`id` 一律剥掉，只留白名单内的**行内**
 * `style`（font / color / margin / padding / line-height / text-align / border /
 * background-color 一类）。业界唯一解法就是 CSS 内联化——doocs/md（13k star，做了 7 年）
 * 用打补丁的 juice 把每条规则展开到元素上，mdnice 同理。
 *
 * solo 此前只内联了等宽字体与表格对齐，其余全靠 `editor.css` 的类选择器 ⇒ 粘到公众号后
 * 标题没有字号梯度、段落没有间距、行内代码没有底色，整篇塌成一坨同样大小的字。这就是
 * 「复制过去看起来很乱」的根因：**不是内容丢了，是层级没了**。
 *
 * ## 为什么不引 juice
 * juice 需要一份**独立于编辑器的 CSS 副本**来匹配选择器，那份副本必然与 `editor.css` 漂移
 * （本项目反复踩过的「真理源两处」）。而 solo 的出站 DOM 是已知的 20 个扩展产出，按标签
 * 直配比解析 CSS 更短更可控，也不必新增依赖。
 *
 * ## 两把尺子（重要）
 * - **字号 / 行高 / 间距**：运行时读 `--mk-*`。主题与设置页就是往 `documentElement` 写这些
 *   变量（`themes/manager.ts::TYPOGRAPHY_VAR_MAP`）⇒ 与屏幕同源。用户把正文字号调到 18px，
 *   粘出去也是 18px；抄一份默认值写死，改主题那天就漂了。
 * - **颜色**：唯一写死的部分，集中在 `EXTERNAL_TINT`。外部平台没有主题概念——跟主题走会把
 *   深色主题的黑底带进白底文章，比不设颜色更糟；留空又等于交给平台默认。所以钉成中性灰。
 */
import { resolveMonoFontStack } from '../../../utils/fontStack';

/**
 * 出站中性色板（外部平台无主题，理由见文件头）。
 * 改这里等于改「所有对外复制品」的观感，别在别处硬编码颜色。
 */
const EXTERNAL_TINT = {
  inlineCodeBg: '#f0f0f0',
  blockBg: '#f6f6f6',
  blockBorder: '#e5e5e5',
  quoteBorder: '#d8d8d8',
  quoteBg: '#fafafa',
  quoteText: '#5a5a5a',
  tableBorder: '#dcdcdc',
  tableHeadBg: '#f3f3f3',
  rule: '#e0e0e0',
  /** 微信自己的正文链接色，跟随平台比自选更不容易出错 */
  link: '#576b95',
} as const;

/**
 * 读不到 CSS 变量时的兜底。
 *
 * 这些值必须与 `editor.css` 的 `:root` 默认一致——只有在「变量根本没定义」（未注入主题、
 * 纯单测环境）时才会用到。日常运行时一律走变量，不会走到这里。
 */
const FALLBACK = {
  fontSize: '16px',
  lineHeight: '1.6',
  paragraphSpacing: '1em',
  quoteBorderWidth: '2px',
  headingSize: ['1.6em', '1.3em', '1.2em', '1.05em', '1em', '0.9em'],
  headingLineHeight: ['1.35', '1.4', '1.45', '1.5', '1.5', '1.5'],
  headingMargin: [
    '1.25em 0 0.6em',
    '1em 0 0.5em',
    '0.75em 0 0.4em',
    '0.6em 0 0.3em',
    '0.5em 0 0.3em',
    '0.5em 0 0.3em',
  ],
  headingLetterSpacing: ['-0.02em', '-0.01em', '', '', '', ''],
} as const;

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

/**
 * 标题字重，与 `editor.css` 的 `h1..h6` 规则逐级对齐（h1 = 700，其余 600）。
 *
 * 为什么只镜像、不读变量：字重没有做成主题变量，`editor.css` 里就是字面量。
 * 唯一能防漂移的办法是机器门禁——`external-styles.spec.ts` 会读 `editor.css` 逐级比对，
 * 改了那边不改这里就红。
 */
export const HEADING_WEIGHT = ['700', '600', '600', '600', '600', '600'] as const;

/** 从 `documentElement` 读主题变量；读不到（或空串）就退回默认 */
function readVar(name: string, fallback: string): string {
  try {
    const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

/**
 * 字号 token → 数值。`16px` / `1rem` / `1.6em` / `120%` / `clamp(1.5em, 2vw, 2.2em)`。
 *
 * ⚠️ 读的是 CSS **自定义属性**（`readVar`），getComputedStyle 对变量返回原始 token、
 * 不做折算，而主题把 heading 尺寸**原样**写进变量（`manager.ts::injectTypography`
 * 无格式校验）——clamp()/百分比/视口单位都是合法字号、编辑器里正常渲染，会原样
 * 到达这里。parseFloat 只会咬住第一个数字：`clamp(1.5em,…)` 当 px 会产出 **1.5px
 * 的肉眼隐形标题**、`120%` 产出 120px 巨型字（审计 P2-4）。折算规则：
 *  - em / rem：相对 base 换算（rem 无根字号上下文，按 base 近似）
 *  - %：按字号语义 × base / 100
 *  - px / 无单位数字：原值
 *  - clamp()/min()/max()/calc()：提取其中的 em/px 参数取**上界**（视口项静态折算
 *    不了；取上界保证不小于用户的可读意图）
 *  - 其余单位（vw/vh 等）：回落 base——宁可平庸字号，不出隐形/巨型字
 * 解析不出同样回落 base。
 */
function toPx(value: string, base: number): number {
  const v = value.trim().toLowerCase();
  // 函数形态必须先于 parseFloat 判：'clamp(…' 开头 parseFloat 是 NaN，
  // 放后面会被「解析不出」早退吞掉、永远走不到提取分支（实测踩过）
  if (/^(?:clamp|min|max|calc)\(/.test(v)) {
    const candidates: number[] = [];
    for (const m of v.matchAll(/(\d*\.?\d+)(em|px)\b/g)) {
      candidates.push(m[2] === 'em' ? Number(m[1]) * base : Number(m[1]));
    }
    if (candidates.length > 0) return Math.max(...candidates);
    return base;
  }
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return base;
  if (v.endsWith('em')) return n * base;
  if (v.endsWith('%')) return (n / 100) * base;
  if (v.endsWith('px') || /^-?[\d.]+$/.test(v)) return n;
  return base;
}

/** 26.400000000000002 → 26.4；整数不带小数点 */
const px = (n: number): string => `${Number(n.toFixed(1))}px`;

type Decls = Record<string, string>;

export function inlineReadingStyles(root: HTMLElement): void {
  const base = toPx(readVar('--mk-font-size', FALLBACK.fontSize), 16);
  const lineHeight = readVar('--mk-line-height', FALLBACK.lineHeight);
  const para = readVar('--mk-paragraph-spacing', FALLBACK.paragraphSpacing);
  const quoteBorder = readVar('--mk-quote-border-width', FALLBACK.quoteBorderWidth);
  const mono = resolveMonoFontStack();

  const q = <T extends Element = HTMLElement>(selector: string): T[] =>
    Array.from(root.querySelectorAll<T>(selector));

  /** 只写给定声明，元素原有声明（例如表格的 `text-align`）原样保留 */
  const apply = (selector: string, decls: Decls): void => {
    for (const el of q(selector)) {
      const style = (el as HTMLElement).style;
      for (const [name, value] of Object.entries(decls)) {
        if (value) style.setProperty(name, value);
      }
    }
  };

  const bodyDecls: Decls = {
    'font-size': px(base),
    'line-height': lineHeight,
  };

  // ── 正文块 ──────────────────────────────────────────────
  // 公众号粘贴进来的是**片段**，没有外层容器，所以每个块都得自带字号——
  // 指望继承等于指望平台，而平台的默认值随时会变。
  apply('p', { ...bodyDecls, margin: `${para} 0` });
  apply('ul, ol', { ...bodyDecls, margin: `${para} 0`, 'padding-left': '1.8em' });
  apply('li', bodyDecls);
  // 列表项、引用、提示框里的段落不再叠加段间距（外层已有留白）
  apply('li > p', { margin: '0' });
  apply('blockquote p, div.mk-callout p', { margin: '0.35em 0' });
  apply('blockquote > p:first-child, div.mk-callout > p:first-child', { 'margin-top': '0' });
  apply('blockquote > p:last-child, div.mk-callout > p:last-child', { 'margin-bottom': '0' });

  // ── 标题：层级全靠字号梯度，微信会把 h1~h6 重置成同一号字 ──────
  for (const n of HEADING_LEVELS) {
    const i = n - 1;
    const size = toPx(readVar(`--mk-heading${n}-size`, FALLBACK.headingSize[i] ?? '1em'), base);
    apply(`h${n}`, {
      'font-size': px(size),
      'line-height': readVar(`--mk-heading${n}-line-height`, FALLBACK.headingLineHeight[i] ?? '1.5'),
      // margin 用 em 原样落地：em 相对元素自身字号，与编辑器里同一条规则等价
      margin: readVar(`--mk-heading${n}-margin`, FALLBACK.headingMargin[i] ?? '0.5em 0 0.3em'),
      'font-weight': HEADING_WEIGHT[i] ?? '600',
      'letter-spacing': readVar(`--mk-heading${n}-letter-spacing`, FALLBACK.headingLetterSpacing[i] ?? ''),
    });
  }

  // ── 引用 ───────────────────────────────────────────────
  apply('blockquote', {
    ...bodyDecls,
    margin: `${para} 0`,
    padding: '0.6em 1em',
    'border-left': `${quoteBorder} solid ${EXTERNAL_TINT.quoteBorder}`,
    'background-color': EXTERNAL_TINT.quoteBg,
    color: EXTERNAL_TINT.quoteText,
  });

  // ── 代码：等宽 + 保换行 + 浅底，缺一样就看不出「这是代码」 ──────
  for (const el of q('div[data-type="mermaid-block"]')) el.classList.add('language-mermaid');
  apply('pre, div[data-type="mermaid-block"], div[data-type="math-block"]', {
    'white-space': 'pre-wrap',
    'font-family': mono,
    'background-color': EXTERNAL_TINT.blockBg,
    border: `1px solid ${EXTERNAL_TINT.blockBorder}`,
    'border-radius': '6px',
    padding: '0.8em 1em',
    margin: `${para} 0`,
    'font-size': px(base * 0.9),
    'line-height': '1.55',
    'overflow-x': 'auto',
    'word-break': 'break-word',
  });
  for (const el of q('code')) {
    if (el.closest('pre')) continue; // 继承 pre，不重复设
    const style = (el as HTMLElement).style;
    style.setProperty('font-family', mono);
    style.setProperty('background-color', EXTERNAL_TINT.inlineCodeBg);
    style.setProperty('padding', '0.15em 0.35em');
    style.setProperty('border-radius', '3px');
    style.setProperty('font-size', px(base * 0.92));
  }

  // ── 表格 ───────────────────────────────────────────────
  apply('table', {
    'border-collapse': 'collapse',
    margin: `${para} 0`,
    'font-size': px(base * 0.95),
    'line-height': '1.5',
  });
  apply('th, td', {
    border: `1px solid ${EXTERNAL_TINT.tableBorder}`,
    padding: '6px 10px',
    'vertical-align': 'top',
  });
  apply('th', { 'background-color': EXTERNAL_TINT.tableHeadBg, 'font-weight': '600' });

  // ── 分割线 ─────────────────────────────────────────────
  apply('hr', {
    border: '0',
    'border-top': `1px solid ${EXTERNAL_TINT.rule}`,
    margin: '2em 0',
    height: '0',
  });

  // ── 链接 ───────────────────────────────────────────────
  // 公众号只放行自家域名，外链会降级成纯文字；设色无害，站内链接还能保住可读性
  apply('a', { color: EXTERNAL_TINT.link, 'text-decoration': 'underline' });

  // ── 图片 ───────────────────────────────────────────────
  // 只限宽，不动 height：height 可能来自用户拖拽，覆盖它等于改内容
  apply('img', { 'max-width': '100%' });

  // ── 提示框（callout）────────────────────────────────────
  apply('div.mk-callout', {
    ...bodyDecls,
    margin: `${para} 0`,
    padding: '0.75em 1em',
    'border-left': `3px solid ${EXTERNAL_TINT.quoteBorder}`,
    'background-color': EXTERNAL_TINT.blockBg,
    'border-radius': '4px',
  });
}
