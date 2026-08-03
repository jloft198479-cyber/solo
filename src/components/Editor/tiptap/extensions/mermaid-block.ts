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

// 登记所有活跃 Mermaid NodeView，主题切换时遍历重渲。
// 背景：Mermaid SVG 颜色在渲染时固化到 inline style，主题切换后不重渲会残留旧主题色。
const mermaidNodeViews = new Set<{ rerender: () => void }>();

// ── Mermaid Lightbox：全屏放大预览（单例） ──────────────────────
// 同一时间只开一个；克隆当前已渲染 SVG（矢量无损）；支持滚轮缩放/按钮缩放/拖拽平移/Esc 关闭。
// 主题色随源 SVG（克隆的是已显示 SVG，主题切换时源会重渲，但 lightbox 已打开的不重渲——
// 这是可接受的取舍：用户放大时一般不会同时切主题）。
let lightboxState: {
  overlay: HTMLDivElement;
  svgWrap: HTMLDivElement;
  scale: number;
  tx: number;
  ty: number;
  cleanup: () => void;
} | null = null;

function closeMermaidLightbox() {
  if (!lightboxState) return;
  lightboxState.cleanup();
  lightboxState.overlay.remove();
  lightboxState = null;
}

/**
 * 打开 Mermaid 全屏放大预览。
 * @param sourceSvg 已渲染的 SVG 元素（克隆它，不动原 DOM）
 */
function openMermaidLightbox(sourceSvg: SVGSVGElement | null) {
  // 已有打开的先关掉
  if (lightboxState) closeMermaidLightbox();
  if (!sourceSvg) return;

  const overlay = document.createElement('div');
  overlay.className = 'mk-mermaid-lightbox';

  // 工具栏
  const toolbar = document.createElement('div');
  toolbar.className = 'mk-mermaid-lightbox-toolbar';
  overlay.appendChild(toolbar);

  const makeBtn = (label: string, title: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mk-mermaid-lightbox-btn';
    b.textContent = label;
    b.title = title;
    toolbar.appendChild(b);
    return b;
  };
  const zoomInBtn = makeBtn('+', '放大');
  const zoomOutBtn = makeBtn('−', '缩小');
  const resetBtn = makeBtn('1:1', '重置');
  const closeBtn = makeBtn('×', '关闭');

  // SVG 容器（居中 + 拖拽平移）
  const svgWrap = document.createElement('div');
  svgWrap.className = 'mk-mermaid-lightbox-svg';
  const clone = sourceSvg.cloneNode(true) as SVGSVGElement;
  // 克隆的 SVG 设为可见尺寸自适应，靠 transform scale 缩放
  clone.style.maxWidth = '90vw';
  clone.style.maxHeight = '80vh';
  clone.style.width = 'auto';
  clone.style.height = 'auto';
  svgWrap.appendChild(clone);
  overlay.appendChild(svgWrap);

  document.body.appendChild(overlay);

  let scale = 1;
  let tx = 0;
  let ty = 0;
  const applyTransform = () => {
    clone.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };

  const setScale = (next: number) => {
    scale = Math.max(0.2, Math.min(8, next));
    applyTransform();
  };

  // 滚轮缩放
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setScale(scale * delta);
  };
  svgWrap.addEventListener('wheel', onWheel, { passive: false });

  // 按钮缩放
  zoomInBtn.addEventListener('click', () => setScale(scale * 1.2));
  zoomOutBtn.addEventListener('click', () => setScale(scale / 1.2));
  resetBtn.addEventListener('click', () => {
    scale = 1;
    tx = 0;
    ty = 0;
    applyTransform();
  });
  closeBtn.addEventListener('click', closeMermaidLightbox);

  // 点背景关闭（点 SVG 本身不关）
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeMermaidLightbox();
  });

  // 拖拽平移
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;
  const onDown = (e: MouseEvent) => {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startTx = tx;
    startTy = ty;
    svgWrap.style.cursor = 'grabbing';
  };
  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    tx = startTx + (e.clientX - startX);
    ty = startTy + (e.clientY - startY);
    applyTransform();
  };
  const onUp = () => {
    dragging = false;
    svgWrap.style.cursor = 'grab';
  };
  svgWrap.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  svgWrap.style.cursor = 'grab';

  // Esc 关闭
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMermaidLightbox();
    }
  };
  window.addEventListener('keydown', onKey);

  lightboxState = {
    overlay,
    svgWrap,
    scale,
    tx,
    ty,
    cleanup: () => {
      svgWrap.removeEventListener('wheel', onWheel);
      svgWrap.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
    },
  };
}

/** 构造 Mermaid 初始化配置：跟随系统主题，暗色主题下显式提亮 subgraph 标题/边框 */
function buildMermaidConfig() {
  const isDark = document.documentElement.classList.contains('dark');
  return {
    startOnLoad: false,
    theme: (isDark ? 'dark' : 'default') as 'dark' | 'default',
    securityLevel: 'loose' as const,
    // 暗色主题下 subgraph 标题默认深色与背景对比度不足、边框过暗，显式提亮
    themeVariables: isDark
      ? {
          clusterBkg: 'rgba(255, 255, 255, 0.08)',
          clusterBorder: 'rgba(255, 255, 255, 0.2)',
          titleColor: '#ffffff',
        }
      : undefined,
  };
}

function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      mod.default.initialize(buildMermaidConfig());
      return mod;
    });
  }
  return mermaidPromise;
}

/** 主题切换时重新初始化 Mermaid 并刷新所有已渲染图表 */
export async function reinitializeMermaidTheme() {
  if (!mermaidPromise) return;
  const mod = await mermaidPromise;
  mod.default.initialize(buildMermaidConfig());
  // 遍历所有活跃 NodeView 重渲：SVG 颜色在渲染时固化，必须重渲才更新
  mermaidNodeViews.forEach((view) => view.rerender());
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

      // 统一管理事件监听器，destroy 时一次性清理（声明在前，下方监听器可立即引用）
      const eventController = new AbortController();

      // 头部顶栏：左侧 mermaid 标识，右侧删除按钮
      const header = document.createElement('div');
      header.className = 'mk-mermaid-header';
      dom.appendChild(header);

      const badge = document.createElement('div');
      badge.className = 'mk-mermaid-badge';
      badge.textContent = 'mermaid';
      header.appendChild(badge);

      // 删除按钮：hover 整块时显示，点击删整块
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'mk-block-delete-button';
      deleteButton.title = '删除此块';
      deleteButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      header.appendChild(deleteButton);

      // 放大按钮：hover 整块时显示，点击打开 lightbox 全屏预览。
      // 与删除按钮并列于 header 右侧（删除按钮 margin-left:auto 占满左侧空间，
      // 放大按钮紧跟其后）；SVG 点击仍为进编辑，放大走独立按钮，零冲突。
      const zoomButton = document.createElement('button');
      zoomButton.type = 'button';
      zoomButton.className = 'mk-block-zoom-button';
      zoomButton.title = '放大查看';
      zoomButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';
      header.appendChild(zoomButton);

      deleteButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof getPos === 'function') {
          const pos = getPos();
          if (pos != null) {
            const tr = editor.view.state.tr.delete(pos, pos + node.nodeSize);
            editor.view.dispatch(tr);
            editor.commands.focus();
          }
        }
      }, { signal: eventController.signal });

      // 渲染区域
      const renderDiv = document.createElement('div');
      renderDiv.className = 'mk-mermaid-render';
      dom.appendChild(renderDiv);

      // 放大按钮：克隆当前 renderDiv 内的 SVG 到全屏 lightbox。
      // 放在 renderDiv 声明后绑定，避免前向引用；编辑模式/placeholder/错误态下无 SVG，跳过。
      zoomButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const svg = renderDiv.querySelector('svg');
        if (!svg) return;
        openMermaidLightbox(svg as SVGSVGElement);
      }, { signal: eventController.signal });

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

      async function renderMermaid(source: string) {
        const version = ++renderVersion;
        // 双缓冲：不提前清空，保留旧 SVG 直到新 SVG 就绪，避免主题切换重渲时
        // 「旧 SVG → 空 → 新 SVG」的闪烁（mermaid.render 是异步，期间 DOM 会空）。
        if (!source.trim()) {
          if (destroyed || version !== renderVersion) return;
          renderDiv.replaceChildren();
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
          // 新 SVG 就绪，一次性替换旧内容（旧 SVG 保留到此刻，中间无空态）
          renderDiv.innerHTML = svg;
        } catch (err: unknown) {
          if (destroyed || version !== renderVersion) {
            return;
          }
          renderDiv.replaceChildren();
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
        header.style.display = 'none';
        editDiv.style.display = 'block';
        textarea.focus();
      }

      function exitEdit() {
        if (!isEditing) return;
        isEditing = false;
        const newSource = textarea.value;
        editDiv.style.display = 'none';
        renderDiv.style.display = 'block';
        header.style.display = 'flex';

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
          return;
        }
        // Mod+Backspace 删除整个 mermaid 块。
        // 背景：本节点 isolating:true + contentDOM:undefined，标准 Backspace
        // 在块外不会删块、块内 textarea 又是原生 DOM，没有删除入口——
        // 用 Mod+Backspace 作为显式删除快捷键。
        if ((e.metaKey || e.ctrlKey) && e.key === 'Backspace') {
          e.preventDefault();
          if (typeof getPos === 'function') {
            const pos = getPos();
            if (pos != null) {
              const tr = editor.view.state.tr.delete(pos, pos + node.nodeSize);
              editor.view.dispatch(tr);
              editor.commands.focus();
            }
          }
        }
      }, { signal: eventController.signal });

      // 初始渲染
      renderMermaid(node.textContent);

      // 登记到全局 Set，供 reinitializeMermaidTheme 主题切换时重渲
      const handle = {
        rerender: () => {
          // 编辑模式下不打断用户输入；已销毁的实例跳过
          if (!destroyed && !isEditing) renderMermaid(node.textContent);
        },
      };
      mermaidNodeViews.add(handle);

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
          // 从全局 Set 移除，防止主题切换时对已销毁实例重渲
          mermaidNodeViews.delete(handle);
          // 若 lightbox 正显示本块的 SVG，先关掉，防止悬挂
          if (lightboxState) closeMermaidLightbox();
          // 清理所有事件监听器，防止内存泄漏
          eventController.abort();
        },
      };
    };
  },
});
