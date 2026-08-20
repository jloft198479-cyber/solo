import MarkdownIt from 'markdown-it';
import markdownItTaskLists from 'markdown-it-task-lists';
import markdownItMark from 'markdown-it-mark';
import markdownItSub from 'markdown-it-sub';
import markdownItSup from 'markdown-it-sup';
import markdownItTexmath from 'markdown-it-texmath';
import markdownItFootnote from 'markdown-it-footnote';

let _md: MarkdownIt | null = null;

/**
 * 对外渲染前的私有格式降级清洗（「剥私有、保通用」）。
 *
 * solo 私有元素（如 `文字变浅` `<span class="mk-dim">…</span>`）只在 solo 内被认识，
 * 渲染出的 HTML 对外复制/粘贴时会变成一串转义乱码（`&lt;span…&gt;`），粘到
 * Notion/公众号等外部富文本就是火腿肠乱码。
 *
 * 最大兼容性策略：渲染前把私有标签剥掉、只留内层文字；内部的 `<br>` 换行保持为
 * 换行。粗体/标题/列表等通用格式不受影响，照常渲染成标准 HTML 带走。
 *
 * 注意：这里是「对外展示」降级，不影响编辑器内部的 mk-dim 显示与 markdown 源文本。
 */
const PRIVATE_TAG_RE = /<span class="mk-dim">(.*?)<\/span>/g;

function sanitizeForExternal(markdown: string): string {
  return markdown
    .replace(PRIVATE_TAG_RE, (_, inner) => inner.replace(/<br>/g, '\n'));
}

function getRenderer(): MarkdownIt {
  if (!_md) {
    // linkify:false 与编辑器内解析器(markdown/parser.ts)保持一致：
    // 裸 URL 不自动转链接，保证「编辑器所见」与「复制出的 HTML」行为一致。
    _md = new MarkdownIt({ html: false, linkify: false })
      .enable(['table', 'strikethrough']);

    _md.use(markdownItTaskLists, { enabled: true, label: false });
    _md.use(markdownItMark);
    _md.use(markdownItSub);
    _md.use(markdownItSup);
    _md.use(markdownItTexmath, {
      engine: { renderToString: (latex: string) => latex },
      delimiters: 'dollars',
    });
    _md.use(markdownItFootnote);
  }
  return _md;
}

export function renderMarkdown(markdown: string): string {
  return getRenderer().render(sanitizeForExternal(markdown));
}
