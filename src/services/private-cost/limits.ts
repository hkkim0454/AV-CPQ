/**
 * 원가표 입력 제한 (설계서 §8.3).
 *
 * "파일 크기·ZIP 해제 크기·항목 수·행/열 수·처리 시간을 제한한다. 과대 파일을 차단한다."
 *
 * 제한을 두는 이유는 성능이 아니라 안전이다 — 압축률이 극단적인 ZIP을 풀면
 * 메모리가 터지고, 그 과정에서 브라우저가 상태를 디스크로 내보낼 수 있다.
 */
export interface InputLimits {
  /** 원본 파일 크기. */
  maxBytes: number;
  /** ZIP 해제 후 전체 크기. */
  maxUnzippedBytes: number;
  /** ZIP 엔트리 수. */
  maxZipEntries: number;
  /** 데이터 행 수 (머리글 제외). */
  maxRows: number;
  /** 열 수. */
  maxColumns: number;
  /** 파싱 제한 시간(ms). */
  maxParseMs: number;
}

export const DEFAULT_LIMITS: InputLimits = {
  maxBytes: 20 * 1024 * 1024,
  maxUnzippedBytes: 200 * 1024 * 1024,
  maxZipEntries: 500,
  maxRows: 100_000,
  maxColumns: 200,
  maxParseMs: 30_000,
};
