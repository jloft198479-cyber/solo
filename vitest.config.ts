import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  // `bun/npm run test:full`（= `vitest run --mode full`）：完整回归，连全仓保真体检一起跑。
  // 走 config 内部赋值，而不是 shell 的 `SOLO_FIDELITY_SCAN=1 vitest run` ——
  // 后者在 Windows 的 cmd 下是无效语法（npm run 默认用 cmd，会报「不是内部或外部命令」）。
  if (mode === 'full') process.env.SOLO_FIDELITY_SCAN = '1';

  return {
    plugins: [vue()],
    test: {
      environment: 'node',
      include: ['src/**/__tests__/**/*.spec.ts'],
      coverage: {
        // 仅在 CI 或显式 --coverage 时生效；本地默认不收集，避免拖慢日常测试
        provider: 'v8',
        include: [
          // 优先覆盖核心业务逻辑：状态管理、组合式函数、服务层
          'src/stores/**/*.ts',
          'src/composables/**/*.ts',
          'src/services/**/*.ts',
          'src/commands/**/*.ts',
          'src/utils/**/*.ts',
          'src/themes/**/*.ts',
          // 编辑器扩展与 markdown 解析/序列化
          'src/components/Editor/tiptap/extensions/**/*.ts',
          'src/components/Editor/tiptap/markdown/**/*.ts',
        ],
        exclude: [
          'src/**/__tests__/**',
          'src/**/*.d.ts',
          'src/types/**',
          // 入口与声明文件不纳入覆盖率
          'src/main.ts',
          'src/vite-env.d.ts',
        ],
        // 基础门槛：保证核心模块至少有基础覆盖
        thresholds: {
          statements: 50,
          functions: 50,
          branches: 40,
          lines: 50,
        },
      },
    },
  };
});
