import type { Ref } from 'vue';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { CustomCodeBlock } from './extensions/code-block';
import { SemanticHeading } from './extensions/semantic-heading';
import {
  CustomTable,
  CustomTableRow,
  CustomTableHeader,
  CustomTableCell,
} from './extensions/table';
import { CustomImage } from './extensions/image';
import { Callout } from './extensions/callout';
import { MathBlock } from './extensions/math-block';
import { MathInline } from './extensions/math-inline';
import { MermaidBlock } from './extensions/mermaid-block';
import { MarkdownInput } from './extensions/markdown-input';
import { MarkdownPaste } from './extensions/markdown-paste';
import { Superscript, Subscript } from './extensions/sub-sup';
import { Wikilink } from './extensions/wikilink';
import {
  SlashCommands,
  slashCommandItems,
  type SlashCommandItem,
} from './extensions/slash-commands';
import {
  EmojiSuggest,
  emojiItems,
  type EmojiItem,
} from './extensions/emoji-suggest';
import { ParagraphFocus } from './extensions/paragraph-focus';
import { SearchHighlight, type SearchHighlightOptions } from './extensions/search-highlight';

type SlashCommandSuggestionProps = SuggestionProps<SlashCommandItem, SlashCommandItem>;
type EmojiSuggestSuggestionProps = SuggestionProps<EmojiItem, EmojiItem>;

export interface SlashMenuController {
  show: (position: { top: number; left: number }) => void;
  hide: () => void;
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export interface EmojiMenuController {
  show: (position: { top: number; left: number }) => void;
  hide: () => void;
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface EditorExtensionOptions {
  slashMenuRef: Ref<SlashMenuController | null>;
  slashMenuItems: Ref<SlashCommandItem[]>;
  slashMenuCommand: Ref<(item: SlashCommandItem) => void>;
  emojiMenuRef: Ref<EmojiMenuController | null>;
  emojiMenuItems: Ref<EmojiItem[]>;
  emojiMenuCommand: Ref<(item: EmojiItem) => void>;
  searchHighlightOptions: SearchHighlightOptions;
}

export function createEditorExtensions(options: EditorExtensionOptions) {
  const { slashMenuRef, slashMenuItems, slashMenuCommand, emojiMenuRef, emojiMenuItems, emojiMenuCommand } = options;

  return [
    StarterKit.configure({
      // 禁用 StarterKit 内置节点，使用自定义扩展处理 Markdown fidelity 和 IME 行为。
      codeBlock: false,
      link: false,
      heading: false,
    }),
    SemanticHeading,
    CustomCodeBlock,
    CustomTable,
    CustomTableRow,
    CustomTableHeader,
    CustomTableCell,
    CustomImage,
    Callout,
    Highlight.configure({ multicolor: false }),
    ParagraphFocus,
    SearchHighlight.configure(options.searchHighlightOptions),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: '' },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({
      placeholder: '开始写作...',
    }),
    MathBlock,
    MathInline,
    MermaidBlock,
    MarkdownInput,
    MarkdownPaste,
    Superscript,
    Subscript,
    Wikilink,
    SlashCommands.configure({
      suggestion: {
        char: '/',
        startOfLine: false,
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase();
          return slashCommandItems.filter(
            (item) =>
              item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
          );
        },
        render: () => ({
          onStart: (props: SlashCommandSuggestionProps) => {
            slashMenuItems.value = props.items;
            slashMenuCommand.value = props.command;
            const rect = props.clientRect?.();
            if (rect) slashMenuRef.value?.show({ top: rect.bottom + 4, left: rect.left });
          },
          onUpdate: (props: SlashCommandSuggestionProps) => {
            slashMenuItems.value = props.items;
            slashMenuCommand.value = props.command;
            const rect = props.clientRect?.();
            if (rect) slashMenuRef.value?.show({ top: rect.bottom + 4, left: rect.left });
          },
          onKeyDown: (props: SuggestionKeyDownProps) => {
            const { event } = props;
            if (event.key === 'Escape') {
              slashMenuRef.value?.hide();
              return true;
            }
            return slashMenuRef.value?.onKeyDown(event) ?? false;
          },
          onExit: () => {
            slashMenuRef.value?.hide();
          },
        }),
      },
    }),
    EmojiSuggest.configure({
      suggestion: {
        char: ':',
        startOfLine: false,
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase();
          if (!q) {
            return emojiItems.slice(0, 20);
          }
          return emojiItems.filter(
            (item) =>
              item.name.toLowerCase().includes(q) ||
              item.keywords.some((kw) => kw.toLowerCase().includes(q)),
          );
        },
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).insertContent(props.emoji).run();
        },
        render: () => ({
          onStart: (props: EmojiSuggestSuggestionProps) => {
            emojiMenuItems.value = props.items;
            emojiMenuCommand.value = props.command;
            const rect = props.clientRect?.();
            if (rect) emojiMenuRef.value?.show({ top: rect.bottom + 4, left: rect.left });
          },
          onUpdate: (props: EmojiSuggestSuggestionProps) => {
            emojiMenuItems.value = props.items;
            emojiMenuCommand.value = props.command;
            const rect = props.clientRect?.();
            if (rect) emojiMenuRef.value?.show({ top: rect.bottom + 4, left: rect.left });
          },
          onKeyDown: (props: SuggestionKeyDownProps) => {
            const { event } = props;
            if (event.key === 'Escape') {
              emojiMenuRef.value?.hide();
              return true;
            }
            return emojiMenuRef.value?.onKeyDown(event) ?? false;
          },
          onExit: () => {
            emojiMenuRef.value?.hide();
          },
        }),
      },
    }),
  ];
}
