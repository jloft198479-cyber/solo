/**
 * 整篇文档 → 对外 HTML 的**唯一出口**（CP-20261011-002）。
 *
 * 存在的意义是消掉「两个 HTML 生产者」：以前 Ctrl+C 走 ProseMirror 的 `DOMSerializer`，
 * 「复制全文」按钮另走一遍 `markdown → markdown-it → HTML`，两套装配清单必然漂移（台账 §二
 * #16 ③，教训 C2「修一条漏一条 = 没修完」）。现在两者同源，各扩展写一份 `renderHTML` 就够了。
 *
 * 拿的是 doc 而不是 markdown 字符串：`getDoc()`（`MarkdownEditor.vue`）给的是实时内存 doc，
 * 不经落盘序列化，因此也就绕开了「防抖 500ms 才更新的 store 快照」。
 *
 * `serializeFragment` 不传 `target` ⇒ 返回 `DocumentFragment`，需要一个 detached div 承载才能取
 * `innerHTML`。⚠️ 那个 div **不许挂进 `document`**：挂进去会引样式、触发 NodeView 相关副作用，
 * 还平白多出 CSP/布局开销，而我们要的只是字符串。
 */
import { DOMSerializer } from '@tiptap/pm/model';
import type { Fragment, Node as PMNode, Schema } from '@tiptap/pm/model';
import { externalizeHtml } from './externalize-html';

export function serializeDocumentHtml(doc: PMNode | null): string | null {
  if (!doc) return null;
  const fragment = DOMSerializer.fromSchema(doc.type.schema).serializeFragment(doc.content);
  const wrap = document.createElement('div');
  wrap.appendChild(fragment as Node);
  externalizeHtml(wrap);
  return wrap.innerHTML;
}

/**
 * 选区复制（Ctrl+C / 右键复制）的 `text/html` 序列化器 —— 与整篇出口共用同一个归一层，
 * 只是档位是 `selection`（见 `externalize-html.ts` 的 `ExternalizeTarget`）。
 *
 * 为什么需要它：`serializeForClipboard` 默认用 `DOMSerializer.fromSchema(schema)` 直出，
 * 归一层一行都没跑 ⇒ 选区复制到外部会带着 colgroup 死宽、ZWNJ、`[^1]` 源码、callout 没标题。
 * 挂上 `editorProps.clipboardSerializer` 即可与按钮路径对齐。
 *
 * 为什么只实现 `serializeFragment`：`serializeForClipboard` 只调这一个方法
 * （prosemirror-view `index.js` 中 `serializer.serializeFragment(content, {document: doc})`），
 * 传进来的 `options.document` 是一个游离 document，所有新建节点必须用 `ownerDocument`。
 * 因此这里用对象字面量 + 一次窄断言，而不是继承 `DOMSerializer`（构造函数强制要 schema，
 * 而 `editorProps` 是静态对象、构造期拿不到 schema）。
 */
export function createSelectionClipboardSerializer(): DOMSerializer {
  // 惰性构建：首次复制时从 fragment 自身取 schema（编辑器里所有节点共享同一个 schema）
  let base: DOMSerializer | null = null;

  const serializer = {
    serializeFragment(fragment: Fragment, options?: { document?: Document }): DocumentFragment {
      const targetDoc = options?.document ?? document;
      if (!base) {
        let schema: Schema | undefined;
        fragment.descendants((node) => {
          schema = node.type.schema;
          return false;
        });
        // 空选区（空文档 Ctrl+A）：没有节点就没有 schema，也没有内容要序列化
        if (!schema) return targetDoc.createDocumentFragment();
        base = DOMSerializer.fromSchema(schema);
      }
      // 传了 options.document ⇒ 运行时一定是 DocumentFragment；类型签名把两种情况合成了
      // `HTMLElement | DocumentFragment`（那是给「直接指定 target 元素」的用法留的）
      const raw = base.serializeFragment(fragment, options) as DocumentFragment;
      return externalizeFragment(raw, targetDoc);
    },
  };

  return serializer as unknown as DOMSerializer;
}

/** 把序列化产物过一遍归一层，再还原成 fragment（归一层按 HTMLElement 根节点工作） */
function externalizeFragment(raw: DocumentFragment, doc: Document): DocumentFragment {
  const root = doc.createElement('div');
  root.appendChild(raw);
  externalizeHtml(root, 'selection');
  const out = doc.createDocumentFragment();
  while (root.firstChild) out.appendChild(root.firstChild);
  return out;
}

