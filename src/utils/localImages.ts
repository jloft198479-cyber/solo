/**
 * 本地图片识别（复制出站提示用，2026-10-21）。
 *
 * 为什么需要：本地图片（`./assets/a.png`）在 solo 里能正常显示，但所有外部目标都拿不到
 * ——公众号要你先上传素材库、网页编辑器要可访问的 URL。用户不知道这一点就会以为图丢了。
 * 复制后给一次提示，比让他对着裂图猜要省事。
 *
 * 判据只看「有没有 scheme」：`http(s):` 与 `assets:` 等带 scheme 的一律不算本地；
 * `data:` / `blob:` 也是 scheme，同样不算（它们在外部目标里至少能显示或本来就不该出现）。
 */
const MD_IMAGE_RE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)/g;
/**
 * scheme 至少两个字符：单字母 + 冒号是 Windows 盘符（`D:/pics/a.png`），不是 scheme。
 * 真实 scheme（http/https/data/blob/assets）都 ≥2 字符，不会误伤。
 */
const HAS_SCHEME_RE = /^(?:[a-z][a-z0-9+.-]+:|\/\/)/i;

/** 统计 Markdown 源码里的本地图片数量 */
export function countLocalImages(markdown: string): number {
  let count = 0;
  for (const match of markdown.matchAll(MD_IMAGE_RE)) {
    const src = match[1];
    if (!src || HAS_SCHEME_RE.test(src)) continue;
    count++;
  }
  return count;
}
