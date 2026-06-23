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
        manualChunks: {
          'tiptap-core': ['@tiptap/vue-3', '@tiptap/pm', '@tiptap/core'],
          'tiptap-extensions': [
            '@tiptap/extension-placeholder',
            '@tiptap/extension-highlight',
            '@tiptap/extension-image',
            '@tiptap/extension-link',
            '@tiptap/extension-table',
            '@tiptap/extension-task-list',
            '@tiptap/extension-underline',
            '@tiptap/extension-text-align',
            '@tiptap/extension-subscript',
            '@tiptap/extension-superscript',
            '@tiptap/extension-typography',
          ],
          'markdown-it': ['markdown-it'],
          'katex': ['katex'],
          'mermaid': ['mermaid'],
        },
      },
    },
  },
}));
