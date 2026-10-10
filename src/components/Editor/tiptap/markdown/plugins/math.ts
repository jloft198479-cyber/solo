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

export const mathNodeSerializers: Record<string, NodeSerializer> = {
  mathInline(state: MarkdownSerializerState, node) {
    state.write(`$${node.attrs.latex || ''}$`);
  },

  mathBlock(state: MarkdownSerializerState, node) {
    const content = node.textContent;
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
