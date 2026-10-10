import type Token from 'markdown-it/lib/token.mjs';
import type { Schema } from '@tiptap/pm/model';
import type { MarkdownParseState, TokenHandler } from '../parser';
import type { MarkdownSerializerState, NodeSerializer } from '../serializer';
import type { FenceHandler, MarkdownSyntaxPlugin } from './index';
import { computeFence } from './fence';
// 解析期插入的 ZWNJ 不该留在「字面内容」里 —— 见 ../../zwnj 与敏感区 #23
import { stripZwnj } from '../../zwnj';

/**
 * ⚠️ 为什么数学内容在**入口**就要剥 ZWNJ（而不是在序列化器兜底）：
 * `$$…$$` / `$…$` **不在** `protectCodeRegions` 的覆盖范围内，所以 ZWNJ 预处理
 * 会把 U+200C 插进数学源里（实测 `$$a**——b$$` 会中招）——`mathBlock` 落进
 * `textContent`、`mathInline` 落进 `attrs.latex`，**输出时会被原样写进文件**
 * （污染用户文件），同时脏 LaTeX 还会进 KaTeX 渲染。
 *
 * 数学内容**经解析期带入 ZWNJ 的唯一入口**就是这里（其余创建路径——`markdown-input`
 * / `slash-commands` 手工插入——建的是空节点，不经解析期预处理，无 ZWNJ 可带）
 * ⇒ 在入口剥一次，内存 / 渲染 / 落盘 / 剪贴板
 * 全部自动干净（也顺带清洗存量脏文件）。**故序列化侧不再重复剥**——那会变成
 * 同一件事两处做。
 */
export function mathTokenHandlers(schema: Schema): Record<string, TokenHandler> {
  const handlers: Record<string, TokenHandler> = {};

  if (schema.nodes.mathInline) {
    handlers.math_inline = (state: MarkdownParseState, token: Token) => {
      state.addNode(schema.nodes.mathInline, { latex: stripZwnj(token.content.trim()) });
    };
  }

  if (schema.nodes.mathBlock) {
    handlers.math_block = (state: MarkdownParseState, token: Token) => {
      const latex = stripZwnj(token.content.replace(/^\n|\n$/g, ''));
      state.addNode(schema.nodes.mathBlock, {}, latex ? [schema.text(latex)] : undefined);
    };
    // texmath 的 `$$…$$` 若**紧跟前一段正文**（中间无空行），不会成为块级 `math_block`，
    // 而是被解析进段落 inline 层的 `math_inline_double`（实测 token 流：
    // `正文\n$$\nE=mc^2\n$$\n` → inline[text"正文", softbreak, math_inline_double]）。
    // 此前**没有这个 handler** ⇒ token 被静默跳过 ⇒ **整块公式连同内容消失**，
    // 且不报错（台账 §二 #38）。语义上 `$$…$$` 就是行间公式，故与 math_block 同映射。
    // 它出现在段落内，`addNode` 会因「块级节点落进 textblock」先收掉段落再落块
    // （见 parser.ts `addNode`），最终得到「段落 + mathBlock」两块，内容不丢。
    handlers.math_inline_double = handlers.math_block;
  }

  return handlers;
}

export function mathFenceHandler(schema: Schema): FenceHandler | null {
  if (!schema.nodes.mathBlock) {
    return null;
  }

  // fence 形式（```math）的解析入口：内容含 $$ 的 math 块以此形式落盘（见序列化侧）
  return (state, _token, language, content) => {
    if (language !== 'math') {
      return false;
    }
    // 围栏内容本就被 protectCodeRegions 保护，此处剥 ZWNJ 是为**清洗存量**被污染的
    // 文件（与 serializer 里 code block 那条同源口径）
    const clean = content ? stripZwnj(content) : '';
    state.addNode(schema.nodes.mathBlock, {}, clean ? [schema.text(clean)] : undefined);
    return true;
  };
}

/**
 * 规范化数学块内容：去首尾空行 → 去掉各行**公共**前导空白（dedent）→ 去行尾空白。
 *
 * 为什么必须 dedent：`writeLine()` 会在**行首自动补一次外层 `lineIndent`**（列表项 /
 * 引用块的续行缩进），而块内容里往往**已经带着源文件的前导空格** ⇒ 缩进被加两遍，
 * 且每存一次再加一遍（`- 项\n\n  $$\n  E=mc^2\n  $$\n` R1 加 2、R2 再加 2，
 * **永不收敛**；`> $$…$$` 每轮 +1 并留尾随空格）。dedent 只去掉**公共**前缀，
 * 行与行之间的相对缩进（LaTeX 排版用）保持不动。
 */
function normalizeMathContent(raw: string): string {
  const lines = raw.split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  let common = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    common = Math.min(common, line.length - line.trimStart().length);
  }
  if (!Number.isFinite(common)) common = 0;
  return lines.map((line) => line.slice(common).replace(/\s+$/, '')).join('\n');
}

export const mathNodeSerializers: Record<string, NodeSerializer> = {
  mathInline(state: MarkdownSerializerState, node) {
    state.write(`$${node.attrs.latex || ''}$`);
  },

  mathBlock(state: MarkdownSerializerState, node) {
    const content = normalizeMathContent(node.textContent);
    // 内容含 $$ 时 $$ 定界形式会被提前闭合（texmath 非贪婪匹配到 $$ 即停）→
    // 落盘即损坏；改用 fence 形式（```math）。无冲突时维持 Obsidian 兼容的 $$ 形式
    if (content.includes('$$')) {
      const fence = computeFence(content);
      state.writeLine(fence + 'math');
      state.writeLine(content);
      state.writeLine(fence);
    } else {
      state.writeLine('$$');
      state.writeLine(content);
      state.writeLine('$$');
    }
    state.closeBlock(node);
  },
};

export const mathMarkdownPlugin: MarkdownSyntaxPlugin = {
  name: 'math',
  tokenHandlers: mathTokenHandlers,
  fenceHandler: mathFenceHandler,
  nodeSerializers: mathNodeSerializers,
};
