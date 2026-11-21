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
/** 承诺文档里「会被统一」那张表的标记（只列 expected ≠ input 的条目）。 */
const PROMISE_BEGIN = '<!-- rewrite-list:begin -->';
const PROMISE_END = '<!-- rewrite-list:end -->';
// 自定位到仓库根（7 层：vectors → __tests__ → markdown → tiptap → Editor → components → src → root），
// 不依赖 cwd，项目改名 / 换盘 / 从任意目录跑都不受影响。
const DOC_PATH = fileURLToPath(
  new URL('../../../../../../../docs/FEATURE-MATRIX.md', import.meta.url),
);
const PROMISE_PATH = fileURLToPath(
  new URL('../../../../../../../docs/FIDELITY-PROMISE.md', import.meta.url),
);

/**
 * 表格单元格：去掉段末换行（那是噪点，不是信息）、压平中间换行、转义竖线；
 * 含反引号时改用双反引号包裹（Markdown 的标准写法）。
 */
function codeCell(text: string): string {
  const trimmed = text.replace(/\n+$/, '');
  const flat = trimmed.replace(/\n/g, '⏎').replace(/\|/g, '\\|');
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

/**
 * 承诺文档里「会被统一」那张表：只列往返后文本真的会变的条目。
 * 与 FEATURE-MATRIX 的表格同源——**不许手抄一份**，否则新加向量时它必漂。
 */
function renderRewriteTable(): string {
  const rewritten = SYNTAX_VECTORS.filter((v) => v.expected !== v.input);
  const lines = [
    PROMISE_BEGIN,
    '',
    '| 你写的 | 存完变成 | 说明 |',
    '| --- | --- | --- |',
  ];
  for (const v of rewritten) {
    lines.push(
      `| ${codeCell(v.input)} | ${codeCell(v.expected)} | ${textCell(v.note ?? '写法统一为标准形式')} |`,
    );
  }
  lines.push('', PROMISE_END);
  return lines.join('\n');
}

/** 校验（或刷新）一个生成区：文档里那段必须与渲染结果逐字相同。 */
function checkGeneratedSection(
  filePath: string,
  begin: string,
  end: string,
  rendered: string,
  label: string,
): void {
  const doc = readFileSync(filePath, 'utf8');
  const start = doc.indexOf(begin);
  const finish = doc.indexOf(end);

  expect(start, `${label} 缺少生成区起始标记 ${begin}`).toBeGreaterThan(-1);
  expect(finish, `${label} 缺少生成区结束标记 ${end}`).toBeGreaterThan(start);

  const current = doc.slice(start, finish + end.length);

  if (process.env.SOLO_DOCS_UPDATE === '1') {
    writeFileSync(
      filePath,
      doc.slice(0, start) + rendered + doc.slice(finish + end.length),
      'utf8',
    );
    return;
  }

  expect(
    current,
    `${label} 已过期（或有人手改了它）。跑 \`bun run docs:vectors\` 刷新，不要手改。`,
  ).toBe(rendered);
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

describe('生成区与向量表一致', () => {
  it('FEATURE-MATRIX 的语法表', () => {
    checkGeneratedSection(
      DOC_PATH,
      BEGIN,
      END,
      renderSection(),
      'docs/FEATURE-MATRIX.md 的语法表',
    );
  });

  it('FIDELITY-PROMISE 的「会被统一」清单', () => {
    checkGeneratedSection(
      PROMISE_PATH,
      PROMISE_BEGIN,
      PROMISE_END,
      renderRewriteTable(),
      'docs/FIDELITY-PROMISE.md 的改写清单',
    );
  });
});
