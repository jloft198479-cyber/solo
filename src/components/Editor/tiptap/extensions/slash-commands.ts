import { Extension } from '@tiptap/vue-3';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions } from '@tiptap/suggestion';
import type { Editor, Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';

import { guardedFindSuggestionMatch } from './suggestion-guard';
import { demoteListItemToBlock, hasListItemToDemote, shouldDemoteOnListToggle } from '../list-demote';
import type { IconName } from '../../../icons/svg';

const slashPluginKey = new PluginKey('slashCommands');

/**
 * 列表项内的斜杠命令：先删掉候选词，再走托孤（正文 / 各列表 4 个入口共用同一段病态路径，
 * 台账 §一 #50）。是否接管由调用方的闸门决定，这里只负责「删词 + 托孤」这组固定动作。
 */
function demoteAfterDelete(editor: Editor, range: Range): void {
  editor.chain().focus().deleteRange(range).run();
  demoteListItemToBlock(editor.view);
}

export interface SlashCommandItem {
  title: string;
  description: string;
  /**
   * 图标键 —— **必须是图标库里的名字**（`icons/svg.ts` 的 `IconName`），不接受自由字符串。
   * 2026-10-17 批 3 第 3 步之前这里是 `string`，14 项各填一个字符（`¶` `H1` `☐` `∑` …），
   * 混了排版符号 / 文字标签 / 伪图标三种性质，改一处全处不动。改成联合类型后，
   * 填错名字**编译期就红**，也不可能再退回"随手打个字符"。
   */
  icon: IconName;
  category: string;
  /**
   * 匹配别名：拼音首字母 + 常用英文缩写。
   * 让用户输入 `bg` 能匹配到「表格」(biǎo gé)、`dmk` 匹配「代码块」(dài mǎ kuài)。
   * 用空格分隔多个别名，匹配时对整体做 includes 子串匹配。
   */
  alias?: string;
  command: (props: { editor: Editor; range: Range }) => void;
}

type SlashCommandSuggestionOptions = Omit<
  SuggestionOptions<SlashCommandItem, SlashCommandItem>,
  'editor'
>;

interface SlashCommandsOptions {
  suggestion: SlashCommandSuggestionOptions;
}

export const slashCommandItems: SlashCommandItem[] = [
  // 基础块
  {
    title: '正文',
    description: '正文段落',
    icon: 'paragraph',
    category: '基础',
    alias: 'zw',
    command: ({ editor, range }) => {
      // 常见路径保持原样的一整条 chain（单事务、一次撤销）；只有「列表项转正文」
      // 这条病态路径才先删文本再托孤（台账 §一 #50）。
      if (hasListItemToDemote(editor.view)) {
        demoteAfterDelete(editor, range);
        return;
      }
      editor.chain().focus().deleteRange(range).setParagraph().run();
    },
  },
  {
    title: '标题 1',
    description: '大标题',
    icon: 'heading1',
    category: '标题',
    alias: 'bt h1',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run();
    },
  },
  {
    title: '标题 2',
    description: '中标题',
    icon: 'heading2',
    category: '标题',
    alias: 'bt h2',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run();
    },
  },
  {
    title: '标题 3',
    description: '小标题',
    icon: 'heading3',
    category: '标题',
    alias: 'bt h3',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run();
    },
  },
  // 列表
  {
    title: '无序列表',
    description: '项目符号列表',
    icon: 'bulletList',
    category: '列表',
    alias: 'wxxb ul lb',
    command: ({ editor, range }) => {
      // 接管判据收窄（审计 P2-2 升 P1）：同型容器 + 单项内才托孤，
      // 多选跨项 / 跨型切换交回原生 toggle（判据见 list-demote）
      if (shouldDemoteOnListToggle(editor.view, 'listItem', 'bulletList')) {
        demoteAfterDelete(editor, range);
        return;
      }
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: '有序列表',
    description: '编号列表',
    icon: 'orderedList',
    category: '列表',
    alias: 'yxxb ol lb',
    command: ({ editor, range }) => {
      // 接管判据收窄（审计 P2-2 升 P1）：同型容器 + 单项内才托孤，
      // 多选跨项 / 跨型切换交回原生 toggle（判据见 list-demote）
      if (shouldDemoteOnListToggle(editor.view, 'listItem', 'orderedList')) {
        demoteAfterDelete(editor, range);
        return;
      }
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: '任务列表',
    description: '待办事项清单',
    icon: 'taskList',
    category: '列表',
    alias: 'rwlb task todo lb',
    command: ({ editor, range }) => {
      // taskItem 不比容器（混编 bulletList 是常态），只判项类型与单项内
      if (shouldDemoteOnListToggle(editor.view, 'taskItem', null)) {
        demoteAfterDelete(editor, range);
        return;
      }
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  // 块元素
  {
    title: '引用',
    description: '块引用',
    icon: 'quote',
    category: '块',
    alias: 'yy quote',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setBlockquote().run();
    },
  },
  {
    title: '重点',
    description: '重点提示块',
    icon: 'lightbulb',
    category: '块',
    alias: 'zd callout',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range)
        .wrapIn('callout')
        .run();
    },
  },
  {
    title: '代码块',
    description: '语法高亮代码',
    icon: 'code',
    category: '块',
    alias: 'dmk code',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setCodeBlock().run();
    },
  },
  {
    title: '分割线',
    description: '水平分割线',
    icon: 'divider',
    category: '块',
    alias: 'fgx hr',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    title: '表格',
    description: '3×3 表格',
    icon: 'table',
    category: '块',
    alias: 'bg table',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();
    },
  },
  // 高级块
  {
    title: '数学公式',
    description: 'LaTeX 数学公式',
    icon: 'math',
    category: '高级',
    alias: 'sxgs math gs',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range)
        .insertContent({ type: 'mathBlock' })
        .run();
    },
  },
  {
    title: 'Mermaid 图表',
    description: '流程图/时序图',
    icon: 'diagram',
    category: '高级',
    alias: 'mermaid tl tb',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range)
        .insertContent({ type: 'mermaidBlock' })
        .run();
    },
  },
];

export const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: 'slashCommands',

  addOptions(): SlashCommandsOptions {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase();
          return slashCommandItems.filter(
            (item) =>
              item.title.toLowerCase().includes(q) ||
              item.description.toLowerCase().includes(q) ||
              (item.alias?.toLowerCase().includes(q) ?? false),
          );
        },
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: slashPluginKey,
        // P4-04：守卫版匹配，避免每次事务对整段文本 matchAll
        findSuggestionMatch: guardedFindSuggestionMatch,
        ...this.options.suggestion,
      }),
    ];
  },
});
