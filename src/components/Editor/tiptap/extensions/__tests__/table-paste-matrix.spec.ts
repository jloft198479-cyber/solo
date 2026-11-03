// @vitest-environment happy-dom
/**
 * 表格「进站」矩阵验收表 —— 只回答一个问题：
 *   **外面各个软件复制出来的表格，粘进 solo 能不能还原成真表格？**
 *
 * 为什么要有这张表（而不是零散补几条用例）：
 * 表格来源不同 ⇒ 剪贴板里带的形态不同 ⇒ 走的是**不同管道**。过去每次只修被投诉的那一种，
 * 修一处不知道有没有踩另一处。这张表把「来源 → 管道 → 验收」钉在一处，任何改动必须
 * 保证：**红格转绿，绿格不许变红**（新增缺口要显式登记，不能静默通过）。
 *
 * 管道只有两条（PM 的语义，不是我们的发明）：
 *   A. HTML 路径：剪贴板带 text/html → PM 用 schema 的 DOMParser 解析（Excel/Word/网页/飞书都走这条）
 *   B. 纯文本路径：只有 text/plain → 过 `clipboardTextParser` 钩子（markdown 源码、聊天软件复制）
 *
 * ⚠️ 本表不测「渲染成什么样式」，只测**结构**：表格节点在不在、行列对不对、格内加粗丢没丢。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import * as pmViewLib from '@tiptap/pm/view';
import { Slice } from '@tiptap/pm/model';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';

import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { markdownPastePlugin } from '../markdown-paste';

/** Tauri 依赖：本表只关心结构，剪贴板/图片/对话框一律打桩 */
vi.mock('../../../../../services/tauri/document', () => ({
  saveClipboardImage: vi.fn().mockResolvedValue({ absolutePath: '/tmp/x.png', relativePath: 'x.png' }),
  authorizeImageAsset: vi.fn().mockResolvedValue(undefined),
  resolveImageDisplay: vi.fn(),
}));
vi.mock('../../../../../services/tauri/dialog', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('../../../../../services/tauri/clipboard', () => ({
  readClipboardHtml: vi.fn().mockResolvedValue(null),
}));

const schema = createTestSchema();

function countNodes(doc: PMNode, name: string): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === name) n += 1;
    return true;
  });
  return n;
}

function hasBold(doc: PMNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === 'bold')) found = true;
    return !found;
  });
  return found;
}

/** 每个表格的「行数 × 首行列数」—— 用来区分「表格在」和「表格对」 */
function tableShape(doc: PMNode): Array<{ rows: number; cols: number }> {
  const shapes: Array<{ rows: number; cols: number }> = [];
  doc.descendants((node) => {
    if (node.type.name !== 'table') return true;
    shapes.push({ rows: node.childCount, cols: node.firstChild?.childCount ?? 0 });
    return false;
  });
  return shapes;
}

describe('表格进站矩阵（来源 → 管道 → 结果）', () => {
  let view: EditorView | null = null;
  let mount: HTMLElement | null = null;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });
  afterEach(() => {
    if (view && !view.isDestroyed) view.destroy();
    view = null;
    mount?.remove();
    mount = null;
  });

  function mountEditor(): EditorView {
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 1),
      plugins: [markdownPastePlugin()],
    });
    view = new EditorView(mount!, { state });
    return view;
  }

  function pasteEvent(parts: Record<string, string>): ClipboardEvent {
    return {
      clipboardData: {
        getData: (type: string) => parts[type] ?? '',
        types: Object.keys(parts),
        files: [],
      } as unknown as DataTransfer,
    } as unknown as ClipboardEvent;
  }

  /**
   * 复刻 PM 真实粘贴管线（prosemirror-view doPaste）：
   * parseFromClipboard（内含 clipboardTextParser）→ handlePaste → transformPasted → 插入。
   * 返回插入后的 doc，让断言看「用户最终看到的结构」而不是中间产物。
   */
  function paste(parts: Record<string, string>): PMNode {
    const v = mountEditor();
    const event = pasteEvent(parts);
    const text = parts['text/plain'] ?? '';
    const html = parts['text/html'] ?? null;
    const parse = (
      pmViewLib as unknown as {
        __parseFromClipboard(
          view: EditorView,
          text: string,
          html: string | null,
          plainText: boolean,
          $context: ResolvedPos,
        ): Slice | null;
      }
    ).__parseFromClipboard;
    let slice = parse(v, text, html, false, v.state.selection.$from) ?? Slice.empty;

    const handled = Boolean(
      v.someProp('handlePaste', (handler) => handler(v, event, slice)),
    );
    if (handled) return v.state.doc; // 钩子自己插了（含 Layer 4 占位/图片）

    slice = v.someProp('transformPasted', (f) => f(slice, v)) ?? slice;
    v.dispatch(v.state.tr.replaceSelection(slice));
    return v.state.doc;
  }

  // ── A. HTML 路径：大厂软件都走这条，必须一直是绿的 ────────────────
  describe('A. HTML 路径（Excel / Word / 网页 / 飞书）', () => {
    it('网页 / Excel 的 <table> → 真表格，行列不丢', () => {
      const doc = paste({
        'text/plain': '甲\t乙\n1\t2',
        'text/html':
          '<table><thead><tr><th>甲</th><th>乙</th></tr></thead>' +
          '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
      });
      expect(tableShape(doc)).toEqual([{ rows: 2, cols: 2 }]);
    });

    it('Word 表格（带 mso 垃圾）→ 真表格，文字不被吞', () => {
      const doc = paste({
        'text/plain': '甲 乙 1 2',
        'text/html':
          '<table class="MsoTableGrid" style="mso-table-layout-alt:fixed"><tr>' +
          '<td><p class="MsoNormal">甲<o:p></o:p></p></td>' +
          '<td><p class="MsoNormal">乙<o:p></o:p></p></td></tr>' +
          '<tr><td>1</td><td>2</td></tr></table>',
      });
      expect(tableShape(doc)).toEqual([{ rows: 2, cols: 2 }]);
      expect(doc.textContent).toContain('甲');
      expect(doc.textContent).toContain('2');
    });

    it('单元格内含加粗与 div 包装（公众号 / 飞书）→ 表格在，加粗在', () => {
      const doc = paste({
        'text/plain': '甲 乙',
        'text/html':
          '<table><tbody><tr><td><div><strong>甲</strong></div></td><td><div>乙</div></td></tr></tbody></table>',
      });
      expect(tableShape(doc)).toEqual([{ rows: 1, cols: 2 }]);
      expect(hasBold(doc)).toBe(true);
    });

    it('含 colspan 的合并单元格 → 至少不丢字、不退化成纯文本', () => {
      const doc = paste({
        'text/plain': '合并 1 2',
        'text/html':
          '<table><tr><td colspan="2">合并</td></tr><tr><td>1</td><td>2</td></tr></table>',
      });
      expect(tableShape(doc).length).toBe(1);
      expect(doc.textContent).toContain('合并');
    });
  });

  // ── B. 纯文本路径：markdown 源码，本次病根所在 ────────────────────
  describe('B. 纯文本路径（markdown 源码：Obsidian / Typora / 聊天软件复制）', () => {
    it('B1 连续行表格 → 真表格（现状绿，防止被改坏）', () => {
      const doc = paste({
        'text/plain': '| 甲 | 乙 |\n| --- | --- |\n| 1 | **2** |',
      });
      expect(tableShape(doc)).toEqual([{ rows: 2, cols: 2 }]);
      expect(hasBold(doc)).toBe(true);
    });

    it('B2 表格行之间夹空行（聊天软件复制）→ 仍应是真表格 ★本次目标', () => {
      const doc = paste({
        'text/plain': '| 甲 | 乙 |\n\n| --- | --- |\n\n| 1 | **2** |',
      });
      expect(tableShape(doc)).toEqual([{ rows: 2, cols: 2 }]);
    });

    it('B3 表格前有说明文字 + 行间空行（真实投诉形态）→ 表格在、正文在、加粗在 ★本次目标', () => {
      const md = [
        '行，就按通用 Agent 的术语，逐条对上：',
        '',
        '| 你的说法 | 通用 Agent 里的词 | 在 Trae 里长什么样 |',
        '',
        '| --- | --- | --- |',
        '',
        '| 一节课 | **会话（Session）** | 左边会话列表里的一条 |',
        '',
        '| 备课 | **建索引** | 给附件做一次解析 |',
        '',
        '**一句话**：课 = 会话，文件 = 附件。',
      ].join('\n');
      const doc = paste({ 'text/plain': md });
      // 列数由分隔行决定（3 列）；行数 = 表头 1 + 数据 2
      expect(tableShape(doc)).toEqual([{ rows: 3, cols: 3 }]);
      expect(hasBold(doc)).toBe(true);
      expect(doc.textContent).toContain('通用 Agent 的术语');
      expect(doc.textContent).toContain('课 = 会话');
    });

    it('B4 一篇里两张表（都夹空行）→ 两张都成立 ★本次目标', () => {
      const md = [
        '表一：',
        '',
        '| a | b |',
        '',
        '| --- | --- |',
        '',
        '| 1 | 2 |',
        '',
        '表二：',
        '',
        '| c | d |',
        '',
        '| --- | --- |',
        '',
        '| 3 | 4 |',
      ].join('\n');
      expect(tableShape(paste({ 'text/plain': md }))).toEqual([
        { rows: 2, cols: 2 },
        { rows: 2, cols: 2 },
      ]);
    });

    it('B5 标题 + 表格 + 空行（走结构化分支）→ 表格不被标题分支吞掉 ★本次目标', () => {
      const md = ['# 标题', '', '| a | b |', '', '| --- | --- |', '', '| 1 | 2 |', '', '- 列表项'].join(
        '\n',
      );
      const doc = paste({ 'text/plain': md });
      expect(tableShape(doc)).toEqual([{ rows: 2, cols: 2 }]);
      expect(countNodes(doc, 'heading')).toBe(1);
      expect(countNodes(doc, 'listItem')).toBe(1);
    });

    it('B6 单列表格（无首尾竖线写法）→ 仍应识别 ★本次目标', () => {
      const doc = paste({ 'text/plain': 'a | b\n--- | ---\n1 | 2' });
      expect(tableShape(doc)).toEqual([{ rows: 2, cols: 2 }]);
    });
  });

  // ── D. 空行归一化的副作用回归：块外的东西一个字都不许改 ──────────
  describe('D. 归一化不得越界（N1–N4，复审实测复现）', () => {
    it('N1 CRLF / 空行含空格（Windows 来源）→ 表格照样成立', () => {
      expect(
        tableShape(paste({ 'text/plain': '| 甲 | 乙 |\r\n\r\n| --- | --- |\r\n\r\n| 1 | 2 |' })),
      ).toEqual([{ rows: 2, cols: 2 }]);
      expect(
        tableShape(paste({ 'text/plain': '| 甲 | 乙 |\n \n| --- | --- |\n \n| 1 | 2 |' })),
      ).toEqual([{ rows: 2, cols: 2 }]);
    });

    it('N2 表格后紧跟带竖线的句子 → 句子留在表格外，不许吞成末行', () => {
      const doc = paste({
        'text/plain': '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n我选 A | B 都行',
      });
      expect(tableShape(doc)).toEqual([{ rows: 2, cols: 2 }]);
      expect(doc.lastChild?.type.name).toBe('paragraph');
      expect(doc.lastChild?.textContent).toBe('我选 A | B 都行');
    });

    it('N3 两张相邻表格（只隔一个空行）→ 两张，不许并成一张', () => {
      const doc = paste({
        'text/plain':
          '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n| c | d |\n| --- | --- |\n| 3 | 4 |',
      });
      expect(tableShape(doc)).toEqual([
        { rows: 2, cols: 2 },
        { rows: 2, cols: 2 },
      ]);
    });

    it('N4 围栏代码里的表格示例 → 代码块内容逐字不变（空行不许删）', () => {
      const md = ['```text', 'a | b', '', '--- | ---', '', 'x', '```'].join('\n');
      const doc = paste({ 'text/plain': md });
      expect(countNodes(doc, 'table')).toBe(0);
      expect(countNodes(doc, 'codeBlock')).toBe(1);
      let code = '';
      doc.descendants((node) => {
        if (node.type.name === 'codeBlock') code = node.textContent;
        return true;
      });
      expect(code).toBe('a | b\n\n--- | ---\n\nx');
    });
  });

  // ── E. HTML 塌方救援：表格也必须救得回来 ──────────────────────────
  describe('E. 装饰性 HTML 塌方 + 原文是表格', () => {
    it('E1 div/span 拍平成纯段落 → 从 textContent 救回真表格', () => {
      const lines = ['| a | b |', '| --- | --- |', '| 1 | 2 |'];
      const html = lines.map((line) => `<div><span>${line}</span></div>`).join('');
      const doc = paste({ 'text/plain': lines.join('\n'), 'text/html': html });
      expect(tableShape(doc)).toEqual([{ rows: 2, cols: 2 }]);
    });
  });

  // ── C. 明确**不该**变表格的：防误伤，绿格不许变红 ────────────────
  describe('C. 防误伤（这些必须保持原样，不许为了修表格把它们变成表格）', () => {
    it('C1 Tab 分隔（Excel 纯文本降级 / TSV）→ 现状为纯文本，锁现状', () => {
      const doc = paste({ 'text/plain': '甲\t乙\n1\t2' });
      expect(tableShape(doc)).toEqual([]);
      expect(doc.textContent).toContain('甲');
    });

    it('C2 CSV → 现状为纯文本，锁现状', () => {
      const doc = paste({ 'text/plain': 'name,age\n张三,18' });
      expect(tableShape(doc)).toEqual([]);
    });

    it('C3 散文含管道符 + 下一行是 --- （setext 标题形态）→ 不许误判成表格', () => {
      const doc = paste({ 'text/plain': '我选 A | B 都行\n---\n正文一段' });
      expect(tableShape(doc)).toEqual([]);
    });

    it('C4 多行 shell 管道示例 → 不许误判成表格', () => {
      const md = ['cat a.txt | grep x', 'ls -l | wc -l', 'echo hi | tee out.log'].join('\n');
      expect(tableShape(paste({ 'text/plain': md }))).toEqual([]);
    });

    it('C5 普通多行纯文本 → 逐行成段，不触发任何 markdown 转换', () => {
      const doc = paste({ 'text/plain': '第一段\n第二段\n第三段' });
      expect(tableShape(doc)).toEqual([]);
      expect(countNodes(doc, 'paragraph')).toBeGreaterThanOrEqual(3);
    });
  });
});
