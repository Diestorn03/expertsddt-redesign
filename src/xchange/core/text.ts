/** Strict text decoding and number parsing shared by every text parser. */
import { XchangeError } from './errors';

/**
 * UTF-8 (BOM optional) or BOM-marked UTF-16 LE/BE. Invalid sequences and NUL characters throw
 * TEXT_ENCODING (UTF-16 without a BOM decodes as UTF-8 full of NULs, so it is rejected too).
 */
export function decodeText(bytes: Uint8Array): string {
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes); // strips the BOM itself
  } catch {
    throw new XchangeError('TEXT_ENCODING', { reason: 'invalid' });
  }
  if (text.includes('\u0000')) throw new XchangeError('TEXT_ENCODING', { reason: 'nul' });
  return text;
}

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Plain decimal only ("1", "-2.5e-3", ".5"); null for "", "0x1F", "Infinity", "1,5", overflow. */
export function parseStrictNumber(token: string): number | null {
  if (!DECIMAL.test(token)) return null;
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}
