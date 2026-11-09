# solo-web — solo 产品官网（静态站）

solo 产品官网。纯静态、零依赖、零构建——直接放任何静态托管即可。

## 文件

| 文件 | 说明 |
|---|---|
| `index.html` | 页面主体（语义化 HTML，含内联 SVG 图标） |
| `styles.css` | 全部样式（设计 token + 组件） |
| `main.js` | 交互（主题切换 / 导航 / 滚动入场 / 语法 Tab / FAQ 手风琴） |
| `favicon.svg` | 站点图标（朱墨方章 + solo 字样） |
| `DESIGN.md` | 设计系统规范（本仓库 UI 唯一规范来源） |

## 本地预览

```bash
# 任选其一
python -m http.server 8080
npx serve .
```

浏览器打开 `http://localhost:8080`。

## 部署

整目录上传到任意静态托管（GitHub Pages / Vercel / Netlify / 对象存储）即可，无需构建步骤。

## 设计说明

- 风格基底：Notion 式暖纸极简 + solo 自身"书卷气"（衬线展示字、暖纸底、朱墨单强调色）。
- 明暗双主题，默认跟随系统，选择记 `localStorage`（键 `solo-theme`）。
- 无外部网络请求：系统字体栈 + 内联 SVG，离线可开。
- 无障碍：WCAG AA 对比度、`:focus-visible` 焦点环、语义化标签、`prefers-reduced-motion` 降级、Tab 键盘导航。
- 性能：首屏以下区块 `content-visibility: auto`；动效只跑 `opacity/transform`，指数缓出。

## 内容真实性约定

站内所有"已实现"描述以 solo 项目 `docs/FEATURE-MATRIX.md` 为准；未实现功能（如 PDF/HTML 导出、崩溃会话恢复、手机端）已在 FAQ 与"数据安全"节如实标注，**新增文案前请先核对该表**。
