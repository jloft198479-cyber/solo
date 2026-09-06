import type { Schema } from '@tiptap/pm/model';
import type { MarkdownSerializerState, NodeSerializer } from '../serializer';
import type { FenceHandler, MarkdownSyntaxPlugin } from './index';
import { computeFence } from './fence';

export function mermaidFenceHandler(schema: Schema): FenceHandler | null {
  if (!schema.nodes.mermaidBlock) {
    return null;
  }

  return (state, _token, language, content) => {
    if (language !== 'mermaid') {
      return false;
    }

    state.addNode(schema.nodes.mermaidBlock, {}, content ? [schema.text(content)] : undefined);
    return true;
  };
}

export const mermaidNodeSerializers: Record<string, NodeSerializer> = {
  mermaidBlock(state: MarkdownSerializerState, node) {
    // 围栏升级（B7）：内容含独立 ``` 行时固定 3 反引号会被提前闭合 → 落盘即损坏
    const content = node.textContent;
    const fence = computeFence(content);
    state.writeLine(fence + 'mermaid');
    state.writeLine(content);
    state.writeLine(fence);
    state.closeBlock(node);
  },
};

export const mermaidMarkdownPlugin: MarkdownSyntaxPlugin = {
  name: 'mermaid',
  fenceHandler: mermaidFenceHandler,
  nodeSerializers: mermaidNodeSerializers,
};
