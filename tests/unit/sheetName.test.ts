import { describe, it, expect } from 'vitest';
import {
  normalizeSheetName,
  assignSheetNames,
  quoteSheetRef,
} from '@/export/ooxml/sheetName';

/**
 * 설계서 §9.3: "Excel 시트명 escaping을 수행한다. 시트명 길이·금지 문자·중복 이름·
 * 끝 공백 정책을 명시한다."
 *
 * 원본 시트 `LED Display `는 **끝 공백이 있고** 갑지가 `='LED Display '!J35`로 참조한다.
 * 공백을 흘리면 Excel이 조용히 `#REF!`로 연다.
 */
describe('normalizeSheetName', () => {
  it('일반 한글 이름은 그대로 둔다', () => {
    expect(normalizeSheetName('월컨트롤 시스템')).toBe('월컨트롤 시스템');
  });

  it('끝 공백을 보존한다 — 원본 호환', () => {
    expect(normalizeSheetName('LED Display ')).toBe('LED Display ');
  });

  it('Excel 금지 문자를 전부 바꾼다', () => {
    expect(normalizeSheetName('A:B')).toBe('A_B');
    expect(normalizeSheetName('A\\B')).toBe('A_B');
    expect(normalizeSheetName('A/B')).toBe('A_B');
    expect(normalizeSheetName('A?B')).toBe('A_B');
    expect(normalizeSheetName('A*B')).toBe('A_B');
    expect(normalizeSheetName('A[B]C')).toBe('A_B_C');
  });

  it('31자를 넘으면 자른다', () => {
    const long = '가'.repeat(40);
    const out = normalizeSheetName(long);
    expect(out).toHaveLength(31);
  });

  it('작은따옴표로 시작하거나 끝나면 바꾼다 — Excel이 거부한다', () => {
    expect(normalizeSheetName("'리드")).toBe('_리드');
    expect(normalizeSheetName("리드'")).toBe('리드_');
  });

  it('빈 이름은 대체 이름을 준다', () => {
    expect(normalizeSheetName('')).toBe('시트');
    expect(normalizeSheetName('   ')).not.toBe('');
  });

  it('History는 Excel 예약어라 피한다', () => {
    expect(normalizeSheetName('History')).toBe('History_');
    expect(normalizeSheetName('history')).toBe('history_');
  });
});

describe('assignSheetNames — 중복 해소', () => {
  it('중복 이름에 번호를 붙인다', () => {
    const names = assignSheetNames(['회의실', '회의실', '회의실']);
    expect(names).toEqual(['회의실', '회의실 (2)', '회의실 (3)']);
  });

  it('대소문자만 다른 이름도 Excel에서는 중복이다', () => {
    const names = assignSheetNames(['Room', 'room']);
    expect(names[0]).toBe('Room');
    expect(names[1]).not.toBe('room');
  });

  it('예약된 이름(갑지)과 충돌하지 않는다', () => {
    const names = assignSheetNames(['갑지'], ['갑지']);
    expect(names[0]).not.toBe('갑지');
  });

  it('중복 해소 후에도 31자를 넘지 않는다', () => {
    const long = '나'.repeat(31);
    const names = assignSheetNames([long, long]);
    expect(names[0]).toHaveLength(31);
    expect(names[1]!.length).toBeLessThanOrEqual(31);
    expect(names[1]).not.toBe(names[0]);
  });

  it('정규화 결과가 같아져 생긴 중복도 해소한다', () => {
    // `A:B`와 `A/B`는 둘 다 `A_B`로 정규화된다
    const names = assignSheetNames(['A:B', 'A/B']);
    expect(names[0]).toBe('A_B');
    expect(names[1]).toBe('A_B (2)');
  });
});

describe('quoteSheetRef — 수식 안의 시트 참조', () => {
  it('공백이 있는 이름은 작은따옴표로 감싼다', () => {
    expect(quoteSheetRef('LED Display ')).toBe(`'LED Display '`);
  });

  it('한글 이름은 작은따옴표로 감싼다 — Excel이 한글 시트명을 그렇게 쓴다', () => {
    expect(quoteSheetRef('월컨트롤 시스템')).toBe(`'월컨트롤 시스템'`);
  });

  it('이름 안의 작은따옴표를 두 번 쓴다', () => {
    expect(quoteSheetRef("it's")).toBe(`'it''s'`);
  });

  it('영문·숫자·밑줄만 있는 짧은 이름은 따옴표 없이도 되지만 항상 감싼다', () => {
    // 항상 감싸는 쪽이 안전하다. Excel은 불필요한 따옴표를 허용한다.
    expect(quoteSheetRef('Rack1')).toBe(`'Rack1'`);
  });
});
