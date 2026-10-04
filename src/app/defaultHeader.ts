import type { QuoteHeader } from '../domain/quote/types';

/**
 * 두 입구(구성도/품목 선택) 공통 기본 견적 머리글 — 현장·고객 등 실제
 * 입력 폼은 아직 만들지 않았다(이번 Task2 범위 밖, 다음 작업으로 남김).
 * 빈 문자열 placeholder는 이 저장소의 기존 관례다(`QuoteHeader`는 형식
 * 자체에 필수 검증을 두지 않는다 — `tests/integration/twoEntryPoints.test.ts`
 * 등에서도 `contact: ''`, `conditions: []`을 그대로 쓴다).
 */
export function defaultHeader(quoteNumber: string): QuoteHeader {
  return {
    quoteNumber,
    quoteDate: new Date().toISOString().slice(0, 10),
    customer: '',
    projectName: '',
    contact: '',
    conditions: [],
  };
}
