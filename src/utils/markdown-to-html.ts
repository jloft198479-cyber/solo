import MarkdownIt from 'markdown-it';
import markdownItTaskLists from 'markdown-it-task-lists';
import markdownItMark from 'markdown-it-mark';
import markdownItSub from 'markdown-it-sub';
import markdownItSup from 'markdown-it-sup';
import markdownItTexmath from 'markdown-it-texmath';
import markdownItFootnote from 'markdown-it-footnote';

let _md: MarkdownIt | null = null;

function getRenderer(): MarkdownIt {
  if (!_md) {
    _md = new MarkdownIt({ html: false, linkify: true })
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
  return getRenderer().render(markdown);
}
