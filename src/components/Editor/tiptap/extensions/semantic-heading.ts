/**
 * 标题扩展
 *
 * 仅提供 heading 节点定义，**不**注册即时转换的 input rule。
 *
 * 原因：`# ` 即时转成空 heading 后，若用户紧接着开始 IME composition，
 * ProseMirror 的 compositionstart 会强制 flush DOM observer，此时 DOM 与文档
 * 不同步，readDOMChange 会把拼音留在标题、把上屏中文丢到下一段。
 *
 * 因此标题采用「pending heading」策略：输入 `# 文字` 时段落保持为 paragraph，
 * 用 CSS 装饰模拟标题外观，等输入稳定（非 composition）后再转换为真正的 heading。
 * 该转换逻辑与行内标记转换共用同一个引擎与同一份 composition 状态，
 * 集中在 markdown-input.ts，避免多插件抢 composition 状态的竞态。
 */
import { Heading } from '@tiptap/extension-heading';

export const SemanticHeading = Heading.extend({
  // 关闭内置的 `# ` → heading 即时 input rule，改由 markdown-input.ts 的
  // pending-heading 机制在输入稳定后转换。
  addInputRules() {
    return [];
  },
  // 键位对齐注册表（键位真理源 src/commands/registry.ts，台账 §二 #28）：
  // 注册表承诺 Mod-1..6（Typora 心智），但 TipTap 默认是 Mod-Alt-1..6——
  // 承诺的键按了没反应、实际生效的键从未宣传过。此处覆写让编辑器内真实
  // 生效的键 = 注册表声明的键，一致性由 commands/__tests__/shortcut-consistency.spec 锁定。
  addKeyboardShortcuts() {
    return this.options.levels.reduce(
      (items, level) => ({
        ...items,
        [`Mod-${level}`]: () => this.editor.commands.toggleHeading({ level }),
      }),
      {},
    );
  },
}).configure({
  levels: [1, 2, 3, 4, 5, 6],
});
