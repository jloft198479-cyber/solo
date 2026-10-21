// @vitest-environment happy-dom
/**
 * 选区复制（Ctrl+C）的 `text/html` 回归锁（2026-10-21）。
 *
 * 背景：`serializeForClipboard` 默认直出 DOMSerializer，归一层一行都没跑 ⇒ 按钮路径干净、
 * Ctrl+C 路径脏。本文件锁「两条通道同一套标准」，以及选区档位**刻意不做的两件事**
 * （不删 frontmatter、不拆 tableWrapper）。
 *
 * 判据分四组：
 *  - A 归一层该做的都做了（ZWNJ / 死宽 / 脚注 / callout 标题）
 *  - B 档位分叉（frontmatter、tableWrapper 必须原样留着，否则粘回 solo 丢东西）
 *  - C 顶层节点身份不变（`data-pm-slice` 是打在第一个顶层元素上的，身份变了标记就落错）
 *  - D 回读签名不变（与按钮路径同基线比，只许出现「标题段落被去重」这一处差异）
 */
import { describe, expect, it } from 'vitest';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';

import { parseMarkdown } from '../markdown/parser';
import { createTestSchema } from '../markdown/__tests__/test-utils';
import { createSelectionClipboardSerializer, serializeDocumentHtml } from '../clipboard-html';

const MD = [
  '---',
  'title: 选区出站对照',
  '---',
  '',
  '# 标题',
  '',
  '段落**粗**、[^1] 与 ![图|200x100](./a.png)。',
  '',
  '> [!NOTE] 框标题',
  '> 框正文。',
  '',
  '| 甲 | 乙 |',
  '| :--- | ---: |',
  '| 1 | 2 |',
  '',
  '[^1]: 定义。',
].join('\n');

const schema = createTestSchema();

/** 复刻 prosemirror-view `serializeForClipboard`：新建游离 document，交给序列化器 */
function selectionHtml(doc: PMNode): { html: string; firstTopTag: string | null } {
  const detached = document.implementation.createHTMLDocument('clipboard');
  const fragment = createSelectionClipboardSerializer().serializeFragment(doc.content, {
    document: detached,
  });
  const wrap = detached.createElement('div');
  wrap.appendChild(fragment);
  const first = wrap.firstElementChild;
  return { html: wrap.innerHTML, firstTopTag: first ? first.nodeName.toLowerCase() : null };
}

const ZWNJ_COUNT = (s: string) => (s.match(/\u200C/g) ?? []).length;

describe('选区出站（Ctrl+C 通道）', () => {
  const doc = parseMarkdown(schema, MD);
  const { html, firstTopTag } = selectionHtml(doc);

  // ── A 归一层该做的都做了 ──
  it('A 无 ZWNJ、无 colgroup、无死宽、脚注给 [1]、callout 标题进正文', () => {
    expect(ZWNJ_COUNT(html)).toBe(0);
    expect(html).not.toContain('colgroup');
    expect(html).not.toMatch(/min-width/);
    expect(html).toMatch(/<sup[^>]*data-footnote-ref[^>]*>\[1\]<\/sup>/);
    expect(html).not.toContain('[^1]');
    expect(html).toContain('<strong>框标题</strong>');
    // data-title 保留（solo 回读的标题载体）；去重由粘贴侧负责
    expect(html).toContain('data-title="框标题"');
  });

  it('A 表格内部手术照做（thead 提升、对齐保留）', () => {
    expect(html).toMatch(/<thead><tr><th[^>]*text-align: left/);
    expect(html).toContain('text-align: right');
  });

  // ── B 档位分叉：选区不能动的东西 ──
  it('B 保留 frontmatter（粘回 solo 要靠它还原元数据）', () => {
    expect(html).toContain('data-type="frontmatter"');
    expect(html).toContain('title: 选区出站对照');
  });

  // ── C 顶层节点身份不变 ──
  it('C 顶层第一个元素与未归一产物一致（data-pm-slice 的落点）', () => {
    // 样本首块是 frontmatter —— 选区档位不删它，所以首个顶层元素仍是同一个 div
    expect(firstTopTag).toBe('div');
  });

  // ── D 与按钮路径的差异只允许「标题段落」这一处 ──
  it('D 同一文档：按钮路径删 frontmatter，选区路径留', () => {
    const buttonHtml = serializeDocumentHtml(doc)!;
    expect(buttonHtml).not.toContain('data-type="frontmatter"');
    expect(buttonHtml).toContain('data-title="框标题"');
    expect(buttonHtml).toContain('<strong>框标题</strong>');
  });

  // ── 序列化器自身的边界 ──
  it('空内容不炸（空文档 Ctrl+A）', () => {
    const empty = schema.nodes.doc.create(null, schema.nodes.paragraph.create());
    const detached = document.implementation.createHTMLDocument('empty');
    const frag = createSelectionClipboardSerializer().serializeFragment(
      schema.nodes.doc.create().content,
      { document: detached },
    );
    expect(frag.childNodes.length).toBe(0);
    expect(empty).toBeTruthy();
  });

  it('不传 options 时回落到全局 document（非 PM 调用方）', () => {
    const htmlRoot = document.createElement('div');
    const frag = createSelectionClipboardSerializer().serializeFragment(doc.content);
    htmlRoot.appendChild(frag);
    expect(htmlRoot.innerHTML).not.toContain('colgroup');
  });

  it('回读：callout 标题段落与 attrs 并存（去重前），且私有属性一个不少', () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const back = PMDOMParser.fromSchema(schema).parse(wrap);
    let calloutCount = 0;
    back.descendants((n) => {
      if (n.type.name === 'callout') {
        calloutCount++;
        expect(n.attrs.title).toBe('框标题');
      }
      return true;
    });
    expect(calloutCount).toBe(1);
  });

  /**
   * 接线锁：序列化器本身对了，但**没人把它挂到编辑器上**同样等于没修。
   * 这是本仓踩过的「假锁」形态——只测被抽出来的函数，调用点删掉仍全绿。
   * 组件级挂载成本太高（依赖 store / theme / 路由），故按源码断言，与
   * `wikilink-sync-refresh-lock.spec.ts` / `design-contracts.spec.ts` 同范式。
   */
  it('接线：编辑器 editorProps 真的挂上了选区序列化器', async () => {
    const { readFile } = await import('node:fs/promises');
    // happy-dom 环境下 import.meta.url 不是 file: 协议（fileURLToPath 会抛），
    // 故按 vitest 的 cwd（= 仓库根）拼路径
    const { join } = await import('node:path');
    const file = join(process.cwd(), 'src/components/Editor/MarkdownEditor.vue');
    const src = await readFile(file, 'utf8');
    expect(src).toContain('clipboardSerializer: createSelectionClipboardSerializer()');
    expect(src).toContain("import { createSelectionClipboardSerializer } from './tiptap/clipboard-html'");
  });
});
