import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// 설계서 §8.4: 의존성·글꼴·아이콘은 자체 호스팅한다. 외부 CDN을 쓰지 않는다.
// 설계서 §8.5: 배포 시 connect-src 'none' CSP와 호환되어야 한다.
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: false, // 설계서 §8.4: 소스맵에 실제 값이 남지 않게 한다
    assetsInlineLimit: 0,
  },
  worker: { format: 'es' },
});
