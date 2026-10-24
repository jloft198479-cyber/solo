// @vitest-environment happy-dom
/**
 * 出站内联样式的回归锁 —— 锁的是「粘到公众号之后，读者还能不能看出层级」。
 *
 * 为什么是这一层：公众号只保留行内 `style`，`class` / `<style>` / `id` 全部剥掉。
 * 换句话说「屏幕上的层级」与「粘出去的层级」之间唯一的桥梁就是**内联声明**。
 * 所以本文件的两个判据都站在平台视角：
 *  ① 剥掉 class 与 `<style>` 之后，每个语义元素仍自带样式；
 *  ② 标题、正文、代码、引用、表格的字号/边框差异，在**只剩 style** 的 DOM 上仍成立。
 *
 * 另有两条硬约束：
 *  - 不许出现 `var(--…)`：微信丢弃 CSS 变量，写了等于没写。
 *  - 字号必须跟着 `--mk-font-size` 走：用户把正文调到 20px，粘出去也得是 20px。
 *    这条同时是「不许把默认值抄死在这里」的锁。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseMarkdown } from '../markdown/parser';
import { serializeDocumentHtml } from '../clipboard-html';
import { HEADING_WEIGHT } from '../external-styles';
import { createTestSchema } from '../markdown/__tests__/test-utils';

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

const MD = [
  '# 一级标题',
  '',
  '## 二级标题',
  '',
  '### 三级标题',
  '',
  '正文段落，含 `行内代码` 与 **加粗**。',
  '',
  '- 无序项',
  '- 另一项',
  '',
  '1. 有序项',
  '',
  '> 引用一句带 `码` 的话。',
  '',
  '```js',
  'const answer = 42;',
  '```',
  '',
  '| 甲 | 乙 |',
  '| :-- | --: |',
  '| 1 | 2 |',
  '',
  '---',
  '',
].join('\n');

const schema = createTestSchema();

function externalHtml(): HTMLElement {
  const doc = parseMarkdown(schema, MD);
  const html = serializeDocumentHtml(doc) ?? '';
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  return wrap;
}

/** 模拟公众号：`class` / `id` / `<style>` 全剥，只留行内 style */
function washForWechat(html: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  wrap.querySelectorAll('style, script, link').forEach((el) => el.remove());
  wrap.querySelectorAll('*').forEach((el) => {
    el.removeAttribute('class');
    el.removeAttribute('id');
  });
  return wrap;
}

const styleOf = (el: Element | null): string => (el as HTMLElement | null)?.getAttribute('style') ?? '';
const fontSizeOf = (el: Element | null): number => Number.parseFloat(/font-size:\s*([\d.]+)px/.exec(styleOf(el))?.[1] ?? 'NaN');

afterEach(() => {
  document.documentElement.style.removeProperty('--mk-font-size');
  document.documentElement.style.removeProperty('--mk-line-height');
});

describe('出站内联样式：公众号视角', () => {
  it('A 语义元素在剥掉 class 之后仍自带样式（一个都不能裸奔）', () => {
    const washed = washForWechat(externalHtml().innerHTML);
    const REQUIRED = [
      'p',
      'h1',
      'h2',
      'h3',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'table',
      'th',
      'td',
      'hr',
      'strong',
    ];
    for (const tag of REQUIRED) {
      const nodes = Array.from(washed.querySelectorAll(tag));
      // strong 靠平台默认的加粗，不需要内联；这里只断言「存在」
      if (tag === 'strong') {
        expect(nodes.length, '样本里应有 strong').toBeGreaterThan(0);
        continue;
      }
      expect(nodes.length, `样本里应有 ${tag}`).toBeGreaterThan(0);
      for (const node of nodes) {
        if (tag === 'code' && node.closest('pre')) continue; // 继承 pre
        expect(styleOf(node), `<${tag}> 裸奔了：粘到公众号会退回平台默认样式`).not.toBe('');
      }
    }
  });

  it('B 层级在只剩 style 的 DOM 上仍成立：标题 > 正文，且逐级递减', () => {
    const washed = washForWechat(externalHtml().innerHTML);
    const body = fontSizeOf(washed.querySelector('p'));
    const [h1, h2, h3] = ['h1', 'h2', 'h3'].map((t) => fontSizeOf(washed.querySelector(t)));

    expect(body).toBeGreaterThan(0);
    expect(h1).toBeGreaterThan(h2);
    expect(h2).toBeGreaterThan(h3);
    expect(h3).toBeGreaterThan(body);
    // 字重也是层级的一部分（微信会重置 h 标签的 font-weight），且必须与编辑器一致
    HEADING_LEVELS.forEach((n, i) => {
      const h = washed.querySelector(`h${n}`);
      if (!h) return; // 样本只有 h1~h3
      expect(styleOf(h), `h${n} 字重应与 editor.css 一致`).toContain(`font-weight: ${HEADING_WEIGHT[i]}`);
    });
  });

  it('F 字重与 editor.css 逐级一致（那边改了这边没改就红）', () => {
    // happy-dom 下 import.meta.url 不是 file: 协议，fileURLToPath 会抛 ⇒ 用 cwd 拼
    const css = readFileSync(join(process.cwd(), 'src/components/Editor/tiptap/editor.css'), 'utf8');
    HEADING_LEVELS.forEach((n, i) => {
      // 以「字号声明」为锚点往后读：标题还有一条共用规则（`h1, h2, … { position }`），
      // 按选择器取块会先撞上它（它没有 font-weight）
      const anchor = css.indexOf(`var(--mk-heading${n}-size)`);
      expect(anchor, `editor.css 里找不到 h${n} 的字号声明`).toBeGreaterThan(-1);
      const weight = /font-weight:\s*(\d+)/.exec(css.slice(anchor, anchor + 300))?.[1];
      expect(weight, `editor.css 里找不到 h${n} 的 font-weight`).toBeTruthy();
      expect(HEADING_WEIGHT[i], `h${n} 出站字重漂了`).toBe(weight);
    });
  });

  it('C 代码块 / 引用 / 表格 / 分割线各自带「能看出边界」的声明', () => {
    const washed = washForWechat(externalHtml().innerHTML);

    const pre = styleOf(washed.querySelector('pre'));
    expect(pre).toContain('white-space: pre-wrap'); // 否则换行被 HTML 规则折叠
    expect(pre).toContain('font-family');
    expect(pre).toContain('background-color');

    const inlineCode = Array.from(washed.querySelectorAll('code')).find((el) => !el.closest('pre'));
    expect(styleOf(inlineCode!)).toContain('background-color');
    expect(styleOf(inlineCode!)).toContain('font-family');

    expect(styleOf(washed.querySelector('blockquote'))).toContain('border-left');

    expect(styleOf(washed.querySelector('table'))).toContain('border-collapse: collapse');
    const cell = styleOf(washed.querySelector('td'));
    expect(cell).toContain('border');
    expect(cell).toContain('padding');

    expect(styleOf(washed.querySelector('hr'))).toContain('border-top');
  });

  it('D 出站 HTML 里不许有 CSS 变量（微信会丢弃 var()，等于没设）', () => {
    expect(externalHtml().innerHTML).not.toContain('var(--');
  });

  it('E 字号跟随 --mk-font-size（证明读的是主题变量，不是把默认值抄死在这里）', () => {
    const before = fontSizeOf(externalHtml().querySelector('p'));

    document.documentElement.style.setProperty('--mk-font-size', '20px');
    const after = fontSizeOf(externalHtml().querySelector('p'));
    const h1 = fontSizeOf(externalHtml().querySelector('h1'));

    expect(before).toBe(16);
    expect(after).toBe(20);
    // h1 是 1.6em ⇒ 32px；抄死 16px 的写法会算成 25.6
    expect(h1).toBeCloseTo(32, 1);
  });
});

describe('P2-4：字号 token 静态折算（clamp() / 百分比 / 未知单位）', () => {
  // 我防的事故：自定义主题的 heading1~6Size 被 manager.ts::injectTypography **原样**
  // 写入 CSS 变量（无格式校验），clamp()/百分比/视口单位都是合法字号、编辑器里正常
  // 渲染；但出站读的是 CSS 变量的**原始 token**，旧 toPx 的 parseFloat 只会咬住第一
  // 个数字当 px —— clamp(1.5em, 2vw, 2.2em) 复制出去是 1.5px 的肉眼隐形标题、
  // 120% 是 120px 巨型字（审计 P2-4，新功能 cbcf1e5 引入）。
  afterEach(() => {
    document.documentElement.style.removeProperty('--mk-heading1-size');
  });

  it('clamp()：折算落在 [min em, max em] 区间，绝不产出 1.5px 隐形标题', () => {
    document.documentElement.style.setProperty('--mk-heading1-size', 'clamp(1.5em, 2vw, 2.2em)');
    const washed = washForWechat(externalHtml().innerHTML);
    const size = fontSizeOf(washed.querySelector('h1'));
    expect(size, `clamp 被折算成了 ${size}px`).toBeGreaterThanOrEqual(1.5 * 16);
    expect(size).toBeLessThanOrEqual(2.2 * 16 + 0.1);
  });

  it('百分比：120% = 正文字号 × 1.2（字号语义，不是 120px）', () => {
    document.documentElement.style.setProperty('--mk-heading1-size', '120%');
    const washed = washForWechat(externalHtml().innerHTML);
    expect(fontSizeOf(washed.querySelector('h1'))).toBeCloseTo(16 * 1.2, 1);
  });

  it('未知单位（2vw）：回落数字号，不产出 2px 微型字', () => {
    document.documentElement.style.setProperty('--mk-heading1-size', '2vw');
    const washed = washForWechat(externalHtml().innerHTML);
    expect(fontSizeOf(washed.querySelector('h1'))).toBe(16);
  });

  it('em 语义不变（回归防误伤）', () => {
    document.documentElement.style.setProperty('--mk-heading1-size', '1.4em');
    const washed = washForWechat(externalHtml().innerHTML);
    expect(fontSizeOf(washed.querySelector('h1'))).toBeCloseTo(16 * 1.4, 1);
  });
});
