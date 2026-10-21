import { describe, expect, it } from 'vitest';
import { countLocalImages } from '../localImages';

/**
 * 本地图片计数（复制出站提示用）。
 *
 * 判据只关心「外部目标拿不到」：无 scheme 的路径算本地；`http(s):` / `data:` / `blob:`
 * 都不算（前者能直接访问，后者是内联数据）。
 */
describe('countLocalImages', () => {
  it('相对路径算本地', () => {
    expect(countLocalImages('![图](./assets/a.png)')).toBe(1);
    expect(countLocalImages('![图](assets/a.png)')).toBe(1);
  });

  it('无 scheme 的绝对路径也算本地（Windows 盘符 / POSIX 都算）', () => {
    expect(countLocalImages('![图](/home/u/a.png)')).toBe(1);
    expect(countLocalImages('![图](D:/pics/a.png)')).toBe(1);
  });

  it('带尺寸后缀的 solo 语法照样能数', () => {
    expect(countLocalImages('![图注|200x100](./a.png)')).toBe(1);
  });

  it('带 title 的图片只数一次', () => {
    expect(countLocalImages('![图](./a.png "封面")')).toBe(1);
  });

  it('远程图 / 内联图不算', () => {
    expect(countLocalImages('![a](https://example.com/a.png)')).toBe(0);
    expect(countLocalImages('![a](http://example.com/a.png)')).toBe(0);
    expect(countLocalImages('![a](data:image/png;base64,AAA)')).toBe(0);
    expect(countLocalImages('![a](blob:https://x/y)')).toBe(0);
    expect(countLocalImages('![a](//cdn.example.com/a.png)')).toBe(0);
  });

  it('普通链接不算图片', () => {
    expect(countLocalImages('[文档](./a.md)')).toBe(0);
    expect(countLocalImages('[说明](https://example.com)')).toBe(0);
  });

  it('混合文档计数准确', () => {
    const md = [
      '# 标题',
      '![本地1](./a.png) 与 ![远程](https://example.com/b.png)',
      '',
      '![本地2|300x200](./img/c.jpg "说明")',
      '',
      '正文里的 `![不是图片](x.png)` 在行内代码里也按图片语法计数（宁可多提醒一次）',
    ].join('\n');
    expect(countLocalImages(md)).toBe(3);
  });

  it('没有图片返回 0', () => {
    expect(countLocalImages('纯文字，没有任何图片。')).toBe(0);
    expect(countLocalImages('')).toBe(0);
  });
});
