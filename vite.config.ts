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
          if (id.includes('@tiptap/vue-3') || id.includes('@tiptap/pm') || id.includes('@tiptap/core')) {
            return 'tiptap-core';
          }
          if (id.includes('@tiptap/extension-') || id.includes('@tiptap/starter-kit')) {
            return 'tiptap-extensions';
          }
          if (id.includes('markdown-it')) return 'markdown-it';
          if (id.includes('katex')) return 'katex';
          if (id.includes('mermaid')) return 'mermaid';
        },
      },
    },
  },
}));
