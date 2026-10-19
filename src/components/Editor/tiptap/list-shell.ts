import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { ITEM_NODE_TYPES, LIST_NODE_TYPES } from './list-move';

/**
 * 「纯空壳列表项」的判定与溶解 —— **列表里唯一被允许的「没有正文的项」出口**。
 *
 * 什么是空壳：`listItem` 自身没有任何文字，孩子全是（或只剩）子列表。
 * markdown 里它只能落成 `- - 甲` 这种结构：既讲不出「这一行是什么」，
 * 又会在屏幕上留下一个**没有内容的圆点**——若子列表还在它下面，壳的
 * `li::marker` 与子项 marker 会挤在同一行（用户看到的就是「两个点」，
 * 2026-10-19 报告；台账 §一 #50 的 `- - 乙` 是同族）。
 *
 * 为什么不能只靠 schema 拦：本仓 `listItem.content = 'block+'`（台账 §二 #30），
 * 一个只装 `bulletList` 的列表项在 schema 里是**合法**的 ⇒ 没有任何一道机器
 * 校验会拒绝它，只能由结构改写的出口自己保证不留下它。
 *
 * 两条使用路径（共用这一份实现，勿各自复制）：
 * - `list-demote.ts`：父项「转普通段落」时托孤子列表，壳随之溶解；
 * - `extensions/list-backspace-guard.ts`：空父项行首退格时整壳溶解（子项升一级），
 *   而不是只删掉那行空段落。
 */

/**
 * 纯空壳列表项判定。
 *
 * 空段落孩子（无文字）不打破 onlyLists ⇒ 含「空段落 + 子列表」的项也算纯壳，
 * 会连空段落一起溶解 —— 空段落没有 markdown 表达，属预期取舍。
 */
export function isPureShell(node: PMNode): boolean {
  if (!ITEM_NODE_TYPES.has(node.type.name)) return false;
  let onlyLists = true;
  node.forEach((c) => {
    if (!LIST_NODE_TYPES.has(c.type.name) && c.textContent.trim().length > 0) onlyLists = false;
  });
  return onlyLists;
}

/**
 * 把纯空壳列表项溶解掉：子列表项提升到父列表（与父列表同类型时展开成兄弟项；
 * 类型不同但父容器收得下就整块搬过去）。
 *
 * 保守原则：任何一个子列表**塞不进父容器**（例如 `taskList` 挂在只收
 * `listItem | taskItem` 的 `bulletList` 下）就整体放弃、不改文档 —— 宁可留壳，
 * 也不写出一条会被 PM 补齐成畸形、甚至直接抛错的结构。调用方据
 * `tr.steps.length === 0` 判断是否真的改动过。
 */
export function dissolveShell(tr: Transaction, shellPos: number): void {
  const shell = tr.doc.nodeAt(shellPos);
  if (!shell || !isPureShell(shell)) return;
  const $pos = tr.doc.resolve(shellPos + 1);
  let itemDepth = -1;
  for (let d = $pos.depth; d > 0; d--) {
    if (ITEM_NODE_TYPES.has($pos.node(d).type.name)) {
      itemDepth = d;
      break;
    }
  }
  if (itemDepth < 1) return;
  const parentList = $pos.node(itemDepth - 1);
  if (!LIST_NODE_TYPES.has(parentList.type.name)) return;
  const promoted: PMNode[] = [];
  let compatible = true;
  shell.forEach((c) => {
    if (!LIST_NODE_TYPES.has(c.type.name)) return;
    if (c.type.name === parentList.type.name) c.forEach((gc) => promoted.push(gc));
    else if (parentList.type.contentMatch.matchType(c.type)) promoted.push(c);
    else compatible = false;
  });
  if (!compatible) return;
  if (promoted.length === 0) tr.delete(shellPos, shellPos + shell.nodeSize);
  else tr.replaceWith(shellPos, shellPos + shell.nodeSize, Fragment.from(promoted));
}
