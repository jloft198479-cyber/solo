/**
 * 输入法「合成冻结」总闸 —— 合成期视觉层行为的唯一真相源。
 *
 * 为什么需要它：solo 让同一个 contenteditable 同时当「输入法拼字面」和
 * 「markdown 实时渲染面」。输入法靠浏览器上报的光标矩形定位候选窗，矩形由 DOM
 * 算出来；合成期若重排 / 重建 DOM，矩形失真 → 候选窗失锚。
 * 详见 docs/solo输入法合成冻结总闸方案-2026-09-13.md §1。
 *
 * 铁律（新增任何 decoration / appendTransaction / nodeview / 浮动菜单都必须遵守）：
 * 合成期（isFrozen 为真）只允许浏览器自己的合成文字落地，其余一律推迟——
 *   - 装饰：走 mapFrozenDecorations（只平移、不重建）
 *   - 结构变身 / 菜单定位重渲 / nodeview 重建：直接跳过，等 compositionend 后再补
 *
 * 设计约束（勿违）：
 * 1. **不做全局 dispatch 拦截**：ProseMirror 的合成事务与应用事务走同一条通道，
 *    全局拦会连用户打的字一起挡掉。总闸是「一份共享契约 + 各入口主动接入」。
 * 2. **权威信号是 view.composing**（浏览器 DOM composition）。插件 state.apply /
 *    appendTransaction 拿不到 view，故用 createCompositionTracker() 在插件 view()
 *    里登记实例——每实例一份闭包，多编辑器不串台。
 * 3. **退化安全**：view 缺失 / 已销毁一律视为「未冻结」。宁可少冻结（退回旧行为），
 *    也绝不挡掉合成文字。
 */
import type { Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { DecorationSet, EditorView } from '@tiptap/pm/view';

/** 浏览器是否正在输入法组字中。view 缺失 / 已销毁 → false（退化安全）。 */
export function isFrozen(view: EditorView | null | undefined): boolean {
  return view?.composing === true;
}

/**
 * 合成期装饰的唯一正确做法：只按事务 map 平移已有装饰跟随 doc 变化，绝不重建。
 * 重建（remove + add）会换掉正在组字段落的 DOM 包装节点 → 光标矩形失真 → 候选窗失锚。
 * 组字结束后首个非组字事务会带最新内容重建，效果不会漏。
 */
export function mapFrozenDecorations(
  set: DecorationSet,
  tr: Transaction,
  doc: PMNode = tr.doc,
): DecorationSet {
  return tr.docChanged ? set.map(tr.mapping, doc) : set;
}

/**
 * 每实例一份的 view 登记器。
 *
 * state.apply / appendTransaction 拿不到 view，而 view.composing 是组字的权威信号，
 * 因此插件在 view() 生命周期里把实例登记进来。闭包随插件实例走，多编辑器不串台
 * （同 search-highlight 把引用比较缓存放闭包的先例）。
 */
export function createCompositionTracker() {
  let view: EditorView | null = null;

  return {
    /** 在插件 view() 中登记；返回注销函数，请在插件 destroy() 里调用。 */
    track(editorView: EditorView): () => void {
      view = editorView;
      return () => {
        if (view === editorView) view = null;
      };
    },
    /** 该实例是否正在组字。 */
    isFrozen(): boolean {
      return isFrozen(view);
    },
  };
}
