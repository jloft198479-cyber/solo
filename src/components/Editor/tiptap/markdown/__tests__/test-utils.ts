import { Schema, type Node as PMNode } from '@tiptap/pm/model';
import MarkdownIt from 'markdown-it';
import { parseMarkdown } from '../parser';
import { serializeMarkdown, serializeMarkdownForClipboard } from '../serializer';

/** 构建最小 schema（匹配 solo 实际使用的 nodes + marks）
 *  注意：这是生产 schema 的镜像，属性必须与 extensions/*.ts 保持同步——
 *  缺属性会让相关 roundtrip「静默通过」，给假绿灯（表格跨格、图片尺寸曾如此）。 */
export function createTestSchema(): Schema {
  return new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
      heading: {
        group: 'block', content: 'inline*',
        attrs: { level: { default: 1 } },
        defining: true,
        parseDOM: [1, 2, 3, 4, 5, 6].map((l) => ({ tag: `h${l}`, attrs: { level: l } })),
        toDOM: (n: PMNode) => [`h${n.attrs.level}`, 0],
      },
      blockquote: { group: 'block', content: 'block+', parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
      bulletList: { group: 'block', content: '(listItem | taskItem)+', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
      orderedList: { group: 'block', content: '(listItem | taskItem)+', attrs: { start: { default: 1 } }, parseDOM: [{ tag: 'ol' }], toDOM: () => ['ol', 0] },
      listItem: { content: 'block+', parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] },
      taskList: { group: 'block', content: 'taskItem+', parseDOM: [{ tag: 'ul[data-type="taskList"]' }], toDOM: () => ['ul', { 'data-type': 'taskList' }, 0] },
      taskItem: { content: 'block+', attrs: { checked: { default: false } }, parseDOM: [{ tag: 'li[data-type="taskItem"]' }], toDOM: (n: PMNode) => ['li', { 'data-type': 'taskItem', 'data-checked': n.attrs.checked }, 0] },
      codeBlock: {
        group: 'block', content: 'text*', marks: '', code: true,
        attrs: { language: { default: null } },
        parseDOM: [{ tag: 'pre' }], toDOM: () => ['pre', ['code', 0]],
      },
      hardBreak: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
      horizontalRule: { group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
      table: { group: 'block', content: 'tableRow+', tableRole: 'table', parseDOM: [{ tag: 'table' }], toDOM: () => ['table', ['tbody', 0]] },
      tableRow: { content: '(tableHeader | tableCell)+', tableRole: 'row', parseDOM: [{ tag: 'tr' }], toDOM: () => ['tr', 0] },
      tableHeader: {
        content: 'paragraph+', tableRole: 'header_cell', isolating: true,
        // 与生产一致：CustomTableHeader/TableCell 未覆盖 addAttributes，用 Tiptap 默认
        attrs: { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } },
        parseDOM: [{ tag: 'th' }], toDOM: () => ['th', 0],
      },
      tableCell: {
        content: 'paragraph+', tableRole: 'cell', isolating: true,
        attrs: { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } },
        parseDOM: [{ tag: 'td' }], toDOM: () => ['td', 0],
      },
      image: {
        inline: true, group: 'inline',
        // width/height 与生产 image.ts 的 addAttributes 同步（决定 `![alt|WxH](src)` 往返）
        attrs: { src: { default: '' }, alt: { default: '' }, title: { default: null }, width: { default: null }, height: { default: null } },
        parseDOM: [{ tag: 'img' }], toDOM: () => ['img'],
      },
      mathInline: {
        inline: true, group: 'inline', atom: true,
        attrs: { latex: { default: '' } },
        parseDOM: [{ tag: 'span[data-type="math-inline"]' }],
        toDOM: () => ['span', { 'data-type': 'math-inline' }, 0],
      },
      mathBlock: {
        group: 'block', content: 'text*', marks: '', code: true,
        parseDOM: [{ tag: 'div[data-type="math-block"]' }],
        toDOM: () => ['div', { 'data-type': 'math-block' }, 0],
      },
      mermaidBlock: {
        group: 'block', content: 'text*', marks: '', code: true,
        parseDOM: [{ tag: 'div[data-type="mermaid-block"]' }],
        toDOM: () => ['div', { 'data-type': 'mermaid-block' }, 0],
      },
      frontmatter: {
        group: 'block', content: 'text*', marks: '', code: true, defining: true,
        parseDOM: [{ tag: 'pre[data-frontmatter]' }],
        toDOM: () => ['pre', { 'data-frontmatter': '' }, ['code', 0]],
      },
      callout: {
        group: 'block', content: 'block+',
        attrs: {
          calloutType: { default: 'note' },
          title: { default: '' },
          fold: { default: null }, // '+' | '-' | null（B10）
        },
        parseDOM: [{ tag: 'div.mk-callout' }],
        toDOM: () => ['div', { 'data-type': 'callout' }, 0],
      },
      footnoteRef: {
        inline: true, group: 'inline', atom: true,
        attrs: { label: { default: '' } },
        parseDOM: [{ tag: 'sup[data-footnote-ref]' }],
        toDOM: () => ['sup', { 'data-footnote-ref': '' }, 0],
      },
      footnoteSection: {
        group: 'block', content: 'footnoteDef+', defining: true,
        parseDOM: [{ tag: 'div[data-footnote-section]' }],
        toDOM: () => ['div', { 'data-footnote-section': '' }, 0],
      },
      footnoteDef: {
        group: 'block', content: 'block+', defining: true,
        attrs: { label: { default: '' } },
        parseDOM: [{ tag: 'div[data-footnote-def]' }],
        toDOM: () => ['div', { 'data-footnote-def': '' }, 0],
      },
      wikilink: {
        inline: true, group: 'inline', atom: true,
        attrs: { target: { default: '' }, alias: { default: '' } },
        parseDOM: [{ tag: 'span[data-wikilink]' }],
        toDOM: () => ['span', { 'data-wikilink': '' }, 0],
      },
      text: { group: 'inline' },
    },
    marks: {
      bold: { parseDOM: [{ tag: 'strong' }], toDOM: () => ['strong', 0] },
      italic: { parseDOM: [{ tag: 'em' }], toDOM: () => ['em', 0] },
      strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }], toDOM: () => ['s', 0] },
      code: { parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
      highlight: { parseDOM: [{ tag: 'mark' }], toDOM: () => ['mark', 0] },
      link: {
        attrs: { href: { default: '' }, target: { default: null }, title: { default: null } },
        parseDOM: [{ tag: 'a' }], toDOM: () => ['a', 0],
      },
      superscript: { parseDOM: [{ tag: 'sup' }], toDOM: () => ['sup', 0] },
      subscript: { parseDOM: [{ tag: 'sub' }], toDOM: () => ['sub', 0] },
      dim: { parseDOM: [{ tag: 'span.mk-dim' }], toDOM: () => ['span', { class: 'mk-dim' }, 0] },
    },
  });
}

export function normalize(md: string): string {
  return md.replace(/\n+$/, '\n');
}

export function roundTrip(md: string): string {
  const schema = createTestSchema();
  const doc = parseMarkdown(schema, md);
  return serializeMarkdown(doc);
}

export function roundTripClipboard(md: string): string {
  const schema = createTestSchema();
  const doc = parseMarkdown(schema, md);
  return serializeMarkdownForClipboard(doc);
}

// ── 独立参照系（markdown-it 标准实现，不经 solo 的自定义 handler）──────────
//
// 为什么必须独立：拿 solo 自己解析自己做判据，parser 的系统性缺陷会**对称地**
// 复制到参照侧，导致「丢掉一半内容」也判为等价——fixtures/lists.md 实测如此。
// 参照系必须来自不受 solo 实现影响的第三方标准解析器。

const refMd = new MarkdownIt('commonmark', { html: false }).enable(['table', 'strikethrough']);

/** 提取可见文字：原文与输出用同一参照系，差异自然抵消（如过逃逸 / mark 顺序）。
 *  NBSP 是编辑器用于占位的**不可见字符**（防空段落被丢弃），不算内容，剥离。 */
function visibleText(md: string): string {
  const parts: string[] = [];
  for (const t of refMd.parse(md, {})) {
    if (t.type === 'inline' && t.children) {
      for (const c of t.children) {
        if (c.type === 'text' || c.type === 'code_inline') parts.push(c.content);
      }
    } else if (t.type === 'fence' || t.type === 'code_block') {
      parts.push(t.content);
    }
  }
  return parts.join('').replace(/\u00a0/g, '');
}

/** 块级结构直方图：只数「开标签」类型计数，不受 tight/loose、对齐空格影响。
 *  空段落（无可见文字，如空文件写出的 NBSP 占位）不计入——它不承载内容。 */
function blockHistogram(md: string): string {
  const tokens = refMd.parse(md, {});
  const counts: Record<string, number> = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.nesting !== 1) continue;
    if (t.type === 'paragraph_open') {
      const inline = tokens[i + 1];
      const inner = (inline?.children ?? [])
        .filter((c) => c.type === 'text' || c.type === 'code_inline')
        .map((c) => c.content)
        .join('')
        .replace(/[\s\u00a0]/g, '');
      if (!inner) continue;
    }
    counts[t.type] = (counts[t.type] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}×${v}`)
    .join(' ');
}

/** 字符多重集（排序后）——只反映「内容增减」，不受顺序重排影响 */
function charBag(s: string): string {
  return [...s].sort().join('');
}

/** 取第一段「在 got 中找不到」的原文片段，供报错定位 */
function firstMissingFragment(ref: string, got: string): string {
  const WIN = 6;
  for (let i = 0; i < ref.length; i++) {
    const probe = ref.slice(i, i + WIN);
    if (probe.length === WIN && !got.includes(probe)) return ref.slice(i, i + 24);
  }
  return '';
}

/**
 * 重开等价检查：序列化输出「重新打开」后，内容必须与原文一致。
 *
 * 判据用**独立参照系**（markdown-it）比对两件事：
 *  ① 可见文字的**多重集** —— 抓内容增减（列表段被吞、文字消失）
 *  ② 块级结构直方图 —— 抓结构塌陷
 *
 * 为什么这样切：
 *  - 不用字节比对：它把「格式规整」（表格对齐、mark 顺序归一、尾随空格）与「真丢内容」
 *    混为一谈——前者是设计选择，后者是数据事故。
 *  - 文字用**多重集**而非序列：顺序重排（如脚注定义位置变动）不是内容丢失，不该报。
 *
 * @returns 差异描述数组，空数组 = 等价
 */
export function reopenDrift(md: string, out: string): string[] {
  const drift: string[] = [];

  const refText = visibleText(md);
  const gotText = visibleText(out);
  if (charBag(refText) !== charBag(gotText)) {
    const missing = firstMissingFragment(refText, gotText);
    drift.push(
      `内容增减：原文 ${refText.length} 字 → 输出 ${gotText.length} 字` +
        (missing ? `；输出中缺失「${missing}」` : ''),
    );
  }

  const refStruct = blockHistogram(md);
  const gotStruct = blockHistogram(out);
  if (refStruct !== gotStruct) {
    drift.push(`块结构变化：[${refStruct}] → [${gotStruct}]`);
  }

  return drift;
}

// ── 可复现随机源（fuzz 用）──────────────────────────────────────────────
//
// 为什么不用 `Math.random()`：fuzz 一旦在 CI 偶发转红，**无法复现**就没法定位——
// 测试的价值一半在「能重放失败」。种子化后：同种子 → 同序列，报告里打印种子即可重跑。
// （本项目曾因 fuzz 用真随机，5/100 失败后只能靠肉眼回推输入。）

export type Rand = () => number;

/** mulberry32：小、快、分布够好的确定性 PRNG */
export function makeRand(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 获取随机整数 [min, max] */
export function randInt(rng: Rand, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** 随机选择数组中的一项 */
export function pick<T>(rng: Rand, arr: T[]): T {
  return arr[randInt(rng, 0, arr.length - 1)];
}
