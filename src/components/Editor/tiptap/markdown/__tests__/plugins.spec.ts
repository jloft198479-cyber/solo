import { describe, expect, it } from 'vitest';
import Token from 'markdown-it/lib/token.mjs';
import { createMarkdownCompatSchema } from '../compat-schema';
import { MarkdownParseState } from '../parser';
import {
  getPluginFenceHandlers,
  getPluginNodeSerializers,
  getPluginPreprocessors,
  getPluginTokenHandlers,
  getPluginTokenInterceptors,
  markdownSyntaxPlugins,
} from '../plugins';

describe('markdown syntax plugin registry', () => {
  const schema = createMarkdownCompatSchema();

  it('keeps feature plugins registered in preprocessing order', () => {
    expect(markdownSyntaxPlugins.map((plugin) => plugin.name)).toEqual([
      'frontmatter',
      'footnote',
      'callout',
      'math',
      'mermaid',
      'wikilink',
    ]);
  });

  it('aggregates parser and serializer hooks from plugins', () => {
    expect(getPluginPreprocessors(schema)).toHaveLength(1); // frontmatter
    expect(getPluginFenceHandlers(schema)).toHaveLength(2); // math + mermaid
    expect(getPluginTokenInterceptors(schema)).toHaveLength(1); // callout
    expect(Object.keys(getPluginTokenHandlers(schema)).sort()).toEqual([
      'footnote_anchor',
      'footnote_block_close',
      'footnote_block_open',
      'footnote_close',
      'footnote_open',
      'footnote_ref',
      'math_block',
      'math_inline',
      'text',
    ]);
    expect(Object.keys(getPluginNodeSerializers()).sort()).toEqual([
      'callout',
      'footnoteDef',
      'footnoteRef',
      'footnoteSection',
      'frontmatter',
      'mathBlock',
      'mathInline',
      'mermaidBlock',
      'wikilink',
    ]);
  });

  it('routes mermaid fences through the plugin fence handler', () => {
    const fenceHandlers = getPluginFenceHandlers(schema);
    const state = new MarkdownParseState(schema);
    const token = new Token('fence', 'code', 0);

    // math handler 在注册表首位（插件顺序），对 mermaid 语言应放行（false）
    expect(fenceHandlers[0](state, token, 'mermaid', 'graph TD;\nA-->B')).toBe(false);
    // mermaid handler 接管
    expect(fenceHandlers[1](state, token, 'mermaid', 'graph TD;\nA-->B')).toBe(true);
    expect(state.top.content[0]?.type.name).toBe('mermaidBlock');
    expect(state.top.content[0]?.textContent).toBe('graph TD;\nA-->B');
  });
});
