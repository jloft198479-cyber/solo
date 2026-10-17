/**
 * 设计契约锁（B 级守恒锁，只当警报器）
 *
 * 防的事故（设计规范化批 1，2026-10-17，见 docs/PROPOSAL-design-standards.md）：
 * - A2：代码块 / 公式 / 图表编辑框字号被写回 px ⇒「正文字号放大后代码块不跟」
 * - A4：设置页行高兜底值与 editor.css 真值漂移（历史曾 1.9 vs 1.7 两说）
 * - B4：Tailwind v4 preflight 不再给 button 加 cursor: pointer ⇒ 按钮悬浮显示箭头
 * - B5：编辑器浮层按钮仅 hover 显形、无 :focus-visible ⇒ 键盘 Tab 过去看不见
 *
 * 本锁只保证「机制没被改回去」，不证明观感正确 —— 观感靠真机目视。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const readSrc = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

/** 取出某选择器块内的声明文本（不解析 CSS，只做定位匹配，够用且稳定） */
function ruleBody(css: string, selector: string): string {
  const idx = css.indexOf(selector);
  if (idx === -1) return '';
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('排版跟随：内容类字号必须用相对单位（A2）', () => {
  const editorCss = readSrc('components/Editor/tiptap/editor.css');

  const contentSelectors = [
    '.tiptap-editor pre',
    '.tiptap-editor .mk-math-textarea',
    '.tiptap-editor .mk-mermaid-textarea',
  ];

  for (const sel of contentSelectors) {
    it(`${sel} 的 font-size 用 em（跟随正文字号，不许回退 px）`, () => {
      const body = ruleBody(editorCss, `${sel} {`);
      expect(body, `找不到 ${sel} 的规则块`).not.toBe('');
      expect(body).toMatch(/font-size:\s*[\d.]+em/);
      expect(body).not.toMatch(/font-size:\s*[\d.]+px/);
    });
  }
});

describe('行高真理源一致（A4）', () => {
  const editorCss = readSrc('components/Editor/tiptap/editor.css');
  const panel = readSrc('components/Settings/AppearanceSettingsPanel.vue');

  it('设置页行高兜底值 === editor.css --mk-line-height（防再次漂移）', () => {
    const cssValue = editorCss.match(/--mk-line-height:\s*([\d.]+);/);
    expect(cssValue, 'editor.css 里找不到 --mk-line-height').toBeTruthy();

    // 只取 lineHeight 分支的兜底值（同文件上方 font-size 分支也有一个 parseFloat(raw) : 16）
    const panelValue = panel.match(
      /typography\?\.lineHeight;[\s\S]{0,120}?parseFloat\(raw\)\s*:\s*([\d.]+)/,
    );
    expect(panelValue, 'AppearanceSettingsPanel 里找不到行高兜底值').toBeTruthy();
    expect(panelValue![1]).toBe(cssValue![1]);
  });
});

describe('光标与键盘可见性（B4 / B5）', () => {
  const mainCss = readSrc('assets/styles/main.css');
  const editorCss = readSrc('components/Editor/tiptap/editor.css');
  const themeCard = readSrc('components/Settings/ThemeCard.vue');

  it('全局兜底：button 悬浮有手型光标（非 disabled）', () => {
    expect(mainCss).toMatch(/button:not\(:disabled\)\s*\{[^}]*cursor:\s*pointer/);
  });

  const focusVisibleSelectors = [
    '.tiptap-editor .mk-code-block-copy-button:focus-visible',
    '.tiptap-editor .mk-block-delete-button:focus-visible',
    '.tiptap-editor .mk-block-zoom-button:focus-visible',
  ];

  for (const sel of focusVisibleSelectors) {
    it(`${sel} 存在且使按钮显形（opacity: 1）`, () => {
      const body = ruleBody(editorCss, `${sel} {`);
      expect(body, `找不到 ${sel} 规则`).not.toBe('');
      expect(body).toMatch(/opacity:\s*1/);
    });
  }

  it('主题卡删除按钮有 :focus-visible 显形', () => {
    const body = ruleBody(themeCard, '.theme-delete-btn:focus-visible {');
    expect(body, '找不到 .theme-delete-btn:focus-visible 规则').not.toBe('');
    expect(body).toMatch(/opacity:\s*1/);
  });
});
