/**
 * 三套 Schema 一致性校验
 *
 * solo 同时维护三套 schema，各服务不同通道：
 *   edit   生产编辑  `createEditorExtensions()`      → 打开文件（`parseMarkdown` 的 schema）
 *   parse  生产解析  `createMarkdownCompatSchema()`  → 粘贴 / 剪贴板
 *   test   测试镜像  `createTestSchema()`            → 全部 markdown 单测
 *
 * 三者本就不该完全一致（`parse` 刻意宽松以兼容外部文本；`test` 是最小镜像），
 * 但每处差异都必须是**有理由且被记录的**——否则就是漂移，而漂移会静默影响某一通道。
 * （实测后果见 KNOWN-ISSUES §二 #11：粘贴丢 frontmatter / 图片尺寸 / callout 标题。）
 *
 * 本测试锁定「差异集合 + 每处差异的三方取值」：
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
    test: 'colspan,colwidth,rowspan',
    status: 'bug',
    note: '#11：粘贴通道无 attrs → 单元格对齐丢失；test 亦缺 align',
  },
  'node.tableHeader.attrs': {
    edit: 'align,colspan,colwidth,rowspan',
    parse: '∅',
    test: 'colspan,colwidth,rowspan',
    status: 'bug',
    note: '#11（同上，表头）',
  },
  'mark.underline.attrs': {
    edit: '∅',
    parse: '-',
    test: '-',
    status: 'bug',
    note: '#11：粘贴通道无 underline 标记 → 下划线丢失（test 镜像同样缺）',
  },

  // ── 测试镜像漂移（createTestSchema 与生产不同步，会给出与实际不符的结论）────
  'node.codeBlock.attrs': {
    edit: 'language,languageLabel',
    parse: 'language,languageLabel',
    test: 'language',
    status: 'mirror',
    note: '镜像缺 languageLabel → 相关回归在测试里测不出',
  },
  'node.listItem.content': {
    edit: 'paragraph block*',
    parse: 'paragraph block*',
    test: 'block+',
    status: 'mirror',
    note: '镜像比生产宽松（生产限定首块必须是 paragraph）',
  },
  'node.taskItem.content': {
    edit: 'paragraph block*',
    parse: 'paragraph block*',
    test: 'block+',
    status: 'mirror',
    note: '同 listItem：镜像比生产宽松',
  },
  'node.tableCell.content': {
    edit: 'block+',
    parse: 'block+',
    test: 'paragraph+',
    status: 'mirror',
    note: '镜像比生产**严格** → 可能在测试里制造生产中不存在的失败',
  },
  'node.tableHeader.content': {
    edit: 'block+',
    parse: 'block+',
    test: 'paragraph+',
    status: 'mirror',
    note: '同 tableCell（表头）',
  },

  // ── 设计意图（各通道职责不同，无需动作）────────────────────────────────
  'mark.link.attrs': {
    edit: 'class,href,rel,target,title',
    parse: 'href,target,title',
    test: 'href,target,title',
    status: 'intended',
    note: '编辑侧为外链补安全属性（rel/target/class），解析侧不需要',
  },
  'node.orderedList.attrs': {
    edit: 'start,type',
    parse: 'start',
    test: 'start',
    status: 'intended',
    note: '编辑侧多保留有序列表样式类型（1/a/i）',
  },
  'node.tableRow.content': {
    edit: '(tableCell | tableHeader)*',
    parse: '(tableHeader | tableCell)+',
    test: '(tableHeader | tableCell)+',
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
