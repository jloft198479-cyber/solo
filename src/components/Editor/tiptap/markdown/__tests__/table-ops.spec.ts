// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { parseMarkdown } from '../parser';
import { serializeMarkdown } from '../serializer';
import { createTestSchema } from './test-utils';

function createTableEditor(md: string): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: '',
  });

  const schema = createTestSchema();
  const doc = parseMarkdown(schema, md);
  editor.commands.setContent(doc.toJSON());

  return editor;
}

function serialize(editor: Editor): string {
  const schema = createTestSchema();
  const doc = schema.nodeFromJSON(editor.getJSON());
  return serializeMarkdown(doc);
}

const TABLE_3X3 = `| A | B | C |
| --- | --- | --- |
| 1 | 2 | 3 |
| 4 | 5 | 6 |
`;

describe('GFM 表格合法性回归', () => {
  it('删除最后一行数据后表格仍合法（含分隔行）', () => {
    const editor = createTableEditor(`| A | B |
| --- | --- |
| 1 | 2 |
`);
    // Cursor in the data row (position inside paragraph of second row's first cell)
    editor.commands.setTextSelection(14);
    expect(editor.can().deleteRow()).toBe(true);
    editor.chain().focus().deleteRow().run();

    const md = serialize(editor);
    expect(md).toContain('| ---');
    const pipeLines = md.split('\n').filter((l) => l.includes('|'));
    expect(pipeLines.length).toBeGreaterThanOrEqual(2);
    editor.destroy();
  });

  it('删除最后一列多余列后表格仍合法', () => {
    const editor = createTableEditor(`| A | B |
| --- | --- |
| 1 | 2 |
`);
    editor.commands.setTextSelection(7);
    expect(editor.can().deleteColumn()).toBe(true);
    editor.chain().focus().deleteColumn().run();

    const md = serialize(editor);
    expect(md).toContain('| ---');
    const headerLine = md.split('\n').find((l) => l.includes('|'));
    expect(headerLine).toBeTruthy();
    expect((headerLine!.match(/\|/g) || []).length).toBe(2);
    editor.destroy();
  });

  it('删除表头行后分隔行仍在（GFM 要求）', () => {
    const editor = createTableEditor(TABLE_3X3);
    // Cursor in header row
    editor.commands.setTextSelection(3);
    editor.chain().focus().deleteRow().run();

    const md = serialize(editor);
    // After deleting header row, the first remaining row becomes the new header.
    // Serialized output must still have a separator line.
    expect(md).toContain('| ---');
    expect(md.split('\n').filter((l) => l.includes('|')).length).toBeGreaterThanOrEqual(3);
    editor.destroy();
  });

  it('toggleHeaderRow 双向：普通 → 表头 → 普通，round-trip 一致', () => {
    const editor = createTableEditor(TABLE_3X3);
    editor.commands.setTextSelection(3);

    // First toggle: header → plain (remove header)
    editor.chain().focus().toggleHeaderRow().run();
    const afterFirst = serialize(editor);

    // Second toggle: plain → header (restore header)
    editor.chain().focus().toggleHeaderRow().run();
    const afterSecond = serialize(editor);

    // After two toggles we should be back to original structure
    expect(afterSecond).toContain('| ---');
    expect(afterSecond.split('\n').filter((l) => l.includes('|')).length).toBe(
      afterFirst.split('\n').filter((l) => l.includes('|')).length,
    );
    editor.destroy();
  });

  it('最小表格 deleteRow/deleteColumn 不崩溃', () => {
    const editor = createTableEditor(`| A |
| --- |
`);
    editor.commands.setTextSelection(3);

    expect(() => {
      editor.can().deleteRow();
      editor.can().deleteColumn();
    }).not.toThrow();

    // If deletion succeeds, result should still be valid
    const canDeleteRow = editor.can().deleteRow();
    if (canDeleteRow) {
      editor.chain().focus().deleteRow().run();
      const md = serialize(editor);
      expect(typeof md).toBe('string');
    }
    editor.destroy();
  });

  it('addRowBefore / addRowAfter 增加行数且序列化合法', () => {
    const editor = createTableEditor(`| A | B |
| --- | --- |
| 1 | 2 |
`);
    editor.commands.setTextSelection(3);

    editor.chain().focus().addRowBefore().run();
    let md = serialize(editor);
    // Should now have 3 data lines + 1 separator = 4 pipe lines
    const pipeLines = md.split('\n').filter((l) => l.includes('|'));
    expect(pipeLines.length).toBe(4);
    expect(md).toContain('| ---');

    editor.chain().focus().addRowAfter().run();
    md = serialize(editor);
    const pipeLines2 = md.split('\n').filter((l) => l.includes('|'));
    expect(pipeLines2.length).toBe(5);
    expect(md).toContain('| ---');
    editor.destroy();
  });

  it('addColumnBefore / addColumnAfter 增加列数且序列化合法', () => {
    const editor = createTableEditor(`| A | B |
| --- | --- |
| 1 | 2 |
`);
    editor.commands.setTextSelection(3);

    editor.chain().focus().addColumnBefore().run();
    let md = serialize(editor);
    // Each row should now have 3 cells
    const headerLine = md.split('\n').find((l) => l.includes('A'));
    expect(headerLine).toBeTruthy();
    // Count pipes: 3 cells = 4 pipes
    expect((headerLine!.match(/\|/g) || []).length).toBe(4);

    editor.chain().focus().addColumnAfter().run();
    md = serialize(editor);
    const headerLine2 = md.split('\n').find((l) => l.includes('A'));
    expect((headerLine2!.match(/\|/g) || []).length).toBe(5);
    editor.destroy();
  });
});
