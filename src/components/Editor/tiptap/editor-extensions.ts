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
import { Dim } from './extensions/dim';
import { Frontmatter } from './extensions/frontmatter';
import { FootnoteRef, FootnoteSection, FootnoteDef } from './extensions/footnote';
import { Wikilink } from './extensions/wikilink';
import { LinkOpen } from './extensions/link-open';
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
import {
  WikilinkSuggest,
  filterWikilinkCandidates,
  refreshWikilinkCandidates,
  type WikilinkCandidateItem,
} from './extensions/wikilink-suggest';
import { ParagraphFocus } from './extensions/paragraph-focus';
import { SearchHighlight, type SearchHighlightOptions } from './extensions/search-highlight';

type SlashCommandSuggestionProps = SuggestionProps<SlashCommandItem, SlashCommandItem>;
type EmojiSuggestSuggestionProps = SuggestionProps<EmojiItem, EmojiItem>;
type WikilinkSuggestSuggestionProps = SuggestionProps<WikilinkCandidateItem, WikilinkCandidateItem>;

export interface SlashMenuController {
  show: (position: MenuPosition) => void;
  hide: () => void;
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export interface EmojiMenuController {
  show: (position: MenuPosition) => void;
  hide: () => void;
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export interface WikilinkMenuController {
  show: (position: MenuPosition) => void;
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
// 对齐业界做法（Floating UI 的 `size` + `flip` 组合），两步缺一不可：
//   flip —— 下方放不下就翻到上方；
//   size —— 菜单高度**不是常量**，由当侧可用空间裁决，放不下就压缩 + 自身滚动。
// 只做 flip 而把高度写死，翻上去后菜单会按「最大高度」占座，内容少时底边
// 离光标一大截（看着像飘在别处，与输入点毫无关联）。
//
// 上方改用 bottom 而非 top 定位：菜单是 position: fixed，bottom 相对视口底，
// 于是「菜单底边贴光标上沿」恒成立——不必事先测量菜单高度，也就没有
// 「先渲染再校正」的一帧抖动。
// 下发为滚动区（.mk-slash-menu-scroll）的 max-height，非菜单总高：
// 菜单还要再加 padding(4*2) + border(1*2) = 10px，故超出该值的部分由
// VIEWPORT_MARGIN=8 吸收，内容填满时净越界 ≤2px，肉眼不可见，不值得为它加码。
const MENU_IDEAL_HEIGHT = 340; // 富余空间下的高度上限（≈ 历史 320 + padding/border）
const MENU_MIN_HEIGHT = 120; // 空间再挤也别把菜单压成一条缝（宁可略微溢出）
const MENU_MIN_WIDTH = 240;
const VIEWPORT_MARGIN = 8;
const CURSOR_GAP = 4;

export interface MenuPosition {
  /** 放光标下方时给 top；放上方时给 bottom（二者互斥） */
  top?: number;
  bottom?: number;
  left: number;
  /** 该侧可用高度，下发为 CSS max-height；内容超出时菜单自身滚动 */
  maxHeight: number;
}

export function computeMenuPosition(
  rect: { top: number; bottom: number; left: number },
  viewport: { width: number; height: number } = {
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  },
): MenuPosition {
  const { width: vw, height: vh } = viewport;

  // 两侧可用空间：已扣掉视口边距和与光标之间的缝隙
  const spaceBelow = vh - VIEWPORT_MARGIN - rect.bottom - CURSOR_GAP;
  const spaceAbove = rect.top - VIEWPORT_MARGIN - CURSOR_GAP;

  // flip：下方优先；下方放不下理想高度时，退到更宽敞的一侧
  const placeBelow = spaceBelow >= MENU_IDEAL_HEIGHT || spaceBelow >= spaceAbove;

  const vertical: Pick<MenuPosition, 'top' | 'bottom'> = placeBelow
    ? { top: rect.bottom + CURSOR_GAP }
    : { bottom: vh - rect.top + CURSOR_GAP };
  // size：菜单高度由当侧可用空间裁决，并夹在 [下限, 理想高度] 内——
  // 上限不可省：空间富余时若不封顶，菜单会随光标位置忽高忽低（同目录文件多
  // 或 slash 条目多时，屏幕上方输入会展开成近全屏高，退回到「菜单高度写死」
  // 的反面）。下限则保证再挤也还有几行可用（宁可略微溢出，不压成一条缝）。
  const maxHeight = Math.min(
    Math.max(placeBelow ? spaceBelow : spaceAbove, MENU_MIN_HEIGHT),
    MENU_IDEAL_HEIGHT,
  );

  let left = rect.left;
  if (left + MENU_MIN_WIDTH > vw - VIEWPORT_MARGIN) {
    left = vw - MENU_MIN_WIDTH - VIEWPORT_MARGIN;
  }
  if (left < VIEWPORT_MARGIN) {
    left = VIEWPORT_MARGIN;
  }

  return { ...vertical, left, maxHeight };
}

interface EditorExtensionOptions {
  slashMenuRef: Ref<SlashMenuController | null>;
  slashMenuItems: Ref<SlashCommandItem[]>;
  slashMenuCommand: Ref<(item: SlashCommandItem) => void>;
  emojiMenuRef: Ref<EmojiMenuController | null>;
  emojiMenuItems: Ref<EmojiItem[]>;
  emojiMenuCommand: Ref<(item: EmojiItem) => void>;
  wikilinkMenuRef: Ref<WikilinkMenuController | null>;
  wikilinkMenuItems: Ref<WikilinkCandidateItem[]>;
  wikilinkMenuCommand: Ref<(item: WikilinkCandidateItem) => void>;
  searchHighlightOptions: SearchHighlightOptions;
  /** 返回当前文档路径，用于粘贴图片时落盘 */
  getDocumentPath?: () => string | null;
  /** 返回自定义图片存储路径 */
  getStoragePath?: () => string | null;
  /** 互链 [[target]] 点击回调，由上层解析路径并打开目标文档 */
  onWikilinkNavigate?: (target: string) => void;
}

export function createEditorExtensions(options: EditorExtensionOptions) {
  const {
    slashMenuRef,
    slashMenuItems,
    slashMenuCommand,
    emojiMenuRef,
    emojiMenuItems,
    emojiMenuCommand,
    wikilinkMenuRef,
    wikilinkMenuItems,
    wikilinkMenuCommand,
  } = options;

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
    LinkOpen,
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
    Dim,
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
        // 代码上下文不弹菜单（A5 守卫当时漏加给 Slash，只加了 Emoji——勿再漏）：
        // 代码块里敲 `// 注释` 不应唤出命令菜单
        allow: ({ editor }) => !editor.isActive('codeBlock') && !editor.isActive('code'),
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase();
          return slashCommandItems.filter(
            (item) =>
              item.title.toLowerCase().includes(q) ||
              item.description.toLowerCase().includes(q) ||
              (item.alias?.toLowerCase().includes(q) ?? false),
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
              // stopPropagation：关 Slash 菜单不应顺带触发 window 级 Esc（焦点模式切换），
              // 与 Emoji / Wikilink 菜单一致
              event.stopPropagation();
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
        // 代码上下文不弹菜单（与 Slash 一致）：行内 code 里的 `https:` 等
        // 冒号内容不应唤出 Emoji 菜单
        allow: ({ editor }) => !editor.isActive('codeBlock') && !editor.isActive('code'),
        // 同 Slash：中文无词间空格习惯，「你好:微笑」也应唤出菜单。
        // Suggestion 默认 allowedPrefixes=[' '] 会过滤所有非空格/非行首前缀，
        // 对中文场景致命（Slash 已修，Emoji 漏修——勿再犯）。
        allowedPrefixes: null,
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
              // stopPropagation：关 Emoji 菜单不应顺带触发 window 级 Esc
              // （焦点模式切换），与 Slash 菜单一致
              event.stopPropagation();
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
    // 历史坑：`[[` 菜单曾因扩展级门控未接线而永不弹出（v1.2.43 起回归）。
    // 现门控只判代码上下文，文档路径只在 items / render 里按需读
    // options.getDocumentPath——不下沉到扩展，避免同一份状态两处维护。
    WikilinkSuggest.configure({
      suggestion: {
        // 中文无词间空格习惯（Slash/Emoji 同款教训），任意前缀后输入 [[ 都应唤出
        allowedPrefixes: null,
        items: ({ query }: { query: string }) =>
          filterWikilinkCandidates(query, options.getDocumentPath?.() ?? null),
        render: () => {
          // 异步候选刷新完成时重过滤：items() 是同步读缓存，磁盘列表到达后
          // 主动重算当前 query 的结果，菜单无缝从「缓存/空列表」切到新列表
          let currentQuery = '';
          const updateItems = () => {
            wikilinkMenuItems.value = filterWikilinkCandidates(
              currentQuery,
              options.getDocumentPath?.() ?? null,
            );
          };
          return {
            onStart: (props: WikilinkSuggestSuggestionProps) => {
              currentQuery = props.query;
              wikilinkMenuCommand.value = props.command;
              updateItems();
              const rect = props.clientRect?.();
              if (rect) wikilinkMenuRef.value?.show(computeMenuPosition(rect));
              // 后台刷新同目录候选（去重并发）；菜单先显示缓存，刷新后无缝更新
              void refreshWikilinkCandidates(options.getDocumentPath?.() ?? null).then(() => {
                updateItems();
              });
            },
            onUpdate: (props: WikilinkSuggestSuggestionProps) => {
              currentQuery = props.query;
              wikilinkMenuCommand.value = props.command;
              updateItems();
              const rect = props.clientRect?.();
              if (rect) wikilinkMenuRef.value?.show(computeMenuPosition(rect));
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              const { event } = props;
              if (event.key === 'Escape') {
                // stopPropagation：关互链菜单不应顺带触发 window 级 Esc
                //（焦点模式切换），与 Slash/Emoji 菜单一致
                event.stopPropagation();
                wikilinkMenuRef.value?.hide();
                return true;
              }
              return wikilinkMenuRef.value?.onKeyDown(event) ?? false;
            },
            onExit: () => {
              wikilinkMenuRef.value?.hide();
            },
          };
        },
      },
    }),
  ];
}
