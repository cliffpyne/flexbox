import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
// import { rtlcssPlugin } from './vite-rtlcss-plugin';
import { visualizer } from 'rollup-plugin-visualizer';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    visualizer({
      filename: 'dist/stats.html',
      open: true,
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  base: '/', // ✅ FIXED
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  css: {
    devSourcemap: true,
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ['if-function', 'color-functions', 'global-builtin', 'import'],
      },
    },
  },
});
