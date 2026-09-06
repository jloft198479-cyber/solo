import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRemoteImageCacheForTests,
  __setRemoteImageFetcherForTests,
  formatImageMarkdown,
  getRemoteImageDisplaySrc,
  parseImageMarkdown,
} from '../image';

beforeEach(() => {
  __resetRemoteImageCacheForTests();
});

describe('formatImageMarkdown', () => {
  it('formats image markdown without title', () => {
    expect(formatImageMarkdown({ src: '/demo.png', alt: 'demo', title: null, width: null, height: null }))
      .toBe('![demo](/demo.png)');
  });

  it('formats image markdown with title', () => {
    expect(formatImageMarkdown({ src: '/demo.png', alt: 'demo', title: 'cover', width: null, height: null }))
      .toBe('![demo](/demo.png "cover")');
  });

  it('formats image markdown with dimensions', () => {
    expect(formatImageMarkdown({ src: '/demo.png', alt: 'demo', title: null, width: 640, height: 480 }))
      .toBe('![demo|640x480](/demo.png)');
  });

  it('formats image markdown with dimensions and title', () => {
    expect(formatImageMarkdown({ src: '/demo.png', alt: 'demo', title: 'cover', width: 800, height: 600 }))
      .toBe('![demo|800x600](/demo.png "cover")');
  });
});

describe('parseImageMarkdown', () => {
  it('parses image markdown without title', () => {
    expect(parseImageMarkdown('![demo](/demo.png)')).toEqual({
      src: '/demo.png',
      alt: 'demo',
      title: null,
      width: null,
      height: null,
    });
  });

  it('parses image markdown with title', () => {
    expect(parseImageMarkdown('![demo](/demo.png "cover")')).toEqual({
      src: '/demo.png',
      alt: 'demo',
      title: 'cover',
      width: null,
      height: null,
    });
  });

  it('parses image markdown with dimensions', () => {
    expect(parseImageMarkdown('![demo|640x480](/demo.png)')).toEqual({
      src: '/demo.png',
      alt: 'demo',
      title: null,
      width: 640,
      height: 480,
    });
  });

  it('parses image markdown with dimensions and title', () => {
    expect(parseImageMarkdown('![demo|800x600](/demo.png "cover")')).toEqual({
      src: '/demo.png',
      alt: 'demo',
      title: 'cover',
      width: 800,
      height: 600,
    });
  });

  it('ignores invalid dimension suffix', () => {
    expect(parseImageMarkdown('![demo|0x0](/demo.png)')).toEqual({
      src: '/demo.png',
      alt: 'demo|0x0',
      title: null,
      width: null,
      height: null,
    });
  });

  it('returns null for invalid markdown', () => {
    expect(parseImageMarkdown('not image markdown')).toBe(null);
    expect(parseImageMarkdown('![]()')).toBe(null);
  });
});

describe('getRemoteImageDisplaySrc', () => {
  it('deduplicates pending requests for the same remote URL', async () => {
    const fetcher = vi.fn(async () => 'asset://localhost/remote-image-cache/demo.png');
    __setRemoteImageFetcherForTests(fetcher);

    const results = await Promise.all([
      getRemoteImageDisplaySrc('https://example.com/demo.png'),
      getRemoteImageDisplaySrc('https://example.com/demo.png'),
    ]);

    // 两个请求返回同一个值（dedup）
    expect(results[0]).toBe(results[1]);
    // fetcher 只被调用一次
    expect(fetcher).toHaveBeenCalledTimes(1);
    // #4 之后 fetcher 返回 asset URL，直接透传缓存（C8 已删 blob 转换路径）
    expect(results[0]).toBe('asset://localhost/remote-image-cache/demo.png');
  });

  it('limits concurrent remote image requests', async () => {
    const resolvers: Array<() => void> = [];
    const fetcher = vi.fn(
      (src: string) =>
        new Promise<string>((resolve) => {
          resolvers.push(() => {
            resolve(`data:${src}`);
          });
        }),
    );
    __setRemoteImageFetcherForTests(fetcher);

    const urls = Array.from({ length: 6 }, (_, index) => `https://example.com/${index}.png`);
    const requests = urls.map((url) => getRemoteImageDisplaySrc(url));

    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(4);

    resolvers.splice(0, 4).forEach((resolve) => {
      resolve();
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(6);

    resolvers.splice(0).forEach((resolve) => {
      resolve();
    });
    await expect(Promise.all(requests)).resolves.toEqual(urls.map((url) => `data:${url}`));
  });

  it('caches failures briefly and falls back to the original URL', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network failed');
    });
    __setRemoteImageFetcherForTests(fetcher);

    await expect(getRemoteImageDisplaySrc('https://example.com/missing.png'))
      .resolves.toBe('https://example.com/missing.png');
    await expect(getRemoteImageDisplaySrc('https://example.com/missing.png'))
      .resolves.toBe('https://example.com/missing.png');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('enforces an entry-count LRU cap (C8: 真兜底替代恒不触发的 50MB 假预算)', async () => {
    // 逐个拉取 502 个不同 URL（并发上限 4，串行等待避免抖动），缓存条目应封顶 500
    const fetcher = vi.fn(async (src: string) => `asset://localhost/${src.length}.png`);
    __setRemoteImageFetcherForTests(fetcher);

    for (let i = 0; i < 502; i++) {
      await getRemoteImageDisplaySrc(`https://example.com/img-${i}.png`);
    }

    // 最老的条目被 LRU 淘汰，最新条目仍在缓存（再次请求不触发 fetcher）
    const before = fetcher.mock.calls.length;
    await getRemoteImageDisplaySrc('https://example.com/img-501.png');
    expect(fetcher.mock.calls.length).toBe(before);
    // 早期条目已被驱逐：重新请求会再次命中 fetcher
    await getRemoteImageDisplaySrc('https://example.com/img-0.png');
    expect(fetcher.mock.calls.length).toBe(before + 1);
  });
});
