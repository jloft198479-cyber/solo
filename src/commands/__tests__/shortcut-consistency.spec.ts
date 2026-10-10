// @vitest-environment happy-dom
/**
 * 注册表默认键 ⇄ 编辑器内真实生效 一致性回归锁（台账 §二 #28）。
 *
 * 背景：编辑器作用域命令的快捷键由 ProseMirror keymap 实际处理（useAppDomEvents 对
 * 「editor 作用域 + 默认键」的组合让行），而注册表曾单方面宣称另一套键（Ctrl+1..6 等
 * Typora 心智键）——设置页展示的键按了没反应，实际生效的键从未宣传过。
 *
 * 修复原则（AGENTS「键位真理源 = registry.ts」）：编辑器扩展覆写 TipTap 默认键，
 * 让编辑器内真实生效的键 = 注册表声明的键。本锁用「真实派发 keydown、断言事件被
 * 消费（defaultPrevented）」钉死，比反射扩展字段更贴近用户体验（按了有没有反应）：
 *   ① 注册表承诺的每个 editor 键在编辑器内按键必须被消费（撒谎/漂移 → 红）；
 *   ② 注册表的 app 作用域键不得被编辑器内绑定抢走（如 file.saveAs 的 Mod-Shift-s）；
 *   ③ 被让位的 TipTap 旧默认键不得回潮（回潮即重新抢键 → 红）。
 */
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { Editor } from '@tiptap/vue-3';
import { COMMANDS } from '../registry';
import { createEditorExtensions } from '../../components/Editor/tiptap/editor-extensions';

const extensions = createEditorExtensions({
  slashMenuRef: ref(null),
  slashMenuItems: ref([]),
  slashMenuCommand: ref(() => {}),
  emojiMenuRef: ref(null),
  emojiMenuItems: ref([]),
  emojiMenuCommand: ref(() => {}),
  wikilinkMenuRef: ref(null),
  wikilinkMenuItems: ref([]),
  wikilinkMenuCommand: ref(() => {}),
  searchHighlightOptions: { getMatches: () => [], getActiveIndex: () => -1 },
});

function newEditor(content = '<p>abc</p>'): Editor {
  return new Editor({ extensions, content });
}

/**
 * 向编辑器真实派发一次注册表风格的 keydown，返回事件是否被编辑器消费。
 * Mod 在 Windows/Linux 下即 Ctrl。key 统一传注册表写法（小写）：
 * PM 匹配用的是「event 派生键名 + 修饰键重组」，修饰键才是语义载体，
 * 大小写不影响匹配结果；真实浏览器的大写 key 行为由 PM 自身保证。
 */
function pressShortcut(editor: Editor, shortcut: string): boolean {
  const parts = shortcut.split('-');
  const key = parts[parts.length - 1];
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: parts.includes('Mod'),
    shiftKey: parts.includes('Shift'),
    altKey: parts.includes('Alt'),
    bubbles: true,
    cancelable: true,
  });
  editor.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('注册表默认键 ⇄ 编辑器真实生效（§二 #28）', () => {
  // 个别命令需要特定初始内容才能「toggle 出变化」：
  // - 撤销/重做需要非空历史；
  // - Mod-0（setParagraph）在已是段落的文档上无变化 → 命令返回 false → 不消费，
  //   这与真实编辑器行为一致（在标题上按才有意义），故给标题内容。
  const CONTENT_FIXTURE: Record<string, string> = {
    'editor.paragraph': '<h1>标题</h1>',
  };

  it('注册表承诺的每个 editor 作用域默认键，在编辑器内按键都被真实消费', () => {
    const editorScope = COMMANDS.filter((c) => c.scope === 'editor' && c.defaultShortcut);
    expect(editorScope.length).toBeGreaterThan(10);

    const lies: string[] = [];
    for (const command of editorScope) {
      const shortcut = command.defaultShortcut!;
      const editor = newEditor(CONTENT_FIXTURE[command.id]);
      if (command.id === 'editor.undo' || command.id === 'editor.redo') {
        // 撤销/重做需要非空历史才能生效：先真实输入一笔
        editor.commands.insertContent('x');
      }
      if (!pressShortcut(editor, shortcut)) {
        lies.push(`${command.id} 承诺 ${shortcut}，但编辑器内按键无响应`);
      }
      editor.destroy();
    }
    expect(lies).toEqual([]);
  });

  it('注册表的 app 作用域默认键不被编辑器内绑定抢走（含 file.saveAs 的 Mod-Shift-s）', () => {
    const appKeys = COMMANDS.filter((c) => c.scope === 'app' && c.defaultShortcut).map(
      (c) => c.defaultShortcut!,
    );
    expect(appKeys.length).toBeGreaterThan(10);

    const stolen: string[] = [];
    for (const shortcut of new Set(appKeys)) {
      const editor = newEditor();
      if (pressShortcut(editor, shortcut)) {
        stolen.push(`${shortcut} 被编辑器内绑定消费（app 命令将被压制）`);
      }
      editor.destroy();
    }
    expect(stolen).toEqual([]);
  });

  it('被让位的 TipTap 旧默认键不回潮（回潮即抢键回归）', () => {
    // 不含 Mod-Shift-b：TipTap v3 为 bold 注册了大写变体 Mod-B，PM 键名解析会让
    // Ctrl+Shift+B 命中该变体（改动前亦然，属 PM 固有机制而非 blockquote 旧键回潮；
    // blockquote 的 Mod-Shift-b 绑定已随覆写消失）。Mod-Shift-q 覆写后无此冲突。
    const retired = [
      'Mod-Alt-0',
      'Mod-Alt-1',
      'Mod-Alt-6',
      'Mod-Alt-c',
      'Mod-e',
      'Mod-Shift-s',
    ];
    const editor = newEditor();
    const resurfaced = retired.filter((key) => pressShortcut(editor, key));
    editor.destroy();
    expect(resurfaced).toEqual([]);
  });

  it('抽样行为：Mod-1 定级标题、Mod-Shift-x 切删除线且 Mod-Shift-s 不再切删除线', () => {
    const heading = newEditor('<p>正文</p>');
    pressShortcut(heading, 'Mod-1');
    expect(heading.state.doc.firstChild?.type.name).toBe('heading');
    expect(heading.state.doc.firstChild?.attrs.level).toBe(1);
    heading.destroy();

    const strike = newEditor();
    strike.commands.selectAll();
    pressShortcut(strike, 'Mod-Shift-x');
    const marks: string[] = [];
    strike.state.doc.descendants((node) => {
      if (node.isText) marks.push(...node.marks.map((m) => m.type.name));
      return true;
    });
    expect(marks).toContain('strike');

    // 编辑器内已无 Mod-Shift-s 绑定：再按不会切回无删除线（该键归 file.saveAs）
    pressShortcut(strike, 'Mod-Shift-s');
    const after: string[] = [];
    strike.state.doc.descendants((node) => {
      if (node.isText) after.push(...node.marks.map((m) => m.type.name));
      return true;
    });
    expect(after).toEqual(['strike']);
    strike.destroy();
  });
});
