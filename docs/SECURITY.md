---
title: Security Policy
type: guide
audience: maintainer
status: active
tags: [安全, 漏洞披露, 攻击面]
summary: 安全披露政策 + 攻击面 + 当前版本号（随 package.json 更新）
updates: [package.json, ARCHITECTURE.md §11.4]
---

# Security Policy

## 1. 项目性质与攻击面

**solo 是一个本地优先（local-first）的桌面 Markdown 编辑器**：纯前端 + Rust 桌面壳，**没有后端服务器、没有云端账户、不联网上传用户文档**。

这意味着它的攻击面比「带后端的 Web 服务」小得多，但仍有几处需要认真对待：

| 攻击面 | 说明 | 现状 |
|---|---|---|
| **图片资产路径穿越** | 渲染本地图片时，恶意构造的路径可能读取 `solo` 数据目录之外的文件 | Rust 侧 `validate_image_asset_path` 先做 `canonicalize`（解析符号链接与 `..`）再校验图片扩展名，防穿越 |
| **恶意文档诱导越权读写文件** | 文档里可出现任意路径（图片引用、链接、导入源、保存目标），Rust 侧若直接采信前端传入路径，就能读/写本职功能之外的文件 | 读、写命令各加扩展名白名单（读限 md / markdown / txt，写另加 json）；图片引用与导入源统一走 `validate_image_asset_path` |
| **远程图片 / 字体 URL 滥用（SSRF）** | 恶意文档可诱导应用向任意地址发起请求，包括内网与云元数据端点 | `validate_remote_image_url` 限 http/https 并拦截字面量内网 / 回环 / 链路本地主机与云元数据地址；`validate_font_url` 限 https。**残留风险见 §4** |
| **自动更新供应链** | 自动更新会拉取 `latest.json` + 签名安装包，若签名校验被绕过可投毒 | 使用 Tauri updater + `TAURI_SIGNING_PRIVATE_KEY` 签名校验 |
| **HTML / Markdown 粘贴** | 粘贴富文本 / HTML 时可能带入脚本、危险协议 | 前端 `turndown` 转换 + 内容经 TipTap/ProseMirror 净化；mermaid 用 `loose` 模式（本地单文件编辑器，风险可接受） |
| **文件关联 / 右键新建** | 注册表项、`.md` 文件图标与 ShellNew | 安装时写入，卸载时清理 |
| **WebView2 远程内容** | solo 本身不加载远程网页；CSP 已收紧（font-src 含 `blob:` 仅用于字体下载） | 仅加载本地 `asset://` 与 `http://asset.localhost` |

> **不在攻击面内**：用户文档内容本身、本地文件系统读写（这是软件本职功能）、剪贴板（仅用户主动复制时写入）。

---

## 2. 支持的版本

我们只对**最新正式版**提供安全修复。安全漏洞请在最新版上复现并报告。

- 当前版本：`v1.2.40`（以 `package.json` 为准）。
- 旧版本（< 最新版）不再单独打安全补丁；请升级到最新版。

---

## 3. 报告漏洞

**请勿在公开 Issue 中披露安全漏洞。**

请通过以下方式私下报告：

- **微信**：`fzz198479`（项目维护者）
- 或在仓库中创建 **private / 草稿 Issue / 私信**，标题注明 `[SECURITY]`。

报告请包含：

1. 漏洞类型（路径穿越 / 更新投毒 / XSS / 其他）
2. 复现步骤（含环境版本，如 `v1.2.40`、Windows 版本）
3. 影响范围评估（能读到什么、能执行什么）
4. 如有，附最小复现样例或日志路径（`%APPDATA%\solo\`）

我们会在收到报告后 **7 个工作日内**确认并评估，修复后随下一个版本发布，并在 `CHANGELOG.md` 中注明。

---

## 4. 已知安全相关设计取舍

- **mermaid `securityLevel: 'loose'`**：本地优先单文件编辑器，文档由用户自己编写，外部注入风险极低，故放宽以修复「全黑」渲染问题。若未来支持加载不可信远程文档，需重新评估。
- **IPC 路径 / URL 信任边界**：Rust 侧对前端传入的路径与 URL 做白名单校验（扩展名白名单 + `canonicalize` 后校验 + 协议/主机限制），是本地编辑器唯一的实质安全边界，改动需格外谨慎。具体校验规则与改动铁律以 `ARCHITECTURE.md` §11.4 为真理源，本文不复制。
- **远程 URL 校验只挡字面量主机，挡不住 DNS rebinding**：`validate_remote_image_url` 判断的是 URL 里写出来的主机，攻击者若掌握一个公网域名并让其解析到内网 IP，请求仍会打到内网。彻底修法需要「解析后 IP 再校验 + 用该 IP 建连」，会破坏 TLS SNI 与虚拟主机、且 reqwest 需自定义 resolver——本地优先单文件编辑器的 threat model 下不付这个复杂度。取舍详情见 [`docs/KNOWN-ISSUES.md`](./KNOWN-ISSUES.md) §二 #5。
- **字体 URL 只限 https，刻意不做主机白名单**：GitHub release 会 302 跳到 `objects.githubusercontent.com`，主机白名单会打断下载。当前唯一调用方 `fontLoader.ts` 用的是硬编码 https 常量，`validate_font_url` 只防命令被传入任意 URL（`file://` / http 明文）；字体链路有「连修四版才修对」的历史，不再引入新的失效面。
- **自动更新签名**：`TAURI_SIGNING_PRIVATE_KEY` 为 GitHub Secrets，不在仓库中。

---

## 5. 第三方依赖

solo 依赖 Tauri 2、Vue 3、TipTap/ProseMirror、Tailwind 等。依赖漏洞请先确认是否影响 solo 的实际攻击面（多数 Web 框架 CVE 不影响本地桌面壳），再决定是否升级。升级前先跑 `bun run test` + `bun run build`。
