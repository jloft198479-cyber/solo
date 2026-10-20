/**
 * Rust → 前端事件「定向 vs 广播」语义锁。
 *
 * **我防的是哪个已发生的事故**（新建锁准入 ①，见 docs/agent-playbook.md §C）：
 * - 2026-10-20 用户实测：A 文档点互链另开 B 窗口，**关掉 B，A 也跟着关**。
 *   真因不是关闭链，而是发送端：`events.rs` 两处用 `window.emit(...)` 发事件。
 *   Tauri 2 的 `Emitter::emit` 是**全局广播**（trait 默认实现 → `manager.emit` →
 *   遍历所有 webview 下发），`window.emit` 只是「借 window 句柄调全局方法」，
 *   名字像定向、行为是全广播。而前端是 `getCurrentWindow().listen()` 按窗口注册，
 *   于是 B 的 `window-close-requested` 被 A 也收到，A 当成自己的关窗请求跑了关闭链。
 * - 同一个 bug 也污染菜单事件（Ctrl+S / Ctrl+N 会打到所有窗口）。此前几乎只用单窗口，
 *   一窗一文档 + 互链另开一窗才把这条潜伏了三个版本的错配顶到台面上。
 * - 风险是**静默回归**：tsc / lint / 前端单测全绿，只有真机双窗口才看得见。
 *
 * **级别**：C · 接线锁（源码文本比对）。只钉「发送点有没有显式指定目标窗」，
 * 不证明原生投递行为 —— 「关 B 不再关 A」只能真机验。
 *
 * **反向校准**（准入 ②）：把 `emit_to_window` 里的 `emit_to` 换回 `emit`，
 * 第 1、2 条立即转红；还原后复绿。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function repoRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 12; i++) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('[event-dispatch] 找不到仓库根');
}

const ROOT = repoRoot(dirname(fileURLToPath(import.meta.url)));
const RUST_SRC = resolve(ROOT, 'src-tauri/src');

/** 递归收集 .rs（不引第三方遍历库，单测环境够用） */
function collectRustFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectRustFiles(full, out);
    else if (entry.endsWith('.rs')) out.push(full);
  }
  return out;
}

/**
 * 挑出「裸 emit」：定向变体是 `emit_to` / `emit_filter` / `emit_str*`，
 * 只有 `.emit(` 本身是全局广播。
 */
function bareEmitHits(source: string): string[] {
  return [...source.matchAll(/\.emit[a-z_]*\(/g)]
    .map((match) => match[0])
    .filter((call) => call === '.emit(');
}

function funcBody(source: string, fnName: string): string {
  const sig = new RegExp(`fn\\s+${fnName}\\s*[<(]`);
  const m = sig.exec(source);
  expect(m, `[event-dispatch] events.rs 里找不到 ${fnName} 定义`).not.toBeNull();
  const start = source.indexOf('{', m!.index);
  expect(start, `[event-dispatch] ${fnName} 缺少函数体`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`[event-dispatch] ${fnName} 大括号未闭合`);
}

describe('Rust → 前端事件必须显式定向', () => {
  const eventsRs = readFileSync(resolve(RUST_SRC, 'events.rs'), 'utf8');

  it('关窗请求走 emit_to，不走全局广播', () => {
    const body = funcBody(eventsRs, 'emit_window_close_requested');
    expect(body).toContain('emit_to_window(');
    expect(bareEmitHits(body), '关窗事件一旦全局广播，关一扇窗会连锁关掉所有窗').toEqual([]);
  });

  it('菜单事件走 emit_to，不走全局广播', () => {
    const body = funcBody(eventsRs, 'emit_menu_event');
    expect(body).toContain('emit_to_window(');
    expect(bareEmitHits(body), '菜单事件广播会让所有窗口同时执行同一条命令').toEqual([]);
  });

  it('全仓 Rust 源码无裸 .emit( 调用', () => {
    const offenders: string[] = [];
    for (const file of collectRustFiles(RUST_SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        // 注释里的示例代码不算调用点（文件头就用 `window.emit(...)` 讲这个坑）
        if (line.trim().startsWith('//')) return;
        if (line.includes('.emit(') && !line.includes('global-broadcast')) {
          offenders.push(`${file.replace(ROOT, '')}:${index + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      '裸 .emit( 是全局广播（Tauri 2 Emitter 默认实现）。需要广播请用 app.emit 并在行尾标注 ' +
        '`// global-broadcast` 说明理由；定向请用 emit_to。',
    ).toEqual([]);
  });

  it('emit_to_window 的目标就是窗自己（不是 AnyLabel 通配之外的其它写法）', () => {
    const body = funcBody(eventsRs, 'emit_to_window');
    expect(body).toContain('window.label()');
    expect(body).toContain('emit_to(');
  });

  it('判据本身有效：能认出裸 emit，且不误伤定向变体', () => {
    expect(bareEmitHits('window.emit("x", ())')).toEqual(['.emit(']);
    expect(bareEmitHits('window.emit_to("a", "x", ())')).toEqual([]);
    expect(bareEmitHits('app.emit_filter("x", (), |_| true)')).toEqual([]);
  });
});
