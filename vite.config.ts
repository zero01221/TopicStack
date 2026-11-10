import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Vite 构建与 vitest 测试配置。
 * 纯前端单页应用：不配置后端代理、不注入任何外部服务地址。
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  test: {
    // 判据测试全部是纯函数断言，无需 DOM 环境。
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
