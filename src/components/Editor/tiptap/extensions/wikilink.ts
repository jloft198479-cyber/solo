/**
 * Wikilink 内联节点扩展
 *
 * 支持 Obsidian 风格 [[page]] 和 [[page|display]] 语法。
 * 渲染为带有特殊样式的内联链接。
 *
 * 点击跳转：单击 wikilink 节点触发 onNavigate(target) 回调，由上层
 * （MarkdownEditor.vue）解析目标路径并打开对应文档。
 */
import { Node, mergeAttributes, InputRule } from '@tiptap/vue-3';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { hasMarkdownExtension } from './wikilink-drop';

const wikilinkClickKey = new PluginKey('wikilinkClick');

/**
 * 把互链目标拆成「文件部分」与「锚点部分」（纯函数，便于单测）。
 *
 * `[[笔记#小节]]` 的文件部分是 `笔记`，`#小节` 是 Obsidian 风格的标题锚点。
 * solo 不做锚点跳转（YAGNI），但**必须把锚点从文件名里剥掉**——否则 `#` 会参与
 * 路径拼接，导致「文件明明在却被标红」以及点开时创建出 `笔记#小节.md` 这种带 `#`
 * 的垃圾文件（2026-10-20 评估 P0-1；Obsidian 官方也把 `#` 定义为锚点分隔符）。
 *
 * 只切**第一个** `#`：Obsidian 的多级锚点 `[[A#一级#二级]]` 整段都算锚点。
 * 代价：文件名本身含 `#` 时无法被链接到（Windows 允许该字符但 Obsidian 明确禁止，
 * 且互链语法里天然歧义）——取舍见 docs 台账。
 */
export function splitWikilinkAnchor(target: string): { path: string; anchor: string } {
  const t = target.trim();
  const hash = t.indexOf('#');
  if (hash < 0) return { path: t, anchor: '' };
  return { path: t.slice(0, hash).trim(), anchor: t.slice(hash + 1).trim() };
}

/**
 * 把互链目标 [[target]] 解析为当前文档同目录下的绝对路径（纯函数，便于单测）。
 * - 兼容 \ 与 / 分隔符，沿用当前文档路径的分隔符
 * - 目标无扩展名时补 .md（[[B]] → B.md，[[sub/B]] → sub/B.md）
 * - `#` 之后是标题锚点，不参与文件名（[[B#小节]] → B.md；[[#小节]] → null，指向本文档）
 * - 当前文档未保存（currentPath 为空）或无目录信息时返回 null
 */
export function resolveWikilinkTarget(
  currentPath: string | null | undefined,
  target: string,
): string | null {
  if (!currentPath) return null;
  const { path: t } = splitWikilinkAnchor(target);
  if (!t) return null;

  const lastSep = Math.max(currentPath.lastIndexOf('\\'), currentPath.lastIndexOf('/'));
  if (lastSep < 0) return null;
  const dir = currentPath.slice(0, lastSep);
  const sep = currentPath[lastSep];

  const normalized = t.replace(/[\\/]+/g, sep);
  // 只有 `.md` / `.markdown` 算「已带后缀」，其余补 `.md`（`.env` → `.env.md`）。
  // 与 Obsidian 同口径：文件名里有点不等于写了后缀，判据必须是 markdown 后缀本身。
  const withExt = hasMarkdownExtension(normalized) ? normalized : `${normalized}.md`;
  return `${dir}${sep}${withExt}`;
}

export const Wikilink = Node.create<{
  onNavigate?: (target: string) => void;
}>({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,

  addOptions() {
    return {
      onNavigate: undefined,
    };
  },

  addAttributes() {
    return {
      target: { default: '' },
      alias: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-wikilink]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const target = node.attrs.target as string;
    const alias = node.attrs.alias as string;
    const display = alias || target;

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-wikilink': target,
        class: 'mk-wikilink',
        title: target,
      }),
      display,
    ];
  },

  addInputRules() {
    return [
      // [[page|alias]] 或 [[page]]
      new InputRule({
        find: /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/,
        handler: ({ state, range, match }) => {
          const target = match[1]?.trim() || '';
          const alias = match[2]?.trim() || '';
          if (!target) return;
          // `![[foo]]` 是嵌入语法（solo 不支持，suggestion-guard 早为 `![[` 加过同款
          // 守卫）：不带 `!` 判别会把 `!` 留在原地 + 尾部转互链，产出语义错误的
          // 「伪嵌入」——对齐 convertPendingLink 对 `![` 的 #22 修法（审计 C-7）
          if (range.from > 0 && state.doc.textBetween(range.from - 1, range.from) === '!') {
            return;
          }

          const node = this.type.create({ target, alias });
          state.tr.replaceWith(range.from, range.to, node);
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const onNavigate = this.options.onNavigate;
    const type = this.type;
    return [
      new Plugin({
        key: wikilinkClickKey,
        props: {
          // 单击 wikilink 节点 → 触发跳转回调，返回 true 阻止默认的 atom 选中行为。
          // 编辑链接仍可键盘操作：方向键定位光标、Shift+方向键选中后 Backspace 删除。
          handleClickOn(_view, _pos, node) {
            if (node.type === type && onNavigate) {
              onNavigate(node.attrs.target as string);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
