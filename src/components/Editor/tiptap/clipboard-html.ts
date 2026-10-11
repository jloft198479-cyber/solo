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
import type { Node as PMNode } from '@tiptap/pm/model';
import { externalizeHtml } from './externalize-html';

export function serializeDocumentHtml(doc: PMNode | null): string | null {
  if (!doc) return null;
  const fragment = DOMSerializer.fromSchema(doc.type.schema).serializeFragment(doc.content);
  const wrap = document.createElement('div');
  wrap.appendChild(fragment as Node);
  externalizeHtml(wrap);
  return wrap.innerHTML;
}
