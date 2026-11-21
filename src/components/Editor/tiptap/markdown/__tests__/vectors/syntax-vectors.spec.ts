/**
 * 语法支持度向量表的两条职责（读写同一份数据，见 `vectors/syntax-vectors.ts`）：
 *
 *   1. **跑断言**：每条向量逐条 `parse → serialize`，与判断过的 `expected` 比对；
 *      再跑第二轮，证明 `expected` 是**不动点**（不是"每存一次掉一点"）。
 *   2. **生成文档**：把同一份数据渲染成 `docs/FEATURE-MATRIX.md` §4.5 的表格，
 *      并与仓库里已提交的那段逐字比对——不一致即红，逼你刷新而不是让文档漂走。
 *
 * 刷新文档：`bun run docs:vectors`（= `vitest run --mode docs-update`，见 vitest.config.ts 的注释：
 * Windows 的 cmd 不支持 `ENV=1 cmd` 语法，所以走 mode 而不是 shell 前缀）。
 *
 * 为什么这么写而不是"把测试输出直接粘进文档"：那样只能证明「此刻跑出来是这样」，
 * 不能证明「这个结果是对的」。`expected` 是人判断过的，断言的失败才是信号。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../parser';
import { serializeMarkdown } from '../../serializer';
import { createTestSchema } from '../test-utils';
import { SYNTAX_VECTORS } from './syntax-vectors';

const schema = createTestSchema();
const roundTrip = (md: string) => serializeMarkdown(parseMarkdown(schema, md));

/** 文档里这节的边界标记。生成器只替换这两个标记之间的内容。 */
const BEGIN = '<!-- syntax-matrix:begin -->';
const END = '<!-- syntax-matrix:end -->';
// 自定位到仓库根（7 层：vectors → __tests__ → markdown → tiptap → Editor → components → src → root），
// 不依赖 cwd，项目改名 / 换盘 / 从任意目录跑都不受影响。
const DOC_PATH = fileURLToPath(
  new URL('../../../../../../../docs/FEATURE-MATRIX.md', import.meta.url),
);

/** 表格单元格：压平换行、转义竖线；含反引号时改用双反引号包裹（Markdown 的标准写法）。 */
function codeCell(text: string): string {
  const flat = text.replace(/\n/g, '⏎').replace(/\|/g, '\\|');
  return flat.includes('`') ? `\`\` ${flat} \`\`` : `\`${flat}\``;
}

function textCell(text: string): string {
  return text.replace(/\n/g, ' ').replace(/\|/g, '\\|');
}

function renderSection(): string {
  const unchanged = SYNTAX_VECTORS.filter((v) => v.expected === v.input).length;
  const rewritten = SYNTAX_VECTORS.length - unchanged;

  const lines = [
    BEGIN,
    '',
    '> **本节由测试向量生成，勿手改。** 数据源：`src/components/Editor/tiptap/markdown/__tests__/vectors/syntax-vectors.ts`；',
    '> 刷新：`bun run docs:vectors`。表格里说的每一行，都在 `syntax-vectors.spec.ts` 里真跑过一遍',
    '> ——所以它说的是「编辑器确实这么做」，不是「我们希望它这么做」。',
    '>',
    '> `⏎` = 换行。「往返后」= 打开这个文件再保存一次时文本会变成什么；',
    '> **已改写** 不是 bug，是编辑器必须做的归一（原写法在内存里没有载体）。',
    '',
    '| 分组 | 语法 | 示例 | 往返后 | 已知改写 |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const v of SYNTAX_VECTORS) {
    const cell = v.expected === v.input ? '不变' : '**已改写**';
    lines.push(
      `| ${v.group} | ${textCell(v.name)} | ${codeCell(v.input)} | ${cell} | ${v.note ? textCell(v.note) : '—'} |`,
    );
  }

  lines.push(
    '',
    `合计 **${SYNTAX_VECTORS.length}** 条：原样往返 ${unchanged} 条，已知改写 ${rewritten} 条。`,
    '',
    END,
  );
  return lines.join('\n');
}

describe('Markdown 语法支持度向量表', () => {
  describe.each(SYNTAX_VECTORS.map((v) => [`${v.group} · ${v.name}`, v] as const))(
    '%s',
    (_label, vector) => {
      it('往返结果与期望一致', () => {
        expect(roundTrip(vector.input)).toBe(vector.expected);
      });

      it('二次往返稳定（期望值是不动点）', () => {
        expect(roundTrip(vector.expected)).toBe(vector.expected);
      });
    },
  );
});

describe('FEATURE-MATRIX 的语法表由向量生成', () => {
  it('已提交的生成区与向量表逐字一致', () => {
    const doc = readFileSync(DOC_PATH, 'utf8');
    const begin = doc.indexOf(BEGIN);
    const end = doc.indexOf(END);

    expect(begin, `docs/FEATURE-MATRIX.md 缺少生成区起始标记 ${BEGIN}`).toBeGreaterThan(-1);
    expect(end, `docs/FEATURE-MATRIX.md 缺少生成区结束标记 ${END}`).toBeGreaterThan(begin);

    const rendered = renderSection();
    const current = doc.slice(begin, end + END.length);

    if (process.env.SOLO_DOCS_UPDATE === '1') {
      writeFileSync(DOC_PATH, doc.slice(0, begin) + rendered + doc.slice(end + END.length), 'utf8');
      return;
    }

    expect(
      current,
      'FEATURE-MATRIX 的语法表已过期（或有人手改了它）。跑 `bun run docs:vectors` 刷新，不要手改。',
    ).toBe(rendered);
  });
});
