import type { Editor as TiptapEditor } from '@tiptap/vue-3';
import type { EditorState } from '@tiptap/pm/state';

export interface EditorOutlineItem {
  level: number;
  text: string;
  pos: number;
}

export interface EditorCursorInfo {
  cursor: { line: number; col: number };
  selectionLen: number;
}

export function getEditorWordCount(editor: TiptapEditor): number {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.isText) {
      count += (node.text ?? '').replace(/\s+/g, '').length;
      return false;
    }
    return true;
  });
  return count;
}

// ── 大纲缓存 keyed by EditorState 引用 ──
// PM 每次事务创建新 state，引用变化即内容变化，无 docSize 的滞后 bug
const _outlineCache = new WeakMap<EditorState, EditorOutlineItem[]>();

export function extractEditorOutline(editor: TiptapEditor): EditorOutlineItem[] {
  const state = editor.state;
  const cached = _outlineCache.get(state);
  if (cached) return cached;

  const outline: EditorOutlineItem[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      outline.push({
        level: node.attrs.level,
        text: node.textContent,
        pos,
      });
    }
  });

  _outlineCache.set(state, outline);
  return outline;
}

/**
 * 获取光标位置信息（行号 + 列号 + 选区文本）。
 *
 * 使用祖先路径遍历（ancestor walk）代替全量 doc.descendants：
 * 从光标位置沿文档树向上，仅计数每个层级中位于当前节点之前的兄弟块，
 * 而非遍历光标前的所有块节点。
 * 复杂度从 O(光标前所有节点数) 降为 O(树深度 × 平均兄弟数)，
 * 对大文档和深层嵌套结构（如长列表、多层引用）提速显著。
 */
export function getEditorCursorInfo(editor: TiptapEditor): EditorCursorInfo {
  const { from } = editor.state.selection;
  const $from = editor.state.doc.resolve(from);
  let line = 1;

  // 沿祖先路径向上：在每个层级中，计数同级且位于当前节点之前的块节点
  for (let depth = $from.depth; depth > 0; depth--) {
    const parent = $from.node(depth - 1);
    const indexInParent = $from.index(depth - 1);
    for (let i = 0; i < indexInParent; i++) {
      const sibling = parent.child(i);
      if (sibling.isBlock) {
        line++;
        // 嵌套块（如 blockquote 内的段落）：计数其内部所有块级后代
        sibling.descendants((node) => {
          if (node.isBlock) line++;
        });
      }
    }
  }

  const col = from - $from.start($from.depth) + 1;
  const selection = editor.state.selection;
  // 状态栏只需要字数，不拷全文：大文档全选时 textBetween 会拷贝整份内容
  let selectionLen = 0;
  if (!selection.empty) {
    editor.state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      if (node.isText) {
        // nodesBetween 会给出与选区部分重叠的文本节点，按交集裁剪才精确
        const start = Math.max(selection.from, pos);
        const end = Math.min(selection.to, pos + (node.text?.length ?? 0));
        selectionLen += Math.max(0, end - start);
      }
      return true;
    });
  }

  return {
    cursor: { line, col },
    selectionLen,
  };
}
