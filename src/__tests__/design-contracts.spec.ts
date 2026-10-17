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
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
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

/** 去掉注释再扫：说明文字里引用历史值是正常的，不算硬编码 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 递归收集 src 下的所有文件（跳过 __tests__ 与 node_modules） */
function walkAll(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walkAll(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
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

describe('层级：所有 z-index 一律走语义 token（B2）', () => {
  // 改前 13 个离散值、19 处、5 组撞值（50×2 / 100×2 / 300×3 / 400×2 / 9999×2），
  // 谁高谁低只能靠读实现猜。这张锁保证：想加浮层必须先在 main.css 的刻度表里
  // 找到语义；写死数字当场红，避免半年后又长出第十四档。
  const files = walkAll(fileURLToPath(new URL('..', import.meta.url))).filter(
    (f) => f.endsWith('.vue') || f.endsWith('.css'),
  );

  it('没有任何字面量 z-index 数字', () => {
    const bad: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/z-index:\s*(\d+)/g)) {
        bad.push(`${relative(fileURLToPath(new URL('..', import.meta.url)), file)}: ${m[0]}`);
      }
    }
    expect(bad, '请改用 var(--z-*)：语义档位见 main.css 的刻度表').toEqual([]);
  });

  it('没有 Tailwind 数字层级类（z-50 / z-[2000] 一类）', () => {
    const bad: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bz-\[?\d+/g)) {
        bad.push(`${relative(fileURLToPath(new URL('..', import.meta.url)), file)}: ${m[0]}`);
      }
    }
    expect(bad, '请改用 z-[var(--z-*)] 或样式块里的 var(--z-*)').toEqual([]);
  });
});

describe('token 引用必须可解析（防改名漏改）', () => {
  // 2026-10-17 真实事故：`--z-titlebar` 更名为 `--z-chrome` 时漏改了标题栏自身那一处，
  // `var(--z-titlebar)` 解析失败 ⇒ z-index 退回 auto ⇒ **整个标题栏被正文盖住、看起来"不见了"**。
  // 教训：清掉字面量 ≠ 引用有效。所以在这里逐条核对「用到就必须定义过」。
  const css = readFileSync(fileURLToPath(new URL('../assets/styles/main.css', import.meta.url)), 'utf8');
  const defined = new Set([...css.matchAll(/(--(?:z|space)-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

  it('var(--z-*) 与 var(--space-*) 全部有定义', () => {
    const files = walkAll(fileURLToPath(new URL('..', import.meta.url))).filter(
      (f) => f.endsWith('.vue') || f.endsWith('.css'),
    );
    const missing: string[] = [];
    for (const file of files) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/var\((--(?:z|space)-[a-z0-9-]+)\)/g)) {
        if (!defined.has(m[1])) {
          missing.push(`${relative(fileURLToPath(new URL('..', import.meta.url)), file)}: ${m[1]}`);
        }
      }
    }
    expect(missing, '这些 token 被引用但没有定义（改名漏改？）').toEqual([]);
  });
});

describe('间距标度（B7）', () => {
  const css = readSrc('assets/styles/main.css');
  const SCALE = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'];
  const EXPECTED = [2, 4, 6, 8, 12, 16, 24, 32];

  it('标度齐全、单调递增、且与实际用值一致', () => {
    const values = SCALE.map((k) =>
      Number(css.match(new RegExp(String.raw`--space-${k}:\s*(\d+)px`))?.[1]),
    );
    expect(values, '--space-* 刻度缺档').toEqual(EXPECTED);
  });

  it('刻度内的单值间距一律走 var(--space-*)', () => {
    const files = walkAll(fileURLToPath(new URL('..', import.meta.url))).filter(
      (f) => f.endsWith('.vue') || f.endsWith('.css'),
    );
    const bad: string[] = [];
    const re = /^\s*(gap|row-gap|column-gap|padding|margin)(-(?:top|bottom|left|right))?:\s*(\d+)px;/gm;
    for (const file of files) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const m of text.matchAll(re)) {
        if (EXPECTED.includes(Number(m[3]))) {
          bad.push(`${relative(fileURLToPath(new URL('..', import.meta.url)), file)}: ${m[0].trim()}`);
        }
      }
    }
    expect(bad, '这些间距在刻度内，请改用 var(--space-*)').toEqual([]);
  });
});

describe('圆角刻度（B6）', () => {
  const css = readSrc('assets/styles/main.css');
  // 原第 6 档 `xl: 10px` 零消费，已按 B8 删除 —— 有刻度无消费等于留个假选项。
  // 删档必须同步这里：多一档（偷偷加回来）或少一档（误删承重档）都会红。
  const SCALE = ['xs', 'sm', 'md', 'lg', 'pill'];
  const EXPECTED = ['2px', '3px', '4px', '8px', '999px'];

  it('刻度齐全且等于既定值', () => {
    const values = SCALE.map((k) =>
      css.match(new RegExp(`--radius-${k}:\\s*([^;]+);`))?.[1].trim(),
    );
    expect(values, '--radius-* 刻度缺档或被改值').toEqual(EXPECTED);
  });

  it('不许有刻度外的 --radius-* 定义', () => {
    // 只查「五档都在」挡不住「偷偷加回第六档」—— 那正是 B8 要清掉的东西。
    // 扫前剥注释：说明文字里写「原 `--radius-xl: 10px` 已删」是正常的，不算定义。
    const declared = [...stripComments(css).matchAll(/(--radius-[a-z0-9]+)\s*:/g)].map((m) => m[1]);
    const known = SCALE.map((k) => `--radius-${k}`);
    expect(declared.sort(), '多出来的圆角档等于又留了个假选项').toEqual(known.sort());
  });

  it('不允许字面量圆角（0 = 无圆角、50% = 正圆，两者不是刻度值）', () => {
    const files = walkAll(fileURLToPath(new URL('..', import.meta.url))).filter(
      (f) => f.endsWith('.vue') || f.endsWith('.css'),
    );
    const bad: string[] = [];
    for (const file of files) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/border-radius:\s*([^;]+);/g)) {
        if (/\d+px/.test(m[1])) {
          bad.push(`${relative(fileURLToPath(new URL('..', import.meta.url)), file)}: ${m[0]}`);
        }
      }
    }
    expect(bad, '请改用 var(--radius-*)：刻度见 main.css').toEqual([]);
  });
});

describe('模态遮罩（B6）', () => {
  // 历史问题：设置弹窗写死 bg-black/30，绕过 --modal-overlay 的明暗两套暖棕，
  // 浅色主题下这块遮罩比命令面板偏冷偏灰 —— 同一语义两套配方。
  it('设置 / 命令面板 / 未保存三处遮罩都走 --modal-overlay', () => {
    const settings = readSrc('components/Settings/SettingsModal.vue');
    const palette = readSrc('components/CommandPalette.vue');
    const mainCss = readSrc('assets/styles/main.css');

    expect(ruleBody(settings, '.settings-modal-overlay')).toContain('var(--modal-overlay)');
    expect(ruleBody(palette, '.palette-overlay')).toContain('var(--modal-overlay)');
    expect(ruleBody(mainCss, '.unsaved-overlay')).toContain('var(--modal-overlay)');

    // 不许再写 bg-black/N（Tailwind 类会盖过主题）
    expect(settings).not.toMatch(/bg-black\/\d+/);
  });
});

describe('排版注释与实测对齐（B1a）', () => {
  // ThemeTypography 的 JSDoc 曾漂移 15 处（lineHeight 写 1.9 实 1.6、
  // h1 字号写 1.875em 实 1.6em…），而 8 套预设一个都没声明 typography ⇒
  // 注释就是唯一文档，写错等于骗人。真理源是 editor.css，这里逐条比对。
  const types = readSrc('themes/types.ts');
  const editorCss = readSrc('components/Editor/tiptap/editor.css');

  it('每条「当前 X」都等于 editor.css 的实测值', () => {
    const docs = [...types.matchAll(/`(--mk-[a-z0-9-]+)`（当前 ([^）]+)）/g)];
    // 26 个字段写死 —— 注释被删光时锁不能空转成绿
    expect(docs.length, 'ThemeTypography 注释格式被破坏或被删').toBe(26);

    const bad: string[] = [];
    for (const m of docs) {
      const cssVar = m[1];
      const documented = m[2].trim();
      const declared = editorCss.match(new RegExp(`${cssVar}:\\s*([^;]+);`))?.[1].trim();
      const fallback = editorCss.match(new RegExp(`var\\(${cssVar},\\s*([^)]+)\\)`))?.[1].trim();
      const actual = declared ?? fallback;
      if (!actual) bad.push(`${cssVar}：editor.css 里既无定义也无 fallback`);
      else if (actual !== documented) bad.push(`${cssVar}：注释写 ${documented}，实测 ${actual}`);
    }
    expect(bad, '注释与 CSS 漂移，请把注释改成实测值').toEqual([]);
  });
});
