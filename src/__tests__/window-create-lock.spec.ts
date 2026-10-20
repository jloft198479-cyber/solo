/**
 * 另开一窗 ⇄ 主窗口 browser args 一致性锁。
 *
 * **我防的是哪个已发生的事故**（新建锁准入 ①，见 docs/agent-playbook.md §C）：
 * - 2026-10-20 用户装 1.2.62 实测「点互链毫无反应，单击双击都打不开」。
 *   真机排查结论：`create_editor_window` 建窗时用 Tauri 默认的 additionalBrowserArgs，
 *   而主窗口配置（tauri.conf.json）里带 `TSFImeSupport` —— WebView2 要求**同一
 *   user data folder 内环境参数一致**，不一致时 `CreateCoreWebView2EnvironmentWithOptions`
 *   失败，但 `build()` **仍返回 Ok**，拿到的是没有 HWND 的空壳。
 *   表现：Rust 日志 `created window` 正常、命令返回 label、`spawn_startup_show_fallback`
 *   十秒后报「未收到 startup_ready」；用户侧只有一个结果 —— **点了没反应**。
 *   受影响不止互链：Ctrl+N「新建窗口」、多选 .md 启动的「其余各开一窗」同样失效。
 * - 这里的风险是**静默回归**：谁把这段 args 传递删掉、或改成另写一套字面量，
 *   tsc / lint / 全量单测**全绿**（原生建窗失败压根不在 JS 单测覆盖范围内）。
 *
 * **级别**：C · 接线锁（源码文本比对）。只钉「有没有按主窗口配置传」，
 * **不证明原生行为正确** —— 「真机上确实弹出了一扇能用的新窗」只能真机验。
 *
 * **反向校准**（准入 ②）：2026-10-20 实跑 —— 把 `builder = builder.additional_browser_args(args)`
 * 换成 `let _ = args;`，第 2 条转红；还原后复绿。
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
  throw new Error('[window-create] 找不到仓库根');
}

const ROOT = repoRoot(dirname(fileURLToPath(import.meta.url)));
const LIB_RS = resolve(ROOT, 'src-tauri/src/lib.rs');

/** 按大括号配平取出 Rust 函数体（够用即可，不引入完整 Rust parser） */
function bodyOf(src: string, fnName: string): string {
  const sig = new RegExp(`fn\\s+${fnName}\\s*\\(`);
  const m = sig.exec(src);
  expect(m, `[window-create] lib.rs 里找不到 ${fnName} 定义`).not.toBeNull();
  let i = src.indexOf('{', m!.index);
  expect(i, `[window-create] ${fnName} 缺少函数体`).toBeGreaterThan(-1);
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`[window-create] ${fnName} 大括号未闭合`);
}

describe('另开一窗 ⇄ 主窗口 browser args 一致性', () => {
  const lib = readFileSync(LIB_RS, 'utf8');
  const body = bodyOf(lib, 'create_editor_window');

  it('create_editor_window 仍按 WebviewWindowBuilder 建窗（函数没被替换）', () => {
    expect(body).toContain('WebviewWindowBuilder::new');
  });

  it('必须把 additional_browser_args 传给 builder（漏了就是空壳窗口）', () => {
    expect(
      body,
      '新窗口没传 additional_browser_args —— WebView2 环境参数与主窗口不一致，build() 会返回空壳，界面表现为「点了没反应」',
    ).toContain('builder = builder.additional_browser_args(');
  });

  it('取值必须来自主窗口配置，不许另写一套字面量', () => {
    expect(body).toContain('config()');
    expect(body).toContain('additional_browser_args');
    // 反向：一旦有人图省事写死一份 args，就会与 tauri.conf.json 漂移
    expect(body, '别硬编码 browser args —— 会与 tauri.conf.json 漂移').not.toMatch(
      /additional_browser_args\(\s*"/,
    );
  });

  it('new_editor_window 必须保持 async（改回同步会死锁：主线程自己等自己）', () => {
    expect(
      lib,
      '同步命令在主线程建窗 —— WebView2 初始化靠同一个消息循环推进，会卡死（窗口壳出现但永远不 ready）',
    ).toMatch(/async\s+fn\s+new_editor_window\s*\(/);
  });
});
