import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue()],

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    // 启用生产优化
    target: "esnext",
    minify: "esbuild",
    // 分包策略：将大型依赖拆分为独立 chunk
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          // TipTap 核心包
          if (id.includes('@tiptap/vue-3') || id.includes('@tiptap/pm') || id.includes('@tiptap/core')) {
            return 'tiptap-core';
          }
          // TipTap 扩展包（仅包含实际安装的）
          if (
            id.includes('@tiptap/extension-placeholder') ||
            id.includes('@tiptap/extension-highlight') ||
            id.includes('@tiptap/extension-image') ||
            id.includes('@tiptap/extension-link') ||
            id.includes('@tiptap/extension-table') ||
            id.includes('@tiptap/extension-task-list') ||
            id.includes('@tiptap/extension-subscript') ||
            id.includes('@tiptap/extension-superscript')
          ) {
            return 'tiptap-extensions';
          }
          // 其他大型依赖
          if (id.includes('markdown-it')) return 'markdown-it';
          if (id.includes('katex')) return 'katex';
          if (id.includes('mermaid')) return 'mermaid';
        },
      },
    },
  },
}));
