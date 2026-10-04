import { describe, expect, it } from 'vitest';
import { validateQuantityInput } from '../../src/domain/quote/validateInput';

describe('validateQuantityInput', () => {
  it('빈 문자열은 거부한다', () => {
    expect(validateQuantityInput('')).toEqual({ ok: false, reason: '수량을(를) 입력하세요.' });
    expect(validateQuantityInput('   ')).toEqual({ ok: false, reason: '수량을(를) 입력하세요.' });
  });

  it('음수는 거부한다', () => {
    expect(validateQuantityInput('-1')).toMatchObject({ ok: false });
    expect(validateQuantityInput('-0.5')).toMatchObject({ ok: false });
  });

  it('잘못된 소수 형식은 거부한다', () => {
    expect(validateQuantityInput('1.2.3')).toMatchObject({ ok: false });
    expect(validateQuantityInput('abc')).toMatchObject({ ok: false });
    expect(validateQuantityInput('1.')).toMatchObject({ ok: false });
    expect(validateQuantityInput('.5')).toMatchObject({ ok: false });
  });

  it('정수·소수는 허용하고 앞뒤 공백은 자른다', () => {
    expect(validateQuantityInput('1')).toEqual({ ok: true, value: '1' });
    expect(validateQuantityInput('  38  ')).toEqual({ ok: true, value: '38' });
    expect(validateQuantityInput('1.5')).toEqual({ ok: true, value: '1.5' });
    expect(validateQuantityInput('0')).toEqual({ ok: true, value: '0' });
  });
});
