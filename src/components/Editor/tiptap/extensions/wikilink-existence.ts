/**
 * 失效互链标记：互链指向的文件**不存在**时，把它标成红色波浪线并在悬停时说明原因。
 *
 * # 为什么需要这个
 *
 * 互链目标存的是**裸文件名**（`[[B]]`），而文件在系统里被改名（尤其**资源管理器里右键
 * 重命名**）时，solo 收不到任何通知 —— 没有文件监视器，改名后 A 里的 `[[B]]` 就成了
 * 死链：点它没反应，界面上也看不出任何异常，用户只能自己发现「怎么打不开了」。
 * （2026-10-20 用户实测踩到：`Desktop\solo` 里 `solo-极简…md` 仍写着 `[[幕布测试]]`，
 * 同目录文件已叫 `测试幕布.md`，全程无提示。）
 *
 * 这里不做同步（改不了别人的文件），只做**让你看得见**：打开文档时拿同目录文件清单比对，
 * 找不到的把互链标红。
 *
 * # 为什么用 decoration 而不是改节点属性
 *
 * 「文件在不在」是**环境状态**、不是文档内容 —— 塞进节点属性会进 schema / 进序列化，
 * 改天文件回来了还得改文档；decoration 是纯展示层，随文档关闭消失，零持久化代价。
 *
 * # 性能
 *
 * 全量重建**只在打开/切换文档、以及目录清单刷新后**发生（`refresh` meta）。
 * 打字（`docChanged`）只做 `DecorationSet.map` 平移，绝不重扫全文档 ——
 * 这条是硬约束，别退回「doc 变了就重建」（同 `list-fold` 的教训）。
 * 代价：新插入的互链要等下次打开文档才会标红。
 */
import { Extension } from '@tiptap/vue-3';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export const wikilinkExistenceKey = new PluginKey<DecorationSet>('wikilinkExistence');

/**
 * 同目录候选清单的数量上限，**必须与 Rust `document.rs::SAME_DIR_DOC_LIMIT` 一致**
 * （由 `wikilink-existence.spec.ts` 的「上限对齐」用例读源码校验）。
 *
 * 为什么需要它：Rust 侧排序后 `truncate(500)`，超出部分的文件**不在清单里**。
 * 若照常比对，排在 500 名之后的文件会被判成「不存在」而标红 —— 实测 602 个文件的
 * 目录里 `[[zzz]]` 就被误标了。所以清单一旦达到上限就视为「不完整」，一律不标。
 */
export const WIKILINK_CANDIDATE_LIMIT = 500;

/** 建「同目录已存在名字」索引：同时收录带扩展名与去扩展名两种写法，比较一律小写。 */
export function buildWikilinkNameIndex(files: readonly string[]): Set<string> {
  const index = new Set<string>();
  for (const file of files) {
    const name = file.toLowerCase();
    index.add(name);
    for (const ext of ['.md', '.markdown', '.txt']) {
      if (name.endsWith(ext)) index.add(name.slice(0, -ext.length));
    }
  }
  return index;
}

/**
 * 互链目标是否找不到（纯函数，便于单测）。
 *
 * 不标红的三类，都是「判不了」而不是「一定在」—— 宁可漏标也不能误标（误标＝满屏红波浪线）：
 * - 索引为空：目录清单还没拿到（含读取失败），此时一律不标
 * - 目标带路径分隔符（`[[sub/B]]`）：清单只含同目录，子目录目标判不了
 * - 目标自带**非 `.md`** 扩展名（`[[B.markdown]]` / `[[B.txt]]`）：清单只列 `.md`，
 *   这类目标指向的文件根本不在清单里，判不了（实测 `[[D.markdown]]` 曾被误标红）
 * - 目标为空
 */
export function isWikilinkTargetMissing(
  target: string,
  index: ReadonlySet<string>,
): boolean {
  if (index.size === 0) return false;
  const t = target.trim();
  if (!t) return false;
  if (/[\\/]/.test(t)) return false;
  const ext = /\.([a-z0-9]+)$/i.exec(t);
  if (ext && ext[1].toLowerCase() !== 'md') return false;
  return !index.has(t.toLowerCase());
}

/** 悬停提示里的文件名：目标已带扩展名就原样用，别拼成 `B.md.md`。 */
function displayFileName(target: string): string {
  return /\.[a-z0-9]+$/i.test(target) ? target : `${target}.md`;
}

function buildDecorations(doc: PMNode, getFiles: () => readonly string[]): DecorationSet {
  const files = getFiles();
  // 清单达到上限 = 可能被 Rust 侧截断，此时任何「不在清单里」都不能当作不存在
  if (files.length >= WIKILINK_CANDIDATE_LIMIT) return DecorationSet.empty;
  const index = buildWikilinkNameIndex(files);
  if (index.size === 0) return DecorationSet.empty;

  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => { // perf-allow: 仅 init 与显式 refresh（打开/切文档、清单刷新）跑一次；打字走 map 平移
    if (node.type.name !== 'wikilink') return;
    const target = String(node.attrs.target ?? '');
    if (!isWikilinkTargetMissing(target, index)) return;
    decorations.push(
      Decoration.inline(pos, pos + node.nodeSize, {
        class: 'mk-wikilink--broken',
        title: `目标文件不存在：${displayFileName(target.trim())}（可能已被改名或删除）`,
      }),
    );
  });
  return DecorationSet.create(doc, decorations);
}

export interface WikilinkExistenceOptions {
  /**
   * 返回同目录可编辑文档的文件名清单（含扩展名）。
   * 数据源复用 `wikilink-suggest` 的候选缓存 —— 不额外读目录。
   */
  getSiblingFiles: () => readonly string[];
}

export const WikilinkExistence = Extension.create<WikilinkExistenceOptions>({
  name: 'wikilinkExistence',

  addOptions() {
    return { getSiblingFiles: () => [] };
  },

  addProseMirrorPlugins() {
    const getFiles = () => this.options.getSiblingFiles();

    return [
      new Plugin<DecorationSet>({
        key: wikilinkExistenceKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc, getFiles),
          apply(tr, previous, oldState, newState) {
            // 打开文档 / 目录清单刷新后由上层显式派发 —— 全量重扫只在这时发生
            if (tr.getMeta(wikilinkExistenceKey)) {
              return buildDecorations(newState.doc, getFiles);
            }
            if (!tr.docChanged) return previous;
            // 整篇替换（切文档 / 重设内容 / 载入）：`replaceWith(0, size, doc)` 会把所有
            // inline 装饰映射成零长度并丢弃 —— 只 map 不重建会让标记凭空消失
            // （实测：搜索框输入触发一次等长整篇替换，坏链标记就再也回不来了）。
            const wholeDocReplace = tr.steps.some((step) => {
              const s = step as unknown as { from?: number; to?: number };
              return s.from === 0 && s.to === oldState.doc.content.size;
            });
            if (wholeDocReplace) return buildDecorations(newState.doc, getFiles);
            const mapped = previous.map(tr.mapping, tr.doc);
            // 兜底：装饰被映射没了（原先有、现在一个不剩）→ 重建一次。
            // 只在「全丢」时发生，正常打字始终走 map 平移（性能硬约束）。
            if (previous.find().length > 0 && mapped.find().length === 0) {
              return buildDecorations(newState.doc, getFiles);
            }
            return mapped;
          },
        },
        props: {
          decorations: (state) => wikilinkExistenceKey.getState(state) ?? DecorationSet.empty,
        },
      }),
    ];
  },
});
