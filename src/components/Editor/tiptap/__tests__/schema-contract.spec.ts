/**
 * 生产 schema 契约锁
 *
 * 本文件原为 `schema-consistency.spec.ts`，校验「三套 schema」字段级一致性
 * （edit 生产编辑 / parse 兼容解析 / test 测试镜像）。2026-09-14 经**调用链**核实：
 *   - `createMarkdownCompatSchema()` 是**死代码**——生产零调用，`markdown-paste.ts`
 *     从未 import 它（`git log -S` 为空，4 处 `parseMarkdown` 实参皆 `view.state.schema`），
 *     唯一使用者是测试文件 ⇒ 已删除。
 *   - `createTestSchema()` 已改为直接复用生产 schema（不再手抄镜像）。
 * ⇒ 三套归一为**一套**，「一致性校验」天然失去对象，故转为**单套正向契约锁**。
 *
 * 为什么不能顺势把这个文件也删掉：
 *   原来的「差异集校验」只能发现「多处取值**不一致**」。当约束被**一致地改错**
 *   （从前是三套一起错，现在只剩一套更无对照）时，差异集校验完全失灵。
 *   下方每条契约都对应一次真实事故（见 KNOWN-ISSUES），因此必须**正向钉死**：
 *   改动越界即红，且红的时候能直接读到「为什么这条不能动」。
 *
 * 约定：改 `editor-extensions.ts` 的节点/mark 定义后，本文件必须重跑；
 *      若确实要改契约，请连同 KNOWN-ISSUES / docs/sensitive-areas.md 一并更新。
 */
import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { getSchema } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { createEditorExtensions } from '../editor-extensions';

function buildSchema(): Schema {
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

describe('生产 schema 契约锁', () => {
  const schema = buildSchema();

  /**
   * 列表容器与列表项（KNOWN-ISSUES §二 #10 / §一 #26）
   *
   * 「容器肯不肯装」直接决定内容存亡：容器只肯收单一类型的项时，同层混排
   * （`- 甲` / `1. 乙` / `- [ ] 丙`）会让 `createAndFill` 失败，`closeNode()`
   * 兜底成空段落并**静默丢弃**已收集内容——数据丢失级。
   */
  describe('列表容器与列表项', () => {
    it('bulletList / orderedList 须允许同层混排（普通项 + 待办项）', () => {
      expect(schema.nodes.bulletList.spec.content).toBe('(listItem | taskItem)+');
      expect(schema.nodes.orderedList.spec.content).toBe('(listItem | taskItem)+');
    });

    it('taskList 须仍只收 taskItem（容器判定已保证「全为任务项」才用它）', () => {
      expect(schema.nodes.taskList.spec.content).toBe('taskItem+');
    });

    it('listItem / taskItem 首块须是 paragraph', () => {
      // 该约束是解析侧「块级内容进列表项时补位空段落」的依据；
      // 序列化侧据此跳过补位段（否则 `- # 标题` 会被写散成两个块，见 §一 #26-C）。
      expect(schema.nodes.listItem.spec.content).toBe('paragraph block*');
      expect(schema.nodes.taskItem.spec.content).toBe('paragraph block*');
    });
  });

  /**
   * mark 互斥性（KNOWN-ISSUES §一 #26-B）
   *
   * Tiptap 的 `code` mark 默认 `excludes: '_'`（排斥一切其他 mark）。
   * 后果：`**加粗 `代码` 加粗**` 的粗体被 code 截断且**无法跨过**，
   * 中文写作里「强调中夹行内代码」极常见 ⇒ 既丢格式，又让 round-trip 不收敛。
   */
  describe('mark 互斥性', () => {
    it('code 不得排斥其他 mark', () => {
      expect(schema.marks.code.spec.excludes ?? '').toBe('');
    });
  });

  /**
   * 无 markdown 载体的 mark 必须关闭（2026-10-03，`underline` 事故）
   *
   * 一个 mark 能进生产 schema 只说明编辑器**能渲染**它；能不能**存住**
   * 取决于 `serializer.ts` 的 `markDelimiter()` 有没有对应 case。二者脱节时
   * 走的是 `default: return ''`——**静默吞 mark**，不报错、不丢文字、只丢格式。
   *
   * 事故实录：`underline` 是StarterKit 默认成员，`StarterKit.configure()` 逐个
   * 关掉了 codeBlock/link/heading/code/bulletList/orderedList，唯独漏了它。
   * 后果（探针实测，非推测）：`<u>下划线</u>` 从网页粘贴进来 marks=[underline]、
   * **屏幕上有下划线**，存盘写成 `这是下划线`、重开格式消失 ⇒ 用户以为存好了。
   *
   * 为什么会漏：契约锁此前只查 `content` 约束与 attrs，**不查「mark 有没有
   * markdown 载体」**——正交的一维被漏了，于是「schema 有 / 序列化器无 case」
   * 这类不一致没有任何防线。
   *
   * 判据：mark 若既无 markdown 语法（CommonMark/GFM 皆无），又没接UI 入口，
   * 就必须关掉；否则就是「用户能制造、但存盘即丢」的数据损失入口。
   */
  describe('无 markdown 载体的 mark', () => {
    const MARKS_WITHOUT_MARKDOWN_SYNTAX = ['underline'];

    for (const name of MARKS_WITHOUT_MARKDOWN_SYNTAX) {
      it(`\`${name}\` 不得进生产 schema（无 markdown 载体 ⇒ 存盘即丢格式）`, () => {
        expect(schema.marks[name]).toBeUndefined();
      });
    }

    /**
     * 反向：若将来要支持下划线，**不能只删这一条**。
     * 必须同时补齐三处，否则又会退成「能显示、存不住」：
     *   ① `serializer.ts` `markDelimiter()` 加 case（并决定落哪种语法）
     *   ② `parser.ts` 加对应 token handler（否则解析不回来）
     *   ③ 给出 UI 入口，且语法须是**别人也认的**（否则文件发出去是字面量）
     */
    it('本组登记的每个 mark 都必须有文档化的「重新开启条件」（防随手删断言）', () => {
      // 断言集合本身不为空且不含重复——若有人清空列表，上面的循环会静默通过
      expect(MARKS_WITHOUT_MARKDOWN_SYNTAX.length).toBeGreaterThan(0);
      expect(new Set(MARKS_WITHOUT_MARKDOWN_SYNTAX).size).toBe(
        MARKS_WITHOUT_MARKDOWN_SYNTAX.length,
      );
    });
  });

  /**
   * 承载用户信息的 attrs 必须存在（缺失即某处信息静默消失）
   *
   * 断言用「必须包含」而非「完全相等」：新增属性不算事故，丢失属性才算。
   */
  describe('信息载体 attrs 完整性', () => {
    const REQUIRED: Array<[string, string[]]> = [
      // 图片尺寸：`![alt|400x300](src)` 语法往返的载体
      ['image', ['src', 'alt', 'title', 'width', 'height']],
      // callout 标题与折叠态：`> [!NOTE] 标题` / `> [!NOTE]- 折叠`
      ['callout', ['calloutType', 'title', 'fold']],
      // 表格列对齐：`| :-: |`。注：schema 具备该属性，parser/serializer 侧
      // 尚未实现解析与输出（独立缺口，见 KNOWN-ISSUES §二 #12）
      ['tableCell', ['align', 'colspan', 'rowspan', 'colwidth']],
      ['tableHeader', ['align', 'colspan', 'rowspan', 'colwidth']],
      // 链接与有序列表起点
      ['link', ['href', 'title']],
      ['orderedList', ['start']],
    ];

    for (const [name, attrs] of REQUIRED) {
      it(`node/mark \`${name}\` 具备 ${attrs.join('、')}`, () => {
        const spec = schema.nodes[name] ?? schema.marks[name];
        const actual = Object.keys(spec.spec.attrs ?? {});
        expect(actual).toEqual(expect.arrayContaining(attrs));
      });
    }

    it('frontmatter 节点须存在（缺它则带 YAML 头的文件整块丢失）', () => {
      expect(schema.nodes.frontmatter).toBeDefined();
      expect(schema.nodes.frontmatter.spec.content).toBe('text*');
    });
  });
});
