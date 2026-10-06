/**
 * `tools/build-approved.ts` 의 **실행 진입점**.
 *
 * 왜 파일을 나누는가: `vite-node` 는 `process.argv` 에서 스크립트 경로를 빼고
 * 사용자 인자만 남긴다. 그래서 "이 모듈이 직접 실행됐는가"를 argv 로 판정할
 * 수 없다 — 예전 코드가 그렇게 하다가 조건이 영영 거짓이 되어
 * `npm run build:approved` 가 **아무 일도 하지 않고 조용히 끝났다.**
 *
 * 진입점을 따로 두면 판정이 필요 없다. 시험은 `build-approved.ts` 를
 * `import` 하므로 이 파일을 거치지 않고, 따라서 시험 중에 `main()` 이
 * 도는 일도 없다.
 */
import { main } from './build-approved';

main();
