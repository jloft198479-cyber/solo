/**
 * Callout Markdown 插件
 *
 * 解析：检测 > [!TYPE] 格式的 blockquote，转换为 callout 节点
 * 序列化：将 callout 节点序列化为 > [!TYPE]\n> content 格式
 *
 * 使用有状态的 token interceptor：检测到 callout blockquote 后，
 * 内部所有 token 委托给主解析器的 handler dispatch，并跳过主循环对这些 token 的重复处理。
 *
 * 块级与 inline token 均委托给主 handler dispatch，确保所有插件注册的
 * handler（列表/表格/代码块/math/footnote/wikilink/sup/sub 等）在 callout 内正常工作。
 */
import type Token from 'markdown-it/lib/token.mjs';
import type { Schema } from '@tiptap/pm/model';
import type { MarkdownParseState } from '../parser';
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
 * Callout 解析的 per-parse 状态。
 * 挂在 MarkdownParseState.pluginData 上（每次 parseMarkdown 新建，天然隔离），
 * 避免 interceptor 按 schema 全局缓存后跨文档泄漏状态（M8：一次解析异常
 * 卡住 skipUntilClose=true，会让之后所有文档的 callout 解析永久失效）。
 */
interface CalloutParseState {
  skipUntilClose: boolean;
  skipLevel: number;
}

function getCalloutParseState(state: MarkdownParseState): CalloutParseState {
  let s = state.pluginData.callout as CalloutParseState | undefined;
  if (!s) {
    s = { skipUntilClose: false, skipLevel: -1 };
    state.pluginData.callout = s;
  }
  return s;
}

const calloutTokenInterceptor: (schema: Schema) => TokenInterceptor = (schema) => {
  // 构建完整的 token handler 映射（含所有插件注册的 handler）
  const handlers = getTokenHandlers(schema);

  return (state: MarkdownParseState, token: Token, tokens: Token[], index: number): boolean => {
    const parseState = getCalloutParseState(state);

    // 如果正在跳过 callout blockquote 的内部 token
    if (parseState.skipUntilClose) {
      if (token.type === 'blockquote_close' && token.level <= parseState.skipLevel) {
        // 到达匹配的 blockquote_close，结束跳过
        parseState.skipUntilClose = false;
        parseState.skipLevel = -1;
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

    // C1：委托主 handler 分发 blockquote 内部的所有 token。
    // 之前只认 paragraph_open/close/inline 三种，代码块/列表/表格/分割线等
    // 块级 token 被静默跳过 → roundtrip 丢内容。委托后与主解析循环行为一致，
    // 且 inline 走主 handler 还能带上 checkbox 的 skipNextSpace 逻辑。
    // 嵌套 blockquote 的 open/close 仍跳过（callout 内不嵌套 blockquote）。
    //
    // 特例：当 marker 独占一行（> [!TYPE] 后直接接列表/代码块/表格）时，
    // markdown-it 会把 marker 单独解析成一个段落，剥离后该段落为空——
    // 跳过这个空段落（paragraph_open / inline / paragraph_close），
    // 避免产出空段落导致序列化多出空行。
    const markerInlineEmpty = (inlineToken.children ?? []).length === 0;
    const skipOpen = markerInlineEmpty && tokens[inlineIdx - 1]?.type === 'paragraph_open' ? inlineIdx - 1 : -1;
    const skipClose = markerInlineEmpty && tokens[inlineIdx + 1]?.type === 'paragraph_close' ? inlineIdx + 1 : -1;

    for (let i = index + 1; i < closeIdx; i++) {
      const t = tokens[i];
      if (t.type === 'blockquote_open' || t.type === 'blockquote_close') continue;
      if (markerInlineEmpty && (i === inlineIdx || i === skipOpen || i === skipClose)) continue;
      const handler = handlers[t.type];
      if (handler) {
        handler(state, t, tokens, i);
      }
    }

    state.closeNode(); // 关闭 callout

    // 标记跳过范围：从 blockquote_open 到 blockquote_close 的所有 token
    // 当前 blockquote_open 会被返回值 true 跳过
    // 后续 token 通过 skipUntilClose 标志跳过
    parseState.skipUntilClose = true;
    parseState.skipLevel = token.level;

    return true; // 跳过 blockquote_open
  };
};

const calloutNodeSerializers: Record<string, NodeSerializer> = {
  callout(state: MarkdownSerializerState, node) {
    const type = normalizeCalloutType(node.attrs.calloutType as string);
    // C2：与 blockquote 序列化器统一（serializer.ts blockquote）——先渲染到
    // 临时 state 再逐行加 > 前缀。之前只在 renderNode 前写一次 >，代码块/数学块
    // 等多行内容的后续行没有前缀 → 产出非法 Markdown，重解析会吞掉后续内容。
    const inner = state.createChild();
    inner.renderContent(node);
    const lines = inner.output.replace(/\n$/, '').split('\n');
    state.writeLine(`> [!${type.toUpperCase()}]`);
    for (const line of lines) state.writeLine(`> ${line}`);
    state.closeBlock(node);
  },
};

export const calloutMarkdownPlugin: MarkdownSyntaxPlugin = {
  name: 'callout',
  tokenInterceptor: calloutTokenInterceptor,
  nodeSerializers: calloutNodeSerializers,
};
