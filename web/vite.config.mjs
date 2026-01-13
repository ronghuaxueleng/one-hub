// https://github.com/vitejs/vite/discussions/3448
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import jsconfigPaths from 'vite-jsconfig-paths';

// ----------------------------------------------------------------------

export default defineConfig({
  plugins: [react(), jsconfigPaths()],
  // https://github.com/jpuri/react-draft-wysiwyg/issues/1317
  //   define: {
  //     global: 'window'
  //   },
  resolve: {
    alias: [
      {
        find: /^~(.+)/,
        replacement: path.join(process.cwd(), 'node_modules/$1')
      },
      {
        find: /^src(.+)/,
        replacement: path.join(process.cwd(), 'src/$1')
      }
    ]
  },
  server: {
    // this ensures that the browser opens upon server start
    open: true,
    // this sets a default port to 3000
    host: true,
    port: 3010,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000', // 设置代理的目标服务器
        changeOrigin: true
      }
    }
  },
  preview: {
    // this ensures that the browser opens upon preview start
    open: true,
    // this sets a default port to 3000
    port: 3010
  },
  build: {
    // 针对低内存服务器的构建优化
    sourcemap: false, // 禁用 sourcemap 节省内存
    minify: 'esbuild', // 使用 esbuild 压缩（比 terser 更快更省内存）
    chunkSizeWarningLimit: 1000, // 增加 chunk 大小警告阈值
    rollupOptions: {
      output: {
        // 手动分割代码，减少单个 chunk 大小
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'mui-vendor': ['@mui/material', '@mui/icons-material', '@mui/lab'],
          'chart-vendor': ['apexcharts', 'react-apexcharts'],
          'editor-vendor': ['@monaco-editor/react', 'monaco-editor'],
        }
      }
    },
    // 减少并行处理，降低内存峰值
    commonjsOptions: {
      transformMixedEsModules: true
    }
  }
});
