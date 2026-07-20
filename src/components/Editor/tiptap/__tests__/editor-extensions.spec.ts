/**
 * 浮动菜单定位的边界检测测试。
 *
 * 锁住的不变量：SlashMenu / EmojiMenu 显示位置不会超出视口边界。
 * 覆盖场景：下方放得下（默认）、下方遮挡→翻转上方、右侧遮挡→左移、
 * 上方也放不下→钉视口顶、左侧超出→钉视口左边。
 */
import { describe, expect, it } from 'vitest';
import { computeMenuPosition } from '../editor-extensions';

// 视口常量（与实现里的 MENU_MAX_HEIGHT=340 / MENU_MIN_WIDTH=240 / VIEWPORT_MARGIN=8 对齐）
const MENU_MAX_HEIGHT = 340;
const MENU_MIN_WIDTH = 240;
const MARGIN = 8;

describe('computeMenuPosition - 浮动菜单边界检测', () => {
  it('下方放得下：默认放下方（top = rect.bottom + 4）', () => {
    const rect = { top: 100, bottom: 120, left: 50 };
    const viewport = { width: 1024, height: 768 };
    expect(computeMenuPosition(rect, viewport)).toEqual({ top: 124, left: 50 });
  });

  it('下方遮挡 + 上方放得下：翻转到光标上方', () => {
    // 视口高 500，光标在 bottom=400，下方剩 100 放不下 340 的菜单
    // 上方有 400-340-4=56 ≥ 8，放得下 → 翻转
    const rect = { top: 380, bottom: 400, left: 50 };
    const viewport = { width: 1024, height: 500 };
    expect(computeMenuPosition(rect, viewport)).toEqual({
      top: 380 - MENU_MAX_HEIGHT - 4, // = 36
      left: 50,
    });
  });

  it('下方遮挡 + 上方也放不下（菜单比视口高）：钉视口顶部', () => {
    // 视口高 300，光标在 bottom=200；上方 top=200-340-4=-144 < 8 放不下
    // → 钉在顶部 margin
    const rect = { top: 180, bottom: 200, left: 50 };
    const viewport = { width: 1024, height: 300 };
    expect(computeMenuPosition(rect, viewport)).toEqual({ top: MARGIN, left: 50 });
  });

  it('右侧遮挡：left 向左收缩到视口内', () => {
    // 视口宽 800，光标 left=700，菜单 min-width 240 → 700+240=940 超出
    // → left = 800 - 240 - 8 = 552
    const rect = { top: 100, bottom: 120, left: 700 };
    const viewport = { width: 800, height: 768 };
    expect(computeMenuPosition(rect, viewport)).toEqual({
      top: 124,
      left: 800 - MENU_MIN_WIDTH - MARGIN, // = 552
    });
  });

  it('左侧超出（rect.left 为负或太小）：钉视口左边', () => {
    const rect = { top: 100, bottom: 120, left: -50 };
    const viewport = { width: 1024, height: 768 };
    expect(computeMenuPosition(rect, viewport)).toEqual({ top: 124, left: MARGIN });
  });

  it('光标在视口右下角：上下左右都翻转', () => {
    // 视口 800x500，光标在 (780, 480)，下方放不下、右侧也放不下
    const rect = { top: 460, bottom: 480, left: 780 };
    const viewport = { width: 800, height: 500 };
    expect(computeMenuPosition(rect, viewport)).toEqual({
      top: 460 - MENU_MAX_HEIGHT - 4, // 翻转上方
      left: 800 - MENU_MIN_WIDTH - MARGIN, // 左收缩
    });
  });

  it('小视口极端场景：菜单比视口还高，至少 top 钉顶、left 钉左', () => {
    // 视口 200x200，菜单 max-height 340，min-width 240 都超出
    const rect = { top: 100, bottom: 110, left: 100 };
    const viewport = { width: 200, height: 200 };
    expect(computeMenuPosition(rect, viewport)).toEqual({
      top: MARGIN,
      left: MARGIN,
    });
  });
});
