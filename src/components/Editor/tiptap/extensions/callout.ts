/**
 * Callout 块扩展 — 重点提示
 *
 * 语法：> [!type] 其中 type 可为 note/warning/tip/info 等
 * 参见 Obsidian callout 语法兼容。
 */
import { Node as TiptapNode, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

const VALID_TYPES = [
  'note', 'abstract', 'info', 'tip', 'success', 'question',
  'warning', 'failure', 'danger', 'bug', 'example', 'quote',
  'callout',
] as const;

export type CalloutType = (typeof VALID_TYPES)[number];

/**
 * 归一化 callout 类型。
 * 已知类型 → 标准小写；未知类型 → 原样保留（避免数据静默丢失）。
 */
export function normalizeCalloutType(type: string | null | undefined): string {
  if (!type) return 'note';
  const lower = type.toLowerCase().trim();
  if ((VALID_TYPES as readonly string[]).includes(lower)) return lower;
  return lower; // 保留未知类型，不降级
}

export const Callout = TiptapNode.create({
  name: 'callout',

  group: 'block',

  content: 'block+',

  defining: true,

  addAttributes() {
    return {
      calloutType: {
        default: 'note',
        parseHTML: (el) => normalizeCalloutType(el.getAttribute('data-callout-type')),
        renderHTML: (attrs) => ({
          'data-callout-type': (attrs.calloutType as string) || 'note',
          class: 'mk-callout',
        }),
      },
      // B10：Obsidian `> [!NOTE]+ 标题` 的标题与折叠标记，保真建模防 roundtrip 语义漂移
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-title') || '',
        renderHTML: (attrs) => (attrs.title ? { 'data-title': attrs.title as string } : {}),
      },
      fold: {
        default: null, // '+'（默认展开）| '-'（默认折叠）| null（不可折叠）
        parseHTML: (el) => {
          const v = el.getAttribute('data-fold');
          return v === '+' || v === '-' ? v : null;
        },
        renderHTML: (attrs) => (attrs.fold ? { 'data-fold': attrs.fold as string } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div.mk-callout' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const eventController = new AbortController();

      const dom = document.createElement('div');

      // header（可交互的标题按钮/输入框）
      const header = document.createElement('div');
      header.className = 'mk-callout-header';
      dom.appendChild(header);

      const titleButton = document.createElement('button');
      titleButton.type = 'button';
      titleButton.className = 'mk-callout-title-button';
      header.appendChild(titleButton);

      const titleInput = document.createElement('input');
      titleInput.className = 'mk-callout-title-input';
      titleInput.placeholder = '输入标题';
      titleInput.style.display = 'none';
      header.appendChild(titleInput);

      // body（ProseMirror 内容渲染这里）
      const body = document.createElement('div');
      body.className = 'mk-callout-body';
      dom.appendChild(body);

      // NodeView 的 DOM 不会自动应用 addAttributes 的 renderHTML（那只作用于
      // 剪贴板/HTML 序列化）——必须手动同步，否则类型配色/标题 CSS 全部失效
      const applyAttrs = (n: PMNode) => {
        dom.className = 'mk-callout';
        dom.setAttribute('data-callout-type', normalizeCalloutType(n.attrs.calloutType as string));
        const title = typeof n.attrs.title === 'string' ? n.attrs.title.trim() : '';
        if (title) dom.setAttribute('data-title', title);
        else dom.removeAttribute('data-title');
        const fold = n.attrs.fold === '+' || n.attrs.fold === '-' ? n.attrs.fold : null;
        if (fold) dom.setAttribute('data-fold', fold);
        else dom.removeAttribute('data-fold');
      };
      applyAttrs(node);

      // —— 标题编辑逻辑（就地编辑：点标题文字，原位变成输入框）——

      let isEditingTitle = false;
      // 进入编辑时屏幕上显示的那行文字（标题；无标题时是类型名顶着）。
      // 提交时若与此相同 ⇒ 可见结果零变化，不写库（见 commitTitle）
      let displayedAtEntry = '';

      function syncTitleUI() {
        if (isEditingTitle) return;
        const title = typeof node.attrs.title === 'string' ? node.attrs.title.trim() : '';
        const type = normalizeCalloutType(node.attrs.calloutType as string);
        titleButton.textContent = title || type;
      }

      function enterTitleEdit() {
        if (isEditingTitle) return;
        isEditingTitle = true;
        const title = typeof node.attrs.title === 'string' ? node.attrs.title.trim() : '';
        // 预填屏幕上看到的文字：用户点的是这行字，就该在这行字上改——
        // 无标题时头上是借来的类型名（NOTE），一并预填，而不是给个空框重打
        displayedAtEntry = title || normalizeCalloutType(node.attrs.calloutType as string);
        titleButton.style.display = 'none';
        titleInput.style.display = 'block';
        titleInput.value = displayedAtEntry;
        titleInput.focus();
        titleInput.select();
      }

      function exitTitleEdit() {
        isEditingTitle = false;
        titleInput.style.display = 'none';
        titleButton.style.display = 'inline-flex';
        syncTitleUI();
      }

      function commitTitle() {
        const next = titleInput.value.trim();
        const current = typeof node.attrs.title === 'string' ? node.attrs.title.trim() : '';
        exitTitleEdit();
        // 双守卫（对齐代码块 commitLanguage）：
        // ① 与点开时显示的文字相同 ⇒ 不写库（改了又改回；无标题时显示的是借来的
        // 类型名 NOTE——一旦写成 title=note，data-title 一挂大写徽章规矩就失效，
        // NOTE 会变小写，反而是可见的脏数据）
        // ② 与存值相同 ⇒ 不发空事务（无标题时清空预填文字失焦：title 本就是 ''）
        if (next === displayedAtEntry || next === current) return;
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (typeof pos !== 'number') return;
        // 对齐代码块 updateCodeBlockLanguage——用 ProseMirror 原生 setNodeMarkup 更新属性
        const tr = editor.view.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          title: next,
        });
        editor.view.dispatch(tr);
        editor.commands.focus();
      }

      function cancelTitleEdit() {
        exitTitleEdit();
      }

      titleButton.addEventListener(
        'click',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          enterTitleEdit();
        },
        { signal: eventController.signal },
      );

      titleInput.addEventListener(
        'blur',
        () => commitTitle(),
        { signal: eventController.signal },
      );

      titleInput.addEventListener(
        'keydown',
        (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitTitle();
            editor.commands.focus();
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            cancelTitleEdit();
            editor.commands.focus();
          }
        },
        { signal: eventController.signal },
      );

      syncTitleUI();

      return {
        dom,
        contentDOM: body,
        update(updatedNode: PMNode) {
          if (updatedNode.type !== node.type) return false;
          node = updatedNode;
          applyAttrs(updatedNode);
          syncTitleUI();
          return true;
        },
        stopEvent(event) {
          return event.target instanceof globalThis.Node && header.contains(event.target as Node);
        },
        ignoreMutation(mutation) {
          return mutation.target instanceof globalThis.Node && header.contains(mutation.target as Node);
        },
        destroy() {
          eventController.abort();
        },
      };
    };
  },
});
