import type Token from 'markdown-it/lib/token.mjs';
import type { Schema } from '@tiptap/pm/model';
import type { MarkdownParseState, TokenHandler } from '../parser';
import type { MarkdownSerializerState, NodeSerializer } from '../serializer';
import type { FenceHandler, MarkdownSyntaxPlugin } from './index';
import { computeFence } from './fence';

export function mathTokenHandlers(schema: Schema): Record<string, TokenHandler> {
  const handlers: Record<string, TokenHandler> = {};

  if (schema.nodes.mathInline) {
    handlers.math_inline = (state: MarkdownParseState, token: Token) => {
      state.addNode(schema.nodes.mathInline, { latex: token.content.trim() });
    };
  }

  if (schema.nodes.mathBlock) {
    handlers.math_block = (state: MarkdownParseState, token: Token) => {
      const latex = token.content.replace(/^\n|\n$/g, '');
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
    state.addNode(schema.nodes.mathBlock, {}, content ? [schema.text(content)] : undefined);
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
