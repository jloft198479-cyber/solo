/**
 * mark 载体全覆盖防线（2026-10-03，`underline` 事故）
 *
 * 要挡的事故形态：**新增 mark 忘了在 `markDelimiter()` 加 case**。
 * 无 case ⇒ 落`default: return ''` ⇒ 文本在、格式静默消失，用户看不出已丢。
 * `underline` 就是这么丢的：StarterKit 默认带进来的 mark，`StarterKit.configure()`
 * 逐个关掉了六个、唯独漏了它，序列化器也没有它的 case。
 *
 * 为什么不能只靠 schema-contract 逐个枚举：
 *   那边是「登记已知的坏 mark」（`['underline']`），新增 mark 落空时它**静默通过**。
 *   本文件是**全量集合比对**——生产 schema 的 marks 与序列化器有 case 的 marks
 *   必须完全相等，任一侧多出即红⇒ 新增 mark 漏接载体立刻被抓住，无需先登记。
 *
 * 判据分层：
 *   - schema 有 / case 无 ⇒ 落`default` 静默吞格式 ⇒ **数据损失级**，红
 *   - case 有 / schema 无 ⇒ 多余分支，删schema 时会变僵尸代码 ⇒ 提醒，黄绿之间
 *     （不断言为红：`link` 的 case 是通用 markdown 语义，加回来时不必改serializer）
 *
 * 双向锁：两侧相等才绿。删mark 只动一侧、只加 mark 只动一侧，都会红。
 *
 * 参照系说明：本文件直接读`serializer.ts` 源码文本抽 case 名。
 * 不用「造 doc 试往返」的行为判定，因为那只测已知几个 mark，新增的漏网仍是假绿
 *（`coverage.probe.ts` 的教训：它正是靠集合比对才一次性抓全的）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ref } from 'vue';
import { getSchema } from '@tiptap/core';
import { createEditorExtensions } from '../../editor-extensions';

/** 从 serializer.ts 的 markDelimiter() 抽 case 分支名 */
function serializerMarkCases(): string[] {
  const src = readFileSync(
    'src/components/Editor/tiptap/markdown/serializer.ts',
    'utf8',
  );
  const start = src.indexOf('private markDelimiter');
  expect(start, 'serializer.ts 里找不到 markDelimiter()').toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('\n  }', start));
  return [...body.matchAll(/case '([a-zA-Z]+)':/g)].map((m) => m[1]);
}

function buildSchema() {
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

describe('mark 的 markdown 载体全覆盖', () => {
  const schemaMarks = Object.keys(buildSchema().marks).sort();
  const cases = [...new Set(serializerMarkCases())].sort();

  it('生产 schema 的每个 mark 都必须有 markdown 定界符载体', () => {
    const missing = schemaMarks.filter((m) => !cases.includes(m));
    expect(
      missing,
      missing.length
        ? `这些 mark 在生产 schema 里，但 serializer.markDelimiter() 无 case` +
          ` ⇒ 存盘时被default 分支静默吞掉（文本在、格式消失）。` +
          ` 两种修法：① 给 markDelimiter 加 case；` +
          ` ② 若它本就没有 markdown 载体，则从 editor-extensions.ts 关掉` +
          `（如 underline，Markdown 无此语法）。`
        : undefined,
    ).toEqual([]);
  });

  it('case 表里不得有 schema 已不存在的 mark（防僵尸分支）', () => {
    // link 属通用 markdown 语义，将来若重新引入 link mark 不必删 case ⇒ 不在此列
    const ALLOWED_WITHOUT_SCHEMA = ['link'];
    const orphan = cases.filter(
      (c) => !schemaMarks.includes(c) && !ALLOWED_WITHOUT_SCHEMA.includes(c),
    );
    expect(
      orphan,
      orphan.length
        ? `serializer 里有 case 但生产 schema 无此 mark：${orphan.join(', ')}` +
          ` ⇒ 删mark 时忘了删 case，变成僵尸代码。`
        : undefined,
    ).toEqual([]);
  });

  it('本防线本身有效：case 抽取非空且 schema 至少含一个 mark', () => {
    // 防「正则抽不出来→ 空数组 → 上面两条全绿」的假防线
    expect(cases.length).toBeGreaterThan(0);
    expect(schemaMarks.length).toBeGreaterThan(0);
    expect(schemaMarks).toContain('bold');
  });
});
