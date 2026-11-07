/**
 * Implant position files -> ImplantSite[] (spec 3.3). The content decides the format; the extension is
 * only used to refuse native vendor projects and spreadsheets. Unknown formats are refused, never guessed.
 *
 * Errors (details): FILE_EMPTY; FILE_TOO_LARGE {limitBytes, bytes}; FORMAT_UNSUPPORTED {reason:
 * 'nativeVendorFormat' | 'spreadsheet'}; TEXT_ENCODING {reason: 'invalid' | 'nul'}; FORMAT_UNKNOWN;
 * plus the errors of xml.ts and of each family parser.
 */
import { XchangeError } from '../../core/errors';
import { LIMITS } from '../../core/limits';
import { decodeText } from '../../core/text';
import type { PositionFormat } from '../../core/types';
import { unsupported, type ParsedPositions } from './common';
import { parseICamPoints } from './icam';
import { parsePositionsJSON } from './json';
import { isMatrixXmlRoot, matrixXmlFromXml } from './matrix-xml';
import { parseMicronMapperCSV } from './micronmapper';
import { hasScanAdaptor, scanAdaptorsFromXml } from './scanadaptor';
import { parseMatrixTable } from './table';
import { parseXml } from './xml';

export type { ParsedPositions } from './common';
export type { XmlElement } from './xml';
export { parseXml } from './xml';
export { parseMicronMapperCSV } from './micronmapper';
export { parseScanAdaptorXML } from './scanadaptor';
export { parseMatrixTable } from './table';
export { parsePositionsJSON } from './json';
export { parseMatrixXML } from './matrix-xml';
export { parseICamPoints } from './icam';

export interface PositionParseOptions {
  /** Lower-case extension without the dot. Only used to refuse native vendor files and spreadsheets. */
  extension?: string;
}

const NATIVE_VENDOR = new Set(['pic', 'tupel', 'beb']);
const SPREADSHEET = new Set(['xlsx', 'xls']);
const SPREADSHEET_NS = 'urn:schemas-microsoft-com:office:spreadsheet'; // Excel 2003 XML
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]; // binary .xls

const startsWith = (bytes: Uint8Array, magic: readonly number[]): boolean => magic.every((b, k) => bytes[k] === b);

export function parsePositions(input: Uint8Array | string, options: PositionParseOptions = {}): ParsedPositions {
  // ponytail: a string is measured in UTF-16 code units (never fewer than its UTF-8 bytes).
  const bytes = typeof input === 'string' ? input.length : input.byteLength;
  if (bytes === 0) throw new XchangeError('FILE_EMPTY');
  const limitBytes = LIMITS.positions.maxBytes;
  if (bytes > limitBytes) throw new XchangeError('FILE_TOO_LARGE', { limitBytes, bytes });
  const extension = (options.extension ?? '').toLowerCase().replace(/^\./, '');
  if (NATIVE_VENDOR.has(extension)) throw unsupported('nativeVendorFormat');
  if (SPREADSHEET.has(extension)) throw unsupported('spreadsheet');
  let text: string;
  if (typeof input === 'string') {
    if (input.includes('\u0000')) throw new XchangeError('TEXT_ENCODING', { reason: 'nul' });
    text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  } else {
    if (startsWith(input, ZIP_MAGIC) || startsWith(input, CFB_MAGIC)) throw unsupported('spreadsheet');
    text = decodeText(input);
  }
  const head = text.trimStart();
  if (!head) throw new XchangeError('FILE_EMPTY');

  if (head.startsWith('<')) {
    if (head.includes(SPREADSHEET_NS)) throw unsupported('spreadsheet');
    const root = parseXml(head);
    if (hasScanAdaptor(root)) return scanAdaptorsFromXml(root);
    if (isMatrixXmlRoot(root)) return matrixXmlFromXml(root);
    throw new XchangeError('FORMAT_UNKNOWN');
  }
  switch (detectPositionFormat(head)) {
    case 'positions-json':
      return parsePositionsJSON(text);
    case 'icam-txt':
      return parseICamPoints(text);
    case 'micronmapper-csv':
      return parseMicronMapperCSV(text);
    case 'matrix-table':
      return parseMatrixTable(text);
    default:
      throw new XchangeError('FORMAT_UNKNOWN');
  }
}

const ICAM_RECORD = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,39}_(?:Origin|X|Y|Z)\s+[+.\d-]/u;
const MARKER_ROW = /^"?(?:AXO|AHY)\d+"?[ \t]*[,;\t]/;
const APPLICATION_ROW = /^"?Application:"?[ \t]*[,;\t]/;
const TABLE_IDENTITY = /\b(?:name|label|position|toothnumber|marker)\b/i;
const TABLE_MATRIX = /\b(?:mat[0-3]|m[0-3][0-3]|origin[xyz]|axis[xyz]|indexed[xyz])\b/i;

/**
 * Content-based (spec 3.3 priority): XML (ScanAdaptor, then ImplantPositions), JSON, iCam points,
 * MicronMapper, then a table header. Never throws; null when nothing matches.
 */
export function detectPositionFormat(text: string): PositionFormat | null {
  try {
    const head = text.trimStart();
    if (head.startsWith('<')) {
      if (head.includes(SPREADSHEET_NS)) return null;
      const root = parseXml(head);
      return hasScanAdaptor(root) ? 'scanadaptor-xml' : isMatrixXmlRoot(root) ? 'matrix-xml' : null;
    }
    if (head.startsWith('{') || head.startsWith('[')) return 'positions-json';
    const lines = head.split(/\r\n?|\n/);
    const first: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && first.push(trimmed) === 2) break;
    }
    if (first.some((line) => ICAM_RECORD.test(line))) return 'icam-txt';
    if (MARKER_ROW.test(first[0] ?? '') || lines.some(isMicronMapperApplication)) return 'micronmapper-csv';
    if (first.some((line) => TABLE_IDENTITY.test(line) && TABLE_MATRIX.test(line))) return 'matrix-table';
    return null;
  } catch {
    return null; // e.g. malformed or oversized XML: the parser reports the specific error
  }
}

function isMicronMapperApplication(line: string): boolean {
  const trimmed = line.trim();
  const match = APPLICATION_ROW.exec(trimmed);
  if (!match) return false;
  const value = trimmed.slice(match[0].length).trimStart();
  return (value.startsWith('"') ? value.slice(1).trimStart() : value).toLowerCase().startsWith('micronmapper');
}
