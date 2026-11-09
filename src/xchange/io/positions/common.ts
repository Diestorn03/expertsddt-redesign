/**
 * Pieces shared by the position-file families: site building (label, uniqueness, rigidity, count limit),
 * mm / row-major declarations, a strict delimited-text lexer and the rule that every delimiter that parses
 * must give the same data.
 *
 * Errors thrown here (details):
 * - POSITIONS_MALFORMED {format, reason, row?}: 'quoting' | 'tooManyRows' | 'tooManyColumns' | 'notText' |
 *   'declarationRepeated' | 'matrixOrder' | 'matrixOrderMissing'
 * - FORMAT_UNSUPPORTED {reason}: 'columnMajor' | 'quaternion'
 * - POSITIONS_AMBIGUOUS {format}; POSITIONS_EMPTY {format}; FORMAT_UNKNOWN
 * - LABEL_INVALID {row}; LABEL_DUPLICATE {row}; TOO_MANY_POSITIONS {limit}
 * - MATRIX_INVALID {reason: 'shape' | core/mat4 reasons, row}; MATRIX_NOT_RIGID {reason (core/mat4), row}
 * - NUMBER_INVALID {row}; UNITS_NOT_MM {row?}
 * `row` is the 1-based record (table / CSV), line (iCam) or position number (JSON, XML).
 */
import { XchangeError, type XchangeWarning } from '../../core/errors';
import { LIMITS, PARSE_LIMITS, RIGID_TOLERANCE } from '../../core/limits';
import { fromAxes, validateRigid } from '../../core/mat4';
import { parseStrictNumber } from '../../core/text';
import type { ImplantSite, Mat4, PositionFormat, Vec3 } from '../../core/types';
import { cross } from '../../core/vec3';
import type { XmlElement } from './xml';

export interface ParsedPositions {
  sites: ImplantSite[];
  format: PositionFormat;
  warnings: XchangeWarning[];
}

export function malformed(format: PositionFormat, reason: string, row?: number): XchangeError {
  return new XchangeError('POSITIONS_MALFORMED', row === undefined ? { format, reason } : { format, reason, row });
}

export function unsupported(reason: string): XchangeError {
  return new XchangeError('FORMAT_UNSUPPORTED', { reason });
}

/** Plain decimal (surrounding whitespace ignored) or NUMBER_INVALID {row}. */
export function number(token: string, row: number): number {
  const value = parseStrictNumber(token.trim());
  if (value === null) throw new XchangeError('NUMBER_INVALID', { row });
  return value;
}

/** One matrix row written "a;b;c;d" (ScanAdaptor Mat0..Mat3, table Mat cells). */
export function matRow(cell: string, row: number): number[] {
  const parts = cell.split(';');
  if (parts.length !== 4) throw new XchangeError('MATRIX_INVALID', { reason: 'shape', row });
  return parts.map((part) => number(part, row));
}

/** origin XYZ, +Z axis XYZ, indexed +X XYZ as written (not normalised) -> frame with Y = Z × X. */
export function frameFromOriginAxes(v: readonly number[]): Mat4 {
  const x: Vec3 = [v[6]!, v[7]!, v[8]!];
  const z: Vec3 = [v[3]!, v[4]!, v[5]!];
  return fromAxes(x, cross(z, x), z, [v[0]!, v[1]!, v[2]!]);
}

const LABEL = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;

/** Collects sites in file order with the rules every family shares (CONTRACTS.md, io/positions). */
export class SiteCollector {
  readonly sites: ImplantSite[] = [];
  private readonly labels = new Set<string>();
  private readonly format: PositionFormat;

  constructor(format: PositionFormat) {
    this.format = format;
  }

  add(rawLabel: string, values: ArrayLike<number>, row: number, tolerance: number = RIGID_TOLERANCE): void {
    const limit = LIMITS.positions.maxPositions;
    if (this.sites.length >= limit) throw new XchangeError('TOO_MANY_POSITIONS', { limit });
    const label = rawLabel.trim().normalize('NFC');
    if (!LABEL.test(label)) throw new XchangeError('LABEL_INVALID', { row });
    if (this.labels.has(label)) throw new XchangeError('LABEL_DUPLICATE', { row });
    let matrix: Mat4;
    try {
      matrix = validateRigid(values, tolerance);
    } catch (error) {
      throw error instanceof XchangeError ? new XchangeError(error.code, { ...error.details, row }) : error;
    }
    this.labels.add(label);
    this.sites.push({ id: `site-${this.sites.length + 1}`, label, matrix, source: this.format, flags: {} });
  }

  result(warnings: XchangeWarning[] = []): ParsedPositions {
    if (!this.sites.length) throw new XchangeError('POSITIONS_EMPTY', { format: this.format });
    return { sites: this.sites, format: this.format, warnings };
  }
}

const MILLIMETRES = /^(?:mm|millimet(?:er|re)s?)$/i;

/** Declared units must be millimetres; nothing is ever converted. */
export function requireMm(value: string, row?: number): void {
  if (!MILLIMETRES.test(value.trim())) throw new XchangeError('UNITS_NOT_MM', row === undefined ? {} : { row });
}

/** Row-major passes; column-major and quaternions are refused, never transposed or converted. */
export function requireRowMajor(value: string | undefined, format: PositionFormat, row?: number): void {
  if (value === undefined) throw malformed(format, 'matrixOrderMissing', row);
  const order = value.trim();
  if (/^row[-_ ]?major$/i.test(order)) return;
  if (/^col(?:umn)?[-_ ]?major$/i.test(order)) throw unsupported('columnMajor');
  if (/quaternion/i.test(order)) throw unsupported('quaternion');
  throw malformed(format, 'matrixOrder', row);
}

/**
 * Value declared on an XML element as attribute `attribute` (camelCase) or its Capitalised spelling, or as
 * one text-only child element `element`. Trimmed; undefined when absent; two declarations are refused.
 */
export function declared(el: XmlElement, attribute: string, element: string, format: PositionFormat, row?: number): string | undefined {
  const values: string[] = [];
  for (const key of [attribute, attribute[0]!.toUpperCase() + attribute.slice(1)]) {
    const value = el.attributes[key];
    if (value !== undefined) values.push(value);
  }
  for (const child of el.children) {
    if (child.name !== element) continue;
    if (child.children.length) throw malformed(format, 'notText', row);
    values.push(child.text);
  }
  if (values.length > 1) throw malformed(format, 'declarationRepeated', row);
  return values[0]?.trim();
}

/** ' ' means "runs of spaces and tabs". */
export type Delimiter = ',' | ';' | '\t' | '|' | ' ';

export interface TextRecord {
  /** 1-based record number, empty lines included (the row a spreadsheet shows). */
  row: number;
  /** Trimmed fields without trailing empty ones; never empty. */
  fields: string[];
}

/**
 * Strict delimited-text lexer: RFC 4180 quotes ("" escapes, quoted line breaks), LF / CRLF / CR records,
 * empty records skipped, at most PARSE_LIMITS.tableMaxRows records of tableMaxColumns fields. A quote
 * inside an unquoted field, text after a closing quote or an unterminated quote -> 'quoting'.
 */
export function lexDelimited(text: string, delimiter: Delimiter, format: PositionFormat): TextRecord[] {
  const records: TextRecord[] = [];
  const blanks = delimiter === ' ';
  const n = text.length;
  const isSep = (c: string | undefined): boolean => (blanks ? c === ' ' || c === '\t' : c === delimiter);
  const isPad = (c: string | undefined): boolean => !blanks && (c === ' ' || c === '\t') && c !== delimiter;
  const isBreak = (c: string | undefined): boolean => c === '\n' || c === '\r';
  let i = 0;
  let row = 1;
  let fields: string[] = [];
  if (blanks) while (i < n && isSep(text[i])) i++;
  for (;;) {
    while (i < n && isPad(text[i])) i++;
    let value = '';
    if (text[i] === '"') {
      let from = ++i;
      for (;;) {
        const quote = text.indexOf('"', i);
        if (quote < 0) throw malformed(format, 'quoting', row);
        if (text[quote + 1] !== '"') {
          value += text.slice(from, quote);
          i = quote + 1;
          break;
        }
        value += text.slice(from, quote + 1);
        i = from = quote + 2;
      }
      while (i < n && isPad(text[i])) i++;
      if (i < n && !isSep(text[i]) && !isBreak(text[i])) throw malformed(format, 'quoting', row);
    } else {
      const from = i;
      while (i < n && !isSep(text[i]) && !isBreak(text[i])) {
        if (text[i] === '"') throw malformed(format, 'quoting', row);
        i++;
      }
      value = text.slice(from, i);
    }
    fields.push(value.trim());
    if (fields.length > PARSE_LIMITS.tableMaxColumns) throw malformed(format, 'tooManyColumns', row);
    if (blanks) while (i < n && isSep(text[i])) i++;
    if (i < n && !isBreak(text[i])) {
      if (!blanks) i++; // the delimiter
      continue;
    }
    while (fields.length && fields[fields.length - 1] === '') fields.pop();
    if (fields.length) {
      if (records.length >= PARSE_LIMITS.tableMaxRows) throw malformed(format, 'tooManyRows');
      records.push({ row, fields });
    }
    if (i >= n) return records;
    i += text[i] === '\r' && text[i + 1] === '\n' ? 2 : 1;
    row++;
    fields = [];
    if (blanks) while (i < n && isSep(text[i])) i++;
  }
}

function sameSites(a: readonly ImplantSite[], b: readonly ImplantSite[]): boolean {
  return a.length === b.length && a.every((site, k) => site.label === b[k]!.label && site.matrix.every((v, j) => v === b[k]!.matrix[j]));
}

/**
 * Lexes `text` with each delimiter and interprets the records. Every delimiter that parses must give the
 * same labels and matrices (else POSITIONS_AMBIGUOUS). When none parses, rethrows the error of the
 * delimiter whose records scored highest, if that score reaches `minScore`; else the first lexing error;
 * else FORMAT_UNKNOWN (nothing looked like this format: skipped, not guessed).
 */
export function parseWithDelimiters(
  text: string,
  format: PositionFormat,
  delimiters: readonly Delimiter[],
  interpret: (records: TextRecord[]) => ParsedPositions,
  score: (records: TextRecord[]) => number,
  minScore: number,
): ParsedPositions {
  let found: ParsedPositions | undefined;
  let best: { score: number; error: unknown } | undefined;
  let lexError: unknown;
  for (const delimiter of delimiters) {
    let records: TextRecord[];
    try {
      records = lexDelimited(text, delimiter, format);
    } catch (error) {
      lexError ??= error;
      continue;
    }
    let parsed: ParsedPositions;
    try {
      parsed = interpret(records);
    } catch (error) {
      const value = score(records);
      if (!best || value > best.score) best = { score: value, error };
      continue;
    }
    if (found && !sameSites(found.sites, parsed.sites)) throw new XchangeError('POSITIONS_AMBIGUOUS', { format });
    found ??= parsed;
  }
  if (found) return found;
  if (best && best.score >= minScore) throw best.error;
  throw lexError ?? new XchangeError('FORMAT_UNKNOWN');
}
