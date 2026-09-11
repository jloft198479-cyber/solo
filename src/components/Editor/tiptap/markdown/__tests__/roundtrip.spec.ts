/**
 * Markdown ↔ PM Doc round-trip 测试
 *
 * 验证：md → parseMarkdown → serializeMarkdown → md'，md' === md
 * 这些测试不依赖 DOM/Editor（纯 schema + parser + serializer）。
 */
import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { parseMarkdown } from '../parser';
import { serializeMarkdown, serializeMarkdownForClipboard } from '../serializer';
import { createTestSchema, roundTrip, normalize } from './test-utils';

// ── 基础 round-trip 测试 ─────────────────────────────────────

describe('Round-trip: parse → serialize', () => {
  describe('Phase A: bold / italic / strike', () => {
    it('bold', () => {
      expect(roundTrip('**hello**\n')).toBe(normalize('**hello**\n'));
    });

    it('italic', () => {
      expect(roundTrip('*hello*\n')).toBe(normalize('*hello*\n'));
    });

    it('strike', () => {
      expect(roundTrip('~~hello~~\n')).toBe(normalize('~~hello~~\n'));
    });

    it('nested bold + italic', () => {
      expect(roundTrip('**a *b* c**\n')).toBe(normalize('**a *b* c**\n'));
    });

    it('nested strike + bold (mark order normalized by PM schema)', () => {
      // PM 按 schema 定义顺序排列同范围 mark：bold 在 strike 外层
      expect(roundTrip('~~**hello**~~\n')).toBe(normalize('**~~hello~~**\n'));
    });

    it('multiple marks in sequence', () => {
      expect(roundTrip('**bold** then *italic* then ~~strike~~\n'))
        .toBe(normalize('**bold** then *italic* then ~~strike~~\n'));
    });

    describe('Phase A2: mark + trailing punctuation edge cases', () => {
      // 中文标点
      it('bold with trailing Chinese comma at paragraph end', () => {
        expect(roundTrip('**沉浸式体验，**\n')).toBe(normalize('**沉浸式体验，**\n'));
      });
      it('bold with trailing Chinese period at paragraph end', () => {
        expect(roundTrip('**沉浸式体验。**\n')).toBe(normalize('**沉浸式体验。**\n'));
      });
      it('bold with trailing Chinese question at paragraph end', () => {
        expect(roundTrip('**沉浸式体验？**\n')).toBe(normalize('**沉浸式体验？**\n'));
      });
      it('bold with trailing Chinese exclamation at paragraph end', () => {
        expect(roundTrip('**沉浸式体验！**\n')).toBe(normalize('**沉浸式体验！**\n'));
      });
      it('bold with trailing Chinese colon at paragraph end', () => {
        expect(roundTrip('**沉浸式体验：**\n')).toBe(normalize('**沉浸式体验：**\n'));
      });
      it('bold with trailing Chinese semicolon at paragraph end', () => {
        expect(roundTrip('**沉浸式体验；**\n')).toBe(normalize('**沉浸式体验；**\n'));
      });
      it('bold with trailing Chinese ellipsis at paragraph end', () => {
        expect(roundTrip('**沉浸式体验……**\n')).toBe(normalize('**沉浸式体验……**\n'));
      });

      // 英文标点
      it('bold with trailing period at paragraph end', () => {
        expect(roundTrip('**hello world.**\n')).toBe(normalize('**hello world.**\n'));
      });
      it('bold with trailing comma at paragraph end', () => {
        expect(roundTrip('**hello, world,**\n')).toBe(normalize('**hello, world,**\n'));
      });
      it('bold with trailing exclamation at paragraph end', () => {
        expect(roundTrip('**hello!**\n')).toBe(normalize('**hello!**\n'));
      });
      it('bold with trailing question at paragraph end', () => {
        expect(roundTrip('**hello?**\n')).toBe(normalize('**hello?**\n'));
      });

      // 非段落末尾（后接文本）——通过 preprocessor 插入 ZWNJ 使关闭符 + 内容正确
      // ZWNJ 在序列化时被剥离，roundtrip 输出干净
      it('bold with Chinese punctuation followed by more text', () => {
        expect(roundTrip('**沉浸式体验，**继续\n')).toBe(normalize('**沉浸式体验，**继续\n'));
      });
      // 显式 ZWNJ 也会被剥离
      it('bold with Chinese punctuation followed by more text (ZWNJ workaround)', () => {
        expect(roundTrip('**沉浸式体验，\u200C**继续\n')).toBe(normalize('**沉浸式体验，**继续\n'));
      });

      // italic 同理
      it('italic with Chinese punctuation followed by more text', () => {
        expect(roundTrip('*沉浸式体验，*继续\n')).toBe(normalize('*沉浸式体验，*继续\n'));
      });
      it('italic with Chinese punctuation followed by more text (ZWNJ workaround)', () => {
        expect(roundTrip('*沉浸式体验，\u200C*继续\n')).toBe(normalize('*沉浸式体验，*继续\n'));
      });
      // Unicode 符号标点也统一处理
      it('italic with Unicode symbol at boundary', () => {
        expect(roundTrip('*hello™*world\n')).toBe(normalize('*hello™*world\n'));
      });
      // bold + italic 混合标记
      it('bold-italic with Chinese punctuation followed by more text', () => {
        expect(roundTrip('***你好，***继续\n')).toBe(normalize('***你好，***继续\n'));
      });
      it('bold-italic with Chinese punctuation followed by more text (ZWNJ workaround)', () => {
        expect(roundTrip('***你好，\u200C***继续\n')).toBe(normalize('***你好，***继续\n'));
      });
      it('italic with Chinese punctuation at paragraph end', () => {
        expect(roundTrip('*沉浸式体验，*\n')).toBe(normalize('*沉浸式体验，*\n'));
      });
      it('strike with Chinese punctuation at paragraph end', () => {
        expect(roundTrip('~~沉浸式体验，~~\n')).toBe(normalize('~~沉浸式体验，~~\n'));
      });
      it('highlight with Chinese punctuation at paragraph end', () => {
        expect(roundTrip('==沉浸式体验，==\n')).toBe(normalize('==沉浸式体验，==\n'));
      });

      // 混合 mark + 标点
      it('bold italic mixed with Chinese punctuation', () => {
        expect(roundTrip('**粗体 *斜体* 混合，**\n')).toBe(normalize('**粗体 *斜体* 混合，**\n'));
      });
      it('bold with Chinese punctuation and closing parenthesis', () => {
        expect(roundTrip('**（沉浸式体验），**\n')).toBe(normalize('**（沉浸式体验），**\n'));
      });

      // 加粗内容包含引号
      it('bold with Chinese quotes inside', () => {
        expect(roundTrip('**他说“你好”**\n')).toBe(normalize('**他说“你好”**\n'));
      });

      // 多段落
      it('bold with Chinese punctuation across paragraphs', () => {
        const md = '**第一段，**\n\n**第二段。**\n';
        expect(roundTrip(md)).toBe(normalize(md));
      });
    });

    describe('Phase A3: ZWNJ 预处理不进入代码区', () => {
      const codeWithPunct = '```python\n# 说明：「**参数**」必填\nx = 1\n```\n';

      // 断言解析后的 doc 本身不含 ZWNJ：只测往返会被序列化侧的剥离兜底掩盖
      it('围栏代码块解析后不含零宽字符', () => {
        const doc = parseMarkdown(createTestSchema(), codeWithPunct);
        expect(doc.textContent.includes('\u200C')).toBe(false);
      });

      it('行内 code span 解析后不含零宽字符', () => {
        const doc = parseMarkdown(createTestSchema(), '写作时用 `「**加粗**」` 包裹。\n');
        expect(doc.textContent.includes('\u200C')).toBe(false);
      });

      it('代码区往返保真', () => {
        expect(roundTrip(codeWithPunct)).toBe(normalize(codeWithPunct));
      });

      it('代码内容里的存量 ZWNJ 在序列化时被清洗', () => {
        const dirty = '```\n「\u200C**参数**」\n```\n';
        expect(roundTrip(dirty)).toBe(normalize('```\n「**参数**」\n```\n'));
      });

      it('正文的 CJK 边界修正不受影响', () => {
        expect(roundTrip('嘿**「注意**\n')).toBe(normalize('嘿**「注意**\n'));
      });
    });
  });

  describe('headings', () => {
    it('parses heading as semantic inline content without marker nodes', () => {
      const schema = createTestSchema();
      const doc = parseMarkdown(schema, '## Hello\n');
      const heading = doc.firstChild;

      expect(heading?.type.name).toBe('heading');
      expect(heading?.attrs.level).toBe(2);
      expect(heading?.firstChild?.isText).toBe(true);
      expect(heading?.textContent).toBe('Hello');
    });

    it('heading', () => {
      expect(roundTrip('## Hello\n')).toBe(normalize('## Hello\n'));
    });

    it('heading with bold', () => {
      expect(roundTrip('## **Bold heading**\n')).toBe(normalize('## **Bold heading**\n'));
    });
  });

  describe('other marks', () => {
    it('inline code', () => {
      expect(roundTrip('`code`\n')).toBe(normalize('`code`\n'));
    });

    it('inline math', () => {
      expect(roundTrip('$E = mc^2$\n')).toBe(normalize('$E = mc^2$\n'));
    });

    it('highlight', () => {
      expect(roundTrip('==highlight==\n')).toBe(normalize('==highlight==\n'));
    });

    it('link', () => {
      expect(roundTrip('[text](https://example.com)\n'))
        .toBe(normalize('[text](https://example.com)\n'));
    });

    it('wikilink', () => {
      expect(roundTrip('See [[Roadmap]] and [[Project Alpha|Alpha]].\n'))
        .toBe(normalize('See [[Roadmap]] and [[Project Alpha|Alpha]].\n'));
    });

    it('superscript', () => {
      expect(roundTrip('^sup^\n')).toBe(normalize('^sup^\n'));
    });

    it('subscript', () => {
      expect(roundTrip('~sub~\n')).toBe(normalize('~sub~\n'));
    });

    it('dim', () => {
      expect(roundTrip('这是<span class="mk-dim">变浅文字</span>结尾\n')).toBe(
        normalize('这是<span class="mk-dim">变浅文字</span>结尾\n'),
      );
    });

    it('dim 内容含尖括号：文本语义保真且序列化幂等', () => {
      const schema = createTestSchema();
      // 解析后尖括号是 dim 内的普通字符，序列化为 \< \> 保真转义（不被当 HTML 结构）
      const doc1 = parseMarkdown(schema, 'a<span class="mk-dim">x < b 且 c > d</span>z\n');
      const first = serializeMarkdown(doc1);
      // 重 parse 后文档文本不变、mark 不丢
      const doc2 = parseMarkdown(schema, first);
      expect(serializeMarkdown(doc2)).toBe(first);
    });

    it('裸 </span> 文本不被误当 dim 闭合', () => {
      // 未配对的开 tag 不产生 dim，裸 </span> 作为普通文本被转义序列化
      const md = '文本 </span> 结尾\n';
      const doc = parseMarkdown(createTestSchema(), md);
      // 不产生 dim mark，保留为纯文本
      expect(JSON.stringify(doc)).not.toContain('mk-dim');
    });
  });

  describe('block contexts', () => {
    it('bold in list item', () => {
      expect(roundTrip('- **bold item**\n')).toBe(normalize('- **bold item**\n'));
    });

    it('block math', () => {
      const md = '$$\n\\begin{aligned}\nd_{i, j} &\\leftarrow d_{i, j} + 1 \\\\\nd_{i, y + 1} &\\leftarrow d_{i, y + 1} - 1 \\\\\nd_{x + 1, j} &\\leftarrow d_{x + 1, j} - 1 \\\\\nd_{x + 1, y + 1} &\\leftarrow d_{x + 1, y + 1} + 1\n\\end{aligned}\n$$\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });

    it('mermaid block', () => {
      const md = '```mermaid\ngraph TD\n  A --> B\n```\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });

    it('inline image', () => {
      const md = '![doocs](https://cdn-doocs.oss-cn-shenzhen.aliyuncs.com/gh/doocs/md/images/logo-2.png)\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });

    it('inline image with size syntax keeps width/height', () => {
      const md = '![封面|100x200](assets/a.png)\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });

    it('bold in blockquote', () => {
      expect(roundTrip('> **bold quote**\n')).toBe(normalize('> **bold quote**\n'));
    });

    it('plain paragraph', () => {
      expect(roundTrip('hello world\n')).toBe(normalize('hello world\n'));
    });

    it('horizontal rule', () => {
      expect(roundTrip('---\n')).toBe(normalize('---\n'));
    });

    it('table cell hard break as br', () => {
      const md = '| A | B |\n| --- | --- |\n| line1<br>line2 | ok |\n';
      // <br> 在 html:false 模式下是字面文本，序列化时 < > 会被转义
      expect(roundTrip(md)).toBe(
        normalize('| A                | B   |\n| ---------------- | --- |\n| line1\\<br\\>line2 | ok  |\n'),
      );
    });
  });

  describe('Phase B: highlight / superscript / subscript nesting', () => {
    it('highlight with bold inside', () => {
      expect(roundTrip('==**bold highlight**==\n')).toBe(normalize('**==bold highlight==**\n'));
    });

    it('multiple superscripts', () => {
      expect(roundTrip('^2^+^3^\n')).toBe(normalize('^2^+^3^\n'));
    });

    it('subscript in list item', () => {
      expect(roundTrip('- H~2~O\n')).toBe(normalize('- H~2~O\n'));
    });

    it('highlight in blockquote', () => {
      expect(roundTrip('> ==important==\n')).toBe(normalize('> ==important==\n'));
    });

    it('dim 与 bold 嵌套：mark 不丢失且 roundtrip 幂等', () => {
      // mark 顺序会被 PM 规范化（同 highlight+bold），故不断言精确顺序，
      // 只验证 dim mark 未被丢弃 + 二次 roundtrip 稳定。
      const first = roundTrip('**<span class="mk-dim">变浅加粗</span>**\n');
      expect(first).toContain('mk-dim');
      expect(roundTrip(first)).toBe(first);
    });
  });

  describe('Phase C: inline code', () => {
    it('code in list item', () => {
      expect(roundTrip('- `code item`\n')).toBe(normalize('- `code item`\n'));
    });

    it('code in blockquote', () => {
      expect(roundTrip('> `code quote`\n')).toBe(normalize('> `code quote`\n'));
    });

    it('code does not nest with bold (excludes)', () => {
      expect(roundTrip('`code **not bold**`\n')).toBe(normalize('`code **not bold**`\n'));
    });
  });

  describe('Phase D: link tokens', () => {
    it('link with title', () => {
      expect(roundTrip('[text](https://example.com "title")\n'))
        .toBe(normalize('[text](https://example.com "title")\n'));
    });

    it('link with bold inside (PM normalizes bold outside link)', () => {
      expect(roundTrip('[**bold link**](https://example.com)\n'))
        .toBe(normalize('**[bold link](https://example.com)**\n'));
    });

    it('link in list item', () => {
      expect(roundTrip('- [link](https://example.com)\n'))
        .toBe(normalize('- [link](https://example.com)\n'));
    });

    it('link in blockquote', () => {
      expect(roundTrip('> [link](https://example.com)\n'))
        .toBe(normalize('> [link](https://example.com)\n'));
    });
  });

  describe('edge cases', () => {
    it('empty document', () => {
      const result = roundTrip('');
      expect(result.trim()).toBe('');
    });

    it('multiple paragraphs', () => {
      const md = 'first\n\nsecond\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });

    it('escapes literal markdown punctuation', () => {
      const schema = createTestSchema();
      const paragraph = schema.nodes.paragraph.create(null, [
        schema.text('literal [text] (paren) *star* ~tilde~ ^sup^ ==mark== !bang|pipe`tick`'),
      ]);
      const doc = schema.nodes.doc.create(null, [paragraph]);

      expect(serializeMarkdown(doc))
        .toBe(normalize('literal \\[text\\] \\(paren\\) \\*star\\* \\~tilde\\~ \\^sup\\^ \\=\\=mark\\=\\= !bang\\|pipe\\`tick\\`\n'));
    });

    it('escapes dollar sign and curly braces and angle brackets', () => {
      const schema = createTestSchema();
      const paragraph = schema.nodes.paragraph.create(null, [
        schema.text('cost $5 {key} <tag> end'),
      ]);
      const doc = schema.nodes.doc.create(null, [paragraph]);

      expect(serializeMarkdown(doc))
        .toBe(normalize('cost \\$5 \\{key\\} \\<tag\\> end\n'));
    });

    it('escapes line-start hash to prevent heading misparse', () => {
      const schema = createTestSchema();
      const paragraph = schema.nodes.paragraph.create(null, [
        schema.text('#hashtag not a heading'),
      ]);
      const doc = schema.nodes.doc.create(null, [paragraph]);

      expect(serializeMarkdown(doc))
        .toBe(normalize('\\#hashtag not a heading\n'));
    });

    it('escapes line-start dash to prevent list misparse', () => {
      const schema = createTestSchema();
      const paragraph = schema.nodes.paragraph.create(null, [
        schema.text('-5 degrees'),
      ]);
      const doc = schema.nodes.doc.create(null, [paragraph]);

      expect(serializeMarkdown(doc))
        .toBe(normalize('\\-5 degrees\n'));
    });

    it('escapes line-start plus to prevent list misparse', () => {
      const schema = createTestSchema();
      const paragraph = schema.nodes.paragraph.create(null, [
        schema.text('+5 offset'),
      ]);
      const doc = schema.nodes.doc.create(null, [paragraph]);

      expect(serializeMarkdown(doc))
        .toBe(normalize('\\+5 offset\n'));
    });

    it('does not escape dash in middle of text', () => {
      const schema = createTestSchema();
      const paragraph = schema.nodes.paragraph.create(null, [
        schema.text('mid-dash here'),
      ]);
      const doc = schema.nodes.doc.create(null, [paragraph]);

      expect(serializeMarkdown(doc))
        .toBe(normalize('mid-dash here\n'));
    });

    it('escapes quoted link titles', () => {
      const md = '[text](https://example.com "say \\"hi\\"")\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });
  });

  // 图片/链接地址保真（丢图 bug 回归锁）：
  // 含空格文件名必须用尖括号形式落盘；中文路径的百分号编码必须解码还原；
  // 字面 % 与成对括号不得被误改。
  describe('image/link destination fidelity', () => {
    function parseFirstImageSrc(md: string): string | null {
      const schema = createTestSchema();
      const doc = parseMarkdown(schema, md);
      let src: string | null = null;
      doc.descendants((node) => {
        if (node.type.name === 'image') src = node.attrs.src as string;
        return src === null;
      });
      return src;
    }

    it('含空格文件名：序列化用尖括号，重开解析回原始 src（丢图回归锁）', () => {
      const schema = createTestSchema();
      const doc = parseMarkdown(
        schema,
        '![alt](assets/Pasted image 1757123456789.png)\n',
      );
      // 旧行为：解析不出 image 节点，整段退化成字面文本
      const src = parseFirstImageSrc('![alt](<assets/Pasted image 1757123456789.png>)\n');
      expect(src).toBe('assets/Pasted image 1757123456789.png');

      // 编辑器内直接拖入建的节点（src 带空格）序列化必须落盘为尖括号形式
      const image = schema.nodes.image.create({
        src: 'assets/Pasted image 1757123456789.png',
        alt: 'alt',
      });
      const doc2 = schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, [image]),
      ]);
      const serialized = serializeMarkdown(doc2);
      expect(serialized).toBe(
        normalize('![alt](<assets/Pasted image 1757123456789.png>)\n'),
      );
      // 落盘产物重新解析，src 不变 → 重开不丢图
      expect(parseFirstImageSrc(serialized)).toBe('assets/Pasted image 1757123456789.png');
      expect(doc.childCount).toBe(1);
    });

    it('中文路径：磁盘上的百分号编码解码还原，零编辑不再误标脏', () => {
      expect(parseFirstImageSrc('![a](assets/%E5%9B%BE%E7%89%87%E4%B8%80.png)\n')).toBe(
        'assets/图片一.png',
      );
    });

    it('中文路径原文往返保真（不再被改写成编码）', () => {
      const md = '![alt](assets/图片一.png)\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });

    it('成对括号文件名保持既有转义形式往返', () => {
      const md = '![alt](assets/cover\\(1\\).png)\n';
      expect(roundTrip(md)).toBe(normalize(md));
      expect(parseFirstImageSrc(md)).toBe('assets/cover(1).png');
    });

    it('文件名里的字面 % 不被误解（纯 ASCII 编码保持原样）', () => {
      expect(parseFirstImageSrc('![a](assets/100%25real.png)\n')).toBe('assets/100%25real.png');
      expect(roundTrip('![a](assets/100%25real.png)\n')).toBe(
        normalize('![a](assets/100%25real.png)\n'),
      );
    });

    it('远程 URL 的合法百分号编码不被解码', () => {
      const md = '![a](https://cdn.example.com/img%20b/%E5%9B%BE.png)\n';
      // 含非 ASCII 解码产物 → 采用解码值；再次序列化时因含空格转尖括号，重解析仍保真
      const src = parseFirstImageSrc(md);
      expect(src).toBe('https://cdn.example.com/img b/图.png');
      expect(roundTrip('![a](<https://cdn.example.com/img b/图.png>)\n')).toBe(
        normalize('![a](<https://cdn.example.com/img b/图.png>)\n'),
      );
    });

    it('链接 href 含空格同样走尖括号形式', () => {
      const schema = createTestSchema();
      const link = schema.marks.link.create({ href: 'assets/my doc notes.md' });
      const doc = schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, [schema.text('目标', [link])]),
      ]);
      const serialized = serializeMarkdown(doc);
      expect(serialized).toBe(normalize('[目标](<assets/my doc notes.md>)\n'));
      expect(roundTrip(serialized)).toBe(normalize(serialized));
    });
  });

  describe('callout', () => {
    it('callout with default type', () => {
      expect(roundTrip('> [!note]\n> hello\n')).toBe(normalize('> [!NOTE]\n> hello\n'));
    });

    it('callout with warning type', () => {
      expect(roundTrip('> [!warning]\n> be careful\n')).toBe(normalize('> [!WARNING]\n> be careful\n'));
    });

    it('callout with info type', () => {
      expect(roundTrip('> [!info]\n> some info\n')).toBe(normalize('> [!INFO]\n> some info\n'));
    });

    it('callout with nested bullet list', () => {
      const md = '> [!NOTE]\n> - item 1\n> - item 2\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });

    it('callout with nested code block', () => {
      const md = '> [!TIP]\n> ```js\n> console.log("hello");\n> ```\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });

    it('callout with nested table', () => {
      const md = '> [!WARNING]\n> | a   | b   |\n> | --- | --- |\n> | 1   | 2   |\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });

    it('callout with horizontal rule', () => {
      const md = '> [!TIP]\n> text before\n>\n> ---\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });

    it('callout with multi-paragraph content', () => {
      const md = '> [!NOTE]\n> first para\n>\n> second para\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });

    it('callout double roundtrip is idempotent', () => {
      const md = '> [!NOTE]\n> - item 1\n> - item 2\n';
      const once = roundTrip(md);
      expect(roundTrip(once)).toBe(once);
    });
  });

  describe('frontmatter', () => {
    it('parses and serializes YAML frontmatter', () => {
      const md = '---\ntitle: Hello\ncreated: 2025-01-01\n---\n\nbody text\n';
      expect(roundTrip(md)).toBe(normalize('---\ntitle: Hello\ncreated: 2025-01-01\n---\n\nbody text\n'));
    });

    it('frontmatter preserves multiple lines', () => {
      const md = '---\ntitle: My Document\ntags: [a, b, c]\ndraft: true\n---\n\nContent here\n';
      expect(roundTrip(md)).toBe(normalize('---\ntitle: My Document\ntags: [a, b, c]\ndraft: true\n---\n\nContent here\n'));
    });
  });

  describe('footnotes', () => {
    it('single footnote', () => {
      const md = 'Here is text[^1]\n\n[^1]: the footnote\n';
      expect(roundTrip(md)).toBe(normalize('Here is text[^1]\n\n[^1]: the footnote\n'));
    });

    it('multiple footnotes', () => {
      const md = 'First[^1] and second[^2]\n\n[^1]: First footnote\n\n[^2]: Second footnote\n';
      expect(roundTrip(md)).toBe(normalize('First[^1] and second[^2]\n\n[^1]: First footnote\n\n[^2]: Second footnote\n'));
    });

    it('footnote with rich text', () => {
      const md = 'Ref[^1]\n\n[^1]: **bold** and *italic* in footnote\n';
      expect(roundTrip(md)).toBe(normalize('Ref[^1]\n\n[^1]: **bold** and *italic* in footnote\n'));
    });
  });

  describe('table round-trip with inline marks', () => {
    it('bold in table cell', () => {
      const md = '| A | B |\n| --- | --- |\n| **bold** | plain |\n';
      expect(roundTrip(md)).toBe(
        normalize('| A        | B     |\n| -------- | ----- |\n| **bold** | plain |\n'),
      );
    });

    it('italic in table cell', () => {
      const md = '| A | B |\n| --- | --- |\n| *em* | plain |\n';
      expect(roundTrip(md)).toBe(
        normalize('| A    | B     |\n| ---- | ----- |\n| *em* | plain |\n'),
      );
    });

    it('inline code in table cell', () => {
      const md = '| A | B |\n| --- | --- |\n| `code` | plain |\n';
      expect(roundTrip(md)).toBe(
        normalize('| A      | B     |\n| ------ | ----- |\n| `code` | plain |\n'),
      );
    });

    it('mixed marks across cells', () => {
      const md = '| **a** | *b* | `c` |\n| --- | --- | --- |\n| x | y | z |\n';
      expect(roundTrip(md)).toBe(
        normalize('| **a** | *b* | `c` |\n| ----- | --- | --- |\n| x     | y   | z   |\n'),
      );
    });
  });

  // ── P2 格式兼容修复（B1/B2/B4/B6/B7/B8，2026-09-06） ─────────────
  describe('P2 format compatibility fixes', () => {
    function docHasItalic(schema: Schema, md: string): boolean {
      const doc = parseMarkdown(schema, md);
      let hasItalic = false;
      doc.descendants((n) => {
        if (n.marks.some((m) => m.type.name === 'italic')) hasItalic = true;
        return !hasItalic;
      });
      return hasItalic;
    }

    function codeSpanText(schema: Schema, md: string): string | null {
      const doc = parseMarkdown(schema, md);
      let text: string | null = null;
      doc.descendants((n) => {
        if (n.isText && n.marks.some((m) => m.type.name === 'code')) {
          text = n.text ?? '';
          return false;
        }
        return true;
      });
      return text;
    }

    // B1：文件模式字面 `_` 转义
    describe('B1: literal underscore escaping (file mode)', () => {
      it('字面 `snake \\_case\\_` 保存重开不变成斜体', () => {
        const schema = createTestSchema();
        const md = 'snake \\_case\\_ 词\n';
        expect(docHasItalic(schema, md)).toBe(false);
        const out = serializeMarkdown(parseMarkdown(schema, md));
        // 保存产物重新打开后仍是字面文本，不被解释为斜体
        expect(docHasItalic(schema, out)).toBe(false);
      });

      it('字面 `_word_`（空格包围）保存重开不变成斜体', () => {
        const schema = createTestSchema();
        const md = '前缀 \\_word\\_ 后缀\n';
        const out = serializeMarkdown(parseMarkdown(schema, md));
        expect(docHasItalic(schema, out)).toBe(false);
      });

      it('intraword snake_case_var 不被转义（文件字节干净）', () => {
        const schema = createTestSchema();
        const para = schema.nodes.paragraph.create(null, [
          schema.text('use snake_case_var here'),
        ]);
        const doc = schema.nodes.doc.create(null, [para]);
        expect(serializeMarkdown(doc)).toBe('use snake_case_var here\n');
      });

      it('intraword 中文_下划线 不被转义', () => {
        const schema = createTestSchema();
        const para = schema.nodes.paragraph.create(null, [
          schema.text('中文_下划线_变量'),
        ]);
        const doc = schema.nodes.doc.create(null, [para]);
        expect(serializeMarkdown(doc)).toBe('中文_下划线_变量\n');
      });
    });

    // B2：clipboard 模式转义补 `_ ~ [ ] < >`
    describe('B2: clipboard escaping covers _~[]<>', () => {
      it('字面 ~~text~~ / [见附录] / <tag> 出站被转义', () => {
        const schema = createTestSchema();
        const para = schema.nodes.paragraph.create(null, [
          schema.text('a ~~text~~ b [见附录] c <tag> d'),
        ]);
        const doc = schema.nodes.doc.create(null, [para]);
        expect(serializeMarkdownForClipboard(doc)).toBe(
          'a \\~\\~text\\~\\~ b \\[见附录\\] c \\<tag\\> d\n',
        );
      });

      it('字面 _word_（空格包围）出站被转义，intraword 不转义', () => {
        const schema = createTestSchema();
        const para = schema.nodes.paragraph.create(null, [
          schema.text('a _word_ snake_case_var'),
        ]);
        const doc = schema.nodes.doc.create(null, [para]);
        expect(serializeMarkdownForClipboard(doc)).toBe(
          'a \\_word\\_ snake_case_var\n',
        );
      });

      it('出站转义产物在 solo parser 下还原为字面文本', () => {
        const schema = createTestSchema();
        const out = serializeMarkdownForClipboard(
          schema.nodes.doc.create(null, [
            schema.nodes.paragraph.create(null, [
              schema.text('a ~~text~~ b [见附录] c <tag> d _word_'),
            ]),
          ]),
        );
        const doc = parseMarkdown(schema, out);
        const text = doc.textContent;
        expect(text).toBe('a ~~text~~ b [见附录] c <tag> d _word_');
      });
    });

    // B4：有序列表第 10 项起子列表缩进
    describe('B4: ordered list item 10+ sublist indent', () => {
      it('第 10 项的子列表缩进按 marker 宽度（4）对齐，重开不脱离', () => {
        const schema = createTestSchema();
        const lines: string[] = [];
        for (let i = 1; i <= 10; i++) lines.push(`${i}. 项${i}`);
        const md = lines.join('\n') + '\n    - 子项\n';
        const doc = parseMarkdown(schema, md);
        const ol = doc.firstChild;
        expect(ol?.type.name).toBe('orderedList');
        // 第 10 项内含子列表
        const item10 = ol?.lastChild;
        expect(item10?.childCount).toBe(2);
        expect(item10?.lastChild?.type.name).toBe('bulletList');
        // 序列化后子列表缩进 4 空格（`10. ` marker 宽）
        const out = serializeMarkdown(doc);
        expect(out).toContain('\n    - 子项');
        // 落盘产物重新解析，子列表仍在第 10 项内
        const doc2 = parseMarkdown(schema, out);
        const ol2 = doc2.firstChild;
        expect(ol2?.lastChild?.lastChild?.type.name).toBe('bulletList');
        // 双向稳定
        expect(roundTrip(out)).toBe(normalize(out));
      });

      it('第 1-9 项的子列表缩进维持 3 空格不变', () => {
        // 多块列表项序列化为 loose 形式（块间空行）是既有行为，此处只锁缩进
        expect(roundTrip('1. 项1\n   - 子项\n')).toBe(
          normalize('1. 项1\n\n   - 子项\n'),
        );
      });

      it('bullet / task 列表的子列表缩进维持现状（3 空格）', () => {
        expect(roundTrip('- 项\n   - 子项\n')).toBe(normalize('- 项\n\n   - 子项\n'));
        expect(roundTrip('- [x] 任务\n   - 子项\n')).toBe(
          normalize('- [x] 任务\n\n   - 子项\n'),
        );
      });
    });

    // B6：行内代码首尾空格
    describe('B6: code span leading/trailing space padding', () => {
      it('首尾各一空格：双空格 padding 保真', () => {
        const schema = createTestSchema();
        const para = schema.nodes.paragraph.create(null, [
          schema.text(' x ', [schema.marks.code.create()]),
        ]);
        const doc = schema.nodes.doc.create(null, [para]);
        const out = serializeMarkdown(doc);
        expect(out).toBe('`  x  `\n');
        // 落盘产物重新解析，code 文本仍是 ' x '
        expect(codeSpanText(schema, out)).toBe(' x ');
      });

      it('单端空格：无需 padding 直接保真', () => {
        const schema = createTestSchema();
        const mk = (t: string) => schema.text(t, [schema.marks.code.create()]);
        const doc = (t: string) =>
          schema.nodes.doc.create(null, [
            schema.nodes.paragraph.create(null, [mk(t)]),
          ]);
        expect(serializeMarkdown(doc('x '))).toBe('`x `\n');
        expect(serializeMarkdown(doc(' x'))).toBe('` x`\n');
      });

      it('全空格内容：CommonMark 不剥，原样保真', () => {
        const schema = createTestSchema();
        const para = schema.nodes.paragraph.create(null, [
          schema.text(' ', [schema.marks.code.create()]),
        ]);
        const doc = schema.nodes.doc.create(null, [para]);
        expect(serializeMarkdown(doc)).toBe('` `\n');
        expect(codeSpanText(schema, '` `\n')).toBe(' ');
      });
    });

    // B7：mermaid / math 块围栏升级
    describe('B7: mermaid/math fence upgrade', () => {
      it('mermaid 内容含独立 ``` 行时围栏升级，重开不损坏', () => {
        const schema = createTestSchema();
        const content = 'graph TD\n  A --> B\n```\nB --> C';
        const node = schema.nodes.mermaidBlock.create(null, [schema.text(content)]);
        const doc = schema.nodes.doc.create(null, [node]);
        const out = serializeMarkdown(doc);
        expect(out).toBe('````mermaid\ngraph TD\n  A --> B\n```\nB --> C\n````\n');
        // 落盘产物重新解析，类型与内容保真
        const doc2 = parseMarkdown(schema, out);
        expect(doc2.firstChild?.type.name).toBe('mermaidBlock');
        expect(doc2.firstChild?.textContent).toBe(content);
      });

      it('mermaid 无围栏冲突时维持 3 反引号现状', () => {
        expect(roundTrip('```mermaid\ngraph TD\n  A --> B\n```\n')).toBe(
          normalize('```mermaid\ngraph TD\n  A --> B\n```\n'),
        );
      });

      it('math 块内容含 $$ 时改用 fence 形式落盘，重开保真', () => {
        const schema = createTestSchema();
        const latex = 'a = b\n$$\nc = d';
        const node = schema.nodes.mathBlock.create(null, [schema.text(latex)]);
        const doc = schema.nodes.doc.create(null, [node]);
        const out = serializeMarkdown(doc);
        expect(out).toBe('```math\na = b\n$$\nc = d\n```\n');
        const doc2 = parseMarkdown(schema, out);
        expect(doc2.firstChild?.type.name).toBe('mathBlock');
        expect(doc2.firstChild?.textContent).toBe(latex);
      });

      it('math 块无 $$ 时维持 Obsidian 兼容的 $$ 形式', () => {
        expect(roundTrip('$$\nE = mc^2\n$$\n')).toBe(normalize('$$\nE = mc^2\n$$\n'));
      });
    });

    // B8：含反斜杠的链接 destination
    describe('B8: backslash link destination fidelity', () => {
      it('Windows 路径 href 还原为原始反斜杠形式，roundtrip 保真', () => {
        const schema = createTestSchema();
        const md = '[笔记](C:\\notes\\a.md)\n';
        const doc = parseMarkdown(schema, md);
        let href = '';
        doc.descendants((n) => {
          for (const m of n.marks) {
            if (m.type.name === 'link') href = m.attrs.href as string;
          }
          return true;
        });
        expect(href).toBe('C:\\notes\\a.md');
        const out = serializeMarkdown(doc);
        expect(out).toBe('[笔记](C:\\notes\\a.md)\n');
        expect(roundTrip(out)).toBe(normalize(out));
      });

      it('含反斜杠的图片 src 同样保真', () => {
        const schema = createTestSchema();
        const md = '![图](assets\\sub\\图.png)\n';
        const doc = parseMarkdown(schema, md);
        let src = '';
        doc.descendants((n) => {
          if (n.type.name === 'image') src = n.attrs.src as string;
          return true;
        });
        expect(src).toBe('assets\\sub\\图.png');
        const out = serializeMarkdown(doc);
        expect(roundTrip(out)).toBe(normalize(out));
      });
    });

    // B5：表格列宽东亚对齐
    describe('B5: table column width East Asian alignment', () => {
      it('含中文单元格的列宽按显示宽度计算（宽字符记 2，非 UTF-16 长度）', () => {
        const md = '| 名称 | 说明 |\n| --- | --- |\n| 短 | 中文说明文字 |\n';
        const out = roundTrip(md);
        // col0: max('名称'=4, 3, '短'=2)=4；col1: max('说明'=4, 3, '中文说明文字'=12)=12
        expect(out).toBe(
          '| 名称 | 说明         |\n' +
          '| ---- | ------------ |\n' +
          '| 短   | 中文说明文字 |\n',
        );
      });

      it('纯 ASCII 表格字节不变（visualWidth 与 length 等价）', () => {
        const md = '| Name | Desc |\n| --- | --- |\n| a | longer cell |\n';
        const out = roundTrip(md);
        expect(out).toBe(
          '| Name | Desc        |\n' +
          '| ---- | ----------- |\n' +
          '| a    | longer cell |\n',
        );
      });
    });

    // B10：callout 标题/折叠标记建模
    describe('B10: callout title & fold marker fidelity', () => {
      it('> [!NOTE]+ 标题：折叠标记与标题 roundtrip 保真', () => {
        const md = '> [!NOTE]+ 快速备注\n> 内容段落\n';
        expect(roundTrip(md)).toBe(normalize(md));
      });

      it('> [!WARNING]- 标题：默认折叠标记保真', () => {
        const md = '> [!WARNING]- 归档说明\n> 内容段落\n';
        expect(roundTrip(md)).toBe(normalize(md));
      });

      it('> [!TIP] 纯标题（无折叠标记）保真，标题不再混入正文', () => {
        const md = '> [!TIP] 小技巧\n> 内容段落\n';
        expect(roundTrip(md)).toBe(normalize(md));
        const schema = createTestSchema();
        const doc = parseMarkdown(schema, md);
        const callout = doc.firstChild;
        expect(callout?.type.name).toBe('callout');
        expect(callout?.attrs.title).toBe('小技巧');
        expect(callout?.attrs.fold).toBeNull();
        expect(callout?.textContent).toBe('内容段落');
      });

      it('> [!NOTE]+ 仅折叠标记无标题保真', () => {
        const md = '> [!NOTE]+\n> 内容段落\n';
        expect(roundTrip(md)).toBe(normalize(md));
      });

      it('无标题无标记维持现状字节（回归锁）', () => {
        const md = '> [!NOTE]\n> 内容段落\n';
        expect(roundTrip(md)).toBe(normalize(md));
      });

      it('callout 内空行序列化不带尾随空格（> 而非 > 空格）', () => {
        const md = '> [!NOTE]\n> 第一段\n>\n> 第二段\n';
        const out = roundTrip(md);
        expect(out).toBe('> [!NOTE]\n> 第一段\n>\n> 第二段\n');
        expect(out).not.toContain('> \n');
      });
    });
  });
});
