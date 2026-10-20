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
  WIKILINK_SCAN_DEPTH,
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

/** 读 Rust 侧 document.rs 源码：让「前端常量 / 闸门是否还在」有唯一可核的事实源。 */
function readRustDocumentSource(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(resolve(dir, 'package.json'))) {
      return readFileSync(resolve(dir, 'src-tauri/src/commands/document.rs'), 'utf8');
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('找不到仓库根');
}

function makeEditor(files: readonly string[], content?: string, truncated = false) {
  return new Editor({
    extensions: [
      StarterKit,
      Wikilink,
      WikilinkExistence.configure({
        getSiblingFiles: () => ({ files: [...files], truncated }),
      }),
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
  it('索引只登相对路径（含 / 去 .md 两种形态），不登末段裸名', () => {
    const index = buildWikilinkNameIndex(['B.md', 'sub/C.md']);
    expect(index.has('b.md')).toBe(true);
    expect(index.has('b')).toBe(true);
    expect(index.has('sub/c.md')).toBe(true);
    expect(index.has('sub/c')).toBe(true);
    // 末段裸名不登：`[[C]]` 会被解析成同目录的 C.md，那里并没有这个文件
    // （登了就会出现「界面不标红、点下去却弹创建」的自相矛盾）
    expect(index.has('c')).toBe(false);
  });

  it('非 .md 不进索引（清单只列 .md，登了就会与解析器口径打架）', () => {
    expect(buildWikilinkNameIndex(['README.MARKDOWN', 'note.txt']).size).toBe(0);
  });

  it('存在 / 不存在 / 大小写不敏感', () => {
    const index = buildWikilinkNameIndex(['B.md']);
    expect(isWikilinkTargetMissing('B', index)).toBe(false);
    expect(isWikilinkTargetMissing('b', index)).toBe(false);
    expect(isWikilinkTargetMissing('B.md', index)).toBe(false);
    expect(isWikilinkTargetMissing('C', index)).toBe(true);
  });

  it('跨目录目标按相对路径判定（能判就判，不再一律放过）', () => {
    const index = buildWikilinkNameIndex(['B.md', 'sub/C.md']);
    expect(isWikilinkTargetMissing('sub/C', index)).toBe(false);
    expect(isWikilinkTargetMissing('sub/C.md', index)).toBe(false);
    // 分隔符归一：手打的反斜杠写法必须命中小写 / 索引
    expect(isWikilinkTargetMissing('sub\\C', index)).toBe(false);
    // 深度内的真死链要标出来（否则跨目录就是「好坏都不显示」）
    expect(isWikilinkTargetMissing('sub/D', index)).toBe(true);
    expect(isWikilinkTargetMissing('other/C', index)).toBe(true);
  });

  it('判不了的一律不标（宁可漏标也不误标）', () => {
    const index = buildWikilinkNameIndex(['B.md']);
    // 清单还没拿到：空索引 → 不标
    expect(isWikilinkTargetMissing('C', buildWikilinkNameIndex([]))).toBe(false);
    // 空目标 → 不标
    expect(isWikilinkTargetMissing('   ', index)).toBe(false);
    // 绝对路径不在「相对清单」坐标系里 → 判不了
    expect(isWikilinkTargetMissing('D:/notes/C', index)).toBe(false);
    expect(isWikilinkTargetMissing('/home/u/C', index)).toBe(false);
    // 出界（父目录及以上）：扫描只往下走 → 判不了
    expect(isWikilinkTargetMissing('../C', index)).toBe(false);
    expect(isWikilinkTargetMissing('sub/../C', index)).toBe(false);
    // 超出扫描深度（3 层 > WIKILINK_SCAN_DEPTH）→ 清单里不会出现，判不了
    expect(isWikilinkTargetMissing('a/b/c/D', index)).toBe(false);
    // 深度内的同型目标仍按正常口径判
    expect(isWikilinkTargetMissing('a/b', index)).toBe(true);
  });

  it('目标是 .markdown / .txt 等清单不收的扩展名 → 不标（实测曾误标）', () => {
    const index = buildWikilinkNameIndex(['B.md']);
    expect(isWikilinkTargetMissing('B.markdown', index)).toBe(false);
    expect(isWikilinkTargetMissing('note.txt', index)).toBe(false);
    // .md 仍按正常口径判定
    expect(isWikilinkTargetMissing('C.md', index)).toBe(true);
  });

  it('标题锚点不参与文件名判定（[[B#小节]] 判的是 B）', () => {
    const index = buildWikilinkNameIndex(['B.md', 'sub/C.md']);
    expect(isWikilinkTargetMissing('B#小节', index)).toBe(false);
    expect(isWikilinkTargetMissing('B#一级#二级', index)).toBe(false);
    expect(isWikilinkTargetMissing('sub/C#小节', index)).toBe(false);
    // 文件不在时仍要标红 —— 别因为带锚点就一律放过
    expect(isWikilinkTargetMissing('C#小节', index)).toBe(true);
    // 锚点里的分隔符/扩展名不能影响判定
    expect(isWikilinkTargetMissing('B#a/b.md', index)).toBe(false);
  });

  it('纯锚点 [[#小节]] 指向本文档 → 不标', () => {
    expect(isWikilinkTargetMissing('#小节', buildWikilinkNameIndex(['B.md']))).toBe(false);
  });

  it('扫描范围与 Rust 侧一致（不同步就会误标）', () => {
    const rust = readRustDocumentSource();

    const depth = /WIKILINK_SCAN_DEPTH:\s*usize\s*=\s*(\d+)/.exec(rust);
    expect(depth, 'Rust 侧找不到 WIKILINK_SCAN_DEPTH 定义').not.toBeNull();
    expect(
      Number(depth![1]),
      'Rust 的递归深度改了而前端没跟 —— 扫描范围外的目标会被误标成不存在',
    ).toBe(WIKILINK_SCAN_DEPTH);

    // 收集上限本身不再由前端复刻：Rust 用 `truncated` 显式告知「清单不完整」，
    // 前端据此整体放弃判定。这里只锁住「闸门常量仍在」——它一旦被删，truncated
    // 就永远为 false，超量目录里的文件会被误判成不存在。
    expect(/WIKILINK_SCAN_LIMIT:\s*usize\s*=\s*(\d+)/.exec(rust)).not.toBeNull();
    expect(/WIKILINK_SCAN_MAX_DIRS:\s*usize\s*=\s*(\d+)/.exec(rust)).not.toBeNull();
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

  it('清单不完整（truncated）时一律不标 —— 宁可漏标也不误标', () => {
    // 目录闸门可能在文件数远不到上限时就触发，靠「长度 == 上限」猜不出来，
    // 必须由 Rust 显式给出 truncated（否则排在后面的文件会被误判成不存在）
    editor = makeEditor(['B.md'], undefined, true);
    expect(brokenDecorations(editor)).toHaveLength(0);
  });

  it('清单为空（还没读到目录）时一个都不标', () => {
    editor = makeEditor([]);
    expect(brokenDecorations(editor)).toHaveLength(0);
  });

  it('只信 truncated，不靠「长度 == 上限」猜（长度猜测会误伤满清单的正常目录）', () => {
    // 长度远超 Rust 上限但 truncated=false ⇒ 清单是完整的，照常判定：
    // 不在清单里的「不存在」仍要标红。旧实现靠「长度 >= 500 就放弃」猜，
    // 文件数刚好触顶、目录预算没触的正常目录会被整片放过（标记凭空消失）。
    const full = ['B.md', ...Array.from({ length: 5000 }, (_, i) => `f${i}.md`)];
    editor = makeEditor(full);
    // 清单里有的 B 不标，只有「不存在」标红 —— 长度不该改变判定口径
    expect(brokenDecorations(editor)).toHaveLength(1);
  });

  it('悬停提示不把带扩展名的目标拼成 B.md.md', () => {
    editor = new Editor({
      extensions: [
        StarterKit,
        Wikilink,
        WikilinkExistence.configure({
          getSiblingFiles: () => ({ files: ['B.md'], truncated: false }),
        }),
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
        WikilinkExistence.configure({
          getSiblingFiles: () => ({ files: [...files], truncated: false }),
        }),
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
