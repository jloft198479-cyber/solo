/**
 * `[[` 互链文件名补全（Suggestion 基建，Slash/Emoji 同款）
 *
 * 输入 `[[` 唤出**当前文档所在目录及其下若干层子目录**的 .md 菜单，继续输入过滤，
 * 选中后直接插入 wikilink 节点（不依赖 InputRule 时序）。候选由 Rust
 * `list_markdown_files` 提供（相对路径、仅 .md、浅层优先排序、上限 500、深度见
 * `WIKILINK_SCAN_DEPTH`）；菜单每次唤起后台刷新一次（本地磁盘毫秒级），
 * 刷新完成前先显示缓存/空列表，完成后无缝更新。
 *
 * 插入的 target 是**相对路径**（`sub/B`）——与手打写法、`resolveWikilinkTarget`
 * 的拼接规则三者天然一致，不需要额外换算。
 */
import { Extension, type Editor } from '@tiptap/vue-3';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';

import { guardedFindSuggestionMatch } from './suggestion-guard';
import { basename, isLinkableTarget } from './wikilink-drop';
import { listMarkdownFiles, type MarkdownFileList } from '../../../../services/tauri/document';

const wikilinkPluginKey = new PluginKey('wikilinkSuggest');

/** 菜单最多展示条数（目录文件多时截断，菜单自身可滚动） */
const MENU_ITEM_LIMIT = 50;

export interface WikilinkCandidateItem {
  /** 相对路径（含 .md），用作菜单 key 与排除自身 */
  fileName: string;
  /** 插入到 [[...]] 的 target（相对路径去掉 .md 后缀，如 `sub/B`） */
  target: string;
}

// ── 候选缓存 ────────────────────────────────────────────────────
//
// 单槽缓存（key = 当前文档路径）。切换文档后首次唤起时缓存 key 不匹配 →
// 先显示空列表，后台刷新完成后由 render 回调重过滤无缝更新；文档切换时
// 的主动预取（MarkdownEditor watch）让多数唤起直接命中缓存。
// 多窗口各自唤起时最后一次刷新生效——错窗首帧顶多短暂空列表，可接受。
let cachedCandidates: { docPath: string; list: MarkdownFileList } | null = null;
let inflight: { docPath: string; promise: Promise<void> } | null = null;

/**
 * 空清单：每次新建对象，避免共享可变状态。`truncated: false` 配空 `files`，
 * 在标红侧走的是「索引为空 → 不标」分支，语义安全。
 */
function emptyFileList(): MarkdownFileList {
  return { files: [], truncated: false };
}

export function getWikilinkCandidates(docPath: string | null): MarkdownFileList {
  if (!docPath || cachedCandidates?.docPath !== docPath) return emptyFileList();
  return cachedCandidates.list;
}

/**
 * 后台刷新目录树候选。失败退化为空清单（菜单显示「无匹配文档」），
 * 不弹窗打断输入——补全是辅助功能，目录读取失败不上升为用户可见错误。
 */
export function refreshWikilinkCandidates(docPath: string | null): Promise<void> {
  if (!docPath) return Promise.resolve();
  if (inflight && inflight.docPath === docPath) return inflight.promise;

  const promise = listMarkdownFiles(docPath)
    .then((list) => {
      cachedCandidates = { docPath, list };
    })
    .catch(() => {
      cachedCandidates = { docPath, list: emptyFileList() };
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
  inflight = { docPath, promise };
  return promise;
}

/** 文件名的可编辑后缀（Rust 侧只列 .md，这里仍按后缀判断而不是硬切 3 字节）。 */
const DOC_SUFFIX = /\.md$/i;

/** 过滤候选：排除当前文档自身，按 query 大小写不敏感子串匹配 target。 */
export function filterWikilinkCandidates(
  query: string,
  docPath: string | null,
): WikilinkCandidateItem[] {
  const { files } = getWikilinkCandidates(docPath);
  if (!files.length) return [];

  const selfName = docPath ? basename(docPath) : '';
  const q = query.trim().toLowerCase();
  const items: WikilinkCandidateItem[] = [];
  for (const fileName of files) {
    // 清单是相对路径：同层自身就是文件名本身，子目录里的同名文件不算自身
    if (fileName === selfName) continue;
    const target = fileName.replace(DOC_SUFFIX, '');
    if (!target) continue;
    // 含 `#` / `[` / `]` / `|` 的文件名解析器读不回来 —— 不进菜单，避免「选中即死链」
    if (!isLinkableTarget(target)) continue;
    if (!q || target.toLowerCase().includes(q)) {
      items.push({ fileName, target });
      if (items.length >= MENU_ITEM_LIMIT) break;
    }
  }
  return items;
}

/**
 * 互链补全是否可唤出：**只受代码上下文限制**。
 *
 * 未保存文档（无路径）**照常返回 true**——候选自然退化为空列表
 * （`getWikilinkCandidates(null)` → `[]`），菜单空态换成引导文案。
 * 早前这里还叠了一道 `!!getDocumentPath()`，等于静默禁用：敲 `[[` 毫无
 * 反应，用户只能以为补全坏了。弹出来把规则说清楚，不打断输入。
 */
export function isWikilinkSuggestAllowed(editor: Pick<Editor, 'isActive'>): boolean {
  return !editor.isActive('codeBlock') && !editor.isActive('code');
}

export interface WikilinkSuggestOptions {
  suggestion: Omit<SuggestionOptions<WikilinkCandidateItem, WikilinkCandidateItem>, 'editor'>;
}

export const WikilinkSuggest = Extension.create<WikilinkSuggestOptions>({
  name: 'wikilinkSuggest',

  addOptions(): WikilinkSuggestOptions {
    return {
      suggestion: {
        char: '[[',
        startOfLine: false,
        items: () => [],
        command: ({ editor, range, props }) => {
          // deleteRange 吃掉「[[query」原文，直接插入 wikilink 节点
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({ type: 'wikilink', attrs: { target: props.target, alias: '' } })
            .run();
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: wikilinkPluginKey,
        findSuggestionMatch: guardedFindSuggestionMatch,
        allow: ({ editor }) => isWikilinkSuggestAllowed(editor),
        ...this.options.suggestion,
      }),
    ];
  },
});
