import type { Editor as TiptapEditor } from '@tiptap/vue-3';
import { serializeClipboardSlice } from './markdown/serializer';
import { moveListItem } from './list-move';
import { demoteListItemToBlock, isInsideListOf } from './list-demote';

export interface BubbleMenuActionData {
  href?: string;
}

/**
 * toggle 家族的「第二次按 = 退出」：只在**已经在同类型列表里**且目标含子列表时接管。
 *
 * 叶子项交回 toggle —— 它自己就能正确退出列表，不必惊动托孤。
 */
function exitList(editor: TiptapEditor, listType: string): boolean {
  return isInsideListOf(editor.view, listType) && demoteListItemToBlock(editor.view);
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
      // 「第二次按 = 退出列表」：已经在无序列表里再按一次 ⇒ 走托孤，不许重排出 `- - 乙`
      if (!exitList(editor, 'listItem')) chain.toggleBulletList().run();
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
      if (exitList(editor, 'listItem')) return true;
      return chain.toggleBulletList().run();
    case 'editor.orderedList':
      if (exitList(editor, 'listItem')) return true;
      return chain.toggleOrderedList().run();
    case 'editor.taskList':
      if (exitList(editor, 'taskItem')) return true;
      return chain.toggleTaskList().run();
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
