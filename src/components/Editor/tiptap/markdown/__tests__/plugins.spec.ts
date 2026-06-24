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
      'callout',
      'math',
      'mermaid',
      'wikilink',
    ]);
  });

  it('aggregates parser and serializer hooks from plugins', () => {
    expect(getPluginPreprocessors(schema)).toHaveLength(0);
    expect(getPluginFenceHandlers(schema)).toHaveLength(1);
    expect(getPluginTokenInterceptors(schema)).toHaveLength(1); // callout
    expect(Object.keys(getPluginTokenHandlers(schema)).sort()).toEqual([
      'math_block',
      'math_inline',
      'text',
    ]);
    expect(Object.keys(getPluginNodeSerializers()).sort()).toEqual([
      'callout',
      'mathBlock',
      'mathInline',
      'mermaidBlock',
      'wikilink',
    ]);
  });

  it('routes mermaid fences through the plugin fence handler', () => {
    const [fenceHandler] = getPluginFenceHandlers(schema);
    const state = new MarkdownParseState(schema);
    const token = new Token('fence', 'code', 0);

    expect(fenceHandler(state, token, 'mermaid', 'graph TD;\nA-->B')).toBe(true);
    expect(state.top.content[0]?.type.name).toBe('mermaidBlock');
    expect(state.top.content[0]?.textContent).toBe('graph TD;\nA-->B');
  });
});
