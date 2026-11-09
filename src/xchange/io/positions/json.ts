/**
 * Named row-major matrices in JSON (spec 3.3): `{"positions": [...]}`, a bare array of positions, or one
 * position object. Each position: `name` (string or number), `matrix` (16 numbers or 4 rows of 4),
 * `units: "mm"` (own or root, required) and `matrixOrder: "row-major"` (own or root; implied by a root
 * `format: "expertsddt-positions"`). Only own properties are read ("__proto__" is plain data).
 *
 * Errors (details): POSITIONS_MALFORMED {format, reason, row?}: 'json' | 'structure' | 'matrixMissing' (+
 * 'matrixOrder' | 'matrixOrderMissing' from common.ts); UNITS_MISSING {row}; UNITS_NOT_MM {row?};
 * FORMAT_UNSUPPORTED {reason: 'columnMajor' | 'quaternion'}; MATRIX_INVALID {reason: 'shape', row};
 * NUMBER_INVALID {row}; TOO_MANY_POSITIONS {limit}; plus SiteCollector errors (common.ts).
 */
import { XchangeError } from '../../core/errors';
import { LIMITS } from '../../core/limits';
import { malformed, requireMm, requireRowMajor, SiteCollector, unsupported, type ParsedPositions } from './common';

const FORMAT = 'positions-json';
type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);
const own = (object: JsonObject | undefined, key: string): unknown => (object && Object.hasOwn(object, key) ? object[key] : undefined);
const hasQuaternion = (object: JsonObject): boolean => Object.keys(object).some((key) => /quat/i.test(key));
/** Non-strings become '' so that they fail the unit / order checks. */
const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

export function parsePositionsJSON(text: string): ParsedPositions {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw malformed(FORMAT, 'json');
  }
  const root = isObject(data) ? data : undefined;
  const positions = own(root, 'positions');
  const list = isArray(data) ? data : isArray(positions) ? positions : root && Object.hasOwn(root, 'matrix') ? [root] : undefined;
  if (!list) throw root && hasQuaternion(root) ? unsupported('quaternion') : malformed(FORMAT, 'structure');
  const limit = LIMITS.positions.maxPositions;
  if (list.length > limit) throw new XchangeError('TOO_MANY_POSITIONS', { limit });

  const rootUnits = own(root, 'units');
  const rootOrder = own(root, 'matrixOrder');
  if (rootUnits !== undefined) requireMm(asText(rootUnits));
  if (rootOrder !== undefined) requireRowMajor(asText(rootOrder), FORMAT);
  const canonical = own(root, 'format') === 'expertsddt-positions';

  const sites = new SiteCollector(FORMAT);
  list.forEach((item, k) => {
    const row = k + 1;
    if (!isObject(item)) throw malformed(FORMAT, 'structure', row);
    const units = own(item, 'units') ?? rootUnits;
    if (units === undefined) throw new XchangeError('UNITS_MISSING', { row });
    requireMm(asText(units), row);
    const order = own(item, 'matrixOrder') ?? rootOrder;
    if (order !== undefined || !canonical) requireRowMajor(order === undefined ? undefined : asText(order), FORMAT, row);
    if (!Object.hasOwn(item, 'matrix')) throw hasQuaternion(item) ? unsupported('quaternion') : malformed(FORMAT, 'matrixMissing', row);
    const name = own(item, 'name');
    sites.add(typeof name === 'string' || typeof name === 'number' ? String(name) : '', jsonMatrix(item['matrix'], row), row);
  });
  return sites.result();
}

function jsonMatrix(value: unknown, row: number): number[] {
  const nested = isArray(value) && value.length === 4 && value.every(isArray);
  const flat = nested ? (value.every((r) => isArray(r) && r.length === 4) ? value.flat() : undefined) : value;
  if (!isArray(flat) || flat.length !== 16) throw new XchangeError('MATRIX_INVALID', { reason: 'shape', row });
  return flat.map((v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new XchangeError('NUMBER_INVALID', { row });
    return v;
  });
}
