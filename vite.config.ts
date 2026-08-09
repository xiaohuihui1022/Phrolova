/// <reference types="node" />
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev"),
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    // 代理配置：
    //   /api      → Cloudflare Pages Functions (port 5174)
    //   /ws       → Cloudflare Worker WebSocket (port 8788)
    //
    // 本地开发启动流程：
    //   Terminal A → pnpm dev:cf (Pages Functions)
    //   Terminal B → cd cf-server && pnpm wrangler dev (Worker WebSocket)
    //   Terminal C → pnpm dev (Vite HMR)
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:5174",
        changeOrigin: true,
      },
      "/ws": {
        target: process.env.VITE_WS_PROXY_TARGET ?? "ws://127.0.0.1:8788",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    host: "0.0.0.0",
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});