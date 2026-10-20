// @vitest-environment happy-dom
import { Editor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Wikilink } from '../wikilink';
import {
  buildWikilinkNameIndex,
  isWikilinkTargetMissing,
  WikilinkExistence,
  wikilinkExistenceKey,
  WIKILINK_CANDIDATE_LIMIT,
} from '../wikilink-existence';

/**
 * 失效互链标记契约锁。
 *
 * 防的事故（2026-10-20 用户实测）：文档在**资源管理器里改名**后，别的文档里指向它的
 * `[[旧名]]` 变成死链 —— 点了没反应，界面上也看不出任何异常，用户只能自己撞上才发现。
 * solo 没有文件监视器，改不了别人的文件，能做的是「让你看得见」：打开文档时比对
 * 同目录文件清单，找不到的互链标红。
 *
 * 两道判据：
 * ① 纯函数口径（什么算失效、什么不敢判就不标）
 * ② 插件行为（打开即标、refresh 重算、打字只平移不重扫全文档）
 */

function makeEditor(files: readonly string[], content?: string) {
  return new Editor({
    extensions: [
      StarterKit,
      Wikilink,
      WikilinkExistence.configure({ getSiblingFiles: () => files }),
    ],
    content:
      content ??
      '<p>见 <span data-wikilink="B" target="B">B</span> 与 <span data-wikilink="不存在" target="不存在">不存在</span></p>',
  });
}

function brokenDecorations(editor: Editor) {
  const set = wikilinkExistenceKey.getState(editor.state);
  if (!set) return [];
  return set.find().filter((d) => (d as unknown as { type?: { attrs?: { class?: string } } }).type?.attrs?.class === 'mk-wikilink--broken');
}

describe('失效互链：名字索引与判定口径', () => {
  it('索引同时收录带扩展名与去扩展名两种写法，一律小写', () => {
    const index = buildWikilinkNameIndex(['B.md', 'README.MARKDOWN', 'note.txt']);
    expect(index.has('b.md')).toBe(true);
    expect(index.has('b')).toBe(true);
    expect(index.has('readme.markdown')).toBe(true);
    expect(index.has('readme')).toBe(true);
    expect(index.has('note')).toBe(true);
  });

  it('存在 / 不存在 / 大小写不敏感', () => {
    const index = buildWikilinkNameIndex(['B.md']);
    expect(isWikilinkTargetMissing('B', index)).toBe(false);
    expect(isWikilinkTargetMissing('b', index)).toBe(false);
    expect(isWikilinkTargetMissing('B.md', index)).toBe(false);
    expect(isWikilinkTargetMissing('C', index)).toBe(true);
  });

  it('判不了的一律不标（宁可漏标也不误标）', () => {
    // 清单还没拿到：空索引 → 不标
    expect(isWikilinkTargetMissing('C', buildWikilinkNameIndex([]))).toBe(false);
    // 带路径的目标不在同目录清单里 → 不标
    expect(isWikilinkTargetMissing('sub/C', buildWikilinkNameIndex(['B.md']))).toBe(false);
    expect(isWikilinkTargetMissing('sub\\C', buildWikilinkNameIndex(['B.md']))).toBe(false);
    // 空目标 → 不标
    expect(isWikilinkTargetMissing('   ', buildWikilinkNameIndex(['B.md']))).toBe(false);
  });

  it('目标是 .markdown / .txt 等清单不收的扩展名 → 不标（实测曾误标）', () => {
    const index = buildWikilinkNameIndex(['B.md']);
    expect(isWikilinkTargetMissing('B.markdown', index)).toBe(false);
    expect(isWikilinkTargetMissing('B.markdown', buildWikilinkNameIndex(['B.markdown']))).toBe(
      false,
    );
    expect(isWikilinkTargetMissing('note.txt', index)).toBe(false);
    // .md 仍按正常口径判定
    expect(isWikilinkTargetMissing('C.md', index)).toBe(true);
  });

  it('截断上限与 Rust 侧 SAME_DIR_DOC_LIMIT 一致（两边不同步就会误标）', () => {
    let dir = dirname(fileURLToPath(import.meta.url));
    let root = '';
    for (let i = 0; i < 12; i++) {
      if (existsSync(resolve(dir, 'package.json'))) {
        root = dir;
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    expect(root, '找不到仓库根').not.toBe('');
    const rust = readFileSync(resolve(root, 'src-tauri/src/commands/document.rs'), 'utf8');
    const m = /SAME_DIR_DOC_LIMIT:\s*usize\s*=\s*(\d+)/.exec(rust);
    expect(m, 'Rust 侧找不到 SAME_DIR_DOC_LIMIT 定义').not.toBeNull();
    expect(
      Number(m![1]),
      'Rust 的目录上限改了而前端 WIKILINK_CANDIDATE_LIMIT 没跟 —— 超过上限的文件会被误标成不存在',
    ).toBe(WIKILINK_CANDIDATE_LIMIT);
  });
});

describe('失效互链：插件行为', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('打开即标：只标指向不存在文件的那一个', () => {
    editor = makeEditor(['B.md']);
    const decos = brokenDecorations(editor);
    expect(decos).toHaveLength(1);

    const pos = decos[0].from;
    const node = editor.state.doc.nodeAt(pos);
    expect(node?.type.name).toBe('wikilink');
    expect(node?.attrs.target).toBe('不存在');
  });

  it('清单为空（还没读到目录）时一个都不标', () => {
    editor = makeEditor([]);
    expect(brokenDecorations(editor)).toHaveLength(0);
  });

  it('清单达到上限（Rust 可能截断）时一个都不标', () => {
    const huge = Array.from({ length: WIKILINK_CANDIDATE_LIMIT }, (_, i) => `f${i}.md`);
    editor = makeEditor(huge);
    expect(brokenDecorations(editor)).toHaveLength(0);
  });

  it('悬停提示不把带扩展名的目标拼成 B.md.md', () => {
    editor = new Editor({
      extensions: [
        StarterKit,
        Wikilink,
        WikilinkExistence.configure({ getSiblingFiles: () => ['B.md'] }),
      ],
      content:
        '<p><span data-wikilink="C" target="C">C</span><span data-wikilink="D.md" target="D.md">D</span></p>',
    });
    const titles = brokenDecorations(editor).map(
      (d) => (d as unknown as { type: { attrs: { title?: string } } }).type.attrs.title ?? '',
    );
    expect(titles).toHaveLength(2);
    expect(titles.some((t) => t.includes('C.md'))).toBe(true);
    expect(titles.some((t) => t.includes('D.md') && !t.includes('D.md.md'))).toBe(true);
  });

  it('打字只平移 decoration，不重扫全文档（性能硬约束）', () => {
    editor = makeEditor(['B.md']);
    const before = brokenDecorations(editor);
    expect(before).toHaveLength(1);
    const posBefore = before[0].from;

    // 在段落开头插入两个字 → 后面的互链位置整体后移 2
    editor
      .chain()
      .insertContentAt(1, '前缀')
      .run();

    const after = brokenDecorations(editor);
    expect(after).toHaveLength(1);
    expect(after[0].from).toBe(posBefore + 2);
  });

  it('refresh 后按新清单重算（用户手动改好文件名再刷新）', () => {
    let files: readonly string[] = ['B.md'];
    editor = new Editor({
      extensions: [
        StarterKit,
        Wikilink,
        WikilinkExistence.configure({ getSiblingFiles: () => files }),
      ],
      content:
        '<p>见 <span data-wikilink="B" target="B">B</span> 与 <span data-wikilink="不存在" target="不存在">不存在</span></p>',
    });
    expect(brokenDecorations(editor)).toHaveLength(1);

    files = ['B.md', '不存在.md'];
    editor.view.dispatch(editor.state.tr.setMeta(wikilinkExistenceKey, 'refresh'));
    expect(brokenDecorations(editor)).toHaveLength(0);
  });

  it('整篇替换后标记要重建，不能凭空消失（实测：搜索框输入就踩过）', () => {
    editor = makeEditor(['B.md']);
    expect(brokenDecorations(editor)).toHaveLength(1);

    // setContent 走 replaceWith(0, size, doc) 整篇替换：inline 装饰会被映射成
    // 零长度并被 DecorationSet.map 丢弃 —— apply 必须识别这种事务并重建
    editor.commands.setContent(
      '<p><span data-wikilink="另一个缺失" target="另一个缺失">X</span></p>',
    );
    const decos = brokenDecorations(editor);
    expect(decos, '整篇替换后标记全丢了 —— 用户会看到红波浪线无缘无故消失').toHaveLength(1);
    expect(editor.state.doc.nodeAt(decos[0].from)?.attrs.target).toBe('另一个缺失');
  });

  it('全选删除（同样是整篇替换）后不应残留标记', () => {
    editor = makeEditor(['B.md']);
    expect(brokenDecorations(editor)).toHaveLength(1);
    editor.commands.setContent('<p>干净内容</p>');
    expect(brokenDecorations(editor)).toHaveLength(0);
  });

  it('整篇替换：原先没有标记、替换后有的也要标出来（这条只有整篇替换分支能救）', () => {
    editor = makeEditor(['B.md'], '<p>干净内容</p>');
    expect(brokenDecorations(editor)).toHaveLength(0);
    editor.commands.setContent(
      '<p><span data-wikilink="不存在" target="不存在">X</span></p>',
    );
    expect(brokenDecorations(editor)).toHaveLength(1);
  });

  it('非整篇的局部替换把装饰吞掉时也要重建（搜索框输入实测会触发）', () => {
    editor = makeEditor(['B.md']);
    const before = brokenDecorations(editor);
    expect(before).toHaveLength(1);
    const size = editor.state.doc.content.size;
    // 等长替换「内部范围」（不是 0..size，所以不属于整篇替换）：装饰会被映射丢弃，
    // 但文档里的互链还在 —— 必须重建，否则标记凭空消失且再也回不来
    const slice = editor.state.doc.slice(1, size - 1);
    editor.view.dispatch(editor.state.tr.replaceWith(1, size - 1, slice.content));
    expect(brokenDecorations(editor), '局部替换后标记丢了').toHaveLength(1);
  });
});
