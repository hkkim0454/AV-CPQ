/**
 * 메인페이지 자료 안내 PDF 2건을 dev/build에서 내준다(계획 §8,
 * 2026-10-05 — 노임 공표 PDF + 2026-10-05 추가 요청 — 표준품셈 PDF).
 *
 * `tools/vite-guide-assets.ts`와 같은 두 갈래 구조다 — dev는 미들웨어가
 * 디스크에서 바로 내주고, build는 `closeBundle`에서 `dist/`로 복사한다.
 *
 * **정확히 이 파일들만** 내준다(허용 목록). "한 개만" 이라는 원래
 * 표현은 "업로드 폴더나 다른 PDF를 전부 허용하지 않는다"는 뜻이지,
 * 영원히 한 파일만 허용한다는 뜻이 아니다 — 승인된 파일을 추가할 때는
 * 여기 `ALLOWED`와 `.gitignore`의 narrow exception을 **둘 다** 늘린다.
 *
 * 내용을 추출하거나 다시 그려 보여주지 않는다 — 원문 바이트를 그대로
 * 보기(새 탭)·다운로드로만 내보낸다.
 */
import { copyFileSync, createReadStream, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

const SOURCE_DIR = 'reference-docs';
const URL_PREFIX = '/reference-docs/';

/** 승인되고 실측 확인한 파일만 올린다. 새 PDF는 확인 전에 추가하지 않는다. */
export const ALLOWED = [
  '2026년_하반기_적용_정보통신부문_시중노임단가_공표_안내_1부.pdf',
  '2026년도-적용-정보통신공사-표준품셈.pdf',
] as const;

export function referenceDocsPlugin(root = process.cwd()): Plugin {
  const sourcePath = resolve(root, SOURCE_DIR);
  let isBuild = false;

  return {
    name: 'avcpq-reference-docs',

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
        const name = decodeURIComponent(url.slice(URL_PREFIX.length));
        if (!(ALLOWED as readonly string[]).includes(name)) {
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
        res.setHeader('Content-Type', 'application/pdf');
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
          throw new Error(`자료 PDF가 없다: ${missing.join(', ')}`);
        }

        mkdirSync(outDir, { recursive: true });
        for (const name of ALLOWED) {
          copyFileSync(join(sourcePath, name), join(outDir, name));
        }
        // eslint-disable-next-line no-console
        console.log(`\n자료 PDF ${ALLOWED.length}개 복사: ${ALLOWED.join(', ')}`);
      },
    },
  };
}
