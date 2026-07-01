import MarkdownIt from 'markdown-it';

let _md: MarkdownIt | null = null;

function getRenderer(): MarkdownIt {
  if (!_md) {
    _md = new MarkdownIt({ html: false, linkify: true })
      .enable(['table', 'strikethrough']);
  }
  return _md;
}

export function renderMarkdown(markdown: string): string {
  return getRenderer().render(markdown);
}
