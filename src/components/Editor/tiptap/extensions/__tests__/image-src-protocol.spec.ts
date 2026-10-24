// @vitest-environment happy-dom
/**
 * 入站 `<img>` 的协议门禁锁（审计 2026-10-25 P2-5）。
 *
 * 我防的事故：粘贴含 `file://` 图的 HTML（Outlook 邮件、本地打开的网页复制），
 * `pickImageSrc` 的占位排除表只拦 data:/blob:，`file:///D:/photos/cat.png` 被当
 * 「本地相对路径」join 文档目录、永远解析不出；WebView2 的 CSP img-src 也不放行
 * file: ⇒ 永久破图；落盘后重开还被 markdown-it validateLink 退化成字面文本。
 * `javascript:` 则是注入面。
 *
 * 修法：pickImageSrc 对 file:/javascript:/vbscript: 返回 null ⇒ parseHTML 的
 * getAttrs 给 false ⇒ 整图丢弃（不建空节点）。markdown 文本管线（磁盘已有文件）
 * 的 file: 放行是另一条路（parser 侧，见 file-url-roundtrip.spec.ts），不经这里。
 *
 * 反向校准（准入②，执行时已做）：撤掉 BLOCKED_SRC_RE 判定 ⇒ file:/javascript:
 * 两条转红；其余各条为「不得误伤」的回归守卫。
 */
import { Editor } from '@tiptap/vue-3';
import { ref } from 'vue';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';

import { createEditorExtensions } from '../../editor-extensions';
import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';

const schema = createTestSchema();
const editors: Editor[] = [];

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

function makeEditor(): Editor {
  const editor = new Editor({
    extensions: createEditorExtensions({
      slashMenuRef: ref(null),
      slashMenuItems: ref([]),
      slashMenuCommand: ref(() => {}),
      emojiMenuRef: ref(null),
      emojiMenuItems: ref([]),
      emojiMenuCommand: ref(() => {}),
      wikilinkMenuRef: ref(null),
      wikilinkMenuItems: ref([]),
      wikilinkMenuCommand: ref(() => {}),
      searchHighlightOptions: {} as never,
    }),
    content: parseMarkdown(schema, '').toJSON(),
  });
  editors.push(editor);
  return editor;
}

function imagesAfterInsert(html: string): PMNode[] {
  const editor = makeEditor();
  editor.commands.insertContent(html);
  const out: PMNode[] = [];
  editor.state.doc.descendants((n) => {
    if (n.type.name === 'image') out.push(n);
    return true;
  });
  return out;
}

describe('入站 <img> 协议门禁（P2-5）', () => {
  it('file:// 图整图丢弃（不建节点）', () => {
    expect(imagesAfterInsert('<img src="file:///D:/photos/cat.png" alt="猫">')).toHaveLength(0);
  });

  it('javascript: 图整图丢弃', () => {
    expect(imagesAfterInsert('<img src="javascript:alert(1)" alt="x">')).toHaveLength(0);
  });

  it('vbscript: 图整图丢弃', () => {
    expect(imagesAfterInsert('<img src="vbscript:msgbox" alt="x">')).toHaveLength(0);
  });

  it('http(s) 图照常保留（不得误伤）', () => {
    const imgs = imagesAfterInsert('<img src="https://cdn.example.com/a.png" alt="图">');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].attrs.src).toBe('https://cdn.example.com/a.png');
  });

  it('相对路径图照常保留（不得误伤）', () => {
    const imgs = imagesAfterInsert('<img src="assets/a.png" alt="图">');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].attrs.src).toBe('assets/a.png');
  });

  it('data-src 懒加载真地址照常取用（不得误伤）', () => {
    const imgs = imagesAfterInsert(
      '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="https://cdn.example.com/real.png">',
    );
    expect(imgs).toHaveLength(1);
    expect(imgs[0].attrs.src).toBe('https://cdn.example.com/real.png');
  });

  it('协议相对 //cdn 归一为 https（既有规则不得回退）', () => {
    const imgs = imagesAfterInsert('<img src="//cdn.example.com/a.png" alt="图">');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].attrs.src).toBe('https://cdn.example.com/a.png');
  });
});
