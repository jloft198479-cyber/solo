/**
 * 浮动菜单定位的边界检测测试 + Suggestion 触发配置契约测试。
 *
 * 锁住的不变量：SlashMenu / EmojiMenu 显示位置不会超出视口边界；
 * Slash / Emoji 两个 Suggestion 的 allowedPrefixes 均为 null（任意前缀触发）。
 */
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { computeMenuPosition, createEditorExtensions } from '../editor-extensions';

// 视口常量（与实现里的 MENU_IDEAL_HEIGHT=340 / MENU_MIN_HEIGHT=120 /
// MENU_MIN_WIDTH=240 / VIEWPORT_MARGIN=8 / CURSOR_GAP=4 对齐）
const MENU_IDEAL_HEIGHT = 340;
const MENU_MIN_HEIGHT = 120;
const MENU_MIN_WIDTH = 240;
const MARGIN = 8;
const GAP = 4;

/** 菜单底边在视口中的 y 坐标（上方定位时由 bottom 反推） */
const bottomEdgeY = (pos: { bottom?: number }, vh: number) => vh - (pos.bottom ?? 0);

describe('computeMenuPosition - 浮动菜单边界检测（size + flip）', () => {
  it('下方放得下：默认放下方，并把该侧可用高度下发为 max-height', () => {
    const rect = { top: 100, bottom: 120, left: 50 };
    const viewport = { width: 1024, height: 768 };
    expect(computeMenuPosition(rect, viewport)).toEqual({
      top: 120 + GAP,
      left: 50,
      maxHeight: 768 - MARGIN - 120 - GAP, // = 636
    });
  });

  it('下方遮挡 + 上方放得下：翻转到光标上方', () => {
    // 视口高 500，光标 bottom=400：下方仅剩 88，上方有 368 → 翻转
    const rect = { top: 380, bottom: 400, left: 50 };
    const viewport = { width: 1024, height: 500 };
    const pos = computeMenuPosition(rect, viewport);
    expect(pos.top).toBeUndefined();
    expect(pos.bottom).toBe(500 - rect.top + GAP); // = 124
    expect(pos.maxHeight).toBe(rect.top - MARGIN - GAP); // = 368
  });

  it('★ 上翻时菜单底边紧贴光标上沿（不按最大高度占座）', () => {
    // 锁住本次修复的核心：旧实现用「top = 光标上沿 − 最大高度」定位，
    // 菜单内容少时底边离光标一大截（看着像飘在别处，与输入点毫无关联）。
    // 改用 bottom 定位后，无论菜单实际多高，底边恒在「光标上沿 − 缝隙」处。
    const vh = 500;
    const rect = { top: 380, bottom: 400, left: 50 };
    const pos = computeMenuPosition(rect, { width: 1024, height: vh });
    expect(pos.top).toBeUndefined();
    expect(bottomEdgeY(pos, vh)).toBe(rect.top - GAP); // = 376
    // 反证：与旧实现的落点明显不同（差 ≈ 最大高度 − 实际高度）
    expect(bottomEdgeY(pos, vh)).not.toBe(rect.top - MENU_IDEAL_HEIGHT - GAP);
  });

  it('上下都放不下：退到宽敞的一侧并压缩高度，菜单不越界', () => {
    // 视口高 300，光标 bottom=200：下方 88、上方 168，都 < 理想 340
    // → 取上方并压到 168：底边 176、顶边 176−168=8，恰好贴住视口边距
    const rect = { top: 180, bottom: 200, left: 50 };
    const viewport = { width: 1024, height: 300 };
    const pos = computeMenuPosition(rect, viewport);
    expect(pos.bottom).toBe(300 - rect.top + GAP); // = 124
    expect(pos.maxHeight).toBe(rect.top - MARGIN - GAP); // = 168
    expect(bottomEdgeY(pos, 300) - (pos.maxHeight ?? 0)).toBe(MARGIN); // 顶边不越界
  });

  it('空间极小：max-height 不低于下限，菜单仍可用', () => {
    // 视口 200x200，上方可用仅 88 < 下限 120 → 取 120
    const rect = { top: 100, bottom: 110, left: 100 };
    const viewport = { width: 200, height: 200 };
    const pos = computeMenuPosition(rect, viewport);
    expect(pos.maxHeight).toBe(MENU_MIN_HEIGHT);
  });

  it('右侧遮挡：left 向左收缩到视口内', () => {
    // 视口宽 800，光标 left=700，菜单 min-width 240 → 700+240=940 超出
    // → left = 800 - 240 - 8 = 552
    const rect = { top: 100, bottom: 120, left: 700 };
    const viewport = { width: 800, height: 768 };
    const pos = computeMenuPosition(rect, viewport);
    expect(pos.left).toBe(800 - MENU_MIN_WIDTH - MARGIN); // = 552
  });

  it('左侧超出（rect.left 为负或太小）：钉视口左边', () => {
    const rect = { top: 100, bottom: 120, left: -50 };
    const viewport = { width: 1024, height: 768 };
    const pos = computeMenuPosition(rect, viewport);
    expect(pos.left).toBe(MARGIN);
  });

  it('光标在视口右下角：上下左右都翻转', () => {
    // 视口 800x500，光标在 (780, 480)，下方放不下、右侧也放不下
    const rect = { top: 460, bottom: 480, left: 780 };
    const viewport = { width: 800, height: 500 };
    const pos = computeMenuPosition(rect, viewport);
    expect(pos.top).toBeUndefined(); // 翻到上方
    expect(pos.bottom).toBe(500 - rect.top + GAP); // = 44
    expect(pos.left).toBe(800 - MENU_MIN_WIDTH - MARGIN); // = 552
    // 压缩后顶边仍在视口内
    expect(bottomEdgeY(pos, 500) - (pos.maxHeight ?? 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('Suggestion 触发配置契约（allowedPrefixes=null）', () => {
  /**
   * Suggestion 默认 allowedPrefixes=[' ']——只允许空格/行首前缀，中文场景致命
   * （「你好/」「你好:微笑」完全无反应）。Slash 已修、Emoji 曾漏修，
   * 本测试直接断言 createEditorExtensions 产出的实际配置，锁死「null」契约，
   * 防止未来误改回默认值或漏传。
   */
  function extensionOptions(
    name: string,
    getDocumentPath?: () => string | null,
  ): Record<string, unknown> | undefined {
    const extensions = createEditorExtensions({
      slashMenuRef: ref(null as never),
      slashMenuItems: ref([] as never),
      slashMenuCommand: ref((() => {}) as never),
      emojiMenuRef: ref(null as never),
      emojiMenuItems: ref([] as never),
      emojiMenuCommand: ref((() => {}) as never),
      wikilinkMenuRef: ref(null as never),
      wikilinkMenuItems: ref([] as never),
      wikilinkMenuCommand: ref((() => {}) as never),
      searchHighlightOptions: {} as never,
      getDocumentPath,
    });
    const found = extensions.find((ext) => ext.name === name);
    return found?.options as Record<string, unknown> | undefined;
  }

  it('Slash：allowedPrefixes 显式为 null（任意前缀触发，中文可用）', () => {
    const opts = extensionOptions('slashCommands') as
      | { suggestion?: { allowedPrefixes?: string[] | null } }
      | undefined;
    expect(opts?.suggestion?.allowedPrefixes).toBeNull();
  });

  it('Emoji：allowedPrefixes 显式为 null（中文后输入 :微笑 可唤出菜单）', () => {
    const opts = extensionOptions('emojiSuggest') as
      | { suggestion?: { allowedPrefixes?: string[] | null } }
      | undefined;
    expect(opts?.suggestion?.allowedPrefixes).toBeNull();
  });

  it('Wikilink：allowedPrefixes 显式为 null + char 为 [[（中文后输入 [[ 可唤出）', () => {
    const opts = extensionOptions('wikilinkSuggest') as
      | { suggestion?: { allowedPrefixes?: string[] | null; char?: string } }
      | undefined;
    expect(opts?.suggestion?.allowedPrefixes).toBeNull();
    expect(opts?.suggestion?.char).toBe('[[');
  });

});
