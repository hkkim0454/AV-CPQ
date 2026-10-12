import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    // 기본은 `node` 다. 컴포넌트 소비부를 확인하는 몇 개 시험만 파일 머리의
    // `@vitest-environment jsdom` 으로 DOM 을 켠다(사용성 2차 Task B).
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}'],
    reporters: ['default'],
  },
});
