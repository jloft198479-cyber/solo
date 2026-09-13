// @vitest-environment happy-dom
/**
 * composition-freeze 总闸的契约回归锁。
 *
 * 该模块是「合成期只平移、不重建 DOM」的唯一真相源——原先 4 个插件各写一份
 * `let liveView` + `view.composing` 判断（markdown-input / paragraph-focus /
 * search-highlight / code-block），新增第 5 处就可能漏。本文件锁住**模块自身**的
 * 契约；各插件「组字期装饰只 map」的行为由各自 spec 的场景锁覆盖
 * （paragraph-focus.spec.ts / code-block.spec.ts 的「组字冻结回归锁」节）。
 */
import { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { describe, expect, it } from 'vitest';

import { createMarkdownCompatSchema } from '../markdown/compat-schema';
import { createCompositionTracker, isFrozen, mapFrozenDecorations } from '../composition-freeze';

const schema = createMarkdownCompatSchema();

const DOC = schema.nodes.doc.create(null, [
  schema.nodes.paragraph.create(null, [schema.text('甲乙丙')]),
]);

/** 只需 composing 一个字段的假 view——本模块不碰其它成员 */
function fakeView(composing: boolean): EditorView {
  return { composing } as unknown as EditorView;
}

/** 覆盖整段文本 [1,4) 的行内装饰，便于观察平移 */
function baseSet(): DecorationSet {
  return DecorationSet.create(DOC, [Decoration.inline(1, 4, { class: 'x' })]);
}

describe('isFrozen', () => {
  it('view 缺失 / 已销毁 → 未冻结（退化安全：宁可少冻结，也不挡合成文字）', () => {
    expect(isFrozen(null)).toBe(false);
    expect(isFrozen(undefined)).toBe(false);
  });

  it('只认 view.composing 这一浏览器权威信号', () => {
    expect(isFrozen(fakeView(true))).toBe(true);
    expect(isFrozen(fakeView(false))).toBe(false);
  });
});

describe('mapFrozenDecorations', () => {
  it('doc 未变化 → 原样返回同一实例，不做任何重建', () => {
    const set = baseSet();
    const tr = EditorState.create({ schema, doc: DOC }).tr.setMeta('noop', 1);
    expect(tr.docChanged).toBe(false);
    expect(mapFrozenDecorations(set, tr)).toBe(set);
  });

  it('doc 变化 → 装饰坐标随事务平移（不 remove + add）', () => {
    const set = baseSet();
    // 在「甲」「乙」之间插入一字：装饰两端按映射平移，而不是被重建
    const tr = EditorState.create({ schema, doc: DOC }).tr.insertText('前', 2);
    const mapped = mapFrozenDecorations(set, tr);
    expect(mapped).not.toBe(set);
    expect([mapped.find()[0].from, mapped.find()[0].to]).toEqual([1, 5]);
  });

  it('显式传入目标 doc 时按该 doc 映射（search-highlight 传 newState.doc 的用法）', () => {
    const set = baseSet();
    const tr = EditorState.create({ schema, doc: DOC }).tr.insertText('前', 2);
    expect(mapFrozenDecorations(set, tr, tr.doc).find()[0].to).toBe(5);
  });
});

describe('createCompositionTracker', () => {
  it('track 之前未冻结（插件未挂载 / 已销毁的兜底）', () => {
    expect(createCompositionTracker().isFrozen()).toBe(false);
  });

  it('track 后跟随该实例的 composing 变化', () => {
    const tracker = createCompositionTracker();
    tracker.track(fakeView(true));
    expect(tracker.isFrozen()).toBe(true);
  });

  it('untrack 后回到未冻结', () => {
    const tracker = createCompositionTracker();
    const untrack = tracker.track(fakeView(true));
    untrack();
    expect(tracker.isFrozen()).toBe(false);
  });

  it('旧实例 untrack 不会误清新实例（多编辑器不串台）', () => {
    const tracker = createCompositionTracker();
    const untrackOld = tracker.track(fakeView(false));
    tracker.track(fakeView(true)); // 新实例接管
    untrackOld(); // 旧实例销毁
    expect(tracker.isFrozen()).toBe(true);
  });
});
