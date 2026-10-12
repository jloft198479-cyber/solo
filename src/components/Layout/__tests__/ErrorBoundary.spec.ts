// @vitest-environment happy-dom
// 测试需要「抛错子组件 + 挂载根」两个桩组件，豁免单文件单组件规则
/* eslint-disable vue/one-component-per-file */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { defineComponent, h, createApp, ref, nextTick } from 'vue';
import ErrorBoundary from '../ErrorBoundary.vue';

/**
 * 挂载 ErrorBoundary，子组件在 shouldThrow 置真后抛出 throwFactory() 的返回值
 * （用工厂是为了模拟「抛出普通对象」这类非 Error 异常）。
 */
function mountBoundary(throwFactory: () => unknown) {
  const shouldThrow = ref(false);
  const Child = defineComponent({
    setup() {
      return () => {
        if (shouldThrow.value) throw throwFactory();
        return h('div', 'ok');
      };
    },
  });

  const el = document.createElement('div');
  document.body.appendChild(el);
  // 根组件负责把 Child 作为默认插槽放进 ErrorBoundary
  const app = createApp({
    setup() {
      return () => h(ErrorBoundary, null, { default: () => h(Child) });
    },
  });
  app.mount(el);

  return {
    shouldThrow,
    unmount: () => {
      app.unmount();
      document.body.removeChild(el);
    },
  };
}

async function fallback() {
  await nextTick();
  await nextTick();
  return document.querySelector('.error-boundary-fallback') as HTMLElement | null;
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('普通对象异常提取 message，绝不渲染 [object Object]', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = mountBoundary(() => ({ code: 'TAURI_UNAVAILABLE', message: '环境不可用' }));

    ctx.shouldThrow.value = true;
    const box = await fallback();

    expect(box).toBeTruthy();
    expect(box?.getAttribute('role')).toBe('alert');
    expect(box?.querySelector('.error-boundary-detail')?.textContent).toBe('环境不可用');
    expect(box?.textContent).not.toContain('[object Object]');
    expect(box?.querySelector('.error-boundary-copy')?.textContent).toContain('复制错误详情');

    ctx.unmount();
  });

  it('无 message 的对象异常显示友好兜底文案', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = mountBoundary(() => ({ code: 'WEIRD' }));

    ctx.shouldThrow.value = true;
    const box = await fallback();

    expect(box?.querySelector('.error-boundary-detail')?.textContent).toBe(
      '未知错误，详情已记录到控制台',
    );

    ctx.unmount();
  });

  it('Error 实例显示其 message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = mountBoundary(() => new Error('组件炸了'));

    ctx.shouldThrow.value = true;
    const box = await fallback();

    expect(box?.querySelector('.error-boundary-detail')?.textContent).toBe('组件炸了');

    ctx.unmount();
  });

  it('复制详情：循环引用对象安全序列化，并给出已复制反馈', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    const circular: Record<string, unknown> = { code: 'LOOP' };
    circular.self = circular;
    const ctx = mountBoundary(() => circular);

    ctx.shouldThrow.value = true;
    const box = (await fallback()) as HTMLElement;

    (box.querySelector('.error-boundary-copy') as HTMLButtonElement).click();
    await Promise.resolve();
    await nextTick();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain('"self": "[Circular]"');
    expect(box.querySelector('.error-boundary-copy')?.textContent).toBe('已复制');

    ctx.unmount();
    vi.unstubAllGlobals();
  });

  it('点重试后子树恢复渲染，兜底页消失', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = mountBoundary(() => new Error('临时故障'));

    ctx.shouldThrow.value = true;
    expect(await fallback()).toBeTruthy();

    // 故障解除后再重试
    ctx.shouldThrow.value = false;
    (document.querySelector('.error-boundary-retry') as HTMLButtonElement).click();
    // 两帧：boundary 切回 slot 一帧，子组件重新挂载一帧
    await nextTick();
    await nextTick();

    expect(document.querySelector('.error-boundary-fallback')).toBeNull();

    ctx.unmount();
  });
});
