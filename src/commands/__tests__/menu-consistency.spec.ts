/**
 * registry ⟷ menu.rs 兜底键位一致性闸门（M-13）
 *
 * 背景：`menu.rs` 每个菜单项都带一个「兜底加速键」，只在启动后 IPC 同步前生效。
 * 两边曾各写一套默认值（如 find 是 `CmdOrCtrl+G` vs registry 的 `Mod-f`）⇒ 首屏窗口期
 * 用户按下去没有反应，且这类漂移**已复发三次**，此前无任何护栏。
 *
 * 做法与 `mark-delimiter-coverage.spec.ts` 同款：直接读 Rust 源码文本抽兜底值比对，
 * 比「跑起来看菜单」稳定，也不依赖平台。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { COMMANDS, getShortcut, toTauriAccelerator } from '../registry';

const MENU_RS = readFileSync('src-tauri/src/menu.rs', 'utf8');

/** 抽 `accelerator(shortcuts, "id", Some("accel"))` 的 (id, accel) */
function rustFallbacks(): Array<{ id: string; accel: string }> {
  const found: Array<{ id: string; accel: string }> = [];
  const re = /accelerator\(\s*shortcuts,\s*"([^"]+)",\s*Some\("([^"]+)"\)/g;
  for (const match of MENU_RS.matchAll(re)) {
    found.push({ id: match[1], accel: match[2] });
  }
  return found;
}

describe('menu.rs 兜底键位 ⟷ registry 默认键位', () => {
  const fallbacks = rustFallbacks();

  it('抽取有效（防「正则抽不出来 → 空数组 → 假绿」）', () => {
    expect(fallbacks.length).toBeGreaterThan(0);
  });

  it('menu.rs 配了兜底的 id 必须都是 registry 里的菜单命令', () => {
    const menuIds = new Set(COMMANDS.filter((c) => c.menuSection).map((c) => c.id));
    const unknown = fallbacks.map((f) => f.id).filter((id) => !menuIds.has(id));
    expect(
      unknown,
      `menu.rs 给这些 id 配了兜底键，但 registry 里它们不是菜单命令：${unknown.join(', ')}`,
    ).toEqual([]);
  });

  it('每个菜单命令的 registry 默认键位都要在 menu.rs 里有对应兜底', () => {
    const missing: string[] = [];
    for (const command of COMMANDS) {
      if (!command.menuSection) continue;
      const shortcut = getShortcut(command);
      if (!shortcut) continue; // 无默认键位的命令（如 关于/诊断）不配兜底
      const accel = toTauriAccelerator(shortcut);
      if (!MENU_RS.includes(`"${accel}"`)) {
        missing.push(`${command.id}（期望 ${accel}）`);
      }
    }
    expect(
      missing,
      `这些菜单命令的 registry 默认键位在 menu.rs 里找不到对应兜底 ⇒ 首屏窗口期会按错键：` +
        missing.join(' / '),
    ).toEqual([]);
  });
});
