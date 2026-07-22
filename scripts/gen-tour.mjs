// gen-tour.mjs — 把 solo-tour.html 里引用的文件「原文」内联进 HTML。
//
// 为什么需要它：导游是纯静态 file:// 打开的 HTML，浏览器禁止它 fetch 本地文件，
// 所以「原文」不能运行时读取，只能构建时把内容嵌进 HTML（Tier 1 方案）。
// 用法： node scripts/gen-tour.mjs   （每次文档有实质改动后跑一次即可）
//
// 它做的事：
//   1. 从 HTML 的 FILES 数组里抽出每个条目的 path
//   2. 读取这些文件的真实内容（目录则生成文件树）
//   3. 注入到 HTML 中 // ===== SOURCES START / END 占位符之间
//   4. 转义 </script 防止破坏 <script> 标签
//
// 不引入任何第三方依赖，仅用 Node 内置模块。

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, '..');
const htmlPath = resolve(repoRoot, 'docs', 'solo-tour.html');

const html = readFileSync(htmlPath, 'utf8');

// 只匹配 FILES 条目：形如 { cat: "...", path: "..." }（related 里的字符串不含 cat: 前缀）
const pathRe = /cat:\s*"[^"]+",\s*path:\s*"([^"]+)"/g;
const paths = [];
let m;
while ((m = pathRe.exec(html)) !== null) paths.push(m[1]);

const MAX = 300000; // 单文件截断阈值（字符），防极端大文件撑爆 HTML
const SOURCES = {};
let missing = 0;

function listDir(root, dir) {
  const out = [];
  const walk = (d) => {
    const entries = readdirSync(d, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const en of entries) {
      const abs = resolve(d, en.name);
      const rel = relative(root, abs);
      if (en.isDirectory()) { out.push(rel + '/'); walk(abs); }
      else out.push(rel);
    }
  };
  walk(dir);
  return out.join('\n');
}

for (const p of paths) {
  const full = resolve(repoRoot, p);
  try {
    const st = statSync(full);
    if (st.isDirectory()) {
      SOURCES[p] = { dir: true, tree: listDir(repoRoot, full) };
    } else {
      let text = readFileSync(full, 'utf8');
      if (text.length > MAX) {
        text = text.slice(0, MAX) +
          `\n\n…（原文过长，已截断至 ${MAX} 字符；完整内容见右侧 GitHub 链接）`;
      }
      SOURCES[p] = { text };
    }
  } catch {
    SOURCES[p] = { missing: true };
    missing++;
  }
}

let json = JSON.stringify(SOURCES);
// 防止源文件里出现 </script> 提前关闭外层 <script> 标签
json = json.replace(/<\/script/gi, '<\\/script');

const re = /(\/\/ ===== SOURCES START[\s\S]*?\n)([\s\S]*?)(\n\s*\/\/ ===== SOURCES END)/;
if (!re.test(html)) {
  console.error('✗ 未在 HTML 中找到 SOURCES 占位符');
  process.exit(1);
}
const out = html.replace(re, (_, a, _b, c) => a + `const SOURCES = ${json};` + c);
writeFileSync(htmlPath, out);

console.log(`✓ 已内联 ${paths.length - missing} 个文件原文（${missing} 个缺失）到 ${relative(repoRoot, htmlPath)}`);
