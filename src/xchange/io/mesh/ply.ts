/**
 * PLY reader: ascii, binary_little_endian and binary_big_endian 1.0. Needs a `vertex` element with
 * scalar x/y/z and a `face` element with one integer list `vertex_indices` (or `vertex_index`); every
 * other property and element is read past. Vertex colors: red/green/blue, all three or none.
 *
 * Error details: MESH_MALFORMED {format: 'ply', reason, line?}, reason one of magic, format, headerLine,
 * propertyBeforeElement, propertyType, duplicateName, elementCount, headerTooLong, noVertexElement,
 * vertexProperties, faceProperties, listCount, polygonCorners, trailingData; MESH_TRUNCATED {line?};
 * TOO_MANY_VERTICES / TOO_MANY_TRIANGLES {limit, count?}; MESH_INDEX_OUT_OF_RANGE {face};
 * NUMBER_INVALID / COORDINATE_OUT_OF_RANGE {vertex} (binary) or {line} (ascii); MESH_EMPTY {dropped};
 * TEXT_ENCODING {reason: 'nul'} (header).
 */
import { XchangeError, type XchangeWarning } from '../../core/errors';
import { MAX_ABS_COORDINATE_MM, PARSE_LIMITS } from '../../core/limits';
import { checkSize, coordinateError, Cursor, finish, nulError, TriangleSink } from './common';
import type { MeshParseLimits, ParsedMesh } from './index';

// Scalar type ids (index into SIZES); ids >= F32 are floating point.
const I8 = 0, U8 = 1, I16 = 2, U16 = 3, I32 = 4, U32 = 5, F32 = 6, F64 = 7;
const SIZES = [1, 1, 2, 2, 4, 4, 4, 8];
const TYPES = new Map<string, number>([
  ['char', I8], ['int8', I8], ['uchar', U8], ['uint8', U8], ['short', I16], ['int16', I16], ['ushort', U16], ['uint16', U16],
  ['int', I32], ['int32', I32], ['uint', U32], ['uint32', U32], ['float', F32], ['float32', F32], ['double', F64], ['float64', F64],
]);

// What a property feeds: 0..2 = x/y/z, R..R+2 = red/green/blue, INDICES = the face list.
const SKIP = -1, Z = 2, R = 3, INDICES = 6;
const VERTEX_ROLES = new Map<string, number>([['x', 0], ['y', 1], ['z', 2], ['red', 3], ['green', 4], ['blue', 5]]);
const MAX_CORNERS = PARSE_LIMITS.maxPolygonCorners;

interface Property {
  name: string;
  type: number;
  /** Type of the list count; -1 for a scalar. */
  countType: number;
  role: number;
}

interface Element {
  name: string;
  count: number;
  props: Property[];
}

interface Header {
  encoding: 'ascii' | 'le' | 'be';
  elements: Element[];
  bodyStart: number;
  lines: number;
}

const malformed = (reason: string, line?: number): XchangeError =>
  new XchangeError('MESH_MALFORMED', line === undefined ? { format: 'ply', reason } : { format: 'ply', reason, line });

export function isPLY(b: Uint8Array): boolean {
  return b[0] === 0x70 && b[1] === 0x6c && b[2] === 0x79 && (b[3] === 0x0a || (b[3] === 0x0d && b[4] === 0x0a));
}

export function parsePLY(bytes: Uint8Array, limits: MeshParseLimits): ParsedMesh {
  checkSize(bytes, limits);
  const h = parseHeader(bytes);
  const vertex = h.elements.find((e) => e.name === 'vertex');
  const face = h.elements.find((e) => e.name === 'face');
  if (!vertex) throw malformed('noVertexElement');

  for (const p of vertex.props) {
    const role = VERTEX_ROLES.get(p.name);
    if (role !== undefined && p.countType < 0) p.role = role;
  }
  const has = (role: number): boolean => vertex.props.some((p) => p.role === role);
  if (![0, 1, 2].every(has)) throw malformed('vertexProperties');
  const warnings: XchangeWarning[] = [];
  const channels = [R, R + 1, R + 2].filter(has).length;
  if (channels > 0 && channels < 3) {
    warnings.push({ code: 'MESH_COLORS_IGNORED' });
    for (const p of vertex.props) if (p.role >= R) p.role = SKIP;
  }
  if (face) {
    const lists = face.props.filter((p) => p.name === 'vertex_indices' || p.name === 'vertex_index');
    const list = lists[0];
    if (lists.length !== 1 || !list || list.countType < 0 || list.type >= F32) throw malformed('faceProperties');
    list.role = INDICES;
  }

  const plyMax = PARSE_LIMITS.plyMaxElementCount;
  const vertexLimit = Math.min(3 * limits.maxTriangles, plyMax), faceLimit = Math.min(limits.maxTriangles, plyMax);
  if (vertex.count > vertexLimit) throw new XchangeError('TOO_MANY_VERTICES', { limit: vertexLimit, count: vertex.count });
  if (face && face.count > faceLimit) throw new XchangeError('TOO_MANY_TRIANGLES', { limit: faceLimit, count: face.count });
  if (h.elements.some((e) => e.count > plyMax)) throw malformed('elementCount');
  if (!face || face.count === 0) throw new XchangeError('MESH_EMPTY', { dropped: 0 }); // point cloud

  // Every record needs at least its scalars and list counts (ascii: one char + one separator each).
  let need = 0;
  for (const e of h.elements) {
    let record = 0;
    for (const p of e.props) record += h.encoding === 'ascii' ? 2 : SIZES[p.countType < 0 ? p.type : p.countType]!;
    need += e.count * record;
  }
  if (need > bytes.length - h.bodyStart + (h.encoding === 'ascii' ? 1 : 0)) throw new XchangeError('MESH_TRUNCATED');

  const nv = vertex.count;
  const positions = new Float32Array(3 * nv);
  const colors = channels === 3 ? new Uint8Array(3 * nv) : undefined;
  const sink = new TriangleSink(face.count, limits.maxTriangles);
  const corners = new Uint32Array(MAX_CORNERS);
  const ready = h.elements.indexOf(vertex) < h.elements.indexOf(face);
  const body: Body = {
    nv,
    corners,
    /** False for a coordinate out of range or NaN anything. */
    set(role, r, v, type) {
      if (role <= Z) {
        if (!(Math.abs(v) <= MAX_ABS_COORDINATE_MM)) return false;
        positions[3 * r + role] = v;
      } else {
        if (Number.isNaN(v)) return false;
        colors![3 * r + role - R] = toByte(v, type);
      }
      return true;
    },
    face(n) {
      if (n === 3) sink.push(corners[0]!, corners[1]!, corners[2]!);
      else sink.polygon(corners, n, ready ? positions : null);
    },
  };
  if (h.encoding === 'ascii') readAscii(bytes, h, body);
  else readBinary(bytes, h, body);
  return finish('ply', positions, sink.result(), sink.dropped, colors, warnings);
}

interface Body {
  nv: number;
  corners: Uint32Array;
  set(role: number, record: number, value: number, type: number): boolean;
  face(corners: number): void;
}

function parseHeader(bytes: Uint8Array): Header {
  const max = Math.min(bytes.length, PARSE_LIMITS.plyMaxHeaderBytes);
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, max)); // one char per byte
  const elements: Element[] = [];
  const elementNames = new Set<string>();
  let propNames = new Set<string>();
  let encoding: Header['encoding'] | null = null;
  for (let p = 0, line = 1; ; line++) {
    const nl = text.indexOf('\n', p);
    if (nl < 0) {
      if (bytes.length <= max) throw new XchangeError('MESH_TRUNCATED', { line });
      throw malformed('headerTooLong', line);
    }
    const raw = text.slice(p, nl);
    p = nl + 1;
    if (raw.includes('\u0000')) throw nulError();
    const s = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === 1) {
      if (s !== 'ply') throw malformed('magic', line);
      continue;
    }
    const t = s.trim().split(/\s+/);
    switch (t[0]) {
      case '':
      case 'comment':
      case 'obj_info':
        break;
      case 'format': {
        const e = t[1] === 'ascii' ? 'ascii' : t[1] === 'binary_little_endian' ? 'le' : t[1] === 'binary_big_endian' ? 'be' : null;
        if (encoding || !e || t[2] !== '1.0' || t.length !== 3) throw malformed('format', line);
        encoding = e;
        break;
      }
      case 'element': {
        const name = t[1]!;
        if (t.length !== 3 || !/^\d+$/.test(t[2]!)) throw malformed('elementCount', line);
        if (elementNames.has(name)) throw malformed('duplicateName', line);
        elementNames.add(name);
        propNames = new Set();
        elements.push({ name, count: Number(t[2]), props: [] });
        break;
      }
      case 'property': {
        const el = elements[elements.length - 1];
        if (!el) throw malformed('propertyBeforeElement', line);
        const list = t[1] === 'list';
        if (t.length !== (list ? 5 : 3)) throw malformed('headerLine', line);
        const type = TYPES.get(t[list ? 3 : 1]!);
        const countType = list ? TYPES.get(t[2]!) : -1;
        if (type === undefined || countType === undefined || countType >= F32) throw malformed('propertyType', line);
        const name = t[list ? 4 : 2]!;
        if (propNames.has(name)) throw malformed('duplicateName', line);
        propNames.add(name);
        el.props.push({ name, type, countType, role: SKIP });
        break;
      }
      case 'end_header':
        if (!encoding) throw malformed('format', line);
        return { encoding, elements, bodyStart: p, lines: line };
      default:
        throw malformed('headerLine', line);
    }
  }
}

function read(view: DataView, o: number, type: number, little: boolean): number {
  switch (type) {
    case I8: return view.getInt8(o);
    case U8: return view.getUint8(o);
    case I16: return view.getInt16(o, little);
    case U16: return view.getUint16(o, little);
    case I32: return view.getInt32(o, little);
    case U32: return view.getUint32(o, little);
    case F32: return view.getFloat32(o, little);
    default: return view.getFloat64(o, little);
  }
}

/** uchar and other integers kept (clamped), ushort / 257, float 0-1 -> round(255·v), clamped. */
function toByte(v: number, type: number): number {
  const s = type >= F32 ? 255 * v : type === U16 ? v / 257 : v;
  return s <= 0 ? 0 : s >= 255 ? 255 : Math.round(s);
}

function readBinary(bytes: Uint8Array, h: Header, body: Body): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = h.encoding === 'le', end = bytes.length, corners = body.corners;
  let o = h.bodyStart;
  for (const el of h.elements) {
    const props = el.props;
    for (let r = 0; r < el.count; r++) {
      for (let k = 0; k < props.length; k++) {
        const p = props[k]!;
        const size = SIZES[p.type]!;
        if (p.countType < 0) {
          if (o + size > end) throw new XchangeError('MESH_TRUNCATED');
          if (p.role !== SKIP) {
            const v = read(view, o, p.type, little);
            if (!body.set(p.role, r, v, p.type)) throw coordinateError(v, { vertex: r });
          }
          o += size;
          continue;
        }
        const countSize = SIZES[p.countType]!;
        if (o + countSize > end) throw new XchangeError('MESH_TRUNCATED');
        const n = read(view, o, p.countType, little);
        o += countSize;
        if (n < 0) throw malformed('listCount');
        if (o + n * size > end) throw new XchangeError('MESH_TRUNCATED');
        if (p.role !== INDICES) {
          o += n * size;
          continue;
        }
        if (n > MAX_CORNERS) throw malformed('polygonCorners');
        for (let i = 0; i < n; i++, o += size) {
          const v = read(view, o, p.type, little);
          if (!(v >= 0 && v < body.nv)) throw new XchangeError('MESH_INDEX_OUT_OF_RANGE', { face: r });
          corners[i] = v;
        }
        body.face(n);
      }
    }
  }
  if (o !== end) throw malformed('trailingData');
}

function readAscii(bytes: Uint8Array, h: Header, body: Body): void {
  const cur = new Cursor(bytes, h.bodyStart, bytes.length, h.lines + 1);
  const corners = body.corners;
  const token = (): void => {
    if (!cur.next()) throw new XchangeError('MESH_TRUNCATED', { line: cur.line });
  };
  for (const el of h.elements) {
    const props = el.props;
    for (let r = 0; r < el.count; r++) {
      for (let k = 0; k < props.length; k++) {
        const p = props[k]!;
        token();
        if (p.countType < 0) {
          if (p.role !== SKIP) {
            const v = p.type >= F32 ? cur.number() : cur.integer();
            if (!body.set(p.role, r, v, p.type)) throw coordinateError(v, { line: cur.line });
          }
          continue;
        }
        const n = cur.integer();
        if (!(n >= 0)) throw malformed('listCount', cur.line);
        if (p.role !== INDICES) {
          for (let i = 0; i < n; i++) token(); // ignored list, values unparsed
          continue;
        }
        if (n > MAX_CORNERS) throw malformed('polygonCorners', cur.line);
        for (let i = 0; i < n; i++) {
          token();
          const v = cur.integer();
          if (Number.isNaN(v)) throw new XchangeError('NUMBER_INVALID', { line: cur.line });
          if (!(v >= 0 && v < body.nv)) throw new XchangeError('MESH_INDEX_OUT_OF_RANGE', { face: r });
          corners[i] = v;
        }
        body.face(n);
      }
    }
  }
  if (cur.next()) throw malformed('trailingData', cur.line);
}
