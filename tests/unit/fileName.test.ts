import { describe, expect, it } from 'vitest';

import {
  FileNameError,
  isInternalFileName,
  quoteFileName,
} from '@/export/variants/fileName';

describe('quoteFileName — D18 출력 3종', () => {
  it('등급별 꼬리표가 붙는다', () => {
    expect(quoteFileName('평택 사무3동', '2026-07-29', 0)).toBe(
      '견적서_평택 사무3동_260729_원.xlsx',
    );
    expect(quoteFileName('평택 사무3동', '2026-07-29', 1)).toBe(
      '견적서_평택 사무3동_260729(설명+품셈포함).xlsx',
    );
    expect(quoteFileName('평택 사무3동', '2026-07-29', 2)).toBe(
      '견적서_평택 사무3동_260729.xlsx',
    );
  });

  it('꼬리표가 붙으면 사내용, 없으면 고객용', () => {
    expect(isInternalFileName(quoteFileName('현장', '2026-07-29', 0))).toBe(true);
    expect(isInternalFileName(quoteFileName('현장', '2026-07-29', 1))).toBe(true);
    expect(isInternalFileName(quoteFileName('현장', '2026-07-29', 2))).toBe(false);
  });

  it('한글 현장명을 그대로 쓴다', () => {
    expect(quoteFileName('삼성전자 DSR A타워 29층', '2026-08-07', 2)).toBe(
      '견적서_삼성전자 DSR A타워 29층_260807.xlsx',
    );
  });
});

describe('quoteFileName — 날짜', () => {
  it('YYMMDD 로 자른다', () => {
    expect(quoteFileName('현장', '2026-01-02', 2)).toContain('_260102');
  });

  it('시차 변환을 하지 않는다 — 아침에 만든 견적이 전날이 되면 안 된다', () => {
    // `new Date('2026-01-01')` 는 UTC 자정이라 한국에서 현지 시각으로 읽으면
    // 09:00 이고, 반대로 다루면 전날이 된다. 글자를 그대로 자른다.
    expect(quoteFileName('현장', '2026-01-01', 2)).toContain('_260101');
    expect(quoteFileName('현장', '2026-12-31', 2)).toContain('_261231');
  });

  it('달력에 없는 날짜를 거부한다', () => {
    expect(() => quoteFileName('현장', '2026-02-30', 2)).toThrow(FileNameError);
    expect(() => quoteFileName('현장', '2026-13-01', 2)).toThrow(FileNameError);
    expect(() => quoteFileName('현장', '2026-00-10', 2)).toThrow(FileNameError);
  });

  it('윤년 2월 29일은 받는다', () => {
    expect(quoteFileName('현장', '2028-02-29', 2)).toContain('_280229');
    expect(() => quoteFileName('현장', '2026-02-29', 2)).toThrow(FileNameError);
  });

  it('꼴이 틀리면 거부한다', () => {
    expect(() => quoteFileName('현장', '26-07-29', 2)).toThrow(FileNameError);
    expect(() => quoteFileName('현장', '2026/07/29', 2)).toThrow(FileNameError);
    expect(() => quoteFileName('현장', '', 2)).toThrow(FileNameError);
  });
});

describe('quoteFileName — 현장명', () => {
  it('빈 현장명은 「현장명」으로 채운다', () => {
    expect(quoteFileName('', '2026-07-29', 2)).toBe('견적서_현장명_260729.xlsx');
    expect(quoteFileName('   ', '2026-07-29', 2)).toBe('견적서_현장명_260729.xlsx');
  });

  it('파일명에 쓸 수 없는 글자를 뺀다', () => {
    const name = quoteFileName('A/B:C*D?E"F<G>H|I', '2026-07-29', 2);
    expect(name).toBe('견적서_A B C D E F G H I_260729.xlsx');
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
  });

  it('끝의 마침표를 뗀다 — 윈도우가 조용히 떼어낸다', () => {
    expect(quoteFileName('현장...', '2026-07-29', 2)).toBe(
      '견적서_현장_260729.xlsx',
    );
  });

  it('150자를 넘지 않는다', () => {
    const long = '가'.repeat(300);
    for (const level of [0, 1, 2] as const) {
      const name = quoteFileName(long, '2026-07-29', level);
      expect(name.length, `등급 ${level}`).toBeLessThanOrEqual(150);
    }
  });

  it('길어도 꼬리표를 자르지 않는다 — 사내용이 고객용처럼 보이면 안 된다', () => {
    const long = '가'.repeat(300);
    expect(quoteFileName(long, '2026-07-29', 0).endsWith('_원.xlsx')).toBe(true);
    expect(
      quoteFileName(long, '2026-07-29', 1).endsWith('(설명+품셈포함).xlsx'),
    ).toBe(true);
    expect(isInternalFileName(quoteFileName(long, '2026-07-29', 1))).toBe(true);
  });

  it('날짜도 자르지 않는다', () => {
    expect(quoteFileName('가'.repeat(300), '2026-07-29', 2)).toContain('_260729');
  });
});
