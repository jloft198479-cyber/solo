/**
 * 菜单字形锁（2026-10-17 · 批 3 第 3 步）
 *
 * 防的事故：斜杠菜单 14 项曾各自填一个字符 —— `¶` `H1` `•` `☐` `❝` `▎` `<>` `—` `⊞` `∑` `◈`
 * `1.`，混了排版符号 / 文字标签 / 伪图标三种性质，没有规则说「标题该用什么」；气泡菜单又把
 * `H1` / `H2` / `</>` 各写一遍。结果是同一件事两个出处、改一处全处不动。
 *
 * 现在菜单项只声明**图标键**（`icons/svg.ts` 的 `IconName`），屏幕上的图形一律来自那份图源。
 * 类型层面已由 `IconName` 兜住，但类型可以被 `as any` 绕过，所以再加一层运行时锁：
 * ① 键必须真实存在于图标库；② 键必须是 ASCII 标识符（挡住「再填个字符」的回退）；
 * ③ 气泡菜单不许再内联字符字形。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ICONS } from '../../../../icons/svg';
import { slashCommandItems } from '../slash-commands';

describe('菜单字形锁：菜单只声明图标键，图形只来自图标库', () => {
  it('斜杠菜单每项的图标键都存在于图标库', () => {
    expect(slashCommandItems).toHaveLength(14);
    const bad = slashCommandItems
      .filter((item) => !(item.icon in ICONS))
      .map((item) => `${item.title}: ${item.icon}`);
    expect(bad, '这些菜单项填了图标库里不存在的键').toEqual([]);
  });

  it('图标键必须是 ASCII 标识符（防止退回「随手打个字符」）', () => {
    const bad = slashCommandItems
      .filter((item) => !/^[a-zA-Z][A-Za-z0-9]*$/.test(item.icon))
      .map((item) => item.icon);
    expect(bad, '图标键里出现了字符 / 中文 / 符号').toEqual([]);
  });

  it('气泡菜单不再内联字符字形（H1 / H2 / </> 已换成同一套图标）', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../../views/BubbleMenu.vue', import.meta.url)),
      'utf8',
    );
    expect(src).not.toMatch(/&lt;\/&gt;/);
    expect(src).not.toMatch(/>\s*H[123]\s*</);
    expect(src).toContain('name="heading1"');
    expect(src).toContain('name="heading2"');
  });
});
