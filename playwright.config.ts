import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 설정 (계획 2026-10-04-quote-workspace-ui Task 1).
 *
 * `vite dev`를 그대로 띄운다 — 실제 입구가 실제 빌드 파이프라인(가이드
 * 자산 플러그인 포함)을 거치는지 보려는 것이다. 각 테스트는
 * `tests/e2e/fixtures.ts`의 `mockResources`로 네트워크 요청을 가로채
 * 합성 자료로 응답한다 — 저장소의 실제 승인 카탈로그/가이드 파일은
 * 건드리지 않는다.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
