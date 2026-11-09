import { describe, expect, it } from 'vitest';
import { ERROR_CODES, XchangeError, fromErrorPayload, isXchangeError, toErrorPayload } from './errors';
import { decodeText, parseStrictNumber } from './text';

describe('errors', () => {
  it('carries a stable code and details, and survives a worker round trip', () => {
    const e = new XchangeError('FILE_TOO_LARGE', { limitBytes: 10, bytes: 20 });
    expect(e).toBeInstanceOf(Error);
    expect(isXchangeError(e)).toBe(true);
    expect(e.code).toBe('FILE_TOO_LARGE');
    const back = fromErrorPayload(structuredClone(toErrorPayload(e)));
    expect(back.code).toBe('FILE_TOO_LARGE');
    expect(back.details).toEqual({ limitBytes: 10, bytes: 20 });
  });

  it('turns unknown errors into INTERNAL without leaking their message', () => {
    const payload = toErrorPayload(new Error('C:/patients/Jane Doe upper.stl not found'));
    expect(payload).toEqual({ code: 'INTERNAL', details: { reason: 'unexpected' } });
    expect(JSON.stringify(payload)).not.toContain('Jane');
    // @ts-expect-error a forged code from a worker message is rejected
    expect(fromErrorPayload({ code: 'NOPE', details: {} }).code).toBe('INTERNAL');
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});

describe('decodeText', () => {
  const utf16 = (text: string, littleEndian: boolean): Uint8Array => {
    const out = new Uint8Array(2 + 2 * text.length);
    out.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]);
    const view = new DataView(out.buffer);
    for (let i = 0; i < text.length; i++) view.setUint16(2 + 2 * i, text.charCodeAt(i), littleEndian);
    return out;
  };

  it('accepts UTF-8 with or without BOM and BOM-marked UTF-16', () => {
    const text = 'name,m00\nÄXO1,1.5';
    const utf8 = new TextEncoder().encode(text);
    expect(decodeText(utf8)).toBe(text);
    expect(decodeText(Uint8Array.of(0xef, 0xbb, 0xbf, ...utf8))).toBe(text);
    expect(decodeText(utf16(text, true))).toBe(text);
    expect(decodeText(utf16(text, false))).toBe(text);
  });

  it('rejects invalid UTF-8, NUL characters and BOM-less UTF-16', () => {
    const code = (bytes: Uint8Array): string => {
      try {
        decodeText(bytes);
        return 'accepted';
      } catch (e) {
        return e instanceof XchangeError ? `${e.code}:${e.details.reason}` : 'other';
      }
    };
    expect(code(Uint8Array.of(0x61, 0xc3, 0x28))).toBe('TEXT_ENCODING:invalid');
    expect(code(Uint8Array.of(0x61, 0x00, 0x62))).toBe('TEXT_ENCODING:nul');
    expect(code(utf16('abc', true).subarray(2))).toBe('TEXT_ENCODING:nul');
  });
});

describe('parseStrictNumber', () => {
  it('accepts plain decimals only', () => {
    for (const [token, value] of [['1', 1], ['-2.5e-3', -0.0025], ['.5', 0.5], ['+7.', 7], ['0.000001', 1e-6]] as const) {
      expect(parseStrictNumber(token)).toBe(value);
    }
    for (const token of ['', ' 1', '0x1F', 'Infinity', 'NaN', '1,5', '1e999', '1.2.3', '--1']) {
      expect(parseStrictNumber(token)).toBeNull();
    }
  });
});
