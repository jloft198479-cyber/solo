/**
 * 互链跳转 ⇄ 「另开一窗」接线锁。
 *
 * **我防的是哪个已发生的事故**（新建锁准入 ①，见 docs/agent-playbook.md §C）：
 * - 2026-10-20 排查发现：在文档 A 里点互链打开 B，A 会**被顶掉**（同一窗口内替换）。
 *   根因是 App.vue 把 `@navigate-wikilink` 接到了 `handleOpenFile` —— 与产品语义
 *   「一窗一文档 / 无标签页」（docs/FEATURE-MATRIX.md）自相矛盾。
 *   修法：另立 `handleWikilinkNavigate` 走 `newEditorWindow(path)`（Rust 侧 `new_editor_window`
 *   接受 `Option<String>` 路径并存 `PendingWindowPaths`，能力本就就绪，只是没接线）。
 * - 这里的风险是**静默回归**：谁把绑定改回 `handleOpenFile`，行为倒退回「顶掉当前文档」，
 *   而 tsc / lint / 其它测试**全绿**（原生建窗行为压根不在 JS 单测覆盖范围内，只能真机验）。
 *   ⇒ 所以用静态锁把「接线指向」钉住，别让产品决策被无声改掉。
 *
 * **级别**：C · 接线锁（源码文本比对）。只钉「指向」，**不证明原生行为正确** ——
 * 「点互链真的开出了一扇新窗、B 真的加载进去了、焦点对不对」仍需真机验收。
 *
 * **反向校准**（准入 ②）：2026-10-20 实跑 —— 把绑定改回 `handleOpenFile` → 第 2 条转红；
 * 把 `handleWikilinkNavigate` 函数体改成 `openDocumentWithPrompt` → 第 3 条转红。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function repoRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 12; i++) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('[wikilink-navigate] 找不到仓库根');
}

const ROOT = repoRoot(dirname(fileURLToPath(import.meta.url)));
const APP_VUE = resolve(ROOT, 'src/App.vue');
const EDITOR_VUE = resolve(ROOT, 'src/components/Editor/MarkdownEditor.vue');

function read(p: string): string {
  expect(existsSync(p), `[wikilink-navigate] 缺少文件：${p}`).toBe(true);
  return readFileSync(p, 'utf8');
}

/** 从函数签名起按大括号配平取出函数体（够用即可，不引入完整 JS parser） */
function bodyOf(src: string, fnName: string): string {
  const sig = new RegExp(`(?:async\\s+)?function\\s+${fnName}\\s*\\(`);
  const m = sig.exec(src);
  expect(m, `[wikilink-navigate] App.vue 里找不到 ${fnName} 定义`).not.toBeNull();
  let i = src.indexOf('{', m!.index);
  expect(i, `[wikilink-navigate] ${fnName} 缺少函数体`).toBeGreaterThan(-1);
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`[wikilink-navigate] ${fnName} 大括号未闭合`);
}

describe('互链跳转 ⇄ 另开一窗 接线锁', () => {
  const app = read(APP_VUE);
  const editor = read(EDITOR_VUE);

  it('emit 源头仍在：MarkdownEditor 依旧 emit navigate-wikilink', () => {
    expect(editor).toContain("emit('navigate-wikilink'");
  });

  it('App.vue 把 @navigate-wikilink 绑到 handleWikilinkNavigate（不得回落 handleOpenFile）', () => {
    expect(app, '互链绑定不再是 handleWikilinkNavigate —— 产品决策被改了？').toMatch(
      /@navigate-wikilink="handleWikilinkNavigate"/,
    );
    // 反向：一旦绑回 handleOpenFile，「点互链顶掉当前文档」的旧行为静默复活
    expect(app).not.toMatch(/@navigate-wikilink="handleOpenFile"/);
  });

  it('handleWikilinkNavigate 走 newEditorWindow，不走当前窗口替换', () => {
    const body = bodyOf(app, 'handleWikilinkNavigate');
    expect(body).toContain('newEditorWindow(');
    expect(body).not.toContain('openDocumentWithPrompt');
  });
});
