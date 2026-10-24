import type { Editor as TiptapEditor } from '@tiptap/vue-3';
import type { Node as PMNode } from '@tiptap/pm/model';
import { AllSelection, TextSelection } from '@tiptap/pm/state';
import { serializeClipboardSlice } from './markdown/serializer';
import { moveListItem } from './list-move';
import { demoteListItemToBlock, shouldDemoteOnListToggle } from './list-demote';

export interface BubbleMenuActionData {
  href?: string;
}

/**
 * 全选（AllSelection）时原生 toggle 会把整篇 wrap 进新列表——实测 v3.31.3，
 * `- A/- B/- C` 全选点无序 → `- - A\n  - B\n  - C`（#50 要防的空壳嵌套）——
 * 因为 AllSelection 的 from=0 落在列表外，toggleList 的「已在列表里」分支失配。
 * 把选区归一为**等价覆盖的文本选区**（起点挪进首块内容、终点进末块内容），
 * 原生即走正确的「整块退出 / 原地换标记」分支（诊断实测，2026-10-25）。
 */
/**
 * 全选（AllSelection）时原生 toggle 会把整篇 wrap 进新列表——实测 v3.31.3，
 * `- A/- B/- C` 全选点无序 → `- - A\n  - B\n  - C`（#50 要防的空壳嵌套）——
 * 因为 AllSelection 的 from=0 落在列表外，toggleList 的「已在列表里」分支失配。
 * 把选区归一为**等价覆盖的文本选区**后，原生即走正确的「整块退出 / 原地换标记」
 * 分支（诊断实测，2026-10-25）。
 *
 * 端点必须取**真实文本节点**：TrailingNode 会在任何事务后给「以列表结尾的文档」
 * 补一个空段，按几何下沉取最右叶子会落进空段（无行内内容）⇒ TextSelection 端点
 * 非法 ⇒ 归一静默失效（实测），所以这里只能扫到末个文本节点为止。
 */
function lastTextRange(doc: PMNode): { from: number; to: number } | null {
  let from: number | null = null;
  let to = 0;
  doc.descendants((n, pos) => {
    // perf-allow: 一次性用户命令（列表按钮/快捷键）触发，每次点击至多一次 O(n)，
    // 不在每键路径上；且端点必须是真实文本节点（见上），无法用几何下沉替代
    if (!n.isText) return true;
    if (from === null) from = pos;
    to = pos + n.nodeSize;
    return true;
  });
  if (from === null || from >= to) return null;
  return { from, to };
}

function normalizeAllSelectionForToggle(editor: TiptapEditor): void {
  const view = editor.view;
  const { selection } = view.state;
  if (!(selection instanceof AllSelection)) return;
  // 不能 create(doc, 1, size-1)——from 会落在项内块边界（不在 textblock 里），
  // 原生分支照样不认；TextSelection.between 对块边界还会抛错（诊断实测
  // 2026-10-25）。无文本的空文档跳过，原生自行处理。
  const range = lastTextRange(view.state.doc);
  if (!range) return;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)),
  );
}

/**
 * toggle 家族的「第二次按 = 退出」：只在**同型容器 + 单项内**（含子列表）时由
 * 托孤路径接管，其余交回原生 toggleList——多选跨项 / 跨型切换原生本来就能整块
 * 退出 / 原地换标记，接管反而把结构改坏（审计 P2-2 升 P1，判据见 list-demote）。
 */
function exitList(editor: TiptapEditor, itemType: string, containerType: string | null): boolean {
  const view = editor.view;
  if (shouldDemoteOnListToggle(view, itemType, containerType)) {
    return demoteListItemToBlock(view);
  }
  normalizeAllSelectionForToggle(editor);
  return false;
}

export function runBubbleMenuAction(
  editor: TiptapEditor | null,
  type: string,
  data?: BubbleMenuActionData,
) {
  if (!editor) return;
  const chain = editor.chain().focus();

  switch (type) {
    case 'bold':
      chain.toggleBold().run();
      break;
    case 'italic':
      chain.toggleItalic().run();
      break;
    case 'code':
      chain.toggleCode().run();
      break;
    case 'link':
      if (data?.href) {
        chain.setLink({ href: data.href }).run();
      }
      break;
    case 'unlink':
      chain.unsetLink().run();
      break;
    case 'dim':
      chain.toggleMark('dim').run();
      break;
    case 'h1':
      chain.toggleHeading({ level: 1 }).run();
      break;
    case 'h2':
      chain.toggleHeading({ level: 2 }).run();
      break;
    case 'bulletList':
      // 「第二次按 = 退出列表」：同型容器 + 单项内才走托孤，不许重排出 `- - 乙`。
      // 注意 fresh chain：顶部那个 chain 在 exitList 派发「全选归一」事务之前就
      // 捕获了 state，复用它会把归一前的 AllSelection 又带回来
      if (!exitList(editor, 'listItem', 'bulletList')) {
        editor.chain().focus().toggleBulletList().run();
      }
      break;
    case 'clearFormat':
      // 「清除格式」= 洗澡，不换身份：只去掉装饰（粗体/斜体/高亮/链接…），
      // **块类型与缩进一概不动**（契约见 docs/PROPOSAL-list-semantics.md）。
      //
      // 这里原先是 `clearNodes().unsetAllMarks()`，而 clearNodes 会一路拆掉外层容器 ——
      // 在列表里它等于给了「清除」重排树的能力：给子项清格式，结果把父项降级了、
      // 全家还被提升一级。去掉 clearNodes 之后，这类 bug 从根上不再有发生的可能。
      // 要改块类型请走「转普通段落」（Ctrl+0），那条路才负责把缩进说清楚。
      chain.unsetAllMarks().run();
      break;
  }
}

export function executeEditorCommand(editor: TiptapEditor | null, commandId: string): boolean {
  if (!editor) {
    return false;
  }

  const chain = editor.chain().focus();

  switch (commandId) {
    case 'editor.undo':
      return editor.commands.undo();
    case 'editor.redo':
      return editor.commands.redo();
    case 'editor.bold':
      return chain.toggleBold().run();
    case 'editor.italic':
      return chain.toggleItalic().run();
    case 'editor.strike':
      return chain.toggleStrike().run();
    case 'editor.highlight':
      return chain.toggleHighlight().run();
    case 'editor.dim':
      return chain.toggleMark('dim').run();
    case 'editor.code':
      return chain.toggleCode().run();
    // 与浮动菜单同源：**不另写一遍**，直接复用 runBubbleMenuAction 里的唯一定义——
    // 否则「清除格式」的语义将来改一处漏一处（M-34 收编命令时唯一的漂移风险）。
    // （link 未收：它需要用户输入 URL，而应用内没有文本输入对话框，光靠命令面板完成不了。）
    case 'editor.unlink':
      runBubbleMenuAction(editor, 'unlink');
      return true;
    case 'editor.clearFormat':
      runBubbleMenuAction(editor, 'clearFormat');
      return true;
    case 'editor.heading1':
      return chain.toggleHeading({ level: 1 }).run();
    case 'editor.heading2':
      return chain.toggleHeading({ level: 2 }).run();
    case 'editor.heading3':
      return chain.toggleHeading({ level: 3 }).run();
    case 'editor.heading4':
      return chain.toggleHeading({ level: 4 }).run();
    case 'editor.heading5':
      return chain.toggleHeading({ level: 5 }).run();
    case 'editor.heading6':
      return chain.toggleHeading({ level: 6 }).run();
    case 'editor.paragraph':
      // 同上：列表项「转为正文」走的是同一条 PM 转换路径，同样会把子列表憋成空壳项
      if (demoteListItemToBlock(editor.view)) return true;
      return chain.setParagraph().run();
    case 'editor.bulletList':
      if (exitList(editor, 'listItem', 'bulletList')) return true;
      return editor.chain().focus().toggleBulletList().run();
    case 'editor.orderedList':
      if (exitList(editor, 'listItem', 'orderedList')) return true;
      return editor.chain().focus().toggleOrderedList().run();
    case 'editor.taskList':
      // taskItem 不比容器（混编 bulletList 是常态），只判项类型与单项内
      if (exitList(editor, 'taskItem', null)) return true;
      return editor.chain().focus().toggleTaskList().run();
    case 'editor.blockquote':
      return chain.toggleBlockquote().run();
    case 'editor.codeBlock':
      return chain.toggleCodeBlock().run();
    case 'editor.tableAddRowBefore':
      return chain.addRowBefore().run();
    case 'editor.tableAddRowAfter':
      return chain.addRowAfter().run();
    case 'editor.tableDeleteRow':
      return chain.deleteRow().run();
    case 'editor.tableAddColBefore':
      return chain.addColumnBefore().run();
    case 'editor.tableAddColAfter':
      return chain.addColumnAfter().run();
    case 'editor.tableDeleteCol':
      return chain.deleteColumn().run();
    case 'editor.tableToggleHeaderRow':
      return chain.toggleHeaderRow().run();
    case 'editor.tableDeleteTable':
      return chain.deleteTable().run();
    // 默认复制给的是「渲染后的干净文字」，需要 Markdown 源码时走这条
    // （见 registry 的 edit.copyAsMarkdown 说明）。刻意不碰 chain.focus()：
    // 复制不该改变光标与焦点。
    case 'edit.copyAsMarkdown': {
      const { state } = editor;
      void navigator.clipboard
        .writeText(serializeClipboardSlice(state.doc, state.selection.content()))
        .catch(() => {
          // 剪贴板不可用（权限 / 非安全上下文）时静默失败，不打断编辑
        });
      return true;
    }
    // 列表项同层换位（Alt+↑/↓）。刻意不走上面那个 chain：
    // chain 头里挂了 `.focus()`，而换位自己管焦点（组字期还要直接拒绝执行，
    // 见 list-move.ts 的铁律 3），多一次抢焦点没好处。
    case 'list.moveItemUp':
    case 'list.moveItemDown':
      return moveListItem(editor.view, commandId === 'list.moveItemUp' ? -1 : 1);
    default:
      return false;
  }
}
