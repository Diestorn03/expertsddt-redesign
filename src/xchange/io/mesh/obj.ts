/**
 * Wavefront OBJ reader: `v` records (3 fields, 4 with w = 1, 6 = xyz + rgb 0-1, 7 = xyzw + rgb) and `f`
 * records (`v`, `v/vt`, `v//vn`, `v/vt/vn`, negative = relative), polygons triangulated, `\` continues a
 * record, `#` comments. Texture coordinates, normals, groups and materials are ignored (materials are
 * never loaded). A face may only use vertices defined before it.
 *
 * Error details: MESH_MALFORMED {format: 'obj', reason, line}, reason one of unknownRecord, vertexFields,
 * vertexWeight, polygonCorners, lineTooLong; FORMAT_UNSUPPORTED {reason: 'freeform', line};
 * NUMBER_INVALID / COORDINATE_OUT_OF_RANGE / MESH_INDEX_OUT_OF_RANGE {line}; TOO_MANY_VERTICES /
 * TOO_MANY_TRIANGLES {limit}; MESH_EMPTY {dropped}; TEXT_ENCODING {reason: 'nul'}.
 */
import { XchangeError, type XchangeWarning } from '../../core/errors';
import { MAX_ABS_COORDINATE_MM, PARSE_LIMITS } from '../../core/limits';
import { checkSize, coordinateError, Cursor, finish, grow, parseInteger, TriangleSink } from './common';
import type { MeshParseLimits, ParsedMesh } from './index';

const UNKNOWN = 0, VERTEX = 1, FACE = 2, IGNORED = 3, FREEFORM = 4;
const IGNORED_WORDS = new Set([
  'vt', 'vn', 'vp', 'o', 'g', 's', 'l', 'p', 'mg', 'usemtl', 'mtllib', 'usemap', 'maplib',
  'lod', 'bevel', 'c_interp', 'd_interp', 'shadow_obj', 'trace_obj', 'ctech', 'stech',
]);
const FREEFORM_WORDS = new Set(['cstype', 'deg', 'bmat', 'step', 'curv', 'curv2', 'surf', 'parm', 'trim', 'hole', 'scrv', 'sp', 'end', 'con']);
const MAX_CORNERS = PARSE_LIMITS.maxPolygonCorners;

const malformed = (reason: string, line: number): XchangeError => new XchangeError('MESH_MALFORMED', { format: 'obj', reason, line });

/** Record kind of the current token (keywords are case-sensitive, as in the format). */
function kind(cur: Cursor): number {
  const b = cur.bytes, s = cur.start, n = cur.end - s;
  if (n === 1 && b[s] === 0x76) return VERTEX;
  if (n === 1 && b[s] === 0x66) return FACE;
  if (n > 10) return UNKNOWN; // longest keyword: shadow_obj
  const word = cur.text();
  return IGNORED_WORDS.has(word) ? IGNORED : FREEFORM_WORDS.has(word) ? FREEFORM : UNKNOWN;
}

/** Every complete line of the window is an OBJ record, comment or blank, and at least one is `v`. */
export function looksLikeOBJ(bytes: Uint8Array, windowBytes: number): boolean {
  const end = windowBytes < bytes.length ? bytes.lastIndexOf(0x0a, windowBytes - 1) + 1 : windowBytes;
  try {
    const cur = new Cursor(bytes, 0, end);
    let vertices = 0;
    while (cur.pos < end) {
      if (cur.nextInLine()) {
        const k = kind(cur);
        if (k === UNKNOWN) return false;
        if (k === VERTEX) vertices++;
        while (cur.nextInLine()) continue;
      }
      cur.skipLine();
    }
    return vertices > 0;
  } catch {
    return false; // NUL: not text
  }
}

export function parseOBJ(bytes: Uint8Array, limits: MeshParseLimits): ParsedMesh {
  checkSize(bytes, limits);
  const maxVertices = 3 * limits.maxTriangles;
  const cur = new Cursor(bytes);
  const sink = new TriangleSink(1024, limits.maxTriangles);
  const corners = new Uint32Array(MAX_CORNERS);
  const fields = new Float64Array(7);
  let positions = new Float32Array(3 * 1024);
  let colors: Uint8Array | null = null;
  let nv = 0, colored = 0;
  const end = bytes.length;
  while (cur.pos < end) {
    const line = cur.line, start = cur.pos;
    if (cur.nextInLine()) {
      const k = kind(cur);
      if (k === VERTEX) {
        let n = 0;
        while (cur.nextInLine()) {
          if (n === 7) throw malformed('vertexFields', line);
          const v = cur.number();
          if (!Number.isFinite(v)) throw new XchangeError('NUMBER_INVALID', { line });
          fields[n++] = v;
        }
        if (n !== 3 && n !== 4 && n !== 6 && n !== 7) throw malformed('vertexFields', line);
        if ((n === 4 || n === 7) && fields[3] !== 1) throw malformed('vertexWeight', line);
        if (nv === maxVertices) throw new XchangeError('TOO_MANY_VERTICES', { limit: maxVertices });
        const o = 3 * nv;
        if (o + 3 > positions.length) {
          positions = grow(positions, o + 3, 3 * maxVertices);
          if (colors) colors = grow(colors, positions.length);
        }
        for (let j = 0; j < 3; j++) {
          const v = fields[j]!;
          if (!(Math.abs(v) <= MAX_ABS_COORDINATE_MM)) throw coordinateError(v, { line });
          positions[o + j] = v;
        }
        if (n >= 6) {
          colors ??= new Uint8Array(positions.length);
          for (let j = 0; j < 3; j++) {
            const c = fields[n - 3 + j]!;
            colors[o + j] = c <= 0 ? 0 : c >= 1 ? 255 : Math.round(255 * c);
          }
          colored++;
        }
        nv++;
      } else if (k === FACE) {
        let n = 0;
        while (cur.nextInLine()) {
          if (n === MAX_CORNERS) throw malformed('polygonCorners', line);
          let slash = cur.start;
          while (slash < cur.end && bytes[slash] !== 0x2f) slash++; // v[/vt][/vn]: only v is used
          const i = parseInteger(bytes, cur.start, slash);
          if (Number.isNaN(i)) throw new XchangeError('NUMBER_INVALID', { line });
          const v = i > 0 ? i - 1 : nv + i; // negative: relative to the vertices read so far
          if (!(i !== 0 && v >= 0 && v < nv)) throw new XchangeError('MESH_INDEX_OUT_OF_RANGE', { line });
          corners[n++] = v;
        }
        if (n === 3) sink.push(corners[0]!, corners[1]!, corners[2]!);
        else sink.polygon(corners, n, positions);
      } else if (k === FREEFORM) {
        throw new XchangeError('FORMAT_UNSUPPORTED', { reason: 'freeform', line });
      } else if (k === UNKNOWN) {
        throw malformed('unknownRecord', line);
      } else {
        while (cur.nextInLine()) continue; // ignored record
      }
    }
    cur.skipLine();
    if (cur.pos - start > PARSE_LIMITS.maxLineChars) throw malformed('lineTooLong', line);
  }

  const warnings: XchangeWarning[] = [];
  let outColors: Uint8Array | undefined;
  if (colors && colored === nv) outColors = colors.slice(0, 3 * nv);
  else if (colored > 0) warnings.push({ code: 'MESH_COLORS_IGNORED' });
  return finish('obj', positions.slice(0, 3 * nv), sink.result(), sink.dropped, outColors, warnings);
}
