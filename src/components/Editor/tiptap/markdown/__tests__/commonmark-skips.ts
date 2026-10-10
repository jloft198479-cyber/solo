/**
 * CommonMark spec 的**跳过表**（已知限制 / 设计约束）。
 *
 * 为什么单独放一个非 `.spec.ts` 模块：`commonmark.spec.ts` 与 `safety-net.spec.ts`
 * 都要用它；若从 `.spec.ts` 里导出，导入方的 `describe/it` 会被**连带注册**，
 * 同一批用例会跑两遍（实测 safety-net 文件里凭空多出 618 个用例）。
 *
 * ⭐ 2026-10-10（批次 4 · G6）做过一次**陈旧性清理**：
 * 逐条实跑「若取消跳过，`commonmark.spec.ts` 的判据会不会过」，结果 **34 条里 22 条早已通过**
 * （14/43/47/273/274/278/292/293/296/299/309/316/318/319/320/321/324/516/530/554/558/559）
 * ⇒ 已移除、恢复成真用例。**跳过表不会自己收缩**，长期只增不减就会变成「永久免检区」——
 * 这正是本文件过去「绿着却漏掉混排列表丢内容」的同源病根。
 *
 * 保留的 12 条分三类（每条括号里标明真实病灶）：
 *   · 不收敛 —— 存两次还在变
 *   · 输出为空 —— 整行内容被丢弃（真丢失）
 *   · 模型限制 —— ProseMirror 平铺 marks 不记嵌套深度
 *
 * ⚠️ 「静默丢格式」的 5 条（207/418/432/484/487）另在 `safety-net.spec.ts` 的
 * `KNOWN_SPEC_GAPS` 有**双向锁**（修好即转红），并在 `docs/KNOWN-ISSUES.md` §二 有台账。
 * 改本表时请同步那两处——「一处定义、处处一致」。
 */
export const SKIP: Record<number, string> = {
  // Entity and numeric character references
  40: 'entity: &#9;→tab→缩进代码围栏化（不收敛）',

  // Thematic breaks
  61: 'hr: 列表项内分隔线归一化（不收敛）',

  // Setext headings
  81: 'heading: setext→ATX，跨行 emphasis 丢失（不收敛）',
  82: 'heading: setext→ATX，跨行 emphasis 丢失（不收敛）',
  95: 'heading: setext→ATX，双行段落结构变化（不收敛）',

  // Link reference definitions
  207: 'link ref: 引用定义整行被丢弃（输出为空）',

  // List items — marker normalization
  301: 'list: +→- 标记归一化（不收敛）',
  302: 'list: )→. + 空行差异（不收敛）',

  // Emphasis and strong emphasis（ProseMirror 平铺 mark 模型限制）
  418: 'emphasis: 嵌套 * 同类型 marks 无法区分深度（strong 丢失 + 不收敛）',
  432: 'emphasis: 同类型 marks 嵌套无法序列化（strong 丢失 + 不收敛）',

  // Links
  484: 'link: 空 label 链接 `[](url)` 整行被丢弃（输出为空）',
  487: 'link: 空 label 链接 `[]()` 整行被丢弃（输出为空）',
};
