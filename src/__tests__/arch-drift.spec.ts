/**
 * 架构文档 ⇄ 代码漂移自动锁。
 *
 * **我防的是哪个已发生的事故**（新建锁准入 ①，见 docs/agent-playbook.md §C）：
 * - 2026-10-13 全量核对发现三处「只同步了代码、没同步文档」的漂移：
 *   ① `ARCHITECTURE.md` §4.2 命令表 26 条 vs `lib.rs::generate_handler!` 28 条（会话记忆两条没回灌）；
 *   ② §8.3 扩展清单漏 4 项（`ListFold` / `ListItem.extend` / `ListBackspaceGuard` / `CellContentGuard`）；
 *   ③ `StarterKit` 禁用清单写 3 项、实际 11 项 —— 而漏的正是**列表容器契约**（敏感区 #15）与
 *      **mark 载体**（#16b）的载体名，会让 Agent 在敏感区里找不到对应扩展 ⇒ 改错代码。
 *
 * **级别**：B · 守恒锁（集合比对）。只当警报器，**不证明行为对**；到这里红灯就要同步，别绕。
 *
 * **反向校准**（准入 ②）：删掉文档里任一注册项（或源码里任一 register），本 spec 必须转红。
 * 2026-10-13 实跑：删 `record_document_session` 行 → 红；删 `ListFold` 行 → 红；删 `underline` 行 → 红。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function repoRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 12; i++) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('[arch-drift] 找不到仓库根');
}

const ROOT = repoRoot(dirname(fileURLToPath(import.meta.url)));
const ARCH = resolve(ROOT, 'ARCHITECTURE.md');
const LIB_RS = resolve(ROOT, 'src-tauri/src/lib.rs');
const COMMAND_NAMES = resolve(ROOT, 'src/services/tauri/command-names.ts');
const EDITOR_EXT = resolve(ROOT, 'src/components/Editor/tiptap/editor-extensions.ts');

function read(p: string): string {
  expect(existsSync(p), `[arch-drift] 缺少文件：${p}`).toBe(true);
  return readFileSync(p, 'utf8');
}

/** 集合差集：给人类看的「多了什么 / 少了什么」 */
function diff(actual: string[], expected: string[]): string {
  const a = new Set(actual);
  const b = new Set(expected);
  const missing = [...b].filter((x) => !a.has(x));
  const extra = [...a].filter((x) => !b.has(x));
  return [`  文档/登记里缺（代码有）: ${missing.join(', ') || '—'}`, `  多余（代码已删）: ${extra.join(', ') || '—'}`].join('\n');
}

// ── 1. Rust 命令：generate_handler! 宏 ─────────────────────────────
function rustCommands(): string[] {
  const src = read(LIB_RS);
  const start = src.indexOf('generate_handler![');
  expect(start, '[arch-drift] lib.rs 里找不到 generate_handler![').toBeGreaterThan(-1);
  const body = src.slice(start + 'generate_handler!['.length);
  const end = body.indexOf(']');
  expect(end, '[arch-drift] generate_handler! 未闭合').toBeGreaterThan(-1);
  return body
    .slice(0, end)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-z][a-z0-9_]*$/.test(s));
}

/** ARCHITECTURE §4.2 命令表：形如 `| \`command_name\` | file | desc |`（限定在 §4.2 小节内取） */
function docCommands(arch: string): string[] {
  const start = arch.indexOf('### 4.2 命令清单');
  const end = arch.indexOf('### 4.3', start);
  expect(start, '[arch-drift] ARCHITECTURE.md 找不到 §4.2 小节').toBeGreaterThan(-1);
  expect(end, '[arch-drift] ARCHITECTURE.md 找不到 §4.3 小节（§4.2 未闭合）').toBeGreaterThan(start);
  return [...arch.slice(start, end).matchAll(/^\| `([a-z][a-z0-9_]*)` \|/gm)].map((m) => m[1]);
}

function frontendCommands(): string[] {
  const src = read(COMMAND_NAMES);
  return [...src.matchAll(/:\s*'([a-z][a-z0-9_]*)'/g)].map((m) => m[1]);
}

// ── 2. 编辑器扩展：createEditorExtensions 返回数组 ─────────────────
/** 先抹字符串再抹行注释，避免把字符串里的内容误判成注释 / 括号 */
function stripNoise(line: string): string {
  return line
    .replace(/'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"/g, "''")
    .replace(/\/\/.*$/, '');
}

/** 取 return [ ... ] 里的顶层项名字（按括号深度判定「是否顶层」） */
function editorExtensions(): string[] {
  const src = read(EDITOR_EXT);
  const fnIdx = src.indexOf('export function createEditorExtensions');
  expect(fnIdx, '[arch-drift] 找不到 createEditorExtensions').toBeGreaterThan(-1);
  const retIdx = src.indexOf('return [', fnIdx);
  expect(retIdx, '[arch-drift] createEditorExtensions 里找不到 return [').toBeGreaterThan(-1);

  const lines = src.slice(retIdx).split('\n');
  const names: string[] = [];
  let depth = 1; // 已在 return [ 的数组内
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (depth === 1) {
      const m = /^\s{4}([A-Za-z][A-Za-z0-9_]*)/.exec(raw);
      if (m) names.push(m[1]);
    }
    for (const ch of stripNoise(raw)) {
      if (ch === '[' || ch === '{' || ch === '(') depth++;
      else if (ch === ']' || ch === '}' || ch === ')') depth--;
    }
    if (depth <= 0) break;
  }
  expect(names.length, '[arch-drift] 扩展数组解析为空 —— 解析器失效，先修本 spec').toBeGreaterThan(0);
  return names;
}

/** StarterKit.configure({ xxx: false, ... }) 里被显式关闭的内置项 */
function starterKitDisabled(): string[] {
  const src = read(EDITOR_EXT);
  const start = src.indexOf('StarterKit.configure({');
  expect(start, '[arch-drift] 找不到 StarterKit.configure({').toBeGreaterThan(-1);
  const lines = src.slice(start).split('\n');
  const body: string[] = [];
  let depth = 0;
  for (const raw of lines) {
    depth += countDepthDelta(raw);
    body.push(raw);
    if (depth <= 0) break;
  }
  return [...body.join('\n').matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*): false,/gm)].map((m) => m[1]);
}

function countDepthDelta(line: string): number {
  let d = 0;
  for (const ch of stripNoise(line)) {
    if (ch === '[' || ch === '{' || ch === '(') d++;
    else if (ch === ']' || ch === '}' || ch === ')') d--;
  }
  return d;
}

/** 读 ARCHITECTURE.md 里带标记的可机器校验区（每行第一列为名字，其后为说明） */
function docBlock(arch: string, marker: string): string[] {
  const start = arch.indexOf(`<!-- SOLO:${marker}:START -->`);
  const end = arch.indexOf(`<!-- SOLO:${marker}:END -->`);
  expect(start, `[arch-drift] ARCHITECTURE.md 缺少 ${marker} 起始标记`).toBeGreaterThan(-1);
  expect(end, `[arch-drift] ARCHITECTURE.md 缺少 ${marker} 结束标记`).toBeGreaterThan(start);
  return arch
    .slice(start, end)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('```') && !l.startsWith('<!--'))
    .map((l) => l.split(/\s+/)[0]);
}

describe('架构文档 ⇄ 代码漂移', () => {
  it('① 命令：ARCHITECTURE §4.2 表 == lib.rs::generate_handler!（双向）', () => {
    const code = rustCommands();
    const doc = docCommands(read(ARCH));
    expect(code.length, '[arch-drift] 命令解析为空 —— 解析器失效').toBeGreaterThan(0);
    expect(
      [...doc].sort(),
      `\n命令表与代码不一致（两边都是真理源，改任一边都要同步另一边）：\n${diff(doc, code)}`,
    ).toEqual([...code].sort());
  });

  it('② 命令：前端 command-names.ts == lib.rs::generate_handler!（双向）', () => {
    const code = rustCommands();
    const fe = frontendCommands();
    expect(
      [...fe].sort(),
      `\ncommand-names.ts 与 Rust 命令注册不一致（AGENTS §1.1 要求同步）：\n${diff(fe, code)}`,
    ).toEqual([...code].sort());
  });

  it('③ 扩展：ARCHITECTURE §8.3 清单 == editor-extensions.ts 返回数组（双向）', () => {
    const code = editorExtensions();
    const doc = docBlock(read(ARCH), 'EXT-LIST');
    expect(
      [...doc].sort(),
      `\n扩展清单与代码不一致（源码注释里写了每个扩展「为什么在」）：\n${diff(doc, code)}`,
    ).toEqual([...code].sort());
  });

  it('④ 扩展：ARCHITECTURE §8.3 StarterKit 禁用清单 == configure({ xxx: false })（双向）', () => {
    const code = starterKitDisabled();
    const doc = docBlock(read(ARCH), 'STARTERKIT-DISABLED');
    expect(code.length, '[arch-drift] 禁用项解析为空 —— 解析器失效').toBeGreaterThan(0);
    expect(
      [...doc].sort(),
      `\nStarterKit 禁用清单与代码不一致：\n${diff(doc, code)}`,
    ).toEqual([...code].sort());
  });
});
