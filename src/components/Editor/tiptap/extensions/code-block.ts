/**
 * 代码块扩展 — 基于 CodeBlock + 自研增量高亮插件
 *
 * 特性：
 * - 语法高亮（lowlight + highlight.js），增量更新：只重渲内容变化的代码块
 *   （原 CodeBlockLowlight 插件每事务对 old/new doc 各全文档 findChildren，
 *   且命中门控时重渲全部代码块，大文档连续打字卡顿——P4-01）
 * - 直接在渲染态编辑代码
 * - 支持语言标识
 */
import { CodeBlock } from '@tiptap/extension-code-block';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { isHeavyDocument } from '../../document-scale';
import { createCompositionTracker } from '../composition-freeze';
import { scheduleIdleRender } from './idle-render-scheduler';
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import css from 'highlight.js/lib/languages/css';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import diff from 'highlight.js/lib/languages/diff';

let lowlightInstance: ReturnType<typeof createLowlight> | null = null;

/**
 * 未标注语言的代码块，自动语言检测（highlightAuto）的字符数上限。
 *
 * 成本由「代码块**自身**规模 × 已注册语言数」决定，与文档总规模无关（2026-09-15 实测，Node）：
 * 1k 字 5ms ｜ 3k 字 10ms ｜ 6k 字 21ms ｜ 12k 字 45ms，WebView2 约 ×2~3。
 * 对照：同规模**已标注**语言的块只要 4.5ms——自动检测贵约 6×，因为它把 17 种 tokenizer 逐个跑一遍。
 * 超过上限即不高亮：它只是配色装饰，不值得让「在大代码块里敲一个字」付出几十毫秒。
 */
const AUTO_DETECT_MAX_CHARS = 3000;

/**
 * 打开时**同步**高亮的代码块数上限，其余走空闲分批补算。
 *
 * 为什么需要：按块字符上限只解决了「单个大块」，没解决「块数多」——
 * 未标注语言的块要跑 17 种 tokenizer，实测（Node）1k 字 6.6ms / 3k 字 16.6ms，
 * WebView2 约 ×2~3。一份从 AI 对话粘来的笔记常有 30~60 个未标注代码块，
 * 首屏同步跑完就是 0.3~1s 全砸在打开那一刻。
 *
 * 分批后：浏览器先画出文档与首屏代码，其余在空闲窗口逐步上色。
 * 与 mermaid / math NodeView 走的是同一套空闲调度（`scheduleIdleRender`）——
 * 高亮只是配色装饰，晚几十毫秒出现无感，但卡在打开首帧上很致命。
 *
 * ≤ 该值的文档走原路径（一次同步跑完），行为与优化前完全一致。
 */
const INITIAL_HIGHLIGHT_BLOCKS = 8;

/** 每个空闲批次补算的代码块数（与 idle-render-scheduler 的批处理粒度对齐） */
const IDLE_HIGHLIGHT_BATCH = 4;

/** 空闲批次回填装饰的元数据标记（`apply` 据此把补算结果并入 DecorationSet） */
const HIGHLIGHT_CHUNK_META = 'codeBlockHighlightChunk';

interface HighlightChunk {
  from: number;
  to: number;
  decorations: Decoration[];
}

/**
 * 懒加载 lowlight 单例（P5-04：消除模块求值与窗口显示的竞争）。
 *
 * 原 实现：模块顶层 `const lowlight = createLowlight({...})` 同步执行，
 * 在编辑器 chunk 加载时即注册 17 种 highlight.js 语言。
 * 如果 chunk 从 WebView2 缓存秒到，顶层求值会在 `window.show()` 之前的
 * IPC 间隙同步执行，挤占主线程，延迟窗口显示。
 *
 * 新实现：延迟到首次使用（createIncrementalLowlightPlugin 默认值调用）时才执行。
 * 此时窗口已显示、编辑器已创建（走 RAF 延迟初始化），不在窗口显示关键路径上。
 *
 * 17 种语言的静态 import 保留——它们是纯数据（语言语法定义对象），
 * 模块求值开销 < 5ms，不是瓶颈。重活是 createLowlight() 调用本身
 * （构建 parser、注册语法），延迟到首次使用。
 */
function getLowlight(): ReturnType<typeof createLowlight> {
  if (lowlightInstance) return lowlightInstance;
  lowlightInstance = createLowlight({
    javascript,
    typescript,
    python,
    bash,
    json,
    markdown,
    xml,
    yaml,
    sql,
    css,
    rust,
    go,
    java,
    cpp,
    php,
    ruby,
    diff,
  });
  return lowlightInstance;
}

export function normalizeCodeBlockLanguage(language: string | null | undefined): string | null {
  const normalized = language?.trim().toLowerCase() ?? '';
  return normalized || null;
}

export function getCodeBlockLanguageLabel(language: string | null | undefined): string {
  return normalizeCodeBlockLanguage(language) || 'plain text';
}

// ── 增量语法高亮（P4-01）──────────────────────────────────────────
//
// 原理：PM 文档不可变，同一 node 引用 = 内容未变。
// 插件 state 存 DecorationSet，每事务：
//   1. 未变更的代码块装饰经 tr.mapping 平移复用（O(装饰数)，无高亮计算）
//   2. 只对「变更区间命中的代码块」重新高亮（nodesBetween 只走区间子树）
// 对比原插件：不再每事务 2× 全文档 findChildren，也不再把所有代码块整体重渲。
// 注：setNodeMarkup 的属性变更走 replaceWith → ReplaceStep，step map 覆盖整个块
// 区间，变更区间检测天然命中，无需额外通知机制（曾误判为空 step map 而引入
// tr meta 方案，测试证伪后移除）。

interface HastNode {
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

interface HighlightSpan {
  text: string;
  classes: string[];
}

function parseNodes(nodes: HastNode[], className: string[] = []): HighlightSpan[] {
  return nodes.flatMap((node) => {
    const classes = [
      ...className,
      ...(Array.isArray(node.properties?.className) ? (node.properties.className as string[]) : []),
    ];
    if (node.children) return parseNodes(node.children, classes);
    return [{ text: node.value ?? '', classes }];
  });
}

function highlightBlock(
  block: PMNode,
  blockPos: number,
  defaultLanguage: string | null,
  lowlightInstance: ReturnType<typeof createLowlight>,
): Decoration[] {
  const language = normalizeCodeBlockLanguage(
    typeof block.attrs.language === 'string' ? block.attrs.language : null,
  );
  const effective = language || defaultLanguage;
  // 无语言标注时走 highlightAuto——它把 17 种语言的完整 tokenizer 逐个跑一遍，是实测热点。
  // 两道门：① **单块自身规模**超上限（真判据——成本只跟块大小有关，与文档总规模无关）；
  // ② heavy 档兜底（大文档整体让路）。命中即不建装饰；标注了语言的块走单语言路径，
  // 便宜约 6×，不受这两道门限制。
  if (!effective && (isHeavyDocument() || block.textContent.length > AUTO_DETECT_MAX_CHARS)) return [];
  const result =
    effective && lowlightInstance.registered(effective)
      ? lowlightInstance.highlight(effective, block.textContent)
      : lowlightInstance.highlightAuto(block.textContent);

  const spans = parseNodes((result.children ?? []) as HastNode[]);
  const decorations: Decoration[] = [];
  let from = blockPos + 1;
  for (const span of spans) {
    const to = from + span.text.length;
    if (span.classes.length > 0 && to > from) {
      decorations.push(Decoration.inline(from, to, { class: span.classes.join(' ') }));
    }
    from = to;
  }
  return decorations;
}

/**
 * 收集「尚未处理」的代码块（文档顺序）。
 *
 * 判定用**节点引用**而非位置：PM 文档不可变，且重建文档时复用未改动的子树
 * ⇒ 同一引用 = 同一内容。编辑过的块会拿到新引用，自动重新入队；文件切换后
 * 整篇都是新节点，也会自动重新入队——无需任何位置/代际簿记。
 * WeakSet 不持有引用，长时间会话也不会泄漏。
 */
function collectPendingBlocks(
  doc: PMNode,
  name: string,
  done: WeakSet<PMNode>,
): { node: PMNode; pos: number }[] {
  const pending: { node: PMNode; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === name && !done.has(node)) pending.push({ node, pos });
    return true;
  });
  return pending;
}

/** 高亮一批块，产出可并入 DecorationSet 的分块（带块范围，便于先清旧装饰） */
function highlightBlocks(
  blocks: { node: PMNode; pos: number }[],
  done: WeakSet<PMNode>,
  defaultLanguage: string | null,
  lowlightInstance: ReturnType<typeof createLowlight>,
): HighlightChunk[] {
  return blocks.map(({ node, pos }) => {
    done.add(node);
    return {
      from: pos,
      to: pos + node.nodeSize,
      decorations: highlightBlock(node, pos, defaultLanguage, lowlightInstance),
    };
  });
}

export function createIncrementalLowlightPlugin(
  name: string,
  defaultLanguage: string | null,
  lowlightInstance: ReturnType<typeof createLowlight> = getLowlight(),
) {
  // 组字权威信号：apply 拿不到 view，用共享登记器挂住本实例（composition-freeze）。
  // 组字期间冻结语法高亮装饰重建，避免改动正在组字的 DOM 导致 WebView2 IME 候选窗失锚变形。
  const tracker = createCompositionTracker();
  // 已处理过的代码块节点引用（含「判定为无需高亮」的），见 collectPendingBlocks
  const highlighted = new WeakSet<PMNode>();
  // 空闲补算需要 view 才能 dispatch，由 view() 建立
  let view: EditorView | null = null;
  let destroyed = false;
  let sweepQueued = false;

  /** 把一个空闲批次的高亮结果并入装饰集（元数据事务，doc 未变） */
  function runIdleSweep() {
    sweepQueued = false;
    if (destroyed || !view || view.isDestroyed) return;
    // 组字期间绝不下发新装饰：合并会 remove+add 改动正在组字的 <code> DOM，
    // 正是组字冻结要防的（见 composition-freeze 铁律：新增 decoration 必须走它）。
    // 此处**在计算之前**判定——dispatch 同步执行，其间不会有 composition 事件插入，
    // 故「判完即算、算完即发」对冻结状态是原子的。推迟到组字结束后重排。
    if (tracker.isFrozen()) {
      queueSweep();
      return;
    }
    const doc = view.state.doc;
    const pending = collectPendingBlocks(doc, name, highlighted);
    if (pending.length === 0) return;
    const chunks = highlightBlocks(
      pending.slice(0, IDLE_HIGHLIGHT_BATCH),
      highlighted,
      defaultLanguage,
      lowlightInstance,
    );
    view.dispatch(view.state.tr.setMeta(HIGHLIGHT_CHUNK_META, chunks));
    if (pending.length > IDLE_HIGHLIGHT_BATCH) queueSweep();
  }

  function queueSweep() {
    if (sweepQueued || destroyed) return;
    sweepQueued = true;
    scheduleIdleRender(runIdleSweep);
  }

  /** 把补算分块并入装饰集：先清块内旧装饰再加新的（空装饰也清，防止残留） */
  function mergeChunks(decoSet: DecorationSet, doc: PMNode, chunks: HighlightChunk[]): DecorationSet {
    let merged = decoSet;
    for (const chunk of chunks) {
      const stale = merged.find(chunk.from, chunk.to);
      if (stale.length > 0) merged = merged.remove(stale);
      if (chunk.decorations.length > 0) merged = merged.add(doc, chunk.decorations);
    }
    return merged;
  }

  // 显式注解：props.decorations 里引用 plugin 自身，无注解会形成循环推断（TS7022）
  const plugin: Plugin<DecorationSet> = new Plugin<DecorationSet>({
    key: new PluginKey('codeBlockHighlight'),
    view(editorView) {
      view = editorView;
      const untrack = tracker.track(editorView);
      // view 建立后补排一次：init 里若已有积压（块数超上限）会在此接上；
      // 无积压时任务空跑一次即退出（sweepQueued 防重复排队）
      queueSweep();
      return {
        destroy() {
          destroyed = true;
          view = null;
          untrack();
        },
      };
    },
    state: {
      init: (_, { doc }) => {
        // 打开时只同步高亮首屏量级的块（INITIAL_HIGHLIGHT_BLOCKS），其余排空闲队列。
        // 块数不超过上限时一次跑完，行为与优化前完全一致。
        const pending = collectPendingBlocks(doc, name, highlighted);
        const head = pending.slice(0, INITIAL_HIGHLIGHT_BLOCKS);
        const chunks = highlightBlocks(head, highlighted, defaultLanguage, lowlightInstance);
        if (pending.length > head.length) queueSweep();
        return DecorationSet.create(doc, chunks.flatMap((c) => c.decorations));
      },
      apply(tr: Transaction, decoSet: DecorationSet) {
        // 空闲补算回填：独立于 docChanged 分支（该事务不改文档）
        const chunks = tr.getMeta(HIGHLIGHT_CHUNK_META) as HighlightChunk[] | undefined;
        if (chunks) {
          decoSet = mergeChunks(decoSet, tr.doc, chunks);
          if (!tr.docChanged) return decoSet;
        }
        if (!tr.docChanged) return decoSet;

        const mapped = decoSet.map(tr.mapping, tr.doc);
        // 组字期间：只 map 平移已有高亮装饰跟随 doc 变化，不重建（重建会 remove+add
        // 改动组字中的 <code> DOM → WebView2 IME 候选窗失锚变形）。组字结束后
        // 首个非组字事务会带最新内容重建，高亮不会漏。
        if (tracker.isFrozen()) return mapped;
        const docSize = tr.doc.content.size;
        const affected = new Map<number, PMNode>();

        // 从各 step 的变更区间收集受影响代码块。
        // step map 给出的是「该 step 前」的坐标，统一经 tr.mapping 换算到最终文档：
        // from 用 assoc=-1（钉在插入内容之前）、to 用 assoc=+1（覆盖插入内容之后），
        // 纯插入才能得到非空区间（assoc 反向时插入会算成 from > to 而被跳过——实测踩坑）。
        for (const step of tr.steps) {
          step.getMap().forEach((fromA, toA) => {
            const from = Math.min(Math.max(tr.mapping.map(fromA, -1), 0), docSize);
            const to = Math.min(Math.max(tr.mapping.map(toA, 1), 0), docSize);
            if (to < from) return;
            tr.doc.nodesBetween(from, to, (node, pos) => {
              if (node.type.name === name) affected.set(pos, node);
              return true;
            });
          });
        }

        if (affected.size === 0) return mapped;

        // 一次事务命中过多块（典型：文件切换 = 整篇替换 ⇒ 收集到全部代码块）时，
        // 同样只同步处理首屏量级，其余交给空闲补算，避免切文档瞬间卡顿。
        const entries = [...affected.entries()];
        const head = entries.slice(0, INITIAL_HIGHLIGHT_BLOCKS);
        if (entries.length > head.length) queueSweep();

        let result = mapped;
        for (const [pos, node] of head) {
          // 相邻块的装饰不可能触碰本块边界（块间至少隔 1 个 token 位置），
          // 按块范围 find + remove 不会误删他人装饰
          const stale = result.find(pos, pos + node.nodeSize);
          if (stale.length > 0) result = result.remove(stale);
          const fresh = highlightBlock(node, pos, defaultLanguage, lowlightInstance);
          if (fresh.length > 0) result = result.add(tr.doc, fresh);
          highlighted.add(node);
        }
        return result;
      },
    },
    props: {
      decorations(state) {
        return plugin.getState(state);
      },
    },
  });
  return plugin;
}

function updateCodeBlockLanguage(
  editor: Editor,
  node: PMNode,
  getPos: (() => number | undefined) | boolean,
  language: string | null,
) {
  if (typeof getPos !== 'function') return;

  const pos = getPos();
  if (typeof pos !== 'number') return;
  const tr = editor.view.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    language,
  });
  editor.view.dispatch(tr);
}

export const CustomCodeBlock = CodeBlock.extend({
  addAttributes() {
    const parent = this.parent?.() ?? {};

    return {
      ...parent,
      languageLabel: {
        default: null,
        parseHTML: () => null,
        renderHTML: (attributes) => ({
          'data-language': getCodeBlockLanguageLabel(
            typeof attributes.language === 'string' ? attributes.language : null,
          ),
        }),
      },
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'mk-code-block-shell';

      // 统一管理事件监听器，destroy 时一次性清理（声明在前，下方监听器可立即引用）
      const eventController = new AbortController();

      const header = document.createElement('div');
      header.className = 'mk-code-block-header';
      dom.appendChild(header);

      const languageButton = document.createElement('button');
      languageButton.type = 'button';
      languageButton.className = 'mk-code-block-language-button';
      header.appendChild(languageButton);

      const languageInput = document.createElement('input');
      languageInput.className = 'mk-code-block-language-input';
      languageInput.placeholder = '输入语言';
      languageInput.style.display = 'none';
      header.appendChild(languageInput);

      // 复制按钮
      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'mk-code-block-copy-button';
      copyButton.title = '复制代码';
      copyButton.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      header.appendChild(copyButton);

      let copyTimeout: ReturnType<typeof setTimeout> | null = null;
      copyButton.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          const code = node.textContent;
          navigator.clipboard.writeText(code).then(() => {
            // 写入是异步的，本块可能已经销毁；此时再改按钮并起定时器就是泄漏
            if (eventController.signal.aborted) return;
            copyButton.classList.add('is-copied');
            copyButton.innerHTML =
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
            if (copyTimeout) clearTimeout(copyTimeout);
            copyTimeout = setTimeout(() => {
              copyButton.classList.remove('is-copied');
              copyButton.innerHTML =
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
            }, 2000);
          });
        },
        { signal: eventController.signal },
      );

      const pre = document.createElement('pre');
      pre.className = 'mk-code-block';
      dom.appendChild(pre);

      const code = document.createElement('code');
      pre.appendChild(code);

      let isEditingLanguage = false;

      function syncLanguageUI() {
        if (isEditingLanguage) return;
        const currentLanguage =
          typeof node.attrs.language === 'string' ? node.attrs.language : null;
        const label = getCodeBlockLanguageLabel(currentLanguage);
        languageButton.textContent = label;
        pre.dataset.language = label;
      }

      function enterLanguageEdit() {
        if (isEditingLanguage) return;
        isEditingLanguage = true;
        languageButton.style.display = 'none';
        languageInput.style.display = 'block';
        languageInput.value = typeof node.attrs.language === 'string' ? node.attrs.language : '';
        languageInput.focus();
        languageInput.select();
      }

      function exitLanguageEdit() {
        isEditingLanguage = false;
        languageInput.style.display = 'none';
        languageButton.style.display = 'inline-flex';
        syncLanguageUI();
      }

      function commitLanguage() {
        const nextLanguage = normalizeCodeBlockLanguage(languageInput.value);
        const currentLanguage = normalizeCodeBlockLanguage(
          typeof node.attrs.language === 'string' ? node.attrs.language : null,
        );

        exitLanguageEdit();

        if (nextLanguage === currentLanguage) return;
        updateCodeBlockLanguage(editor, node, getPos, nextLanguage);
      }

      function cancelLanguageEdit() {
        exitLanguageEdit();
      }

      languageButton.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          enterLanguageEdit();
        },
        { signal: eventController.signal },
      );

      languageInput.addEventListener(
        'blur',
        () => {
          commitLanguage();
        },
        { signal: eventController.signal },
      );

      languageInput.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitLanguage();
            editor.commands.focus();
            return;
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            cancelLanguageEdit();
            editor.commands.focus();
          }
        },
        { signal: eventController.signal },
      );

      syncLanguageUI();

      return {
        dom,
        contentDOM: code,
        update(updatedNode: PMNode) {
          if (updatedNode.type.name !== 'codeBlock') return false;
          node = updatedNode;
          syncLanguageUI();
          return true;
        },
        stopEvent(event: Event) {
          return event.target instanceof Node && header.contains(event.target);
        },
        ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }) {
          return mutation.target instanceof Node && header.contains(mutation.target);
        },
        destroy() {
          // 清理所有事件监听器与回显定时器，防止内存泄漏
          eventController.abort();
          if (copyTimeout) clearTimeout(copyTimeout);
        },
      };
    };
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      createIncrementalLowlightPlugin(this.name, this.options.defaultLanguage ?? null),
    ];
  },
}).configure({
  defaultLanguage: null,
  HTMLAttributes: {
    class: 'mk-code-block',
  },
});
