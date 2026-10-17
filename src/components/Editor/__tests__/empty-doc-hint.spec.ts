/**
 * 空文档提示（Placeholder）契约。
 *
 * 防的事故：
 * - 文案里写死 `Ctrl+F`：Mac 上该是 ⌘F，用户改键后更会当面撒谎（registry M-32 立的规矩）；
 * - 把 placeholder 写回静态字符串：用户改键后提示永远停在旧键位；
 * - 有人「顺手」把三个入口删成一个 —— 用户明确要的是 / + 查找 + 命令面板。
 *
 * 位置：空文档第一段的 `::before`（CSS 伪元素，纯文本），一输入即消失。
 * 完整键位速查不在这里，在命令面板里（每条命令右侧已显示）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const editor = read('../MarkdownEditor.vue');
const extensions = read('../tiptap/editor-extensions.ts');

describe('空文档提示', () => {
  it('三个入口齐全：/ 唤起命令 + 查找 + 命令面板', () => {
    expect(editor).toContain("'/ 唤起命令'");
    expect(editor).toContain("shortcutHint('edit.find'");
    expect(editor).toContain("shortcutHint('view.commandPalette'");
  });

  it('键位来自 registry，不写死 Ctrl / ⌘', () => {
    const start = editor.indexOf('function buildEmptyDocHint');
    expect(start, 'buildEmptyDocHint 不见了').toBeGreaterThan(-1);
    const hintBlock = editor.slice(start, start + 900);
    expect(hintBlock).not.toMatch(/Ctrl\+|⌘|\bMod-/);
  });

  it('Placeholder 用函数取值（改键后点一下编辑器即刷新）', () => {
    expect(extensions).toMatch(/placeholder:\s*\(\)\s*=>/);
    expect(extensions).toContain('getEmptyDocHint');
  });
});
