/**
 * Markdown 语法支持度向量表 —— **语法事实的唯一来源**。
 *
 * 两条用途：
 *   1. 测试：每条向量逐条跑 `parse → serialize`，与 `expected` 比对（`syntax-vectors.spec.ts`）
 *   2. 文档：同一份数据生成 `docs/FEATURE-MATRIX.md` §4.5 的支持度表（**勿手改那节**）
 *
 * 规矩（不遵守就退化成「假锁」）：
 *   - `input` 必须**带病灶形状**，不能只写"正常路径"的漂亮例子。看起来太顺的向量多半测不到东西。
 *   - `expected` 是**判断过**的往返结果，不是"跑一遍拿到的输出直接粘过来"。差异只有两类：
 *     ① 编辑器**必然改写**的写法（`_x_`→`*x*`、`+`→`-`、setext→ATX …）——写进 `note`，这也正是
 *        W3 承诺清单的素材；② 真 bug —— **不许写进 expected**，要单独记台账。
 *   - 一条向量一个断言，失败时能指名道姓，不要写成大数组整体比对。
 *
 * 第一批范围：§3 格式与语法 + §4 扩展语法的主路径（按 docs/PROPOSAL-file-fidelity.md §6-3 的推荐）。
 * 扩表时只加数据，不动测试与生成器。
 */

export interface SyntaxVector {
  /** 表格分组 */
  group: '行内' | '块级' | '扩展';
  /** 语法名（表格第一列，也是测试名） */
  name: string;
  /** 输入 Markdown */
  input: string;
  /** 判断过的往返结果 */
  expected: string;
  /** 已知改写 / 边界的说明；空 = 原样往返 */
  note?: string;
}

export const SYNTAX_VECTORS: readonly SyntaxVector[] = [
  // ── 行内 ──────────────────────────────────────────────
  {
    group: '行内',
    name: '粗体',
    input: '**加粗**\n',
    expected: '**加粗**\n',
  },
  {
    group: '行内',
    name: '斜体（星号）',
    input: '*斜体*\n',
    expected: '*斜体*\n',
  },
  {
    group: '行内',
    name: '斜体（下划线）',
    input: '_斜体_\n',
    expected: '*斜体*\n',
    note: '下划线写法统一为星号',
  },
  {
    group: '行内',
    name: '删除线',
    input: '~~删除线~~\n',
    expected: '~~删除线~~\n',
  },
  {
    group: '行内',
    name: '高亮',
    input: '==高亮==\n',
    expected: '==高亮==\n',
  },
  {
    group: '行内',
    name: '行内代码',
    input: '`代码`\n',
    expected: '`代码`\n',
  },
  {
    group: '行内',
    name: '行内代码套在粗体里（定界符定序病灶）',
    input: '**粗 `代码` 粗**\n',
    expected: '**粗 `代码` 粗**\n',
    note: 'KNOWN-ISSUES 一/26 的病灶形状',
  },
  {
    group: '行内',
    name: '下标',
    input: 'H~2~O\n',
    expected: 'H~2~O\n',
  },
  {
    group: '行内',
    name: '上标',
    input: 'x^2^\n',
    expected: 'x^2^\n',
  },
  {
    group: '行内',
    name: '链接',
    input: '[文本](https://example.com)\n',
    expected: '[文本](https://example.com)\n',
  },
  {
    group: '行内',
    name: '尖括号自动链接',
    input: '<https://auto.link>\n',
    expected: '[https://auto.link](https://auto.link)\n',
    note: '转为标准链接写法',
  },
  {
    group: '行内',
    name: '引用式链接',
    input: '[文本][ref]\n\n[ref]: https://example.com\n',
    expected: '[文本](https://example.com)\n',
    note: '转为行内式，定义行不再保留',
  },
  {
    group: '行内',
    name: '反斜杠转义',
    input: '\\*不是斜体\\*\n',
    expected: '\\*不是斜体\\*\n',
  },
  {
    group: '行内',
    name: '硬换行（行尾两空格）',
    input: '第一行  \n第二行\n',
    expected: '第一行  \n第二行\n',
  },
  {
    group: '行内',
    name: '图片',
    input: '![图](a.png)\n',
    expected: '![图](a.png)\n',
  },
  {
    group: '行内',
    name: '图片尺寸（solo 私有语法）',
    input: '![图|300x200](a.png)\n',
    expected: '![图|300x200](a.png)\n',
    note: '非标准 Markdown，别家编辑器会当文字显示',
  },
  {
    group: '扩展',
    name: 'WikiLink',
    input: '[[笔记]]\n',
    expected: '[[笔记]]\n',
  },
  {
    group: '扩展',
    name: 'WikiLink 带别名',
    input: '[[笔记|别名]]\n',
    expected: '[[笔记|别名]]\n',
  },
  {
    group: '扩展',
    name: '脚注',
    input: '正文[^1]\n\n[^1]: 脚注内容\n',
    expected: '正文[^1]\n\n[^1]: 脚注内容\n',
  },

  // ── 块级 ──────────────────────────────────────────────
  {
    group: '块级',
    name: '一级标题',
    input: '# 标题\n',
    expected: '# 标题\n',
  },
  {
    group: '块级',
    name: '六级标题',
    input: '###### 六级\n',
    expected: '###### 六级\n',
  },
  {
    group: '块级',
    name: '下划线式标题',
    input: '标题\n===\n',
    expected: '# 标题\n',
    note: 'setext 写法统一为 # 形式',
  },
  {
    group: '块级',
    name: '无序列表',
    input: '- 甲\n- 乙\n',
    expected: '- 甲\n- 乙\n',
  },
  {
    group: '块级',
    name: '无序列表（加号符号）',
    input: '+ 甲\n+ 乙\n',
    expected: '- 甲\n- 乙\n',
    note: '列表符号统一为 -',
  },
  {
    group: '块级',
    name: '有序列表',
    input: '1. 甲\n2. 乙\n',
    expected: '1. 甲\n2. 乙\n',
  },
  {
    group: '块级',
    name: '任务列表',
    input: '- [ ] 待办\n- [x] 已办\n',
    expected: '- [ ] 待办\n- [x] 已办\n',
  },
  {
    group: '块级',
    name: '普通项与任务项同层混排（整段消失病灶）',
    input: '- 甲\n- [ ] 乙\n',
    expected: '- 甲\n- [ ] 乙\n',
    note: 'KNOWN-ISSUES 一/10 的病灶形状：曾整段丢',
  },
  {
    group: '块级',
    name: '嵌套列表',
    input: '- 甲\n  - 乙\n',
    expected: '- 甲\n  - 乙\n',
  },
  {
    group: '块级',
    name: '引用块',
    input: '> 引用\n',
    expected: '> 引用\n',
  },
  {
    group: '块级',
    name: '代码块（带语言）',
    input: '```ts\nconst a = 1;\n```\n',
    expected: '```ts\nconst a = 1;\n```\n',
  },
  {
    group: '块级',
    name: '表格',
    input: '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
    expected: '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n',
    note: '按列宽重新对齐（补空格）',
  },
  {
    group: '块级',
    name: '水平分隔线',
    input: '---\n',
    expected: '---\n',
  },

  // ── 扩展（块级） ──────────────────────────────────────
  {
    group: '扩展',
    name: 'Callout',
    input: '> [!NOTE]\n> 内容\n',
    expected: '> [!NOTE]\n> 内容\n',
  },
  {
    group: '扩展',
    name: '块级公式',
    input: '$$\nE=mc^2\n$$\n',
    expected: '$$\nE=mc^2\n$$\n',
  },
  {
    group: '扩展',
    name: '行内公式',
    input: '$x^2$\n',
    expected: '$x^2$\n',
  },
  {
    group: '扩展',
    name: 'Mermaid 图表',
    input: '```mermaid\ngraph TD\nA-->B\n```\n',
    expected: '```mermaid\ngraph TD\nA-->B\n```\n',
  },
  {
    group: '扩展',
    name: 'Frontmatter',
    input: '---\ntitle: x\n---\n正文\n',
    expected: '---\ntitle: x\n---\n\n正文\n',
    note: '结束符后补一个空行',
  },
];

/** 已知改写清单（W3 承诺清单的素材）：原样往返之外的每一条。 */
export const REWRITE_NOTES = SYNTAX_VECTORS.filter(
  (v) => v.note && v.expected !== v.input,
);
