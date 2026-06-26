/**
 * Callout Markdown 插件
 *
 * 解析：检测 > [!TYPE] 格式的 blockquote，转换为 callout 节点
 * 序列化：将 callout 节点序列化为 > [!TYPE]\n> content 格式
 *
 * 使用有状态的 token interceptor：检测到 callout blockquote 后，
 * 手动处理内部所有 token，并跳过主循环对这些 token 的重复处理。
 *
 * inline children 委托给主解析器的 handler dispatch，确保所有插件注册的
 * inline token（math、footnote、wikilink、sup/sub 等）在 callout 内正常工作。
 */
import type Token from 'markdown-it/lib/token.mjs';
import type { Schema } from '@tiptap/pm/model';
import type { MarkdownParseState, TokenHandler } from '../parser';
import { getTokenHandlers } from '../parser';
import type { NodeSerializer } from '../serializer';
import type { MarkdownSerializerState } from '../serializer';
import type { MarkdownSyntaxPlugin, TokenInterceptor } from './index';
import { normalizeCalloutType } from '../../extensions/callout';

/**
 * 检测 inline token 是否以 [!TYPE] 开头（接受任意类型，兼容旧文档）
 */
function matchCalloutMarker(inlineToken: Token): string | null {
  if (!inlineToken.children || inlineToken.children.length === 0) return null;

  const firstChild = inlineToken.children[0];
  if (firstChild.type !== 'text') return null;

  const text = firstChild.content;
  const match = text.match(/^\[!([A-Za-z]+)\]/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * 从 inline token 的 children 中剥离 [!TYPE] 前缀及紧跟的换行
 */
function stripCalloutMarker(inlineToken: Token) {
  if (!inlineToken.children || inlineToken.children.length === 0) return;

  const firstChild = inlineToken.children[0];
  if (firstChild.type !== 'text') return;

  // 剥离 [!TYPE]
  firstChild.content = firstChild.content.replace(/^\[![A-Za-z]+\]/, '');

  // 如果剥离后文本为空，移除该 token
  if (!firstChild.content) {
    inlineToken.children.splice(0, 1);
    // 如果下一个 sibling 是 softbreak（[!TYPE]\n 中的 \n），一并移除
    if (inlineToken.children.length > 0 && inlineToken.children[0].type === 'softbreak') {
      inlineToken.children.splice(0, 1);
    }
  }
}

/**
 * 处理 inline token 的 children，委托给主解析器的 handler dispatch。
 * 不再硬编码 switch case，所有插件注册的 inline token 类型自动支持。
 */
function processInlineChildren(
  state: MarkdownParseState,
  handlers: Record<string, TokenHandler>,
  children: Token[],
) {
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const handler = handlers[child.type];
    if (handler) {
      handler(state, child, children, i);
    } else if (child.type === 'text') {
      state.addText(child.content);
    }
    // 未注册的 token 类型静默跳过（与主解析器行为一致）
  }
}

const calloutTokenInterceptor: (schema: Schema) => TokenInterceptor = (schema) => {
  // 有状态闭包：记录需要跳过的 token 范围
  let skipUntilClose = false;
  let skipLevel = -1;

  // 构建完整的 token handler 映射（含所有插件注册的 handler）
  const handlers = getTokenHandlers(schema);

  return (state: MarkdownParseState, token: Token, tokens: Token[], index: number): boolean => {
    // 如果正在跳过 callout blockquote 的内部 token
    if (skipUntilClose) {
      if (token.type === 'blockquote_close' && token.level <= skipLevel) {
        // 到达匹配的 blockquote_close，结束跳过
        skipUntilClose = false;
        skipLevel = -1;
      }
      return true; // 跳过此 token
    }

    if (token.type !== 'blockquote_open') return false;

    // 向前查找 blockquote 的第一个 inline token
    let inlineIdx = -1;
    let closeIdx = -1;
    for (let i = index + 1; i < tokens.length; i++) {
      if (tokens[i].type === 'inline' && inlineIdx === -1) {
        inlineIdx = i;
      }
      if (tokens[i].type === 'blockquote_close' && tokens[i].level === token.level) {
        closeIdx = i;
        break;
      }
    }

    if (inlineIdx === -1 || closeIdx === -1) return false;

    const inlineToken = tokens[inlineIdx];
    const calloutType = matchCalloutMarker(inlineToken);
    if (!calloutType) return false;

    // 这是 callout blockquote — 剥离 marker 前缀
    stripCalloutMarker(inlineToken);

    // 打开 callout 节点
    state.openNode(schema.nodes.callout, { calloutType: normalizeCalloutType(calloutType) });

    // 手动处理 blockquote 内部的所有 token
    for (let i = index + 1; i < closeIdx; i++) {
      const t = tokens[i];
      // 跳过嵌套 blockquote 的开/关（callout 不嵌套 blockquote）
      if (t.type === 'blockquote_open' || t.type === 'blockquote_close') continue;

      if (t.type === 'paragraph_open') {
        state.openNode(schema.nodes.paragraph);
      } else if (t.type === 'paragraph_close') {
        state.closeNode();
      } else if (t.type === 'inline' && t.children) {
        processInlineChildren(state, handlers, t.children);
      }
    }

    state.closeNode(); // 关闭 callout

    // 标记跳过范围：从 blockquote_open 到 blockquote_close 的所有 token
    // 当前 blockquote_open 会被返回值 true 跳过
    // 后续 token 通过 skipUntilClose 标志跳过
    skipUntilClose = true;
    skipLevel = token.level;

    return true; // 跳过 blockquote_open
  };
};

const calloutNodeSerializers: Record<string, NodeSerializer> = {
  callout(state: MarkdownSerializerState, node) {
    const type = normalizeCalloutType(node.attrs.calloutType as string);
    const marker = `[!${type.toUpperCase()}]`;

    state.writeLine(`> ${marker}`);

    // 逐段落序列化为 > prefix 格式
    node.forEach((child) => {
      if (child.type.name === 'paragraph') {
        // 内联内容前缀 >
        state.write('> ');
        state.renderInline(child);
        state.write('\n');
      } else {
        // 其他块级节点也加 > 前缀
        state.write('> ');
        state.renderNode(child);
      }
    });

    state.closeBlock(node);
  },
};

export const calloutMarkdownPlugin: MarkdownSyntaxPlugin = {
  name: 'callout',
  tokenInterceptor: calloutTokenInterceptor,
  nodeSerializers: calloutNodeSerializers,
};
