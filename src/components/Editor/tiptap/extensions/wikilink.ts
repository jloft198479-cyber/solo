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

const wikilinkClickKey = new PluginKey('wikilinkClick');

/**
 * 把互链目标 [[target]] 解析为当前文档同目录下的绝对路径（纯函数，便于单测）。
 * - 兼容 \ 与 / 分隔符，沿用当前文档路径的分隔符
 * - 目标无扩展名时补 .md（[[B]] → B.md，[[sub/B]] → sub/B.md）
 * - 当前文档未保存（currentPath 为空）或无目录信息时返回 null
 */
export function resolveWikilinkTarget(
  currentPath: string | null | undefined,
  target: string,
): string | null {
  if (!currentPath) return null;
  const t = target.trim();
  if (!t) return null;

  const lastSep = Math.max(currentPath.lastIndexOf('\\'), currentPath.lastIndexOf('/'));
  if (lastSep < 0) return null;
  const dir = currentPath.slice(0, lastSep);
  const sep = currentPath[lastSep];

  const normalized = t.replace(/[\\/]+/g, sep);
  const withExt = /\.[^\\/]+$/.test(normalized) ? normalized : `${normalized}.md`;
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
