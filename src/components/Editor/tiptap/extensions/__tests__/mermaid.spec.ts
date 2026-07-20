/**
 * Mermaid 错误处理单测
 *
 * 验证 buildMermaidErrorMessage 在“中文/全角标签解析失败”时给出引号提示，
 * 普通英文标签或非解析类错误则不加提示（避免误报）。
 */
import { describe, it, expect } from 'vitest';
import { buildMermaidErrorMessage } from '../mermaid-block';

describe('buildMermaidErrorMessage', () => {
  it('普通英文标签解析错误：不加引号提示', () => {
    const src = 'graph TD\n  A-->B';
    const msg = buildMermaidErrorMessage(src, new Error('Parse error on line 2'));
    expect(msg).toContain('图表语法错误');
    expect(msg).not.toContain('引号');
  });

  it('含中文标签解析错误：追加引号提示', () => {
    const src = 'graph TD\n  A-->中文节点';
    const msg = buildMermaidErrorMessage(src, new Error('Parse error on line 2'));
    expect(msg).toContain('图表语法错误');
    expect(msg).toContain('引号');
    expect(msg).toContain('A["文本"]');
  });

  it('含中文但非解析类错误：不加提示', () => {
    const src = 'graph TD\n  A-->中文';
    const msg = buildMermaidErrorMessage(src, new Error('some other failure'));
    expect(msg).not.toContain('引号');
  });

  it('非 Error 对象（字符串）也能处理并给出提示', () => {
    const msg = buildMermaidErrorMessage('中文标签 graph LR', 'Parse error on line 1');
    expect(msg).toContain('图表语法错误');
    expect(msg).toContain('引号');
  });

  it('全角符号标签解析失败：也给出提示', () => {
    const src = 'graph LR\n  Ａ－－＞Ｂ';
    const msg = buildMermaidErrorMessage(src, new Error('Syntax error'));
    expect(msg).toContain('引号');
  });
});
