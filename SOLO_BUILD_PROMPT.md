# Solo 构建与打包 - 给 Claude Code 的提示词

## 前情摘要（我已完成的全部工作，不要重复）

### 本次 session（v1.2.5 → v1.2.6）修正

**P0 修复（日常高频场景的 roundtrip 稳定性）：**

1. **列表项内 block blank line 分离** (`serializer.ts:260-268`)
   - `renderContent` 中去掉 `inTightList` 检查，列表项内 block 间始终用 `blankLine()`
   - 修复：Ex 254、263、264、270、271、286-290、300 等列表项内容丢失问题

2. **Code span 反引号定界符** (`serializer.ts:115-148`)
   - 新增 `_codeSpanDelims()`：计算相邻 code text 节点的最长反引号运行，用 N+1 定界符；首尾字符为反引号时加空格填充
   - 修复：Ex 17、329、330、339

**P1 修复（非高频但 roundtrip 实测发现）：**

3. **ATX heading 尾随 # 转义** (`serializer.ts:315-322`)
   - heading 序列化后检查行末是否含 `空格+#`，插入 `\` 防止 re-parse 吃掉内容
   - 修复：Ex 76（内容 foo ### → foo 的数据丢失）

4. **代码围栏自适应定界符** (`serializer.ts:362-376`)
   - 根据 codeBlock 内容中最长反引号运行确定 fence 长度；language 含反引号时自动切为 `~~~` 围栏（CommonMark 限制：backtick fence 的 info string 不能含反引号）
   - 新增辅助函数 `_maxCharRun()`、`_lineClash()` (`serializer.ts:462-477`)
   - 修复：Ex 123、124、127、134、146

5. **URL 括号转义** (`serializer.ts:201-203`)
   - link mark 的 href 中转义 `(` → `\(`、`)` → `\)`
   - 修复：Ex 492、498、499、500

6. **连续 HR 去空行** (`serializer.ts:270-277`)
   - `renderContent` 中相邻 `horizontalRule` 节点间用 `ensureNewline()` 取代 `blankLine()`
   - 修复：Ex 98

### 之前 session 已完成

- CJK 标点 + bold/italic 的 delimiter boundary 保护（ZWNJ 插入）
- ZWNJ dedup
- EscapeInline 去除 `!?` 转义
- 新增 roundtrip 用例

### 当前测试状态

- `npm test`（vitest run）：**27 files / 977 tests 全绿**
- CommonMark spec：652 条中 **618 条通过 + 34 条 skip**（skip 全是设计约束：entity 不重编码、setext→ATX、nested emphasis PM 限制等）
- `npm run build`（vue-tsc + vite build）：已通过，dist/ 已生成

## 接下来需要你做的事

### 1. 生成桌面安装包

```bash
npm version patch   # 如果版本号还没改
npm run build:tauri # 在本地有 Rust 工具链的环境跑
```

产物在 `src-tauri/target/release/bundle/` 下。

### 2. 允许做的合理改动

- 如果发现 serializer/parser 层有肉眼可见的 bug（测试覆盖不到的），可以修
- 如果 Tauri build 报错，修相关 config
- README 等文档变更

### 3. 禁止做（我已经确认过不需要）

- ❌ 不要重新分析或修改 commonmark SKIP 表的 34 条——全部是 design constraint
- ❌ 不要重构 serializer/parser 架构——当前结构对 Solo 这个体量的产品足够
- ❌ 不要改 package.json 的 dependencies
- ❌ 不要动前端 UI（Vue 组件、tailwind、样式等）
- ❌ 不要新增 lint/type fix（当前 lint 经过确认，不阻塞构建）
- ❌ 不要加注释——代码可读性已经够好
