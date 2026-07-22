import { defineConfig } from 'vite';

export default defineConfig({
  // Tauri 在开发模式下会注入窗口对象，所以这里关闭 cjs 互操作
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ['VITE_'],
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false,
  },
});
