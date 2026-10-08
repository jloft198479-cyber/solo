import type { Transaction } from '@tiptap/pm/state';

/**
 * 事务形态判定 —— 装饰类插件的公共前提，一处定义。
 *
 * `paragraph-focus`（块级 active/dimmed）与 `list-fold`（列表折叠）都要先回答
 * 「这个事务是不是把整篇文档换了」：整体替换时，为旧文档建的装饰**不能**靠
 * `map` 平移沿用到新文档——旧装饰对新 doc 无效，必须按新 doc 全量重建。
 * 两个插件各自复制一份判定会漂移，故收到这里。
 */
export function isWholeDocReplace(tr: Transaction): boolean {
  if (tr.steps.length !== 1) return false;
  let whole = false;
  tr.steps[0].getMap().forEach((from, to) => {
    if (from === 0 && to === tr.before.content.size) whole = true;
  });
  return whole;
}
