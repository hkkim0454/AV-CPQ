/**
 * `data/approved/`를 dev와 build에서 **같은 상대 경로**로 읽히게 한다 (단계 3-A Task 0).
 *
 * 앱은 `${import.meta.env.BASE_URL}data/approved/products.json`으로 읽는다.
 * 빌드 타임 `import`를 쓰지 않는 이유는 결정 D3이다 — `prices.json`을 배포에서
 * 빼기만 하면 되게 해 두려면 번들에 박으면 안 된다.
 *
 * `publicDir`을 `data`로 바꾸지 않는 이유: 기존 `public/`이 죽는다.
 * 대신 플러그인 두 갈래로 처리한다.
 *
 *   dev   — 미들웨어가 `/data/approved/*`를 디스크에서 바로 내준다
 *   build — `closeBundle`에서 `dist/data/approved/`로 복사한다
 *
 * `prices.json`이 **없어도 빌드가 성공해야 한다.** 결정 D3이 "판매가를 가리려면
 * 배포에서 빼기만 하면 된다"고 했으므로, 없는 것이 정상 경로다.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, createReadStream } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import type { Plugin } from 'vite';

const SOURCE_DIR = 'data/approved';
const URL_PREFIX = '/data/approved/';

/** 배포에서 빼도 되는 파일. 없어도 빌드가 실패하지 않는다 (결정 D3). */
const OPTIONAL = new Set(['prices.json']);

/** 반드시 있어야 하는 파일. 없으면 빌드를 멈춘다. */
const REQUIRED = ['products.json', 'labor-items.json', 'wage-table.json', 'labor-mappings.json'];

export function approvedDataPlugin(root = process.cwd()): Plugin {
  const sourcePath = resolve(root, SOURCE_DIR);

  return {
    name: 'avcpq-approved-data',

    // --- dev: 디스크에서 바로 내준다 ---
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (url === undefined || !url.startsWith(URL_PREFIX)) {
          next();
          return;
        }
        const name = url.slice(URL_PREFIX.length);
        // 경로 탈출 방지 — 파일 이름만 받는다.
        if (name === '' || name.includes('/') || name.includes('\\') || name.includes('..')) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const file = join(sourcePath, name);
        if (!existsSync(file)) {
          // 404는 정상 경로다. `prices.json`이 없으면 앱이 전 품목을 `미등록`으로 그린다.
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader(
          'Content-Type',
          extname(name) === '.json' ? 'application/json; charset=utf-8' : 'application/octet-stream',
        );
        // 배포 데이터는 버전이 바뀌면 파일 내용이 바뀐다. dev에서는 캐시하지 않는다.
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(file).pipe(res);
      });
    },

    // --- build: dist로 복사한다 ---
    closeBundle() {
      const outDir = resolve(root, 'dist', SOURCE_DIR);

      const missing = REQUIRED.filter((name) => !existsSync(join(sourcePath, name)));
      if (missing.length > 0) {
        throw new Error(
          `배포 데이터가 없다: ${missing.join(', ')}\n` +
            `먼저 \`npm run build:approved\`를 돌린다.`,
        );
      }

      mkdirSync(outDir, { recursive: true });
      const copied: string[] = [];
      for (const name of readdirSync(sourcePath)) {
        if (!name.endsWith('.json')) continue;
        copyFileSync(join(sourcePath, name), join(outDir, name));
        copied.push(name);
      }

      const skipped = [...OPTIONAL].filter((name) => !copied.includes(name));
      // eslint-disable-next-line no-console
      console.log(`\n배포 데이터 ${copied.length}개 복사: ${copied.join(', ')}`);
      if (skipped.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `  빠진 선택 파일: ${skipped.join(', ')} — 앱은 해당 단가를 '미등록'으로 표시한다 (결정 D3)`,
        );
      }
    },
  };
}
