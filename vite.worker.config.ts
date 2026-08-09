// Vite Worker 打包配置：将 worker-entry.ts 编译为 dist/_worker.js
// 用法：npx vite build --config vite.worker.config.ts
//
// 注意：
//   - 此构建与主应用 (pnpm build / vite build) 独立
//   - 输出文件 dist/_worker.js 是 Pages Custom Worker 入口
//   - wrangler pages dev 检测到 dist/_worker.js 存在时自动使用它，
//     并跳过 functions/ 目录路由；此时 dist/_worker.js 的
//     export { MatchmakerObject, RoomObject } 就是 Worker 入口级具名导出

import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // 不用 vue 插件（Worker 端无 UI），插件列表留空即可
  plugins: [],
  build: {
    target: 'es2022',
    sourcemap: false,
    minify: false,
    outDir: 'dist',
    emptyOutDir: false, // 不要清空 dist，不然会把 Vite 主构建产物删掉
    lib: {
      entry: fileURLToPath(new URL('./worker-entry.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => '_worker.js',
    },
    rollupOptions: {
      // Cloudflare / Node 内置模块不打包
      external: [
        /^cloudflare:/,
        /^node:/,
        '__STATIC_CONTENT_MANIFEST',
      ],
      output: {
        // 保持单文件打包 + 保留具名导出（默认行为就是这个）
      },
    },
  },
});
