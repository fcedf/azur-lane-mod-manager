import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

const urlShim = fileURLToPath(new URL('./src/vendor/url-shim.mjs', import.meta.url));

// 让 pixi-live2d-display 经由 @pixi/utils 引用的 Node "url" 在【依赖预构建阶段】
// 也解析到浏览器垫片（仅 dev 的 resolve.alias 管不到已被 esbuild 打包的 @pixi/utils）。
const urlShimEsbuildPlugin = {
  name: 'fms-url-shim',
  setup(build) {
    build.onResolve({ filter: /^url$/ }, () => ({ path: urlShim }));
  },
};

export default defineConfig({
  base: './', // 桌面打包后从本地 file:// 加载需要相对路径
  plugins: [vue()],
  resolve: {
    alias: {
      // 运行时（未打包代码 / 生产构建 rollup）同样指向垫片
      url: urlShim,
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [urlShimEsbuildPlugin],
    },
  },
  server: {
    host: true, // 监听 0.0.0.0，允许同一 WiFi 下的手机等设备访问
    port: 5173,
    proxy: {
      // 前端 /api 请求代理到后端，规避跨域
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
