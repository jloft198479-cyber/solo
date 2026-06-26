import type { Schema } from '@tiptap/pm/model';
import type { MarkdownParseState } from '../parser';
import type { MarkdownSerializerState, NodeSerializer } from '../serializer';
import type { MarkdownSyntaxPlugin, Preprocessor } from './index';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n*/;

interface FrontmatterData {
  raw: string;
}

const frontmatterPreprocessor: (schema: Schema) => Preprocessor<FrontmatterData> = (_schema) => ({
  name: 'frontmatter',
  preprocess({ content }) {
    const match = content.match(FRONTMATTER_RE);
    if (!match) {
      return { content, data: { raw: '' } };
    }
    const raw = match[1];
    const stripped = content.slice(match[0].length);
    return { content: stripped, data: { raw } };
  },
  beforeParse(state: MarkdownParseState, data: FrontmatterData) {
    if (!data.raw) return;
    const frontmatterNode = state.schema.nodes.frontmatter;
    if (!frontmatterNode) return;
    const textNode = state.schema.text(data.raw);
    state.top.content.push(frontmatterNode.create(null, [textNode]));
  },
});

const frontmatterSerializer: Record<string, NodeSerializer> = {
  frontmatter(state: MarkdownSerializerState, node) {
    state.writeLine('---');
    state.writeLine(node.textContent);
    state.writeLine('---');
    state.closeBlock(node);
  },
};

export const frontmatterMarkdownPlugin: MarkdownSyntaxPlugin = {
  name: 'frontmatter',
  preprocessor: frontmatterPreprocessor,
  nodeSerializers: frontmatterSerializer,
};
