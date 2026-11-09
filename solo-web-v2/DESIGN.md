# solo — Design System（DESIGN.md）

> 站点设计规范（Google Stitch DESIGN.md 格式）。
> 风格基底参考 Notion 的暖色极简，叠加 solo 自身"书卷气"：衬线展示字、暖纸底色、朱墨单一强调色。
> 本文档是本仓库 UI 的唯一规范来源；写代码前先读这里。

## 1. Visual Theme & Atmosphere

**一句话**：像一本排好版的书，不像一个塞满按钮的软件。

- 暖纸底色而非冷白/纯白；文字用暖调近黑而非纯黑，长时间阅读不刺眼。
- 衬线展示字体（宋体系）承担标题，无衬线承担正文与 UI，等宽承担代码——三者各司其职。
- 结构靠"细语边框"（1px、10% 透明度）与留白，不靠重边框和重阴影。
- 全站只有一个饱和强调色：**朱墨**（vermilion），用于 CTA、链接、关键点缀；黛青作极少量辅助。
- 无任何外部网络请求（无 CDN 字体、无外链图片），系统字体栈 + 内联 SVG，离线可开、秒加载。

## 2. Color Palette & Roles

### Light（默认）
| Token | 值 | 用途 |
|---|---|---|
| `--paper` | `#faf8f3` | 页面底色（暖纸） |
| `--paper-2` | `#f4f0e6` | 交替区块底色 |
| `--surface` | `#ffffff` | 卡片 / 弹层表面 |
| `--ink` | `#1f1b16` | 主文字（暖近黑，非纯黑） |
| `--ink-2` | `#5c554b` | 次要文字 |
| `--ink-3` | `#8f867a` | 弱化 / 占位 / 说明 |
| `--line` | `rgba(31,27,22,.10)` | 细语边框 |
| `--zhu` | `#a63d2f` | 朱墨主强调（CTA / 链接） |
| `--zhu-strong` | `#8f3025` | 朱墨 hover / active |
| `--zhu-tint` | `rgba(166,61,47,.08)` | 朱墨淡底（callout / 徽章） |
| `--dai` | `#2d6a63` | 黛青辅助强调 |
| `--dai-tint` | `rgba(45,106,99,.08)` | 黛青淡底 |

### Dark（夜读墨色）
| Token | 值 |
|---|---|
| `--paper` | `#1a1714` |
| `--paper-2` | `#221e1a` |
| `--surface` | `#26221e` |
| `--ink` | `#f0ebe0` |
| `--ink-2` | `#b3aa9c` |
| `--ink-3` | `#8a8175` |
| `--line` | `rgba(240,235,224,.12)` |
| `--zhu` | `#d4654f` |
| `--zhu-strong` | `#e07a63` |
| `--zhu-tint` | `rgba(212,101,79,.12)` |
| `--dai` | `#6aa8a0` |
| `--dai-tint` | `rgba(106,168,160,.12)` |

### 对比度（WCAG AA 达标）
- 主文字 on paper：≈ 15:1
- 次要文字 `--ink-2` on paper：≈ 5.6:1
- 朱墨 `--zhu` on paper：≈ 6.4:1；dark 下 `#d4654f` on `#1a1714`：≈ 5.4:1
- 全部交互元素有 `:focus-visible` 2px 实心描边环

## 3. Typography Rules

| 角色 | 字体 | 尺寸（clamp 流式） | 字重 | 行高 | 字距 |
|---|---|---|---|---|---|
| Display Hero | serif | clamp(2.5rem, 1.6rem+4vw, 4.25rem) | 700 | 1.08 | **0.02em** |
| Section Heading | serif | clamp(1.75rem, 1.3rem+2vw, 2.75rem) | 700 | 1.15 | -0.01em |
| Card Title | sans | 1.125rem | 600 | 1.4 | 0 |
| Lead | sans | clamp(1.05rem, 1rem+0.4vw, 1.25rem) | 400 | 1.7 | 0 |
| Body | sans | 1rem | 400 | 1.75 | 0 |
| Nav / Button | sans | 0.9375rem | 600 | 1.3 | 0 |
| Caption | sans | 0.8125rem | 400 | 1.5 | 0 |
| Badge | sans | 0.75rem | 600 | 1.3 | 0.06em |
| Code | mono | 0.875rem | 400 | 1.7 | 0 |

**字体栈**
- serif：`"Huiwen-mincho","汇文明朝","Noto Serif SC","Source Han Serif SC","Songti SC","STSong","SimSun",serif`
- sans：`"Noto Sans SC","PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",system-ui,-apple-system,sans-serif`
- mono：`"JetBrains Mono","Cascadia Code","SF Mono",Consolas,monospace`

**原则**：标题用衬线制造"书卷气"，正文用无衬线保证屏显清晰；中文正文行高 ≥1.75；标题随字号增大收紧字距与行高。衬线在站内不出现在版式里；字体板块的 6 张焦点样张为真字体渲染图（不内嵌商用字体文件，站点零字体请求）。

**中西文混排细则**
- **大标题字距取微正（+0.02em）而非负值**：Notion 那套负字距是为拉丁字母设计的；中文是等宽方块，负字距会让笔画挤在一起，大字号下尤其明显。
- 标题统一 `text-wrap: balance`，正文统一 `text-wrap: pretty`（避免中文孤字与标点悬挂）。
- 衬线栈按平台递进：`Noto Serif SC → Source Han Serif SC → Songti SC(macOS) → STZhongsong(Windows 华文中宋) → SimSun`。**STZhongsong 必须排在 SimSun 之前**——后者在 40px+ 会发虚。

## 4. Component Stylings

- **按钮**：主按钮朱墨底白字 6px 圆角 10px/20px padding，hover 加深，active `scale(.98)`；次按钮透明底 + 细语边框；幽灵链接 hover 下划线。
- **卡片**：白/暖纸表面，1px 细语边框，12px 圆角，多层低透明度阴影（见 §6），hover 阴影微增强。
- **徽章**：9999px 全圆角，朱墨淡底 + 朱墨字，12px/600。
- **输入/代码块**：mono，`--paper-2` 底，细语边框，8px 圆角。
- **导航**：非固定（滚动后加毛玻璃仅暗色），左 logo 右 CTA，15px/600。
- **首屏事实行**（`.hero-facts`，2026-10-19 增至四条）：桌面左栏仅 ≈480px，四条排一行会溢出，故用 **2×2 网格**（标题 + 副标）；hero 单列后（≤1024）改一排四列，≤768 回落 2×2。
- **编辑器示意窗**（hero 沉浸式渲染）：按 solo 真机复刻，不做"想象中的编辑器"。视觉真理源 = solo 仓库 `src/themes/presets/graphite.json`（石墨：纯灰阶，与本站无彩色版式同调；暗色 App 无石墨暗色版，站点侧按石墨 token 反相推导；mark 高亮两套均保留 App 共享默认黄，见 `src/themes/manager.ts` SHARED_LIGHT_COLORS/SHARED_DARK_COLORS）+ `src/components/Editor/tiptap/editor.css`（16px / 行高 1.6 / 标题 1.6em / 标注块直角 / 表格全框线）+ `CustomTitlebar.vue` 与 `App.vue`（48px 标题栏、42px 状态栏，均与画布同色无分隔线）。标题栏 = solo 字标（主色 + 2.2px 字距）+ 竖分隔线 + 文件名 + 焦点/大纲/置顶 + 最小化/最大化/关闭；状态栏 = 左字数、右保存态与复制/主题/字体/设置。站内为等比缩小示意（基准 14px ≈ 真机 16px）。
- **示意窗悬停预览暗色**（2026-10-19 用户指令）：鼠标移入 `.editor-window` 即整窗切到暗色（200ms 颜色过渡，`--dur-mid` + `--ease-out`），移出淡回——不点主题开关也能看到第二套主题。实现 = 暗色 token 块选择器从 `:root[data-theme="dark"]` 扩为 `:root[data-theme="dark"], .editor-window:hover`，**色值仍只有一处**；窗口内所有颜色均走 `--ew-*`，故一次换 token 全窗生效。站点本身是暗色时两处同值、悬停无变化。过渡只覆盖颜色类属性（`background-color`/`color`/`border-color`，含伪元素），不碰 `.ln` 入场的 opacity/transform；`prefers-reduced-motion` 下由全局 `transition-duration: .01ms` 自动降级为瞬时。
- **语法演示区**（tab 五面板）：面板内 md-* 渲染与首屏 mock **共用同一套规则与 token**——`--ew-*` 定义在 `:root`（2026-10-18 修复：原定义在 `.editor-window` 上，`.demo` 取不到 → 段落/代码掉浏览器默认样式、表格框线隐形）；`.md-p/strong/em/code/mark` 选择器同时挂 `.ew-canvas` 与 `.demo`。Callout 真值 = `extensions/callout.ts` + `editor.css` 1211+：**无图标**，头部仅「类型徽章（大写英文，0.7em/700/0.06em 字距/opacity .8）」或自定义标题（`[data-title]` 时不强制大写）；默认 note 取石墨值，tip/warning/quote 等类型色板 = `themes/manager.ts` SHARED_LIGHT/DARK_COLORS（石墨 preset 只覆盖 calloutNote）。演示三枚分别取 tip（绿）/ warning 自定义标题「注意」（琥珀）/ quote（灰），覆盖徽章与标题两种模式。
- **字体板块**（2026-10-18 从主题区升级为独立 section，用户指令）：独立 `<section id="fonts">`，eyebrow「字体」+ h2「六种字体，一字一句都是呼吸」。内容 = 6 款字体各一张焦点模式样张（2 列网格，`.fs-grid`）：App 字体清单（`src/constants/fonts.ts`）= 系统默认 + 5 款可下载（思源宋体/朱雀仿宋/小赖/霞鹜文楷 Lite/汇文明朝）。每张版式统一：左栏编辑层级（淡标题 0.2 / 淡段 0.2 / 实段两行+光标 / 淡段 0.22，复刻 `editor.css` 焦点模式），右栏「朝」字 198px 巨排；演示文本「山居笔记」段全款统一，便于横向对比。图底 #f6f6f5 与画框 `--paper-2` 同色 → 垫白画框感（`.fs-figure` 12px 内边距 + 圆角，图片无边框无 caption，图内 meta 行自带字体名）。文件：`font-spec-{system,notoserif,zhuque,xiaolai,lxgw,huiwen}.webp` + `-dark` 版（#17171a 底 / #fafafa 字），CSS 按 `data-theme` 切换。**规格 1120×432 WebP q90，12 张合计 255KB**（2026-10-19 从 2240×864 PNG 压下来，原 1472KB；实测量化平均误差 1.25/255，误差 >4 的像素仅 2.27%，肉眼无差）。图片是 2 倍图的逻辑尺寸，`width/height` 属性写 1120×432 即可。真字体离岸渲染，站点零字体请求；渲染工具 = CDP 等 `document.fonts` loaded 再截图（`shot.js`，Temp/fontgen/），**勿用 `--screenshot` 一把截**（有静默 fallback 竞态，2026-10-18 事故）。

### FAQ 手风琴（原生 `<details>`）

- 结构：`.faq-list details > summary + p`，一次只开一个（JS 监听 `toggle` 互斥）。
- **必须用原生 `<details>`**，不要自造 `div + aria-expanded`——白拿键盘与读屏支持。
- 关闭态：细语底边 + 右侧**圆形徽章箭头**（26px 全圆角、细语边框、`ink-2` 箭头）。
- 展开态：整条 `--zhu-tint` 淡底 + 左侧 3px 朱墨竖线 + 圆角右三边；徽章填朱墨、箭头转白并翻转 180°。
- hover：整条 `color-mix(ink 3.5%)` 淡底；summary 文字转朱墨；徽章描边转朱墨。
- 内边距：summary `20px 20px 20px 16px`，答案 `0 20px 20px 16px`（左侧 16px 对齐正文，右侧 20px 给徽章留位）。
- ⚠️ **不要用 `::details-content` 动画 `block-size`**：实测本机 Chromium 上该伪元素的 `block-size` 连 `!important` 都压不回 `auto`，会把答案整段藏掉（功能性回归，比少个动画严重得多）。展开入场改用只动 `opacity/transform` 的关键帧（`faq-in`），零裁剪风险。
- **版面**（2026-10-18 用户指令）：FAQ 区用全宽 `.container`，**不用** `container-narrow`——与其他板块左对齐一致，不做居中窄列（`container-narrow` 仅保留给刻意的结尾 CTA `cta-final`）。

## 5. Layout Principles

- 容器：`max-width: 1120px`，左右 padding `clamp(1.25rem, 4vw, 2rem)`。
- 区块纵向节奏：`clamp(4rem, 8vw, 7rem)`，白底与暖纸底（`--paper-2`）交替。
- 间距基数 4px，完整量表 **4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 / 96**（`--sp-1` … `--sp-24`）。
  ⚠️ **写 `var(--sp-N)` 前先确认该 N 在量表里**——自定义属性未定义会让整条声明失效归零，且不报错。曾有 `--sp-5`/`--sp-10` 漏定义，导致 FAQ/卡片/页脚静默丢失全部内边距。
- 特性区 3→2→1 列；语法区用 tab 单栏展示；主题区 4→2 列。
- 移动端区块间距降至 48px，标题等比收缩。

## 6. Depth & Elevation

| 层级 | 处理 |
|---|---|
| Flat | 无阴影无边框 |
| Whisper | `1px solid var(--line)` |
| Soft Card | 3 层阴影，单层透明度 ≤0.04 |
| Deep | 5 层阴影，最大模糊 52px、透明度 ≤0.05 |
| Focus | `2px solid var(--zhu)` 描边环 |

**阴影哲学**：多层极低透明度叠加，深度"被感觉到"而不是"被看到"。

## 7. Do's and Don'ts

✅ 暖中性色（带黄褐底味）｜衬线标题｜单一朱墨强调｜细语边框｜留白呼吸｜动效只做 `opacity/transform`｜指数缓出
❌ 纯黑 `#000` / 纯白 `#fff` 大面积铺｜蓝紫渐变｜毛玻璃滥用｜圆角+通用大阴影｜动画化布局属性｜弹性回弹缓动｜卡片套卡片

## 8. Responsive Behavior

| 断点 | 变化 |
|---|---|
| <640px | 单列，标题缩至 2.5rem，区块 48px，导航折叠为菜单 |
| 640–1024px | 特性 2 列，主题 2 列 |
| >1024px | 特性 3 列，完整布局 |

- 触控目标 ≥44px。
- `prefers-reduced-motion: reduce` 时关闭所有动效与打字动画，内容直接呈现。
- 首屏以下区块用 `content-visibility: auto` 降低渲染成本。

## 9. Motion

- 入场：`opacity 0→1` + `translateY(12px→0)`，`cubic-bezier(.22,1,.36,1)`（ease-out-quart），500ms。
- 滚动触发（IntersectionObserver，只触发一次）。
- Hero 打字动画按行 stagger 120ms；`prefers-reduced-motion` 下跳过。
- 主题切换 200ms 颜色过渡。
- 不用回弹/弹性缓动，不动画化宽高/边距。

## 10. Accessibility

- 语义化 HTML：`header/nav/main/section/article/footer`，标题层级不跳级。
- tab 用 `role="tablist/tab/tabpanel"` + `aria-selected` + 键盘左右方向键。
- FAQ 用原生 `<details>/<summary>`（自带键盘与读屏支持）。
- 跳转主内容链接（skip link）。
- 所有交互元素 `:focus-visible` 可见焦点环。
- 图标为内联 SVG，装饰性 `aria-hidden="true"`，功能性配 `aria-label`。
- 文字缩放至 200% 不破版。

## 11. SEO 与部署（2026-10-19 立）

**域名口径**：`https://solo.weimabbs.com/`（无 www、**必须带尾斜杠**）。所有绝对 URL 都以此为准，一处写错整链失效。

- **canonical**：`<link rel="canonical" href="https://solo.weimabbs.com/">` —— 与 `og:url`、`sitemap.xml` 的 `<loc>` 三处必须完全一致。
- **Open Graph**（微信/飞书/X 分享卡片）：`og:type=website`、`og:site_name=solo`、`og:locale=zh_CN`、`og:title`、`og:description`、`og:image` + `width/height/alt`。
  ⚠️ **`og:image` 必须是绝对 URL**——相对路径在分享卡片里 100% 抓不到（爬虫不解析 base）。文件 `og.png`，**1200×630 / 100.7KB**，由 `og-src.html` 经 CDP 2× 渲染后 LANCZOS 降采样（版式 = 左字标 + 86px「克制即自由」+ 副标的 + `solo.weimabbs.com · Apache 2.0`，右暗色编辑器卡片），改文案要重跑别手改图。
- **Twitter Card**：`summary_large_image`（复用 og:image，不另出图）。
- **JSON-LD**：`SoftwareApplication`，含 `applicationCategory=ProductivityApplication`、`operatingSystem=Windows`、`inLanguage=zh-CN`、`license`(Apache-2.0)、`url`、`downloadUrl`(releases)、`sameAs`(仓库)、`screenshot`、`offers{price:0, priceCurrency:CNY}`。**`downloadUrl` 指向 `/releases` 不是仓库首页**。
- **robots.txt**：`User-agent: *` / `Allow: /` / `Sitemap: https://solo.weimabbs.com/sitemap.xml`。
- **sitemap.xml**：单 URL 站点，一条 `<url>`（`<loc>` + `<lastmod>`），改版后手更 lastmod。
- **下载入口**：两处主按钮（首屏 GitHub、结尾 CTA）都指 `https://github.com/jloft198479-cyber/solo/releases`。**不直链 exe**——直链会随版本号失效，releases 页永远有效。国内直连 github.com 常超时（api.github.com 通），CNB 镜像（`cnb.cool/jloft/solo`）为备用下载链路。
- **部署（已上线）**：整站纯静态、零外部请求，无需构建步骤。服务器 `111.172.233.113` 宝塔站点 id=22，根目录 `/www/www/solo.weimabbs.com`，证书 TrustAsia LiteSSL（2027-01 到期）。上传走 `ops/scripts/bt_upload_token.py`：Playwright 登录面板 → 从任一 `/files?action` 请求里抓 `x-http-token` → 带 Cookie 直传 `/files?action=upload`（表单字段 `f_path` / `f_name` / `f_size` / `blob`，**`f_size` 缺了面板直接抛 AttributeError**）。⚠️ 命令行里传服务器绝对路径必须加 `MSYS_NO_PATHCONV=1`，否则 Git Bash 会把 `/www/...` 改写成 `C:/Program Files/Git/www/...`——接口照样回「上传成功」，文件却落在别处，是最坑的一种假绿。
  改完复验用 `ops/scripts/verify_live.py https://solo.weimabbs.com/ <本地目录>`：逐文件 sha256 比对线上内容，并顺带断言 canonical / og:image / og:url / JSON-LD / releases 直链。**「接口说上传成功」不算验收，公网取回的字节一致才算。**
  上线实测：首屏 6 请求 **85KB**（gzip 后 Document 29KB + CSS 12KB + JS 3KB + 图 40KB），FCP 452ms，控制台零报错。
  已知缓存策略（宝塔默认，未改）：HTML 走 ETag 即时生效；`css/js` `max-age=43200`（12h）；图片 `max-age=2592000`（30 天）。**改 CSS/图片后短时间可能看到旧版**，硬刷或改文件名可绕开；要改成短缓存需动 nginx vhost + reload，风险高于收益，暂不碰。

**性能基线**（每次改完复测，回退即视为回归）：全页 **244KB / 10 请求**（Document 76KB + Stylesheet 35KB + Script 7KB + Image 126KB），FCP 300–400ms（本地），控制台零报错。原 847KB，2026-10-19 靠 WebP 化把图片从 730KB 压到 126KB。

