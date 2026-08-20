import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../markdown-to-html';

/**
 * renderMarkdown（对外富文本渲染）的「剥私有、保通用」降级测试。
 *
 * solo 私有元素（如文字变浅 `<span class="mk-dim">…</span>`）只被 solo 认识，
 * 直接渲染会转义成乱码。渲染前须剥壳保干净；通用格式（粗体/斜体/标题等）须保留。
 */
describe('renderMarkdown 对外降级清洗', () => {
  it('文字变浅剥壳、只留内层文字，不出转义乱码', () => {
    expect(renderMarkdown('这是<span class="mk-dim">变浅文字</span>结尾'))
      .toBe('<p>这是变浅文字结尾</p>\n');
  });

  it('变浅内层换行( <br> )剥成换行', () => {
    expect(renderMarkdown('<span class="mk-dim">a<br>b</span>'))
      .toBe('<p>a\nb</p>\n');
  });

  it('变浅与加粗嵌套：只剥变浅、保留加粗', () => {
    expect(renderMarkdown('**<span class="mk-dim">变浅加粗</span>**'))
      .toBe('<p><strong>变浅加粗</strong></p>\n');
  });

  it('通用格式（粗体/斜体/标题/列表）不受影响', () => {
    const html = renderMarkdown('# 标题\n\n这是**粗体**和*斜体*\n\n- 甲\n- 乙');
    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<strong>粗体</strong>');
    expect(html).toContain('<em>斜体</em>');
    expect(html).toContain('<li>甲</li>');
  });

  it('无私有元素时输出与原逻辑一致（不误伤通用 Markdown）', () => {
    expect(renderMarkdown('普通段落')).toBe('<p>普通段落</p>\n');
  });
});