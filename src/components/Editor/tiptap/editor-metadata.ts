import type { Editor as TiptapEditor } from '@tiptap/vue-3';
import type { EditorState } from '@tiptap/pm/state';
// 解析期插入的 ZWNJ 不该外溢到任何「读数 / 计数 / 写盘」——见 ../zwnj 与敏感区 #23
import { stripZwnj } from './zwnj';

export interface EditorOutlineItem {
  level: number;
  text: string;
  pos: number;
}

export function getEditorWordCount(editor: TiptapEditor): number {
  let count = 0;
  editor.state.doc.descendants((node) => { // perf-allow: 字数天然 O(N)，150ms 防抖 + idle 降级（useEditorSync）
    if (node.isText) {
      // stripZwnj：ZWNJ **不是空白**（`\s` 不匹配 U+200C）⇒ 不剥就每个计 1 字，
      // 「打开文档字数即虚高」（台账 §二 #32）。
      count += stripZwnj(node.text ?? '').replace(/\s+/g, '').length;
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
  state.doc.descendants((node, pos) => { // perf-allow: 大纲天然 O(N)，500ms 防抖 + WeakMap 按 state 缓存（每 state 至多一次）
    if (node.type.name === 'heading') {
      outline.push({
        level: node.attrs.level,
        // stripZwnj：大纲文本是对外读数。视觉上无差异（ZWNJ 不可见），纳入契约是为了
        // 不让隐形字符流向下游（未来的复制 / 搜索联动 / 字符串比较），成本仅一次短路判断。
        text: stripZwnj(node.textContent),
        pos,
      });
    }
  });

  _outlineCache.set(state, outline);
  return outline;
}

/**
 * 选区内的字数（状态栏「N 字选中」的唯一数据源）。空选区返回 0。
 *
 * **历史（2026-10-19 删除行号，台账 §一 #72）**：这里原本还返回光标行号/列号，
 * 实现是「沿祖先路径数前序兄弟块、每块再 descendants 数其块级后代」——最外层就是
 * 遍历光标前的**所有**顶层块，复杂度 O(光标前全部节点)，注释却写着「降为 O(深度×兄弟数)」。
 * 实测 107KB 文档 1.42ms、282KB 5.03ms，而它挂在「选区变化 → 100ms 防抖」链路上，
 * 停笔就来一次；更要命的是 `stats.cursor` 全仓没有任何读取方、行号也没有 UI 用途 ⇒ 纯白烧。
 *
 * 若将来真要做「跳转到行」，**按需算一次** O(N) 完全可接受，别再放回每键/每次选区链路。
 */
export function getEditorSelectionLength(editor: TiptapEditor): number {
  const selection = editor.state.selection;
  if (selection.empty) return 0;
  let len = 0;
  // 不拷文本（大文档全选时 textBetween 会拷贝整份内容），逐节点累加交集长度
  editor.state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (!node.isText) return true;
    const start = Math.max(selection.from, pos);
    const end = Math.min(selection.to, pos + (node.text?.length ?? 0));
    len += Math.max(0, end - start);
    return true;
  });
  return len;
}
