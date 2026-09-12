// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Editor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { executeEditorCommand } from '../editor-commands';

/**
 * 「复制为 Markdown」（edit.copyAsMarkdown）——默认复制之外的显式源码入口。
 * 默认复制给的是「渲染后的干净文字」，行为与断言见 clipboard-serializer.spec
 * 的 serializeClipboardText；这里只管源码这条显式通道。
 */
describe('edit.copyAsMarkdown', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  function createEditor(html: string): Editor {
    const editor = new Editor({ extensions: [StarterKit], content: html });
    editor.commands.selectAll();
    return editor;
  }

  it('把选区以 Markdown 源码写剪贴板（保留标记与转义）', () => {
    const editor = createEditor('<p>a*b 与 x = 1</p><h2>标题</h2>');

    expect(executeEditorCommand(editor, 'edit.copyAsMarkdown')).toBe(true);

    const out = writeText.mock.calls[0][0] as string;
    // 源码形态：`*` 带转义（粘到别处仍是字面量），标题带 `##`
    expect(out).toContain('a\\*b');
    expect(out).toContain('## 标题');

    editor.destroy();
  });

  it('未知命令返回 false 且不写剪贴板', () => {
    const editor = createEditor('<p>x</p>');

    expect(executeEditorCommand(editor, 'editor.不存在的命令')).toBe(false);
    expect(writeText).not.toHaveBeenCalled();

    editor.destroy();
  });
});
