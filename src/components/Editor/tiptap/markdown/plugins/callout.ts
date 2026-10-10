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
import { stripZwnj } from '../../zwnj';

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
 * callout 头部信息（B10：Obsidian `> [!NOTE]+ 标题` 的折叠标记与标题建模）
 */
interface CalloutHead {
  /** '+' 默认展开 / '-' 默认折叠 / null 不可折叠 */
  fold: '+' | '-' | null;
  /** marker 行剩余文本作为标题（纯文本；含 inline 格式的标题保守不提取，保持正文） */
  title: string;
}

/**
 * 从 inline token 的 children 中剥离 [!TYPE] 前缀及紧跟的换行，
 * 并提取折叠标记/标题（B10：`+ 标题` 不再混入正文段落）。
 * 折叠标记按 Obsidian 语义须紧跟 `]`；标题为 marker 行剩余文本，
 * 占满 marker 行时移除该 text token 及紧跟的 softbreak。
 */
function stripCalloutMarker(inlineToken: Token): CalloutHead {
  const head: CalloutHead = { fold: null, title: '' };
  if (!inlineToken.children || inlineToken.children.length === 0) return head;

  const firstChild = inlineToken.children[0];
  if (firstChild.type !== 'text') return head;

  // 完整形态：[!TYPE] + 可选折叠标记（紧跟 ]）+ 可选标题（行内剩余文本）
  const m = firstChild.content.match(/^\[![A-Za-z]+\]([+-]?)([ \t]*)(.*)$/);
  if (!m) return head;

  const [, foldRaw, , rest] = m;
  if (foldRaw || rest.trim()) {
    head.fold = foldRaw === '+' || foldRaw === '-' ? foldRaw : null;
    head.title = rest.trim();
    // 标题占满 marker 行：移除该 text token 及紧跟的 softbreak（有正文时）
    inlineToken.children.splice(0, 1);
    if (inlineToken.children.length > 0 && inlineToken.children[0].type === 'softbreak') {
      inlineToken.children.splice(0, 1);
    }
    return head;
  }

  // marker 独占行（] 后无内容）→ 剥离后为空，移除该 token 与 softbreak
  firstChild.content = '';
  inlineToken.children.splice(0, 1);
  if (inlineToken.children.length > 0 && inlineToken.children[0].type === 'softbreak') {
    inlineToken.children.splice(0, 1);
  }
  return head;
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

  // 命名以便**自递归**：嵌套 blockquote 也要先过一遍本拦截器，否则内层 callout
  // 会被当成普通引用、`[!TIP]` 退化成字面量（台账 §二 #49 的 N5）。
  const interceptor: TokenInterceptor = (
    state: MarkdownParseState,
    token: Token,
    tokens: Token[],
    index: number,
  ): boolean => {
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

    // 向前查找 callout 自己那一层的首个 inline token
    let inlineIdx = -1;
    let closeIdx = -1;
    let nestedQuoteBeforeMarker = false;
    for (let i = index + 1; i < tokens.length; i++) {
      const t = tokens[i];
      // 标记必须出现在**本引用自己的首个段落**里：`> > [!NOTE]` 的外层是普通引用，
      // `[!TYPE]` 属于内层。若在找到标记前先遇到嵌套 `blockquote_open`，说明本层不是
      // callout ⇒ 交回主循环按普通引用处理（随后内层会作为 callout 再次进入本拦截器）。
      if (t.type === 'blockquote_open' && inlineIdx === -1) nestedQuoteBeforeMarker = true;
      if (t.type === 'inline' && inlineIdx === -1) {
        inlineIdx = i;
      }
      if (t.type === 'blockquote_close' && t.level === token.level) {
        closeIdx = i;
        break;
      }
    }

    if (inlineIdx === -1 || closeIdx === -1) return false;
    if (nestedQuoteBeforeMarker) return false;

    const inlineToken = tokens[inlineIdx];
    const calloutType = matchCalloutMarker(inlineToken);
    if (!calloutType) return false;

    // 这是 callout blockquote — 剥离 marker 前缀并提取折叠标记/标题（B10）
    const head = stripCalloutMarker(inlineToken);

    // 打开 callout 节点
    state.openNode(schema.nodes.callout, {
      calloutType: normalizeCalloutType(calloutType),
      title: head.title,
      fold: head.fold,
    });

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
      // 只跳过**本 callout 自己那一对** blockquote（level 相同）；嵌套引用
      // （level 更深）正常下发给 handlers → 在 callout 内建出真 blockquote。
      // 旧实现无条件跳过所有 blockquote open/close ⇒ callout 里的二层引用静默塌成段落。
      if (
        (t.type === 'blockquote_open' || t.type === 'blockquote_close') &&
        t.level === token.level
      ) {
        continue;
      }
      if (markerInlineEmpty && (i === inlineIdx || i === skipOpen || i === skipClose)) continue;
      // 嵌套 blockquote：**先过一遍本拦截器**（递归）——它可能自己就是一个 callout
      // （`> [!NOTE]` 里套 `> > [!TIP]`）。旧实现直接下发给 handlers ⇒ 内层一律变成
      // 普通引用，marker 不剥离、`[!TIP]` 退化成字面量 `\[!TIP]`（台账 §二 #49）。
      // 递归命中后必须**整段跳过**到内层的 blockquote_close：那段 token 已在递归里
      // 被消费过，不跳会重复处理。
      if (t.type === 'blockquote_open' && interceptor(state, t, tokens, i)) {
        let nestedClose = closeIdx;
        for (let j = i + 1; j < closeIdx; j++) {
          if (tokens[j].type === 'blockquote_close' && tokens[j].level === t.level) {
            nestedClose = j;
            break;
          }
        }
        i = nestedClose;
        continue;
      }
      const handler = handlers[t.type];
      if (handler) {
        handler(state, t, tokens, i);
      }
    }

    state.closeNode(schema.nodes.callout); // 关闭 callout（带期望类型：迟到/错位的 close 安全落空）

    // 标记跳过范围：从 blockquote_open 到 blockquote_close 的所有 token
    // 当前 blockquote_open 会被返回值 true 跳过
    // 后续 token 通过 skipUntilClose 标志跳过
    parseState.skipUntilClose = true;
    parseState.skipLevel = token.level;

    return true; // 跳过 blockquote_open
  };

  return interceptor;
};

const calloutNodeSerializers: Record<string, NodeSerializer> = {
  callout(state: MarkdownSerializerState, node) {
    const type = normalizeCalloutType(node.attrs.calloutType as string);
    // B10：折叠标记与标题回写（`> [!NOTE]+ 标题`），roundtrip 保 Obsidian 语义
    const fold = node.attrs.fold === '+' || node.attrs.fold === '-' ? node.attrs.fold : '';
    // stripZwnj：title 走属性通道（不经过 escapeInline）。⚠️ 2026-10-10 实测这是
    // **当下就触发**的落点（不是潜在）：`> [!note] 甲，**乙`（未闭合 ** + 标点）的
    // title 会带 ZWNJ 并落盘（台账 §二 #32 / 敏感区 #23④）；此处剥一次即覆盖 :200 写出点
    const title =
      typeof node.attrs.title === 'string' ? stripZwnj(node.attrs.title.trim()) : '';
    // C2：与 blockquote 序列化器统一（serializer.ts blockquote）——先渲染到
    // 临时 state 再逐行加 > 前缀。之前只在 renderNode 前写一次 >，代码块/数学块
    // 等多行内容的后续行没有前缀 → 产出非法 Markdown，重解析会吞掉后续内容。
    const inner = state.createChild();
    inner.renderContent(node);
    const lines = inner.output.replace(/\n$/, '').split('\n');
    state.writeLine(`> [!${type.toUpperCase()}]${fold}${title ? ` ${title}` : ''}`);
    // B10：空行输出 > 不带尾随空格（字节干净）
    for (const line of lines) state.writeLine(line ? `> ${line}` : '>');
    state.closeBlock(node);
  },
};

export const calloutMarkdownPlugin: MarkdownSyntaxPlugin = {
  name: 'callout',
  tokenInterceptor: calloutTokenInterceptor,
  nodeSerializers: calloutNodeSerializers,
};
