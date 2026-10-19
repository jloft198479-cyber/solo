// @vitest-environment happy-dom
/**
 * 折叠装饰「局部重建」的正确性契约（2026-10-19 阶段 2）。
 *
 * 判据（最硬的一条）：**局部重建后的装饰集合，必须与「同一份文档全量重建」逐项一致**。
 * 每个场景先跑真实操作，再用 `createListFoldPlugin()` 对结果文档新建一个 state（其 init
 * 走全量构建），两边的箭头位置 / 隐藏范围必须完全相同 —— 漏一个窗口边界就会红。
 *
 * 第二组锁（`窗口真的收窄了`）补的是第一组的盲区：窗口算不出来时会退回**全量重建**，
 * 而全量重建与全量重建必然「一致」——只测一致性的话，把 `computeRebuildWindow`
 * 改成恒返回 null 也照样全绿。故另有一条：远离改动的那个箭头，其 `Decoration.type`
 * **必须是同一个实例**（PM 的 `map` 只换外层 Decoration，复用 type；重建则造新 type）。
 * 实例被换了 = 这一趟走了全量重建。
 *
 * 覆盖：行尾/行首/行中回车、Tab 缩进（父项获得子列表）、Shift-Tab、嵌套首项退格、
 * 删唯一子项、删整项、插入新列表、撤销。
 */
import { Editor } from '@tiptap/vue-3';
import { EditorState } from '@tiptap/pm/state';
import { ref } from 'vue';
import type { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { createEditorExtensions } from '../../editor-extensions';
import { createListFoldPlugin, listFoldKey } from '../list-fold';
import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';

const schema = createTestSchema();

function makeEditor(md: string): Editor {
  return new Editor({
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
}

function posOfText(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text === text) {
      found = pos;
      return false;
    }
  });
  return found;
}

interface FoldView {
  arrows: number[];
  hidden: string[];
}

function foldOf(state: EditorState): FoldView {
  const set = listFoldKey.getState(state)!.decorations;
  const all = set.find();
  return {
    arrows: all
      .filter((d) => d.from === d.to)
      .map((d) => d.from)
      .sort((a, b) => a - b),
    hidden: all
      .filter((d) => d.from !== d.to)
      .map((d) => `${d.from}-${d.to}`)
      .sort(),
  };
}

/** 用「全量重建」算出期望值：同一份 doc 新建一个插件 state */
function expected(doc: PMNode): FoldView {
  return foldOf(EditorState.create({ schema, doc, plugins: [createListFoldPlugin()] }));
}

function key(editor: Editor, k: string, mods: KeyboardEventInit = {}): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: k, ...mods }),
  );
}

/**
 * 「首块正文恰好是 text」的列表项的起始位置（-1 = 找不到）。
 * BIG 里每项首块文字互不相同，故可当稳定身份用（位置会随编辑漂移）。
 */
function itemPosOf(doc: PMNode, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name !== 'listItem' && node.type.name !== 'taskItem') return true;
    if (node.firstChild?.textContent !== text) return true;
    found = pos;
    return false;
  });
  return found;
}

/**
 * 某个项的折叠箭头 widget 的 `Decoration.type` 实例。
 *
 * 为什么用实例身份当判据：`DecorationSet.map` 会为每条装饰 `new Decoration(...)`，
 * 但**复用同一个 `WidgetType` 实例**（`prosemirror-view` 的 `WidgetType.map` 里是
 * `new Decoration(pos, pos, this)`）；而重建走 `Decoration.widget()` 会造新
 * `WidgetType`。所以「type 实例没变」⇔「这条装饰没被重扫过」。
 */
function arrowTypeAt(state: EditorState, itemPos: number): unknown {
  const set = listFoldKey.getState(state)!.decorations;
  const p = itemPos + 2; // 箭头挂在首块正文起点，见 list-fold.ts 的 widgetPosOf
  return set.find(p, p).find((d) => d.from === p && d.to === p)?.type;
}

const BIG =
  '- A\n  - A1\n    - A1a\n  - A2\n- B\n\n分隔\n\n- C\n  - C1\n- D\n';

/**
 * 让编辑器「落定」：tiptap 的尾随段落（`TrailingNode`）不会在创建时补上，而是等到
 * **首个 dispatch** 才以 appendTransaction 追加 —— 那一趟 doc 真的变了，走全量重建，
 * 把所有 `WidgetType` 实例换掉。不先空跑，基线就取自「注定被换掉」的那一批，断言必误红。
 *
 * 循环到「空跑也不再改 doc」为止，避免依赖它到底补几次。
 */
function settle(editor: Editor): void {
  let size = editor.state.doc.content.size;
  for (let i = 0; i < 4; i++) {
    editor.view.dispatch(editor.state.tr.setMeta('settle', i));
    if (editor.state.doc.content.size === size) return;
    size = editor.state.doc.content.size;
  }
  throw new Error('编辑器没有落定（doc 一直在变）');
}

interface Case {
  name: string;
  /** 远离本次改动的「哨兵项」：它（含子列表）的箭头不允许被重建 */
  sentinel: string;
  /** 本用例使用的初始文档（默认 BIG） */
  doc?: string;
  /**
   * false = 这个改动**本来就**界定不出窗口，有意退回全量重建。
   * 目前只有一种形态：粘贴的列表落在文档末尾 —— 改动的两侧是列表容器而不是列表项，
   * `itemCoverRange` 的相邻项分支接不住；粘贴是一次性动作，全量扫一遍可接受。
   */
  windowBounded?: boolean;
  run: (editor: Editor) => void;
}

const cases: Case[] = [
  {
    name: '父项行尾回车',
    sentinel: 'C',
    run: (e) => {
      e.commands.setTextSelection(posOfText(e, 'A') + 1);
      key(e, 'Enter');
    },
  },
  {
    name: '父项行首回车',
    sentinel: 'C',
    run: (e) => {
      e.commands.setTextSelection(posOfText(e, 'A'));
      key(e, 'Enter');
    },
  },
  {
    name: '父项行中回车',
    sentinel: 'C',
    run: (e) => {
      e.commands.setTextSelection(posOfText(e, 'A1') + 1);
      key(e, 'Enter');
    },
  },
  {
    name: '带子项的行 Tab 缩进',
    sentinel: 'C',
    run: (e) => {
      e.commands.setTextSelection(posOfText(e, 'B') + 1);
      key(e, 'Tab');
    },
  },
  // ---- 下面两条专门盯「父项的箭头因这次改动而增/删」----
  // 这类形状 BIG 覆盖不到（BIG 里的父项本来就有子项，缩进/反缩进都不改变「有没有子列表」），
  // 而窗口若漏掉父项，父项的箭头就会缺失或残留 —— 正是 `itemCoverRange` 的父项扩展在管。
  // 哨兵放在**另一段列表**里：窗口会把边界处相邻项一并纳入（粗一格），紧邻的项当不了哨兵。
  {
    name: 'Tab 缩进成无子项前项的首个子项（父项新增箭头）',
    doc: '- P\n- Q\n\n分隔\n\n- S\n  - S1\n',
    sentinel: 'S',
    run: (e) => {
      e.commands.setTextSelection(posOfText(e, 'Q') + 1);
      key(e, 'Tab');
    },
  },
  {
    name: 'Shift-Tab 抬走唯一子项（父项箭头消失）',
    doc: '- P\n  - Q\n\n分隔\n\n- S\n  - S1\n',
    sentinel: 'S',
    run: (e) => {
      e.commands.setTextSelection(posOfText(e, 'Q') + 1);
      key(e, 'Tab', { shiftKey: true });
    },
  },
  {
    name: '嵌套项 Shift-Tab 反缩进',
    sentinel: 'C',
    run: (e) => {
      e.commands.setTextSelection(posOfText(e, 'A2') + 1);
      key(e, 'Tab', { shiftKey: true });
    },
  },
  {
    name: '嵌套首项行首退格',
    sentinel: 'C',
    run: (e) => {
      e.commands.setTextSelection(posOfText(e, 'A1'));
      key(e, 'Backspace');
    },
  },
  {
    name: '删除唯一子项（块删除）',
    sentinel: 'A1',
    run: (e) => {
      const start = posOfText(e, 'C1') - 2; // C 的子列表起点附近
      e.view.dispatch(e.state.tr.delete(start, start + 8));
    },
  },
  {
    name: '删除整个带子项的项',
    sentinel: 'C',
    run: (e) => {
      const start = posOfText(e, 'A') - 2;
      const end = posOfText(e, 'B') - 2;
      e.view.dispatch(e.state.tr.delete(start, end));
    },
  },
  {
    name: '插入新列表（模拟粘贴）',
    sentinel: 'C',
    windowBounded: false,
    run: (e) => {
      const child = schema.nodes.bulletList.create(
        null,
        schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, schema.text('X1'))),
      );
      const item = schema.nodes.listItem.create(null, [
        schema.nodes.paragraph.create(null, schema.text('X')),
        child,
      ]);
      e.view.dispatch(
        e.state.tr.insert(e.state.doc.content.size, schema.nodes.bulletList.create(null, item)),
      );
    },
  },
];

describe('局部重建一致性验收', () => {
  for (const c of cases) {
    it(c.name, () => {
      const editor = makeEditor(c.doc ?? BIG);
      c.run(editor);
      const actual = foldOf(editor.state);
      const want = expected(editor.state.doc);
      // 期望：局部重建与全量重建逐项一致（不一致时把两边都打出来，方便一眼看出漏了哪条）
      if (JSON.stringify(actual) !== JSON.stringify(want)) {
        throw new Error(
          `${c.name} 的局部重建结果与全量重建不一致\n` +
            `实际: ${JSON.stringify(actual)}\n期望: ${JSON.stringify(want)}`,
        );
      }
      editor.destroy();
    });
  }
});

describe('窗口真的收窄了（不是退回全量）', () => {
  for (const c of cases) {
    // `windowBounded: false` 的场景界定不出窗口（见 Case 注释），不进这一组
    if (c.windowBounded === false) continue;
    it(c.name, () => {
      const editor = makeEditor(c.doc ?? BIG);
      settle(editor);
      const beforePos = itemPosOf(editor.state.doc, c.sentinel);
      expect(beforePos, `哨兵「${c.sentinel}」原始项找不到`).toBeGreaterThan(-1);
      const beforeType = arrowTypeAt(editor.state, beforePos);
      expect(beforeType, `哨兵「${c.sentinel}」原本没有箭头`).toBeTruthy();

      c.run(editor);

      const afterPos = itemPosOf(editor.state.doc, c.sentinel);
      expect(afterPos, `操作后哨兵「${c.sentinel}」不见了`).toBeGreaterThan(-1);
      // 同一个 WidgetType 实例 = 这条装饰压根没被重扫（走的是局部窗口）
      expect(
        arrowTypeAt(editor.state, afterPos),
        `哨兵「${c.sentinel}」的箭头被重建了 ⇒ 本次改动退回了全量重建`,
      ).toBe(beforeType);

      editor.destroy();
    });
  }
});
