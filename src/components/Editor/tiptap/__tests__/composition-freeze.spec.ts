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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { describe, expect, it } from 'vitest';

import { createTestSchema } from '../markdown/__tests__/test-utils';
import { createCompositionTracker, isFrozen, mapFrozenDecorations } from '../composition-freeze';

const schema = createTestSchema();

const DOC = schema.nodes.doc.create(null, [
  schema.nodes.paragraph.create(null, [schema.text('甲乙丙')]),
]);

/** 只需 composing 一个字段的假 view——本模块不碰其它成员。
 *
 *  ⚠️ 2026-10-03：`dom` 字段**保留**，虽然当前 `track()` 已不再挂事件监听。
 *  原因：ProseMirror 的 `view.dom` 在测试环境里会被间接访问，留着更接近真实
 *  实例，也免得下次再补一遍。本条的3 例历史失败已随 IME 补丁整体移除而消失
 *  （见 KNOWN-ISSUES §一 #32），但这条约束本身值得留在注释里。 */
function fakeView(composing: boolean): EditorView {
  return { composing, dom: document.createElement('div') } as unknown as EditorView;
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

/**
 * 组字态判定的**单一来源集合锁**（2026-10-11，台账 §二 #58）。
 *
 * 为什么用「扫全仓」而不是「维护一张登记表」：枚举式防线在「新增一处漏网」时**静默通过**
 * ——登记表没有新成员、测试照样绿（台账 §一 #31 的 underline 事故正是这个坑）。这里反过来：
 * **凡源码里直接读 `<某>view.composing` 的副本一律违规**，白名单只有中枢
 * `composition-freeze.ts` 自己（它是真相源，必须能读原始信号）。
 *
 * 判据取 `view\.composing` 而非 `.composing`：`pluginState.composing` /
 * `value.composing` 是插件 state 的**字段**（不是 view 读），合法，不能误伤。
 *
 * ⚠️ 反向校准：把任一处的 `isFrozen(view)` 改回 `view.composing` ⇒ 本条转红。
 */
describe('组字态判定单一来源（集合锁）', () => {
  function findRepoRoot(from: string): string {
    let dir = from;
    for (let i = 0; i < 12; i++) {
      if (existsSync(join(dir, 'package.json'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error('[composition-freeze] 找不到仓库根');
  }

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p, out);
      else if (/\.(ts|vue)$/.test(entry.name)) out.push(p);
    }
    return out;
  }

  it('除中枢自身外，源码里不得出现 `view.composing` 直读', () => {
    const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
    const offenders: string[] = [];
    for (const file of walk(join(root, 'src'))) {
      const rel = relative(root, file).split(/[\\/]/).join('/');
      if (rel.endsWith('composition-freeze.ts')) continue; // 唯一真相源，必须能读原始信号
      if (rel.includes('__tests__') || rel.endsWith('.spec.ts')) continue; // 测试里允许构造
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const trimmed = line.trimStart();
          if (trimmed.startsWith('*') || trimmed.startsWith('//')) return; // 注释不算
          const code = line.replace(/\/\/.*$/, ''); // 行尾注释去掉再判
          if (/view\.composing/i.test(code)) offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
        });
    }
    expect(
      offenders,
      `组字态判定必须统一走 composition-freeze 的 isFrozen()，不得再直读 view.composing：\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
