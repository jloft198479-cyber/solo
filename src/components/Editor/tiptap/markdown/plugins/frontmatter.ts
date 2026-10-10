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
export const FRONTMATTER_RE = /^---(?:\r?\n)([\s\S]*?)(?:\r?\n)---(?:\r?\n)*/;

interface FrontmatterData {
  /** 分隔符之间的原文（可为空串） */
  raw: string;
  /** 正则**是否命中**。必须与 raw 分开记：空 YAML 头（`---\n\n---`）也是「命中且 raw 为空」，
   *  与「未命中」在 raw 上无法区分，混同就会把已切掉的两个 `---` 整块丢掉（台账 §一 #49）。 */
  matched: boolean;
}

const frontmatterPreprocessor: (schema: Schema) => Preprocessor<FrontmatterData> = (_schema) => ({
  name: 'frontmatter',
  preprocess({ content }) {
    const match = content.match(FRONTMATTER_RE);
    if (!match) {
      return { content, data: { raw: '', matched: false } };
    }
    const raw = match[1];
    const stripped = content.slice(match[0].length);
    return { content: stripped, data: { raw, matched: true } };
  },
  beforeParse(state: MarkdownParseState, data: FrontmatterData) {
    if (!data.matched) return;
    const frontmatterNode = state.schema.nodes.frontmatter;
    if (!frontmatterNode) return;
    // 空头也**必须建节点**：preprocess 已经把这两个 `---` 从 content 里切走了，
    // 不建节点它们就凭空消失（`---\n\n---\n正文` 曾只剩 `正文`）。
    // frontmatter 的 content 是 `text*`，故空头给空 content（不要造空 text 节点）。
    const content = data.raw ? [state.schema.text(data.raw)] : [];
    state.top.content.push(frontmatterNode.create(null, content));
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
