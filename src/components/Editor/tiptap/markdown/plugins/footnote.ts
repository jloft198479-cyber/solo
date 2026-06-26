import type Token from 'markdown-it/lib/token.mjs';
import type { Schema } from '@tiptap/pm/model';
import type { MarkdownParseState, TokenHandler } from '../parser';
import type { NodeSerializer } from '../serializer';
import type { MarkdownSerializerState } from '../serializer';
import type { MarkdownSyntaxPlugin } from './index';

export function footnoteTokenHandlers(schema: Schema): Record<string, TokenHandler> {
  const handlers: Record<string, TokenHandler> = {};

  if (schema.nodes.footnoteRef) {
    handlers.footnote_ref = (state: MarkdownParseState, token: Token) => {
      const label = (token.meta?.label as string) || '';
      state.addNode(schema.nodes.footnoteRef, { label });
    };
  }

  handlers.footnote_block_open = (state: MarkdownParseState) => {
    state.openNode(schema.nodes.footnoteSection);
  };
  handlers.footnote_block_close = (state: MarkdownParseState) => {
    state.closeNode();
  };

  handlers.footnote_open = (state: MarkdownParseState, token: Token) => {
    const label = ((token.meta?.label ?? token.meta?.id) as string) || '';
    state.openNode(schema.nodes.footnoteDef, { label });
  };
  handlers.footnote_close = (state: MarkdownParseState) => {
    state.closeNode();
  };

  handlers.footnote_anchor = () => {};

  return handlers;
}

export const footnoteNodeSerializers: Record<string, NodeSerializer> = {
  footnoteRef(state: MarkdownSerializerState, node) {
    state.write(`[^${node.attrs.label || ''}]`);
  },

  footnoteSection(state: MarkdownSerializerState, node) {
    node.forEach((child, _offset, index) => {
      if (index > 0) state.blankLine();
      state.renderNode(child);
    });
    state.closeBlock(node);
  },

  footnoteDef(state: MarkdownSerializerState, node) {
    const label = node.attrs.label as string;
    const firstChild = node.firstChild;
    if (firstChild && firstChild.isTextblock && node.childCount <= 1) {
      state.write(`[^${label}]: `);
      state.renderInline(firstChild);
      state.write('\n');
    } else if (firstChild && firstChild.isTextblock) {
      state.write(`[^${label}]: `);
      state.renderInline(firstChild);
      state.write('\n');
      for (let i = 1; i < node.childCount; i++) {
        const child = node.child(i);
        state.write('    ');
        if (child.isTextblock) state.renderInline(child);
        else state.renderNode(child);
        state.write('\n');
      }
    } else {
      state.write(`[^${label}]: `);
      state.renderContent(node);
      state.write('\n');
    }
    state.closeBlock(node);
  },
};

export const footnoteMarkdownPlugin: MarkdownSyntaxPlugin = {
  name: 'footnote',
  tokenHandlers: footnoteTokenHandlers,
  nodeSerializers: footnoteNodeSerializers,
};
