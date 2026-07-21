# solo 发布剧本（Release Playbook）

> **全生命周期总纲。** 发布机制的细节见 [`RELEASE_PROCESS.md`](../RELEASE_PROCESS.md)（本剧本的 Phase E/F 子文档）。
> **受众**：人 + AI agent。两者都要能照着走、不漏步、不踩已知坑。
> **目标**：流程清晰、执行规范、效率更高。
> **核心原则**：**判断归人，机械归脚本。** 前半段（梳理/讨论/决策）靠人；后半段（校验/构建/发布）交给 `scripts/release-gate.ps1`。

---

## 总览

```text
A 文档梳理 ──▶ B 问题盘点 ──▶ C 优化提案 ──▶ D 提交纪律 ──▶ E 发布 ──▶ F 上线验证
  (判断)        (判断)         (判断→执行)     (半机械)      (机械·脚本)   (机械+人验)
```

每一阶段都有 **入口条件 / 动作 / 出口关卡（go/no-go）**。出口关卡没过，不进下一阶段。这不是 bureaucracy，是飞行员的起飞前检查单——保证「不会漏、不会乱序」。

---

## Phase A — 文档梳理（判断）

- **何时触发**：每个版本周期开始；或发现文档与代码脱节时。
- **入口**：无。
- **动作**：
  - 对账：README / AGENTS / ARCHITECTURE / PROFILE 与新代码是否一致。
  - 找残留：`marklight` 等历史字样、死链接、已移除功能仍被提及（如「导出 HTML/PDF」已于 v1.2.18 移除）。
  - 外部文档（`design-samples/`、`.archive/`）按约定不入库，仅本地留档。
- **出口关卡**：✅ 无过期/矛盾文档；待改项已进清单（带入 B/C，或 D 顺手改）。
- **加速器**：可让 agent 跑文档洁净度审计（参考 `.workbuddy/doc-cleanliness-audit.md` 模式）。

---

## Phase B — 问题盘点与裁决（判断）

- **入口**：用户反馈 / GitHub Issue / 自查发现。
- **动作**：
  - 记录 bug：环境 + 复现步骤 + 期望（用 `.github/ISSUE_TEMPLATE/bug_report.md`）。
  - **裁决三选一**：① 现在修 → 进 C/D；② 不修 → 记入 `docs/KNOWN-ISSUES.md`；③ 排期 → 标记下个版本。
  - **中文场景适用性评估**：接第三方库时，对其默认值做「中文是否成立」判断（例：`SlashCommands` 的 `allowedPrefixes` 默认 `[' ']`，中文无词间空格习惯会失效 → 显式传 `null`）。
- **出口关卡**：✅ 本版要修的 bug 已确定并进入 C/D；不修/排期项有去向。
- **合并重构铁律**：合并改动时，必须把「原有守卫规则」列成对照清单，逐条确认新逻辑覆盖（图片 IPC 合并曾丢 `assets/` 守卫、`../../` 越权 containment 校验——见 `RELEASE_PROCESS.md` §9.3 与 AGENTS.md 历史经验）。

---

## Phase C — 优化提案（判断 → 执行）

> 这是 7-20 验证过的好模式（`ui-optimization-proposal.md` 提案 → 批准 → 分步执行 → 每步自检）。固化下来。

1. **写提案文档**（`docs/<主题>-proposal.md`）：目标、方案、影响面、分步计划。
2. **用户批准后才动手**（共识前置，见 SOUL.md 工作纪律）。
3. **分步执行**，每步后自检：`vue-tsc --noEmit` → `bun run test` → `bun run build`。
4. 每步可独立验证，**不一次全量**。
- **出口关卡**：✅ 提案已批准 + 每步自检通过 + 未提交改动停在暂存区外待命（等 D）。
- **偏好边界**：保存状态指示器必须反映真实落盘，不引入「乐观保存提前报喜」（7-20 用户明确否决，记入 `MEMORY.md`）。

---

## Phase D — 提交纪律（半机械）

- **入口**：C 完成 / 直接修 bug 完成。
- **拆分规则**（参考 7-20 三笔提交 `334c1d0` / `282e4da` / `ef343ac`）：
  - **feat 提交**：功能/修复主体（相关多文件归一笔）。
  - **bump 提交**：版本号变更独立一笔（`package.json` / `Cargo.toml` / `tauri.conf.json`）。
  - **doc 提交**：PROFILE 版本历史等文档补充。
- **message 规范**：见 `CONTRIBUTING.md`（Conventional 风格：`feat` / `fix` / `docs` / …）。
- **出口关卡**：✅ `git status` 干净、无 secrets、无 `node_modules`/`target`；然后进 E（先 bump 再 tag）。

---

## Phase E — 发布（机械 · 脚本化）

> 机制细节见 [`RELEASE_PROCESS.md`](../RELEASE_PROCESS.md)。本阶段用 `scripts/release-gate.ps1` 跑两道闸门，消灭手滑与易忘。

### PreTag 闸门（打 tag 前）

```powershell
pwsh scripts/release-gate.ps1 -Stage PreTag
# 加 -Fast 仅跑版本三处一致 + replaceAll 扫描（迭代版本号时快速循环，跳过 test/build）
```

脚本自动完成：
1. 版本三处一致校验（`package.json` / `Cargo.toml` / `tauri.conf.json`）。
2. `replaceAll` / `replaceAllAsync` 扫描（TS target ES2020 禁用）。
3. `bun run test` + `bun run build` 门禁（一键，失败即停）。

### PostCI 闸门（tag 推送触发 CI 后）

```powershell
pwsh scripts/release-gate.ps1 -Stage PostCI
# 加 -Publish 才翻转 draft -> published（易忘步骤，显式开关，默认只校验不发布）
```

脚本自动完成：
1. 轮询等 CI 完成（含超时保护，默认 25min）。
2. 资产三件套核对（`.exe` / `.sig` / `latest.json`）。
3. `latest.json` 版本校验（须等于 tag 版本）。
4. `-Publish` 时翻转 `draft=false`（**不翻用户收不到更新**，见 `RELEASE_PROCESS.md` §7.1）。

- **出口关卡**：✅ 两道闸门全绿 +（如需）已 `published`。

---

## Phase F — 上线验证（机械 + 人验）

- **入口**：E 完成（已 `published`）。
- **动作**：
  - 已安装旧版 → 设置/通用/检查更新 → 确认弹新版 → 下载/安装/重启成功。
  - 走 [`RELEASE-CHECKLIST.md`](../RELEASE-CHECKLIST.md) 手动回归（图片/路径/边界/升级）。
- **出口关卡**：✅ 自动更新实测通过 + 回归清单全勾。
- **收尾**：PROFILE 版本历史（已在 D 的 doc 提交里做）、CHANGELOG 对齐。

---

## 附录 — 闸门脚本速查

| 命令 | 作用 | 关键开关 |
|---|---|---|
| `pwsh scripts/release-gate.ps1 -Stage PreTag` | 打 tag 前全闸门 | `-Fast`（跳过 test/build） |
| `pwsh scripts/release-gate.ps1 -Stage PostCI` | CI 后校验 | `-Publish`（翻转发布）、`-CiTimeoutMin`（轮询上限） |

**设计取舍**：脚本只做「判断结果的执行 + 机械校验」，不做任何产品决策。`-Publish` 默认关闭，避免误发；`/tmp` 路径错位坑（7-20 `gh release download` 在 Git Bash 落到 `F:\tmp`）通过在项目内建 `.reltmp` 临时目录规避。
