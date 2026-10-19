// @vitest-environment happy-dom
import { Editor } from '@tiptap/vue-3';
import { ref } from 'vue';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';

import { createEditorExtensions } from '../../editor-extensions';
import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';
import { serializeMarkdown } from '../../markdown/serializer';

/**
 * 列表「行首 Backspace 劈开列表」的**行为契约锁**（方案 `PROPOSAL-list-structure-fix.md` §六 阶段 1）。
 *
 * 为什么要有这一份：`- 甲 / - 乙 / - 丙` 里把光标放到「乙」行首按一次 Backspace，
 * 上游 `liftOutOfList`（`prosemirror-schema-list`）会把列表**切成两个 `bulletList`、
 * 中间夹一个 doc 层孤立段落**——而且原样落盘、重开结构不变。它正是用户报的
 * 「列表里母主题无法用 `Alt+↑/↓` 换位」的真因（`moveListItem` 只挪同容器兄弟）。
 *
 * 本文件锁的是**期望的新行为**（§七 九条决定）：行首 Backspace ＝ **并回上一行**，
 * 永不劈开列表。**修复前应当是红的**——红灯即「劈开」这一禁止态的现形。
 *
 * ⚠️ 跑在 happy-dom，不是 WebView2 真机（AGENTS §4：键位/UI 改动单测只是入场券，
 *    阶段 3 必须真机复核）。
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
 * 顶层块列表 —— 丢掉 StarterKit `TrailingNode` 补的那个空段落。
 * 它是环境噪声（文档以列表结尾时必然补一个），与本契约无关；
 * 不丢的话每条断言都会被它带红，红得没有信息量。
 */
function topNodes(doc: PMNode): PMNode[] {
  const nodes: PMNode[] = [];
  doc.forEach((n) => nodes.push(n));
  while (
    nodes.length > 1 &&
    nodes[nodes.length - 1].type.name === 'paragraph' &&
    nodes[nodes.length - 1].textContent === ''
  ) {
    nodes.pop();
  }
  return nodes;
}

/** 顶层块类型序列——「劈开」的特征就是 doc 层凭空多出一个 paragraph */
function topLevelTypes(doc: PMNode): string[] {
  return topNodes(doc).map((n) => n.type.name);
}

/** 人类可读的结构签名：失败报文里一眼看得出劈没劈 */
function treeSig(doc: PMNode): string {
  const parts: string[] = [];
  for (const n of topNodes(doc)) {
    if (n.type.name === 'bulletList' || n.type.name === 'taskList') {
      const items: string[] = [];
      n.forEach((li) => items.push(`「${li.textContent}」`));
      parts.push(`${n.type.name}(${items.join(' / ')})`);
    } else {
      parts.push(`${n.type.name}「${n.textContent}」`);
    }
  }
  return parts.join(' + ');
}

/** 某段文本的起点绝对位置（descendants 给的 pos 即文本自身起点） */
function posOfText(doc: PMNode, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text === text) {
      found = pos;
      return false;
    }
    return true;
  });
  if (found < 0) throw new Error(`找不到文本「${text}」`);
  return found;
}

/** 已自行摆好选区 / 光标时，只打一次真实 keydown（走 PM/DOM 全链路） */
function pressKey(editor: Editor, init: KeyboardEventInit): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
  );
}

/**
 * 把光标放到某段文本的第 `offset` 个字符处，然后打一次真实 keydown。
 *
 * ⚠️ `offset` 默认为 0＝文本起点。**这一默认值正是「Shift-Tab 假绿灯」的来源**
 * （台账 §二 #55）：守卫旧门槛要求 offset 0，而真实用户按 Shift-Tab 时光标
 * 多半停在字中间 ⇒ 断言必须显式传 offset>0 才盖得住那条路径。
 */
function pressAt(editor: Editor, text: string, init: KeyboardEventInit, offset = 0): void {
  editor.commands.setTextSelection(posOfText(editor.state.doc, text) + offset);
  pressKey(editor, init);
}

const THREE = '- 甲\n- 乙\n- 丙\n';

describe('列表行首 Backspace 契约（修复前应红）', () => {
  it('基准：结构与坐标（后面的断言都依赖它）', () => {
    const doc = parseMarkdown(schema, THREE);
    expect(treeSig(doc)).toBe('bulletList(「甲」 / 「乙」 / 「丙」)');
    expect(posOfText(doc, '乙')).toBe(8);
  });

  it('【禁止劈开】中间项行首 Backspace ⇒ 并进上一项，列表仍是一个容器', () => {
    const editor = makeEditor(THREE);
    pressAt(editor, '乙', { key: 'Backspace' });
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲乙」 / 「丙」)');
    expect(topLevelTypes(editor.state.doc)).toEqual(['bulletList']);
  });

  it('【禁止劈开】末项行首 Backspace ⇒ 并进上一项', () => {
    const editor = makeEditor(THREE);
    pressAt(editor, '丙', { key: 'Backspace' });
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」 / 「乙丙」)');
  });

  it('顶层首项行首 Backspace：前面是段落 ⇒ 并进那个段落', () => {
    const editor = makeEditor('正文\n\n- 甲\n- 乙\n');
    pressAt(editor, '甲', { key: 'Backspace' });
    expect(treeSig(editor.state.doc)).toBe('paragraph「正文甲」 + bulletList(「乙」)');
  });

  it('顶层首项行首 Backspace 且列表是文档第一块（无前驱）⇒ 不动', () => {
    const editor = makeEditor('- 甲\n- 乙\n');
    pressAt(editor, '甲', { key: 'Backspace' });
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」 / 「乙」)');
  });

  it('回归锁：单项列表行首 Backspace ⇒ 退出列表变普通段落（保持现状）', () => {
    const editor = makeEditor('- 甲\n');
    pressAt(editor, '甲', { key: 'Backspace' });
    expect(treeSig(editor.state.doc)).toBe('paragraph「甲」');
  });

  it('回归锁：嵌套子项行首 Backspace ⇒ 只提升一级，不劈开', () => {
    const editor = makeEditor('- 甲\n  - 甲1\n- 乙\n');
    pressAt(editor, '甲1', { key: 'Backspace' });
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」 / 「甲1」 / 「乙」)');
    expect(topLevelTypes(editor.state.doc)).toEqual(['bulletList']);
  });

  it('【禁止劈开】Mod-Backspace 与 Backspace 同罪，必须同批治', () => {
    const editor = makeEditor(THREE);
    pressAt(editor, '乙', { key: 'Backspace', ctrlKey: true });
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲乙」 / 「丙」)');
    expect(topLevelTypes(editor.state.doc)).toEqual(['bulletList']);
  });

  it('【禁止劈开】Shift+Tab 不得把列表切成两段（只锁「不许劈」，不锁具体行为）', () => {
    const editor = makeEditor(THREE);
    pressAt(editor, '乙', { key: 'Tab', shiftKey: true });
    expect(topLevelTypes(editor.state.doc)).toEqual(['bulletList']);
  });

  it('【组字门控】中文组字期间按 Backspace 不得改动结构', () => {
    const editor = makeEditor(THREE);
    editor.commands.setTextSelection(posOfText(editor.state.doc, '乙'));
    editor.view.dom.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    );
    expect(editor.view.composing, '前置条件：组字态没置上，后面的断言就是假的').toBe(true);

    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Backspace' }),
    );
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」 / 「乙」 / 「丙」)');
  });
});

describe('删光一项文字后退格 ⇒ 空项整行消失（2026-10-10 用户报告「列表删不掉」）', () => {
  /** 用户操作：选中某项文字删除（行内容删光），再按退格想删掉这一行 */
  function clearTextThenBackspace(editor: Editor, text: string): void {
    const from = posOfText(editor.state.doc, text);
    editor.commands.setTextSelection({ from, to: from + text.length });
    editor.commands.deleteSelection();
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Backspace' }),
    );
  }

  it('【圆点不留壳】末项删空后退格 ⇒ 整个空项消失', () => {
    const editor = makeEditor('- 甲\n- 乙\n');
    clearTextThenBackspace(editor, '乙');
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」)');
  });

  it('【圆点不留壳】中间项删空后退格 ⇒ 空项消失、列表不劈', () => {
    const editor = makeEditor(THREE);
    clearTextThenBackspace(editor, '乙');
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」 / 「丙」)');
    expect(topLevelTypes(editor.state.doc)).toEqual(['bulletList']);
  });
});

/**
 * 空壳列表项（空段 + 子列表）的行首退格（2026-10-19 用户报告「一行两个圆点」）。
 *
 * 病：父项 A 下挂 A1，回车另起一项（旧行为把 A1 甩给了新项），再删空新项按退格——
 * 守卫只删掉空段落，留下 `listItem(bulletList(A1))` 这个**没有正文的圆点壳**：
 * 壳的 marker 与子项 marker 挤在同一行（配合 `li ul` 的竖引导线，正是用户截图），
 * 落盘 `- - A1`。期望（同 list-demote 的托孤契约）：壳溶解、子项升一级。
 *
 * ⚠️ 反向校准：撤掉 `isPureShell` 分支 ⇒ 本组转红（旧实现只剩空壳）。
 * 注意不能拿 `treeSig` 当唯一判据——它拍平 textContent，看不见壳（「假锁」陷阱：
 * 旧实现下 `treeSig` 同样是 `bulletList(「A」 / 「A1」)`），故必须断言**每项首块是正文**。
 */
describe('空壳项：空段 + 子列表的行首退格 ⇒ 壳溶解（2026-10-19 用户报告）', () => {
  /**
   * 复刻用户路径：光标所在项**原本有子列表**，把正文删光后再按退格。
   * 注意不能直接拿 markdown `- \\n  - A1` 造场景——解析出来是「只有子列表」的壳，
   * 没有空段落可删，走不到守卫（那条路是历史文件遗留，另行处理）。
   */
  function clearTextThenBackspace(editor: Editor, text: string): void {
    const from = posOfText(editor.state.doc, text);
    editor.commands.setTextSelection({ from, to: from + text.length });
    editor.commands.deleteSelection();
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Backspace' }),
    );
  }

  it('壳溶解：子项升一级，落盘不再出现 `- - `', () => {
    const editor = makeEditor('- A\n- A0\n  - A1\n');
    clearTextThenBackspace(editor, 'A0');

    const doc = editor.state.doc;
    const list = topNodes(doc)[0];
    expect(list.type.name).toBe('bulletList');
    expect(list.childCount).toBe(2);
    // 承重断言：每一项的首块都必须是正文块 —— 空壳项的首块会是子列表
    list.forEach((li, _offset, i) => {
      expect(li.firstChild?.type.name, `第 ${i + 1} 项留下了没有正文的空壳`).toBe('paragraph');
    });
    expect(serializeMarkdown(doc)).not.toContain('- - ');
  });

  it('壳在中间：托孤后兄弟顺序不变', () => {
    const editor = makeEditor('- A\n- A0\n  - A1\n- B\n');
    clearTextThenBackspace(editor, 'A0');
    expect(treeSig(editor.state.doc)).toBe('bulletList(「A」 / 「A1」 / 「B」)');
    expect(serializeMarkdown(editor.state.doc)).not.toContain('- - ');
  });

  // ⚠️ 非承重锁：撤掉上面的壳溶解分支，这条**仍然是绿**（旧路径也把光标送回 A 末尾）
  // —— 只作意图哨兵，防未来改光标落点时无声退化，不当「修复生效」的证据。
  it('光标落到前一项末尾（用户预期「光标到 A 项后」）', () => {
    const editor = makeEditor('- A\n- A0\n  - A1\n');
    clearTextThenBackspace(editor, 'A0');
    const $from = editor.state.selection.$from;
    expect($from.parent.textContent).toBe('A');
    expect($from.parentOffset).toBe(1);
  });
});

describe('嵌套首项行首退格：不得降级成段落（2026-10-19 体检 P2）', () => {
  it('带后随兄弟：A1 仍是列表项，整体提升一级', () => {
    const editor = makeEditor('- A\n  - A1\n  - A2\n');
    pressAt(editor, 'A1', { key: 'Backspace' });

    const list = topNodes(editor.state.doc)[0];
    expect(list.type.name).toBe('bulletList');
    expect(list.childCount, '顶层仍是一张列表、两项').toBe(2);
    // 承重断言：旧实现会把 A1 降级成 A 项里的第二段（圆点消失）
    expect(list.child(0).childCount, 'A 项里不应出现第二段').toBe(1);
    expect(list.child(1).firstChild?.type.name).toBe('paragraph');
    expect(list.child(1).firstChild?.textContent).toBe('A1');
    expect(serializeMarkdown(editor.state.doc)).toBe('- A\n- A1\n  - A2\n');
  });

  it('带孙 + 后随兄弟：子树跟着 A1 一起走', () => {
    const editor = makeEditor('- A\n  - A1\n    - A1a\n  - A2\n');
    pressAt(editor, 'A1', { key: 'Backspace' });
    expect(serializeMarkdown(editor.state.doc)).toBe('- A\n- A1\n  - A1a\n  - A2\n');
  });

  it('回归：嵌套非首项仍并进上一项（守卫不能放宽过头）', () => {
    const editor = makeEditor('- A\n  - A1\n  - A2\n');
    pressAt(editor, 'A2', { key: 'Backspace' });
    const list = topNodes(editor.state.doc)[0];
    expect(list.childCount).toBe(1);
    const inner = list.child(0).child(1);
    expect(inner.type.name).toBe('bulletList');
    expect(inner.childCount).toBe(1);
    expect(inner.child(0).textContent).toBe('A1A2');
  });
});

/**
 * 列表内 Shift-Tab 的**新契约**（2026-10-11 方案 B；台账 §二 #55）。
 *
 * **病**：旧门槛要求「光标停在项首块 offset 0」⇒ 用户在字中间按 Shift-Tab（随手按的
 * 常态位置）落到上游 `liftOutOfList` 拆容器 —— 中间项＝劈成两段 + 中间夹 doc 层孤立
 * 段落、首/末项＝把该项甩成 doc 层段落、有选区时甚至整张列表解散；且原样落盘。
 * **药**：门槛改成「在不在项内」，顶层项一律吞掉（no-op）——顶层缩进已是 0，
 * 「−1」越界（契约 §2 把 Shift+Tab 定义为「缩进 ±1 的唯一微调动词」）。
 *
 * ⚠️ **反向校准（2026-10-11 实跑）**：把 `handleListShiftTab` 的门槛改回
 * `resolveGuardContext` ⇒ 前 4 条 + 公理 3 那条共 **5 条转红**；恢复方案 B 后 21 条全绿
 * ⇒ 锁真承重。
 * ⚠️ **例外**：「组字门控」那条**在两种实现下都绿**——不是锁失效，而是 PM 的 keydown
 * 层本来就在合成态忽略按键（`prosemirror-view/dist/index.js:3189` `editHandlers.keydown`
 * → `:3192` `inOrNearComposition` → `:3548` `view.composing ⇒ true`）⇒ 它测不到本扩展的
 * `isFrozen` 分支，只作**意图哨兵**（防未来上游行为变化），**不当承重锁**。
 */
describe('列表内 Shift-Tab：顶层项一律 no-op（2026-10-11 方案 B）', () => {
  const TAB = { key: 'Tab', shiftKey: true };

  it('【禁止拆容器】顶层中间项 项内 offset=1 ⇒ 结构原样不动', () => {
    const editor = makeEditor(THREE);
    pressAt(editor, '乙', TAB, 1);
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」 / 「乙」 / 「丙」)');
    expect(topLevelTypes(editor.state.doc)).toEqual(['bulletList']);
  });

  it('【禁止拆容器】顶层首项 项内 offset=1 ⇒ 原样不动', () => {
    const editor = makeEditor(THREE);
    pressAt(editor, '甲', TAB, 1);
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」 / 「乙」 / 「丙」)');
    expect(topLevelTypes(editor.state.doc)).toEqual(['bulletList']);
  });

  it('【禁止留孤立段落】顶层末项 项内 offset=1 ⇒ 原样不动', () => {
    const editor = makeEditor(THREE);
    pressAt(editor, '丙', TAB, 1);
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」 / 「乙」 / 「丙」)');
    expect(topLevelTypes(editor.state.doc)).toEqual(['bulletList']);
  });

  it('【单项列表】项内 offset=1 ⇒ 原样不动（不再退出列表）', () => {
    const editor = makeEditor('- 甲\n');
    pressAt(editor, '甲', TAB, 1);
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」)');
  });

  it('【公理 3 不外溢】顶层中间项：逐格 offset 1..3 ⇒ 未选中项一字不动', () => {
    for (const offset of [1, 2, 3]) {
      const editor = makeEditor('- 甲\n- 乙bbb\n- 丙\n');
      pressAt(editor, '乙bbb', TAB, offset);
      expect(treeSig(editor.state.doc), `offset=${offset}`).toBe(
        'bulletList(「甲」 / 「乙bbb」 / 「丙」)',
      );
    }
  });

  it('【回归】嵌套子项 项内 offset=1 ⇒ 仍只提升一级（上游语义不受影响）', () => {
    const editor = makeEditor('- 甲\n  - 甲1\n- 乙\n');
    pressAt(editor, '甲1', TAB, 1);
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」 / 「甲1」 / 「乙」)');
    expect(topLevelTypes(editor.state.doc)).toEqual(['bulletList']);
  });

  it('【组字门控·意图哨兵】组字期间 Shift-Tab（嵌套项内）不得改动结构', () => {
    // 用**嵌套项**而不是顶层项：顶层项在方案 B 下本来就吞掉，拿它测不出 isFrozen 门控；
    // 嵌套项若在组字期放行上游，就会当场反缩进（内层列表被提到顶层）。
    // ⚠️ 但实测（2026-10-11）：本用例在**撤掉 isFrozen 门控**时仍是绿的 —— 因为 PM 的
    // keydown 层在合成态直接忽略按键（prosemirror-view:3189/3192/3548）⇒ 上游与本扩展
    // 都收不到键。故它是**意图哨兵**（防上游行为变化），不是本改动的承重锁。
    const editor = makeEditor('- 甲\n  - 甲1\n- 乙\n');
    editor.commands.setTextSelection(posOfText(editor.state.doc, '甲1') + 1);
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(editor.view.composing, '前置条件：组字态没置上，后面的断言就是假的').toBe(true);
    pressKey(editor, TAB);

    const list = topNodes(editor.state.doc)[0];
    expect(list.type.name).toBe('bulletList');
    expect(list.childCount, '外层仍应是 2 项（甲、乙）——反缩进会变成 3 项平铺').toBe(2);
    expect(list.child(0).childCount, '第一项内仍应是 [段落, 子列表]').toBe(2);
    expect(list.child(0).child(1).type.name, '子列表必须还在项内').toBe('bulletList');
  });

  it('【现状登记 · D2 未收编】有选区（落在单项内）⇒ 仍放行上游（会拆容器）', () => {
    const editor = makeEditor(THREE);
    const from = posOfText(editor.state.doc, '乙');
    editor.commands.setTextSelection({ from, to: from + 1 });
    pressKey(editor, TAB);
    // ⚠️ 断的是**现状**：D2「有选区是否一并收编」已拍板「暂不行动」（PROPOSAL-list-shifttab §6）。
    // 将来若收编，本断言随契约改写；在那之前它承担「被静默改掉就会红」的哨兵职责。
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」) + paragraph「乙」 + bulletList(「丙」)');
  });

  it('【现状登记 · D2 未收编】有选区（跨两项）⇒ 仍放行上游（整张列表解散）', () => {
    const editor = makeEditor(THREE);
    const from = posOfText(editor.state.doc, '甲');
    const to = posOfText(editor.state.doc, '丙') + 1;
    editor.commands.setTextSelection({ from, to });
    pressKey(editor, TAB);
    expect(treeSig(editor.state.doc)).toBe('paragraph「甲」 + paragraph「乙」 + paragraph「丙」');
  });
});
