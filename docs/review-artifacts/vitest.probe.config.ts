import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

/**
 * 第三方审查批 3 专用配置：只跑 docs/review-artifacts 下的探针，
 * 不进 CI（主配置的 include 只收 src 下的 __tests__ 目录）。
 *
 * 用法（必须在仓库根执行，root 取当前工作目录）：
 *   npx vitest run --config docs/review-artifacts/vitest.probe.config.ts
 */
export default defineConfig({
  plugins: [vue()],
  root: process.cwd(),
  test: {
    environment: 'node',
    include: ['docs/review-artifacts/**/*.probe.spec.ts'],
  },
});
