/**
 * `[[` 互链文件名补全（Suggestion 基建，Slash/Emoji 同款）
 *
 * 输入 `[[` 唤出同目录 .md 文件菜单，继续输入过滤，选中后直接插入
 * wikilink 节点（不依赖 InputRule 时序）。候选由 Rust `list_markdown_files`
 * 提供（同目录、仅 .md、排序、上限 500）；菜单每次唤起后台刷新一次
 * （本地磁盘毫秒级），刷新完成前先显示缓存/空列表，完成后无缝更新。
 */
import { Extension } from '@tiptap/vue-3';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';

import { guardedFindSuggestionMatch } from './suggestion-guard';
import { listMarkdownFiles } from '../../../../services/tauri/document';

const wikilinkPluginKey = new PluginKey('wikilinkSuggest');

/** 菜单最多展示条数（目录文件多时截断，菜单自身可滚动） */
const MENU_ITEM_LIMIT = 50;

export interface WikilinkCandidateItem {
  /** 文件名（含 .md），用作菜单 key 与排除自身 */
  fileName: string;
  /** 插入到 [[...]] 的 target（文件名去掉 .md 后缀） */
  target: string;
}

// ── 候选缓存 ────────────────────────────────────────────────────
//
// 单槽缓存（key = 当前文档路径）。切换文档后首次唤起时缓存 key 不匹配 →
// 先显示空列表，后台刷新完成后由 render 回调重过滤无缝更新；文档切换时
// 的主动预取（MarkdownEditor watch）让多数唤起直接命中缓存。
// 多窗口各自唤起时最后一次刷新生效——错窗首帧顶多短暂空列表，可接受。
let cachedCandidates: { docPath: string; files: string[] } | null = null;
let inflight: { docPath: string; promise: Promise<void> } | null = null;

export function getWikilinkCandidates(docPath: string | null): string[] {
  if (!docPath || cachedCandidates?.docPath !== docPath) return [];
  return cachedCandidates.files;
}

/**
 * 后台刷新同目录 .md 候选。失败退化为空列表（菜单显示「无匹配文档」），
 * 不弹窗打断输入——补全是辅助功能，目录读取失败不上升为用户可见错误。
 */
export function refreshWikilinkCandidates(docPath: string | null): Promise<void> {
  if (!docPath) return Promise.resolve();
  if (inflight && inflight.docPath === docPath) return inflight.promise;

  const promise = listMarkdownFiles(docPath)
    .then((files) => {
      cachedCandidates = { docPath, files };
    })
    .catch(() => {
      cachedCandidates = { docPath, files: [] };
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
  inflight = { docPath, promise };
  return promise;
}

function basename(path: string): string {
  const lastSep = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return lastSep < 0 ? path : path.slice(lastSep + 1);
}

/** 过滤候选：排除当前文档自身，按 query 大小写不敏感子串匹配 target。 */
export function filterWikilinkCandidates(
  query: string,
  docPath: string | null,
): WikilinkCandidateItem[] {
  const files = getWikilinkCandidates(docPath);
  if (!files.length) return [];

  const selfName = docPath ? basename(docPath) : '';
  const q = query.trim().toLowerCase();
  const items: WikilinkCandidateItem[] = [];
  for (const fileName of files) {
    if (fileName === selfName) continue;
    const target = fileName.slice(0, -3); // 去 .md（Rust 侧保证有后缀）
    if (!target) continue;
    if (!q || target.toLowerCase().includes(q)) {
      items.push({ fileName, target });
      if (items.length >= MENU_ITEM_LIMIT) break;
    }
  }
  return items;
}

export interface WikilinkSuggestOptions {
  suggestion: Omit<SuggestionOptions<WikilinkCandidateItem, WikilinkCandidateItem>, 'editor'>;
  /** 当前文档路径；无路径 = 未保存文档，不唤出补全（互链无法解析相对目标） */
  getDocumentPath: () => string | null;
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
      getDocumentPath: () => null,
    };
  },

  addProseMirrorPlugins() {
    const getDocumentPath = this.options.getDocumentPath;
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: wikilinkPluginKey,
        findSuggestionMatch: guardedFindSuggestionMatch,
        // 代码上下文不弹菜单（Slash/Emoji 同款守卫）；未保存文档不弹
        //（无基准目录，互链目标解析不了）
        allow: ({ editor }) =>
          !editor.isActive('codeBlock') &&
          !editor.isActive('code') &&
          !!getDocumentPath(),
        ...this.options.suggestion,
      }),
    ];
  },
});
