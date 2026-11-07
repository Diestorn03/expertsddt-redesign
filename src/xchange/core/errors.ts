/**
 * Stable error and warning codes. The UI translates codes; messages are for developers.
 * details carry only numbers, booleans and the documented reason ids (see CONTRACTS.md):
 * never file names and never free text copied from a file.
 */

export const ERROR_CODES = [
  'INTERNAL', // a bug; details.reason = 'unexpected'
  'INVALID_ARGUMENT', // programming misuse (wrong array length, bad option)
  'CANCELLED',
  'FILE_EMPTY',
  'FILE_TOO_LARGE', // details: limitBytes, bytes
  'FORMAT_UNKNOWN', // content matches no supported format
  'FORMAT_NOT_ALLOWED', // recognised, but not for this purpose (e.g. OBJ jaw). details: format, purpose
  'FORMAT_UNSUPPORTED', // recognised and deliberately refused. details: reason
  'TEXT_ENCODING', // details.reason: 'invalid' | 'nul'
  'NUMBER_INVALID',
  'COORDINATE_OUT_OF_RANGE',
  'TOO_MANY_TRIANGLES', // details: limit, count
  'TOO_MANY_VERTICES',
  'TOO_MANY_POSITIONS',
  'TOO_MANY_COMPONENTS',
  'MESH_TRUNCATED',
  'MESH_MALFORMED', // details: format, reason, line?
  'MESH_INDEX_OUT_OF_RANGE',
  'MESH_EMPTY',
  'POSITIONS_MALFORMED', // details: format, reason, row?
  'POSITIONS_EMPTY',
  'POSITIONS_AMBIGUOUS',
  'LABEL_INVALID',
  'LABEL_DUPLICATE',
  'UNITS_MISSING',
  'UNITS_NOT_MM',
  'XML_MALFORMED', // details: reason, offset?
  'XML_FORBIDDEN', // DOCTYPE / ENTITY / processing instruction
  'MATRIX_INVALID', // not 16 finite numbers
  'MATRIX_NOT_RIGID', // details.reason: 'lastRow' | 'notOrthonormal' | 'reflection' | 'translationRange'
  'DEGENERATE_GEOMETRY', // details.reason
  'INSUFFICIENT_DATA', // details: required?, count?
  'REFERENCE_NO_MATCH',
  'ALIGNMENT_FAILED',
  'LANDMARKS_INVALID',
  'WORKER_FAILED',
  'EXPORT_GEOMETRY_MISSING', // details: site (index)
  'EXPORT_NAME_INVALID',
  'EXPORT_TOO_LARGE', // details: limitBytes, bytes
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const WARNING_CODES = [
  'MESH_DEGENERATE_TRIANGLES_DROPPED', // details.count
  'MESH_LARGE', // details.triangles (jaw above LIMITS.jaw.warnTriangles)
  'MESH_UNITS_SUSPECT', // details.extentMm (outside PLAUSIBLE_EXTENT_MM)
  'MESH_COLORS_IGNORED',
  'STL_MULTIPLE_SOLIDS', // details.count
  'UNITS_ASSUMED_MM',
  'COMPONENT_FRAGMENTS', // details.count
  'SITE_INDEX_AMBIGUOUS', // details.count
  'SITE_PROVISIONAL', // details.count
] as const;

export type WarningCode = (typeof WARNING_CODES)[number];

export type ErrorDetails = Readonly<Record<string, string | number | boolean>>;

export interface XchangeWarning {
  code: WarningCode;
  details?: ErrorDetails;
}

export class XchangeError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, details: ErrorDetails = {}) {
    super(Object.keys(details).length ? `${code} ${JSON.stringify(details)}` : code);
    this.name = 'XchangeError';
    this.code = code;
    this.details = details;
  }
}

/** Structured-clone-safe form, for worker messages (Error subclasses lose their fields there). */
export interface XchangeErrorPayload {
  code: ErrorCode;
  details: ErrorDetails;
}

export function isXchangeError(error: unknown): error is XchangeError {
  return error instanceof XchangeError;
}

/** Unknown errors become INTERNAL without their message (it could quote a file name). */
export function toErrorPayload(error: unknown): XchangeErrorPayload {
  if (error instanceof XchangeError) return { code: error.code, details: error.details };
  return { code: 'INTERNAL', details: { reason: 'unexpected' } };
}

export function fromErrorPayload(payload: XchangeErrorPayload): XchangeError {
  const known = (ERROR_CODES as readonly string[]).includes(payload.code);
  return known ? new XchangeError(payload.code, payload.details) : new XchangeError('INTERNAL', { reason: 'unexpected' });
}
