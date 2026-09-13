/**
 * Schema 一致性校验
 *
 * solo 历史上并行维护三套 schema；2026-09-14 按调用链核实后，实际只有两套独立存在：
 *   edit   生产编辑  `createEditorExtensions()`      → 打开文件 **和粘贴**（实参是 `view.state.schema`）
 *   parse  兼容解析  `createMarkdownCompatSchema()`  → ⚠️ **死代码**，生产零调用（见 #11）
 *   test   测试镜像  `createTestSchema()`            → 已改为复用 edit（换真身），恒等于 edit
 *
 * ⚠️ 更正（2026-09-14）：原「粘贴通道走 compat schema」的定性系照文件头注释所写，
 * **已被调用链推翻** —— `markdown-paste.ts` 从未 import 它（`git log -S` 为空，
 * 4 处 `parseMarkdown(schema, …)` 实参皆为 `view.state.schema`）。故本表 `parse` 列的差异
 * **不落在任何真实用户路径上**，其价值仅剩「记录死代码的存在」。
 * 待 #11 清理 compat schema 后，本文件应改写为 `edit` 的**正向契约锁**（如列表容器混排）。
 *
 * 本测试锁定「差异集合 + 每处差异的取值」：
 *   - 出现未登记的差异 → 红（新漂移）
 *   - 登记项消失或取值变化 → 红（提示清理台账）
 *
 * 取值记号：`-` = 该 schema 无此节点/标记；`∅` = 存在但无该字段。
 */
import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { getSchema } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { createEditorExtensions } from '../editor-extensions';
import { createMarkdownCompatSchema } from '../markdown/compat-schema';
import { createTestSchema } from '../markdown/__tests__/test-utils';

/** 差异处置状态：intended = 设计意图｜mirror = 测试镜像漂移（应随生产同步）｜bug = 生产缺陷 */
type Divergence = {
  edit: string;
  parse: string;
  test: string;
  status: 'intended' | 'mirror' | 'bug';
  note: string;
};

/**
 * 差异登记表（真理源）。
 * 修改任何一套 schema 后本表必查——新增/消失/取值变化都会让测试转红。
 */
const DIVERGENCES: Record<string, Divergence> = {
  // ── 生产缺陷（已登记 KNOWN-ISSUES §二 #10 / #11，修好后删除对应行）────────
  // 注：原 `node.bulletList.content` 已修（三套现均为 `(listItem | taskItem)+`），
  // 本表不再登记 —— 但它若**被改回去**，三套仍可能"一致地错"，差异集校验抓不到，
  // 故另由末尾的「列表容器契约」用例正向锁住。
  'node.frontmatter.content': {
    edit: 'text*',
    parse: '-',
    test: 'text*',
    status: 'bug',
    note: '#11：粘贴通道无 frontmatter 节点 → 带 frontmatter 的文本整块消失',
  },
  'node.frontmatter.attrs': { edit: '∅', parse: '-', test: '∅', status: 'bug', note: '#11（同上）' },
  'node.image.attrs': {
    edit: 'alt,height,src,title,width',
    parse: 'alt,src,title',
    test: 'alt,height,src,title,width',
    status: 'bug',
    note: '#11：粘贴通道缺 width/height → 图片尺寸丢失',
  },
  'node.callout.attrs': {
    edit: 'calloutType,fold,title',
    parse: 'calloutType',
    test: 'calloutType,fold,title',
    status: 'bug',
    note: '#11：粘贴通道缺 title/fold → callout 标题与折叠态丢失',
  },
  'node.tableCell.attrs': {
    edit: 'align,colspan,colwidth,rowspan',
    parse: '∅',
    test: 'align,colspan,colwidth,rowspan',
    status: 'bug',
    note: '#11：粘贴通道无 attrs → 单元格对齐丢失',
  },
  'node.tableHeader.attrs': {
    edit: 'align,colspan,colwidth,rowspan',
    parse: '∅',
    test: 'align,colspan,colwidth,rowspan',
    status: 'bug',
    note: '#11（同上，表头）',
  },
  'mark.underline.attrs': {
    edit: '∅',
    parse: '-',
    test: '∅',
    status: 'bug',
    note: '#11：粘贴通道无 underline 标记 → 下划线丢失',
  },

  // ── 测试镜像漂移：2026-09-14 换真身后**已全部消除** ────────────────────
  // `createTestSchema()` 改为直接复用生产编辑 schema，故 `test` 列恒等于 `edit` 列，
  // 原 5 项 mirror 差异（codeBlock.attrs / listItem.content / taskItem.content /
  // tableCell.content / tableHeader.content）随之消失。
  // 本表待「兼容 schema 死代码清理」（KNOWN-ISSUES §二 #11）后整体收敛为单列契约锁。

  // ── 设计意图（各通道职责不同，无需动作）────────────────────────────────
  'mark.link.attrs': {
    edit: 'class,href,rel,target,title',
    parse: 'href,target,title',
    test: 'class,href,rel,target,title',
    status: 'intended',
    note: '编辑侧为外链补安全属性（rel/target/class），解析侧不需要',
  },
  'node.orderedList.attrs': {
    edit: 'start,type',
    parse: 'start',
    test: 'start,type',
    status: 'intended',
    note: '编辑侧多保留有序列表样式类型（1/a/i）',
  },
  'node.tableRow.content': {
    edit: '(tableCell | tableHeader)*',
    parse: '(tableHeader | tableCell)+',
    test: '(tableCell | tableHeader)*',
    status: 'intended',
    note: '编辑侧更宽松（允许空行）；差异来源待确认，暂不动作',
  },
};

/** 字段级指纹：`∅` = 存在但无该字段，`-` = 节点/标记本身不存在 */
function fieldMap(schema: Schema): Record<string, string> {
  const m: Record<string, string> = {};
  schema.spec.nodes.forEach((name, spec) => {
    const s = spec as { content?: string; attrs?: Record<string, unknown> };
    m[`node.${name}.content`] = s.content ?? '∅';
    const attrs = Object.keys(s.attrs ?? {}).sort();
    m[`node.${name}.attrs`] = attrs.length ? attrs.join(',') : '∅';
  });
  schema.spec.marks.forEach((name, spec) => {
    const s = spec as { attrs?: Record<string, unknown> };
    const attrs = Object.keys(s.attrs ?? {}).sort();
    m[`mark.${name}.attrs`] = attrs.length ? attrs.join(',') : '∅';
  });
  return m;
}

function buildEditSchema(): Schema {
  return getSchema(
    createEditorExtensions({
      slashMenuRef: ref(null),
      slashMenuItems: ref([]),
      slashMenuCommand: ref(() => {}),
      emojiMenuRef: ref(null),
      emojiMenuItems: ref([]),
      emojiMenuCommand: ref(() => {}),
      wikilinkMenuRef: ref(null),
      wikilinkMenuItems: ref([]),
      wikilinkMenuCommand: ref(() => {}),
      searchHighlightOptions: {} as never,
    }),
  );
}

describe('三套 schema 一致性', () => {
  const edit = fieldMap(buildEditSchema());
  const parse = fieldMap(createMarkdownCompatSchema());
  const test = fieldMap(createTestSchema());
  const valueOf = (key: string) => ({
    edit: edit[key] ?? '-',
    parse: parse[key] ?? '-',
    test: test[key] ?? '-',
  });

  it('差异集合与登记表逐项吻合（新增漂移 → 红；登记项消失 → 红）', () => {
    const allKeys = [...new Set([...Object.keys(edit), ...Object.keys(parse), ...Object.keys(test)])];
    const actual = allKeys
      .filter((k) => new Set(Object.values(valueOf(k))).size > 1)
      .sort();
    const registered = Object.keys(DIVERGENCES).sort();

    expect(
      actual,
      'schema 差异集与登记表不符：多出的键是**新漂移**，缺少的键说明**登记已过期**（请同步 DIVERGENCES）',
    ).toEqual(registered);
  });

  it('每处登记差异的三方取值仍然吻合', () => {
    for (const [key, d] of Object.entries(DIVERGENCES)) {
      expect(valueOf(key), `${key}（${d.note}）`).toEqual({
        edit: d.edit,
        parse: d.parse,
        test: d.test,
      });
    }
  });

  /**
   * 正向契约锁（#10）。
   *
   * 差异集校验只能发现「三方不一致」——三套 schema **一起**被改回错误约束时它看不见。
   * 列表容器「允许同层混排」正是 #10 的修复点，这里把契约钉死，防止回退：
   *   - bulletList / orderedList 必须能同时容纳 listItem 与 taskItem
   *   - taskList 保持只收 taskItem（容器判定已保证只有全任务项才用它）
   */
  it('列表容器允许同层混排（#10 契约，防回退）', () => {
    const schemaNames: Array<[string, Schema]> = [
      ['edit', buildEditSchema()],
      ['parse', createMarkdownCompatSchema()],
      ['test', createTestSchema()],
    ];
    for (const [name, schema] of schemaNames) {
      expect(schema.nodes.bulletList.spec.content, `${name}: bulletList`).toBe(
        '(listItem | taskItem)+',
      );
      expect(schema.nodes.orderedList.spec.content, `${name}: orderedList`).toBe(
        '(listItem | taskItem)+',
      );
      expect(schema.nodes.taskList.spec.content, `${name}: taskList`).toBe('taskItem+');
    }
  });
});
