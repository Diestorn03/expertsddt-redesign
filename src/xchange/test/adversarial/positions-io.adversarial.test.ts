/**
 * Adversarial tests for io/positions: values that pass the checks must still be safe downstream, and
 * hostile text (prototype keys, formulas, encodings) must be refused or stay plain data.
 * Tests named "BUG:" fail on purpose until the production code is fixed (review findings); the others
 * document attacks that hold. All data is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, XchangeError } from '../../core/errors';
import { RIGID_TOLERANCE } from '../../core/limits';
import type { ImplantSite, Mat4 } from '../../core/types';
import { parsePositions } from '../../io/positions/index';
import { makeFrames } from '../fixtures';
import { encodeICamPoints, encodeMatrixTable, encodeMatrixXML, encodePositionsJSON, encodeScanAdaptorXML, utf8 } from '../fixtures/positions';

const KNOWN_CODES = new Set<string>(ERROR_CODES);

/** The XchangeError code fn throws, or 'ok'. Any other exception fails the test. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'ok';
  } catch (error) {
    if (!(error instanceof XchangeError)) throw error;
    expect(KNOWN_CODES.has(error.code)).toBe(true);
    return error.code;
  }
}

const frames = makeFrames(3, 'lower', 9);
const labels = ['11', '12', '13'];

/** The frame with a 4th row that validateRigid accepts today: every entry is off by less than RIGID_TOLERANCE. */
const BOTTOM_ROW_NOISE = [3e-5, -2e-5, 9e-5, 1 + 5e-5] as const;
function withNoisyBottomRow(m: Mat4): Mat4 {
  const out = Float64Array.from(m);
  out.set(BOTTOM_ROW_NOISE, 12);
  return out;
}

describe('io/positions: matrices that pass validateRigid', () => {
  it('BUG: a bottom row inside RIGID_TOLERANCE is refused, or stored as 0 0 0 1', () => {
    // Every family that reads the 4th row from the file keeps it in site.matrix today. core multiply() then
    // leaks it into the rotation (export.adversarial.test.ts, math-core BUG test), and any 4x4 consumer that
    // treats row 3 as projective (three.js applyMatrix4 / the vertex shader divide by w) moves the body.
    expect(Math.max(...BOTTOM_ROW_NOISE.map((v, k) => Math.abs(v - (k === 3 ? 1 : 0))))).toBeLessThan(RIGID_TOLERANCE);
    const noisy = frames.map(withNoisyBottomRow);
    const files: Record<string, string> = {
      scanAdaptor: encodeScanAdaptorXML(noisy, labels),
      tableRows: encodeMatrixTable(noisy, labels, { schema: 'rows' }),
      tableMatrix: encodeMatrixTable(noisy, labels),
      json: encodePositionsJSON(noisy, labels),
      jsonNested: encodePositionsJSON(noisy, labels, { nested: true }),
      matrixXml: encodeMatrixXML(noisy, labels),
      matrixXmlEntries: encodeMatrixXML(noisy, labels, { entries: true }),
    };
    for (const [family, text] of Object.entries(files)) {
      let sites: ImplantSite[];
      try {
        sites = parsePositions(text).sites;
      } catch (error) {
        expect(error, family).toMatchObject({ code: 'MATRIX_NOT_RIGID', details: { reason: 'lastRow' } });
        continue;
      }
      for (const site of sites) {
        const offset = Math.max(...Array.from(site.matrix.slice(12), (v, k) => Math.abs(v - (k === 3 ? 1 : 0))));
        expect(offset, family).toBeLessThanOrEqual(1e-7);
      }
    }
  });
});

describe('io/positions: hostile text stays plain data (regressions)', () => {
  const matrix = Array.from(frames[0]!);
  const scanAdaptorRows = [0, 1, 2, 3].map((r) => `<Mat${r}>${matrix.slice(4 * r, 4 * r + 4).join(';')}</Mat${r}>`).join('');

  it('prototype keys never supply a declaration, a matrix or a label, and never pollute Object.prototype', () => {
    const json = (value: unknown): string => JSON.stringify(value).replaceAll('"PROTO"', '"__proto__"');
    const order = { units: 'mm', matrixOrder: 'row-major' };
    const cases: Array<[string, string]> = [
      [json({ PROTO: order, positions: [{ name: 'A', matrix }] }), 'UNITS_MISSING'], // not inherited
      [json({ ...order, positions: [{ name: 'A', PROTO: { matrix } }] }), 'POSITIONS_MALFORMED'], // matrixMissing
      [json({ ...order, positions: [{ name: 'A', matrix, PROTO: { polluted: 1 } }] }), 'ok'],
      [json({ ...order, constructor: { prototype: { polluted: 1 } }, positions: [{ name: 'constructor', matrix }] }), 'ok'],
      [json({ ...order, positions: [{ name: '__proto__', matrix }] }), 'LABEL_INVALID'],
      [`<ImplantPositions __proto__="x" constructor="y" units="mm" matrixOrder="row-major"><Position name="toString"><Matrix4x4>${matrix.join(' ')}</Matrix4x4></Position></ImplantPositions>`, 'ok'],
      [`<__proto__ units="mm"><ScanAdaptor><ToothNumber>hasOwnProperty</ToothNumber>${scanAdaptorRows}</ScanAdaptor></__proto__>`, 'ok'],
      ['Name,m00,__proto__\nA,1,2\n', 'POSITIONS_MALFORMED'], // columns
      [encodeICamPoints([frames[0]!], ['constructor']), 'ok'],
    ];
    for (const [text, expected] of cases) expect([text.slice(0, 70), codeOf(() => parsePositions(text))]).toEqual([text.slice(0, 70), expected]);
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(({} as Record<string, unknown>)['units']).toBeUndefined();
  });

  it('formula-like cells (= + - @, also after blanks or full-width) never become labels', () => {
    for (const bad of ['=1+1', '+SUM(A1)', '-2+3', '@SUM(1)', ' =1', '\t=1', '＝1', '=HYPERLINK("x")']) {
      const texts = [
        encodeMatrixTable(frames, [bad, '12', '13'], { delimiter: ';' }),
        encodePositionsJSON(frames, [bad, '12', '13']),
        encodeMatrixXML(frames, [bad, '12', '13']),
        encodeScanAdaptorXML(frames, [bad, '12', '13']),
      ];
      for (const text of texts) expect([bad, codeOf(() => parsePositions(text))]).toEqual([bad, 'LABEL_INVALID']);
    }
  });

  it('BOM and UTF-16 tricks are decoded strictly or refused as TEXT_ENCODING', () => {
    const csv = encodeMatrixTable(frames, labels);
    const le = (text: string): number[] => Array.from(text, (c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8]).flat();
    const refused: Array<[string, number[]]> = [
      ['UTF-16 LE without BOM', le(csv)],
      ['UTF-16 BOM, odd length', [0xff, 0xfe, ...le(csv), 0x41]],
      ['UTF-32 LE BOM', [0xff, 0xfe, 0x00, 0x00, ...le(csv).flatMap((b, i) => (i % 2 ? [b, 0, 0] : [b]))]],
      ['UTF-16 lone surrogate', [0xff, 0xfe, ...le(`\uD800${csv}`)]],
      ['UTF-8 BOM then UTF-16 BOM', [0xef, 0xbb, 0xbf, 0xff, 0xfe, ...utf8(csv)]],
      ['overlong UTF-8', [...utf8(csv), 0xc0, 0xaf]],
      ['CESU-8 surrogate', [...utf8(csv), 0xed, 0xa0, 0x80]],
    ];
    for (const [name, bytes] of refused) expect([name, codeOf(() => parsePositions(Uint8Array.from(bytes)))]).toEqual([name, 'TEXT_ENCODING']);
    expect(parsePositions(Uint8Array.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, ...utf8(csv)])).sites).toHaveLength(3); // two BOMs
  });
});
