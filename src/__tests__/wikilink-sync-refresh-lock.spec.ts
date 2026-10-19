/**
 * 改名同步互链 ⇄ 「受影响窗口立即刷新」接线锁。
 *
 * **我防的是哪个已发生的事故**（新建锁准入 ①，见 docs/agent-playbook.md §C）：
 * - 2026-10-20 排查：在 A 里互链到 B，改名 B 后打开 A，A 里的链接名还是旧的。
 *   事实是同步功能**已经跑通**（Rust `sync_wikilinks_on_rename` 确实把盘上的
 *   `[[旧名]]` 改写成了 `[[新名]]`），断的是「**改了盘 ≠ 开着的窗口跟着变**」：
 *   被改的那篇开在**另一个窗口**里，内存态还留着旧名字，得等用户重新点到它、
 *   再手动点「重新加载」才会刷新。
 *   修法：改写落盘后由前端广播 `solo:wikilinks-synced`（JS `emit` 的目标是 `Any`，
 *   全局送达，见 tauri `event/listener.rs` 的 `match_any_or_filter`），收到广播的窗口
 *   按路径自认领——干净就静默重载、脏就改走既有「外部修改」提示。
 * - 这里的风险是**静默回归**：谁重构 `syncInboundWikilinks` 时把广播那行删掉，
 *   行为倒退回「用户一直看到旧名字」，而 tsc / lint / 其它测试**全绿**
 *   （跨窗口事件投递压根不在 JS 单测覆盖范围内，只能真机验）。
 *   ⇒ 用静态锁钉住「接线还在」，别让这条链路被无声拆掉。
 *
 * **级别**：C · 接线锁（源码文本比对）。只钉「接线上没被拆」，
 * **不证明**广播真能跨窗口送达、窗口真会重载——那两条仍需真机验收。
 *
 * **反向校准**（准入 ②）：2026-10-20 实跑 —— 删掉 `emitWikilinksSynced(...)` 那行 → 第 2 条转红；
 * 把 `handleWikilinksSynced` 的重载那行改成 `documentSession` 之外的写法 / 删监听注册 → 第 3、4 条转红。
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
  throw new Error('[wikilink-sync] 找不到仓库根');
}

const ROOT = repoRoot(dirname(fileURLToPath(import.meta.url)));
const EVENTS_TS = resolve(ROOT, 'src/services/tauri/events.ts');
const SESSION_TS = resolve(ROOT, 'src/composables/useDocumentSession.ts');

function read(p: string): string {
  expect(existsSync(p), `[wikilink-sync] 缺少文件：${p}`).toBe(true);
  return readFileSync(p, 'utf8');
}

/** 从函数签名起按大括号配平取出函数体（够用即可，不引入完整 JS parser） */
function bodyOf(src: string, fnName: string): string {
  const sig = new RegExp(`(?:async\\s+)?function\\s+${fnName}\\s*\\(`);
  const m = sig.exec(src);
  expect(m, `[wikilink-sync] 找不到 ${fnName} 定义`).not.toBeNull();
  let i = src.indexOf('{', m!.index);
  expect(i, `[wikilink-sync] ${fnName} 缺少函数体`).toBeGreaterThan(-1);
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`[wikilink-sync] ${fnName} 大括号未闭合`);
}

describe('改名同步互链 ⇄ 受影响窗口刷新 接线锁', () => {
  const events = read(EVENTS_TS);
  const session = read(SESSION_TS);

  it('广播事件名是全局口径的 solo:wikilinks-synced（emit 与 listen 必须同名）', () => {
    expect(events).toContain("const WIKILINKS_SYNCED = 'solo:wikilinks-synced';");
    const emitBody = bodyOf(events, 'emitWikilinksSynced');
    const listenBody = bodyOf(events, 'listenWikilinksSynced');
    expect(emitBody, 'emit 没走全局广播（改成 getCurrentWindow 定向就漏窗口了）').toContain(
      'emit(WIKILINKS_SYNCED',
    );
    expect(listenBody).toContain('WIKILINKS_SYNCED');
  });

  it('改写落盘成功后才广播（syncInboundWikilinks 内，且晚于 changed.length 判定）', () => {
    const body = bodyOf(session, 'syncInboundWikilinks');
    expect(body, '广播那行被删了 —— 窗口不会再自动刷新').toContain('emitWikilinksSynced(');
    expect(body.indexOf('changed.length > 0')).toBeLessThan(body.indexOf('emitWikilinksSynced('));
    // 只预览（dry_run=true）那一步绝不能广播：那时一个文件都还没改
    const dryRunCall = body.indexOf('syncWikilinksOnRename(oldPath, newPath, true)');
    expect(dryRunCall, '预览调用签名变了，本锁需同步更新').toBeGreaterThan(-1);
    expect(body.indexOf('emitWikilinksSynced(')).toBeGreaterThan(dryRunCall);
  });

  it('订阅广播且随组件卸载注销（异步注册也要兜住先卸载的竞态）', () => {
    expect(session).toContain('listenWikilinksSynced(');
    expect(session, '卸载时没注销 → 监听器泄漏').toContain('unlistenWikilinksSynced?.()');
    expect(session, '异步注册完成后需在已卸载时自我注销').toContain('if (disposed) fn();');
  });

  it('干净态静默重载、脏态只提示（绝不覆盖用户手上未保存的内容）', () => {
    const body = bodyOf(session, 'handleWikilinksSynced');
    expect(body).toContain('evaluateDirtyFromEditor()');
    expect(body).toContain('promptExternalModified()');
    expect(body, '干净态没重载 → 链接名不会当场变新').toContain('fileStore.setFile(');
    // 脏态分支必须在重载之前 return，否则未保存编辑会被盘上内容顶掉
    expect(body.indexOf('promptExternalModified()')).toBeLessThan(body.indexOf('fileStore.setFile('));
    // 大文档自动重载 = 一次全量重解析的顿挫（≥50 万字档），必须挡在自动路径之外改走提示
    expect(body, '大文档性能闸被拆了 —— 会自动重载大文档').toContain('isHeavyDocument()');
    expect(body.indexOf('isHeavyDocument()')).toBeLessThan(body.indexOf('fileStore.setFile('));
    // 读盘期间用户可能已经开始输入：await 之后必须再查一次脏态，
    // 只查 await 之前那次会把刚打的字静默抹掉（2026-10-20 复审）
    expect(
      body.lastIndexOf('evaluateDirtyFromEditor()'),
      '重载前缺少第二次脏态检查（await 之后）',
    ).toBeGreaterThan(body.indexOf('await openDocument('));
  });
});
