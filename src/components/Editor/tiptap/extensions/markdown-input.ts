/**
 * 统一 Markdown 输入引擎
 *
 * 编辑器走纯 WYSIWYG：markdown 标记输入即转换为真实 marks/节点，不以字面文本停留。
 * 行内标记（bold/italic/strike/code/highlight/sup/sub）与标题（heading）的转换，
 * 全部由**这一个**插件、**一份** composition 状态驱动，杜绝多插件抢 composition
 * 状态的竞态（这正是历史上行内标记在 IME 下失效的根因）。
 *
 * 三类转换：
 *
 *   1. 行内标记 —— 路径 A：StarterKit/Highlight/sub-sup/wikilink 各自的原生
 *      input rules 负责非 IME 即时转换；路径 B：本插件在非 composition 的文档变更后、
 *      以及 compositionend 收尾时扫描光标前文本兜底转换（覆盖「标记被 IME 一次性提交」）。
 *
 *   2. 标题（pending heading）—— 输入 `# 文字` 时段落保持 paragraph、用 CSS 装饰
 *      模拟标题外观；等输入稳定（非 composition、settle 之后）再转换为真正的 heading。
 *      绝不在空 heading 上让 IME composition 发生，从根本上规避 readDOMChange 错位。
 *
 *   3. 块级 —— 数学块（$$）、Mermaid（```mermaid）的 input rules。
 */
import { Extension, InputRule } from '@tiptap/vue-3';
import { inputRegex as highlightInputRegex } from '@tiptap/extension-highlight';
import {
  starInputRegex as boldStarInputRegex,
  underscoreInputRegex as boldUnderscoreInputRegex,
} from '@tiptap/extension-bold';
import {
  starInputRegex as italicStarInputRegex,
  underscoreInputRegex as italicUnderscoreInputRegex,
} from '@tiptap/extension-italic';
import { inputRegex as strikeInputRegex } from '@tiptap/extension-strike';
import { inputRegexMatch as codeInputRegexMatch } from '@tiptap/extension-code';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { MarkType, Node as PMNode, NodeType } from '@tiptap/pm/model';

// 输入法上屏后等待 DOM/composition 稳定再扫描的延迟（毫秒）。
const IME_SETTLE_DELAY_MS = 50;
// 非 IME 文本输入后，等待停顿再把 pending heading 转成真正 heading 的延迟（毫秒）。
const TEXT_SETTLE_DELAY_MS = 300;
const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
const markdownInputPluginKey = new PluginKey<MarkdownInputState>('markdownInput');

type MarkdownInputState = {
  composing: boolean;
  forceCheck: boolean;
  suppressUntil: number;
  /** pending heading 装饰集，随事务增量维护（P4-02） */
  decorations: DecorationSet;
};

type PendingHeading = {
  level: number;
  paragraphPos: number;
  prefixLength: number;
};

type Matcher =
  | RegExp
  | ((text: string) => { index: number; text: string; replaceWith?: string } | null);

type InlineMarkCandidate = {
  name: string;
  finder: Matcher;
};

type InlineMatch = {
  markType: MarkType;
  fullStart: number;
  fullEnd: number;
  openingStart: number;
  innerStart: number;
  innerText: string;
};

const inlineMarkCandidates: InlineMarkCandidate[] = [
  { name: 'code', finder: codeInputRegexMatch },
  { name: 'bold', finder: boldStarInputRegex },
  { name: 'bold', finder: boldUnderscoreInputRegex },
  { name: 'strike', finder: strikeInputRegex },
  { name: 'highlight', finder: highlightInputRegex },
  { name: 'italic', finder: italicStarInputRegex },
  { name: 'italic', finder: italicUnderscoreInputRegex },
  { name: 'superscript', finder: /\^([^^]+)\^$/ },
  { name: 'subscript', finder: /(?<!~)~([^~]+)~$/ },
];

// ── 块级 input rules（数学块、Mermaid）──────────────────────────

/** 输入 $$ 并换行时，创建数学公式块 */
function mathBlockInputRule() {
  return new InputRule({
    find: /^\$\$\s$/,
    handler: ({ state, range }) => {
      const mathBlockType = state.schema.nodes.mathBlock;
      if (!mathBlockType) return;
      const tr = state.tr.delete(range.from, range.to);
      tr.replaceSelectionWith(mathBlockType.create());
    },
  });
}

/** 输入 ```mermaid 并换行时，创建 Mermaid 块 */
function mermaidInputRule() {
  return new InputRule({
    find: /^```mermaid\s$/,
    handler: ({ state, range }) => {
      const mermaidBlockType = state.schema.nodes.mermaidBlock;
      if (!mermaidBlockType) return;
      const tr = state.tr.delete(range.from, range.to);
      tr.replaceSelectionWith(mermaidBlockType.create());
    },
  });
}

export const MarkdownInput = Extension.create({
  name: 'markdownInput',

  addInputRules() {
    return [mathBlockInputRule(), mermaidInputRule()];
  },

  addProseMirrorPlugins() {
    return [markdownInputPlugin()];
  },
});

// 测试基建：导出插件工厂、PluginKey 与状态类型，供 IME/输入编排回归测试驱动
// 状态机（用 meta 事务模拟 compositionstart/end、用 fake timers 推进 Date.now/setTimeout）。
// 仅为可测性增加的 additive export，不改变任何运行时行为或分支。
export { markdownInputPlugin, markdownInputPluginKey };
export type { MarkdownInputState };

function markdownInputPlugin(): Plugin<MarkdownInputState> {
  return new Plugin<MarkdownInputState>({
    key: markdownInputPluginKey,

    state: {
      init(_, { doc }) {
        return {
          composing: false,
          forceCheck: false,
          suppressUntil: 0,
          decorations: buildPendingHeadingDecorations(doc),
        };
      },
      apply(tr, value) {
        // 增量维护 pending heading 装饰：mapped 平移复用 + 只重算变更区间内块。
        // 原实现 props.decorations 每次 doc 变化全文档 descendants 重建（P4-02）。
        const decorations = tr.docChanged
          ? updatePendingDecorations(tr, value.decorations)
          : value.decorations;
        const meta = tr.getMeta(markdownInputPluginKey) as Partial<MarkdownInputState> | undefined;
        if (!meta) {
          return { ...value, decorations, forceCheck: false };
        }
        return {
          composing: meta.composing ?? value.composing,
          forceCheck: meta.forceCheck ?? false,
          suppressUntil: meta.suppressUntil ?? value.suppressUntil,
          decorations,
        };
      },
    },

    view() {
      let checkTimer: number | null = null;

      function clearCheckTimer() {
        if (checkTimer == null) return;
        window.clearTimeout(checkTimer);
        checkTimer = null;
      }

      function scheduleCheck(view: EditorView, delay: number) {
        clearCheckTimer();
        checkTimer = window.setTimeout(() => {
          checkTimer = null;
          if (view.isDestroyed) return;
          setMarkdownInputState(view, {
            composing: false,
            forceCheck: true,
            suppressUntil: 0,
          });
        }, delay);
      }

      return {
        // 非 IME 文本输入后，pending heading 需要在停顿后转成真正 heading。
        // composition 路径由 compositionend 自己安排 forceCheck，这里只管非 IME。
        update(view, previousState) {
          if (view.state.doc.eq(previousState.doc)) return;

          const pluginState = markdownInputPluginKey.getState(view.state);
          if (pluginState?.composing) {
            clearCheckTimer();
            return;
          }

          // 装饰集非空 = 存在 pending heading（每段至少 1 条节点装饰）。
          // 原实现这里 findPendingHeading 全文档遍历（P4-02）。
          if (!pluginState || pluginState.decorations.find().length === 0) {
            clearCheckTimer();
            return;
          }

          const now = Date.now();
          if (pluginState && pluginState.suppressUntil > now) {
            scheduleCheck(view, pluginState.suppressUntil - now);
            return;
          }

          scheduleCheck(view, TEXT_SETTLE_DELAY_MS);
        },

        destroy() {
          clearCheckTimer();
        },
      };
    },

    props: {
      handleDOMEvents: {
        compositionstart(view) {
          setMarkdownInputState(view, {
            composing: true,
            forceCheck: false,
            suppressUntil: Number.POSITIVE_INFINITY,
          });
          return false;
        },
        compositionend(view) {
          const suppressUntil = Date.now() + IME_SETTLE_DELAY_MS;
          setMarkdownInputState(view, {
            composing: false,
            forceCheck: false,
            suppressUntil,
          });
          // 上屏后等 DOM/composition 稳定，再强制扫描一次（覆盖行内标记与标题）。
          window.setTimeout(() => {
            if (view.isDestroyed) return;
            setMarkdownInputState(view, {
              composing: false,
              forceCheck: true,
              suppressUntil: 0,
            });
          }, IME_SETTLE_DELAY_MS);
          return false;
        },
      },

      decorations(state) {
        return markdownInputPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },

    appendTransaction(transactions, _oldState, newState) {
      const pluginState = markdownInputPluginKey.getState(newState);
      if (pluginState?.composing) return null;
      if (pluginState && pluginState.suppressUntil > Date.now()) return null;

      const docChanged = transactions.some((tr) => tr.docChanged);
      if (!docChanged && !pluginState?.forceCheck) return null;

      // 查找空 heading / pending heading：
      // - forceCheck（settle 兜底）：全文档扫描，低频、正确性优先
      // - 普通 docChanged：只扫最后一个变更事务的变更区间（P4-02 增量，
      //   多变更事务的中间区间漏检由 forceCheck 兜底——正常输入单事务）
      let emptyHeading: { pos: number; level: number } | null = null;
      let pendingHeading: PendingHeading | null = null;
      if (pluginState?.forceCheck) {
        ({ emptyHeading, pendingHeading } = scanHeadings(newState.doc));
      } else {
        let changedTr: Transaction | null = null;
        for (const tr of transactions) if (tr.docChanged) changedTr = tr;
        if (changedTr) {
          ({ emptyHeading, pendingHeading } = scanChangedRanges(changedTr, newState.doc));
        }
      }

      // 1. 空 heading 被删空 → 退回 pending heading（恢复 `# ` 前缀）。
      if (docChanged && emptyHeading) {
        const level = emptyHeading.level;
        const prefix = '#'.repeat(level) + ' ';
        const paragraphType = newState.schema.nodes.paragraph;
        if (paragraphType) {
          const node = newState.doc.nodeAt(emptyHeading.pos);
          if (node) {
            const tr = newState.tr;
            tr.setBlockType(emptyHeading.pos, emptyHeading.pos + node.nodeSize, paragraphType);
            tr.insertText(prefix, emptyHeading.pos + 1);
            if (tr.docChanged) return tr;
          }
        }
      }

      // 2. pending heading → 真正 heading
      if (pendingHeading) {
        const heading = convertPendingHeading(
          newState.tr,
          newState.doc,
          newState.schema.nodes.heading,
          pendingHeading,
        );
        if (heading) return heading;
      }

      // 3. 行内标记：非 composition 文档变更即转换（即时），forceCheck 收尾兜底。
      const marks = convertPendingInlineMarks(newState.tr, newState);
      if (marks) return marks;

      // 4. 链接直输 [文字](url)：带 href attr，单独处理（同一兜底路径，覆盖 IME）。
      const link = convertPendingLink(newState.tr, newState);
      if (link) return link;

      return null;
    },
  });
}

function setMarkdownInputState(view: EditorView, state: Partial<MarkdownInputState>) {
  view.dispatch(view.state.tr.setMeta(markdownInputPluginKey, state));
}

// ── 行内标记转换 ──────────────────────────────────────────────

function matchInlineSyntax(
  textBeforeCursor: string,
  markType: MarkType,
  finder: Matcher,
): InlineMatch | null {
  if (typeof finder === 'function') {
    const result = finder(textBeforeCursor);
    if (!result) return null;

    const innerText = result.replaceWith ?? result.text;
    if (!innerText) return null;

    return {
      markType,
      fullStart: result.index,
      fullEnd: result.index + result.text.length,
      openingStart: result.index,
      innerStart: result.index + result.text.indexOf(innerText),
      innerText,
    };
  }

  const result = finder.exec(textBeforeCursor);
  if (!result) return null;

  const innerText = result[result.length - 1];
  if (!innerText) return null;

  const fullStart = result.index ?? textBeforeCursor.length - result[0].length;
  const fullMatch = result[0];
  const leadingOffset = fullMatch.search(/\S/);

  return {
    markType,
    fullStart,
    fullEnd: fullStart + fullMatch.length,
    openingStart: fullStart + Math.max(0, leadingOffset),
    innerStart: fullStart + fullMatch.lastIndexOf(innerText),
    innerText,
  };
}

function findPendingInlineMark(state: EditorState): InlineMatch | null {
  const { selection, schema } = state;
  const { $cursor } = selection as TextSelection;
  if (!$cursor) return null;

  const parent = $cursor.parent;
  if (!parent.isTextblock || parent.type.spec.code) return null;

  const textBeforeCursor = parent.textBetween(0, $cursor.parentOffset, undefined, '￼');
  if (!textBeforeCursor) return null;

  for (const candidate of inlineMarkCandidates) {
    const markType = schema.marks[candidate.name];
    if (!markType) continue;

    const match = matchInlineSyntax(textBeforeCursor, markType, candidate.finder);
    if (match) return match;
  }

  return null;
}

export function convertPendingInlineMarks(tr: Transaction, state: EditorState): Transaction | null {
  const { selection } = state;
  const { $cursor } = selection as TextSelection;
  if (!$cursor) return null;

  const match = findPendingInlineMark(state);
  if (!match) return null;

  const parentStart = $cursor.start();
  const openingStart = parentStart + match.openingStart;
  const innerStart = parentStart + match.innerStart;
  const innerEnd = innerStart + match.innerText.length;
  const closingEnd = parentStart + match.fullEnd;

  if (match.innerText.length === 0) return null;
  if (openingStart > innerStart || innerEnd > closingEnd) return null;

  tr.delete(innerEnd, closingEnd);
  tr.delete(openingStart, innerStart);
  tr.addMark(openingStart, openingStart + match.innerText.length, match.markType.create());
  tr.removeStoredMark(match.markType);

  return tr.steps.length ? tr : null;
}

// ── 链接直输 [文字](url) ───────────────────────────────────────

// 链接文本不含 `]`/换行且非空；URL 不含空白与括号且非空；锚定在光标前文本末尾。
const linkInputRegex = /\[([^\]\n]+)\]\(([^()\s]+)\)$/;

/**
 * 光标前文本以 `[文字](url)` 结尾时，转换为 link mark（href=url）。
 *
 * 与 convertPendingInlineMarks 同构（删闭合、删开头、加 mark），但 link 带 href
 * 属性、结构特殊，故单列。非 IME 即时转换、IME 经 compositionend 的 forceCheck 兜底。
 */
export function convertPendingLink(tr: Transaction, state: EditorState): Transaction | null {
  const linkType = state.schema.marks.link;
  if (!linkType) return null;

  const { $cursor } = state.selection as TextSelection;
  if (!$cursor) return null;

  const parent = $cursor.parent;
  if (!parent.isTextblock || parent.type.spec.code) return null;

  const textBeforeCursor = parent.textBetween(0, $cursor.parentOffset, undefined, '￼');
  const match = linkInputRegex.exec(textBeforeCursor);
  if (!match) return null;

  const linkText = match[1];
  const href = match[2];
  if (!linkText || !href) return null;

  const parentStart = $cursor.start();
  const openBracketPos = parentStart + (textBeforeCursor.length - match[0].length);
  const textStart = openBracketPos + 1;
  const textEnd = textStart + linkText.length;
  const closeEnd = openBracketPos + match[0].length;

  tr.delete(textEnd, closeEnd); // 删 `](url)`
  tr.delete(openBracketPos, textStart); // 删 `[`
  tr.addMark(openBracketPos, openBracketPos + linkText.length, linkType.create({ href }));
  tr.removeStoredMark(linkType);

  return tr.steps.length ? tr : null;
}

// ── 标题（pending heading）转换 ────────────────────────────────

/**
 * 单次遍历同时查找：
 * - 空 heading（需退回 pending paragraph）
 * - pending heading（# 前缀的 paragraph，需转成真正 heading）
 *
 * 合并原 findPendingHeading + revertEmptyHeading 的两次全量 descendants 遍历。
 * 优先级：空 heading 优先（先恢复再转换，避免互踩）。
 */
// doc 级扫描缓存：doc 引用不变即内容不变，WeakMap 不阻止 doc 被 GC
const _scanCache = new WeakMap<
  PMNode,
  {
    emptyHeading: { pos: number; level: number } | null;
    pendingHeading: PendingHeading | null;
  }
>();

function scanHeadings(doc: PMNode): {
  emptyHeading: { pos: number; level: number } | null;
  pendingHeading: PendingHeading | null;
} {
  const cached = _scanCache.get(doc);
  if (cached) return cached;

  let emptyHeading: { pos: number; level: number } | null = null;
  let pendingHeading: PendingHeading | null = null;

  doc.descendants((node, pos) => {
    // 找到其一即可停止深层遍历
    if (emptyHeading || pendingHeading) return false;

    if (node.type.name === 'heading') {
      if (node.content.size > 0) return true;
      const level = node.attrs.level as number;
      if (!HEADING_LEVELS.includes(level as (typeof HEADING_LEVELS)[number])) return true;
      emptyHeading = { pos, level };
      return false;
    }

    if (node.type.name === 'paragraph') {
      const match = /^(#{1,6})\s\S/.exec(node.textContent);
      if (!match) return false;
      pendingHeading = {
        level: match[1].length,
        paragraphPos: pos,
        prefixLength: match[1].length + 1,
      };
      return false;
    }

    return true;
  });

  const result = { emptyHeading, pendingHeading };
  _scanCache.set(doc, result);
  return result;
}

/**
 * 增量版标题扫描（P4-02）：只扫 [from, to) 区间内与区间相交的块
 * （nodesBetween 语义：起点 < to 且 结束 > from），判定与 scanHeadings 一致。
 */
function scanHeadingsInRange(
  doc: PMNode,
  from: number,
  to: number,
): { emptyHeading: { pos: number; level: number } | null; pendingHeading: PendingHeading | null } {
  let emptyHeading: { pos: number; level: number } | null = null;
  let pendingHeading: PendingHeading | null = null;

  doc.nodesBetween(from, to, (node, pos) => {
    if (emptyHeading || pendingHeading) return false;

    if (node.type.name === 'heading') {
      if (node.content.size > 0) return true;
      const level = node.attrs.level as number;
      if (!HEADING_LEVELS.includes(level as (typeof HEADING_LEVELS)[number])) return true;
      emptyHeading = { pos, level };
      return false;
    }

    if (node.type.name === 'paragraph') {
      const match = /^(#{1,6})\s\S/.exec(node.textContent);
      if (!match) return false;
      pendingHeading = {
        level: match[1].length,
        paragraphPos: pos,
        prefixLength: match[1].length + 1,
      };
      return false;
    }

    return true;
  });

  return { emptyHeading, pendingHeading };
}

/**
 * 把事务各 step 的变更区间换算到最终文档坐标后做增量标题扫描。
 * 坐标换算与 updatePendingDecorations 同款（from 钉前、to 钉后，纯插入才非空）。
 */
function scanChangedRanges(
  tr: Transaction,
  doc: PMNode,
): { emptyHeading: { pos: number; level: number } | null; pendingHeading: PendingHeading | null } {
  const docSize = doc.content.size;
  let emptyHeading: { pos: number; level: number } | null = null;
  let pendingHeading: PendingHeading | null = null;

  for (const step of tr.steps) {
    if (emptyHeading && pendingHeading) break;
    step.getMap().forEach((fromA, toA) => {
      if (emptyHeading && pendingHeading) return;
      const from = Math.min(Math.max(tr.mapping.map(fromA, -1), 0), docSize);
      const to = Math.min(Math.max(tr.mapping.map(toA, 1), 0), docSize);
      if (to < from) return;
      const result = scanHeadingsInRange(doc, from, to);
      if (result.emptyHeading) emptyHeading = result.emptyHeading;
      if (result.pendingHeading) pendingHeading = result.pendingHeading;
    });
  }

  return { emptyHeading, pendingHeading };
}

/**
 * 空 heading 被删空时，转回 paragraph 并恢复 `# ` 前缀，让 pending 机制重新接管，
 * 规避空 heading 上的 IME composition 错位。
 */
export function revertEmptyHeading(tr: Transaction, doc: PMNode): Transaction | null {
  const { emptyHeading } = scanHeadings(doc);
  if (!emptyHeading) return null;

  const { pos, level } = emptyHeading;
  const prefix = '#'.repeat(level) + ' ';
  const paragraphType = doc.type.schema.nodes.paragraph;
  if (!paragraphType) return null;

  const node = doc.nodeAt(pos);
  if (!node) return null;
  tr.setBlockType(pos, pos + node.nodeSize, paragraphType);
  tr.insertText(prefix, pos + 1);

  return tr.docChanged ? tr : null;
}

function findPendingHeading(doc: PMNode): PendingHeading | null {
  return scanHeadings(doc).pendingHeading;
}

export function convertPendingHeading(
  tr: Transaction,
  doc: PMNode,
  headingType: NodeType | undefined,
  pending?: PendingHeading | null,
): Transaction | null {
  if (!headingType) return null;

  if (pending === undefined) {
    pending = findPendingHeading(doc);
  }
  if (!pending || !HEADING_LEVELS.includes(pending.level as (typeof HEADING_LEVELS)[number])) {
    return null;
  }

  const contentPos = pending.paragraphPos + 1;

  tr.delete(contentPos, contentPos + pending.prefixLength);
  tr.setBlockType(contentPos, contentPos, headingType, { level: pending.level });

  return tr.docChanged ? tr : null;
}

/** 为单个 pending heading 段落构建装饰（node + 行内前缀各一条）。 */
function buildParagraphPendingDecorations(
  node: PMNode,
  pos: number,
  match: RegExpExecArray,
): Decoration[] {
  const level = match[1].length;
  return [
    Decoration.node(pos, pos + node.nodeSize, {
      class: `mk-pending-heading mk-pending-heading-${level}`,
      'data-pending-heading-level': `H${level}`,
    }),
    Decoration.inline(pos + 1, pos + 1 + match[0].length, {
      class: 'mk-pending-heading-prefix',
    }),
  ];
}

/** 首次加载：全文档构建 pending heading 装饰（一次性，后续由 updatePendingDecorations 增量维护）。 */
function buildPendingHeadingDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return true;

    const match = /^(#{1,6})\s/.exec(node.textContent);
    if (!match) return true;

    decorations.push(...buildParagraphPendingDecorations(node, pos, match));
    return true;
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * 增量维护 pending heading 装饰（P4-02）。
 * mapped 平移未变更段的装饰；只对变更区间内 textblock 重新评估：
 * 先移除该块范围内旧装饰（防 setBlockType 等类型变更残留），
 * 仅当其为匹配的 paragraph 时重建装饰。亚线性，无全文档遍历。
 */
function updatePendingDecorations(tr: Transaction, decoSet: DecorationSet): DecorationSet {
  const mapped = decoSet.map(tr.mapping, tr.doc);
  const docSize = tr.doc.content.size;
  const touched = new Set<number>();
  let result = mapped;

  for (const step of tr.steps) {
    step.getMap().forEach((fromA, toA) => {
      const from = Math.min(Math.max(tr.mapping.map(fromA, -1), 0), docSize);
      const to = Math.min(Math.max(tr.mapping.map(toA, 1), 0), docSize);
      if (to < from) return;
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) return true;
        if (touched.has(pos)) return false;
        touched.add(pos);

        // find 的相交判定是闭区间（span.to >= start），会把「结束位置恰好等于
        // 本块起点」的相邻 node 装饰误捞进来，必须过滤到完全落在块范围内。
        const stale = result
          .find(pos, pos + node.nodeSize)
          .filter((d) => d.from >= pos && d.to <= pos + node.nodeSize);
        if (stale.length > 0) result = result.remove(stale);

        if (node.type.name === 'paragraph') {
          const match = /^(#{1,6})\s/.exec(node.textContent);
          if (match) result = result.add(tr.doc, buildParagraphPendingDecorations(node, pos, match));
        }
        return false;
      });
    });
  }
  return result;
}
