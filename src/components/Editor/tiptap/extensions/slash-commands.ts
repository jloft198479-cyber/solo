import { Extension } from '@tiptap/vue-3';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions } from '@tiptap/suggestion';
import type { Editor, Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';

const slashPluginKey = new PluginKey('slashCommands');

export interface SlashCommandItem {
  title: string;
  description: string;
  icon: string;
  category: string;
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
    icon: '¶',
    category: '基础',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setParagraph().run();
    },
  },
  {
    title: '标题 1',
    description: '大标题',
    icon: 'H1',
    category: '标题',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run();
    },
  },
  {
    title: '标题 2',
    description: '中标题',
    icon: 'H2',
    category: '标题',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run();
    },
  },
  {
    title: '标题 3',
    description: '小标题',
    icon: 'H3',
    category: '标题',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run();
    },
  },
  // 列表
  {
    title: '无序列表',
    description: '项目符号列表',
    icon: '•',
    category: '列表',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: '有序列表',
    description: '编号列表',
    icon: '1.',
    category: '列表',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: '任务列表',
    description: '待办事项清单',
    icon: '☐',
    category: '列表',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  // 块元素
  {
    title: '引用',
    description: '块引用',
    icon: '❝',
    category: '块',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setBlockquote().run();
    },
  },
  {
    title: '重点',
    description: '重点提示块',
    icon: '▎',
    category: '块',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range)
        .wrapIn('callout')
        .run();
    },
  },
  {
    title: '代码块',
    description: '语法高亮代码',
    icon: '<>',
    category: '块',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setCodeBlock().run();
    },
  },
  {
    title: '分割线',
    description: '水平分割线',
    icon: '—',
    category: '块',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    title: '表格',
    description: '3×3 表格',
    icon: '⊞',
    category: '块',
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
    icon: '∑',
    category: '高级',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range)
        .insertContent({ type: 'mathBlock' })
        .run();
    },
  },
  {
    title: 'Mermaid 图表',
    description: '流程图/时序图',
    icon: '◈',
    category: '高级',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range)
        .insertContent({ type: 'mermaidBlock' })
        .run();
    },
  },
];

const _slashLowerIndex: { titleLower: string; descLower: string; catLower: string }[] =
  slashCommandItems.map(item => ({
    titleLower: item.title.toLowerCase(),
    descLower: item.description.toLowerCase(),
    catLower: item.category.toLowerCase(),
  }));

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
            (_, i) =>
              _slashLowerIndex[i].titleLower.includes(q) ||
              _slashLowerIndex[i].descLower.includes(q) ||
              _slashLowerIndex[i].catLower.includes(q),
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
        ...this.options.suggestion,
      }),
    ];
  },
});
