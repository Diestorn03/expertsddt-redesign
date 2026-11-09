/**
 * iCam TransformedPoints TXT (spec 3.3): lines `<name>_Origin|_X|_Y|_Z x y z` (whitespace separated, mm)
 * and optionally `units: mm`. Each name needs its four points. Axes = endpoint - origin must have equal
 * lengths (1e-4 relative) above 1e-6 mm; they are normalised, then validateRigid(m, 1e-5).
 *
 * Errors (details, `row` = line number): POSITIONS_MALFORMED {format, reason, row}: 'line' |
 * 'endpointRepeated' | 'endpointMissing'; NUMBER_INVALID {row}; COORDINATE_OUT_OF_RANGE {row};
 * MATRIX_NOT_RIGID {reason: 'axisLength' | core/mat4 reasons, row}; UNITS_NOT_MM {row};
 * TOO_MANY_POSITIONS {limit}; plus SiteCollector errors (common.ts).
 */
import { XchangeError } from '../../core/errors';
import { LIMITS, MAX_ABS_COORDINATE_MM } from '../../core/limits';
import { fromAxes } from '../../core/mat4';
import type { Vec3 } from '../../core/types';
import { length, scale, sub } from '../../core/vec3';
import { malformed, number, requireMm, SiteCollector, type ParsedPositions } from './common';

const FORMAT = 'icam-txt';
const AXES = ['Origin', 'X', 'Y', 'Z'] as const;
type Axis = (typeof AXES)[number];
const ICAM_TOLERANCE = 1e-5;

export function parseICamPoints(text: string): ParsedPositions {
  const limit = LIMITS.positions.maxPositions;
  const groups = new Map<string, { row: number; points: Partial<Record<Axis, Vec3>> }>();
  text.split(/\r\n?|\n/).forEach((raw, k) => {
    const row = k + 1;
    const line = raw.trim();
    if (!line) return;
    const units = /^units\s*[:=]/i.exec(line);
    if (units) {
      requireMm(line.slice(units[0].length), row);
      return;
    }
    const tokens = line.split(/\s+/);
    const key = tokens[0]!;
    const cut = key.lastIndexOf('_');
    const axis = AXES.find((a) => a === key.slice(cut + 1));
    if (tokens.length !== 4 || cut < 1 || !axis) throw malformed(FORMAT, 'line', row);
    const point = tokens.slice(1).map((token) => number(token, row)) as Vec3;
    if (point.some((v) => Math.abs(v) > MAX_ABS_COORDINATE_MM)) throw new XchangeError('COORDINATE_OUT_OF_RANGE', { row });
    const name = key.slice(0, cut);
    let group = groups.get(name);
    if (!group) {
      if (groups.size >= limit) throw new XchangeError('TOO_MANY_POSITIONS', { limit });
      group = { row, points: {} };
      groups.set(name, group);
    }
    if (group.points[axis]) throw malformed(FORMAT, 'endpointRepeated', row);
    group.points[axis] = point;
  });

  const sites = new SiteCollector(FORMAT);
  for (const [name, { row, points }] of groups) {
    const { Origin: origin, X, Y, Z } = points;
    if (!origin || !X || !Y || !Z) throw malformed(FORMAT, 'endpointMissing', row);
    const axes = [X, Y, Z].map((p) => sub(p, origin));
    const lengths = axes.map((a) => length(a));
    const longest = Math.max(...lengths);
    const shortest = Math.min(...lengths);
    if (!(shortest > 1e-6) || longest - shortest > longest * 1e-4) {
      throw new XchangeError('MATRIX_NOT_RIGID', { reason: 'axisLength', row });
    }
    const [x, y, z] = axes.map((a, i) => scale(a, 1 / lengths[i]!)) as [Vec3, Vec3, Vec3];
    sites.add(name, fromAxes(x, y, z, origin), row, ICAM_TOLERANCE);
  }
  return sites.result();
}
