// @vitest-environment happy-dom
/**
 * 代码字体栈（--font-mono）出口锁。
 *
 * 防的事故（台账 §二 #67）：出站 HTML（复制全文）里 mermaid / math 源码块的
 * 等宽字体曾硬编码为 `ui-monospace, SFMono-Regular, Menlo, monospace`，
 * 与编辑器用的 `--font-mono` 漂移 ⇒ 外部消费者看到的代码字体与编辑器不一致。
 * 现统一走 resolveMonoFontStack()（运行时读 CSS 变量，读不到回落常量）。
 *
 * 「回落常量与 CSS 不漂移」由 font-scope.spec.ts 锁；这里锁 resolver 自身行为。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MONO_FALLBACK_STACK, resolveMonoFontStack } from '../fontStack';

describe('resolveMonoFontStack', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--font-mono');
  });

  it('读不到 CSS 变量时回落 MONO_FALLBACK_STACK', () => {
    expect(resolveMonoFontStack()).toBe(MONO_FALLBACK_STACK);
  });

  it('能读到运行时 --font-mono 时用它的值（真理源在 CSS）', () => {
    document.documentElement.style.setProperty('--font-mono', 'X-mono, monospace');
    expect(resolveMonoFontStack()).toBe('X-mono, monospace');
  });
});
