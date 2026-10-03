import { describe, it, expect } from 'vitest';
import { numberString, koreanAmountSentence } from '@/export/ooxml/koreanAmount';

/**
 * 설계서 §9.4: "원본 C8의 NUMBERSTRING 한글 금액 수식은 목표 Excel에서 검증한다."
 *
 * 아래 기대값은 **실제 Microsoft 365 Excel 16.0 ko-KR에서 측정한 값**이다
 * (2026-10-03, COM으로 `=NUMBERSTRING(A1,1)` 실행).
 * 추측이 아니라 측정값이므로, 이 테스트가 깨지면 변환기가 Excel과 어긋난 것이다.
 */
describe('numberString — Excel NUMBERSTRING(n, 1)과 동일', () => {
  const measured: Array<[string, string]> = [
    ['0', '영'],
    ['1', '일'],
    ['5', '오'],
    ['10', '일십'],
    ['11', '일십일'],
    ['100', '일백'],
    ['101', '일백일'],
    ['110', '일백일십'],
    ['1000', '일천'],
    ['1001', '일천일'],
    ['10000', '일만'],
    ['10001', '일만일'],
    ['100000', '일십만'],
    ['1000000', '일백만'],
    ['10000000', '일천만'],
    ['100000000', '일억'],
    ['266000000', '이억육천육백만'],
    ['3500000', '삼백오십만'],
    ['3580000', '삼백오십팔만'],
    ['1234567890', '일십이억삼천사백오십육만칠천팔백구십'],
    ['10000000000', '일백억'],
    ['1000000000000', '일조'],
  ];

  for (const [input, expected] of measured) {
    it(`${input} → ${expected}`, () => {
      expect(numberString(input)).toBe(expected);
    });
  }

  it('소수는 버린다 — Excel NUMBERSTRING도 정수부만 읽는다', () => {
    expect(numberString('1234.99')).toBe('일천이백삼십사');
  });

  it('음수는 던진다 — 견적 금액에 쓰지 않는다', () => {
    expect(() => numberString('-1000')).toThrow();
  });
});

describe('koreanAmountSentence — 갑지 C8 전체 문구', () => {
  it('원본 형식을 그대로 만든다', () => {
    // 원본: ="일금"&NUMBERSTRING(H18,1)&"원정(\"&TEXT(H18,"###,##0")&") V.A.T별도"
    // 한국어 Windows에서 `\`는 ₩로 보인다.
    expect(koreanAmountSentence('266000000')).toBe(
      '일금이억육천육백만원정(\\266,000,000) V.A.T별도',
    );
  });

  it('천 단위 구분 기호를 넣는다', () => {
    expect(koreanAmountSentence('3500000')).toBe('일금삼백오십만원정(\\3,500,000) V.A.T별도');
  });

  it('0원도 문구를 만든다', () => {
    expect(koreanAmountSentence('0')).toBe('일금영원정(\\0) V.A.T별도');
  });
});
