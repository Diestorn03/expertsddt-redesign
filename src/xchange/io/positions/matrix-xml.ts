/**
 * Open ImplantPositions / Matrix4x4 XML (spec 3.3; the schema the prototype documented):
 *   <ImplantPositions units="mm" matrixOrder="row-major">
 *     <Position name="3"><Matrix4x4>1 0 0 0  0 1 0 0  0 0 1 0  0 0 0 1</Matrix4x4></Position>
 *   </ImplantPositions>
 * Root `ImplantPositions` (positions = its `Position` | `ImplantPosition` children) or a single
 * `ImplantPosition` root. A declaration is an attribute (camelCase or Capitalised) or one text-only child
 * element (Capitalised): `units`, `matrixOrder` (root or position), `name`, and on Matrix4x4 `order` and
 * `indexBase`. Units are required (position or root). A text matrix (16 numbers separated by whitespace,
 * `,` or `;`) needs an explicit row-major order; 16 `<Entry row column value>` (value as attribute or text)
 * are addressed with indexBase 0 (default) or 1.
 *
 * Errors (details): FORMAT_UNKNOWN (other root); UNITS_MISSING {row}; UNITS_NOT_MM {row?}; FORMAT_UNSUPPORTED
 * {reason: 'columnMajor' | 'quaternion'}; POSITIONS_MALFORMED {format, reason, row?}: 'matrixCount' |
 * 'matrixChildren' | 'mixedContent' | 'indexBase' | 'entryValue' (+ 'notText' | 'declarationRepeated' |
 * 'matrixOrder' | 'matrixOrderMissing' from common.ts); MATRIX_INVALID {reason: 'shape' | 'entryAddress', row};
 * NUMBER_INVALID {row}; TOO_MANY_POSITIONS {limit}; XML_* (xml.ts); plus SiteCollector errors (common.ts).
 */
import { XchangeError } from '../../core/errors';
import { LIMITS } from '../../core/limits';
import { declared, malformed, number, requireMm, requireRowMajor, SiteCollector, unsupported, type ParsedPositions } from './common';
import { parseXml, type XmlElement } from './xml';

const FORMAT = 'matrix-xml';
const MATRIX_CHILDREN = new Set(['Entry', 'Order', 'IndexBase']);

export const isMatrixXmlRoot = (root: XmlElement): boolean => root.name === 'ImplantPositions' || root.name === 'ImplantPosition';

export function parseMatrixXML(text: string): ParsedPositions {
  return matrixXmlFromXml(parseXml(text));
}

export function matrixXmlFromXml(root: XmlElement): ParsedPositions {
  if (!isMatrixXmlRoot(root)) throw new XchangeError('FORMAT_UNKNOWN');
  const rootUnits = declared(root, 'units', 'Units', FORMAT);
  const rootOrder = declared(root, 'matrixOrder', 'MatrixOrder', FORMAT);
  if (rootUnits !== undefined) requireMm(rootUnits);
  if (rootOrder !== undefined) requireRowMajor(rootOrder, FORMAT);
  const single = root.name === 'ImplantPosition';
  const positions = single ? [root] : root.children.filter((c) => c.name === 'Position' || c.name === 'ImplantPosition');
  const limit = LIMITS.positions.maxPositions;
  if (positions.length > limit) throw new XchangeError('TOO_MANY_POSITIONS', { limit });

  const sites = new SiteCollector(FORMAT);
  positions.forEach((position, k) => {
    const row = k + 1;
    // A single-position root already gave its declarations as rootUnits / rootOrder.
    const own = (attribute: string, element: string): string | undefined =>
      single ? undefined : declared(position, attribute, element, FORMAT, row);
    const units = own('units', 'Units') ?? rootUnits;
    if (units === undefined) throw new XchangeError('UNITS_MISSING', { row });
    requireMm(units, row);
    const matrices = position.children.filter((c) => c.name === 'Matrix4x4');
    if (matrices.length !== 1) {
      if (!matrices.length && position.children.some((c) => /quaternion/i.test(c.name))) throw unsupported('quaternion');
      throw malformed(FORMAT, 'matrixCount', row);
    }
    const matrix = matrices[0]!;
    const order = declared(matrix, 'order', 'Order', FORMAT, row) ?? own('matrixOrder', 'MatrixOrder') ?? rootOrder;
    sites.add(declared(position, 'name', 'Name', FORMAT, row) ?? '', readMatrix(matrix, order, row), row);
  });
  return sites.result();
}

function readMatrix(matrix: XmlElement, order: string | undefined, row: number): number[] {
  if (matrix.children.some((c) => !MATRIX_CHILDREN.has(c.name))) throw malformed(FORMAT, 'matrixChildren', row);
  const entries = matrix.children.filter((c) => c.name === 'Entry');
  if (!entries.length) {
    requireRowMajor(order, FORMAT, row);
    return splitMatrixText(matrix.text, row);
  }
  if (order !== undefined) requireRowMajor(order, FORMAT, row);
  if (matrix.text.trim()) throw malformed(FORMAT, 'mixedContent', row);
  if (entries.length !== 16) throw new XchangeError('MATRIX_INVALID', { reason: 'shape', row });
  const base = declared(matrix, 'indexBase', 'IndexBase', FORMAT, row) ?? '0';
  if (base !== '0' && base !== '1') throw malformed(FORMAT, 'indexBase', row);
  const address = (value: string | undefined): number => {
    const index = value !== undefined && /^\d{1,2}$/.test(value.trim()) ? Number(value.trim()) - Number(base) : -1;
    if (index < 0 || index > 3) throw new XchangeError('MATRIX_INVALID', { reason: 'entryAddress', row });
    return index;
  };
  const values = new Array<number>(16).fill(0);
  const seen = new Set<number>();
  for (const entry of entries) {
    if (entry.children.length) throw malformed(FORMAT, 'notText', row);
    const key = address(entry.attributes['row']) * 4 + address(entry.attributes['column']);
    if (seen.has(key)) throw new XchangeError('MATRIX_INVALID', { reason: 'entryAddress', row });
    seen.add(key);
    const attribute = entry.attributes['value'];
    if (attribute !== undefined && entry.text.trim()) throw malformed(FORMAT, 'entryValue', row);
    values[key] = number(attribute ?? entry.text, row);
  }
  return values;
}

/** 16 numbers separated by whitespace, ',' or ';' (an empty value between separators is refused). */
function splitMatrixText(text: string, row: number): number[] {
  if (!text.trim()) throw new XchangeError('MATRIX_INVALID', { reason: 'shape', row });
  const tokens: string[] = [];
  for (const part of text.split(/[,;]/)) {
    const trimmed = part.trim();
    if (!trimmed) throw new XchangeError('NUMBER_INVALID', { row });
    for (const token of trimmed.split(/\s+/)) {
      if (tokens.push(token) > 16) throw new XchangeError('MATRIX_INVALID', { reason: 'shape', row });
    }
  }
  if (tokens.length !== 16) throw new XchangeError('MATRIX_INVALID', { reason: 'shape', row });
  return tokens.map((token) => number(token, row));
}
