// @vitest-environment happy-dom
/**
 * 折叠装饰「局部重建」的随机一致性验收（种子化，可复现）。
 *
 * 为什么要有这一份：`list-fold-scope.spec.ts` 是定点形状（11 个），人穷举不出
 * 组合爆炸的所有形状（缩进 × 撤销 × 折叠 × 跨列表删除 …）。这里用固定种子随机敲键，
 * 每一步都把「局部重建的实际结果」和「同一份文档全量重建的期望结果」逐项比对：
 * 箭头位置、被隐藏的子列表范围、折叠集合。漏一个窗口边界、多一层重复箭头、折叠位置
 * 没跟着剪枝 —— 都会在这里立刻分叉。
 *
 * 判据是**系统外的标尺**：期望值由「新建一个 state 走 init 全量构建」算出，
 * 不是「跑两遍比一致」那种看不见稳定丢内容的假锁。
 *
 * 种子固定 ⇒ 失败可复现：报错里带 `seed` 与完整操作序列。
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
import { ITEM_NODE_TYPES } from '../../list-move';

const schema = createTestSchema();

/** 覆盖：嵌套 / 有序 / 待办 / 引用 / 多段列表 —— 折叠与结构判定都各有分支 */
const SEED_DOC = [
  '- A',
  '  - A1',
  '    - A1a',
  '  - A2',
  '- B',
  '  - B1',
  '',
  '段落一',
  '',
  '1. 有序一',
  '2. 有序二',
  '   - 深一',
  '- [ ] 待办一',
  '  - [x] 待办二',
  '',
  '> 引用里没有列表',
  '',
  '- C',
  '- D',
  '  - D1',
  '    - D1a',
  '  - D2',
  '',
].join('\n');

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

/** 装饰层 + 折叠集合的快照串：只有三项都相同才算一致 */
function snapshot(state: EditorState): string {
  const s = listFoldKey.getState(state)!;
  const all = s.decorations.find();
  return JSON.stringify({
    arrows: all.filter((d) => d.from === d.to).map((d) => d.from).sort((a, b) => a - b),
    hidden: all.filter((d) => d.from !== d.to).map((d) => `${d.from}-${d.to}`).sort(),
    folded: [...s.folded].sort((a, b) => a - b),
  });
}

/**
 * 同一份文档 + 同一份折叠集合下，**全量重建**的期望快照。
 *
 * 折叠是视图态而非文档属性，新建的 state 只能从「记忆」恢复（本用例无文档路径 ⇒ 恒空），
 * 所以要把实际折叠集合逐个 toggle 灌进去 —— toggle 走的是 `rebuildWindow = null` 的全量
 * 重建路径，得到的正是 `collectDecorations(doc, folded)` 的结果。
 */
function expected(doc: PMNode, folded: number[]): string {
  let state = EditorState.create({ schema, doc, plugins: [createListFoldPlugin()] });
  for (const pos of folded) {
    state = state.apply(state.tr.setMeta(listFoldKey, { toggle: pos }));
  }
  return snapshot(state);
}

/** xorshift32：固定种子 ⇒ 序列可复现 */
function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/** 随机找一个「含子列表的列表项」的位置（折叠只对这些项有意义） */
function randomFoldableItem(doc: PMNode, rand: () => number): number | null {
  const candidates: number[] = [];
  doc.descendants((node, pos) => {
    if (!ITEM_NODE_TYPES.has(node.type.name)) return true;
    if (node.childCount > 1) candidates.push(pos);
    return true;
  });
  if (!candidates.length) return null;
  return candidates[Math.floor(rand() * candidates.length)];
}

interface Op {
  name: string;
  run: (editor: Editor, rand: () => number, pos: number) => void;
}

const MODS: Record<string, KeyboardEventInit> = {
  Enter: {},
  Tab: {},
  'Shift-Tab': { shiftKey: true },
  Backspace: {},
  Delete: {},
};

const OPS: Op[] = [
  ...Object.entries(MODS).map(([name, mods]) => ({
    name,
    run: (editor: Editor, _rand: () => number, pos: number) => {
      editor.commands.setTextSelection(pos);
      const key = name === 'Shift-Tab' ? 'Tab' : name;
      editor.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...mods }),
      );
    },
  })),
  {
    name: 'Fold',
    run: (editor: Editor, rand: () => number) => {
      const itemPos = randomFoldableItem(editor.state.doc, rand);
      if (itemPos == null) return;
      editor.view.dispatch(editor.state.tr.setMeta(listFoldKey, { toggle: itemPos }));
    },
  },
  {
    name: 'Undo',
    run: (editor: Editor) => {
      editor.commands.undo();
    },
  },
];

const SEEDS = [1, 2, 3, 4, 5, 6];
const ROUNDS = 60;

describe('随机按键：局部重建必须与全量重建一致', () => {
  for (const seed of SEEDS) {
    it(`seed=${seed}`, () => {
      const editor = makeEditor(SEED_DOC);
      // 落定：尾随段落会在首个 dispatch 时补上（见 list-fold-scope.spec.ts 的同名说明）
      editor.view.dispatch(editor.state.tr.setMeta('settle', 1));

      const rand = rng(seed);
      const log: string[] = [];
      let docChangedOps = 0;

      for (let round = 0; round < ROUNDS; round++) {
        const size = editor.state.doc.content.size;
        const pos = Math.max(1, Math.min(size - 1, 1 + Math.floor(rand() * (size - 2))));
        const op = OPS[Math.floor(rand() * OPS.length)];
        const before = editor.state.doc;
        try {
          op.run(editor, rand, pos);
          log.push(`${op.name}@${pos}`);
        } catch {
          // 随机位置偶尔落在非法处（如文档首尾 token），跳过即可 —— 不给用例加噪音
          log.push(`${op.name}@${pos}!err`);
          continue;
        }
        if (editor.state.doc !== before) docChangedOps++;

        const actual = snapshot(editor.state);
        const want = expected(editor.state.doc, [...listFoldKey.getState(editor.state)!.folded]);
        if (actual !== want) {
          throw new Error(
            `seed=${seed} round=${round} 不一致\n操作: ${log.join(' ')}\n` +
              `实际: ${actual}\n期望: ${want}`,
          );
        }
      }

      // 空转防护：随机序列必须真的改过文档，否则这份用例等于没跑
      expect(docChangedOps, '随机序列一步都没改动文档，压测无效').toBeGreaterThan(ROUNDS / 4);
      editor.destroy();
    });
  }
});
