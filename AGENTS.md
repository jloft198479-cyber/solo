# solo 项目工作手册

> 给 AI 和开发者的快速入门 + 纪律约束 + 文档地图。

---

## 项目一句话

solo 是一个 **Tauri v2 桌面端 Markdown 编辑器**（Vue 3 + TipTap + Rust），纯本地、无后端、单文件编辑。

## 工作纪律（不可违反）

### 改代码前
- 先读实际代码行为，不以注释为准
- 确认影响范围：改了这个文件，还有哪些文件受影响？逐个检查

### 改 parser/serializer 后
1. `bun run test` — 所有 roundtrip 测试必须通过
2. `vue-tsc --noEmit` — 类型检查通过
3. `bun run build` — 前端构建通过

### 发版前（🛑 常见踩坑区）
1. **先升版本号**（3 个文件：`package.json` / `Cargo.toml` / `tauri.conf.json`）
2. **检查 `replaceAll`**：TS target ES2020，用 `.split().join()` 替代
3. 确认 tag 名与版本号一致（`v1.x.x`）
4. 完整流程见 `RELEASE_PROCESS.md`

### 提交前
- 不要提交 secrets / key
- 不要提交 `node_modules` / `target`
- 先看 `git status` 再 commit

## 文档地图

| 读者 | 先读这个 | 再看这个 |
|------|----------|----------|
| **新接手** | `AGENTS.md`（本文） | `BUILD_GUIDE.md` |
| **查技术决策** | `PROFILE.md` | `ARCHITECTURE.md` |
| **改 CJK 边界** | `docs/cjk-boundary.md` | `parser.ts` / `serializer.ts` |
| **发新版本** | `RELEASE_PROCESS.md` | `.github/workflows/release.yml` |
| **编译不通过** | `BUILD_GUIDE.md §7 故障排查` | `TROUBLESHOOTING.md` |

### 快速链接

| 用途 | 路径 |
|------|------|
| 项目档案（技术栈 + 架构决策 + 版本历史） | `.opencode/PROFILE.md` |
| 体系编译手册 | `BUILD_GUIDE.md` |
| 正式发布流程 | `RELEASE_PROCESS.md` |
| 架构参考 | `ARCHITECTURE.md` |
| CJK 标点加粗边界专题 | `docs/cjk-boundary.md` |

## 关键约束速查

- **TS target**: ES2020（禁止 `replaceAll`）
- **构建**: `bun run build`（vue-tsc + vite）→ `bunx tauri build`
- **测试**: `bun run test`（Vitest + happy-dom），当前 ~978 tests
- **Rust**: 1.96.0，edition 2021，`CARGO_HOME=M:\rust\.cargo`
- **MSVC**: Build Tools v14.44，路径 `M:\VS\BuildTools`
- **Bun**: 1.3.14

## 沟通风格

- 说人话，言简意赅
- 实事求是，不臆想不编造
- 先想后做，共识前置
- 完成自检再通报
- 被批评后经验必须沉淀到文档
