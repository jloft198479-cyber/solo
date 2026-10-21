// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRemoteImageCacheForTests,
  __setRemoteImageFetcherForTests,
  formatImageMarkdown,
  getRemoteImageDisplaySrc,
  parseImageMarkdown,
  REMOTE_IMAGE_PLACEHOLDER,
} from '../image';
import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseHtmlSlice } from '../markdown-paste';

beforeEach(() => {
  __resetRemoteImageCacheForTests();
});

/**
 * 懒加载图入站（2026-10-21）。
 *
 * 公众号 / 知乎 / 简书 / 多数 CMS 的正文图把真地址放在 `data-src`，`src` 是 1×1 base64 占位
 * 甚至干脆没有。基类规则是 `img[src]:not([src^="data:"])` ⇒ 占位版会把「空白 SVG」写进文档
 * （落盘是一坨 base64），无 src 版直接丢图。三条用例各锁一种形态。
 */
describe('懒加载图片入站（data-src 优先）', () => {
  const schema = createTestSchema();

  const imagesOf = (html: string) => {
    const slice = parseHtmlSlice(schema, html);
    // 整段没有任何可解析内容时返回 null（例如全是占位图，被整张丢弃）
    if (!slice) return [];
    const doc = schema.nodes.doc.create(null, slice.content);
    const out: { src: unknown; alt: unknown }[] = [];
    doc.descendants((n) => {
      if (n.type.name === 'image') out.push({ src: n.attrs.src, alt: n.attrs.alt });
      return true;
    });
    return out;
  };

  it('src 是 base64 占位、真地址在 data-src → 取 data-src', () => {
    const html =
      '<p><img class="rich_pages" data-src="https://mmbiz.qpic.cn/a/640" ' +
      'data-ratio="0.66" src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="></p>';
    expect(imagesOf(html)).toEqual([{ src: 'https://mmbiz.qpic.cn/a/640', alt: null }]);
  });

  it('只有 data-src、完全没有 src → 也要接住（默认规则会整张丢掉）', () => {
    expect(imagesOf('<p><img data-src="https://cdn.example.com/b.png"></p>')).toEqual([
      { src: 'https://cdn.example.com/b.png', alt: null },
    ]);
  });

  it('普通网络图与 alt 不受影响（回归：别把正常路径改坏）', () => {
    expect(imagesOf('<p><img src="https://example.com/c.png" alt="图注"></p>')).toEqual([
      { src: 'https://example.com/c.png', alt: '图注' },
    ]);
  });

  // ── 边界（2026-10-21 复审 §五，5 条全是真实粘贴形态）──
  it('data-src 是 data: 占位、src 有真地址 → 取 src（占位不许顶掉真图）', () => {
    expect(
      imagesOf(
        '<p><img data-src="data:image/png;base64,AAAA" src="https://cdn.example.com/a.png"></p>',
      ),
    ).toEqual([{ src: 'https://cdn.example.com/a.png', alt: null }]);
  });

  it('data-src 是相对路径、src 是绝对地址 → 取绝对（相对路径跨文档必然失效）', () => {
    expect(imagesOf('<p><img data-src="./a.png" src="https://cdn.example.com/a.png"></p>')).toEqual([
      { src: 'https://cdn.example.com/a.png', alt: null },
    ]);
  });

  /**
   * 安全：协议相对地址必须归一成 https。
   * 不归一的后果不是显示问题——`isRemoteImageSrc` 只认 http(s)，`//` 会被判成本地地址、
   * 原始串直接交给 `<img>`，WebView2 按当前源补全并自行请求，绕过 Rust 抓取的 SSRF
   * 白名单（M-16，见 `syncView` 注释）。
   */
  it('data-src="//…" 归一成 https:（堵 M-16 的旁路）', () => {
    expect(imagesOf('<p><img data-src="//cdn.example.com/a.png"></p>')).toEqual([
      { src: 'https://cdn.example.com/a.png', alt: null },
    ]);
  });

  it('data-src 为空且没有 src → 不造空图片节点（否则落盘是 ![]()）', () => {
    expect(imagesOf('<p><img data-src=""></p>')).toEqual([]);
    expect(imagesOf('<p><img data-src="   "></p>')).toEqual([]);
  });

  it('只剩 data: 占位、没有可用地址 → 整张丢弃（不把 base64 写进文档）', () => {
    expect(imagesOf('<p><img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="></p>')).toEqual([]);
    expect(
      imagesOf('<p><img data-src="data:image/png;base64,AAAA" src="blob:https://x/y"></p>'),
    ).toEqual([]);
  });
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

  it('caches failures briefly and falls back to a safe placeholder (never the raw remote URL)', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network failed');
    });
    __setRemoteImageFetcherForTests(fetcher);

    // ⚠️ 绝不退回原始远程 URL：那会让 WebView2 绕过 Rust 的 SSRF 白名单（M-16）
    await expect(getRemoteImageDisplaySrc('https://example.com/missing.png'))
      .resolves.toBe(REMOTE_IMAGE_PLACEHOLDER);
    await expect(getRemoteImageDisplaySrc('https://example.com/missing.png'))
      .resolves.toBe(REMOTE_IMAGE_PLACEHOLDER);
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
