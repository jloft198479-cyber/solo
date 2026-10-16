/**
 * 字体作用域契约锁（B 级守恒锁，只当警报器）
 *
 * 防的事故：早期 `body` 直接用 `--font-text`，导致「切换正文字体 ⇒ 整个界面
 * （标题栏 / 侧栏 / 大纲 / 菜单 / 设置）跟着换字体」。文艺字体一上，小字号
 * 菜单直接难读。业界（Obsidian / Notion / VS Code）都是正文字体与界面字体分离。
 *
 * 本锁只保证「CSS 变量的归属没被改回去」，**不证明界面观感正确** —— 观感靠
 * 真机目视 / CDP 截图。边界定义见 docs/PROPOSAL-font-scope.md。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MONO_FALLBACK_STACK } from '../utils/fontStack';

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

describe('字体作用域：正文 / 界面 / 代码 三分', () => {
  const mainCss = readSrc('assets/styles/main.css');
  const editorCss = readSrc('components/Editor/tiptap/editor.css');

  it('界面字体变量 --font-ui 已定义', () => {
    expect(mainCss).toMatch(/--font-ui\s*:/);
  });

  it('body 用界面字体，不用正文字体（界面不随正文字体变化）', () => {
    const body = ruleBody(mainCss, '\nbody {');
    expect(body).toMatch(/font-family:\s*var\(--font-ui\)/);
    expect(body).not.toMatch(/var\(--font-text\)/);
  });

  it('编辑区用正文字体', () => {
    const editor = ruleBody(editorCss, '.tiptap-editor {');
    expect(editor).toMatch(/font-family:\s*var\(--font-text\)/);
  });

  it('编辑区内的提示文字固定为界面字体（不被文艺字体带跑）', () => {
    const placeholder = ruleBody(editorCss, '.tiptap-editor p.is-editor-empty:first-child::before');
    expect(placeholder).toMatch(/font-family:\s*var\(--font-ui\)/);
  });
});

describe('代码字体栈：单一来源（--font-mono）', () => {
  const mainCss = readSrc('assets/styles/main.css');
  const externalize = readSrc('components/Editor/tiptap/externalize-html.ts');

  it('MONO_FALLBACK_STACK 与 main.css 的 --font-mono 逐字一致（防漂移）', () => {
    const matched = mainCss.match(/--font-mono:\s*([^;]+);/);
    expect(matched, 'main.css 里找不到 --font-mono 声明').toBeTruthy();
    expect(matched![1]!.replace(/\s+/g, ' ').trim()).toBe(MONO_FALLBACK_STACK);
  });

  it('出站归一不自带字体栈字面量，走 resolveMonoFontStack()（台账 §二 #67）', () => {
    expect(externalize).toContain('resolveMonoFontStack');
    expect(externalize).not.toMatch(/ui-monospace|SFMono/);
  });
});
