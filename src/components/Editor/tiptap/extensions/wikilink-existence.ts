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
import { splitWikilinkAnchor } from './wikilink';
import { WIKILINK_SCAN_DEPTH } from './wikilink-drop';
import type { MarkdownFileList } from '../../../../services/tauri/document';

export const wikilinkExistenceKey = new PluginKey<DecorationSet>('wikilinkExistence');

/**
 * 目录递归深度的真理源在 `wikilink-drop.ts`（纯函数模块，composables 层也能安全引用，
 * 不会为一个常量把 tiptap 拖进非 UI 层）。这里 re-export，让「判定」的调用方就近导入。
 *
 * 为什么判定要用它：清单只覆盖「当前文档所在目录 + 向下 N 层」。更深的目标扫不到，
 * 判「不存在」就是误标红 —— 一律不判。三处（列候选 / 标红 / 改名扫描）必须同深度，
 * 否则又会造出「这个入口认、那个入口不认」的不对称。
 */
export { WIKILINK_SCAN_DEPTH };

/**
 * 建「已存在文件」索引：只登记**解析器真能拼出来的写法**。
 *
 * - 清单元素是相对路径（`sub/B.md`），索引键统一小写 `/`，并同时收录去 `.md` 的形态；
 * - **不登记末段裸名**：`sub/c.md` 不许让 `[[C]]` 变成「存在」——解析器会把 `[[C]]`
 *   拼成 `C.md`（同目录），那里没有这个文件。若登记裸名，界面不标红、点下去却弹
 *   「是否创建」，正是 2026-10-20 评估里 P0-3 那种自相矛盾。
 * - **只收 `.md`**：清单本身只列 `.md`，收 `.markdown/.txt` 会让 `[[B]]` 在只有
 *   `B.markdown` 时被判「存在」，而解析器只补 `.md` ⇒ 同样落回上面的矛盾。
 */
export function buildWikilinkNameIndex(files: readonly string[]): Set<string> {
  const index = new Set<string>();
  for (const file of files) {
    const rel = file.replace(/\\/g, '/').toLowerCase();
    if (!rel.endsWith('.md') || rel.length <= 3) continue;
    index.add(rel);
    index.add(rel.slice(0, -3));
  }
  return index;
}

/**
 * 互链目标是否找不到（纯函数，便于单测）。
 *
 * 下列情况返回 `false`（不标红）——都是「判不了」而不是「一定在」，
 * 宁可漏标也不能误标（误标＝满屏红波浪线）：
 * - 索引为空：目录清单还没拿到（含读取失败）
 * - 目标为空 / 纯锚点 `[[#小节]]`
 * - 绝对路径（`C:...` / `/...`）：不在相对清单里，判不了
 * - 目标含 `..`：出界到父目录及以上，扫描范围之外
 * - 路径段数超过 `WIKILINK_SCAN_DEPTH`：超出扫描深度
 * - 目标自带**非 `.md`** 扩展名（`[[B.markdown]]`）：清单只列 `.md`
 *
 * `#` 之后是标题锚点，先剥掉再比（`[[B#小节]]` 判的是 `B`）。
 */
export function isWikilinkTargetMissing(
  target: string,
  index: ReadonlySet<string>,
): boolean {
  if (index.size === 0) return false;
  const { path } = splitWikilinkAnchor(target);
  if (!path) return false;

  // 归一成小写 `/`：索引键就是这个形态。含 `\` 才 replace，多数情况零额外分配
  let t = path.includes('\\') ? path.replace(/\\/g, '/') : path;
  if (t.includes('//')) t = t.replace(/\/{2,}/g, '/');
  t = t.toLowerCase();

  // 绝对路径不在「相对清单」的坐标系里，判不了
  if (t.startsWith('/') || /^[a-z]:/.test(t)) return false;

  const segments = t.split('/');
  // 出界（父目录及以上）：扫描只往下走，判不了
  if (segments.includes('..')) return false;
  // 超出扫描深度：清单里根本不会出现，判不了
  if (segments.length - 1 > WIKILINK_SCAN_DEPTH) return false;

  // 非 .md 扩展名：清单只列 .md（用 lastIndexOf 判，比正则少一次对象分配）
  const lastDot = t.lastIndexOf('.');
  const lastSlash = t.lastIndexOf('/');
  if (lastDot > lastSlash + 1 && t.slice(lastDot + 1) !== 'md') return false;

  return !index.has(t);
}

/** 悬停提示里的文件名：目标已带扩展名就原样用，别拼成 `B.md.md`；锚点不进文件名。 */
function displayFileName(target: string): string {
  const { path } = splitWikilinkAnchor(target);
  return /\.[a-z0-9]+$/i.test(path) ? path : `${path}.md`;
}

function buildDecorations(doc: PMNode, getFiles: () => MarkdownFileList): DecorationSet {
  const { files, truncated } = getFiles();
  // 清单可能不完整（凑满文件上限 / 触到目录预算）⇒ 任何「不在清单里」都不能当作不存在。
  // 这条判据由 Rust 侧显式给出（`truncated`），不再靠「长度 == 上限」去猜——
  // 目录闸门触发时长度可能远不到上限，猜不出来。
  if (truncated) return DecorationSet.empty;
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
   * 返回目录树候选清单（含完整性标志）。数据源复用 `wikilink-suggest` 的候选缓存
   * ——不额外读目录。
   */
  getSiblingFiles: () => MarkdownFileList;
}

export const WikilinkExistence = Extension.create<WikilinkExistenceOptions>({
  name: 'wikilinkExistence',

  addOptions() {
    return { getSiblingFiles: () => ({ files: [], truncated: false }) };
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
