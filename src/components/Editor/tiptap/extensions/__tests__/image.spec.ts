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
    expect(formatImageMarkdown({ src: '/demo.png', alt: 'demo', title: null }))
      .toBe('![demo](/demo.png)');
  });

  it('formats image markdown with title', () => {
    expect(formatImageMarkdown({ src: '/demo.png', alt: 'demo', title: 'cover' }))
      .toBe('![demo](/demo.png "cover")');
  });
});

describe('parseImageMarkdown', () => {
  it('parses image markdown without title', () => {
    expect(parseImageMarkdown('![demo](/demo.png)')).toEqual({
      src: '/demo.png',
      alt: 'demo',
      title: null,
    });
  });

  it('parses image markdown with title', () => {
    expect(parseImageMarkdown('![demo](/demo.png "cover")')).toEqual({
      src: '/demo.png',
      alt: 'demo',
      title: 'cover',
    });
  });

  it('returns null for invalid markdown', () => {
    expect(parseImageMarkdown('not image markdown')).toBe(null);
    expect(parseImageMarkdown('![]()')).toBe(null);
  });
});

describe('getRemoteImageDisplaySrc', () => {
  it('deduplicates pending requests for the same remote URL', async () => {
    const fetcher = vi.fn(async () => 'data:image/png;base64,demo');
    __setRemoteImageFetcherForTests(fetcher);

    const results = await Promise.all([
      getRemoteImageDisplaySrc('https://example.com/demo.png'),
      getRemoteImageDisplaySrc('https://example.com/demo.png'),
    ]);

    // 两个请求返回同一个值（dedup）
    expect(results[0]).toBe(results[1]);
    // fetcher 只被调用一次
    expect(fetcher).toHaveBeenCalledTimes(1);
    // 返回值是 blob URL（base64 data URL 已转换为 Blob URL）
    expect(results[0]).toMatch(/^blob:/);
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
});
