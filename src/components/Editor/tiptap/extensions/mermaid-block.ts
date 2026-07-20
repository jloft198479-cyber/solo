/**
 * Mermaid 图表扩展
 *
 * 支持 ```mermaid ... ``` 代码块自动识别为 Mermaid 图表。
 * 渲染态：Mermaid SVG 图表
 * 点击：进入源码编辑模式
 */
import { Node, mergeAttributes } from '@tiptap/vue-3';
import type { Node as PMNode } from '@tiptap/pm/model';

// 异步加载 mermaid
let mermaidPromise: Promise<typeof import('mermaid')> | null = null;
function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
        securityLevel: 'loose',
      });
      return mod;
    });
  }
  return mermaidPromise;
}

/** 主题切换时重新初始化 Mermaid 并刷新所有图表 */
export async function reinitializeMermaidTheme() {
  if (!mermaidPromise) return;
  const mod = await mermaidPromise;
  const isDark = document.documentElement.classList.contains('dark');
  mod.default.initialize({
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    securityLevel: 'loose',
  });
}

// Mermaid 图表实例计数器，用于生成唯一 ID（mermaid.render 需要 DOM 唯一 id）
let mermaidCounter = 0;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// CJK 统一表意文字 + 全角标点/符号
function hasCjkOrFullwidth(text: string): boolean {
  return /[一-鿿　-〿＀-￯]/.test(text);
}

/**
 * 生成对中文用户友好的 Mermaid 错误提示。
 * 当源码含中文/全角字符且错误疑似标签解析失败时，追加引号提示——
 * mermaid 11 要求中文/特殊字符标签必须加引号，如 A["文本"]。
 */
export function buildMermaidErrorMessage(source: string, error: unknown): string {
  const msg = getErrorMessage(error);
  let text = `图表语法错误: ${msg}`;
  const looksLikeParseError = /parse error|syntax error|label|unexpected|expect/i.test(msg);
  if (looksLikeParseError && hasCjkOrFullwidth(source)) {
    text += '  💡 提示：含中文/特殊字符的标签建议加引号，如 A["文本"]';
  }
  return text;
}

export const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  isolating: true,

  addAttributes() {
    return {};
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid-block', class: 'mk-mermaid-block' }),
      0,
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'mk-mermaid-block';

      // 头部标识
      const badge = document.createElement('div');
      badge.className = 'mk-mermaid-badge';
      badge.textContent = 'mermaid';
      dom.appendChild(badge);

      // 渲染区域
      const renderDiv = document.createElement('div');
      renderDiv.className = 'mk-mermaid-render';
      dom.appendChild(renderDiv);

      // 编辑区域
      const editDiv = document.createElement('div');
      editDiv.className = 'mk-mermaid-edit';
      editDiv.style.display = 'none';

      const textarea = document.createElement('textarea');
      textarea.className = 'mk-mermaid-textarea';
      textarea.placeholder = '输入 Mermaid 图表语法...';
      editDiv.appendChild(textarea);
      dom.appendChild(editDiv);

      let isEditing = false;
      let renderVersion = 0;
      let destroyed = false;
      // 统一管理事件监听器，destroy 时一次性清理
      const eventController = new AbortController();

      async function renderMermaid(source: string) {
        const version = ++renderVersion;
        renderDiv.replaceChildren();
        if (!source.trim()) {
          const placeholder = document.createElement('span');
          placeholder.className = 'mk-mermaid-placeholder';
          placeholder.textContent = '点击输入 Mermaid 图表';
          renderDiv.appendChild(placeholder);
          return;
        }
        try {
          const mermaid = await getMermaid();
          const id = `mermaid-${++mermaidCounter}`;
          const { svg } = await mermaid.default.render(id, source);
          if (destroyed || version !== renderVersion) {
            return;
          }
          renderDiv.innerHTML = svg;
        } catch (err: unknown) {
          if (destroyed || version !== renderVersion) {
            return;
          }
          const error = document.createElement('span');
          error.className = 'mk-mermaid-error';
          error.textContent = buildMermaidErrorMessage(source, err);
          renderDiv.appendChild(error);
        }
      }

      function enterEdit() {
        if (isEditing) return;
        isEditing = true;
        textarea.value = node.textContent;
        renderDiv.style.display = 'none';
        badge.style.display = 'none';
        editDiv.style.display = 'block';
        textarea.focus();
      }

      function exitEdit() {
        if (!isEditing) return;
        isEditing = false;
        const newSource = textarea.value;
        editDiv.style.display = 'none';
        renderDiv.style.display = 'block';
        badge.style.display = 'block';

        if (typeof getPos === 'function') {
          const pos = getPos();
          if (pos != null) {
            const tr = editor.view.state.tr;
            const nodeSize = node.nodeSize;
            const from = pos + 1;
            const to = pos + nodeSize - 1;

            if (newSource) {
              tr.replaceWith(from, to, editor.view.state.schema.text(newSource));
            } else {
              tr.delete(from, to);
            }
            editor.view.dispatch(tr);
          }
        }

        renderMermaid(newSource);
      }

      renderDiv.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        enterEdit();
      }, { signal: eventController.signal });

      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        enterEdit();
      }, { signal: eventController.signal });

      textarea.addEventListener('blur', () => {
        exitEdit();
      }, { signal: eventController.signal });

      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          exitEdit();
          editor.commands.focus();
        }
      }, { signal: eventController.signal });

      // 初始渲染
      renderMermaid(node.textContent);

      return {
        dom,
        contentDOM: undefined,
        update(updatedNode: PMNode) {
          if (updatedNode.type.name !== 'mermaidBlock') return false;
          node = updatedNode;
          if (!isEditing) {
            renderMermaid(node.textContent);
          }
          return true;
        },
        stopEvent(event: Event) {
          if (isEditing) return true;
          return event.type === 'mousedown' || event.type === 'click';
        },
        ignoreMutation() {
          return true;
        },
        destroy() {
          destroyed = true;
          renderVersion += 1;
          // 清理所有事件监听器，防止内存泄漏
          eventController.abort();
        },
      };
    };
  },
});
