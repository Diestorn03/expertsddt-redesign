/**
 * Synthetic position-file encoders for the io/positions tests: every family is written from the same
 * frames (makeFrames). Numbers use String(v), which parses back to the identical float64, except
 * MicronMapper, which rounds to 6 decimals like the real exports. No real file is ever read.
 */
import { getColumn } from '../../core/mat4';
import type { Mat4 } from '../../core/types';

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** BOM + UTF-16 code units. */
export function utf16(text: string, littleEndian = true): Uint8Array {
  const out = new Uint8Array(2 + 2 * text.length);
  out.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(2 + 2 * i, text.charCodeAt(i), littleEndian);
  return out;
}

/** Labels that exercise the label rule (digits, '-', '_', '.', a space); index 3 has the space. */
export function positionLabels(n: number): string[] {
  const pool = ['11', '12', 'A-3', 'Implant 4', 'x_5', '2.6', '47', '48'];
  return Array.from({ length: n }, (_, i) => pool[i] ?? `P${i + 1}`);
}

/** Same labels without spaces (iCam names cannot contain one). */
export const compactLabels = (n: number): string[] => positionLabels(n).map((label) => label.replaceAll(' ', '_'));

export const micronMapperMarkers = (prefix: 'AXO' | 'AHY', n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);

const num = (v: number): string => String(v);
const rowsOf = (m: Mat4): number[][] => [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => m[r * 4 + c]!));
const xmlEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export interface MicronMapperOptions {
  version?: '1.4' | '1.6';
  delimiter?: ',' | ';' | '\t';
  crlf?: boolean;
  /** Quote every field. */
  quote?: boolean;
}

/** Marker rows (origin, +Z, +X; 6 decimals), Camera / Max divergence angle rows, Application footer. */
export function encodeMicronMapperCSV(frames: readonly Mat4[], options: MicronMapperOptions = {}): string {
  const { version = '1.4', delimiter = ',' } = options;
  const markers = micronMapperMarkers(version === '1.4' ? 'AXO' : 'AHY', frames.length);
  const cell = (s: string): string => (options.quote ? `"${s}"` : s);
  const line = (cells: string[]): string => cells.map(cell).join(delimiter);
  const rows = frames.map((m, i) =>
    line([markers[i]!, ...[...getColumn(m, 3), ...getColumn(m, 2), ...getColumn(m, 0)].map((v) => v.toFixed(6))]),
  );
  rows.push(line(['Camera:', 'SN-0000']), line(['Max divergence angle:', '0.25']), line(['Application:', `MicronMapper V${version}.2.7`]));
  return rows.join(options.crlf ? '\r\n' : '\n') + '\n';
}

export function encodeScanAdaptorXML(frames: readonly Mat4[], labels: readonly string[], options: { units?: string } = {}): string {
  const units = options.units === undefined ? '' : ` units="${options.units}"`;
  const adaptors = frames.map((m, i) => {
    const mats = rowsOf(m).map((r, k) => `    <Mat${k}>${r.map(num).join(';')}</Mat${k}>`);
    return ['  <ScanAdaptor>', `    <ToothNumber>${xmlEscape(labels[i]!)}</ToothNumber>`, ...mats, '  </ScanAdaptor>'].join('\n');
  });
  return `<?xml version="1.0" encoding="utf-8"?>\n<ScanAdaptors${units}>\n${adaptors.join('\n')}\n</ScanAdaptors>\n`;
}

export type TableSchema = 'rows' | 'matrix' | 'axis';
export type TableDelimiter = ',' | ';' | '\t' | '|' | ' ';

export interface TableOptions {
  schema?: TableSchema;
  delimiter?: TableDelimiter;
  /** 'line' = `units<delimiter>mm`, 'colonLine' = `units: mm`, 'column' = a units column. */
  units?: 'none' | 'line' | 'colonLine' | 'column';
  /** Header of the identity column (default Name, or Marker for the axis schema). */
  identity?: string;
  crlf?: boolean;
}

export function encodeMatrixTable(frames: readonly Mat4[], labels: readonly string[], options: TableOptions = {}): string {
  const { schema = 'matrix', delimiter = ',', units = 'none' } = options;
  const identity = options.identity ?? (schema === 'axis' ? 'Marker' : 'Name');
  const quote = (cell: string): string =>
    cell.includes('"') || cell.includes(delimiter) || (delimiter === ' ' && /\s/.test(cell)) ? `"${cell.replaceAll('"', '""')}"` : cell;
  const columns =
    schema === 'rows'
      ? ['Mat0', 'Mat1', 'Mat2', 'Mat3']
      : schema === 'matrix'
        ? Array.from({ length: 16 }, (_, k) => `m${k >> 2}${k & 3}`)
        : ['originX', 'originY', 'originZ', 'axisX', 'axisY', 'axisZ', 'indexedX', 'indexedY', 'indexedZ'];
  const cellsOf = (m: Mat4): string[] =>
    schema === 'rows'
      ? rowsOf(m).map((r) => r.map(num).join(';'))
      : schema === 'matrix'
        ? Array.from(m, num)
        : [...getColumn(m, 3), ...getColumn(m, 2), ...getColumn(m, 0)].map(num);
  const withUnits = units === 'column';
  const lines: string[] = [];
  if (units === 'line') lines.push(['units', 'mm'].join(delimiter));
  if (units === 'colonLine') lines.push('units: mm');
  lines.push([identity, ...columns, ...(withUnits ? ['Units'] : [])].map(quote).join(delimiter));
  frames.forEach((m, i) => lines.push([labels[i]!, ...cellsOf(m), ...(withUnits ? ['mm'] : [])].map(quote).join(delimiter)));
  return lines.join(options.crlf ? '\r\n' : '\n') + '\n';
}

export interface JsonOptions {
  shape?: 'object' | 'array' | 'single';
  /** 4 rows of 4 instead of 16 numbers. */
  nested?: boolean;
  /** Root `format: "expertsddt-positions"` instead of an explicit matrixOrder. */
  canonical?: boolean;
}

export function encodePositionsJSON(frames: readonly Mat4[], labels: readonly string[], options: JsonOptions = {}): string {
  const matrix = (m: Mat4): number[] | number[][] => (options.nested ? rowsOf(m) : Array.from(m));
  const explicit = { units: 'mm', matrixOrder: 'row-major' };
  if (options.shape === 'single') return JSON.stringify({ name: labels[0], ...explicit, matrix: matrix(frames[0]!) });
  if (options.shape === 'array') return JSON.stringify(frames.map((m, i) => ({ name: labels[i], ...explicit, matrix: matrix(m) })));
  const head = options.canonical ? { format: 'expertsddt-positions', units: 'mm' } : explicit;
  return JSON.stringify({ ...head, positions: frames.map((m, i) => ({ name: labels[i], matrix: matrix(m) })) }, null, 2);
}

export interface MatrixXmlOptions {
  /** 16 addressed <Entry> elements instead of a text matrix. */
  entries?: boolean;
  indexBase?: 0 | 1;
  /** Entry value as attribute (default) or as text. */
  valueAs?: 'attribute' | 'text';
  separator?: ' ' | ',' | ';';
}

export function encodeMatrixXML(frames: readonly Mat4[], labels: readonly string[], options: MatrixXmlOptions = {}): string {
  const base = options.indexBase ?? 0;
  const separator = options.separator ?? ' ';
  const positions = frames.map((m, i) => {
    let matrix: string;
    if (options.entries) {
      const entries = Array.from(m, (v, k) => {
        const address = `row="${(k >> 2) + base}" column="${(k & 3) + base}"`;
        return options.valueAs === 'text' ? `<Entry ${address}>${num(v)}</Entry>` : `<Entry ${address} value="${num(v)}"/>`;
      }).reverse(); // addressed: the order must not matter
      matrix = `<Matrix4x4${base ? ' indexBase="1"' : ''}>\n      ${entries.join('\n      ')}\n    </Matrix4x4>`;
    } else {
      matrix = `<Matrix4x4>${rowsOf(m).map((r) => r.map(num).join(separator)).join(separator === ' ' ? '  ' : separator)}</Matrix4x4>`;
    }
    return `  <Position name="${xmlEscape(labels[i]!)}">\n    ${matrix}\n  </Position>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ImplantPositions units="mm" matrixOrder="row-major">\n${positions.join('\n')}\n</ImplantPositions>\n`;
}

/** name_Origin / name_X / name_Y / name_Z endpoint lines (axis endpoints at axisLength mm), CRLF. */
export function encodeICamPoints(frames: readonly Mat4[], labels: readonly string[], options: { axisLength?: number; units?: boolean } = {}): string {
  const length = options.axisLength ?? 10;
  const lines = options.units ? ['units: mm'] : [];
  frames.forEach((m, i) => {
    const origin = getColumn(m, 3);
    const endpoint = (c: 0 | 1 | 2): string => getColumn(m, c).map((v, k) => num(origin[k]! + length * v)).join(' ');
    lines.push(`${labels[i]}_Origin ${origin.map(num).join(' ')}`, `${labels[i]}_X ${endpoint(0)}`, `${labels[i]}_Y ${endpoint(1)}`, `${labels[i]}_Z ${endpoint(2)}`);
  });
  return lines.join('\r\n') + '\r\n';
}
