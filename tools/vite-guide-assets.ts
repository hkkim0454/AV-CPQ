/**
 * 정제 가이드 템플릿 4개+manifest를 dev/build에서 같은 상대 경로로 내준다
 * (계획 2026-10-04-quote-workspace-ui Task 1).
 *
 * `tools/vite-approved-data.ts`와 같은 두 갈래 구조다 — dev는 미들웨어가
 * 디스크에서 바로 내주고, build는 `closeBundle`에서 `dist/`로 복사한다.
 *
 * **정확히 이 5개 파일만** 내준다(허용 목록). `templates/sanitized/`에는
 * 이 화면이 쓰지 않는 `quote-template.xlsx`(평택 원본 양식)도 있고,
 * 업로드 폴더·`.local`·원본(비정제) xlsx가 나중에 그 옆에 생길 수도
 * 있다 — 디렉터리 전체를 내주면 그런 파일도 같이 배포될 위험이 있다.
 * 허용 목록이면 새 파일이 생겨도 명시적으로 추가하기 전까지는 안
 * 나간다.
 */
import { copyFileSync, createReadStream, existsSync, mkdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

const SOURCE_DIR = 'templates/sanitized';
const URL_PREFIX = '/templates/sanitized/';

/** 이 화면이 실제로 쓰는 파일 전부. 전부 필수다 — 하나라도 없으면 빌드를 멈춘다. */
const ALLOWED = [
  'guide-won.xlsx',
  'guide-pumsem.xlsx',
  'guide-ds.xlsx',
  'guide-ds-won.xlsx',
  'guide-manifest.json',
];

export function guideAssetsPlugin(root = process.cwd()): Plugin {
  const sourcePath = resolve(root, SOURCE_DIR);
  let isBuild = false;

  return {
    name: 'avcpq-guide-assets',

    configResolved(config) {
      isBuild = config.command === 'build';
    },

    // --- dev: 디스크에서 바로 내준다 ---
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (url === undefined || !url.startsWith(URL_PREFIX)) {
          next();
          return;
        }
        const name = url.slice(URL_PREFIX.length);
        if (!ALLOWED.includes(name)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const file = join(sourcePath, name);
        if (!existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader(
          'Content-Type',
          extname(name) === '.json' ? 'application/json; charset=utf-8' : 'application/octet-stream',
        );
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(file).pipe(res);
      });
    },

    // --- build: dist로 복사한다 ---
    closeBundle: {
      sequential: true,
      handler() {
        if (!isBuild) return;

        const outDir = resolve(root, 'dist', SOURCE_DIR);
        const missing = ALLOWED.filter((name) => !existsSync(join(sourcePath, name)));
        if (missing.length > 0) {
          throw new Error(
            `가이드 배포 자산이 없다: ${missing.join(', ')}\n` +
              `먼저 \`npm run build:guides\`로 templates/sanitized/를 만든다.`,
          );
        }

        mkdirSync(outDir, { recursive: true });
        for (const name of ALLOWED) {
          copyFileSync(join(sourcePath, name), join(outDir, name));
        }
        // eslint-disable-next-line no-console
        console.log(`\n가이드 배포 자산 ${ALLOWED.length}개 복사: ${ALLOWED.join(', ')}`);
      },
    },
  };
}
