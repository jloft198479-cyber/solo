// @vitest-environment happy-dom
import { Editor } from '@tiptap/vue-3';
import { ref } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';

import { createEditorExtensions } from '../../editor-extensions';
import { executeEditorCommand, runBubbleMenuAction } from '../../editor-commands';
import { slashCommandItems } from '../../extensions/slash-commands';
import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';
import { serializeMarkdown } from '../../markdown/serializer';

/**
 * 列表语义契约的行为锁（规则来源：docs/PROPOSAL-list-semantics.md）。
 *
 * 两条动词，职责分离，各自一句话：
 * - **清除格式** = 洗澡：只去装饰（粗体/斜体/高亮/链接…），**块类型与缩进一概不动**。
 * - **转普通段落**（Ctrl+0 / 命令面板「普通段落」/ 斜杠「正文」）= 换身份：
 *   把该块换成段落，它直属的下级**整体减一级**，其余一律不动。
 *
 * ⚠️ 反向校准：把 `editor-commands.ts` 里对 `demoteListItemToBlock` 的调用去掉，
 *    「转普通段落」那几条必须转红；把 `unsetAllMarks` 换回 `clearNodes().unsetAllMarks()`，
 *    「清除格式」那几条必须转红。红得起来才说明这些锁不是摆设。
 *
 * ⚠️ happy-dom，非 WebView2 真机（AGENTS §4：UI 改动单测只是入场券）。
 */

const schema = createTestSchema();

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

function makeEditor(md: string): Editor {
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
    content: parseMarkdown(schema, md).toJSON(),
  });
  editors.push(editor);
  return editor;
}

/**
 * 把选区精确放到「含有指定文字」的位置。
 *
 * 不用 `editor.commands.setTextSelection('甲')`：它不接受字符串搜索语义，传字符串时
 * 选区**不会移动**，停在文档开头 —— 目标块不在首位时测的就是另一个块了。
 * 找不到锚点**直接抛错**，绝不能静默测错位置。
 */
function selectText(editor: Editor, needle: string): void {
  let anchor = -1;
  editor.state.doc.descendants((node, pos) => {
    if (anchor >= 0) return false;
    if (!node.isText || !node.text) return true;
    const hit = node.text.indexOf(needle);
    if (hit >= 0) anchor = pos + hit;
    return true;
  });
  if (anchor < 0) throw new Error(`测试锚点未命中：${needle}`);
  editor.commands.setTextSelection({ from: anchor, to: anchor + needle.length });
}

/** 落盘结果（去首尾空行，避开 StarterKit 补的尾随空段落造成的无信息量红） */
function saved(editor: Editor): string {
  return serializeMarkdown(editor.state.doc).trim();
}

/** 走「未经本模块」的原始命令得到基线 —— 用于锁定「没被接管的路径逐字节不变」 */
function legacySaved(md: string, needle: string, action: 'clear' | 'paragraph'): string {
  const editor = makeEditor(md);
  selectText(editor, needle);
  if (action === 'clear') editor.chain().focus().clearNodes().unsetAllMarks().run();
  else editor.chain().focus().setParagraph().run();
  return saved(editor);
}

/** 走真实按键链（同 list-backspace.spec.ts 的 pressAt 做法） */
function pressMod0(editor: Editor): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: '0', ctrlKey: true }),
  );
}

/** 用户报障时的真实结构：B 是父项（带子树），C 是夹在中间的叶子项，A 是另一个顶层项 */
const MD = '- B\n  - D\n    - 1\n    - 2\n    - 3\n  - C\n  - E\n- A\n';

describe('清除格式 = 洗澡，不动骨（层级一个字都不许变）', () => {
  it('给父项清除格式：结构完全不变', () => {
    const editor = makeEditor(MD);
    selectText(editor, 'B');
    runBubbleMenuAction(editor, 'clearFormat');
    expect(saved(editor)).toBe(MD.trim());
  });

  it('给叶子项 C 清除格式：结构完全不变（旧行为会误伤父项 B）', () => {
    const editor = makeEditor(MD);
    selectText(editor, 'C');
    runBubbleMenuAction(editor, 'clearFormat');
    expect(saved(editor)).toBe(MD.trim());
  });

  it('去掉粗体等装饰，但列表符号与层级原样保留', () => {
    const editor = makeEditor('- **甲**\n  - 乙\n');
    selectText(editor, '甲');
    runBubbleMenuAction(editor, 'clearFormat');

    const first = editor.state.doc.maybeChild(0);
    expect(first?.type.name).toBe('bulletList');
    expect(first?.firstChild?.firstChild?.marks ?? []).toHaveLength(0);
    expect(saved(editor)).toBe('- 甲\n  - 乙');
  });

  it('标题上的清除格式：标题仍是标题（不清块类型）', () => {
    const md = '# 标题\n\n正文\n';
    const editor = makeEditor(md);
    selectText(editor, '标题');
    runBubbleMenuAction(editor, 'clearFormat');
    expect(saved(editor)).toBe('# 标题\n\n正文');
  });
});

describe('转普通段落 = 换身份，下级减一级、其余不动', () => {
  it('Ctrl+0 在父项 B 上：B 变段落，D（带 1/2/3）与 C/E 减一级，A 不动', () => {
    const editor = makeEditor(MD);
    selectText(editor, 'B');
    pressMod0(editor);
    expect(saved(editor)).toBe('B\n\n- D\n  - 1\n  - 2\n  - 3\n- C\n- E\n- A');
  });

  it('命令面板入口与键盘入口同结果', () => {
    const editor = makeEditor(MD);
    selectText(editor, 'B');
    executeEditorCommand(editor, 'editor.paragraph');
    expect(saved(editor)).toBe('B\n\n- D\n  - 1\n  - 2\n  - 3\n- C\n- E\n- A');
  });

  it('斜杠命令「正文」入口同样托孤', () => {
    const editor = makeEditor('- 甲/zw\n  - 乙\n');
    const slash = '/zw';
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return true;
      const hit = node.text.indexOf(slash);
      if (hit >= 0) at = pos + hit;
      return true;
    });
    editor.commands.setTextSelection({ from: at, to: at + slash.length });
    const item = slashCommandItems.find((i) => i.title === '正文')!;
    item.command({ editor, range: { from: at, to: at + slash.length } as never });

    expect(saved(editor)).toBe('甲\n\n- 乙');
  });

  it('三层嵌套：子的子仍跟着自己的父，层级差不变', () => {
    const editor = makeEditor('- 甲\n  - 乙\n    - 丁\n');
    selectText(editor, '甲');
    pressMod0(editor);
    expect(saved(editor)).toBe('甲\n\n- 乙\n  - 丁');
  });

  it('待办项作父（正文被包在 div 里）同样成立', () => {
    const editor = makeEditor('- [ ] 甲\n  - 乙\n');
    selectText(editor, '甲');
    pressMod0(editor);
    expect(saved(editor)).toBe('甲\n\n- 乙');
  });

  it('一次 Ctrl+Z 回到原样（单事务）', () => {
    const editor = makeEditor('- 甲\n  - 乙\n  - 丙\n');
    selectText(editor, '甲');
    pressMod0(editor);
    expect(saved(editor)).toBe('甲\n\n- 乙\n- 丙');

    expect(editor.commands.undo()).toBe(true);
    expect(saved(editor)).toBe('- 甲\n  - 乙\n  - 丙');
  });

  it('历史畸形结构（空壳列表项）能被收拾干净', () => {
    // 这就是修复前会落出的 `- - 乙`：中间那层列表项没有自己的正文
    const editor = makeEditor('- - 乙\n  - 丙\n');
    selectText(editor, '乙');
    pressMod0(editor);
    expect(saved(editor)).not.toContain('- -');
  });
});

describe('不该管的别管（零副作用降级）', () => {
  it('嵌套叶子项转段落：自己真正退出列表（零缩进），祖先与兄弟层级不动', () => {
    // 嵌套项被「转普通段落」必须彻底脱离 listItem（公理 1），而不是留在父项里当 2 空格缩进段落。
    const editor = makeEditor(MD);
    const before = textSeq(editor);
    selectText(editor, 'C');
    pressMod0(editor);
    const out = saved(editor);

    // 文字守恒（不丢字、不重复）
    expect([...textSeq(editor)].sort()).toEqual([...before].sort());
    // C 不再是列表项，而是零缩进的纯段落（真正退出列表）
    expect(out).not.toContain('- C');
    expect(out.split('\n').some((l) => l === 'C')).toBe(true);
    // 兄弟 D（带 1/2/3）与 E 仍在 B 之下，层级没变
    expect(out).toContain('  - D');
    expect(out).toContain('    - 1');
    expect(out).toContain('  - E');
    // 祖先 B / A 仍是顶层项（祖先层级不动，公理 3）
    expect(out.startsWith('- B')).toBe(true);
    expect(out.trimEnd().endsWith('- A')).toBe(true);
  });

  it('普通段落上的清除格式：结果逐字节等于原路径', () => {
    const md = '**粗体段落**\n';
    const editor = makeEditor(md);
    selectText(editor, '粗体段落');
    runBubbleMenuAction(editor, 'clearFormat');
    expect(saved(editor)).toBe(legacySaved(md, '粗体段落', 'clear'));
  });
});

/**
 * 输入矩阵 + 不变量检查（第三方复测后补）。
 *
 * 为什么要有这一层：固定字符串断言只能证明「我测过的那几个输入对」，
 * 证明不了「换个输入也对」。真正的判据是**不变量** ——
 *   ① 文字守恒（不丢字、不重复） ② 次序守恒 ③ 不产出 `- -` 畸形壳。
 */
function textSeq(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isText && node.text) out.push(node.text);
    return true;
  });
  return out;
}

const MATRIX: { name: string; md: string; target: string; order: 'keep' | string[]; nested?: boolean }[] = [
  { name: '目标前有兄弟', md: '- 前\n- 甲\n  - 乙\n- 后\n', target: '甲', order: 'keep' },
  { name: '目标在末位', md: '- 前\n- 甲\n  - 乙\n', target: '甲', order: 'keep' },
  // 嵌套目标：Ctrl+0 后整体「退出列表」落到文档级（末尾），故次序里 B 移到最后
  { name: '深层目标（嵌套在父项里）', md: '- A\n  - B\n    - C\n    - E\n', target: 'B', order: ['A', 'C', 'E', 'B'], nested: true },
  { name: '双子列表混排（无序+有序）', md: '- 甲\n  - 乙\n  1. 丙\n', target: '甲', order: 'keep' },
  { name: '三层 + 兄弟', md: '- 上\n- 甲\n  - 乙\n    - 丙\n- 下\n', target: '甲', order: 'keep' },
];

describe('输入矩阵 · 不变量（文字守恒 / 次序守恒 / 无畸形壳 / 缩进归零）', () => {
  for (const c of MATRIX) {
    it(c.name + '：Ctrl+0 后文字与次序不变、不产畸形壳、嵌套项真正退出列表', () => {
      const editor = makeEditor(c.md);
      const before = textSeq(editor);
      selectText(editor, c.target);
      pressMod0(editor);
      const out = saved(editor);

      // ① 文字守恒（不丢字、不重复）—— 用多重集比对，避免次序干扰
      expect([...textSeq(editor)].sort()).toEqual([...before].sort());
      // ② 次序：顶层目标原地不变；嵌套目标整体移到末尾（契约「退出列表」的必然结果）
      const expectOrder = c.order === 'keep' ? before : c.order;
      expect(textSeq(editor)).toEqual(expectOrder);
      // ③ 无畸形壳（既 `- -` 也含 `- [ ] -`）
      expect(out).not.toContain('- -');
      expect(out).not.toContain('- [ ] -');
      // ④ 嵌套目标：落盘行首无空格（缩进归零，公理 1）
      if (c.nested) {
        const lines = out.split('\n').filter((l) => l.trim() === c.target);
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.every((l) => !l.startsWith(' '))).toBe(true);
      }
    });
  }

  describe('公理 3：祖先层级不被改动（嵌套托孤不外溢）', () => {
    it('B1 深层目标：A/E 顶层不变，C 上提到 A 下，B 真正退出到文档级', () => {
      const md = '- A\n  - B\n    - C\n- E\n';
      const editor = makeEditor(md);
      const before = textSeq(editor);
      selectText(editor, 'B');
      pressMod0(editor);
      const out = saved(editor);

      expect([...textSeq(editor)].sort()).toEqual([...before].sort()); // 文字守恒
      expect(out).not.toContain('- -'); // 无畸形壳
      const lines = out.split('\n');
      expect(lines.some((l) => l === '- A')).toBe(true); // A 仍是顶层项
      expect(lines.some((l) => l === '- E')).toBe(true); // E 仍是顶层项（祖先层级不动）
      expect(lines.some((l) => l === 'B')).toBe(true); // B 真正退出：文档级段落
      expect(out).not.toContain('- B'); // B 不再是列表项
      expect(out).toContain('  - C'); // C 仍在 A 之下（托孤，非外溢）
    });

    it('B2 叶子中间项：B/A 顶层不变，D/E 仍在 B 下，C 真正退出到文档级', () => {
      const md = '- B\n  - D\n  - C\n  - E\n- A\n';
      const editor = makeEditor(md);
      const before = textSeq(editor);
      selectText(editor, 'C');
      pressMod0(editor);
      const out = saved(editor);

      expect([...textSeq(editor)].sort()).toEqual([...before].sort());
      expect(out).not.toContain('- -');
      const lines = out.split('\n');
      expect(lines.some((l) => l === '- B')).toBe(true);
      expect(lines.some((l) => l === '- A')).toBe(true);
      expect(lines.some((l) => l === 'C')).toBe(true);
      expect(out).not.toContain('- C'); // C 不再是列表项
      expect(out).toContain('  - D'); // 兄弟 D 仍在 B 下
      expect(out).toContain('  - E'); // 兄弟 E 仍在 B 下
    });
  });

  it('待办列表 toggle 第二次（退出）：不产出 `- - 乙` 畸形', () => {
    const editor = makeEditor('- [ ] 甲\n  - 乙\n');
    const before = textSeq(editor);
    selectText(editor, '甲');
    executeEditorCommand(editor, 'editor.taskList');

    expect(saved(editor)).not.toContain('- -');
    expect(textSeq(editor)).toEqual(before);
  });

  // 🔴A 的真触发形态：父容器是 bulletList 且混编 taskItem + listItem（D2 点名的缺口）
  it('待办列表 toggle（父容器混编 taskItem+listItem）：不产出 `- [ ] - 乙` 畸形', () => {
    const editor = makeEditor('- [ ] 甲\n  - 乙\n- 丙\n');
    const before = textSeq(editor);
    selectText(editor, '甲');
    executeEditorCommand(editor, 'editor.taskList');

    expect(saved(editor)).not.toContain('- [ ] -'); // 关键：混编父容器下不能补出畸形壳
    expect(saved(editor)).not.toContain('- -');
    expect(textSeq(editor)).toEqual(before);
  });

  // 多块列表项（项内同时有段落和子列表）：能跑且有锁
  it('多块列表项转段落：段落变成纯段落、子列表托孤，不产畸形', () => {
    const editor = makeEditor('- 甲\n  正文一段\n  - 乙\n');
    const before = textSeq(editor);
    selectText(editor, '甲');
    pressMod0(editor);

    expect([...textSeq(editor)].sort()).toEqual([...before].sort());
    expect(saved(editor)).not.toContain('- -');
    expect(saved(editor)).not.toContain('- [ ] -');
  });

  it('无序列表 toggle 第二次（退出）：同样不产畸形', () => {
    const editor = makeEditor('- 甲\n  - 乙\n  - 丙\n');
    const before = textSeq(editor);
    selectText(editor, '甲');
    executeEditorCommand(editor, 'editor.bulletList');

    expect(saved(editor)).not.toContain('- -');
    expect(textSeq(editor)).toEqual(before);
  });

  it('清除格式在矩阵里同样不改结构（只去装饰）', () => {
    for (const c of MATRIX) {
      const editor = makeEditor(c.md);
      selectText(editor, c.target);
      runBubbleMenuAction(editor, 'clearFormat');
      expect(saved(editor)).toBe(c.md.trim());
    }
  });
});
