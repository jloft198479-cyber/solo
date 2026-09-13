import { Schema } from '@tiptap/pm/model';
import { ref } from 'vue';
import { getSchema } from '@tiptap/core';
import MarkdownIt from 'markdown-it';
import { createEditorExtensions } from '../../editor-extensions';
import { parseMarkdown } from '../parser';
import { serializeMarkdown, serializeMarkdownForClipboard } from '../serializer';

/**
 * 测试用 schema —— 直接复用**生产编辑 schema**，不再手抄镜像。
 *
 * 历史（#11）：本函数曾是 124 行手抄的「最小 schema」，文件头自陈
 * 「属性必须与 extensions/*.ts 保持同步，缺属性会给假绿灯（表格跨格、图片尺寸曾如此）」。
 * 实测证明镜像**双向骗人**：生产真丢的它接得住（假绿）；生产不丢的它却丢（假红）。
 * 更早的误判是以为 paste 通道用另一套 schema——实际 `markdown-paste.ts` 全程用
 * `view.state.schema`（即本 schema），手抄镜像只有测试在用。
 *
 * ⇒ 现在测试永远测真身。改 `extensions/*.ts` 自动反映到全部 markdown 单测。
 * 详见 `KNOWN-ISSUES.md` §二 #11 与 `topics/schema-drift.md` §⑥。
 */
let cachedSchema: Schema | null = null;

export function createTestSchema(): Schema {
  // 单例缓存：构建扩展树开销大，而测试内 schema 恒定
  return (cachedSchema ??= getSchema(
    createEditorExtensions({
      slashMenuRef: ref(null),
      slashMenuItems: ref([]),
      slashMenuCommand: ref(() => {}),
      emojiMenuRef: ref(null),
      emojiMenuItems: ref([]),
      emojiMenuCommand: ref(() => {}),
      wikilinkMenuRef: ref(null),
      wikilinkMenuItems: ref([]),
      wikilinkMenuCommand: ref(() => {}),
      searchHighlightOptions: {} as never,
    }),
  ));
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
