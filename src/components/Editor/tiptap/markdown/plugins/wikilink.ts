import type { Schema } from '@tiptap/pm/model';
import type { MarkdownParseState, TokenHandler } from '../parser';
import type { MarkdownSerializerState, NodeSerializer } from '../serializer';
import type { MarkdownSyntaxPlugin } from './index';
import { stripZwnj } from '../../zwnj';

function parseWikilinkText(state: MarkdownParseState, content: string) {
  const regex = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      state.addText(content.slice(lastIndex, match.index));
    }

    const target = match[1].trim();
    const alias = match[2]?.trim() || '';
    state.addNode(state.schema.nodes.wikilink, { target, alias });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    state.addText(content.slice(lastIndex));
  }
}

export function wikilinkTokenHandlers(schema: Schema): Record<string, TokenHandler> {
  if (!schema.nodes.wikilink) {
    return {};
  }

  return {
    text(state, token) {
      if (/\[\[/.test(token.content)) {
        parseWikilinkText(state, token.content);
      } else {
        state.addText(token.content);
      }
    },
  };
}

export const wikilinkNodeSerializers: Record<string, NodeSerializer> = {
  wikilink(state: MarkdownSerializerState, node) {
    // stripZwnj：target / alias 走属性通道，**不经过** escapeInline。
    // ⚠️ 2026-10-10 实测这是**当下就触发**的落点（不是潜在）：`[[a，**b]]` 会建
    // wikilink 且 target="a，\u200C**b"，落盘带 ZWNJ（第三方 F-1 补充 + 我方直接构造实测）
    const target = stripZwnj(node.attrs.target as string);
    const alias = stripZwnj(node.attrs.alias as string);
    // escapeCellPipe：单元格内 target/alias 里的 `|` 会切列；**分隔符本身也必须
    // 写成 `\|`**——它是裸 `|`，在单元格里照样切列（重开时 escapedSplit 还原成
    // `|`，互链语法不受影响）——审计 P1-1
    if (alias) {
      const sep = state.isInTableCell ? '\\|' : '|';
      state.write(`[[${state.escapeCellPipe(target)}${sep}${state.escapeCellPipe(alias)}]]`);
    } else {
      state.write(`[[${state.escapeCellPipe(target)}]]`);
    }
  },
};

export const wikilinkMarkdownPlugin: MarkdownSyntaxPlugin = {
  name: 'wikilink',
  tokenHandlers: wikilinkTokenHandlers,
  nodeSerializers: wikilinkNodeSerializers,
};
