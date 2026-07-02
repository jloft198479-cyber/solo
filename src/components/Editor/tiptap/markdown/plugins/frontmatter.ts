import type { Schema } from '@tiptap/pm/model';
import type { MarkdownParseState } from '../parser';
import type { MarkdownSerializerState, NodeSerializer } from '../serializer';
import type { MarkdownSyntaxPlugin, Preprocessor } from './index';

/**
 * 匹配 YAML frontmatter：--- 分隔，支持 CRLF 和 LF 行尾。
 * ───注意───
 * 序列化器始终输出 LF，保存后的文件统一为 LF 行尾。
 * 但打开其他编辑器创建的 CRLF 文件时同样能正确解析。
 */
const FRONTMATTER_RE = /^---(?:\r?\n)([\s\S]*?)(?:\r?\n)---(?:\r?\n)*/;

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
