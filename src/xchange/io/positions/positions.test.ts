import { describe, expect, it } from 'vitest';
import { ERROR_CODES, XchangeError } from '../../core/errors';
import { LIMITS } from '../../core/limits';
import { identity, maxAbsDiff } from '../../core/mat4';
import { createRng, type Rng } from '../../core/sampling';
import type { Mat4 } from '../../core/types';
import { makeFrames } from '../../test/fixtures';
import {
  compactLabels,
  encodeICamPoints,
  encodeMatrixTable,
  encodeMatrixXML,
  encodeMicronMapperCSV,
  encodeMicronMapperExport,
  encodePositionsJSON,
  encodeScanAdaptorXML,
  micronMapperMarkers,
  positionLabels,
  utf16,
  utf8,
} from '../../test/fixtures/positions';
import { parseWithDelimiters, SiteCollector, type ParsedPositions, type TextRecord } from './common';
import {
  detectPositionFormat,
  parseICamPoints,
  parseMatrixTable,
  parseMatrixXML,
  parseMicronMapperCSV,
  parsePositions,
  parsePositionsJSON,
  parseScanAdaptorXML,
} from './index';

function expectSites(parsed: ParsedPositions, frames: readonly Mat4[], labels: readonly string[], format: string, tolerance = 1e-9): void {
  expect(parsed.format).toBe(format);
  expect(parsed.sites.map((s) => s.label)).toEqual(labels);
  parsed.sites.forEach((site, i) => {
    expect(site.id).toBe(`site-${i + 1}`);
    expect(site.source).toBe(format);
    expect(site.flags).toEqual({});
    expect(maxAbsDiff(site.matrix, frames[i]!)).toBeLessThanOrEqual(tolerance);
  });
}

function errorOf(fn: () => unknown): XchangeError {
  try {
    fn();
  } catch (e) {
    if (e instanceof XchangeError) return e;
    throw e;
  }
  throw new Error('expected an XchangeError');
}

/** "CODE:reason" of the XchangeError thrown by fn ("CODE:" without a reason). */
const failure = (fn: () => unknown): string => {
  const e = errorOf(fn);
  return `${e.code}:${String(e.details.reason ?? '')}`;
};

const CASES = [
  { arch: 'lower', frames: makeFrames(6, 'lower') },
  { arch: 'upper', frames: makeFrames(5, 'upper', 11) },
];

describe.each(CASES)('every family written from the same frames ($arch arch)', ({ frames }) => {
  const labels = positionLabels(frames.length);

  it('MicronMapper V1.4 AXO / V1.6 AHY with every delimiter, quoted and CRLF (6 decimals)', () => {
    for (const version of ['1.4', '1.6'] as const) {
      const markers = micronMapperMarkers(version === '1.4' ? 'AXO' : 'AHY', frames.length);
      for (const delimiter of [',', ';', '\t'] as const) {
        for (const variant of [{}, { quote: true, crlf: true }]) {
          const text = encodeMicronMapperCSV(frames, { version, delimiter, ...variant });
          expect(detectPositionFormat(text)).toBe('micronmapper-csv');
          const parsed = parsePositions(utf8(text));
          expectSites(parsed, frames, markers, 'micronmapper-csv', 1e-5);
          expect(parsed.warnings).toEqual([]);
        }
      }
    }
    expectSites(parseMicronMapperCSV(encodeMicronMapperCSV(frames)), frames, micronMapperMarkers('AXO', frames.length), 'micronmapper-csv', 1e-5);
  });

  it('ScanAdaptor XML with and without units, UTF-8 and BOM-marked UTF-16 LE / BE', () => {
    for (const units of [undefined, 'mm']) {
      const text = encodeScanAdaptorXML(frames, labels, { units });
      expect(detectPositionFormat(text)).toBe('scanadaptor-xml');
      for (const bytes of [utf8(text), utf16(text, true), utf16(text, false)]) expectSites(parsePositions(bytes), frames, labels, 'scanadaptor-xml');
      expectSites(parseScanAdaptorXML(text), frames, labels, 'scanadaptor-xml');
    }
  });

  it('matrix tables: Mat0..Mat3, m00..m33 and marker + axes, with 5 delimiters and every unit style', () => {
    for (const schema of ['rows', 'matrix', 'axis'] as const) {
      for (const delimiter of [',', ';', '\t', '|', ' '] as const) {
        for (const units of ['none', 'line', 'colonLine', 'column'] as const) {
          const text = encodeMatrixTable(frames, labels, { schema, delimiter, units, crlf: delimiter === ';' });
          expect([schema, delimiter, units, detectPositionFormat(text)]).toEqual([schema, delimiter, units, 'matrix-table']);
          const parsed = parsePositions(utf8(text));
          expectSites(parsed, frames, labels, 'matrix-table');
          expect(parsed.warnings).toEqual(units === 'none' ? [{ code: 'UNITS_ASSUMED_MM' }] : []);
        }
      }
    }
    // Tab and whitespace both parse this one; they agree, so it is accepted.
    const compact = compactLabels(frames.length);
    expectSites(parseMatrixTable(encodeMatrixTable(frames, compact, { delimiter: '\t' })), frames, compact, 'matrix-table');
  });

  it('JSON: positions object, bare array, single object, nested rows, canonical format', () => {
    const variants = [{}, { nested: true }, { canonical: true }, { shape: 'array' }, { shape: 'array', nested: true }] as const;
    for (const options of variants) {
      const text = encodePositionsJSON(frames, labels, options);
      expect(detectPositionFormat(text)).toBe('positions-json');
      expectSites(parsePositions(utf8(text)), frames, labels, 'positions-json');
    }
    const single = encodePositionsJSON(frames, labels, { shape: 'single' });
    expectSites(parsePositionsJSON(single), frames.slice(0, 1), labels.slice(0, 1), 'positions-json');
  });

  it('ImplantPositions XML: text matrices with any separator and addressed entries', () => {
    const variants = [
      {},
      { separator: ',' },
      { separator: ';' },
      { entries: true },
      { entries: true, indexBase: 1 },
      { entries: true, valueAs: 'text' },
    ] as const;
    for (const options of variants) {
      const text = encodeMatrixXML(frames, labels, options);
      expect(detectPositionFormat(text)).toBe('matrix-xml');
      expectSites(parsePositions(utf8(text)), frames, labels, 'matrix-xml');
    }
    const one = `<ImplantPosition units="mm"><Name>${labels[0]}</Name><Matrix4x4 Order="row-major">${Array.from(frames[0]!).join(' ')}</Matrix4x4></ImplantPosition>`;
    expectSites(parseMatrixXML(one), frames.slice(0, 1), labels.slice(0, 1), 'matrix-xml');
  });

  it('iCam TransformedPoints with equal axis lengths of any size', () => {
    const names = compactLabels(frames.length);
    for (const options of [{}, { axisLength: 1, units: true }, { axisLength: 25 }]) {
      const text = encodeICamPoints(frames, names, options);
      expect(detectPositionFormat(text)).toBe('icam-txt');
      expectSites(parsePositions(utf8(text)), frames, names, 'icam-txt');
    }
    expectSites(parseICamPoints(encodeICamPoints(frames, names)), frames, names, 'icam-txt');
  });
});

describe('parsePositions: input checks', () => {
  const frames = makeFrames(3, 'lower');
  const labels = positionLabels(3);
  const csv = encodeMatrixTable(frames, labels);

  it('accepts a decoded string, a UTF-8 BOM and BOM-marked UTF-16 for every text family', () => {
    expectSites(parsePositions(`\uFEFF${csv}`), frames, labels, 'matrix-table');
    expectSites(parsePositions(Uint8Array.of(0xef, 0xbb, 0xbf, ...utf8(csv))), frames, labels, 'matrix-table');
    expectSites(parsePositions(utf16(csv, false)), frames, labels, 'matrix-table');
    expectSites(parsePositions(utf16(encodePositionsJSON(frames, labels), true)), frames, labels, 'positions-json');
    expectSites(parsePositions(utf16(encodeMicronMapperCSV(frames), true)), frames, micronMapperMarkers('AXO', 3), 'micronmapper-csv', 1e-5);
  });

  it('survives deeply nested JSON without recursion', () => {
    const depth = 200_000;
    expect(failure(() => parsePositions(`${'['.repeat(depth)}${']'.repeat(depth)}`))).toMatch(/^POSITIONS_MALFORMED:(json|structure)$/);
    expect(failure(() => parsePositions(`{"positions":${'['.repeat(depth)}`))).toBe('POSITIONS_MALFORMED:json');
  });

  it('checks emptiness and size before decoding, vendor and spreadsheet files before parsing', () => {
    expect(failure(() => parsePositions(new Uint8Array(0)))).toBe('FILE_EMPTY:');
    expect(failure(() => parsePositions(' \r\n\t'))).toBe('FILE_EMPTY:');
    expect(failure(() => parsePositions(utf8('\uFEFF  \n')))).toBe('FILE_EMPTY:');
    const max = LIMITS.positions.maxBytes;
    expect(errorOf(() => parsePositions(new Uint8Array(max + 1)))).toMatchObject({ code: 'FILE_TOO_LARGE', details: { limitBytes: max, bytes: max + 1 } });
    expect(failure(() => parsePositions('x'.repeat(max + 1)))).toBe('FILE_TOO_LARGE:');
    for (const extension of ['pic', 'PIC', '.tupel', 'beb']) {
      expect(failure(() => parsePositions(utf8(csv), { extension }))).toBe('FORMAT_UNSUPPORTED:nativeVendorFormat');
    }
    for (const extension of ['xlsx', 'xls']) expect(failure(() => parsePositions(utf8(csv), { extension }))).toBe('FORMAT_UNSUPPORTED:spreadsheet');
    expectSites(parsePositions(utf8(csv), { extension: 'csv' }), frames, labels, 'matrix-table');
    expect(failure(() => parsePositions(Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0)))).toBe('FORMAT_UNSUPPORTED:spreadsheet');
    expect(failure(() => parsePositions(Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)))).toBe('FORMAT_UNSUPPORTED:spreadsheet');
    const spreadsheetML = '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"/>';
    expect(failure(() => parsePositions(spreadsheetML))).toBe('FORMAT_UNSUPPORTED:spreadsheet');
    expect(detectPositionFormat(spreadsheetML)).toBeNull();
    expect(failure(() => parsePositions(Uint8Array.of(0x61, 0xc3, 0x28)))).toBe('TEXT_ENCODING:invalid');
    expect(failure(() => parsePositions('name\u0000'))).toBe('TEXT_ENCODING:nul');
  });

  it('refuses content that matches no supported format', () => {
    for (const text of ['hello world', 'a,b,c\n1,2,3\n', '<Other><X/></Other>', '11 12 13\n']) {
      expect(failure(() => parsePositions(text))).toBe('FORMAT_UNKNOWN:');
    }
    expect(detectPositionFormat('a,b,c\n1,2,3')).toBeNull();
    expect(detectPositionFormat('')).toBeNull();
  });
});

describe('parsePositions: refusals (skipped, not guessed)', () => {
  const frames = makeFrames(3, 'lower');
  const labels = positionLabels(3);
  const csv = encodeMatrixTable(frames, labels);
  const matrixJSON = (position: object, root: object = { units: 'mm' }): string =>
    JSON.stringify({ ...root, positions: [{ name: 'A', matrix: Array.from(frames[0]!), ...position }] });

  it('refuses DOCTYPE, ENTITY and billion-laughs XML before reading any position', () => {
    const laughs =
      '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;">]>' +
      '<ScanAdaptors>&lol2;</ScanAdaptors>';
    expect(failure(() => parsePositions(laughs))).toBe('XML_FORBIDDEN:doctype');
    const external = '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///c:/windows/win.ini">]><ImplantPositions units="mm">&e;</ImplantPositions>';
    expect(failure(() => parsePositions(external))).toBe('XML_FORBIDDEN:doctype');
    expect(failure(() => parsePositions('<!ENTITY e "x"><ScanAdaptors/>'))).toBe('XML_FORBIDDEN:entity');
    expect(failure(() => parsePositions('<ScanAdaptors>&e;</ScanAdaptors>'))).toBe('XML_MALFORMED:reference');
    expect(detectPositionFormat(laughs)).toBeNull();
  });

  it('refuses column-major and quaternion conventions and requires an explicit order', () => {
    expect(failure(() => parsePositions(matrixJSON({ matrixOrder: 'column-major' })))).toBe('FORMAT_UNSUPPORTED:columnMajor');
    expect(failure(() => parsePositions(matrixJSON({}, { units: 'mm', matrixOrder: 'ColMajor' })))).toBe('FORMAT_UNSUPPORTED:columnMajor');
    expect(failure(() => parsePositions(matrixJSON({ matrixOrder: 'quaternion-wxyz' })))).toBe('FORMAT_UNSUPPORTED:quaternion');
    expect(failure(() => parsePositions(matrixJSON({})))).toBe('POSITIONS_MALFORMED:matrixOrderMissing');
    expect(failure(() => parsePositions(matrixJSON({ matrixOrder: 'diagonal' })))).toBe('POSITIONS_MALFORMED:matrixOrder');
    expect(failure(() => parsePositions(matrixJSON({ matrixOrder: 'column-major' }, { format: 'expertsddt-positions', units: 'mm' })))).toBe(
      'FORMAT_UNSUPPORTED:columnMajor',
    );
    const quaternion = JSON.stringify({ units: 'mm', matrixOrder: 'row-major', positions: [{ name: 'A', quaternion: [1, 0, 0, 0], translation: [0, 0, 0] }] });
    expect(failure(() => parsePositions(quaternion))).toBe('FORMAT_UNSUPPORTED:quaternion');
    expect(failure(() => parsePositions(JSON.stringify({ name: 'A', units: 'mm', quat: [1, 0, 0, 0] })))).toBe('FORMAT_UNSUPPORTED:quaternion');

    const xml = encodeMatrixXML(frames, labels);
    expect(failure(() => parsePositions(xml.replace('matrixOrder="row-major"', 'matrixOrder="column-major"')))).toBe('FORMAT_UNSUPPORTED:columnMajor');
    expect(failure(() => parsePositions(xml.replace(' matrixOrder="row-major"', '')))).toBe('POSITIONS_MALFORMED:matrixOrderMissing');
    const entries = encodeMatrixXML(frames, labels, { entries: true }).replace(' matrixOrder="row-major"', '');
    expectSites(parsePositions(entries), frames, labels, 'matrix-xml'); // addressed entries need no order
    const xmlQuaternion = '<ImplantPositions units="mm"><Position name="A"><Quaternion w="1" x="0" y="0" z="0"/></Position></ImplantPositions>';
    expect(failure(() => parsePositions(xmlQuaternion))).toBe('FORMAT_UNSUPPORTED:quaternion');
  });

  it('refuses units other than mm and requires units in JSON and matrix XML', () => {
    expectSites(parsePositions(csv.replace('Name,', 'units,millimetres\nName,')), frames, labels, 'matrix-table');
    expect(errorOf(() => parsePositions(`units,in\n${csv}`))).toMatchObject({ code: 'UNITS_NOT_MM', details: { row: 1 } });
    expect(errorOf(() => parsePositions(encodeMatrixTable(frames, labels, { units: 'column' }).replace(/mm\n$/, 'cm\n')))).toMatchObject({
      code: 'UNITS_NOT_MM',
      details: { row: 4 },
    });
    expect(failure(() => parsePositions(matrixJSON({ matrixOrder: 'row-major', units: 'inch' })))).toBe('UNITS_NOT_MM:');
    expect(failure(() => parsePositions(matrixJSON({ matrixOrder: 'row-major' }, { units: 'cm' })))).toBe('UNITS_NOT_MM:');
    expect(errorOf(() => parsePositions(matrixJSON({ matrixOrder: 'row-major' }, {})))).toMatchObject({ code: 'UNITS_MISSING', details: { row: 1 } });
    // Only own properties count: a "__proto__" key cannot smuggle units in.
    const proto = `{"positions":[{"name":"A","matrixOrder":"row-major","matrix":${JSON.stringify(Array.from(frames[0]!))},"__proto__":{"units":"mm"}}]}`;
    expect(failure(() => parsePositions(proto))).toBe('UNITS_MISSING:');
    const xml = encodeMatrixXML(frames, labels);
    expect(failure(() => parsePositions(xml.replace('units="mm"', 'units="in"')))).toBe('UNITS_NOT_MM:');
    expect(errorOf(() => parsePositions(xml.replace(' units="mm"', '')))).toMatchObject({ code: 'UNITS_MISSING', details: { row: 1 } });
    const adaptors = encodeScanAdaptorXML(frames, labels, { units: 'cm' });
    expect(failure(() => parsePositions(adaptors))).toBe('UNITS_NOT_MM:');
    const adaptorUnits = encodeScanAdaptorXML(frames, labels).replace('<ToothNumber>12', '<Units>inch</Units><ToothNumber>12');
    expect(errorOf(() => parsePositions(adaptorUnits))).toMatchObject({ code: 'UNITS_NOT_MM', details: { row: 2 } });
    const icam = encodeICamPoints(frames, compactLabels(3), { units: true }).replace('units: mm', 'units: inches');
    expect(errorOf(() => parsePositions(icam))).toMatchObject({ code: 'UNITS_NOT_MM', details: { row: 1 } });
  });

  it('refuses duplicate labels (after NFC normalisation) with the row of the repeat', () => {
    const duplicate = ['11', '12', '11'];
    expect(errorOf(() => parsePositions(encodeMatrixTable(frames, duplicate)))).toMatchObject({ code: 'LABEL_DUPLICATE', details: { row: 4 } });
    expect(errorOf(() => parsePositions(encodeScanAdaptorXML(frames, duplicate)))).toMatchObject({ code: 'LABEL_DUPLICATE', details: { row: 3 } });
    expect(errorOf(() => parsePositions(encodePositionsJSON(frames, duplicate)))).toMatchObject({ code: 'LABEL_DUPLICATE', details: { row: 3 } });
    expect(errorOf(() => parsePositions(encodeMatrixXML(frames, duplicate)))).toMatchObject({ code: 'LABEL_DUPLICATE', details: { row: 3 } });
    const micron = encodeMicronMapperCSV(frames).replace('AXO02', 'AXO01');
    expect(errorOf(() => parsePositions(micron))).toMatchObject({ code: 'LABEL_DUPLICATE', details: { row: 2 } });
    const nfc = encodeMatrixTable(frames, ['Caf\u00e9', 'Cafe\u0301', '3']);
    expect(errorOf(() => parsePositions(nfc))).toMatchObject({ code: 'LABEL_DUPLICATE', details: { row: 3 } });
  });

  it('applies the label rule (1-40 letters, digits, space . _ -; starting with a letter or digit)', () => {
    expectSites(parsePositions(encodeMatrixTable(frames, ['Diente 11', 'x'.repeat(40), '\u00f1-2.b_c'])), frames, ['Diente 11', 'x'.repeat(40), '\u00f1-2.b_c'], 'matrix-table');
    for (const bad of ['../x', 'x'.repeat(41), '-a', '=HYPERLINK(1)', 'a/b', 'a:b']) {
      expect([bad, errorOf(() => parsePositions(encodeMatrixTable(frames, [bad, 'b', 'c'])))]).toMatchObject([bad, { code: 'LABEL_INVALID', details: { row: 2 } }]);
    }
    expect(failure(() => parsePositions(encodeScanAdaptorXML(frames, ['', 'b', 'c'])))).toBe('LABEL_INVALID:');
    expect(failure(() => parsePositions(matrixJSON({ matrixOrder: 'row-major', name: { x: 1 } })))).toBe('LABEL_INVALID:');
  });

  it('refuses extra, unnamed-with-data, repeated or mixed-schema columns', () => {
    const header = csv.split('\n')[0]!;
    const withColumn = (extraHeader: string, extraCell: string): string =>
      csv
        .split('\n')
        .map((line, k) => (line ? `${line},${k === 0 ? extraHeader : extraCell}` : line))
        .join('\n');
    expect(errorOf(() => parsePositions(withColumn('comment', 'x')))).toMatchObject({ code: 'POSITIONS_MALFORMED', details: { reason: 'columns', row: 1 } });
    expect(errorOf(() => parsePositions(withColumn('', '5')))).toMatchObject({ code: 'POSITIONS_MALFORMED', details: { reason: 'columns', row: 2 } });
    expectSites(parsePositions(withColumn('', '')), frames, labels, 'matrix-table'); // empty unnamed column: harmless
    expect(failure(() => parsePositions(csv.replace(header, `${header},label`)))).toBe('POSITIONS_MALFORMED:columns');
    expect(failure(() => parsePositions(csv.replace(header, header.replace('m01', 'm00'))))).toBe('POSITIONS_MALFORMED:columns');
    expect(failure(() => parsePositions(csv.replace(header, `${header},Mat0`)))).toBe('POSITIONS_MALFORMED:columns');
    expect(failure(() => parsePositions(csv.replace(header, `${header},units,Units`)))).toBe('POSITIONS_MALFORMED:unitsRepeated');
    const axisWithName = encodeMatrixTable(frames, labels, { schema: 'axis', identity: 'name' });
    expect(failure(() => parsePositions(axisWithName))).toBe('POSITIONS_MALFORMED:columns');
    for (const identity of ['NAME', 'Label', 'position', 'ToothNumber', 'MARKER']) {
      const text = encodeMatrixTable(frames, labels, { identity }).replace('m00', 'M00');
      expectSites(parsePositions(text), frames, labels, 'matrix-table');
    }
  });

  it('every delimiter that parses must give the same data (POSITIONS_AMBIGUOUS)', () => {
    // No real schema can be satisfied by two delimiters with different data, so the shared rule is
    // exercised with an interpreter that reads the first field as a label.
    const interpret = (records: TextRecord[]): ParsedPositions => {
      const sites = new SiteCollector('matrix-table');
      sites.add(records[0]!.fields[0]!, identity(), records[0]!.row);
      return sites.result();
    };
    expect(failure(() => parseWithDelimiters('a b;c\n', 'matrix-table', [' ', ';'], interpret, () => 0, 0))).toBe('POSITIONS_AMBIGUOUS:');
    expect(parseWithDelimiters('a\n', 'matrix-table', [',', ';', ' '], interpret, () => 0, 0).sites).toHaveLength(1);
  });

  it('refuses NaN, infinities, formulas, decimal commas and empty values', () => {
    const firstValue = csv.split('\n')[1]!.split(',')[1]!;
    for (const bad of ['NaN', 'Infinity', '1e999', '=0.5+0.5', '0x1', '1,5', '']) {
      const text = csv.replace(`,${firstValue},`, `,${bad.includes(',') ? `"${bad}"` : bad},`);
      expect([bad, errorOf(() => parsePositions(text))]).toMatchObject([bad, { code: 'NUMBER_INVALID', details: { row: 2 } }]);
    }
    expect(failure(() => parsePositions(encodeMicronMapperCSV(frames).replace(/^(AXO01,)[^,]+/, '$1nan')))).toBe('NUMBER_INVALID:');
    expect(failure(() => parsePositions(matrixJSON({ matrixOrder: 'row-major', matrix: [...Array.from(frames[0]!).slice(0, 15), 1e999] })))).toBe('NUMBER_INVALID:');
    expect(failure(() => parsePositions(matrixJSON({ matrixOrder: 'row-major', matrix: [...Array.from(frames[0]!).slice(0, 15), '1'] })))).toBe('NUMBER_INVALID:');
    expect(failure(() => parsePositions('{"units":"mm","positions":[{"name":"A","matrix":[NaN]}]}'))).toBe('POSITIONS_MALFORMED:json');
    expect(failure(() => parsePositions(encodeMatrixXML(frames, labels).replace(/<Matrix4x4>[^ <]+/, '<Matrix4x4>NaN')))).toBe('NUMBER_INVALID:');
    expect(failure(() => parsePositions(encodeMatrixXML(frames, labels, { separator: ',' }).replace(/(<Matrix4x4>[^,]+),/, '$1,,')))).toBe('NUMBER_INVALID:');
    const scan = encodeScanAdaptorXML(frames, labels).replace(/<Mat1>[^;]+;/, '<Mat1>inf;');
    expect(errorOf(() => parsePositions(scan))).toMatchObject({ code: 'NUMBER_INVALID', details: { row: 1 } });
    const icam = encodeICamPoints(frames, compactLabels(3)).replace(/^(11_Origin )\S+/, '$1NaN');
    expect(errorOf(() => parsePositions(icam))).toMatchObject({ code: 'NUMBER_INVALID', details: { row: 1 } });
  });

  it('refuses matrices that are not rigid, with the row', () => {
    const table = (m: Mat4): string => encodeMatrixTable([m, frames[1]!, frames[2]!], labels);
    const scaled = Float64Array.from(frames[0]!, (v, k) => (k % 4 < 3 && k < 12 ? 2 * v : v));
    const reflected = Float64Array.from(frames[0]!, (v, k) => (k % 4 === 0 && k < 12 ? -v : v));
    const lastRow = Float64Array.from(frames[0]!, (v, k) => (k === 15 ? 2 : v));
    const far = Float64Array.from(frames[0]!, (v, k) => (k === 3 ? 1e6 : v));
    for (const [m, reason] of [[scaled, 'notOrthonormal'], [reflected, 'reflection'], [lastRow, 'lastRow'], [far, 'translationRange']] as const) {
      expect(errorOf(() => parsePositions(table(m)))).toMatchObject({ code: 'MATRIX_NOT_RIGID', details: { reason, row: 2 } });
    }
    const skewed = encodeMicronMapperCSV(frames).replace(/^(AXO01(?:,[^,]+){3}),[^,]+/, '$1,0.5');
    expect(errorOf(() => parsePositions(skewed))).toMatchObject({ code: 'MATRIX_NOT_RIGID', details: { row: 1 } });
    const names = compactLabels(3);
    const longX = Float64Array.from(frames[0]!, (v, k) => (k % 4 === 0 && k < 12 ? 1.01 * v : v)); // X endpoint 1 % too far
    expect(errorOf(() => parsePositions(encodeICamPoints([longX, frames[1]!, frames[2]!], names)))).toMatchObject({
      code: 'MATRIX_NOT_RIGID',
      details: { reason: 'axisLength', row: 1 },
    });
    const mirrored = encodeICamPoints([reflected, frames[1]!, frames[2]!], names);
    expect(errorOf(() => parsePositions(mirrored))).toMatchObject({ code: 'MATRIX_NOT_RIGID', details: { reason: 'reflection', row: 1 } });
  });

  it('enforces the position limit before building more sites, and refuses empty files', () => {
    const many = makeFrames(LIMITS.positions.maxPositions + 1, 'lower');
    const names = many.map((_, i) => `P${i + 1}`);
    const limit = { code: 'TOO_MANY_POSITIONS', details: { limit: LIMITS.positions.maxPositions } };
    for (const text of [encodeMatrixTable(many, names), encodePositionsJSON(many, names), encodeMatrixXML(many, names), encodeICamPoints(many, names), encodeScanAdaptorXML(many, names)]) {
      expect(errorOf(() => parsePositions(text))).toMatchObject(limit);
    }
    const ok = many.slice(0, LIMITS.positions.maxPositions);
    expect(parsePositions(encodeMatrixTable(ok, names)).sites).toHaveLength(LIMITS.positions.maxPositions);
    expect(failure(() => parsePositions(csv.split('\n')[0]!))).toBe('POSITIONS_EMPTY:');
    expect(failure(() => parsePositions('{"units":"mm","matrixOrder":"row-major","positions":[]}'))).toBe('POSITIONS_EMPTY:');
    expect(failure(() => parsePositions('<ImplantPositions units="mm" matrixOrder="row-major"/>'))).toBe('POSITIONS_EMPTY:');
    expect(failure(() => parsePositions('Camera:,x\nApplication:,MicronMapper V1.4.2.7\n'))).toBe('POSITIONS_EMPTY:');
  });

  it('MicronMapper: V1.4 or V1.6, one Application row, complete marker rows of one family', () => {
    const text = encodeMicronMapperCSV(frames);
    expect(failure(() => parsePositions(text.replace('V1.4.2.7', 'V1.5.0.1')))).toBe('FORMAT_UNSUPPORTED:unknownVersion');
    // The marker family is not tied to the version: V1.6 with AXO markers, V1.4 with BTH ones.
    expectSites(parsePositions(text.replace('V1.4.2.7', 'V1.6.2.7')), frames, micronMapperMarkers('AXO', 3), 'micronmapper-csv', 1e-5);
    expectSites(parsePositions(text.replaceAll('AXO', 'BTH')), frames, micronMapperMarkers('BTH', 3), 'micronmapper-csv', 1e-5);
    // One family per file; a marker is three capital letters plus digits.
    expect(errorOf(() => parsePositions(text.replace('AXO02', 'AHY02')))).toMatchObject({ code: 'POSITIONS_MALFORMED', details: { reason: 'markerFamily', row: 2 } });
    for (const bad of ['AXOX03', 'AX03', 'axo03', 'AXO']) expect(errorOf(() => parsePositions(text.replace('AXO03', bad)))).toMatchObject({ details: { reason: 'row', row: 3 } });
    expect(failure(() => parsePositions(text.replace(/Application:.*\n/, '')))).toBe('POSITIONS_MALFORMED:applicationMissing');
    expect(errorOf(() => parsePositions(`${text}Application:,MicronMapper V1.4.2.7\n`))).toMatchObject({ details: { reason: 'applicationRepeated', row: 7 } });
    expect(errorOf(() => parsePositions(text.replace(/^(AXO01(?:,[^,]+){8}),[^,\n]+/, '$1')))).toMatchObject({ details: { reason: 'row', row: 1 } });
    expect(errorOf(() => parsePositions(text.replace('Camera:', 'Header')))).toMatchObject({ details: { reason: 'row', row: 4 } });
  });

  it('MicronMapper exports as they arrive: BOM, spaced fields, blank lines, dated Application row, any family', () => {
    const four = makeFrames(4, 'lower', 3);
    for (const prefix of ['BTH', 'AHY', 'AXO', 'QRZ']) {
      const text = encodeMicronMapperExport(four, prefix);
      expect(text.charCodeAt(0)).toBe(0xfeff);
      expect(detectPositionFormat(text)).toBe('micronmapper-csv');
      for (const parsed of [parsePositions(utf8(text)), parsePositions(text), parseMicronMapperCSV(text)]) {
        expectSites(parsed, four, micronMapperMarkers(prefix, 4), 'micronmapper-csv', 1e-5);
        expect(parsed.warnings).toEqual([]);
      }
    }
  });

  it('XML families: structure errors', () => {
    const scan = encodeScanAdaptorXML(frames, labels);
    expect(errorOf(() => parsePositions(scan.replace(/<Mat2>.*<\/Mat2>/, '')))).toMatchObject({ details: { reason: 'elementMissing', row: 1 } });
    expect(errorOf(() => parsePositions(scan.replace('<ToothNumber>12</ToothNumber>', '<ToothNumber>12</ToothNumber><ToothNumber>13</ToothNumber>')))).toMatchObject({
      details: { reason: 'elementRepeated', row: 2 },
    });
    expect(failure(() => parsePositions(scan.replace('<ToothNumber>11', '<ScanAdaptor/><ToothNumber>11')))).toBe('POSITIONS_MALFORMED:nested');
    expect(failure(() => parsePositions(scan.replace(/<Mat1>[^;]+;/, '<Mat1>')))).toBe('MATRIX_INVALID:shape');
    expect(failure(() => parsePositions(scan.replace('<ToothNumber>11</ToothNumber>', '<ToothNumber><b>11</b></ToothNumber>')))).toBe('POSITIONS_MALFORMED:notText');
    expect(failure(() => parsePositions(scan.replace('<ScanAdaptors>', '<ScanAdaptors xmlns="urn:other">')))).toBe('FORMAT_UNKNOWN:');
    expect(failure(() => parsePositions(scan.replaceAll('ScanAdaptor>', 'v:ScanAdaptor>')))).toBe('FORMAT_UNKNOWN:');

    const entries = encodeMatrixXML(frames, labels, { entries: true });
    expect(failure(() => parsePositions(entries.replace('row="3" column="3"', 'row="3" column="2"')))).toBe('MATRIX_INVALID:entryAddress');
    expect(failure(() => parsePositions(entries.replace('row="3" column="3"', 'row="4" column="3"')))).toBe('MATRIX_INVALID:entryAddress');
    expect(failure(() => parsePositions(entries.replace(/<Entry row="3" column="3"[^>]*\/>/, '')))).toBe('MATRIX_INVALID:shape');
    expect(failure(() => parsePositions(entries.replace(/(<Entry row="0" column="0" value="[^"]+")\/>/, '$1>1</Entry>')))).toBe('POSITIONS_MALFORMED:entryValue');
    expect(failure(() => parsePositions(entries.replace('<Matrix4x4>', '<Matrix4x4 indexBase="2">')))).toBe('POSITIONS_MALFORMED:indexBase');
    expect(failure(() => parsePositions(entries.replace('<Matrix4x4>', '<Matrix4x4>1')))).toBe('POSITIONS_MALFORMED:mixedContent');
    expect(failure(() => parsePositions(entries.replace('<Matrix4x4>', '<Matrix4x4><Note/>')))).toBe('POSITIONS_MALFORMED:matrixChildren');
    const text = encodeMatrixXML(frames, labels);
    expect(failure(() => parsePositions(text.replace(/<Matrix4x4>[^ ]+ /, '<Matrix4x4>')))).toBe('MATRIX_INVALID:shape');
    expect(failure(() => parsePositions(text.replace('</Position>', '<Matrix4x4/></Position>')))).toBe('POSITIONS_MALFORMED:matrixCount');
    expect(failure(() => parsePositions(text.replace('<Position name="11">', '<Position name="11"><Name>11</Name>')))).toBe('POSITIONS_MALFORMED:declarationRepeated');
  });

  it('JSON and iCam: structure errors', () => {
    expect(failure(() => parsePositions('{"positions": [}'))).toBe('POSITIONS_MALFORMED:json');
    expect(failure(() => parsePositions('[1]'))).toBe('POSITIONS_MALFORMED:structure');
    expect(failure(() => parsePositions('{"units":"mm"}'))).toBe('POSITIONS_MALFORMED:structure');
    expect(failure(() => parsePositions(JSON.stringify({ units: 'mm', matrixOrder: 'row-major', positions: [{ name: 'A' }] })))).toBe('POSITIONS_MALFORMED:matrixMissing');
    expect(failure(() => parsePositions(matrixJSON({ matrixOrder: 'row-major', matrix: Array.from(frames[0]!).slice(1) })))).toBe('MATRIX_INVALID:shape');
    expect(failure(() => parsePositions(matrixJSON({ matrixOrder: 'row-major', matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]] })))).toBe('MATRIX_INVALID:shape');

    const names = compactLabels(3);
    const icam = encodeICamPoints(frames, names);
    expect(errorOf(() => parsePositions(icam.replace(/12_Z [^\r]+\r\n/, '')))).toMatchObject({ details: { reason: 'endpointMissing', row: 5 } });
    expect(errorOf(() => parsePositions(icam.replace('12_Y', '12_X')))).toMatchObject({ details: { reason: 'endpointRepeated', row: 7 } });
    expect(errorOf(() => parsePositions(icam.replace('12_Y', '12_W')))).toMatchObject({ details: { reason: 'line', row: 7 } });
    expect(errorOf(() => parsePositions(icam.replace(/^(11_Origin .*)\r/, '$1 4\r')))).toMatchObject({ details: { reason: 'line', row: 1 } });
    expect(errorOf(() => parsePositions(icam.replace(/^(11_X )\S+/m, '$11e6')))).toMatchObject({ code: 'COORDINATE_OUT_OF_RANGE', details: { row: 2 } });
  });

  it('reports lexing errors (quoting) with the record number', () => {
    const lines = csv.split('\n');
    lines[2] = `"${lines[2]}`;
    expect(errorOf(() => parsePositions(lines.join('\n')))).toMatchObject({ code: 'POSITIONS_MALFORMED', details: { reason: 'quoting', row: 3 } });
    lines[2] = lines[2]!.replace('"', '').replace(',', 'x"y,');
    expect(errorOf(() => parsePositions(lines.join('\n')))).toMatchObject({ code: 'POSITIONS_MALFORMED', details: { reason: 'quoting', row: 3 } });
  });
});

describe('privacy and robustness', () => {
  const frames = makeFrames(3, 'upper', 5);
  const labels = positionLabels(3);

  it('never copies file text (labels, values) into errors', () => {
    const secret = 'PatientJaneDoe';
    const texts = [
      encodeMatrixTable(frames, [secret, secret, 'x']),
      encodeMatrixTable(frames, [`${secret}/x`, 'a', 'b']),
      encodeScanAdaptorXML(frames, [secret, 'b', secret]),
      encodePositionsJSON(frames, [secret, secret, 'c']),
      encodeMatrixTable(frames, labels).replace('\n11,', `\n11,${secret}`),
      encodeICamPoints(frames, [secret, 'b', 'c']).replace(`${secret}_Z`, `${secret}_W`),
      `<ScanAdaptors><ScanAdaptor><ToothNumber>${secret}</ToothNumber></ScanAdaptor></ScanAdaptors>`,
    ];
    for (const text of texts) {
      const e = errorOf(() => parsePositions(text));
      expect(`${e.message} ${JSON.stringify(e.details)}`).not.toContain('Jane');
    }
  });

  it('detectPositionFormat never throws on random text', () => {
    const rng = createRng(42);
    const alphabet = '<>&;:,"\'\t\n\r |{}[]=/_-.0123456789eEAXOHYmMatOriginXYZ\u00e9\u4e2d\uFEFF?!';
    for (let k = 0; k < 600; k++) {
      let text = '';
      const size = Math.floor(rng() * 160);
      for (let j = 0; j < size; j++) text += alphabet[Math.floor(rng() * alphabet.length)];
      expect(() => detectPositionFormat(text)).not.toThrow();
    }
  });

  it('mutated valid files are parsed or refused with a known XchangeError, never a crash', () => {
    const samples = [
      encodeMicronMapperCSV(frames),
      encodeScanAdaptorXML(frames, labels),
      encodeMatrixTable(frames, labels, { schema: 'rows' }),
      encodeMatrixTable(frames, labels, { schema: 'axis', delimiter: ';', units: 'line' }),
      encodePositionsJSON(frames, labels, { nested: true }),
      encodeMatrixXML(frames, labels, { entries: true }),
      encodeICamPoints(frames, compactLabels(3)),
    ];
    const rng = createRng(7);
    const codes = new Set<string>(ERROR_CODES);
    for (const sample of samples) {
      for (let k = 0; k < 150; k++) {
        const text = mutate(sample, rng);
        expect(() => detectPositionFormat(text)).not.toThrow();
        try {
          parsePositions(text);
        } catch (e) {
          expect(e).toBeInstanceOf(XchangeError);
          expect(codes.has((e as XchangeError).code)).toBe(true);
        }
      }
    }
  });

  it('bounds work on near-limit hostile tables', () => {
    const max = LIMITS.positions.maxBytes;
    const started = performance.now();
    const rows = `Name,m00\n${'a\n'.repeat((max - 16) / 2)}`;
    expect(failure(() => parsePositions(rows))).toBe('POSITIONS_MALFORMED:tooManyRows');
    const columns = `Name,m00,${','.repeat(max - 16)}`;
    expect(failure(() => parsePositions(columns))).toBe('POSITIONS_MALFORMED:tooManyColumns');
    const quote = `Name,m00\n"${'x'.repeat(max - 16)}`;
    expect(failure(() => parsePositions(quote))).toBe('POSITIONS_MALFORMED:quoting');
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

/** 1-4 random single-character deletions, insertions or replacements. */
function mutate(text: string, rng: Rng): string {
  const chars = [...text];
  const pool = '<>&;:,"\t\n |0123456789.-eE_xAXOHYmM=[]{}/\u00e9';
  for (let edits = 1 + Math.floor(rng() * 4); edits > 0; edits--) {
    const at = Math.floor(rng() * (chars.length + 1));
    const c = pool[Math.floor(rng() * pool.length)]!;
    const op = rng();
    if (op < 0.4) chars.splice(at, 1);
    else if (op < 0.8) chars.splice(at, 0, c);
    else chars[at] = c;
  }
  return chars.join('');
}
