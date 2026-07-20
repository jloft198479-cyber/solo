<!-- 提交 PR 前请先读 CONTRIBUTING.md -->

## 摘要

<!-- 这个 PR 改了什么、为什么 -->

## 变更类型

- [ ] Bug 修复（无功能变化）
- [ ] 新功能 / 非破坏性改进
- [ ] 破坏性变更
- [ ] 文档 / 重构 / 清理

## 改动范围

<!-- 列出主要改动文件，以及「为什么动这些文件」 -->

- `src/...`
- `src-tauri/...`

## 验证

<!-- 勾选你实际跑过的。测试数量以 `bun run test` 实际输出为准，不要硬编码数字 -->

- [ ] `bun run test` 全量通过（0 失败）
- [ ] `bun run build` 通过（vue-tsc --noEmit + vite build）
- [ ] 改了 Rust：`cargo check` 通过（按 CONTRIBUTING.md §1.2 加载 MSVC 环境）
- [ ] 无 `replaceAll` / `replaceAllAsync`（TS target ES2020，用 `.split().join()` 替代）
- [ ] 若触及 defect-hotspots 中的 10 个易错区，已额外说明影响评估

## 相关 Issue

<!-- 如有关联，写 `Closes #123` 或 `Related to #123` -->

## 备注

<!-- 给 reviewer 的提示、遗留风险、后续 TODO 等 -->
