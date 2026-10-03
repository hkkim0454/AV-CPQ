import { describe, it, expect } from 'vitest';
import { excelInt, roundDown, dec, add, mul, isZero } from '@/domain/calculation/rounding';

/**
 * 설계서 §5.2: "INT는 음수에서 단순 소수점 버림과 다르다."
 * Excel INT(-1.5) = -2 (음의 무한대 방향). TRUNC(-1.5) = -1.
 */
describe('excelInt — Excel INT 의미', () => {
  it('양수는 소수점을 버린다', () => {
    expect(excelInt('1.9').toString()).toBe('1');
    expect(excelInt('19800.4').toString()).toBe('19800');
    expect(excelInt('0.5').toString()).toBe('0');
  });

  it('정수는 그대로 둔다', () => {
    expect(excelInt('19800').toString()).toBe('19800');
    expect(excelInt('-19800').toString()).toBe('-19800');
  });

  it('음수는 음의 무한대 방향으로 내린다 — 단순 버림이 아니다', () => {
    expect(excelInt('-1.5').toString()).toBe('-2');
    expect(excelInt('-0.1').toString()).toBe('-1');
    expect(excelInt('-19800.4').toString()).toBe('-19801');
  });
});

/**
 * 설계서 §5.5: 갑지 H16 = ROUNDDOWN(SUM(H11:H15),-4) — 만원 미만 절사.
 * Excel ROUNDDOWN은 0 방향으로 버린다(INT와 음수에서 다르다).
 */
describe('roundDown — Excel ROUNDDOWN(value, digits)', () => {
  it('digits=-4 는 만원 미만을 버린다', () => {
    expect(roundDown('3580245', -4).toString()).toBe('3580000');
    expect(roundDown('3589999', -4).toString()).toBe('3580000');
    expect(roundDown('3580000', -4).toString()).toBe('3580000');
  });

  it('digits=0 은 소수점을 버린다', () => {
    expect(roundDown('1234.99', 0).toString()).toBe('1234');
  });

  it('음수는 0 방향으로 버린다 — INT와 다르다', () => {
    expect(roundDown('-3580245', -4).toString()).toBe('-3580000');
    expect(roundDown('-1234.99', 0).toString()).toBe('-1234');
  });

  it('1만 미만은 0이 된다', () => {
    expect(roundDown('9999', -4).toString()).toBe('0');
  });
});

describe('Decimal 보조 함수', () => {
  it('정수 문자열을 부동소수 오차 없이 더한다', () => {
    expect(add('1234567', '2345678').toString()).toBe('3580245');
  });

  it('요율 곱셈에서 부동소수 오차가 나지 않는다', () => {
    // 0.1 * 3 은 JS number로 0.30000000000000004
    expect(mul('0.1', '3').toString()).toBe('0.3');
  });

  it('빈 문자열과 undefined 를 0으로 읽지 않는다', () => {
    expect(() => dec('')).toThrow();
    expect(() => dec('abc')).toThrow();
  });

  it('명시적인 0 은 유효한 값이다', () => {
    expect(isZero(dec('0'))).toBe(true);
    expect(dec('0').toString()).toBe('0');
  });
});
