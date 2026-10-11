/**
 * 表格扩展配置
 *
 * 使用 TipTap 官方表格扩展，支持：
 * - 可编辑单元格
 * - Tab/Shift+Tab 单元格导航
 * - 表头行
 *
 * ⚠️ **单元格内容收紧为 `paragraph`**（2026-10-12，台账 §二 #60 / `PROPOSAL-cell-fidelity.md` §10）。
 *
 * 依据是 **GFM 规范本身**：表格单元格**只有行内语法**，格内没有列表 / 代码块 / 公式 /
 * 引用块 —— Typora、GitHub、VS Code 预览一致如此（业界共识：「单元格内部仍然遵循普通
 * markdown 的行内语法规则」）。TipTap 默认的 `content: 'block+'` 与规范不符，后果有两层：
 * ① **写出去存不住**（块级语法落进单行容器，重开变味，见 #60）；
 * ② **斜杠菜单/命令面板在格内「点了有反应、结果没保住」**（实测 `toggleBulletList` /
 *    `toggleBlockquote` / `toggleCodeBlock` / `insertContent(mathBlock)` 全部接管成功）。
 *
 * 收紧后这两条从源头消失：块级命令在格内**直接失败**（`can()` 为 false，菜单据此禁用），
 * 而不是先造出来再靠序列化兜。**退化安全**：序列化侧仍保留 `cellToText` 的拍平分支，
 * 不假设 schema 永远完美（旧 JSON 快照 / 未来回归都不会把块语法写进格子）。
 */
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';

export const CustomTable = Table.configure({
  resizable: true,
  handleWidth: 5,
  cellMinWidth: 50,
  renderWrapper: true,
  HTMLAttributes: {
    class: 'mk-table',
  },
});

export const CustomTableRow = TableRow.configure({
  HTMLAttributes: {},
});

/** 表头单元格：内容同正文单元格，只能是段落（GFM 格内无块级语法） */
export const CustomTableHeader = TableHeader.extend({ content: 'paragraph' }).configure({
  HTMLAttributes: {},
});

/** 正文单元格：同上。⚠️ 别改回 `block+` —— 见本文件头注释 */
export const CustomTableCell = TableCell.extend({ content: 'paragraph' }).configure({
  HTMLAttributes: {},
});
