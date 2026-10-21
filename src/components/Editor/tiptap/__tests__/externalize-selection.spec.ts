// @vitest-environment happy-dom
/**
 * 选区复制（Ctrl+C）的 `text/html` 回归锁（2026-10-21，复审后重写）。
 *
 * 背景：`serializeForClipboard` 默认直出 DOMSerializer，归一层一行都没跑 ⇒ 按钮路径干净、
 * Ctrl+C 路径脏。本文件锁五组判据：
 *  - A 归一层该做的都做了（ZWNJ / 死宽 / 脚注 / callout 标题进正文）
 *  - B 番位取舍（首块 frontmatter 删、tableWrapper 永不拆）
 *  - C 顶层节点身份不变（`data-pm-slice` 打在第一个顶层元素上，身份变了标记就落错）
 *  - D 两条通道回读后的落盘结果一致（复审指出初版只在注释里承诺、没实现）
 *  - E 用户正文不被误伤（复审 Critical：同名加粗首段、嵌套 callout）
 */
import { describe, expect, it } from 'vitest';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';

import { parseMarkdown } from '../markdown/parser';
import { serializeMarkdown } from '../markdown/serializer';
import { createTestSchema } from '../markdown/__tests__/test-utils';
import { stripInjectedCalloutTitles } from '../extensions/markdown-paste';
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

/** 首块是表格（C 组要验「顶层身份」在非 div 首块上也成立） */
const MD_TABLE_FIRST = ['| 甲 | 乙 |', '| :--- | ---: |', '| 1 | 2 |', '', '尾巴段落。'].join('\n');

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

/** 真实回读链路：HTML 字符串剥掉注入段 → PM 解析 */
function pasteParse(html: string): PMNode {
  const wrap = document.createElement('div');
  wrap.innerHTML = stripInjectedCalloutTitles(html);
  return PMDOMParser.fromSchema(schema).parse(wrap);
}

const ZWNJ_COUNT = (s: string) => (s.match(/\u200C/g) ?? []).length;

describe('选区出站（Ctrl+C 通道）', () => {
  const doc = parseMarkdown(schema, MD);
  const { html } = selectionHtml(doc);

  // ── A 归一层该做的都做了 ──
  it('A 无 ZWNJ、无 colgroup、无死宽、脚注给 [1]、callout 标题进正文', () => {
    expect(ZWNJ_COUNT(html)).toBe(0);
    expect(html).not.toContain('colgroup');
    expect(html).not.toMatch(/min-width/);
    expect(html).toMatch(/<sup[^>]*data-footnote-ref[^>]*>\[1\]<\/sup>/);
    expect(html).not.toContain('[^1]');
    expect(html).toMatch(/<p data-solo-injected-title=""[^>]*><strong>框标题<\/strong><\/p>/);
    // data-title 保留（solo 回读的标题载体）；去重由粘贴侧按标记负责
    expect(html).toContain('data-title="框标题"');
  });

  it('A 表格内部手术照做（thead 提升、对齐保留）', () => {
    expect(html).toMatch(/<thead><tr><th[^>]*text-align: left/);
    expect(html).toContain('text-align: right');
  });

  // ── B 番位取舍 ──
  it('B 首块 frontmatter 被删（Ctrl+A 复制到公众号不该看到 YAML 头）', () => {
    expect(html).not.toContain('data-type="frontmatter"');
    expect(html).not.toContain('title: 选区出站对照');
  });

  it('B 只删首块，不追杀后面的同名块（只删第一个顶层元素）', () => {
    // 构造「frontmatter 在首位、正文在后」的片段：删完首块后正文必须还在
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<div data-type="frontmatter" class="mk-frontmatter">title: 前面的</div><p>后面的段落</p>';
    const parsed = PMDOMParser.fromSchema(schema).parse(wrap);
    const frag = createSelectionClipboardSerializer().serializeFragment(parsed.content, {
      document: document.implementation.createHTMLDocument('x'),
    });
    const out = document.createElement('div');
    out.appendChild(frag);
    expect(out.innerHTML).not.toContain('data-type="frontmatter"');
    expect(out.innerHTML).toContain('后面的段落');
  });

  it('B 永不拆 tableWrapper（拆了顶层身份就变，data-pm-slice 落错）', () => {
    expect(html).toContain('tableWrapper');
  });

  // ── C 顶层节点身份不变 ──
  it('C 首块是 div(frontmatter) 时，删掉后首块变成 h1（身份没被换成别的标签）', () => {
    expect(selectionHtml(doc).firstTopTag).toBe('h1');
  });

  it('C 首块是表格时也不拆 wrapper（顶层仍是 div）', () => {
    const tableDoc = parseMarkdown(schema, MD_TABLE_FIRST);
    expect(selectionHtml(tableDoc).firstTopTag).toBe('div');
  });

  // ── D 两条通道落盘结果一致 ──
  it('D 同一文档：按钮路径与选区路径回读后的 Markdown 完全一致', () => {
    const fromSelection = serializeMarkdown(pasteParse(html));
    const fromButton = serializeMarkdown(pasteParse(serializeDocumentHtml(doc)!));
    expect(fromSelection).toBe(fromButton);
  });

  // ── E 用户正文不被误伤 ──
  /**
   * Critical 回归锁（复审 §二）：用户写的「加粗且文字等于标题」的首段，
   * 与注入段在节点层完全同形。判据必须是来源标记，否则这段会被静默删掉。
   */
  it('E 用户自己写的同名加粗首段：往返后仍在', () => {
    const userDoc = parseMarkdown(schema, '> [!NOTE] 注意\n>\n> **注意**\n>\n> 正文');
    const { html: userHtml } = selectionHtml(userDoc);
    // 出站侧：注入段带标记，用户段不带 —— 两段并存
    expect(userHtml).toMatch(/<p data-solo-injected-title=""[^>]*><strong>注意<\/strong><\/p>/);
    // 用户段没有来源标记（只有 style），注入段有 —— 两段并存，靠标记区分
    expect(userHtml).toMatch(/<p style="[^"]*"><strong>注意<\/strong><\/p>/);

    const back = serializeMarkdown(pasteParse(userHtml));
    expect(back).toContain('> **注意**');
    expect(back).toContain('> 正文');
    // 标题只在 attrs 里一份，正文里用户那份留着 ⇒ 全文出现两次「注意」
    expect(back.split('注意').length - 1).toBe(2);
  });

  /** Major 回归锁（复审 §三）：嵌套 callout 的内层注入段曾经不会被去重 */
  it('E 嵌套 callout：内层注入段也被剥掉，正文不多行', () => {
    const nested = parseMarkdown(
      schema,
      '> [!NOTE]\n> 外层无标题\n>\n> > [!TIP] 内标题\n> > 内正文',
    );
    const { html: nestedHtml } = selectionHtml(nested);
    const back = serializeMarkdown(pasteParse(nestedHtml));
    expect(back).toContain('> > [!TIP] 内标题');
    expect(back).toContain('> > 内正文');
    // 「内标题」只许出现一次（attrs 那一份），正文里不许再有
    expect(back.split('内标题').length - 1).toBe(1);
  });

  // ── 序列化器自身的边界 ──
  it('空内容不炸（空文档 Ctrl+A）', () => {
    const detached = document.implementation.createHTMLDocument('empty');
    const frag = createSelectionClipboardSerializer().serializeFragment(
      schema.nodes.doc.create().content,
      { document: detached },
    );
    expect(frag.childNodes.length).toBe(0);
  });

  it('不传 options 时回落到全局 document（非 PM 调用方）', () => {
    const root = document.createElement('div');
    root.appendChild(createSelectionClipboardSerializer().serializeFragment(doc.content));
    expect(root.innerHTML).not.toContain('colgroup');
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
