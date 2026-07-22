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
import { Frontmatter } from './extensions/frontmatter';
import { FootnoteRef, FootnoteSection, FootnoteDef } from './extensions/footnote';
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

// ── 浮动菜单定位 ───────────────────────────────────────────────
//
// 菜单定位的边界检测：原先直接用 `rect.bottom + 4, rect.left` 放置菜单，
// 当光标在编辑器下方或右边缘时，菜单会被视口边缘遮挡。
// 现在改为：
//  - 下方放得下就放下方（默认）；放不下且上方放得下 → 翻转到上方
//  - 上方也放不下（菜单比视口还高）→ 钉在视口顶部，靠 scroll 滚动
//  - 右侧超出 → 向左收缩；左侧超出 → 钉在视口左边
//
// 抽成纯函数便于单测覆盖「下方遮挡 / 上方翻转 / 右侧遮挡 / 极端小视口」等场景。
//
// 估算尺寸来源：CSS .mk-slash-menu-scroll { max-height: 320px }，
// 加 padding + border ≈ 340。EmojiMenu 尺寸略小但用同值偏差可接受。
const MENU_MAX_HEIGHT = 340;
const MENU_MIN_WIDTH = 240;
const VIEWPORT_MARGIN = 8;

export function computeMenuPosition(
  rect: { top: number; bottom: number; left: number },
  viewport: { width: number; height: number } = {
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  },
): { top: number; left: number } {
  const { width: vw, height: vh } = viewport;
  const belowTop = rect.bottom + 4;
  const aboveTop = rect.top - MENU_MAX_HEIGHT - 4;

  let top: number;
  const fitsBelow = belowTop + MENU_MAX_HEIGHT <= vh - VIEWPORT_MARGIN;
  const fitsAbove = aboveTop >= VIEWPORT_MARGIN;

  if (fitsBelow) {
    top = belowTop;
  } else if (fitsAbove) {
    // 下方放不下、上方放得下 → 翻转
    top = aboveTop;
  } else {
    // 上下都放不下（菜单比视口高）→ 钉在视口顶部，靠菜单自身 scroll
    top = VIEWPORT_MARGIN;
  }

  let left = rect.left;
  if (left + MENU_MIN_WIDTH > vw - VIEWPORT_MARGIN) {
    left = vw - MENU_MIN_WIDTH - VIEWPORT_MARGIN;
  }
  if (left < VIEWPORT_MARGIN) {
    left = VIEWPORT_MARGIN;
  }

  return { top, left };
}

interface EditorExtensionOptions {
  slashMenuRef: Ref<SlashMenuController | null>;
  slashMenuItems: Ref<SlashCommandItem[]>;
  slashMenuCommand: Ref<(item: SlashCommandItem) => void>;
  emojiMenuRef: Ref<EmojiMenuController | null>;
  emojiMenuItems: Ref<EmojiItem[]>;
  emojiMenuCommand: Ref<(item: EmojiItem) => void>;
  searchHighlightOptions: SearchHighlightOptions;
  /** 返回当前文档路径，用于粘贴图片时落盘 */
  getDocumentPath?: () => string | null;
  /** 返回自定义图片存储路径 */
  getStoragePath?: () => string | null;
  /** 互链 [[target]] 点击回调，由上层解析路径并打开目标文档 */
  onWikilinkNavigate?: (target: string) => void;
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
    Frontmatter,
    FootnoteRef,
    FootnoteSection,
    FootnoteDef,
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
      placeholder: '开始写作… 输入 / 唤起命令',
    }),
    MathBlock,
    MathInline,
    MermaidBlock,
    MarkdownInput,
    MarkdownPaste.configure({
      getDocumentPath: options.getDocumentPath,
      getStoragePath: options.getStoragePath,
    }),
    Superscript,
    Subscript,
    Wikilink.configure({
      onNavigate: options.onWikilinkNavigate,
    }),
    SlashCommands.configure({
      suggestion: {
        char: '/',
        startOfLine: false,
        // 允许 / 在任意前缀后触发：中文没有词间空格习惯，用户在「你好/」
        // 或「hello/」后敲 / 也应唤出菜单。Suggestion 默认 allowedPrefixes=[' ']
        // 会过滤掉所有「非空格、非行首」的前缀，对中文场景致命。
        allowedPrefixes: null,
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
            if (rect) slashMenuRef.value?.show(computeMenuPosition(rect));
          },
          onUpdate: (props: SlashCommandSuggestionProps) => {
            slashMenuItems.value = props.items;
            slashMenuCommand.value = props.command;
            const rect = props.clientRect?.();
            if (rect) slashMenuRef.value?.show(computeMenuPosition(rect));
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
            if (rect) emojiMenuRef.value?.show(computeMenuPosition(rect));
          },
          onUpdate: (props: EmojiSuggestSuggestionProps) => {
            emojiMenuItems.value = props.items;
            emojiMenuCommand.value = props.command;
            const rect = props.clientRect?.();
            if (rect) emojiMenuRef.value?.show(computeMenuPosition(rect));
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
