/**
 * 主题模板完整性锁
 *
 * 防的事故（2026-10-20，见 outputs/AUDIT-2026-10-20-主题可定制性.md）：
 * - **喂假开关**：模板给了字段，真实界面零 `var()` 消费点（tagBg / successBg / shadowLg …）
 * - **死字段**：模板给了 `radiusSm` 这类 `ThemeColors` 里根本不存在的键
 * - **值漂移**：模板 typography 抄了当年 JSDoc 的错误值（lineHeight 1.9 而实测 1.6）
 * - **遗漏**：`ThemeColors` 的必填项模板没给，用户主题呈半残状态
 *
 * 判据全部来自系统外可观察事实（源码里的 `var()` 消费点、`editor.css` 实测值），
 * 不依赖任何"注释里写着"的说法。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CSS_VAR_MAP } from '../types';

const root = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(root(rel), 'utf8');

const template = JSON.parse(read('public/theme-template.json')) as {
  colors: Record<string, string>;
  typography?: Record<string, string>;
};
const typesSrc = read('src/themes/types.ts');
const editorCss = read('src/components/Editor/tiptap/editor.css');

/** 从 ThemeColors 接口里解析字段：{ name, optional } */
function themeColorFields(): Array<{ name: string; optional: boolean }> {
  const iface = typesSrc.slice(
    typesSrc.indexOf('export interface ThemeColors'),
    typesSrc.indexOf('/**\n * 排版变量'),
  );
  return [...iface.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)(\??):/gm)].map((m) => ({
    name: m[1],
    optional: m[2] === '?',
  }));
}

/** 采集 src 下全部 css/vue 的声明层之外的文本（去掉 `--x: y;` 定义行，只留消费） */
function collectConsumption(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === '__tests__') continue;
        walk(p);
      } else if (['.css', '.vue', '.ts'].includes(extname(p))) {
        out.push(readFileSync(p, 'utf8'));
      }
    }
  };
  walk(fileURLToPath(new URL('../../', import.meta.url)));
  return out
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--[a-z0-9-]+:\s*[^;]+;/gm, '');
}

const consumption = collectConsumption();

describe('主题模板：字段集与接口一致', () => {
  const fields = themeColorFields();

  it('接口字段解析成功（防止正则失配后锁空转成绿）', () => {
    expect(fields.length, '解析不出 ThemeColors 字段').toBeGreaterThan(60);
  });

  it('模板里的每个字段都真实存在于 ThemeColors（拦死字段 / 拼错）', () => {
    const known = new Set(fields.map((f) => f.name));
    const unknown = Object.keys(template.colors).filter((k) => !known.has(k));
    expect(unknown, '模板声明了 ThemeColors 里不存在的字段，用户改了不会有任何反应').toEqual([]);
  });

  it('ThemeColors 的必填字段模板全都给了（拦遗漏）', () => {
    const declared = new Set(Object.keys(template.colors));
    const missing = fields.filter((f) => !f.optional && !declared.has(f.name)).map((f) => f.name);
    expect(missing, '主题模板缺这些必填字段，导入后该颜色会是 undefined').toEqual([]);
  });

  it('每个模板字段都有 CSS_VAR_MAP 映射', () => {
    const unmapped = Object.keys(template.colors).filter((k) => !(k in CSS_VAR_MAP));
    expect(unmapped, '字段没有 CSS 变量映射，注入时会被静默跳过').toEqual([]);
  });
});

describe('主题模板：不喂假开关', () => {
  it('模板里每个字段在源码中至少有一个 var() 消费点', () => {
    const dead: string[] = [];
    for (const key of Object.keys(template.colors)) {
      const cssVar = CSS_VAR_MAP[key as keyof typeof CSS_VAR_MAP];
      if (!cssVar) continue; // 上一条锁已单独报
      // 容忍 `var(\n  --x` 这类格式化换行，避免锁因排版而假绿
      if (!new RegExp(`var\\(\\s*${cssVar}`).test(consumption)) dead.push(`${key} → ${cssVar}`);
    }
    expect(
      dead,
      '这些字段在模板里可调、但源码没有任何 var() 引用 ⇒ 用户改了屏幕不会变（假开关）。' +
        '有 UI 对应就接线，没有就从模板移除。',
    ).toEqual([]);
  });
});

describe('主题模板：typography 值必须等于实测默认值', () => {
  it('模板声明的每个排版值都等于 editor.css 的实测值', () => {
    const typography = template.typography ?? {};
    const drift: string[] = [];
    for (const [field, value] of Object.entries(typography)) {
      // ThemeTypography 字段 → CSS 变量，取自 manager.ts 的 TYPOGRAPHY_VAR_MAP（真理源）
      const managerSrc = read('src/themes/manager.ts');
      const mapBlock = managerSrc.slice(managerSrc.indexOf('TYPOGRAPHY_VAR_MAP'));
      const cssVar = mapBlock.match(new RegExp(`${field}:\\s*'(--mk-[a-z0-9-]+)'`))?.[1];
      if (!cssVar) {
        drift.push(`${field}：TYPOGRAPHY_VAR_MAP 里找不到映射`);
        continue;
      }
      const declared = editorCss.match(new RegExp(`${cssVar}:\\s*([^;]+);`))?.[1]?.trim();
      const fallback = editorCss.match(new RegExp(`var\\(${cssVar},\\s*([^)]+)\\)`))?.[1]?.trim();
      const actual = declared ?? fallback;
      if (!actual) drift.push(`${field}：editor.css 里既无定义也无 fallback`);
      else if (actual !== value) drift.push(`${field}：模板写 ${value}，实测 ${actual}`);
    }
    expect(
      drift,
      '模板排版值与产品默认值不一致 ⇒ 用户「照抄不改」也会改掉版式（刷墙长高）。',
    ).toEqual([]);
  });

  it('模板不得重新引入全文级排版参数（行高 / 正文字号 / 字距 / 段距）', () => {
    const fullDocLevel = ['lineHeight', 'fontSize', 'letterSpacing', 'paragraphSpacing'];
    const present = fullDocLevel.filter((k) => k in (template.typography ?? {}));
    expect(
      present,
      '全文级排版归「设置 → 编辑器」，不属于主题（与 VS Code / Obsidian 的排版解耦一致）',
    ).toEqual([]);
  });
});
